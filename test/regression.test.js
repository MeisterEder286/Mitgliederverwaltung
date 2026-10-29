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

// ================================================================== Abschnitt 7 des Prüfberichts (ohne Freigabe)

/** Fakes über veränderbare Tabs (Kopie) – für gezielt präparierte synthetische Fälle. */
function mitTabs(email, aendern, seed) {
  const verein = erzeugeVerein({ seed: seed || 3, mitglieder: 300 });
  const tabs = JSON.parse(JSON.stringify(verein.tabs));
  if (aendern) aendern(tabs, tab => alsObjekte({ [tab]: tabs[tab] })[tab]);
  const f = erzeugeFakes({ tabs, email, eigentuemer: MV });
  const g = ladeProjekt(f.globale);
  return { f, g, obj: tab => alsObjekte({ [tab]: f.daten(tab) })[tab] };
}
function setze(tabs, tab, idSpalte, id, felder) {
  const k = tabs[tab][0];
  const z = tabs[tab].slice(1).find(r => r[k.indexOf(idSpalte)] === id);
  Object.keys(felder).forEach(f => { z[k.indexOf(f)] = felder[f]; });
}
function emailMit(tabs, rolle, abt) {
  const b = tabs.Benutzer, k = b[0];
  return b.slice(1).find(z => z[k.indexOf('rolle')] === rolle && (!abt || z[k.indexOf('abteilung_id')] === abt))[k.indexOf('email')];
}

test('Mehrfachrollen: Kassier + Abteilungsleiter wird gewarnt, Vorstand + AL und AL + Jugendleiter nicht', () => {
  const { g } = beitragsdaten();
  const B = (email, rolle, abt) => ({ benutzer_id: email.length + rolle.length, email, rolle, abteilung_id: abt || null, aktiv: true });
  const w = rein(g.Rechte.mehrfachrollenWarnungen([
    B('kasse@x.de', 'Kassier'), B('KASSE@x.de ', 'Abteilungsleiter', 1),
    B('vorstand@x.de', 'Vorstand'), B('vorstand@x.de', 'Abteilungsleiter', 2),
    B('al@x.de', 'Abteilungsleiter', 1), B('al@x.de', 'Jugendleiter'),
    Object.assign(B('alt@x.de', 'Kassier'), {}), Object.assign(B('alt@x.de', 'Jugendleiter'), { aktiv: false })
  ]));
  assert.deepStrictEqual(w.map(x => x.email), ['kasse@x.de']);
  assert.deepStrictEqual(w[0].sicht, ['hochsensibel']);
  assert.match(w[0].meldung, /Kassier \+ Abteilungsleiter/);
  // Die Rechte selbst sind unverändert (nur Meldung)
  const ktx = rein(g.Rechte.kontext([B('kasse@x.de', 'Kassier'), B('kasse@x.de', 'Abteilungsleiter', 1)], 'kasse@x.de'));
  assert.ok(ktx.sicht.includes('hochsensibel') && ktx.zeilen === 'alle');
});

test('Mehrfachrollen: Warnung erscheint in der Benutzerverwaltung', () => {
  const u = mitTabs(MV, (tabs) => {
    const b = tabs.Benutzer, k = b[0];
    const kassier = b.slice(1).find(z => z[k.indexOf('rolle')] === 'Kassier');
    const neu = kassier.slice();
    neu[k.indexOf('benutzer_id')] = 9990; neu[k.indexOf('rolle')] = 'Jugendleiter'; neu[k.indexOf('abteilung_id')] = '';
    b.push(neu);
  });
  const w = ok(u.g.apiVerwaltungBenutzer()).warnungen.filter(x => x.art === 'mehrfachrolle');
  assert.strictEqual(w.length, 1);
  assert.match(w[0].rolle, /Kassier \+ Jugendleiter|Jugendleiter \+ Kassier/);
});

