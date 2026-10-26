// -----------------------------------------------------------------------------
// Home Assistant media players as Gladys 5.3 music players (pure helpers).
//
//   nowPlayingOf   a media_player state -> the publishNowPlaying snapshot:
//                  texts, artwork URL, duration, a position brought to now,
//                  shuffle, repeat, mute, volume;
//   artworkUrlOf   entity_picture -> an absolute URL without the access token
//                  Home Assistant rotates every few minutes (the key must not
//                  change with it); the bytes are read with the long-lived
//                  token (src/bridge.js);
//   toMediaItem    a BrowseMedia node -> a Gladys MediaItem;
//   MediaIds       content type + content id <-> MediaItem id (≤ 512).
//
// Home Assistant has no standard queue (no `queue`); browse_media,
// search_media (2025.2 and later) and play_media with `enqueue` give
// `browse`, `search` and `append`.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { MAX_MEDIA_SECONDS, REPEAT_TO_GLADYS, playbackOf } from './mapping.js';

/** The core drops a MediaItem whose id is longer. */
export const MAX_MEDIA_ID_LENGTH = 512;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const text = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
    if (finite(value)) {
      return String(value);
    }
  }
  return '';
};

/** The http(s) origin and path prefix of Home Assistant, from the WebSocket URL of the configuration. */
export function httpBase(wsUrl) {
  if (typeof wsUrl !== 'string' || wsUrl === '') {
    return null;
  }
  return wsUrl.replace(/^ws/, 'http').replace(/\/api\/websocket$/, '');
}

/**
 * An image path given by Home Assistant (entity_picture, a BrowseMedia
 * thumbnail) made absolute. The `token` of the media player proxy and the
 * `authSig` of a signed path expire: they are dropped (the key would change
 * with them), the long-lived token authenticates the request instead.
 * @returns {string|null}
 */
