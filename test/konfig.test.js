/**
 * Tests für src/Konfig.js – Lesen aus _Konfig mit Zwischenspeicher.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt } = require('./hilfe/projekt');
const { erzeugeFakes, beispielTabs } = require('./hilfe/gas-fakes');

test('wert/alle lesen _Konfig einmal und nutzen danach den Cache', () => {
  const f = erzeugeFakes({ tabs: beispielTabs(['_Konfig']) });
  const g = ladeProjekt(f.globale);
  assert.strictEqual(g.Konfig.wert('beitragsjahr'), '2026');
  assert.strictEqual(g.Konfig.wert('mandat_verfall_monate'), '36');
  assert.strictEqual(g.Konfig.wert('gibt_es_nicht'), null);
  assert.strictEqual(f.zaehler.batchGet, 1);
  assert.ok(f.cache['konfig:v1']);

  // neue Ausführung (frischer Kontext), gleicher Cache → kein Tabellenzugriff
  const g2 = ladeProjekt(f.globale);
  assert.strictEqual(g2.Konfig.wert('ehrung_zaehlweise'), 'letzter_eintritt');
  assert.strictEqual(f.zaehler.batchGet, 1);
});

test('vergessen leert Speicher und Cache', () => {
  const f = erzeugeFakes({ tabs: beispielTabs(['_Konfig']) });
  const g = ladeProjekt(f.globale);
  g.Konfig.wert('beitragsjahr');
  f.daten('_Konfig').find(z => z[0] === 'beitragsjahr')[1] = '2027';
  assert.strictEqual(g.Konfig.wert('beitragsjahr'), '2026');
  g.Konfig.vergessen();
  assert.ok(!f.cache['konfig:v1']);
  assert.strictEqual(g.Konfig.wert('beitragsjahr'), '2027');
  assert.strictEqual(f.zaehler.batchGet, 2);
});
