// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`): call a Home Assistant service, run
// a script, activate a scene, press a button. Entities are typed by the scene
// author ("script.good_night", or "good_night" for the action's own domain):
// the scene editor can only list Gladys devices, not Home Assistant entities.
//
// The commands of locks, alarm panels and covers of garages, gates and doors
// follow the same switch as the devices (allow_security_commands): a scene is
// not a way around it.
// -----------------------------------------------------------------------------

const SERVICE = /^([a-z0-9_]+)\.([a-z0-9_]+)$/;
const ENTITY = /^([a-z0-9_]+)\.([a-z0-9_]+)$/;
/** Services that open a cover. */
const OPENING = new Set(['open_cover', 'set_cover_position', 'toggle', 'open_cover_tilt']);

/** "a, b" or ["a", "b"] -> ["a", "b"] */
function entityList(value) {
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === 'string');
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function parseJson(bridge, raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return {};
  }
  let data;
  try {
    data = JSON.parse(String(raw));
  } catch {
    throw bridge.error('bad_json');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw bridge.error('bad_json');
  }
  return data;
}

/** The entity typed, with the action's domain when only the name was given. */
function entityOf(bridge, raw, domains) {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  const full = text.includes('.') ? text : `${domains[0]}.${text}`;
  const match = full.match(ENTITY);
  if (!match || !domains.includes(match[1])) {
    throw bridge.error('bad_entity');
  }
  return { entityId: full, domain: match[1] };
}

/** Refuses a security command when the configuration does not allow them. */
function guard(bridge, domain, service, entityIds) {
  if (bridge.config.allowSecurity) {
    return;
  }
  if (domain === 'lock' || domain === 'alarm_control_panel') {
    throw bridge.error('security_disabled');
  }
  if (domain === 'cover' && OPENING.has(service)) {
    // No target: every cover, the garage door included.
    if (entityIds.length === 0 || entityIds.some((id) => bridge.isSecurityEntity(id))) {
      throw bridge.error('security_disabled');
    }
  }
}

export function sceneActions(bridge) {
  return {
    async call_service(fields) {
      const match = String(fields.service ?? '')
        .trim()
        .toLowerCase()
        .match(SERVICE);
      if (!match) {
        throw bridge.error('bad_service');
      }
      const [, domain, service] = match;
      const data = parseJson(bridge, fields.data);
      const targets = entityList(fields.entity_id);
      for (const id of targets) {
        if (!ENTITY.test(id)) {
          throw bridge.error('bad_entity');
        }
      }
      guard(bridge, domain, service, [...targets, ...entityList(data.entity_id)]);
      bridge.logger.info(
        `Scene action: ${domain}.${service}${targets.length ? ` on ${targets.join(', ')}` : ''}`,
      );
      await bridge.callService(domain, service, data, targets.length ? targets : undefined);
    },

    async run_script(fields) {
      const { entityId } = entityOf(bridge, fields.script, ['script']);
      const variables = parseJson(bridge, fields.variables);
      bridge.logger.info(`Scene action: run ${entityId}`);
      await bridge.callService(
        'script',
        'turn_on',
        Object.keys(variables).length ? { variables } : {},
        entityId,
      );
    },

    async activate_scene(fields) {
      const { entityId } = entityOf(bridge, fields.scene, ['scene']);
      bridge.logger.info(`Scene action: activate ${entityId}`);
      await bridge.callService('scene', 'turn_on', {}, entityId);
    },

    async press_button(fields) {
      const { entityId, domain } = entityOf(bridge, fields.button, ['button', 'input_button']);
      bridge.logger.info(`Scene action: press ${entityId}`);
      await bridge.callService(domain, 'press', {}, entityId);
    },
  };
}

export const SCENE_ACTION_KEYS = ['call_service', 'run_script', 'activate_scene', 'press_button'];
