// -----------------------------------------------------------------------------
// Home Assistant media players as Gladys 5.3 music players: the now-playing
// snapshot, the writable features, publishNowPlaying end to end, the catalog
// (browse_media, search_media, play_media) and the artwork, against the
// answers of a real Home Assistant 2026.10.1 (demo + a local media folder).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import { validateMediaItems } from '@gladysassistant/integration-sdk';
import { createHa, fixture } from './helpers/fakeHa.js';
import { addDevice, createWorld, deviceOf, settle, until } from './helpers/world.js';
import { MUSIC_PLAYBACK_STATE, mapEntity } from '../src/mapping.js';
import { MediaIds, artworkUrlOf, httpBase, nowPlayingOf, toMediaItem } from '../src/music.js';

const BASE = 'http://192.0.2.10:8123';
const states = fixture().states;
const state = (id) => structuredClone(states.find((s) => s.entity_id === id));
const role = (features, name) => features.find((f) => f.role === name);

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

/** A device as Gladys stores it once added, and its feature of one role. */
const feature = (device, name) => device.features.find((f) => f.external_id.endsWith(`-${name}`));

test('now playing: texts, artwork without the rotating token, a position brought to now', () => {
  const lr = state('media_player.living_room');
  const sampled = Date.parse(lr.attributes.media_position_updated_at);
  const snapshot = nowPlayingOf(lr, { now: sampled + 10_000, base: BASE });
  assert.equal(snapshot.playback_state, MUSIC_PLAYBACK_STATE.PLAYING);
  assert.equal(snapshot.title, '♥♥ The Best Fireplace Video (3 hours)');
  assert.equal(snapshot.artist, '');
  assert.equal(snapshot.duration, 300);
  assert.equal(snapshot.position, 55, '45 s sampled 10 s ago');
  assert.equal(snapshot.shuffle, false);
  assert.equal(snapshot.mute, false);
  assert.equal(snapshot.volume, 100);
  assert.equal(
    snapshot.artwork_url,
    `${BASE}/api/media_player_proxy/media_player.living_room?cache=bc2ffb49c4f67034`,
  );
  // Clamped to the duration; frozen while paused.
  assert.equal(nowPlayingOf(lr, { now: sampled + 3_600_000, base: BASE }).position, 300);
  const paused = { ...lr, state: 'paused' };
  assert.equal(nowPlayingOf(paused, { now: sampled + 10_000, base: BASE }).position, 45);

  // A track without position (the demo walkman): shown as a live stream, not a running bar.
  const walkman = nowPlayingOf(state('media_player.walkman'), { now: Date.now(), base: BASE });
  assert.deepEqual(
    [walkman.title, walkman.artist, walkman.album, walkman.duration, walkman.position],
    ['I Wanna Be A Hippy (Flamman & Abraxas Radio Mix)', 'Technohead', 'Bounzz', 0, 0],
  );
  assert.equal(walkman.repeat, 0);
  // An episode: the series as album.
  assert.equal(
    nowPlayingOf(state('media_player.lounge_room'), { now: 0, base: BASE }).album,
    'House of Cards',
  );
});

test('now playing: idle clears the texts and the artwork, unavailable publishes nothing', () => {
  const idle = { entity_id: 'media_player.x', state: 'idle', attributes: { volume_level: 0.3 } };
  assert.deepEqual(nowPlayingOf(idle, { now: 0, base: BASE }), {
    playback_state: MUSIC_PLAYBACK_STATE.IDLE,
    title: '',
    artist: '',
    album: '',
    artwork_url: null,
    duration: 0,
    position: 0,
    volume: 30,
  });
  for (const st of ['off', 'standby', 'on']) {
    assert.equal(nowPlayingOf({ ...idle, state: st }, { now: 0 }).playback_state, 2, st);
  }
  assert.equal(nowPlayingOf({ ...idle, state: 'buffering' }, { now: 0 }).playback_state, 3);
  assert.equal(nowPlayingOf({ ...idle, state: 'unavailable' }, { now: 0 }), null);
  assert.equal(nowPlayingOf({ ...idle, state: 'unknown' }, { now: 0 }), null);
});

