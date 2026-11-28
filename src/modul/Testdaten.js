/**
 * TestdatenEinspielen – ersetzt in der TEST-Umgebung die Bewegungsdaten durch einen synthetischen Verein.
 *
 * Zweck:      Verwaltung → System → „Testdaten einspielen“: Der Browser liest `testdaten.json` (npm run testdaten)
 *             und schickt sie in Blöcken; dieses Modul leert die Bewegungsdaten-Tabs, schreibt die Blöcke, zieht
 *             die Zähler in _Konfig nach und baut den Snapshot neu. Kein Drive-Zugriff, kein neuer Scope.
 * Datenquelle: Script Properties TESTUMGEBUNG (Schalter) und testdaten_laeuft (Fortschritt); Tabelle über DB.
 * Wer darf was: Nur wenn ALLES zutrifft: Script Property TESTUMGEBUNG = ja (nur im Test-Skriptprojekt gesetzt, über
 *             die WebApp nicht änderbar; Groß-/Kleinschreibung und Leerzeichen egal), Datenbank-Datei mit „TEST“ im Namen, Rolle Mitgliederverwalter, Recht
 *             konfig_aendern (Api.ausfuehren). In der Produktion fehlt der Schalter – dort lehnt jede Funktion ab.
 * Besonderheiten:
 *   - Ablauf: start (alles prüfen, dann Tabs leeren) → block (je bis zu Testdaten.MAX_BLOCK Zeilen, lückenlos in
 *     Reihenfolge) → ende (Zeilenzahlen prüfen, _Konfig, Snapshot). Bricht der Browser ab, bleibt die Test-Tabelle
 *     teilweise gefüllt; einfach neu starten.
 *   - Geschrieben wird wie überall mit setValues im Zellformat des Datenmodells (DB.anhaengen); Formate und
 *     Auswahllisten aus setup bleiben, weil nur Inhalte gelöscht werden (clearContent).
 *   - Benutzer, Stammdaten, Protokoll, Vorlagen, Dokumente bleiben unberührt (Testdaten.ERLAUBT).
 */
