/**
 * Testdaten-Import – füllt die TEST-Tabelle aus `testdaten.json` in einem Drive-Ordner (synthetischer Verein).
 *
 * Zweck:      Die Testumgebung (docs/BETRIEB.md, Abschnitt 3) ohne Kopieren von Hand mit dem erfundenen Verein aus
 *             `npm run testdaten` füllen: alle Bewegungsdaten-Tabs ersetzen, Zähler in _Konfig nachziehen.
 * Datenquelle: Script Properties dieses (eigenen!) Projekts:
 *               TEST_DB_ID            ID der Test-Tabelle (NIE die Produktiv-Datenbank)
 *               TESTDATEN_ORDNER_ID   Drive-Ordner, in dem `testdaten.json` liegt (die neueste gleichnamige gilt)
 * Wer darf was: Dieses Projekt ist NICHT als WebApp bereitgestellt. Es läuft nur per Hand im Editor
 *             (testdatenPruefen, testdatenImportieren). Niemand sonst kann es aufrufen.
 * Besonderheiten:
 *   - Bewusst ein getrenntes Projekt wie backup/ und eingang/: Das Lesen aus Drive braucht `drive.readonly`. In der
 *     WebApp (gleicher Code wie Produktion) hätte jede Lücke damit Lesezugriff auf das ganze Drive (A5).
 *   - Schutz vor dem Echtbestand: Die Zieltabelle muss „TEST“ im Namen tragen (Groß-/Kleinschreibung egal), die
 *     Datei muss als synthetisch gekennzeichnet sein, und dieses Projekt kennt die Datenbank-ID der WebApp nicht.
 *   - Erst prüfen, dann schreiben: Passt eine Kopfzeile nicht (z. B. `setup` nach einem Update nicht ausgeführt),
 *     wird NICHTS geschrieben. Ersetzt werden nur die Tabs, die in der Datei stehen; ohne Benutzer in der Datei
 *     bleibt der Tab Benutzer unberührt. Stammdaten-Tabs (Startbelegung aus `setup`) werden nie angefasst.
 *   - Werte gehen mit valueInputOption RAW in die Tabelle: Datum als Seriennummer, Text bleibt Text (führende
 *     Nullen der Mitgliedsnummer bleiben) – genau das Zellformat, das die WebApp liest (UNFORMATTED_VALUE).
 *   - Danach in der WebApp der Test-Umgebung: Verwaltung → System → „Snapshot neu aufbauen“ (leert auch die Caches
 *     für Einstellungen und Benutzer).
 *   - Die reinen Prüf- und Rechenteile stehen im Namensraum TestImportPlan und sind in Node getestet
 *     (test/testimport.test.js).
 */

