// -----------------------------------------------------------------------------
// Home Assistant WebSocket API client (https://developers.home-assistant.io/docs/api/websocket).
//
// One connection to /api/websocket: the server says `auth_required`, the
// client answers with the long-lived access token, the server says `auth_ok`
// (with its version) or `auth_invalid`. Then every command carries an `id`,
// answered by a `result` message of the same id; a subscription keeps its id
// and receives `event` messages with it. A `ping` every 30 s detects a dead
// link (Wi-Fi gone, Home Assistant frozen) that TCP alone would not see for
// minutes. Reconnection is the caller's job (src/bridge.js): this client
// connects once and emits `close` when the link is lost.
//
// The WebSocket is the one built into Node.js (22+): no dependency. Tests pass
// their own `createSocket` (test/helpers/fakeHa.js), never a network socket.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export const SOCKET_TIMINGS = {
  connectTimeout: 15_000,
  commandTimeout: 20_000,
  pingInterval: 30_000,
  pingTimeout: 10_000,
};

/** Home Assistant answered the command with `success: false`. */
export class HaCommandError extends Error {
  constructor(code, message) {
    super(message || code || 'Home Assistant refused the command');
    this.name = 'HaCommandError';
    this.code = code;
  }
}

/** The token was refused (`auth_invalid`). */
export class HaAuthError extends Error {
  constructor(message) {
    super(message || 'Invalid access token');
    this.name = 'HaAuthError';
  }
}

export class HaSocket extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.url ws(s)://host:port/api/websocket
   * @param {string} options.token long-lived access token
   * @param {(url: string) => WebSocket} [options.createSocket]
   * @param {object} [options.timings]
   * @param {object} [options.timers]
   */
  constructor({
    url,
    token,
    createSocket = (u) => new WebSocket(u),
    timings = SOCKET_TIMINGS,
    timers = globalThis,
  }) {
    super();
    this.url = url;
    this.token = token;
    this.createSocket = createSocket;
    this.timings = { ...SOCKET_TIMINGS, ...timings };
    this.timers = timers;
    this.nextId = 1;
    /** id -> { resolve, reject, timer } */
    this.pending = new Map();
    /** subscription id -> callback(event) */
    this.subscriptions = new Map();
    this.ws = undefined;
    this.version = undefined;
    this.closed = false;
    this.pingTimer = undefined;
    this.pongTimer = undefined;
  }

  /** Opens and authenticates; resolves with the Home Assistant version. */
  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (!settled) {
          settled = true;
          this.timers.clearTimeout(timer);
          reject(err);
        }
        this.shutdown();
      };
      const timer = this.timers.setTimeout(
        () => fail(new Error('Home Assistant did not answer in time')),
        this.timings.connectTimeout,
      );
      let ws;
      try {
        ws = this.createSocket(this.url);
      } catch (err) {
        fail(err);
        return;
      }
      this.ws = ws;
      ws.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        } catch {
          return;
        }
        // Home Assistant may coalesce several messages in one JSON array.
        for (const m of Array.isArray(message) ? message : [message]) {
          if (settled) {
            this.handle(m);
          } else if (m?.type === 'auth_required') {
            this.send({ type: 'auth', access_token: this.token });
          } else if (m?.type === 'auth_ok') {
            settled = true;
            this.timers.clearTimeout(timer);
            this.version = typeof m.ha_version === 'string' ? m.ha_version : undefined;
            this.startPing();
            resolve(this.version);
          } else if (m?.type === 'auth_invalid') {
            fail(new HaAuthError(m.message));
          }
        }
      };
      ws.onerror = (event) => {
        if (!settled) {
          fail(new Error(event?.error?.message || event?.message || 'connection failed'));
        }
      };
      ws.onclose = () => {
        if (!settled) {
          fail(new Error('connection closed'));
          return;
        }
        this.shutdown();
      };
    });
  }

  send(message) {
    if (!this.ws || this.closed) {
      throw new Error('not connected to Home Assistant');
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * One command; resolves with its `result`, rejects with HaCommandError.
   * @param {string} type
   * @param {object} [payload]
   */
  call(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId;
      this.nextId += 1;
      const timer = this.timers.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Home Assistant did not answer ${type} in time`));
      }, this.timings.commandTimeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ ...payload, id, type });
      } catch (err) {
        this.timers.clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Subscribes to one event type (`state_changed`, `zha_event`…).
   * @param {string} eventType
   * @param {(event: object) => void} callback
   */
  async subscribeEvents(eventType, callback) {
    const id = this.nextId;
    // The callback is known before the answer: an event may follow it at once.
    this.subscriptions.set(id, callback);
    try {
      await this.call('subscribe_events', { event_type: eventType });
    } catch (err) {
      this.subscriptions.delete(id);
      throw err;
    }
    return id;
  }

  handle(message) {
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'event') {
      const callback = this.subscriptions.get(message.id);
      if (callback && message.event) {
        callback(message.event);
      }
      return;
    }
    if (message.type === 'pong') {
      this.timers.clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    this.timers.clearTimeout(pending.timer);
    if (message.type === 'pong') {
      pending.resolve(true);
    } else if (message.success === false) {
      pending.reject(new HaCommandError(message.error?.code, message.error?.message));
    } else {
      pending.resolve(message.result);
    }
  }

  startPing() {
    this.pingTimer = this.timers.setInterval(() => {
      if (this.pongTimer) {
        return;
      }
      this.pongTimer = this.timers.setTimeout(() => {
        // No pong: the link is dead, even if TCP has not noticed yet.
        this.close();
      }, this.timings.pingTimeout);
      this.call('ping').catch(() => {});
    }, this.timings.pingInterval);
  }

  /** Releases everything once; emits `close` the first time. */
  shutdown() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.timers.clearInterval(this.pingTimer);
    this.timers.clearTimeout(this.pongTimer);
    for (const { reject, timer } of this.pending.values()) {
      this.timers.clearTimeout(timer);
      reject(new Error('connection to Home Assistant lost'));
    }
    this.pending.clear();
    this.subscriptions.clear();
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        // already closed
      }
    }
    this.emit('close');
  }

  close() {
    this.shutdown();
  }
}
