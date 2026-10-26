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
