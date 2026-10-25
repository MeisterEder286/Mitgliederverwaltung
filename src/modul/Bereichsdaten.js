/**
 * Bereichsdaten – gemeinsame Hilfen der Module Ehrungen, Nachweise und Berichte.
 *
 * Zweck:      1. Liefert die Daten, auf denen ein Bericht für den Aufrufer rechnen darf: bei Zeilensicht „alle“
 *                die vollständige Basis, sonst den rollenbeschnittenen Ausschnitt (wie im Browser). So kann z. B.
 *                ein Abteilungsleiter über keinen Bericht an Daten fremder Abteilungen kommen.
 *             2. Sammelschreiben: viele Zeilen in EINEM Schreibzugriff anlegen bzw. ändern (z. B. 60 Ehrungen
 *                übernehmen). DB.einfuegen braucht je Zeile rund zehn Tabellenzugriffe – bei Sammelvorgängen zu
 *                langsam. Hier: ID-Zähler einmal reservieren, Eindeutigkeit im Speicher prüfen, einmal anhängen.
 * Datenquelle: Snapshot.basis() (Cache), SnapshotKern.fuer(); Sammelschreiben direkt über DB.blatt/DB.anhaengen.
 * Wer darf was: – (die aufrufenden Module prüfen Rolle und Zeilenschutz vorher).
 * Besonderheiten:
 *   - Sammelschreiben NUR innerhalb von DB.mitSperre aufrufen (wie DB.einfuegen). Danach DB.vorratLeeren().
 *   - Spalten werden über die Kopfzeile (Namen) gefunden, nie über die Position.
 *   - Wunsch an den Datenzugriff (DB): einfuegenViele/aktualisiereViele dort zentral anbieten; dann entfällt
 *     dieser Teil hier.
 */
