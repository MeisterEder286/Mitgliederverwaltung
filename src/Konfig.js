/**
 * Konfig – liest die Einstellungen aus dem Tab _Konfig (Schlüssel → Wert).
 *
 * Zweck:       Beitragsjahr, Fristen, Schalter wie snapshot_einbetten usw. an einer Stelle bereitstellen
 *              ("Konfiguration als Daten" statt fest im Code).
 * Datenquelle: Tab _Konfig über DB.lese; zwischengespeichert im Script-Cache (Schlüssel konfig:v1,
 *              10 Minuten) und für die Dauer einer Ausführung im Speicher.
 * Wer darf:    Lesen ist eine interne Hilfe ohne Rollenprüfung – die Werte gehen nie gesammelt an den
 *              Client. Ändern darf nur, wer die Aktion konfig_aendern hat (Sicherheitsregel A8); wer
 *              ändert, ruft danach Konfig.vergessen() auf.
 * Besonderheit:Alle Werte sind Texte (wie in der Tabelle). Zahlen also selbst umwandeln, z. B.
 *              Number(Konfig.wert('mandat_verfall_monate')). Unbekannter Schlüssel → null.
 */
var Konfig = (function () {
  var SCHLUESSEL = 'konfig:v1';
  var DAUER_S = 600;
  var speicher = null;

  function alle() {
    if (speicher) return speicher;
    var cache = CacheService.getScriptCache();
    var json = cache.get(SCHLUESSEL);
    if (json) {
      speicher = JSON.parse(json);
      return speicher;
    }
    var werte = {};
    DB.lese(['_Konfig'])._Konfig.forEach(function (z) {
      if (z.schluessel) werte[z.schluessel] = z.wert === null ? '' : String(z.wert);
    });
    try { cache.put(SCHLUESSEL, JSON.stringify(werte), DAUER_S); } catch (e) { console.warn('Konfig: Cache nicht geschrieben – ' + e.message); }
    speicher = werte;
    return speicher;
  }

  function wert(schluessel) {
    var w = alle()[schluessel];
    return w === undefined ? null : w;
  }

  function vergessen() {
    speicher = null;
    if (typeof DB !== 'undefined' && DB.vorratLeeren) DB.vorratLeeren();
    CacheService.getScriptCache().remove(SCHLUESSEL);
  }

  return { alle: alle, wert: wert, vergessen: vergessen };
})();
