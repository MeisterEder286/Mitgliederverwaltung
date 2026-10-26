<?php
/**
 * Test für wordpress/inc/antrag-generator.php und wordpress/inc/eingang-sender.php ohne WordPress (Stubs).
 * Aufruf: php wordpress/tests/eingang-sender-test.php [--beispiel]
 *   ohne Argument: Prüfungen, Ausgabe „ok …“/„FEHLER …“, Exit-Code 1 bei Fehlern (über test/wordpress.test.js)
 *   --beispiel:    gibt nur den erzeugten Antrag (Familie, Kind) als JSON aus – test/wordpress.test.js prüft damit,
 *                  dass die Mitgliederverwaltung genau das versteht, was WordPress erzeugt.
 */

define( 'ABSPATH', __DIR__ );

$GLOBALS['konfig']    = [ 'aktiv' => true, 'url' => 'https://script.google.com/macros/s/TEST/exec', 'schluessel' => str_repeat( 's', 40 ) ];
$GLOBALS['antworten'] = [];   // Warteschlange: je Aufruf eine Antwort (array oder WP_Error)
$GLOBALS['aufrufe']   = [];

class WP_Error { public function __construct( public string $code = 'fehler' ) {} }
function apply_filters( $name, $wert ) { return 'tsv_eingang_konfig' === $name ? $GLOBALS['konfig'] : $wert; }
function wp_generate_uuid4() { return '00000000-0000-4000-8000-000000000001'; }
function wp_json_encode( $d ) { return json_encode( $d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ); }
function wp_date( $f ) { return '2026-10-25T21:30:00'; }
function is_wp_error( $x ) { return $x instanceof WP_Error; }
function wp_remote_post( $url, $args ) { $GLOBALS['aufrufe'][] = [ 'POST', $url, $args ]; return array_shift( $GLOBALS['antworten'] ); }
function wp_remote_get( $url, $args ) { $GLOBALS['aufrufe'][] = [ 'GET', $url, $args ]; return array_shift( $GLOBALS['antworten'] ); }
function wp_remote_retrieve_response_code( $a ) { return $a['code'] ?? 0; }
function wp_remote_retrieve_body( $a ) { return $a['body'] ?? ''; }
function wp_remote_retrieve_header( $a, $h ) { return $a['headers'][ $h ] ?? ''; }
ini_set( 'error_log', '/dev/null' );

require dirname( __DIR__ ) . '/inc/antrag-generator.php';
require dirname( __DIR__ ) . '/inc/eingang-sender.php';

// Formulardaten wie von Contact Form 7 (Radio/Checkbox als Liste), erfunden
$familie = [
	'beitragsart' => [ 'familienbeitrag' ], 'mitglied_ab' => '2026-11-01', 'abteilungen' => [ 'fussball', 'Fitness Turnen' ],
	'anrede_1' => [ 'Herr' ], 'titel_1' => 'Dr.', 'nachname_1' => 'Wpbeispiel', 'vorname_1' => 'Hans', 'gebdat_1' => '1980-01-02',
	'strasse_1' => 'Hauptstraße 5', 'plz_1' => '84066', 'ort_1' => 'Ergoldsbach', 'telefon_1' => '08771 12345', 'handy_1' => '',
	'email_1' => 'hans@example.com',
	'anrede_2' => [ 'Frau' ], 'nachname_2' => 'Wpbeispiel', 'vorname_2' => 'Anna', 'gebdat_2' => '1982-05-06', 'email_2' => '',
	'anrede_3' => [ 'Herr' ], 'nachname_3' => 'Wpbeispiel', 'vorname_3' => 'Lukas', 'gebdat_3' => '2012-09-30',
	'anrede_4' => [ '' ], 'nachname_4' => '', 'vorname_4' => '',
	'iban' => 'de89 3704 0044 0532 0130 00', 'bic' => 'cobadeffxxx', 'bank_name' => 'Testbank', 'kontoinhaber' => '',
	'acceptance-dsgvo_einwilligung' => '1', 'acceptance-sepa_einwilligung' => '1',
	'einwilligung_fotos' => '1', 'einwilligung_newsletter' => '', 'einwilligung_ehrungen' => [ '1' ],
	'tsv_signature_1' => 'data:image/png;base64,AAAA', 'tsv_signature_2' => 'data:image/png;base64,BBBB',
];
$kind = [
	'beitragsart' => [ 'kind' ], 'mitglied_ab' => '2026-11-01', 'abteilungen' => [ 'fussball' ],
	'anrede_1' => [ 'Frau' ], 'nachname_1' => 'Wpkind', 'vorname_1' => 'Mia', 'gebdat_1' => '2016-05-06',
	'strasse_1' => 'Am Bach 3a', 'plz_1' => '84061', 'ort_1' => 'Ergoldsbach', 'email_1' => 'eltern@example.com',
	'iban' => 'DE89370400440532013000', 'kontoinhaber' => 'Petra Wpkind',
	'acceptance-dsgvo_einwilligung' => '1', 'acceptance-sepa_einwilligung' => '1', 'einwilligung_fotos' => '1',
];

