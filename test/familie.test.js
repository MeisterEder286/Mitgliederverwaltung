/**
 * Tests für src/lib/familie.js und src/modul/Familie.js (+ API): wer fällt aus dem Familienbeitrag heraus,
 * Verlängerung bei Schule/Studium/Ausbildung, Prognose, Umstellung auf Einzelbeitrag, Zahlungshistorie,
 * Halbjahresbeitrag (lib/beitrag.js), Nachlauf/Rechnungen/Jahresübersicht in Finanzen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes, isoZuSerial } = require('./hilfe/gas-fakes');
const { erzeugeVerein, alsObjekte } = require('./daten/generator');

const HEUTE = '2026-10-25';
const g0 = ladeProjekt({});
const KONFIG = { familie_kinder_bis_alter: '17', familie_ausbildung_bis_alter: '25', familie_umstellung_stichtag: '01.01.', ausbildungsnachweis_vorlauf_monate: '2' };

/** Kleine Familie: Vater (Inhaber), Mutter, Kinder mit wählbarem Geburtsdatum/Ausbildung. */
function familie(kinder) {
  const d = {
    Beitragsart: [
      { beitragsart_id: 1, bezeichnung: 'Erwachsene', betrag: 100, alter_von: 18, alter_bis: null, aktiv: true },
      { beitragsart_id: 2, bezeichnung: 'Jugendliche bis 18', betrag: 45, alter_von: 0, alter_bis: 17, aktiv: true },
      { beitragsart_id: 3, bezeichnung: 'Fördermitglied', betrag: 50, alter_von: null, alter_bis: null, aktiv: true }
    ],
    Beitragsgemeinschaft: [{ beitragsgemeinschaft_id: 1, bezeichnung: 'Familie Huber', festbetrag: 180, aktiv: true }],
    Beitragskonto: [{ beitragskonto_id: 1, kontoinhaber_name: 'Huber, Max', kontoinhaber_mitglied_id: 1, zahlweg: 'Lastschrift', aktiv: true }],
    Mitglied: [
      { mitglied_id: 1, vorname: 'Max', nachname: 'Huber', geburtsdatum: '1975-03-01', beitragskonto_id: 1, beitragsgemeinschaft_id: 1, version: 1 },
      { mitglied_id: 2, vorname: 'Eva', nachname: 'Huber', geburtsdatum: '1977-06-01', beitragskonto_id: 1, beitragsgemeinschaft_id: 1, version: 1 }
    ],
    Mitgliedschaftszeitraum: [], Sollstellung: []
  };
  kinder.forEach((k, i) => d.Mitglied.push(Object.assign({ mitglied_id: 10 + i, vorname: 'Kind' + i, nachname: 'Huber', beitragskonto_id: 1, beitragsgemeinschaft_id: 1, version: 1 }, k)));
  d.Mitglied.forEach(m => d.Mitgliedschaftszeitraum.push({ zeitraum_id: m.mitglied_id, mitglied_id: m.mitglied_id, eintrittsdatum: '2010-01-01' }));
  return d;
}
function eintrag(r, id) { return rein(r).eintraege.find(e => e.mitglied_id === id); }

test('Kind 17 → 18 fällt zum 01.01. heraus, Vorschlag Erwachsenenbeitrag, gleiches Konto', () => {
  const d = familie([{ geburtsdatum: '2008-05-10' }, { geburtsdatum: '2012-02-02' }]);
  const r2026 = g0.Familie.ausscheider(d, 2026, KONFIG, HEUTE);
  assert.strictEqual(eintrag(r2026, 10).ergebnis, 'bleibt');          // am 01.01.2026 erst 17
  const r = g0.Familie.ausscheider(d, 2027, KONFIG, HEUTE);
  const e = eintrag(r, 10);
  assert.strictEqual(e.ergebnis, 'faellt_raus');
  assert.match(e.grund, /Altersgrenze/);
  assert.strictEqual(e.vorschlag.beitragsart_id, 1);
  assert.strictEqual(e.konto_id, 1);
  assert.strictEqual(eintrag(r, 11).ergebnis, 'bleibt');
  assert.strictEqual(eintrag(r, 1).rolle, 'erwachsen');
  assert.strictEqual(eintrag(r, 2).rolle, 'erwachsen');
  assert.strictEqual(eintrag(r, 10).rolle, 'kind');
});

