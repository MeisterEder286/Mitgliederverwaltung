# Migration Daten16 → neue Mitgliederverwaltung

Einmalige Übernahme des Altbestands aus Access. Läuft **lokal auf deinem Rechner** (Node ≥ 20). Die Echtdaten
verlassen den Rechner nicht und kommen nie ins Repository. Erst das fertige Ergebnis wird ins (private) Google Sheet eingefügt.

| Baustein | Datei |
|---|---|
| Regeln (rein, getestet) | `src/lib/migration.js` (`Migration.migriere`) |
| Kommandozeile | `tools/migration-lokal.js` |
| Synthetischer Testbestand (alles erfunden) | `tools/daten16-synthetisch.js` → `test/daten/daten16/` |
| Tests | `test/migration.test.js` |

## 1. Export aus Access

1. Tabelle `Daten16` öffnen → Externe Daten → Exportieren → Textdatei, **mit Feldnamen in der ersten Zeile**,
   Trennzeichen Semikolon (Komma geht auch). Zeichensatz egal (UTF-8 oder Windows-1252 werden erkannt).
2. Ebenso `AustritteAb2010` exportieren (frühere Mitgliedschaften für Wiedereintritte).
3. Beide Dateien in einen Ordner **außerhalb** des Repositorys legen (oder nach `migration/eingabe/` – steht in `.gitignore`).

## 2. Testlauf (zuerst immer mit Testkopie, Sicherheitsregel C2)

```
node tools/migration-lokal.js pfad/daten16.csv --austritte pfad/austritte.csv --beitragsjahr 2026 --pauschalen 180,150
```

| Option | Bedeutung |
|---|---|
| `--austritte` | AustritteAb2010-Export (optional) |
| `--ziel` | Ausgabeordner, Standard `migration/ausgabe/` (in `.gitignore`) |
| `--beitragsjahr` | Jahr für die NG-Sollstellungen (Standard `_Konfig.beitragsjahr`) |
| `--stichtag` | Stichtag für Status/Alter (Standard heute) |
| `--pauschalen` | Beträge, die eine Familien-/Ehegattenpauschale sind (Rückfrage M8). Ohne Angabe gilt: Betrag größer als die höchste Einzel-Beitragsart |
| `--muster` | Schema der Mandatsreferenz, Standard `TSV-{jahr}-{mitglnr}` (Platzhalter `{jahr}`, `{mitglnr}`, `{id}`) |

Ergebnis im Zielordner:
- `<Tab>.tsv` – zum Einfügen ins Sheet (empfohlen), `<Tab>.csv` – dasselbe zum Ansehen in Excel
- `pruefbericht.html` – im Browser öffnen: Annahmen, Prüfliste mit Filter, Konto-Cluster
- `pruefbericht.csv` – Prüfliste zum Abhaken in Excel
- `konfig_werte.txt` – Werte für `_Konfig`

**Der Zielordner enthält Echtdaten: nicht weitergeben, nach Abschluss löschen.**

## 3. Prüfbericht abarbeiten

Erst die **Fehler**, dann die **Warnungen**. Korrekturen am besten **in Access** (bzw. im Export) vornehmen und den Lauf
wiederholen – so bleibt der Ablauf reproduzierbar. Was sich in Access nicht abbilden lässt (z. B. Gemeinschaft von Hand),
nach dem Import in der Oberfläche erledigen.

| Art | Bedeutung / was tun |
|---|---|
| `zahler_unbekannt` | „Zahler“ zeigt auf eine Mitgliedsnummer, die es nicht gibt → Person zahlt vorläufig selbst; Zahler klären |
| `zahler_ausgetreten` | Zahler ist ausgetreten/verstorben, Abhängige aktiv (Waisen, Übergabe §4) → neuer Zahler + Mandat, Selbstzahler oder Austritt |
| `zahler_kette` | Zahler zahlt selbst über jemand anderen → direkten Zahler eintragen |
| `iban_abweichend` | Im Cluster steht bei einer Person eine andere IBAN als beim Zahler → klären, wer wirklich zahlt |
| `iban_ungueltig` / `iban_aus_blz` | IBAN-Prüfziffer falsch / IBAN aus BLZ+Konto errechnet (Sonderregeln mancher Banken!) → bestätigen lassen |
| `cluster_mischfall` | Pauschale und Einzelbeiträge passen nicht zusammen (mehrere Pauschalen, Pauschale ohne Mitzahler, Mitzahler ohne Pauschale) → Gemeinschaft/Beitragsart von Hand |
| `beitrag_unbekannt` / `beitragsart_mehrdeutig` / `ohne_beitrag` | Beitragsart nicht eindeutig → nach Import in der Oberfläche zuordnen |
| `eintritt_fehlt` | ohne Eintrittsdatum kein Mitgliedschaftszeitraum → nachtragen |
| `zeitraum`, `zeitraum_ueberlappt` | Austritt vor Eintritt bzw. überlappende Zeiträume mit AustritteAb2010 |
| `dublette` | gleicher Nachname + Geburtsdatum → prüfen, ob dieselbe Person (Wiedereintritt) |
| `abteilung_unbekannt` | Abteilungsname nicht zuordenbar → Alias in `optionen.abteilungAlias` oder Abteilung anlegen |
| `hausnummer`, `plz`, `geschlecht`, `email`, `anrede`, `datum_*` | Datenqualität, unkritisch für den Start (Geschlecht/Geburtsdatum aber für die BLSV-Meldung nötig) |
| `spalte_fehlt` / `spalte_unbekannt` | Spaltenname im Export weicht ab → Alias in `SPALTEN` (Kopf von `src/lib/migration.js`) ergänzen |

