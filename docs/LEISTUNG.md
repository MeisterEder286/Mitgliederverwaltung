# Leistung: Messwerk, Sonden, Ist-Stand

Ziel: kürzere Antwortzeiten beim Laden und Speichern, ohne Sicherheit oder Nebenläufigkeit zu schwächen.
Arbeitsweise: **erst messen, dann bauen.** Jede Zahl in diesem Dokument hat eine Herkunft:

| Kennzeichen | Bedeutung |
|---|---|
| **gemessen (live)** | in Google gemessen, Median aus ≥ 6 Läufen, Datum und Stand dabei |
| **gezählt (lokal)** | exakte Zahl der Blattzugriffe aus `tools/messen-lokal.js` (Doubles, 1.200 synthetische Mitglieder) |
| **Referenz** | im Referenzprojekt gemessen – hier **nicht** nachgeprüft |
| **erwartet** | Schätzung, nicht gemessen |
| **[?]** | Annahme über Apps-Script-Verhalten, offen bis zur Sonde |

Stand 11/2026: Messwerk, Sonden und lokale Zählung sind gebaut und getestet. **Live gemessen ist noch nichts.**
Abschnitt 5 sagt, was zu messen ist; Abschnitt 6 enthält die Vermutungen, die die Messung bestätigen oder
widerlegen soll.

## 1. Messwerk

### Server (`src/Messung.js`, Hülle in `src/Datenzugriff.js`)

Jede Ausführung hat einen Messlauf. Abschnitte bilden einen Stapel. `ms` ist **exklusiv** (ohne verschachtelte
Abschnitte), `inkl` ist **inklusiv**. Die Summe aller exklusiven Zeiten plus `rest_ms` ergibt `gesamt_ms`.

| Abschnitt | Was |
|---|---|
| `pruefkette` | `Zugriff.pruefe`: Identität, Benutzer-Tabelle, Rechte |
| `handler` | Fachfunktion (ohne die Abschnitte darunter) |
| `sperre` | `waitLock` + `releaseLock`; zusätzlich `sperre_gehalten_ms` = Zeit unter der Sperre |
| `vorladen` | `Sheets.Spreadsheets.Values.batchGet` (DB.lese) |
| `lesen` / `meta` | SpreadsheetApp `getValues`/`getValue` bzw. `getLastRow`, `getLastColumn`, `getMaxRows`, `getDataRange` |
| `schreiben` | `setValues`, `setValue`, `appendRow`, `insertRowsAfter`, `deleteRow(s)` |
| `flush` | `SpreadsheetApp.flush()` (Festschreiben) |
| `oeffnen` | `openById`, `getSheetByName` |
| `log` | `Protokoll.schreibe` (eigene Blattzugriffe zählen bei lesen/schreiben, die Spur nennt `in: log`) |
| `ansicht` | Rollenschnitt, Packen, Snapshot-Write-through (`Snapshot.fuerClient`/`schreibe`), JSON der Antwort |
| `cache` | CacheService: Snapshot-Teile, Benutzer, Konfig |
| `messung` | Messpuffer im CacheService (get + put je Aufruf) |
| `laden_ms` | Auswerten aller Skriptdateien bis zum Start der Funktion (`src/0_Messbeginn.js`). [?] Gilt nur, wenn Apps Script diese Datei zuerst lädt. Sonst ist der Wert zu klein. |
| `seite_ms` | nur `doGet`: Auswerten der HTML-Vorlage (alle `client/*.html`) |

Zähler: `lesungen` (batchGet + SpreadsheetApp), `meta`, `schreibungen`, `flushes`, `oeffnen`, `cache`,
`zellen_gelesen`, `zellen_geschrieben`, `tabellen` (gelesene Tabs) und `spur` (jeder Zugriff mit Zeitpunkt, Art,
Methode, Tab, Zellen, ms, umgebendem Abschnitt; höchstens 200).

**Wer bekommt den Bericht?** Er wird nur ausgeliefert, wenn ein Aufruf ihn ausdrücklich anfordert **und** die Rolle
`messung_lesen` hat (Vorstand, Mitgliederverwalter). Das prüft `Api.ausfuehren` nach der Zugriffsprüfung. Abgewiesene
Aufrufer bekommen nie einen Bericht. Der Bericht enthält keine E-Mail-Adressen und keine Zellinhalte. Er nennt nur
Tab-Namen, Methoden und Zahlen. Er wird als `_mess` an die Antwort gehängt.