test('Studium bis 2028 verlängert; Ausbildungsende vor Stichtag → fällt heraus; 26-Jährige → Grenze 25', () => {
  const d = familie([
    { geburtsdatum: '2005-04-01', ausbildung_art: 'Studium', ausbildung_bis: '2028-09-30', ausbildung_nachweis_am: '2026-10-01' },
    { geburtsdatum: '2006-04-01', ausbildung_art: 'Ausbildung', ausbildung_bis: '2026-08-31', ausbildung_nachweis_am: '2025-09-01' },
    { geburtsdatum: '2000-03-01', ausbildung_art: 'Studium', ausbildung_bis: '2029-03-31', ausbildung_nachweis_am: '2026-10-01' }
  ]);
  const r = g0.Familie.ausscheider(d, 2027, KONFIG, HEUTE);
  const studium = eintrag(r, 10);
  assert.strictEqual(studium.ergebnis, 'verlaengert_bis');
  assert.strictEqual(studium.verlaengert_bis, '2028-09-30');
  const azubi = eintrag(r, 11);
  assert.strictEqual(azubi.ergebnis, 'faellt_raus');
  assert.match(azubi.grund, /Ausbildung endet \(prognostiziert 31\.08\.2026\)/);
  const alt = eintrag(r, 12);                          // am 01.01.2027 26 Jahre
  assert.strictEqual(alt.ergebnis, 'faellt_raus');
  assert.match(alt.grund, /Ausbildungsgrenze/);
});

test('Nachweis anfordern: fehlender/alter Nachweis oder Ende innerhalb des Vorlaufs', () => {
  const d = familie([
    { geburtsdatum: '2005-04-01', ausbildung_art: 'Studium', ausbildung_bis: '2028-09-30' },
    { geburtsdatum: '2007-02-01', ausbildung_art: 'Schule', ausbildung_bis: '2026-12-15', ausbildung_nachweis_am: '2026-09-01' }
  ]);
  const r = g0.Familie.ausscheider(d, 2026, KONFIG, HEUTE);
  assert.strictEqual(eintrag(r, 10).ergebnis, 'nachweis_anfordern');
  assert.ok(eintrag(r, 10).nachweis_faellig);
  assert.strictEqual(eintrag(r, 11).ergebnis, 'nachweis_anfordern');   // Ende 15.12. – 2 Monate ≤ 25.10.
});

test('Prognose: erstes Ausscheidejahr je Person, Mehreinnahmen; Hinweis bei Restgemeinschaft', () => {
  const d = familie([
    { geburtsdatum: '2009-05-10' },
    { geburtsdatum: '2005-04-01', ausbildung_art: 'Studium', ausbildung_bis: '2028-09-30', ausbildung_nachweis_am: '2026-10-01' }
  ]);
  const p = rein(g0.Familie.prognose(d, 2027, 4, KONFIG, HEUTE));
  const j2028 = p.find(x => x.jahr === 2028);
  assert.deepStrictEqual(j2028.personen.map(x => x.mitglied_id), [10]);
  const j2029 = p.find(x => x.jahr === 2029);
  assert.deepStrictEqual(j2029.personen.map(x => x.mitglied_id), [11]);
  assert.strictEqual(j2029.mehreinnahmen, 100);
  assert.strictEqual(p.reduce((n, x) => n + x.anzahl, 0), 2, 'jede Person nur einmal');
  // Ehepaar ohne Kinder, einer fällt heraus? → nicht möglich (Erwachsene). Familie mit 1 Elternteil + 1 Kind:
  const klein = familie([{ geburtsdatum: '2008-05-10' }]);
  klein.Mitglied = klein.Mitglied.filter(m => m.mitglied_id !== 2);
  const r = g0.Familie.ausscheider(klein, 2027, KONFIG, HEUTE);
  assert.ok(rein(r).gemeinschaften[0].hinweis.includes('nur noch 1 Person'));
});

