/**
 * Tests für Nachweise (src/modul/Nachweise.js, src/api/Nachweise.js): Übersicht je Rolle, Erfassen mit
 * § 72a-Prüfungen, Zeilenschutz Abteilungsleiter, Löschen nach Frist, Fristen neu berechnen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const VEREIN = erzeugeVerein({ seed: 4, mitglieder: 300 });
function benutzer(rolle, abt) {
  const b = VEREIN.tabs.Benutzer, k = b[0];
  return b.slice(1).find(z => z[k.indexOf('rolle')] === rolle && (!abt || z[k.indexOf('abteilung_id')] === abt))[k.indexOf('email')];
}
function als(rolle, abt) {
  const f = erzeugeFakes({ tabs: JSON.parse(JSON.stringify(VEREIN.tabs)), email: benutzer(rolle, abt) });
  return { f, g: ladeProjekt(f.globale) };
}
function objekte(f, tab) { const d = f.daten(tab); return d.slice(1).filter(z => z.some(x => x !== '' && x !== null)).map(z => Object.fromEntries(d[0].map((k, i) => [k, z[i]]))); }
const HEUTE = () => new Date().toISOString().slice(0, 10);

test('Übersicht: MV sieht alle Funktionsträger; AL nur seine; Kassier kein Zugriff', () => {
  const mv = rein(als('Mitgliederverwalter').g.apiNachweiseUebersicht());
  assert.strictEqual(mv.ok, true, JSON.stringify(mv.fehler));
  assert.ok(mv.daten.personen.length > 0);
  assert.ok(mv.daten.fristen_neu_berechnen);
  const al = rein(als('Abteilungsleiter', 1).g.apiNachweiseUebersicht());
  assert.strictEqual(al.ok, true);
  assert.ok(al.daten.personen.length < mv.daten.personen.length);
  assert.ok(!al.daten.fristen_neu_berechnen);
  // AL sieht nur Personen mit laufender Funktion in Abteilung 1 (Fußball)
  const fkt = objekte(als('Mitgliederverwalter').f, 'Funktion');
  al.daten.personen.forEach(p => assert.ok(fkt.some(f => f.mitglied_id === p.mitglied_id && f.abteilung_id === 1), 'fremde Person ' + p.mitglied_id));
  assert.strictEqual(rein(als('Kassier').g.apiNachweiseUebersicht()).fehler.art, 'zugriff');
});

test('FZ-Einsicht erfassen: Pflichtprüfungen, Ergebnis nur „ohne einschlägigen Eintrag“, eingesehen_durch vom Server', () => {
  const { f, g } = als('Abteilungsleiter', 1);
  const u = rein(g.apiNachweiseUebersicht()).daten;
  const fz = u.arten.find(a => a.kategorie === 'Führungszeugnis');
  const person = u.personen[0];
  const h = HEUTE();
  // Inhalte statt Ergebnis → abgelehnt
  let a = rein(g.apiNachweiseErfassen({ mitglied_id: person.mitglied_id, qualifikationsart_id: fz.id, ausgestellt_am: h, eingesehen_am: h, ergebnis: 'Eintrag wegen …' }));
  assert.strictEqual(a.ok, false); assert.ok(a.fehler.felder.some(x => x.feld === 'ergebnis'));
  // Zeugnis zu alt
  a = rein(g.apiNachweiseErfassen({ mitglied_id: person.mitglied_id, qualifikationsart_id: fz.id, ausgestellt_am: '2020-01-01', eingesehen_am: h, ergebnis: u.ergebnis_erlaubt }));
  assert.ok(a.fehler.felder.some(x => x.feld === 'ausgestellt_am'));
  // korrekt
  a = rein(g.apiNachweiseErfassen({ mitglied_id: person.mitglied_id, qualifikationsart_id: fz.id, ausgestellt_am: h, eingesehen_am: h,
    ergebnis: u.ergebnis_erlaubt, eingesehen_durch: 'Fremder Name' }));
  assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
  const q = objekte(f, 'Qualifikation').pop();
  assert.notStrictEqual(q.eingesehen_durch, 'Fremder Name');
  assert.ok(q.wiedervorlage_am, 'Wiedervorlage berechnet');
  assert.ok(a.daten.aktualisiert.qualifikationen.length === 1);
  const prot = objekte(f, '_Protokoll').pop();
  assert.strictEqual(prot.tabelle, 'Qualifikation');
  assert.ok(!String(prot.neu_wert || '').length, 'keine Werte im Protokoll');
});

test('Zeilenschutz: AL kann für Person außerhalb seines Sichtkreises nichts erfassen', () => {
  const { g } = als('Abteilungsleiter', 1);
  const mv = als('Mitgliederverwalter');
  const alle = rein(mv.g.apiNachweiseUebersicht()).daten;
  const alIds = rein(g.apiNachweiseUebersicht()).daten.personen.map(p => p.mitglied_id);
  const fremd = alle.personen.find(p => !alIds.includes(p.mitglied_id));
  if (!fremd) return;  // synthetischer Verein ohne fremde Funktionsträger
  const fz = alle.arten.find(a => a.kategorie === 'Führungszeugnis');
  const h = HEUTE();
  const a = rein(g.apiNachweiseErfassen({ mitglied_id: fremd.mitglied_id, qualifikationsart_id: fz.id, ausgestellt_am: h, eingesehen_am: h, ergebnis: alle.ergebnis_erlaubt }));
  assert.strictEqual(a.fehler.art, 'zugriff');
});

test('Lizenz erfassen und ändern; FZ-Vermerk nicht änderbar', () => {
  const { f, g } = als('Mitgliederverwalter');
  const u = rein(g.apiNachweiseUebersicht()).daten;
  const liz = u.arten.find(a => a.kategorie === 'Lizenz');
  const p = u.personen[0];
  let a = rein(g.apiNachweiseErfassen({ mitglied_id: p.mitglied_id, qualifikationsart_id: liz.id }));
  assert.strictEqual(a.ok, false);
  a = rein(g.apiNachweiseErfassen({ mitglied_id: p.mitglied_id, qualifikationsart_id: liz.id, ausgestellt_am: '2025-06-01', gueltig_bis: '2029-12-31' }));
  assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
  const q = objekte(f, 'Qualifikation').pop();
  const b = rein(g.apiNachweiseAendern(q.qualifikation_id, 1, { gueltig_bis: '2030-12-31' }));
  assert.strictEqual(b.ok, true, JSON.stringify(b.fehler));
  assert.strictEqual(rein(g.apiNachweiseAendern(q.qualifikation_id, 1, { gueltig_bis: '2031-12-31' })).fehler.art, 'konflikt');
  const fzQ = objekte(f, 'Qualifikation').find(x => x.eingesehen_am);
  if (fzQ) assert.strictEqual(rein(g.apiNachweiseAendern(fzQ.qualifikation_id, fzQ.version, { bemerkung: 'x' })).fehler.art, 'fachlich');
});

test('Löschen nur nach Fristablauf; Fristen neu berechnen nur mit Zeilensicht alle', () => {
  const { f, g } = als('Mitgliederverwalter');
  const u = rein(g.apiNachweiseUebersicht()).daten;
  if (u.zu_loeschen.length) {
    const z = u.zu_loeschen[0];
    const a = rein(g.apiNachweiseLoeschen([{ qualifikation_id: z.qualifikation_id, version: z.version }]));
    assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
    const q = objekte(f, 'Qualifikation').find(x => x.qualifikation_id === z.qualifikation_id);
    assert.ok(q.geloescht_am && !q.eingesehen_am && !q.eingesehen_durch);
    assert.strictEqual(rein(g.apiNachweiseLoeschen([{ qualifikation_id: z.qualifikation_id, version: q.version }])).fehler.art, 'fachlich');
  }
  // gültiges FZ ist nicht löschbar
  const gruen = u.personen.find(p => p.ampel === 'gruen' && p.fz);
  if (gruen) assert.strictEqual(rein(g.apiNachweiseLoeschen([{ qualifikation_id: gruen.fz.qualifikation_id, version: gruen.fz.version }])).fehler.art, 'fachlich');
  const fr = rein(g.apiNachweiseFristenAktualisieren());
  assert.strictEqual(fr.ok, true, JSON.stringify(fr.fehler));
  assert.strictEqual(rein(g.apiNachweiseFristenAktualisieren()).daten.geaendert, 0, 'idempotent');
  assert.strictEqual(rein(als('Abteilungsleiter', 1).g.apiNachweiseFristenAktualisieren()).fehler.art, 'zugriff');
});

test('Export protokolliert', () => {
  const { f, g } = als('Jugendleiter');
  const a = rein(g.apiNachweiseExport());
  assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
  assert.ok(objekte(f, '_Protokoll').some(p => p.aktion === 'exportiert'));
});
