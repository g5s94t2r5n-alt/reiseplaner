# Reiseplaner

Private Web-App zur Planung von Roadtrips, Backpacking- und Campingreisen mit mehreren Stops.

Du gibst Land oder Region, Start (und Ziel oder Rundreise), Zeitraum, Reiseart, Tempo, maximale Fahrzeit pro Tag und Interessen an. Die App

- **schlägt Stops vor**: kuratierte Ziele aus Wikivoyage, gewichtet nach Interessen und Umweg,
- **plant die Route** mit echten Fahrzeiten (OSRM) und fügt bei zu langen Etappen **Zwischenstopps** ein,
- **empfiehlt die Aufenthaltsdauer** pro Stop mit Begründung und verteilt die Nächte auf dein Budget,
- **zeigt Unterkünfte** passend zur Reiseart: Stellplätze und Campingplätze (mit Ausstattung wie Strom, Duschen, Entsorgung), Hostels, Pensionen oder Hotels. Unterkünfte, die im Reisezeitraum laut OpenStreetMap geschlossen haben, werden markiert,
- **zeigt pro Stop „Entdecken“**: Sehenswürdigkeiten und Aktivitäten aus Wikivoyage (mit Öffnungszeiten, Preisen, Karte) und sehenswerte Orte in der Nähe aus der deutschen Wikipedia (mit Fotos), sortiert nach Bekanntheit, dazu der deutsche Wikivoyage-Reiseführer,
- **„Unterwegs wissen“**: pro Land Fahrseite, Währung, Notruf, Maut/Vignette sowie Feiertage und Schulferien während deiner Reisetage,
- **verlinkt Buchungsseiten** mit vorausgefüllter Suche (Ort, Reisedaten, Personenzahl): Airbnb für alle Reisearten, Booking.com für Backpacker und Auto sowie Google Maps. Hat eine Unterkunft keine Website in den offenen Daten, gibt es einen „Website suchen“-Link. Daten von diesen Seiten liest die App nicht (keine offenen Schnittstellen),
- **berücksichtigt Wildcampen / Freistehen** (Camper und Zelt): Regeln pro Land entlang der Route, Hinweise an jedem Übernachtungsort sowie kostenlose Plätze (Schutzhütten, Naturlagerplätze, Wohnmobil-Parkplätze und – wo erlaubt oder geduldet – Rastplätze),
- **prüft Saison und Wetter**: typisches Wetter pro Stop für deine Reisetage (bzw. Vorhersage kurz vor Abreise), Tageslicht, beste Reisezeit für die Route sowie Hinweise auf Frost, Schnee, Regen, Hitze, Polarnacht und Passstraßen im Winter.

Alles ist kostenlos, es gibt keine API-Keys und kein Konto. Trips werden lokal im Browser gespeichert (IndexedDB).

## Online-Version

**https://g5s94t2r5n-alt.github.io/reiseplaner/**

Aufs Handy holen: Seite öffnen, dann
- **iPhone (Safari):** Teilen-Symbol → „Zum Home-Bildschirm“
- **Android (Chrome):** Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“

Trips werden pro Gerät im Browser gespeichert (kein Konto, keine Synchronisierung). **Übertragen:** Im Trip auf „📱 Aufs Handy / Teilen“ tippen und den QR-Code mit der Handy-Kamera scannen, oder den Link verschicken. Der Link enthält nur Einstellungen, Orte und Nächte (komprimiert im Teil nach `#`, wird nie an einen Server geschickt). Route, Infos und Unterkünfte baut das Zielgerät neu auf. Ein erneut geteilter Trip kann den vorhandenen ersetzen oder als Kopie gespeichert werden. Bereits geladene Trips lassen sich auch offline öffnen. Für Karten, Routen und Unterkünfte braucht die App Internet.

Jeder Push auf `main` wird automatisch getestet, gebaut und veröffentlicht (`.github/workflows/deploy.yml`).

## Starten

Node.js liegt in `~/.local/node`. Einmalig im Terminal (oder dauerhaft in `~/.zshrc`):

```bash
export PATH="$HOME/.local/node/bin:$PATH"
```

