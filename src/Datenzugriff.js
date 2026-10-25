/**
 * DB – die einzige Stelle, die die Datenbank-Tabelle liest und schreibt (Datenzugriffs-Schicht).
 *
 * Zweck:       Lesen aller Tabs mit EINEM Aufruf, Einfügen und Ändern einzelner Datensätze, ID-Vergabe,
 *              Sperre gegen gleichzeitiges Schreiben, Zählen der Tabellenzugriffe (für die Zeitmessung).
 * Datenquelle: die Datenbank-Datei, deren ID in der Script Property DB_ID steht (nie vom Client, A3).
 *              Spalten werden immer über die Kopfzeile (Zeile 1) gefunden, nie über ihre Position.
 * Wer darf:    DB prüft KEINE Rollen. Jede öffentliche Funktion prüft vorher über Api/Zugriff, ob der
 *              Nutzer die Aktion darf (A2). DB verlässt sich darauf.
 * Besonderheiten:
 *  - Lesen über die Sheets-API (Advanced Service "Sheets", gleicher Scope wie SpreadsheetApp):
 *    Werte unformatiert, Datumswerte als Seriennummer → zeitzonenfest (siehe Werte).
 *  - Schreiben über SpreadsheetApp. einfuegen/aktualisieren/neueId funktionieren NUR innerhalb von
 *    DB.mitSperre(...) – sonst würden zwei Nutzer gleichzeitig dieselbe Zeile oder ID erwischen (A7).
 *  - Vor dem Freigeben der Sperre wird SpreadsheetApp.flush() aufgerufen, damit der nächste Schreiber
 *    den neuen Stand sieht.
 *  - Optimistische Sperre: Jede bearbeitbare Zeile hat eine Spalte "version". Wer ändert, schickt die
 *    Version mit, die er gesehen hat. Passt sie nicht mehr, gibt es Fehler.konflikt mit dem aktuellen Stand.
 *  - Der Zähler sheets zählt jeden Aufruf an SpreadsheetApp bzw. die Sheets-API (Messung, Auftragspunkt 8).
 */
