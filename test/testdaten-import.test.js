/**
 * Tests für „Testdaten einspielen“ (src/lib/testdaten.js, src/modul/Testdaten.js, apiTestdaten* in
 * src/api/Verwaltung.js) gegen die Fakes: Ablauf wie im Browser (start → Blöcke → ende) mit einer echten Datei aus
 * tools/testdaten-export.js, Ergebnis = Zellformat des Generators, Benutzer/Stammdaten unberührt, und alle Sperren
 * (Schalter TESTUMGEBUNG, „TEST“ im Dateinamen, Rolle, Kopfzeilen, Reihenfolge, Formelschutz).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');
const { exportiere } = require('../tools/testdaten-export');

const MV = 'verwaltung@tsv-ergoldsbach.de';
const VORSTAND = 'vorstand@tsv-ergoldsbach.de';
const ALT = erzeugeVerein({ mitglieder: 60, seed: 9 }).tabs;
const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'testdaten-import-'));
exportiere({ mitglieder: 250, seed: 4, stichtag: '2026-11-27', ziel, benutzer: ['fremd@example.org'] });
const DATEI = JSON.parse(fs.readFileSync(path.join(ziel, 'testdaten.json'), 'utf8'));
test.after(() => fs.rmSync(ziel, { recursive: true, force: true }));

function kopie(tabs) { const o = {}; Object.keys(tabs).forEach(t => { o[t] = tabs[t].map(z => z.slice()); }); return o; }
function aufbau(opt) {
  const o = Object.assign({ email: MV, properties: { TESTUMGEBUNG: 'ja' } }, opt || {});
  const f = erzeugeFakes({ tabs: o.tabs || kopie(ALT), email: o.email, eigentuemer: MV, properties: o.properties, dateiName: o.dateiName });
  return { f, g: ladeProjekt(f.globale) };
}
const ok = a => { assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return rein(a.daten); };
const fachlich = (a, muster) => {
  assert.strictEqual(a.ok, false, 'sollte abgelehnt werden');
  assert.strictEqual(a.fehler.art, 'fachlich', JSON.stringify(a.fehler));
  if (muster) assert.match(a.fehler.meldung, muster);
};
/** Wie der Browser: Kopfdaten ohne Zeilen. */
function info(d) {
  const i = { art: d.art, version: d.version, synthetisch: d.synthetisch, erzeugt: d.erzeugt, konfig: d.konfig, tabs: {} };
  Object.keys(d.tabs).forEach(t => { i.tabs[t] = { kopf: d.tabs[t].kopf, anzahl: d.tabs[t].zeilen.length }; });
  return i;
}
function spiele(g, d) {
  const s = ok(g.apiTestdatenStart(info(d)));
  s.tabs.forEach(t => {
    const z = d.tabs[t].zeilen;
    for (let v = 0; v < z.length; v += s.block) ok(g.apiTestdatenBlock(t, v, z.slice(v, v + s.block)));
  });
  return { start: s, ende: ok(g.apiTestdatenEnde()) };
}

test('reine Prüfung: Kopfdaten, Blöcke, Konfig-Schlüssel', () => {
  const g = ladeProjekt({});
  const T = g.Testdaten;
  const p = rein(T.pruefeKopfdaten(info(DATEI)));
  assert.deepStrictEqual(p.fehler, []);
  assert.deepStrictEqual(p.uebersprungen, ['Benutzer']);
  assert.ok(p.tabs.includes('Mitglied') && p.tabs.includes('Sollstellung') && !p.tabs.includes('Benutzer'));
  const falsch = info(DATEI); falsch.synthetisch = false; falsch.tabs.Ehrung.kopf = falsch.tabs.Ehrung.kopf.slice().reverse();
  const f = rein(T.pruefeKopfdaten(falsch)).fehler.join(' ');
  assert.match(f, /nicht als synthetisch/);
  assert.match(f, /Tab Ehrung: Spalten/);
  const zeile = DATEI.tabs.Funktion.zeilen[0].slice();
  assert.strictEqual(T.pruefeBlock('Funktion', [zeile]), null);
  zeile[2] = '=HYPERLINK("x")';
  assert.match(T.pruefeBlock('Funktion', [zeile]), /Formelzeichen/);
  assert.match(T.pruefeBlock('Funktion', [zeile.slice(1)]), /Spaltenzahl/);
  assert.match(T.pruefeBlock('Benutzer', []), /darf nicht/);
  assert.match(T.pruefeBlock('Funktion', [DATEI.tabs.Funktion.zeilen[0].map(() => ({}))]), /ungültiger Zellwert/);
  const k = rein(T.konfigWerte([['beitragsjahr', '2026'], ['next_id_Mitglied', '251'], ['next_id_Benutzer', '2'], ['mail_aktiv', 'ja']], ['Mitglied']));
  assert.deepStrictEqual(k.werte, [['beitragsjahr', '2026'], ['next_id_Mitglied', '251']]);
  assert.ok(T.istTestName('Mitgliederverwaltung TEST') && !T.istTestName('Mitgliederverwaltung TSV – Datenbank'));
});

