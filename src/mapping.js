// -----------------------------------------------------------------------------
// One Home Assistant entity -> Gladys features (pure).
//
// An entity is its state object (`entity_id`, `state`, `attributes`, from
// get_states or a state_changed event). `mapEntity` returns its features, each
//   role      part of the feature external id: never change it,
//   spec      category, type, unit, min, max, read_only, has_feedback,
//   read      (stateObject) -> number | null (null: nothing to publish),
//   write     (value, stateObject) -> { service, data } (omitted when read-only),
//   throttle  a measurement, spaced by the sensor interval,
// or `{ skipped: reason }` when nothing maps it.
//
// Value conventions: Home Assistant on one side (entity docs and the
// `supported_features` bits of homeassistant/components/<domain>/const.py),
// the Gladys core enums on the other (server/utils/constants.js, copied: the
// SDK does not export them). A door sensor is `on` when OPEN in Home
// Assistant, and 0 when OPEN in Gladys.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';

// Value enums of the Gladys core.
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const THERMOSTAT_MODE = { OFF: 0, HEATING: 1, COOLING: 2, AUTO: 3 };
export const MUSIC_PLAYBACK_STATE = { PAUSED: 0, PLAYING: 1, IDLE: 2, BUFFERING: 3 };

// supported_features bits of Home Assistant.
export const COVER = { OPEN: 1, CLOSE: 2, SET_POSITION: 4, STOP: 8 };
export const CLIMATE = { TARGET_TEMPERATURE: 1 };
export const FAN = { SET_SPEED: 1 };
export const MEDIA = {
  PAUSE: 1,
  SEEK: 2,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  TURN_ON: 128,
  TURN_OFF: 256,
  PLAY_MEDIA: 512,
  STOP: 4096,
  PLAY: 16384,
  SHUFFLE_SET: 32768,
  BROWSE_MEDIA: 131072,
  REPEAT_SET: 262144,
  MEDIA_ENQUEUE: 2097152,
  SEARCH_MEDIA: 4194304,
};

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const has = (stateObj, bit) =>
  (Number(stateObj.attributes?.supported_features) & bit) === bit;
const attr = (s, key) => s?.attributes?.[key];
const onOff = (s) => (s?.state === 'on' ? 1 : s?.state === 'off' ? 0 : null);
const number = (s) => {
  if (typeof s?.state !== 'string' || s.state.trim() === '') {
    return null;
  }
  const n = Number(s.state);
  return Number.isFinite(n) ? n : null;
};

/** Covers that open a way into the house: their commands are a security choice. */
export const SENSITIVE_COVERS = ['garage', 'gate', 'door'];

// --- Units ------------------------------------------------------------------------

/** Home Assistant unit -> Gladys unit. */
export const UNITS = {
  '°C': U.CELSIUS,
  '°F': U.FAHRENHEIT,
  K: U.KELVIN,
  '%': U.PERCENT,
  hPa: U.HECTO_PASCAL,
  mbar: U.MILLIBAR,
  Pa: U.PASCAL,
  kPa: U.KILO_PASCAL,
  bar: U.BAR,
  psi: U.PSI,
  lx: U.LUX,
  ppm: U.PPM,
  ppb: U.PPB,
  W: U.WATT,
  kW: U.KILOWATT,
  Wh: U.WATT_HOUR,
  kWh: U.KILOWATT_HOUR,
  MWh: U.MEGAWATT_HOUR,
  V: U.VOLT,
  mV: U.MILLI_VOLT,
  A: U.AMPERE,
  mA: U.MILLI_AMPERE,
  'm³': U.CUBIC_METER,
  L: U.LITER,
  mL: U.MILLILITER,
  'µg/m³': U.MICROGRAM_PER_CUBIC_METER,
  'μg/m³': U.MICROGRAM_PER_CUBIC_METER,
  'mg/m³': U.MILLIGRAM_PER_CUBIC_METER,
  'm/s': U.METER_PER_SECOND,
  'km/h': U.KILOMETER_PER_HOUR,
  dB: U.DECIBEL,
  mm: U.MM,
  cm: U.CM,
  m: U.M,
  km: U.KM,
  s: U.SECONDS,
  min: U.MINUTES,
  h: U.HOURS,
  d: U.DAYS,
  'mm/h': U.MILLIMETER_PER_HOUR,
};