test('Berichte: Ein-/Austritte zeigen gesperrte Personen ohne Namen (Kassier), Mitgliederverwaltung namentlich', () => {
  let gesperrt = null;
  const vorbereiten = (tabs, obj) => {
    const z = obj('Mitgliedschaftszeitraum').find(x => x.eintrittsdatum >= '2020-01-01' && x.eintrittsdatum <= '2025-12-31');
    gesperrt = z.mitglied_id;
    setze(tabs, 'Mitglied', 'mitglied_id', gesperrt, { verarbeitung_eingeschraenkt: 'ja', sperre_grund: 'Test' });
  };
  const kasse = mitTabs('kassier@tsv-ergoldsbach.de', vorbereiten);
  const mvU = mitTabs(MV, vorbereiten);
  const k = ok(kasse.g.apiBerichteBewegungen('2020-01-01', '2025-12-31'));
  const m = ok(mvU.g.apiBerichteBewegungen('2020-01-01', '2025-12-31'));
  assert.strictEqual(k.eintraege.length, m.eintraege.length, 'gleiche Zählung');
  assert.ok(!k.eintraege.some(e => e.mitglied_id === gesperrt), 'keine ID der gesperrten Person');
  assert.ok(k.eintraege.some(e => e.name === 'Datensatz gesperrt' && e.mitgliedsnummer === null && e.grund === null));
  assert.ok(m.eintraege.some(e => e.mitglied_id === gesperrt && e.name !== 'Datensatz gesperrt'));
});

test('Nachweise: Abteilungsleiter kann einen Vermerk, den er nicht sieht, weder ändern noch löschen', () => {
  let qid = null;
  const u = mitTabs(null, (tabs, obj) => {
    // Person in Abteilung 1 OHNE laufende Funktion dort → Vermerke für den AL Fußball unsichtbar
    const fkt = obj('Funktion');
    const z = obj('Abteilungszugehoerigkeit').find(a => a.abteilung_id === 1 && !a.austrittsdatum &&
      !fkt.some(f => f.mitglied_id === a.mitglied_id && f.abteilung_id === 1));
    const q = tabs.Qualifikation, k = q[0];
    qid = 99001;
    const zeile = k.map(() => '');
    zeile[k.indexOf('qualifikation_id')] = qid; zeile[k.indexOf('mitglied_id')] = z.mitglied_id;
    zeile[k.indexOf('qualifikationsart_id')] = 2; zeile[k.indexOf('ausgestellt_am')] = '2025-03-01';
    zeile[k.indexOf('gueltig_bis')] = '2028-03-01'; zeile[k.indexOf('version')] = 1;
    q.push(zeile);
  }, 4);
  const al = (() => {
    const f = erzeugeFakes({ tabs: (() => { const t = {}; u.f.datei.getSheets().forEach(b => { t[b.getName()] = u.f.daten(b.getName()).map(z => z.slice()); }); return t; })(),
      email: emailMit({ Benutzer: u.f.daten('Benutzer') }, 'Abteilungsleiter', 1), eigentuemer: MV });
    return { f, g: ladeProjekt(f.globale) };
  })();
  const a = rein(al.g.apiNachweiseAendern(qid, 1, { bemerkung: 'geändert' }));
  assert.strictEqual(a.ok, false); assert.strictEqual(a.fehler.art, 'zugriff');
  const l = rein(al.g.apiNachweiseLoeschen([{ qualifikation_id: qid, version: 1 }]));
  assert.strictEqual(l.ok, false); assert.strictEqual(l.fehler.art, 'zugriff');
});