var TestdatenEinspielen = (function () {
  var MARKE = 'testdaten_laeuft';
  var GUELTIG_MS = 60 * 60 * 1000;

  function props() { return PropertiesService.getScriptProperties(); }
  function schalterWert() { return props().getProperty('TESTUMGEBUNG'); }
  function schalterAn() { return String(schalterWert() || '').trim().toLowerCase() === 'ja'; }

  /**
   * Für die Oberfläche. null, wenn TESTUMGEBUNG gar nicht gesetzt ist (Produktion: nichts anzeigen). Sonst
   * { frei, grund }: grund nennt die erste nicht erfüllte Bedingung, damit man in der Test-Umgebung sieht, woran es liegt.
   */
  function status(ktx) {
    try {
      var w = schalterWert();
      if (w === null || w === undefined) return null;
      if (!schalterAn()) return { frei: false, grund: 'Script Property TESTUMGEBUNG hat den Wert „' + w + '“ – erwartet wird „ja“.' };
      if (ktx.rollen.indexOf('Mitgliederverwalter') < 0) return { frei: false, grund: 'Nur die Rolle Mitgliederverwalter darf Testdaten einspielen.' };
      var name = DB.dateiName();
      if (!Testdaten.istTestName(name)) return { frei: false, grund: 'Die Datenbank-Tabelle heißt „' + name + '“ – ihr Name muss „TEST“ enthalten.' };
      return { frei: true, grund: null };
    } catch (e) { return { frei: false, grund: 'Prüfung fehlgeschlagen.' }; }
  }

  function freigegeben(ktx) { var s = status(ktx); return !!(s && s.frei); }

  function pruefeZugang(ktx) {
    if (!schalterAn()) throw Fehler.fachlich('Testdaten einspielen gibt es nur in der Test-Umgebung (Script Property TESTUMGEBUNG = ja).');
    if (ktx.rollen.indexOf('Mitgliederverwalter') < 0) throw Fehler.fachlich('Testdaten einspielen darf nur die Rolle Mitgliederverwalter.');
    var name = DB.dateiName();
    if (!Testdaten.istTestName(name)) {
      throw Fehler.fachlich('Die Datenbank „' + name + '“ trägt kein „TEST“ im Namen – Testdaten werden hier nicht eingespielt.');
    }
  }

  function leseMarke(ktx) {
    var m = null;
    try { m = JSON.parse(props().getProperty(MARKE) || 'null'); } catch (e) { m = null; }
    if (!m || m.email !== ktx.email || !(Date.now() - m.seit < GUELTIG_MS)) {
      throw Fehler.fachlich('Kein laufendes Einspielen gefunden – bitte die Datei neu auswählen und von vorn beginnen.');
    }
    return m;
  }

  /** info: Kopfdaten der Datei ohne Zeilen ({ art, version, synthetisch, erzeugt, tabs: { Tab: { kopf, anzahl } }, konfig }). */
  function start(ktx, info) {
    pruefeZugang(ktx);
    var p = Testdaten.pruefeKopfdaten(info);
    if (p.fehler.length) throw Fehler.fachlich(p.fehler.join(' '));
    var konfig = Testdaten.konfigWerte(info.konfig, p.tabs).werte;
    return DB.mitSperre(function () {
      var blaetter = {}, fehler = [];
      p.tabs.forEach(function (tab) {
        var b = DB.blatt(tab);
        var f = Testdaten.pruefeTabellenkopf(tab, DB.kopf(b));
        if (f) fehler.push(f);
        blaetter[tab] = b;
      });
      if (fehler.length) throw Fehler.fachlich('Nichts geändert: ' + fehler.join(' '));
      var anzahl = {};
      p.tabs.forEach(function (tab) {
        var b = blaetter[tab], letzte = b.getLastRow(), spalten = b.getLastColumn();
        if (letzte > 1) b.getRange(2, 1, letzte - 1, spalten).clearContent();
        var noetig = info.tabs[tab].anzahl + 1, max = b.getMaxRows();
        if (noetig > max) b.insertRowsAfter(max, noetig - max);
        anzahl[tab] = info.tabs[tab].anzahl;
        DB.zaehle(4);
      });
      props().setProperty(MARKE, JSON.stringify({ email: ktx.email, seit: Date.now(), tabs: anzahl, konfig: konfig }));
      return { tabs: p.tabs, uebersprungen: p.uebersprungen, block: Testdaten.MAX_BLOCK };
    });
  }

  /** Schreibt zeilen ab Datenzeile `von` (0-basiert). Blöcke müssen lückenlos in Reihenfolge kommen. */
  function block(ktx, tab, von, zeilen) {
    pruefeZugang(ktx);
    var m = leseMarke(ktx);
    if (!(tab in m.tabs)) throw Fehler.fachlich('Tab ' + tab + ' gehört nicht zu diesem Einspielen.');
    var f = Testdaten.pruefeBlock(tab, zeilen);
    if (f) throw Fehler.fachlich(f);
    if (!(von >= 0) || Math.floor(von) !== von || von + zeilen.length > m.tabs[tab]) throw Fehler.fachlich('Ungültige Zeilenposition für ' + tab + '.');
    return DB.mitSperre(function () {
      var b = DB.blatt(tab), letzte = b.getLastRow();
      if (letzte !== von + 1) throw Fehler.fachlich('Reihenfolge gestört bei ' + tab + ' – bitte von vorn beginnen.');
      DB.anhaengen(b, zeilen.map(function (z) { return z.map(function (v) { return v === null ? '' : v; }); }), letzte);
      return { tab: tab, bis: von + zeilen.length };
    });
  }

  /** Prüft die Zeilenzahlen, setzt die Zähler in _Konfig und baut den Snapshot neu. */
  function ende(ktx) {
    pruefeZugang(ktx);
    var m = leseMarke(ktx);
    DB.mitSperre(function () {
      var fehlt = [];
      Object.keys(m.tabs).forEach(function (tab) {
        var n = DB.blatt(tab).getLastRow() - 1;
        if (n !== m.tabs[tab]) fehlt.push(tab + ' (' + n + ' von ' + m.tabs[tab] + ')');
      });
      if (fehlt.length) throw Fehler.fachlich('Unvollständig: ' + fehlt.join(', ') + ' – bitte von vorn beginnen.');
      DB.konfigVergessen();
      m.konfig.forEach(function (kv) {
        DB.zaehlerSetzen(kv[0], kv[1], kv[0].indexOf('next_id_') === 0 ? 'ID-Zähler – nur vom Skript erhöhen' : '');
      });
      DB.konfigVergessen();
    });
    props().deleteProperty(MARKE);
    Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: '_Konfig', datensatz_id: '-',
      kommentar: 'Testdaten eingespielt: ' + Object.keys(m.tabs).map(function (t) { return t + ' ' + m.tabs[t]; }).join(', ') }]);
    var s = Verwaltung.snapshotNeu(ktx);
    return { tabs: m.tabs, snapshot_gebaut_am: s.snapshot_gebaut_am };
  }

  return { status: status, freigegeben: freigegeben, start: start, block: block, ende: ende };
})();
