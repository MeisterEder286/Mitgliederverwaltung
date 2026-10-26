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
