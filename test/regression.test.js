/**
 * Regressionstests zu Befunden der Code-Prüfung 10/2026 (nur synthetische Daten).
 * Jeder Test hält eine bestehende Regel fest, die an einer Stelle nicht durchgesetzt war:
 *   - Mitglieder: „eine Gemeinschaft = ein Konto“ auch beim Bearbeiten; Datenschutz-Felder nicht per Anlegen;
 *     Wiedereintritt schreibt nichts, wenn eine Abteilung nicht zugeordnet werden kann.
 *   - Beitritt: kein Wiedereintritt für Verstorbene; ungültiges Eintrittsdatum → Antrag abgelehnt.
 *   - Fristen: FZ-Löschdatum frisch gerechnet (Funktion nach Einsicht eingetragen).
 *   - SEPA: Einzugsdatum in der Vergangenheit, Mandatsverfall zum Einzugsdatum, Ländercode der Adresse.
 *   - Sollstellung: Storno-Grund bleibt bei langer Bemerkung erhalten.
 *   - Anonymisierung: E-Mail-Adresse im Anschreiben und Ausbildungsangaben werden geleert.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein, alsObjekte } = require('./daten/generator');
const { beitragsdaten } = require('./hilfe/beitragsdaten');
const { ladeFachdaten, kopie } = require('./hilfe/fachdaten');

const MV = 'verwaltung@tsv-ergoldsbach.de';
const GLAEUBIGER = {
  name: 'TSV Ergoldsbach e. V.', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', glaeubigerId: 'DE98ZZZ09999999999',
  adresse: { strasse: 'Sportplatzweg', hausnummer: '1', plz: '84061', ort: 'Ergoldsbach', land: 'DE' }
};

function als(email, seed) {
  const verein = erzeugeVerein({ seed: seed || 3, mitglieder: 300 });
  const f = erzeugeFakes({ tabs: verein.tabs, email, eigentuemer: MV });
  const g = ladeProjekt(f.globale);
  return { f, g, obj: tab => alsObjekte({ [tab]: f.daten(tab) })[tab] };
}
function ok(a) { a = rein(a); assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return a.daten; }
function fehler(a) { a = rein(a); assert.strictEqual(a.ok, false, 'Fehler erwartet'); return a.fehler; }

// ------------------------------------------------------------------ Mitglieder

test('Bearbeiten: Mitglied einer Gemeinschaft kann nicht auf ein anderes Konto gelegt werden', () => {
  const u = als(MV);
  const mitglieder = u.obj('Mitglied');
  const inGem = mitglieder.find(m => m.beitragsgemeinschaft_id && m.beitragskonto_id &&
    mitglieder.some(x => x.mitglied_id !== m.mitglied_id && x.beitragsgemeinschaft_id === m.beitragsgemeinschaft_id));
  assert.ok(inGem, 'Testdaten: keine Gemeinschaft mit zwei Mitgliedern');
  const anderes = u.obj('Beitragskonto').find(k => k.beitragskonto_id !== inGem.beitragskonto_id);
  const f = fehler(u.g.apiMitgliedSpeichern(inGem.mitglied_id, inGem.version, { beitragskonto_id: anderes.beitragskonto_id }));
  assert.strictEqual(f.felder[0].feld, 'beitragskonto_id');
  assert.strictEqual(u.obj('Mitglied').find(m => m.mitglied_id === inGem.mitglied_id).beitragskonto_id, inGem.beitragskonto_id, 'nichts gespeichert');
  // Andere Felder bleiben normal änderbar
  ok(u.g.apiMitgliedSpeichern(inGem.mitglied_id, inGem.version, { ort: 'Neufahrn' }));
});

test('Anlegen: Datenschutz-Felder (anonymisiert, Sperre) lassen sich nicht mitgeben', () => {
  const u = als(MV);
  const d = ok(u.g.apiMitgliedAnlegen({
    mitglied: { vorname: 'Theo', nachname: 'Probemann', geburtsdatum: '1990-05-06', beitragsart_id: 1,
      anonymisiert: true, verarbeitung_eingeschraenkt: true, sperre_grund: 'x', loeschbar_ab: '2027-01-01' },
    eintrittsdatum: '2026-10-01'
  }));
  const m = u.obj('Mitglied').find(x => x.mitglied_id === d.mitglied_id);
  assert.ok(!m.anonymisiert && !m.verarbeitung_eingeschraenkt && !m.sperre_grund && !m.loeschbar_ab);
});

test('Wiedereintritt: unbekannte Abteilung → Fehler und KEIN neuer Zeitraum (vorher Zeitraum ohne Abteilung)', () => {
  const u = als(MV);
  const zr = u.obj('Mitgliedschaftszeitraum');
  const aus = u.obj('Mitglied').find(m => m.status === 'ausgetreten' && !m.sterbedatum &&
    !zr.some(z => z.mitglied_id === m.mitglied_id && (!z.austrittsdatum || z.austrittsdatum > '2026-10-25')));
  const vorher = zr.filter(z => z.mitglied_id === aus.mitglied_id).length;
  fehler(u.g.apiMitgliedWiedereintritt(aus.mitglied_id, { eintrittsdatum: '2026-10-25', abteilungen: [{ abteilung_id: 999 }] }));
  assert.strictEqual(u.obj('Mitgliedschaftszeitraum').filter(z => z.mitglied_id === aus.mitglied_id).length, vorher);
  // zweiter Versuch mit gültiger Abteilung legt genau EINEN Zeitraum an
  ok(u.g.apiMitgliedWiedereintritt(aus.mitglied_id, { eintrittsdatum: '2026-10-25', abteilungen: [{ abteilung_id: 3 }] }));
  const offen = u.obj('Mitgliedschaftszeitraum').filter(z => z.mitglied_id === aus.mitglied_id && !z.austrittsdatum && !z.austritt_wirksam);
  assert.strictEqual(offen.length, 1);
});

// ------------------------------------------------------------------ Beitritt

function xmlAntrag(datei, personen) {
  return { datei, personen: personen.map(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k.replace(/ /g, '_x0020_'), String(v)]))) };
}
function beitrittsUmgebung() {
  const v = erzeugeVerein({ seed: 5, mitglieder: 300 });
  const k = v.tabs.Benutzer[0];
  const z = v.tabs.Benutzer.slice(1).find(r => r[k.indexOf('rolle')] === 'Mitgliederverwalter');
  const f = erzeugeFakes({ tabs: v.tabs, email: z[k.indexOf('email')] });
  const g = ladeProjekt(f.globale);
  return { g, obj: tab => alsObjekte({ [tab]: f.daten(tab) })[tab] };
}

test('Beitritt: ungültiges Eintrittsdatum → Antrag abgelehnt, keine Person ohne Mitgliedschaftszeitraum', () => {
  const u = beitrittsUmgebung();
  const vorher = u.obj('Mitglied').length;
  const d = ok(u.g.apiBeitrittImportieren([xmlAntrag('datum.xml', [{ Anrede: 'Herr', Nachname: 'Datumsfehler', Vorname: 'Karl',
    GebDat: '1980-01-01', EinDat: '31.02.2026', Gesamtbeitrag: '100' }])], []));
  assert.strictEqual(d.ergebnisse[0].ok, false);
  assert.match(d.ergebnisse[0].grund, /Eintrittsdatum/);
  assert.strictEqual(u.obj('Mitglied').length, vorher);
});

test('Beitritt: Wiedereintritt einer verstorbenen Person wird abgelehnt', () => {
  const u = beitrittsUmgebung();
  const tot = u.obj('Mitglied').find(m => m.sterbedatum && m.vorname && m.nachname && !m.anonymisiert);
  assert.ok(tot, 'Testdaten: keine verstorbene Person');
  const zrVorher = u.obj('Mitgliedschaftszeitraum').filter(z => z.mitglied_id === tot.mitglied_id).length;
  const d = ok(u.g.apiBeitrittImportieren([xmlAntrag('tot.xml', [{ Anrede: 'Herr', Nachname: tot.nachname, Vorname: tot.vorname,
    GebDat: tot.geburtsdatum || '', Gesamtbeitrag: '100' }])], [{ index: 0, personen: { 0: 'wiedereintritt' } }]));
  assert.strictEqual(d.ergebnisse[0].ok, false);
  assert.match(d.ergebnisse[0].grund, /verstorben/);
  assert.strictEqual(u.obj('Mitgliedschaftszeitraum').filter(z => z.mitglied_id === tot.mitglied_id).length, zrVorher);
});

// ------------------------------------------------------------------ Fristen

test('FZ-Löschdatum: nach der Einsicht eingetragene Funktion macht den Vermerk sofort nicht löschbar', () => {
  const { g, daten } = ladeFachdaten();
  const FZ = { qualifikationsart_id: 1, kategorie: 'Führungszeugnis', loeschfrist_monate: 3 };
  // Person 1 hat keine pflichtige Funktion: beim Erfassen wurde zu_loeschen_ab = heute gespeichert
  const q = { mitglied_id: 1, zu_loeschen_ab: '2026-10-01' };
  assert.strictEqual(g.Fristen.loeschdatum(q, daten, FZ, '2026-10-25'), '2026-10-25');
  // jetzt läuft eine pflichtige Funktion (Art wie bei Person 6)
  const art = daten.Funktion.find(f => f.mitglied_id === 6 && !f.bis).funktionsart_id;
  daten.Funktion.push({ funktion_id: 9999, mitglied_id: 1, funktionsart_id: art, von: '2026-10-20', bis: null });
  assert.strictEqual(g.Fristen.loeschdatum(q, daten, FZ, '2026-10-25'), null);
  // gespeicherter Wert ist Untergrenze: nie früher löschbar als bisher
  assert.strictEqual(g.Fristen.loeschdatum({ mitglied_id: 2, zu_loeschen_ab: '2027-03-01' }, daten, FZ, '2026-10-25') >= '2027-03-01', true);
});

// ------------------------------------------------------------------ SEPA

function laufDaten() {
  const { g, d } = beitragsdaten({ gueltigeIbans: true });
  const plan = g.Sollstellungslauf.plane(d, 2027, '2026-10-25');
  plan.neu.forEach((s, i) => { s.sollstellung_id = 100 + i; d.Sollstellung.push(s); });
  return { g, d };
}

test('SEPA: Datei mit Einzugsdatum in der Vergangenheit wird nicht erzeugt', () => {
  const { g, d } = laufDaten();
  const l = g.Sepa.lauf(d, 2027, { heute: '2027-04-20' });   // Fälligkeit 15.02.2027 liegt zurück
  assert.ok(l.posten.length && l.posten.every(p => p.einzugsdatum < '2027-04-20'));
  const x = rein(g.Sepa.xml(l, GLAEUBIGER, { heute: '2027-04-20' }));
  assert.strictEqual(x.ok, false);
  assert.match(x.fehler.join(' '), /Vergangenheit/);
  // mit neuem Einzugsdatum geht es
  const l2 = g.Sepa.lauf(d, 2027, { heute: '2027-04-20', einzugsdatum: '2027-05-05' });
  assert.strictEqual(rein(g.Sepa.xml(l2, GLAEUBIGER, { heute: '2027-04-20' })).ok, true);
});

test('SEPA: Mandatsverfall wird zum Einzugsdatum geprüft, nicht zum Erstellungstag', () => {
  const { g, d } = laufDaten();
  const k = d.Beitragskonto.find(x => x.beitragskonto_id === 4);
  d.Sollstellung = d.Sollstellung.filter(s => !(s.beitragskonto_id === 4 && s.jahr < 2027));
  k.mandatsdatum = '2024-01-20';   // nie genutzt → verfällt am 2027-01-20
  const vorVerfall = rein(g.Sepa.lauf(d, 2027, { heute: '2027-01-10', einzugsdatum: '2027-01-15' }));
  assert.ok(vorVerfall.posten.some(p => p.konto === 4), 'Einzug vor dem Verfall');
  const nachVerfall = rein(g.Sepa.lauf(d, 2027, { heute: '2027-01-10', einzugsdatum: '2027-02-15' }));
  assert.ok(!nachVerfall.posten.some(p => p.konto === 4), 'Einzug nach dem Verfall');
  assert.match(nachVerfall.ausgeschlossen.find(a => a.konto_id === 4).grund, /verfallen/);
});

test('SEPA: Land als Freitext („Österreich“) ergibt keine ungültige Ctry, sondern keine Adresse', () => {
  const { g, d } = laufDaten();
  const l = g.Sepa.lauf(d, 2027, { heute: '2026-10-25' });
  l.posten[0].adresse = { strasse: 'Hauptstraße', hausnummer: '1', plz: '5020', ort: 'Salzburg', land: 'Österreich' };
  l.posten[1].adresse = { strasse: 'Hauptstraße', hausnummer: '2', plz: '5020', ort: 'Salzburg', land: 'at' };
  const x = rein(g.Sepa.xml(l, GLAEUBIGER, { heute: '2026-10-25' }));
  assert.strictEqual(x.ok, true);
  assert.ok(!/<Ctry>(?!DE|AT)/.test(x.xml), 'nur gültige Ländercodes');
  assert.ok(x.xml.includes('<Ctry>AT</Ctry>'));
  assert.strictEqual(g.Sepa.adresseVollstaendig(l.posten[0].adresse), false);
});

// ------------------------------------------------------------------ Sollstellung

test('Storno: Grund bleibt bei langer Bemerkung erhalten, Länge höchstens 500', () => {
  const { g } = beitragsdaten();
  const a = g.Sollstellungslauf.naechsterStatus({ status: 'offen', bemerkung: 'x'.repeat(498) }, { art: 'storniert', grund: 'falscher Tarif' });
  assert.ok(a.bemerkung.length <= 500);
  assert.match(a.bemerkung, /Storniert: falscher Tarif$/);
  const kurz = g.Sollstellungslauf.naechsterStatus({ status: 'offen', bemerkung: 'Familie 180,00' }, { art: 'storniert', grund: 'Doppelt' });
  assert.strictEqual(kurz.bemerkung, 'Familie 180,00 · Storniert: Doppelt');
});

// ------------------------------------------------------------------ Anonymisierung

test('Anonymisierung: E-Mail-Adresse im Anschreiben und Ausbildungsangaben werden geleert', () => {
  const { g, daten, konfig } = ladeFachdaten();
  const d = kopie(daten);
  d.Anschreiben = [{ anschreiben_id: 1, mitglied_id: 14, inhalt: 'Text', empfaenger: 'X', email_an: 'person@example.org', betreff: 'Austritt' }];
  const m = d.Mitglied.find(x => x.mitglied_id === 14);
  m.ausbildung_art = 'Studium'; m.ausbildung_bis = '2028-09-30';
  const plan = kopie(g.Loeschung.anonymisierePlan(m, d, konfig || {}));
  assert.strictEqual(plan.aenderungen.Anschreiben[0].felder.email_an, null);
  const mf = plan.aenderungen.Mitglied.find(x => x.id === 14).felder;
  assert.strictEqual(mf.ausbildung_art, null);
  assert.strictEqual(mf.ausbildung_bis, null);
  assert.strictEqual(mf.ausbildung_nachweis_am, null);
});
