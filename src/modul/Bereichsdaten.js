/**
 * Bereichsdaten – gemeinsame Hilfen der Module Ehrungen, Nachweise und Berichte.
 *
 * Zweck:      1. Liefert die Daten, auf denen ein Bericht für den Aufrufer rechnen darf: bei Zeilensicht „alle“
 *                die vollständige Basis, sonst den rollenbeschnittenen Ausschnitt (wie im Browser). So kann z. B.
 *                ein Abteilungsleiter über keinen Bericht an Daten fremder Abteilungen kommen.
 *             2. Sammelschreiben: viele Zeilen in EINEM Schreibzugriff anlegen bzw. ändern (z. B. 60 Ehrungen
 *                übernehmen) – Hüllen um DB.einfuegenViele / DB.aktualisiereViele.
 * Datenquelle: Snapshot.basis() (Cache), SnapshotKern.fuer(); Sammelschreiben über DB.einfuegenViele/aktualisiereViele.
 * Wer darf was: – (die aufrufenden Module prüfen Rolle und Zeilenschutz vorher).
 * Besonderheiten:
 *   - Sammelschreiben NUR innerhalb von DB.mitSperre aufrufen (wie DB.einfuegen). Danach DB.vorratLeeren().
 *   - Spalten werden über die Kopfzeile (Namen) gefunden, nie über die Position.
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
  // Dünne Hüllen um die zentralen Massenfunktionen in DB (Datenzugriff). Nur innerhalb von DB.mitSperre.

  /** Legt viele Zeilen an (ein Lese-, ein Schreibzugriff). Liefert die gespeicherten Objekte (mit ID, version 1). */
  function einfuegen(tab, objekte, ktx) {
    return DB.einfuegenViele(tab, objekte, ktx);
  }

  /**
   * Ändert viele Zeilen: aenderungen = [{ id, version, werte }]. version null → keine Versionsprüfung
   * (nur für Läufe des Systems, z. B. Fristen neu berechnen). Liefert [{ alt, neu, diff }].
   */
  function aktualisieren(tab, aenderungen, ktx) {
    return DB.aktualisiereViele(tab, aenderungen.map(function (a) {
      return { id: a.id, version: a.version, aenderungen: a.werte };
    }), ktx);
  }

  return { fuer: fuer, index: index, name: name, hatEinwilligung: hatEinwilligung, einfuegen: einfuegen, aktualisieren: aktualisieren };
})();