var Bereichsdaten = (function () {

  /** Umkehrung SnapshotKern.LISTEN: Listenname → Tab. */
  function tabZuListe() {
    var m = {};
    Object.keys(SnapshotKern.LISTEN).forEach(function (t) { m[SnapshotKern.LISTEN[t]] = t; });
    return m;
  }

  /**
   * Daten für ktx: { daten: { Tab: [zeilen] }, konfig, heute, alle: bool }.
   * alle = true → vollständige Basis (nur bei Zeilensicht „alle“), sonst der beschnittene Ausschnitt.
   */
  function fuer(ktx) {
    var basis = Snapshot.basis();
    var heute = DB.jetzt().slice(0, 10);
    var alle = Rechte.zeilenSicht(ktx).alle === true;
    if (alle) return { daten: basis.tabs, konfig: basis.konfig || {}, heute: heute, alle: true };
    var schnitt = SnapshotKern.fuer(basis, ktx, heute);
    var zuTab = tabZuListe();
    var daten = {};
    Object.keys(schnitt).forEach(function (liste) { if (zuTab[liste]) daten[zuTab[liste]] = schnitt[liste]; });
    return { daten: daten, konfig: basis.konfig || {}, heute: heute, alle: false };
  }

  /** Index { id: zeile } eines Tabs. */
  function index(zeilen, feld) {
    var m = {};
    (zeilen || []).forEach(function (z) { m[z[feld]] = z; });
    return m;
  }

  /** „Nachname, Vorname“. */
  function name(m) { return m ? [m.nachname, m.vorname].filter(Boolean).join(', ') : '–'; }

  /** Gilt eine Einwilligung der Art `art` für die Person am Stichtag (erteilt, nicht widerrufen)? */
  function hatEinwilligung(einwilligungen, mitgliedId, art, stichtag) {
    return (einwilligungen || []).some(function (e) {
      return e.mitglied_id === mitgliedId && e.art === art && e.erteilt_am && e.erteilt_am <= stichtag &&
        (!e.widerrufen_am || e.widerrufen_am > stichtag);
    });
  }

  // ------------------------------------------------------------------ Sammelschreiben

  function kopf(b) {
    var n = b.getLastColumn();
    DB.zaehle(1);
    var k = b.getRange(1, 1, 1, n).getValues()[0].map(function (x) { return String(x).trim(); });
    DB.zaehle(1);
    return k;
  }

  /** Reserviert `anzahl` IDs aus _Konfig.next_id_<Tab> (ein Lese-, ein Schreibzugriff). Liefert die erste ID. */
  function reserviereIds(tab, anzahl, bestand) {
    var idSpalte = Schema.TABELLEN[tab].idSpalte;
    var k = DB.blatt('_Konfig');
    var kk = kopf(k);
    var letzte = k.getLastRow();
    DB.zaehle(1);
    var sS = kk.indexOf('schluessel'), sW = kk.indexOf('wert');
    var name = 'next_id_' + tab;
    var maxBestand = 0;
    (bestand || []).forEach(function (z) { var v = Number(z[idSpalte]); if (v > maxBestand) maxBestand = v; });
    if (letzte >= 2) {
      var zeilen = k.getRange(2, 1, letzte - 1, kk.length).getValues();
      DB.zaehle(1);
      for (var i = 0; i < zeilen.length; i++) {
        if (String(zeilen[i][sS]).trim() !== name) continue;
        var start = Math.max(Number(zeilen[i][sW]) || 1, maxBestand + 1);
        k.getRange(i + 2, sW + 1).setValue(String(start + anzahl));
        DB.zaehle(1);
        return start;
      }
    }
    var erste = maxBestand + 1;
    DB.anhaengen(k, [kk.map(function (h) {
      return h === 'schluessel' ? name : h === 'wert' ? String(erste + anzahl) : h === 'beschreibung' ? 'ID-Zähler — nur vom Skript erhöhen' : '';
    })]);
    return erste;
  }

  /**
   * Legt viele Zeilen an (nur in DB.mitSperre). Prüft Feldwerte (Werte.pruefe) und Eindeutigkeiten im Speicher.
   * Liefert die gespeicherten Objekte (mit ID, version 1).
   */
  function einfuegen(tab, objekte, ktx) {
    if (!objekte.length) return [];
    var t = Schema.TABELLEN[tab];
    var fehler = [];
    objekte.forEach(function (o) { fehler = fehler.concat(Werte.pruefe(tab, o)); });
    if (fehler.length) throw Fehler.fachlich(fehler.map(function (f) { return f.meldung; }).join(' '));
    var bestand = DB.lese([tab])[tab] || [];
    (t.eindeutig || []).forEach(function (gruppe) {
      var schl = function (z) {
        var w = gruppe.map(function (s) { return z[s] === null || z[s] === undefined ? '' : String(z[s]); });
        return w.every(function (x) { return x === ''; }) ? null : w.join('|');
      };
      var gesehen = {};
      bestand.forEach(function (z) { var s = schl(z); if (s) gesehen[s] = true; });
      objekte.forEach(function (o) {
        var s = schl(o);
        if (!s) return;
        if (gesehen[s]) throw Fehler.fachlich('Diesen Eintrag gibt es bereits (' + gruppe.map(Werte.feldname).join(', ') + ').');
        gesehen[s] = true;
      });
    });
    var start = t.idSpalte ? reserviereIds(tab, objekte.length, bestand) : null;
    var jetzt = DB.jetzt();
    var namen = t.spalten.map(function (s) { return s.name; });
    var b = DB.blatt(tab);
    var kk = kopf(b);
    var neu = objekte.map(function (o, i) {
      var z = {};
      Object.keys(o).forEach(function (k) { if (namen.indexOf(k) >= 0) z[k] = o[k]; });
      if (t.idSpalte) z[t.idSpalte] = start + i;
      if (namen.indexOf('version') >= 0) z.version = 1;
      if (namen.indexOf('geaendert_am') >= 0) z.geaendert_am = jetzt;
      if (namen.indexOf('geaendert_von') >= 0) z.geaendert_von = (ktx && ktx.email) || null;
      return z;
    });
    var zeilen = neu.map(function (z) { return Werte.objektZuZeile(kk, z, tab); });
    DB.anhaengen(b, zeilen);
    DB.vorratLeeren();
    return zeilen.map(function (z) { return Werte.zeileZuObjekt(kk, z, tab); });
  }

  /**
   * Ändert viele Zeilen eines Tabs (nur in DB.mitSperre): aenderungen = [{ id, version, werte }].
   * version null/undefined → keine Versionsprüfung (nur für Läufe des Systems, z. B. Fristen neu berechnen).
   * Liest den Tab einmal, schreibt jede geänderte Zeile einzeln (wenige) bzw. den Block (viele).
   * Liefert [{ alt, neu, diff }] nur für tatsächlich geänderte Zeilen.
   */
  function aktualisieren(tab, aenderungen, ktx) {
    if (!aenderungen.length) return [];
    var t = Schema.TABELLEN[tab];
    var b = DB.blatt(tab);
    var kk = kopf(b);
    var letzte = b.getLastRow();
    DB.zaehle(1);
    if (letzte < 2) throw Fehler.fachlich('Der Datensatz wurde nicht gefunden. Bitte die Ansicht neu laden.');
    var block = b.getRange(2, 1, letzte - 1, kk.length).getValues();
    DB.zaehle(1);
    var sId = kk.indexOf(t.idSpalte);
    var nachId = {};
    block.forEach(function (z, i) { nachId[String(z[sId])] = i; });
    var jetzt = DB.jetzt();
    var ergebnis = [];
    var geaendert = {};
    aenderungen.forEach(function (a) {
      var i = nachId[String(a.id)];
      if (i === undefined) throw Fehler.fachlich('Der Datensatz wurde nicht gefunden. Bitte die Ansicht neu laden.');
      var alt = Werte.zeileZuObjekt(kk, block[i], tab);
      if (a.version !== null && a.version !== undefined && kk.indexOf('version') >= 0 && Number(alt.version || 0) !== Number(a.version)) {
        throw Fehler.konflikt(alt);
      }
      var fehler = Werte.pruefe(tab, a.werte, { teilweise: true });
      if (fehler.length) throw Fehler.fachlich(fehler.map(function (f) { return f.meldung; }).join(' '));
      var d = Werte.diff(tab, alt, a.werte);
      if (!d.length) return;
      var neu = {};
      Object.keys(alt).forEach(function (k) { neu[k] = alt[k]; });
      Object.keys(a.werte).forEach(function (k) { if (k !== t.idSpalte && Werte.TECHNISCHE_FELDER.indexOf(k) < 0) neu[k] = a.werte[k]; });
      if (kk.indexOf('version') >= 0) neu.version = Number(alt.version || 0) + 1;
      if (kk.indexOf('geaendert_am') >= 0) neu.geaendert_am = jetzt;
      if (kk.indexOf('geaendert_von') >= 0) neu.geaendert_von = (ktx && ktx.email) || null;
      block[i] = Werte.objektZuZeile(kk, neu, tab, block[i]);
      geaendert[i] = true;
      ergebnis.push({ alt: alt, neu: Werte.zeileZuObjekt(kk, block[i], tab), diff: d });
    });
    var idx = Object.keys(geaendert).map(Number);
    if (idx.length > 20) {
      b.getRange(2, 1, block.length, kk.length).setValues(block);
      DB.zaehle(1);
    } else {
      idx.forEach(function (i) { b.getRange(i + 2, 1, 1, kk.length).setValues([block[i]]); DB.zaehle(1); });
    }
    DB.vorratLeeren();
    return ergebnis;
  }

  return { fuer: fuer, index: index, name: name, hatEinwilligung: hatEinwilligung, einfuegen: einfuegen, aktualisieren: aktualisieren };
})();