test('Beitritt: Fehler nach dem Schreiben → Wiedereintritt und Nummernzähler werden vollständig zurückgenommen', () => {
  const u = beitrittsUmgebung();
  const zr = u.obj('Mitgliedschaftszeitraum');
  const aus = u.obj('Mitglied').find(m => m.status === 'ausgetreten' && m.vorname && m.nachname && !m.sterbedatum &&
    zr.filter(z => z.mitglied_id === m.mitglied_id).every(z => z.austrittsdatum));
  const vorher = { m: aus, zr: zr.filter(z => z.mitglied_id === aus.mitglied_id).length, zug: JSON.stringify(u.obj('Abteilungszugehoerigkeit').filter(z => z.mitglied_id === aus.mitglied_id)),
    n: u.obj('_Konfig').find(k => k.schluessel === 'mitgliedsnummer_naechste').wert, konten: u.obj('Beitragskonto').length, mitglieder: u.obj('Mitglied').length };
  const orig = u.g.Snapshot.schreibe;
  u.g.Snapshot.schreibe = function () { throw new Error('erzwungen'); };
  const d = ok(u.g.apiBeitrittImportieren([xmlAntrag('w.xml', [
    { Anrede: 'Frau', Nachname: aus.nachname, Vorname: aus.vorname, GebDat: '', IBAN: 'DE02120300000000202051', Gesamtbeitrag: '100', 'Abteilung 1': 'Turnen' },
    { Anrede: 'Herr', Nachname: 'Neuling', Vorname: 'Kai', GebDat: '2015-03-03' }])], [{ index: 0, personen: { 0: 'wiedereintritt' } }]));
  u.g.Snapshot.schreibe = orig;
  assert.strictEqual(d.ergebnisse[0].ok, false);
  const nachher = u.obj('Mitglied').find(m => m.mitglied_id === aus.mitglied_id);
  ['status', 'beitragskonto_id', 'beitragsgemeinschaft_id', 'beitragsart_id'].forEach(f => assert.strictEqual(nachher[f], vorher.m[f], f));
  assert.strictEqual(u.obj('Mitgliedschaftszeitraum').filter(z => z.mitglied_id === aus.mitglied_id).length, vorher.zr);
  assert.strictEqual(u.obj('_Konfig').find(k => k.schluessel === 'mitgliedsnummer_naechste').wert, vorher.n, 'Zähler unverändert');
  assert.strictEqual(u.obj('Beitragskonto').length, vorher.konten);
  assert.strictEqual(u.obj('Mitglied').length, vorher.mitglieder);
  const zugNachher = u.obj('Abteilungszugehoerigkeit').filter(z => z.mitglied_id === aus.mitglied_id)
    .map(z => { const o = Object.assign({}, z); delete o.version; delete o.geaendert_am; delete o.geaendert_von; return o; });
  const zugVorher = JSON.parse(vorher.zug).map(z => { const o = Object.assign({}, z); delete o.version; delete o.geaendert_am; delete o.geaendert_von; return o; });
  assert.deepStrictEqual(zugNachher, zugVorher, 'wieder geöffnete Zugehörigkeit ist zurückgenommen');
});

test('Prüfregeln: überlappende/mehrfach offene Zeiträume, Ende vor Beginn, doppelte Funktion, fehlende Verweise', () => {
  const { g, daten } = ladeFachdaten();
  const d = kopie(daten);
  const id = d.Mitglied[0].mitglied_id;
  const art = d.Funktion[0].funktionsart_id;
  d.Mitgliedschaftszeitraum.push({ zeitraum_id: 9001, mitglied_id: id, eintrittsdatum: '2026-01-01', austrittsdatum: null });
  d.Mitgliedschaftszeitraum.push({ zeitraum_id: 9002, mitglied_id: 424242, eintrittsdatum: '2020-05-01', austrittsdatum: '2019-01-01' });
  d.Funktion.push({ funktion_id: 9101, mitglied_id: id, funktionsart_id: art, abteilung_id: d.Funktion[0].abteilung_id, von: '2024-01-01', bis: null },
    { funktion_id: 9102, mitglied_id: id, funktionsart_id: art, abteilung_id: d.Funktion[0].abteilung_id, von: '2025-01-01', bis: null },
    { funktion_id: 9103, mitglied_id: id, funktionsart_id: art, abteilung_id: d.Funktion[0].abteilung_id, zusatz: 'X', von: '2025-05-01', bis: '2025-01-01' });
  d.Sollstellung = (d.Sollstellung || []).concat([{ sollstellung_id: 9201, beitragskonto_id: 777777, jahr: 2026 }]);
  d.Notiz = [{ notiz_id: 9301, mitglied_id: 555555, beitragskonto_id: null }];
  d.Benutzer = [{ benutzer_id: 9401, email: 'x@y.de', mitglied_id: 666666, rolle: 'Kassier', aktiv: true }];
  const b = kopie(g.Pruefregeln.pruefe(d, '2026-10-25', {}));
  const hat = (regel, tab, rid) => b.some(x => x.regel === regel && x.tab === tab && (rid === undefined || x.id === rid));
  assert.ok(hat('zeitraum_ueberlappung', 'Mitgliedschaftszeitraum'), 'zweiter offener Zeitraum');
  assert.ok(hat('datum_reihenfolge', 'Mitgliedschaftszeitraum', 9002));
  assert.ok(hat('verweis_ungueltig', 'Mitgliedschaftszeitraum', 9002));
  assert.ok(hat('funktion_doppelt', 'Funktion', 9102));
  assert.ok(hat('datum_reihenfolge', 'Funktion', 9103));
  assert.ok(hat('verweis_ungueltig', 'Sollstellung', 9201));
  assert.ok(hat('verweis_ungueltig', 'Notiz', 9301));
  assert.ok(hat('verweis_ungueltig', 'Benutzer', 9401));
  Object.keys(g.Pruefregeln.REGELN).forEach(r => assert.ok(g.Pruefregeln.REGELN[r].titel));
});

