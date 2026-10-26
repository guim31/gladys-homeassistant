// -----------------------------------------------------------------------------
// The bridge: one Home Assistant connection, its inventory, the live states,
// the commands and the scene events.
//
//   connect    HaSocket (auth with the long-lived token), then get_config,
//              get_states and the entity, device and area registries;
//   inventory  src/inventory.js -> publishDiscoveredDevices (Discovery tab);
//   live       subscribe_events state_changed -> the features of the devices
//              ADDED in Gladys only (the others would be dropped by the core
//              and spend the 300 states/min);
//   registry   entity/device/area_registry_updated, an entity created or
//              removed -> the inventory is read again (debounced);
//   commands   onSetValue -> call_service; Home Assistant's state_changed
//              echo is the feedback;
//   music      media players -> publishNowPlaying (src/music.js); browse_media,
//              search_media and play_media for the music panels of Gladys 5.3;
//              artwork read with the long-lived token, made small enough;
//   events     forward_events (event types) -> trigger `ha_event`;
//              watched_entities -> trigger `entity_state_changed`;
//   failures   connection lost -> unreachable badges, new attempt after 5 s,
//              doubling up to 60 s (a refused token: every 5 minutes).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { matcher, normalizeConfig } from './config.js';
import { HaAuthError, HaCommandError, HaSocket } from './ha/socket.js';
import { buildInventory } from './inventory.js';
import { ArtworkError, prepareArtwork, readLimited } from './artwork-resize.js';
import { MEDIA, SENSITIVE_COVERS, WriteError, domainOf, has } from './mapping.js';
import { MediaIds, SEARCH_CLASSES, httpBase, nowPlayingOf, toMediaItem } from './music.js';
import { StatePublisher } from './publisher.js';
import { ERRORS, STATUS, localizedError, testMessage } from './texts.js';

export const BRIDGE_TIMINGS = {
  reconnectMin: 5000,
  reconnectMax: 60_000,
  authRetry: 5 * 60_000,
  inventoryDebounce: 3000,
  // Home Assistant still starting: its inventory is read again after this delay.
  startingRetry: 10_000,
  refreshInterval: 60 * 60_000,
  // Gladys waits 10 s for a music answer, 15 s for an artwork.
  musicTimeout: 8000,
  artworkTimeout: 10_000,
  browseCache: 60_000,
};

/** Largest artwork read before resizing. */
export const MAX_ARTWORK_DOWNLOAD = 10 * 1024 * 1024;

export const TRIGGERS = { HA_EVENT: 'ha_event', ENTITY_CHANGED: 'entity_state_changed' };
export const WIDGET_KEY = 'status';

/** Scene events per minute: the core takes 300, a chatty event type must not spend them all. */
export const EVENTS_PER_MINUTE = 120;

/** The core refuses a discovered list longer than this (setDiscoveredDevices, 5.2.0). */
export const MAX_DISCOVERED_DEVICES = 2000;

const REGISTRY_EVENTS = [
  'entity_registry_updated',
  'device_registry_updated',
  'area_registry_updated',
];

const short = (value, max = 1000) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > max ? text.slice(0, max) : text;
};

export class Bridge {
  constructor({
    gladys,
    logger,
    createSocket,
    timers = globalThis,
    timings = BRIDGE_TIMINGS,
    socketTimings,
    publisherTimings,
    now = Date.now,
    fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  }) {
    this.fetch = fetchImpl;
    this.gladys = gladys;
    this.logger = logger;
    this.createSocket = createSocket;
    this.timers = timers;
    this.timings = { ...BRIDGE_TIMINGS, ...timings };
    this.socketTimings = socketTimings;
    this.now = now;
    this.publisher = new StatePublisher({
      gladys,
      logger,
      now,
      timers,
      timings: publisherTimings,
    });
    this.config = normalizeConfig({});
    this.configKey = undefined;
    this.status = 'not_configured';
    this.version = undefined;
    this.socket = undefined;
    this.snapshot = undefined;
    /** entity_id -> last state object */
    this.states = new Map();
    this.inventory = buildInventory({}, { externalIds: gladys.externalIds.bind(gladys) });
    this.limited = false;
    this.generation = 0;
    this.reconnectTimer = undefined;
    this.inventoryTimer = undefined;
    this.refreshTimer = undefined;
    this.delay = this.timings.reconnectMin;
    this.transports = new Map();
    this.eventWindow = [];
    this.eventsDropped = false;
    this.mediaIds = new MediaIds();
    /** entity_id -> first sight of a position without its timestamp */
    this.samples = new Map();
    /** browse_media answers, for the "load more" pages: key -> { at, node } */
    this.browseCache = new Map();
  }

