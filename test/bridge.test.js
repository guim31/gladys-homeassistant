// -----------------------------------------------------------------------------
// The integration end to end: the SDK's fake Gladys, the handlers of
// src/app.js, the fake Home Assistant serving a real 2026.10.1 inventory.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createHa } from './helpers/fakeHa.js';
import { captureLogs } from './helpers/logs.js';
import {
  addDevice,
  baseConfig,
  createWorld,
  deviceOf,
  featureId,
  flushed,
  settle,
  until,
} from './helpers/world.js';
import { createLogger } from '@gladysassistant/integration-sdk';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('connects, reads the inventory and offers the devices in Discovery', async (t) => {
  const w = await world(t);
  assert.equal(w.bridge.status, 'online');
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.ok(w.fake.discoveredDevices.length >= 40);
  assert.deepEqual(
    w.ha.calls.slice(0, 5).map((c) => c.type),
    [
      'get_config',
      'get_states',
      'config/entity_registry/list',
      'config/device_registry/list',
      'config/area_registry/list',
    ],
  );
  assert.ok(w.ha.callsOf('subscribe_events').some((c) => c.event_type === 'state_changed'));
  // Nothing added in Gladys yet: no state spent on the 300 per minute.
  await flushed(w);
  assert.equal(w.fake.states.length, 0);
});

test('states: sent once the device is added, then live and only the changes', async (t) => {
  const w = await world(t);
  const light = deviceOf(w, 'light.kitchen_lights');
  await addDevice(w, light);
  await flushed(w);
  const brightness = featureId(w, 'light.kitchen_lights', 'brightness');
  assert.equal(w.fake.lastState(featureId(w, 'light.kitchen_lights', 'state')), 1);
  assert.equal(w.fake.lastState(brightness), 71);
  assert.equal(w.fake.lastState(featureId(w, 'light.kitchen_lights', 'color')), 0xff4070);
  const count = w.fake.states.length;

  w.ha.setState('light.kitchen_lights', 'on', { brightness: 255 });
  await until(() => w.fake.lastState(brightness) === 100, { what: 'the new brightness' });
  assert.equal(w.fake.states.length, count + 1, 'only the brightness changed');

  // Another entity, not added: nothing sent.
  w.ha.setState('light.bed_light', 'on', { brightness: 10, color_mode: 'hs' });
  await flushed(w);
  assert.equal(w.fake.states.length, count + 1);
});

test('a door opened in Home Assistant is published OPEN (0) in Gladys', async (t) => {
  const w = await world(t);
  await addDevice(w, deviceOf(w, 'binary_sensor.front_door_contact'));
  const contact = featureId(w, 'binary_sensor.front_door_contact', 'value');
  await until(() => w.fake.lastState(contact) === 1, { what: 'closed' });
  w.ha.setState('binary_sensor.front_door_contact', 'on');
  await until(() => w.fake.lastState(contact) === 0, { what: 'open' });
});

test('commands: Gladys -> call_service, the state_changed echo is the feedback', async (t) => {
  const w = await world(t);
  const light = await addDevice(w, deviceOf(w, 'light.kitchen_lights'));
  const brightness = light.features.find((f) => f.external_id.endsWith('-brightness'));
  const ack = await w.fake.setValue(light, brightness, 40);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.ha.services().at(-1), {
    service: 'light.turn_on',
    data: { brightness_pct: 40 },
    target: 'light.kitchen_lights',
  });
  await until(() => w.fake.lastState(brightness.external_id) === 40, { what: 'the echo' });

  const thermostat = await addDevice(w, deviceOf(w, 'climate.heatpump'));
  const target = thermostat.features.find((f) => f.type === 'target-temperature');
  assert.equal((await w.fake.setValue(thermostat, target, 19)).success, true);
  assert.deepEqual(w.ha.services().at(-1), {
    service: 'climate.set_temperature',
    data: { temperature: 19 },
    target: 'climate.heatpump',
  });
  const refused = await w.fake.setValue(thermostat, target, 80);
  assert.equal(refused.success, false);
  assert.match(refused.error, /hors des limites/);
  assert.equal(w.ha.services().length, 2, 'nothing sent for a refused value');
});