test('neueId: von Hand eingefügte Zeile mit der nächsten ID → keine doppelte ID beim Anlegen', () => {
  const u = als(MV);
  const zaehler = Number(u.obj('_Konfig').find(k => k.schluessel === 'next_id_Notiz').wert);
  // Zeile „von Hand“ mit genau der ID, die der Zähler als Nächstes vergeben würde
  const blatt = u.f.datei.getSheetByName('Notiz');
  const kopf = u.f.daten('Notiz')[0];
  blatt.appendRow(kopf.map(h => h === 'notiz_id' ? zaehler : h === 'art' ? 'Notiz' : h === 'text' ? 'von Hand' : h === 'sichtbar_fuer' ? 'Verwaltung' : ''));
  const neu = rein(u.g.DB.mitSperre(() => u.g.DB.einfuegen('Notiz', { art: 'Notiz', text: 'per Skript', sichtbar_fuer: 'Verwaltung', erstellt_von: MV }, { email: MV })));
  assert.ok(neu.notiz_id > zaehler, 'ID ' + neu.notiz_id + ' liegt über der von Hand vergebenen ' + zaehler);
  const ids = u.obj('Notiz').map(n => n.notiz_id);
  assert.strictEqual(new Set(ids).size, ids.length, 'IDs eindeutig');
});

test('Lesen über die Sheets-API innerhalb der Sperre: vorher SpreadsheetApp.flush()', () => {
  const u = als(MV);
  const folge = [];
  const flush = u.f.globale.SpreadsheetApp.flush;
  const batchGet = u.f.globale.Sheets.Spreadsheets.Values.batchGet;
  u.f.globale.SpreadsheetApp.flush = function () { folge.push('flush'); return flush.apply(this, arguments); };
  u.f.globale.Sheets.Spreadsheets.Values.batchGet = function () { folge.push('batchGet'); return batchGet.apply(this, arguments); };
  u.g.DB.mitSperre(() => {
    u.g.DB.einfuegen('Notiz', { art: 'Notiz', text: 'a', sichtbar_fuer: 'Verwaltung', erstellt_von: MV }, { email: MV });
    u.g.DB.vorratLeeren();
    u.g.DB.lese(['Notiz']);
  });
  const i = folge.lastIndexOf('batchGet');
  assert.ok(i > 0 && folge[i - 1] === 'flush', folge.join(' → '));
});

// ================================================================== Weitere 🔵-Punkte des Prüfberichts

function zeile(tabs, tab, werte) {
  const k = tabs[tab][0];
  tabs[tab].push(k.map(h => (h in werte ? werte[h] : '')));
}

