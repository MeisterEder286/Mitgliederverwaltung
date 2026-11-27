/**
 * Tests für die Neuaufnahme (apiMitgliedAufnehmen, apiFinanzenIbanSuchen): Person oder Familie mit Zahlung in einem
 * Schritt – neues Konto mit IBAN, vorhandene IBAN erkennen, Konto einer anderen Person mitnutzen, Beitragsgemeinschaft,
 * gesetzliche Vertretung nur bei Minderjährigen, Feldfehler je Person, Rechte.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein, alsObjekte } = require('./daten/generator');

const MV = 'verwaltung@tsv-ergoldsbach.de';
const KASSIER = 'kassier@tsv-ergoldsbach.de';
const verein = erzeugeVerein({ seed: 5, mitglieder: 200 });
const IBAN = 'DE89370400440532013000';

function als(email) {
  const f = erzeugeFakes({ tabs: verein.tabs, email, eigentuemer: MV });
  const g = ladeProjekt(f.globale);
  return { f, g, obj: tab => alsObjekte({ [tab]: f.daten(tab) })[tab] };
}
function ok(a) { a = rein(a); assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return a.daten; }
function fehler(a, art) { a = rein(a); assert.strictEqual(a.ok, false, 'Fehler erwartet'); assert.strictEqual(a.fehler.art, art, JSON.stringify(a.fehler)); return a.fehler; }

function familie(zahlung, gemeinschaft) {
  return {
    eintrittsdatum: '2026-11-01',
    personen: [
      { mitglied: { vorname: 'Anna', nachname: 'Aufnahmetest', geburtsdatum: '1985-02-03', strasse: 'Ringstraße', hausnummer: '4', plz: '84061', ort: 'Ergoldsbach', beitragsart_id: 1 },
        abteilungen: [{ abteilung_id: 2, status: 'aktiv' }],
        vertretung: { art: 'frei', name: 'Soll ignoriert werden' } },
      { mitglied: { vorname: 'Ben', nachname: 'Aufnahmetest', geburtsdatum: '2015-06-07', strasse: 'Ringstraße', hausnummer: '4', plz: '84061', ort: 'Ergoldsbach', beitragsart_id: 2 },
        abteilungen: [{ abteilung_id: 1, status: 'aktiv' }],
        vertretung: { art: 'antrag', index: 0 } }
    ],
    zahlung, gemeinschaft
  };
}

test('Familie mit neuem Lastschrift-Konto und Gemeinschaft: alles in einem Aufruf, Vertretung nur beim Kind', () => {
  const u = als(MV);
  const d = ok(u.g.apiMitgliedAufnehmen(familie(
    { art: 'neu', inhaber: { art: 'antrag', index: 0 }, konto: { zahlweg: 'Lastschrift', iban: 'DE89 3704 0044 0532 0130 00', mandatsdatum: '2026-10-20' } },
    { art: 'neu', bezeichnung: 'Familie Aufnahmetest', festbetrag: '150,00' })));
  assert.strictEqual(d.mitglieder.length, 2);
  const ms = u.obj('Mitglied').filter(m => m.nachname === 'Aufnahmetest');
  const anna = ms.find(m => m.vorname === 'Anna'), ben = ms.find(m => m.vorname === 'Ben');
  const konto = u.obj('Beitragskonto').find(k => k.beitragskonto_id === d.konto_id);
  assert.strictEqual(konto.iban, IBAN);
  assert.strictEqual(konto.kontoinhaber_name, 'Anna Aufnahmetest');
  assert.strictEqual(konto.kontoinhaber_mitglied_id, anna.mitglied_id);
  assert.strictEqual(konto.mandatsreferenz, 'TSV-2026-' + anna.mitgliedsnummer);
  assert.strictEqual(anna.beitragskonto_id, d.konto_id);
  assert.strictEqual(ben.beitragskonto_id, d.konto_id);
  const gem = u.obj('Beitragsgemeinschaft').find(g => g.beitragsgemeinschaft_id === d.gemeinschaft_id);
  assert.strictEqual(gem.festbetrag, 150);
  assert.strictEqual(anna.beitragsgemeinschaft_id, gem.beitragsgemeinschaft_id);
  assert.strictEqual(ben.vertreter_mitglied_id, anna.mitglied_id);
  assert.ok(!anna.vertreter_name, 'Volljährige bekommen keine gesetzliche Vertretung');
  assert.notStrictEqual(anna.mitgliedsnummer, ben.mitgliedsnummer);
  assert.ok(u.obj('Abteilungszugehoerigkeit').some(z => z.mitglied_id === ben.mitglied_id && z.abteilung_id === 1));
  assert.ok(!JSON.stringify(d).includes(IBAN), 'keine Klartext-IBAN an den Browser');
});

test('IBAN schon vorhanden: Suche findet das Konto, Neuanlage wird ohne Bestätigung abgelehnt, Mitnutzen klappt', () => {
  const u = als(MV);
  const vorhanden = u.obj('Beitragskonto').find(k => k.iban && k.aktiv !== false);
  const s = ok(u.g.apiFinanzenIbanSuchen(vorhanden.iban.replace(/(.{4})/g, '$1 ')));
  assert.strictEqual(s.gueltig, true);
  assert.ok(s.treffer.some(t => t.beitragskonto_id === vorhanden.beitragskonto_id));
  assert.ok(!JSON.stringify(s).includes(vorhanden.iban));
  assert.strictEqual(ok(u.g.apiFinanzenIbanSuchen('DE00 1234')).gueltig, false);

  const eingabe = { eintrittsdatum: '2026-11-01', personen: [{ mitglied: { vorname: 'Carl', nachname: 'Ibantest', geburtsdatum: '1990-01-01' } }],
    zahlung: { art: 'neu', konto: { zahlweg: 'Lastschrift', iban: vorhanden.iban, mandatsdatum: '2026-10-01', kontoinhaber_name: 'Carl Ibantest' } } };
  const f = fehler(u.g.apiMitgliedAufnehmen(eingabe), 'fachlich');
  assert.ok(f.felder.some(x => x.bereich === 'zahlung' && x.feld === 'iban'));
  assert.ok(!u.obj('Mitglied').some(m => m.nachname === 'Ibantest'), 'nichts geschrieben');

  const d = ok(u.g.apiMitgliedAufnehmen(Object.assign({}, eingabe, { zahlung: { art: 'konto', beitragskonto_id: vorhanden.beitragskonto_id } })));
  const carl = u.obj('Mitglied').find(m => m.mitglied_id === d.mitglieder[0].mitglied_id);
  assert.strictEqual(carl.beitragskonto_id, vorhanden.beitragskonto_id);
});

test('Feldfehler je Person, Minderjährige ohne Vertretung nur als Hinweis, Kassier darf nicht aufnehmen', () => {
  const u = als(MV);
  const f = fehler(u.g.apiMitgliedAufnehmen({ eintrittsdatum: '2026-11-01', personen: [
    { mitglied: { vorname: 'Ok', nachname: 'Gut' } }, { mitglied: { vorname: 'Ohne', plz: '12' } }] }), 'fachlich');
  assert.ok(f.felder.some(x => x.person === 1 && x.feld === 'nachname'));
  assert.ok(f.felder.some(x => x.person === 1 && x.feld === 'plz'));
  assert.ok(!f.felder.some(x => x.person === 0));

  const d = ok(u.g.apiMitgliedAufnehmen({ eintrittsdatum: '2026-11-01', personen: [{ mitglied: { vorname: 'Klein', nachname: 'Kindtest', geburtsdatum: '2018-01-01' } }], zahlung: { art: 'spaeter' } }));
  assert.ok(d.hinweise.some(h => /minderjährig/.test(h)));
  assert.ok(d.hinweise.some(h => /kein Beitragskonto/.test(h)));

  const k = als(KASSIER);
  fehler(k.g.apiMitgliedAufnehmen({ eintrittsdatum: '2026-11-01', personen: [{ mitglied: { vorname: 'X', nachname: 'Y' } }] }), 'zugriff');
});

test('Bestehende Gemeinschaft nur mit deren Konto', () => {
  const u = als(MV);
  const m = u.obj('Mitglied').find(x => x.beitragsgemeinschaft_id && x.beitragskonto_id);
  if (!m) return;   // Generator ohne Gemeinschaft – nichts zu prüfen
  const andere = u.obj('Beitragskonto').find(k => k.beitragskonto_id !== m.beitragskonto_id && k.aktiv !== false);
  const basis = { eintrittsdatum: '2026-11-01', personen: [{ mitglied: { vorname: 'Gem', nachname: 'Gemtest', geburtsdatum: '2016-03-03' } }],
    gemeinschaft: { art: 'bestehend', beitragsgemeinschaft_id: m.beitragsgemeinschaft_id } };
  const f = fehler(u.g.apiMitgliedAufnehmen(Object.assign({ zahlung: { art: 'konto', beitragskonto_id: andere.beitragskonto_id } }, basis)), 'fachlich');
  assert.ok(f.felder.some(x => x.bereich === 'gemeinschaft'));
  const d = ok(u.g.apiMitgliedAufnehmen(Object.assign({ zahlung: { art: 'konto', beitragskonto_id: m.beitragskonto_id } }, basis)));
  const neu = u.obj('Mitglied').find(x => x.mitglied_id === d.mitglieder[0].mitglied_id);
  assert.strictEqual(neu.beitragsgemeinschaft_id, m.beitragsgemeinschaft_id);
});