test('Einspielen: Tabs ersetzt im Zellformat des Generators, Benutzer und Stammdaten bleiben, _Konfig und Snapshot', () => {
  const { f, g } = aufbau();
  const benutzerVorher = f.daten('Benutzer').map(z => z.slice());
  const abteilungVorher = f.daten('Abteilung').map(z => z.slice());
  const r = spiele(g, DATEI);
  assert.deepStrictEqual(r.start.uebersprungen, ['Benutzer']);
  Object.keys(DATEI.tabs).filter(t => t !== 'Benutzer').forEach(t => {
    const ist = f.daten(t).filter((z, i) => i === 0 || z.some(v => v !== ''));
    assert.deepStrictEqual(ist.slice(1).map(z => z.slice(0, DATEI.tabs[t].kopf.length)), DATEI.tabs[t].zeilen, t);
  });
  assert.deepStrictEqual(f.daten('Benutzer'), benutzerVorher);
  assert.deepStrictEqual(f.daten('Abteilung'), abteilungVorher);
  const konfig = Object.fromEntries(f.daten('_Konfig').slice(1).map(z => [z[0], z[1]]));
  const soll = Object.fromEntries(DATEI.konfig);
  assert.strictEqual(konfig.beitragsjahr, '2026');
  assert.strictEqual(konfig.next_id_Mitglied, soll.next_id_Mitglied);
  assert.strictEqual(konfig.mitgliedsnummer_naechste, soll.mitgliedsnummer_naechste);
  assert.notStrictEqual(konfig.next_id_Benutzer, '2', 'Zähler der übersprungenen Benutzer bleibt');
  assert.ok(r.ende.snapshot_gebaut_am);
  assert.strictEqual(r.ende.tabs.Mitglied, DATEI.tabs.Mitglied.zeilen.length);
  assert.strictEqual(f.properties.testdaten_laeuft, undefined, 'Marke aufgeräumt');
  // Die WebApp arbeitet danach mit dem neuen Bestand
  const sys = ok(g.apiVerwaltungSystem());
  assert.strictEqual(sys.zeilen.Mitglied, DATEI.tabs.Mitglied.zeilen.length);
  assert.strictEqual(sys.testdaten, true);
  // erneutes Einspielen ist jederzeit möglich
  ok(g.apiTestdatenStart(info(DATEI)));
});

test('Sperren: kein Schalter, kein TEST im Namen, falsche Rolle → abgelehnt, nichts geändert', () => {
  let u = aufbau({ properties: {} });
  fachlich(u.g.apiTestdatenStart(info(DATEI)), /nur in der Test-Umgebung/);
  assert.strictEqual(ok(u.g.apiVerwaltungSystem()).testdaten, false);
  fachlich(u.g.apiTestdatenBlock('Mitglied', 0, []), /nur in der Test-Umgebung/);
  fachlich(u.g.apiTestdatenEnde(), /nur in der Test-Umgebung/);

  u = aufbau({ properties: { TESTUMGEBUNG: 'JA bitte' } });
  fachlich(u.g.apiTestdatenStart(info(DATEI)), /nur in der Test-Umgebung/);

  u = aufbau({ dateiName: 'Mitgliederverwaltung TSV – Datenbank' });
  const vorher = u.f.daten('Mitglied').length;
  fachlich(u.g.apiTestdatenStart(info(DATEI)), /kein „TEST“ im Namen/);
  assert.strictEqual(u.f.daten('Mitglied').length, vorher);
  assert.strictEqual(ok(u.g.apiVerwaltungSystem()).testdaten, false);

  u = aufbau({ email: VORSTAND });
  fachlich(u.g.apiTestdatenStart(info(DATEI)), /Mitgliederverwalter/);
  assert.strictEqual(ok(u.g.apiVerwaltungSystem()).testdaten, false);

  u = aufbau({ email: 'kassier@tsv-ergoldsbach.de' });
  assert.strictEqual(u.g.apiTestdatenStart(info(DATEI)).fehler.art, 'zugriff');
});

test('Kopfzeile der Tabelle weicht ab → nichts geleert', () => {
  const tabs = kopie(ALT);
  tabs.Ehrung[0] = tabs.Ehrung[0].slice().reverse();
  const { f, g } = aufbau({ tabs });
  const vorher = f.daten('Mitglied').map(z => z.slice());
  fachlich(g.apiTestdatenStart(info(DATEI)), /Nichts geändert: Tab Ehrung/);
  assert.deepStrictEqual(f.daten('Mitglied'), vorher);
});

test('Blöcke: ohne Start, falsche Reihenfolge, Formel, zu früh beendet → abgelehnt', () => {
  const { g } = aufbau();
  const z = DATEI.tabs.Mitglied.zeilen;
  fachlich(g.apiTestdatenBlock('Mitglied', 0, z.slice(0, 10)), /Kein laufendes Einspielen/);
  ok(g.apiTestdatenStart(info(DATEI)));
  fachlich(g.apiTestdatenBlock('Mitglied', 10, z.slice(10, 20)), /Reihenfolge/);
  fachlich(g.apiTestdatenBlock('Benutzer', 0, DATEI.tabs.Benutzer.zeilen), /gehört nicht/);
  const boese = z.slice(0, 2).map(r => r.slice()); boese[1][5] = '+49 1234';
  fachlich(g.apiTestdatenBlock('Mitglied', 0, boese), /Formelzeichen/);
  fachlich(g.apiTestdatenBlock('Mitglied', z.length - 1, z.slice(0, 5)), /Zeilenposition/);
  ok(g.apiTestdatenBlock('Mitglied', 0, z.slice(0, 10)));
  fachlich(g.apiTestdatenEnde(), /Unvollständig: Mitglied \(10 von/);
});

test('Marke gilt nur für die Person, die gestartet hat', () => {
  const tabs = kopie(ALT);
  const { f, g } = aufbau({ tabs });
  ok(g.apiTestdatenStart(info(DATEI)));
  const m = JSON.parse(f.properties.testdaten_laeuft);
  m.email = 'jemand@tsv-ergoldsbach.de';
  f.properties.testdaten_laeuft = JSON.stringify(m);
  fachlich(g.apiTestdatenBlock('Mitglied', 0, DATEI.tabs.Mitglied.zeilen.slice(0, 5)), /Kein laufendes Einspielen/);
});
