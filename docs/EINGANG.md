# Online-Aufnahmeanträge von der Homepage (Eingang)

Stand 10/2026. Entscheidungen (Johann): Variante a (WordPress sendet an ein eigenes Eingangs-Skript); eigenes
Antragsformat `tsv-antrag-2` statt Access-XML; Preise nur in der Mitgliederverwaltung; Einwilligungen im Formular;
Access-XML läuft parallel weiter (Rückfall-Mail, Datei-Import).

Fertig: WebApp-Teil, Eingangs-Skript (`eingang/`), WordPress-Module zum Vorbauen (`wordpress/`, Schalter
`TSV_EINGANG_AKTIV`, Standard aus).

## Ablauf

```
WordPress (Aufnahmeformular, Contact Form 7)
   │  HTTPS POST: Antrag „tsv-antrag-2“ (JSON) + PDF mit Unterschrift + geheimer Schlüssel
   ▼
Eingangs-Skript (eigenes Apps-Script-Projekt des Funktionskontos, Web-App „Jeder“, nur doPost)
   │  1. legt JSON und PDF im Drive-Ordner „Beitritte Eingang“ ab (Freigabe: nur Funktionskonto)
   │  2. hängt eine Zeile an den Tab „Eingang“ der Eingangstabelle an
   ▼
Eingangstabelle „Aufnahmeanträge TSV – Eingang“ (getrennte Datei, nie die Datenbank)
   │  Scope spreadsheets (hat die WebApp schon) – kein Drive-Scope in der WebApp
   ▼
WebApp: Mitglieder → „Beitritte aus XML importieren“ → Abschnitt „Online-Anträge von der Homepage“
   Vorschau (Server wandelt um, IBAN nur maskiert) → Übernehmen → Zeile „uebernommen“, Inhalt geleert,
   PDF als Dokument verknüpft („Aufnahmeantrag“ je Person, „SEPA-Mandat“ am Konto bei Lastschrift),
   Einwilligungen angelegt
```

Warum so: Ein öffentlich erreichbares Schreibziel ist immer eine eigene, isolierte Datei (Sicherheitsregel,
`antrag_endpunkt_regel`). Das Eingangs-Skript kennt die Datenbank nicht. Die WebApp behält ihre vier Scopes.
Auf dem WordPress-Server liegt nur ein Schlüssel, mit dem man Anträge abliefern, aber nichts lesen kann.

## Format `tsv-antrag-2`

Erzeugt von `wordpress/inc/antrag-generator.php`, gelesen von `src/lib/antrag2.js`. Beispiele:
`test/daten/beitritt/online-familie.json`, `online-kind.json`.

```json
{
  "format": "tsv-antrag-2",
  "erstellt_am": "2026-10-25T21:30:00",
  "tarif": "familienbeitrag",
  "mitglied_ab": "2026-11-01",
  "abteilungen": ["fussball", "fitness-turnen"],
  "anschrift": { "strasse": "Hauptstraße 5", "plz": "84066", "ort": "Ergoldsbach" },
  "personen": [
    { "anrede": "Herr", "titel": "Dr.", "vorname": "Hans", "nachname": "Beispiel", "geburtsdatum": "1980-01-02",
      "geschlecht": "m", "email": "hans@example.com", "telefon": "08771 12345", "handy": "0170 1234567" },
    { "anrede": "Frau", "vorname": "Anna", "nachname": "Beispiel", "geburtsdatum": "1982-05-06" }
  ],
  "konto": { "iban": "DE89370400440532013000", "bic": "COBADEFFXXX", "kontoinhaber": "Hans Beispiel" },
  "unterschriften": {
    "antrag": { "datum": "2026-10-25", "name": "Hans Beispiel", "als": "selbst" },
    "sepa":   { "datum": "2026-10-25", "name": "Hans Beispiel" }
  },
  "bestaetigt": { "datenschutz": true, "sepa_mandat": true },
  "einwilligungen": { "fotos": true, "newsletter": false, "ehrungen": true },
  "bemerkung": "freier Text aus dem Formular"
}
```

| Feld | Bedeutung | In der Mitgliederverwaltung |
|---|---|---|
| `tarif` | Wert des Formularfelds `beitragsart` | Beitragsart mit passendem „Schlüssel im Online-Formular“ (`online_schluessel`, mehrere durch Komma). Ist sie „als Gemeinschaft“ (Familie/Ehepaar) markiert, entsteht eine Beitragsgemeinschaft „Familie Beispiel“ mit dem **aktuellen Betrag aus den Stammdaten**; sonst bekommt jede Person diese Beitragsart. Nicht zugeordnet → Warnung, Vorschlag nach Alter |
| `abteilungen` | Werte der Checkbox `abteilungen` | Abteilung mit passendem `online_schluessel`, für jede Person; unbekannt → Warnung |
| `anschrift` | gilt für alle Personen (einzeln überschreibbar mit `strasse`/`plz`/`ort` an der Person) | Straße und Hausnummer werden getrennt |
| `personen` | 1–10, Person 1 zuerst | Person 1 ist Zahler, alle weiteren zahlen über Person 1; Minderjährige bekommen Person 1 als Vertretung |
| `konto` | nur einmal | Konto aus IBAN/BIC; Kontoinhaber, der keine Person des Antrags ist → Konto ohne Mitgliedsbezug (Warnung) |
| `unterschriften.sepa.datum` | Datum im PDF | Mandatsdatum (sonst `antrag.datum`) |
| `unterschriften.antrag.als` | `selbst` / `erziehungsberechtigt` | bei `erziehungsberechtigt`: `name` wird gesetzliche Vertretung der Minderjährigen |
| `bestaetigt` | Pflicht-Zustimmungen | fehlt eine, erscheint eine Warnung |
| `einwilligungen` | `fotos`, `newsletter`, `ehrungen` (`messenger`) | je Person eine Zeile in `Einwilligung` (erteilt am Unterschriftsdatum, Form „Aufnahmeantrag“, bei Minderjährigen „erteilt durch“ = Unterschreibende) |