/** Display bounds of a temperature (Gladys never applies them to a write). */
const TEMPERATURE_BOUNDS = {
  [U.CELSIUS]: [-60, 150],
  [U.FAHRENHEIT]: [-76, 302],
  [U.KELVIN]: [0, 500],
};

const sensor = (category, type, units, min, max, round) => ({
  category,
  type,
  units,
  min,
  max,
  round,
});
const BIG = 1e9;

/** `sensor` entities, by device_class: the Gladys feature and the units it takes. */
export const SENSORS = {
  temperature: sensor(C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, ['°C', '°F', 'K']),
  humidity: sensor(C.HUMIDITY_SENSOR, T.SENSOR.DECIMAL, ['%'], 0, 100),
  moisture: sensor(C.SOIL_MOISTURE_SENSOR, T.SENSOR.DECIMAL, ['%'], 0, 100),
  pressure: sensor(C.PRESSURE_SENSOR, T.SENSOR.DECIMAL, ['hPa', 'mbar', 'Pa', 'kPa', 'bar', 'psi']),
  atmospheric_pressure: sensor(C.PRESSURE_SENSOR, T.SENSOR.DECIMAL, ['hPa', 'mbar', 'Pa', 'kPa']),
  illuminance: sensor(C.LIGHT_SENSOR, T.SENSOR.DECIMAL, ['lx'], 0, 200_000),
  carbon_dioxide: sensor(C.CO2_SENSOR, T.SENSOR.DECIMAL, ['ppm'], 0, 100_000),
  pm25: sensor(C.PM25_SENSOR, T.SENSOR.DECIMAL, ['µg/m³', 'μg/m³'], 0, 10_000),
  pm10: sensor(C.PM10_SENSOR, T.SENSOR.DECIMAL, ['µg/m³', 'μg/m³'], 0, 10_000),
  volatile_organic_compounds_parts: sensor(C.VOC_SENSOR, T.SENSOR.DECIMAL, ['ppb'], 0, 100_000),
  aqi: sensor(C.AIRQUALITY_SENSOR, T.AIRQUALITY_SENSOR.AQI, [undefined], 0, 500),
  power: sensor(C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, ['W', 'kW'], -BIG, BIG),
  energy: sensor(C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX, ['Wh', 'kWh', 'MWh'], 0, 1e12),
  voltage: sensor(C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, ['V', 'mV'], 0, 1_000_000),
  current: sensor(C.ENERGY_SENSOR, T.ENERGY_SENSOR.CURRENT, ['A', 'mA'], -BIG, BIG),
  battery: sensor(C.BATTERY, T.BATTERY.INTEGER, ['%'], 0, 100, true),
  gas: sensor(C.VOLUME_SENSOR, T.VOLUME_SENSOR.DECIMAL, ['m³', 'L'], 0, 1e12),
  water: sensor(C.VOLUME_SENSOR, T.VOLUME_SENSOR.DECIMAL, ['m³', 'L', 'mL'], 0, 1e12),
  sound_pressure: sensor(C.NOISE_SENSOR, T.SENSOR.INTEGER, ['dB'], 0, 200, true),
  wind_speed: sensor(C.SPEED_SENSOR, T.SPEED_SENSOR.DECIMAL, ['m/s', 'km/h'], 0, 1000),
  speed: sensor(C.SPEED_SENSOR, T.SPEED_SENSOR.DECIMAL, ['m/s', 'km/h'], 0, 1000),
  distance: sensor(C.DISTANCE_SENSOR, T.SENSOR.DECIMAL, ['mm', 'cm', 'm', 'km'], 0, BIG),
  duration: sensor(C.DURATION, T.DURATION.DECIMAL, ['s', 'min', 'h', 'd'], 0, BIG),
  precipitation_intensity: sensor(
    C.PRECIPITATION_SENSOR,
    T.PRECIPITATION_SENSOR.DECIMAL,
    ['mm/h'],
    0,
    10_000,
  ),
};

