/**
 * Tests für src/lib/blsv.js – Bestandserhebung je Sportart und Verein, Statistik_Jahr, CSV.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeFachdaten, kopie } = require('./hilfe/fachdaten');

test('Person in mehreren Abteilungen zählt je Sportart einmal, im Verein einmal', () => {
  const { g, daten } = ladeFachdaten();
  const b = kopie(g.Blsv.bestand(daten, '2026-01-01'));
  // Lena Wagner (3): Turnen + Fußball; Michael Wagner (1): Fußball passiv + Stockschützen
  assert.strictEqual(b.mehrfach, 2);
  assert.strictEqual(b.summe_sportarten, b.sportarten.reduce((s, x) => s + x.gesamt, 0));
  assert.ok(b.summe_sportarten > b.verein.gesamt);
  const fussball = b.sportarten.find(s => s.sportart === 'Fußball');
  assert.ok(fussball.davon_passiv >= 1);
  // Steinberger (verstorben 14.02.2026) zählt zum 01.01.2026 noch, zum 01.01.2027 nicht
  assert.ok(kopie(g.Blsv.bestand(daten, '2027-01-01')).verein.gesamt < b.verein.gesamt + 1);
  assert.strictEqual(b.verein.gesamt, b.verein.maennlich + b.verein.weiblich + b.verein.divers + b.verein.ohne_geschlecht);
  const klassen = b.verein.alter_bis_14 + b.verein.alter_15_18 + b.verein.alter_19_26 + b.verein.alter_ab_27 + b.verein.ohne_geburtsdatum;
  assert.strictEqual(klassen, b.verein.gesamt);
});

test('Stockschützen werden als BLSV-Sportart Eisstocksport gemeldet; Prüfliste bei fehlenden Angaben', () => {
  const { g, daten } = ladeFachdaten();
  daten.Mitglied.find(m => m.mitglied_id === 1).geschlecht = null;
  daten.Abteilung.find(a => a.abteilung_id === 3).blsv_sportart = null;
  const b = kopie(g.Blsv.bestand(daten, '2026-01-01'));
  assert.ok(b.sportarten.some(s => s.sportart === 'Eisstocksport'));
  assert.ok(b.pruefliste.some(p => p.art === 'geschlecht_fehlt' && p.mitglied_id === 1));
  assert.ok(b.pruefliste.some(p => p.art === 'sportart_fehlt' && p.abteilung_id === 3));
});

test('Jahrgangslogik vs. exakt: Lena (21.11.2011) zum 01.01.2026 → 15 bzw. 14', () => {
  const { g, daten } = ladeFachdaten();
  const nur = Object.assign({}, daten, { Mitglied: daten.Mitglied.filter(m => m.mitglied_id === 3) });
  assert.strictEqual(kopie(g.Blsv.bestand(nur, '2026-01-01')).verein.alter_15_18, 1);
  assert.strictEqual(kopie(g.Blsv.bestand(nur, '2026-01-01', { altersmodus: 'exakt' })).verein.alter_bis_14, 1);
});

test('Statistik_Jahr-Zeilen und CSV', () => {
  const { g, daten } = ladeFachdaten();
  const b = g.Blsv.bestand(daten, '2026-01-01');
  const z = kopie(g.Blsv.kennzahlen(daten, '2026-01-01'));
  assert.strictEqual(z.berichtsjahr, 2025);
  const zeilen = kopie(g.Blsv.statistikZeilen(b, 2026, '2026-01-01', z, '2026-01-31'));
  assert.strictEqual(zeilen[0].ebene, 'Verein');
  assert.strictEqual(zeilen[0].mitglieder_gesamt, kopie(b).verein.gesamt);
  assert.strictEqual(zeilen[0].beitragssoll, 380);   // Sollstellungen 2025: 280 + 100
  assert.ok(zeilen.slice(1).every(r => r.ebene === 'Abteilung' && r.abteilung_id));
  const csv = g.Blsv.csv(b);
  assert.match(csv.split('\r\n')[0], /^Sportart;gesamt;männlich/);
  assert.match(csv, /Mitglieder im Verein;/);
});
