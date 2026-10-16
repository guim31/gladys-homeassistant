# Home-Assistant-Brücke

Diese Integration verbindet Gladys mit **deinem Home Assistant** und bietet
dessen Geräte im Reiter **Entdecken** von Gladys an: Lampen, Schalter und
Steckdosen, Rollläden, Thermostate, Sensoren, Melder, Mediaplayer, Ventilatoren
und Schlösser. Sobald ein Gerät hinzugefügt ist, folgen seine Zustände Home
Assistant **live**, und Gladys steuert es **über Home Assistant**, das seine
Zigbee-, Z-Wave-, Matter-, WLAN- und Cloud-Integrationen behält. Wechsle in
deinem Tempo zu Gladys, Raum für Raum, oder betreibe beide nebeneinander. Alles
bleibt in deinem lokalen Netzwerk. Inoffiziell, nicht mit dem Projekt Home
Assistant oder Nabu Casa verbunden.

> Getestet mit Home Assistant 2026.10 (seinen Demo-Entitäten), noch nicht mit
> vielen echten Installationen: Deine Rückmeldungen sind im GitHub-Repository
> willkommen.

## Voraussetzungen

- Ein aktuelles Home Assistant (getestet mit 2026.10), von der Gladys-Maschine
  aus erreichbar (gleiches Netzwerk oder VPN).
- Ein **langlebiges Zugriffstoken**, am besten von einem
  **Administratorkonto**: Nur ein Administrator kann die Geräte und Bereiche
  von Home Assistant lesen. Ohne ihn wird jede Entität ein eigenes Gerät, und
  der Bereichsfilter wirkt nicht.

## Konfiguration

### Adresse und Token

1. Öffne in Home Assistant dein Profil (unten links), Reiter **Sicherheit**,
   dann **Langlebige Zugriffstoken → Token erstellen**. Nenne es „Gladys“ und
   kopiere das Token: Home Assistant zeigt es nur einmal.
2. Öffne in Gladys die Integration, **Konfiguration**:
   - **Adresse von Home Assistant**: zum Beispiel `http://192.168.1.20:8123`
     oder `https://ha.example.org` hinter einem Reverse-Proxy. Kein
     `.local`-Name, nicht `localhost`: Die Integration läuft in ihrem eigenen
     Container.
   - **Langlebiges Zugriffstoken**: einfügen.
3. Klicke auf **Verbindung testen**: Die Version von Home Assistant, die Zahl
   der angebotenen Geräte und die nicht importierten Entitätstypen werden
   angezeigt.
4. Öffne den Reiter **Entdecken** und füge die gewünschten Geräte hinzu. Deren
   Werte werden sofort nach dem Hinzufügen gesendet.

### Auswahl des Imports

Eine Home-Assistant-Installation hat oft Hunderte von Entitäten. Gladys bietet
nur an:

- die angekreuzten **Entitätstypen** (Lampen, Schalter, Rollläden,
  Thermostate, Sensoren, Melder, Mediaplayer, Ventilatoren, Schlösser,
  Schalter-Helfer);
- in den aufgeführten **Bereichen**, falls angegeben (Namen durch Kommas
  getrennt, wie `Wohnzimmer, Küche`);
- nie die Entitäten aus **Auszulassende Entitäten**
  (`sensor.*_signal_strength`, `*` steht für beliebigen Text);
- dazu die **trotzdem zu importierenden Entitäten**, unabhängig von Typen und
  Bereichen.

Deaktivierte und ausgeblendete Entitäten sowie Konfigurations- und
Diagnose-Entitäten (Helligkeit einer LED, Signalstärke) werden ausgelassen,
außer den Batteriestand-Werten. Nur die in Gladys hinzugefügten Geräte
erhalten Zustände: Die anderen kosten nichts.

### Schlösser, Garagentore und Tore

Standardmäßig sind **Schlösser** und die Rollläden, die Home Assistant als
**Garagentor, Tor oder Tür** einstuft, in Gladys **schreibgeschützt**: Du
siehst, ob sie verriegelt, offen oder geschlossen sind, aber weder ein Gerät
noch eine Szene noch ein mit Gladys verbundener Sprachassistent kann sie
öffnen. Kreuze **Befehle für Schlösser, Garagentore und Tore erlauben** an, um
sie zu steuern (dann im Reiter Entdecken bei diesen Geräten auf
„Aktualisieren“ klicken). Alarmanlagen werden nie importiert; die Szenenaktion, die einen Home-Assistant-Dienst aufruft, lehnt jeden Befehl an sie, an Alarmanlagen und an alle Rollläden auf einmal (`all`, ein Bereich, ein Gerät) ab, solange dieses Feld nicht angekreuzt ist.

