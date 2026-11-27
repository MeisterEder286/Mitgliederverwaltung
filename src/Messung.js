/**
 * Zeitmessung je Server-Aufruf (Auftragspunkt 8, Verbesserung V9) und Messwerk für die Leistungsarbeit.
 *
 * Zweck:      1. Für jeden Aufruf: Laufzeit und Zahl der Tabellenzugriffe (messung: { server_ms, sheets }) an der
 *                Antwort und gepuffert im Script-Cache; ein stündlicher Trigger schreibt den Puffer nach „_Messung“.
 *             2. Messwerk (docs/LEISTUNG.md): je Ausführung Millisekunden je Abschnitt (sperre, vorladen, lesen,
 *                schreiben, flush, oeffnen, pruefkette, handler, log, ansicht, cache, messung), Zahl der Lesungen,
 *                Meta-Abfragen, Schreibungen, flushes, gelesene/geschriebene Zellen, gelesene Tabellen und eine
 *                Spur jedes einzelnen Blattzugriffs. Den Bericht (_mess) bekommt nur, wer ausdrücklich danach fragt
 *                (apiMessen bzw. doGet mit ?messen=1) UND die Aktion messung_lesen hat (Api.ausfuehren prüft das).
 * Datenquelle: Script-Cache (Schlüssel messung:puffer), Tab „_Messung“; Messwerk nur im Speicher der Ausführung.
 * Wer darf was: Auswertung und Bericht nur mit messung_lesen. Keine E-Mail-Adressen, keine Zellinhalte in den
 *             Messwerten – nur Rollen, Tab-Namen, Methodennamen, Zahlen (Datensparsamkeit).
 * Besonderheiten:
 *   - Messen darf einen Aufruf nie scheitern lassen: Alle Fehler im Messwerk und im Cache werden geschluckt.
 *   - Abschnitte bilden einen Stapel. „ms“ ist exklusiv (ohne verschachtelte Abschnitte), „inkl“ inklusiv. Ein
 *     Blattzugriff innerhalb von „log“ zählt also bei „lesen“/„schreiben“; die Spur nennt den umgebenden Abschnitt.
 *     Summe aller exklusiven Zeiten + rest = gesamt.
 *   - laden_ms: Zeit vom Auswerten der ersten Skriptdatei (MESS_T0 in src/0_Messbeginn.js) bis zum Start der
 *     Messung. [?] Gilt nur, wenn Apps Script diese Datei zuerst lädt (Ladereihenfolge nicht zugesichert); sonst
 *     ist der Wert zu klein. Prüfen: laden_ms bei apiPing muss > 0 sein.
 *   - Der Puffer wird ohne Sperre gelesen und geschrieben (Messwerte, keine Fachdaten; Verlust in Kauf genommen).
 *     Das Puffern kostet je Aufruf ein CacheService-get + put; das Messwerk weist es als Abschnitt „messung“ aus.
 */
