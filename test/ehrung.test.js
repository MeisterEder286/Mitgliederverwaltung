/**
 * Tests für src/lib/ehrung.js – Jahresliste der Ehrungen (Übergabe §4), Zählweisen, Statusübergänge.
 * Beispieldaten: test/daten/beispiel (erfunden, aus dem Datenmodell-xlsx).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeFachdaten, kopie } = require('./hilfe/fachdaten');

function liste(daten, konfig, jahr, g, opt) { return kopie(g.Ehrung.jahresliste(daten, jahr, konfig, opt)); }
function finde(l, mitglied, typ, schwelle) { return l.find(e => e.mitglied_id === mitglied && e.typ === typ && e.schwelle === schwelle); }

test('Bauer: 40 Jahre seit Wiedereintritt (letzter Eintritt, beschlossen), Vergleich 52 gesamt', () => {
  const { g, daten, konfig } = ladeFachdaten();
  const e = finde(liste(daten, konfig, 2026, g), 5, 'Mitgliedsjubiläum', 40);
  assert.ok(e, 'Bauer 40 fehlt');
  assert.match(e.grundlage, /40 J\. seit 01\.04\.1986/);
  assert.deepStrictEqual(e.vergleich, { letzter_eintritt: 40, gesamt: 52 });
});

test('Zählweise gesamt (Umschalter): Bauer 2026 keine neue Stufe 40, 50 lag 2024', () => {
  const { g, daten, konfig } = ladeFachdaten();
  daten.Ehrung = [];
  const k = Object.assign({}, konfig, { ehrung_zaehlweise: 'gesamt' });
  const l = liste(daten, k, 2026, g);
  assert.ok(!finde(l, 5, 'Mitgliedsjubiläum', 40));
  assert.ok(!finde(l, 5, 'Mitgliedsjubiläum', 50));
  assert.ok(finde(liste(daten, k, 2024, g), 5, 'Mitgliedsjubiläum', 50));
  const n = liste(daten, k, 2026, g, { nachholenAb: 2024 });
  const nach = finde(n, 5, 'Mitgliedsjubiläum', 50);
  assert.ok(nach && nach.nachzuholen && nach.faellig_jahr === 2024);
});

test('Wagner 25 Jahre 2026 (vorhandene Zeile, nicht neu); Geburtstage; Obermeier 10 J. Abteilungsleitung je Funktion', () => {
  const { g, daten, konfig } = ladeFachdaten();
  const l = liste(daten, konfig, 2026, g);
  const w = finde(l, 1, 'Mitgliedsjubiläum', 25);
  assert.ok(w && w.neu === false && w.status === 'fällig');
  assert.ok(finde(l, 6, 'Geburtstag', 70));
  assert.ok(finde(l, 5, 'Geburtstag', 75).neu);
  const o = finde(l, 8, 'Funktionsjubiläum', 10);
  assert.strictEqual(o.funktion_id, 1);
  assert.match(o.grundlage, /Abteilungsleiter \(Fußball\) seit 01\.04\.2016/);
});

test('verschoben aus 2025 bleibt offen, verliehene erscheinen nicht erneut, Verstorbene nicht', () => {
  const { g, daten, konfig } = ladeFachdaten();
  const l = liste(daten, konfig, 2026, g);
  const f = finde(l, 7, 'Mitgliedsjubiläum', 25);
  assert.ok(f && f.status === 'verschoben' && f.faellig_jahr === 2025 && f.nachzuholen);
  assert.ok(!l.some(e => e.mitglied_id === 9), 'Verstorbener auf der Liste');
  // verliehen → nicht mehr auf der Liste
  daten.Ehrung.find(e => e.ehrung_id === 2).status = 'verliehen';
  assert.ok(!finde(liste(daten, konfig, 2026, g), 1, 'Mitgliedsjubiläum', 25));
});

test('Austritt setzt die Zählung zurück (letzter Eintritt)', () => {
  const { g, daten, konfig } = ladeFachdaten();
  daten.Ehrung = [];
  const z = daten.Mitgliedschaftszeitraum.find(x => x.mitglied_id === 1);
  z.austrittsdatum = '2020-12-31';
  daten.Mitgliedschaftszeitraum.push({ zeitraum_id: 99, mitglied_id: 1, eintrittsdatum: '2022-01-01', austrittsdatum: null });
  assert.ok(!finde(liste(daten, konfig, 2026, g), 1, 'Mitgliedsjubiläum', 25));
  assert.ok(finde(liste(daten, Object.assign({}, konfig, { ehrung_zaehlweise: 'gesamt' }), 2024, g), 1, 'Mitgliedsjubiläum', 20) === undefined);
});

test('Funktionsjubiläum summe_aller: Obermeier 20 J. Ehrenamt 2026 (Überlappung/Lücken korrekt)', () => {
  const { g, daten, konfig } = ladeFachdaten();
  daten.Ehrung = [];
  const k = Object.assign({}, konfig, { funktionsjubilaeum_zaehlweise: 'summe_aller' });
  const e = finde(liste(daten, k, 2026, g), 8, 'Funktionsjubiläum', 20);
  assert.ok(e && e.funktion_id === null);
  assert.ok(!finde(liste(daten, k, 2025, g), 8, 'Funktionsjubiläum', 20));
});

test('Eindeutigkeit inkl. Funktion (V2): zwei Ämter derselben Stufe ergeben zwei Einträge', () => {
  const { g, daten, konfig } = ladeFachdaten();
  daten.Ehrung = [];
  daten.Funktion.push({ funktion_id: 50, mitglied_id: 8, funktionsart_id: 9, abteilung_id: 1, von: '2016-06-01', bis: null });
  const l = liste(daten, konfig, 2026, g).filter(e => e.mitglied_id === 8 && e.schwelle === 10);
  assert.deepStrictEqual(l.map(e => e.funktion_id).sort(), [1, 50]);
  const neu = kopie(g.Ehrung.materialisiere(l));
  assert.strictEqual(neu.length, 2);
  assert.strictEqual(neu[0].status, 'fällig');
});

test('Statusübergänge', () => {
  const { g } = ladeFachdaten();
  const v = kopie(g.Ehrung.verleihe({ status: 'fällig' }, '2027-03-12', 'JHV 2027'));
  assert.deepStrictEqual(v, { status: 'verliehen', verliehen_am: '2027-03-12', veranstaltung: 'JHV 2027' });
  assert.throws(() => g.Ehrung.verleihe({ status: 'verliehen' }, '2027-03-12'));
  assert.throws(() => g.Ehrung.verleihe({ status: 'fällig' }, ''));
  assert.strictEqual(g.Ehrung.verschiebe({ status: 'fällig' }, 'nicht erschienen').status, 'verschoben');
  assert.strictEqual(g.Ehrung.lehneAb({ status: 'fällig' }).status, 'abgelehnt');
});