Dann:

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Unit-Tests (Vitest)
npm run build      # Typecheck + Produktions-Build nach dist/
```

## Datenquellen (alle kostenlos)

| Zweck | Dienst | Hinweis |
|---|---|---|
| Ortssuche | Photon (komoot) | Autovervollständigung, OSM-basiert |
| Wikidata-ID, Rückwärtssuche | Nominatim | max. 1 Anfrage/s, wird gedrosselt |
| Stop-Kandidaten, Sehenswürdigkeiten, Unterkunftstipps | Wikivoyage (englisch) | Abschnitte *Cities*, *Other destinations*, *See*, *Do*, *Sleep* |
| Kurzbeschreibung + Bild | Wikipedia (deutsch, sonst englisch) | REST-Summary |
| Fahrzeit-Matrix, Route, Reihenfolge | OSRM-Demo-Server | nur Auto; Backpacker-Zeiten = Auto × 1,4 (Schätzung) |
| Unterkünfte mit Ausstattung | Overpass (OpenStreetMap) | oft überlastet → mehrere Spiegel-Server, gestaffelt |
| Unterkünfte (schneller Fallback) | Photon mit Kategorie-Filter | nur Name/Typ/Lage |
| Klima (letzte 3 Jahre), Vorhersage (16 Tage), Geländehöhe | Open-Meteo | kostenlos für private Nutzung |
| Beliebtheit (Aufrufzahlen) | Wikimedia Pageviews (Wikivoyage, Wikipedia) | Ersatz für Bewertungen |
| Orte in der Nähe, Fotos | Wikipedia (deutsch), Geosuche | |
| Ortsart (Nationalpark, Fjord …) | Wikidata (SPARQL) | |
| Feiertage | Nager.Date | über 100 Länder |
| Schulferien | OpenHolidays | v. a. Europa, nicht alle Länder/Jahre |

API-Antworten werden in IndexedDB zwischengespeichert, damit die öffentlichen Dienste geschont werden.

## Aufbau

```
src/
  api/          Zugriff auf externe Dienste (Cache, Drosselung, Fallbacks)
  lib/          Geo-Funktionen, Wikitext-Parser
  planner/      Planungslogik (rein, getestet)
    candidates  Ziele aus Wikivoyage laden und bewerten
    select      Stop-Auswahl (Greedy-Einfügen + 2-opt) im Nächte-Budget
    nights      Aufenthaltsdauer empfehlen und Budget verteilen
    itinerary   Zwischenstopps, Tagesablauf mit Datum
    plan        Ablauf: Kandidaten → Fahrzeiten → Auswahl → Infos → Route → Nächte
    accommodation  Unterkünfte zusammenführen
    season      Klima-Statistik, Tageslicht, Hinweise, beste Reisezeit
    seasonReport  Wetter-/Höhendaten laden und pro Stop/Etappe auswerten
  data/         Wildcamping-Regeln pro Land
  components/   React-Oberfläche (Formular, Karte, Reiseplan, Unterkünfte)
  store.ts      Trips (zustand, persistiert in IndexedDB)