  // --- Configuration and lifecycle -----------------------------------------------

  /** Applies a configuration; restarts the connection when it changed. */
  async configure(raw) {
    const key = JSON.stringify(raw ?? {});
    if (key === this.configKey && this.status !== 'not_configured') {
      return;
    }
    this.configKey = key;
    this.config = normalizeConfig(raw);
    this.publisher.setInterval(this.config.sensorInterval);
    await this.restart();
  }

  async restart() {
    this.disconnect();
    this.generation += 1;
    this.delay = this.timings.reconnectMin;
    this.publisher.start();
    this.timers.clearInterval(this.refreshTimer);
    // Hourly, the values again (the heartbeat keeps them dated): never a frozen value while offline.
    this.refreshTimer = this.timers.setInterval(() => {
      if (this.status === 'online') {
        this.pushAll();
      }
    }, this.timings.refreshInterval);
    if (this.config.invalidUrl || !this.config.url || !this.config.token) {
      this.status = this.config.invalidUrl ? 'invalid_url' : 'not_configured';
      await this.setConnectionStatus(false, STATUS[this.status]);
      return;
    }
    await this.connect(this.generation);
  }

  /** Stops everything (shutdown, tests). */
  stop() {
    this.generation += 1;
    this.disconnect();
    this.publisher.stop();
    this.timers.clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  disconnect() {
    this.timers.clearTimeout(this.reconnectTimer);
    this.timers.clearTimeout(this.inventoryTimer);
    this.reconnectTimer = undefined;
    this.inventoryTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.removeAllListeners('close');
      socket.close();
    }
  }

