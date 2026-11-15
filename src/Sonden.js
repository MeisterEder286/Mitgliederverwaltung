/**
 * Sonden – kleine Messreihen, die Annahmen über das Verhalten von Apps Script klären (docs/LEISTUNG.md, Abschnitt 3).
 *
 * Zweck:      Vor jedem Umbau der Datenschicht messen, was wirklich Zeit kostet: Lesen je Tabelle (erste/weitere
 *             Lesung, Zellenzahl), batchGet, Schreibmuster (lesen–schreiben–lesen, erst lesen dann schreiben + flush,
 *             batchGet + values.batchUpdate), Sichtbarkeit einer API-Schreibung für SpreadsheetApp, Gleichheit
 *             USER_ENTERED ↔ setValues und Einzelpreise (openById, Sperre, CacheService, flush …).
 *             Jede Reihe: Median aus mindestens 6 Läufen (Standard 7), dazu Min/Max.
 * Datenquelle: AUSSCHLIESSLICH eine Kopie der Datenbank-Datei, deren ID in der Script Property SONDE_DB_ID steht.
 *             Ist sie nicht gesetzt oder gleich DB_ID, bricht jede Sonde ab. Schreibende Sonden arbeiten in eigenen
 *             Tabs _Sonde1…3 der Kopie bzw. hängen in der Kopie zwei Zeilen an „Mitglied“ an und löschen sie wieder.
 *             Lesend wird zusätzlich der echte Snapshot im Script-Cache benutzt (nur gelesen).
 * Wer darf was: nur das Funktionskonto im Apps-Script-Editor (Zugriff.nurFunktionskonto). Aus dem Browser abgewiesen.
 * Besonderheiten:
 *   - Ausführen im Editor: sondeLesen, sondeSchreiben, sondeSichtbarkeit, sondeWerte, sondePreise – jede für sich in
 *     einer eigenen Ausführung (Ergebnisse hängen davon ab, was dieselbe Ausführung vorher getan hat). sondeAlle ruft
 *     sie nacheinander in einer sinnvollen Reihenfolge auf (Sichtbarkeit zuletzt).
 *   - Ergebnis im Ausführungsprotokoll (console.log) und als Rückgabewert. Zahlen in docs/LEISTUNG.md übertragen.
 *   - Werte und Namen aus der Kopie erscheinen nicht im Ergebnis – nur Zeiten, Zahlen, Spaltennamen, ja/nein.
 */
