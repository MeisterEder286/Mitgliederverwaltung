/**
 * API Nachweise – öffentliche Server-Funktionen der Ansicht „Nachweise“ (Führungszeugnisse, Lizenzen).
 *
 * Zweck:      Rolle prüfen (Api.ausfuehren) und an NachweiseModul (src/modul/Nachweise.js) übergeben.
 * Datenquelle: siehe NachweiseModul.
 * Wer darf was: lesen/Export qualifikation_lesen; erfassen, ändern, löschen, Fristen neu berechnen
 *             qualifikation_erfassen (Zeilenschutz im Modul).
 * Besonderheiten: § 72a SGB VIII – niemals Inhalte eines Führungszeugnisses erfassen.
 */

function apiNachweiseUebersicht() {
  return Api.ausfuehren('apiNachweiseUebersicht', 'qualifikation_lesen', function (ktx) { return NachweiseModul.uebersicht(ktx); });
}

function apiNachweiseErfassen(eingabe) {
  return Api.ausfuehren('apiNachweiseErfassen', 'qualifikation_erfassen', function (ktx) { return NachweiseModul.erfassen(ktx, eingabe); });
}

function apiNachweiseAendern(qualifikationId, version, eingabe) {
  return Api.ausfuehren('apiNachweiseAendern', 'qualifikation_erfassen', function (ktx) {
    return NachweiseModul.aendern(ktx, qualifikationId, version, eingabe);
  });
}

function apiNachweiseLoeschen(eintraege) {
  return Api.ausfuehren('apiNachweiseLoeschen', 'qualifikation_erfassen', function (ktx) { return NachweiseModul.loeschen(ktx, eintraege); });
}

function apiNachweiseFristenAktualisieren() {
  return Api.ausfuehren('apiNachweiseFristenAktualisieren', 'qualifikation_erfassen', function (ktx) {
    return NachweiseModul.fristenAktualisieren(ktx);
  });
}

function apiNachweiseExport() {
  return Api.ausfuehren('apiNachweiseExport', 'qualifikation_lesen', function (ktx) { return NachweiseModul.exportiere(ktx); });
}