if ( in_array( '--beispiel', $argv, true ) ) {
	echo wp_json_encode( [ 'familie' => tsv_antrag_erzeugen( $familie, '2026-10-25' ), 'kind' => tsv_antrag_erzeugen( $kind, '2026-10-24' ) ] );
	exit( 0 );
}

$fehler = 0;
function pruefe( $bedingung, $text ) {
	global $fehler;
	echo ( $bedingung ? 'ok ' : 'FEHLER ' ) . $text . "\n";
	if ( ! $bedingung ) { $fehler++; }
}
function zuruecksetzen( array $antworten ) { $GLOBALS['antworten'] = $antworten; $GLOBALS['aufrufe'] = []; }

// ---------- Generator
$a = tsv_antrag_erzeugen( $familie, '2026-10-25' );
pruefe( 'tsv-antrag-2' === $a['format'] && 'familienbeitrag' === $a['tarif'] && '2026-11-01' === $a['mitglied_ab'], 'Format, Tarif-Schlüssel, Eintritt' );
pruefe( [ 'fussball', 'fitness-turnen' ] === $a['abteilungen'], 'Abteilungen als Schlüssel' );
pruefe( 3 === count( $a['personen'] ), 'leere Person 4 nicht übernommen' );
pruefe( 'm' === $a['personen'][0]['geschlecht'] && 'w' === $a['personen'][1]['geschlecht'] && '08771 12345' === $a['personen'][0]['telefon'], 'Geschlecht aus Anrede, Telefon bei Person 1' );
pruefe( ! isset( $a['personen'][0]['handy'] ) && ! isset( $a['personen'][1]['email'] ), 'leere Felder weggelassen' );
pruefe( 'DE89370400440532013000' === $a['konto']['iban'] && 'COBADEFFXXX' === $a['konto']['bic'] && 'Hans Wpbeispiel' === $a['konto']['kontoinhaber'], 'Konto: IBAN normalisiert, Inhaber = Person 1 wenn leer' );
pruefe( [ 'datum' => '2026-10-25', 'name' => 'Hans Wpbeispiel', 'als' => 'selbst' ] === $a['unterschriften']['antrag'], 'Unterschrift Antrag: selbst' );
pruefe( [ 'fotos' => true, 'newsletter' => false, 'ehrungen' => true ] === $a['einwilligungen'], 'Einwilligungen' );
pruefe( true === $a['bestaetigt']['datenschutz'] && true === $a['bestaetigt']['sepa_mandat'], 'Bestätigungen' );
$text = wp_json_encode( $a );
pruefe( ! str_contains( $text, 'base64' ) && ! str_contains( $text, 'Testbank' ) && ! preg_match( '/"(betrag|gesamtbeitrag|festbetrag)"/i', $text ), 'keine Signaturen, keine Bank, keine Beträge im Antrag' );
$k = tsv_antrag_erzeugen( $kind, '2026-10-24' );
pruefe( [ 'datum' => '2026-10-24', 'name' => 'Petra Wpkind', 'als' => 'erziehungsberechtigt' ] === $k['unterschriften']['antrag'], 'Kind: Erziehungsberechtigte (Kontoinhaber) unterschreibt' );
pruefe( [ 'fotos' => true ] === $k['einwilligungen'], 'nur vorhandene Einwilligungsfelder' );
$k2 = tsv_antrag_erzeugen( array_merge( $kind, [ 'erziehungsberechtigter_name' => 'Paul Wpkind' ] ), '2026-10-24' );
pruefe( 'Paul Wpkind' === $k2['unterschriften']['antrag']['name'], 'Feld erziehungsberechtigter_name hat Vorrang' );
pruefe( 'fitness-turnen' === tsv_antrag_schluessel( 'Fitness Turnen' ) && 'fussball' === tsv_antrag_schluessel( 'Fußball' ), 'Schlüssel vereinheitlicht' );

// ---------- Sender
$weiter = [ 'code' => 302, 'headers' => [ 'location' => 'https://script.googleusercontent.com/macros/echo?user_content_key=x' ] ];
$ok     = [ 'code' => 200, 'body' => '{"ok":true,"eingang_id":"x"}' ];
$pdf    = sys_get_temp_dir() . '/tsv-beitritt-Wpbeispiel-2026-10-25-213000.pdf';
file_put_contents( $pdf, "%PDF-1.4\n% synthetisch\n" );

