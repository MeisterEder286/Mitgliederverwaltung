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

  /**
   * Setzt einen Wert in _Konfig (legt den Schlüssel an, falls er fehlt). Nur innerhalb DB.mitSperre und nur
   * nach Rechteprüfung (konfig_aendern) bzw. für skriptinterne Zähler (z. B. mitgliedsnummer_naechste).
   * Liefert den alten Wert (oder null). Leert danach den Konfig-Cache.
   */
  function setze(schluessel, wert, beschreibung) {
    var b = DB.blatt('_Konfig');
    var letzte = b.getLastRow(), spalten = b.getLastColumn();
    var daten = b.getRange(1, 1, Math.max(letzte, 1), spalten).getValues();
    DB.zaehle(3);
    var kopf = daten[0].map(function (k) { return String(k).trim(); });
    var iS = kopf.indexOf('schluessel'), iW = kopf.indexOf('wert'), iB = kopf.indexOf('beschreibung');
    for (var i = 1; i < daten.length; i++) {
      if (String(daten[i][iS]).trim() === schluessel) {
        var alt = daten[i][iW];
        b.getRange(i + 1, iW + 1).setValue(Werte.zelleSchreiben(String(wert === null || wert === undefined ? '' : wert), { typ: 'Text' }));
        DB.zaehle(1);
        vergessen();
        return alt === '' ? null : String(alt);
      }
    }
    var zeile = kopf.map(function (k, j) {
      return j === iS ? schluessel : j === iW ? String(wert === null || wert === undefined ? '' : wert) : j === iB ? (beschreibung || '') : '';
    });
    DB.anhaengen(b, [zeile], letzte);
    vergessen();
    return null;
  }

  function vergessen() {
    speicher = null;
    if (typeof DB !== 'undefined' && DB.vorratLeeren) DB.vorratLeeren();
    CacheService.getScriptCache().remove(SCHLUESSEL);
  }

  return { alle: alle, wert: wert, setze: setze, vergessen: vergessen };
})();
