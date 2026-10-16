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
//   events     forward_events (event types) -> trigger `ha_event`;
//              watched_entities -> trigger `entity_state_changed`;
//   failures   connection lost -> unreachable badges, new attempt after 5 s,
//              doubling up to 60 s (a refused token: every 5 minutes).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { matcher, normalizeConfig } from './config.js';
import { HaAuthError, HaCommandError, HaSocket } from './ha/socket.js';
import { buildInventory } from './inventory.js';
import { SENSITIVE_COVERS, WriteError, domainOf } from './mapping.js';
import { StatePublisher } from './publisher.js';
import { ERRORS, STATUS, localizedError, testMessage } from './texts.js';

export const BRIDGE_TIMINGS = {
  reconnectMin: 5000,
  reconnectMax: 60_000,
  authRetry: 5 * 60_000,
  inventoryDebounce: 3000,
  refreshInterval: 60 * 60_000,
};

export const TRIGGERS = { HA_EVENT: 'ha_event', ENTITY_CHANGED: 'entity_state_changed' };
export const WIDGET_KEY = 'status';

/** Scene events per minute: the core takes 300, a chatty event type must not spend them all. */
export const EVENTS_PER_MINUTE = 120;

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
  }) {
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
    this.refreshTimer = this.timers.setInterval(() => this.pushAll(), this.timings.refreshInterval);
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
      socket.on('close', () => this.onLost(generation));
      await this.loadInventory(socket);
      await socket.subscribeEvents('state_changed', (event) => this.onStateChanged(event));
      for (const type of REGISTRY_EVENTS) {
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
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      if (this.socket === socket) {
        socket.removeAllListeners('close');
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
        if (err instanceof HaCommandError) {
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
    if (this.limited) {
      this.logger.warn(
        'The token is not an administrator one: devices and areas of Home Assistant are not read',
      );
    }
    this.snapshot = { config, states, entities, devices, areas };
    this.states = new Map((states ?? []).map((s) => [s.entity_id, s]));
    await this.rebuild();
  }

  async rebuild() {
    this.inventory = buildInventory(this.snapshot ?? {}, {
      ...this.config,
      externalIds: this.gladys.externalIds.bind(this.gladys),
    });
    this.watched = matcher(this.config.watched);
    await this.publishDevices();
    this.pushAll();
  }

  async publishDevices() {
    if (!this.gladys.connected) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(this.inventory.devices);
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  scheduleInventory() {
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
    }, this.timings.inventoryDebounce);
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
    if (!previous && this.config.domains.includes(domainOf(entityId))) {
      // A new entity: the inventory may change.
      this.scheduleInventory();
    }
    if (this.inventory.routes.has(entityId)) {
      this.pushEntity(entityId);
      if ((next.state === 'unavailable') !== (previous?.state === 'unavailable')) {
        this.publishTransports().catch(() => {});
      }
    }
    if (
      this.watched?.(entityId) &&
      previous &&
      previous.state !== next.state &&
      !this.inventory.entityDevice.has(entityId)
    ) {
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
    this.transports.delete(device.external_id);
    this.pushAll();
    await this.publishTransports();
    this.requestWidgetRefresh();
  }

  async onDeviceDeleted(device) {
    this.publisher.forget(device.external_id);
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
  async callService(domain, service, data = {}, entityId) {
    if (this.status !== 'online' || !this.socket) {
      throw this.error('offline');
    }
    try {
      await this.socket.call('call_service', {
        domain,
        service,
        service_data: data,
        ...(entityId ? { target: { entity_id: entityId } } : {}),
      });
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

  /** Locks, and covers that open a garage, a gate or a door. */
  isSecurityEntity(entityId) {
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