var Messung = (function () {
  var PUFFER = 'messung:puffer';
  var CACHE_SEKUNDEN = 21600; // 6 h, Höchstwert des CacheService
  var TAB = '_Messung';
  var MAX_SPUR = 200;

  // ------------------------------------------------------------------ Messwerk (je Ausführung)

  var lauf = null;              // aktueller Messlauf
  var diagnoseGewuenscht = false;

  function neuerLauf(name) {
    var t0 = Date.now();
    return {
      name: String(name), t0: t0, stapel: [], ende: null,
      abschnitte: {}, // name → { ms, inkl, n }
      z: { lesungen: 0, meta: 0, schreibungen: 0, flushes: 0, oeffnen: 0, zellen_gelesen: 0, zellen_geschrieben: 0, cache: 0 },
      tabellen: {}, spur: [], spur_verworfen: 0,
      laden_ms: (typeof MESS_T0 === 'number' && MESS_T0 <= t0) ? t0 - MESS_T0 : null,
      sperre_gehalten_ms: 0
    };
  }

  function eintrag(name) {
    return lauf.abschnitte[name] || (lauf.abschnitte[name] = { ms: 0, inkl: 0, n: 0 });
  }

  /** Abschnitt betreten; liefert ein Kennzeichen für verlasse(). */
  function betrete(name) {
    if (!lauf) return null;
    var jetzt = Date.now();
    var oben = lauf.stapel[lauf.stapel.length - 1];
    if (oben) { eintrag(oben.name).ms += jetzt - oben.seit; }
    var k = { name: name, start: jetzt, seit: jetzt };
    lauf.stapel.push(k);
    return k;
  }

  function verlasse(k) {
    if (!lauf || !k) return;
    var jetzt = Date.now();
    // Bis zum Kennzeichen abbauen (falls ein innerer Abschnitt durch eine Ausnahme nicht sauber verlassen wurde)
    while (lauf.stapel.length) {
      var oben = lauf.stapel.pop();
      var e = eintrag(oben.name);
      e.ms += jetzt - oben.seit;
      if (oben === k) { e.inkl += jetzt - oben.start; e.n++; break; }
    }
    var darunter = lauf.stapel[lauf.stapel.length - 1];
    if (darunter) darunter.seit = jetzt;
  }

  /** Führt fn im Abschnitt name aus (auch ohne laufende Messung). */
  function abschnitt(name, fn) {
    var k = null;
    try { k = betrete(name); } catch (e) { k = null; }
    try { return fn(); } finally { try { verlasse(k); } catch (e2) { /* Messen darf nichts stören */ } }
  }

  /**
   * Einen Blatt- oder API-Zugriff festhalten.
   * art: 'lesen' | 'vorladen' | 'meta' | 'schreiben' | 'flush' | 'oeffnen' | 'cache'
   * info: { methode, tab | tabs, zellen, ms }
   */
  function zugriff(art, info) {
    if (!lauf) return;
    try {
      info = info || {};
      var z = lauf.z;
      if (art === 'lesen' || art === 'vorladen') { z.lesungen++; z.zellen_gelesen += info.zellen || 0; }
      else if (art === 'meta') z.meta++;
      else if (art === 'schreiben') { z.schreibungen++; z.zellen_geschrieben += info.zellen || 0; }
      else if (art === 'flush') z.flushes++;
      else if (art === 'oeffnen') z.oeffnen++;
      else if (art === 'cache') z.cache++;
      var tabs = info.tabs || (info.tab ? [info.tab] : []);
      if (art === 'lesen' || art === 'vorladen') tabs.forEach(function (t) { lauf.tabellen[t] = (lauf.tabellen[t] || 0) + 1; });
      if (lauf.spur.length >= MAX_SPUR) { lauf.spur_verworfen++; return; }
      var oben = lauf.stapel[lauf.stapel.length - 1]; // umgebender Abschnitt (miss() hat den eigenen schon verlassen)
      lauf.spur.push({
        t: Date.now() - lauf.t0 - (info.ms || 0), art: art, methode: info.methode || '',
        tab: tabs.length > 3 ? tabs.length + ' Tabs' : tabs.join(','), zellen: info.zellen || 0, ms: info.ms || 0,
        in: oben ? oben.name : ''
      });
    } catch (e) { /* egal */ }
  }

  /** Misst fn als Zugriff der Art art im gleichnamigen Abschnitt. info.zellen darf eine Funktion des Ergebnisses sein. */
  function miss(art, info, fn) {
    var k = null, t = Date.now(), ergebnis;
    try { k = betrete(art); } catch (e) { k = null; }
    try {
      ergebnis = fn();
      return ergebnis;
    } finally {
      try {
        verlasse(k);
        var zellen = typeof info.zellen === 'function' ? (ergebnis === undefined ? 0 : info.zellen(ergebnis)) : info.zellen;
        zugriff(art, { methode: info.methode, tab: info.tab, tabs: info.tabs, zellen: zellen || 0, ms: Date.now() - t });
      } catch (e2) { /* egal */ }
    }
  }

  function sperreGehalten(ms) { if (lauf) lauf.sperre_gehalten_ms += ms; }

  /** apiMessen/doGet: Bericht für den nächsten Api.ausfuehren-Aufruf anfordern (Rechte prüft Api.ausfuehren). */
  function diagnoseAnfordern() { diagnoseGewuenscht = true; }
  /** Liest die Anforderung und setzt sie zurück – sie gilt für genau einen Aufruf. */
  function diagnoseUebernehmen() { var d = diagnoseGewuenscht; diagnoseGewuenscht = false; return d; }

  /** Bericht über den laufenden/letzten Messlauf (für _mess). */
  function bericht() {
    if (!lauf) return null;
    var ende = lauf.ende || Date.now();
    var gesamt = ende - lauf.t0;
    var ab = {}, summe = 0;
    Object.keys(lauf.abschnitte).forEach(function (n) {
      var e = lauf.abschnitte[n];
      ab[n] = { ms: e.ms, inkl: e.inkl, n: e.n };
      summe += e.ms;
    });
    var z = lauf.z;
    return {
      funktion: lauf.name,
      gesamt_ms: gesamt,
      laden_ms: lauf.laden_ms,
      rest_ms: Math.max(0, gesamt - summe),
      abschnitte: ab,
      lesungen: z.lesungen, meta: z.meta, schreibungen: z.schreibungen, flushes: z.flushes, oeffnen: z.oeffnen,
      cache: z.cache, zellen_gelesen: z.zellen_gelesen, zellen_geschrieben: z.zellen_geschrieben,
      tabellen: Object.keys(lauf.tabellen).sort(),
      sperre_gehalten_ms: lauf.sperre_gehalten_ms,
      spur: lauf.spur.slice(),
      spur_verworfen: lauf.spur_verworfen
    };
  }

  // ------------------------------------------------------------------ Puffer → _Messung (wie bisher)

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
    try { lauf = neuerLauf(name); } catch (e) { lauf = null; }
    return { name: String(name), t0: lauf ? lauf.t0 : Date.now() };
  }

  /** Beendet die Messung; liefert { server_ms, sheets } für die Antwort an den Browser. */
  function ende(h, info) {
    if (!h) return null;
    info = info || {};
    var ms = Date.now() - h.t0;
    var sheets = null;
    try { sheets = (typeof DB !== 'undefined' && DB.zaehler) ? DB.zaehler().sheets : null; } catch (e) { sheets = null; }
    abschnitt('messung', function () {
      puffere([{
        zeitpunkt: jetzt(), funktion: h.name, rolle: (info.rollen || []).join(','), dauer_ms: ms,
        sheets_aufrufe: sheets, cache: info.cache || '', client_ms: null, ok: info.ok !== false
      }]);
    });
    if (lauf && lauf.t0 === h.t0) lauf.ende = Date.now();
    return { server_ms: ms, sheets: sheets };
  }

  /** Vom Browser gemessene Zeiten übernehmen: [{ name, client_ms }], höchstens 100 Einträge. */
  function clientWerte(liste) {
    if (!Array.isArray(liste)) return 0;
    var neue = liste.slice(0, 100).map(function (w) {
      // Der Browser (client/kern) schickt { funktion, client_ms, … } – beide Schreibweisen annehmen.
      return w && typeof w.name !== 'string' && typeof w.funktion === 'string' ? { name: w.funktion, client_ms: w.client_ms } : w;
    }).filter(function (w) {
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

  return {
    start: start, ende: ende, clientWerte: clientWerte, schreibePuffer: schreibePuffer, auswertung: auswertung,
    abschnitt: abschnitt, miss: miss, zugriff: zugriff, sperreGehalten: sperreGehalten, bericht: bericht,
    diagnoseAnfordern: diagnoseAnfordern, diagnoseUebernehmen: diagnoseUebernehmen
  };
})();
