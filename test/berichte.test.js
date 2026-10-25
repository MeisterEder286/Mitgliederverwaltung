/**
 * Tests für Berichte (src/modul/Berichte.js, src/api/Berichte.js): BLSV, Einfrieren, Jahresvergleich, Listen,
 * Sichtkreis und Einwilligung.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const VEREIN = erzeugeVerein({ seed: 5, mitglieder: 300 });
function benutzer(rolle, abt) {
  const b = VEREIN.tabs.Benutzer, k = b[0];
  return b.slice(1).find(z => z[k.indexOf('rolle')] === rolle && (!abt || z[k.indexOf('abteilung_id')] === abt))[k.indexOf('email')];
}
function als(rolle, abt) {
  const f = erzeugeFakes({ tabs: JSON.parse(JSON.stringify(VEREIN.tabs)), email: benutzer(rolle, abt) });
  return { f, g: ladeProjekt(f.globale) };
}
function objekte(f, tab) { const d = f.daten(tab); return d.slice(1).filter(z => z.some(x => x !== '' && x !== null)).map(z => Object.fromEntries(d[0].map((k, i) => [k, z[i]]))); }

test('BLSV: Bestand je Sportart, Verein einmal; Export protokolliert; AL bekommt Hinweis', () => {
  const { f, g } = als('Kassier');
  const a = rein(g.apiBerichteBlsv('2026-01-01'));
  assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
  assert.ok(a.daten.verein.gesamt > 0 && a.daten.summe_sportarten >= a.daten.verein.gesamt);
  const e = rein(g.apiBerichteBlsvExport('2026-01-01'));
  assert.match(e.daten.inhalt, /Mitglieder im Verein/);
  assert.ok(objekte(f, '_Protokoll').some(p => p.aktion === 'exportiert'));
  const al = rein(als('Abteilungsleiter', 1).g.apiBerichteBlsv('2026-01-01'));
  assert.strictEqual(al.ok, false); assert.strictEqual(al.fehler.art, 'fachlich');
  assert.strictEqual(rein(g.apiBerichteBlsv('kein Datum')).fehler.art, 'fachlich');
});

test('Jahresstatistik einfrieren: nur konfig_aendern, einmal je Jahr, Jahresvergleich zeigt sie', () => {
  const { f, g } = als('Mitgliederverwalter');
  const a = rein(g.apiBerichteStatistikEinfrieren(2026, '2026-01-01', '2026-01-28'));
  assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
  const zeilen = objekte(f, 'Statistik_Jahr');
  assert.strictEqual(zeilen.length, a.daten.zeilen);
  assert.ok(zeilen.some(z => z.ebene === 'Verein'));
  assert.strictEqual(rein(g.apiBerichteStatistikEinfrieren(2026)).fehler.art, 'fachlich');
  const v = rein(g.apiBerichteJahresvergleich()).daten.jahre;
  assert.ok(v.some(j => j.jahr === 2026 && j.eingefroren));
  assert.ok(v.some(j => !j.eingefroren));
  assert.strictEqual(rein(als('Kassier').g.apiBerichteStatistikEinfrieren(2025)).fehler.art, 'zugriff');
});

test('Geburtstage und Jubiläen: Einwilligung markiert, AL nur Sichtkreis', () => {
  const { g } = als('Mitgliederverwalter');
  const gb = rein(g.apiBerichteGeburtstage('2026-01-01', '2026-12-31')).daten.eintraege;
  assert.ok(gb.length > 50);
  assert.ok(gb.some(x => x.einwilligung) && gb.some(x => !x.einwilligung));
  assert.ok(gb.every(x => typeof x.rund === 'boolean'));
  const al = rein(als('Abteilungsleiter', 1).g.apiBerichteGeburtstage('2026-01-01', '2026-12-31')).daten.eintraege;
  assert.ok(al.length < gb.length);
  const j = rein(g.apiBerichteJubilaeen(2026));
  assert.strictEqual(j.ok, true, JSON.stringify(j.fehler));
  j.daten.eintraege.forEach(x => assert.ok(x.jahre >= 10));
  assert.strictEqual(rein(g.apiBerichteGeburtstage('2026-12-31', '2026-01-01')).fehler.art, 'fachlich');
});

test('Abteilungsübersicht und Bewegungen', () => {
  const { g } = als('Vorstand');
  const ab = rein(g.apiBerichteAbteilungen()).daten;
  const fb = ab.find(a => a.bezeichnung === 'Fußball');
  assert.ok(fb.mitglieder > 0 && fb.mitglieder === fb.aktiv + fb.passiv);
  const bw = rein(g.apiBerichteBewegungen('2020-01-01', '2026-12-31')).daten;
  assert.ok(bw.eintritte > 0 && bw.austritte > 0);
  const al = rein(als('Abteilungsleiter', 1).g.apiBerichteAbteilungen()).daten;
  assert.ok(al.find(a => a.abteilung_id === 1).mitglieder > 0);
  assert.strictEqual((al.find(a => a.abteilung_id === 2) || { mitglieder: 0 }).mitglieder, 0, 'AL sieht keine fremde Abteilung');
});
