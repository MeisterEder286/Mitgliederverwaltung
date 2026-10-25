/**
 * Tests für Ehrungen (src/modul/Ehrungen.js, src/api/Ehrungen.js) gegen die Fakes mit synthetischem Verein.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const VEREIN = erzeugeVerein({ seed: 3, mitglieder: 300 });
function mail(rolle) {
  const b = VEREIN.tabs.Benutzer, k = b[0];
  return b.slice(1).find(z => z[k.indexOf('rolle')] === rolle)[k.indexOf('email')];
}
function als(rolle, tabs) {
  const f = erzeugeFakes({ tabs: tabs || JSON.parse(JSON.stringify(VEREIN.tabs)), email: mail(rolle) });
  return { f, g: ladeProjekt(f.globale) };
}
function objekte(f, tab) { const d = f.daten(tab); return d.slice(1).filter(z => z.some(x => x !== '' && x !== null)).map(z => Object.fromEntries(d[0].map((k, i) => [k, z[i]]))); }

test('Jahresliste: nur mit ehrung_bearbeiten, mit Namen und Einwilligungs-Hinweis', () => {
  const { g } = als('Mitgliederverwalter');
  const a = rein(g.apiEhrungenListe(2026));
  assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
  assert.ok(a.daten.eintraege.length > 0);
  const e = a.daten.eintraege[0];
  assert.ok(e.name && typeof e.veroeffentlichung_erlaubt === 'boolean');
  assert.strictEqual(a.daten.einstellungen.ehrung_zaehlweise, 'letzter_eintritt');
  for (const r of ['Kassier', 'Abteilungsleiter', 'Jugendleiter']) {
    const x = rein(als(r).g.apiEhrungenListe(2026));
    assert.strictEqual(x.ok, false); assert.strictEqual(x.fehler.art, 'zugriff');
  }
  assert.strictEqual(rein(g.apiEhrungenListe('abc')).fehler.art, 'fachlich');
});

test('Übernehmen legt alle neu fälligen an (ein Sammelschreiben), zweiter Lauf legt nichts an', () => {
  const { f, g } = als('Mitgliederverwalter');
  const vorher = objekte(f, 'Ehrung').length;
  const liste = rein(g.apiEhrungenListe(2027)).daten;
  const neu = liste.eintraege.filter(e => e.neu).length;
  assert.ok(neu > 0);
  f.zaehler.sheets = 0;
  const a = rein(g.apiEhrungenUebernehmen(2027));
  assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
  assert.strictEqual(a.daten.angelegt, neu);
  assert.ok(a.messung.sheets < 30, 'Sammelschreiben: ' + a.messung.sheets + ' Tabellenzugriffe');
  assert.strictEqual(objekte(f, 'Ehrung').length, vorher + neu);
  assert.strictEqual(a.daten.aktualisiert.ehrungen.length, neu);
  const ids = objekte(f, 'Ehrung').map(e => e.ehrung_id);
  assert.strictEqual(new Set(ids).size, ids.length, 'IDs eindeutig');
  assert.strictEqual(rein(g.apiEhrungenUebernehmen(2027)).daten.angelegt, 0);
  assert.ok(rein(g.apiEhrungenListe(2027)).daten.eintraege.every(e => !e.neu));
  const prot = objekte(f, '_Protokoll');
  assert.ok(prot.some(p => p.tabelle === 'Ehrung' && p.aktion === 'angelegt'));
});

test('Verleihen (Sammel), Verschieben, Ablehnen, Öffnen; Versionskonflikt; neu fällige direkt verleihen', () => {
  const { f, g } = als('Mitgliederverwalter');
  const liste = rein(g.apiEhrungenListe(2027)).daten.eintraege;
  const neue = liste.filter(e => e.neu).slice(0, 2);
  const v = rein(g.apiEhrungenStatus(neue.map(e => ({ mitglied_id: e.mitglied_id, ehrungsregel_id: e.ehrungsregel_id, funktion_id: e.funktion_id, faellig_jahr: e.faellig_jahr })),
    'verleihen', { verliehen_am: '2027-03-12', veranstaltung: 'JHV 2027' }));
  assert.strictEqual(v.ok, true, JSON.stringify(v.fehler));
  const verliehen = objekte(f, 'Ehrung').filter(e => e.status === 'verliehen' && e.veranstaltung === 'JHV 2027');
  assert.strictEqual(verliehen.length, 2);
  // Ohne Datum: Feldfehler
  const ohne = rein(g.apiEhrungenStatus([{ ehrung_id: verliehen[0].ehrung_id, version: 1 }], 'verleihen', {}));
  assert.strictEqual(ohne.ok, false);
  // bereits verliehen → fachlich
  assert.strictEqual(rein(g.apiEhrungenStatus([{ ehrung_id: verliehen[0].ehrung_id, version: 1 }], 'verschieben', {})).fehler.art, 'fachlich');
  // öffnen, dann mit alter Version → Konflikt
  assert.strictEqual(rein(g.apiEhrungenStatus([{ ehrung_id: verliehen[0].ehrung_id, version: 1 }], 'oeffnen', {})).ok, true);
  assert.strictEqual(rein(g.apiEhrungenStatus([{ ehrung_id: verliehen[0].ehrung_id, version: 1 }], 'ablehnen', {})).fehler.art, 'konflikt');
  const ab = rein(g.apiEhrungenStatus([{ ehrung_id: verliehen[0].ehrung_id, version: 2 }], 'ablehnen', { bemerkung: 'verzichtet' }));
  assert.strictEqual(ab.ok, true);
  // erfundener Eintrag wird abgelehnt
  const falsch = rein(g.apiEhrungenStatus([{ mitglied_id: 99999, ehrungsregel_id: 1, funktion_id: null, faellig_jahr: 2026 }], 'verleihen', { verliehen_am: '2027-01-01' }));
  assert.strictEqual(falsch.fehler.art, 'fachlich');
});

test('Export wird protokolliert und enthält Briefanrede', () => {
  const { f, g } = als('Mitgliederverwalter');
  const a = rein(g.apiEhrungenExport(2026, 'urkunden'));
  assert.strictEqual(a.ok, true);
  assert.ok(a.daten.length && 'briefanrede' in a.daten[0]);
  assert.ok(objekte(f, '_Protokoll').some(p => p.aktion === 'exportiert' && p.tabelle === 'Ehrung'));
});
