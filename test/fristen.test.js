/**
 * Tests für src/lib/fristen.js – FZ-Wiedervorlage, Löschfrist ab letzter Funktion, Ampel, Eingabeprüfung.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeFachdaten, kopie } = require('./hilfe/fachdaten');

const FZ = { qualifikationsart_id: 1, kategorie: 'Führungszeugnis', wiedervorlage_monate: 60, max_alter_zeugnis_monate: 3, loeschfrist_monate: 3 };

test('Wiedervorlage: Qualifikationsart vor _Konfig (X4)', () => {
  const { g } = ladeFachdaten();
  assert.strictEqual(g.Fristen.wiedervorlage({ eingesehen_am: '2024-01-12' }, FZ, { fz_wiedervorlage_monate: '12' }), '2029-01-12');
  assert.strictEqual(g.Fristen.wiedervorlage({ eingesehen_am: '2024-01-12' }, Object.assign({}, FZ, { wiedervorlage_monate: null }), { fz_wiedervorlage_monate: '12' }), '2025-01-12');
  assert.strictEqual(g.Fristen.wiedervorlage({ gueltig_bis: '2027-06-11' }, { kategorie: 'Kurs' }), '2027-06-11');
});

test('FZ-Löschfrist beginnt erst mit dem Ende der LETZTEN pflichtigen Funktion', () => {
  const { g, daten } = ladeFachdaten();
  // Huber (6): ÜL + AL laufen → keine Löschfrist
  assert.strictEqual(g.Fristen.zuLoeschenAb(6, daten, FZ, '2026-10-25'), null);
  daten.Funktion.filter(f => f.mitglied_id === 6 && !f.bis).forEach((f, i) => { f.bis = i ? '2026-09-30' : '2026-06-30'; });
  assert.strictEqual(g.Fristen.zuLoeschenAb(6, daten, FZ, '2026-10-25'), '2026-12-30');
  // Person ohne pflichtige Funktion: sofort
  assert.strictEqual(g.Fristen.zuLoeschenAb(1, daten, FZ, '2026-10-25'), '2026-10-25');
});

test('Ampel und Mängel: Vogl ohne FZ rot, Lehner abgelaufen rot, gelb im 3-Monats-Vorlauf', () => {
  const { g, daten, konfig } = ladeFachdaten();
  const u = kopie(g.Fristen.uebersicht(daten, '2026-10-25', konfig));
  const p = id => u.personen.find(x => x.mitglied_id === id);
  assert.strictEqual(p(12).ampel, 'rot');
  assert.strictEqual(p(12).fz, null);
  assert.strictEqual(p(13).ampel, 'rot');
  assert.strictEqual(p(8).ampel, 'gruen');
  assert.deepStrictEqual(u.maengel.map(m => m.mitglied_id).sort(), [12, 13]);
  assert.strictEqual(g.Fristen.ampelFuer(8, daten, '2026-12-01', konfig), 'gelb');   // Wiedervorlage 21.02.2027
  assert.strictEqual(g.Fristen.ampelFuer(1, daten, '2026-10-25', konfig), null);     // keine pflichtige Funktion
  const huber = p(6);
  assert.ok(huber.lizenzen.some(l => l.stand === 'abgelaufen'));
});

test('Eingabeprüfung Einsichtnahme: Alter des Zeugnisses, nur zulässiges Ergebnis', () => {
  const { g } = ladeFachdaten();
  const ok = { ausgestellt_am: '2026-09-01', eingesehen_am: '2026-10-20', eingesehen_durch: 'Obermeier, Thomas', ergebnis: 'ohne einschlägigen Eintrag' };
  assert.deepStrictEqual(kopie(g.Fristen.pruefeEinsicht(ok, FZ, '2026-10-25')), []);
  const alt = kopie(g.Fristen.pruefeEinsicht(Object.assign({}, ok, { ausgestellt_am: '2026-01-01' }), FZ, '2026-10-25'));
  assert.ok(alt.some(f => f.feld === 'ausgestellt_am'));
  const inhalt = kopie(g.Fristen.pruefeEinsicht(Object.assign({}, ok, { ergebnis: 'Eintrag wegen …' }), FZ, '2026-10-25'));
  assert.ok(inhalt.some(f => f.feld === 'ergebnis'));
  assert.ok(kopie(g.Fristen.pruefeEinsicht(Object.assign({}, ok, { eingesehen_am: '2026-12-01' }), FZ, '2026-10-25')).some(f => f.feld === 'eingesehen_am'));
  assert.ok(kopie(g.Fristen.pruefeEinsicht({ ergebnis: 'x' }, { kategorie: 'Lizenz' })).some(f => f.feld === 'ergebnis'));
});

test('Abgeleitete Felder und Löschung eines Vermerks', () => {
  const { g, daten, konfig } = ladeFachdaten();
  const a = kopie(g.Fristen.abgeleitet({ mitglied_id: 12, eingesehen_am: '2026-10-20' }, daten, FZ, '2026-10-25', konfig));
  assert.deepStrictEqual(a, { wiedervorlage_am: '2031-10-20', zu_loeschen_ab: null });
  const l = kopie(g.Fristen.loeschAenderungen('2026-10-25'));
  assert.strictEqual(l.geloescht_am, '2026-10-25');
  assert.strictEqual(l.eingesehen_am, null);
});