- `apiMessen(name, args)` ruft die öffentliche Funktion `name` auf und fordert den Bericht an. Erlaubt sind nur
  `api…`-Funktionen, die ohnehin öffentlich sind. Jede prüft ihre eigene Aktion. Es entsteht also keine neue
  Angriffsfläche. Die Anforderung gilt für genau einen Aufruf.
- `doGet` mit `?messen=1` an der `/exec`-URL bettet den Bericht als `<script type="application/json" id="mess-start">`
  in die Seite ein.
- Die bisherige Kurzmessung `messung: { server_ms, sheets }` an jeder Antwort und der Puffer nach `_Messung` bleiben
  unverändert.

### Browser (`src/client/kern.html`, Ansicht „Messwerte“)

In der Browser-Konsole der WebApp. Achtung: Die WebApp läuft in einem iframe, deshalb in den DevTools den Kontext
`userCodeAppPanel` wählen.

```
App.messen(true)        // Messmodus an (gilt bis zum Schließen des Tabs); alle Aufrufe laufen über apiMessen
…Aktionen ausführen…
App.messbericht()       // console.table: je Aufruf browser_ms, server_ms, differenz_ms, laden_ms, Abschnitte, Zähler
App.messbericht(3)      // Spur des 4. Aufrufs (jeder einzelne Blattzugriff)
App.messberichtLeeren()
App.messen(false)
```

Dasselbe ohne Konsole: Verwaltung → Messwerte → „Messmodus ein“. Dort steht auch eine Tabelle.

**Zeit aufteilen** (je Aufruf):

```
browser_ms                          gemessen im Browser um google.script.run herum
 ├─ differenz_ms = browser − server Netz + Ausführungshülle von Apps Script (Start der Ausführung, Antwort zurück)
 └─ server_ms (= gesamt_ms)         innerhalb von Api.ausfuehren
     ├─ laden_ms                    davor: Skriptdateien auswerten (gehört eigentlich zur Differenz, wird aber hier sichtbar)
     └─ Abschnitte …
```

Für den Erstaufruf (`doGet`) ist `browser_ms` die Zeit vom Start des inneren Dokuments bis „bedienbar“. Die Zeit bis
zum Ende von `doGet` fehlt darin. Sie steht in den DevTools unter „Network“ als Dauer der `/exec`-Anfrage
(Gesamtzeit Erstaufruf = diese Dauer + `browser_ms`).

## 2. Ist-Stand der Architektur (aus dem Code)

Schon vorhanden:

- Lesen über **ein** `batchGet` (`UNFORMATTED_VALUE` + `SERIAL_NUMBER`) und ein Vorrat je Ausführung (`DB.lese`).
- Startdaten werden in `doGet` eingebettet (`_Konfig.snapshot_einbetten = ja`). Es gibt also keinen zweiten Aufruf.
- Der Browser hält einen rollenbeschnittenen Snapshot und arbeitet lokal. Schreibantworten liefern die geänderten
  Datensätze (`App.daten.uebernehme`).
- Reine Lesungen schreiben keine Protokollzeile. Ausnahmen sind Exportvermerke (gewollt), Abweisungen und Fehler.

Unterschiede zum Referenzprojekt:

- **Ausführungsübergreifende Caches** im Script-Cache:
  - Snapshot-Basis aller Fachtabellen, 6 h, gzip in Teilstücken
  - Benutzer und Rollen, 5 min
  - `_Konfig`, 10 min

  `Snapshot.pruefeMitglied` (Zeilenschutz beim Schreiben) entscheidet auf Grundlage der **gecachten** Basis. Die
  Revision (`version`) wird dagegen frisch unter der Sperre geprüft (`DB.aktualisieren`). Die Vorgabe sagt: „nie
  Identität, Rollen oder Revisionen ausführungsübergreifend cachen“. Das ist eine dokumentierte frühere Entscheidung
  (ENTSCHEIDUNGEN 10/2026, „ein Basis-Snapshot im Cache“). **Offen, zu entscheiden** (siehe 6.4).
- **Schreiben** läuft über SpreadsheetApp, Zelle für Zelle bzw. Zeile für Zeile, abwechselnd mit Lesungen. Es gibt
  einen `flush` am Ende der Sperre.

## 3. Sonden (`src/Sonden.js`)

Klären die Befunde des Referenzprojekts für **diese** Datei. Laufen nur gegen eine **Kopie**:

1. Datenbank-Datei in Drive kopieren (Datei → Kopie erstellen).
2. Projekteinstellungen → Script Properties: `SONDE_DB_ID` = ID der Kopie. Ist sie gleich `DB_ID`, bricht jede Sonde
   ab.
