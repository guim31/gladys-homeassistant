# gladys-homeassistant

[Gladys Assistant](https://gladysassistant.com) external integration bridging
**Home Assistant**: the devices of an existing Home Assistant become Gladys
devices of the Discovery tab, their states follow Home Assistant live, and
Gladys controls them through Home Assistant. Made for Home Assistant users who
move to Gladys at their own pace, or run both side by side. Local only (the
WebSocket API of Home Assistant on your network). Unofficial, not affiliated
with the Home Assistant project, the Open Home Foundation or Nabu Casa.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md) ·
[docs/de.md](docs/de.md) · [docs/es.md](docs/es.md).

> Tested against a real Home Assistant 2026.10.1 in Docker (its `demo`
> integration: lights, covers, thermostats, sensors, media players, fans,
> locks), not yet on many real installations: feedback welcome.

## What it does

- **Devices**: lights (on/off, brightness, colour, colour temperature),
  switches and toggle helpers, covers (open/close/stop, position), thermostats
  (setpoint bounded by Home Assistant, mode, room temperature), sensors by
  device class (temperature, humidity, pressure, illuminance, CO2, PM2.5/PM10,
  power, energy index, voltage, current, battery, gas, water…), binary sensors
  (door/window as Gladys opening sensors, motion, presence, smoke, leak, CO,
  tamper), media players, fans, locks.
- **Music player of Gladys 5.3**: every `media_player` is a full player in the
  Gladys Music widget (artwork, title, artist, album, progress, play / pause /
  stop, seek, shuffle, repeat, mute, volume) with the browse panel
  (`media_player/browse_media`), search (`media_player/search_media`, Home
  Assistant 2025.2 or later) and play / play next / add to queue
  (`play_media` with `enqueue`), and the `music.play-media` scene action.
  Players added with 1.0 get the new features through **Update** in the
  Discovery tab.
- **Selection**: by kind of entity, by area, entity patterns to include or
  exclude; hidden, configuration and diagnostic entities left out (battery
  levels kept). States are only sent for the devices added in Gladys, changes
  only, within the 300 states per minute of the core.
- **Safety**: locks and garage doors, gates and doors are read-only unless
  the user allows their commands in the configuration; the "call a service"
  scene action follows the same switch.
- **Scene triggers**: a Home Assistant event of a listed type (`zha_event`,
  `tag_scanned`…), the state change of a watched entity not imported.
- **Scene actions**: call any Home Assistant service, run a script, activate a
  scene, press a button.
- **Dashboard widget**: connection, version, devices offered and added,
  entities followed, a Reload button.

## Requirements

- Gladys Assistant 5.3.0 or later.
- Home Assistant reachable from the Gladys machine, and a long-lived access
  token (preferably of an administrator: the device and area registries are
  admin-only).

## Installation

In Gladys: **Integrations → Install from GitHub**, address
`https://github.com/guim31/gladys-homeassistant`. Then follow the
[documentation](docs/en.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js ⇄ src/bridge.js (Bridge) ⇄ src/ha/socket.js ⇄ Home Assistant /api/websocket
                              ├─ src/inventory.js  states + registries -> devices, routes (pure)
                              ├─ src/mapping.js    one entity -> features, readers, writers (pure)
                              ├─ src/music.js      media players: now playing, MediaItems (pure)
                              ├─ src/artwork-resize.js  artwork made small enough, plain JS
                              ├─ src/publisher.js  states within 300/min, sensor spacing
                              ├─ src/scenes.js     scene actions
                              └─ src/widgets.js    dashboard widget
```

- **Connection**: the WebSocket API (`auth` with the long-lived token), a
  `ping` every 30 s; lost → unreachable badges, new attempt after 5 s,
  doubling up to 60 s (a refused token: every 5 minutes).
- **Inventory**: `get_config`, `get_states`, `config/entity_registry/list`,
  `config/device_registry/list`, `config/area_registry/list`; read again when
  a registry changes or an entity appears or disappears. One Gladys device per
  Home Assistant device, external ids `ext:<selector>:device:<device id>` and
  `…:<entity registry id>-<role>` (stable when an entity_id is renamed); an
  entity without device: `ext:<selector>:entity:<registry id | entity_id>`.
- **Live**: `subscribe_events` `state_changed`; commands through
  `call_service`, the `state_changed` echo is the feedback.
- **Music**: a media player's state goes through `publishNowPlaying` (the
  position sampled at `media_position_updated_at`, brought to now); the
  artwork key comes from `entity_picture` without its rotating `token`, and
  the image is read with the long-lived token (`Authorization: Bearer`, sent
  to Home Assistant only), then reduced to a JPEG of 400 px when above the
  300 KB the core accepts. MediaItem ids are `["<content type>","<content
id>"]`, what `play_media` and `browse_media` take back.

Developed without access to many real installations: the mapping follows the
Home Assistant entity documentation and was checked against the demo
entities of Home Assistant 2026.10.1.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/ha/media-2026.10.1.json` holds real `browse_media` and
`search_media` answers (demo players and a local media folder).
`test/fixtures/ha/demo-2026.10.1.json` holds the answers of a real Home
Assistant 2026.10.1 (`demo` integration plus a few YAML helpers, a door
template, a script and a scene), read through the WebSocket API, without
tokens. `test/helpers/fakeHa.js` serves them over an in-memory WebSocket;
`test/gladys-rules.test.js` checks every device against the feature table of
the Gladys core.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## Credits

- [Home Assistant](https://github.com/home-assistant/core) (Apache-2.0): the
  WebSocket API documentation, the entity documentation and the
  `supported_features` constants of each domain, read as documentation; its
  Docker image and `demo` integration for the fixtures and the tests.
- [LM1LC3N7/gladys-homey](https://github.com/LM1LC3N7/gladys-homey)
  (Apache-2.0): the state publisher (`src/publisher.js`) is adapted from it,
  and the choices of the bridges of the same family (Jeedom, Domoticz,
  eedomus, Homey Pro) were followed: Discovery tab, one device per source
  device, careful commands.
- [jpeg-js](https://github.com/jpeg-js/jpeg-js) (BSD-3-Clause): its encoder
  writes the reduced artworks (`src/artwork-resize.js`, shared with the other
  music integrations of the author).

## Limits

Not imported: alarm panels, vacuums, cameras, valves, humidifiers, water
heaters, sirens, numbers, selects, text sensors, cover tilt, thermostat
presets, fan modes (watch them with the entity trigger, control them with the
service action). See the [documentation](docs/en.md#limits).

## License

Apache-2.0, see [LICENSE](LICENSE). Home Assistant is a trademark of the Open
Home Foundation; this project is not affiliated with it nor with Nabu Casa.
