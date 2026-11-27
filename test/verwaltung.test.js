/**
 * Tests für src/modul/Verwaltung.js und src/api/Verwaltung.js gegen die Fakes (synthetischer Verein, 300 Personen):
 * Benutzer & Rechte (Selbstschutz, Eindeutigkeit, Cache), Warnliste V10, Einstellungen (_Konfig) mit Validierung,
 * Stammdaten, Datenqualität, Hinweise, System.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const MV = 'verwaltung@tsv-ergoldsbach.de';
const KASSIER = 'kassier@tsv-ergoldsbach.de';
const AL = 'fussball@tsv-ergoldsbach.de';
const VEREIN = erzeugeVerein({ mitglieder: 300 });
function kopie(tabs) { const o = {}; Object.keys(tabs).forEach(t => { o[t] = tabs[t].map(z => z.slice()); }); return o; }
function aufbau(email, tabs) {
  const f = erzeugeFakes({ tabs: tabs || kopie(VEREIN.tabs), email: email || MV, eigentuemer: MV });
  return { f, g: ladeProjekt(f.globale) };
}
function objekte(f, tab) { const d = f.daten(tab); return d.slice(1).map(z => Object.fromEntries(d[0].map((k, i) => [k, z[i]]))); }
const ok = (a) => { assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return rein(a.daten); };
const fehler = (a, art) => { assert.strictEqual(a.ok, false); assert.strictEqual(a.fehler.art, art, JSON.stringify(a.fehler)); return rein(a.fehler); };

test('Benutzer: Liste mit Matrix, anlegen, Pflichtabteilung, Eindeutigkeit, Domain-Hinweis, Cache verworfen', () => {
  const { f, g } = aufbau();
  const l = ok(g.apiVerwaltungBenutzer());
  assert.strictEqual(l.benutzer.length, 6);
  assert.ok(l.matrix.Abteilungsleiter.aktionen.includes('qualifikation_erfassen'));
  const fe = fehler(rein(g.apiVerwaltungBenutzerSpeichern(null, null, { email: 'neu@tsv-ergoldsbach.de', rolle: 'Abteilungsleiter' })), 'fachlich');
  assert.ok(fe.felder.some(x => x.feld === 'abteilung_id'));
  fehler(rein(g.apiVerwaltungBenutzerSpeichern(null, null, { email: 'kein-email', rolle: 'Kassier' })), 'fachlich');
  const neu = ok(g.apiVerwaltungBenutzerSpeichern(null, null, { email: ' Neu@TSV-Ergoldsbach.de ', name: 'Neu', rolle: 'Abteilungsleiter', abteilung_id: 3 }));
  assert.strictEqual(neu.benutzer.email, 'neu@tsv-ergoldsbach.de');
  assert.strictEqual(neu.benutzer.aktiv, true);
  assert.strictEqual(neu.hinweis, null);
  fehler(rein(g.apiVerwaltungBenutzerSpeichern(null, null, { email: 'neu@tsv-ergoldsbach.de', rolle: 'Abteilungsleiter', abteilung_id: 3 })), 'fachlich');
  const fremd = ok(g.apiVerwaltungBenutzerSpeichern(null, null, { email: 'x@gmail.com', rolle: 'Kassier', abteilung_id: 2 }));
  assert.ok(fremd.hinweis && /Vereinsdomain/.test(fremd.hinweis));
  assert.ok(!fremd.benutzer.abteilung_id, 'Abteilung nur bei Abteilungsleitern');
  // Deaktivieren; der neue Zugang ist sofort wirksam (Benutzer-Cache verworfen)
  const n = ladeProjekt(erzeugeFakes({ tabs: (() => { const t = {}; f.datei.getSheets().forEach(b => { t[b.getName()] = f.daten(b.getName()); }); return t; })(), email: 'neu@tsv-ergoldsbach.de', eigentuemer: MV }).globale);
  assert.strictEqual(rein(n.apiStart()).ok, true);
  ok(g.apiVerwaltungBenutzerSpeichern(neu.benutzer.benutzer_id, neu.benutzer.version, { aktiv: false }));
  assert.strictEqual(objekte(f, 'Benutzer').find(b => b.email === 'neu@tsv-ergoldsbach.de').aktiv, 'nein');
  assert.ok(objekte(f, '_Protokoll').some(p => p.tabelle === 'Benutzer' && p.aktion === 'angelegt'));
});

test('Benutzer: Selbstschutz – letzte eigene Verwaltungsrolle kann nicht entzogen werden', () => {
  const { f, g } = aufbau();
  const ich = objekte(f, 'Benutzer').find(b => b.email === MV);
  const e = fehler(rein(g.apiVerwaltungBenutzerSpeichern(ich.benutzer_id, ich.version, { aktiv: false })), 'fachlich');
  assert.match(e.meldung, /selbst/);
  fehler(rein(g.apiVerwaltungBenutzerSpeichern(ich.benutzer_id, ich.version, { rolle: 'Kassier' })), 'fachlich');
});

test('Warnliste V10: Abteilungsleiter-Zugang ohne laufendes Amt wird gemeldet', () => {
  const tabs = kopie(VEREIN.tabs);
  const b = tabs.Benutzer; const iM = b[0].indexOf('mitglied_id'), iR = b[0].indexOf('rolle');
  const al = b.slice(1).find(z => z[iR] === 'Abteilungsleiter');
  const { g } = aufbau(MV, tabs);
  const vorher = ok(g.apiVerwaltungBenutzer()).warnungen.length;
  al[iM] = 2;   // Person ohne Amt
  const { g: g2 } = aufbau(MV, tabs);
  const nachher = ok(g2.apiVerwaltungBenutzer()).warnungen;
  assert.ok(nachher.length > vorher || nachher.some(w => w.rolle === 'Abteilungsleiter'));
});

test('Einstellungen: lesbar mit Typen, Validierung, Zähler gesperrt, Konflikt, Protokoll', () => {
  const { f, g } = aufbau();
  const k = ok(g.apiVerwaltungKonfig());
  const zaehler = k.find(x => x.schluessel === 'next_id_Mitglied');
  assert.strictEqual(zaehler.bearbeitbar, false);
  assert.strictEqual(k.find(x => x.schluessel === 'ehrung_zaehlweise').typ, 'auswahl');
  fehler(rein(g.apiVerwaltungKonfigSpeichern('next_id_Mitglied', '1', zaehler.wert)), 'fachlich');
  fehler(rein(g.apiVerwaltungKonfigSpeichern('mandat_verfall_monate', 'drei', '36')), 'fachlich');
  fehler(rein(g.apiVerwaltungKonfigSpeichern('verein_glaeubiger_id', 'DE00ZZZ00000000000', 'DE00ZZZ00000000000')), 'fachlich');
  fehler(rein(g.apiVerwaltungKonfigSpeichern('impressum_url', 'http://x.de', null)), 'fachlich');
  fehler(rein(g.apiVerwaltungKonfigSpeichern('ehrung_zaehlweise', 'gesamt', 'falscher_alter_wert')), 'konflikt');
  const r = ok(g.apiVerwaltungKonfigSpeichern('ehrung_zaehlweise', 'gesamt', 'letzter_eintritt'));
  assert.strictEqual(r.geaendert, true);
  assert.strictEqual(objekte(f, '_Konfig').find(x => x.schluessel === 'ehrung_zaehlweise').wert, 'gesamt');
  assert.strictEqual(g.Konfig.wert('ehrung_zaehlweise'), 'gesamt', 'Konfig-Cache verworfen');
  ok(g.apiVerwaltungKonfigSpeichern('sepa_faelligkeit', '01.03.', '15.02.'));
  // Jugendalter (Sicht Jugendleiter) einstellbar, mit Plausibilitätsgrenze
  const jugend = k.find(x => x.schluessel === 'jugend_bis_alter');
  assert.strictEqual(jugend.typ, 'zahl');
  fehler(rein(g.apiVerwaltungKonfigSpeichern('jugend_bis_alter', '30', jugend.wert)), 'fachlich');
  ok(g.apiVerwaltungKonfigSpeichern('jugend_bis_alter', '20', jugend.wert));
  assert.strictEqual(g.Konfig.wert('jugend_bis_alter'), '20');
  assert.ok(objekte(f, '_Protokoll').some(p => p.tabelle === '_Konfig' && p.datensatz_id === 'ehrung_zaehlweise' && p.neu_wert === 'gesamt'));
  // Kassier darf nicht
  fehler(rein(aufbau(KASSIER).g.apiVerwaltungKonfig()), 'zugriff');
});

test('Stammdaten: Liste, anlegen (aktiv vorbelegt), bearbeiten mit Version, unbekannter Tab abgelehnt', () => {
  const { f, g } = aufbau();
  const l = ok(g.apiVerwaltungStammdaten('Abteilung'));
  assert.strictEqual(l.zeilen.length, 5);
  const neu = ok(g.apiVerwaltungStammdatenSpeichern('Abteilung', null, null, { bezeichnung: 'Volleyball', blsv_sportart: 'Volleyball', meldepflichtig: true }));
  assert.strictEqual(neu.datensatz.aktiv, true);
  assert.ok(neu.aktualisiert.abteilungen.some(a => a.bezeichnung === 'Volleyball'), 'Snapshot write-through');
  const r = ok(g.apiVerwaltungStammdatenSpeichern('Abteilung', neu.datensatz.abteilung_id, neu.datensatz.version, { aktiv: false }));
  assert.strictEqual(r.datensatz.aktiv, false);
  const af = ok(g.apiVerwaltungStammdatenSpeichern('Aufbewahrungsfrist', null, null, { datenkategorie: 'Test', betrifft_tab: 'Mitglied', dauer_monate: 12, bezugspunkt: 'Austritt' }));
  assert.strictEqual(af.datensatz.datenkategorie, 'Test');
  fehler(rein(g.apiVerwaltungStammdaten('Benutzer')), 'fachlich');
  fehler(rein(aufbau(AL).g.apiVerwaltungStammdatenSpeichern('Abteilung', null, null, { bezeichnung: 'X' })), 'zugriff');
  assert.strictEqual(objekte(f, 'Abteilung').length, 6);
});

test('Datenqualität, Hinweise, System, Snapshot neu', () => {
  const tabs = erzeugeVerein({ mitglieder: 300, fehler: true }).tabs;
  const { g } = aufbau(MV, tabs);
  const p = ok(g.apiVerwaltungPruefregeln());
  assert.ok(p.befunde.length > 0 && p.zusammenfassung.fehler > 0);
  assert.ok(p.befunde.every(b => b.titel));
  const z = ok(g.apiVerwaltungPruefregelnZusammenfassung());
  assert.strictEqual(z.fehler, p.zusammenfassung.fehler);
  const h = ok(g.apiVerwaltungHinweise());
  assert.ok(h.some(x => /Gläubiger-ID/.test(x.text)), 'Platzhalter-Gläubiger-ID erkannt');
  const s = ok(g.apiVerwaltungSystem());
  assert.ok(s.zeilen.Mitglied > 0 && s.zeilen.Benutzer === 6);
  const n = ok(g.apiVerwaltungSnapshotNeu());
  assert.ok(n.snapshot_gebaut_am);
  fehler(rein(aufbau(KASSIER).g.apiVerwaltungPruefregeln()), 'zugriff');
});
