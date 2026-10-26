// -----------------------------------------------------------------------------
// Home Assistant states and registries -> Gladys devices and routing tables (pure).
//
// One Gladys device per Home Assistant DEVICE (device registry), holding the
// features of its selected entities; an entity without a device (YAML
// helpers, templates, older platforms) is a Gladys device of its own.
// External ids are built from ids Home Assistant never changes:
//   device   ext:<selector>:device:<device registry id>
//            ext:<selector>:entity:<entity registry id | entity_id>
//   feature  <device id>:<entity registry id | entity_id>-<role>
// The entity registry id survives a renamed entity_id; an entity without a
// registry entry (no unique_id) cannot be renamed, so its entity_id is stable.
//
// Selection (configuration): domains, areas, entities to include or exclude.
// Disabled entities have no state; hidden ones and the configuration and
// diagnostic entities (a LED brightness, a signal strength) are left out
// unless included by name, except the battery levels.
// -----------------------------------------------------------------------------

import { matcher } from './config.js';
import { domainOf, mapEntity } from './mapping.js';
import { ROLE_NAMES } from './texts.js';

const cut = (text, max = 100) => String(text ?? '').slice(0, max);

/**
 * Never listed as "not imported": the domains every install has, and the ones
 * the scene actions run (scripts, scenes, buttons).
 */
const SILENT_DOMAINS = new Set([
  'script',
  'scene',
  'button',
  'input_button',
  'automation',
  'zone',
  'sun',
  'person',
  'conversation',
  'stt',
  'tts',
  'update',
  'notify',
  'event',
  'todo',
  'wake_word',
  'assist_satellite',
  'ai_task',
]);

/**
 * @param {object} snapshot { states, entities, devices, areas, config } read from Home Assistant
 * @param {object} options the normalized configuration (src/config.js) + { externalIds }
 */
