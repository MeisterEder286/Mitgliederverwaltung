# WordPress: Online-Antrag an den Eingang senden

Vorbereitet für das Child-Theme `tsv-ergoldsbach-child` (Branch `develop`). Solange `TSV_EINGANG_AKTIV` nicht
gesetzt ist, ändert sich nichts: Die Mail geht wie bisher mit PDF und XML. Gesamtablauf: `docs/EINGANG.md`.

## Dateien

| Datei | Zweck |
|---|---|
| `inc/eingang-sender.php` | `tsv_eingang_aktiv()`, `tsv_eingang_senden()`, `tsv_eingang_hinweis_text()` – unverändert ins Child-Theme nach `inc/` kopieren |
| `tests/eingang-sender-test.php` | Test ohne WordPress (Stubs), läuft hier im Repo über `npm test` |

## Einbau (Child-Theme)

1. `inc/eingang-sender.php` nach `tsv-ergoldsbach-child/inc/` kopieren und dort laden, wo auch
   `inc/beitritt-hook.php` geladen wird:
   ```php
   require_once get_stylesheet_directory() . '/inc/eingang-sender.php';
   ```
2. In `tsv_beitritt_before_send()` (`inc/beitritt-hook.php`) den internen Versand an die Mitgliederverwaltung
   so umbauen. Mail an den Antragsteller und an die Abteilungsleiter bleibt **unverändert**.
   ```php
   // Online-Antrag an den Eingang der Mitgliederverwaltung (Schalter in wp-config.php, Standard aus)
   $eingang = [ 'ok' => false ];
   if ( function_exists( 'tsv_eingang_aktiv' ) && tsv_eingang_aktiv() ) {
       // dasselbe Datum, das im PDF bei den Unterschriften steht („Ergoldsbach, den …“)
       $eingang = tsv_eingang_senden( $xml_path, $pdf_path, wp_date( 'Y-m-d' ) );
   }
   if ( $eingang['ok'] ) {
       // Antrag liegt im Eingang: nur Hinweis, ohne Anhänge und ohne Bankdaten
       wp_mail( $intern_ziel,
           $betreff_prefix . sprintf( 'Neuer Online-Antrag im Eingang: %s, %s (%s)', $data['nachname_1'], $data['vorname_1'], wp_date( 'd.m.Y H:i' ) ),
           tsv_eingang_hinweis_text( $data ),
           [ 'Content-Type: text/plain; charset=UTF-8', 'From: TSV Website <info@tsv-ergoldsbach.de>' ] );
   } else {
       // bisheriger Versand mit PDF und XML (Rückfall); bei aktivem Eingang im Betreff kennzeichnen
       $rueckfall = ( function_exists( 'tsv_eingang_aktiv' ) && tsv_eingang_aktiv() ) ? '[Eingang fehlgeschlagen – bitte XML importieren] ' : '';
       wp_mail( $intern_ziel,
           $betreff_prefix . $rueckfall . sprintf( 'Neuer Beitrittsantrag: %s, %s (%s)', $data['nachname_1'], $data['vorname_1'], wp_date( 'd.m.Y H:i' ) ),
           tsv_beitritt_email_intern( $data, $signatur_meta ),
           [ 'Content-Type: text/plain; charset=UTF-8',
             'From: TSV Website <info@tsv-ergoldsbach.de>',
             'Reply-To: ' . ( $lokal ? $test_email : $bewerber_email ) ],
           [ $pdf_path, $xml_path ] );
   }
   ```
   Wichtig: `tsv_eingang_senden()` muss **vor** dem `@unlink` von PDF/XML laufen. Wird der Wert für
   `unterschrift_am` im PDF anders ermittelt (z. B. eigene Variable), genau diesen Wert übergeben.
3. `wp-config.php` je Umgebung (Staging zuerst; lokal auf eine Test-Bereitstellung zeigen lassen):
   ```php
   define( 'TSV_EINGANG_AKTIV', false );   // erst nach erfolgreichem Test auf true
   define( 'TSV_EINGANG_URL', 'https://script.google.com/macros/s/…/exec' );
   define( 'TSV_EINGANG_SCHLUESSEL', '…' );   // aus einrichten() im Eingangs-Skript; nie ins Git
   ```

## Test auf Staging

1. Eingangs-Skript als **Test-Bereitstellung** mit einer **Test-Eingangstabelle** einrichten (`eingang/LIESMICH.md`).
2. Auf `neu.tsv-ergoldsbach.de` die drei Konstanten setzen, `TSV_EINGANG_AKTIV` auf `true`.
3. Formular mit erfundenen Daten absenden (Familie mit 3 Personen, Test-IBAN `DE89 3704 0044 0532 0130 00`).
4. Erwartet: neue Zeile „neu“ in der Test-Eingangstabelle, XML und PDF im Test-Ordner, Mail „Neuer Online-Antrag im
   Eingang“ ohne Anhänge. In der Test-WebApp erscheint der Antrag unter „Online-Anträge von der Homepage“.
5. Gegenprobe: falschen Schlüssel eintragen → Mail mit „[Eingang fehlgeschlagen …]“ und Anhängen (Rückfall).
6. Blockiert Wordfence o. Ä. ausgehende Verbindungen, steht „TSV Eingang: Senden fehlgeschlagen (verbindung)“ im
   PHP-Fehlerprotokoll – dann `script.google.com` und `script.googleusercontent.com` freigeben.

## Empfehlungen aus der Bestandsaufnahme

- **Spam-Schutz:** Honeypot ist im Beitrittsformular vorhanden. Das Eingangs-Skript nimmt zusätzlich höchstens
  30 Anträge je Stunde an.
- **IBAN in der Mail:** Im Rückfall enthält der Mailtext weiter die IBAN. Sobald der Eingang zuverlässig läuft, die
  IBAN im Rückfalltext maskieren (`DE89 •••• 3000`) – die vollständige steht in der angehängten XML.
- **Datenschutz:** Das PDF nennt im Footer die IP-Adresse. Das gehört ins Verarbeitungsverzeichnis (erledigt in
  `docs/VERARBEITUNGSVERZEICHNIS.md`).
