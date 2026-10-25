/**
 * Tests für src/Cache.js: gzip + Base64 in Teilstücken ≤ 90 KB, fehlender Teil → null, Generationen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');

function aufbau() {
  const f = erzeugeFakes({ tabs: {} });
  return { f, g: ladeProjekt(f.globale) };
}
/** Schwer komprimierbare Daten, damit mehrere Teilstücke entstehen. */
function gross(n) {
  let x = 12345;
  return { liste: Array.from({ length: n }, (_, i) => ({ i, z: (x = (x * 1103515245 + 12345) % 2147483648).toString(36) + i.toString(16) })) };
}

test('kleines Objekt: speichern und laden', () => {
  const { g } = aufbau();
  assert.strictEqual(g.Cache.speichere('t', { a: 1, ü: 'ß' }, 600), 1);
  assert.deepStrictEqual(rein(g.Cache.lade('t')), { a: 1, ü: 'ß' });
  assert.strictEqual(g.Cache.vorhanden('t'), true);
});

test('großes Objekt wird in mehrere Teilstücke ≤ 90 KB zerlegt', () => {
  const { f, g } = aufbau();
  const o = gross(40000);
  const n = g.Cache.speichere('gross', o, 600);
  assert.ok(n >= 2, 'Teilstücke: ' + n);
  assert.deepStrictEqual(rein(g.Cache.lade('gross')), o);
  // der Fake wirft bei > 100 KB je Wert – also sind alle Teile klein genug
  assert.ok(f.globale.CacheService.getScriptCache().get('gross:kopf'));
});

test('fehlt ein Teil, liefert lade() null; verwerfe() macht ungültig', () => {
  const { f, g } = aufbau();
  g.Cache.speichere('x', gross(40000), 600);
  const c = f.globale.CacheService.getScriptCache();
  const kopf = JSON.parse(c.get('x:kopf'));
  c.remove('x:g' + kopf.generation + ':1');
  assert.strictEqual(g.Cache.lade('x'), null);
  g.Cache.speichere('y', { a: 1 }, 600);
  g.Cache.verwerfe('y');
  assert.strictEqual(g.Cache.lade('y'), null);
});

test('neue Generation ersetzt die alte vollständig', () => {
  const { f, g } = aufbau();
  g.Cache.speichere('z', { v: 1 }, 600);
  const k1 = JSON.parse(f.globale.CacheService.getScriptCache().get('z:kopf')).generation;
  g.Cache.speichere('z', { v: 2 }, 600);
  const k2 = JSON.parse(f.globale.CacheService.getScriptCache().get('z:kopf')).generation;
  assert.notStrictEqual(k1, k2);
  assert.deepStrictEqual(rein(g.Cache.lade('z')), { v: 2 });
});
