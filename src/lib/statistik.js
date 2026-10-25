/**
 * Auswertung von Messwerten (reine Logik, in Node getestet).
 *
 * Zweck:      Fasst Messwerte je Server-Funktion zusammen: Anzahl, Median und 90-%-Wert (P90) für
 *             Serverzeit, Zahl der Tabellenzugriffe und vom Browser gemessene Zeit.
 * Datenquelle: Einträge aus Tab „_Messung“ und dem Messpuffer (siehe Messung.js).
 * Wer darf was: nur über apiMessungen (Aktion messung_lesen).
 * Besonderheiten: P90 nach der „nächster Rang“-Methode (Wert, unter dem mindestens 90 % liegen).
 *             Leere Werte (null) werden je Kennzahl ignoriert.
 */
var Statistik = (function () {
  function zahlen(liste) {
    return liste.filter(function (x) { return typeof x === 'number' && isFinite(x); })
      .sort(function (a, b) { return a - b; });
  }

  function median(liste) {
    var z = zahlen(liste);
    if (!z.length) return null;
    var m = Math.floor(z.length / 2);
    return z.length % 2 ? z[m] : (z[m - 1] + z[m]) / 2;
  }

  function perzentil(liste, p) {
    var z = zahlen(liste);
    if (!z.length) return null;
    var rang = Math.ceil(p / 100 * z.length);
    return z[Math.min(Math.max(rang, 1), z.length) - 1];
  }

  function kennzahl(liste) {
    return { median: median(liste), p90: perzentil(liste, 90), anzahl: zahlen(liste).length };
  }

  /**
   * @param eintraege [{ funktion, dauer_ms, sheets_aufrufe, client_ms, ok }]
   * @return [{ funktion, anzahl, fehler, server_ms, sheets, client_ms }] sortiert nach Funktionsname
   */
  function auswerten(eintraege) {
    var gruppen = {};
    (eintraege || []).forEach(function (e) {
      if (!e || !e.funktion) return;
      var g = gruppen[e.funktion] || (gruppen[e.funktion] = { s: [], sh: [], c: [], n: 0, f: 0 });
      g.n++;
      if (e.ok === false) g.f++;
      g.s.push(e.dauer_ms); g.sh.push(e.sheets_aufrufe); g.c.push(e.client_ms);
    });
    return Object.keys(gruppen).sort().map(function (name) {
      var g = gruppen[name];
      return { funktion: name, anzahl: g.n, fehler: g.f, server_ms: kennzahl(g.s), sheets: kennzahl(g.sh), client_ms: kennzahl(g.c) };
    });
  }

  return { median: median, perzentil: perzentil, auswerten: auswerten };
})();
