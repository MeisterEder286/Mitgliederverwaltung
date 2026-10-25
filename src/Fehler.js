/**
 * Markierte Fehler für die Kommunikation mit dem Client.
 *
 * Zweck:      Unterscheidet Fehler, deren Meldung der Nutzer sehen darf (fachlich, Konflikt, kein Zugriff),
 *             von internen Fehlern, die nur generisch gemeldet werden (Sicherheitsregel A9).
 * Datenquelle: keine.
 * Wer darf was: wird von allen Server-Modulen verwendet; die Übersetzung in eine Antwort macht Api.js.
 * Besonderheiten: Erkennung über die Eigenschaft `art`, nicht über instanceof – das funktioniert auch über
 *             Datei- und Kontextgrenzen hinweg. Fachmeldungen formulieren wir selbst; sie dürfen nie
 *             Tab-Namen, Spaltennamen oder Stacktraces enthalten.
 */
var Fehler = (function () {
  function erzeuge(art, meldung, zusatz) {
    var e = new Error(meldung);
    e.art = art;
    e.meldung = meldung;
    if (zusatz) Object.keys(zusatz).forEach(function (k) { e[k] = zusatz[k]; });
    return e;
  }

  /**
   * Fehler mit einer für den Nutzer verständlichen, selbst formulierten Meldung.
   * felder (optional): [{ feld, meldung }] – der Browser zeigt sie direkt am Eingabefeld an.
   */
  function fachlich(meldung, felder) {
    return erzeuge('fachlich', meldung, felder && felder.length ? { felder: felder } : null);
  }

  /** Versionskonflikt: jemand anderes hat den Datensatz zwischenzeitlich geändert. */
  function konflikt(aktuell) {
    return erzeuge('konflikt', 'Der Datensatz wurde inzwischen von jemand anderem geändert.', { aktuell: aktuell });
  }

  /** Kein Zugriff – bewusst ohne Begründung. */
  function keinZugriff() {
    return erzeuge('zugriff', 'Kein Zugriff.');
  }

  /** Liefert die Art eines markierten Fehlers oder null für unbekannte (interne) Fehler. */
  function artVon(e) {
    var a = e && e.art;
    return a === 'fachlich' || a === 'konflikt' || a === 'zugriff' ? a : null;
  }

  return { fachlich: fachlich, konflikt: konflikt, keinZugriff: keinZugriff, artVon: artVon };
})();
