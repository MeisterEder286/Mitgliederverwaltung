/**
 * Tests für src/lib/loeschung.js – Fristen, Löschliste, Anonymisierungsplan, Betroffenenfrist, Auskunft.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeFachdaten, kopie } = require('./hilfe/fachdaten');

test('loeschbarAb: anonymisierter Anker (Beispiel Mitglied 14) → Buchungen bis 31.12.2035, löschbar ab 01.01.2036', () => {
  const { g, daten } = ladeFachdaten();
  const f = kopie(g.Loeschung.loeschbarAb(14, daten, daten.Aufbewahrungsfrist, '2026-10-25'));
  assert.strictEqual(f.loeschbar_ab, '2036-01-01');
  assert.match(f.sperre_grund, /§ 147 AO.*31\.12\.2035/);
  assert.strictEqual(kopie(g.Loeschung.loeschbarAb(1, daten, daten.Aufbewahrungsfrist, '2026-10-25')).laeuft_noch, true);
});

test('loeschbarAb: Verstorbener – Stammdaten 36 Monate, Buchungen 10 Jahre', () => {
  const { g, daten } = ladeFachdaten();
  const f = kopie(g.Loeschung.loeschbarAb(9, daten, daten.Aufbewahrungsfrist, '2026-10-25'));
  assert.strictEqual(f.mitgliedschaft_endete, '2026-02-14');
  assert.strictEqual(f.anonymisieren_ab, '2029-02-15');
  assert.strictEqual(f.loeschbar_ab, '2037-01-01');
});

test('Löschliste: sperren empfohlen, später anonymisieren, Konto leeren', () => {
  const { g, daten, konfig } = ladeFachdaten();
  const jetzt = kopie(g.Loeschung.loeschliste(daten, daten.Aufbewahrungsfrist, '2026-10-25', konfig));
  assert.ok(jetzt.some(k => k.stufe === 'sperren' && k.mitglied_id === 9));
  const spaeter = kopie(g.Loeschung.loeschliste(daten, daten.Aufbewahrungsfrist, '2029-03-01', konfig));
  assert.ok(spaeter.some(k => k.stufe === 'anonymisieren' && k.mitglied_id === 9));
  assert.ok(spaeter.some(k => k.stufe === 'konto_leeren' && k.id === 6));
  assert.ok(!spaeter.some(k => k.mitglied_id === 1 && k.tab === 'Mitglied'), 'aktives Mitglied auf der Löschliste');
});

test('Anonymisierungsplan: Restmerkmale weg, Zeiträume/Zugehörigkeiten/Einwilligungen entfernt, gemeinsames Konto bleibt', () => {
  const { g, daten, konfig } = ladeFachdaten();
  const p = kopie(g.Loeschung.anonymisierePlan(daten.Mitglied.find(m => m.mitglied_id === 5), daten, konfig, '2026-10-25'));
  const m = p.aenderungen.Mitglied[0].felder;
  assert.strictEqual(m.nachname, '(anonymisiert)');
  assert.strictEqual(m.geburtsdatum, null);
  assert.strictEqual(m.geschlecht, null);
  assert.strictEqual(m.anonymisiert, true);
  assert.deepStrictEqual(p.entfernen.Mitgliedschaftszeitraum.sort(), [5, 6]);
  assert.ok(p.entfernen.Einwilligung.includes(8));
  assert.ok(p.aenderungen.Beitragskonto[0].felder.iban === null);
  // Sabine Wagner (2) zahlt über Konto 1 von Michael → Konto bleibt, Hinweis
  const w = kopie(g.Loeschung.anonymisierePlan(daten.Mitglied.find(x => x.mitglied_id === 1), daten, konfig, '2026-10-25'));
  assert.ok(!w.aenderungen.Beitragskonto);
  assert.ok(w.hinweise.some(h => /Konto 1/.test(h)));
  // Chronik: entfernen
  const e = kopie(g.Loeschung.anonymisierePlan(daten.Mitglied.find(x => x.mitglied_id === 8), daten, Object.assign({}, konfig, { chronik_bei_anonymisierung: 'entfernen' }), '2026-10-25'));
  assert.strictEqual(e.entfernen.Funktion.length, 3);
});

test('Protokollbereinigung, Betroffenenfrist, Auskunft', () => {
  const { g, daten } = ladeFachdaten();
  const frist = daten.Aufbewahrungsfrist.find(f => f.datenkategorie === 'Änderungsprotokoll');
  assert.deepStrictEqual(kopie(g.Loeschung.protokollBereinigung(daten._Protokoll, frist, '2029-09-01')), [1, 2]);
  assert.deepStrictEqual(kopie(g.Loeschung.protokollBereinigung(daten._Protokoll, frist, '2026-10-25')), []);
  const f = kopie(g.Loeschung.betroffenenFrist({ eingang_am: '2026-10-01' }, '2026-11-05'));
  assert.deepStrictEqual(f, { frist: '2026-11-01', status: 'überfällig', tage_rest: -4 });
  const a = kopie(g.Loeschung.auskunft(1, daten));
  const titel = a.abschnitte.map(x => x.titel);
  assert.ok(titel.includes('Stammdaten und Kontakt') && titel.includes('Beitragskonto und Bankverbindung') && titel.includes('Einwilligungen'));
  assert.strictEqual(a.abschnitte[0].eintraege[0].Geburtsdatum, '14.03.1978');
});

test('Anonymisierung leert Anschreiben-Inhalte und entfernt Dokument-Links (Mandat bleibt ohne Personenbezug)', () => {
  const { ladeFachdaten, kopie } = require('./hilfe/fachdaten');
  const { g, daten, konfig } = ladeFachdaten();
  const d = kopie(daten);
  d.Anschreiben = [{ anschreiben_id: 1, mitglied_id: 14, inhalt: 'Sehr geehrter …', empfaenger: 'X', betreff: 'Austritt' }];
  d.Dokument = [{ dokument_id: 1, mitglied_id: 14, art: 'Aufnahmeantrag', link: 'https://drive.google.com/x' },
    { dokument_id: 2, mitglied_id: 14, art: 'SEPA-Mandat', beitragskonto_id: 11, link: 'https://drive.google.com/y' }];
  const m = d.Mitglied.find(x => x.mitglied_id === 14);
  const plan = kopie(g.Loeschung.anonymisierePlan(m, d, konfig || {}));
  const a = (plan.aenderungen.Anschreiben || [])[0];
  assert.ok(a, 'Anschreiben wird geändert');
  const felder = a.felder;
  assert.strictEqual(felder.inhalt, null);
  assert.deepStrictEqual(plan.entfernen.Dokument, [1]);
  assert.ok((plan.aenderungen.Dokument || []).length === 1);
});
