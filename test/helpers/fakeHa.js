// -----------------------------------------------------------------------------
// A fake Home Assistant: the WebSocket API of /api/websocket in memory, serving
// the answers of a real Home Assistant 2026.10.1 (test/fixtures/ha). No socket,
// no network: `createSocket` returns an object shaped like the WebSocket of
// Node.js, wired to this server.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const TOKEN = 'test-token';

export function fixture() {
  return JSON.parse(
    readFileSync(new URL('../fixtures/ha/demo-2026.10.1.json', import.meta.url), 'utf8'),
  );
}

const later = (fn) => setImmediate(fn);

/** browse_media and search_media answers of the same Home Assistant (media players). */
export function mediaFixture() {
  return JSON.parse(
    readFileSync(new URL('../fixtures/ha/media-2026.10.1.json', import.meta.url), 'utf8'),
  );
}

const MEDIA_BIT = { browse: 131072, search: 4194304 };

export function createHa({ data = fixture(), admin = true, media = mediaFixture() } = {}) {
  const ha = {
    data,
    media,
    admin,
    token: TOKEN,
    version: data.auth_ok.ha_version,
    down: false,
    sockets: new Set(),
    /** every command received: { type, ...payload } */
    calls: [],
    /** commands to refuse: type -> { code, message } */
    refuse: new Map(),
    connects: 0,
    /** answer nothing to pings (a frozen Home Assistant) */
    silent: false,

    state(entityId) {
      return ha.data.states.find((s) => s.entity_id === entityId);
    },

    /** Changes a state like Home Assistant does, and sends state_changed. */
    setState(entityId, state, attributes) {
      const old = ha.state(entityId);
      const next = {
        entity_id: entityId,
        state,
        attributes: { ...(old?.attributes ?? {}), ...(attributes ?? {}) },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };
      ha.data.states = ha.data.states.filter((s) => s.entity_id !== entityId).concat(next);
      ha.fire('state_changed', { entity_id: entityId, old_state: old ?? null, new_state: next });
      return next;
    },

    removeEntity(entityId) {
      const old = ha.state(entityId);
      ha.data.states = ha.data.states.filter((s) => s.entity_id !== entityId);
      ha.fire('state_changed', { entity_id: entityId, old_state: old, new_state: null });
    },

    fire(eventType, eventData) {
      for (const socket of ha.sockets) {
        socket.emitEvent(eventType, eventData);
      }
    },

    /** Closes every connection (Home Assistant restarted). */
    drop() {
      for (const socket of [...ha.sockets]) {
        socket.serverClose();
      }
    },

    callsOf(type) {
      return ha.calls.filter((c) => c.type === type);
    },

    services() {
      return ha.callsOf('call_service').map((c) => ({
        service: `${c.domain}.${c.service}`,
        data: c.service_data,
        target: c.target?.entity_id,
      }));
    },

    createSocket(url) {
      ha.connects += 1;
      return new FakeSocket(ha, url);
    },
  };
  ha.createSocket = ha.createSocket.bind(ha);
  return ha;
}

class FakeSocket {
  constructor(ha, url) {
    this.ha = ha;
    this.url = url;
    this.authed = false;
    this.subscriptions = new Map();
    this.open = true;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    later(() => {
      if (ha.down) {
        this.onerror?.({ message: 'connect ECONNREFUSED 192.0.2.10:8123' });
        this.onclose?.({});
        return;
      }
      ha.sockets.add(this);
      this.deliver({ type: 'auth_required', ha_version: ha.version });
    });
  }

  deliver(message) {
    later(() => {
      if (this.open) {
        this.onmessage?.({ data: JSON.stringify(message) });
      }
    });
  }

  send(text) {
    if (!this.open) {
      throw new Error('socket closed');
    }
    const message = JSON.parse(text);
    if (!this.authed) {
      if (message.type === 'auth' && message.access_token === this.ha.token) {
        this.authed = true;
        this.deliver({ type: 'auth_ok', ha_version: this.ha.version });
      } else {
        this.deliver({ type: 'auth_invalid', message: 'Invalid access token or password' });
        later(() => this.serverClose());
      }
      return;
    }
    this.ha.calls.push(message);
    this.answer(message);
  }

  result(id, result) {
    this.deliver({ id, type: 'result', success: true, result });
  }

  error(id, code, message) {
    this.deliver({ id, type: 'result', success: false, error: { code, message } });
  }

