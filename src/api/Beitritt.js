/**
 * API Beitritt – Beitritts-Anträge aus XML-Dateien (Access-Format) übernehmen.
 *
 * Zweck:      apiBeitrittVorschau zeigt je Antrag, was angelegt würde (vorläufige Nummern, Konto maskiert,
 *             Gemeinschaft, Dubletten, Warnungen); apiBeitrittImportieren legt alles an – je Antrag atomar.
 * Datenquelle: Die XML-Dateien liest der Browser; er schickt je Person die Felder als Texte (keine Dateien).
 * Wer darf was: Aktion mitglied_anlegen; zusätzlich prüft das Modul konto_bearbeiten (Bankdaten werden übernommen).
 * Besonderheiten: Logik in src/modul/Beitritt.js und src/lib/beitritt.js. Online-Anträge von der Homepage kommen
 *             aus der getrennten Eingangstabelle (apiBeitrittEingang…, src/lib/eingang.js): dort zerlegt der Server
 *             die XML, der Browser schickt nur eingang_id und Entscheidungen.
 */

/** antraege = [{ datei, personen: [{ Feld: 'Text' }] }] */
function apiBeitrittVorschau(antraege) {
  return Api.ausfuehren('apiBeitrittVorschau', 'mitglied_anlegen', function (ktx) { return BeitrittModul.vorschau(ktx, antraege); });
}

/** entscheidungen = [{ index, ueberspringen, gemeinschaft, personen: { personIndex: 'neu' | 'wiedereintritt' } }] */
function apiBeitrittImportieren(antraege, entscheidungen) {
  return Api.ausfuehren('apiBeitrittImportieren', 'mitglied_anlegen', function (ktx) { return BeitrittModul.importieren(ktx, antraege, entscheidungen); });
}

/** Online-Anträge von der Homepage: offene (nur Namen) und zuletzt erledigte. */
function apiBeitrittEingang() {
  return Api.ausfuehren('apiBeitrittEingang', 'mitglied_anlegen', function (ktx) { return BeitrittModul.eingang(ktx); });
}

/** Zahl offener Online-Anträge (Startseite); null = Eingang nicht eingerichtet. */
function apiBeitrittEingangAnzahl() {
  return Api.ausfuehren('apiBeitrittEingangAnzahl', 'mitglied_anlegen', function (ktx) { return BeitrittModul.eingangAnzahl(ktx); });
}

/** ids = [eingang_id] */
function apiBeitrittEingangVorschau(ids) {
  return Api.ausfuehren('apiBeitrittEingangVorschau', 'mitglied_anlegen', function (ktx) { return BeitrittModul.eingangVorschau(ktx, ids); });
}

/** entscheidungen = [{ eingang_id, ueberspringen, gemeinschaft, personen: { personIndex: 'neu' | 'wiedereintritt' } }] */
function apiBeitrittEingangImportieren(ids, entscheidungen) {
  return Api.ausfuehren('apiBeitrittEingangImportieren', 'mitglied_anlegen', function (ktx) { return BeitrittModul.eingangImportieren(ktx, ids, entscheidungen); });
}

/** Online-Antrag nicht übernehmen (z. B. doppelt abgeschickt); grund bleibt in der Eingangstabelle. */
function apiBeitrittEingangAblehnen(id, grund) {
  return Api.ausfuehren('apiBeitrittEingangAblehnen', 'mitglied_anlegen', function (ktx) { return BeitrittModul.eingangAblehnen(ktx, String(id || ''), String(grund || '').slice(0, 200)); });
}
