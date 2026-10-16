# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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
- Locks, garage doors and gates read-only unless their commands are allowed
  in the configuration.
- Scene triggers: a Home Assistant event of a listed type, the state change of
  a watched entity.
- Scene actions: call a Home Assistant service, run a script, activate a
  scene, press a button.
- Dashboard widget: connection, version, devices offered and added, entities
  followed, Reload button.
- Documentation in English, French, German and Spanish.
