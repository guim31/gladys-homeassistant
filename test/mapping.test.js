// -----------------------------------------------------------------------------
// One entity -> features, domain by domain, on the states of a real Home
// Assistant 2026.10.1 (demo integration). The value conventions are frozen
// here: a door OPEN in Home Assistant is 0 in Gladys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COVER_STATE,
  OPENING_SENSOR_STATE,
  THERMOSTAT_MODE,
  WriteError,
  colorToInt,
  intToColor,
  mapEntity,
} from '../src/mapping.js';
import { fixture } from './helpers/fakeHa.js';

const states = fixture().states;
const state = (id) => structuredClone(states.find((s) => s.entity_id === id));
const role = (features, name) => features.find((f) => f.role === name);
const read = (features, name, s) => role(features, name).read(s);

test('light: on/off, brightness in %, colour and colour temperature in mireds', () => {
  const s = state('light.kitchen_lights');
  const f = mapEntity(s);
  assert.deepEqual(
    f.map((x) => x.role),
    ['state', 'brightness', 'color', 'color_temp'],
  );
  assert.equal(read(f, 'state', s), 1);
  assert.equal(read(f, 'brightness', s), 71); // 180 / 255
  assert.equal(read(f, 'color', s), colorToInt([255, 64, 112]));
  assert.equal(read(f, 'color_temp', s), null, 'hs mode: no colour temperature');
  const ct = role(f, 'color_temp').spec;
  assert.deepEqual([ct.min, ct.max], [153, 500]); // 6535 K .. 2000 K

  const ceiling = state('light.ceiling_lights');
  const fc = mapEntity(ceiling);
  assert.equal(read(fc, 'color_temp', ceiling), 380); // 2631 K
  assert.equal(read(fc, 'color', ceiling), null, 'temperature mode: the rgb is computed');

  assert.deepEqual(role(f, 'brightness').write(50), {
    service: 'turn_on',
    data: { brightness_pct: 50 },
  });
  assert.deepEqual(role(f, 'brightness').write(0), { service: 'turn_off' });
  assert.deepEqual(role(f, 'color').write(0xff0000), {
    service: 'turn_on',
    data: { rgb_color: [255, 0, 0] },
  });
  assert.deepEqual(role(f, 'color_temp').write(250), {
    service: 'turn_on',
    data: { color_temp_kelvin: 4000 },
  });
  assert.deepEqual(role(f, 'state').write(0), { service: 'turn_off' });
  assert.deepEqual(intToColor(colorToInt([1, 2, 3])), [1, 2, 3]);

  const off = state('light.bed_light');
  const fo = mapEntity(off);
  assert.equal(read(fo, 'state', off), 0);
  assert.equal(read(fo, 'brightness', off), 0);
  assert.equal(read(fo, 'color', off), null);
});

test('light: an rgbw light has no colour temperature, an unavailable one publishes nothing', () => {
  const s = state('light.office_rgbw_lights');
  const f = mapEntity(s);
  assert.deepEqual(
    f.map((x) => x.role),
    ['state', 'brightness', 'color'],
  );
  const down = { ...s, state: 'unavailable', attributes: { supported_color_modes: ['rgbw'] } };
  assert.equal(read(f, 'state', down), null);
  assert.equal(read(f, 'brightness', down), null);
});

