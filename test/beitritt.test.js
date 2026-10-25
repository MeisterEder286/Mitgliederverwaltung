/**
 * Tests Beitritts-XML-Import (src/lib/beitritt.js, src/modul/Beitritt.js, src/api/Beitritt.js).
 * Nachfolger des Access-Moduls „BeitrittsXmlImportieren“: Person 1 zahlt selbst, alle weiteren über Person 1,
 * Bankdaten werden übernommen, immer NEUE Mitgliedsnummern (höchste + 1), je Antrag alles oder nichts.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const DATEN = path.join(__dirname, 'daten', 'beitritt');
const IBAN_FAMILIE = 'DE89370400440532013000';

/** XML wie der Browser zerlegen: je <Daten16> ein Objekt mit den (noch kodierten) Elementnamen. */
function personenAus(xml) {
  return [...xml.matchAll(/<Daten16>([\s\S]*?)<\/Daten16>/g)].map(m =>
    Object.fromEntries([...m[1].matchAll(/<([\w]+)>([^<]*)<\/\1>/g)].map(x => [x[1], x[2]])));
}
function antrag(datei) { return { datei, personen: personenAus(fs.readFileSync(path.join(DATEN, datei), 'utf8')) }; }
function xmlAntrag(datei, personen) {
  return { datei, personen: personen.map(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k.replace(/ /g, '_x0020_'), String(v)]))) };
}

function umgebung(rolle) {
  const v = erzeugeVerein({ seed: 5, mitglieder: 300 });
  const k = v.tabs.Benutzer[0];
  const z = v.tabs.Benutzer.slice(1).find(r => r[k.indexOf('rolle')] === (rolle || 'Mitgliederverwalter'));
  const f = erzeugeFakes({ tabs: v.tabs, email: z[k.indexOf('email')] });
  const g = ladeProjekt(f.globale);
  const obj = tab => { const d = f.daten(tab); return d.slice(1).map(r => Object.fromEntries(d[0].map((h, i) => [h, r[i]]))); };
  return { f, g, obj };
}
function ok(a) { a = rein(a); assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return a.daten; }
function maxNr(obj) { return Math.max(...obj('Mitglied').map(m => Number(String(m.mitgliedsnummer).replace(/\D/g, '')) || 0)); }

test('Vorschau: Familie mit 3 Personen – ein Konto (maskiert), Gemeinschaft, fortlaufende vorläufige Nummern, keine Klartext-IBAN', () => {
  const u = umgebung();
  const d = ok(u.g.apiBeitrittVorschau([antrag('familie.xml')]));
  const a = d.antraege[0];
  assert.strictEqual(a.personen.length, 3);
  assert.strictEqual(a.konto.zahlweg, 'Lastschrift');
  assert.ok(a.konto.iban_maskiert && !a.konto.iban_maskiert.includes('0532'));
  assert.strictEqual(a.gemeinschaft.festbetrag, 180);
  assert.match(a.gemeinschaft.bezeichnung, /Beispielhuber/);
  const max = maxNr(u.obj);
  assert.deepStrictEqual(a.personen.map(p => Number(p.nummer_vorlaeufig)), [max + 1, max + 2, max + 3]);
  assert.strictEqual(a.personen[0].rolle, 'zahlt selbst');
  assert.ok(!JSON.stringify(d).includes(IBAN_FAMILIE), 'IBAN im Klartext in der Vorschau');
  assert.ok(!JSON.stringify(d).includes('0532013000'));
});

