/**
 * Tests für src/lib/sepa.js – Sequenz FRST/RCUR, Lauf mit Ausschlussgründen, XML pain.008.001.08.
 * Die XML-Datei wird mit xmllint gegen test/xsd/pain.008.001.08.xsd (ISO-Basisschema) validiert;
 * fehlt xmllint, wird dieser Teil mit Hinweis übersprungen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { rein } = require('./hilfe/projekt');
const { beitragsdaten } = require('./hilfe/beitragsdaten');

const XSD = path.join(__dirname, 'xsd', 'pain.008.001.08.xsd');
const GLAEUBIGER = {
  name: 'TSV Ergoldsbach e. V.', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', glaeubigerId: 'DE98ZZZ09999999999',
  adresse: { strasse: 'Sportplatzweg', hausnummer: '1', plz: '84061', ort: 'Ergoldsbach', land: 'DE' }
};

function hatXmllint() {
  try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
}

/** Beispieldaten mit gültigen IBANs und geplanter Sollstellung 2027. */
function laufDaten() {
  const { g, d } = beitragsdaten({ gueltigeIbans: true });
  const plan = g.Sollstellungslauf.plane(d, 2027, '2026-10-25');
  plan.neu.forEach((s, i) => { s.sollstellung_id = 100 + i; d.Sollstellung.push(s); });
  return { g, d };
}

test('Zeichenbereinigung und Kennungen', () => {
  const { g } = beitragsdaten();
  assert.strictEqual(g.Sepa.bereinige('Müller-Lüdenscheidt & Söhne <GmbH>'), 'Mueller-Luedenscheidt + Soehne GmbH');
  assert.strictEqual(g.Sepa.bereinige('Café Señor'), 'Cafe Senor');
  assert.strictEqual(g.Sepa.bereinige('x'.repeat(200), 140).length, 140);
  assert.strictEqual(g.Sepa.kennung('/TSV 2001//1042/'), 'TSV2001/1042');
});

test('Sequenz: FRST ohne erfolgreiche Vorlastschrift, RCUR danach, neues Mandat → FRST, immerRcur', () => {
  const { g } = beitragsdaten();
  const S = g.Sepa.sequenz;
  const soll = [
    { sollstellung_id: 1, beitragskonto_id: 4, status: 'ruecklastschrift', sepa_sequenz: 'FRST', einzugsdatum: '2026-02-15' },
    { sollstellung_id: 2, beitragskonto_id: 1, status: 'bezahlt', sepa_sequenz: 'RCUR', einzugsdatum: '2026-02-15' }
  ];
  assert.strictEqual(S(4, soll, { mandatsdatum: '2001-01-08' }), 'FRST', 'nur Rücklastschrift → wieder FRST');
  assert.strictEqual(S(1, soll, { mandatsdatum: '2001-09-12' }), 'RCUR');
  assert.strictEqual(S(1, soll, { mandatsdatum: '2026-06-01' }), 'FRST', 'neues Mandat nach dem letzten Einzug');
  assert.strictEqual(S(1, soll, { mandatsdatum: '2001-09-12' }, { ausser: 2 }), 'FRST');
  assert.strictEqual(S(9, soll, {}, { immerRcur: true }), 'RCUR');
});

test('Lauf 2027: Posten, Summe, Überweiser als Info ausgeschlossen', () => {
  const { g, d } = laufDaten();
  const l = rein(g.Sepa.lauf(d, 2027, { heute: '2026-10-25' }));
  assert.strictEqual(l.anzahl, 8);
  assert.strictEqual(l.summe, 980);
  const wagner = l.posten.find(p => p.konto === 1);
  assert.strictEqual(wagner.betrag, 280);
  assert.strictEqual(wagner.sequenz, 'RCUR');
  assert.strictEqual(wagner.mandatsreferenz, 'TSV-2001-1042');
  assert.match(wagner.verwendungszweck, /Mitgliedsbeitrag 2027 .*1042 1043 1044 1187/);
  assert.strictEqual(wagner.adresse.strasse, 'Rosenweg');
  assert.strictEqual(l.posten.find(p => p.konto === 9).sequenz, 'FRST', 'Vogl: neues Mandat');
  assert.deepStrictEqual(l.ausgeschlossen.map(a => [a.konto_id, a.art]), [[3, 'info']]);
});

