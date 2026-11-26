/**
 * Snapshot – Server-Seite des Daten-Snapshots: Basis aus Cache oder Tabelle, Rollen-Sicht, write-through.
 *
 * Zweck:      Liefert jedem Benutzer beim Start einen rollenbeschnittenen Datenbestand (Snapshot.fuer) und hält
 *             die Basis bei jedem Schreibzugriff aktuell (Snapshot.schreibe), damit nach dem Speichern KEIN
 *             zweiter Lesevorgang nötig ist (Auftragspunkte 1–3).
 * Datenquelle: CacheService ('snapshot:basis', 6 h, je Tab gzip in Teilstücken über Cache.speichereMehrteilig –
 *             beim Speichern werden nur geänderte Tabs neu gepackt). Fehlt der Eintrag,
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
  var WARM_NEU_AB_MS = 4 * 3600 * 1000;   // stündlicher Trigger → spätestens nach ~5 h neu gebaut, vor Ablauf (6 h)
  var basisSpeicher = null;     // je Ausführung
  var basisKopf = null;         // Cache-Kopf zu basisSpeicher (unveränderte Tabs werden beim Ablegen weiterverwendet)
  var basisSperre = 0;          // DB.sperre() beim Laden von basisSpeicher (0 = außerhalb einer Sperre geladen)
  var cacheErgebnis = null;

  function heute() { return DB.jetzt().slice(0, 10); }

  function leseTabs() { return SnapshotKern.TABS.concat(['_Konfig']); }

  function konfigAus(zeilen) {
    var k = {};
    (zeilen || []).forEach(function (z) { if (z.schluessel) k[z.schluessel] = z.wert === null ? '' : String(z.wert); });
    return k;
  }

  /** Neu aus der Tabelle bauen und ablegen → { basis, kopf }. */
  function baueAusTabelle() {
    var d = DB.lese(leseTabs());
    var basis = SnapshotKern.basisAusTabs(d, konfigAus(d._Konfig));
    basis.gebaut_am = DB.jetzt();
    basis.aus_tabelle_am = basis.gebaut_am;   // nur hier gesetzt – Maß für warmhalten (write-through ändert es nicht)
    return { basis: basis, kopf: ablegen(basis, null, null) };
  }

  /**
   * Im Cache ablegen – je Tab ein Eintrag; mit vorher/geaendert werden nur die geänderten Tabs neu gepackt.
   * Scheitert das, den alten Eintrag verwerfen – sonst bliebe ein veralteter Stand gültig. Liefert den Kopf oder null.
   */
  function ablegen(b, vorher, geaendert) {
    var kopf = Cache.speichereMehrteilig(SCHLUESSEL,
      { konfig: b.konfig, gebaut_am: b.gebaut_am, aus_tabelle_am: b.aus_tabelle_am }, b.tabs, vorher, geaendert, DAUER_S);
    if (!kopf) Cache.verwerfe(SCHLUESSEL);
    return kopf;
  }

  /** Basis aus dem Cache → { basis, kopf } oder null. */
  function ausCache() {
    var r = Cache.ladeMehrteilig(SCHLUESSEL);
    if (!r) return null;
    var d = r.daten || {};
    return { basis: { tabs: r.eintraege, konfig: d.konfig || {}, gebaut_am: d.gebaut_am, aus_tabelle_am: d.aus_tabelle_am }, kopf: r.kopf };
  }

  /** Basis der laufenden Ausführung (Speicher → Cache → Tabelle). */
  function basis() {
    if (basisSpeicher) return basisSpeicher;
    var c = ausCache();
    cacheErgebnis = c ? 'treffer' : 'fehlgriff';
    merkeBasis(c || baueAusTabelle());
    return basisSpeicher;
  }

  function merkeBasis(stand) {
    basisSpeicher = stand.basis;
    basisKopf = stand.kopf;
    basisSperre = DB.sperre();
  }

  /** Für die Zugriffsprüfung: zu lesende Tabs um die Basis-Tabs ergänzen, wenn die Basis nicht im Cache liegt. */
  function mitlesen(tabs) {
    if (basisSpeicher || Cache.vorhanden(SCHLUESSEL)) return tabs;
    return tabs.concat(leseTabs().filter(function (t) { return tabs.indexOf(t) < 0; }));
  }

  function fuer(ktx) { return SnapshotKern.fuer(basis(), ktx, heute()); }

  /** Für den Browser: nur die gewünschten Bereiche (Standard Kern), in Spaltenform gepackt. */
  function fuerClient(ktx, bereiche) {
    var b = (bereiche || ['kern']).filter(function (x) { return x === 'kern' || SnapshotKern.BEREICHE[x]; });
    return { bereiche: b, listen: SnapshotKern.packe(SnapshotKern.nurBereiche(fuer(ktx), b)) };
  }

  /**
   * Write-through: aenderungen = [{ tab, neu } | { tab, entfernt }] nach erfolgreichem DB-Schreiben.
   * Liefert die Antwort für den Browser { aktualisiert, entfernt }. Nur innerhalb DB.mitSperre.
   * Wurde die Basis schon unter DERSELBEN Sperre geladen (z. B. von pruefeMitglied), ist sie aktuell und wird
   * weiterverwendet – sonst frisch aus dem Cache (eine ältere Kopie könnte fremde Speicherungen überschreiben).
   */
  function schreibe(ktx, aenderungen) {
    var sperre = DB.sperre();
    var stand = basisSpeicher && sperre && basisSperre === sperre ? { basis: basisSpeicher, kopf: basisKopf } : ausCache();
    if (!stand) {
      stand = baueAusTabelle();   // liest frisch (unter der Sperre) – enthält die Änderung bereits
    } else {
      var alt = stand.basis;
      var b = SnapshotKern.aenderungAnwenden(alt, aenderungen);
      b.gebaut_am = DB.jetzt();
      b.aus_tabelle_am = alt.aus_tabelle_am;
      var geaendert = [];
      (aenderungen || []).forEach(function (a) { if (SnapshotKern.LISTEN[a.tab] && geaendert.indexOf(a.tab) < 0) geaendert.push(a.tab); });
      stand = { basis: b, kopf: ablegen(b, stand.kopf, geaendert) };
    }
    merkeBasis(stand);
    return SnapshotKern.antwortFuer(stand.basis, ktx, heute(), aenderungen);
  }

  /** Wirft Fehler.keinZugriff(), wenn die Person für ktx nicht sichtbar ist. */
  function pruefeMitglied(ktx, id) {
    if (!SnapshotKern.mitgliedSichtbar(basis(), ktx, heute(), id)) throw Fehler.keinZugriff();
  }

  /** Cache ungültig machen (nach Setup, Massenänderungen, direkten Eingriffen in die Tabelle). */
  function verwerfen() {
    basisSpeicher = null;
    basisKopf = null;
    Cache.verwerfe(SCHLUESSEL);
  }

  /**
   * Für den stündlichen Trigger: Konfig-Cache auffrischen und die Basis neu bauen, wenn sie im Cache fehlt oder
   * älter als WARM_NEU_AB_MS ist. Der Neubau läuft unter der Sperre, damit er keine gleichzeitige Speicherung im
   * Cache mit einem älteren Tabellenstand überschreibt.
   */
  function warmhalten() {
    if (Konfig.wert('cache_warmhalten') !== 'ja') return false;
    Konfig.vergessen();
    Konfig.alle();
    var c = ausCache();
    if (c && alterMs(c.basis) < WARM_NEU_AB_MS) return 'aktuell';
    return DB.mitSperre(function () {
      merkeBasis(baueAusTabelle());
      return 'neu gebaut';
    });
  }

  function alterMs(b) {
    var gebaut = Date.parse(b && b.aus_tabelle_am);
    return isFinite(gebaut) ? Date.parse(DB.jetzt()) - gebaut : Infinity;
  }

  function letzterCache() { return cacheErgebnis; }

  return {
    fuerClient: fuerClient,
    basis: basis, fuer: fuer, schreibe: schreibe, pruefeMitglied: pruefeMitglied, verwerfen: verwerfen,
    warmhalten: warmhalten, mitlesen: mitlesen, letzterCache: letzterCache
  };
})();