### Optionen

- **Mindestabstand zwischen zwei Werten eines Sensors**: standardmäßig 10
  Sekunden. Eine Steckdose, die ihre Leistung jede Sekunde meldet, wird in
  diesem Takt an Gladys gesendet. Schalter, Lampen, Rollläden und Melder werden
  nie verzögert.
- **Sprache der Funktionsnamen**: die Wörter, die an die Namen der
  Nebenfunktionen angehängt werden („Küche – Helligkeit“). Standardmäßig
  Französisch.
- **Ereignistypen, auf die gehört wird** und **Zu beobachtende, nicht
  importierte Entitäten**: siehe die Szenenauslöser unten.

## Was du bekommst

### Geräte

Ein Gladys-Gerät pro **Home-Assistant-Gerät**, mit den Funktionen seiner
Entitäten; eine Entität ohne Gerät (ein Helfer, eine Vorlage) ist ein eigenes
Gerät. Der Name ist der aus Home Assistant, mit seinem Bereich („Decke
(Wohnzimmer)“).

| Home Assistant                                          | In Gladys                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `light`                                                 | Ein/Aus, Helligkeit, Farbe, Farbtemperatur (falls unterstützt)           |
| `switch`, `input_boolean`                               | ein Schalter                                                             |
| `cover`                                                 | ein Rollladen (oder Vorhang): öffnen, schließen, stoppen, Position       |
| `cover` Garagentor, Tor, Tür                            | offen oder geschlossen (schreibgeschützt, sofern nicht erlaubt)          |
| `climate`                                               | Solltemperatur, Modus (aus, heizen, kühlen, auto), Raumtemperatur        |
| `sensor` nach Geräteklasse                              | Temperatur, Feuchtigkeit, Druck, Helligkeit, CO2, PM2,5, PM10            |
|                                                         | Leistung, Energie (Zählerstand), Spannung, Strom, Batterie, Gas, Wasser  |
|                                                         | Lärm, Windgeschwindigkeit, Entfernung, Dauer, Regenintensität, AQI       |
| `binary_sensor` Tür, Fenster, Garagentor, Öffnung       | ein Öffnungsmelder                                                       |
| `binary_sensor` Bewegung, Belegung, Anwesenheit         | ein Bewegungs- oder Anwesenheitsmelder                                   |
| `binary_sensor` Rauch, Feuchtigkeit, CO, Sabotage, usw. | Rauch-, Wasser-, CO-, Sabotagemelder; sonst ein allgemeiner Eingang      |
| `media_player`                                          | Ein/Aus, Wiedergabe, Pause, weiter, zurück, Lautstärke, Wiedergabestatus |
| `fan`                                                   | Ein/Aus, Geschwindigkeit in %                                            |
| `lock`                                                  | verriegelt oder nicht (schreibgeschützt, sofern nicht erlaubt)           |

Die **Solltemperatur** eines Thermostats bleibt innerhalb der Grenzen, die Home
Assistant dafür angibt (`min_temp`, `max_temp`): Ein Wert außerhalb wird
abgelehnt, nie in einen anderen umgewandelt. Ein Thermostat, das nur einen
Bereich annimmt (heat_cool), zeigt Modus und Temperatur, keine
Solltemperatur. Eine Farblampe zeigt im Farbmodus ihre Farbe und im Weißmodus
ihre Farbtemperatur.

### Dashboard-Widget

**Home Assistant**: die angebotenen Geräte, die hinzugefügten Geräte, die
verfolgten Entitäten, die Verbindung und die Version von Home Assistant sowie
eine Taste **Neu laden**, die die Geräteliste neu liest.

### Szenenauslöser

- **Home-Assistant-Ereignis**: Ein Ereignis eines in **Ereignistypen, auf die
  gehört wird** aufgeführten Typs ist eingetreten (`zha_event` einer
  Zigbee-Fernbedienung, `tag_scanned` eines NFC-Tags, eigene Ereignisse).
  Filter: Ereignistyp, Entität. Die Szene erhält den Typ, die Entität und die
  Ereignisdaten (JSON).
- **Home-Assistant-Entität geändert**: Eine in **Zu beobachtende, nicht
  importierte Entitäten** aufgeführte Entität hat ihren Zustand geändert
  (Alarm scharf, Sauger reinigt, Person zu Hause). Filter: Entität, neuer
  Zustand. Die Szene erhält die Entität, ihren Namen, den neuen und den
  vorherigen Zustand.

