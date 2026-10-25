/**
 * Snapshot – Server-Seite des Daten-Snapshots: Basis aus Cache oder Tabelle, Rollen-Sicht, write-through.
 *
 * Zweck:      Liefert jedem Benutzer beim Start einen rollenbeschnittenen Datenbestand (Snapshot.fuer) und hält
 *             die Basis bei jedem Schreibzugriff aktuell (Snapshot.schreibe), damit nach dem Speichern KEIN
 *             zweiter Lesevorgang nötig ist (Auftragspunkte 1–3).
 * Datenquelle: CacheService ('snapshot:basis', 6 h, gzip in Teilstücken über Cache.js). Fehlt der Eintrag,
 *             EIN DB.lese über alle Basis-Tabs plus _Konfig; danach wird neu abgelegt.
 * Wer darf was:
 *   - fuer(ktx): Zeilen- und Feldschnitt nach Rolle (Logik in lib/snapshot.js, Rechte in lib/rechte.js).
 *   - pruefeMitglied(ktx, id): Zeilenschutz für Schreibzugriffe (z. B. Abteilungsleiter nur eigene Abteilung).
 * Besonderheiten:
 *   - IBAN/BIC sind nie in der Basis (siehe lib/snapshot.js).
 *   - schreibe() nur innerhalb DB.mitSperre: Die Basis wird unter der Sperre frisch aus dem Cache geholt,
 *     geändert und zurückgeschrieben – so überschreiben sich zwei gleichzeitige Speicherungen nicht.
 *     Fehlt der Cache unter der Sperre, wird aus der Tabelle neu gebaut (enthält die Änderung dann schon).
 *   - mitlesen(tabs): Die Zugriffsprüfung liest beim Kaltstart Benutzer; fehlt die Basis im Cache, werden
 *     deren Tabs im SELBEN batchGet mitgelesen (DB-Vorrat). Kaltstart = 1 Tabellenzugriff.
 *   - letzterCache(): 'treffer' / 'fehlgriff' / null – wird in _Messung mitgeschrieben.
 */
var Snapshot = (function () {
  var SCHLUESSEL = 'snapshot:basis';
  var DAUER_S = 21600;
  var basisSpeicher = null;     // je Ausführung
  var cacheErgebnis = null;

  function heute() { return DB.jetzt().slice(0, 10); }

  function leseTabs() { return SnapshotKern.TABS.concat(['_Konfig']); }

  function konfigAus(zeilen) {
    var k = {};
    (zeilen || []).forEach(function (z) { if (z.schluessel) k[z.schluessel] = z.wert === null ? '' : String(z.wert); });
    return k;
  }

  function baueAusTabelle() {
    var d = DB.lese(leseTabs());
    var basis = SnapshotKern.basisAusTabs(d, konfigAus(d._Konfig));
    basis.gebaut_am = DB.jetzt();
    Cache.speichere(SCHLUESSEL, basis, DAUER_S);
    return basis;
  }

  /** Basis der laufenden Ausführung (Speicher → Cache → Tabelle). */
  function basis() {
    if (basisSpeicher) return basisSpeicher;
    var b = Cache.lade(SCHLUESSEL);
    if (b) { cacheErgebnis = 'treffer'; basisSpeicher = b; return b; }
    cacheErgebnis = 'fehlgriff';
    basisSpeicher = baueAusTabelle();
    return basisSpeicher;
  }

  /** Für die Zugriffsprüfung: zu lesende Tabs um die Basis-Tabs ergänzen, wenn die Basis nicht im Cache liegt. */
  function mitlesen(tabs) {
    if (basisSpeicher || Cache.vorhanden(SCHLUESSEL)) return tabs;
    return tabs.concat(leseTabs().filter(function (t) { return tabs.indexOf(t) < 0; }));
  }

  function fuer(ktx) { return SnapshotKern.fuer(basis(), ktx, heute()); }

  /**
   * Write-through: aenderungen = [{ tab, neu } | { tab, entfernt }] nach erfolgreichem DB-Schreiben.
   * Liefert die Antwort für den Browser { aktualisiert, entfernt }. Nur innerhalb DB.mitSperre.
   */
  function schreibe(ktx, aenderungen) {
    var b = Cache.lade(SCHLUESSEL);
    if (!b) {
      b = baueAusTabelle();   // liest frisch (unter der Sperre) – enthält die Änderung bereits
    } else {
      b = SnapshotKern.aenderungAnwenden(b, aenderungen);
      b.gebaut_am = DB.jetzt();
      Cache.speichere(SCHLUESSEL, b, DAUER_S);
    }
    basisSpeicher = b;
    return SnapshotKern.antwortFuer(b, ktx, heute(), aenderungen);
  }

  /** Wirft Fehler.keinZugriff(), wenn die Person für ktx nicht sichtbar ist. */
  function pruefeMitglied(ktx, id) {
    if (!SnapshotKern.mitgliedSichtbar(basis(), ktx, heute(), id)) throw Fehler.keinZugriff();
  }

  /** Cache ungültig machen (nach Setup, Massenänderungen, direkten Eingriffen in die Tabelle). */
  function verwerfen() {
    basisSpeicher = null;
    Cache.verwerfe(SCHLUESSEL);
  }

  /** Für den optionalen Trigger: Basis neu bauen, bevor der Cache abläuft. */
  function warmhalten() {
    if (Konfig.wert('cache_warmhalten') !== 'ja') return false;
    basisSpeicher = null;
    DB.vorratLeeren();
    basisSpeicher = baueAusTabelle();
    return true;
  }

  function letzterCache() { return cacheErgebnis; }

  return {
    basis: basis, fuer: fuer, schreibe: schreibe, pruefeMitglied: pruefeMitglied, verwerfen: verwerfen,
    warmhalten: warmhalten, mitlesen: mitlesen, letzterCache: letzterCache
  };
})();