test('locks and garage doors: no command without the explicit permission', async (t) => {
  const w = await world(t);
  const lock = await addDevice(w, deviceOf(w, 'lock.front_door'));
  const [feature] = lock.features;
  assert.equal(feature.read_only, true);
  // Even a device created before the permission was removed cannot be opened.
  const ack = await w.fake.setValue(lock, { ...feature, read_only: false }, 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /désactivées/);
  assert.equal(w.ha.services().length, 0);

  const scene = await w.fake.sceneAction('call_service', {
    service: 'lock.unlock',
    entity_id: 'lock.front_door',
  });
  assert.equal(scene.success, false);
  const garage = await w.fake.sceneAction('call_service', {
    service: 'cover.open_cover',
    entity_id: 'cover.garage_door',
  });
  assert.equal(garage.success, false);
  assert.equal(w.ha.services().length, 0);
  // Closing is never dangerous.
  const close = await w.fake.sceneAction('call_service', {
    service: 'cover.close_cover',
    entity_id: 'cover.garage_door',
  });
  assert.equal(close.success, true, close.error);
});

test('locks: controllable once allowed in the configuration', async (t) => {
  const w = await world(t, { config: baseConfig({ allow_security_commands: true }) });
  const lock = await addDevice(w, deviceOf(w, 'lock.kitchen_door'));
  const [feature] = lock.features;
  assert.equal(feature.read_only, false);
  assert.equal((await w.fake.setValue(lock, feature, 1)).success, true);
  assert.deepEqual(w.ha.services().at(-1), {
    service: 'lock.lock',
    data: {},
    target: 'lock.kitchen_door',
  });
  await until(() => w.fake.lastState(feature.external_id) === 1, { what: 'locked' });
});

test('Home Assistant restarted: unreachable badges, reconnection, states again', async (t) => {
  const w = await world(t);
  const sw = await addDevice(w, deviceOf(w, 'switch.ac'));
  const id = sw.features[0].external_id;
  await until(() => w.fake.lastState(id) === 0, { what: 'the switch' });
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: sw.external_id,
    transport: 'local',
  });

  w.ha.down = true;
  w.ha.drop();
  await until(() => w.fake.transports.at(-1)?.transport === 'unreachable', {
    what: 'the unreachable badge',
  });
  assert.equal(w.bridge.status, 'unreachable');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: sw.external_id,
    transport: 'unreachable',
  });
  const failed = await w.fake.setValue(sw, sw.features[0], 1);
  assert.match(failed.error, /pas connecté/);

  // Changed while down: read again at the reconnection.
  w.ha.data.states.find((s) => s.entity_id === 'switch.ac').state = 'on';
  w.ha.down = false;
  await until(() => w.bridge.status === 'online', { what: 'the reconnection' });
  await until(() => w.fake.lastState(id) === 1, { what: 'the state changed meanwhile' });
  await until(() => w.fake.transports.at(-1)?.transport === 'local', { what: 'the local badge' });
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('an unavailable entity makes its device unreachable', async (t) => {
  const w = await world(t);
  const sw = await addDevice(w, deviceOf(w, 'switch.decorative_lights'));
  w.ha.setState('switch.decorative_lights', 'unavailable');
  await until(() => w.fake.transports.at(-1)?.transport === 'unreachable', {
    what: 'the unreachable badge',
  });
  assert.equal(w.fake.transports.at(-1).device_external_id, sw.external_id);
  w.ha.setState('switch.decorative_lights', 'on');
  await until(() => w.fake.transports.at(-1)?.transport === 'local', { what: 'back' });
});