var Sonden = (function () {
  var N = 7;
  var SCRATCH = ['_Sonde1', '_Sonde2', '_Sonde3'];

  function kopieId() {
    var p = PropertiesService.getScriptProperties();
    var kopie = p.getProperty('SONDE_DB_ID'), original = p.getProperty('DB_ID');
    if (!kopie) throw new Error('Sonden: Script Property SONDE_DB_ID fehlt (ID einer KOPIE der Datenbank, siehe docs/LEISTUNG.md).');
    if (kopie === original) throw new Error('Sonden: SONDE_DB_ID ist die echte Datenbank – Sonden laufen nur gegen eine Kopie.');
    return kopie;
  }

  function stat(ms) {
    var s = ms.slice().sort(function (a, b) { return a - b; });
    var m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    return { median: m, min: s[0], max: s[s.length - 1], n: s.length };
  }

  /** fn(i) n-mal ausführen; liefert Median/Min/Max der Laufzeiten. */
  function reihe(n, fn) {
    var ms = [];
    for (var i = 0; i < n; i++) { var t = Date.now(); fn(i); ms.push(Date.now() - t); }
    return stat(ms);
  }

  function a1(tab, rest) { return "'" + tab.replace(/'/g, "''") + "'" + (rest ? '!' + rest : ''); }

  function spaltenBuchstabe(n) {
    var s = '';
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function ausgabe(name, ergebnis) {
    console.log(name + ':\n' + JSON.stringify(ergebnis, null, 1));
    return ergebnis;
  }

  /** Tabs der Kopie mit Daten (ohne _Sonde*), größte zuerst. */
  function datentabs(datei) {
    return datei.getSheets().map(function (sh) { return { name: sh.getName(), zeilen: sh.getLastRow() }; })
      .filter(function (t) { return t.zeilen > 1 && t.name.indexOf('_Sonde') !== 0; })
      .sort(function (a, b) { return b.zeilen - a.zeilen; })
      .map(function (t) { return t.name; });
  }

  function scratch(datei) {
    return SCRATCH.map(function (name) {
      var sh = datei.getSheetByName(name);
      if (!sh) {
        sh = datei.insertSheet(name);
        var zeilen = [];
        for (var r = 0; r < 300; r++) {
          var z = [];
          for (var c = 0; c < 15; c++) z.push(c === 0 ? r + 1 : 'Text ' + r + '/' + c);
          zeilen.push(z);
        }
        sh.getRange(1, 1, zeilen.length, 15).setValues(zeilen);
        SpreadsheetApp.flush();
      }
      return sh;
    });
  }

  // ------------------------------------------------------------------ Lesen

  function lesen() {
    var id = kopieId();
    var datei = SpreadsheetApp.openById(id);
    var tabs = datentabs(datei);
    var n = Math.max(6, Math.min(N, tabs.length));
    var erste = [], weitere = [], eineZelle = [];
    for (var i = 0; i < n; i++) {
      var sh = datei.getSheetByName(tabs[i % tabs.length]);
      var t = Date.now(); sh.getDataRange().getValues(); erste.push(Date.now() - t);
      t = Date.now(); sh.getDataRange().getValues(); weitere.push(Date.now() - t);
      t = Date.now(); sh.getRange(1, 1).getValue(); eineZelle.push(Date.now() - t);
    }
    var groesster = tabs[0];
    var opt = { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' };
    function bg(liste) { return Sheets.Spreadsheets.Values.batchGet(id, { ranges: liste.map(function (x) { return a1(x); }), valueRenderOption: opt.valueRenderOption, dateTimeRenderOption: opt.dateTimeRenderOption }); }
    var ergebnis = {
      tabs_mit_daten: tabs.length,
      hinweis_erste: tabs.length < n ? 'weniger Tabs als Läufe – ab Lauf ' + (tabs.length + 1) + ' keine „erste“ Lesung mehr' : '',
      spreadsheetapp_erste_lesung_je_tab: stat(erste),
      spreadsheetapp_weitere_lesung_gleicher_tab: stat(weitere),
      spreadsheetapp_eine_zelle: stat(eineZelle),
      batchget_1_tab: reihe(n, function (i) { bg([tabs[i % tabs.length]]); }),
      batchget_5_tabs: reihe(n, function () { bg(tabs.slice(0, 5)); }),
      batchget_alle_tabs: reihe(n, function () { bg(tabs); }),
      batchget_alle_tabs_anzahl: tabs.length
    };
    // FORMATTED_VALUE ↔ getDisplayValues (Referenzprojekt: gleich, nur Leerstellen am Ende fehlen)
    var anzeige = datei.getSheetByName(groesster).getDataRange().getDisplayValues();
    var formatiert = (Sheets.Spreadsheets.Values.batchGet(id, { ranges: [a1(groesster)], valueRenderOption: 'FORMATTED_VALUE' }).valueRanges[0].values) || [];
    var abweichend = 0, spalten = {};
    anzeige.forEach(function (z, r) {
      z.forEach(function (v, c) {
        var w = formatiert[r] && formatiert[r][c] !== undefined ? formatiert[r][c] : '';
        if (String(v) !== String(w)) { abweichend++; spalten[String(anzeige[0][c])] = true; }
      });
    });
    ergebnis.formatted_gleich_display = { tab: groesster, zellen: anzeige.length * (anzeige[0] || []).length, abweichend: abweichend, spalten: Object.keys(spalten).slice(0, 20) };
    return ausgabe('sondeLesen', ergebnis);
  }

  // ------------------------------------------------------------------ Schreiben

  function schreiben() {
    var id = kopieId();
    var datei = SpreadsheetApp.openById(id);
    var blaetter = scratch(datei);
    var n = N;
    // A: je Blatt lesen – schreiben – lesen
    var a = reihe(n, function (i) {
      blaetter.forEach(function (sh) {
        sh.getRange(2, 1, 50, 15).getValues();
        sh.getRange(2 + i, 3).setValue('A' + i + '-' + Date.now());
        sh.getRange(2, 1, 50, 15).getValues();
      });
      SpreadsheetApp.flush();
    });
    // B: erst alles lesen, dann schreiben, ein flush
    var b = reihe(n, function (i) {
      blaetter.forEach(function (sh) { sh.getRange(2, 1, 50, 15).getValues(); });
      blaetter.forEach(function (sh) { sh.getRange(2 + i, 4).setValue('B' + i + '-' + Date.now()); });
      SpreadsheetApp.flush();
    });
    // C: ein batchGet + ein values.batchUpdate (USER_ENTERED)
    var c = reihe(n, function (i) {
      Sheets.Spreadsheets.Values.batchGet(id, { ranges: SCRATCH.map(function (t) { return a1(t, 'A2:O51'); }) });
      Sheets.Spreadsheets.Values.batchUpdate({
        valueInputOption: 'USER_ENTERED',
        data: SCRATCH.map(function (t) { return { range: a1(t, 'E' + (2 + i)), values: [['C' + i + '-' + Date.now()]] }; })
      }, id);
    });
    return ausgabe('sondeSchreiben', {
      a_lesen_schreiben_lesen_je_blatt_3_blaetter: a,
      b_erst_lesen_dann_schreiben_ein_flush: b,
      c_batchget_plus_batchupdate: c,
      hinweis: 'Dateigröße beeinflusst A/B stärker als C (Referenzprojekt: in großen Dateien C 5× schneller).'
    });
  }

  // ------------------------------------------------------------------ Sichtbarkeit API ↔ SpreadsheetApp

  function sichtbarkeit() {
    var id = kopieId();
    var datei = SpreadsheetApp.openById(id);
    var sh = scratch(datei)[0];
    var vorher = sh.getRange(2, 2).getValue();
    var neu = 'API-' + Date.now();
    Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'USER_ENTERED', data: [{ range: a1(SCRATCH[0], 'B2'), values: [[neu]] }] }, id);
    var ssaGleichesBlatt = sh.getRange(2, 2).getValue();
    var ssaBereichGanz = sh.getRange(1, 1, 5, 5).getValues()[1][1];
    var api = Sheets.Spreadsheets.Values.batchGet(id, { ranges: [a1(SCRATCH[0], 'B2')] }).valueRanges[0].values[0][0];
    SpreadsheetApp.flush();
    var nachFlush = sh.getRange(2, 2).getValue();
    var neuGeoeffnet = SpreadsheetApp.openById(id).getSheetByName(SCRATCH[0]).getRange(2, 2).getValue();
    var ungelesen = datei.getSheetByName(SCRATCH[1]);
    var neu2 = 'API2-' + Date.now();
    Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'USER_ENTERED', data: [{ range: a1(SCRATCH[1], 'B2'), values: [[neu2]] }] }, id);
    var ssaVorherUngelesen = ungelesen.getRange(2, 2).getValue();
    return ausgabe('sondeSichtbarkeit', {
      vorher_gleich_neu: vorher === neu,
      spreadsheetapp_sieht_api_schreibung_gleiche_zelle: ssaGleichesBlatt === neu,
      spreadsheetapp_sieht_api_schreibung_anderer_bereich: ssaBereichGanz === neu,
      batchget_sieht_api_schreibung: api === neu,
      spreadsheetapp_nach_flush: nachFlush === neu,
      spreadsheetapp_nach_neuem_openById: neuGeoeffnet === neu,
      spreadsheetapp_vorher_nicht_gelesenes_blatt: ssaVorherUngelesen === neu2
    });
  }

  // ------------------------------------------------------------------ USER_ENTERED ↔ setValues

  var KNIFFLIG = ["'=1+1", '84061', '0871 12345', '1,5', '1.5', '17.08.2026', '2026-08-17', '-5', '+49 871 1', 'TRUE', 'ja', ' vorn', '@x', "'"];

  function werte() {
    var id = kopieId();
    var datei = SpreadsheetApp.openById(id);
    var tab = 'Mitglied';
    var sh = datei.getSheetByName(tab);
    var letzte = sh.getLastRow(), spalten = sh.getLastColumn();
    if (letzte < 2) throw new Error('Sonden: Mitglied in der Kopie ist leer.');
    var kopf = sh.getRange(1, 1, 1, spalten).getValues()[0].map(String);
    var muster = Werte.objektZuZeile(kopf, Werte.zeileZuObjekt(kopf, sh.getRange(2, 1, 1, spalten).getValues()[0], tab), tab);
    var typ = {};
    (Schema.TABELLEN[tab].spalten || []).forEach(function (s) { typ[s.name] = s.typ; });
    var k = 0;
    var zeile = muster.map(function (v, i) {
      if (typ[kopf[i]] !== 'Text') return v === null || v === undefined ? '' : v;
      var w = KNIFFLIG[k++ % KNIFFLIG.length];
      return Werte.zelleSchreiben(w, { typ: 'Text' });   // wie der Produktivcode schreibt (Formelschutz)
    });
    var zA = letzte + 1, zB = letzte + 2;
    if (sh.getMaxRows() < zB) sh.insertRowsAfter(sh.getMaxRows(), 10);
    sh.getRange(zA, 1, 1, spalten).setValues([zeile]);
    SpreadsheetApp.flush();
    Sheets.Spreadsheets.Values.batchUpdate({
      valueInputOption: 'USER_ENTERED',
      data: [{ range: a1(tab, 'A' + zB + ':' + spaltenBuchstabe(spalten) + zB), values: [zeile] }]
    }, id);
    var unf = Sheets.Spreadsheets.Values.batchGet(id, { ranges: [a1(tab, 'A' + zA + ':' + spaltenBuchstabe(spalten) + zB)], valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }).valueRanges[0].values || [];
    var fmt = Sheets.Spreadsheets.Values.batchGet(id, { ranges: [a1(tab, 'A' + zA + ':' + spaltenBuchstabe(spalten) + zB)], valueRenderOption: 'FORMATTED_VALUE' }).valueRanges[0].values || [];
    var abw = [];
    for (var c = 0; c < spalten; c++) {
      var u1 = unf[0] && unf[0][c] !== undefined ? unf[0][c] : '', u2 = unf[1] && unf[1][c] !== undefined ? unf[1][c] : '';
      var f1 = fmt[0] && fmt[0][c] !== undefined ? fmt[0][c] : '', f2 = fmt[1] && fmt[1][c] !== undefined ? fmt[1][c] : '';
      if (u1 !== u2 || f1 !== f2) {
        abw.push({ spalte: kopf[c], typ: typ[kopf[c]] || '?', geschrieben: typeof zeile[c] === 'string' && typ[kopf[c]] === 'Text' ? zeile[c] : typeof zeile[c],
          setValues: [typeof u1, typ[kopf[c]] === 'Text' ? u1 : '', f1 === '' ? '' : '…'], user_entered: [typeof u2, typ[kopf[c]] === 'Text' ? u2 : '', f2 === '' ? '' : '…'] });
      }
    }
    // Wie liest der Produktivcode die knifflige Zeile zurück? (Text-Spalten: Rundreise gleich?)
    var rundreise = [];
    kopf.forEach(function (name, c) {
      if (typ[name] !== 'Text') return;
      var gelesen = Werte.zelleLesen(unf[0] && unf[0][c] !== undefined ? unf[0][c] : '', { typ: 'Text' });
      var erwartet = Werte.zelleLesen(zeile[c], { typ: 'Text' });
      if (String(gelesen) !== String(erwartet)) rundreise.push({ spalte: name, geschrieben: zeile[c], gelesen: gelesen });
    });
    sh.deleteRows(zA, 2);
    SpreadsheetApp.flush();
    return ausgabe('sondeWerte', {
      spalten: spalten, abweichungen_setValues_vs_user_entered: abw,
      rundreise_text_abweichend: rundreise,
      hinweis: 'Leere Liste = gleiches Blattbild. Testzeilen wurden wieder gelöscht (nur in der Kopie).'
    });
  }

  // ------------------------------------------------------------------ Einzelpreise

  function preise() {
    var id = kopieId();
    var cache = CacheService.getScriptCache();
    var lock = LockService.getScriptLock();
    var datei = SpreadsheetApp.openById(id);
    var tab = datentabs(datei)[0];
    var snapshotRoh = null;
    var ergebnis = {
      openById: reihe(N, function () { SpreadsheetApp.openById(id); }),
      getSheetByName: reihe(N, function () { datei.getSheetByName(tab); }),
      tryLock_releaseLock: reihe(N, function () { if (lock.tryLock(5000)) lock.releaseLock(); }),
      cache_get: reihe(N, function (i) { cache.get('sonde:x' + i); }),
      cache_put: reihe(N, function (i) { cache.put('sonde:x' + i, 'x', 60); }),
      cache_get_put: reihe(N, function (i) { cache.get('sonde:y' + i); cache.put('sonde:y' + i, 'y', 60); }),
      flush_ohne_ausstehendes: reihe(N, function () { SpreadsheetApp.flush(); }),
      session_activeUser: reihe(N, function () { Session.getActiveUser().getEmail(); }),
      property_get: reihe(N, function () { PropertiesService.getScriptProperties().getProperty('DB_ID'); }),
      snapshot_cache_lade: reihe(N, function () { snapshotRoh = Cache.lade('snapshot:basis'); })
    };
    if (snapshotRoh) {
      var json = JSON.stringify(snapshotRoh);
      ergebnis.snapshot_json_kb = Math.round(json.length / 1024);
      ergebnis.snapshot_stringify = reihe(N, function () { JSON.stringify(snapshotRoh); });
      ergebnis.snapshot_gzip_base64 = reihe(N, function () { Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json, 'application/json')).getBytes()); });
    } else {
      ergebnis.snapshot = 'nicht im Cache – vorher die WebApp einmal öffnen';
    }
    return ausgabe('sondePreise', ergebnis);
  }

  function alle() {
    return { lesen: lesen(), preise: preise(), schreiben: schreiben(), werte: werte(), sichtbarkeit: sichtbarkeit() };
  }

  return { lesen: lesen, schreiben: schreiben, sichtbarkeit: sichtbarkeit, werte: werte, preise: preise, alle: alle, stat: stat };
})();

// Öffentliche Einstiege für den Apps-Script-Editor – nur Funktionskonto, nur gegen die Kopie (SONDE_DB_ID).
function sondeLesen() { Zugriff.nurFunktionskonto(); return Sonden.lesen(); }
function sondeSchreiben() { Zugriff.nurFunktionskonto(); return Sonden.schreiben(); }
function sondeSichtbarkeit() { Zugriff.nurFunktionskonto(); return Sonden.sichtbarkeit(); }
function sondeWerte() { Zugriff.nurFunktionskonto(); return Sonden.werte(); }
function sondePreise() { Zugriff.nurFunktionskonto(); return Sonden.preise(); }
function sondeAlle() { Zugriff.nurFunktionskonto(); return Sonden.alle(); }