var DB = (function () {
  var datei_ = null;
  var sheetsAufrufe = 0;
  var gesperrt = false;

  function intern(meldung) { return new Error('DB: ' + meldung); }

  function dbId() {
    var id = PropertiesService.getScriptProperties().getProperty('DB_ID');
    if (!id) throw intern('Script Property DB_ID fehlt – siehe docs/BETRIEB.md');
    return id;
  }

  function datei() {
    if (!datei_) {
      datei_ = SpreadsheetApp.openById(dbId());
      sheetsAufrufe++;
    }
    return datei_;
  }

  function tabSchema(tab) {
    var t = Schema.TABELLEN[tab];
    if (!t) throw intern('Unbekannter Tab ' + tab);
    return t;
  }

  function blatt(tab) {
    tabSchema(tab);
    var b = datei().getSheetByName(tab);
    sheetsAufrufe++;
    if (!b) throw intern('Tab fehlt in der Datenbank: ' + tab + ' (setup() ausführen)');
    return b;
  }

  function kopfLesen(b) {
    var spalten = b.getLastColumn();
    sheetsAufrufe++;
    if (spalten < 1) throw intern('Kopfzeile fehlt in ' + b.getName());
    var kopf = b.getRange(1, 1, 1, spalten).getValues()[0].map(function (k) { return String(k).trim(); });
    sheetsAufrufe++;
    return kopf;
  }

  function nurInSperre(wer) {
    if (!gesperrt) throw intern(wer + ' nur innerhalb von DB.mitSperre aufrufen');
  }

  function zeileLeer(zeile) {
    return !zeile || zeile.every(function (z) { return z === '' || z === null || z === undefined; });
  }

  // Vorrat: Was in dieser Ausführung schon gelesen wurde, wird nicht erneut gelesen. So kann z. B. die
  // Zugriffsprüfung beim Kaltstart Benutzer UND alle Snapshot-Tabs in EINEM batchGet holen, und Konfig/Snapshot
  // bedienen sich danach daraus. Der Vorrat wird bei jedem Schreibzugriff und beim Betreten von mitSperre
  // geleert (unter der Sperre wird immer frisch gelesen). Die gelieferten Objekte nicht verändern.
  var vorrat = {};
  function vorratLeeren() { vorrat = {}; }

  /** Liest mehrere Tabs mit höchstens EINEM Aufruf (bereits gelesene Tabs aus dem Vorrat). Ergebnis: { Tab: [Objekt, …] } */
  function lese(tabs) {
    tabs.forEach(tabSchema);
    if (!tabs.length) return {};
    var fehlend = tabs.filter(function (t) { return !Object.prototype.hasOwnProperty.call(vorrat, t); });
    if (fehlend.length) {
      var neu = leseVomSheet(fehlend);
      fehlend.forEach(function (t) { vorrat[t] = neu[t]; });
    }
    var ergebnis = {};
    tabs.forEach(function (t) { ergebnis[t] = vorrat[t]; });
    return ergebnis;
  }

  function leseVomSheet(tabs) {
    var antwort = Sheets.Spreadsheets.Values.batchGet(dbId(), {
      ranges: tabs.map(function (t) { return "'" + t.replace(/'/g, "''") + "'"; }),
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER'
    });
    sheetsAufrufe++;
    var bereiche = (antwort && antwort.valueRanges) || [];
    var ergebnis = {};
    tabs.forEach(function (tab, i) {
      var werte = (bereiche[i] && bereiche[i].values) || [];
      if (!werte.length) { ergebnis[tab] = []; return; }
      var kopf = werte[0].map(function (k) { return String(k).trim(); });
      var fehlend = tabSchema(tab).spalten.filter(function (sp) { return kopf.indexOf(sp.name) < 0; });
      if (fehlend.length) {
        console.warn('DB.lese: In ' + tab + ' fehlen Spalten: ' + fehlend.map(function (s) { return s.name; }).join(', '));
      }
      ergebnis[tab] = werte.slice(1).filter(function (z) { return !zeileLeer(z); })
        .map(function (z) { return Werte.zeileZuObjekt(kopf, z, tab); });
    });
    return ergebnis;
  }

  /** Zeilennummer (1-basiert) des Datensatzes mit dieser ID oder -1. Liest nur die ID-Spalte. */
  function findeZeile(b, kopf, idSpalte, id) {
    var spalte = kopf.indexOf(idSpalte);
    if (spalte < 0) throw intern('ID-Spalte ' + idSpalte + ' fehlt in ' + b.getName());
    var letzte = b.getLastRow();
    sheetsAufrufe++;
    if (letzte < 2) return -1;
    var ids = b.getRange(2, spalte + 1, letzte - 1, 1).getValues();
    sheetsAufrufe++;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] !== '' && String(ids[i][0]) === String(id)) return i + 2;
    }
    return -1;
  }

  /** Wirft einen fachlichen Fehler, wenn obj eine Eindeutigkeitsregel des Tabs verletzt. */
  function pruefeEindeutig(tab, obj, nurGruppenMit) {
    var t = tabSchema(tab);
    var gruppen = t.eindeutig.filter(function (g) {
      return !nurGruppenMit || g.some(function (f) { return nurGruppenMit.indexOf(f) >= 0; });
    });
    if (!gruppen.length) return;
    var bestand = lese([tab])[tab];
    gruppen.forEach(function (g) {
      var doppelt = bestand.some(function (z) {
        if (t.idSpalte && obj[t.idSpalte] !== undefined && String(z[t.idSpalte]) === String(obj[t.idSpalte])) return false;
        return g.every(function (f) {
          var a = z[f], b = obj[f];
          var aLeer = a === null || a === undefined || a === '';
          var bLeer = b === null || b === undefined || b === '';
          return (aLeer && bLeer) || String(a) === String(b);
        });
      });
      if (doppelt) {
        throw Fehler.fachlich('Diesen Eintrag gibt es bereits (gleiche Angaben bei: ' + g.map(Werte.feldname).join(', ') + ').',
          g.map(function (f) { return { feld: f, meldung: 'Bereits vergeben.' }; }));
      }
    });
  }

  function fachlichAusPruefung(fehler) {
    // Feldliste mitgeben: der Browser zeigt die Meldungen direkt am jeweiligen Eingabefeld (App.formular).
    if (fehler.length) throw Fehler.fachlich(fehler.map(function (f) { return f.meldung; }).join(' '), fehler);
  }

  /** Entfernt Felder, die nur das Skript setzt (ID, version, geaendert_*). */
  function bereinigt(tab, obj) {
    var t = tabSchema(tab);
    var sauber = {};
    Object.keys(obj || {}).forEach(function (k) {
      if (k === t.idSpalte || Werte.TECHNISCHE_FELDER.indexOf(k) >= 0) return;
      sauber[k] = obj[k];
    });
    return sauber;
  }

  function hatSpalte(tab, name) {
    return tabSchema(tab).spalten.some(function (sp) { return sp.name === name; });
  }

  /** Nächste freie ID eines Tabs aus _Konfig (next_id_<Tab>). Nur in mitSperre. */
  function neueId(tab) {
    vorratLeeren();
    nurInSperre('neueId');
    var t = tabSchema(tab);
    if (!t.idSpalte) throw intern('Tab ' + tab + ' hat keine ID-Spalte');
    var k = blatt('_Konfig');
    var kopf = kopfLesen(k);
    var sSchluessel = kopf.indexOf('schluessel'), sWert = kopf.indexOf('wert');
    var letzte = k.getLastRow();
    sheetsAufrufe++;
    var name = 'next_id_' + tab;
    if (letzte >= 2) {
      var zeilen = k.getRange(2, 1, letzte - 1, kopf.length).getValues();
      sheetsAufrufe++;
      for (var i = 0; i < zeilen.length; i++) {
        if (String(zeilen[i][sSchluessel]).trim() === name) {
          var id = Number(zeilen[i][sWert]);
          if (!(id > 0) || Math.floor(id) !== id) throw intern('Zähler ' + name + ' ist keine ganze Zahl');
          k.getRange(i + 2, sWert + 1).setValue(String(id + 1));
          sheetsAufrufe++;
          return id;
        }
      }
    }
    // Zähler fehlt: aus dem Bestand ableiten und anlegen
    var max = 0;
    lese([tab])[tab].forEach(function (z) {
      var v = Number(z[t.idSpalte]);
      if (v > max) max = v;
    });
    var neu = kopf.map(function (h) {
      if (h === 'schluessel') return name;
      if (h === 'wert') return String(max + 2);
      if (h === 'beschreibung') return 'ID-Zähler — nur vom Skript erhöhen';
      return '';
    });
    k.appendRow(neu);
    sheetsAufrufe++;
    return max + 1;
  }

  /** Legt einen Datensatz an. Liefert den gespeicherten Stand (mit ID, version = 1). Nur in mitSperre. */
  function einfuegen(tab, obj, ktx) {
    vorratLeeren();
    nurInSperre('einfuegen');
    var t = tabSchema(tab);
    var sauber = bereinigt(tab, obj);
    fachlichAusPruefung(Werte.pruefe(tab, sauber));
    pruefeEindeutig(tab, sauber);
    var neu = {};
    Object.keys(sauber).forEach(function (k) { neu[k] = sauber[k]; });
    if (t.idSpalte) neu[t.idSpalte] = neueId(tab);
    if (hatSpalte(tab, 'version')) neu.version = 1;
    if (hatSpalte(tab, 'geaendert_am')) neu.geaendert_am = jetzt();
    if (hatSpalte(tab, 'geaendert_von')) neu.geaendert_von = (ktx && ktx.email) || null;
    var b = blatt(tab);
    var kopf = kopfLesen(b);
    var zeile = Werte.objektZuZeile(kopf, neu, tab);
    b.appendRow(zeile);
    sheetsAufrufe++;
    return Werte.zeileZuObjekt(kopf, zeile, tab);
  }

  /**
   * Ändert einen Datensatz. Liefert { alt, neu, diff }. Nur in mitSperre.
   * erwarteteVersion: die Version, die der Nutzer gesehen hat. Passt sie nicht → Fehler.konflikt(aktuell).
   * Ohne inhaltliche Änderung wird nichts geschrieben und die Version bleibt.
   */
  function aktualisieren(tab, id, aenderungen, erwarteteVersion, ktx) {
    vorratLeeren();
    nurInSperre('aktualisieren');
    var t = tabSchema(tab);
    if (!t.idSpalte) throw intern('Tab ' + tab + ' hat keine ID-Spalte');
    var sauber = bereinigt(tab, aenderungen);
    fachlichAusPruefung(Werte.pruefe(tab, sauber, { teilweise: true }));
    var b = blatt(tab);
    var kopf = kopfLesen(b);
    var nr = findeZeile(b, kopf, t.idSpalte, id);
    if (nr < 0) throw Fehler.fachlich('Der Datensatz wurde nicht gefunden. Bitte die Ansicht neu laden.');
    var alteZeile = b.getRange(nr, 1, 1, kopf.length).getValues()[0];
    sheetsAufrufe++;
    var alt = Werte.zeileZuObjekt(kopf, alteZeile, tab);
    if (hatSpalte(tab, 'version') && Number(alt.version || 0) !== Number(erwarteteVersion)) {
      throw Fehler.konflikt(alt);
    }
    var aenderung = Werte.diff(tab, alt, sauber);
    if (!aenderung.length) return { alt: alt, neu: alt, diff: [] };
    var neu = {};
    Object.keys(alt).forEach(function (k) { neu[k] = alt[k]; });
    Object.keys(sauber).forEach(function (k) { neu[k] = sauber[k]; });
    pruefeEindeutig(tab, neu, aenderung.map(function (d) { return d.feld; }));
    if (hatSpalte(tab, 'version')) neu.version = Number(alt.version || 0) + 1;
    if (hatSpalte(tab, 'geaendert_am')) neu.geaendert_am = jetzt();
    if (hatSpalte(tab, 'geaendert_von')) neu.geaendert_von = (ktx && ktx.email) || null;
    var zeile = Werte.objektZuZeile(kopf, neu, tab, alteZeile);
    b.getRange(nr, 1, 1, kopf.length).setValues([zeile]);
    sheetsAufrufe++;
    return { alt: alt, neu: Werte.zeileZuObjekt(kopf, zeile, tab), diff: aenderung };
  }

  /** Führt fn unter der Skriptsperre aus (wiedereintrittsfähig). Liefert das Ergebnis von fn. */
  function mitSperre(fn) {
    if (gesperrt) return fn();
    vorratLeeren();
    var wartezeit = 10000;
    try { wartezeit = Number(Konfig.wert('sperre_wartezeit_ms')) || 10000; } catch (e) { /* Standardwert */ }
    var sperre = LockService.getScriptLock();
    try {
      sperre.waitLock(wartezeit);
    } catch (e) {
      throw Fehler.fachlich('Gerade speichert jemand anderes. Bitte in einigen Sekunden erneut versuchen.');
    }
    gesperrt = true;
    try {
      return fn();
    } finally {
      gesperrt = false;
      try { SpreadsheetApp.flush(); sheetsAufrufe++; } finally { sperre.releaseLock(); }
    }
  }

  /** Aktuelle Ortszeit des Skripts als "JJJJ-MM-TTThh:mm:ss". */
  function jetzt() {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  }

  function zaehler() { return { sheets: sheetsAufrufe }; }
  function zaehlerZuruecksetzen() { sheetsAufrufe = 0; }
  /**
   * Hängt Zeilen mit EINEM setValues unter die letzte belegte Zeile. Ein Tab hat in Google Sheets eine
   * feste Rastergröße (neu: 1000 Zeilen); ein Bereich darüber hinaus wirft einen Fehler. Deshalb wird
   * das Raster bei Bedarf vorher vergrößert. `letzte` kann mitgegeben werden, wenn der Aufrufer sie schon kennt.
   */
  function anhaengen(b, zeilen, letzte) {
    if (!zeilen.length) return;
    if (letzte === undefined) { letzte = b.getLastRow(); sheetsAufrufe++; }
    var max = b.getMaxRows();
    sheetsAufrufe++;
    var bis = letzte + zeilen.length;
    if (bis > max) { b.insertRowsAfter(max, Math.max(bis - max, 100)); sheetsAufrufe++; }
    b.getRange(letzte + 1, 1, zeilen.length, zeilen[0].length).setValues(zeilen);
    sheetsAufrufe++;
  }

  /** Für andere Module (Protokoll, Messung), die selbst auf ein Blatt zugreifen. */
  function zaehle(n) { sheetsAufrufe += (n || 1); }

  return {
    lese: lese,
    vorratLeeren: vorratLeeren,
    mitSperre: mitSperre,
    // Nach jedem Schreibzugriff ist der Vorrat veraltet → leeren (auch im Fehlerfall).
    einfuegen: function (tab, obj, ktx) { try { return einfuegen(tab, obj, ktx); } finally { vorratLeeren(); } },
    aktualisieren: function (tab, id, a, v, ktx) { try { return aktualisieren(tab, id, a, v, ktx); } finally { vorratLeeren(); } },
    neueId: function (tab) { try { return neueId(tab); } finally { vorratLeeren(); } },
    zaehler: zaehler,
    zaehlerZuruecksetzen: zaehlerZuruecksetzen,
    zaehle: zaehle,
    blatt: blatt,
    anhaengen: anhaengen,
    jetzt: jetzt
  };
})();
