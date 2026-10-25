/**
 * Test-Hilfe: lädt alle Dateien aus src/ in EINEN gemeinsamen vm-Kontext – genau wie Apps Script,
 * wo alle Skriptdateien einen globalen Namensraum teilen. Apps-Script-Dienste (SpreadsheetApp,
 * CacheService, …) werden als Fakes über `globale` hineingereicht (siehe test/hilfe/gas-fakes.js).
 *
 *   const { ladeProjekt, rein } = require('./hilfe/projekt');
 *   const g = ladeProjekt({ ...fakes });     // g.Schema, g.Werte, g.DB, …
 *
 * Wichtig: Objekte aus dem Kontext haben andere Prototypen als die des Testprozesses.
 * Für Vergleiche mit assert.deepStrictEqual deshalb erst rein(x) anwenden.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');

function dateien(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return dateien(p);
    return p.endsWith('.js') ? [p] : [];
  }).sort();
}

function ladeProjekt(globale) {
  const ctx = vm.createContext(Object.assign({ console }, globale || {}));
  dateien(SRC).forEach(p => {
    new vm.Script(fs.readFileSync(p, 'utf8'), { filename: path.relative(SRC, p) }).runInContext(ctx);
  });
  return ctx;
}

/** Macht Werte aus dem vm-Kontext mit assert.deepStrictEqual vergleichbar. */
function rein(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

/** Gepackten Client-Snapshot ({ bereiche, listen: { name: { k, z } } }) wie der Browser auspacken → { name: [obj] }. */
function entpacke(snap) {
  const o = {};
  const listen = snap && snap.listen ? snap.listen : {};
  Object.keys(listen).forEach(n => {
    o[n] = listen[n].z.map(z => { const x = {}; listen[n].k.forEach((k, i) => { if (z[i] !== null) x[k] = z[i]; }); return x; });
  });
  return o;
}

module.exports = { ladeProjekt, rein, entpacke };
