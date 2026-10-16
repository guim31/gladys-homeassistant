import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMAINS, matcher, normalizeConfig, normalizeUrl } from '../src/config.js';

test('the address of Home Assistant, as typed, becomes its WebSocket URL', () => {
  assert.equal(normalizeUrl('192.0.2.10'), 'ws://192.0.2.10:8123/api/websocket');
  assert.equal(normalizeUrl(' 192.0.2.10:8124 '), 'ws://192.0.2.10:8124/api/websocket');
  assert.equal(normalizeUrl('http://192.0.2.10:8123/'), 'ws://192.0.2.10:8123/api/websocket');
  assert.equal(normalizeUrl('https://ha.example'), 'wss://ha.example/api/websocket');
  assert.equal(normalizeUrl('wss://ha.example/api/websocket'), 'wss://ha.example/api/websocket');
  assert.equal(normalizeUrl('https://example.org/ha/'), 'wss://example.org/ha/api/websocket');
  assert.equal(normalizeUrl('ftp://192.0.2.10'), null);
  assert.equal(normalizeUrl('http://user:pass@192.0.2.10'), null);
  assert.equal(normalizeUrl(''), null);
});

test('defaults and normalization', () => {
  const config = normalizeConfig({});
  assert.equal(config.url, null);
  assert.equal(config.invalidUrl, false);
  assert.deepEqual(config.domains, DOMAINS);
  assert.equal(config.allowSecurity, false);
  assert.equal(config.sensorInterval, 10);
  assert.equal(config.language, 'fr');
  const typed = normalizeConfig({
    url: 'nope://',
    domains: ['light', 'vacuum'],
    areas: 'Living Room, kitchen',
    include_entities: 'sensor.a, light.*\nswitch.b',
    forward_events: 'zha_event, bad!, tag_scanned',
    allow_security_commands: 'true',
    sensor_interval: '-5',
    language: 'it',
  });
  assert.equal(typed.invalidUrl, true);
  assert.deepEqual(typed.domains, ['light']);
  assert.deepEqual(typed.areas, ['living room', 'kitchen']);
  assert.deepEqual(typed.include, ['sensor.a', 'light.*', 'switch.b']);
  assert.deepEqual(typed.forwardEvents, ['zha_event', 'tag_scanned']);
  assert.equal(typed.allowSecurity, false, 'only a real true allows the security commands');
  assert.equal(typed.sensorInterval, 0);
  assert.equal(typed.language, 'fr');
});

test('entity patterns: * matches any text, nothing else is special', () => {
  const match = matcher(['sensor.*_battery', 'light.kitchen']);
  assert.equal(match('sensor.door_battery'), true);
  assert.equal(match('light.kitchen'), true);
  assert.equal(match('light.kitchenX'), false);
  assert.equal(match('sensorXdoor_battery'), false);
});
