// -----------------------------------------------------------------------------
// The Home Assistant WebSocket client: authentication, commands, events,
// coalesced messages, and the ping that detects a frozen Home Assistant.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HaAuthError, HaCommandError, HaSocket } from '../src/ha/socket.js';
import { TOKEN, createHa } from './helpers/fakeHa.js';

const timings = { connectTimeout: 300, commandTimeout: 300, pingInterval: 20, pingTimeout: 30 };

function client(ha, token = TOKEN) {
  return new HaSocket({
    url: 'ws://192.0.2.10:8123/api/websocket',
    token,
    createSocket: ha.createSocket,
    timings,
  });
}

test('authenticates, answers commands, refuses with the Home Assistant error', async () => {
  const ha = createHa();
  const socket = client(ha);
  assert.equal(await socket.connect(), '2026.10.1');
  const config = await socket.call('get_config');
  assert.equal(config.version, '2026.10.1');
  ha.refuse.set('get_states', { code: 'home_assistant_error', message: 'Boom' });
  await assert.rejects(socket.call('get_states'), (err) => {
    assert.ok(err instanceof HaCommandError);
    assert.equal(err.code, 'home_assistant_error');
    return true;
  });
  socket.close();
});

test('a refused token is an HaAuthError', async () => {
  const socket = client(createHa(), 'wrong');
  await assert.rejects(socket.connect(), HaAuthError);
});

test('an unreachable Home Assistant rejects the connection', async () => {
  const ha = createHa();
  ha.down = true;
  await assert.rejects(client(ha).connect(), /ECONNREFUSED/);
});

test('events reach their subscription; coalesced messages are split', async () => {
  const ha = createHa();
  const socket = client(ha);
  await socket.connect();
  const seen = [];
  await socket.subscribeEvents('state_changed', (event) => seen.push(event.data.entity_id));
  ha.setState('switch.ac', 'on');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(seen, ['switch.ac']);
  const [fake] = ha.sockets;
  const id = [...fake.subscriptions.keys()][0];
  const event = (entity) => ({
    id,
    type: 'event',
    event: { event_type: 'state_changed', data: { entity_id: entity } },
  });
  fake.onmessage({ data: JSON.stringify([event('a.b'), event('c.d')]) });
  assert.deepEqual(seen, ['switch.ac', 'a.b', 'c.d']);
  socket.close();
});

test('no pong: the link is closed and `close` emitted, pending commands rejected', async () => {
  const ha = createHa();
  const socket = client(ha);
  await socket.connect();
  let closed = 0;
  socket.on('close', () => {
    closed += 1;
  });
  ha.silent = true;
  ha.refuse.set('get_states', { code: 'x', message: 'never' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(closed, 1);
  await assert.rejects(socket.call('get_config'), /not connected/);
});
