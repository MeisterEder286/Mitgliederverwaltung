/**
 * Startet den PHP-Test des WordPress-Moduls (wordpress/tests/eingang-sender-test.php) mit Syntaxprüfung.
 * Fehlt php auf dem Rechner, wird der Test mit Hinweis übersprungen (wie die XSD-Prüfung ohne xmllint).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const WURZEL = path.join(__dirname, '..');
const php = spawnSync('php', ['-v'], { encoding: 'utf8' });

test('WordPress-Modul eingang-sender.php: Syntax und Ablauf (php)', (t) => {
  if (php.status !== 0) { t.skip('php nicht installiert'); return; }
  for (const datei of ['wordpress/inc/eingang-sender.php', 'wordpress/tests/eingang-sender-test.php']) {
    const l = spawnSync('php', ['-l', path.join(WURZEL, datei)], { encoding: 'utf8' });
    assert.strictEqual(l.status, 0, datei + ': ' + l.stdout + l.stderr);
  }
  const r = spawnSync('php', [path.join(WURZEL, 'wordpress', 'tests', 'eingang-sender-test.php')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /alle Prüfungen ok/);
});

test('WordPress → Mitgliederverwaltung: der erzeugte Antrag wird so übernommen, wie er gemeint ist (php)', (t) => {
  if (php.status !== 0) { t.skip('php nicht installiert'); return; }
  const r = spawnSync('php', [path.join(WURZEL, 'wordpress', 'tests', 'eingang-sender-test.php'), '--beispiel'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const beispiele = JSON.parse(r.stdout);
  const { ladeProjekt, rein } = require('./hilfe/projekt');
  const { erzeugeFakes } = require('./hilfe/gas-fakes');
  const { erzeugeVerein } = require('./daten/generator');
  const v = erzeugeVerein({ seed: 5, mitglieder: 300 });
  const k = v.tabs.Benutzer[0];
  const mv = v.tabs.Benutzer.slice(1).find(z => z[k.indexOf('rolle')] === 'Mitgliederverwalter');
  const g = ladeProjekt(erzeugeFakes({ tabs: v.tabs, email: mv[k.indexOf('email')] }).globale);
  const vorschau = rein(g.apiBeitrittVorschau([
    { datei: 'familie.json', json: JSON.stringify(beispiele.familie) },
    { datei: 'kind.json', json: JSON.stringify(beispiele.kind) }]));
  assert.strictEqual(vorschau.ok, true, JSON.stringify(vorschau.fehler));
  const [familie, kind] = vorschau.daten.antraege;
  assert.deepStrictEqual(familie.tarif, { schluessel: 'familienbeitrag', beitragsart: 'Familienbeitrag', gemeinschaft: 'Familie Wpbeispiel', betrag: 180 });
  assert.ok(familie.personen.every(p => p.abteilungen.length === 2), 'fussball + fitness-turnen');
  assert.deepStrictEqual(familie.einwilligungen, ['Fotos und Videos', 'Ehrungen und Geburtstage in Vereinsmedien']);
  assert.strictEqual(familie.konto.mandatsdatum, '2026-10-25');
  assert.deepStrictEqual(familie.warnungen, [], 'keine Warnungen für einen sauberen Antrag');
  assert.strictEqual(kind.tarif.beitragsart, 'Jugendliche bis 18');
  assert.strictEqual(kind.konto_extern, true);
  assert.ok(kind.personen[0].warnungen.every(w => !/Vertretung/.test(w)), 'Vertretung aus der Unterschrift');
});