test('now playing: a position without timestamp counts from when it was first seen', () => {
  const samples = new Map();
  const st = {
    entity_id: 'media_player.x',
    state: 'playing',
    attributes: { media_title: 'A', media_duration: 200, media_position: 20 },
  };
  assert.equal(nowPlayingOf(st, { now: 1000, samples }).position, 20);
  assert.equal(nowPlayingOf(st, { now: 6000, samples }).position, 25);
  st.attributes.media_position = 90;
  assert.equal(nowPlayingOf(st, { now: 7000, samples }).position, 90);
  // A live stream (no duration) is never capped.
  const live = { ...st, attributes: { media_position: 100_000, media_position_updated_at: 'x' } };
  assert.equal(nowPlayingOf(live, { now: 0, samples: new Map() }).position, 100_000);
});

test('artwork URLs: absolute, without token nor authSig on Home Assistant only', () => {
  assert.equal(httpBase('wss://ha.example:8123/sub/api/websocket'), 'https://ha.example:8123/sub');
  assert.equal(
    artworkUrlOf('/api/brands/integration/tts/logo.png', BASE),
    `${BASE}/api/brands/integration/tts/logo.png`,
  );
  assert.equal(
    artworkUrlOf('/media/local/a.jpg?authSig=abc&x=1', BASE),
    `${BASE}/media/local/a.jpg?x=1`,
  );
  assert.equal(
    artworkUrlOf('https://i.scdn.co/image/ab?token=keep', BASE),
    'https://i.scdn.co/image/ab?token=keep',
  );
  assert.equal(artworkUrlOf('data:image/png;base64,xx', BASE), null);
  assert.equal(artworkUrlOf('', BASE), null);
  assert.equal(artworkUrlOf(undefined, BASE), null);
});

test('writable features: play, pause, stop, seek, shuffle, repeat, mute — refused when unsupported', () => {
  const lr = state('media_player.living_room');
  const f = mapEntity(lr);
  const playback = role(f, 'playback');
  assert.deepEqual(
    [playback.spec.min, playback.spec.max, playback.spec.read_only, playback.spec.has_feedback],
    [0, 2, false, true],
  );
  assert.deepEqual(playback.write(1, lr), { service: 'media_play' });
  assert.deepEqual(playback.write(0, lr), { service: 'media_pause' });
  assert.deepEqual(playback.write(2, lr), { service: 'media_stop' });
  assert.throws(() => playback.write(3, lr), { key: 'unsupported_value' });
  assert.deepEqual(role(f, 'position').write(120.4, lr), {
    service: 'media_seek',
    data: { seek_position: 120 },
  });
  assert.deepEqual(role(f, 'shuffle').write(1, lr), {
    service: 'shuffle_set',
    data: { shuffle: true },
  });
  assert.deepEqual(role(f, 'mute').write(0, lr), {
    service: 'volume_mute',
    data: { is_volume_muted: false },
  });
  // The walkman cannot seek: the feature is writable all the same (supported_features
  // follow the media in Home Assistant), the write is refused with a message.
  const walkman = state('media_player.walkman');
  const fw = mapEntity(walkman);
  assert.equal(role(fw, 'position').spec.read_only, false);
  assert.throws(() => role(fw, 'position').write(10, walkman), { key: 'seek_unsupported' });
  assert.deepEqual(role(fw, 'repeat').write(2, walkman), {
    service: 'repeat_set',
    data: { repeat: 'one' },
  });
  assert.throws(() => role(fw, 'repeat').write(5, walkman), { key: 'unsupported_value' });
  // A player without play or stop (search-only demo player).
  const search = state('media_player.search');
  assert.throws(() => role(mapEntity(search), 'playback').write(1, search), {
    key: 'unsupported_value',
  });
});

