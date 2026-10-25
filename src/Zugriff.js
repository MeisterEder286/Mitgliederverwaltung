/**
 * Zugriffsprüfung: Wer ruft auf, und darf er das?
 *
 * Zweck:      Ermittelt bei JEDEM Server-Aufruf die angemeldete Person über
 *             Session.getActiveUser().getEmail(), sucht sie im Tab „Benutzer“ und prüft die angefragte
 *             Aktion gegen die Rechtematrix (lib/rechte.js). Sicherheitsregel A2.
 * Datenquelle: Tab „Benutzer“ (eine Zeile je Rollenzuweisung), für 5 Minuten im Script-Cache.
 * Wer darf was: Jeder Aufruf ohne passenden aktiven Benutzereintrag wird abgewiesen und protokolliert.
 * Besonderheiten:
 *   - Die WebApp läuft als Eigentümer („Ausführen als: Ich“) und ist auf die Vereinsdomain beschränkt.
 *     Nur dann liefert getActiveUser() die Adresse des Aufrufers. Ist sie leer, wird abgewiesen.
 *   - Nach Änderungen am Tab Benutzer Zugriff.vergessen() aufrufen, sonst gilt bis zu 5 Minuten der alte Stand.
 *   - nurFunktionskonto() schützt Funktionen, die nur der Eigentümer im Editor oder ein Trigger ausführen
 *     soll (Setup, Trigger). [A]/[?] Annahme: Bei zeitgesteuerten Triggern, die der Eigentümer angelegt hat,
 *     liefert getActiveUser() die Adresse des Eigentümers. Falls nicht (leer), schlägt die Prüfung fehl –
 *     das ist die sichere Seite; dann muss die betroffene Trigger-Funktion anders abgesichert werden.
 */
var Zugriff = (function () {
  var CACHE_SCHLUESSEL = 'benutzer:v1';
  var CACHE_SEKUNDEN = 300;

  function benutzerZeilen() {
    var cache = null;
    try {
      cache = CacheService.getScriptCache();
      var roh = cache.get(CACHE_SCHLUESSEL);
      if (roh) return JSON.parse(roh);
    } catch (e) { cache = null; }
    // Kaltstart: fehlt auch die Snapshot-Basis im Cache, werden deren Tabs im selben batchGet mitgelesen
    // (DB-Vorrat) – so kostet der erste Aufruf nur EINEN Tabellenzugriff.
    var tabs = (typeof Snapshot !== 'undefined' && Snapshot.mitlesen) ? Snapshot.mitlesen(['Benutzer']) : ['Benutzer'];
    var zeilen = DB.lese(tabs).Benutzer || [];
    try { if (cache) cache.put(CACHE_SCHLUESSEL, JSON.stringify(zeilen), CACHE_SEKUNDEN); } catch (e) { /* Cache ist nur Beschleunigung */ }
    return zeilen;
  }

  function abweisen(email, aktion) {
    try {
      Protokoll.schreibe({ email: email || '(unbekannt)' }, [{
        aktion: 'abgewiesen', tabelle: 'Benutzer', datensatz_id: '-', kommentar: String(aktion || '')
      }]);
    } catch (e) {
      // Ein Protokollfehler darf die Abweisung nicht verhindern.
      console.error('Abweisung konnte nicht protokolliert werden: ' + (e && e.message));
    }
    return Fehler.keinZugriff();
  }

  /** Liefert den Rechte-Kontext oder wirft Fehler.keinZugriff(). */
  function pruefe(aktion) {
    var email = '';
    try { email = String(Session.getActiveUser().getEmail() || '').trim(); } catch (e) { email = ''; }
    if (!email) throw abweisen('', aktion);
    var ktx = Rechte.kontext(benutzerZeilen(), email);
    if (!ktx || !Rechte.darf(ktx, aktion)) throw abweisen(email, aktion);
    return ktx;
  }

  /** Benutzer-Cache leeren (nach jeder Änderung am Tab Benutzer). */
  function vergessen() {
    try { CacheService.getScriptCache().remove(CACHE_SCHLUESSEL); } catch (e) { /* nichts zu tun */ }
  }

  /** Nur der Eigentümer (Funktionskonto) im Editor oder in einem Trigger. */
  function nurFunktionskonto() {
    var aktiv = '', effektiv = '';
    try {
      aktiv = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
      effektiv = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
    } catch (e) { aktiv = ''; }
    if (!aktiv || aktiv !== effektiv) throw abweisen(aktiv, 'nur_funktionskonto');
    return { email: aktiv, rollen: ['Funktionskonto'] };
  }

  return { pruefe: pruefe, vergessen: vergessen, nurFunktionskonto: nurFunktionskonto };
})();