export function artworkUrlOf(picture, base) {
  if (typeof picture !== 'string' || picture === '' || picture.startsWith('data:')) {
    return null;
  }
  let url;
  try {
    // A path of Home Assistant ("/api/…") is under its own prefix, if any (a reverse proxy).
    url =
      base && picture.startsWith('/') && !picture.startsWith('//')
        ? new URL(`${base}${picture}`)
        : base
          ? new URL(picture, `${base}/`)
          : new URL(picture);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  if (base && url.href.startsWith(`${base}/`)) {
    url.searchParams.delete('token');
    url.searchParams.delete('authSig');
  }
  return url.href;
}

/**
 * The publishNowPlaying snapshot of a media_player state, every key; null
 * when the player is unavailable (nothing is published then).
 * @param {object} st the state object
 * @param {object} context
 * @param {number} context.now ms
 * @param {string|null} context.base http base of Home Assistant
 * @param {Map<string, {position: number, at: number}>} [context.samples] the
 *   instants positions without media_position_updated_at were first seen
 */
export function nowPlayingOf(st, { now, base, samples }) {
  const playback = playbackOf(st);
  if (playback === null) {
    return null;
  }
  const a = st.attributes ?? {};
  const snapshot = {
    playback_state: playback,
    title: text(a.media_title, a.media_channel),
    artist: text(a.media_artist, a.media_album_artist),
    album: text(a.media_album_name, a.media_series_title),
    artwork_url: artworkUrlOf(a.entity_picture, base),
  };
  const duration =
    finite(a.media_duration) && a.media_duration > 0
      ? Math.min(Math.round(a.media_duration), MAX_MEDIA_SECONDS)
      : 0;
  if (finite(a.media_position) && a.media_position >= 0) {
    let position = a.media_position;
    if (playback === 1) {
      // The position is a sample taken at media_position_updated_at: brought to now.
      let at = Date.parse(a.media_position_updated_at ?? '');
      if (!Number.isFinite(at) && samples) {
        const seen = samples.get(st.entity_id);
        at = seen && seen.position === a.media_position ? seen.at : now;
        samples.set(st.entity_id, { position: a.media_position, at });
      }
      if (Number.isFinite(at)) {
        position += Math.max(0, now - at) / 1000;
      }
    }
    snapshot.duration = duration;
    // Never capped on a live stream: the dashboard extrapolates it without a cap either.
    snapshot.position = duration > 0 ? Math.min(position, duration) : position;
  } else {
    // No position: shown as a live stream, rather than a bar running from an old sample.
    snapshot.duration = 0;
    snapshot.position = 0;
  }
  if (typeof a.shuffle === 'boolean') {
    snapshot.shuffle = a.shuffle;
  }
  if (a.repeat in REPEAT_TO_GLADYS) {
    snapshot.repeat = REPEAT_TO_GLADYS[a.repeat];
  }
  if (typeof a.is_volume_muted === 'boolean') {
    snapshot.mute = a.is_volume_muted;
  }
  if (finite(a.volume_level)) {
    snapshot.volume = Math.max(0, Math.min(100, Math.round(a.volume_level * 100)));
  }
  return snapshot;
}

// --- Catalog ------------------------------------------------------------------------

/**
 * MediaItem ids: `[content type, content id]` in JSON, what play_media and
 * browse_media take back together. A pair longer than 512 characters gets a
 * hashed id, remembered in `file` (/data) so that a scene keeping it still
 * plays after a restart.
 */
export class MediaIds {
  constructor({ max = 5000, file } = {}) {
    this.max = max;
    this.file = file;
    this.long = new Map();
    if (file) {
      try {
        for (const [id, raw] of JSON.parse(readFileSync(file, 'utf8'))) {
          this.long.set(id, raw);
        }
      } catch {
        // none yet, or unreadable: started empty
      }
    }
  }

  save() {
    if (!this.file) {
      return;
    }
    try {
      writeFileSync(this.file, JSON.stringify([...this.long]));
    } catch {
      // /data unavailable: the ids live until the next restart
    }
  }

  encode(type, id) {
    const raw = JSON.stringify([String(type ?? ''), String(id ?? '')]);
    if (raw.length <= MAX_MEDIA_ID_LENGTH) {
      return raw;
    }
    const hashed = `ha:${createHash('sha1').update(raw).digest('hex')}`;
    const known = this.long.has(hashed);
    this.long.delete(hashed);
    this.long.set(hashed, raw);
    if (this.long.size > this.max) {
      this.long.delete(this.long.keys().next().value);
    }
    if (!known) {
      this.save();
    }
    return hashed;
  }

  /** @returns {{ type: string, id: string } | null} */
  decode(mediaId) {
    const raw = typeof mediaId === 'string' ? (this.long.get(mediaId) ?? mediaId) : '';
    try {
      const pair = JSON.parse(raw);
      if (
        Array.isArray(pair) &&
        pair.length === 2 &&
        typeof pair[0] === 'string' &&
        typeof pair[1] === 'string'
      ) {
        return { type: pair[0], id: pair[1] };
      }
    } catch {
      // not one of ours
    }
    return null;
  }
}

/** Home Assistant media classes -> Gladys media types (MUSIC_MEDIA_TYPES). */
const CONTAINER_TYPES = { album: 'album', artist: 'artist', playlist: 'playlist' };
const ARTIST_CLASSES = ['artist', 'composer', 'contributing_artist'];

export function mediaTypeOf(node) {
  const cls = String(node?.media_class ?? '');
  if (cls === 'channel') {
    return 'radio';
  }
  if (ARTIST_CLASSES.includes(cls)) {
    return 'artist';
  }
  if (node?.can_expand) {
    return CONTAINER_TYPES[cls] ?? (cls === 'podcast' ? 'playlist' : 'folder');
  }
  return 'track';
}

/** Gladys search filter -> Home Assistant media classes. */
export const SEARCH_CLASSES = {
  track: ['track', 'music', 'episode', 'movie', 'video'],
  album: ['album'],
  artist: ['artist'],
  playlist: ['playlist', 'podcast'],
  radio: ['channel'],
  folder: ['directory'],
};

/**
 * @param {object} node a BrowseMedia node of Home Assistant
 * @param {object} context
 * @param {MediaIds} context.ids
 * @param {(url: string) => string} context.artworkKey gladys.artworkKey
 * @param {string|null} context.base
 */
export function toMediaItem(node, { ids, artworkKey, base }) {
  const thumbnail = artworkUrlOf(node?.thumbnail, base);
  const browsable = node?.can_expand === true;
  const playable = node?.can_play === true;
  const item = {
    id: ids.encode(node?.media_content_type, node?.media_content_id),
    type: mediaTypeOf(node),
    title: text(node?.title, node?.media_content_id, '?').slice(0, 200),
    duration: null,
    browsable,
    playable,
  };
  if (thumbnail) {
    item.artwork_key = artworkKey(thumbnail);
  }
  return item;
}
