/**
 * Einheitlicher Rahmen für jede vom Browser aufrufbare Server-Funktion.
 *
 * Zweck:      Jede öffentliche Funktion (google.script.run) läuft durch Api.ausfuehren. Dort passiert
 *             immer dasselbe: Zeitmessung starten, Rolle prüfen (Sicherheitsregel A2), Fachfunktion
 *             ausführen, Fehler in eine generische Antwort übersetzen (A9), Messung beenden.
 * Datenquelle: keine eigene; nutzt Zugriff (Tab Benutzer), Messung, DB-Zähler.
 * Wer darf was: entscheidet Zugriff.pruefe(aktion) anhand der Rechtematrix (lib/rechte.js).
 * Besonderheiten:
 *   - Antwortformat: { ok: true, daten, messung } oder { ok: false, fehler: { art, meldung, nr, aktuell?, felder? }, messung }.
 *   - Interne Fehler bekommen eine kurze Fehler-Nr.; Details (Stacktrace) stehen nur im Server-Log
 *     (console.error → Ausführungsprotokoll), nie in der Antwort.
 *   - Die Antwort wird JSON-sauber gemacht (google.script.run verträgt keine Date-Objekte und kein undefined
 *     in Arrays).
 */
var Api = (function () {
  var INTERN = 'Es ist ein Fehler aufgetreten. Bitte erneut versuchen oder die Verwaltung informieren (Fehler-Nr. ';

  function fehlerNr() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  /** Macht beliebige Daten für google.script.run übertragbar. */
  function sauber(x) {
    return x === undefined ? null : JSON.parse(JSON.stringify(x));
  }

  function ausfuehren(name, aktion, fn) {
    var h = null, ktx = null, antwort, ok = false;
    try { h = Messung.start(name); } catch (e) { h = null; }
    try {
      if (typeof DB !== 'undefined' && DB.zaehlerZuruecksetzen) DB.zaehlerZuruecksetzen();
      if (typeof DB !== 'undefined' && DB.vorratLeeren) DB.vorratLeeren();
      ktx = Zugriff.pruefe(aktion);
      antwort = { ok: true, daten: sauber(fn(ktx)) };
      ok = true;
    } catch (e) {
      var art = Fehler.artVon(e);
      if (art) {
        antwort = { ok: false, fehler: { art: art, meldung: e.meldung } };
        if (art === 'konflikt') antwort.fehler.aktuell = sauber(e.aktuell);
        if (e.felder) antwort.fehler.felder = sauber(e.felder);
      } else {
        var nr = fehlerNr();
        console.error('Fehler-Nr. ' + nr + ' in ' + name + ': ' + (e && e.message) + '\n' + (e && e.stack));
        antwort = { ok: false, fehler: { art: 'intern', meldung: INTERN + nr + ').', nr: nr } };
      }
    } finally {
      var messung = null;
      try {
        var cache = (typeof Snapshot !== 'undefined' && Snapshot.letzterCache) ? Snapshot.letzterCache() : null;
        messung = Messung.ende(h, { ok: ok, rollen: ktx ? ktx.rollen : null, cache: cache });
      } catch (e2) { messung = null; }
      if (antwort) antwort.messung = messung;
    }
    return antwort;
  }

  return { ausfuehren: ausfuehren };
})();