export function buildInventory(snapshot, options) {
  const { externalIds, language = 'fr' } = options;
  const states = Array.isArray(snapshot.states) ? snapshot.states : [];
  const registry = new Map((snapshot.entities ?? []).map((e) => [e.entity_id, e]));
  const haDevices = new Map((snapshot.devices ?? []).map((d) => [d.id, d]));
  const areas = new Map((snapshot.areas ?? []).map((a) => [a.area_id, a]));
  const included = matcher(options.include ?? []);
  const excluded = matcher(options.exclude ?? []);
  const selectedDomains = new Set(options.domains ?? []);
  const selectedAreas = new Set(options.areas ?? []);
  const temperatureUnit = snapshot.config?.unit_system?.temperature ?? '°C';
  const roles = ROLE_NAMES[language] ?? ROLE_NAMES.en;

  /** device external id -> { device, names } */
  const devices = new Map();
  const routes = new Map();
  const writers = new Map();
  /** feature external id -> entity_id, read-only features included */
  const featureEntity = new Map();
  const ignored = new Map();
  const entityDevice = new Map();
  /** media_player entity_id -> { deviceId, snapshotId, features: { nowPlaying key -> feature id } } */
  const players = new Map();
  let entityCount = 0;

  const areaOf = (reg, haDevice) => areas.get(reg?.area_id ?? haDevice?.area_id);
  /** feature ids of the devices added in Gladys: kept even when their bit is gone */
  const existing = options.existing ?? new Set();

  /**
   * The selection of the configuration: `skip` (disabled, excluded, hidden…),
   * `ignored` (a domain not selected, counted in the connection test) or `ok`.
   */
  const select = (s) => {
    const entityId = s?.entity_id;
    if (typeof entityId !== 'string' || !entityId.includes('.')) {
      return 'skip';
    }
    const reg = registry.get(entityId);
    if (reg?.disabled_by || excluded(entityId)) {
      return 'skip';
    }
    if (included(entityId)) {
      return 'ok';
    }
    if (!selectedDomains.has(domainOf(entityId))) {
      return 'ignored';
    }
    const haDevice = reg?.device_id ? haDevices.get(reg.device_id) : undefined;
    const area = areaOf(reg, haDevice);
    const battery = s.attributes?.device_class === 'battery';
    if (reg?.hidden_by || (reg?.entity_category && !battery)) {
      return 'skip';
    }
    if (
      selectedAreas.size > 0 &&
      !(area && (selectedAreas.has(area.area_id) || selectedAreas.has(area.name.toLowerCase())))
    ) {
      return 'skip';
    }
    return 'ok';
  };

  // One player per Home Assistant device carries the music features (the Music
  // widget picks features by type), the others stay as in 1.0: the selected
  // player that already has them in Gladys, else the smallest registry id.
  const primaryPlayer = new Map();
  for (const s of states) {
    const reg = registry.get(s?.entity_id);
    const haDevice = reg?.device_id ? haDevices.get(reg.device_id) : undefined;
    if (
      domainOf(s?.entity_id) !== 'media_player' ||
      !haDevice ||
      haDevice.disabled_by ||
      select(s) !== 'ok'
    ) {
      continue;
    }
    const key = reg.id ?? s.entity_id;
    const added = existing.has(externalIds('device', haDevice.id).feature(`${key}-title`));
    const current = primaryPlayer.get(haDevice.id);
    if (
      current === undefined ||
      (added && !current.added) ||
      (added === current.added && key < current.key)
    ) {
      primaryPlayer.set(haDevice.id, { key, added });
    }
  }

  for (const s of states) {
    const selection = select(s);
    if (selection !== 'ok') {
      if (selection === 'ignored' && !SILENT_DOMAINS.has(domainOf(s.entity_id))) {
        const domain = domainOf(s.entity_id);
        ignored.set(domain, (ignored.get(domain) ?? 0) + 1);
      }
      continue;
    }
    const entityId = s.entity_id;
    const domain = domainOf(entityId);
    const reg = registry.get(entityId);
    const haDevice = reg?.device_id ? haDevices.get(reg.device_id) : undefined;
    const area = areaOf(reg, haDevice);
    const entityKey = reg?.id ?? entityId;
    const features = mapEntity(s, {
      allowSecurity: options.allowSecurity,
      temperatureUnit,
      language,
      primary:
        !haDevice ||
        Boolean(haDevice.disabled_by) ||
        (primaryPlayer.get(haDevice.id)?.key ?? entityKey) === entityKey,
    });
    if (!Array.isArray(features)) {
      ignored.set(domain, (ignored.get(domain) ?? 0) + 1);
      continue;
    }

    const ids =
      haDevice && !haDevice.disabled_by
        ? externalIds('device', haDevice.id)
        : externalIds('entity', entityKey);
    let entry = devices.get(ids.device);
    if (!entry) {
      const base = haDevice
        ? haDevice.name_by_user || haDevice.name || s.attributes?.friendly_name || entityId
        : s.attributes?.friendly_name || entityId;
      const name =
        area && !base.toLowerCase().includes(area.name.toLowerCase())
          ? `${base} (${area.name})`
          : base;
      entry = {
        names: new Set(),
        device: {
          name: cut(name),
          external_id: ids.device,
          should_poll: false,
          features: [],
          params: [
            haDevice
              ? { name: 'ha_device_id', value: haDevice.id }
              : { name: 'ha_entity_id', value: entityId },
            ...(area ? [{ name: 'ha_area', value: area.name }] : []),
            ...(haDevice?.manufacturer
              ? [{ name: 'manufacturer', value: haDevice.manufacturer }]
              : []),
            ...(haDevice?.model ? [{ name: 'model', value: haDevice.model }] : []),
          ],
        },
      };
      devices.set(ids.device, entry);
    }
    entityCount += 1;
    entityDevice.set(entityId, ids.device);
    const friendly = String(s.attributes?.friendly_name || entityId).trim();
    for (const f of features) {
      const featureId = ids.feature(`${entityKey}-${f.role}`);
      if (f.present === false && !existing.has(featureId)) {
        continue;
      }
      let name = f.main ? friendly : `${friendly} – ${roles[f.role] ?? f.role}`;
      if (entry.names.has(name)) {
        name = `${name} (${entityId})`;
      }
      entry.names.add(name);
      entry.device.features.push({ name: cut(name), external_id: featureId, ...f.spec });
      featureEntity.set(featureId, entityId);
      if (f.music) {
        const player = players.get(entityId) ?? {
          deviceId: ids.device,
          // One publishNowPlaying snapshot per player: a device can hold several.
          snapshotId: `${ids.device}:${entityKey}`,
          features: {},
        };
        player.features[f.music] = featureId;
        players.set(entityId, player);
      }
      if (f.read) {
        const list = routes.get(entityId) ?? [];
        list.push({ featureId, read: f.read, throttle: Boolean(f.throttle) });
        routes.set(entityId, list);
      }
      if (f.write) {
        writers.set(featureId, { entityId, domain, write: f.write });
      }
    }
  }

  return {
    devices: [...devices.values()].map((e) => e.device),
    routes,
    writers,
    featureEntity,
    entityDevice,
    players,
    entityCount,
    ignored: [...ignored.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}
