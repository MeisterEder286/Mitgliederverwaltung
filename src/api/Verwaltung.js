/**
 * API Verwaltung – öffentliche Funktionen für den Browser (google.script.run).
 *
 * Zweck:      Benutzer & Rechte, Einstellungen (_Konfig), Stammdaten, Datenqualität, Hinweise und System.
 * Datenquelle: src/modul/Verwaltung.js.
 * Wer darf was: benutzer_verwalten, konfig_aendern, stammdaten_bearbeiten (Vorstand, Mitgliederverwalter) –
 *             je Funktion über Api.ausfuehren geprüft.
 * Besonderheiten: keine.
 */

function apiVerwaltungBenutzer() {
  return Api.ausfuehren('apiVerwaltungBenutzer', 'benutzer_verwalten', function (ktx) { return Verwaltung.benutzer(ktx); });
}

function apiVerwaltungBenutzerSpeichern(id, version, werte) {
  return Api.ausfuehren('apiVerwaltungBenutzerSpeichern', 'benutzer_verwalten', function (ktx) {
    return Verwaltung.benutzerSpeichern(ktx, id || null, version, werte);
  });
}

function apiVerwaltungKonfig() {
  return Api.ausfuehren('apiVerwaltungKonfig', 'konfig_aendern', function (ktx) { return Verwaltung.konfig(ktx); });
}

function apiVerwaltungKonfigSpeichern(schluessel, wert, bisher) {
  return Api.ausfuehren('apiVerwaltungKonfigSpeichern', 'konfig_aendern', function (ktx) {
    return Verwaltung.konfigSpeichern(ktx, schluessel, wert, bisher);
  });
}

function apiVerwaltungStammdaten(tab) {
  return Api.ausfuehren('apiVerwaltungStammdaten', 'stammdaten_bearbeiten', function (ktx) { return Verwaltung.stammdaten(ktx, String(tab)); });
}

function apiVerwaltungStammdatenSpeichern(tab, id, version, werte) {
  return Api.ausfuehren('apiVerwaltungStammdatenSpeichern', 'stammdaten_bearbeiten', function (ktx) {
    return Verwaltung.stammdatenSpeichern(ktx, String(tab), id || null, version, werte);
  });
}

function apiVerwaltungPruefregeln() {
  return Api.ausfuehren('apiVerwaltungPruefregeln', 'stammdaten_bearbeiten', function (ktx) { return Verwaltung.pruefung(ktx); });
}

function apiVerwaltungPruefregelnZusammenfassung() {
  return Api.ausfuehren('apiVerwaltungPruefregelnZusammenfassung', 'stammdaten_bearbeiten', function () {
    return Verwaltung.pruefungZusammenfassung();
  });
}

function apiVerwaltungHinweise() {
  return Api.ausfuehren('apiVerwaltungHinweise', 'konfig_aendern', function (ktx) { return Verwaltung.hinweise(ktx); });
}

function apiVerwaltungSystem() {
  return Api.ausfuehren('apiVerwaltungSystem', 'konfig_aendern', function (ktx) { return Verwaltung.system(ktx); });
}

function apiVerwaltungSnapshotNeu() {
  return Api.ausfuehren('apiVerwaltungSnapshotNeu', 'konfig_aendern', function (ktx) { return Verwaltung.snapshotNeu(ktx); });
}