test('binary sensors: a door open in Home Assistant is 0 (OPEN) in Gladys', () => {
  const s = state('binary_sensor.front_door_contact');
  const [f] = mapEntity(s);
  assert.equal(f.spec.category, 'opening-sensor');
  assert.equal(f.spec.read_only, true);
  assert.equal(f.read({ ...s, state: 'on' }), OPENING_SENSOR_STATE.OPEN);
  assert.equal(f.read({ ...s, state: 'off' }), OPENING_SENSOR_STATE.CLOSE);
  assert.equal(f.read({ ...s, state: 'unavailable' }), null);

  const [motion] = mapEntity(state('binary_sensor.movement_backyard'));
  assert.equal(motion.spec.category, 'motion-sensor');
  assert.equal(motion.read({ state: 'on' }), 1);
  const [leak] = mapEntity(state('binary_sensor.basement_floor_wet'));
  assert.equal(leak.spec.category, 'leak-sensor');
  assert.equal(leak.read({ state: 'on' }), 1);
  const [generic] = mapEntity({ entity_id: 'binary_sensor.x', state: 'on', attributes: {} });
  assert.deepEqual([generic.spec.category, generic.spec.type], ['input', 'binary']);
});

test('sensors: by device class and unit; the others are skipped with a reason', () => {
  const t = state('sensor.outside_temperature');
  const [temp] = mapEntity(t);
  assert.deepEqual(
    [temp.spec.category, temp.spec.type, temp.spec.unit],
    ['temperature-sensor', 'decimal', 'celsius'],
  );
  assert.equal(temp.read(t), 15.6);
  assert.equal(temp.throttle, true);
  assert.equal(temp.read({ ...t, state: 'unknown' }), null);

  const [battery] = mapEntity(state('sensor.outside_temperature_battery'));
  assert.deepEqual([battery.spec.category, battery.spec.type], ['battery', 'integer']);
  assert.equal(battery.read({ state: '12.6' }), 13);

  const [energy] = mapEntity(state('sensor.total_energy_kwh'));
  assert.deepEqual(
    [energy.spec.category, energy.spec.type, energy.spec.unit],
    ['energy-sensor', 'index', 'kilowatt-hour'],
  );
  const [mwh] = mapEntity(state('sensor.total_energy_mwh'));
  assert.equal(mwh.spec.unit, 'megawatt-hour');
  const [power] = mapEntity(state('sensor.power_consumption'));
  assert.deepEqual([power.spec.type, power.spec.unit], ['power', 'watt']);
  assert.ok(power.spec.min < 0, 'a production is negative');
  const [gas] = mapEntity(state('sensor.total_gas_m3'));
  assert.deepEqual([gas.spec.category, gas.spec.unit], ['volume-sensor', 'cubicmeter']);

  assert.deepEqual(mapEntity(state('sensor.carbon_monoxide')), {
    skipped: 'sensor:carbon_monoxide',
  });
  assert.deepEqual(mapEntity(state('sensor.thermostat')), { skipped: 'sensor:enum' });
  assert.deepEqual(
    mapEntity({
      entity_id: 'sensor.t',
      state: '70',
      attributes: { device_class: 'temperature', unit_of_measurement: 'parsecs' },
    }),
    { skipped: 'sensor:temperature:parsecs' },
  );
});

test('cover: open/close/stop and position; 100 is open in both', () => {
  const s = state('cover.living_room_window');
  const f = mapEntity(s);
  assert.deepEqual(
    f.map((x) => x.role),
    ['command', 'position'],
  );
  assert.equal(read(f, 'command', s), COVER_STATE.OPEN);
  assert.equal(read(f, 'position', s), 70);
  assert.deepEqual(role(f, 'command').write(COVER_STATE.CLOSE, s), { service: 'close_cover' });
  assert.deepEqual(role(f, 'command').write(COVER_STATE.STOP, s), { service: 'stop_cover' });
  assert.deepEqual(role(f, 'position').write(30), {
    service: 'set_cover_position',
    data: { position: 30 },
  });
  // The kitchen window has no position; the garage door cannot stop.
  const k = state('cover.kitchen_window');
  const fk = mapEntity(k);
  assert.deepEqual(
    fk.map((x) => x.role),
    ['command'],
  );
  assert.equal(read(fk, 'command', k), COVER_STATE.CLOSE);
  const g = state('cover.garage_door');
  const fg = mapEntity(g, { allowSecurity: true });
  assert.throws(() => role(fg, 'command').write(COVER_STATE.STOP, g), WriteError);
  // A tilt-only pergola has nothing Gladys can show.
  assert.deepEqual(mapEntity(state('cover.pergola_roof')), { skipped: 'cover:nothing' });
});

