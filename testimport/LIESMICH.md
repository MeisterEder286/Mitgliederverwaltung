# Testimport – Test-Tabelle per Skript mit dem erfundenen Verein füllen

Eigenes, kleines Apps-Script-Projekt. Es liest `testdaten.json` (aus `npm run testdaten`) aus einem Drive-Ordner
und ersetzt damit die Bewegungsdaten der **Test**-Tabelle. Kein Kopieren von Hand.

**Nur für die Testumgebung.** Das Projekt bricht ab, wenn die Zieltabelle kein „TEST“ im Namen trägt oder die Datei
nicht als synthetisch gekennzeichnet ist.

## Warum ein eigenes Projekt?

Zum Lesen aus Drive braucht es den Scope `drive.readonly`. Die WebApp hat bewusst keinen Drive-Scope (Sicherheitsregel
A5, wie bei `backup/` und `eingang/`). Test- und Produktiv-WebApp laufen mit demselben Code, deshalb steht der
Import nicht dort. Dieses Projekt ist keine WebApp, hat keine Trigger und läuft nur per Hand im Editor.

## Einmalig einrichten

1. **Test-Tabelle** nach `docs/BETRIEB.md` Abschnitt 3 anlegen. Der Name muss **TEST** enthalten, z. B.
   „Mitgliederverwaltung TEST“. In der Test-WebApp einmal `setup` ausführen.
2. **Drive-Ordner** für die Testdaten anlegen, z. B. „Testdaten Mitgliederverwaltung“. ID aus der URL
   (`…/folders/<ID>`) merken.
3. **Skriptprojekt:** script.google.com → Neues Projekt „Mitgliederverwaltung Testimport“. Projekt-ID in
   `testimport/.clasp.json` eintragen (Vorlage `.clasp.json.beispiel`), dann im Repository:

   ```
   npm run push:testimport
   ```

   Alternativ `Import.js` und `appsscript.json` von Hand in den Editor kopieren (Manifest einblenden:
   Projekteinstellungen → „appsscript.json im Editor anzeigen“).
4. **Script Properties** (Projekteinstellungen → Script-Eigenschaften):
   - `TEST_DB_ID` = ID der **Test**-Tabelle (aus der URL zwischen `/d/` und `/edit`). **Nie** die ID der
     Produktiv-Datenbank eintragen.
   - `TESTDATEN_ORDNER_ID` = ID des Drive-Ordners aus Schritt 2.

## Testdaten einspielen

1. Lokal erzeugen:

   ```
   npm run testdaten -- --benutzer deine.adresse@example.org
   ```

2. `testdaten/ausgabe/testdaten.json` in den Drive-Ordner hochladen. Liegen dort mehrere Dateien dieses Namens,
   gilt die neueste.
3. Im Editor des Testimport-Projekts **`testdatenPruefen`** ausführen. Beim ersten Mal die Berechtigungen
   bestätigen (Tabellen, Drive nur lesen). Im Ausführungsprotokoll steht je Tab „vorher → nachher“. Geschrieben wird
   dabei nichts.
4. **`testdatenImportieren`** ausführen.
5. In der Test-WebApp: **Verwaltung → System → „Snapshot neu aufbauen“**. Das leert auch die Caches für
   Einstellungen und Benutzer.

## Was passiert

| | |
|---|---|
| Ersetzt | jeder Tab, der in der Datei steht: Mitglied, Mitgliedschaftszeitraum, Abteilungszugehoerigkeit, Funktion, Beitragskonto, Beitragsgemeinschaft, Sollstellung, Qualifikation, Ehrung, Einwilligung. Benutzer nur, wenn beim Export `--benutzer` angegeben war |
| Nachgezogen | in `_Konfig`: `beitragsjahr`, `mitgliedsnummer_naechste`, `next_id_*` der importierten Tabs |
| Nie angefasst | Stammdaten aus `setup` (Abteilung, Beitragsart, Funktionsart …), übrige `_Konfig`-Werte, `_Protokoll`, `_Messung`, Vorlagen, Dokumente |
| Abbruch ohne Schreiben | Zieltabelle ohne „TEST“ im Namen, Datei nicht synthetisch, Tab fehlt, Kopfzeile passt nicht (dann Code und `setup` der Test-Umgebung auf den Stand des Exports bringen) |

Die Werte gehen unverändert (`RAW`) in die Tabelle: Datum als Seriennummer, Mitgliedsnummer mit führender Null als
Text. Das ist genau das Format, das die WebApp liest. Das Gebietsschema der Tabelle spielt dafür keine Rolle.

E-Mails: Die erfundenen Adressen enden auf `@example.de`. Vor Versandtests in `_Konfig` `mail_test_an` setzen.
