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
   (bestehende Werte werden nie überschrieben).
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
   - `snapshotWarmhalten` – alle 5 Stunden, nur wenn `_Konfig.cache_warmhalten = ja`
   Ergebnis jedes Wartungslaufs: ein Eintrag im `_Protokoll` (Tabelle „Wartung“), Details im Ausführungsprotokoll.
   Nach Änderung von `cache_warmhalten` `triggerEinrichten` erneut ausführen.
10. **Deployment:** Bereitstellen → Neue Bereitstellung → Web-App, „Ausführen als: **Ich**“, „Zugriff:
    **Jeder in [Domain]**“. Die Deployment-ID und die exec-URL im zentralen Register (`docs/REGISTER.md`)
    eintragen.
11. **Homepage:** WordPress-Seite `/verwaltung` mit Redirect-Block auf die exec-URL (Sicherheitsregel B3).

## 2. Updates

- Lokal ändern → `npm run push` → im Editor **Bereitstellungen verwalten → bestehende Bereitstellung
  bearbeiten → Neue Version**. Nie ein neues Deployment anlegen, sonst ändert sich die URL (A1/B6).
- Alternativ per clasp: `clasp deploy -i <DEPLOYMENT_ID> -d "Beschreibung"`.
- **Nach jedem Update mit neuen Tabs oder Spalten** (z. B. 10/2026: `Vorlage`, `Dokument`, `Anschreiben`, Ausbildungsfelder)
  im Editor `setup` ausführen – legt Fehlendes an und füllt neue Stammdaten-Tabs, ändert nichts Bestehendes.
- Datenmodell ändern: CSV in `docs/daten/` anpassen → `npm run schema` → `npm run push` → `setup` ausführen
  (hängt neue Spalten hinten an, löscht nie etwas).

## 3. Testumgebung (C2)

Eigenes Sheet mit synthetischen Daten, eigenes Skriptprojekt (gleicher Code, andere `DB_ID`), eigenes
Deployment. Änderungen immer zuerst dort.

## 4. Messwerte

Rolle mit `messung_lesen` (Vorstand, Mitgliederverwalter) sieht in der Oberfläche „Messwerte“: Anzahl,
Median und P90 je Server-Funktion (Server-ms, Tabellenzugriffe) und die im Browser gemessene Gesamtzeit.
Rohdaten im Tab `_Messung` (keine Personendaten).

## 5. Bekannte Grenzen (C4) – zu prüfen, Stand meines Wissens

| Grenze | Wert | Bedeutung hier |
|---|---|---|
| Laufzeit je Ausführung | 6 min | Setup und Migration bleiben deutlich darunter |
| CacheService | 100 KB je Wert, max. 6 h | Snapshot wird in Teilstücke zerlegt (Phase 3) |
| Script Properties | ca. 9 KB je Wert | nur `DB_ID` |
| Trigger-Laufzeit gesamt | je nach Kontotyp, für Nonprofits prüfen | stündlicher Messwert-Trigger: Sekunden pro Lauf; nächtliche Wartung: Sekunden bis wenige Minuten, Abbruch nach 4,5 min mit Fortsetzung |
| Gleichzeitige Ausführungen | weiß ich nicht genau | wenige Nutzer, unkritisch |
| E-Mail-Kontingent (MailApp) | je nach Kontotyp, Stand meines Wissens ca. 100 Empfänger/Tag (Consumer) bis 1.500 (Workspace) – prüfen | Versand prüft vorher `MailApp.getRemainingDailyQuota()`; reicht es nicht, wird nichts gesendet. Zusätzlich `_Konfig.mail_max_je_lauf` (Standard 100) |