test('garage door: read-only open/closed unless the security commands are allowed', () => {
  const s = state('cover.garage_door');
  const locked = mapEntity(s);
  assert.deepEqual(
    locked.map((x) => x.role),
    ['contact'],
  );
  assert.equal(locked[0].spec.read_only, true);
  assert.equal(locked[0].read(s), OPENING_SENSOR_STATE.CLOSE);
  assert.equal(locked[0].read({ ...s, state: 'opening' }), OPENING_SENSOR_STATE.OPEN);
  const allowed = mapEntity(s, { allowSecurity: true });
  assert.deepEqual(
    allowed.map((x) => x.role),
    ['command', 'contact'],
  );
  assert.deepEqual(role(allowed, 'command').write(COVER_STATE.OPEN, s), { service: 'open_cover' });
});

test('lock: read-only by default, lockable only when allowed', () => {
  const s = state('lock.front_door');
  const [f] = mapEntity(s);
  assert.deepEqual([f.spec.category, f.spec.type, f.spec.read_only], ['lock', 'binary', true]);
  assert.equal(f.write, undefined);
  assert.equal(f.read(s), 1);
  assert.equal(f.read({ state: 'unlocked' }), 0);
  assert.equal(f.read({ state: 'jammed' }), null);
  const [allowed] = mapEntity(s, { allowSecurity: true });
  assert.equal(allowed.spec.read_only, false);
  assert.deepEqual(allowed.write(0), { service: 'unlock' });
});

test('climate: setpoint bounded by Home Assistant (refused, never clamped), hvac modes', () => {
  const s = state('climate.hvac');
  const f = mapEntity(s);
  assert.deepEqual(
    f.map((x) => x.role),
    ['target', 'mode', 'current'],
  );
  const target = role(f, 'target');
  assert.deepEqual([target.spec.min, target.spec.max, target.spec.unit], [7, 35, 'celsius']);
  assert.equal(target.read(s), 21);
  assert.deepEqual(target.write(19.5, s), {
    service: 'set_temperature',
    data: { temperature: 19.5 },
  });
  assert.throws(() => target.write(60, s), { key: 'out_of_range' });
  assert.throws(() => target.write(2, s), { key: 'out_of_range' });
  assert.equal(read(f, 'mode', s), THERMOSTAT_MODE.COOLING);
  assert.equal(read(f, 'mode', { ...s, state: 'dry' }), null);
  assert.deepEqual(role(f, 'mode').write(THERMOSTAT_MODE.AUTO, s), {
    service: 'set_hvac_mode',
    data: { hvac_mode: 'auto' },
  });
  assert.equal(read(f, 'current', s), 22);

  // Heat pump: heat and off only.
  const hp = state('climate.heatpump');
  const fh = mapEntity(hp);
  assert.throws(() => role(fh, 'mode').write(THERMOSTAT_MODE.COOLING, hp), {
    key: 'unsupported_value',
  });
  // A range thermostat (heat_cool) has no single setpoint: mode and temperature only.
  const eco = state('climate.ecobee');
  const fe = mapEntity(eco);
  assert.deepEqual(
    fe.map((x) => x.role),
    ['mode', 'current'],
  );
  assert.equal(read(fe, 'mode', eco), THERMOSTAT_MODE.AUTO);
  // Fahrenheit installs.
  const [ft] = mapEntity(hp, { temperatureUnit: '°F' });
  assert.equal(ft.spec.unit, 'fahrenheit');
});