3. Die WebApp einmal öffnen, damit der Snapshot im Cache liegt (für `sondePreise`).
4. Im Editor **jede Sonde in einer eigenen Ausführung** starten. Danach die Ausgabe aus dem Ausführungsprotokoll hier
   eintragen. Jede Reihe liefert den Median aus 7 Läufen sowie Min/Max.

Die Sonden legen in der Kopie die Tabs `_Sonde1…3` an. `sondeWerte` hängt zwei Zeilen an `Mitglied` (der Kopie) an
und löscht sie wieder.

| Sonde | Frage | Referenz | hier (live) |
|---|---|---|---|
| `sondeLesen` | erste/weitere SpreadsheetApp-Lesung je Tab; 1 Zelle vs. ganzer Tab | ~300 / ~200 ms, zellenunabhängig | |
| | batchGet 1 / 5 / alle Tabs | alle 15 ≈ 350 ms | |
| | `FORMATTED_VALUE` = `getDisplayValues()`? | gleich bis auf Leerstellen am Ende | |
| `sondeSchreiben` | A: lesen–schreiben–lesen je Blatt (3 Blätter) | 1,2 s je Blatt | |
| | B: erst lesen, dann schreiben + ein flush | 0,7 s | |
| | C: batchGet + values.batchUpdate | 0,35–0,45 s | |
| `sondeSichtbarkeit` | sieht SpreadsheetApp eine API-Schreibung derselben Ausführung? batchGet? nach flush? | SpreadsheetApp nein (wenn schon gelesen), batchGet ja | |
| `sondeWerte` | `USER_ENTERED` ergibt dasselbe Blattbild wie `setValues` (inkl. Formelschutz, PLZ, „1,5“, Datumstexte)? | gleich | |
| `sondePreise` | openById, getSheetByName, tryLock+release, Cache get/put, flush leer, Session, Property, Snapshot laden/packen | 150 / – / 200 / 130 / 70 ms | |

## 4. Ist-Zählung je Aktion (gezählt, lokal)

`node tools/messen-lokal.js --markdown`, Rolle Mitgliederverwalter, 1.200 synthetische Mitglieder. Jede Aktion läuft
in einem frisch geladenen Projekt, wie eine neue Ausführung.

Legende:

- `batchget`: Aufrufe von `batchGet`
- `lesen_ssa`: Wert-Lesungen über SpreadsheetApp
- `meta`: `getLastRow` usw.
- `tabellen`: per batchGet gelesene Tabs
- `tabellen_ssa`: über SpreadsheetApp berührte Tabs
- `cache`: CacheService-Aufrufe ohne den Messpuffer (der kostet je Aufruf zusätzlich get + put)
- `muster`: Reihenfolge der Zugriffe; V = batchGet, L = Lesen über SpreadsheetApp, S = Schreiben, F = flush; Meta
  weggelassen

### warm (Snapshot, Benutzer, Konfig im Script-Cache)

| aktion | batchget | lesen_ssa | meta | schreib | flush | tabellen_ssa | cache | muster |
|---|---|---|---|---|---|---|---|---|
| apiPing | 0 | 0 | 0 | 0 | 0 | 0 | 2 | |
| apiStart / apiSnapshot / Finanzen-Übersicht / Auswertungen / Notizen offen | 0 | 0 | 0 | 0 | 0 | 0 | 4 | |
| apiDatenschutzProtokoll | 1 | 0 | 0 | 0 | 0 | 0 | 2 | V |
| apiMitgliederExport (Exportvermerk) | 0 | 1 | 3 | 1 | 1 | 1 | 2 | LSF |
| apiMitgliedSpeichern | 0 | 4 | 5 | 2 | 1 | 2 | 8 | LLLSLSF |
| apiMitgliedAdresseUngueltig | 0 | 4 | 5 | 2 | 1 | 2 | 8 | LLLSLSF |
| apiMitgliedAnlegen | 3 | 11 | 13 | 8 | 1 | 5 | 10 | LSVLLSLSLLSLSVLLSLSLSFV |
| apiFunktionEintragen | 0 | 4 | 6 | 3 | 1 | 3 | 8 | LLSLSLSF |
| apiNotizSpeichern | 0 | 4 | 6 | 3 | 1 | 3 | 8 | LLSLSLSF |
| apiFinanzenKontoSpeichern | 1 | 4 | 5 | 2 | 1 | 2 | 6 | VLLLSLSF |

### kalt (Script-Cache leer: erster Aufruf nach Ablauf, nach Wartung oder nach Setup)

