# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/mapping.test.js          # one file
node --test --test-name-pattern "lock"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK client, registerHandlers, connect
src/app.js                        SDK wiring: every handler of the manifest
src/bridge.js                     Bridge: connection lifecycle, inventory, live states, commands, events
src/ha/socket.js                  Home Assistant WebSocket client (auth, commands, events, ping)
src/inventory.js                  states + registries -> Gladys devices, routes, writers (pure)
src/mapping.js                    one entity -> features with read/write (pure), Gladys enums
src/music.js                      media players: now-playing snapshot, artwork URLs, MediaItems (pure)
src/artwork-resize.js             artwork made small enough for the core (plain JS, copied from gladys-mopidy)
src/publisher.js                  states within 300/min, sensor spacing, 12 h heartbeat
src/scenes.js                     scene actions (call_service, run_script, activate_scene, press_button)
src/widgets.js                    dashboard widget `status`
src/texts.js                      every text of the container, en/fr/de/es
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (same sections)
test/                             node --test, SDK fake Gladys + test/helpers/fakeHa.js
test/fixtures/ha/                 answers of a real Home Assistant 2026.10.1 (demo integration, browse/search)
test/fixtures/artwork/            JPEG variants for test/artwork-resize.test.js
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is in four languages (English, French, German with
  "du", Spanish with "usted"): action messages, manifest texts, feature name
  suffixes, and `docs/{en,fr,de,es}.md`, kept in sync (`test/i18n.test.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli.
  **Piège du 5.2.0** (GladysAssistant/Gladys#3198, correctif #3199, relevé sur gladys-ping-wol) :
  un appareil **créé sans `should_poll`** n'est jamais sondé, même après correction du cœur (valeur
  stockée à la création), et la 5.2.1 du 13/10/2026 ne le corrige pas. **Le conteneur sonde donc
  lui-même** par un minuteur, qui saute un appareil sondé il y a moins d'une demi-période, en gardant
  `onPoll` comme repli ; seuls les appareils ajoutés (`gladys.devices`) sont lus. Un test le prouve
  sans appeler `onPoll`.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- **Un `external_id` de fonctionnalité ne change jamais d'appareil** d'une version à l'autre. UniFi
  1.5.2 avait sorti les ports PoE dans un appareil dédié, la 1.6.0 les a remis dans la passerelle avec
  les mêmes identifiants : ceux qui avaient ajouté l'appareil dédié ne peuvent plus « Mettre à jour » la
  passerelle (409 `external_id must be unique`). Pour regrouper, garder l'appareil existant
  (`gladys.getDevices()`) ou changer d'identifiant.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**SDK 0.15 et journaux**

- SDK `@gladysassistant/integration-sdk` **^0.15.0** (12/10/2026) : `DEVICE_POLL_FREQUENCIES`, faux
  Gladys de test (`@gladysassistant/integration-sdk/testing`, à préférer à un faux maison),
  déduplication des états, `parseMdnsTxt`. Lire son README et son CHANGELOG.
- **Journaux calmes** (demande de Guilhem, 13/10/2026) : rien au niveau info pour un cycle normal de
  lecture, un état publié ou un message reçu. L'info ne garde que le cycle de vie : démarrage,
  connexion, perte et retour d'un appareil ou d'un service, erreurs utiles, une ligne par action de
  l'utilisateur. Le reste passe en debug (`LOG_LEVEL=debug`). Une erreur qui se répète écrit une ligne
  au premier échec et une au rétablissement, pas une par tentative. Jamais de secret ni d'adresse
  avec identifiants. Un test vérifie qu'un cycle normal n'écrit rien en info.
- **Heartbeat** : republier au moins toutes les 12 h une valeur qui ne change pas, sinon le front
  affiche « Pas de valeur récente » au-delà de 48 h.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- **Cibler la dernière version publiée du cœur, pas `master`** : la spec de `master` décrit des
  fonctions non publiées. Les boutons de widget qui ouvrent un formulaire (#3168, commit 3feb2cf8)
  sont absents de la 5.1.4 mais **livrés dans la 5.2.0** (sortie le 12/10/2026) : `gladys_version`
  `>=5.2.0` si on s'en sert, ou un bouton direct en repli. Vérifier par `git tag --contains`.

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration
  (`source: "devices"`, seule source dynamique).
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM public.ecr.aws/docker/library/node:…` (miroir officiel ECR Public, même
  empreinte) et non `node:…` de Docker Hub, qui refuse en 429 les pulls anonymes des runners GitHub
  dès qu'il y a plusieurs builds à la fois. Un échec 429 dans le job « Docker build » n'est pas un bug
  du code. Même parade dans `.github/workflows/build.yml` (posée par l'orchestrateur, ne pas la
  retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.

### Langues (depuis le 11/10/2026)

Tout texte montré à l'utilisateur existe en **`en`, `fr`, `de` et `es`** : manifeste, contenu des widgets, messages,
noms de fonctionnalités. L'allemand **tutoie** (« du »), l'espagnol **vouvoie** (« usted ») : décision de Guilhem,
appliquée à ses 21 intégrations. `test/i18n.test.js` doit échouer sur une langue manquante, un texte vide ou trop
long, et sur un « Sie »/« Ihr… » de politesse en allemand. Le store exige `docs/en.md` et `docs/fr.md`
(`DOCS_LANGUAGES`) et publie aussi `docs/de.md` et `docs/es.md` quand ils existent
(`DOCS_OPTIONAL_LANGUAGES` d'integration-store) : écrire les quatre, avec les mêmes sections.

## Choix par défaut de Guilhem (12/10/2026)

- Langue par défaut des noms de fonctionnalités et des textes produits par le conteneur : **`fr`**.
- Fichier `LICENSE` Apache-2.0 (texte complet) à la racine.
- `transports` : `local` seul quand le cloud n'est qu'une option annexe.
- Docs `en`, `fr`, `de`, `es` avec les mêmes sections.
- Chauffe, ouverture, sécurité : ne rien rendre pilotable « comme un thermostat » ou par un assistant
  vocal quand une erreur serait dangereuse (leçon d'OctoPrint).

## Home Assistant (propre à ce dépôt)

- **API** : WebSocket `/api/websocket` uniquement (`auth` par jeton longue durée, `get_config`,
  `get_states`, registres `config/{entity,device,area}_registry/list`, `subscribe_events`,
  `call_service`, `ping`). Node 22+ a un `WebSocket` global : aucune dépendance. HA peut regrouper
  plusieurs messages dans un tableau JSON : le client les sépare.
- **Les registres sont réservés aux administrateurs** (`unauthorized` sinon) : on se replie sur un
  appareil par entité, sans pièces, et le test de connexion le dit. Les abonnements à un type
  d'événement autre que `state_changed` et les `*_registry_updated` exigent aussi un administrateur.
- **Identifiants** : appareil `device:<id du registre d'appareils>` ou
  `entity:<id du registre d'entités | entity_id>` ; fonctionnalité `<id d'entité>-<rôle>`. L'id du registre d'entités survit
  au renommage d'un `entity_id` ; une entité sans registre (pas de `unique_id`) ne peut pas être
  renommée. Les rôles (`state`, `brightness`, `color`, `color_temp`, `command`, `position`,
  `contact`, `target`, `mode`, `current`, `value`, `power`, `playback`, `play`, `pause`, `next`,
  `previous`, `volume`, `speed`, et depuis 1.1 `title`, `artist`, `album`, `artwork`, `duration`,
  `shuffle`, `repeat`, `mute` ; `position` sert aussi au lecteur) sont figés.
- **Pièges vérifiés sur HA 2026.10.1** : `rgb_color` est calculé même en mode température (ne publier
  la couleur que si `color_mode` est une couleur) ; `color_temp` en mireds a disparu au profit de
  `color_temp_kelvin` / `min_color_temp_kelvin` ; un `climate` en `heat_cool` n'a pas d'attribut
  `temperature` (seulement `target_temp_low/high`) ; `brightness` vaut `null` quand la lampe est
  éteinte ; les entités YAML de la démo (serrures, lecteurs) n'ont pas d'entrée de registre.
- **Sécurité** (choix par défaut de Guilhem) : serrures et volets `garage`/`gate`/`door` en lecture
  seule sauf `allow_security_commands` ; l'action « appeler un service » refuse `lock.*`,
  `alarm_control_panel.*` et l'ouverture d'un volet sensible (ou de tous les volets) sans ce
  réglage. Consigne de thermostat refusée hors `min_temp`/`max_temp`, jamais bornée en silence.
- **Test réel** : `ghcr.io/home-assistant/home-assistant:stable` avec `demo:` dans
  `configuration.yaml`, onboarding et jeton créés par l'API (`/api/onboarding/users`,
  `/auth/token`, puis `auth/long_lived_access_token` en WebSocket).

## Lecteur Musique (Gladys 5.3, SDK 0.16, version 1.1)

- **Un seul canal** : toute fonctionnalité `music` d'un `media_player` (sauf les commandes `play`,
  `pause`, `next`, `previous`) porte une clé `music` dans `src/mapping.js` et n'a pas de `read` :
  elle passe par `publishNowPlaying` (`publishPlayer` de `src/bridge.js`), jamais par le
  publieur d'états. Seules les fonctionnalités d'appareils ajoutés sont envoyées ; un instantané par
  entité (`snapshotId` = `<appareil>:<clé d'entité>`, un appareil HA peut avoir plusieurs lecteurs),
  oublié à `onDeviceCreated` / `onDeviceUpdated` / `onDeviceDeleted` (le SDK n'oublie que l'id exact
  de l'appareil).
- **Toujours inscriptibles** : `playback_state` (0/1/2) et `position` le sont dès la publication,
  même si le lecteur ne sait pas le faire : Home Assistant change `supported_features` selon le
  média (Cast…) et le cœur ne rend jamais inscriptible une fonctionnalité déjà ajoutée en lecture
  seule. Refus avec message (`seek_unsupported`, `unsupported_value`). Les autres (`power`, `play`,
  `pause`, `next`, `previous`, `volume`, `shuffle`, `repeat`, `mute`) suivent les bits (`present`
  dans `src/mapping.js`) **mais restent** sur un appareil déjà ajouté quand le bit disparaît
  (`existing` de `buildInventory`) : « Mettre à jour » supprime les fonctionnalités absentes, et un
  Cast inactif perd PAUSE, PLAY, NEXT… `supported_options` de `playback` suit le bit STOP (le cœur
  les synchronise sans « Mettre à jour »).
- **Plusieurs `media_player` sur un appareil HA** (Android TV + Cast fusionnés) : le widget Musique
  indexe les fonctionnalités par type, donc un seul lecteur porte les fonctionnalités 1.1 : parmi
  les lecteurs sélectionnés (mêmes filtres que l'inventaire : masqué, exclu, pièce), celui qui les a
  déjà dans Gladys, sinon celui de plus petit id de registre ; les autres gardent exactement leurs fonctionnalités 1.0 (lues par
  le publieur d'états). Le catalogue vise ce lecteur seul. `pushAll` parcourt les routes **et** les
  lecteurs (un lecteur sans `power` n'a aucune route).
- **Délai** : une écriture `media_player` attend 4,5 s au plus (Gladys coupe un set-value à 5 s) ; les
  ids de MediaItem hachés (> 512) sont gardés dans `/data/media-ids.json` (scènes).
- **Position** : `media_position` est un échantillon pris à `media_position_updated_at` : la ramener
  à maintenant en lecture (sinon le SDK la croit sautée). Sans position (lecteur démo `walkman`),
  `duration: 0` et `position: 0` (« Direct »).
- **Pochettes** : `entity_picture` vaut `/api/media_player_proxy/<entité>?token=…&cache=…` ; le
  `token` tourne toutes les ~5 min : il est retiré de l'URL (sinon la clé change), et la requête
  porte `Authorization: Bearer <jeton longue durée>`, accepté par le proxy (vérifié sur 2026.10.1 :
  403 sans). Idem `authSig` des chemins signés (`/media/local/…`). Le jeton ne part qu'à l'origine
  de Home Assistant (préfixe de chemin compris : un autre service peut partager l'origine derrière
  un proxy), sans suivre de redirection. Le proxy sert l'image d'origine :
  `artwork-resize.js`.
- **Catalogue** : `media_player/browse_media` rend tout un niveau (pagination faite ici, réponse
  gardée 60 s pour « Charger plus ») ; id d'un MediaItem `["<media_content_type>","<media_content_id>"]`
  (haché au-delà de 512, table dans `/data/media-ids.json`, écrite à part puis renommée). `media_player/search_media` répond `{ result: [...] }`.
  `play_media` avec `enqueue` sur un lecteur sans `MEDIA_ENQUEUE` est **accepté en silence** (il
  remplace) : « à la suite » / « en fin de file » sont refusés ici. Pas de file standard → pas de
  `queue`. Mode `replace` : pas d'`enqueue` (le défaut de chaque intégration, « lire maintenant »).
- **Banc** (`scratch-homeassistant`, 26/10) : HA 2026.10.1 + `demo:` + `media_dirs` local. Aucun
  lecteur démo n'a à la fois `BROWSE_MEDIA` et `PLAY_MEDIA` ; le seek du lecteur YouTube démo ne
  fait rien (service accepté, position inchangée) ; le lecteur `browse` a aussi `SEARCH_MEDIA` mais
  media_source refuse la recherche sans content id.
