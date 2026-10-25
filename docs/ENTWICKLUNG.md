# Entwicklung – Aufbau, Konventionen, Schnittstellen

Für einen technisch interessierten Nachfolger. Diese Datei beschreibt, **wie der Code gebaut ist** und **welche
Funktion wofür zuständig ist**. Fachliche Regeln stehen im Datenmodell (`docs/daten/`, Lies-mich im xlsx) und in
`docs/PHASE0_Konzept.md`.

## 1. Werkzeuge

| Befehl | Was passiert |
|---|---|
| `npm run schema` | erzeugt `src/lib/schema.js` und `src/lib/startbelegung.js` aus `docs/daten/*.csv` |
| `npm run check` | Syntax, gemeinsamer globaler Namensraum, HTML-Skripte, Kopfkommentare, Scopes (`tools/check.js`) |
| `npm test` | alle Tests unter `test/` (Node, keine Abhängigkeiten) |
| `npm run push` | check + test + `clasp push` |
| `npm run vorschau` | `vorschau.html` – Oberfläche lokal im Browser, mit synthetischen Daten und Stub für `google.script.run` (Mobil-Sichtprüfung) |

Node ≥ 20. Es gibt **keine** npm-Abhängigkeiten und **keinen** Build-Schritt: Der Code in `src/` ist genau der
Code, der im Apps-Script-Editor steht.

## 2. Datenmodell als Daten

- Maßgeblich sind die CSV-Dateien in `docs/daten/` (`tabellen.csv`, `feldkatalog.csv`, `auswahllisten.csv`,
  `startbelegung/*.csv`). Das xlsx ist der historische Ausgangspunkt (`tools/xlsx_export.py`).
- Jede Spalte hat eine **Sichtklasse**: `intern` (Name, Nummer, Status, IDs, `version`), `kontakt` (Anschrift,
  Telefon, Geburtsdatum …), `finanz` (Konto, Beitragsbezug, Sollstellung), `hochsensibel` (Qualifikation/FZ),
  `verwaltung` (Benutzer, Protokoll, Löschsperren, DSGVO-Vorgänge). Die Rollenmatrix (`src/lib/rechte.js`)
  ordnet Rollen Sichtklassen zu.
- Spalten werden **immer über den Namen** in Zeile 1 gefunden, nie über die Position.

## 3. Laufzeit-Konventionen (Apps Script)

1. **Ein globales Objekt je Datei** (Namensraum), z. B. `var DB = (function () { … return {…}; })();`.
   Keine weiteren Top-Level-Namen außer öffentlichen API-/Trigger-Funktionen.
2. **Kein Dienstaufruf auf oberster Ebene** (SpreadsheetApp, CacheService …), nur in Funktionen. Die
   Ladereihenfolge der Dateien ist in Apps Script nicht garantiert; `npm run check` erzwingt das.
3. **Öffentlich aufrufbar** (`google.script.run`) sind nur Top-Level-Funktionen **ohne** `_` am Ende. Jede beginnt
   mit `Api.ausfuehren(name, aktion, fn)`, das die Rolle prüft (Sicherheitsregel A2). Alle anderen Funktionen
   liegen in Namensräumen oder enden auf `_`.
4. **Keine IDs von Dateien/Tabs vom Client** (A3). Die Datenbank-ID steht in der Script Property `DB_ID`.
5. **Fachlogik ohne Apps-Script-Dienste** in `src/lib/` (in Node testbar). Dienste nur in den Dateien direkt
   unter `src/`.
6. **Fehler an den Client generisch** (A9): nur Fachmeldungen, die wir selbst formulieren, plus eine Fehler-Nr.
   Details nur in `console.error` (Stackdriver).
7. **Schreiben nur unter Sperre** (`DB.mitSperre`, A7) und immer mit Protokolleintrag (A10).

## 4. Werte-Darstellung

