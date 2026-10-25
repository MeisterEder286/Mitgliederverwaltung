/**
 * API Notizen – öffentliche Funktionen für interne Notizen, Rückfragen und Wiedervorlagen (google.script.run).
 *
 * Zweck:      Dünne Schicht über src/modul/Notizen.js; jede Funktion läuft über Api.ausfuehren (Rollenprüfung,
 *             generische Fehler, Messung).
 * Datenquelle: siehe Modul.
 * Wer darf was: notiz_lesen (offene Notizen) bzw. notiz_schreiben (alles Schreibende) – laut src/lib/rechte.js alle
 *             Rollen; Leserkreis und Zeilenschutz prüft das Modul (src/lib/notizen.js).
 * Besonderheiten: Rückfrage-Antwort liefert zusätzlich ein Sprungziel (sprung) für den Browser.
 */

function apiNotizSpeichern(werte) {
  return Api.ausfuehren('apiNotizSpeichern', 'notiz_schreiben', function (ktx) { return Notizen.speichern(ktx, werte || {}); });
}

function apiNotizErledigen(id, version, ergebnis) {
  return Api.ausfuehren('apiNotizErledigen', 'notiz_schreiben', function (ktx) {
    return Notizen.erledigen(ktx, Number(id), Number(version) || 0, ergebnis === undefined ? null : String(ergebnis));
  });
}

function apiNotizLoeschen(id, version) {
  return Api.ausfuehren('apiNotizLoeschen', 'notiz_schreiben', function (ktx) {
    return Notizen.loeschen(ktx, Number(id), Number(version) || 0);
  });
}

function apiNotizenOffen() {
  return Api.ausfuehren('apiNotizenOffen', 'notiz_lesen', function (ktx) { return Notizen.offene(ktx); });
}

/** Antwort auf eine Rückfrage: { entscheidung: 'konto_bleibt'|'eigenes_konto'|'ueberweisung', bemerkung }. */
function apiNotizRueckfrageAntwort(id, version, antwort) {
  return Api.ausfuehren('apiNotizRueckfrageAntwort', 'notiz_schreiben', function (ktx) {
    var a = antwort || {};
    return Notizen.rueckfrageAntwort(ktx, Number(id), Number(version) || 0,
      { entscheidung: String(a.entscheidung || ''), bemerkung: a.bemerkung === undefined ? null : String(a.bemerkung) });
  });
}

function apiNotizenExportVermerken(anzahl) {
  return Api.ausfuehren('apiNotizenExportVermerken', 'notiz_lesen', function (ktx) { return Notizen.exportVermerken(ktx, anzahl); });
}
