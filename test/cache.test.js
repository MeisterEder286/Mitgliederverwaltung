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

test('mehrteilig: nur geänderte Einträge neu gepackt, fehlender Teil oder altes Format → null', () => {
  const { f, g } = aufbau();
  const c = f.globale.CacheService.getScriptCache();
  const k1 = g.Cache.speichereMehrteilig('m', { v: 1 }, { a: { x: 1 }, b: gross(40000) }, null, null, 600);
  assert.ok(k1.eintraege.b.teile >= 2);
  const k2 = g.Cache.speichereMehrteilig('m', { v: 2 }, { a: { x: 2 }, b: gross(40000) }, k1, ['a'], 600);
  assert.notStrictEqual(k2.eintraege.a.generation, k1.eintraege.a.generation);
  assert.deepStrictEqual(k2.eintraege.b, k1.eintraege.b, 'b weiterverwendet');
  const r = rein(g.Cache.ladeMehrteilig('m'));
  assert.deepStrictEqual(r.daten, { v: 2 });
  assert.deepStrictEqual(r.eintraege.a, { x: 2 });
  assert.deepStrictEqual(r.eintraege.b, gross(40000));
  // alte Einträge (älter als 3 h) werden trotzdem neu geschrieben, damit sie nicht vor dem Kopf verfallen
  const alt = JSON.parse(JSON.stringify(k2)); alt.eintraege.b.am = 0;
  const k3 = g.Cache.speichereMehrteilig('m', { v: 3 }, { a: { x: 3 }, b: { y: 1 } }, alt, ['a'], 600);
  assert.notStrictEqual(k3.eintraege.b.generation, k2.eintraege.b.generation);
  c.remove('m:a:g' + k3.eintraege.a.generation + ':0');
  assert.strictEqual(g.Cache.ladeMehrteilig('m'), null);
  g.Cache.speichere('alt', { a: 1 }, 600);
  assert.strictEqual(g.Cache.ladeMehrteilig('alt'), null, 'altes Einteil-Format → neu bauen');
});