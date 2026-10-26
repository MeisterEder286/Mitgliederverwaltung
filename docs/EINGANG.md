# Online-Aufnahmeanträge von der Homepage (Eingang)

Stand 10/2026. Entscheidung: Variante a (Johann). Der WebApp-Teil ist fertig. Das Eingangs-Skript und die
Anbindung in WordPress folgen.

## Ablauf

```
WordPress (Aufnahmeformular)
   │  HTTPS POST: XML (Access-Format /dataroot/Daten16) + PDF mit Unterschrift + geheimer Schlüssel
   ▼
Eingangs-Skript (eigenes Apps-Script-Projekt des Funktionskontos, Web-App „Jeder“, nur doPost)
   │  1. legt XML und PDF im Drive-Ordner „Beitritte Eingang“ ab (Freigabe: nur Funktionskonto)
   │  2. hängt eine Zeile an den Tab „Eingang“ der Eingangstabelle an
   ▼
Eingangstabelle „Aufnahmeanträge TSV – Eingang“ (getrennte Datei, nie die Datenbank)
   │  Scope spreadsheets (hat die WebApp schon) – kein Drive-Scope in der WebApp
   ▼
WebApp: Mitglieder → „Beitritte aus XML importieren“ → Abschnitt „Online-Anträge von der Homepage“
   Vorschau (Server zerlegt die XML, IBAN nur maskiert) → Übernehmen → Zeile „uebernommen“, XML geleert,
   PDF als Dokument verknüpft („Aufnahmeantrag“ je Person, „SEPA-Mandat“ am Konto bei Lastschrift)
```

Warum so: Ein öffentlich erreichbares Schreibziel ist immer eine eigene, isolierte Datei (Sicherheitsregel,
`antrag_endpunkt_regel`). Das Eingangs-Skript kennt die Datenbank nicht. Die WebApp behält ihre vier Scopes.
Auf dem WordPress-Server liegt nur ein Schlüssel, mit dem man Anträge abliefern, aber nichts lesen kann.

## Tab „Eingang“ – Vertrag zwischen Eingangs-Skript und WebApp

Kopfzeile genau so (Reihenfolge egal). `eingangEinrichten()` in der WebApp legt sie an.

| Spalte | Wer schreibt | Inhalt |
|---|---|---|
| `eingang_id` | Eingangs-Skript | eindeutig, nie wiederverwendet (z. B. Zeitstempel + Zufall) – Pflicht |
| `eingang_am` | Eingangs-Skript | Zeitpunkt des Eingangs (Server-Zeit, nicht vom Formular) |
| `dateiname` | Eingangs-Skript | Name der XML-Datei im Ordner |
| `xml` | Eingangs-Skript | XML-Text (UTF-8, ohne DOCTYPE, höchstens 500 000 Zeichen) – Pflicht |
| `drive_link` | Eingangs-Skript | Link auf die XML-Datei (`https://drive.google.com/…`) |
| `pdf_link` | Eingangs-Skript | Link auf das PDF mit Unterschrift (`https://drive.google.com/…`) |
| `status` | beide | `neu` (Eingangs-Skript) → `uebernommen` / `abgelehnt` (WebApp) – Pflicht |
| `erledigt_am`, `erledigt_von` | WebApp | wann und von wem abgeschlossen |
| `ergebnis` | WebApp | „Nr. 1234, 1235“ bzw. Grund der Ablehnung (ohne Bankdaten) |

Regeln:
- Das Eingangs-Skript **hängt nur an** (`appendRow`), es ändert und löscht keine Zeilen. Die WebApp ändert nur
  `status`, `erledigt_*`, `ergebnis` und leert `xml`.
- Werte mit `=` am Anfang schreibt die WebApp als Text (Formelschutz). Das Eingangs-Skript muss das ebenso tun
  (`'` voranstellen oder Zellformat Text).
- Ein PDF-Link, der nicht auf `drive.google.com`/`docs.google.com` zeigt, wird ignoriert.

## Einrichtung (WebApp-Teil)

1. Im Ordner der Datenbank (nur Funktionskonto) ein neues Sheet „Aufnahmeanträge TSV – Eingang“ anlegen.
2. In der WebApp Script Property `EINGANG_ID` = ID dieses Sheets. Es darf nicht `DB_ID` sein, das lehnt die
   WebApp ab.
3. Im Editor `eingangEinrichten` ausführen. Das legt den Tab „Eingang“ mit der Kopfzeile an.
4. Ohne `EINGANG_ID` ist der Abschnitt einfach ausgeblendet. Der Datei-Import funktioniert wie bisher.

## Noch zu bauen

- **Eingangs-Skript** (`eingang/` im Repo, eigenes Projekt wie `backup/`): `doPost` prüft den Schlüssel
  (Script Property, Vergleich in konstanter Zeit), Größe und Inhaltstyp, legt XML und PDF im Ordner ab und hängt die
  Zeile an. Antwort ohne Details. Scopes: `spreadsheets`, `drive.file` (nur selbst angelegte Dateien).
- **WordPress:** Nach dem Absenden XML und PDF per `wp_remote_post` an die Eingangs-URL schicken, statt
  sie zu mailen. Den Schlüssel in `wp-config.php`, nicht in der Datenbank. Bei einem Fehler eine Mail als Rückfall.
- Aufbewahrung der Dateien im Ordner: wie „Dokument-Links wie Antrag/Mandat“ im Tab `Aufbewahrungsfrist`.
