/**
 * API Berichte – öffentliche Server-Funktionen der Ansicht „Berichte“ (BLSV, Statistik, Listen).
 *
 * Zweck:      Rolle prüfen (Api.ausfuehren) und an BerichteModul (src/modul/Berichte.js) übergeben.
 * Datenquelle: siehe BerichteModul.
 * Wer darf was: Aktion export (alle lesenden Berichte; Vereinszahlen nur mit Zeilensicht „alle“ – im Modul);
 *             Einfrieren der Jahresstatistik: Aktion konfig_aendern.
 * Besonderheiten: apiBerichteExportProtokollieren meldet einen im Browser erzeugten Export (CSV/Druck einer
 *             Liste, deren Daten der Browser schon hat) ins Protokoll – Nachvollziehbarkeit statt Sperre.
 */

function apiBerichteBlsv(stichtag) {
  return Api.ausfuehren('apiBerichteBlsv', 'export', function (ktx) { return BerichteModul.blsv(ktx, stichtag); });
}

function apiBerichteBlsvExport(stichtag) {
  return Api.ausfuehren('apiBerichteBlsvExport', 'export', function (ktx) { return BerichteModul.blsvExport(ktx, stichtag); });
}

function apiBerichteStatistikEinfrieren(jahr, stichtag, gemeldetAm) {
  return Api.ausfuehren('apiBerichteStatistikEinfrieren', 'konfig_aendern', function (ktx) {
    return BerichteModul.einfrieren(ktx, jahr, stichtag, gemeldetAm);
  });
}

function apiBerichteJahresvergleich() {
  return Api.ausfuehren('apiBerichteJahresvergleich', 'export', function (ktx) { return BerichteModul.jahresvergleich(ktx); });
}

function apiBerichteGeburtstage(von, bis) {
  return Api.ausfuehren('apiBerichteGeburtstage', 'export', function (ktx) { return BerichteModul.geburtstage(ktx, von, bis); });
}

function apiBerichteJubilaeen(jahr) {
  return Api.ausfuehren('apiBerichteJubilaeen', 'export', function (ktx) { return BerichteModul.jubilaeen(ktx, jahr); });
}

function apiBerichteAbteilungen() {
  return Api.ausfuehren('apiBerichteAbteilungen', 'export', function (ktx) { return BerichteModul.abteilungen(ktx); });
}

function apiBerichteBewegungen(von, bis) {
  return Api.ausfuehren('apiBerichteBewegungen', 'export', function (ktx) { return BerichteModul.bewegungen(ktx, von, bis); });
}

/** Im Browser erzeugten Export protokollieren (liste: Bezeichnung, anzahl: Zeilen). */
function apiBerichteExportProtokollieren(liste, anzahl) {
  return Api.ausfuehren('apiBerichteExportProtokollieren', 'export', function (ktx) {
    BerichteModul.exportiert(ktx, String(liste || 'Liste').slice(0, 120), Number(anzahl) || 0);
    return true;
  });
}
