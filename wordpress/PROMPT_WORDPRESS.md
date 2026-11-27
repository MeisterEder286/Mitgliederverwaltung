# Prompt für den WordPress-Chat (Child-Theme tsv-ergoldsbach-child)

Alles ab der Linie unten in den WordPress-Chat kopieren. Er baut die Anbindung an den Eingang der
Mitgliederverwaltung **vorgebaut und ausgeschaltet** ein. Erzeugt aus `wordpress/inc/` – bei Änderungen dort neu erzeugen.

---

Bitte baue im Child-Theme tsv-ergoldsbach-child (Git, Branch develop) die Anbindung des Online-Aufnahmeantrags an den
„Eingang“ der Mitgliederverwaltung ein. Sie soll VORGEBAUT, aber AUSGESCHALTET sein: Solange die Konstante
TSV_EINGANG_AKTIV nicht true ist, muss sich alles exakt wie heute verhalten (Mail mit PDF und XML).

Hintergrund: Statt XML und PDF nur per Mail zu schicken, sendet WordPress den Antrag in einem neuen Format
„tsv-antrag-2“ (JSON) und das PDF per HTTPS an ein Google-Apps-Script („Eingangs-Skript“). Das Format enthält
KEINE Preise: nur den Tarif-Schlüssel (Wert des Felds beitragsart) und die Abteilungs-Schlüssel (Werte der Checkbox
abteilungen); die Beträge kennt nur die Mitgliederverwaltung. Die Access-XML (inc/xml-generator.php) bleibt
unverändert für die Rückfall-Mail, weil Access noch parallel läuft. Klappt das Senden nicht, geht die bisherige
Mail mit Anhängen als Rückfall.

Aufgaben:

1. Zwei neue Dateien mit EXAKT dem Inhalt unten anlegen (nicht umformulieren; sie sind im Repo der
   Mitgliederverwaltung getestet, auch gegen deren Import): inc/antrag-generator.php und inc/eingang-sender.php.
   Laden per require_once dort, wo inc/beitritt-hook.php geladen wird:
   require_once get_stylesheet_directory() . '/inc/antrag-generator.php';
   require_once get_stylesheet_directory() . '/inc/eingang-sender.php';

2. In tsv_beitritt_before_send() (inc/beitritt-hook.php) NUR den internen Versand an die Mitgliederverwaltung
   umbauen; Kopie an den Antragsteller und Mails an die Abteilungsleiter bleiben unverändert:
   - Wenn function_exists('tsv_eingang_aktiv') && tsv_eingang_aktiv():
       $antrag  = tsv_antrag_erzeugen( $data, <Datum der Unterschrift im PDF als 'Y-m-d'> );
       $eingang = tsv_eingang_senden( $antrag, $pdf_path, basename( $xml_path ) );
     Das Datum muss genau das sein, das im PDF bei „Ergoldsbach, den …“ steht. Wird es im pdf-generator aus einer
     Variablen erzeugt, dieselbe Quelle nehmen; sonst wp_date( 'Y-m-d' ) zum selben Zeitpunkt.
   - Wenn $eingang['ok']: statt der bisherigen internen Mail eine Hinweis-Mail OHNE Anhänge:
       Betreff: $betreff_prefix . sprintf( 'Neuer Online-Antrag im Eingang: %s, %s (%s)', nachname_1, vorname_1, wp_date('d.m.Y H:i') )
       Text:    tsv_eingang_hinweis_text( $data )
       Header:  Content-Type text/plain UTF-8, From wie bisher
   - Sonst: die bisherige interne Mail UNVERÄNDERT (mit [ $pdf_path, $xml_path ] als Anhang). Nur wenn der Eingang
     aktiv war, im Betreff vorne '[Eingang fehlgeschlagen – bitte Datei importieren] ' ergänzen.
   - Das Senden muss VOR dem @unlink von PDF/XML/Signaturen laufen. Das Aufräumen bleibt, wie es ist.
   - Prüfe in tsv_beitritt_before_send(), ob $data die Formularwerte so enthält, wie der Generator sie erwartet
     (Feldnamen siehe Kopfkommentar von inc/antrag-generator.php; Radio/Checkbox als Liste oder String ist beides
     ok). Weichen Feldnamen ab, NICHT den Generator ändern, sondern berichten.

