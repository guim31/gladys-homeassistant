# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Gladys 5.3 music player: every Home Assistant `media_player` becomes a full
  player in the Gladys Music widget — artwork, title, artist, album, duration
  and position (seek), shuffle, repeat, mute, volume, and a playback state you
  can write (play, pause, stop) — as far as the player allows it in Home
  Assistant; a refused command says why.
- Music panel: browse the media sources of Home Assistant, search (Home
  Assistant 2025.2 or later, players that support it), play, play next and add
  to queue (players with a queue in Home Assistant), and the "Play music on a
  speaker" scene action.
- Artwork read with your access token and reduced to a JPEG of 400 px when it
  is larger than what Gladys accepts.

### Changed

- Requires Gladys 5.3.0 or later.
- A stopped, idle or switched-off player now reads **Stopped** (2) in its
  playback state, no longer **Paused** (0): check the scenes that wait for 0.
- Players added with 1.0: click **Update** on the device in the Discovery tab
  to get the new features; play, pause, next, previous, volume and the
  playback state keep their ids, so scenes and dashboards keep working.

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-16

### Added

- Bridge to Home Assistant through its WebSocket API (long-lived access token):
  the devices of Home Assistant in the Discovery tab of Gladys, one Gladys
  device per Home Assistant device, states followed live.
- Lights (on/off, brightness, colour, colour temperature), switches and toggle
  helpers, covers (open/close/stop, position), thermostats (setpoint within
  the limits of Home Assistant, mode, room temperature), sensors by device
  class, door and window sensors, motion, presence, smoke, leak, CO and tamper
  detectors, media players, fans and locks.
- Selection by kind of entity, by area, and entity patterns to include or
  exclude.
- Locks, garage doors, gates and doors read-only, and alarm panels never
  disarmed, unless their commands are allowed in the configuration.
- Scene triggers: a Home Assistant event of a listed type, the state change of
  a watched entity.
- Scene actions: call a Home Assistant service, run a script, activate a
  scene, press a button.
- Dashboard widget: connection, version, devices offered and added, entities
  followed, Reload button.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-homeassistant/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-homeassistant/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-homeassistant/releases/tag/v1.0.0
