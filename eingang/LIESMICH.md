# Eingangs-Skript (eigenes Apps-Script-Projekt)

Nimmt Online-Aufnahmeanträge der Homepage entgegen (XML + PDF mit Unterschrift), legt sie im Drive-Ordner ab und
hängt eine Zeile an die Eingangstabelle. Gesamtablauf und Spaltenvertrag: `docs/EINGANG.md`.

## Warum ein eigenes Projekt

- Es ist **öffentlich erreichbar** (Web-App „Zugriff: Jeder“), weil der WordPress-Server sich nicht bei Google
  anmelden kann. Deshalb darf es nichts außer Abliefern: Es kennt die Datenbank nicht (`check.js` prüft, dass
  `DB_ID` nicht vorkommt), liest keine Anträge aus und ändert keine Zeilen.
- Scopes nur `spreadsheets` und `drive.file` (nur selbst angelegte Dateien/Ordner). `check.js` lehnt andere ab.

## Einrichtung (Funktionskonto)

1. **Eingangstabelle** „Aufnahmeanträge TSV – Eingang“ im geschützten Ordner anlegen (falls noch nicht da).
2. **Projekt:** script.google.com → Neues Projekt im Funktionskonto. Script-ID in `eingang/.clasp.json`
   (Vorlage `.clasp.json.beispiel`), dann `npm run push:eingang`.
3. **Script Property** `EINGANG_ID` = ID der Eingangstabelle (dieselbe wie `EINGANG_ID` in der WebApp).
4. Im Editor **`einrichten`** ausführen und die Berechtigungen bestätigen. Das Skript:
   - erzeugt `SCHLUESSEL` und schreibt die Zeile für `wp-config.php` ins Ausführungsprotokoll,
   - legt den Ordner „Beitritte Eingang“ an (Link im Protokoll) und speichert `ORDNER_ID`,
   - legt in der Eingangstabelle den Tab „Eingang“ mit Kopfzeile an.
5. Den Ordner **in den geschützten Bereich verschieben**. Freigabe: nur Funktionskonto, NICHT „jeder mit dem Link“.
6. **Bereitstellen** → Neue Bereitstellung → Web-App, „Ausführen als: **Ich**“, „Zugriff: **Jeder**“.
   Die exec-URL kommt nach `TSV_EINGANG_URL` in `wp-config.php` und ins Register (`docs/REGISTER.md`).
   Später nur „Bereitstellung bearbeiten → Neue Version“, sonst ändert sich die URL.
7. In der **WebApp** (Hauptprojekt) `EINGANG_ID` setzen und `eingangEinrichten` ausführen (prüft die Kopfzeile).

Für Staging und Tests dasselbe mit eigener Test-Eingangstabelle und eigener Bereitstellung.

## Schlüssel wechseln

`SCHLUESSEL` in den Script Properties löschen, `einrichten` erneut ausführen, neuen Wert in `wp-config.php`
eintragen. Bis dahin abgewiesene Anträge gehen per Rückfall-Mail an die Mitgliederverwaltung.

## Antworten

`{ "ok": true, "eingang_id": "…" }` · `{ "ok": true, "doppelt": true }` (Wiederholung) ·
`{ "ok": false, "fehler": "nicht_berechtigt" | "ungueltig" | "nicht_eingerichtet" | "zu_viele" | "intern" }`.
Einzelheiten nur im Ausführungsprotokoll, ohne personenbezogene Daten.