test('Austritt rückwirkend vor Spartenbeginn: Zugehörigkeit endet an ihrem Beginn, nie davor', () => {
  let ziel = null;
  const u = mitTabs(MV, (tabs, obj) => {
    // Person ohne Konto (kein Konto-Guard), laufende Mitgliedschaft; Sparte beginnt später als der Austritt
    const zr = obj('Mitgliedschaftszeitraum');
    const m = obj('Mitglied').find(x => x.status === 'aktiv' && !x.sterbedatum && !obj('Beitragskonto').some(k => k.kontoinhaber_mitglied_id === x.mitglied_id) &&
      zr.some(z => z.mitglied_id === x.mitglied_id && !z.austrittsdatum && !z.austritt_wirksam && z.eintrittsdatum < '2025-01-01'));
    ziel = m.mitglied_id;
    zeile(tabs, 'Abteilungszugehoerigkeit', { zugehoerigkeit_id: 99501, mitglied_id: ziel, abteilung_id: 4, status: 'aktiv', eintrittsdatum: '2026-06-01', version: 1 });
  });
  ok(u.g.apiMitgliedAustritt(ziel, { austritt_wirksam: '2026-03-31', austrittsgrund: 'Umzug' }));
  const z = u.obj('Abteilungszugehoerigkeit').find(x => x.zugehoerigkeit_id === 99501);
  assert.strictEqual(z.austrittsdatum, '2026-06-01');
  assert.ok(!u.obj('Abteilungszugehoerigkeit').some(x => x.mitglied_id === ziel && x.austrittsdatum && x.eintrittsdatum && x.austrittsdatum < x.eintrittsdatum));
});

test('Cache: schlägt das Speichern fehl, wird der alte Stand verworfen statt weiter ausgeliefert', () => {
  const f = erzeugeFakes({ tabs: {} });
  const g = ladeProjekt(f.globale);
  g.Cache.speichere('t', { stand: 'alt' }, 600);
  assert.deepStrictEqual(rein(g.Cache.lade('t')), { stand: 'alt' });
  const original = f.globale.CacheService.getScriptCache;
  f.globale.CacheService.getScriptCache = () => Object.assign({}, original(), {
    putAll: () => { throw new Error('Kontingent erschöpft'); },
    remove: k => original().remove(k)
  });
  assert.strictEqual(g.Cache.speichere('t', { stand: 'neu' }, 600), 0);
  f.globale.CacheService.getScriptCache = original;
  assert.strictEqual(g.Cache.lade('t'), null, 'kein veralteter Stand');
});

test('Funktion eintragen: dieselbe laufende Funktion ein zweites Mal wird abgelehnt (Doppelklick)', () => {
  const u = als(MV);
  const art = u.obj('Funktionsart').find(a => a.ebene === 'Abteilung' && a.aktiv !== false);
  const m = u.obj('Mitglied').find(x => x.status === 'aktiv' && !x.sterbedatum);
  const werte = { mitglied_id: m.mitglied_id, funktionsart_id: art.funktionsart_id, abteilung_id: 2, zusatz: 'E-Jugend', von: '2026-09-01' };
  ok(u.g.apiFunktionEintragen(werte));
  const f = fehler(u.g.apiFunktionEintragen(Object.assign({}, werte, { zusatz: ' e-jugend ' })));
  assert.match(f.meldung, /bereits eingetragen/);
  ok(u.g.apiFunktionEintragen(Object.assign({}, werte, { zusatz: 'D-Jugend' })));   // andere Mannschaft geht
  assert.strictEqual(u.obj('Funktion').filter(x => x.mitglied_id === m.mitglied_id && x.funktionsart_id === art.funktionsart_id && x.von === '2026-09-01').length, 2);
});

