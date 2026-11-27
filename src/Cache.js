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
 *   - speichereMehrteilig/ladeMehrteilig: mehrere benannte Einträge unter einem Kopf, nur geänderte werden neu
 *     gepackt (Snapshot: je Tabellenblatt – eine Speicherung packt nicht mehr den ganzen Bestand).
 */
var Cache = (function () {
  var TEIL_ZEICHEN = 90 * 1024;
  var MAX_SEKUNDEN = 21600;
  var NEU_PACKEN_AB_MS = 3 * 3600 * 1000;   // mehrteilig: ältere Einträge mit neu schreiben (Cache hält höchstens 6 h)
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

  function neueGeneration() { return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /**
   * Mehrteilig: mehrere benannte Objekte (z. B. je Tabellenblatt) unter EINEM Kopf. Nur geänderte Einträge werden neu
   * gepackt; unveränderte verweisen auf die Teile des bisherigen Kopfs (vorher). Einträge, deren Teile älter als
   * NEU_PACKEN_AB_MS sind, werden trotzdem neu geschrieben, damit sie nicht vor dem Kopf aus dem Cache verfallen.
   *   daten:     kleines Objekt, steht direkt im Kopf
   *   eintraege: { name: objekt }
   *   vorher:    Kopf aus ladeMehrteilig (oder null)
   *   geaendert: [namen] – null = alle neu packen
   * Liefert den neuen Kopf oder null bei Fehler (dann bleibt der alte Kopf – der Aufrufer sollte verwerfen).
   */
  function speichereMehrteilig(schluessel, daten, eintraege, vorher, geaendert, sekunden) {
    try {
      var jetzt = Date.now();
      var dauer = Math.min(sekunden || MAX_SEKUNDEN, MAX_SEKUNDEN);
      var verweise = {}, schreiben = {}, n = 0;
      Object.keys(eintraege).forEach(function (name) {
        var alt = vorher && vorher.eintraege && vorher.eintraege[name];
        if (alt && geaendert && geaendert.indexOf(name) < 0 && jetzt - (alt.am || 0) < NEU_PACKEN_AB_MS) {
          verweise[name] = alt;
          return;
        }
        var text = packe(eintraege[name]);
        var gen = neueGeneration(), teile = 0;
        for (var i = 0; i < text.length; i += TEIL_ZEICHEN) {
          schreiben[schluessel + ':' + name + ':g' + gen + ':' + teile] = text.slice(i, i + TEIL_ZEICHEN);
          teile++;
          n++;
        }
        verweise[name] = { generation: gen, teile: teile, am: jetzt };
      });
      var c = cache();
      if (n) c.putAll(schreiben, dauer);
      var kopf = { mehrteilig: true, daten: daten, eintraege: verweise };
      c.put(schluessel + ':kopf', JSON.stringify(kopf), dauer);
      return kopf;
    } catch (e) {
      console.warn('Cache.speichereMehrteilig(' + schluessel + ') fehlgeschlagen: ' + (e && e.message));
      return null;
    }
  }

  /** Lädt { daten, eintraege: { name: objekt }, kopf } oder null (fehlt, Teil fehlt, altes Format, defekt). */
  function ladeMehrteilig(schluessel) {
    try {
      var c = cache();
      var kopfText = c.get(schluessel + ':kopf');
      if (!kopfText) return null;
      var kopf = JSON.parse(kopfText);
      if (!kopf.mehrteilig) return null;
      var namen = [];
      Object.keys(kopf.eintraege).forEach(function (name) {
        var e = kopf.eintraege[name];
        for (var i = 0; i < e.teile; i++) namen.push(schluessel + ':' + name + ':g' + e.generation + ':' + i);
      });
      var teile = namen.length ? c.getAll(namen) : {};
      var eintraege = {};
      var namenListe = Object.keys(kopf.eintraege);
      for (var j = 0; j < namenListe.length; j++) {
        var name = namenListe[j], e2 = kopf.eintraege[name], text = '';
        for (var k = 0; k < e2.teile; k++) {
          var t = teile[schluessel + ':' + name + ':g' + e2.generation + ':' + k];
          if (typeof t !== 'string') return null;
          text += t;
        }
        eintraege[name] = entpacke(text);
      }
      return { daten: kopf.daten, eintraege: eintraege, kopf: kopf };
    } catch (e) {
      console.warn('Cache.ladeMehrteilig(' + schluessel + ') fehlgeschlagen: ' + (e && e.message));
      return null;
    }
  }

  return {
    speichere: speichere, lade: lade, vorhanden: vorhanden, verwerfe: verwerfe,
    speichereMehrteilig: speichereMehrteilig, ladeMehrteilig: ladeMehrteilig
  };
})();