## 4. Import ins Google Sheet

Voraussetzung: Sheet und Skript nach `docs/BETRIEB.md` eingerichtet, **`setup` ausgeführt** (legt Tabs, Spaltenformate
und Auswahllisten an). Tabelleneinstellung **Gebietsschema Deutschland** (Datei → Einstellungen), damit TT.MM.JJJJ als
Datum erkannt wird. **[A]**

1. In den Tabs `Mitglied`, `Mitgliedschaftszeitraum`, `Abteilungszugehoerigkeit`, `Beitragskonto`,
   `Beitragsgemeinschaft`, `Sollstellung` alle Zeilen unterhalb der Kopfzeile löschen (Beispieldaten).
2. Je Tab: `<Tab>.tsv` in einem Texteditor öffnen, **ab der zweiten Zeile** alles markieren und kopieren, im Sheet
   Zelle **A2** anklicken und mit **Strg+Umschalt+V** (nur Werte) einfügen. Die Spaltenreihenfolge der Datei entspricht
   der Kopfzeile, die `setup` angelegt hat. Grund für diesen Weg: Textspalten (Mitgliedsnummer, PLZ, Telefon, IBAN) sind
   vom Setup als Text formatiert – beim Einfügen bleiben führende Nullen erhalten. **[?]** Beim Datei-Import mit
   „Text in Zahlen umwandeln“ gingen sie verloren; daher nicht den Import-Dialog verwenden. Bitte in der Testkopie prüfen:
   Nach dem Einfügen muss z. B. Mitgliedsnummer `0873` weiterhin `0873` lauten.
3. Tab `_Konfig`: die Werte aus `konfig_werte.txt` eintragen (`next_id_*`, `mitgliedsnummer_naechste`).
4. In der Oberfläche: **Verwaltung → System → „Snapshot neu aufbauen“**.
5. **Verwaltung → Datenqualität** prüfen; die Befunde decken sich weitgehend mit dem Prüfbericht.

## 5. Abgleich mit Access (vor dem Umstieg)

- [ ] Anzahl Mitglieder gesamt / aktiv / ausgetreten gegen die Access-Abfragen
- [ ] Anzahl je Abteilung (Berichte → Abteilungen) gegen Access
- [ ] Anzahl Lastschrift-Konten und Summe der Sollbeträge (Finanzen → Sollstellungen → Probelauf für das nächste Jahr)
      gegen den letzten Access-Einzug
- [ ] Stichproben: 10 Mitglieder (darunter Familien mit Pauschale, „Felix-Fälle“, Wiedereintritte) Feld für Feld
- [ ] Mandatsreferenzen: Stichprobe gegen die zuletzt eingereichte SEPA-Datei (siehe Annahme unten)
- [ ] Ausgabeordner und Exportdateien löschen

## 6. Annahmen, die vor dem Echtlauf zu bestätigen sind

| Nr. | Annahme | Warum wichtig |
|---|---|---|
| M2 / X3 | **Mandatsreferenz** = `TSV-{Eintrittsjahr des Zahlers}-{MitglNr des Zahlers}`, **Mandatsdatum** = Eintrittsdatum des Zahlers. Daten16 hat keine Mandatsspalten. | Weicht die Referenz von der bisher an die Bank gemeldeten ab, gilt das Mandat als neu (FRST / neue Unterschrift). Schema aus dem bisherigen Access-SEPA-Export ablesen und mit `--muster` setzen. |
| M8 | Pauschalbeträge (z. B. 180 € Familie, 150 € Ehepaar) | Ohne `--pauschalen` werden Pauschalen nur geschätzt. |
| M3 | `Zahlung` enthält nur „NG“ → Sollstellung des Beitragsjahres mit Status ruecklastschrift | beschlossen 10/2026 |
| M5 | „Status Abteilung 1“: Werte „aktiv“/„passiv“ (auch „A“/„P“); Abteilung 2–4 → aktiv | Status gibt es im Altbestand nur für Abteilung 1 |
| – | Versandart: E-Mail, wenn eine Adresse vorhanden ist, sonst Post | kein Feld in Daten16 |
| – | Nicht übernommen (keine Quelle): Ehrenmitglied, Sterbedatum, „Adresse ungültig“, gesetzliche Vertretung, Funktionen, Einwilligungen, Qualifikationen | nach dem Import in der Oberfläche pflegen |

Rückfragen aus Phase 0, Stand: M1 (Format „Zahler“) **geklärt** – MitglNr; M3 **geklärt**; M7 **geklärt** – „Personalien“ ist nur
ein Formular; M2, M4 (Klartext oder Code in „Abteilung n“ – beides wird über Namen/Aliase zugeordnet), M5, M6
(Spalten von AustritteAb2010 – tolerant: ID/MitglNr, EinDat, AusDat, Grund) und M8 **offen**.
