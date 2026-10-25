/**
 * Änderungs- und Zugriffsprotokoll (Tab „_Protokoll“, append-only).
 *
 * Zweck:      Hält fest, wer wann welchen Datensatz angelegt, geändert, eingesehen oder exportiert hat und
 *             welche Zugriffe abgewiesen wurden (Sicherheitsregel A10, Nachweis bei DSGVO-Anfragen).
 * Datenquelle: Tab „_Protokoll“; Spalten werden über die Kopfzeile (Namen) gefunden.
 * Wer darf was: Schreiben tun nur Server-Funktionen. Lesen ist eine eigene Aktion (protokoll_lesen) und
 *             wird in Phase 3 rollengefiltert angezeigt – das Protokoll enthält alte IBANs im Klartext.
 * Besonderheiten:
 *   - Nur anhängen, nie ändern, nie löschen. Deshalb ist die nächste protokoll_id = Zahl der Datenzeilen + 1
 *     (= getLastRow(), weil Zeile 1 die Kopfzeile ist).
 *   - Alle Einträge eines Aufrufs gehen in EINEM Schreibzugriff in die Tabelle.
 *   - Texte werden auf 500 Zeichen gekürzt. Texte, die mit = + - @ beginnen, bekommen ein ' vorangestellt,
 *     damit die Tabelle sie nicht als Formel ausführt (Formel-Injektion).
 *   - Die Bereinigung alter Werte (bereinigt_am, Aufbewahrungsfrist) folgt in Phase 5.
 */
var Protokoll = (function () {
  var TAB = '_Protokoll';
  var MAX_LAENGE = 500;

  function blatt() { return DB.blatt(TAB); }

  function zaehle(n) {
    if (typeof DB !== 'undefined' && DB.zaehle) DB.zaehle(n);
  }

  /** Wert für eine Textzelle: gekürzt und gegen Formel-Injektion geschützt. */
  function text(v) {
    if (v === null || v === undefined) return '';
    var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s.length > MAX_LAENGE) s = s.slice(0, MAX_LAENGE - 1) + '…';
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return s;
  }

  function jetztSerial() {
    return Werte.zuSerial(DB.jetzt());
  }

  /**
   * Schreibt Einträge ins Protokoll.
   * @param ktx  Kontext mit email (bei Abweisungen die abgewiesene Adresse)
   * @param eintraege [{ aktion, tabelle, datensatz_id, feld?, alt_wert?, neu_wert?, kommentar? }]
   */
  function schreibe(ktx, eintraege) {
    if (!eintraege || !eintraege.length) return 0;
    // Fortlaufende protokoll_id = Zeilennummer → nur unter der Sperre korrekt. Aufrufer ohne Sperre (z. B. reine
    // Lese-/Exportvermerke) bekommen sie hier (Befund M2; DB.mitSperre ist wiedereintrittsfähig).
    return DB.mitSperre(function () { return schreibeGesperrt(ktx, eintraege); });
  }

  function schreibeGesperrt(ktx, eintraege) {
    var sh = blatt();
    var letzte = sh.getLastRow();
    var kopf = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    zaehle(2);
    var zeit = jetztSerial();
    var email = text(ktx && ktx.email);
    var zeilen = eintraege.map(function (e, i) {
      var werte = {
        protokoll_id: letzte + i, // letzte Zeile = Zahl der bisherigen Einträge (+ Kopfzeile)
        zeitpunkt: zeit,
        benutzer_email: email,
        aktion: text(e.aktion),
        tabelle: text(e.tabelle),
        datensatz_id: text(e.datensatz_id),
        feld: text(e.feld),
        alt_wert: text(e.alt_wert),
        neu_wert: text(e.neu_wert),
        kommentar: text(e.kommentar),
        bereinigt_am: ''
      };
      return kopf.map(function (k) { return Object.prototype.hasOwnProperty.call(werte, k) ? werte[k] : ''; });
    });
    DB.anhaengen(sh, zeilen, letzte);   // vergrößert das Raster bei Bedarf, zählt selbst
    return zeilen.length;
  }

  /** Macht aus einem Werte.diff-Ergebnis Protokolleinträge (ein Eintrag je geändertem Feld). */
  function ausDiff(tab, id, diff) {
    return (diff || []).map(function (d) {
      return { aktion: 'geändert', tabelle: tab, datensatz_id: id, feld: d.feld, alt_wert: d.alt, neu_wert: d.neu };
    });
  }

  return { schreibe: schreibe, ausDiff: ausDiff, text: text };
})();