test('Import Familie: neue Nummern max+1…, ein Konto mit IBAN und Mandatsreferenz, Gemeinschaft, Vertretung, Zähler, Protokoll ohne IBAN', () => {
  const u = umgebung();
  const max = maxNr(u.obj);
  const vorher = u.obj('Mitglied').length;
  const d = ok(u.g.apiBeitrittImportieren([antrag('familie.xml')], [{ index: 0 }]));
  assert.match(d.kopf, /^3 neue Person\(en\) aus 1 Antrag/);
  const r = d.ergebnisse[0];
  assert.deepStrictEqual(r.personen.map(p => Number(p.nummer)), [max + 1, max + 2, max + 3]);
  assert.strictEqual(r.personen[0].rolle, 'zahlt selbst');
  assert.strictEqual(r.personen[1].rolle, 'Zahler: ' + r.personen[0].nummer);
  const neu = u.obj('Mitglied').slice(vorher);
  assert.strictEqual(neu.length, 3);
  const konto = u.obj('Beitragskonto').find(k => k.beitragskonto_id === r.konto_id);
  assert.strictEqual(konto.iban, IBAN_FAMILIE);
  assert.strictEqual(konto.zahlweg, 'Lastschrift');
  assert.strictEqual(konto.mandatsreferenz, 'TSV-2026-' + r.personen[0].nummer);
  assert.strictEqual(konto.kontoinhaber_mitglied_id, r.personen[0].mitglied_id);
  assert.ok(neu.every(m => m.beitragskonto_id === r.konto_id));
  const gem = u.obj('Beitragsgemeinschaft').find(x => x.beitragsgemeinschaft_id === neu[0].beitragsgemeinschaft_id);
  assert.strictEqual(Number(gem.festbetrag), 180);
  assert.ok(neu.every(m => m.beitragsgemeinschaft_id === gem.beitragsgemeinschaft_id));
  const lena = neu.find(m => m.vorname === 'Lena');
  assert.strictEqual(lena.vertreter_mitglied_id, r.personen[0].mitglied_id);
  assert.strictEqual(neu[0].hausnummer, '12a');
  assert.ok(neu.every(m => m.status === 'aktiv'));
  assert.strictEqual(u.obj('Mitgliedschaftszeitraum').filter(z => neu.some(m => m.mitglied_id === z.mitglied_id)).length, 3);
  assert.ok(u.obj('Abteilungszugehoerigkeit').filter(z => z.mitglied_id === lena.mitglied_id).length === 2, 'Lena: Turnen + Fußball');
  const naechste = u.obj('_Konfig').find(k => k.schluessel === 'mitgliedsnummer_naechste').wert;
  assert.strictEqual(Number(naechste), max + 4);
  const prot = JSON.stringify(u.obj('_Protokoll'));
  assert.ok(!prot.includes(IBAN_FAMILIE) && !prot.includes('0532013000'), 'IBAN im Protokoll');
  assert.ok(!JSON.stringify(d).includes(IBAN_FAMILIE), 'IBAN in der Antwort');
  assert.ok(d.aenderung.aktualisiert.mitglieder.length >= 3);
});

test('Zwei Anträge: Nummern laufen weiter; erwachsener Sohn mit eigenem Beitrag → nur gemeinsames Konto', () => {
  const u = umgebung();
  const max = maxNr(u.obj);
  const vater = { Anrede: 'Herr', Nachname: 'Sohnsberger', Vorname: 'Karl', GebDat: '1960-01-01', Strasse: 'Hauptstraße 4', Plz: '84061', Ort: 'Ergoldsbach',
    IBAN: 'DE02120300000000202051', Gesamtbeitrag: '100', 'Abteilung 1': 'Tennis' };
  const sohn = { Anrede: 'Herr', Nachname: 'Sohnsberger', Vorname: 'Felix', GebDat: '1999-06-01', Gesamtbeitrag: '100', 'Abteilung 1': 'Fußball' };
  const d = ok(u.g.apiBeitrittImportieren([antrag('einzel.xml'), xmlAntrag('sohn.xml', [vater, sohn])], []));
  assert.match(d.kopf, /^3 neue Person\(en\) aus 2 Antrag/);
  const alle = d.ergebnisse.flatMap(r => r.personen.map(p => Number(p.nummer)));
  assert.deepStrictEqual(alle, [max + 1, max + 2, max + 3]);
  const r = d.ergebnisse[1];
  assert.strictEqual(r.gemeinschaft, null);
  const ms = u.obj('Mitglied').filter(m => r.personen.some(p => p.mitglied_id === m.mitglied_id));
  assert.ok(ms.every(m => m.beitragskonto_id === r.konto_id && !m.beitragsgemeinschaft_id && m.beitragsart_id));
  // Einzelperson: Kontoinhaber leer → Name der Person
  const k1 = u.obj('Beitragskonto').find(k => k.beitragskonto_id === d.ergebnisse[0].konto_id);
  assert.strictEqual(k1.kontoinhaber_name, 'Musterfrau, Erika');
});