| Typ im Feldkatalog | im Sheet | im Code / beim Client |
|---|---|---|
| `Datum` | Seriennummer, Format `dd.MM.yyyy` | `"JJJJ-MM-TT"` (String) |
| `Zeitpunkt` | Seriennummer, Format `dd.MM.yyyy HH:mm` | `"JJJJ-MM-TTThh:mm:ss"` (Ortszeit Europe/Berlin) |
| `ja/nein` | Text `ja` / `nein` | `true` / `false` |
| `Ganzzahl`, `FK` | Zahl | `number` |
| `Dezimal` | Zahl, Format `#,##0.00` | `number` (Euro, 2 Nachkommastellen) |
| `Text`, `Langtext`, `Auswahl` | Text (Spaltenformat `@` für Text) | `string` |
| leere Zelle | leer | `null` |

Gelesen wird über die Sheets-API mit `UNFORMATTED_VALUE` / `SERIAL_NUMBER`. Dadurch sind Datumswerte
zeitzonenunabhängige Zahlen. Geschrieben werden Seriennummern; das Spaltenformat sorgt für die Anzeige.
Lesend sind die Konverter tolerant (z. B. `"17.08.2026"` als Text).

## 5. Schnittstellen der Namensräume

### `Schema` (`src/lib/schema.js`, erzeugt)
`Schema.TABELLEN[tab] = { gruppe, idSpalte, eindeutig: [[spalte,…],…], spalten: [{name, typ, pflicht, liste, sicht}] }`,
`Schema.LISTEN[liste] = [werte]`.

### `Startbelegung` (`src/lib/startbelegung.js`, erzeugt)
`Startbelegung[tab] = { kopf: [...], zeilen: [[...]] }` – Stammdaten-Tabs und `_Konfig`; Datum als `JJJJ-MM-TT`.

### `Werte` (`src/lib/werte.js`, rein)
- `serialZuDatum(n)` → `"JJJJ-MM-TT"`; `serialZuZeitpunkt(n)` → `"JJJJ-MM-TTThh:mm:ss"`
- `zuSerial(s)` – akzeptiert `JJJJ-MM-TT`, `JJJJ-MM-TTThh:mm(:ss)`, `TT.MM.JJJJ` → Zahl
- `zelleLesen(wert, spalte)` / `zelleSchreiben(wert, spalte)` – Konvertierung gemäß Tabelle oben
- `zeileZuObjekt(kopf, zeile, tab)` / `objektZuZeile(kopf, obj, tab)` – über Spaltennamen; unbekannte Spalten im Sheet bleiben beim Schreiben unverändert
- Texte, die mit `= + - @` beginnen, bekommen beim Schreiben ein `'` vorangestellt (Formel-Injektion), beim Lesen wird es entfernt
- `ausFormular(tab, werte)` → neues Objekt: Formulartexte typgerecht (`'3'` → 3, `'1.234,50'` → 1234.5, `''` → null,
  `'ja'`/`'nein'` → true/false, `'TT.MM.JJJJ'` → `'JJJJ-MM-TT'`); unpassende Werte bleiben stehen, `pruefe` meldet sie
- `pruefe(tab, obj, {teilweise})` → `[ {feld, meldung} ]` (Pflicht, Typ, Auswahlliste; `auto`-Felder werden ignoriert)
- `diff(tab, alt, neu)` → `[ {feld, alt, neu} ]` (ohne `version`/`geaendert_*`)