  answer(m) {
    const { ha } = this;
    const refused = ha.refuse.get(m.type);
    if (refused) {
      this.error(m.id, refused.code, refused.message);
      return;
    }
    const adminOnly = m.type.startsWith('config/');
    if (adminOnly && !ha.admin) {
      this.error(m.id, 'unauthorized', 'Unauthorized');
      return;
    }
    switch (m.type) {
      case 'ping':
        if (!ha.silent) {
          this.deliver({ id: m.id, type: 'pong' });
        }
        return;
      case 'get_config':
        return this.result(m.id, ha.data.config);
      case 'get_states':
        return this.result(m.id, structuredClone(ha.data.states));
      case 'config/entity_registry/list':
        return this.result(m.id, ha.data.entities);
      case 'config/device_registry/list':
        return this.result(m.id, ha.data.devices);
      case 'config/area_registry/list':
        return this.result(m.id, ha.data.areas);
      case 'subscribe_events': {
        const allowed = ha.admin || ['state_changed'].concat(REGISTRY).includes(m.event_type);
        if (!allowed) {
          return this.error(m.id, 'unauthorized', 'Unauthorized');
        }
        this.subscriptions.set(m.id, m.event_type);
        return this.result(m.id, null);
      }
      case 'media_player/browse_media': {
        const player = ha.state(m.entity_id);
        if (!player || !(player.attributes.supported_features & MEDIA_BIT.browse)) {
          return this.error(m.id, 'not_supported', 'Player does not support browsing media');
        }
        const node = [ha.media.browse_root, ha.media.browse_media_source, ha.media.browse_bench]
          .concat(ha.media.extra ?? [])
          .find((n) =>
            m.media_content_id === undefined
              ? n === ha.media.browse_root
              : n.media_content_id === m.media_content_id ||
                (m.media_content_id === 'media-source://media_source' &&
                  n === ha.media.browse_media_source),
          );
        if (!node) {
          return this.error(m.id, 'home_assistant_error', 'Unknown source directory.');
        }
        return this.result(m.id, structuredClone(node));
      }
      case 'media_player/search_media': {
        const player = ha.state(m.entity_id);
        if (!player || !(player.attributes.supported_features & MEDIA_BIT.search)) {
          const { code, message } = ha.media.search_unsupported.error;
          return this.error(m.id, code, message);
        }
        return this.result(m.id, structuredClone(ha.media.search_hip));
      }
      case 'call_service': {
        const entityIds = [m.target?.entity_id ?? []].flat();
        for (const id of entityIds) {
          if (!ha.state(id) && !id.startsWith('script.') && !id.startsWith('scene.')) {
            return this.error(m.id, 'not_found', `Entity ${id} not found`);
          }
        }
        this.result(m.id, { context: { id: 'x' } });
        // Like Home Assistant: the effect comes back as state_changed.
        later(() => applyService(ha, m.domain, m.service, m.service_data ?? {}, entityIds));
        return;
      }
      default:
        return this.error(m.id, 'unknown_command', 'Unknown command.');
    }
  }

  emitEvent(eventType, data) {
    for (const [id, type] of this.subscriptions) {
      if (type === eventType || type === undefined) {
        this.deliver({
          id,
          type: 'event',
          event: {
            event_type: eventType,
            data,
            origin: 'LOCAL',
            time_fired: new Date().toISOString(),
          },
        });
      }
    }
  }

  close() {
    this.open = false;
    this.ha.sockets.delete(this);
  }

  serverClose() {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.ha.sockets.delete(this);
    this.onclose?.({ code: 1006 });
  }
}

const REGISTRY = ['entity_registry_updated', 'device_registry_updated', 'area_registry_updated'];

/** The few effects the tests look at. */
function applyService(ha, domain, service, data, entityIds) {
  for (const id of entityIds) {
    const s = ha.state(id);
    if (!s) {
      continue;
    }
    if (service === 'turn_on' && ['light', 'switch', 'input_boolean', 'fan'].includes(domain)) {
      const attrs = {};
      if (data.brightness_pct !== undefined) {
        attrs.brightness = Math.round((data.brightness_pct / 100) * 255);
      }
      if (data.rgb_color) {
        attrs.rgb_color = data.rgb_color;
        attrs.color_mode = 'hs';
      }
      ha.setState(id, 'on', attrs);
    } else if (service === 'turn_off') {
      ha.setState(id, 'off', domain === 'light' ? { brightness: null } : {});
    } else if (service === 'set_temperature') {
      ha.setState(id, s.state, { temperature: data.temperature });
    } else if (service === 'set_cover_position') {
      ha.setState(id, data.position === 0 ? 'closed' : 'open', {
        current_position: data.position,
      });
    } else if (service === 'lock' || service === 'unlock') {
      ha.setState(id, service === 'lock' ? 'locked' : 'unlocked');
    } else if (domain === 'media_player') {
      applyMedia(ha, id, s, service, data);
    }
  }
}

/** What a demo media player does with the services the music player sends. */
function applyMedia(ha, id, s, service, data) {
  const now = new Date().toISOString();
  switch (service) {
    case 'media_play':
      return ha.setState(id, 'playing', { media_position_updated_at: now });
    case 'media_pause':
      return ha.setState(id, 'paused', { media_position_updated_at: now });
    case 'media_stop': {
      // Unloaded: the media attributes disappear, like on most players.
      const attributes = Object.fromEntries(
        Object.entries(s.attributes).filter(
          ([key]) => !key.startsWith('media_') && key !== 'entity_picture',
        ),
      );
      ha.data.states = ha.data.states.map((x) => (x.entity_id === id ? { ...x, attributes } : x));
      return ha.setState(id, 'idle');
    }
    case 'media_seek':
      return ha.setState(id, s.state, {
        media_position: data.seek_position,
        media_position_updated_at: now,
      });
    case 'shuffle_set':
      return ha.setState(id, s.state, { shuffle: data.shuffle });
    case 'repeat_set':
      return ha.setState(id, s.state, { repeat: data.repeat });
    case 'volume_mute':
      return ha.setState(id, s.state, { is_volume_muted: data.is_volume_muted });
    case 'volume_set':
      return ha.setState(id, s.state, { volume_level: data.volume_level });
    default:
      return undefined;
  }
}
