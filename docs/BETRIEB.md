# Betrieb – Einrichtung, Deployment, Pflege

Schritt für Schritt für den Eigentümer des Funktionskontos. Alle Schritte im Funktionskonto des Vereins,
**nie** im persönlichen Konto (Sicherheitsregel C1).

## 1. Einmalige Einrichtung

1. **Ablage:** In der geteilten Ablage einen Ordner anlegen, auf den **nur das Funktionskonto** Zugriff hat
   (A4). Darin ein leeres Google Sheet „Mitgliederverwaltung TSV – Datenbank“ anlegen. Nicht teilen.
2. **Skriptprojekt:** script.google.com → Neues Projekt (eigenständig, nicht an das Sheet gebunden) im
   Funktionskonto. Projekt-ID in `.clasp.json` eintragen (Vorlage `.clasp.json.beispiel`).
3. **Code übertragen:** lokal `npm run push` (prüft, testet, überträgt `src/`).
4. **Script Property** setzen: Projekteinstellungen → Script-Eigenschaften → `DB_ID` = ID des Sheets
   (aus der URL zwischen `/d/` und `/edit`). Die ID steht bewusst nicht im Code (A3/A8).
5. **Erweiterter Dienst:** Google Sheets API ist über `appsscript.json` aktiviert. Beim ersten Ausführen
   die Berechtigungen bestätigen. Angefordert werden nur: Tabellen, E-Mail-Adresse des Nutzers, Trigger und
   **E-Mail senden** (`script.send_mail` – nur Senden, kein Lesen des Postfachs; für „Schreiben → E-Mails senden“).
   Nach einem Update, das diesen Scope neu hinzufügt, muss das Funktionskonto die Berechtigung einmal im Editor neu
   bestätigen (eine beliebige Funktion ausführen), sonst schlägt der Versand fehl.
   E-Mail-Versand vor dem Einschalten (`mail_aktiv = ja`) in der Testumgebung mit `mail_test_an` prüfen.
6. **Setup:** Im Editor die Funktion `setup` ausführen. Sie legt alle Tabs mit Kopfzeilen, Formaten,
   Auswahllisten und der Startbelegung an und gibt einen Bericht aus. Mehrfaches Ausführen ist unschädlich
   (bestehende Werte werden nie überschrieben). Meldet der Bericht „ACHTUNG Zeitzone“, in der Tabelle unter
   Datei → Einstellungen die Zeitzone des Skripts (`Europe/Berlin`) einstellen.
7. **Startbelegung prüfen:** In den Tabs `Beitragsart`, `Ehrungsregel`, `Funktionsart`, `Qualifikationsart`,
   `Aufbewahrungsfrist`, `_Konfig` alle mit BEISPIEL/PRÜFEN markierten Werte anpassen.
8. **Benutzer:** Im Tab `Benutzer` je Rollenzuweisung eine Zeile (E-Mail, Rolle, bei Abteilungsleitern
   `abteilung_id`, `aktiv = ja`). Wer zwei Rollen hat, bekommt zwei Zeilen.
9. **Trigger:** Im Editor `triggerEinrichten` ausführen. Es entfernt vorhandene Trigger derselben Funktionen und legt an:
   - `messungSchreiben` – stündlich: gepufferte Messwerte nach `_Messung`
   - `wartungNachts` – täglich gegen 02:00 (Europe/Berlin): Status-Cache nachziehen, FZ-Fristen, Löschbarkeit
     ausgetretener Mitglieder, am Monatsersten Protokoll-Bereinigung, Messwerte älter als 3 Monate entfernen,
     Snapshot neu bauen. Bricht ein Lauf an der Laufzeitgrenze ab, setzt ein einmaliger Trigger `wartungFortsetzen`
     ihn nach einer Minute fort (legt sich selbst an und räumt sich selbst weg).
   - `snapshotWarmhalten` – stündlich; wirkt nur bei `_Konfig.cache_warmhalten = ja` (Standard). Frischt den
     Einstellungs-Cache auf und baut den Snapshot neu aus der Tabelle, wenn er fehlt oder sein letzter Neubau aus der
     Tabelle älter als 4 Stunden ist – so trifft niemand auf einen langsamen Kaltstart, und direkte Eingriffe in die
     Tabelle sind spätestens nach rund 5 Stunden im Snapshot.
   - `protokollNachtragen` – alle 5 Minuten: überträgt Protokolleinträge, die noch in den Script Properties warten
     (`protwarte:*`). Normalerweise erledigt das der Browser direkt nach dem Speichern (`apiNachlauf`); der Trigger
     ist das Sicherheitsnetz. Diese Properties nicht von Hand löschen. Mit `_Konfig.protokoll_nachgelagert = nein`
     wird wie früher sofort beim Speichern ins Protokoll geschrieben.
   Ergebnis jedes Wartungslaufs: ein Eintrag im `_Protokoll` (Tabelle „Wartung“), Details im Ausführungsprotokoll.
   `cache_warmhalten` kann jederzeit umgeschaltet werden, ohne `triggerEinrichten` erneut auszuführen.
