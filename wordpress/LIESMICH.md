# WordPress: Online-Antrag an den Eingang senden

Vorbereitet für das Child-Theme `tsv-ergoldsbach-child` (Branch `develop`). Solange `TSV_EINGANG_AKTIV` nicht
gesetzt ist, ändert sich nichts: Die Mail geht wie bisher mit PDF und XML. Gesamtablauf und Format: `docs/EINGANG.md`.

## Dateien

| Datei | Zweck |
|---|---|
| `inc/antrag-generator.php` | `tsv_antrag_erzeugen()` – baut aus den CF7-Feldern den Antrag im Format `tsv-antrag-2` (JSON) |
| `inc/eingang-sender.php` | `tsv_eingang_aktiv()`, `tsv_eingang_senden()`, `tsv_eingang_hinweis_text()` |
| `PROMPT_WORDPRESS.md` | fertiger Auftrag für den WordPress-Chat (enthält beide `inc/`-Dateien wörtlich) |
| `PROMPT_WORDPRESS_NACHTRAG.md` | Umstellung des bereits gebauten Stands (Commit `0d5f72e`, XML-Fassung) auf `tsv-antrag-2` |
| `tests/eingang-sender-test.php` | Test ohne WordPress (Stubs), läuft hier im Repo über `npm test`; prüft auch, dass die Mitgliederverwaltung den erzeugten Antrag versteht |

Beide `inc/`-Dateien unverändert ins Child-Theme nach `inc/` kopieren. `inc/xml-generator.php` bleibt, solange Access
parallel läuft (Rückfall-Mail mit XML).

## Einbau (Child-Theme)

1. Laden, wo auch `inc/beitritt-hook.php` geladen wird:
   ```php
   require_once get_stylesheet_directory() . '/inc/antrag-generator.php';
   require_once get_stylesheet_directory() . '/inc/eingang-sender.php';
   ```
2. In `tsv_beitritt_before_send()` (`inc/beitritt-hook.php`) den internen Versand an die Mitgliederverwaltung so
   umbauen. Mail an den Antragsteller und an die Abteilungsleiter bleiben **unverändert**.
   ```php
   // Online-Antrag an den Eingang der Mitgliederverwaltung (Schalter in wp-config.php, Standard aus)
   $eingang = [ 'ok' => false ];
   if ( function_exists( 'tsv_eingang_aktiv' ) && tsv_eingang_aktiv() ) {
       // dasselbe Datum, das im PDF bei den Unterschriften steht („Ergoldsbach, den …“)
       $antrag  = tsv_antrag_erzeugen( $data, wp_date( 'Y-m-d' ) );
       $eingang = tsv_eingang_senden( $antrag, $pdf_path, basename( $xml_path ) );
   }
   if ( $eingang['ok'] ) {
       // Antrag liegt im Eingang: nur Hinweis, ohne Anhänge und ohne Bankdaten
       wp_mail( $intern_ziel,
           $betreff_prefix . sprintf( 'Neuer Online-Antrag im Eingang: %s, %s (%s)', $data['nachname_1'], $data['vorname_1'], wp_date( 'd.m.Y H:i' ) ),
           tsv_eingang_hinweis_text( $data ),
           [ 'Content-Type: text/plain; charset=UTF-8', 'From: TSV Website <info@tsv-ergoldsbach.de>' ] );
   } else {
       // bisheriger Versand mit PDF und XML (Rückfall); bei aktivem Eingang im Betreff kennzeichnen
       $rueckfall = ( function_exists( 'tsv_eingang_aktiv' ) && tsv_eingang_aktiv() ) ? '[Eingang fehlgeschlagen – bitte Datei importieren] ' : '';
       wp_mail( $intern_ziel,
           $betreff_prefix . $rueckfall . sprintf( 'Neuer Beitrittsantrag: %s, %s (%s)', $data['nachname_1'], $data['vorname_1'], wp_date( 'd.m.Y H:i' ) ),
           tsv_beitritt_email_intern( $data, $signatur_meta ),
           [ 'Content-Type: text/plain; charset=UTF-8',
             'From: TSV Website <info@tsv-ergoldsbach.de>',
             'Reply-To: ' . ( $lokal ? $test_email : $bewerber_email ) ],
           [ $pdf_path, $xml_path ] );
   }
   ```
   Wichtig: Das Senden muss **vor** dem `@unlink` von PDF/XML laufen. Wird das Unterschriftsdatum im PDF aus einer
   eigenen Variablen erzeugt, genau diesen Wert an `tsv_antrag_erzeugen()` übergeben.