```

## Wie die Empfehlungen entstehen

- **Stop-Auswahl:** Kandidaten aus dem Wikivoyage-Artikel der Region sind Highlights (+3), dazu kommen Punkte für passende Interessen (Stichwörter in der Beschreibung). Ausgewählt wird nach *Bewertung² pro verbrauchtem Reisetag*. Dabei zählen der Umweg laut Fahrzeit-Matrix und die nötigen Zwischenübernachtungen mit, bis das Nächte-Budget ausgeschöpft ist.
- **Aufenthaltsdauer:** `0,5 + log2(1 + Programmpunkte) / 2,2`. Programmpunkte sind die Wikivoyage-Einträge unter *See* und *Do*, ersatzweise die Artikellänge oder OSM-Sehenswürdigkeiten. Dazu kommen Faktoren für Interessen und Tempo sowie ein Puffertag nach langer Anreise. Anschließend werden die Nächte proportional auf das Budget verteilt. Manuell gesetzte Werte bleiben dabei unverändert.

- **Saison & Wetter:** Für jeden Stop werden die Tage der letzten drei Jahre ausgewertet, die in deinen Aufenthalt fallen (±3 Tage). Gemessen wird am Straßenpunkt, an dem die Route ankommt, nicht an der Gipfel- oder Gletscher-Koordinate aus Wikivoyage. Beginnt die Reise in den nächsten ~2 Wochen, wird die Vorhersage genutzt. Die beste Reisezeit ergibt sich aus Temperatur (Ideal 17–27 °C, mit Strand-Interesse 24–32 °C), Regen- und Schneetagen. Für Etappen wird ein Höhenprofil (Open-Meteo) erstellt: Bei Gelände über 900 m und Frost oder Schnee gibt es einen Pass-Hinweis. Achtung: Tunnel werden dabei als Gelände über der Straße gemessen.

- **Öffnungszeiten von Campingplätzen:** Reihenfolge der Quellen: OSM `opening_hours` (z. B. „May-Sep“), dann OSM `seasonal` (yes/no/summer/winter), dann Monatsangaben in der Beschreibung („Open May to September“). Ohne Angabe steht „Öffnungszeiten unbekannt“ am Platz. Geschlossene Plätze rutschen ans Ende.
- **Wildcampen:** Die Regeln liegen in `src/data/wildCamping.ts`, getrennt für Zelt und Fahrzeug, mit drei Stufen: erlaubt, geduldet/eingeschränkt, verboten. Das ist eine vereinfachte Übersicht ohne Gewähr (Stand 2026). Das Land eines Ortes kommt aus der Photon-Rückwärtssuche, bei Großbritannien wird Schottland gesondert behandelt.

- **Stop-Auswahl im Detail:**
  - *Interessen:* Anteil passender Wikivoyage-Einträge (z. B. 8 von 10 Einträgen sind Wanderungen) bei den 40 vielversprechendsten Kandidaten, dazu Ortsart aus Wikidata (Nationalpark, Gebirge, Fjord, Großstadt, UNESCO …) und Stichwörter der Kurzbeschreibung. Städte zählen bei Natur/Wandern höchstens mittel. Passt ein Ort zu keinem Interesse richtig, gibt es einen Abzug.
  - *Jahreszeit:* Klima im Reisezeitraum (gleiche Tage im Vorjahr) am nächsten Straßenpunkt. Winterliche Naturziele werden abgewertet, hoch gelegene Orte mit Schnee stark (Passstraßen meist gesperrt), Strandziele bei Kühle ebenso. Auch Polarnacht und Dauerregen zählen.
  - *Keine Lückenfüller:* Orte unter 55 % der Bewertung des besten Kandidaten werden nicht gewählt. Übrige Nächte gehen an die guten Stops.
  - *Deine Kontrolle:* 📌 „Behalten“ (bleibt beim Neu-Vorschlagen), „Alternativen“ mit Tauschen (Umweg geschätzt), „Nicht mehr vorschlagen“ (auch im Karten-Popup). „Warum dieser Stop?“ zeigt die Begründung.
- **Qualität statt nur Menge:** Echte Gästebewertungen (Google, Tripadvisor, Booking) gibt es nicht kostenlos. Ersatzweise misst die App, wie viele Menschen sich für einen Ort interessieren:
  - Stop-Auswahl: + bis zu 3 Punkte nach Wikivoyage-Aufrufen, relativ zum beliebtesten Ziel der Region. Orte im Umkreis von 15 km um Start und Ziel werden nicht automatisch gewählt.
  - Aufenthaltsdauer: Bekannte Sehenswürdigkeiten (mit Wikidata-Eintrag) zählen doppelt, sehr beliebte Ziele und UNESCO-Welterbe bekommen etwas mehr Zeit.
  - Sehenswürdigkeiten: nach Wikipedia-Aufrufen sortiert. Die Aufrufe zählen nur, wenn der Wikipedia-Titel zum Namen passt (Schutz vor falschen Wikidata-Verweisen).
  - Unterkünfte: offizielle Hotelsterne aus OSM. Bei jeder Unterkunft gibt es einen Link zu den Google-Bewertungen.

## Ideen für später

- Export (PDF/GPX/Google-Maps-Link), Teilen
- Offline-Modus (PWA mit Karten-Cache)
- Echte ÖPNV-Verbindungen für Backpacker
- Optional: KI-Texte zu den Stops (kostenpflichtige API)
