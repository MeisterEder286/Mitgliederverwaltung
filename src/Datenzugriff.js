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
 *  - Massenschreiben (einfuegenViele, aktualisiereViele) mit fester Zahl an Tabellenzugriffen, unabhängig von
 *    der Zahl der Datensätze; entfernen nur für Löschkonzept und technische Bereinigung.
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
    // Die Sheets-API sieht gepufferte SpreadsheetApp-Schreibvorgänge erst nach flush(). Innerhalb der Sperre
    // (Eindeutigkeitsprüfung nach einem Einfügen, Cache-Neubau in Snapshot.schreibe) deshalb vorher leeren.
    if (gesperrt) { SpreadsheetApp.flush(); sheetsAufrufe++; }
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
      // Sind ALLE Schlüsselfelder des neuen Datensatzes leer (z. B. Überweisungskonto ohne Mandatsreferenz),
      // gibt es nichts zu vergleichen. Bei teilweise leeren Gruppen (Benutzer ohne abteilung_id) gilt leer = leer.
      if (g.every(function (f) { return istLeer(obj[f]); })) return;
      var doppelt = bestand.some(function (z) {
        if (t.idSpalte && obj[t.idSpalte] !== undefined && String(z[t.idSpalte]) === String(obj[t.idSpalte])) return false;
        return g.every(function (f) {
          var a = z[f], b = obj[f];
          var aLeer = a === null || a === undefined || a === '';
          var bLeer = b === null || b === undefined || b === '';
          return (aLeer && bLeer) || schluesselWert(f, a) === schluesselWert(f, b);
        });
      });
      if (doppelt) {
        throw Fehler.fachlich('Diesen Eintrag gibt es bereits (gleiche Angaben bei: ' + g.map(Werte.feldname).join(', ') + ').',
          g.map(function (f) { return { feld: f, meldung: 'Bereits vergeben.' }; }));
      }
    });
  }

  function istLeer(v) { return v === null || v === undefined || v === ''; }

  /**
   * Vergleichswert für Eindeutigkeiten: E-Mail-Adressen ohne Groß-/Kleinschreibung und Randleerzeichen – so wie die
   * Rechteprüfung sie vergleicht (Rechte.kontext); sonst gälten „A@x.de“ und „a@x.de“ als zwei Zugänge.
   */
  function schluesselWert(feld, v) {
    return feld === 'email' ? String(v).trim().toLowerCase() : String(v);
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

  /**
   * Höchste ID im Tab, direkt über SpreadsheetApp gelesen (sieht auch eigene, noch nicht geflushte Schreibvorgänge
   * innerhalb der Sperre). 0 bei leerem Tab.
   */
  function hoechsteId(tab, idSpalte) {
    var b = blatt(tab);
    var letzte = b.getLastRow();
    sheetsAufrufe++;
    if (letzte < 2) return 0;
    var kopf = kopfLesen(b);
    var s = kopf.indexOf(idSpalte);
    if (s < 0) return 0;
    var max = 0;
    b.getRange(2, s + 1, letzte - 1, 1).getValues().forEach(function (z) { var v = Number(z[0]); if (v > max) max = v; });
    sheetsAufrufe++;
    return max;
  }

  /**
   * Nächste freie ID eines Tabs aus _Konfig (next_id_<Tab>). Nur in mitSperre.
   * Wie reserviereIds nie unter höchster vorhandener ID + 1: Zeilen, die von Hand (oder per Wiederherstellung)
   * eingefügt wurden, ohne den Zähler zu erhöhen, führen so nicht zu doppelten IDs (Prüfbefund 10/2026).
   */
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
          id = Math.max(id, hoechsteId(tab, t.idSpalte) + 1);
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


  // ================================================================== Massenschreiben
  // Für Sammelvorgänge (Sollstellungslauf, Ehrungen übernehmen, nächtliche Wartung). DB.einfuegen/aktualisieren
  // brauchen je Datensatz rund zehn Tabellenzugriffe; die folgenden Funktionen eine feste Zahl – unabhängig davon,
  // ob 5 oder 500 Datensätze geschrieben werden. Nur innerhalb von DB.mitSperre.

  /** Liest den Wert-Block eines Tabs: { kopf, werte (ohne Kopfzeile, Rohwerte), spalten }. */
  function leseBlock(b) {
    var letzte = b.getLastRow(), spalten = b.getLastColumn();
    sheetsAufrufe += 2;
    if (spalten < 1) throw intern('Kopfzeile fehlt in ' + b.getName());
    var alle = b.getRange(1, 1, Math.max(letzte, 1), spalten).getValues();
    sheetsAufrufe++;
    return { kopf: alle[0].map(function (k) { return String(k).trim(); }), werte: alle.slice(1), spalten: spalten, letzte: letzte };
  }

  /** Reserviert `anzahl` fortlaufende IDs aus _Konfig.next_id_<Tab> (nie kleiner als größte vorhandene ID + 1). */
  function reserviereIds(tab, anzahl, bestand) {
    var idSpalte = tabSchema(tab).idSpalte;
    var maxBestand = 0;
    (bestand || []).forEach(function (z) { var v = Number(z[idSpalte]); if (v > maxBestand) maxBestand = v; });
    var k = blatt('_Konfig');
    var blk = leseBlock(k);
    var sS = blk.kopf.indexOf('schluessel'), sW = blk.kopf.indexOf('wert');
    var name = 'next_id_' + tab;
    for (var i = 0; i < blk.werte.length; i++) {
      if (String(blk.werte[i][sS]).trim() !== name) continue;
      var start = Math.max(Number(blk.werte[i][sW]) || 1, maxBestand + 1);
      k.getRange(i + 2, sW + 1).setValue(String(start + anzahl));
      sheetsAufrufe++;
      return start;
    }
    var erste = maxBestand + 1;
    anhaengen(k, [blk.kopf.map(function (h) {
      return h === 'schluessel' ? name : h === 'wert' ? String(erste + anzahl) : h === 'beschreibung' ? 'ID-Zähler — nur vom Skript erhöhen' : '';
    })], blk.letzte);
    return erste;
  }

  /** Schlüssel einer Eindeutigkeitsgruppe; null, wenn alle Felder leer sind (dann keine Prüfung). */
  function gruppenSchluessel(gruppe, z) {
    var w = gruppe.map(function (f) { return istLeer(z[f]) ? '' : schluesselWert(f, z[f]); });
    return w.every(function (x) { return x === ''; }) ? null : w.join('\u0001');
  }

  /**
   * Legt viele Datensätze an: ein Lesen (Eindeutigkeit), ein ID-Block aus _Konfig, EIN Schreibzugriff.
   * Feldfehler kommen als Fehler.fachlich mit Feldliste; die Meldung nennt die Nummer des Eintrags (1-basiert).
   * Liefert die gespeicherten Objekte (mit ID, version = 1).
   */
  function einfuegenViele(tab, objekte, ktx) {
    nurInSperre('einfuegenViele');
    if (!objekte || !objekte.length) return [];
    vorratLeeren();
    var t = tabSchema(tab);
    var sauber = objekte.map(function (o) { return bereinigt(tab, o); });
    var fehler = [];
    sauber.forEach(function (o, i) {
      Werte.pruefe(tab, o).forEach(function (f) {
        fehler.push({ feld: f.feld, meldung: (sauber.length > 1 ? 'Eintrag ' + (i + 1) + ': ' : '') + f.meldung });
      });
    });
    fachlichAusPruefung(fehler);
    var bestand = lese([tab])[tab] || [];
    (t.eindeutig || []).forEach(function (gruppe) {
      var gesehen = {};
      bestand.forEach(function (z) { var k = gruppenSchluessel(gruppe, z); if (k) gesehen[k] = true; });
      sauber.forEach(function (o) {
        var k = gruppenSchluessel(gruppe, o);
        if (!k) return;
        if (gesehen[k]) {
          throw Fehler.fachlich('Diesen Eintrag gibt es bereits (gleiche Angaben bei: ' + gruppe.map(Werte.feldname).join(', ') + ').',
            gruppe.map(function (f) { return { feld: f, meldung: 'Bereits vergeben.' }; }));
        }
        gesehen[k] = true;
      });
    });
    var start = t.idSpalte ? reserviereIds(tab, sauber.length, bestand) : null;
    var zeit = jetzt();
    var b = blatt(tab);
    var kopf = kopfLesen(b);
    var zeilen = sauber.map(function (o, i) {
      var neu = {};
      Object.keys(o).forEach(function (k) { neu[k] = o[k]; });
      if (t.idSpalte) neu[t.idSpalte] = start + i;
      if (hatSpalte(tab, 'version')) neu.version = 1;
      if (hatSpalte(tab, 'geaendert_am')) neu.geaendert_am = zeit;
      if (hatSpalte(tab, 'geaendert_von')) neu.geaendert_von = (ktx && ktx.email) || null;
      return Werte.objektZuZeile(kopf, neu, tab);
    });
    anhaengen(b, zeilen);
    return zeilen.map(function (z) { return Werte.zeileZuObjekt(kopf, z, tab); });
  }

  /** Texte in unveränderten, aber mitgeschriebenen Zeilen gegen Formel-Ausführung schützen. */
  function formelschutzRoh(zeile) {
    return zeile.map(function (v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; });
  }

  /**
   * Ändert viele Datensätze eines Tabs: liste = [{ id, aenderungen, version }].
   *   version null/undefined → keine Versionsprüfung (nur für Läufe des Systems, z. B. nächtliche Wartung).
   * Ein Lesezugriff auf den Tab; geschrieben werden zusammenhängende Läufe geänderter Zeilen (bei sehr vielen
   * verstreuten Zeilen ein einziger Block von der ersten bis zur letzten, unveränderte Zeilen darin unverändert).
   * Erster Versionskonflikt → Fehler.konflikt(aktuell); nichts wird geschrieben.
   * Liefert [{ alt, neu, diff }] nur für tatsächlich geänderte Datensätze.
   */
  function aktualisiereViele(tab, liste, ktx) {
    nurInSperre('aktualisiereViele');
    if (!liste || !liste.length) return [];
    vorratLeeren();
    var t = tabSchema(tab);
    if (!t.idSpalte) throw intern('Tab ' + tab + ' hat keine ID-Spalte');
    var b = blatt(tab);
    var blk = leseBlock(b);
    var kopf = blk.kopf, werte = blk.werte;
    var sId = kopf.indexOf(t.idSpalte);
    if (sId < 0) throw intern('ID-Spalte ' + t.idSpalte + ' fehlt in ' + tab);
    var nachId = {};
    werte.forEach(function (z, i) { if (z[sId] !== '') nachId[String(z[sId])] = i; });
    var fehlend = liste.filter(function (a) { return nachId[String(a.id)] === undefined; }).map(function (a) { return a.id; });
    if (fehlend.length) {
      throw Fehler.fachlich('Einige Datensätze wurden nicht gefunden (' + fehlend.slice(0, 5).join(', ') + '). Bitte die Ansicht neu laden.');
    }
    var zeit = jetzt();
    var ergebnis = [], geaendert = {}, neueZeilen = {};
    liste.forEach(function (a) {
      var i = nachId[String(a.id)];
      var basisZeile = neueZeilen[i] || werte[i];
      var alt = Werte.zeileZuObjekt(kopf, basisZeile, tab);
      if (a.version !== null && a.version !== undefined && hatSpalte(tab, 'version') && Number(alt.version || 0) !== Number(a.version)) {
        throw Fehler.konflikt(alt);
      }
      var sauber = bereinigt(tab, a.aenderungen);
      fachlichAusPruefung(Werte.pruefe(tab, sauber, { teilweise: true }));
      var d = Werte.diff(tab, alt, sauber);
      if (!d.length) return;
      var neu = {};
      Object.keys(alt).forEach(function (k) { neu[k] = alt[k]; });
      Object.keys(sauber).forEach(function (k) { neu[k] = sauber[k]; });
      if (hatSpalte(tab, 'version')) neu.version = Number(alt.version || 0) + 1;
      if (hatSpalte(tab, 'geaendert_am')) neu.geaendert_am = zeit;
      if (hatSpalte(tab, 'geaendert_von')) neu.geaendert_von = (ktx && ktx.email) || null;
      neueZeilen[i] = Werte.objektZuZeile(kopf, neu, tab, basisZeile);
      geaendert[i] = true;
      ergebnis.push({ alt: alt, neu: Werte.zeileZuObjekt(kopf, neueZeilen[i], tab), diff: d });
    });
    // Eindeutigkeit der geänderten Datensätze gegen den Bestand (im Speicher)
    (t.eindeutig || []).forEach(function (gruppe) {
      if (!ergebnis.some(function (e) { return e.diff.some(function (d) { return gruppe.indexOf(d.feld) >= 0; }); })) return;
      var gesehen = {};
      werte.forEach(function (z, i) {
        var o = Werte.zeileZuObjekt(kopf, neueZeilen[i] || z, tab);
        var k = gruppenSchluessel(gruppe, o);
        if (!k) return;
        if (gesehen[k]) {
          throw Fehler.fachlich('Diesen Eintrag gibt es bereits (gleiche Angaben bei: ' + gruppe.map(Werte.feldname).join(', ') + ').',
            gruppe.map(function (f) { return { feld: f, meldung: 'Bereits vergeben.' }; }));
        }
        gesehen[k] = true;
      });
    });
    var idx = Object.keys(geaendert).map(Number).sort(function (x, y) { return x - y; });
    if (!idx.length) return ergebnis;
    var laeufe = [];
    idx.forEach(function (i) {
      var l = laeufe[laeufe.length - 1];
      if (l && l.bis === i - 1) l.bis = i; else laeufe.push({ von: i, bis: i });
    });
    function zeileFuer(i) { return geaendert[i] ? neueZeilen[i] : formelschutzRoh(werte[i]); }
    if (laeufe.length > 10) {
      var von = idx[0], bis = idx[idx.length - 1], block = [];
      for (var r = von; r <= bis; r++) block.push(zeileFuer(r));
      b.getRange(von + 2, 1, block.length, blk.spalten).setValues(block);
      sheetsAufrufe++;
    } else {
      laeufe.forEach(function (l) {
        var blockL = [];
        for (var r2 = l.von; r2 <= l.bis; r2++) blockL.push(zeileFuer(r2));
        b.getRange(l.von + 2, 1, blockL.length, blk.spalten).setValues(blockL);
        sheetsAufrufe++;
      });
    }
    return ergebnis;
  }

  /**
   * Entfernt Datensätze (Zeilen) über ihre ID – nur für das Löschkonzept (Stufe 3) und technische Bereinigung.
   * ids: eine ID oder eine Liste. Nur innerhalb von DB.mitSperre. Liefert die Anzahl entfernter Zeilen.
   * Zusammenhängende Zeilen werden mit einem deleteRows-Aufruf entfernt, von unten nach oben.
   */
  function entfernen(tab, ids) {
    nurInSperre('entfernen');
    var liste = Array.isArray(ids) ? ids : [ids];
    if (!liste.length) return 0;
    vorratLeeren();
    var t = tabSchema(tab);
    if (!t.idSpalte) throw intern('Tab ' + tab + ' hat keine ID-Spalte');
    var b = blatt(tab);
    var kopf = kopfLesen(b);
    var sp = kopf.indexOf(t.idSpalte);
    var letzte = b.getLastRow();
    sheetsAufrufe++;
    if (sp < 0 || letzte < 2) return 0;
    var werte = b.getRange(2, sp + 1, letzte - 1, 1).getValues();
    sheetsAufrufe++;
    var gesucht = {};
    liste.forEach(function (i) { gesucht[String(i)] = true; });
    var zeilen = [];
    werte.forEach(function (w, i) { if (w[0] !== '' && gesucht[String(w[0])]) zeilen.push(i + 2); });
    return zeilenEntfernen(b, zeilen);
  }

  /** Entfernt Zeilen (1-basierte Nummern) – zusammenhängende Läufe je mit einem deleteRows, von unten nach oben. */
  function zeilenEntfernen(b, zeilen) {
    if (!zeilen.length) return 0;
    zeilen = zeilen.slice().sort(function (x, y) { return y - x; });
    // Sheets erlaubt nicht, alle nicht fixierten Zeilen zu löschen [A]: dann vorher eine leere Zeile anhängen.
    var max = b.getMaxRows();
    sheetsAufrufe++;
    if (zeilen.length >= max - 1) { b.insertRowsAfter(max, 1); sheetsAufrufe++; }
    var i = 0;
    while (i < zeilen.length) {
      var unten = zeilen[i], oben = unten;
      while (i + 1 < zeilen.length && zeilen[i + 1] === oben - 1) { i++; oben = zeilen[i]; }
      if (unten === oben) b.deleteRow(oben); else b.deleteRows(oben, unten - oben + 1);
      sheetsAufrufe++;
      i++;
    }
    vorratLeeren();
    return zeilen.length;
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
    einfuegenViele: function (tab, o, ktx) { try { return einfuegenViele(tab, o, ktx); } finally { vorratLeeren(); } },
    aktualisiereViele: function (tab, l, ktx) { try { return aktualisiereViele(tab, l, ktx); } finally { vorratLeeren(); } },
    entfernen: function (tab, ids) { try { return entfernen(tab, ids); } finally { vorratLeeren(); } },
    zeilenEntfernen: function (b, zeilen) { nurInSperre('zeilenEntfernen'); try { return zeilenEntfernen(b, zeilen); } finally { vorratLeeren(); } },
    zaehler: zaehler,
    zaehlerZuruecksetzen: zaehlerZuruecksetzen,
    zaehle: zaehle,
    blatt: blatt,
    anhaengen: anhaengen,
    jetzt: jetzt
  };
})();
