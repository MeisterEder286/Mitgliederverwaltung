/**
 * Einheitlicher Rahmen für jede vom Browser aufrufbare Server-Funktion.
 *
 * Zweck:      Jede öffentliche Funktion (google.script.run) läuft durch Api.ausfuehren. Dort passiert
 *             immer dasselbe: Zeitmessung starten, Rolle prüfen (Sicherheitsregel A2), Fachfunktion
 *             ausführen, Fehler in eine generische Antwort übersetzen (A9), Messung beenden.
 * Datenquelle: keine eigene; nutzt Zugriff (Tab Benutzer), Messung, DB-Zähler.
 * Wer darf was: entscheidet Zugriff.pruefe(aktion) anhand der Rechtematrix (lib/rechte.js).
 * Besonderheiten:
 *   - Antwortformat: { ok: true, daten, messung } oder { ok: false, fehler: { art, meldung, nr, felder? }, messung }.
 *   - Interne Fehler bekommen eine kurze Fehler-Nr.; Details (Stacktrace) stehen nur im Server-Log
 *     (console.error → Ausführungsprotokoll), nie in der Antwort.
 *   - Messwerk: Prüfkette, Handler und Ansicht (JSON) sind Abschnitte der Messung. Hat der Aufruf den Bericht angefordert
 *     (apiMessen, doGet?messen=1) und die Rolle messung_lesen, hängt _mess an der Antwort (docs/LEISTUNG.md).
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
    var h = null, ktx = null, antwort, ok = false, diagnose = false;
    try { diagnose = Messung.diagnoseUebernehmen ? Messung.diagnoseUebernehmen() : false; } catch (e) { diagnose = false; }
    try { h = Messung.start(name); } catch (e) { h = null; }
    var abschnitt = (Messung.abschnitt || function (n, f) { return f(); });
    try {
      if (typeof DB !== 'undefined' && DB.zaehlerZuruecksetzen) DB.zaehlerZuruecksetzen();
      if (typeof DB !== 'undefined' && DB.vorratLeeren) DB.vorratLeeren();
      ktx = abschnitt('pruefkette', function () { return Zugriff.pruefe(aktion); });
      var roh = abschnitt('handler', function () { return fn(ktx); });
      antwort = { ok: true, daten: abschnitt('ansicht', function () { return sauber(roh); }) };
      ok = true;
    } catch (e) {
      var art = Fehler.artVon(e);
      if (art) {
        antwort = { ok: false, fehler: { art: art, meldung: e.meldung } };
        // Bei Versionskonflikt KEINEN Datensatz mitschicken: er wäre nicht nach Rolle geschnitten (bei Beitragskonto
        // stünde die IBAN im Klartext darin – Befund H2). Der Browser lädt den Snapshot ohnehin neu (App.ladeNeu).
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
      // Messwerk-Bericht nur auf ausdrückliche Anforderung UND nur für Rollen mit messung_lesen (Admin-Bereich).
      // Abgewiesene oder nicht identifizierte Aufrufer (ktx null) bekommen ihn nie.
      try {
        if (antwort && diagnose && ktx && Rechte.darf(ktx, 'messung_lesen') && Messung.bericht) antwort._mess = Messung.bericht();
      } catch (e3) { /* Messen darf nichts stören */ }
    }
    return antwort;
  }

  return { ausfuehren: ausfuehren };
})();
