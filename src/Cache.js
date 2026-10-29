/**
 * Cache – große Objekte im CacheService ablegen (gzip, Base64, in Teilstücken).
 *
 * Zweck:      Der Snapshot ist größer als die 100 KB, die der CacheService je Eintrag erlaubt. Er wird deshalb
 *             als JSON gepackt (gzip), Base64-kodiert und in Teilstücke ≤ 90 KB zerlegt.
 * Datenquelle: CacheService.getScriptCache() – gemeinsam für alle Ausführungen dieses Skripts.
 * Wer darf was: nur Server-Code; der Inhalt verlässt den Server nie direkt.
 * Besonderheiten:
 *   - Generation: Jede Speicherung bekommt eine neue Generation; die Teile heißen <schluessel>:g<gen>:<i>,
 *     der Kopf <schluessel>:kopf = { generation, teile }. Der Kopf wird ZULETZT geschrieben. Ein Leser folgt
 *     immer dem Kopf und bekommt so nie eine Mischung aus alten und neuen Teilen. Fehlt ein Teil (der Cache
 *     darf Einträge jederzeit verwerfen), ist das Ergebnis null → der Aufrufer baut neu.
 *   - Höchstdauer im CacheService: 6 Stunden (21600 s).
 *   - [A]/[?] Annahmen zum Apps-Script-Verhalten: Utilities.gzip(blob) liefert einen Blob mit gzip-Daten,
 *     Utilities.ungzip(blob) kehrt das um (der Blob braucht dazu den Inhaltstyp application/x-gzip);
 *     Utilities.base64Encode(bytes)/base64Decode(text) arbeiten mit Byte-Arrays. putAll/getAll sind je
 *     ein Cache-Aufruf. Falls gzip in Produktion Probleme macht, kann PACKEN auf false gesetzt werden.
 *   - Cache-Fehler sind nie fatal: speichere() schluckt sie (Cache ist nur Beschleunigung), lade() liefert null.
 */
var Cache = (function () {
  var TEIL_ZEICHEN = 90 * 1024;
  var MAX_SEKUNDEN = 21600;
  var PACKEN = true;

  function cache() { return CacheService.getScriptCache(); }

  function packe(objekt) {
    var json = JSON.stringify(objekt);
    if (!PACKEN) return 'J' + json;
    var gz = Utilities.gzip(Utilities.newBlob(json, 'application/json'));
    return 'Z' + Utilities.base64Encode(gz.getBytes());
  }

  function entpacke(text) {
    if (text.charAt(0) === 'J') return JSON.parse(text.slice(1));
    var bytes = Utilities.base64Decode(text.slice(1));
    var json = Utilities.ungzip(Utilities.newBlob(bytes, 'application/x-gzip')).getDataAsString();
    return JSON.parse(json);
  }

  /** Legt ein Objekt ab. Liefert die Zahl der Teilstücke (0 bei Fehler). */
  function speichere(schluessel, objekt, sekunden) {
    try {
      var text = packe(objekt);
      var generation = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      var teile = {};
      var n = 0;
      for (var i = 0; i < text.length; i += TEIL_ZEICHEN) {
        teile[schluessel + ':g' + generation + ':' + n] = text.slice(i, i + TEIL_ZEICHEN);
        n++;
      }
      var dauer = Math.min(sekunden || MAX_SEKUNDEN, MAX_SEKUNDEN);
      var c = cache();
      c.putAll(teile, dauer);
      c.put(schluessel + ':kopf', JSON.stringify({ generation: generation, teile: n }), dauer);
      return n;
    } catch (e) {
      console.warn('Cache.speichere(' + schluessel + ') fehlgeschlagen: ' + (e && e.message));
      // Den bisherigen Stand nicht weiter ausliefern – sonst sähen alle Leser bis zu 6 h die Fassung VOR der Änderung
      verwerfe(schluessel);
      return 0;
    }
  }

  /** Kopf vorhanden? (ein Cache-Aufruf, ohne die Teile zu laden) */
  function vorhanden(schluessel) {
    try { return !!cache().get(schluessel + ':kopf'); } catch (e) { return false; }
  }

  /** Lädt ein Objekt oder null (nicht vorhanden, Teil fehlt, defekt). */
  function lade(schluessel) {
    try {
      var c = cache();
      var kopfText = c.get(schluessel + ':kopf');
      if (!kopfText) return null;
      var kopf = JSON.parse(kopfText);
      var namen = [];
      for (var i = 0; i < kopf.teile; i++) namen.push(schluessel + ':g' + kopf.generation + ':' + i);
      var teile = c.getAll(namen);
      var text = '';
      for (var j = 0; j < namen.length; j++) {
        if (typeof teile[namen[j]] !== 'string') return null;
        text += teile[namen[j]];
      }
      return entpacke(text);
    } catch (e) {
      console.warn('Cache.lade(' + schluessel + ') fehlgeschlagen: ' + (e && e.message));
      return null;
    }
  }

  /** Macht den Eintrag ungültig (Kopf entfernen genügt; die Teile verfallen von selbst). */
  function verwerfe(schluessel) {
    try { cache().remove(schluessel + ':kopf'); } catch (e) { /* nichts zu tun */ }
  }

  return { speichere: speichere, lade: lade, vorhanden: vorhanden, verwerfe: verwerfe };
})();
