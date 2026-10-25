/**
 * Regressionstests zu den Befunden der Sicherheitsprüfung (docs/SICHERHEITSPRUEFUNG.md).
 * Jeder Test spielt den dort beschriebenen Angriffsweg nach und erwartet, dass er scheitert.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const verein = erzeugeVerein({ seed: 3, mitglieder: 200 });
function als(rolle) {
  const k = verein.tabs.Benutzer[0];
  const z = verein.tabs.Benutzer.slice(1).find(r => r[k.indexOf('rolle')] === rolle);
  const f = erzeugeFakes({ tabs: verein.tabs, email: z[k.indexOf('email')] });
  return { f, g: ladeProjekt(f.globale) };
}

test('K1: Abteilungs- und Jugendleiter bekommen keinen Buchhaltungs-Export', () => {
  for (const rolle of ['Abteilungsleiter', 'Jugendleiter']) {
    const a = rein(als(rolle).g.apiFinanzenBuchhaltung(2026));
    assert.strictEqual(a.ok, false, rolle);
    assert.strictEqual(a.fehler.art, 'zugriff', rolle);
  }
  assert.strictEqual(rein(als('Kassier').g.apiFinanzenBuchhaltung(2026)).ok, true);
});

test('H2: Versionskonflikt liefert keinen Datensatz (keine IBAN im Klartext)', () => {
  const { g } = als('Mitgliederverwalter');
  const k = verein.tabs.Beitragskonto;
  const zeile = k.slice(1).find(z => z[k[0].indexOf('iban')]);
  const id = zeile[k[0].indexOf('beitragskonto_id')];
  const a = rein(g.apiFinanzenKontoSpeichern(id, 999, { bemerkung: 'x' }));
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.fehler.art, 'konflikt');
  assert.ok(!JSON.stringify(a).includes(zeile[k[0].indexOf('iban')]), 'IBAN im Klartext in der Antwort');
});

test('Keine Antwort irgendeiner Lesefunktion enthält eine IBAN im Klartext (außer IbanAufdecken/SEPA)', () => {
  const ibans = verein.tabs.Beitragskonto.slice(1).map(z => z[verein.tabs.Beitragskonto[0].indexOf('iban')]).filter(Boolean);
  const { g } = als('Mitgliederverwalter');
  const antworten = [g.apiStart(), g.apiSnapshot(['finanzen', 'historie']), g.apiFinanzenUebersicht(2026),
    g.apiFinanzenKlaerliste(), g.apiFinanzenBuchhaltung(2026), g.apiDatenschutzProtokoll({}, 0)];
  const text = JSON.stringify(antworten);
  ibans.forEach(i => assert.ok(!text.includes(i), 'IBAN gefunden: ' + i.slice(0, 6) + '…'));
});

test('M1: Einstellungen werden mit Formelschutz geschrieben', () => {
  const { f, g } = als('Mitgliederverwalter');
  const k = f.daten('_Konfig');
  const iS = k[0].indexOf('schluessel'), iW = k[0].indexOf('wert');
  const zeile = k.find(z => z[iS] === 'verein_name');
  const a = rein(g.apiVerwaltungKonfigSpeichern('verein_name', '=IMPORTXML("https://x","//a")', zeile[iW]));
  const nachher = f.daten('_Konfig').find(z => z[iS] === 'verein_name')[iW];
  assert.ok(!String(nachher).startsWith('='), 'Formel ungeschützt gespeichert: ' + nachher + ' / ' + JSON.stringify(a.fehler || ''));
});