| aktion | batchget | Tabs je batchGet | lesen_ssa | schreib | muster |
|---|---|---|---|---|---|
| apiPing, apiStart, apiSnapshot, Leseaktionen | 1 | 21 (155.703 Zellen) | 0 | 0 | V |
| apiMitgliedSpeichern | **3** | 21–22 | 4 | 2 | **VVV**LLLSLSF |
| apiMitgliedAnlegen | **6** | 21–22 | 11 | 8 | VVVLSVLLSLSLLSLSVLLSLSLSFV |
| apiFinanzenKontoSpeichern | 4 | 21–22 | 4 | 2 | VVVLLLSLSVF |

CPU-Hinweis aus Node (nur Größenordnung, **nicht** auf Apps Script übertragbar): Bei `apiMitgliedSpeichern` (warm)
entfallen ~90 % der Serverzeit auf den Abschnitt `ansicht`. Das ist der Snapshot-Write-through: die gzip-Basis
(~900 KB im Cache) laden, entpacken, ändern, packen und wieder ablegen. `apiStart` (warm) verbringt seine Zeit
ebenfalls fast ganz in `ansicht`.

## 5. Live-Messung (offen)

Vorgehen: Stand einspielen (`npm run push`, Deployment aktualisieren). Als Mitgliederverwalter die WebApp mit
`?messen=1` öffnen. In der Konsole `App.messen(true)` setzen. Jede Aktion **≥ 6-mal** ausführen und den Median
eintragen. Cache-Zustand vermerken: warm = vorher schon benutzt, kalt = nach „Cache leeren“ in Verwaltung → System.

| Aktion | browser_ms | server_ms | Differenz | laden | Sperre | Vorladen | Lesen+Meta | Prüfkette | Log | Schreiben | flush | Ansicht | Cache | Messpuffer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| doGet (Network-Dauer + bedienbar) | | | | | | | | | | | | | | |
| apiPing | | | | | | | | | | | | | | |
| apiSnapshot(finanzen) | | | | | | | | | | | | | | |
| Reiterwechsel mit Serveraufruf (z. B. Finanzen-Übersicht) | | | | | | | | | | | | | | |
| apiMitgliedSpeichern | | | | | | | | | | | | | | |
| apiMitgliedAnlegen | | | | | | | | | | | | | | |
| apiFinanzenKontoSpeichern | | | | | | | | | | | | | | |

Erst mit diesen Zahlen wird entschieden, wo der Hebel ist (Abschnitt 6).

## 6. Vermutungen und Plan (erwartet, nicht gemessen)

### 6.1 Schreibpfad: Mischzugriff (gezählt; Kosten: Referenz)

Jede Speicherung liest und schreibt abwechselnd über SpreadsheetApp, in 2–5 Tabellen: `LLLSLSF`. Laut Referenz kostet
dieses Muster ~1,2 s je Blatt. „Ein batchGet + ein values.batchUpdate“ kostet 0,35–0,45 s. **Erwartet:** größter
Hebel beim Speichern, wenn `sondeSchreiben` die Referenz bestätigt.

Umbau (nur nach Sonde):

1. Sperre zuerst, dann **ein** batchGet aller nötigen Tabs ins Memo, inklusive Kopf und Spalte A von `_Protokoll`.
2. Alle Schreibungen in einen Puffer (Zellen ändern, Zeilen anhängen, Log, `_Konfig`-Zähler). Am Ende **ein**
   `values.batchUpdate` (`USER_ENTERED`). Scheitert der Handler, wird der Puffer verworfen.
3. Danach jeden SpreadsheetApp-Zugriff in derselben Ausführung hart sperren.

Ansatzpunkt ist die Hülle in `Datenzugriff.js`. Über sie laufen schon heute alle Blattzugriffe, auch die direkten in
`Konfig.setze`, `Protokoll`, `Mitglieder.naechsteMitgliedsnummer`, `Verwaltung`, `Datenschutz` und `Wartung`. Die
Fachmodule müssten dafür kaum angefasst werden. Voraussetzung: `sondeWerte` zeigt keine Abweichung zwischen
`setValues` und `USER_ENTERED`.

### 6.2 Kalter Schreibpfad liest bis zu 6× alle Tabs (gezählt)

`VVV`: Die Zugriffsprüfung liest Benutzer und die Snapshot-Tabs. `DB.mitSperre` leert den Vorrat. Unter der Sperre
wird erneut gelesen, danach noch einmal für die Basis. Jedes batchGet holt 21 Tabs mit ~156.000 Zellen.
**Erwartet:** fällt mit 6.1 weg (ein batchGet unter der Sperre). Betrifft nur kalte Aufrufe.