test('umstellungPlan: Gemeinschaft weg, Beitragsart gesetzt, Hinweis bei bereits gestellter Sollstellung', () => {
  const d = familie([{ geburtsdatum: '2008-05-10' }]);
  d.Sollstellung.push({ sollstellung_id: 1, beitragskonto_id: 1, jahr: 2027, soll_betrag: 180, status: 'offen' });
  const p = rein(g0.Familie.umstellungPlan(d, [{ mitglied_id: 10 }], 2027, KONFIG));
  assert.deepStrictEqual(p.aenderungen['10'], { beitragsgemeinschaft_id: null, beitragsart_id: 1 });
  assert.ok(p.hinweise.some(h => /schon angelegt/.test(h)));
  const f = rein(g0.Familie.umstellungPlan(d, [{ mitglied_id: 1, beitragsart_id: 99 }], 2027, KONFIG));
  assert.ok(f.fehler.length);
});

test('Halbjahresbeitrag (beitrag_anteilig = halbjahr): Eintritt ab 01.07. halb, sonst voll; Monat anteilig', () => {
  const d = {
    Beitragsart: [{ beitragsart_id: 1, bezeichnung: 'Erwachsene', betrag: 100, aktiv: true }],
    Beitragsgemeinschaft: [], Beitragskonto: [{ beitragskonto_id: 1, zahlweg: 'Lastschrift', aktiv: true }],
    Mitglied: [{ mitglied_id: 1, beitragskonto_id: 1, beitragsart_id: 1 }, { mitglied_id: 2, beitragskonto_id: 1, beitragsart_id: 1 }],
    Mitgliedschaftszeitraum: [{ mitglied_id: 1, eintrittsdatum: '2026-09-01' }, { mitglied_id: 2, eintrittsdatum: '2026-03-01' }]
  };
  const halb = rein(g0.Beitrag.sollJeKonto(1, d, 2026, { konfig: { beitrag_anteilig: 'halbjahr' } }));
  assert.strictEqual(halb.betrag, 150);   // 50 + 100
  const voll = rein(g0.Beitrag.sollJeKonto(1, d, 2026, { konfig: { beitrag_anteilig: 'nein' } }));
  assert.strictEqual(voll.betrag, 200);
  const monat = rein(g0.Beitrag.sollJeKonto(1, d, 2026, { konfig: { beitrag_anteilig: 'monat' } }));
  assert.strictEqual(monat.betrag, 33.33 + 83.33);   // je Position gerundet
  // Austritt bis 30.06. → halb
  d.Mitgliedschaftszeitraum[1].austrittsdatum = '2026-05-31';
  assert.strictEqual(rein(g0.Beitrag.sollJeKonto(1, d, 2026, { konfig: { beitrag_anteilig: 'halbjahr' } })).betrag, 100);
});

test('jahressummen: Soll/Ist/Gebühr/offen je Jahr, storniert zählt nicht', () => {
  const j = rein(g0.Familie.jahressummen([
    { jahr: 2025, soll_betrag: 100, ist_betrag: 100, status: 'bezahlt' },
    { jahr: 2026, soll_betrag: 100, ist_betrag: 0, gebuehr: 5, status: 'ruecklastschrift', ruecklastschrift_grund: 'x' },
    { jahr: 2026, soll_betrag: 50, status: 'storniert' }
  ]));
  assert.deepStrictEqual(j.map(x => x.jahr), [2026, 2025]);
  assert.strictEqual(j[0].offen, 105);
  assert.strictEqual(j[0].storniert, 1);
  assert.strictEqual(j[0].soll, 100);
  assert.strictEqual(j[1].offen, 0);
});