test('Lauf: Ausschlussgründe IBAN, Mandat, verfallen, stillgelegt', () => {
  const { g, d } = laufDaten();
  const k = id => d.Beitragskonto.find(x => x.beitragskonto_id === id);
  k(2).iban = 'DE00000000000000000000';
  k(5).mandatsreferenz = null;
  k(7).aktiv = false;
  d.Sollstellung = d.Sollstellung.filter(s => !(s.beitragskonto_id === 4 && s.jahr < 2027));   // Fischer: nie genutzt seit 2001
  const l = rein(g.Sepa.lauf(d, 2027, { heute: '2026-10-25' }));
  const grund = id => (l.ausgeschlossen.find(a => a.konto_id === id) || {}).grund || '';
  assert.match(grund(2), /Prüfziffer/);
  assert.match(grund(5), /Mandat unvollständig/);
  assert.match(grund(7), /stillgelegt/);
  assert.match(grund(4), /verfallen/);
  assert.strictEqual(l.anzahl, 4);
});

test('XML: Gläubiger-ID-Platzhalter → Fehlerliste statt Datei', () => {
  const { g, d } = laufDaten();
  const l = g.Sepa.lauf(d, 2027, { heute: '2026-10-25' });
  const x = rein(g.Sepa.xml(l, Object.assign({}, GLAEUBIGER, { glaeubigerId: 'DE00ZZZ00000000000' })));
  assert.strictEqual(x.ok, false);
  assert.match(x.fehler.join(' '), /Platzhalter/);
  assert.strictEqual(rein(g.Sepa.xml({ jahr: 2027, posten: [] }, GLAEUBIGER)).ok, false);
});

test('XML pain.008.001.08: Struktur, Summen je PmtInf und gesamt, XSD-valide', () => {
  const { g, d } = laufDaten();
  // ein Name mit Sonderzeichen und eine unvollständige Adresse
  d.Beitragskonto.find(k => k.beitragskonto_id === 8).kontoinhaber_name = 'Schmid, Korbinian & Söhne <Test>';
  d.Mitglied.find(m => m.mitglied_id === 13).hausnummer = null;
  d.Mitglied.find(m => m.mitglied_id === 10).ort = null;
  const l = g.Sepa.lauf(d, 2027, { heute: '2026-10-25' });
  const x = g.Sepa.xml(l, GLAEUBIGER, { erstelltAm: '2026-10-25T12:00:00' });
  assert.strictEqual(x.ok, true, JSON.stringify(x.fehler));
  const xml = x.xml;
  assert.match(xml, /xmlns="urn:iso:std:iso:20022:tech:xsd:pain\.008\.001\.08"/);
  assert.match(xml, /<GrpHdr>[\s\S]*<NbOfTxs>8<\/NbOfTxs>[\s\S]*<CtrlSum>980\.00<\/CtrlSum>/);
  assert.strictEqual(x.summe, 980);
  // je PmtInf: NbOfTxs und CtrlSum passen zu den enthaltenen Transaktionen
  const pmt = xml.split('<PmtInf>').slice(1);
  assert.strictEqual(pmt.length, 2, 'FRST und RCUR getrennt');
  let gesamt = 0;
  pmt.forEach(teil => {
    const betraege = [...teil.matchAll(/<InstdAmt Ccy="EUR">([\d.]+)<\/InstdAmt>/g)].map(m => Number(m[1]));
    assert.strictEqual(Number(/<NbOfTxs>(\d+)<\/NbOfTxs>/.exec(teil)[1]), betraege.length);
    assert.strictEqual(Number(/<CtrlSum>([\d.]+)<\/CtrlSum>/.exec(teil)[1]), betraege.reduce((a, b) => a + b, 0));
    gesamt += betraege.length;
  });
  assert.strictEqual(gesamt, 8);
  assert.match(xml, /<Nm>Schmid, Korbinian \+ Soehne Test<\/Nm>/);
  assert.ok(!/[äöüß&<>](?![a-z]+;)/.test(xml.replace(/<[^>]+>/g, '')), 'nur SEPA-Basiszeichen in Texten');
  assert.match(xml, /<Nm>Lehner, Julia<\/Nm><PstlAdr><StrtNm>Feldstrasse<\/StrtNm><PstCd>/, 'ohne Hausnummer: BldgNb entfällt');
  assert.match(xml, /<Nm>Kellner, Hans<\/Nm><\/Dbtr>/, 'unvollständige Adresse wird weggelassen');
  assert.match(xml, /<CdtrAgt><FinInstnId><BICFI>COBADEFFXXX<\/BICFI>/);
  assert.match(xml, /<DbtrAgt><FinInstnId><BICFI>COBADEFFXXX<\/BICFI>/);

  if (!hatXmllint()) { console.log('Hinweis: xmllint fehlt – XSD-Validierung übersprungen'); return; }
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sepa-')), 'lauf.xml');
  fs.writeFileSync(datei, xml);
  execFileSync('xmllint', ['--noout', '--schema', XSD, datei], { stdio: 'pipe' });
  // ohne BIC (IBAN-only) ebenfalls valide
  d.Beitragskonto.forEach(k => { k.bic = null; });
  const x2 = g.Sepa.xml(g.Sepa.lauf(d, 2027, { heute: '2026-10-25' }), Object.assign({}, GLAEUBIGER, { bic: null, adresse: null }), { erstelltAm: '2026-10-25T12:00:00' });
  assert.match(x2.xml, /<Othr><Id>NOTPROVIDED<\/Id><\/Othr>/);
  fs.writeFileSync(datei, x2.xml);
  execFileSync('xmllint', ['--noout', '--schema', XSD, datei], { stdio: 'pipe' });
});

