/**
 * Sonden (src/Sonden.js): laufen nur gegen eine Kopie (SONDE_DB_ID ≠ DB_ID), nur als Funktionskonto, liefern
 * Median/Min/Max und keine Zellinhalte. Die Zeiten selbst sind hier bedeutungslos (Fakes) – geprüft wird der Ablauf.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const verein = erzeugeVerein({ seed: 9, mitglieder: 60 });
const EIGENTUEMER = 'verwaltung@tsv-ergoldsbach.de';
function umgebung(properties, email) {
  const f = erzeugeFakes({ tabs: verein.tabs, email: email || EIGENTUEMER, eigentuemer: EIGENTUEMER, dbId: 'KOPIE', properties });
  const orig = console.log; console.log = () => {};
  return { f, g: ladeProjekt(f.globale), still: () => { console.log = orig; } };
}

test('Sonden brechen ohne Kopie oder mit der echten Datei ab', () => {
  const ohne = umgebung({ DB_ID: 'ORIGINAL' });
  try { assert.throws(() => ohne.g.sondePreise(), /SONDE_DB_ID fehlt/); } finally { ohne.still(); }
  const gleich = umgebung({ DB_ID: 'KOPIE', SONDE_DB_ID: 'KOPIE' });
  try { assert.throws(() => gleich.g.sondeLesen(), /echte Datenbank/); } finally { gleich.still(); }
});

test('Sonden nur für das Funktionskonto', () => {
  const u = umgebung({ DB_ID: 'KOPIE', SONDE_DB_ID: 'KOPIE2' }, 'mv@tsv-ergoldsbach.de');
  const err = console.error; console.error = () => {};
  try { assert.throws(() => u.g.sondeAlle(), e => e.art === 'zugriff'); } finally { u.still(); console.error = err; }
});

test('alle Sonden laufen gegen die Kopie, liefern Median aus ≥ 6 Läufen und räumen Testzeilen weg', () => {
  const u = umgebung({ DB_ID: 'ORIGINAL', SONDE_DB_ID: 'KOPIE' });
  let e;
  const mitgliedVorher = u.f.daten('Mitglied').length;
  try { e = rein(u.g.sondeAlle()); } finally { u.still(); }
  assert.ok(e.lesen.batchget_alle_tabs.n >= 6);
  assert.strictEqual(typeof e.lesen.spreadsheetapp_erste_lesung_je_tab.median, 'number');
  assert.strictEqual(e.lesen.formatted_gleich_display.abweichend >= 0, true);
  assert.ok(e.schreiben.c_batchget_plus_batchupdate.n >= 6);
  assert.strictEqual(e.sichtbarkeit.batchget_sieht_api_schreibung, true);
  assert.ok(Array.isArray(e.werte.abweichungen_setValues_vs_user_entered));
  assert.strictEqual(u.f.daten('Mitglied').length, mitgliedVorher, 'Testzeilen gelöscht');
  assert.ok(u.f.daten('_Sonde1'), 'Scratch-Tab in der Kopie angelegt');
  const text = JSON.stringify(e);
  const k = verein.tabs.Mitglied[0];
  verein.tabs.Mitglied.slice(1, 20).forEach(z => assert.ok(!text.includes(z[k.indexOf('nachname')] + ''), 'Zellinhalt im Ergebnis'));
  assert.deepStrictEqual(rein(u.g.Sonden.stat([5, 1, 3, 9, 7, 2])), { median: 4, min: 1, max: 9, n: 6 });
});
