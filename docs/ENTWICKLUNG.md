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
- `jetzt()` → `"JJJJ-MM-TTThh:mm:ss"` in der Zeitzone des Skripts

### `Konfig` (`src/Konfig.js`)
`wert(schluessel)`, `alle()` (aus CacheService, 10 min), `vergessen()` (Cache leeren nach Änderung).

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