// ------------------------------------------------------------------ Servermodul gegen Fakes

const BENUTZER = { mv: 'verwaltung@tsv-ergoldsbach.de', kassier: 'kassier@tsv-ergoldsbach.de', al: 'fussball@tsv-ergoldsbach.de' };
function verein() { return erzeugeVerein({ seed: 5, mitglieder: 300 }).tabs; }
function als(email, tabs) { const f = erzeugeFakes({ tabs, email }); return { f, g: ladeProjekt(f.globale) }; }
function ok(a) { a = rein(a); assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return a.daten; }
function obj(f, tab) { const d = f.daten(tab); return d.slice(1).map(z => Object.fromEntries(d[0].map((k, i) => [k, z[i]]))); }

test('API: Übersicht/Ausscheider für Kasse und MV, nicht für Abteilungsleiter', () => {
  const tabs = verein();
  const k = ok(als(BENUTZER.kassier, tabs).g.apiFamilieAusscheider(2027, 3));
  assert.ok(Array.isArray(k.eintraege) && Array.isArray(k.prognose) && k.prognose.length === 3);
  const u = ok(als(BENUTZER.mv, tabs).g.apiFamilieUebersicht(2027));
  assert.ok(u.gemeinschaften.length > 10);
  const al = rein(als(BENUTZER.al, tabs).g.apiFamilieAusscheider(2027, 3));
  assert.strictEqual(al.ok, false); assert.strictEqual(al.fehler.art, 'zugriff');
});

test('Umstellung auf Einzelbeitrag (Sammelaktion): Gemeinschaft entfernt, Beitragsart gesetzt, Konto bleibt, Protokoll; Kassier darf nicht', () => {
  const tabs = verein();
  const mv = als(BENUTZER.mv, tabs);
  // Ein Kind künstlich auf 20 Jahre setzen → fällt 2027 heraus
  const r0 = ok(mv.g.apiFamilieUebersicht(2027));
  const g = r0.gemeinschaften.find(x => x.personen.some(p => p.rolle === 'kind'));
  const kind = g.personen.find(p => p.rolle === 'kind');
  const kopf = mv.f.daten('Mitglied')[0];
  const zeile = mv.f.daten('Mitglied').find(z => z[kopf.indexOf('mitglied_id')] === kind.mitglied_id);
  zeile[kopf.indexOf('geburtsdatum')] = isoZuSerial('2004-06-01');
  const mv2 = als(BENUTZER.mv, (() => { const t = {}; mv.f.datei.getSheets().forEach(b => { t[b.getName()] = mv.f.daten(b.getName()).map(z => z.slice()); }); return t; })());
  const a = ok(mv2.g.apiFamilieAusscheider(2027, 2));
  const e = a.eintraege.find(x => x.mitglied_id === kind.mitglied_id);
  assert.strictEqual(e.ergebnis, 'faellt_raus');
  assert.ok(a.anschreiben.some(x => x.anlass === 'Umstellung Einzelbeitrag' && x.mitglied_ids.includes(kind.mitglied_id)));
  // Kassier hat kein mitglied_bearbeiten
  const kas = als(BENUTZER.kassier, mv2.f.globale ? (() => { const t = {}; mv2.f.datei.getSheets().forEach(b => { t[b.getName()] = mv2.f.daten(b.getName()).map(z => z.slice()); }); return t; })() : tabs);
  assert.strictEqual(rein(kas.g.apiFamilieUmstellen([{ mitglied_id: kind.mitglied_id, version: e.version }], '2027-01-01')).fehler.art, 'zugriff');
  const u = ok(mv2.g.apiFamilieUmstellen([{ mitglied_id: kind.mitglied_id, version: e.version, beitragsart_id: e.vorschlag.beitragsart_id }], '2027-01-01'));
  assert.ok(u.aktualisiert.mitglieder.some(m => m.mitglied_id === kind.mitglied_id));
  const m = obj(mv2.f, 'Mitglied').find(x => x.mitglied_id === kind.mitglied_id);
  assert.strictEqual(m.beitragsgemeinschaft_id, '');
  assert.strictEqual(m.beitragsart_id, e.vorschlag.beitragsart_id);
  assert.strictEqual(m.beitragskonto_id, e.konto_id);
  assert.ok(obj(mv2.f, '_Protokoll').some(p => String(p.datensatz_id) === String(kind.mitglied_id) && /Umstellung auf Einzelbeitrag/.test(p.kommentar)));
  // Versionskonflikt beim zweiten Mal
  assert.strictEqual(rein(mv2.g.apiFamilieUmstellen([{ mitglied_id: kind.mitglied_id, version: e.version }], '2027-01-01')).ok, false);
});