/** `binary_sensor` entities, by device_class; `invert`: Home Assistant `on` is Gladys 0. */
export const BINARY_SENSORS = {
  door: { category: C.OPENING_SENSOR, type: T.SENSOR.BINARY, invert: true },
  window: { category: C.OPENING_SENSOR, type: T.SENSOR.BINARY, invert: true },
  garage_door: { category: C.OPENING_SENSOR, type: T.SENSOR.BINARY, invert: true },
  opening: { category: C.OPENING_SENSOR, type: T.SENSOR.BINARY, invert: true },
  motion: { category: C.MOTION_SENSOR, type: T.SENSOR.BINARY },
  occupancy: { category: C.MOTION_SENSOR, type: T.SENSOR.BINARY },
  presence: { category: C.PRESENCE_SENSOR, type: T.SENSOR.BINARY },
  smoke: { category: C.SMOKE_SENSOR, type: T.SENSOR.BINARY },
  moisture: { category: C.LEAK_SENSOR, type: T.SENSOR.BINARY },
  carbon_monoxide: { category: C.CO_SENSOR, type: T.SENSOR.BINARY },
  tamper: { category: C.TAMPER, type: T.TAMPER.BINARY },
  battery: { category: C.BATTERY_LOW, type: T.BATTERY_LOW.BINARY },
  vibration: { category: C.VIBRATION_SENSOR, type: T.VIBRATION_SENSOR.BINARY },
};
/** Every other binary sensor (no class, gas, problem, plug…): a generic on/off input. */
const GENERIC_BINARY = { category: C.INPUT, type: T.INPUT.BINARY };

/** Gladys colour temperatures are in mireds. */
const toMireds = (kelvin) => Math.round(1_000_000 / kelvin);

const COLOR_MODES = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];
const DIMMABLE = ['brightness', 'color_temp', 'white', ...COLOR_MODES];

export const colorToInt = ([r, g, b]) =>
  ((Number(r) & 255) << 16) | ((Number(g) & 255) << 8) | (Number(b) & 255);
