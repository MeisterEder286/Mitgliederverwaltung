/**
 * Zeitmessung je Server-Aufruf (Auftragspunkt 8, Verbesserung V9).
 *
 * Zweck:      Misst Laufzeit und Zahl der Tabellenzugriffe jeder öffentlichen Funktion. Der Messwert geht mit
 *             der Antwort an den Browser und zusätzlich in einen Puffer im Script-Cache. Ein stündlicher
 *             Trigger schreibt den Puffer gesammelt in den Tab „_Messung“ – so kostet nicht jede
 *             Nutzeraktion einen eigenen Schreibzugriff.
 * Datenquelle: Script-Cache (Schlüssel messung:puffer), Tab „_Messung“.
 * Wer darf was: Auswertung nur mit Aktion messung_lesen (Admin-Bereich). Keine E-Mail-Adressen in den
 *             Messwerten, nur Rollen (Datensparsamkeit).
 * Besonderheiten:
 *   - Messen darf einen Aufruf nie scheitern lassen: Alle Cache-Fehler werden geschluckt.
 *   - Der Puffer wird ohne Sperre gelesen und geschrieben. Bei gleichzeitigen Aufrufen kann ein Messwert
 *     verloren gehen – bewusst in Kauf genommen (Messwerte, keine Fachdaten).
 *   - Läuft der Cache ab (spätestens nach 6 h), sind ungeschriebene Messwerte weg. Ebenfalls akzeptiert.
 */
var Messung = (function () {
  var PUFFER = 'messung:puffer';
  var CACHE_SEKUNDEN = 21600; // 6 h, Höchstwert des CacheService
  var TAB = '_Messung';

  function jetzt() {
    try { return DB.jetzt(); } catch (e) { return new Date().toISOString().slice(0, 19); }
  }

  function maxPuffer() {
    try { return Number(Konfig.wert('messung_puffer_max')) || 500; } catch (e) { return 500; }
  }

  function lesePuffer() {
    try {
      var roh = CacheService.getScriptCache().get(PUFFER);
      return roh ? JSON.parse(roh) : [];
    } catch (e) { return []; }
  }

  function speicherePuffer(liste) {
    try { CacheService.getScriptCache().put(PUFFER, JSON.stringify(liste), CACHE_SEKUNDEN); } catch (e) { /* egal */ }
  }

  function puffere(neue) {
    if (!neue.length) return;
    var liste = lesePuffer().concat(neue);
    var max = maxPuffer();
    if (liste.length > max) liste = liste.slice(liste.length - max); // ältestes fliegt raus
    speicherePuffer(liste);
  }

  function start(name) {
    return { name: String(name), t0: Date.now() };
  }

  /** Beendet die Messung; liefert { server_ms, sheets } für die Antwort an den Browser. */
  function ende(h, info) {
    if (!h) return null;
    info = info || {};
    var ms = Date.now() - h.t0;
    var sheets = null;
    try { sheets = (typeof DB !== 'undefined' && DB.zaehler) ? DB.zaehler().sheets : null; } catch (e) { sheets = null; }
    puffere([{
      zeitpunkt: jetzt(), funktion: h.name, rolle: (info.rollen || []).join(','), dauer_ms: ms,
      sheets_aufrufe: sheets, cache: info.cache || '', client_ms: null, ok: info.ok !== false
    }]);
    return { server_ms: ms, sheets: sheets };
  }

  /** Vom Browser gemessene Zeiten übernehmen: [{ name, client_ms }], höchstens 100 Einträge. */
  function clientWerte(liste) {
    if (!Array.isArray(liste)) return 0;
    var neue = liste.slice(0, 100).filter(function (w) {
      return w && typeof w.name === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(w.name) &&
        typeof w.client_ms === 'number' && isFinite(w.client_ms) && w.client_ms >= 0 && w.client_ms < 600000;
    }).map(function (w) {
      return { zeitpunkt: jetzt(), funktion: w.name, rolle: '', dauer_ms: null, sheets_aufrufe: null,
        cache: '', client_ms: Math.round(w.client_ms), ok: true };
    });
    puffere(neue);
    return neue.length;
  }

  /** Trigger (stündlich): Puffer gesammelt nach _Messung schreiben und leeren. */
  function schreibePuffer() {
    var liste = lesePuffer();
    if (!liste.length) return 0;
    var sh = DB.blatt(TAB);
    var kopf = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    var zeilen = liste.map(function (m) {
      return kopf.map(function (k) {
        var v = m[k];
        if (k === 'zeitpunkt') return v ? Werte.zuSerial(v) : '';
        if (k === 'ok') return v === false ? 'nein' : 'ja';
        return v === null || v === undefined ? '' : v;
      });
    });
    DB.anhaengen(sh, zeilen);   // vergrößert das Raster bei Bedarf
    speicherePuffer([]);
    return zeilen.length;
  }

  /** Median/P90 je Funktion aus _Messung und dem noch nicht geschriebenen Puffer. */
  function auswertung() {
    var gespeichert = DB.lese([TAB])[TAB] || [];
    return Statistik.auswerten(gespeichert.concat(lesePuffer()));
  }

  return { start: start, ende: ende, clientWerte: clientWerte, schreibePuffer: schreibePuffer, auswertung: auswertung };
})();