### `DB` (`src/Datenzugriff.js`)
- `lese(tabs)` → `{ [tab]: [obj] }` – **ein** `Sheets.Spreadsheets.Values.batchGet` für alle Tabs
- `mitSperre(fn)` – Script-Lock (Wartezeit `_Konfig.sperre_wartezeit_ms`), sonst `Fehler.fachlich('… später erneut …')`
- `einfuegen(tab, obj, ktx)` → neues Objekt (ID aus `_Konfig.next_id_<Tab>`, `version = 1`, `geaendert_*`). Nur in `mitSperre`.
- `aktualisieren(tab, id, aenderungen, erwarteteVersion, ktx)` → `{ alt, neu, diff }`; bei Versionskonflikt `Fehler.konflikt(aktuellerDatensatz)`. Nur in `mitSperre`.
- `neueId(tab)` – Zähler in `_Konfig` (nur in `mitSperre`)
- `zaehler()` → `{ sheets: n }` Zahl der Tabellenzugriffe seit Ausführungsbeginn; `zaehlerZuruecksetzen()`; `zaehle(n)` für Module mit eigenem Blattzugriff
- `blatt(tab)` → Sheet-Objekt; `anhaengen(blatt, zeilen, letzte?)` – ein `setValues` unter die letzte Zeile, vergrößert das Raster bei Bedarf (neue Tabs haben nur 1000 Zeilen)
- **Massenschreiben** (nur in `mitSperre`, feste Zahl an Tabellenzugriffen – gemessen 16 für `einfuegenViele` und 6 für
  `aktualisiereViele`, gleich bei 5 wie bei 500 Datensätzen, jeweils inkl. Öffnen/flush):
  - `einfuegenViele(tab, objekte, ktx)` → gespeicherte Objekte; ein Lesen (Eindeutigkeit), ID-Block aus `_Konfig`,
    ein Schreibzugriff; Feldfehler mit Feldliste und „Eintrag n:“
  - `aktualisiereViele(tab, [{ id, aenderungen, version }], ktx)` → `[{ alt, neu, diff }]`; `version` null = keine
    Versionsprüfung (nur Systemläufe); erster Konflikt → `Fehler.konflikt`, dann wird nichts geschrieben; geschrieben
    werden zusammenhängende Läufe (bei > 10 verstreuten Läufen ein Block, unveränderte Zeilen darin mit Formelschutz)
  - `entfernen(tab, id | [ids])` → Anzahl; nur Löschkonzept/technische Bereinigung; `zeilenEntfernen(blatt, [zeilennummern])`
    (zusammenhängende Zeilen mit einem `deleteRows`)
- Eindeutigkeit: Sind **alle** Schlüsselfelder eines Datensatzes leer (z. B. Überweisungskonto ohne Mandatsreferenz),
  wird die Gruppe nicht geprüft; bei teilweise leeren Gruppen gilt leer = leer.
- `jetzt()` → `"JJJJ-MM-TTThh:mm:ss"` in der Zeitzone des Skripts

### `Konfig` (`src/Konfig.js`)
`wert(schluessel)`, `alle()` (aus CacheService, 10 min), `vergessen()` (Cache leeren nach Änderung),
`setze(schluessel, wert, beschreibung?)` (nur in `DB.mitSperre`; legt fehlende Schlüssel an, liefert den alten Wert).

### `Rechte` (`src/lib/rechte.js`, rein)
- `ROLLEN`, `AKTIONEN`, `MATRIX[rolle] = { sicht: [klassen], aktionen: [..], zeilen: 'alle'|'abteilung'|'jugend' }`
- `kontext(benutzerZeilen, email)` → `null` oder `{ email, name, rollen, abteilungen, sicht, aktionen, zeilen }` (Vereinigung aller aktiven Zeilen dieser E-Mail, V3)
- `darf(ktx, aktion)`; `sichtbareSpalten(ktx, tab)`; `schneide(ktx, tab, obj)` (Feldschnitt)

### `Zugriff` (`src/Zugriff.js`)
- `pruefe(aktion)` → ktx; liest E-Mail aus `Session.getActiveUser()`, `Benutzer` (Cache 5 min), wirft `Fehler.keinZugriff()`; Abweisungen werden protokolliert
- `nurFunktionskonto()` – für Setup/Trigger: aktiver Nutzer = Eigentümer, sonst `Fehler.keinZugriff()`

