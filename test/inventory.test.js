// -----------------------------------------------------------------------------
// States and registries -> Gladys devices: grouping by Home Assistant device,
// stable external ids, selection by domain, area and entity patterns.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { buildInventory } from '../src/inventory.js';
import { fixture } from './helpers/fakeHa.js';

const gladys = createFakeGladys();
const externalIds = gladys.externalIds.bind(gladys);

function inventory(config = {}, data = fixture()) {
  return buildInventory(data, { ...normalizeConfig(config), externalIds });
}

const byName = (inv, name) => inv.devices.find((d) => d.name === name);

test('one Gladys device per Home Assistant device, keyed on registry ids', () => {
  const data = fixture();
  const inv = inventory({}, data);
  const reg = (id) => data.entities.find((e) => e.entity_id === id);

  // The outside thermometer and its battery level (a diagnostic entity) share a device.
  const outside = byName(inv, 'Outside Temperature (Living Room)');
  const temp = reg('sensor.outside_temperature');
  assert.equal(outside.external_id, `ext:test-integration:device:${temp.device_id}`);
  assert.deepEqual(
    outside.features.map((f) => f.external_id),
    [
      `${outside.external_id}:${temp.id}-value`,
      `${outside.external_id}:${reg('sensor.outside_temperature_battery').id}-value`,
    ],
  );
  assert.deepEqual(outside.params, [
    { name: 'ha_device_id', value: temp.device_id },
    { name: 'ha_area', value: 'Living Room' },
  ]);
  assert.equal(outside.should_poll, false);
  assert.equal(outside.poll_frequency, undefined);

  // An entity without device: a device of its own, keyed on its registry id.
  const fan = byName(inv, 'Living Room Fan');
  const fanId = reg('fan.living_room_fan').id;
  assert.equal(fan.external_id, `ext:test-integration:entity:${fanId}`);
  assert.equal(fan.features[0].external_id, `${fan.external_id}:${fanId}-state`);

  // An entity without registry entry (no unique_id): its entity_id, which cannot change.
  const lock = byName(inv, 'Front Door');
  assert.equal(lock.external_id, 'ext:test-integration:entity:lock.front_door');
  assert.equal(lock.features[0].external_id, `${lock.external_id}:lock.front_door-state`);
  assert.deepEqual(lock.params, [{ name: 'ha_entity_id', value: 'lock.front_door' }]);
});

test('a renamed entity_id keeps its external ids', () => {
  const data = fixture();
  const before = inventory({}, data);
  const renamed = fixture();
  renamed.entities.find((e) => e.entity_id === 'light.kitchen_lights').entity_id = 'light.cuisine';
  renamed.states.find((s) => s.entity_id === 'light.kitchen_lights').entity_id = 'light.cuisine';
  const after = inventory({}, renamed);
  const ids = (inv) => inv.devices.flatMap((d) => d.features.map((f) => f.external_id)).sort();
  assert.deepEqual(ids(after), ids(before));
  assert.ok(after.routes.has('light.cuisine'));
});

test('feature names: the entity for its main feature, a translated suffix for the others', () => {
  const fr = byName(inventory(), 'Kitchen Lights');
  assert.deepEqual(
    fr.features.map((f) => f.name),
    [
      'Kitchen Lights',
      'Kitchen Lights – Luminosité',
      'Kitchen Lights – Couleur',
      'Kitchen Lights – Température de couleur',
    ],
  );
  const de = byName(inventory({ language: 'de' }), 'Kitchen Lights');
  assert.equal(de.features[1].name, 'Kitchen Lights – Helligkeit');
});

test('hidden, configuration and diagnostic entities are left out, battery levels kept', () => {
  const inv = inventory();
  assert.ok(!inv.entityDevice.has('binary_sensor.outside_temperature_battery_charging'));
  assert.ok(inv.entityDevice.has('sensor.outside_temperature_battery'));
  assert.ok(!inv.entityDevice.has('sensor.sun_next_dawn'));
  // Included by name, a diagnostic entity comes back.
  const included = inventory({
    include_entities: 'binary_sensor.outside_temperature_battery_charging',
  });
  assert.ok(included.entityDevice.has('binary_sensor.outside_temperature_battery_charging'));
});

test('selection: domains, areas, entity patterns to include or exclude', () => {
  const lights = inventory({ domains: ['light'] });
  assert.ok(lights.devices.length === 6);
  assert.ok([...lights.entityDevice.keys()].every((id) => id.startsWith('light.')));

  const kitchen = inventory({ areas: 'kitchen' });
  assert.deepEqual([...kitchen.entityDevice.keys()].sort(), [
    'cover.kitchen_window',
    'light.kitchen_lights',
  ]);
  const two = inventory({ areas: 'Kitchen, Bedroom' });
  assert.deepEqual([...two.entityDevice.keys()].sort(), [
    'cover.kitchen_window',
    'light.bed_light',
    'light.kitchen_lights',
    'switch.ac',
  ]);

  const withPattern = inventory({ areas: 'Kitchen', include_entities: 'sensor.total_*' });
  assert.ok(withPattern.entityDevice.has('sensor.total_gas_m3'));
  assert.ok(withPattern.entityDevice.has('sensor.total_energy_kwh'));

  const without = inventory({ exclude_entities: 'media_player.*, light.bed_light' });
  assert.ok(![...without.entityDevice.keys()].some((id) => id.startsWith('media_player.')));
  assert.ok(!without.entityDevice.has('light.bed_light'));
  assert.ok(without.entityDevice.has('light.kitchen_lights'));
});

test('the entities not imported are counted by domain, without the system ones', () => {
  const inv = inventory();
  const ignored = Object.fromEntries(inv.ignored);
  assert.equal(ignored.vacuum, 5);
  assert.equal(ignored.cover, 1, 'the tilt-only pergola');
  for (const silent of ['sun', 'zone', 'script', 'scene', 'button', 'update']) {
    assert.equal(ignored[silent], undefined, silent);
  }
});

test('without the registries (token of a non-admin user): one device per entity', () => {
  const data = fixture();
  data.entities = [];
  data.devices = [];
  data.areas = [];
  const inv = inventory({}, data);
  const light = inv.devices.find((d) => d.name === 'Kitchen Lights');
  assert.equal(light.external_id, 'ext:test-integration:entity:light.kitchen_lights');
  // Without the registry, the diagnostic entities cannot be told apart.
  assert.ok(inv.entityDevice.has('sensor.outside_temperature_battery'));
});
