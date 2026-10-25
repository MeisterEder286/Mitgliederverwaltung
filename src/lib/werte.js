/**
 * Werte – Umwandlung und Prüfung von Feldwerten zwischen Tabelle und Programm.
 *
 * Zweck:       Eine Stelle, die festlegt, wie ein Wert aus einer Tabellenzelle im Programm aussieht und
 *              umgekehrt (siehe docs/ENTWICKLUNG.md, Abschnitt 4):
 *                Datum      Zelle: Seriennummer        Programm: "JJJJ-MM-TT"
 *                Zeitpunkt  Zelle: Seriennummer        Programm: "JJJJ-MM-TTThh:mm:ss"
 *                ja/nein    Zelle: "ja" / "nein"       Programm: true / false
 *                Zahl       Zelle: Zahl                Programm: number
 *                Text       Zelle: Text                Programm: string
 *                leer       Zelle: leer                Programm: null
 *              Außerdem: Pflicht-/Typ-/Auswahllisten-Prüfung und Unterschiede zwischen zwei Ständen.
 * Datenquelle: nur das Datenmodell (Schema.TABELLEN, Schema.LISTEN). Kein Zugriff auf Tabellen.
 * Wer darf:    reine Hilfsfunktionen, keine Rechteprüfung (die liegt in Zugriff/Rechte).
 * Besonderheit:Seriennummer = Tage seit 30.12.1899 (so zählen Google Sheets und Excel). Gerechnet wird
 *              über UTC, damit Sommer-/Winterzeit keine Rolle spielt: Die Zahl beschreibt Kalendertag und
 *              Uhrzeit so, wie sie in der Tabelle stehen, unabhängig von der Zeitzone des Servers.
 *              Läuft unverändert in Apps Script und in Node (Tests).
 */