test('Gladys: the now playing of an added player, one batch, then only the changes', async (t) => {
  const w = await world(t);
  const device = await addDevice(w, deviceOf(w, 'media_player.walkman'));
  const id = (name) => feature(device, name).external_id;
  await until(() => w.fake.lastState(id('title')) !== undefined, { what: 'the now playing' });
  assert.equal(w.fake.lastState(id('playback')), 1);
  assert.equal(w.fake.lastState(id('title')), 'I Wanna Be A Hippy (Flamman & Abraxas Radio Mix)');
  assert.equal(w.fake.lastState(id('artist')), 'Technohead');
  assert.equal(w.fake.lastState(id('album')), 'Bounzz');
  assert.match(w.fake.lastState(id('artwork')), /^art-[0-9a-f]{12}$/);
  assert.equal(w.fake.lastState(id('duration')), 0);
  assert.equal(w.fake.lastState(id('position')), 0);
  assert.equal(w.fake.lastState(id('shuffle')), 0);
  assert.equal(w.fake.lastState(id('repeat')), 0);
  assert.equal(w.fake.lastState(id('mute')), 0);
  assert.equal(w.fake.lastState(id('volume')), 100);
  // Every music state in one batch, none through the state publisher (no double send).
  const sent = w.fake.states.filter(
    (s) =>
      s.device_feature_external_id.startsWith(device.external_id) &&
      !s.device_feature_external_id.endsWith('-power'),
  );
  assert.equal(sent.length, 11);
  assert.equal(new Set(sent.map((s) => s.device_feature_external_id)).size, 11);
  // The artwork is served under that key, with the long-lived token.
  const key = w.fake.lastState(id('artwork'));
  assert.equal(
    w.gladys.artworkUrls.get(key),
    `${BASE}/api/media_player_proxy/media_player.walkman?cache=62c0c516acbc53a9`,
  );

  // A pause: the playback state, and the position sample that goes with it (SDK rule).
  const before = w.fake.states.length;
  w.ha.setState('media_player.walkman', 'paused');
  await until(() => w.fake.lastState(id('playback')) === 0, { what: 'the pause' });
  await settle();
  assert.deepEqual(
    w.fake.states.slice(before).map((s) => s.device_feature_external_id),
    [id('playback'), id('position')],
  );

  // Stopped and unloaded: texts and artwork cleared explicitly, IDLE.
  const ack = await w.fake.setValue(device, feature(device, 'playback'), 2);
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.ha.services().at(-1).service, 'media_player.media_stop');
  await until(() => w.fake.lastState(id('playback')) === 2, { what: 'IDLE' });
  await settle();
  for (const name of ['title', 'artist', 'album', 'artwork']) {
    assert.equal(w.fake.lastState(id(name)), '', name);
  }
});

test('Gladys: commands of the music features and their echo', async (t) => {
  const w = await world(t);
  const device = await addDevice(w, deviceOf(w, 'media_player.living_room'));
  const id = (name) => feature(device, name).external_id;
  await until(() => w.fake.lastState(id('title')) !== undefined, { what: 'the now playing' });

  const cases = [
    ['position', 200, 'media_seek', { seek_position: 200 }],
    ['shuffle', 1, 'shuffle_set', { shuffle: true }],
    ['mute', 1, 'volume_mute', { is_volume_muted: true }],
    ['volume', 40, 'volume_set', { volume_level: 0.4 }],
    ['playback', 0, 'media_pause', {}],
  ];
  for (const [name, value, service, data] of cases) {
    const ack = await w.fake.setValue(device, feature(device, name), value);
    assert.equal(ack.success, true, `${name}: ${ack.error}`);
    assert.deepEqual(w.ha.services().at(-1), {
      service: `media_player.${service}`,
      data,
      target: 'media_player.living_room',
    });
    await until(() => w.fake.lastState(id(name)) === value, { what: `the echo of ${name}` });
  }
  // A seek is a new sample: republished. Paused: frozen at 200.
  assert.equal(w.fake.lastState(id('position')), 200);

  // The walkman cannot seek: a clear refusal, nothing sent.
  const walkman = await addDevice(w, deviceOf(w, 'media_player.walkman'));
  const count = w.ha.services().length;
  const refused = await w.fake.setValue(walkman, feature(walkman, 'position'), 10);
  assert.equal(refused.success, false);
  assert.match(refused.error, /se déplacer/);
  assert.equal(w.ha.services().length, count);
});

test('a player added with 1.0: playback and volume go on, the new features after "Update"', async (t) => {
  const w = await world(t);
  const discovered = deviceOf(w, 'media_player.walkman');
  // The 1.0 device: playback read-only 0/1, commands and volume.
  const old = structuredClone(discovered);
  old.features = old.features.filter((f) =>
    /-(power|playback|play|pause|next|previous|volume)$/.test(f.external_id),
  );
  const playback = old.features.find((f) => f.external_id.endsWith('-playback'));
  Object.assign(playback, { read_only: true, max: 1, has_feedback: false });
  const device = await addDevice(w, old);
  await until(() => w.fake.lastState(playback.external_id) === 1, { what: 'the playback state' });
  const title = feature(discovered, 'title').external_id;
  assert.equal(w.fake.lastState(title), undefined, 'not added yet: not sent');

  // "Update" in Discovery: the SDK forgets the snapshot, everything is published.
  await w.fake.deviceUpdated(structuredClone(discovered));
  await until(() => w.fake.lastState(title) !== undefined, { what: 'the title after the update' });
  assert.equal(w.fake.lastState(playback.external_id), 1);
  assert.ok(device);
});