### `Fehler` und `Api` (`src/Fehler.js`, `src/Api.js`)
- `Fehler.fachlich(meldung)`, `Fehler.konflikt(aktuell)`, `Fehler.keinZugriff()` erzeugen markierte Fehler
- `Api.ausfuehren(name, aktion, fn)` → `{ ok: true, daten, messung: { server_ms, sheets } }` oder
  `{ ok: false, fehler: { art: 'fachlich'|'konflikt'|'zugriff'|'intern', meldung, nr, aktuell? }, messung }`

### `Protokoll` (`src/Protokoll.js`)
`schreibe(ktx, eintraege)` – `eintraege = [{ aktion, tabelle, datensatz_id, feld?, alt_wert?, neu_wert?, kommentar? }]`,
ein einziger Schreibzugriff; `protokoll_id` fortlaufend. `ausDiff(tab, id, diff)` → Einträge.

### `Messung` (`src/Messung.js`)
`start(name)` → Handle; `ende(handle, {ok, cache, rollen})` → `{ server_ms, sheets }` und Puffer im Cache;
`schreibePuffer()` (Trigger, stündlich) → `_Messung`; `auswertung()` → Median/P90 je Funktion.

### Öffentliche Funktionen (`src/Einstieg.js`)
`doGet(e)`, `apiStart()`, `apiPing()`, `apiMessungen()`, `apiClientMessungen(liste)`; für den Eigentümer im Editor:
`setup()`, `triggerEinrichten()`; Trigger: `messungSchreiben()`.

### Client (`src/client/`)
`index.html` (Gerüst), `stil.html`, `app.html`. Startdaten kommen als `<script type="application/json" id="startdaten">`.
`rufe(name, ...args)` → Promise, misst die Zeit je Aufruf (Auftragspunkt 8).

## 6. Ausbau ab Phase 3 – Verträge für Fachmodule

### Dateien je Bereich
| Ebene | Ort | Inhalt |
|---|---|---|
| Fachlogik (rein, testbar) | `src/lib/<thema>.js` | z. B. `Mitgliedschaft`, `Beitrag`, `Sepa`, `Ehrung`, `Blsv`, `Fristen`, `Loeschung`, `Pruefregeln`, `Snapshot`-Kern |
| Servermodul | `src/modul/<Bereich>.js` | Namensraum je Bereich; liest/schreibt über `DB`, protokolliert, pflegt den Snapshot |
| Öffentliche API | `src/api/<Bereich>.js` | nur Top-Level-Funktionen `api<Bereich><Aktion>(…)`, jede = `return Api.ausfuehren('<name>', '<aktion>', function (ktx) { … })` |
| Ansicht | `src/client/ansicht_<bereich>.html` | `App.registriere(…)`, nutzt nur `App.*` aus `client/kern` |

### `Mitgliedschaft` (`src/lib/mitgliedschaft.js`, rein)
`alter`, `alterImJahr`, `laeuft`, `zeitraeumeVon`, `laufenderZeitraum`, `status`, `mitgliedSeit`, `gekuendigt`,
`mitgliedsjahre(zeitraeume, stichtag, modus, stichtagModus)`, `funktionsjahre`, `istJugend`, `laufendeFunktionen`,
`volleMonate`, `volleJahre`, `plusMonate`, `plusTage`.

### Snapshot (`src/lib/snapshot.js` rein, `src/Snapshot.js`, `src/Cache.js`)
- **Basis** (nur Server, im CacheService, gzip + Teilstücke ≤ 100 KB, Generationszähler): Rohzeilen der Tabs
  `Mitglied, Mitgliedschaftszeitraum, Abteilung, Abteilungszugehoerigkeit, Funktionsart, Funktion, Beitragsart,
  Beitragsgemeinschaft, Beitragskonto, Sollstellung, Qualifikationsart, Qualifikation, Ehrungsregel, Ehrung, Einwilligung`
  plus benötigte `_Konfig`-Werte. **Ohne** IBAN/BIC im Klartext (nur `iban_maskiert`, `iban_ok`). Nicht in der Basis:
  `Benutzer, _Konfig (roh), _Protokoll, _Messung, Betroffenenanfrage, Aufnahmeantrag, Aufbewahrungsfrist, Statistik_Jahr`
  (werden bei Bedarf einzeln geladen).