3. **Formular „Beitrittserklaerung“** (CF7, im Admin-Bereich) – neue, freiwillige Felder:
   ```
   [acceptance einwilligung_fotos optional] Fotos und Videos von mir/uns dürfen in Vereinsmedien veröffentlicht werden. [/acceptance]
   [acceptance einwilligung_newsletter optional] Ich möchte den Newsletter per E-Mail erhalten. [/acceptance]
   [acceptance einwilligung_ehrungen optional] Ehrungen und runde Geburtstage dürfen in Vereinsmedien genannt werden. [/acceptance]
   [text erziehungsberechtigter_name]   (nur sichtbar, wenn Person 1 minderjährig ist)
   ```
   Texte mit dem Vorstand abstimmen. Fehlt ein Feld, wird die Einwilligung einfach nicht übermittelt. Fehlt
   `erziehungsberechtigter_name`, gilt bei Kindern der Kontoinhaber als unterschreibende Person.
4. `wp-config.php` je Umgebung (Staging zuerst; lokal auf eine Test-Bereitstellung zeigen lassen):
   ```php
   define( 'TSV_EINGANG_AKTIV', false );   // erst nach erfolgreichem Test auf true
   define( 'TSV_EINGANG_URL', 'https://script.google.com/macros/s/…/exec' );
   define( 'TSV_EINGANG_SCHLUESSEL', '…' );   // aus einrichten() im Eingangs-Skript; nie ins Git
   ```

## Welche Schlüssel die Mitgliederverwaltung kennen muss

Der Antrag enthält keine Preise und keine Anzeigenamen, sondern die **Werte** der Formularfelder:

| Formularfeld | Werte (heute) | wird zugeordnet über |
|---|---|---|
| `beitragsart` | `familienbeitrag`, `ehegattenbeitrag`, `erwachsene`, `kind`, `jugendliche`, `rentner` | Stammdaten → Beitragsart → „Schlüssel im Online-Formular“ (bei Familie/Ehepaar zusätzlich „als Gemeinschaft“) |
| `abteilungen` | `fussball`, `leichtathletik`, `basketball`, `schach`, `fitness-turnen`, `schaeffler`, `teqball` | Stammdaten → Abteilung → „Schlüssel im Online-Formular“ |

Ändert sich ein Wert im Formular, muss der Schlüssel in der Mitgliederverwaltung nachgezogen werden. Ein
unbekannter Schlüssel erscheint dort als Warnung, nichts geht verloren.

## Test auf Staging

1. Eingangs-Skript als **Test-Bereitstellung** mit einer **Test-Eingangstabelle** einrichten (`eingang/LIESMICH.md`).
2. Auf `neu.tsv-ergoldsbach.de` die drei Konstanten setzen, `TSV_EINGANG_AKTIV` auf `true`.
3. Formular mit erfundenen Daten absenden (Familie mit 3 Personen, Test-IBAN `DE89 3704 0044 0532 0130 00`).
4. Erwartet: neue Zeile „neu“ (Format `tsv-antrag-2`) in der Test-Eingangstabelle, JSON und PDF im Test-Ordner, Mail
   „Neuer Online-Antrag im Eingang“ ohne Anhänge. In der Test-WebApp erscheint der Antrag unter „Online-Anträge von
   der Homepage“ mit Tarif und Abteilungen ohne Warnung.
5. Gegenprobe: falschen Schlüssel eintragen → Mail mit „[Eingang fehlgeschlagen …]“ und Anhängen (Rückfall).
6. Blockiert Wordfence o. Ä. ausgehende Verbindungen, steht „TSV Eingang: Senden fehlgeschlagen (verbindung)“ im
   PHP-Fehlerprotokoll – dann `script.google.com` und `script.googleusercontent.com` freigeben.

## Hinweise

- **Spam-Schutz:** Honeypot ist im Beitrittsformular vorhanden. Das Eingangs-Skript nimmt zusätzlich höchstens
  30 Anträge je Stunde an.
- **IBAN in der Mail:** Im Rückfall enthält der Mailtext weiter die IBAN. Sobald der Eingang zuverlässig läuft, die
  IBAN im Rückfalltext maskieren (`DE89 •••• 3000`) – die vollständige steht in der angehängten XML.
- **Preise im Formulartext** pflegt WordPress weiter selbst (nur Anzeige). Maßgeblich für den Beitrag sind die
  Beträge in der Mitgliederverwaltung.