export const intToColor = (n) => {
  const rgb = clamp(Math.round(Number(n) || 0), 0, 0xffffff);
  return [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
};

/** Home Assistant hvac modes <-> Gladys thermostat modes. */
const HVAC_TO_MODE = {
  off: THERMOSTAT_MODE.OFF,
  heat: THERMOSTAT_MODE.HEATING,
  cool: THERMOSTAT_MODE.COOLING,
  auto: THERMOSTAT_MODE.AUTO,
  heat_cool: THERMOSTAT_MODE.AUTO,
};

/** The error thrown for a refused write, keyed in src/texts.js ERRORS. */
export class WriteError extends Error {
  constructor(key) {
    super(key);
    this.name = 'WriteError';
    this.key = key;
  }
}

const binary = (category, type, extra = {}) => ({
  category,
  type,
  min: 0,
  max: 1,
  ...extra,
});

// --- Domains ----------------------------------------------------------------------

function light(s) {
  const modes = Array.isArray(attr(s, 'supported_color_modes'))
    ? attr(s, 'supported_color_modes')
    : [];
  const features = [
    {
      role: 'state',
      main: true,
      spec: binary(C.LIGHT, T.LIGHT.BINARY),
      read: onOff,
      write: (v) => ({ service: Number(v) > 0 ? 'turn_on' : 'turn_off' }),
    },
  ];
  if (modes.some((m) => DIMMABLE.includes(m))) {
    features.push({
      role: 'brightness',
      spec: { category: C.LIGHT, type: T.LIGHT.BRIGHTNESS, min: 0, max: 100, unit: U.PERCENT },
      read: (st) => {
        if (st.state === 'off') {
          return 0;
        }
        const b = attr(st, 'brightness');
        return finite(b) ? clamp(Math.round((b / 255) * 100), 0, 100) : null;
      },
      write: (v) => {
        const pct = clamp(Math.round(Number(v) || 0), 0, 100);
        return pct === 0
          ? { service: 'turn_off' }
          : { service: 'turn_on', data: { brightness_pct: pct } };
      },
    });
  }
  if (modes.some((m) => COLOR_MODES.includes(m))) {
    features.push({
      role: 'color',
      spec: { category: C.LIGHT, type: T.LIGHT.COLOR, min: 0, max: 0xffffff },
      read: (st) => {
        const rgb = attr(st, 'rgb_color');
        // In white or temperature mode, the computed rgb_color is not the colour chosen.
        if (!COLOR_MODES.includes(attr(st, 'color_mode')) || !Array.isArray(rgb)) {
          return null;
        }
        return colorToInt(rgb);
      },
      write: (v) => ({ service: 'turn_on', data: { rgb_color: intToColor(v) } }),
    });
  }
  if (modes.includes('color_temp')) {
    const minK = finite(attr(s, 'min_color_temp_kelvin')) ? attr(s, 'min_color_temp_kelvin') : 2000;
    const maxK = finite(attr(s, 'max_color_temp_kelvin')) ? attr(s, 'max_color_temp_kelvin') : 6500;
    features.push({
      role: 'color_temp',
      spec: {
        category: C.LIGHT,
        type: T.LIGHT.TEMPERATURE,
        min: toMireds(maxK),
        max: toMireds(minK),
      },
      read: (st) => {
        const k = attr(st, 'color_temp_kelvin');
        return attr(st, 'color_mode') === 'color_temp' && finite(k) && k > 0 ? toMireds(k) : null;
      },
      write: (v) => {
        const mireds = Number(v);
        if (!finite(mireds) || mireds <= 0) {
          throw new WriteError('out_of_range');
        }
        return {
          service: 'turn_on',
          data: { color_temp_kelvin: clamp(Math.round(1_000_000 / mireds), minK, maxK) },
        };
      },
    });
  }
  return features;
}

function toggle() {
  return [
    {
      role: 'state',
      main: true,
      spec: binary(C.SWITCH, T.SWITCH.BINARY),
      read: onOff,
      write: (v) => ({ service: Number(v) > 0 ? 'turn_on' : 'turn_off' }),
    },
  ];
}

function cover(s, { allowSecurity }) {
  const deviceClass = attr(s, 'device_class');
  const sensitive = SENSITIVE_COVERS.includes(deviceClass);
  const controllable = !sensitive || allowSecurity;
  const category = deviceClass === 'curtain' ? C.CURTAIN : C.SHUTTER;
  const types = deviceClass === 'curtain' ? T.CURTAIN : T.SHUTTER;
  const features = [];
  if (controllable && (has(s, COVER.OPEN) || has(s, COVER.CLOSE))) {
    features.push({
      role: 'command',
      main: true,
      spec: { category, type: types.STATE, min: -1, max: 1 },
      read: (st) =>
        ['open', 'opening'].includes(st.state)
          ? COVER_STATE.OPEN
          : ['closed', 'closing'].includes(st.state)
            ? COVER_STATE.CLOSE
            : null,
      write: (v, st) => {
        const value = Number(v);
        if (value === COVER_STATE.OPEN && has(st, COVER.OPEN)) {
          return { service: 'open_cover' };
        }
        if (value === COVER_STATE.CLOSE && has(st, COVER.CLOSE)) {
          return { service: 'close_cover' };
        }
        if (value === COVER_STATE.STOP && has(st, COVER.STOP)) {
          return { service: 'stop_cover' };
        }
        throw new WriteError('unsupported_value');
      },
    });
  }
  if (has(s, COVER.SET_POSITION)) {
    features.push({
      role: 'position',
      main: !controllable,
      spec: { category, type: types.POSITION, min: 0, max: 100, unit: U.PERCENT },
      read: (st) => {
        const p = attr(st, 'current_position');
        return finite(p) ? clamp(Math.round(p), 0, 100) : null;
      },
      write: controllable
        ? (v) => ({
            service: 'set_cover_position',
            data: { position: clamp(Math.round(Number(v) || 0), 0, 100) },
          })
        : undefined,
    });
  }
  if (sensitive) {
    // Always readable, even when the commands are off: open or closed.
    features.push({
      role: 'contact',
      main: features.length === 0,
      spec: binary(C.OPENING_SENSOR, T.SENSOR.BINARY),
      read: (st) =>
        st.state === 'closed'
          ? OPENING_SENSOR_STATE.CLOSE
          : ['open', 'opening', 'closing'].includes(st.state)
            ? OPENING_SENSOR_STATE.OPEN
            : null,
    });
  }
  return features;
}

function climate(s, { temperatureUnit }) {
  const features = [];
  const unit = UNITS[temperatureUnit] ?? U.CELSIUS;
  const min = finite(attr(s, 'min_temp')) ? attr(s, 'min_temp') : 7;
  const max = finite(attr(s, 'max_temp')) ? attr(s, 'max_temp') : 35;
  if (has(s, CLIMATE.TARGET_TEMPERATURE) && min < max) {
    features.push({
      role: 'target',
      main: true,
      spec: { category: C.THERMOSTAT, type: T.THERMOSTAT.TARGET_TEMPERATURE, min, max, unit },
      read: (st) => (finite(attr(st, 'temperature')) ? attr(st, 'temperature') : null),
      write: (v, st) => {
        // Bounded by what Home Assistant says this thermostat accepts, never clamped:
        // a wrong value is refused rather than turned into another one.
        const value = Number(v);
        const lo = finite(attr(st, 'min_temp')) ? attr(st, 'min_temp') : min;
        const hi = finite(attr(st, 'max_temp')) ? attr(st, 'max_temp') : max;
        if (!finite(value) || value < lo || value > hi) {
          throw new WriteError('out_of_range');
        }
        return { service: 'set_temperature', data: { temperature: value } };
      },
    });
  }
  const hvacModes = Array.isArray(attr(s, 'hvac_modes')) ? attr(s, 'hvac_modes') : [];
  if (hvacModes.some((m) => m in HVAC_TO_MODE)) {
    features.push({
      role: 'mode',
      spec: { category: C.THERMOSTAT, type: T.THERMOSTAT.MODE, min: 0, max: 3 },
      read: (st) => HVAC_TO_MODE[st.state] ?? null,
      write: (v, st) => {
        const modes = Array.isArray(attr(st, 'hvac_modes')) ? attr(st, 'hvac_modes') : [];
        const wanted = Object.keys(HVAC_TO_MODE).filter((m) => HVAC_TO_MODE[m] === Number(v));
        const mode = wanted.find((m) => modes.includes(m));
        if (!mode) {
          throw new WriteError('unsupported_value');
        }
        return { service: 'set_hvac_mode', data: { hvac_mode: mode } };
      },
    });
  }
  if (finite(attr(s, 'current_temperature'))) {
    const [lo, hi] = TEMPERATURE_BOUNDS[unit] ?? TEMPERATURE_BOUNDS[U.CELSIUS];
    features.push({
      role: 'current',
      spec: { category: C.TEMPERATURE_SENSOR, type: T.SENSOR.DECIMAL, min: lo, max: hi, unit },
      read: (st) =>
        finite(attr(st, 'current_temperature')) ? attr(st, 'current_temperature') : null,
      throttle: true,
    });
  }
  return features;
}

function sensorEntity(s) {
  const deviceClass = attr(s, 'device_class');
  const def = SENSORS[deviceClass];
  if (!def) {
    return { skipped: deviceClass ? `sensor:${deviceClass}` : 'sensor:no_class' };
  }
  const haUnit = attr(s, 'unit_of_measurement');
  if (!def.units.includes(haUnit)) {
    return { skipped: `sensor:${deviceClass}:${haUnit ?? 'no_unit'}` };
  }
  const unit =
    haUnit === undefined
      ? def.category === C.AIRQUALITY_SENSOR
        ? U.AQI
        : undefined
      : UNITS[haUnit];
  let [min, max] = [def.min, def.max];
  if (min === undefined) {
    [min, max] = TEMPERATURE_BOUNDS[unit] ?? [-BIG, BIG];
    if (def.category === C.PRESSURE_SENSOR) {
      [min, max] = [0, BIG];
    }
  }
  return [
    {
      role: 'value',
      main: true,
      spec: { category: def.category, type: def.type, min, max, ...(unit ? { unit } : {}) },
      read: (st) => {
        const n = number(st);
        return n === null ? null : def.round ? Math.round(n) : n;
      },
      throttle: true,
    },
  ];
}

function binarySensor(s) {
  const def = BINARY_SENSORS[attr(s, 'device_class')] ?? GENERIC_BINARY;
  return [
    {
      role: 'value',
      main: true,
      spec: binary(def.category, def.type),
      read: (st) => {
        const v = onOff(st);
        return v === null ? null : def.invert ? 1 - v : v;
      },
    },
  ];
}

/**
 * HA media_player state -> Gladys playback state. `on`, `idle`, `off` and
 * `standby` hold nothing that plays: IDLE (2), not PAUSED (0).
 */
export function playbackOf(st) {
  switch (st?.state) {
    case 'playing':
      return MUSIC_PLAYBACK_STATE.PLAYING;
    case 'paused':
      return MUSIC_PLAYBACK_STATE.PAUSED;
    case 'buffering':
      return MUSIC_PLAYBACK_STATE.BUFFERING;
    case 'unavailable':
    case 'unknown':
    case undefined:
      return null;
    default:
      return MUSIC_PLAYBACK_STATE.IDLE;
  }
}

export const REPEAT_TO_GLADYS = { off: 0, all: 1, one: 2 };
const GLADYS_TO_REPEAT = ['off', 'all', 'one'];

/** Display bound of a duration or a position, in seconds (a live stream shows 0). */
export const MAX_MEDIA_SECONDS = 86_400;

/** Labels of the playback states offered in Gladys (supported_options), by language. */
export const PLAYBACK_LABELS = {
  en: ['Paused', 'Playing', 'Stopped'],
  fr: ['En pause', 'En lecture', 'Arrêté'],
  de: ['Pausiert', 'Wiedergabe', 'Gestoppt'],
  es: ['En pausa', 'Reproduciendo', 'Detenido'],
};

/**
 * The music features of a player. Every one but `play`/`pause`/`next`/`previous`
 * (and the features of a secondary player, see below) is published through
 * publishNowPlaying (`music`: its key there), never through the state
 * publisher. `playback` and `position` are writable from the start, even when
 * the player cannot do it today (Home Assistant changes supported_features with
 * the media, and Gladys never turns a read-only feature writable on an added
 * device): such a write is refused with a message. The features that follow a
 * supported_features bit carry `present`: when the bit is missing, the
 * inventory still keeps them on a device already added in Gladys ("Update"
 * would delete them while a Cast player sits idle).
 *
 * `primary: false`: another media_player of the same Home Assistant device.
 * One Gladys device shows one player (the Music widget picks its features by
 * type), so the others keep their 1.0 features, read by the state publisher.
 */
function mediaPlayer(s, { primary = true, language = 'fr' } = {}) {
  const features = [];
  features.push({
    role: 'power',
    present: has(s, MEDIA.TURN_ON) || has(s, MEDIA.TURN_OFF),
    spec: binary(C.SWITCH, T.SWITCH.BINARY),
    read: (st) =>
      ['off', 'standby'].includes(st.state)
        ? 0
        : ['unavailable', 'unknown'].includes(st.state)
          ? null
          : 1,
    write: (v, st) => {
      const on = Number(v) > 0;
      if ((on && !has(st, MEDIA.TURN_ON)) || (!on && !has(st, MEDIA.TURN_OFF))) {
        throw new WriteError('unsupported_value');
      }
      return { service: on ? 'turn_on' : 'turn_off' };
    },
  });
  const command = (role, bit, type, service) => {
    features.push({
      role,
      present: has(s, bit),
      spec: {
        ...binary(C.MUSIC, type),
        has_feedback: false,
        ...(primary ? { keep_history: false } : {}),
      },
      write: () => ({ service }),
    });
  };
  const volumeWrite = (v) => ({
    service: 'volume_set',
    data: { volume_level: clamp(Math.round(Number(v) || 0), 0, 100) / 100 },
  });
  if (!primary) {
    // The 1.0 features, unchanged: no "Update" offered, the same ids.
    features.push({
      role: 'playback',
      main: true,
      spec: binary(C.MUSIC, T.MUSIC.PLAYBACK_STATE),
      read: (st) =>
        st.state === 'playing'
          ? MUSIC_PLAYBACK_STATE.PLAYING
          : ['unavailable', 'unknown'].includes(st.state)
            ? null
            : MUSIC_PLAYBACK_STATE.PAUSED,
    });
    command('play', MEDIA.PLAY, T.MUSIC.PLAY, 'media_play');
    command('pause', MEDIA.PAUSE, T.MUSIC.PAUSE, 'media_pause');
    command('next', MEDIA.NEXT_TRACK, T.MUSIC.NEXT, 'media_next_track');
    command('previous', MEDIA.PREVIOUS_TRACK, T.MUSIC.PREVIOUS, 'media_previous_track');
    features.push({
      role: 'volume',
      present: has(s, MEDIA.VOLUME_SET),
      spec: { category: C.MUSIC, type: T.MUSIC.VOLUME, min: 0, max: 100, unit: U.PERCENT },
      read: (st) => {
        const v = attr(st, 'volume_level');
        return finite(v) ? clamp(Math.round(v * 100), 0, 100) : null;
      },
      write: volumeWrite,
    });
    return features;
  }
  const music = (role, key, spec, write, present) => {
    features.push({
      role,
      music: key,
      // The name of the device is the name of its playback state, as in 1.0.
      ...(role === 'playback' ? { main: true } : {}),
      ...(present === undefined ? {} : { present }),
      spec: {
        category: C.MUSIC,
        min: 0,
        max: 0,
        keep_history: false,
        ...spec,
        ...(write ? { has_feedback: true } : {}),
      },
      ...(write ? { write } : {}),
    });
  };
  // `playback` (1.0: read-only, 0/1) keeps its id; Gladys offers "Update" (max 1 -> 2).
  // The options follow the STOP bit: Gladys syncs them on an added device without asking.
  const labels = PLAYBACK_LABELS[language] ?? PLAYBACK_LABELS.en;
  const states = has(s, MEDIA.STOP) ? [0, 1, 2] : [0, 1];
  music(
    'playback',
    'playback_state',
    {
      type: T.MUSIC.PLAYBACK_STATE,
      max: 2,
      supported_options: states.map((value) => ({
        value,
        label: labels[value],
        sort_order: value,
      })),
    },
    (v, st) => {
      const value = Number(v);
      if (value === MUSIC_PLAYBACK_STATE.PLAYING && has(st, MEDIA.PLAY)) {
        return { service: 'media_play' };
      }
      if (value === MUSIC_PLAYBACK_STATE.PAUSED && has(st, MEDIA.PAUSE)) {
        return { service: 'media_pause' };
      }
      if (value === MUSIC_PLAYBACK_STATE.IDLE && has(st, MEDIA.STOP)) {
        return { service: 'media_stop' };
      }
      throw new WriteError('unsupported_value');
    },
  );
  music('title', 'title', { type: T.MUSIC.TITLE });
  music('artist', 'artist', { type: T.MUSIC.ARTIST });
  music('album', 'album', { type: T.MUSIC.ALBUM });
  music('artwork', 'artwork_url', { type: T.MUSIC.ARTWORK });
  music('duration', 'duration', {
    type: T.MUSIC.DURATION,
    max: MAX_MEDIA_SECONDS,
    unit: U.SECONDS,
  });
  music(
    'position',
    'position',
    { type: T.MUSIC.POSITION, max: MAX_MEDIA_SECONDS, unit: U.SECONDS },
    (v, st) => {
      const seconds = Number(v);
      if (!has(st, MEDIA.SEEK)) {
        throw new WriteError('seek_unsupported');
      }
      if (!finite(seconds) || seconds < 0) {
        throw new WriteError('out_of_range');
      }
      return { service: 'media_seek', data: { seek_position: Math.round(seconds) } };
    },
  );
  music(
    'shuffle',
    'shuffle',
    { type: T.MUSIC.SHUFFLE, max: 1 },
    (v) => ({ service: 'shuffle_set', data: { shuffle: Number(v) > 0 } }),
    has(s, MEDIA.SHUFFLE_SET),
  );
  music(
    'repeat',
    'repeat',
    { type: T.MUSIC.REPEAT, max: 2 },
    (v) => {
      const repeat = GLADYS_TO_REPEAT[Number(v)];
      if (!repeat) {
        throw new WriteError('unsupported_value');
      }
      return { service: 'repeat_set', data: { repeat } };
    },
    has(s, MEDIA.REPEAT_SET),
  );
  music(
    'mute',
    'mute',
    { type: T.MUSIC.MUTE, max: 1 },
    (v) => ({ service: 'volume_mute', data: { is_volume_muted: Number(v) > 0 } }),
    has(s, MEDIA.VOLUME_MUTE),
  );
  command('play', MEDIA.PLAY, T.MUSIC.PLAY, 'media_play');
  command('pause', MEDIA.PAUSE, T.MUSIC.PAUSE, 'media_pause');
  command('next', MEDIA.NEXT_TRACK, T.MUSIC.NEXT, 'media_next_track');
  command('previous', MEDIA.PREVIOUS_TRACK, T.MUSIC.PREVIOUS, 'media_previous_track');
  music(
    'volume',
    'volume',
    { type: T.MUSIC.VOLUME, max: 100, unit: U.PERCENT },
    volumeWrite,
    has(s, MEDIA.VOLUME_SET),
  );
  return features;
}

function fan(s) {
  const features = toggle();
  if (has(s, FAN.SET_SPEED)) {
    features.push({
      role: 'speed',
      spec: { category: C.FAN, type: T.FAN.PERCENT, min: 0, max: 100, unit: U.PERCENT },
      read: (st) => {
        if (st.state === 'off') {
          return 0;
        }
        const p = attr(st, 'percentage');
        return finite(p) ? clamp(Math.round(p), 0, 100) : null;
      },
      write: (v) => {
        const pct = clamp(Math.round(Number(v) || 0), 0, 100);
        return pct === 0
          ? { service: 'turn_off' }
          : { service: 'set_percentage', data: { percentage: pct } };
      },
    });
  }
  return features;
}

function lock(s, { allowSecurity }) {
  return [
    {
      role: 'state',
      main: true,
      spec: binary(C.LOCK, T.LOCK.BINARY),
      read: (st) =>
        st.state === 'locked' ? 1 : ['unlocked', 'open'].includes(st.state) ? 0 : null,
      // Read-only unless the user enabled the commands of locks explicitly.
      write: allowSecurity ? (v) => ({ service: Number(v) > 0 ? 'lock' : 'unlock' }) : undefined,
    },
  ];
}

const DOMAINS = {
  light,
  switch: toggle,
  input_boolean: toggle,
  cover,
  climate,
  sensor: sensorEntity,
  binary_sensor: binarySensor,
  media_player: mediaPlayer,
  fan,
  lock,
};

export const domainOf = (entityId) => String(entityId).split('.')[0];

/**
 * @param {object} stateObj one state of get_states
 * @param {object} [options]
 * @param {boolean} [options.allowSecurity] locks, garage doors and gates controllable
 * @param {string} [options.temperatureUnit] the unit_system temperature of Home Assistant
 * @param {boolean} [options.primary] media_player: the player of its device (see mediaPlayer)
 * @param {string} [options.language] labels of the supported options
 * @returns {Array<object> | { skipped: string }}
 */
export function mapEntity(
  stateObj,
  { allowSecurity = false, temperatureUnit = '°C', primary = true, language = 'fr' } = {},
) {
  const domain = domainOf(stateObj?.entity_id);
  const build = DOMAINS[domain];
  if (!build) {
    return { skipped: domain };
  }
  const result = build(stateObj, { allowSecurity, temperatureUnit, primary, language });
  if (!Array.isArray(result)) {
    return result;
  }
  if (result.length === 0) {
    return { skipped: `${domain}:nothing` };
  }
  return result.map((f) => {
    const writable = typeof f.write === 'function';
    return {
      ...f,
      spec: {
        read_only: !writable,
        has_feedback: writable && typeof f.read === 'function',
        keep_history: true,
        ...f.spec,
      },
    };
  });
}
