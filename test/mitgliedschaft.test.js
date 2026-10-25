/**
 * Tests für src/lib/mitgliedschaft.js – Ableitungen Status, Alter, Mitgliedsjahre, Funktionsjahre.
 * Fälle aus dem Datenmodell: Bauer (Wiedereintritt 1986), Steinberger (verstorben), Vogl (neu 2026).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt } = require('./hilfe/projekt');
const M = ladeProjekt({}).Mitgliedschaft;

const bauer = [
  { mitglied_id: 5, eintrittsdatum: '1968-01-01', austrittsdatum: '1979-12-31' },
  { mitglied_id: 5, eintrittsdatum: '1986-04-01', austrittsdatum: null }
];

test('Alter und volle Jahre', () => {
  assert.strictEqual(M.alter('2008-10-26', '2026-10-25'), 17);
  assert.strictEqual(M.alter('2008-10-25', '2026-10-25'), 18);
  assert.strictEqual(M.alter('2008-02-29', '2026-02-28'), 17);
  assert.strictEqual(M.alter(null, '2026-01-01'), null);
  assert.strictEqual(M.alterImJahr('1956-06-28', 2026), 70);
});

test('Status: aktiv / ausgetreten / verstorben / ohne Zeitraum', () => {
  assert.strictEqual(M.status({}, bauer, '2026-10-25'), 'aktiv');
  assert.strictEqual(M.status({}, bauer, '1982-01-01'), 'ausgetreten');
  assert.strictEqual(M.status({ sterbedatum: '2026-02-14' }, [{ eintrittsdatum: '1962-01-01' }], '2026-10-25'), 'verstorben');
  assert.strictEqual(M.status({}, [], '2026-10-25'), null);
  // Kündigung zum Jahresende: bis dahin aktiv, Merker gekündigt
  const gek = [{ eintrittsdatum: '2001-09-01', austritt_wirksam: '2026-12-31', kuendigung_eingang: '2026-08-18' }];
  assert.strictEqual(M.status({}, gek, '2026-10-25'), 'aktiv');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(M.gekuendigt(gek, '2026-10-25'))), { austritt: '2026-12-31', eingang: '2026-08-18' });
  assert.strictEqual(M.status({}, gek, '2027-01-01'), 'ausgetreten');
});

test('Mitglied seit = Eintritt des laufenden Zeitraums', () => {
  assert.strictEqual(M.mitgliedSeit(bauer, '2026-10-25'), '1986-04-01');
});

test('Mitgliedsjahre: letzter Eintritt (beschlossen) vs. gesamt, Kalenderjahr vs. exakter Tag', () => {
  assert.strictEqual(M.mitgliedsjahre(bauer, '2026-03-01', 'letzter_eintritt', 'kalenderjahr'), 40);
  assert.strictEqual(M.mitgliedsjahre(bauer, '2026-03-01', 'letzter_eintritt', 'exakter_tag'), 39);
  // gesamt: 1968-01-01..1979-12-31 = 11 J. 11 Mon. + 1986-04-01..2026-12-31 = 40 J. 8 Mon. → 52 J. 7 Mon.
  assert.strictEqual(M.mitgliedsjahre(bauer, '2026-03-01', 'gesamt', 'kalenderjahr'), 52);
  // Austritt setzt im Modus letzter_eintritt zurück
  assert.strictEqual(M.mitgliedsjahre([{ eintrittsdatum: '1990-01-01', austrittsdatum: '2020-12-31' }], '2026-01-01', 'letzter_eintritt', 'kalenderjahr'), 0);
});

test('Funktionsjahre und laufende Funktionen', () => {
  const f = { mitglied_id: 8, von: '2016-04-01', bis: null };
  assert.strictEqual(M.funktionsjahre(f, '2026-05-01', 'kalenderjahr'), 10);
  assert.strictEqual(M.funktionsjahre({ von: '2004-08-01', bis: '2010-06-30' }, '2026-05-01', 'kalenderjahr'), 5);
  assert.strictEqual(M.laufendeFunktionen([f, { mitglied_id: 8, von: '2004-08-01', bis: '2010-06-30' }], '2026-05-01', 8).length, 1);
});

test('Jugend, Datumsrechnung', () => {
  assert.strictEqual(M.istJugend('2009-01-01', '2026-10-25', 17), true);
  assert.strictEqual(M.istJugend('2008-01-01', '2026-10-25', 17), false);
  assert.strictEqual(M.plusMonate('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(M.plusMonate('2021-10-18', 60), '2026-10-18');
  assert.strictEqual(M.plusTage('2026-12-31', 1), '2027-01-01');
});