test('Benutzer: gleiche E-Mail in anderer Schreibweise gilt als derselbe Zugang (Eindeutigkeit)', () => {
  const u = als(MV);
  const b = u.obj('Benutzer').find(x => x.rolle === 'Kassier');
  assert.throws(() => u.g.DB.mitSperre(() => u.g.DB.einfuegen('Benutzer',
    { email: ' ' + b.email.toUpperCase(), rolle: 'Kassier', name: 'Doppelt', aktiv: true }, { email: MV })), e => e.art === 'fachlich');
  assert.throws(() => u.g.DB.mitSperre(() => u.g.DB.einfuegenViele('Benutzer',
    [{ email: b.email.toUpperCase(), rolle: 'Kassier', name: 'Doppelt', aktiv: true }], { email: MV })), e => e.art === 'fachlich');
  const { g } = ladeFachdaten();
  const befunde = rein(g.Pruefregeln.pruefe({ Benutzer: [
    { benutzer_id: 1, email: 'a@x.de', rolle: 'Kassier', abteilung_id: null }, { benutzer_id: 2, email: 'A@X.de', rolle: 'Kassier', abteilung_id: null }] }, '2026-10-25', {}));
  assert.ok(befunde.some(x => x.regel === 'eindeutigkeit' && x.tab === 'Benutzer'));
});

test('Dublettenprüfung: zerlegte Umlaute (NFD) und Akzente werden wie die zusammengesetzte Schreibweise gefaltet', () => {
  const { g } = ladeFachdaten();
  assert.strictEqual(g.Migration.falte('Müller'), g.Migration.falte('Müller'));
  assert.strictEqual(g.Migration.falte('Müller'), 'mueller');
  assert.strictEqual(g.Migration.falte('René'), g.Migration.falte('Rene'));
  // Mitglieder: Dubletten-Suche beim Anlegen
  const u = als(MV);
  const m = u.obj('Mitglied').find(x => /[äöü]/.test(x.nachname || '') && x.geburtsdatum && !x.anonymisiert);
  assert.ok(m, 'Testdaten: kein Nachname mit Umlaut');
  const d = ok(u.g.apiMitgliedDublettenPruefen(m.nachname.normalize('NFD'), m.geburtsdatum));
  assert.ok(d.some(x => x.mitglied_id === m.mitglied_id));
});

test('Migration: Jahreszahl „1985“ wird nicht als Seriennummer (1905) gelesen', () => {
  const { g } = ladeFachdaten();
  const r = rein(g.Migration.datum('1985'));
  assert.strictEqual(r.wert, null);
  assert.match(r.fehler, /Jahreszahl/);
  assert.strictEqual(rein(g.Migration.datum('29221')).wert, '1980-01-01', 'echte Seriennummer bleibt lesbar');
  assert.strictEqual(rein(g.Migration.datum('14.03.1985')).wert, '1985-03-14');
});

test('CSV-Formelschutz: auch Tab und Wagenrücklauf am Zellanfang', () => {
  const { g } = ladeFachdaten();
  const csv = g.Blsv.csv({ sportarten: [{ sportart: '\t=1+1' }, { sportart: '\r=2' }], verein: {} });
  assert.ok(csv.includes("'\t=1+1"), 'Tab geschützt');
  assert.ok(csv.includes("\"'\r=2\""), 'CR geschützt und gequotet');
});

test('Notizen nur am Konto: beim Konto-Leeren entfernt; erledigte zu geleerten Konten in der Fristbereinigung', () => {
  const u = mitTabs(MV, (tabs) => {
    const id = 99601;
    zeile(tabs, 'Beitragskonto', { beitragskonto_id: id, kontoinhaber_name: 'Alt, Zahler', zahlweg: 'Lastschrift', iban: 'DE89370400440532013000',
      mandatsreferenz: 'TSV-ALT-1', mandatsdatum: '2015-01-10', aktiv: 'ja', version: 1 });
    zeile(tabs, 'Beitragskonto', { beitragskonto_id: id + 1, kontoinhaber_name: 'Geleert', zahlweg: 'Lastschrift', aktiv: 'nein', version: 1 });
    zeile(tabs, 'Notiz', { notiz_id: 99701, beitragskonto_id: id, art: 'Notiz', text: 'Zahler bittet um …', sichtbar_fuer: 'Finanzen', version: 1 });
    zeile(tabs, 'Notiz', { notiz_id: 99702, beitragskonto_id: id + 1, art: 'Notiz', text: 'erledigt', sichtbar_fuer: 'Finanzen', erledigt_am: '2020-01-01', version: 1 });
    zeile(tabs, 'Notiz', { notiz_id: 99703, beitragskonto_id: id + 1, art: 'Notiz', text: 'offen', sichtbar_fuer: 'Finanzen', version: 1 });
  });
  ok(u.g.apiDatenschutzKontoLeeren(99601, 1));
  const ids = () => u.obj('Notiz').map(n => n.notiz_id);
  assert.ok(!ids().includes(99701), 'Notiz zum geleerten Konto entfernt');
  rein(u.g.Notizen.fristBereinigung('2026-10-25'));
  assert.ok(!ids().includes(99702), 'erledigte Notiz zum geleerten Konto entfernt');
  assert.ok(ids().includes(99703), 'offene Notiz bleibt');
});

