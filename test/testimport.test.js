/**
 * Tests für das getrennte Testimport-Projekt (testimport/Import.js): Dateiprüfung, Kopfzeilen, _Konfig-Plan,
 * Schreibblöcke und der ganze Ablauf mit kleinen Drive-/Sheets-Fakes gegen einen echten Export
 * (tools/testdaten-export.js): Inhalt der Tabelle = Zellformat des Generators, Schutz vor Nicht-Test-Tabellen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { exportiere } = require('../tools/testdaten-export');
const { ladeProjekt } = require('./hilfe/projekt');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'testimport', 'Import.js'), 'utf8');
function lade(globale) {
  const ctx = vm.createContext(Object.assign({ console: { log() {}, error() {} } }, globale || {}));
  new vm.Script(CODE, { filename: 'Import.js' }).runInContext(ctx);
  return ctx;
}
const P = lade().TestImportPlan;
const T = ladeProjekt({}).Schema.TABELLEN;
const kopf = tab => Array.from(T[tab].spalten, s => s.name);

const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'testimport-'));
exportiere({ mitglieder: 200, seed: 5, stichtag: '2026-11-27', ziel, benutzer: ['test@example.org'] });
const DATEI = fs.readFileSync(path.join(ziel, 'testdaten.json'), 'utf8');
test.after(() => fs.rmSync(ziel, { recursive: true, force: true }));

// ------------------------------------------------------------------ Fakes

function a1Bereich(a1) {
  const m = /^'([^']+)'!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a1);
  const sp = s => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  return { tab: m[1], spalte: sp(m[2]), zeile: Number(m[3]) };
}

function fakeUmgebung(opt) {
  const tabelle = {};   // Tab → 2D-Array (Zeile 1 = Kopf)
  const tabs = ['Mitglied', 'Mitgliedschaftszeitraum', 'Abteilungszugehoerigkeit', 'Funktion', 'Beitragsgemeinschaft', 'Beitragskonto',
    'Sollstellung', 'Qualifikation', 'Ehrung', 'Einwilligung', 'Benutzer', 'Abteilung'];
  tabs.forEach(t => { tabelle[t] = [kopf(t)]; });
  tabelle.Mitglied.push(kopf('Mitglied').map((_, i) => i === 0 ? 999 : 'alt'));   // alte Zeile, muss verschwinden
  tabelle.Abteilung.push(kopf('Abteilung').map(() => 'bleibt'));
  tabelle._Konfig = [['schluessel', 'wert', 'beschreibung'], ['beitragsjahr', '2025', 'x'], ['next_id_Mitglied', '15', 'x'], ['mail_aktiv', 'nein', 'x']];
  (opt.anpassen || (() => {}))(tabelle);
  const aufrufe = [];
  const blatt = name => !tabelle[name] ? null : {
    getLastRow: () => tabelle[name].length,
    getLastColumn: () => tabelle[name][0] ? tabelle[name][0].length : 0,
    getMaxRows: () => Math.max(tabelle[name].length, 1000),
    getMaxColumns: () => tabelle[name][0].length,
    getRange: (z, s, nz, ns) => ({
      getValues: () => tabelle[name].slice(z - 1, z - 1 + nz).map(r => r.slice(s - 1, s - 1 + ns)),
      clearContent: () => { tabelle[name].length = 1; aufrufe.push('leeren ' + name); }
    }),
    insertRowsAfter: () => {},
    getDataRange: () => ({ getValues: () => tabelle[name].map(r => r.slice()) })
  };
  const setze = (a1, werte) => {
    const b = a1Bereich(a1);
    werte.forEach((r, i) => {
      const zeile = tabelle[b.tab][b.zeile - 1 + i] = tabelle[b.tab][b.zeile - 1 + i] || [];
      r.forEach((v, j) => { zeile[b.spalte - 1 + j] = v; });
    });
  };
  const ss = {
    getName: () => opt.name || 'Mitgliederverwaltung TEST',
    getSheetByName: blatt
  };
  const datei = (inhalt, tag) => ({ getName: () => 'testdaten.json', getLastUpdated: () => new Date(2026, 10, tag), getBlob: () => ({ getDataAsString: () => inhalt }) });
  const dateien = opt.dateien || [datei('{"alt":true}', 1), datei(DATEI, 20)];
  const g = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => ({ TEST_DB_ID: 'test-id', TESTDATEN_ORDNER_ID: 'ordner' })[k] || null }) },
    SpreadsheetApp: { openById: id => { assert.strictEqual(id, 'test-id'); return ss; }, flush: () => {} },
    DriveApp: { getFolderById: () => ({ getFilesByName: () => { let i = 0; return { hasNext: () => i < dateien.length, next: () => dateien[i++] }; } }) },
    Sheets: { Spreadsheets: { Values: {
      update: (body, id, a1, o) => { assert.strictEqual(o.valueInputOption, 'RAW'); aufrufe.push('update ' + a1); setze(a1, body.values); },
      batchUpdate: (body) => { body.data.forEach(d => setze(d.range, d.values)); aufrufe.push('konfig'); },
      append: (body) => { body.values.forEach(r => tabelle._Konfig.push(r)); aufrufe.push('append'); }
    } } }
  };
  return { ctx: lade(g), tabelle, aufrufe };
}

// ------------------------------------------------------------------ reine Teile

test('Testname-Schutz', () => {
  assert.ok(P.istTestName('Mitgliederverwaltung TEST'));
  assert.ok(P.istTestName('test-kopie'));
  assert.ok(!P.istTestName('Mitgliederverwaltung TSV – Datenbank'));
});

test('Dateiprüfung', () => {
  assert.deepStrictEqual(Array.from(P.pruefeDatei(JSON.parse(DATEI))), []);
  const d = JSON.parse(DATEI);
  d.synthetisch = false; d.tabs._Konfig = { kopf: ['a'], zeilen: [] }; d.tabs.Ehrung.zeilen[3].pop();
  const f = P.pruefeDatei(d).join('\n');
  assert.match(f, /nicht als synthetisch/);
  assert.match(f, /_Konfig wird nie importiert/);
  assert.match(f, /Ehrung, Zeile 5/);
  assert.match(P.pruefeDatei({ art: 'x' }).join(), /keine Testdaten-Datei/);
});

test('Kopfzeilen: fehlender Tab und vertauschte Spalte, hinten mehr Spalten erlaubt', () => {
  const d = { tabs: { A: { kopf: ['x', 'y'] }, B: { kopf: ['x', 'y'] }, C: { kopf: ['x'] } } };
  const f = Array.from(P.pruefeKoepfe(d, { A: ['x', 'y', 'z'], B: ['y', 'x'], C: null }));
  assert.strictEqual(f.length, 2);
  assert.match(f[0], /Tab B, Spalte A/);
  assert.match(f[1], /Tab C fehlt/);
});

test('_Konfig-Plan: vorhandene ändern, fehlende anhängen', () => {
  const p = P.konfigPlan([['schluessel', 'wert', 'beschreibung'], ['beitragsjahr', '2025', ''], ['next_id_Ehrung', '3', '']],
    [['beitragsjahr', '2026'], ['next_id_Ehrung', 110], ['next_id_Funktion', '186']]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p.aendern)), [{ zeile: 2, spalte: 2, wert: '2026' }, { zeile: 3, spalte: 2, wert: '110' }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p.neu)), [['next_id_Funktion', '186', 'ID-Zähler – nur vom Skript erhöhen']]);
  assert.throws(() => P.konfigPlan([['a', 'b']], []), /setup/);
});

test('Schreibblöcke und Spaltenbuchstaben', () => {
  assert.strictEqual(P.spaltenBuchstabe(1), 'A');
  assert.strictEqual(P.spaltenBuchstabe(26), 'Z');
  assert.strictEqual(P.spaltenBuchstabe(43), 'AQ');
  const b = Array.from(P.bloecke('Sollstellung', 4500, 16), x => x.a1);
  assert.deepStrictEqual(b, ["'Sollstellung'!A2:P2001", "'Sollstellung'!A2002:P4001", "'Sollstellung'!A4002:P4501"]);
  assert.strictEqual(P.bloecke('X', 0, 3).length, 0);
});

// ------------------------------------------------------------------ Ablauf

test('Prüflauf schreibt nichts', () => {
  const u = fakeUmgebung({});
  const bericht = u.ctx.testdatenPruefen();
  assert.match(bericht, /PRÜFUNG in Ordnung/);
  assert.strictEqual(u.aufrufe.length, 0);
  assert.strictEqual(u.tabelle.Mitglied[1][0], 999);
});

test('Import: Tabs ersetzt im Zellformat des Generators, Stammdaten unberührt, _Konfig nachgezogen', () => {
  const u = fakeUmgebung({});
  const bericht = u.ctx.testdatenImportieren();
  assert.match(bericht, /IMPORTIERT/);
  const d = JSON.parse(DATEI);
  Object.keys(d.tabs).forEach(tab => {
    assert.deepStrictEqual(u.tabelle[tab].slice(1), d.tabs[tab].zeilen, tab);
  });
  assert.ok(!u.tabelle.Mitglied.some(r => r[0] === 999), 'alte Zeile entfernt');
  assert.strictEqual(u.tabelle.Abteilung[1][0], 'bleibt');
  const mg = u.tabelle.Mitglied[0].indexOf('mitgliedsnummer'), gd = u.tabelle.Mitglied[0].indexOf('geburtsdatum');
  assert.strictEqual(typeof u.tabelle.Mitglied[1][mg], 'string');
  assert.match(u.tabelle.Mitglied[1][mg], /^0\d{3}$/, 'führende Null bleibt');
  assert.strictEqual(typeof u.tabelle.Mitglied[1][gd], 'number', 'Datum als Seriennummer');
  const k = Object.fromEntries(u.tabelle._Konfig.slice(1).map(r => [r[0], r[1]]));
  assert.strictEqual(k.beitragsjahr, '2026');
  assert.strictEqual(k.mail_aktiv, 'nein');
  assert.ok(Number(k.next_id_Mitglied) > 200);
  assert.ok(k.next_id_Sollstellung, 'fehlender Zähler angehängt');
});

test('Benutzer bleibt unberührt, wenn die Datei keine enthält', () => {
  const ziel2 = fs.mkdtempSync(path.join(os.tmpdir(), 'testimport-'));
  try {
    exportiere({ mitglieder: 50, seed: 5, stichtag: '2026-11-27', ziel: ziel2 });
    const inhalt = fs.readFileSync(path.join(ziel2, 'testdaten.json'), 'utf8');
    const datei = { getName: () => 'testdaten.json', getLastUpdated: () => new Date(), getBlob: () => ({ getDataAsString: () => inhalt }) };
    const u = fakeUmgebung({ dateien: [datei], anpassen: t => { t.Benutzer.push(kopf('Benutzer').map((_, i) => i === 1 ? 'ich@example.org' : '')); } });
    u.ctx.testdatenImportieren();
    assert.strictEqual(u.tabelle.Benutzer[1][1], 'ich@example.org');
    assert.ok(!u.aufrufe.includes('leeren Benutzer'));
  } finally { fs.rmSync(ziel2, { recursive: true, force: true }); }
});

test('Schutz: keine Test-Tabelle, falsche Kopfzeile oder fehlende Datei → nichts geschrieben', () => {
  let u = fakeUmgebung({ name: 'Mitgliederverwaltung TSV – Datenbank' });
  assert.throws(() => u.ctx.testdatenImportieren(), /kein „TEST“ im Namen/);
  assert.strictEqual(u.aufrufe.length, 0);

  u = fakeUmgebung({ anpassen: t => { t.Ehrung[0] = t.Ehrung[0].slice().reverse(); } });
  assert.throws(() => u.ctx.testdatenImportieren(), /Nichts geschrieben:[\s\S]*Tab Ehrung/);
  assert.strictEqual(u.aufrufe.length, 0);

  u = fakeUmgebung({ anpassen: t => { delete t.Qualifikation; } });
  assert.throws(() => u.ctx.testdatenImportieren(), /Tab Qualifikation fehlt/);
  assert.strictEqual(u.aufrufe.length, 0);

  u = fakeUmgebung({ dateien: [] });
  assert.throws(() => u.ctx.testdatenImportieren(), /keine Datei testdaten\.json/);
});