test('media player: music features, commands without feedback, volume in %', () => {
  const s = state('media_player.walkman');
  const f = mapEntity(s).filter((x) => x.present !== false);
  assert.deepEqual(
    f.map((x) => x.role),
    [
      'power',
      'playback',
      'title',
      'artist',
      'album',
      'artwork',
      'duration',
      'position',
      'shuffle',
      'repeat',
      'mute',
      'play',
      'pause',
      'next',
      'previous',
      'volume',
    ],
  );
  // Everything music goes through publishNowPlaying: no reader for the state publisher.
  for (const x of f.filter((x) => x.spec.category === 'music')) {
    assert.equal(x.read, undefined, x.role);
    assert.equal(x.spec.keep_history, false, x.role);
  }
  assert.equal(role(f, 'playback').music, 'playback_state');
  assert.equal(role(f, 'artwork').music, 'artwork_url');
  assert.equal(role(f, 'play').spec.has_feedback, false);
  assert.deepEqual(role(f, 'next').write(1), { service: 'media_next_track' });
  assert.deepEqual(role(f, 'volume').write(35), {
    service: 'volume_set',
    data: { volume_level: 0.35 },
  });
  // A player without shuffle, repeat or mute: those are marked absent (kept only on a
  // device already added, see the inventory).
  const browse = mapEntity(state('media_player.browse'));
  assert.deepEqual(
    browse.filter((x) => x.present !== false).map((x) => x.role),
    ['playback', 'title', 'artist', 'album', 'artwork', 'duration', 'position'],
  );
  // The playback states offered follow the STOP bit, labelled in the language.
  assert.deepEqual(role(f, 'playback').spec.supported_options, [
    { value: 0, label: 'En pause', sort_order: 0 },
    { value: 1, label: 'En lecture', sort_order: 1 },
    { value: 2, label: 'Arrêté', sort_order: 2 },
  ]);
  assert.deepEqual(
    role(browse, 'playback').spec.supported_options.map((o) => o.value),
    [0, 1],
  );
  assert.equal(role(f, 'playback').main, true, 'the device name, as in 1.0');
  // Another player of the same Home Assistant device keeps its 1.0 features.
  const legacy = mapEntity(s, { primary: false }).filter((x) => x.present !== false);
  assert.deepEqual(
    legacy.map((x) => [x.role, x.spec.max, x.spec.read_only, typeof x.read]),
    [
      ['power', 1, false, 'function'],
      ['playback', 1, true, 'function'],
      ['play', 1, false, 'undefined'],
      ['pause', 1, false, 'undefined'],
      ['next', 1, false, 'undefined'],
      ['previous', 1, false, 'undefined'],
      ['volume', 100, false, 'function'],
    ],
  );
  assert.equal(role(legacy, 'playback').read({ ...s, state: 'idle' }), 0);
});

test('fan: on/off and speed in %', () => {
  const s = state('fan.living_room_fan');
  const f = mapEntity(s);
  assert.deepEqual(
    f.map((x) => x.role),
    ['state', 'speed'],
  );
  assert.equal(read(f, 'speed', s), 0);
  assert.equal(read(f, 'speed', { ...s, state: 'on', attributes: { percentage: 66.6 } }), 67);
  assert.deepEqual(role(f, 'speed').write(33), {
    service: 'set_percentage',
    data: { percentage: 33 },
  });
  assert.deepEqual(role(f, 'speed').write(0), { service: 'turn_off' });
  assert.deepEqual(
    mapEntity(state('fan.preset_only_limited_fan')).map((x) => x.role),
    ['state'],
  );
});

test('switch and input_boolean: one on/off; unknown domains are skipped', () => {
  for (const id of ['switch.ac', 'input_boolean.guest_mode']) {
    const [f] = mapEntity(state(id));
    assert.deepEqual([f.spec.category, f.spec.type, f.spec.read_only], ['switch', 'binary', false]);
    assert.deepEqual(f.write(1), { service: 'turn_on' });
  }
  assert.deepEqual(mapEntity(state('vacuum.demo_vacuum_0_ground_floor')), { skipped: 'vacuum' });
});
