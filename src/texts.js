// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js).
// Home Assistant and its entity names are never translated.
// -----------------------------------------------------------------------------

/** Suffixes of the secondary features of an entity ("Ceiling – Brightness"). */
export const ROLE_NAMES = {
  en: {
    brightness: 'Brightness',
    color: 'Colour',
    color_temp: 'Colour temperature',
    position: 'Position',
    command: 'Open/close',
    contact: 'Open or closed',
    target: 'Setpoint',
    mode: 'Mode',
    current: 'Temperature',
    volume: 'Volume',
    play: 'Play',
    pause: 'Pause',
    next: 'Next',
    previous: 'Previous',
    playback: 'Playback',
    power: 'Power',
    speed: 'Speed',
  },
  fr: {
    brightness: 'Luminosité',
    color: 'Couleur',
    color_temp: 'Température de couleur',
    position: 'Position',
    command: 'Ouvrir/fermer',
    contact: 'Ouvert ou fermé',
    target: 'Consigne',
    mode: 'Mode',
    current: 'Température',
    volume: 'Volume',
    play: 'Lecture',
    pause: 'Pause',
    next: 'Suivant',
    previous: 'Précédent',
    playback: 'État de lecture',
    power: 'Marche/arrêt',
    speed: 'Vitesse',
  },
  de: {
    brightness: 'Helligkeit',
    color: 'Farbe',
    color_temp: 'Farbtemperatur',
    position: 'Position',
    command: 'Öffnen/Schließen',
    contact: 'Offen oder geschlossen',
    target: 'Solltemperatur',
    mode: 'Modus',
    current: 'Temperatur',
    volume: 'Lautstärke',
    play: 'Wiedergabe',
    pause: 'Pause',
    next: 'Weiter',
    previous: 'Zurück',
    playback: 'Wiedergabestatus',
    power: 'Ein/Aus',
    speed: 'Geschwindigkeit',
  },
  es: {
    brightness: 'Brillo',
    color: 'Color',
    color_temp: 'Temperatura de color',
    position: 'Posición',
    command: 'Abrir/cerrar',
    contact: 'Abierto o cerrado',
    target: 'Consigna',
    mode: 'Modo',
    current: 'Temperatura',
    volume: 'Volumen',
    play: 'Reproducir',
    pause: 'Pausa',
    next: 'Siguiente',
    previous: 'Anterior',
    playback: 'Estado de reproducción',
    power: 'Encendido/apagado',
    speed: 'Velocidad',
  },
};

/** Connection statuses (Configuration screen, widget). */
export const STATUS = {
  not_configured: {
    en: 'Type the address of Home Assistant and an access token.',
    fr: "Saisissez l'adresse de Home Assistant et un jeton d'accès.",
    de: 'Gib die Adresse von Home Assistant und ein Zugriffstoken ein.',
    es: 'Escriba la dirección de Home Assistant y un token de acceso.',
  },
  invalid_url: {
    en: 'The address of Home Assistant is not valid (example: http://192.168.1.20:8123).',
    fr: "L'adresse de Home Assistant n'est pas valide (exemple : http://192.168.1.20:8123).",
    de: 'Die Adresse von Home Assistant ist ungültig (Beispiel: http://192.168.1.20:8123).',
    es: 'La dirección de Home Assistant no es válida (ejemplo: http://192.168.1.20:8123).',
  },
  auth_failed: {
    en: 'Home Assistant refused the access token: create a new one in your profile.',
    fr: "Home Assistant refuse le jeton d'accès : créez-en un nouveau dans votre profil.",
    de: 'Home Assistant lehnt das Zugriffstoken ab: Erstelle ein neues in deinem Profil.',
    es: 'Home Assistant rechaza el token de acceso: cree uno nuevo en su perfil.',
  },
  unreachable: {
    en: 'Home Assistant is unreachable, new attempt in a moment.',
    fr: 'Home Assistant est injoignable, nouvel essai dans un instant.',
    de: 'Home Assistant ist nicht erreichbar, neuer Versuch gleich.',
    es: 'Home Assistant no está accesible, nuevo intento en un momento.',
  },
  not_admin: {
    en: 'The token belongs to a user who is not an administrator: the device list is not readable.',
    fr: "Le jeton appartient à un utilisateur qui n'est pas administrateur : la liste des appareils est illisible.",
    de: 'Das Token gehört keinem Administrator: Die Geräteliste ist nicht lesbar.',
    es: 'El token pertenece a un usuario que no es administrador: la lista de dispositivos no se puede leer.',
  },
};

