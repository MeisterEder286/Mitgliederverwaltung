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
 *   - Nachgelagert (Standard, _Konfig.protokoll_nachgelagert ≠ nein): schreibe() legt die fertigen Einträge in die
 *     Script Properties (dauerhaft) und kostet keine Sperre und keinen Tabellenzugriff. Übertragen werden sie unter der
 *     Sperre durch apiNachlauf (stößt der Browser nach der Antwort still an), den Trigger protokollNachtragen (alle
 *     5 Minuten) und vor jedem DB.lese von _Protokoll. Zeitpunkt = Zeitpunkt der Änderung, die protokoll_id wird erst
 *     beim Übertragen vergeben. Abbruch zwischen Schreiben und Löschen → schlimmstenfalls doppelt, nie verloren.
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
  /**
   * Listenname aus dem Browser für Export-Vermerke: nur Buchstaben, Ziffern und einfache Satzzeichen, max. 60
   * Zeichen – der Browser soll keinen beliebigen Text ins Audit-Log schreiben können (Befund N1).
   */
  function listenname(x) {
    var s = String(x === null || x === undefined ? '' : x).replace(/[^0-9A-Za-zÄÖÜäöüß .,()\/–-]/g, '').trim().slice(0, 60);
    return s || 'Liste';
  }

  /**
   * Schreibt Einträge ins Protokoll. Standard (_Konfig.protokoll_nachgelagert ≠ nein): Die fertigen Einträge
   * (Zeitpunkt = jetzt) kommen als EIN Wert in die Script Properties (dauerhaft, anders als der Cache) und werden
   * danach unter der Sperre ins Blatt übertragen – durch apiNachlauf (stößt der Browser nach der Antwort an), den
   * Trigger protokollNachtragen und vor jedem Lesen von _Protokoll (DB.lese). Sonst – oder wenn der Wert zu groß
   * ist / die Properties voll sind – sofort, nachdem wartende Einträge übertragen wurden (Reihenfolge der IDs).
   */
  function schreibe(ktx, eintraege) {
    if (!eintraege || !eintraege.length) return 0;
    var messen = typeof Messung !== 'undefined' && Messung.abschnitt ? Messung.abschnitt : function (n, f) { return f(); };
    return messen('log', function () {
      var objekte = alsObjekte(ktx, eintraege);
      if (nachgelagert()) {
        var json = JSON.stringify(objekte);
        if (utf8Laenge(json) <= MAX_WARTEWERT) {
          try {
            PropertiesService.getScriptProperties().setProperty(neuerWarteSchluessel(), json);
            gewartet = true;
            return objekte.length;
          } catch (e) {
            console.warn('Protokoll: Warteschlange nicht beschrieben, schreibe sofort – ' + (e && e.message));
          }
        }
      }
      // protokoll_id = Zeilennummer → nur unter der Sperre korrekt (Befund M2; DB.mitSperre ist wiedereintrittsfähig).
      return DB.mitSperre(function () { nachtragenGesperrt(); return anhaengenGesperrt(objekte); });
    });
  }

  var WARTE = 'protwarte:';
  var MAX_WARTEWERT = 8000;            // Script Properties: höchstens 9 KB je Wert
  var gewartet = false;                // diese Ausführung hat Einträge in die Warteschlange gelegt
  var laufNr = 0;

  function nachgelagert() {
    try { return Konfig.wert('protokoll_nachgelagert') !== 'nein'; } catch (e) { return false; }
  }

  function utf8Laenge(s) { return unescape(encodeURIComponent(s)).length; }

  /** Sortierbar nach Zeit; Zufall + Zähler gegen Kollisionen gleichzeitiger Ausführungen. */
  function neuerWarteSchluessel() {
    var t = String(Date.now());
    while (t.length < 15) t = '0' + t;
    laufNr++;
    return WARTE + t + ':' + Math.random().toString(36).slice(2, 8) + ':' + laufNr;
  }

  function alsObjekte(ktx, eintraege) {
    var zeit = jetztSerial();
    var email = text(ktx && ktx.email);
    return eintraege.map(function (e) {
      return {
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
    });
  }

  function anhaengenGesperrt(objekte) {
    if (!objekte.length) return 0;
    var sh = blatt();
    var letzte = sh.getLastRow();
    zaehle(1);
    var kopf = DB.kopf(sh);   // je Ausführung gemerkt, zählt selbst
    var zeilen = objekte.map(function (o, i) {
      var werte = Object.assign({}, o, { protokoll_id: letzte + i });   // letzte Zeile = bisherige Einträge (+ Kopfzeile)
      return kopf.map(function (k) { return Object.prototype.hasOwnProperty.call(werte, k) ? werte[k] : ''; });
    });
    DB.anhaengen(sh, zeilen, letzte);   // vergrößert das Raster bei Bedarf, zählt selbst
    return zeilen.length;
  }

  function warteSchluessel(alle) {
    return Object.keys(alle).filter(function (k) { return k.indexOf(WARTE) === 0; }).sort();
  }

  function warteschlange() {
    try { var p = PropertiesService.getScriptProperties(); return { p: p, alle: p.getProperties() }; } catch (e) { return null; }
  }

  /**
   * Überträgt wartende Einträge ins Blatt (nur unter der Sperre). Erst nach flush werden sie aus der Warteschlange
   * gelöscht – bricht die Ausführung dazwischen ab, wird ein Eintrag schlimmstenfalls doppelt geschrieben, nie verloren.
   */
  function nachtragenGesperrt() {
    var w = warteschlange();
    if (!w) return 0;
    var schluessel = warteSchluessel(w.alle);
    if (!schluessel.length) return 0;
    var objekte = [];
    schluessel.forEach(function (k) {
      try { objekte = objekte.concat(JSON.parse(w.alle[k])); } catch (e) { console.error('Protokoll: defekter Warteeintrag ' + k); }
    });
    var n = anhaengenGesperrt(objekte);
    SpreadsheetApp.flush();
    zaehle(1);
    schluessel.forEach(function (k) { w.p.deleteProperty(k); });
    return n;
  }

  /** Wartende Einträge übertragen (holt sich die Sperre nur, wenn etwas wartet). wartezeitMs optional. Liefert die Anzahl. */
  function nachtragen(wartezeitMs) {
    var w = warteschlange();
    if (!w || !warteSchluessel(w.alle).length) return 0;
    return DB.mitSperre(nachtragenGesperrt, wartezeitMs);
  }

  /** Hat diese Ausführung Einträge in die Warteschlange gelegt? (Api setzt dann nachlauf: true in der Antwort) */
  function wartet() { return gewartet; }

  /** Macht aus einem Werte.diff-Ergebnis Protokolleinträge (ein Eintrag je geändertem Feld). */
  function ausDiff(tab, id, diff) {
    return (diff || []).map(function (d) {
      return { aktion: 'geändert', tabelle: tab, datensatz_id: id, feld: d.feld, alt_wert: d.alt, neu_wert: d.neu };
    });
  }

  return { schreibe: schreibe, nachtragen: nachtragen, wartet: wartet, ausDiff: ausDiff, text: text, listenname: listenname };
})();