test('Ausbildung speichern: Plausibilität und Speichern', () => {
  const tabs = verein();
  const mv = als(BENUTZER.mv, tabs);
  const m = obj(mv.f, 'Mitglied').find(x => x.beitragsgemeinschaft_id);
  const f1 = rein(mv.g.apiFamilieAusbildungSpeichern(m.mitglied_id, m.version || 0, { ausbildung_bis: '2020-01-01', ausbildung_art: 'Studium' }));
  assert.strictEqual(f1.ok, false);
  assert.ok(f1.fehler.felder.some(x => x.feld === 'ausbildung_bis'));
  const f2 = rein(mv.g.apiFamilieAusbildungSpeichern(m.mitglied_id, m.version || 0, { ausbildung_bis: '2028-09-30' }));
  assert.ok(f2.fehler.felder.some(x => x.feld === 'ausbildung_art'));
  ok(mv.g.apiFamilieAusbildungSpeichern(m.mitglied_id, m.version || 0, { ausbildung_art: 'Studium', ausbildung_bis: '2028-09-30', ausbildung_nachweis_am: '2026-10-01' }));
  const neu = obj(mv.f, 'Mitglied').find(x => x.mitglied_id === m.mitglied_id);
  assert.strictEqual(neu.ausbildung_art, 'Studium');
  assert.strictEqual(neu.ausbildung_bis, isoZuSerial('2028-09-30'));
});

test('Bezahlhistorie: alle Jahre, Anteil der Person, Jahressummen; AL ohne Zugriff', () => {
  const tabs = verein();
  const kas = als(BENUTZER.kassier, tabs);
  const soll = obj(kas.f, 'Sollstellung');
  const kontoMitSoll = soll[0].beitragskonto_id;
  const m = obj(kas.f, 'Mitglied').find(x => x.beitragskonto_id === kontoMitSoll);
  const h = ok(kas.g.apiFamilieBezahlhistorie(m.mitglied_id));
  const jahreRoh = [...new Set(soll.filter(s => s.beitragskonto_id === kontoMitSoll).map(s => s.jahr))];
  assert.strictEqual(new Set(h.zeilen.map(z => z.jahr)).size, jahreRoh.length);
  assert.ok(h.jahre.length >= 1);
  assert.ok(h.zeilen.every(z => z.beitragskonto_id === kontoMitSoll));
  const kh = ok(kas.g.apiFamilieKontohistorie(kontoMitSoll));
  assert.strictEqual(kh.zeilen.length, soll.filter(s => s.beitragskonto_id === kontoMitSoll).length);
  assert.strictEqual(rein(als(BENUTZER.al, tabs).g.apiFamilieBezahlhistorie(m.mitglied_id)).fehler.art, 'zugriff');
  assert.ok(!JSON.stringify(h).match(/DE\d{20}/), 'keine IBAN');
});