var Werte = (function () {
  var MS_PRO_TAG = 86400000;
  var SERIAL_1970 = 25569; // Seriennummer des 01.01.1970
  var TECHNISCHE_FELDER = ['version', 'geaendert_am', 'geaendert_von'];

  function zweistellig(n) { return (n < 10 ? '0' : '') + n; }

  /** Lesbare Feldbezeichnung für Meldungen: "beitragskonto_id" → "Beitragskonto", "plz" → "Plz".
   *  Die Oberfläche ordnet Meldungen über das Feld {feld} ihren eigenen Beschriftungen zu. */
  function feldname(feld) {
    var t = String(feld).replace(/_id$/, '').replace(/_/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function leer(v) { return v === null || v === undefined || v === ''; }

  /** Seriennummer → "JJJJ-MM-TT" (Uhrzeitanteil wird abgeschnitten). */
  function serialZuDatum(n) {
    var d = new Date((Math.floor(Number(n)) - SERIAL_1970) * MS_PRO_TAG);
    return d.getUTCFullYear() + '-' + zweistellig(d.getUTCMonth() + 1) + '-' + zweistellig(d.getUTCDate());
  }

  /** Seriennummer → "JJJJ-MM-TTThh:mm:ss" (auf volle Sekunden gerundet). */
  function serialZuZeitpunkt(n) {
    var sekunden = Math.round((Number(n) - SERIAL_1970) * 86400);
    var d = new Date(sekunden * 1000);
    return d.getUTCFullYear() + '-' + zweistellig(d.getUTCMonth() + 1) + '-' + zweistellig(d.getUTCDate()) +
      'T' + zweistellig(d.getUTCHours()) + ':' + zweistellig(d.getUTCMinutes()) + ':' + zweistellig(d.getUTCSeconds());
  }

  /** Zerlegt einen Datums-/Zeitpunkt-Text in Teile oder liefert null. */
  function zerlege(s) {
    var t = String(s).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
    var j, mo, ta, h, mi, se;
    if (m) {
      j = +m[1]; mo = +m[2]; ta = +m[3]; h = +(m[4] || 0); mi = +(m[5] || 0); se = +(m[6] || 0);
    } else {
      m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
      if (!m) return null;
      ta = +m[1]; mo = +m[2]; j = +m[3]; h = +(m[4] || 0); mi = +(m[5] || 0); se = +(m[6] || 0);
    }
    if (mo < 1 || mo > 12 || ta < 1 || ta > 31 || h > 23 || mi > 59 || se > 59) return null;
    var ms = Date.UTC(j, mo - 1, ta, h, mi, se);
    var d = new Date(ms);
    // 31.02. o. Ä. ablehnen: Date.UTC würde in den Folgemonat rollen
    if (d.getUTCFullYear() !== j || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== ta) return null;
    return { ms: ms, mitZeit: m[4] !== undefined };
  }

  /** "JJJJ-MM-TT", "JJJJ-MM-TTThh:mm(:ss)" oder "TT.MM.JJJJ( hh:mm)" → Seriennummer. Zahl bleibt Zahl. */
  function zuSerial(s) {
    if (typeof s === 'number') return s;
    var z = zerlege(s);
    if (!z) throw new Error('Kein gültiges Datum: ' + s);
    return z.ms / MS_PRO_TAG + SERIAL_1970;
  }

  /** Date-Objekt (z. B. aus SpreadsheetApp.getValues) → Seriennummer nach Ortszeit des Objekts. */
  function dateZuSerial(d) {
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) /
      MS_PRO_TAG + SERIAL_1970;
  }

  function istDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

  /** Zellwert → Programmwert gemäß Spaltentyp. Tolerant: unpassende Werte bleiben unverändert stehen
   *  (pruefe() meldet sie dann). */
  function zelleLesen(wert, spalte) {
    if (leer(wert)) return null;
    var typ = spalte.typ;
    if (typ === 'Datum' || typ === 'Zeitpunkt') {
      var n = typeof wert === 'number' ? wert : istDate(wert) ? dateZuSerial(wert) : null;
      if (n === null) {
        var z = zerlege(wert);
        if (!z) return String(wert);
        n = z.ms / MS_PRO_TAG + SERIAL_1970;
      }
      return typ === 'Datum' ? serialZuDatum(n) : serialZuZeitpunkt(n);
    }
    if (typ === 'ja/nein') {
      if (wert === true || wert === false) return wert;
      var s = String(wert).trim().toLowerCase();
      if (s === 'ja') return true;
      if (s === 'nein') return false;
      return wert;
    }
    if (typ === 'Ganzzahl' || typ === 'FK' || typ === 'Dezimal') {
      if (typeof wert === 'number') return wert;
      var t = String(wert).trim();
      if (typ === 'Dezimal') t = t.replace(/\./g, '').replace(',', '.');
      var zahl = Number(t);
      return t !== '' && isFinite(zahl) ? zahl : wert;
    }
    return ohneFormelschutz(String(wert));
  }

  // Formel-Injektion: Ein Text wie "=HYPERLINK(...)" oder "+49 …" würde von setValues als Formel
  // ausgeführt. Beim Schreiben wird deshalb ein ' vorangestellt (Sheets zeigt es nicht an), beim
  // Lesen wird es wieder entfernt. [?] Ob Sheets das ' bei Spaltenformat "@" als Zeichen speichert,
  // ist nicht sicher – durch das Entfernen beim Lesen ist der Ablauf in beiden Fällen gleich.
  var FORMEL_ANFANG = /^[=+\-@]/;
  function mitFormelschutz(s) { return FORMEL_ANFANG.test(s) ? "'" + s : s; }
  function ohneFormelschutz(s) { return s.charAt(0) === "'" && FORMEL_ANFANG.test(s.slice(1)) ? s.slice(1) : s; }

  /** Programmwert → Zellwert gemäß Spaltentyp. */
  function zelleSchreiben(wert, spalte) {
    if (leer(wert)) return '';
    var typ = spalte.typ;
    if (typ === 'Datum' || typ === 'Zeitpunkt') {
      var n = zuSerial(wert);
      return typ === 'Datum' ? Math.floor(n) : n;
    }
    if (typ === 'ja/nein') {
      if (wert === true || wert === 'ja') return 'ja';
      if (wert === false || wert === 'nein') return 'nein';
      throw new Error('Kein ja/nein-Wert: ' + wert);
    }
    if (typ === 'Ganzzahl' || typ === 'FK' || typ === 'Dezimal') {
      var zahl = typeof wert === 'number' ? wert : Number(String(wert).replace(',', '.'));
      if (!isFinite(zahl)) throw new Error('Keine Zahl: ' + wert);
      return typ === 'Dezimal' ? Math.round(zahl * 100) / 100 : zahl;
    }
    return mitFormelschutz(String(wert));
  }

  function tabelle(tab) {
    var t = Schema.TABELLEN[tab];
    if (!t) throw new Error('Unbekannter Tab im Datenmodell: ' + tab);
    return t;
  }

  /** Eine Tabellenzeile → Objekt mit allen Spalten des Datenmodells. Zuordnung über die Kopfzeile. */
  function zeileZuObjekt(kopf, zeile, tab) {
    var obj = {};
    tabelle(tab).spalten.forEach(function (sp) {
      var i = kopf.indexOf(sp.name);
      obj[sp.name] = i < 0 ? null : zelleLesen(zeile[i], sp);
    });
    return obj;
  }

  /** Objekt → Tabellenzeile in der Reihenfolge von kopf. Spalten, die nicht im Datenmodell stehen oder
   *  im Objekt fehlen, behalten den Wert aus alteZeile (falls angegeben), sonst leer. */
  function objektZuZeile(kopf, obj, tab, alteZeile) {
    var spalten = {};
    tabelle(tab).spalten.forEach(function (sp) { spalten[sp.name] = sp; });
    return kopf.map(function (name, i) {
      var alt = alteZeile && alteZeile[i] !== undefined ? alteZeile[i] : '';
      if (!spalten[name] || !Object.prototype.hasOwnProperty.call(obj, name)) return alt;
      return zelleSchreiben(obj[name], spalten[name]);
    });
  }

  function typFehler(wert, sp) {
    switch (sp.typ) {
      case 'Datum':
        return typeof wert === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(wert) && zerlege(wert) ? null : 'ist kein gültiges Datum';
      case 'Zeitpunkt':
        return typeof wert === 'string' && zerlege(wert) ? null : 'ist kein gültiger Zeitpunkt';
      case 'Ganzzahl':
      case 'FK':
        return typeof wert === 'number' && Math.floor(wert) === wert ? null : 'muss eine ganze Zahl sein';
      case 'Dezimal':
        return typeof wert === 'number' && isFinite(wert) ? null : 'muss eine Zahl sein';
      case 'ja/nein':
        return wert === true || wert === false ? null : 'muss ja oder nein sein';
      default:
        return typeof wert === 'string' ? null : 'muss Text sein';
    }
  }

  /**
   * Prüft ein Objekt gegen das Datenmodell. Liefert [{feld, meldung}] – leer heißt in Ordnung.
   * optionen.teilweise = true: nur die im Objekt vorhandenen Felder prüfen (Änderungen).
   * Nicht geprüft: Schlüssel (PK) und vom Skript gesetzte Felder (auto); "bedingt" prüfen die Fachmodule.
   */
  function pruefe(tab, obj, optionen) {
    var teilweise = !!(optionen && optionen.teilweise);
    var t = tabelle(tab);
    var fehler = [];
    var bekannt = {};
    t.spalten.forEach(function (sp) {
      bekannt[sp.name] = true;
      if (sp.pflicht === 'PK' || sp.pflicht === 'auto') return;
      var vorhanden = Object.prototype.hasOwnProperty.call(obj, sp.name);
      if (teilweise && !vorhanden) return;
      var wert = obj[sp.name];
      if (leer(wert)) {
        if (sp.pflicht === 'ja') fehler.push({ feld: sp.name, meldung: feldname(sp.name) + ': Angabe fehlt.' });
        return;
      }
      var f = typFehler(wert, sp);
      if (f) { fehler.push({ feld: sp.name, meldung: feldname(sp.name) + ' ' + f + '.' }); return; }
      if (sp.typ === 'Auswahl' && sp.liste && Schema.LISTEN[sp.liste] &&
          Schema.LISTEN[sp.liste].indexOf(wert) < 0) {
        fehler.push({ feld: sp.name, meldung: feldname(sp.name) + ': „' + wert + '“ ist kein zulässiger Wert.' });
      }
    });
    Object.keys(obj).forEach(function (k) {
      if (!bekannt[k]) fehler.push({ feld: k, meldung: 'Unbekannte Angabe ' + feldname(k) + '.' });
    });
    return fehler;
  }

  function gleich(a, b) {
    if (leer(a) && leer(b)) return true;
    return a === b;
  }

  /** Unterschiede zwischen zwei Ständen: [{feld, alt, neu}] für alle Felder des Datenmodells, die in
   *  neu vorkommen und sich geändert haben. Technische Felder (version, geaendert_*) zählen nicht. */
  function diff(tab, alt, neu) {
    var ergebnis = [];
    tabelle(tab).spalten.forEach(function (sp) {
      if (TECHNISCHE_FELDER.indexOf(sp.name) >= 0) return;
      if (!Object.prototype.hasOwnProperty.call(neu, sp.name)) return;
      var a = alt ? alt[sp.name] : null;
      if (!gleich(a, neu[sp.name])) {
        ergebnis.push({ feld: sp.name, alt: leer(a) ? null : a, neu: leer(neu[sp.name]) ? null : neu[sp.name] });
      }
    });
    return ergebnis;
  }

  return {
    TECHNISCHE_FELDER: TECHNISCHE_FELDER,
    feldname: feldname,
    serialZuDatum: serialZuDatum,
    serialZuZeitpunkt: serialZuZeitpunkt,
    zuSerial: zuSerial,
    zelleLesen: zelleLesen,
    zelleSchreiben: zelleSchreiben,
    zeileZuObjekt: zeileZuObjekt,
    objektZuZeile: objektZuZeile,
    pruefe: pruefe,
    diff: diff
  };
})();