Bewusst **nicht** im Format: Beträge, Anzeigenamen, Bankname, Signaturbilder (die stehen nur im PDF).
Unbekannte Felder werden ignoriert. Texte höchstens 200 Zeichen, Daten JJJJ-MM-TT.

## Tab „Eingang“ – Vertrag zwischen Eingangs-Skript und WebApp

Kopfzeile genau so (Reihenfolge egal). `eingangEinrichten()` in der WebApp bzw. `einrichten()` im Eingangs-Skript
legen sie an.

| Spalte | Wer schreibt | Inhalt |
|---|---|---|
| `eingang_id` | Eingangs-Skript | `antrag_id` von WordPress (UUID), eindeutig – Pflicht |
| `eingang_am` | Eingangs-Skript | Zeitpunkt des Eingangs (Server-Zeit) |
| `format` | Eingangs-Skript | `tsv-antrag-2` oder `access-xml` (Übergang) |
| `dateiname` | Eingangs-Skript | Name der Datei im Ordner |
| `inhalt` | Eingangs-Skript | JSON bzw. XML, höchstens 45 000 Zeichen (Zellgrenze 50 000) – Pflicht |
| `drive_link` | Eingangs-Skript | Link auf die JSON-/XML-Datei |
| `pdf_link` | Eingangs-Skript | Link auf das PDF mit Unterschrift |
| `unterschrift_am` | Eingangs-Skript | Datum der Unterschrift (aus dem Antrag) |
| `status` | beide | `neu` → `uebernommen` / `abgelehnt` (WebApp) – Pflicht |
| `erledigt_am`, `erledigt_von` | WebApp | wann und von wem abgeschlossen |
| `ergebnis` | WebApp | „Nr. 1234, 1235“ bzw. Grund der Ablehnung (ohne Bankdaten) |

Regeln: Das Eingangs-Skript hängt nur an. Die WebApp ändert nur `status`, `erledigt_*`, `ergebnis` und leert
`inhalt`. Beide schützen Zellen gegen Formeln.

## Einrichtung

1. **Stammdaten** in der Mitgliederverwaltung: bei jeder Beitragsart und Abteilung den „Schlüssel im
   Online-Formular“ eintragen (Werte siehe `wordpress/LIESMICH.md`). Familien- und Ehegattenbeitrag als eigene
   Beitragsarten mit „als Gemeinschaft“ = Familie bzw. Ehepaar.
2. **Eingangstabelle** „Aufnahmeanträge TSV – Eingang“ im Ordner der Datenbank (nur Funktionskonto) anlegen.
3. **WebApp:** Script Property `EINGANG_ID` = ID dieses Sheets (nie `DB_ID`), im Editor `eingangEinrichten`.
4. **Eingangs-Skript:** `eingang/LIESMICH.md`.
5. **WordPress:** `wordpress/LIESMICH.md`.

Ohne `EINGANG_ID` ist der Abschnitt ausgeblendet; der Datei-Import (XML und JSON) funktioniert wie bisher.

## Bausteine

| Baustein | Wo | Anleitung |
|---|---|---|
| Eingangs-Skript (öffentlicher Empfänger) | `eingang/Eingang.js` | `eingang/LIESMICH.md` |
| WordPress: Antrag erzeugen und senden | `wordpress/inc/antrag-generator.php`, `wordpress/inc/eingang-sender.php` | `wordpress/LIESMICH.md` |
| WebApp: Format lesen | `src/lib/antrag2.js` | oben |
| WebApp: Liste, Vorschau, Übernahme, PDF, Einwilligungen | `src/lib/eingang.js`, `src/lib/beitritt.js`, `src/modul/Beitritt.js` | oben |

Inbetriebnahme: Test-Eingangstabelle + Test-Bereitstellung → Staging-WordPress mit `TSV_EINGANG_AKTIV = true` →
Probeantrag bis zur Übernahme in der Test-WebApp → Produktion einrichten → Schalter an.

## Offene Punkte

- Aufbewahrung der Dateien im Ordner „Beitritte Eingang“: wie „Dokument-Links wie Antrag/Mandat“ im Tab
  `Aufbewahrungsfrist`; abgelehnte Anträge von Hand löschen (Ordner und Zeile).
- Einwilligungstexte im Formular mit dem Vorstand abstimmen.
- Access-XML in WordPress abschalten, sobald Access nicht mehr parallel läuft (dann Rückfall-Mail mit dem JSON).