3. Formular „Beitrittserklaerung“ (CF7, liegt in der DB): neue, FREIWILLIGE Felder vorbereiten. Bitte als genaue
   Anleitung für den Admin-Bereich beschreiben (Formular-Tags und Platzierung), nicht selbst in der DB ändern:
   [acceptance einwilligung_fotos optional] Fotos und Videos von mir/uns dürfen in Vereinsmedien veröffentlicht werden. [/acceptance]
   [acceptance einwilligung_newsletter optional] Ich möchte den Newsletter per E-Mail erhalten. [/acceptance]
   [acceptance einwilligung_ehrungen optional] Ehrungen und runde Geburtstage dürfen in Vereinsmedien genannt werden. [/acceptance]
   [text erziehungsberechtigter_name] – nur sichtbar/Pflicht, wenn Person 1 minderjährig ist (per vorhandenem JS)
   Die Texte stimmt der Vorstand noch ab. Falls das PDF die Einwilligungen mit ausgeben soll, nur beschreiben, wo
   das in inc/pdf-generator.php ginge – nicht umsetzen.

4. wp-config.php NICHT ins Git. Für Staging und lokal nur beschreiben, was eingetragen werden muss:
   define( 'TSV_EINGANG_AKTIV', false );
   define( 'TSV_EINGANG_URL', 'https://script.google.com/macros/s/…/exec' );
   define( 'TSV_EINGANG_SCHLUESSEL', '…' );   // kommt aus dem Eingangs-Skript, nie ins Git oder in die DB