10. **Deployment:** Bereitstellen → Neue Bereitstellung → Web-App, „Ausführen als: **Ich**“, „Zugriff:
    **Jeder in [Domain]**“. Die Deployment-ID und die exec-URL im zentralen Register (`docs/REGISTER.md`)
    eintragen.
11. **Homepage:** WordPress-Seite `/verwaltung` mit Redirect-Block auf die exec-URL (Sicherheitsregel B3).
12. **Online-Aufnahmeanträge (optional):** Eingangstabelle anlegen, Script Property `EINGANG_ID` setzen, im Editor
    `eingangEinrichten` ausführen – Details und Spaltenvertrag in `docs/EINGANG.md`.

## 2. Updates

- Lokal ändern → `npm run push` → im Editor **Bereitstellungen verwalten → bestehende Bereitstellung
  bearbeiten → Neue Version**. Nie ein neues Deployment anlegen, sonst ändert sich die URL (A1/B6).
- Alternativ per clasp: `clasp deploy -i <DEPLOYMENT_ID> -d "Beschreibung"`.
- **Nach jedem Update mit neuen Tabs oder Spalten** (z. B. 10/2026: `Vorlage`, `Dokument`, `Anschreiben`, Ausbildungsfelder; 11/2026: Spalten `Beitragsart.max_erwachsene`, `max_kinder`, `kinder_bis_alter`,
  `ausbildung_bis_alter` und `Beitragsgemeinschaft.beitragsart_id` – danach bei Familien-/Ehegattenbeitrag in den
  Beitragsarten die Regeln eintragen und in Finanzen → Gemeinschaften jeder Gemeinschaft ihren Tarif zuordnen)
  im Editor `setup` ausführen – legt Fehlendes an und füllt neue Stammdaten-Tabs, ändert nichts Bestehendes.
- Datenmodell ändern: CSV in `docs/daten/` anpassen → `npm run schema` → `npm run push` → `setup` ausführen
  (hängt neue Spalten hinten an, löscht nie etwas).

## 3. Testumgebung (C2)

Eigenes Sheet mit synthetischen Daten, eigenes Skriptprojekt (gleicher Code, andere `DB_ID`), eigenes
Deployment. Änderungen immer zuerst dort.

**Mit einem erfundenen Verein (~1.200 Mitglieder) füllen**

1. **Einmalig:** Die Test-Tabelle muss **TEST** im Namen tragen (z. B. „Mitgliederverwaltung TEST“). Im
   **Test**-Skriptprojekt unter Projekteinstellungen → Script-Eigenschaften `TESTUMGEBUNG` = `ja` setzen.
   **Nie im Produktiv-Projekt.** Ohne diesen Schalter gibt es die Funktion nicht: Der Knopf erscheint nicht, und der
   Server lehnt jeden Aufruf ab. Über die WebApp lässt sich der Schalter nicht setzen.
2. **Datei erzeugen** (lokal im Repository, Node ≥ 20):

   ```
   npm run testdaten
   ```

   Ergebnis: `testdaten/ausgabe/testdaten.json` (ca. 1,2 MB, in `.gitignore`). Alles ist erfunden, Adressen enden
   auf `@example.de`. Optionen: `--mitglieder 1200`, `--seed 1` (gleicher Seed → gleiche Daten), `--stichtag JJJJ-MM-TT`
   (Standard heute), `--ziel <Ordner>`.
3. **Einspielen:** In der **Test**-WebApp als Mitgliederverwalter **Verwaltung → System → „Testdaten einspielen“**,
   die Datei auswählen, „Einspielen“ bestätigen. Der Browser schickt die Zeilen in Blöcken, danach werden die Zähler in
   `_Konfig` gesetzt und der Snapshot neu gebaut (1–3 Minuten).

