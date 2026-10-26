<?php
/**
 * Test für wordpress/inc/eingang-sender.php ohne WordPress: minimale Stubs für die WP-HTTP-Funktionen.
 * Aufruf: php wordpress/tests/eingang-sender-test.php (über test/wordpress.test.js in npm test).
 * Ausgabe: je Prüfung „ok …“ bzw. „FEHLER …“, Exit-Code 1 bei Fehlern.
 */

define( 'ABSPATH', __DIR__ );

$GLOBALS['konfig']   = [ 'aktiv' => true, 'url' => 'https://script.google.com/macros/s/TEST/exec', 'schluessel' => str_repeat( 's', 40 ) ];
$GLOBALS['antworten'] = [];   // Warteschlange: je Aufruf eine Antwort (array oder WP_Error)
$GLOBALS['aufrufe']  = [];
$GLOBALS['log']      = [];

class WP_Error { public function __construct( public string $code = 'fehler' ) {} }
function apply_filters( $name, $wert ) { return 'tsv_eingang_konfig' === $name ? $GLOBALS['konfig'] : $wert; }
function wp_generate_uuid4() { return '00000000-0000-4000-8000-000000000001'; }
function wp_json_encode( $d ) { return json_encode( $d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ); }
function is_wp_error( $x ) { return $x instanceof WP_Error; }
function wp_remote_post( $url, $args ) { $GLOBALS['aufrufe'][] = [ 'POST', $url, $args ]; return array_shift( $GLOBALS['antworten'] ); }
function wp_remote_get( $url, $args ) { $GLOBALS['aufrufe'][] = [ 'GET', $url, $args ]; return array_shift( $GLOBALS['antworten'] ); }
function wp_remote_retrieve_response_code( $a ) { return $a['code'] ?? 0; }
function wp_remote_retrieve_body( $a ) { return $a['body'] ?? ''; }
function wp_remote_retrieve_header( $a, $h ) { return $a['headers'][ $h ] ?? ''; }
ini_set( 'error_log', '/dev/null' );
set_error_handler( null );

require dirname( __DIR__ ) . '/inc/eingang-sender.php';

$fehler = 0;
function pruefe( $bedingung, $text ) {
	global $fehler;
	echo ( $bedingung ? 'ok ' : 'FEHLER ' ) . $text . "\n";
	if ( ! $bedingung ) { $fehler++; }
}
function zuruecksetzen( array $antworten ) { $GLOBALS['antworten'] = $antworten; $GLOBALS['aufrufe'] = []; }
$weiter = [ 'code' => 302, 'headers' => [ 'location' => 'https://script.googleusercontent.com/macros/echo?user_content_key=x' ] ];
$ok     = [ 'code' => 200, 'body' => '{"ok":true,"eingang_id":"x"}' ];

$tmp = sys_get_temp_dir();
$xml = $tmp . '/tsv-beitritt-Beispiel-2026-10-25-213000.xml';
$pdf = $tmp . '/tsv-beitritt-Beispiel-2026-10-25-213000.pdf';
file_put_contents( $xml, file_get_contents( dirname( __DIR__, 2 ) . '/test/daten/beitritt/homepage.xml' ) );
file_put_contents( $pdf, "%PDF-1.4\n% synthetisch\n" );

// 1. Aktiv: POST ohne Weiterleitung, dann GET auf googleusercontent; Inhalt der Anfrage
zuruecksetzen( [ $weiter, $ok ] );
$r = tsv_eingang_senden( $xml, $pdf, '2026-10-25' );
pruefe( true === $r['ok'], 'Senden erfolgreich' );
pruefe( 2 === count( $GLOBALS['aufrufe'] ) && 'POST' === $GLOBALS['aufrufe'][0][0] && 'GET' === $GLOBALS['aufrufe'][1][0], 'POST, dann GET der Weiterleitung' );
pruefe( 0 === $GLOBALS['aufrufe'][0][2]['redirection'], 'POST ohne automatische Weiterleitung' );
$body = json_decode( $GLOBALS['aufrufe'][0][2]['body'], true );
pruefe( $body['schluessel'] === str_repeat( 's', 40 ) && '00000000-0000-4000-8000-000000000001' === $body['antrag_id'], 'Schlüssel und antrag_id im Body' );
pruefe( str_contains( $body['xml'], '<Daten16>' ) && "%PDF-1.4\n% synthetisch\n" === base64_decode( $body['pdf_base64'] ), 'XML und PDF (base64) im Body' );
pruefe( '2026-10-25' === $body['unterschrift_am'] && 'tsv-beitritt-Beispiel-2026-10-25-213000.xml' === $body['dateiname'], 'Unterschriftsdatum und Dateiname' );