5. Prüfen und berichten:
   - php -l für alle geänderten Dateien (PHP ≥ 8.0; Produktion 8.4, lokal 8.2).
   - Lokal mit TSV_EINGANG_AKTIV = false: Formular absenden → Mail wie bisher (mit Anhängen), keine Änderung.
   - Lokal mit TSV_EINGANG_AKTIV = true und erfundener URL (https://script.google.com/macros/s/TEST/exec) und
     erfundenem Schlüssel (mind. 32 Zeichen): Formular absenden → Rückfall-Mail mit „[Eingang fehlgeschlagen …]“
     und Anhängen; im PHP-Log „TSV Eingang: Senden fehlgeschlagen (…)“.
   - Zusätzlich lokal einmal tsv_antrag_erzeugen() mit den echten Formulardaten eines Testantrags (erfundene
     Personen, Test-IBAN DE89 3704 0044 0532 0130 00) aufrufen und das JSON in die Antwort kopieren – damit
     prüfe ich in der Mitgliederverwaltung, ob alle Felder ankommen.
   - Die tatsächlichen Werte der Formularfelder beitragsart und abteilungen (die value-Teile im CF7-Formular)
     auflisten.
   - Ob Wordfence ausgehende Verbindungen zu script.google.com / script.googleusercontent.com zulässt (Einstellung
     nennen, nichts ändern).
   - Den Diff von inc/beitritt-hook.php zeigen. Commit auf develop mit klarer Nachricht, NICHT auf Produktion
     ausrollen.

Keine echten personenbezogenen Daten, IBANs, Passwörter oder Schlüssel in Code, Commits oder Antwort.

Inhalt von inc/antrag-generator.php:

```php
<?php
/**
 * Antrag-Generator – baut aus den Feldern der „Beitrittserklaerung“ (Contact Form 7) den Online-Antrag im Format
 * „tsv-antrag-2“ für den Eingang der Mitgliederverwaltung.
 *
 * Zweck:       Ersetzt für den Eingang die Access-XML (inc/xml-generator.php bleibt für die Rückfall-Mail, solange
 *              Access parallel läuft). Beschreibung des Formats: docs/EINGANG.md im Repo Mitgliederverwaltung.
 * Grundsätze:  - Keine Beträge: Es wird nur der Tarif-SCHLÜSSEL (Feld beitragsart) übermittelt; die Preise kennt nur
 *                die Mitgliederverwaltung (Beitragsart → „Schlüssel im Online-Formular“).
 *              - Abteilungen als Schlüssel (Werte der Checkbox abteilungen), Anschrift und Konto nur einmal.
 *              - Unterschriften mit Datum (dasselbe Datum wie im PDF) und Rolle: Ist Person 1 minderjährig,
 *                unterschreiben Erziehungsberechtigte (Name aus erziehungsberechtigter_name, sonst Kontoinhaber).
 *              - Einwilligungen aus optionalen Zustimmungsfeldern (einwilligung_fotos, _newsletter, _ehrungen).
 * Felder (CF7): beitragsart, mitglied_ab, abteilungen, anrede_n, titel_n, nachname_n, vorname_n, gebdat_n,
 *              email_n (n = 1–4), strasse_1, plz_1, ort_1, telefon_1, handy_1, iban, bic, kontoinhaber,
 *              acceptance-dsgvo_einwilligung, acceptance-sepa_einwilligung, optional erziehungsberechtigter_name,
 *              einwilligung_fotos, einwilligung_newsletter, einwilligung_ehrungen, bemerkung.
 */

defined( 'ABSPATH' ) || exit;

/** CF7 liefert Radio/Checkbox als Liste, Text als String – einheitlich als String (erster Wert). */
function tsv_antrag_wert( array $data, string $feld ): string {
	$v = $data[ $feld ] ?? '';
	if ( is_array( $v ) ) {
		$v = $v[0] ?? '';
	}
	return trim( preg_replace( '/\s+/u', ' ', (string) $v ) );
}

/** Schlüssel vereinheitlichen wie in der Mitgliederverwaltung: „Fitness Turnen“ → „fitness-turnen“. */
function tsv_antrag_schluessel( string $s ): string {
	$s = mb_strtolower( $s, 'UTF-8' );
	$s = strtr( $s, [ 'ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss' ] );
	$s = preg_replace( '/[\s_]+/', '-', $s );
	$s = preg_replace( '/[^a-z0-9\-]/', '', $s );
	return trim( preg_replace( '/-{2,}/', '-', $s ), '-' );
}

/** Datum 'Y-m-d' oder null. */
function tsv_antrag_datum( string $s ): ?string {
	return preg_match( '/^\d{4}-\d{2}-\d{2}$/', $s ) ? $s : null;
}

/** Zustimmungsfeld (CF7 acceptance/checkbox) gesetzt? */
function tsv_antrag_ja( array $data, string $feld ): bool {
	$v = $data[ $feld ] ?? '';
	if ( is_array( $v ) ) {
		$v = $v[0] ?? '';
	}
	return '' !== trim( (string) $v ) && '0' !== (string) $v;
}

/** Leere Werte entfernen (null und ''), damit das JSON knapp bleibt. */
function tsv_antrag_ohne_leere( array $a ): array {
	return array_filter( $a, static fn( $v ) => null !== $v && '' !== $v );
}

/**
 * Online-Antrag „tsv-antrag-2“ aus den Formulardaten.
 *
 * @param array  $data             Formulardaten wie in tsv_beitritt_before_send().
 * @param string $unterschrift_am  Datum der Unterschriften, 'Y-m-d' – dasselbe wie im PDF („Ergoldsbach, den …“).
 * @param string $erstellt_am      Zeitpunkt, 'Y-m-d\TH:i:s' (Standard: jetzt).
 */
function tsv_antrag_erzeugen( array $data, string $unterschrift_am, string $erstellt_am = '' ): array {
	$geschlecht = [ 'herr' => 'm', 'frau' => 'w', 'divers' => 'd' ];
	$personen   = [];
	for ( $n = 1; $n <= 4; $n++ ) {
		$nach = tsv_antrag_wert( $data, 'nachname_' . $n );
		$vor  = tsv_antrag_wert( $data, 'vorname_' . $n );
		if ( '' === $nach && '' === $vor ) {
			continue;   // ausgeblendete bzw. leere Person
		}
		$anrede     = tsv_antrag_wert( $data, 'anrede_' . $n );
		$personen[] = tsv_antrag_ohne_leere( [
			'anrede'       => $anrede,
			'titel'        => tsv_antrag_wert( $data, 'titel_' . $n ),
			'vorname'      => $vor,
			'nachname'     => $nach,
			'geburtsdatum' => tsv_antrag_datum( tsv_antrag_wert( $data, 'gebdat_' . $n ) ),
			'geschlecht'   => $geschlecht[ mb_strtolower( $anrede, 'UTF-8' ) ] ?? null,
			'email'        => tsv_antrag_wert( $data, 'email_' . $n ),
			'telefon'      => 1 === $n ? tsv_antrag_wert( $data, 'telefon_1' ) : null,
			'handy'        => 1 === $n ? tsv_antrag_wert( $data, 'handy_1' ) : null,
		] );
	}
	$p1          = $personen[0] ?? [];
	$name_p1     = trim( ( $p1['vorname'] ?? '' ) . ' ' . ( $p1['nachname'] ?? '' ) );
	$inhaber     = tsv_antrag_wert( $data, 'kontoinhaber' );
	$inhaber     = '' !== $inhaber ? $inhaber : $name_p1;
	$minderjaehrig = false;
	if ( ! empty( $p1['geburtsdatum'] ) && $unterschrift_am ) {
		$minderjaehrig = ( new DateTimeImmutable( $p1['geburtsdatum'] ) )->diff( new DateTimeImmutable( $unterschrift_am ) )->y < 18;
	}
	$erziehungsberechtigt = tsv_antrag_wert( $data, 'erziehungsberechtigter_name' );
	if ( $minderjaehrig && '' === $erziehungsberechtigt && $inhaber !== $name_p1 ) {
		$erziehungsberechtigt = $inhaber;   // Annahme: Bei Kindern zahlt und unterschreibt ein Elternteil
	}
	$abteilungen = [];
	foreach ( (array) ( $data['abteilungen'] ?? [] ) as $abt ) {
		$k = tsv_antrag_schluessel( (string) $abt );
		if ( '' !== $k && ! in_array( $k, $abteilungen, true ) ) {
			$abteilungen[] = $k;
		}
	}
	$einwilligungen = [];
	foreach ( [ 'fotos', 'newsletter', 'ehrungen' ] as $art ) {
		if ( array_key_exists( 'einwilligung_' . $art, $data ) ) {
			$einwilligungen[ $art ] = tsv_antrag_ja( $data, 'einwilligung_' . $art );
		}
	}
	$datum = tsv_antrag_datum( $unterschrift_am );
	return tsv_antrag_ohne_leere( [
		'format'         => 'tsv-antrag-2',
		'erstellt_am'    => '' !== $erstellt_am ? $erstellt_am : wp_date( 'Y-m-d\TH:i:s' ),
		'tarif'          => tsv_antrag_schluessel( tsv_antrag_wert( $data, 'beitragsart' ) ),
		'mitglied_ab'    => tsv_antrag_datum( tsv_antrag_wert( $data, 'mitglied_ab' ) ),
		'abteilungen'    => $abteilungen,
		'anschrift'      => tsv_antrag_ohne_leere( [
			'strasse' => tsv_antrag_wert( $data, 'strasse_1' ),
			'plz'     => tsv_antrag_wert( $data, 'plz_1' ),
			'ort'     => tsv_antrag_wert( $data, 'ort_1' ),
		] ),
		'personen'       => $personen,
		'konto'          => tsv_antrag_ohne_leere( [
			'iban'         => strtoupper( preg_replace( '/\s+/', '', tsv_antrag_wert( $data, 'iban' ) ) ),
			'bic'          => strtoupper( preg_replace( '/\s+/', '', tsv_antrag_wert( $data, 'bic' ) ) ),
			'kontoinhaber' => $inhaber,
		] ),
		'unterschriften' => [
			'antrag' => tsv_antrag_ohne_leere( [
				'datum' => $datum,
				'name'  => $minderjaehrig ? ( '' !== $erziehungsberechtigt ? $erziehungsberechtigt : null ) : $name_p1,
				'als'   => $minderjaehrig ? 'erziehungsberechtigt' : 'selbst',
			] ),
			'sepa'   => tsv_antrag_ohne_leere( [ 'datum' => $datum, 'name' => $inhaber ] ),
		],
		'bestaetigt'     => [
			'datenschutz' => tsv_antrag_ja( $data, 'acceptance-dsgvo_einwilligung' ),
			'sepa_mandat' => tsv_antrag_ja( $data, 'acceptance-sepa_einwilligung' ),
		],
		'einwilligungen' => $einwilligungen,
		'bemerkung'      => tsv_antrag_wert( $data, 'bemerkung' ),
	] );
}
```

Inhalt von inc/eingang-sender.php:

```php
<?php
/**
 * Eingang-Sender – schickt Online-Aufnahmeanträge an das Eingangs-Skript der Mitgliederverwaltung.
 *
 * Zweck:       Nach dem Absenden der „Beitrittserklaerung“ (Contact Form 7) sendet dieses Modul den Antrag im Format
 *              „tsv-antrag-2“ (inc/antrag-generator.php) und das PDF mit Unterschrift (inc/pdf-generator.php) per HTTPS
 *              an das Eingangs-Skript (Apps Script, Repo Mitgliederverwaltung, eingang/). Dort landen beide im
 *              Drive-Ordner und in der Eingangstabelle. Die Access-XML bleibt nur für die Rückfall-Mail.
 * Einbau:      Child-Theme tsv-ergoldsbach-child, require in functions.php, Aufruf in tsv_beitritt_before_send()
 *              (inc/beitritt-hook.php) – siehe wordpress/LIESMICH.md im Repo Mitgliederverwaltung.
 * Konfiguration (wp-config.php, je Umgebung):
 *              TSV_EINGANG_AKTIV       true = senden; fehlt/false = alles wie bisher (nur Mail)
 *              TSV_EINGANG_URL         exec-URL des Eingangs-Skripts (https://script.google.com/macros/s/…/exec)
 *              TSV_EINGANG_SCHLUESSEL  gemeinsamer Schlüssel (mind. 32 Zeichen, aus einrichten() im Eingangs-Skript)
 * Sicherheit:  Der Schlüssel erlaubt nur das Abliefern, nicht das Lesen. Er steht nur in wp-config.php, nie in der
 *              Datenbank oder im Git. Fehler werden ohne personenbezogene Daten geloggt.
 * Besonderheiten:
 *   - Apps Script antwortet auf POST mit 302 auf script.googleusercontent.com. WordPress/Requests würde dort erneut
 *     POSTen (scheitert); deshalb ohne automatische Weiterleitung senden und der Weiterleitung per GET folgen.
 *   - Eine antrag_id je Antrag; bei Zeitüberschreitung wird EINMAL mit derselben ID wiederholt – das Skript legt
 *     dann keine zweite Zeile an.
 *   - Schlägt das Senden fehl, bleibt der bisherige Mailversand mit Anhängen als Rückfall (Aufrufer entscheidet).
 */

defined( 'ABSPATH' ) || exit;

const TSV_EINGANG_MAX_INHALT = 45000;   // Zellgrenze der Eingangstabelle (50 000 Zeichen)

/** Konfiguration aus wp-config.php (Filter „tsv_eingang_konfig“ für Tests). */
function tsv_eingang_konfig(): array {
	$k = [
		'aktiv'      => defined( 'TSV_EINGANG_AKTIV' ) && TSV_EINGANG_AKTIV === true,
		'url'        => defined( 'TSV_EINGANG_URL' ) ? (string) TSV_EINGANG_URL : '',
		'schluessel' => defined( 'TSV_EINGANG_SCHLUESSEL' ) ? (string) TSV_EINGANG_SCHLUESSEL : '',
	];
	return function_exists( 'apply_filters' ) ? (array) apply_filters( 'tsv_eingang_konfig', $k ) : $k;
}

/** Senden eingeschaltet und vollständig konfiguriert? */
function tsv_eingang_aktiv(): bool {
	$k = tsv_eingang_konfig();
	return ! empty( $k['aktiv'] )
		&& str_starts_with( $k['url'], 'https://script.google.com/macros/s/' )
		&& strlen( $k['schluessel'] ) >= 32;
}

/**
 * Antrag und PDF an das Eingangs-Skript senden.
 *
 * @param array       $antrag    Antrag „tsv-antrag-2“ aus tsv_antrag_erzeugen().
 * @param string      $pdf_path  Pfad des PDF mit Unterschrift ('' = keins).
 * @param string      $dateiname Dateiname ohne Endung, z. B. „tsv-beitritt-Mustermann-2026-10-25-213000“.
 * @param string|null $antrag_id Für Tests; sonst neue UUID.
 * @return array{ok: bool, fehler?: string, eingang_id?: string, doppelt?: bool}
 */
function tsv_eingang_senden( array $antrag, string $pdf_path, string $dateiname, ?string $antrag_id = null ): array {
	if ( ! tsv_eingang_aktiv() ) {
		return [ 'ok' => false, 'fehler' => 'inaktiv' ];
	}
	$k = tsv_eingang_konfig();
	if ( ( $antrag['format'] ?? '' ) !== 'tsv-antrag-2' || empty( $antrag['personen'] ) ) {
		return tsv_eingang_fehler( 'antrag_ungueltig' );
	}
	$inhalt = (string) wp_json_encode( $antrag );
	if ( mb_strlen( $inhalt, 'UTF-8' ) > TSV_EINGANG_MAX_INHALT ) {
		return tsv_eingang_fehler( 'antrag_zu_gross' );
	}
	$pdf       = ( '' !== $pdf_path && is_readable( $pdf_path ) ) ? (string) file_get_contents( $pdf_path ) : '';
	$antrag_id = $antrag_id ?? wp_generate_uuid4();
	$body      = wp_json_encode( [
		'schluessel' => $k['schluessel'],
		'antrag_id'  => $antrag_id,
		'dateiname'  => preg_replace( '/\.(xml|json|pdf)$/i', '', basename( $dateiname ) ),
		'antrag'     => $antrag,
		'pdf_base64' => '' === $pdf ? '' : base64_encode( $pdf ),
	] );

	$fehler = 'unbekannt';
	for ( $versuch = 1; $versuch <= 2; $versuch++ ) {
		$antwort = wp_remote_post( $k['url'], [
			'timeout'     => 25,
			'redirection' => 0,
			'headers'     => [ 'Content-Type' => 'application/json' ],
			'body'        => $body,
		] );
		if ( is_wp_error( $antwort ) ) {
			$fehler = 'verbindung';
			continue;   // einmal mit derselben antrag_id wiederholen
		}
		$code = (int) wp_remote_retrieve_response_code( $antwort );
		if ( in_array( $code, [ 301, 302, 303, 307 ], true ) ) {
			$ziel = (string) wp_remote_retrieve_header( $antwort, 'location' );
			if ( ! str_starts_with( $ziel, 'https://script.googleusercontent.com/' ) ) {
				$fehler = 'weiterleitung';
				break;
			}
			$antwort = wp_remote_get( $ziel, [ 'timeout' => 25, 'redirection' => 0 ] );
			if ( is_wp_error( $antwort ) ) {
				$fehler = 'verbindung';
				continue;
			}
			$code = (int) wp_remote_retrieve_response_code( $antwort );
		}
		$daten = json_decode( (string) wp_remote_retrieve_body( $antwort ), true );
		if ( 200 === $code && is_array( $daten ) && ! empty( $daten['ok'] ) ) {
			return [ 'ok' => true, 'eingang_id' => $antrag_id, 'doppelt' => ! empty( $daten['doppelt'] ) ];
		}
		$fehler = is_array( $daten ) && isset( $daten['fehler'] ) ? preg_replace( '/[^a-z_]/', '', (string) $daten['fehler'] ) : 'http_' . $code;
		if ( in_array( $fehler, [ 'nicht_berechtigt', 'ungueltig', 'nicht_eingerichtet', 'zu_viele' ], true ) ) {
			break;   // Wiederholen ändert nichts
		}
	}
	return tsv_eingang_fehler( $fehler );
}

/** Fehler loggen (nur Code, keine Antragsdaten) und zurückgeben. */
function tsv_eingang_fehler( string $code ): array {
	error_log( 'TSV Eingang: Senden fehlgeschlagen (' . $code . ')' );
	return [ 'ok' => false, 'fehler' => $code ];
}

/**
 * Text der internen Benachrichtigung, wenn der Antrag im Eingang liegt – OHNE Bank-, Adress- und Kontaktdaten.
 *
 * @param array $data Formulardaten wie in tsv_beitritt_before_send().
 */
function tsv_eingang_hinweis_text( array $data ): string {
	$namen = [];
	for ( $n = 1; $n <= 4; $n++ ) {
		$nach = trim( (string) ( $data[ 'nachname_' . $n ] ?? '' ) );
		$vor  = trim( (string) ( $data[ 'vorname_' . $n ] ?? '' ) );
		if ( '' !== $nach || '' !== $vor ) {
			$namen[] = trim( $nach . ', ' . $vor, ', ' );
		}
	}
	$abt = $data['abteilungen'] ?? [];
	$abt = is_array( $abt ) ? implode( ', ', array_map( 'strval', $abt ) ) : (string) $abt;
	return "Ein neuer Online-Aufnahmeantrag ist eingegangen und liegt in der Mitgliederverwaltung bereit:\n"
		. "Mitglieder → Beitritte aus XML importieren → „Online-Anträge von der Homepage“.\n\n"
		. 'Personen: ' . ( $namen ? implode( '; ', $namen ) : '–' ) . "\n"
		. 'Abteilungen: ' . ( '' !== $abt ? $abt : '–' ) . "\n\n"
		. "Antrag und unterschriebenes PDF liegen im geschützten Drive-Ordner. Diese Mail enthält bewusst keine Bankdaten.\n";
}
```