Ersetzt werden Mitglieder, Zeiträume, Abteilungszugehörigkeiten, Funktionen, Konten, Gemeinschaften, Sollstellungen
mehrerer Jahre, Qualifikationen, Ehrungen und Einwilligungen. **Benutzer**, Stammdaten (aus `setup`), übrige
Einstellungen, Protokoll, Vorlagen und Dokumente bleiben. Spalten werden nach Namen zugeordnet. Die Reihenfolge in der
Tabelle ist also egal (bei älteren Tabellen hängt `setup` neue Spalten hinten an). Fehlt eine Spalte, wird nichts
geändert, dann `setup` ausführen bzw. Export und WebApp auf denselben Stand bringen.
Bricht das Einspielen mittendrin ab, einfach neu starten. Vor E-Mail-Tests `mail_test_an` setzen.

**Von Hand (ohne WebApp):** Derselbe Befehl schreibt auch je Tab eine `<Tab>.tsv`, dazu `konfig_werte.txt` und
`LIESMICH.txt`. Je Tab alle Zeilen unter der Kopfzeile löschen, Inhalt ab Zeile 2 in A2 mit **Strg+Umschalt+V**
einfügen (Gebietsschema Deutschland). Das klappt nur, wenn die Spaltenreihenfolge der Tabelle der Kopfzeile der `.tsv`
entspricht; bei älteren Tabellen mit hinten angehängten Spalten den Weg über die WebApp nehmen. Werte aus `konfig_werte.txt` in `_Konfig` eintragen, dann „Snapshot neu
aufbauen“. Mit `--benutzer adresse@example.org` entsteht zusätzlich `Benutzer.tsv` (Mitgliederverwalter). Die
erfundenen Benutzerkonten des Generators werden nie exportiert, und beim Einspielen über die WebApp bleibt der Tab
Benutzer immer unberührt.
Alternativ testet `tools/daten16-synthetisch.js` → `tools/migration-lokal.js` den Migrationsweg (`docs/MIGRATION.md`).

## 4. Messwerte

Rolle mit `messung_lesen` (Vorstand, Mitgliederverwalter) sieht in der Oberfläche „Messwerte“: Anzahl,
Median und P90 je Server-Funktion (Server-ms, Tabellenzugriffe) und die im Browser gemessene Gesamtzeit.
Rohdaten im Tab `_Messung` (keine Personendaten).

Einzelaufrufe mit Aufschlüsselung (Sperre, Lesen, Schreiben, Log, Ansicht …): dort „Messmodus ein“ bzw. in der
Browser-Konsole `App.messen(true)` / `App.messbericht()`; Erstaufruf mit `?messen=1` an der WebApp-URL. Sonden zum
Apps-Script-Verhalten laufen im Editor nur gegen eine Kopie der Datenbank (Script Property `SONDE_DB_ID`).
Anleitung und Ergebnisse: `docs/LEISTUNG.md`.

## 5. Bekannte Grenzen (C4) – zu prüfen, Stand meines Wissens

| Grenze | Wert | Bedeutung hier |
|---|---|---|
| Laufzeit je Ausführung | 6 min | Setup und Migration bleiben deutlich darunter |
| CacheService | 100 KB je Wert, max. 6 h | Snapshot wird in Teilstücke zerlegt (Phase 3) |
| Script Properties | ca. 9 KB je Wert | `DB_ID`, optional `EINGANG_ID` |
| Trigger-Laufzeit gesamt | je nach Kontotyp, für Nonprofits prüfen | stündlicher Messwert-Trigger: Sekunden pro Lauf; nächtliche Wartung: Sekunden bis wenige Minuten, Abbruch nach 4,5 min mit Fortsetzung |
| Gleichzeitige Ausführungen | weiß ich nicht genau | wenige Nutzer, unkritisch |
| E-Mail-Kontingent (MailApp) | je nach Kontotyp, Stand meines Wissens ca. 100 Empfänger/Tag (Consumer) bis 1.500 (Workspace) – prüfen | Versand prüft vorher `MailApp.getRemainingDailyQuota()`; reicht es nicht, wird nichts gesendet. Zusätzlich `_Konfig.mail_max_je_lauf` (Standard 100) |