- **Client-Snapshot** = `Snapshot.fuer(ktx)`: rollenbeschnitten (Zeilen + Felder), Listen in Kleinschreibung:
  `mitglieder` (inkl. abgeleiteter Felder `status_abgeleitet, mitglied_seit, alter, jugend, gekuendigt_zum,
  abteilungen` [laufende abteilung_ids], `funktionen_laufend` [funktionsart_ids], `fz_ampel`), `zeitraeume`,
  `zugehoerigkeiten`, `funktionen`, `abteilungen`, `funktionsarten`, `beitragsarten`, `ehrungsregeln`,
  `qualifikationsarten`, `ehrungen`, `einwilligungen` und nur mit Sichtklasse `finanz`: `konten`, `gemeinschaften`,
  `sollstellungen`; nur mit `hochsensibel`: `qualifikationen` (bei Abteilungsleitern nur Personen mit laufender
  Funktion in der eigenen Abteilung). Gesperrte (`verarbeitung_eingeschraenkt`) und anonymisierte Mitglieder nur für
  Rollen mit Sichtklasse `verwaltung`.
- `Snapshot.schreibe(ktx, aenderungen)` mit `aenderungen = [{ tab, neu: zeile } | { tab, entfernt: id }]` – nur
  innerhalb `DB.mitSperre`, aktualisiert die Basis (write-through) und liefert die Client-Antwort
  `{ aktualisiert: { liste: [datensaetze] }, entfernt: { liste: [ids] } }` (inkl. neu abgeleiteter Mitglieder).
- `Snapshot.pruefeMitglied(ktx, mitgliedId)` wirft `Fehler.keinZugriff()`, wenn die Person für ktx nicht sichtbar ist
  (Zeilenschutz bei Schreibzugriffen, z. B. Abteilungsleiter).
- `Snapshot.verwerfen()` – Cache ungültig machen (z. B. nach Setup, Massenänderung).
- **Bereiche und Spaltenform:** `apiStart()` liefert nur den Bereich `kern`. `finanzen` (konten, gemeinschaften,
  sollstellungen) und `historie` (zeitraeume, einwilligungen) holt der Browser einmal je Sitzung über
  `App.daten.lade('finanzen')` → `apiSnapshot(['finanzen'])`. Übertragen wird in Spaltenform
  `{ bereiche, listen: { name: { k: [schlüssel], z: [[werte]] } } }` (`SnapshotKern.packe`), der Browser packt in
  `App.daten.setze` wieder aus. Gemessen mit 1.200 synthetischen Mitgliedern (Rolle Mitgliederverwalter): Start
  638 KB (gzip 82 KB) statt 2,8 MB für alles; finanzen 452 KB, historie 323 KB.
- Ansichten, die einen Bereich brauchen: `App.daten.lade('finanzen').then(function () { … zeichnen … })`.

### Schreibmuster in Servermodulen
```js
function apiMitgliedSpeichern(id, version, werte) {
  return Api.ausfuehren('apiMitgliedSpeichern', 'mitglied_bearbeiten', function (ktx) {
    return DB.mitSperre(function () {
      Snapshot.pruefeMitglied(ktx, id);
      var felder = Rechte.erlaubteSchreibfelder(ktx, 'Mitglied', werte);   // nur Felder sichtbarer Sichtklassen
      var r = DB.aktualisieren('Mitglied', id, felder, version, ktx);
      Protokoll.schreibe(ktx, Protokoll.ausDiff('Mitglied', id, r.diff));
      return Snapshot.schreibe(ktx, [{ tab: 'Mitglied', neu: r.neu }]);
    });
  });
}
```
Feldfehler: `throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld, meldung }])` – der Browser zeigt sie am Feld.