test('browse: the root of Home Assistant, pages of a level, a folder opened', async (t) => {
  const w = await world(t);
  const device = await addDevice(w, deviceOf(w, 'media_player.browse'));
  const root = await w.fake.musicBrowse(device);
  assert.equal(root.success, true, root.error);
  assert.equal(root.data.total, 6);
  assert.deepEqual(validateMediaItems(root.data.items), []);
  const myMedia = root.data.items.find((i) => i.title === 'My media');
  assert.deepEqual(myMedia, {
    id: '["app","media-source://media_source"]',
    type: 'folder',
    title: 'My media',
    duration: null,
    browsable: true,
    playable: false,
    artwork_key: myMedia.artwork_key,
  });
  assert.equal(
    w.gladys.artworkUrls.get(myMedia.artwork_key),
    `${BASE}/api/brands/integration/media_source/logo.png`,
  );
  // A second page comes from the same answer.
  const calls = w.ha.callsOf('media_player/browse_media').length;
  const page = await w.fake.musicBrowse(device, { offset: 4, limit: 50 });
  assert.deepEqual(
    page.data.items.map((i) => i.title),
    ['My media', 'Text-to-speech'],
  );
  assert.equal(w.ha.callsOf('media_player/browse_media').length, calls);

  const level = await w.fake.musicBrowse(device, { parentId: myMedia.id });
  assert.deepEqual(
    level.data.items.map((i) => [i.title, i.type, i.browsable, i.playable]),
    [['Albums', 'folder', true, false]],
  );
  const bench = await w.fake.musicBrowse(device, {
    parentId: '["","media-source://media_source/local/Albums/Bench"]',
  });
  assert.deepEqual(
    bench.data.items.map((i) => [i.title, i.type, i.playable]),
    [
      ['01 - First.mp3', 'track', true],
      ['cover.png', 'track', true],
    ],
  );
  assert.deepEqual(w.ha.callsOf('media_player/browse_media').at(-1), {
    id: w.ha.callsOf('media_player/browse_media').at(-1).id,
    type: 'media_player/browse_media',
    entity_id: 'media_player.browse',
    media_content_type: '',
    media_content_id: 'media-source://media_source/local/Albums/Bench',
  });

  // A player without browsing: a clear refusal, nothing asked.
  const walkman = await addDevice(w, deviceOf(w, 'media_player.walkman'));
  const refused = await w.fake.musicBrowse(walkman);
  assert.equal(refused.success, false);
  assert.match(refused.error, /ne se parcourt pas/);
  // An id that is not ours.
  const bad = await w.fake.musicBrowse(device, { parentId: 'spotify:album:1' });
  assert.match(bad.error, /inconnu/);
});

test('search: search_media of Home Assistant, the type as media classes', async (t) => {
  const w = await world(t);
  const device = await addDevice(w, deviceOf(w, 'media_player.search'));
  const found = await w.fake.musicSearch(device, { query: 'hip', type: 'album' });
  assert.equal(found.success, true, found.error);
  assert.deepEqual(found.data.items, [
    {
      id: '["movie","search_result_id"]',
      type: 'track',
      title: 'Search result',
      duration: null,
      browsable: false,
      playable: true,
    },
  ]);
  const call = w.ha.callsOf('media_player/search_media').at(-1);
  assert.equal(call.search_query, 'hip');
  assert.deepEqual(call.media_filter_classes, ['album']);
  const walkman = await addDevice(w, deviceOf(w, 'media_player.walkman'));
  const refused = await w.fake.musicSearch(walkman, { query: 'x' });
  assert.match(refused.error, /pas de recherche/);
});