/** Errors returned to Gladys (command toasts, scene action logs). */
export const ERRORS = {
  offline: {
    en: 'Home Assistant is not connected.',
    fr: "Home Assistant n'est pas connecté.",
    de: 'Home Assistant ist nicht verbunden.',
    es: 'Home Assistant no está conectado.',
  },
  unknown_feature: {
    en: 'This feature is no longer offered by Home Assistant: scan again.',
    fr: "Cette fonctionnalité n'est plus proposée par Home Assistant : relancez une recherche.",
    de: 'Diese Funktion bietet Home Assistant nicht mehr an: Suche erneut.',
    es: 'Home Assistant ya no ofrece esta función: vuelva a buscar.',
  },
  security_disabled: {
    en: 'Commands of locks, garage doors and gates are disabled in the configuration.',
    fr: 'Les commandes des serrures, portes de garage et portails sont désactivées dans la configuration.',
    de: 'Befehle für Schlösser, Garagentore und Tore sind in der Konfiguration deaktiviert.',
    es: 'Los comandos de cerraduras, puertas de garaje y portones están desactivados en la configuración.',
  },
  out_of_range: {
    en: 'Value outside the limits Home Assistant gives for this entity.',
    fr: 'Valeur hors des limites que Home Assistant donne pour cette entité.',
    de: 'Wert außerhalb der Grenzen, die Home Assistant für diese Entität angibt.',
    es: 'Valor fuera de los límites que Home Assistant indica para esta entidad.',
  },
  unsupported_value: {
    en: 'Home Assistant does not offer this value for this entity.',
    fr: 'Home Assistant ne propose pas cette valeur pour cette entité.',
    de: 'Home Assistant bietet diesen Wert für diese Entität nicht an.',
    es: 'Home Assistant no ofrece este valor para esta entidad.',
  },
  bad_service: {
    en: 'Write the service as domain.service, for example light.turn_on.',
    fr: 'Écrivez le service sous la forme domaine.service, par exemple light.turn_on.',
    de: 'Schreibe den Dienst als domain.service, zum Beispiel light.turn_on.',
    es: 'Escriba el servicio como dominio.servicio, por ejemplo light.turn_on.',
  },
  bad_entity: {
    en: 'Write the entity as domain.name, for example script.good_night.',
    fr: "Écrivez l'entité sous la forme domaine.nom, par exemple script.good_night.",
    de: 'Schreibe die Entität als domain.name, zum Beispiel script.good_night.',
    es: 'Escriba la entidad como dominio.nombre, por ejemplo script.good_night.',
  },
  bad_json: {
    en: 'The data must be a JSON object, for example {"brightness_pct": 50}.',
    fr: 'Les données doivent être un objet JSON, par exemple {"brightness_pct": 50}.',
    de: 'Die Daten müssen ein JSON-Objekt sein, zum Beispiel {"brightness_pct": 50}.',
    es: 'Los datos deben ser un objeto JSON, por ejemplo {"brightness_pct": 50}.',
  },
  refused: {
    en: 'Home Assistant refused the command: ',
    fr: 'Home Assistant a refusé la commande : ',
    de: 'Home Assistant hat den Befehl abgelehnt: ',
    es: 'Home Assistant rechazó el comando: ',
  },
};

/** Words of the connection test and of the widget. */
export const WORDS = {
  en: {
    connected: 'Connected',
    unreachable: 'Unreachable',
    not_configured: 'Not configured',
    auth_failed: 'Token refused',
    connecting: 'Connecting',
    version: 'Version',
    connection: 'Connection',
    offered: 'Devices offered',
    added: 'Devices added',
    followed: 'Entities followed',
    reload: 'Reload',
    reloaded: 'Device list read again.',
  },
  fr: {
    connected: 'Connecté',
    unreachable: 'Injoignable',
    not_configured: 'Non configuré',
    auth_failed: 'Jeton refusé',
    connecting: 'Connexion',
    version: 'Version',
    connection: 'Connexion',
    offered: 'Appareils proposés',
    added: 'Appareils ajoutés',
    followed: 'Entités suivies',
    reload: 'Relire',
    reloaded: 'Liste des appareils relue.',
  },
  de: {
    connected: 'Verbunden',
    unreachable: 'Nicht erreichbar',
    not_configured: 'Nicht konfiguriert',
    auth_failed: 'Token abgelehnt',
    connecting: 'Verbinde',
    version: 'Version',
    connection: 'Verbindung',
    offered: 'Angebotene Geräte',
    added: 'Hinzugefügte Geräte',
    followed: 'Verfolgte Entitäten',
    reload: 'Neu laden',
    reloaded: 'Geräteliste neu gelesen.',
  },
  es: {
    connected: 'Conectado',
    unreachable: 'No accesible',
    not_configured: 'Sin configurar',
    auth_failed: 'Token rechazado',
    connecting: 'Conectando',
    version: 'Versión',
    connection: 'Conexión',
    offered: 'Dispositivos ofrecidos',
    added: 'Dispositivos añadidos',
    followed: 'Entidades seguidas',
    reload: 'Recargar',
    reloaded: 'Lista de dispositivos releída.',
  },
};

/**
 * The message of the "Test the connection" action.
 * @param {object} r { version, devices, entities, ignored: [[domain, count]], area }
 */
export function testMessage({ version, devices, entities, ignored }) {
  const list = ignored
    .slice(0, 8)
    .map(([domain, count]) => `${domain} (${count})`)
    .join(', ');
  const none = { en: 'none', fr: 'aucune', de: 'keine', es: 'ninguna' };
  const rest = (lang) => list || none[lang];
  return {
    en: `Connected to Home Assistant ${version}: ${devices} devices offered (${entities} entities). Not imported: ${rest('en')}.`,
    fr: `Connecté à Home Assistant ${version} : ${devices} appareils proposés (${entities} entités). Non importées : ${rest('fr')}.`,
    de: `Mit Home Assistant ${version} verbunden: ${devices} Geräte angeboten (${entities} Entitäten). Nicht importiert: ${rest('de')}.`,
    es: `Conectado a Home Assistant ${version}: ${devices} dispositivos ofrecidos (${entities} entidades). No importadas: ${rest('es')}.`,
  };
}

/** An Error whose message is in the configured language, with the four kept for tests. */
export function localizedError(text, language, detail = '') {
  const err = new Error(`${text[language] ?? text.en}${detail}`);
  err.texts = text;
  return err;
}