### Beitritts-Import (`src/lib/beitritt.js` rein, `src/modul/Beitritt.js`, `src/api/Beitritt.js`, `client/ansicht_beitritt`)
Nachfolger des Access-Moduls „BeitrittsXmlImportieren“. Der Browser liest die Dateien (`/dataroot/Daten16`, Elementnamen
mit `_x0020_` entschlüsselt) und schickt je Antrag `{ datei, personen: [{ Feld: 'Text' }] }` an `apiBeitrittVorschau` bzw.
`apiBeitrittImportieren(antraege, entscheidungen)` (Recht `mitglied_anlegen` und zusätzlich `konto_bearbeiten`;
Grenzen 50 Anträge × 20 Personen). `Beitritt.plane` nutzt `Migration.migriere` mit vorläufigen IDs/Nummern (Person 1 =
Zahler) und liefert Personen, Konto (IBAN maskiert), Gemeinschaft, Dubletten und Warnungen; `Beitritt.fuerBrowser` entfernt
die internen Zeilen. Der Import läuft je Antrag in einem eigenen `DB.mitSperre` mit frisch gelesenen Daten: Nummern aus
`Beitritt.nummernkreis` (max + 1, mindestens `_Konfig.mitgliedsnummer_naechste`, danach fortgeschrieben), Mandatsreferenz
`TSV-<Jahr>-<Nr. Person 1>`, Prüfung erwartet = angelegt; bei jedem Fehler werden die neuen Zeilen per `DB.entfernen`
zurückgenommen (Änderungen an Bestandszeilen – Wiedereintritt – erst nach allen Prüfungen). Protokoll ohne Klartext-IBAN.

### Wartung (`src/modul/Wartung.js`, Trigger in `src/api/Wartung.js`)
`wartungNachts()` (täglich gegen 02:00, nur Funktionskonto) erledigt nacheinander, jeder Schritt für sich abgesichert:
`status` (Mitglied.status an `Mitgliedschaft.status` angleichen), `fristen` (FZ-Fristen, `NachweiseModul.fristenAktualisieren`),
`loeschbarkeit` (`loeschbar_ab`/`sperre_grund` ausgetretener Mitglieder nach `Aufbewahrungsfrist` – nichts wird gelöscht),
`protokoll` (am Monatsersten Bereinigung nach Frist), `messung` (`_Messung` älter als 3 Monate entfernen), `snapshot`
(verwerfen und neu bauen). Ergebnis als ein Sammeleintrag im `_Protokoll` (Tabelle „Wartung“). Laufzeitschutz: nach
4,5 Minuten Abbruch, Fortschritt in der Script Property `wartung_fortschritt`, einmaliger Folge-Trigger
`wartungFortsetzen` nach einer Minute; erledigte Schritte laufen am selben Tag nicht doppelt.

## 7. Erweiterungspunkte im Browser

Ansichten können sich in andere Ansichten einhängen, ohne deren Datei zu ändern (`client/kern`):

| Ort | Erwartet | Wirkung |
|---|---|---|
| `mitglied.reiter` | `{ id, titel, sicht?, aktion?, zeichne(ziel, mitglied) }` | zusätzlicher Reiter im Mitglied-Detail |
| `mitglied.knoepfe` | `function (mitglied) → Node\|null` | zusätzliche Knöpfe im Kopf des Mitglied-Details |
| `mitglied.formular` | `function (formular, ziel, modus, mitglied)` | läuft nach Aufbau des Formulars „Bearbeiten“ (`modus = 'bearbeiten'`) bzw. „Neues Mitglied“ (`'neu'`) |
| `konto.abschnitt` | `function (ziel, konto)` | zusätzlicher Abschnitt am Ende des Konto-Details |

Registrieren: `App.erweitere(ort, def)`. Fehler einer Erweiterung werden abgefangen und stören die Ansicht nicht.