// 2. Inaktiv bzw. unvollständig konfiguriert → nichts gesendet
foreach ( [ [ 'aktiv' => false ], [ 'url' => 'https://example.com/exec' ], [ 'schluessel' => 'kurz' ] ] as $aenderung ) {
	$alt = $GLOBALS['konfig'];
	$GLOBALS['konfig'] = array_merge( $alt, $aenderung );
	zuruecksetzen( [] );
	$r = tsv_eingang_senden( $xml, $pdf, '2026-10-25' );
	pruefe( false === $r['ok'] && 'inaktiv' === $r['fehler'] && 0 === count( $GLOBALS['aufrufe'] ), 'inaktiv: ' . key( $aenderung ) );
	$GLOBALS['konfig'] = $alt;
}

// 3. Verbindungsfehler → einmal wiederholt (gleiche antrag_id), dann ok
zuruecksetzen( [ new WP_Error( 'timeout' ), $weiter, [ 'code' => 200, 'body' => '{"ok":true,"doppelt":true}' ] ] );
$r = tsv_eingang_senden( $xml, $pdf, '2026-10-25' );
pruefe( true === $r['ok'] && true === $r['doppelt'], 'Wiederholung nach Zeitüberschreitung, Skript meldet doppelt' );
pruefe( $GLOBALS['aufrufe'][0][2]['body'] === $GLOBALS['aufrufe'][1][2]['body'], 'Wiederholung mit identischem Body (gleiche antrag_id)' );

// 4. Abweisung durch das Skript → keine Wiederholung
zuruecksetzen( [ $weiter, [ 'code' => 200, 'body' => '{"ok":false,"fehler":"nicht_berechtigt"}' ] ] );
$r = tsv_eingang_senden( $xml, $pdf, '2026-10-25' );
pruefe( false === $r['ok'] && 'nicht_berechtigt' === $r['fehler'] && 2 === count( $GLOBALS['aufrufe'] ), 'nicht_berechtigt ohne Wiederholung' );

// 5. Fremde Weiterleitung wird nicht verfolgt; zweimal Verbindungsfehler → Rückfall
zuruecksetzen( [ [ 'code' => 302, 'headers' => [ 'location' => 'https://boese.example/' ] ] ] );
$r = tsv_eingang_senden( $xml, $pdf, '2026-10-25' );
pruefe( 'weiterleitung' === $r['fehler'] && 1 === count( $GLOBALS['aufrufe'] ), 'fremde Weiterleitung nicht verfolgt' );
zuruecksetzen( [ new WP_Error(), new WP_Error() ] );
$r = tsv_eingang_senden( $xml, $pdf, '2026-10-25' );
pruefe( false === $r['ok'] && 'verbindung' === $r['fehler'] && 2 === count( $GLOBALS['aufrufe'] ), 'zweimal Verbindungsfehler → ok = false (Mail als Rückfall)' );

// 6. Ohne PDF, ungültiges Datum, fehlende/zu große XML
zuruecksetzen( [ $weiter, $ok ] );
$r = tsv_eingang_senden( $xml, '', '25.10.2026' );
$body = json_decode( $GLOBALS['aufrufe'][0][2]['body'], true );
pruefe( true === $r['ok'] && '' === $body['pdf_base64'] && '' === $body['unterschrift_am'], 'ohne PDF, Datum im falschen Format leer' );
zuruecksetzen( [] );
pruefe( 'xml_fehlt' === tsv_eingang_senden( $tmp . '/gibt-es-nicht.xml', $pdf, '2026-10-25' )['fehler'], 'XML fehlt' );
$gross = $tmp . '/tsv-gross.xml';
file_put_contents( $gross, str_repeat( 'x', TSV_EINGANG_MAX_XML + 1 ) );
pruefe( 'xml_zu_gross' === tsv_eingang_senden( $gross, $pdf, '2026-10-25' )['fehler'] && 0 === count( $GLOBALS['aufrufe'] ), 'XML zu groß, nichts gesendet' );

// 7. Hinweistext ohne Bank- und Adressdaten
$text = tsv_eingang_hinweis_text( [ 'nachname_1' => 'Beispiel', 'vorname_1' => 'Hans', 'nachname_2' => 'Beispiel', 'vorname_2' => 'Eva',
	'iban' => 'DE89370400440532013000', 'strasse_1' => 'Hauptstraße 5', 'email_1' => 'hans@example.com', 'abteilungen' => [ 'Fußball', 'Leichtathletik' ] ] );
pruefe( str_contains( $text, 'Beispiel, Hans; Beispiel, Eva' ) && str_contains( $text, 'Fußball, Leichtathletik' ), 'Hinweistext mit Namen und Abteilungen' );
pruefe( ! str_contains( $text, 'DE89' ) && ! str_contains( $text, 'Hauptstraße' ) && ! str_contains( $text, '@' ), 'Hinweistext ohne IBAN, Adresse, E-Mail' );

foreach ( [ $xml, $pdf, $gross ] as $d ) { @unlink( $d ); }
echo $fehler ? "\n$fehler Fehler\n" : "\nalle Prüfungen ok\n";
exit( $fehler ? 1 : 0 );
