// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** The Home Assistant domains the integration turns into Gladys devices. */
export const DOMAINS = [
  'light',
  'switch',
  'input_boolean',
  'cover',
  'climate',
  'sensor',
  'binary_sensor',
  'media_player',
  'fan',
  'lock',
];

export const DEFAULT_CONFIG = {
  url: '',
  token: '',
  domains: [...DOMAINS],
  areas: '',
  include_entities: '',
  exclude_entities: '',
  allow_security_commands: false,
  sensor_interval: 10,
  forward_events: '',
  watched_entities: '',
  language: 'fr',
};

// Home Assistant listens on 8123 by default: an address typed without a port gets it.
export const DEFAULT_PORT = 8123;

/**
 * Turn what the user typed into the WebSocket URL of Home Assistant:
 * `192.0.2.10`, `192.0.2.10:8123`, `http://ha.example:8123`,
 * `https://ha.example` or a ws(s) URL, with or without `/api/websocket`.
 * Returns null when it is not usable.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  const schemes = { 'http:': 'ws:', 'https:': 'wss:', 'ws:': 'ws:', 'wss:': 'wss:' };
  if (!schemes[url.protocol] || url.hostname === '') {
    return null;
  }
  if (url.username || url.password) {
    // Credentials in the URL would end up in logs and error messages.
    return null;
  }
  if (!hasScheme && url.port === '') {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/api\/websocket$/, '')
    .replace(/\/+$/, '');
  return `${schemes[url.protocol]}//${url.host}${path}/api/websocket`;
}

/** "a, b\nc d" -> ['a', 'b', 'c', 'd'], lower case, without blanks or duplicates. */
export function splitList(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/** Area names may hold spaces: they are separated by commas, semicolons or new lines only. */
export function splitNames(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(/[,;\n]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/**
 * An entity pattern: `light.kitchen`, `sensor.*_battery`, `*.garden_*`.
 * @param {string} pattern
 * @returns {RegExp}
 */
export function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** @param {string[]} patterns */
export function matcher(patterns) {
  const regexps = patterns.map(patternToRegExp);
  return (entityId) => regexps.some((re) => re.test(entityId));
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typed = typeof source.url === 'string' ? source.url.trim() : '';
  const url = normalizeUrl(typed);
  const domains = Array.isArray(source.domains)
    ? source.domains.filter((d) => DOMAINS.includes(d))
    : [...DOMAINS];
  const interval = Number(source.sensor_interval);
  return {
    url,
    // An address was typed but cannot be used: said in the connection status.
    invalidUrl: typed !== '' && url === null,
    token: typeof source.token === 'string' ? source.token.trim() : '',
    domains,
    areas: splitNames(source.areas),
    include: splitList(source.include_entities),
    exclude: splitList(source.exclude_entities),
    allowSecurity: source.allow_security_commands === true,
    sensorInterval: Number.isFinite(interval)
      ? Math.min(3600, Math.max(0, Math.round(interval)))
      : DEFAULT_CONFIG.sensor_interval,
    forwardEvents: splitList(source.forward_events).filter((e) => /^[a-z0-9_.-]+$/.test(e)),
    watched: splitList(source.watched_entities),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
