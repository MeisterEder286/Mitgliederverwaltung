# Backup der Mitgliederverwaltung (eigenes Apps-Script-Projekt)

## Zweck
Legt regelmäßig eine Kopie der Datenbank-Datei (Google Sheet) in einem geschützten Ordner ab und räumt alte
Kopien auf (Sicherheitsregel C3). Der Google-Versionsverlauf schützt nicht gegen Logikfehler, die viele Zeilen
korrekt aussehend überschreiben, und nicht gegen den Verlust des Kontos.

## Warum ein eigenes Projekt?
Eine Sicherungskopie in einen Ordner zu legen und alte Kopien zu löschen braucht **Drive-Rechte**. Stünden
diese in der WebApp, hätte jede Lücke dort Zugriff auf das ganze Drive des Funktionskontos. Deshalb:
- die **WebApp** hat nur Tabellen-, E-Mail-Adress- und Trigger-Rechte (Sicherheitsregel A5),
- dieses **Backup-Projekt** hat Drive-Rechte, ist aber **keine WebApp** – niemand kann es von außen aufrufen;
  es läuft nur als Zeit-Trigger unter dem Funktionskonto.

Angeforderte Rechte (`appsscript.json`):
| Scope | wofür |
|---|---|
| `drive` | Datei kopieren, in den Backup-Ordner legen, alte Kopien in den Papierkorb, Ordnerfreigabe prüfen |
| `spreadsheets.readonly` | Wiederherstellungstest (Original und Kopie nur lesen) |
| `script.scriptapp` | Zeit-Trigger anlegen |
| `script.send_mail` | Fehlermail an das Funktionskonto |

[?] `drive.file` würde vermutlich **nicht** genügen: Es erlaubt nur Dateien, die das Skript selbst erstellt
oder geöffnet hat; die Datenbank-Datei wurde nicht von diesem Skript erstellt. Bei Zweifel ausprobieren:
Scope auf `drive.file` ändern, `backupErstellen` ausführen – scheitert `getFileById`, bleibt es bei `drive`.

## Einrichtung (einmalig, im Funktionskonto)
1. **Backup-Ordner** in der geteilten Ablage anlegen. Zugriff: nur Funktionskonto und höchstens zwei
   Vorstandspersonen (C1/C3). **Nicht** „Jeder mit dem Link“ – sonst bricht die Sicherung bewusst ab.
2. **Neues Apps-Script-Projekt** (eigenständig) im Funktionskonto anlegen, z. B. „Mitgliederverwaltung Backup“.
   Projekt-ID in `backup/.clasp.json` eintragen (Vorlage `.clasp.json.beispiel`), dann `npm run push:backup`.
3. **Script Properties** setzen (Projekteinstellungen → Script-Eigenschaften):
   | Eigenschaft | Wert |
   |---|---|
   | `DB_ID` | ID der Datenbank-Datei (wie in der WebApp) |
   | `BACKUP_ORDNER_ID` | ID des Backup-Ordners (aus der Ordner-URL) |
   | `BACKUP_AUFBEWAHRUNG_TAGE` | optional, Standard 90 |
   | `BACKUP_RHYTHMUS` | optional, `taeglich` (Standard) oder `woechentlich` |
4. Im Editor einmal **`backupErstellen`** ausführen (Berechtigungen bestätigen) und prüfen, dass die Kopie im
   Ordner liegt.
5. **`triggerEinrichten`** ausführen → Sicherung täglich (bzw. sonntags) gegen 03:15 Uhr.
6. **`wiederherstellungTest`** ausführen und den Bericht im Ausführungsprotokoll lesen (C3: „mindestens einmal
   testen“; danach z. B. jährlich und nach jeder Strukturänderung).
7. Eintrag im zentralen Register (`docs/REGISTER.md`): Projekt-Link, Ordner, Rhythmus.

## Aufbewahrung
- Alle Sicherungen der letzten `BACKUP_AUFBEWAHRUNG_TAGE` Tage bleiben.
- Älter: nur die **erste Sicherung jedes Monats**, 13 Monate lang.
- Alles andere geht in den Papierkorb (dort noch 30 Tage wiederherstellbar).
- Dateien im Ordner mit anderem Namen als „Mitgliederverwaltung Backup JJJJ-MM-TT HH-mm“ werden nie angefasst.
- Die Kopien enthalten dieselben personenbezogenen Daten wie das Original → gleicher Schutz (A4), und die
  Löschfristen gelten mittelbar: Spätestens nach 13 Monaten ist eine Kopie weg.

## Wiederherstellung im Ernstfall
Es wird **nie automatisch** zurückgespielt – ein Fehler dabei würde den aktuellen Bestand zerstören.
1. Ursache klären, WebApp-Zugang ggf. vorübergehend sperren (Benutzer deaktivieren oder Deployment deaktivieren).
2. Passende Sicherung im Backup-Ordner auswählen und **kopieren** (nicht das Original der Sicherung verwenden).
3. Kopie in den Datenbank-Ordner verschieben und umbenennen (z. B. „Mitgliederverwaltung TSV – Datenbank“).
4. In der **WebApp** (Script Properties) `DB_ID` auf die neue Datei setzen; im Editor `setup` ausführen (prüft
   Tabs und Spalten, ändert keine Daten), danach in der Oberfläche „Verwaltung → System → Snapshot neu aufbauen“.
5. Im **Backup-Projekt** `DB_ID` ebenfalls auf die neue Datei setzen.
6. Alte, defekte Datei umbenennen („… defekt JJJJ-MM-TT“) und archivieren, nicht sofort löschen.
7. Änderungen seit der Sicherung aus dem Protokoll (`_Protokoll` der defekten Datei) nachtragen.
8. Vorgang dokumentieren (wer, wann, warum).

## Kontingente (C4)
Eine Kopie eines Sheets dieser Größe dauert Sekunden; Trigger-Laufzeit und Drive-Kontingente sind bei einer
täglichen Sicherung unkritisch. Fehlermails: eine pro fehlgeschlagenem Lauf (tägliches Mail-Kontingent weit
unterschritten).
