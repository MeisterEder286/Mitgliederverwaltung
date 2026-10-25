/**
 * API Beitritt – Beitritts-Anträge aus XML-Dateien (Access-Format) übernehmen.
 *
 * Zweck:      apiBeitrittVorschau zeigt je Antrag, was angelegt würde (vorläufige Nummern, Konto maskiert,
 *             Gemeinschaft, Dubletten, Warnungen); apiBeitrittImportieren legt alles an – je Antrag atomar.
 * Datenquelle: Die XML-Dateien liest der Browser; er schickt je Person die Felder als Texte (keine Dateien).
 * Wer darf was: Aktion mitglied_anlegen; zusätzlich prüft das Modul konto_bearbeiten (Bankdaten werden übernommen).
 * Besonderheiten: Logik in src/modul/Beitritt.js und src/lib/beitritt.js.
 */

/** antraege = [{ datei, personen: [{ Feld: 'Text' }] }] */
function apiBeitrittVorschau(antraege) {
  return Api.ausfuehren('apiBeitrittVorschau', 'mitglied_anlegen', function (ktx) { return BeitrittModul.vorschau(ktx, antraege); });
}

/** entscheidungen = [{ index, ueberspringen, gemeinschaft, personen: { personIndex: 'neu' | 'wiedereintritt' } }] */
function apiBeitrittImportieren(antraege, entscheidungen) {
  return Api.ausfuehren('apiBeitrittImportieren', 'mitglied_anlegen', function (ktx) { return BeitrittModul.importieren(ktx, antraege, entscheidungen); });
}