test('a refused token: status, one log line, retried later', async (t) => {
  const ha = createHa();
  ha.token = 'another';
  const logs = captureLogs(t, 'info');
  const w = await world(t, {
    ha,
    waitOnline: false,
    logger: createLogger({ name: 'homeassistant' }),
  });
  await until(() => w.bridge.status === 'auth_failed', { what: 'auth_failed' });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /refuse le jeton/);
  await until(() => ha.connects >= 2, { what: 'a second attempt' });
  const lines = logs.stop().filter((l) => l.includes('refused the access token'));
  assert.equal(lines.length, 1);
  assert.ok(!logs.lines.some((l) => l.includes('test-token') || l.includes('another')));
  const test = await w.fake.action('test_connection', {});
  assert.equal(test.success, false);
});

test('not configured: a status message, no connection attempt', async (t) => {
  const ha = createHa();
  const w = await world(t, { ha, config: { url: '' }, waitOnline: false });
  await settle();
  assert.equal(w.bridge.status, 'not_configured');
  assert.equal(ha.connects, 0);
  assert.match(w.fake.connectionStatus.message.en, /address of Home Assistant/);
  await w.fake.configUpdated({ url: 'ftp://nope', token: 'x' });
  assert.equal(w.bridge.status, 'invalid_url');
  await w.fake.configUpdated(baseConfig());
  await until(() => w.bridge.status === 'online', { what: 'online' });
});

test('a new entity in Home Assistant shows up in Discovery', async (t) => {
  const w = await world(t);
  const before = w.fake.discoveredDevices.length;
  w.ha.setState('input_boolean.holidays', 'off', { friendly_name: 'Holidays' });
  await until(() => w.fake.discoveredDevices.length === before + 1, { what: 'the new device' });
  w.ha.removeEntity('input_boolean.holidays');
  await until(() => w.fake.discoveredDevices.length === before, { what: 'the removal' });
});

test('events: the listed event types and watched entities start scenes', async (t) => {
  const w = await world(t, {
    config: baseConfig({
      forward_events: 'zha_event, tag_scanned',
      watched_entities: 'vacuum.*, input_boolean.guest_mode',
    }),
  });
  const types = w.ha.callsOf('subscribe_events').map((c) => c.event_type);
  assert.ok(types.includes('zha_event') && types.includes('tag_scanned'));

  w.ha.fire('zha_event', { device_ieee: '00:11', command: 'on', args: [] });
  await until(() => w.fake.sceneEvents.length === 1, { what: 'the event' });
  assert.deepEqual(w.fake.sceneEvents[0], {
    key: 'ha_event',
    data: {
      event_type: 'zha_event',
      entity_id: null,
      data: '{"device_ieee":"00:11","command":"on","args":[]}',
    },
  });

  w.ha.setState('vacuum.demo_vacuum_0_ground_floor', 'cleaning');
  await until(() => w.fake.sceneEvents.length === 2, { what: 'the entity change' });
  assert.equal(w.fake.sceneEvents[1].key, 'entity_state_changed');
  assert.equal(w.fake.sceneEvents[1].data.entity_id, 'vacuum.demo_vacuum_0_ground_floor');
  assert.equal(w.fake.sceneEvents[1].data.state, 'cleaning');
  // An attribute-only change is not a new state.
  w.ha.setState('vacuum.demo_vacuum_0_ground_floor', 'cleaning', { battery_level: 50 });
  await settle();
  assert.equal(w.fake.sceneEvents.length, 2);
  // Watched by name, an entity also offered as a device fires too.
  w.ha.setState('input_boolean.guest_mode', 'on');
  await until(() => w.fake.sceneEvents.length === 3, { what: 'the watched helper' });
  assert.equal(w.fake.sceneEvents[2].data.entity_id, 'input_boolean.guest_mode');
});