Für die in Gladys importierten Entitäten nutze den üblichen Auslöser
„Gerätezustand“.

### Szenenaktionen

- **Home-Assistant-Aktion aufrufen**: ein beliebiger Dienst als
  `domain.service` (`light.turn_on`, `notify.mobile_app_handy`), mit
  Entitäten und Daten in JSON (`{"brightness_pct": 50}`).
- **Home-Assistant-Skript ausführen**: `script.good_night`, mit optionalen
  Variablen in JSON.
- **Home-Assistant-Szene aktivieren**: `scene.movie_time`.
- **Home-Assistant-Taste drücken**: `button.restart_router`.

## Szenenbeispiele

- **Zigbee-Fernbedienung bleibt in Home Assistant**: Auslöser
  „Home-Assistant-Ereignis“, Typ `zha_event`; Aktion: eine Gladys-Szene des
  Wohnzimmers starten.
- **Alarm in Home Assistant scharf geschaltet**: beobachte
  `alarm_control_panel.home`; Auslöser „Home-Assistant-Entität geändert“,
  neuer Zustand `armed_away`; Aktion: die Lampen von Gladys ausschalten und
  dir eine Nachricht senden.
- **Gute Nacht**: um 23 Uhr Aktion „Home-Assistant-Skript ausführen“
  `script.good_night`, danach schließt Gladys ihre eigenen Rollläden.

## Fehlerbehebung

| Statusmeldung                               | Was tun                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Gib die Adresse und ein Zugriffstoken ein   | Fülle beide Felder der Konfiguration aus.                                                      |
| Die Adresse von Home Assistant ist ungültig | Gib `http://IP:8123` (oder `https://…`) ein, ohne Benutzername oder Passwort.                  |
| Home Assistant lehnt das Zugriffstoken ab   | Erstelle ein neues Token in deinem Profil, Reiter Sicherheit, und füge es ein.                 |
| Home Assistant ist nicht erreichbar         | Prüfe die Adresse von der Gladys-Maschine aus (nicht `localhost`) und ob Home Assistant läuft. |
| „kein Administrator“ im Verbindungstest     | Erstelle das Token mit einem Administratorkonto, um Geräte und Bereiche zu erhalten.           |
| Ein Gerät fehlt                             | Prüfe gewählte Typen und Bereiche oder trage die Entität unter „Trotzdem importieren“ ein.     |

Wenn Home Assistant neu startet, werden seine Geräte in Gladys „nicht
erreichbar“; die Integration verbindet sich innerhalb von Sekunden bis zu
einer Minute neu und sendet die inzwischen geänderten Werte. Ein Gerät, dessen
Entitäten in Home Assistant alle nicht verfügbar sind, wird ebenfalls als
nicht erreichbar angezeigt. Die Protokolle der Integration (Gladys,
Integrationsseite) geben die Details.

## Grenzen

- Home Assistant bleibt für die Geräte zuständig: Lass es laufen.
- Nicht importiert: Alarmanlagen, Sauger, Kameras, Ventile, Luftbefeuchter,
  Warmwasserbereiter, Sirenen, Zahlen und Auswahllisten, Text- und
  Aufzählungssensoren, Lamellenneigung, Thermostat-Voreinstellungen und
  Lüftermodi. Der Verbindungstest listet die ausgelassenen Typen auf; beobachte
  sie mit dem Auslöser „Entität geändert“ und steuere sie mit der Szenenaktion
  „Home-Assistant-Aktion aufrufen“.
- Die Funktionsnamen werden beim Hinzufügen des Geräts in Gladys festgelegt:
  Ein später in Home Assistant geänderter Name erscheint im unter Entdecken
  angebotenen Namen, nicht im bereits hinzugefügten Gerät.
- Die Kennungen hängen vom Token ab: Das eines Administrators ergibt ein
  Gladys-Gerät pro Home-Assistant-Gerät, ein anderes ein Gerät pro Entität.
  Ein Wechsel bietet die Geräte unter Entdecken neu an: Behalte dieselbe Art
  von Token.
- Szenenereignisse sind auf 120 pro Minute begrenzt: Ein sehr gesprächiger
  Ereignistyp wird darüber hinaus gekappt, mit einer Zeile im Protokoll.

## Datenschutz

Alles bleibt in deinem lokalen Netzwerk: Die Integration spricht nur mit
deinem Home Assistant, über dessen WebSocket-API. Das Token wird von Gladys als
Geheimnis gespeichert und nie in die Protokolle geschrieben. Home Assistant ist
ein Projekt der Open Home Foundation; diese Integration ist weder mit ihr noch
mit Nabu Casa verbunden.