zuruecksetzen( [ $weiter, $ok ] );
$r = tsv_eingang_senden( $a, $pdf, 'tsv-beitritt-Wpbeispiel-2026-10-25-213000.xml' );
pruefe( true === $r['ok'], 'Senden erfolgreich' );
pruefe( 2 === count( $GLOBALS['aufrufe'] ) && 'POST' === $GLOBALS['aufrufe'][0][0] && 'GET' === $GLOBALS['aufrufe'][1][0] && 0 === $GLOBALS['aufrufe'][0][2]['redirection'], 'POST ohne Weiterleitung, dann GET' );
$body = json_decode( $GLOBALS['aufrufe'][0][2]['body'], true );
pruefe( $body['schluessel'] === str_repeat( 's', 40 ) && '00000000-0000-4000-8000-000000000001' === $body['antrag_id'], 'Schlüssel und antrag_id' );
pruefe( $body['antrag'] === $a && ! isset( $body['xml'] ), 'Antrag als Objekt, keine XML' );
pruefe( "%PDF-1.4\n% synthetisch\n" === base64_decode( $body['pdf_base64'] ) && 'tsv-beitritt-Wpbeispiel-2026-10-25-213000' === $body['dateiname'], 'PDF und Dateiname ohne Endung' );

foreach ( [ [ 'aktiv' => false ], [ 'url' => 'https://example.com/exec' ], [ 'schluessel' => 'kurz' ] ] as $aenderung ) {
	$alt = $GLOBALS['konfig'];
	$GLOBALS['konfig'] = array_merge( $alt, $aenderung );
	zuruecksetzen( [] );
	$r = tsv_eingang_senden( $a, $pdf, 'x' );
	pruefe( 'inaktiv' === $r['fehler'] && 0 === count( $GLOBALS['aufrufe'] ), 'inaktiv: ' . key( $aenderung ) );
	$GLOBALS['konfig'] = $alt;
}

zuruecksetzen( [ new WP_Error( 'timeout' ), $weiter, [ 'code' => 200, 'body' => '{"ok":true,"doppelt":true}' ] ] );
$r = tsv_eingang_senden( $a, $pdf, 'x' );
pruefe( true === $r['ok'] && true === $r['doppelt'] && $GLOBALS['aufrufe'][0][2]['body'] === $GLOBALS['aufrufe'][1][2]['body'], 'Wiederholung mit gleicher antrag_id, Skript meldet doppelt' );

zuruecksetzen( [ $weiter, [ 'code' => 200, 'body' => '{"ok":false,"fehler":"nicht_berechtigt"}' ] ] );
$r = tsv_eingang_senden( $a, $pdf, 'x' );
pruefe( 'nicht_berechtigt' === $r['fehler'] && 2 === count( $GLOBALS['aufrufe'] ), 'nicht_berechtigt ohne Wiederholung' );

zuruecksetzen( [ [ 'code' => 302, 'headers' => [ 'location' => 'https://boese.example/' ] ] ] );
pruefe( 'weiterleitung' === tsv_eingang_senden( $a, $pdf, 'x' )['fehler'] && 1 === count( $GLOBALS['aufrufe'] ), 'fremde Weiterleitung nicht verfolgt' );
zuruecksetzen( [ new WP_Error(), new WP_Error() ] );
pruefe( 'verbindung' === tsv_eingang_senden( $a, $pdf, 'x' )['fehler'] && 2 === count( $GLOBALS['aufrufe'] ), 'zweimal Verbindungsfehler → Rückfall' );

zuruecksetzen( [] );
pruefe( 'antrag_ungueltig' === tsv_eingang_senden( [ 'format' => 'alt' ], $pdf, 'x' )['fehler'], 'falsches Format nicht gesendet' );
$gross = $a;
$gross['bemerkung'] = str_repeat( 'x', TSV_EINGANG_MAX_INHALT );
pruefe( 'antrag_zu_gross' === tsv_eingang_senden( $gross, $pdf, 'x' )['fehler'] && 0 === count( $GLOBALS['aufrufe'] ), 'zu großer Antrag nicht gesendet' );
zuruecksetzen( [ $weiter, $ok ] );
tsv_eingang_senden( $a, '', 'x' );
pruefe( '' === json_decode( $GLOBALS['aufrufe'][0][2]['body'], true )['pdf_base64'], 'ohne PDF' );

$text = tsv_eingang_hinweis_text( $familie );
pruefe( str_contains( $text, 'Wpbeispiel, Hans; Wpbeispiel, Anna; Wpbeispiel, Lukas' ) && str_contains( $text, 'fussball, Fitness Turnen' ), 'Hinweistext mit Namen und Abteilungen' );
pruefe( ! str_contains( $text, 'DE89' ) && ! str_contains( $text, 'Hauptstraße' ) && ! str_contains( $text, '@' ), 'Hinweistext ohne IBAN, Adresse, E-Mail' );

@unlink( $pdf );
echo $fehler ? "\n$fehler Fehler\n" : "\nalle Prüfungen ok\n";
exit( $fehler ? 1 : 0 );