/** Reine Hilfen ohne Apps-Script-Dienste (in Node testbar). */
var TestImportPlan = (function () {
  var ART = 'mitgliederverwaltung-testdaten';
  var VERBOTEN = ['_Konfig', '_Protokoll', '_Messung', 'Abteilung', 'Funktionsart', 'Beitragsart', 'Qualifikationsart',
    'Ehrungsregel', 'Aufbewahrungsfrist'];
  var BLOCK = 2000;   // Zeilen je Schreibaufruf

  function istTestName(name) { return /test/i.test(String(name || '')); }

  /** Aufbau der Datei prüfen. Liefert eine Liste von Fehlertexten (leer = in Ordnung). */
  function pruefeDatei(d) {
    var f = [];
    if (!d || typeof d !== 'object') return ['Datei ist kein JSON-Objekt'];
    if (d.art !== ART) f.push('Datei ist keine Testdaten-Datei (art ≠ ' + ART + ')');
    if (d.version !== 1) f.push('Unbekannte Dateiversion ' + d.version + ' – Import-Projekt aktualisieren');
    if (d.synthetisch !== true) f.push('Datei ist nicht als synthetisch gekennzeichnet – Abbruch');
    if (!d.tabs || typeof d.tabs !== 'object' || !Object.keys(d.tabs).length) f.push('Datei enthält keine Tabs');
    Object.keys(d.tabs || {}).forEach(function (tab) {
      var t = d.tabs[tab];
      if (VERBOTEN.indexOf(tab) >= 0) { f.push('Tab ' + tab + ' wird nie importiert'); return; }
      if (!t || !Array.isArray(t.kopf) || !t.kopf.length || !Array.isArray(t.zeilen)) { f.push('Tab ' + tab + ': kopf/zeilen fehlen'); return; }
      for (var i = 0; i < t.zeilen.length; i++) {
        if (!Array.isArray(t.zeilen[i]) || t.zeilen[i].length !== t.kopf.length) {
          f.push('Tab ' + tab + ', Zeile ' + (i + 2) + ': ' + (Array.isArray(t.zeilen[i]) ? t.zeilen[i].length : '?') + ' statt ' + t.kopf.length + ' Spalten');
          break;
        }
      }
    });
    if (d.konfig !== undefined && !Array.isArray(d.konfig)) f.push('konfig ist keine Liste');
    return f;
  }

  /**
   * Kopfzeilen der Datei gegen die Tabelle prüfen. koepfe: { Tab: [Spaltennamen] | null } (null = Tab fehlt).
   * Die Tabelle darf hinten mehr Spalten haben (neueres Schema), aber keine fehlenden oder vertauschten.
   */
  function pruefeKoepfe(d, koepfe) {
    var f = [];
    Object.keys(d.tabs).forEach(function (tab) {
      var soll = d.tabs[tab].kopf, ist = koepfe[tab];
      if (!ist) { f.push('Tab ' + tab + ' fehlt in der Tabelle – zuerst `setup` ausführen'); return; }
      for (var i = 0; i < soll.length; i++) {
        if (String(ist[i] === undefined ? '' : ist[i]).trim() !== soll[i]) {
          f.push('Tab ' + tab + ', Spalte ' + spaltenBuchstabe(i + 1) + ': Tabelle „' + (ist[i] || '') + '“, Datei „' + soll[i] +
            '“ – Code und `setup` der Test-Umgebung auf den Stand des Exports bringen');
          return;
        }
      }
    });
    return f;
  }

  /**
   * Änderungen für _Konfig. zeilen: Werte des Tabs inkl. Kopfzeile; werte: [[schluessel, wert]].
   * Liefert { aendern: [{ zeile (1-basiert), spalte (1-basiert), wert }], neu: [[Zeile in Kopf-Reihenfolge]] }.
   */
  function konfigPlan(zeilen, werte) {
    var kopf = (zeilen[0] || []).map(function (k) { return String(k).trim(); });
    var iS = kopf.indexOf('schluessel'), iW = kopf.indexOf('wert'), iB = kopf.indexOf('beschreibung');
    if (iS < 0 || iW < 0) throw new Error('_Konfig: Spalten schluessel/wert fehlen – zuerst `setup` ausführen');
    var wo = {};
    for (var z = 1; z < zeilen.length; z++) {
      var s = String(zeilen[z][iS]).trim();
      if (s && !(s in wo)) wo[s] = z + 1;
    }
    var aendern = [], neu = [];
    (werte || []).forEach(function (kv) {
      var wert = String(kv[1]);
      if (wo[kv[0]]) { aendern.push({ zeile: wo[kv[0]], spalte: iW + 1, wert: wert }); return; }
      var r = kopf.map(function () { return ''; });
      r[iS] = kv[0]; r[iW] = wert;
      if (iB >= 0) r[iB] = String(kv[0]).indexOf('next_id_') === 0 ? 'ID-Zähler – nur vom Skript erhöhen' : 'Testdaten-Import';
      neu.push(r);
    });
    return { aendern: aendern, neu: neu };
  }

  /** Zeilenblöcke zum Schreiben ab Zeile 2: [{ a1, von, bis }] (von/bis: Indizes in zeilen, bis exklusiv). */
  function bloecke(tab, anzahl, spalten, block) {
    var b = block || BLOCK, aus = [];
    for (var v = 0; v < anzahl; v += b) {
      var bis = Math.min(anzahl, v + b);
      aus.push({ a1: "'" + tab + "'!A" + (v + 2) + ':' + spaltenBuchstabe(spalten) + (bis + 1), von: v, bis: bis });
    }
    return aus;
  }

  function spaltenBuchstabe(n) {
    var s = '';
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  return { istTestName: istTestName, pruefeDatei: pruefeDatei, pruefeKoepfe: pruefeKoepfe, konfigPlan: konfigPlan,
    bloecke: bloecke, spaltenBuchstabe: spaltenBuchstabe };
})();

/** Nur prüfen und berichten, nichts schreiben. Im Editor zuerst diese Funktion ausführen. */
function testdatenPruefen() { return testimportLauf_(false); }

/** Prüfen und die Test-Tabelle ersetzen. */
function testdatenImportieren() { return testimportLauf_(true); }

function testimportLauf_(schreiben) {
  var p = PropertiesService.getScriptProperties();
  var dbId = p.getProperty('TEST_DB_ID'), ordnerId = p.getProperty('TESTDATEN_ORDNER_ID');
  if (!dbId || !ordnerId) throw new Error('Script Properties TEST_DB_ID und TESTDATEN_ORDNER_ID setzen (testimport/LIESMICH.md)');

  var ss = SpreadsheetApp.openById(dbId);
  if (!TestImportPlan.istTestName(ss.getName())) {
    throw new Error('Abbruch: Die Zieltabelle „' + ss.getName() + '“ trägt kein „TEST“ im Namen. ' +
      'Dieses Projekt schreibt nur in eine Test-Tabelle – TEST_DB_ID prüfen.');
  }
  var datei = testimportDatei_(ordnerId);
  var d = JSON.parse(datei.getBlob().getDataAsString('UTF-8'));
  var fehler = TestImportPlan.pruefeDatei(d);
  if (!fehler.length) {
    var koepfe = {};
    Object.keys(d.tabs).forEach(function (tab) {
      var sh = ss.getSheetByName(tab);
      koepfe[tab] = sh && sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : null;
    });
    fehler = TestImportPlan.pruefeKoepfe(d, koepfe);
  }
  var konfigSh = ss.getSheetByName('_Konfig');
  if (!konfigSh) fehler.push('Tab _Konfig fehlt – zuerst `setup` ausführen');
  if (fehler.length) throw new Error('Nichts geschrieben:\n- ' + fehler.join('\n- '));
  var plan = TestImportPlan.konfigPlan(konfigSh.getDataRange().getValues(), d.konfig || []);

  var bericht = ['Ziel: ' + ss.getName(), 'Datei: ' + datei.getName() + ' vom ' + datei.getLastUpdated() +
    ' (seed ' + d.erzeugt.seed + ', Stichtag ' + d.erzeugt.stichtag + ')'];
  Object.keys(d.tabs).forEach(function (tab) {
    var sh = ss.getSheetByName(tab);
    bericht.push('  ' + tab + ': ' + Math.max(0, sh.getLastRow() - 1) + ' → ' + d.tabs[tab].zeilen.length + ' Zeilen');
  });
  bericht.push('  _Konfig: ' + plan.aendern.length + ' Werte geändert, ' + plan.neu.length + ' neu');
  if (!schreiben) {
    bericht.unshift('PRÜFUNG in Ordnung – noch nichts geschrieben. Zum Ausführen: testdatenImportieren');
    console.log(bericht.join('\n'));
    return bericht.join('\n');
  }

  Object.keys(d.tabs).forEach(function (tab) {
    var sh = ss.getSheetByName(tab), t = d.tabs[tab];
    var letzte = sh.getLastRow();
    if (letzte > 1) sh.getRange(2, 1, letzte - 1, sh.getMaxColumns()).clearContent();
    var noetig = t.zeilen.length + 1;
    if (sh.getMaxRows() < noetig) sh.insertRowsAfter(sh.getMaxRows(), noetig - sh.getMaxRows());
  });
  SpreadsheetApp.flush();
  Object.keys(d.tabs).forEach(function (tab) {
    var t = d.tabs[tab];
    TestImportPlan.bloecke(tab, t.zeilen.length, t.kopf.length).forEach(function (b) {
      Sheets.Spreadsheets.Values.update({ values: t.zeilen.slice(b.von, b.bis) }, dbId, b.a1, { valueInputOption: 'RAW' });
    });
  });
  if (plan.aendern.length) {
    Sheets.Spreadsheets.Values.batchUpdate({
      valueInputOption: 'RAW',
      data: plan.aendern.map(function (a) {
        return { range: "'_Konfig'!" + TestImportPlan.spaltenBuchstabe(a.spalte) + a.zeile, values: [[a.wert]] };
      })
    }, dbId);
  }
  if (plan.neu.length) {
    Sheets.Spreadsheets.Values.append({ values: plan.neu }, dbId, "'_Konfig'!A1", { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
  }
  bericht.unshift('IMPORTIERT. Jetzt in der WebApp der Test-Umgebung: Verwaltung → System → „Snapshot neu aufbauen“.');
  console.log(bericht.join('\n'));
  return bericht.join('\n');
}

/** Neueste Datei `testdaten.json` im Ordner. */
function testimportDatei_(ordnerId) {
  var it = DriveApp.getFolderById(ordnerId).getFilesByName('testdaten.json'), beste = null;
  while (it.hasNext()) {
    var f = it.next();
    if (!beste || f.getLastUpdated() > beste.getLastUpdated()) beste = f;
  }
  if (!beste) throw new Error('Im Ordner liegt keine Datei testdaten.json (npm run testdaten, dann hochladen)');
  return beste;
}
