// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory transport), the integration wired on it by registerHandlers, and
// the fake Home Assistant. Short timings: everything settles in milliseconds.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createLogger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from '../../src/app.js';
import { TOKEN, createHa } from './fakeHa.js';

export const FAST_TIMINGS = {
  reconnectMin: 20,
  reconnectMax: 80,
  authRetry: 200,
  inventoryDebounce: 20,
  refreshInterval: 60_000,
};
export const FAST_SOCKET = {
  connectTimeout: 500,
  commandTimeout: 500,
  pingInterval: 60_000,
  pingTimeout: 50,
};
export const FAST_PUBLISHER = { flushInterval: 10 };

export const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Waits for a condition, failing with `what` after a while. */
export async function until(check, { what = 'the condition', timeout = 2000 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

export const baseConfig = (extra = {}) => ({
  url: 'http://192.0.2.10:8123',
  token: TOKEN,
  ...extra,
});

/**
 * @param {object} [options]
 * @param {object} [options.ha] the fake Home Assistant (default: the demo fixture)
 * @param {object} [options.config] integration config (default: the fake's address and token)
 * @param {object[]} [options.devices] devices already added in Gladys
 */
export async function createWorld({
  ha = createHa(),
  config,
  devices = [],
  connect = true,
  waitOnline = true,
  logger = createLogger({ level: 'silent' }),
  timings = FAST_TIMINGS,
} = {}) {
  const gladys = createFakeGladys({ config: config ?? baseConfig(), devices });
  const app = registerHandlers(gladys, {
    createSocket: ha.createSocket,
    timings,
    socketTimings: FAST_SOCKET,
    publisherTimings: FAST_PUBLISHER,
    logger,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    if (waitOnline && !ha.down) {
      await until(() => app.bridge.status === 'online', { what: 'Home Assistant online' });
    }
  }
  return { gladys, fake: gladys.fake, app, bridge: app.bridge, ha };
}

/** The discovered device holding the features of this entity. */
export function deviceOf(world, entityId) {
  const id = world.bridge.inventory.entityDevice.get(entityId);
  return world.fake.discoveredDevices.find((d) => d.external_id === id);
}

/** The external id of one feature of an entity. */
export function featureId(world, entityId, role) {
  const key = world.ha.data.entities.find((e) => e.entity_id === entityId)?.id ?? entityId;
  const device = deviceOf(world, entityId);
  const feature = device?.features.find(
    (f) => f.external_id === `${device.external_id}:${key}-${role}`,
  );
  if (!feature) {
    throw new Error(`No feature ${role} for ${entityId}`);
  }
  return feature.external_id;
}

/** Adds a discovered device to Gladys, like the user in the Discovery tab. */
export async function addDevice(world, device) {
  const created = structuredClone(device);
  await world.fake.deviceCreated(created);
  await settle();
  return created;
}

/** Waits for the publisher's next flush. */
export async function flushed(world) {
  await settle();
  await world.bridge.publisher.flush();
  await settle();
}