test('scene actions: service with data, script, scene, button', async (t) => {
  const w = await world(t);
  let ack = await w.fake.sceneAction('call_service', {
    service: 'light.turn_on',
    entity_id: 'light.kitchen_lights, light.bed_light',
    data: '{"brightness_pct": 30}',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.ha.services().at(-1), {
    service: 'light.turn_on',
    data: { brightness_pct: 30 },
    target: ['light.kitchen_lights', 'light.bed_light'],
  });
  ack = await w.fake.sceneAction('run_script', { script: 'good_night', variables: '{"x": 1}' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.ha.services().at(-1), {
    service: 'script.turn_on',
    data: { variables: { x: 1 } },
    target: 'script.good_night',
  });
  ack = await w.fake.sceneAction('activate_scene', { scene: 'scene.movie_time' });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.ha.services().at(-1).service, 'scene.turn_on');
  ack = await w.fake.sceneAction('press_button', { button: 'button.push' });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.ha.services().at(-1).service, 'button.press');

  const bad = await w.fake.sceneAction('call_service', { service: 'turn on the light' });
  assert.match(bad.error, /domaine\.service/);
  const json = await w.fake.sceneAction('call_service', { service: 'light.turn_on', data: '{' });
  assert.match(json.error, /objet JSON/);
  const wrong = await w.fake.sceneAction('run_script', { script: 'scene.movie_time' });
  assert.match(wrong.error, /domaine\.nom/);
  const missing = await w.fake.sceneAction('call_service', {
    service: 'light.turn_on',
    entity_id: 'light.nowhere',
  });
  assert.match(missing.error, /refusé la commande/);
});

test('widget: connection, version and counts, in the requested language', async (t) => {
  const w = await world(t);
  await addDevice(w, deviceOf(w, 'light.kitchen_lights'));
  const ack = await w.fake.widgetGet('status', { settings: {}, language: 'de' });
  assert.equal(ack.success, true, ack.error);
  const content = ack.data.content ?? ack.data;
  assert.deepEqual(validateWidgetContent(content), []);
  const values = content.components.filter((c) => c.type === 'value').map((c) => c.value);
  assert.deepEqual(values, [w.fake.discoveredDevices.length, 1, 1]);
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((i) => i.value),
    ['Verbunden', '2026.10.1'],
  );
  const reload = await w.fake.widgetAction('status', 'reload', {}, { settings: {} });
  assert.equal(reload.success, true, reload.error);
  assert.ok(w.fake.widgetRefreshes.length > 0, 'refresh requested at the device creation');
});

test('connection test: version, counts and the entities not imported', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  const message = ack.data.message ?? ack.data;
  assert.match(message.fr, /Home Assistant 2026\.10\.1/);
  assert.match(message.en, /vacuum \(5\)/);
});

test('a non-admin token: one device per entity, said in the connection test', async (t) => {
  const w = await world(t, { ha: createHa({ admin: false }) });
  assert.equal(w.bridge.limited, true);
  const ack = await w.fake.action('test_connection', {});
  assert.match((ack.data.message ?? ack.data).en, /not an administrator/);
});

test('sensors are spaced by the configured interval, switches are not', async (t) => {
  const w = await world(t, { config: baseConfig({ sensor_interval: 3600 }) });
  await addDevice(w, deviceOf(w, 'sensor.power_consumption'));
  await addDevice(w, deviceOf(w, 'switch.decorative_lights'));
  const power = featureId(w, 'sensor.power_consumption', 'value');
  const sw = featureId(w, 'switch.decorative_lights', 'state');
  await until(() => w.fake.lastState(power) === 100, { what: 'the power' });
  w.ha.setState('sensor.power_consumption', '250');
  w.ha.setState('switch.decorative_lights', 'off');
  await until(() => w.fake.lastState(sw) === 0, { what: 'the switch' });
  await flushed(w);
  assert.equal(w.fake.lastState(power), 100, 'the new power waits for the interval');
});

test('a normal cycle writes nothing at the info level', async (t) => {
  const w = await world(t);
  await addDevice(w, deviceOf(w, 'light.kitchen_lights'));
  const logs = captureLogs(t, 'info');
  w.bridge.logger = createLogger({ name: 'homeassistant' });
  w.bridge.publisher.logger = w.bridge.logger;
  for (let i = 0; i < 5; i += 1) {
    w.ha.setState('light.kitchen_lights', 'on', { brightness: 100 + i });
  }
  await flushed(w);
  await w.fake.scanRequest();
  await flushed(w);
  assert.deepEqual(logs.stop(), []);
});