  async setConnectionStatus(connected, message) {
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.logger.debug(`Connection status not sent: ${err.message}`);
    }
  }

  async connect(generation) {
    if (generation !== this.generation) {
      return;
    }
    if (this.status !== 'unreachable' && this.status !== 'auth_failed') {
      this.status = 'connecting';
    }
    const socket = new HaSocket({
      url: this.config.url,
      token: this.config.token,
      createSocket: this.createSocket,
      timings: this.socketTimings,
      timers: this.timers,
    });
    try {
      this.version = await socket.connect();
      if (generation !== this.generation) {
        socket.close();
        return;
      }
      this.socket = socket;
      // Subscribed before get_states: no change is lost between the snapshot and the events.
      await socket.subscribeEvents('state_changed', (event) => this.onStateChanged(event));
      await this.loadInventory(socket);
      for (const type of [...REGISTRY_EVENTS, 'homeassistant_started']) {
        await socket
          .subscribeEvents(type, () => this.scheduleInventory())
          .catch((err) =>
            this.logger.warn(`Home Assistant refused the ${type} events: ${err.message}`),
          );
      }
      for (const type of this.config.forwardEvents) {
        await socket
          .subscribeEvents(type, (event) => this.forwardEvent(event))
          .catch((err) =>
            this.logger.warn(`Home Assistant refused the "${type}" events: ${err.message}`),
          );
      }
      // The loss of the link is watched from here on; a loss during the load failed a call above.
      if (socket.closed) {
        throw new Error('connection lost');
      }
      socket.on('close', () => this.onLost(generation));
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      if (this.socket === socket) {
        this.socket = undefined;
      }
      socket.close();
      await this.onFailure(generation, err);
      return;
    }
    const wasDown = this.status === 'unreachable' || this.status === 'auth_failed';
    this.status = 'online';
    this.delay = this.timings.reconnectMin;
    this.logger.info(
      `${wasDown ? 'Connected again' : 'Connected'} to Home Assistant ${this.version ?? ''}: ${this.inventory.devices.length} devices, ${this.inventory.entityCount} entities`.replace(
        '  ',
        ' ',
      ),
    );
    await this.setConnectionStatus(true);
    await this.publishTransports();
    this.requestWidgetRefresh();
  }

  async onFailure(generation, err) {
    const auth = err instanceof HaAuthError;
    const status = auth ? 'auth_failed' : 'unreachable';
    if (this.status !== status) {
      // One line at the first failure, one at the recovery: not one per attempt.
      this.logger.warn(
        auth
          ? 'Home Assistant refused the access token'
          : `Home Assistant is unreachable: ${err.message}`,
      );
    }
    this.status = status;
    await this.setConnectionStatus(false, STATUS[status]);
    await this.publishTransports();
    this.requestWidgetRefresh();
    this.scheduleReconnect(generation, auth ? this.timings.authRetry : this.delay);
    if (!auth) {
      this.delay = Math.min(this.delay * 2, this.timings.reconnectMax);
    }
  }

  async onLost(generation) {
    if (generation !== this.generation) {
      return;
    }
    this.socket = undefined;
    this.timers.clearTimeout(this.inventoryTimer);
    await this.onFailure(generation, new Error('connection lost'));
  }

  scheduleReconnect(generation, delay) {
    this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect(generation).catch((err) => this.logger.error(err.message));
    }, delay);
  }

  // --- Inventory -----------------------------------------------------------------

  async loadInventory(socket = this.socket) {
    // The registries are admin commands: without them, one device per entity, no areas.
    const registry = (type) =>
      socket.call(type).catch((err) => {
        // Only a refusal for rights: any other error must not change every external id.
        if (err instanceof HaCommandError && err.code === 'unauthorized') {
          this.limited = true;
          return [];
        }
        throw err;
      });
    this.limited = false;
    const [config, states, entities, devices, areas] = await Promise.all([
      socket.call('get_config'),
      socket.call('get_states'),
      registry('config/entity_registry/list'),
      registry('config/device_registry/list'),
      registry('config/area_registry/list'),
    ]);
    const starting = config?.state && config.state !== 'RUNNING';
    if (starting && this.snapshot?.states?.length) {
      // Restarting: its entities are not all loaded yet. The previous inventory stays
      // (no empty Discovery, commands still routed) until homeassistant_started or a retry.
      for (const state of states ?? []) {
        this.states.set(state.entity_id, state);
      }
      this.scheduleInventory(this.timings.startingRetry);
      return;
    }
    if (starting) {
      this.scheduleInventory(this.timings.startingRetry);
    }
    if (this.limited && !this.limitedWarned) {
      this.limitedWarned = true;
      this.logger.warn(
        'The token is not an administrator one: devices and areas of Home Assistant are not read',
      );
    }
    this.snapshot = { config, states, entities, devices, areas };
    // A state_changed received while the snapshot was read is newer: it is kept.
    const merged = new Map();
    for (const state of states ?? []) {
      const live = this.states.get(state.entity_id);
      merged.set(
        state.entity_id,
        live && String(live.last_updated ?? '') > String(state.last_updated ?? '') ? live : state,
      );
    }
    this.states = merged;
    await this.rebuild();
  }

  async rebuild() {
    this.inventory = buildInventory(this.snapshot ?? {}, {
      ...this.config,
      externalIds: this.gladys.externalIds.bind(this.gladys),
    });
    this.watched = matcher(this.config.watched);
    this.included = matcher(this.config.include);
    await this.publishDevices();
    this.pushAll();
  }

  async publishDevices() {
    if (!this.gladys.connected) {
      return;
    }
    let devices = this.inventory.devices;
    if (devices.length > MAX_DISCOVERED_DEVICES) {
      // The core refuses the whole list beyond it: the first ones are offered.
      this.logger.warn(
        `${devices.length} devices: only the first ${MAX_DISCOVERED_DEVICES} are offered, narrow the selection`,
      );
      devices = devices.slice(0, MAX_DISCOVERED_DEVICES);
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  scheduleInventory(delay = this.timings.inventoryDebounce) {
    this.timers.clearTimeout(this.inventoryTimer);
    const generation = this.generation;
    this.inventoryTimer = this.timers.setTimeout(() => {
      this.inventoryTimer = undefined;
      if (generation !== this.generation || !this.socket) {
        return;
      }
      this.loadInventory()
        .then(() => this.publishTransports())
        .catch((err) =>
          this.logger.warn(`Reading the Home Assistant inventory failed: ${err.message}`),
        );
    }, delay);
  }

  /** Scan button, widget "Reload": the inventory now. */
  async scan() {
    if (this.status === 'online' && this.socket) {
      await this.loadInventory();
      await this.publishTransports();
    } else {
      await this.publishDevices();
    }
  }

  // --- States --------------------------------------------------------------------

  /** The external ids of the features of OUR devices added in Gladys. */
  createdFeatures() {
    const ids = new Set();
    for (const device of this.gladys.devices ?? []) {
      for (const feature of device.features ?? []) {
        ids.add(feature.external_id);
      }
    }
    return ids;
  }

  pushEntity(entityId, created = this.createdFeatures()) {
    const state = this.states.get(entityId);
    if (state && this.inventory.players.has(entityId)) {
      this.publishPlayer(entityId, state, created);
    }
    for (const route of this.inventory.routes.get(entityId) ?? []) {
      if (!state || !created.has(route.featureId)) {
        continue;
      }
      let value;
      try {
        value = route.read(state);
      } catch {
        value = null;
      }
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        this.publisher.push(route.featureId, value, route.throttle);
      }
    }
  }

  /** A media player: its music features through publishNowPlaying, the ones added in Gladys. */
  publishPlayer(entityId, state, created) {
    const player = this.inventory.players.get(entityId);
    const snapshot = nowPlayingOf(state, {
      now: this.now(),
      base: httpBase(this.config.url),
      samples: this.samples,
    });
    if (!snapshot || !this.gladys.connected) {
      return;
    }
    const values = {};
    const featureExternalIds = {};
    for (const [key, value] of Object.entries(snapshot)) {
      const featureId = player.features[key];
      if (value !== undefined && featureId && created.has(featureId)) {
        values[key] = value;
        featureExternalIds[key === 'artwork_url' ? 'artwork' : key] = featureId;
      }
    }
    if (Object.keys(values).length === 0) {
      return;
    }
    this.gladys
      .publishNowPlaying(player.snapshotId, values, { featureExternalIds })
      .catch((err) => this.logger.debug(`Now playing of ${entityId} not sent: ${err.message}`));
  }

  /** Forget the now-playing snapshots of a device: the next states publish everything. */
  forgetPlayers(deviceId) {
    for (const player of this.inventory.players.values()) {
      if (player.deviceId === deviceId) {
        this.gladys.forgetPublishedStates(player.snapshotId);
      }
    }
  }

  pushAll() {
    const created = this.createdFeatures();
    for (const entityId of this.inventory.routes.keys()) {
      this.pushEntity(entityId, created);
    }
  }

  onStateChanged(event) {
    const data = event?.data ?? {};
    const entityId = data.entity_id;
    if (typeof entityId !== 'string') {
      return;
    }
    const { new_state: next, old_state: previous } = data;
    if (!next) {
      this.states.delete(entityId);
      if (this.inventory.entityDevice.has(entityId)) {
        this.scheduleInventory();
      }
      return;
    }
    this.states.set(entityId, next);
    if (
      !previous &&
      (this.config.domains.includes(domainOf(entityId)) || this.included?.(entityId))
    ) {
      // A new entity: the inventory may change.
      this.scheduleInventory();
    }
    if (this.inventory.routes.has(entityId) || this.inventory.players.has(entityId)) {
      this.pushEntity(entityId);
      if ((next.state === 'unavailable') !== (previous?.state === 'unavailable')) {
        this.publishTransports().catch(() => {});
      }
    }
    // Listed by the user: fired even when the entity is also offered as a device.
    if (this.watched?.(entityId) && previous && previous.state !== next.state) {
      this.sceneEvent(TRIGGERS.ENTITY_CHANGED, {
        entity_id: entityId,
        state: short(next.state, 255),
        old_state: short(previous.state, 255),
        name: short(next.attributes?.friendly_name ?? entityId, 255),
      });
    }
  }

  /** unreachable for every device when Home Assistant is, or when all its entities are unavailable. */
  async publishTransports() {
    if (!this.gladys.connected) {
      return;
    }
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const entities = new Map();
    for (const [entityId, deviceId] of this.inventory.entityDevice) {
      if (created.has(deviceId)) {
        const list = entities.get(deviceId) ?? [];
        list.push(entityId);
        entities.set(deviceId, list);
      }
    }
    const entries = [];
    for (const [deviceId, list] of entities) {
      const down =
        this.status !== 'online' ||
        list.every((id) => (this.states.get(id)?.state ?? 'unavailable') === 'unavailable');
      const transport = down ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
      if (this.transports.get(deviceId) !== transport) {
        this.transports.set(deviceId, transport);
        entries.push({ external_id: deviceId, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      try {
        await this.gladys.publishTransports(entries.slice(i, i + 100));
      } catch (err) {
        for (const entry of entries.slice(i, i + 100)) {
          this.transports.delete(entry.external_id);
        }
        this.logger.debug(`Transport badges not sent: ${err.message}`);
      }
    }
  }

  // --- Gladys events -------------------------------------------------------------

  async onGladysConnected() {
    this.transports.clear();
    if (
      this.configKey === undefined ||
      JSON.stringify(this.gladys.config ?? {}) !== this.configKey
    ) {
      await this.configure(this.gladys.config ?? {});
      return;
    }
    await this.publishDevices();
    this.pushAll();
    await this.publishTransports();
  }

  async onDeviceCreated(device) {
    // The SDK forgot the values of this device: they are sent again now.
    this.publisher.forget(device.external_id);
    this.forgetPlayers(device.external_id);
    this.transports.delete(device.external_id);
    this.pushAll();
    await this.publishTransports();
    this.requestWidgetRefresh();
  }

  async onDeviceDeleted(device) {
    this.publisher.forget(device.external_id);
    this.forgetPlayers(device.external_id);
    this.transports.delete(device.external_id);
    this.requestWidgetRefresh();
  }

  requestWidgetRefresh() {
    if (this.gladys.connected) {
      // Fire-and-forget in the SDK: it may return nothing.
      Promise.resolve()
        .then(() => this.gladys.requestWidgetRefresh(WIDGET_KEY))
        .catch(() => {});
    }
  }

  // --- Commands ------------------------------------------------------------------

  error(key, detail = '') {
    return localizedError(ERRORS[key], this.config.language, detail);
  }

  /**
   * One Home Assistant service call, the one way out for every command.
   * @param {string} domain
   * @param {string} service
   * @param {object} [data]
   * @param {string} [entityId]
   */
  async callService(domain, service, data = {}, entityId, timeout) {
    if (this.status !== 'online' || !this.socket) {
      throw this.error('offline');
    }
    try {
      await this.socket.call(
        'call_service',
        {
          domain,
          service,
          service_data: data,
          ...(entityId ? { target: { entity_id: entityId } } : {}),
        },
        timeout ?? this.socket.timings.serviceTimeout,
      );
    } catch (err) {
      throw this.error('refused', err.message);
    }
  }

  async setValue(device, feature, value) {
    const id = feature.external_id;
    const writer = this.inventory.writers.get(id);
    if (!writer) {
      const entityId = this.inventory.featureEntity.get(id);
      if (entityId && this.isSecurityEntity(entityId)) {
        throw this.error('security_disabled');
      }
      throw this.error('unknown_feature');
    }
    const state = this.states.get(writer.entityId) ?? {
      entity_id: writer.entityId,
      attributes: {},
    };
    let call;
    try {
      call = writer.write(value, state);
    } catch (err) {
      if (err instanceof WriteError) {
        throw this.error(err.key);
      }
      throw err;
    }
    this.logger.info(`Command: ${writer.domain}.${call.service} on ${writer.entityId}`);
    await this.callService(writer.domain, call.service, call.data ?? {}, writer.entityId);
  }

  // --- Music players (Gladys 5.3) ----------------------------------------------

  /** The media_player of a Gladys device able to do `bit`, or a localized refusal. */
  playerEntity(device, bit, refusal) {
    if (this.status !== 'online' || !this.socket) {
      throw this.error('offline');
    }
    const entities = [];
    for (const [entityId, player] of this.inventory.players) {
      if (player.deviceId === device?.external_id) {
        entities.push(entityId);
      }
    }
    if (entities.length === 0) {
      throw this.error('unknown_feature');
    }
    const entityId = entities.find((id) => has(this.states.get(id) ?? {}, bit));
    if (!entityId) {
      throw this.error(refusal);
    }
    return entityId;
  }

  async musicCall(type, payload) {
    try {
      return await this.socket.call(type, payload, this.timings.musicTimeout);
    } catch (err) {
      throw this.error('refused', err.message);
    }
  }

  mediaItem(node) {
    return toMediaItem(node, {
      ids: this.mediaIds,
      artworkKey: (url) => this.gladys.artworkKey(url),
      base: httpBase(this.config.url),
    });
  }

  decodeMedia(id) {
    const media = this.mediaIds.decode(id);
    if (!media) {
      throw this.error('media_unknown');
    }
    return media;
  }

  async musicBrowse(device, { parentId = null, offset = 0, limit = 50 } = {}) {
    const entityId = this.playerEntity(device, MEDIA.BROWSE_MEDIA, 'browse_unsupported');
    const payload = { entity_id: entityId };
    if (parentId) {
      const media = this.decodeMedia(parentId);
      payload.media_content_type = media.type;
      payload.media_content_id = media.id;
    }
    // Home Assistant answers a whole level: the next pages come from this answer.
    const key = JSON.stringify(payload);
    const now = this.now();
    for (const [k, entry] of this.browseCache) {
      if (now - entry.at > this.timings.browseCache) {
        this.browseCache.delete(k);
      }
    }
    let node = offset > 0 ? this.browseCache.get(key)?.node : undefined;
    if (!node) {
      node = await this.musicCall('media_player/browse_media', payload);
      this.browseCache.delete(key);
      this.browseCache.set(key, { at: now, node });
      if (this.browseCache.size > 20) {
        this.browseCache.delete(this.browseCache.keys().next().value);
      }
    }
    const children = Array.isArray(node?.children) ? node.children : [];
    return {
      items: children.slice(offset, offset + limit).map((child) => this.mediaItem(child)),
      total: children.length,
    };
  }

  async musicSearch(device, { query, type = null, limit = 20 } = {}) {
    const entityId = this.playerEntity(device, MEDIA.SEARCH_MEDIA, 'search_unsupported');
    const answer = await this.musicCall('media_player/search_media', {
      entity_id: entityId,
      search_query: String(query ?? ''),
      ...(type && SEARCH_CLASSES[type] ? { media_filter_classes: SEARCH_CLASSES[type] } : {}),
    });
    const results = Array.isArray(answer?.result) ? answer.result : [];
    return { items: results.slice(0, limit).map((node) => this.mediaItem(node)) };
  }

  async musicPlay(device, media, mode = 'replace') {
    const entityId = this.playerEntity(device, MEDIA.PLAY_MEDIA, 'play_media_unsupported');
    const { type, id } = this.decodeMedia(media?.id);
    const enqueue = { next: 'next', append: 'add' }[mode];
    // Home Assistant ignores `enqueue` on a player without a queue: it would replace.
    if (enqueue && !has(this.states.get(entityId) ?? {}, MEDIA.MEDIA_ENQUEUE)) {
      throw this.error('enqueue_unsupported');
    }
    this.logger.info(`Command: media_player.play_media (${mode}) on ${entityId}`);
    await this.callService(
      'media_player',
      'play_media',
      { media_content_id: id, media_content_type: type, ...(enqueue ? { enqueue } : {}) },
      entityId,
      this.timings.musicTimeout,
    );
  }

  /**
   * onMusicGetArtwork: the image of a key, read with the long-lived token from
   * Home Assistant (never sent elsewhere), made small enough for the core:
   * the media player proxy serves the artwork at its original size.
   */
  async artwork(key) {
    const url = this.gladys.artworkUrls.get(key);
    if (url === undefined) {
      throw new Error(`Unknown artwork ${key}`);
    }
    const base = httpBase(this.config.url);
    const own = Boolean(base) && new URL(url).origin === new URL(base).origin;
    let response;
    try {
      response = await this.fetch(url, {
        headers: own ? { authorization: `Bearer ${this.config.token}` } : {},
        // The token must not follow a redirection.
        redirect: own ? 'error' : 'follow',
        signal: AbortSignal.timeout(this.timings.artworkTimeout),
      });
    } catch (err) {
      throw new Error(`Artwork ${key}: ${err.message}`, { cause: err });
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Artwork ${key}: HTTP ${response.status}`);
    }
    try {
      if (Number(response.headers.get('content-length')) > MAX_ARTWORK_DOWNLOAD) {
        throw new ArtworkError('TOO_LARGE', 'Image larger than 10 MB');
      }
      const image = await prepareArtwork(await readLimited(response.body, MAX_ARTWORK_DOWNLOAD));
      return image.toString('base64');
    } catch (err) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Artwork ${key}: ${err.message}`, { cause: err });
    }
  }

  /** Locks, and covers that open a garage, a gate or a door. */
  isSecurityEntity(raw) {
    const entityId = String(raw ?? '')
      .trim()
      .toLowerCase();
    const domain = domainOf(entityId);
    if (domain === 'lock' || domain === 'alarm_control_panel') {
      return true;
    }
    if (domain === 'cover') {
      return SENSITIVE_COVERS.includes(this.states.get(entityId)?.attributes?.device_class);
    }
    return false;
  }

  // --- Scene events --------------------------------------------------------------

  forwardEvent(event) {
    const data = event?.data && typeof event.data === 'object' ? event.data : {};
    this.sceneEvent(TRIGGERS.HA_EVENT, {
      event_type: short(event?.event_type ?? '', 255),
      entity_id: typeof data.entity_id === 'string' ? data.entity_id : null,
      data: short(data),
    });
  }

  sceneEvent(key, data) {
    const now = this.now();
    this.eventWindow = this.eventWindow.filter((t) => now - t < 60_000);
    if (this.eventWindow.length >= EVENTS_PER_MINUTE) {
      if (!this.eventsDropped) {
        this.eventsDropped = true;
        this.logger.warn(
          `More than ${EVENTS_PER_MINUTE} Home Assistant events in a minute: the next ones are dropped`,
        );
      }
      return;
    }
    this.eventsDropped = false;
    this.eventWindow.push(now);
    this.gladys
      .publishSceneEvent(key, data)
      .catch((err) => this.logger.debug(`Scene event ${key} not sent: ${err.message}`));
  }

  // --- Connection test, widget ---------------------------------------------------

  async testConnection() {
    if (this.status === 'online') {
      const message = testMessage({
        version: this.version ?? '?',
        devices: this.inventory.devices.length,
        entities: this.inventory.entityCount,
        ignored: this.inventory.ignored,
      });
      if (this.limited) {
        for (const lang of Object.keys(message)) {
          message[lang] = `${message[lang]} ${STATUS.not_admin[lang]}`;
        }
      }
      return message;
    }
    const status = ['connecting', 'online'].includes(this.status) ? 'unreachable' : this.status;
    throw localizedError(STATUS[status], this.config.language);
  }

  summary() {
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const offered = this.inventory.devices.map((d) => d.external_id);
    const added = offered.filter((id) => created.has(id));
    let followed = 0;
    for (const [, deviceId] of this.inventory.entityDevice) {
      if (created.has(deviceId)) {
        followed += 1;
      }
    }
    return {
      status: this.status,
      version: this.version,
      offered: offered.length,
      added: added.length,
      followed,
    };
  }
}