test('Mandatsänderung: Kontowechsel gleiche Bank → alte IBAN, andere Bank → SMNDA, erledigt nach Einzug, XSD-valide', () => {
  const { g, d } = laufDaten();
  const wagner = d.Beitragskonto.find(k => k.beitragskonto_id === 1);
  const vorher = d.Sollstellung.filter(s => s.beitragskonto_id === 1 && s.status === 'bezahlt' && s.einzugsdatum);
  assert.ok(vorher.length, 'Wagner hat einen bezahlten Einzug');
  const wechsel = vorher.map(s => s.einzugsdatum).sort().pop().slice(0, 4) + '-12-31';
  const gleicheBank = g.Iban.ausBlzKonto(wagner.iban.slice(4, 12), '0000123456');
  const andereBank = g.Iban.ausBlzKonto('70150000', '1234567890');
  const M = (k, opt) => rein(g.Sepa.mandatsaenderung(k, d.Sollstellung, opt));

  assert.strictEqual(M(wagner), null, 'ohne Wechsel keine Änderung');
  wagner.iban_vorher = gleicheBank; wagner.iban_geaendert_am = wechsel;
  assert.deepStrictEqual(M(wagner), { art: 'konto', alteIban: gleicheBank });
  wagner.iban_vorher = andereBank;
  assert.deepStrictEqual(M(wagner), { art: 'bank' });
  assert.strictEqual(M(Object.assign({}, wagner, { mandatsdatum: wechsel })), null, 'neues Mandat nach dem Wechsel');
  assert.strictEqual(M(Object.assign({}, wagner, { iban_vorher: wagner.iban })), null, 'zurück auf die alte IBAN');
  // nach einem bezahlten Einzug ab dem Wechsel ist die Änderung übermittelt
  const spaeter = d.Sollstellung.concat([{ sollstellung_id: 999, beitragskonto_id: 1, status: 'bezahlt', sepa_sequenz: 'RCUR', einzugsdatum: wechsel }]);
  assert.strictEqual(rein(g.Sepa.mandatsaenderung(wagner, spaeter)), null);
  // nie eingezogenes Konto (Vogl, neues Mandat): kein Änderungshinweis, FRST genügt
  const vogl = d.Beitragskonto.find(k => k.beitragskonto_id === 9);
  assert.strictEqual(M(Object.assign({}, vogl, { iban_vorher: andereBank, iban_geaendert_am: '2026-10-01' })), null);

  // im Lauf und in der Datei
  const l = g.Sepa.lauf(d, 2027, { heute: '2026-10-25' });
  const p = l.posten.find(x => x.konto === 1);
  assert.deepStrictEqual(rein(p.aenderung), { art: 'bank' });
  assert.strictEqual(p.sequenz, 'RCUR');
  const x = g.Sepa.xml(l, GLAEUBIGER, { erstelltAm: '2026-10-25T12:00:00' });
  assert.match(x.xml, /<DtOfSgntr>[\d-]+<\/DtOfSgntr><AmdmntInd>true<\/AmdmntInd><AmdmntInfDtls><OrgnlDbtrAgt><FinInstnId><Othr><Id>SMNDA<\/Id><\/Othr><\/FinInstnId><\/OrgnlDbtrAgt><\/AmdmntInfDtls><\/MndtRltdInf>/);
  assert.strictEqual((x.xml.match(/<AmdmntInd>/g) || []).length, 1, 'nur das geänderte Konto');
  assert.match(rein(g.Sepa.kontrollliste(l)).find(z => z.konto === 1).aenderung, /SMNDA/);
  wagner.iban_vorher = gleicheBank;
  const x2 = g.Sepa.xml(g.Sepa.lauf(d, 2027, { heute: '2026-10-25' }), GLAEUBIGER, { erstelltAm: '2026-10-25T12:00:00' });
  assert.ok(x2.xml.includes('<AmdmntInfDtls><OrgnlDbtrAcct><Id><IBAN>' + gleicheBank + '</IBAN></Id></OrgnlDbtrAcct></AmdmntInfDtls>'));
  const kl = rein(g.Sepa.kontrollliste(g.Sepa.lauf(d, 2027, { heute: '2026-10-25' }))).find(z => z.konto === 1);
  assert.ok(!kl.aenderung.includes(gleicheBank), 'alte IBAN in der Kontrollliste nur maskiert');

  if (!hatXmllint()) return;
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sepa-')), 'aenderung.xml');
  [x.xml, x2.xml].forEach(inhalt => {
    fs.writeFileSync(datei, inhalt);
    execFileSync('xmllint', ['--noout', '--schema', XSD, datei], { stdio: 'pipe' });
  });
});