### 6.3 Snapshot-Write-through je Speicherung (Node-CPU deutet darauf; live prüfen: `ansicht` + `cache`)

Je Speicherung geschieht unter der Sperre:

- `Cache.lade` (get + getAll), gunzip, JSON
- die Änderung anwenden
- JSON, gzip, `putAll` + `put`

Das verlängert auch die Zeit, die die Sperre gehalten wird (`sperre_gehalten_ms`). Mögliche Abhilfe, nur nach
Messung: die Basis aus dem Memo der Lesung unter der Sperre bauen (6.1 liest die Tabs ohnehin) und den Cache außerhalb
der Sperre bzw. nur verwerfen statt neu schreiben.

### 6.4 Ausführungsübergreifende Rechte- und Zeilencaches (Sicherheit, Entscheidung nötig)

Benutzer und Rollen (5 min) sowie der Zeilenschutz aus der Snapshot-Basis (bis 6 h) kommen aus dem Script-Cache. Laut
Vorgabe ist das ein Sicherheitsloch:

- Eine entzogene Rolle wirkt bis zu 5 min weiter, wenn die Änderung nicht über die App lief (`Zugriff.vergessen`).
- Ein Zeilenschutz kann auf veraltetem Stand entscheiden.

Mit 6.1 lässt sich beides **ohne Mehrkosten** aus der einen Lesung unter der Sperre prüfen. Für Lesungen kostet es
ein batchGet mit der Benutzer-Tabelle. Vorschlag: zusammen mit 6.1 umstellen. Erst nach Freigabe, weil es eine
dokumentierte Entscheidung ändert.

### 6.5 Fixkosten je Aufruf (live prüfen: Abschnitt `messung`, `cache`)

- Messpuffer: bei **jedem** Aufruf drei CacheService-Zugriffe (gezählt): Konfig-get (`messung_puffer_max`), dann
  Puffer-get und Puffer-put. Referenz für get + put: ~130 ms. Abhilfe, wenn bestätigt: nur jeden n-ten Aufruf puffern
  oder ganz abschalten (`_Konfig`).
- `openById` bei jedem Schreibaufruf (Referenz ~150 ms). Fällt weg, wenn alles über die API läuft (6.1).
- Weitere Konfig-Cache-gets: `sperre_wartezeit_ms` (jede Schreibung), `snapshot_einbetten` (doGet), Startdaten. Lassen
  sich mit der ersten Lesung zusammenlegen.

### 6.6 Oberfläche

- Lokaler Datenbestand und Schreibantworten mit Datensätzen gibt es schon. Ein Anzeige-Cache für Aggregat-Lesungen
  (CACHEBAR/NEUTRAL/schreibend) lohnt nur für Aktionen mit Serveraufruf beim Reiterwechsel. Welche das sind, zeigt die
  Live-Messung.
- Sofortanzeige mit Warteschlange (optimistic update) erst nach dem Serverteil. Dabei die Revision des Klicks senden.

### Verworfen (aus dem Referenzprojekt übernommen; nicht erneut prüfen ohne neuen Anlass)

| Ansatz | Grund |
|---|---|
| fetch an doPost statt google.script.run | kein belegter Gewinn |
| Schreibpuffer in PropertiesService + Trigger | Prüfkette verlöre ihre Grundlage |
| Sheets-API direkt aus dem Browser | Rechte lägen im Client |
| ausführungsübergreifender Zeilen-/Rechte-Cache | Sicherheitsloch (betrifft hier den Bestand, siehe 6.4) |
| Datei aufteilen (Log/Archiv auslagern) | lohnt nicht, sobald über die API geschrieben wird |

## 7. Tests

- `test/messwerk.test.js`: Abschnittsrechnung, `_mess` nur auf Anforderung und nur mit `messung_lesen`, keine
  E-Mail-Adressen und keine Zellinhalte, `apiMessen` nur für `api…`-Funktionen, `doGet?messen=1`, Hülle ändert keine
  Zugriffszahl.
- `test/sonden.test.js`: Abbruch ohne Kopie und bei echter DB, nur Funktionskonto, Ablauf aller Sonden, Testzeilen
  werden entfernt.
- `test/ui/messwerk.ui.test.js`: `App.messen`/`App.messzeilen` im echten Browser, mit und ohne `messung_lesen`.
- Doubles: `values.batchUpdate`, Teilbereiche im batchGet und `getDisplayValues` ergänzt (`test/hilfe/gas-fakes.js`).