test('Setup meldet abweichende Zeitzone der Tabelle (ändert sie nicht)', () => {
  const eigen = 'verwaltung@tsv-ergoldsbach.de';
  const f = erzeugeFakes({ tabs: {}, email: eigen, eigentuemer: eigen, tabellenZeitzone: 'Etc/UTC' });
  const bericht = String(ladeProjekt(f.globale).setup());
  assert.match(bericht, /ACHTUNG Zeitzone.*Etc\/UTC.*Europe\/Berlin/s);
  const f2 = erzeugeFakes({ tabs: {}, email: eigen, eigentuemer: eigen });
  assert.doesNotMatch(String(ladeProjekt(f2.globale).setup()), /ACHTUNG Zeitzone/);
});

test('tagImJahr: Tag wird am Monatsende gekappt (kein 29.02. in Nicht-Schaltjahren)', () => {
  const { g } = beitragsdaten();
  assert.strictEqual(g.Beitrag.tagImJahr('29.02.', 2026), '2026-02-28');
  assert.strictEqual(g.Beitrag.tagImJahr('29.02.', 2028), '2028-02-29');
  assert.strictEqual(g.Beitrag.tagImJahr('31.04.', 2027), '2027-04-30');
  assert.strictEqual(g.Beitrag.tagImJahr('15.02.', 2027), '2027-02-15');
  assert.strictEqual(g.Beitrag.tagImJahr('15.13.', 2027), '2027-01-01', 'ungültiger Monat → Jahresanfang wie bisher bei Unlesbarem');
});

test('Aufnahmeanträge: Teil der Auskunft und bei der Anonymisierung entfernt – fremde Dubletten-Hinweise bleiben', () => {
  const { g, daten, konfig } = ladeFachdaten();
  const d = kopie(daten);
  d.Mitgliedschaftszeitraum.push({ zeitraum_id: 9801, mitglied_id: 14, eintrittsdatum: '1999-01-01', austrittsdatum: '2010-12-31', aufnahmeantrag_id: 502 });
  d.Aufnahmeantrag = [
    { antrag_id: 501, mitglied_id: 14, vorname: 'Probe', nachname: 'Antrag', status: 'übernommen' },
    { antrag_id: 502, mitglied_id: null, vorname: 'Früher', nachname: 'Antrag', status: 'übernommen' },
    { antrag_id: 503, mitglied_id: null, dublette_mitglied_id: 14, vorname: 'Andere', nachname: 'Person', status: 'abgelehnt' }
  ];
  const m = d.Mitglied.find(x => x.mitglied_id === 14);
  const plan = kopie(g.Loeschung.anonymisierePlan(m, d, konfig || {}));
  assert.deepStrictEqual((plan.entfernen.Aufnahmeantrag || []).sort(), [501, 502]);
  const a = kopie(g.Loeschung.auskunft(14, d));
  const abschnitt = a.abschnitte.find(x => x.titel === 'Aufnahmeanträge');
  assert.ok(abschnitt, 'Abschnitt Aufnahmeanträge');
  assert.strictEqual(abschnitt.eintraege.length, 2);
});