test('Dublette: ohne Entscheidung nicht importiert; „neu“ legt neue Nummer an; „Wiedereintritt“ nutzt bestehende Nummer', () => {
  const u = umgebung();
  ok(u.g.apiBeitrittImportieren([antrag('einzel.xml')], []));
  // gleiche Person erneut → Vorschau meldet Dublette
  const v = ok(u.g.apiBeitrittVorschau([antrag('einzel.xml')]));
  assert.strictEqual(v.antraege[0].personen[0].dubletten.length, 1);
  const ohne = ok(u.g.apiBeitrittImportieren([antrag('einzel.xml')], []));
  assert.strictEqual(ohne.ergebnisse[0].ok, false);
  assert.match(ohne.ergebnisse[0].grund, /ähnlichen Eintrag/);
  // aktives Mitglied → Wiedereintritt abgelehnt
  const akt = ok(u.g.apiBeitrittImportieren([antrag('einzel.xml')], [{ index: 0, personen: { 0: 'wiedereintritt' } }]));
  assert.match(akt.ergebnisse[0].grund, /bereits aktives Mitglied/);
  // Wiedereintritt einer Ausgetretenen aus dem Bestand
  const zr = u.obj('Mitgliedschaftszeitraum');
  const aus = u.obj('Mitglied').find(m => m.status === 'ausgetreten' && m.vorname && m.nachname && !m.sterbedatum &&
    zr.filter(z => z.mitglied_id === m.mitglied_id).every(z => z.austrittsdatum));
  const vorher = u.obj('Mitglied').length;
  const w = ok(u.g.apiBeitrittImportieren([xmlAntrag('wieder.xml', [{ Anrede: 'Frau', Nachname: aus.nachname, Vorname: aus.vorname,
    GebDat: '', IBAN: 'DE02120300000000202051', Gesamtbeitrag: '100', 'Abteilung 1': 'Turnen' }])], [{ index: 0, personen: { 0: 'wiedereintritt' } }]));
  assert.strictEqual(w.ergebnisse[0].ok, true, w.ergebnisse[0].grund);
  assert.strictEqual(u.obj('Mitglied').length, vorher, 'keine neue Person');
  assert.strictEqual(String(w.ergebnisse[0].personen[0].nummer), String(aus.mitgliedsnummer));
  const neu = u.obj('Mitglied').find(m => m.mitglied_id === aus.mitglied_id);
  assert.strictEqual(neu.status, 'aktiv');
  assert.ok(u.obj('Mitgliedschaftszeitraum').filter(z => z.mitglied_id === aus.mitglied_id).some(z => !z.austrittsdatum));
  // „neu“ trotz Dublette
  const n = ok(u.g.apiBeitrittImportieren([antrag('einzel.xml')], [{ index: 0, personen: { 0: 'neu' } }]));
  assert.strictEqual(n.ergebnisse[0].ok, true);
});

test('Ungültige IBAN → nicht übernommen, Zahlweg Überweisung, Warnung', () => {
  const u = umgebung();
  const d = ok(u.g.apiBeitrittImportieren([xmlAntrag('falsch.xml', [{ Anrede: 'Herr', Nachname: 'Falschmann', Vorname: 'Otto', GebDat: '1970-01-01',
    IBAN: 'DE00123456780000000000', Gesamtbeitrag: '100' }])], []));
  const r = d.ergebnisse[0];
  assert.strictEqual(r.ok, true);
  assert.ok(r.warnungen.some(x => /ungültig/.test(x)));
  const k = u.obj('Beitragskonto').find(x => x.beitragskonto_id === r.konto_id);
  assert.strictEqual(k.zahlweg, 'Überweisung');
  assert.ok(!k.iban);
});

test('Atomar: Fehler beim Schreiben der Zugehörigkeiten → nichts bleibt stehen, Zähler unverändert', () => {
  const u = umgebung();
  const vorher = { m: u.obj('Mitglied').length, k: u.obj('Beitragskonto').length, g: u.obj('Beitragsgemeinschaft').length, z: u.obj('Mitgliedschaftszeitraum').length,
    n: u.obj('_Konfig').find(k => k.schluessel === 'mitgliedsnummer_naechste').wert };
  const orig = u.g.DB.einfuegenViele;
  u.g.DB.einfuegenViele = function (tab) { if (tab === 'Abteilungszugehoerigkeit') throw new Error('erzwungen'); return orig.apply(null, arguments); };
  const d = ok(u.g.apiBeitrittImportieren([antrag('familie.xml')], []));
  u.g.DB.einfuegenViele = orig;
  assert.strictEqual(d.ergebnisse[0].ok, false);
  assert.match(d.ergebnisse[0].grund, /nichts gespeichert/);
  assert.strictEqual(u.obj('Mitglied').length, vorher.m);
  assert.strictEqual(u.obj('Beitragskonto').length, vorher.k);
  assert.strictEqual(u.obj('Beitragsgemeinschaft').length, vorher.g);
  assert.strictEqual(u.obj('Mitgliedschaftszeitraum').length, vorher.z);
  assert.strictEqual(u.obj('_Konfig').find(k => k.schluessel === 'mitgliedsnummer_naechste').wert, vorher.n);
});

test('Rechte und Grenzen: Kassier/Abteilungsleiter abgewiesen; zu viele Anträge/Personen', () => {
  for (const rolle of ['Kassier', 'Abteilungsleiter']) {
    const u = umgebung(rolle);
    const a = rein(u.g.apiBeitrittVorschau([antrag('einzel.xml')]));
    assert.strictEqual(a.ok, false);
    assert.strictEqual(a.fehler.art, 'zugriff', rolle);
    assert.strictEqual(rein(u.g.apiBeitrittImportieren([antrag('einzel.xml')], [])).fehler.art, 'zugriff');
  }
  const u = umgebung();
  const viele = Array.from({ length: 51 }, () => antrag('einzel.xml'));
  assert.strictEqual(rein(u.g.apiBeitrittVorschau(viele)).fehler.art, 'fachlich');
  const p = antrag('einzel.xml').personen[0];
  assert.strictEqual(rein(u.g.apiBeitrittVorschau([{ datei: 'x.xml', personen: Array(21).fill(p) }])).fehler.art, 'fachlich');
  assert.strictEqual(rein(u.g.apiBeitrittVorschau('kaputt')).fehler.art, 'fachlich');
});
