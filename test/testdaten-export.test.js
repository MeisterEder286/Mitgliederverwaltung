/**
 * Tests für tools/testdaten-export.js: Export des synthetischen Vereins als TSV je Tab für die Test-Tabelle.
 * Prüft Kopfzeilen gegen das Schema, Zellformat (Datum, ja/nein, Dezimalkomma), Auslassungen (Stammdaten,
 * _Konfig, Benutzer der Vereinsdomain) und die _Konfig-Werte.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exportiere } = require('../tools/testdaten-export');
const { ladeProjekt } = require('./hilfe/projekt');

const T = ladeProjekt({}).Schema.TABELLEN;
const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'testdaten-'));
const r = exportiere({ mitglieder: 300, seed: 3, stichtag: '2026-11-27', ziel });
const lies = tab => fs.readFileSync(path.join(ziel, tab + '.tsv'), 'utf8').replace(/\r\n$/, '').split('\r\n').map(z => z.split('\t'));

test.after(() => fs.rmSync(ziel, { recursive: true, force: true }));

test('alle Bewegungsdaten-Tabs mit Kopfzeile in Schema-Reihenfolge', () => {
  ['Mitglied', 'Mitgliedschaftszeitraum', 'Abteilungszugehoerigkeit', 'Funktion', 'Beitragskonto', 'Beitragsgemeinschaft',
    'Sollstellung', 'Qualifikation', 'Ehrung', 'Einwilligung'].forEach(tab => {
    assert.ok(r.tabs[tab] > 0, tab + ' fehlt');
    const zeilen = lies(tab);
    assert.deepStrictEqual(zeilen[0], Array.from(T[tab].spalten, s => s.name), tab);
    assert.strictEqual(zeilen.length - 1, r.tabs[tab], tab);
    zeilen.forEach(z => assert.strictEqual(z.length, T[tab].spalten.length, tab + ': Spaltenzahl'));
  });
  assert.ok(r.tabs.Mitglied >= 300);
});

test('Stammdaten, _Konfig, technische Tabs und Benutzer der Vereinsdomain werden nicht exportiert', () => {
  ['Abteilung', 'Beitragsart', 'Funktionsart', '_Konfig', '_Protokoll', '_Messung', 'Benutzer', 'Aufnahmeantrag'].forEach(tab => {
    assert.ok(!fs.existsSync(path.join(ziel, tab + '.tsv')), tab);
  });
  const alles = fs.readdirSync(ziel).filter(d => d.endsWith('.tsv')).map(d => fs.readFileSync(path.join(ziel, d), 'utf8')).join('');
  assert.ok(!/\t[^\t@]+@tsv-ergoldsbach\.de\t[^\t]*\t(Vorstand|Kassier|Mitgliederverwalter|Abteilungsleiter)/.test(alles));
});

test('Zellformat für das deutsche Sheet', () => {
  const m = lies('Mitglied'), k = m[0];
  const z = m[1];
  assert.match(z[k.indexOf('geburtsdatum')], /^\d{2}\.\d{2}\.\d{4}$/);
  assert.match(z[k.indexOf('ehrenmitglied')], /^(ja|nein)$/);
  assert.match(z[k.indexOf('mitgliedsnummer')], /^\d{4}$/);
  const s = lies('Sollstellung');
  assert.match(s[1][s[0].indexOf('soll_betrag')], /^\d+,\d{2}$/);
  assert.match(s[1][s[0].indexOf('geaendert_am')], /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/);
});

test('konfig_werte.txt: Zähler über der höchsten exportierten ID, Beitragsjahr aus dem Stichtag', () => {
  const k = Object.fromEntries(fs.readFileSync(path.join(ziel, 'konfig_werte.txt'), 'utf8').trim().split('\r\n').map(z => z.split('\t')));
  assert.strictEqual(k.beitragsjahr, '2026');
  Object.keys(r.tabs).forEach(tab => {
    const zeilen = lies(tab), i = zeilen[0].indexOf(T[tab].idSpalte);
    const max = Math.max(...zeilen.slice(1).map(z => Number(z[i])));
    assert.ok(Number(k['next_id_' + tab]) > max, tab);
  });
  const nr = lies('Mitglied'), iNr = nr[0].indexOf('mitgliedsnummer');
  assert.ok(Number(k.mitgliedsnummer_naechste) > Math.max(...nr.slice(1).map(z => Number(z[iNr]))));
});

test('--benutzer: nur die angegebene Adresse als Mitgliederverwalter', () => {
  const ziel2 = fs.mkdtempSync(path.join(os.tmpdir(), 'testdaten-'));
  try {
    const r2 = exportiere({ mitglieder: 50, seed: 3, stichtag: '2026-11-27', ziel: ziel2, benutzer: ['test@example.org'] });
    assert.strictEqual(r2.tabs.Benutzer, 1);
    const b = fs.readFileSync(path.join(ziel2, 'Benutzer.tsv'), 'utf8').trim().split('\r\n').map(z => z.split('\t'));
    assert.strictEqual(b[1][b[0].indexOf('email')], 'test@example.org');
    assert.strictEqual(b[1][b[0].indexOf('rolle')], 'Mitgliederverwalter');
    assert.ok(r2.konfig.some(([s, w]) => s === 'next_id_Benutzer' && w === '2'));
    assert.throws(() => exportiere({ ziel: ziel2, benutzer: ['kein-mail'] }), /E-Mail/);
  } finally { fs.rmSync(ziel2, { recursive: true, force: true }); }
});

test('deterministisch: gleicher Seed → gleiche Dateien', () => {
  const ziel3 = fs.mkdtempSync(path.join(os.tmpdir(), 'testdaten-'));
  try {
    exportiere({ mitglieder: 300, seed: 3, stichtag: '2026-11-27', ziel: ziel3 });
    assert.strictEqual(fs.readFileSync(path.join(ziel3, 'Sollstellung.tsv'), 'utf8'), fs.readFileSync(path.join(ziel, 'Sollstellung.tsv'), 'utf8'));
  } finally { fs.rmSync(ziel3, { recursive: true, force: true }); }
});