test('Finanzen: Rechnungen (nur Nicht-Lastschrift), Jahresübersicht alle Jahre, SEPA-Nachlauf nur Neues (XSD-valide)', () => {
  const tabs = verein();
  const k = tabs._Konfig;
  Object.entries({ verein_iban: 'DE89370400440532013000', verein_glaeubiger_id: 'DE98ZZZ09999999999', verein_strasse: 'Sportplatzweg',
    verein_hausnummer: '1', verein_plz: '84061', verein_ort: 'Ergoldsbach' }).forEach(([s, w]) => k.push(k[0].map(h => (h === 'schluessel' ? s : h === 'wert' ? w : ''))));
  const kas = als(BENUTZER.kassier, tabs);
  const r = ok(kas.g.apiFinanzenRechnungen(2026));
  const konten = Object.fromEntries(obj(kas.f, 'Beitragskonto').map(x => [x.beitragskonto_id, x]));
  assert.ok(r.every(x => konten[x.beitragskonto_id].zahlweg !== 'Lastschrift'));
  const ju = ok(kas.g.apiFinanzenJahresuebersicht());
  const jahreRoh = new Set(obj(kas.f, 'Sollstellung').map(s => s.jahr));
  assert.strictEqual(ju.jahre.length, jahreRoh.size);
  // Jahreslauf 2027 anlegen, Datei erzeugen → zweiter Probelauf im Modus „neu“ hat keine Posten mehr
  ok(kas.g.apiFinanzenSollstellungAnlegen(2027));
  const p1 = ok(kas.g.apiFinanzenSepaProbelauf(2027, null));
  assert.ok(p1.anzahl > 0);
  const x = ok(kas.g.apiFinanzenSepaXml(2027, '2027-02-15'));
  const p2 = ok(kas.g.apiFinanzenSepaProbelauf(2027, null));
  assert.strictEqual(p2.anzahl, 0, 'nichts doppelt einziehen');
  assert.ok(p2.ausgeschlossen.some(a => /bereits in einer SEPA-Datei/.test(a.grund)));
  const p3 = ok(kas.g.apiFinanzenSepaProbelauf(2027, null, 'erneut'));
  assert.strictEqual(p3.anzahl, p1.anzahl);
  const xsd = path.join(__dirname, 'xsd', 'pain.008.001.08.xsd');
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sepa-')), x.dateiname);
  fs.writeFileSync(datei, x.xml);
  try { execFileSync('xmllint', ['--noout', '--schema', xsd, datei], { stdio: 'pipe' }); } catch (e) { assert.fail('XSD: ' + e.stderr); }
  // Nachzügler: ein Konto bekommt nachträglich eine neue Sollstellung (Konto ohne Sollstellung 2027 simulieren)
  const sKopf = kas.f.daten('Sollstellung')[0];
  const zeilen = kas.f.daten('Sollstellung');
  const i = zeilen.findIndex((z, n) => n > 0 && z[sKopf.indexOf('jahr')] === 2027 && z[sKopf.indexOf('sepa_sequenz')]);
  const kontoId = zeilen[i][sKopf.indexOf('beitragskonto_id')];
  zeilen.splice(i, 1);   // diese Sollstellung „gab es noch nicht“
  const t2 = {}; kas.f.datei.getSheets().forEach(b => { t2[b.getName()] = kas.f.daten(b.getName()).map(z => z.slice()); });
  const k2 = als(BENUTZER.kassier, t2);
  const pl = ok(k2.g.apiFinanzenSepaProbelauf(2027, null));
  assert.strictEqual(pl.nachzuegler_ohne_sollstellung, 1);
  ok(k2.g.apiFinanzenSollstellungAnlegen(2027));
  const nach = ok(k2.g.apiFinanzenSepaProbelauf(2027, null));
  assert.strictEqual(nach.anzahl, 1, 'Nachlauf enthält genau den Nachzügler');
  assert.strictEqual(nach.posten[0].konto, kontoId);
});