test('play: play_media with the content type, enqueue only where Home Assistant has a queue', async (t) => {
  const w = await world(t);
  const device = await addDevice(w, deviceOf(w, 'media_player.living_room'));
  const media = { id: '["music","media-source://media_source/local/Albums/Bench/01 - First.mp3"]' };
  const ack = await w.fake.musicPlay(device, { ...media, type: 'track' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.ha.services().at(-1), {
    service: 'media_player.play_media',
    data: {
      media_content_id: 'media-source://media_source/local/Albums/Bench/01 - First.mp3',
      media_content_type: 'music',
    },
    target: 'media_player.living_room',
  });
  // No MEDIA_ENQUEUE on this player: Home Assistant would replace silently.
  const count = w.ha.services().length;
  const next = await w.fake.musicPlay(device, { ...media, type: 'track' }, 'next');
  assert.equal(next.success, false);
  assert.match(next.error, /file d'attente/);
  assert.equal(w.ha.services().length, count);

  // With a queue: next -> enqueue next, append -> enqueue add.
  w.ha.setState('media_player.living_room', 'playing', { supported_features: 119695 | 2097152 });
  await settle();
  await w.fake.musicPlay(device, { ...media, type: 'track' }, 'next');
  assert.equal(w.ha.services().at(-1).data.enqueue, 'next');
  await w.fake.musicPlay(device, { ...media, type: 'track' }, 'append');
  assert.equal(w.ha.services().at(-1).data.enqueue, 'add');

  // The browse-only player cannot start anything.
  const browse = await addDevice(w, deviceOf(w, 'media_player.browse'));
  const refused = await w.fake.musicPlay(browse, { ...media, type: 'track' });
  assert.match(refused.error, /lancer de média/);
});

test('MediaItem ids: content type and id together, long ones hashed and kept', () => {
  const ids = new MediaIds();
  const short = ids.encode('music', 'media-source://a');
  assert.deepEqual(ids.decode(short), { type: 'music', id: 'media-source://a' });
  const long = ids.encode('music', `media-source://${'x'.repeat(600)}`);
  assert.match(long, /^ha:[0-9a-f]{40}$/);
  assert.equal(ids.decode(long).id.length, 615);
  assert.equal(ids.decode('spotify:track:1'), null);
  assert.equal(ids.decode('[1,2]'), null);
  // A line is never dropped: no title -> the content id, an unknown class -> a track.
  const item = toMediaItem(
    { media_content_id: 'x', media_content_type: 't', can_play: true },
    { ids, artworkKey: () => 'art-0', base: BASE },
  );
  assert.deepEqual(validateMediaItems([item]), []);
  assert.equal(item.title, 'x');
  const types = [
    [{ media_class: 'album', can_expand: true }, 'album'],
    [{ media_class: 'artist', can_expand: true }, 'artist'],
    [{ media_class: 'playlist', can_expand: true }, 'playlist'],
    [{ media_class: 'podcast', can_expand: true }, 'playlist'],
    [{ media_class: 'channel', can_play: true }, 'radio'],
    [{ media_class: 'directory', can_expand: true }, 'folder'],
    [{ media_class: 'music', can_play: true }, 'track'],
  ];
  for (const [node, type] of types) {
    assert.equal(toMediaItem({ ...node, title: 'a' }, { ids, artworkKey: () => 'k' }).type, type);
  }
});

/** A PNG of noise, too large for the core (300 KB). */
function noisePng(size) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = randomBytes((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rows[y * (size * 3 + 1)] = 0;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('artwork: read with the token from Home Assistant only, resized when too large', async (t) => {
  const requests = [];
  const big = noisePng(800);
  assert.ok(big.length > 300 * 1024);
  const fetch = async (url, init) => {
    requests.push({ url, auth: init.headers.authorization, redirect: init.redirect });
    return new Response(big, { headers: { 'content-type': 'image/png' } });
  };
  const ha = createHa();
  const w = await createWorld({ ha });
  t.after(() => w.app.stop());
  w.bridge.fetch = fetch;
  const own = w.gladys.artworkKey(`${BASE}/api/media_player_proxy/media_player.walkman?cache=1`);
  const answer = await w.fake.musicGetArtwork(own);
  assert.equal(answer.success, true, answer.error);
  const image = Buffer.from(answer.data.image, 'base64');
  assert.ok(image.length <= 300 * 1024);
  assert.deepEqual([image[0], image[1]], [0xff, 0xd8], 'a JPEG');
  assert.deepEqual(requests.at(-1), {
    url: `${BASE}/api/media_player_proxy/media_player.walkman?cache=1`,
    auth: 'Bearer test-token',
    redirect: 'error',
  });
  // Another site never gets the token.
  const other = w.gladys.artworkKey('https://i.scdn.co/image/ab67616d00001e02');
  await w.fake.musicGetArtwork(other);
  assert.deepEqual(requests.at(-1), {
    url: 'https://i.scdn.co/image/ab67616d00001e02',
    auth: undefined,
    redirect: 'follow',
  });
  // Refusals are errors, not images the core would refuse.
  w.bridge.fetch = async () => new Response('GIF89a', { status: 200 });
  assert.equal((await w.fake.musicGetArtwork(own)).success, false);
  w.bridge.fetch = async () => new Response('', { status: 403 });
  assert.match((await w.fake.musicGetArtwork(own)).error, /HTTP 403/);
  assert.equal((await w.fake.musicGetArtwork('art-000000000000')).success, false);
});