test('Kontrollliste ohne volle IBAN', () => {
  const { g, d } = laufDaten();
  const k = rein(g.Sepa.kontrollliste(g.Sepa.lauf(d, 2027, { heute: '2026-10-25' })));
  assert.strictEqual(k.length, 8);
  assert.ok(k.every(z => /••••/.test(z.iban)));
});

test('Großer synthetischer Verein (~1.200): Klärliste, Plan 2027, Lauf, XSD-valide, schnell', (t) => {
  let gen;
  try { gen = require('./daten/generator'); } catch (e) { t.skip('test/daten/generator.js fehlt'); return; }
  const { g } = beitragsdaten();
  const { tabs } = gen.erzeugeVerein({ seed: 7, mitglieder: 1200, stichtag: '2026-10-25', fehler: false });
  const d = gen.alsObjekte(tabs);
  const t0 = Date.now();
  const klaer = g.Beitrag.klaerliste(d, 2026, '2026-10-25');
  // Plausibel: nur ein kleiner Teil des Bestands landet auf der Klärliste (Generatordaten sind nahezu regelkonform).
  assert.ok(klaer.filter(e => e.schwere === 'fehler').length < 30, 'Fehler in der Klärliste: ' + klaer.length);
  const plan = g.Sollstellungslauf.plane(d, 2027, '2026-10-25');
  assert.ok(plan.neu.length > 500, 'Konten geplant: ' + plan.neu.length);
  const maxId = d.Sollstellung.reduce((m, s) => Math.max(m, s.sollstellung_id || 0), 0);
  plan.neu.forEach((s, i) => { s.sollstellung_id = maxId + 1 + i; d.Sollstellung.push(s); });
  const l = g.Sepa.lauf(d, 2027, { heute: '2026-10-25' });
  assert.ok(l.anzahl > 400, 'Posten: ' + l.anzahl);
  assert.ok(Math.abs(l.summe - l.posten.reduce((s, p) => s + p.betrag, 0)) < 0.001);
  const x = g.Sepa.xml(l, GLAEUBIGER, { erstelltAm: '2026-10-25T12:00:00' });
  assert.strictEqual(x.ok, true, JSON.stringify(x.fehler));
  const ms = Date.now() - t0;
  // Großzügige Grenze: der Test läuft parallel zu anderen; er soll grobe Ausreißer finden, nicht Millisekunden messen.
  assert.ok(ms < 20000, 'Laufzeit ' + ms + ' ms');
  if (!hatXmllint()) return;
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sepa-')), 'gross.xml');
  fs.writeFileSync(datei, x.xml);
  execFileSync('xmllint', ['--noout', '--schema', XSD, datei], { stdio: 'pipe' });
});
