/**
 * Tests für src/modul/Finanzen.js und src/api/Finanzen.js gegen die Fakes (synthetischer Verein, 300 Mitglieder).
 * Schwerpunkte: Rechte je Rolle, IBAN nie im Klartext außer „aufdecken“ (protokolliert), Feldfehler, Konsistenz-
 * Guards, Sollstellungslauf mit wenigen Tabellenzugriffen, Statusbuchungen, SEPA-Datei (XSD-validiert), Vier Augen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ladeProjekt, rein, entpacke } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein, alsObjekte } = require('./daten/generator');

const MV = 'verwaltung@tsv-ergoldsbach.de';
const KASSIER = 'kassier@tsv-ergoldsbach.de';
const VORSTAND = 'vorstand@tsv-ergoldsbach.de';
const AL = 'fussball@tsv-ergoldsbach.de';
const XSD = path.join(__dirname, 'xsd', 'pain.008.001.08.xsd');

/** Synthetischer Verein; zusatzKonfig = { schluessel: wert } wird an _Konfig angehängt. */
function verein(zusatzKonfig) {
  const v = erzeugeVerein({ seed: 3, mitglieder: 300 });
  const k = v.tabs._Konfig;
  Object.keys(zusatzKonfig || {}).forEach(s => {
    const z = k[0].map(h => (h === 'schluessel' ? s : h === 'wert' ? zusatzKonfig[s] : ''));
    const vorhanden = k.findIndex(r => r[0] === s);
    if (vorhanden > 0) k[vorhanden] = z; else k.push(z);
  });
  return v.tabs;
}

/** Eine „Ausführung“ als email auf (gemeinsamen) Tabellen. Gleicher Cache = gleiche Snapshot-Basis. */
function als(email, tabs, cache) {
  const f = erzeugeFakes({ tabs, email });
  if (cache) f.globale.CacheService = cache;
  return { f, g: ladeProjekt(f.globale) };
}
function tabsVon(f) {
  const t = {};
  f.datei.getSheets().forEach(b => { t[b.getName()] = f.daten(b.getName()).map(z => z.slice()); });
  return t;
}
function objekte(f, tab) {
  const d = f.daten(tab);
  return d.slice(1).map(z => Object.fromEntries(d[0].map((k, i) => [k, z[i]])));
}
function ok(antwort) {
  const a = rein(antwort);
  assert.strictEqual(a.ok, true, 'Fehler: ' + JSON.stringify(a.fehler));
  return a.daten;
}
function fehlerArt(antwort) { const a = rein(antwort); assert.strictEqual(a.ok, false, 'Fehler erwartet'); return a.fehler; }

const GUELTIG = { verein_iban: 'DE89370400440532013000', verein_glaeubiger_id: 'DE98ZZZ09999999999',
  verein_strasse: 'Sportplatzweg', verein_hausnummer: '1', verein_plz: '84061', verein_ort: 'Ergoldsbach' };

test('Übersicht: Kassier und MV ja, Abteilungsleiter nein; Kennzahlen und Kurzinfo je Konto', () => {
  const tabs = verein();
  const u = ok(als(KASSIER, tabs).g.apiFinanzenUebersicht(2026));
  assert.strictEqual(u.jahr, 2026);
  assert.ok(u.einzugsstand.anzahl > 50);
  assert.strictEqual(Object.keys(u.konten).length, tabs.Beitragskonto.length - 1);
  assert.ok(u.jahre.includes(2026));
  const k = Object.values(u.konten).find(x => x.soll > 0);
  assert.ok(['gueltig', 'ungenutzt', 'verfallen', 'fehlt', 'kein'].includes(k.mandat));
  assert.strictEqual(fehlerArt(als(AL, tabs).g.apiFinanzenUebersicht(2026)).art, 'zugriff');
});

test('Kontodetail: Zusammensetzung (Gemeinschaft + Einzel) summiert sich zum Soll', () => {
  const tabs = verein();
  const { g } = als(MV, tabs);
  const d = alsObjekte(tabs);
  // Konto mit Gemeinschaft UND eigenem Beitrag (Fall „Felix“)
  const konto = d.Beitragskonto.find(k => {
    const ms = d.Mitglied.filter(m => m.beitragskonto_id === k.beitragskonto_id);
    return ms.some(m => m.beitragsgemeinschaft_id) && ms.some(m => !m.beitragsgemeinschaft_id && m.beitragsart_id);
  });
  assert.ok(konto, 'Generator liefert einen Fall „Felix“');
  const det = ok(g.apiFinanzenKonto(konto.beitragskonto_id, 2026));
  const summe = det.soll.positionen.reduce((s, p) => s + p.betrag, 0);
  assert.strictEqual(Math.round(summe * 100) / 100, det.soll.betrag);
  assert.ok(det.soll.positionen.some(p => p.art === 'gemeinschaft') && det.soll.positionen.some(p => p.art === 'einzel'));
  assert.ok(/^TSV-\d{4}-/.test(det.mandatsvorschlag));
});

test('IBAN: nie im Snapshot, Klartext nur über „aufdecken“ mit Protokoll; Abteilungsleiter darf nicht', () => {
  const tabs = verein();
  const { f, g } = als(MV, tabs);
  const snap = JSON.stringify(rein(g.apiSnapshot(['kern', 'finanzen'])));
  const kontoZeile = objekte(f, 'Beitragskonto').find(k => k.iban);
  assert.ok(!snap.includes(kontoZeile.iban), 'Klartext-IBAN im Snapshot');
  const a = ok(g.apiFinanzenIbanAufdecken(kontoZeile.beitragskonto_id));
  assert.strictEqual(a.iban.replace(/\s/g, ''), kontoZeile.iban);
  const prot = objekte(f, '_Protokoll');
  assert.ok(prot.some(p => p.aktion === 'eingesehen' && p.tabelle === 'Beitragskonto' && String(p.datensatz_id) === String(kontoZeile.beitragskonto_id)));
  assert.ok(!prot.some(p => String(p.kommentar).includes(kontoZeile.iban)));
  assert.strictEqual(fehlerArt(als(AL, tabs).g.apiFinanzenIbanAufdecken(kontoZeile.beitragskonto_id)).art, 'zugriff');
});

test('Konto anlegen/ändern: Feldfehler, Mandatsreferenz eindeutig, IBAN-Änderung mit Protokoll alt/neu, Kassier darf nicht', () => {
  const tabs = verein();
  const { f, g } = als(MV, tabs);
  const falsch = fehlerArt(g.apiFinanzenKontoSpeichern(null, null, { kontoinhaber_name: 'Test, Tina', zahlweg: 'Lastschrift', iban: 'DE00123', mandatsdatum: '2026-01-02' }));
  assert.strictEqual(falsch.art, 'fachlich');
  assert.ok(falsch.felder.some(x => x.feld === 'iban') && falsch.felder.some(x => x.feld === 'mandatsreferenz'));
  const vorhandeneRef = objekte(f, 'Beitragskonto').find(k => k.mandatsreferenz).mandatsreferenz;
  const doppelt = fehlerArt(g.apiFinanzenKontoSpeichern(null, null, { kontoinhaber_name: 'Test, Tina', zahlweg: 'Lastschrift', iban: 'DE89 3704 0044 0532 0130 00', mandatsreferenz: vorhandeneRef, mandatsdatum: '2026-01-02' }));
  assert.ok(doppelt.felder.some(x => x.feld === 'mandatsreferenz'));

  const neu = ok(g.apiFinanzenKontoSpeichern(null, null, { kontoinhaber_name: 'Test, Tina', zahlweg: 'Lastschrift', iban: 'de89 3704 0044 0532 0130 00', mandatsreferenz: 'TSV-2026-T1', mandatsdatum: '2026-01-02' }));
  assert.ok(neu.konto_id > 0);
  assert.ok(neu.aktualisiert.konten[0].iban_maskiert && !neu.aktualisiert.konten[0].iban);
  const zeile = objekte(f, 'Beitragskonto').find(k => k.beitragskonto_id === neu.konto_id);
  assert.strictEqual(zeile.iban, 'DE89370400440532013000');

  const geaendert = ok(g.apiFinanzenKontoSpeichern(neu.konto_id, 1, { iban: 'DE02120300000000202051' }));
  assert.strictEqual(geaendert.aktualisiert.konten[0].version, 2);
  const prot = objekte(f, '_Protokoll').filter(p => p.tabelle === 'Beitragskonto' && p.feld === 'iban' && String(p.datensatz_id) === String(neu.konto_id));
  assert.ok(prot.some(p => p.alt_wert === 'DE89370400440532013000' && p.neu_wert === 'DE02120300000000202051'), 'IBAN alt/neu protokolliert');
  // Kontowechsel unter demselben Mandat: alte IBAN für die Mandatsänderung gemerkt, aber nie im Snapshot
  const nachWechsel = objekte(f, 'Beitragskonto').find(k => k.beitragskonto_id === neu.konto_id);
  assert.strictEqual(nachWechsel.iban_vorher, 'DE89370400440532013000');
  assert.ok(nachWechsel.iban_geaendert_am);
  assert.ok(!('iban_vorher' in geaendert.aktualisiert.konten[0]));
  assert.ok(!JSON.stringify(rein(g.apiSnapshot(['kern', 'finanzen']))).includes('iban_vorher'));
  assert.ok(geaendert.hinweise.some(h => /Mandatsänderung/.test(h)));
  // veraltete Version → Konflikt
  assert.strictEqual(fehlerArt(g.apiFinanzenKontoSpeichern(neu.konto_id, 1, { bemerkung: 'x' })).art, 'konflikt');
  // Neuer Inhaber → Hinweis neues Mandat
  const inh = ok(g.apiFinanzenKontoSpeichern(neu.konto_id, 2, { kontoinhaber_name: 'Test, Tom' }));
  assert.ok(inh.hinweise.some(h => /neues, unterschriebenes Mandat/.test(h)));
  assert.ok(!objekte(f, 'Beitragskonto').find(k => k.beitragskonto_id === neu.konto_id).iban_vorher, 'neuer Inhaber: keine Mandatsänderung');

  const kassier = als(KASSIER, tabsVon(f));
  assert.strictEqual(fehlerArt(kassier.g.apiFinanzenKontoSpeichern(neu.konto_id, 3, { bemerkung: 'x' })).art, 'zugriff');
});

test('Guards: Konto mit aktiven Personen nicht stilllegbar; Gemeinschaft nur gemeinsam umhängen', () => {
  const tabs = verein();
  const { g } = als(MV, tabs);
  const d = alsObjekte(tabs);
  const heute = '2026-10-25';
  const zr = {};
  d.Mitgliedschaftszeitraum.forEach(z => (zr[z.mitglied_id] = zr[z.mitglied_id] || []).push(z));
  const aktiv = m => g.Mitgliedschaft.status(m, zr[m.mitglied_id] || [], heute) === 'aktiv';
  const familie = d.Mitglied.filter(m => m.beitragsgemeinschaft_id && aktiv(m));
  const person = familie[0];
  const konto = d.Beitragskonto.find(k => k.beitragskonto_id === person.beitragskonto_id);
  const f1 = fehlerArt(g.apiFinanzenKontoStilllegen(konto.beitragskonto_id, konto.version));
  assert.match(f1.meldung, /aktive Person/);

  const anderes = d.Beitragskonto.find(k => k.aktiv && k.beitragskonto_id !== konto.beitragskonto_id);
  const f2 = fehlerArt(g.apiFinanzenPersonZuordnen(person.mitglied_id, person.version, anderes.beitragskonto_id, false));
  assert.match(f2.meldung, /Gemeinschaft/);
  const r = ok(g.apiFinanzenPersonZuordnen(person.mitglied_id, person.version, anderes.beitragskonto_id, true));
  const umgehaengt = r.aktualisiert.mitglieder.filter(m => m.beitragsgemeinschaft_id === person.beitragsgemeinschaft_id);
  assert.ok(umgehaengt.length >= 2 && umgehaengt.every(m => m.beitragskonto_id === anderes.beitragskonto_id));
});

test('Gemeinschaft: anlegen, Person aufnehmen (übernimmt Konto), entfernen, auflösen', () => {
  const tabs = verein();
  const { g } = als(MV, tabs);
  const d = alsObjekte(tabs);
  const neu = ok(g.apiFinanzenGemeinschaftSpeichern(null, null, { bezeichnung: 'Familie Test', festbetrag: 160 }));
  const gid = neu.gemeinschaft_id;
  const leer = fehlerArt(g.apiFinanzenGemeinschaftSpeichern(null, null, { bezeichnung: '' }));
  assert.ok(leer.felder.some(x => x.feld === 'bezeichnung'));
  const p = d.Mitglied.find(m => !m.beitragsgemeinschaft_id && m.beitragsart_id && m.beitragskonto_id);
  const r = ok(g.apiFinanzenGemeinschaftMitglied(gid, p.mitglied_id, p.version, 'hinzu'));
  const nachher = r.aktualisiert.mitglieder.find(m => m.mitglied_id === p.mitglied_id);
  assert.strictEqual(nachher.beitragsgemeinschaft_id, gid);
  assert.ok(r.hinweise.some(h => /Festbetrag/.test(h)));
  const r2 = ok(g.apiFinanzenGemeinschaftMitglied(gid, p.mitglied_id, nachher.version, 'entfernen'));
  assert.ok(!r2.aktualisiert.mitglieder[0].beitragsgemeinschaft_id);
  const auf = ok(g.apiFinanzenGemeinschaftAufloesen(gid, 1));
  assert.strictEqual(auf.aktualisiert.gemeinschaften[0].aktiv, false);
});

test('Sollstellungslauf: Probelauf, Anlegen mit wenigen Tabellenzugriffen, keine Doppelten, Schutz vor veralteter Vorschau', () => {
  const tabs = verein();
  const { f, g } = als(MV, tabs);
  const plan = ok(g.apiFinanzenSollstellungPlanen(2027));
  assert.ok(plan.anzahl > 50 && plan.summe > 0);
  assert.strictEqual(fehlerArt(g.apiFinanzenSollstellungAnlegen(2027, plan.anzahl + 1)).art, 'fachlich');
  const vorher = objekte(f, 'Sollstellung').length;
  const schreibVorher = (f.zaehler.setValues || 0) + (f.zaehler.appendRow || 0);
  const a = rein(g.apiFinanzenSollstellungAnlegen(2027, plan.anzahl));
  assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
  const schreib = (f.zaehler.setValues || 0) + (f.zaehler.appendRow || 0) - schreibVorher;
  assert.ok(schreib <= 6, 'Schreibzugriffe: ' + schreib);
  assert.ok(a.messung.sheets <= 25, 'Tabellenzugriffe: ' + a.messung.sheets);
  const nach = objekte(f, 'Sollstellung');
  assert.strictEqual(nach.length, vorher + plan.anzahl);
  const ids = nach.map(s => s.sollstellung_id);
  assert.strictEqual(new Set(ids).size, ids.length, 'IDs eindeutig');
  assert.strictEqual(a.daten.aktualisiert.sollstellungen.length, plan.anzahl);
  assert.strictEqual(ok(g.apiFinanzenSollstellungPlanen(2027)).anzahl, 0);
  assert.match(fehlerArt(g.apiFinanzenSollstellungAnlegen(2027)).meldung, /keine neuen/);
  // Protokoll: ein Sammeleintrag
  assert.strictEqual(objekte(f, '_Protokoll').filter(p => p.tabelle === 'Sollstellung' && p.aktion === 'angelegt').length, 1);
});

test('Zahlungsstatus: Rücklastschrift mit Standardgebühr, unzulässiger Übergang, Konflikt; Kassier darf buchen', () => {
  const tabs = verein();
  const { f, g } = als(KASSIER, tabs);
  const s = objekte(f, 'Sollstellung').find(x => x.status === 'bezahlt' && x.jahr === 2026);   // ältere Jahre sind nicht im Snapshot
  const r = ok(g.apiFinanzenSollstellungStatus(s.sollstellung_id, s.version, { art: 'ruecklastschrift', grund: 'Konto erloschen', datum: '2026-03-01' }));
  const neu = r.aktualisiert.sollstellungen[0];
  assert.strictEqual(neu.status, 'ruecklastschrift');
  assert.strictEqual(neu.gebuehr, 5);
  assert.strictEqual(fehlerArt(g.apiFinanzenSollstellungStatus(s.sollstellung_id, s.version, { art: 'gemahnt' })).art, 'konflikt');
  const ohneGrund = fehlerArt(g.apiFinanzenSollstellungStatus(s.sollstellung_id, neu.version, { art: 'storniert' }));
  assert.ok(ohneGrund.felder.some(x => x.feld === 'grund'));
  const st = ok(g.apiFinanzenSollstellungStatus(s.sollstellung_id, neu.version, { art: 'storniert', grund: 'verstorben' }));
  assert.match(fehlerArt(g.apiFinanzenSollstellungStatus(s.sollstellung_id, st.aktualisiert.sollstellungen[0].version, { art: 'bezahlt' })).meldung, /nicht möglich/);
});

test('SEPA: Probelauf ohne Klartext-IBAN, Datei nur mit gültigem Gläubiger, XSD-valide, Vermerke, Sammelbuchung', () => {
  const ohneKonto = verein();
  const x = als(MV, ohneKonto);
  ok(x.g.apiFinanzenSollstellungAnlegen(2027));
  const pl = ok(x.g.apiFinanzenSepaProbelauf(2027));
  assert.ok(pl.anzahl > 0 && pl.glaeubiger_fehler.length > 0);
  const ibans = objekte(x.f, 'Beitragskonto').map(k => k.iban).filter(Boolean);
  const plText = JSON.stringify(pl);
  assert.ok(!ibans.some(i => plText.includes(i)), 'Klartext-IBAN im Probelauf');
  assert.match(fehlerArt(x.g.apiFinanzenSepaXml(2027)).meldung, /Gläubiger|Vereinskontos/);

  const tabs = verein(GUELTIG);
  const { f, g } = als(MV, tabs);
  ok(g.apiFinanzenSollstellungAnlegen(2027));
  const probe = ok(g.apiFinanzenSepaProbelauf(2027));
  assert.deepStrictEqual(probe.glaeubiger_fehler, []);
  const d = ok(g.apiFinanzenSepaXml(2027));
  assert.match(d.dateiname, /^SEPA-Lastschrift_2027_/);
  assert.ok(d.xml.includes('pain.008.001.08') && d.anzahl === probe.anzahl);
  if (fs.existsSync(XSD)) {
    const datei = path.join(os.tmpdir(), 'finanzen-test-' + process.pid + '.xml');
    fs.writeFileSync(datei, d.xml);
    try { execFileSync('xmllint', ['--noout', '--schema', XSD, datei], { stdio: 'pipe' }); }
    catch (e) { if (e.code !== 'ENOENT') assert.fail('XSD: ' + e.stderr); }
    finally { fs.unlinkSync(datei); }
  }
  const soll = objekte(f, 'Sollstellung').filter(s => s.jahr === 2027 && s.sepa_sequenz);
  assert.strictEqual(soll.length, d.anzahl);
  assert.ok(d.aktualisiert.sollstellungen.every(s => s.sepa_sequenz === 'FRST' || s.sepa_sequenz === 'RCUR'));
  const prot = objekte(f, '_Protokoll').filter(p => p.aktion === 'exportiert');
  assert.ok(prot.length === 1 && !objekte(f, 'Beitragskonto').some(k => k.iban && String(prot[0].kommentar).includes(k.iban)));
  // Sammelbuchung
  const sb = ok(g.apiFinanzenSammelBezahlt(2027, null, '2027-02-20'));
  assert.strictEqual(sb.anzahl, d.anzahl);
  assert.ok(objekte(f, 'Sollstellung').filter(s => s.jahr === 2027 && s.sepa_sequenz).every(s => s.status === 'bezahlt'));
  // Abteilungsleiter darf keinen Lauf
  assert.strictEqual(fehlerArt(als(AL, tabsVon(f)).g.apiFinanzenSepaProbelauf(2027)).art, 'zugriff');
});

test('Vier-Augen-Prinzip: Freigabe durch andere Person erforderlich', () => {
  const tabs = verein(Object.assign({ sepa_vier_augen: 'ja' }, GUELTIG));
  const mv = als(MV, tabs);
  ok(mv.g.apiFinanzenSollstellungAnlegen(2027));
  assert.match(fehlerArt(mv.g.apiFinanzenSepaXml(2027)).meldung, /zweiten Person/);
  ok(mv.g.apiFinanzenSepaFreigeben(2027));
  assert.match(fehlerArt(mv.g.apiFinanzenSepaXml(2027)).meldung, /ANDEREN Person/);
  const k = als(KASSIER, tabsVon(mv.f));
  ok(k.g.apiFinanzenSepaFreigeben(2027));
  const mv2 = als(MV, tabsVon(k.f));
  assert.ok(ok(mv2.g.apiFinanzenSepaXml(2027)).anzahl > 0);
});

test('Klärliste, Tarifwechsel (nur MV übernimmt), Buchhaltungsexport protokolliert', () => {
  const tabs = verein();
  const { f, g } = als(MV, tabs);
  const kl = ok(g.apiFinanzenKlaerliste(2026));
  assert.ok(Array.isArray(kl));
  const tw = ok(g.apiFinanzenTarifwechsel(2027));
  const kandidat = tw.find(v => v.nach);
  if (kandidat) {
    const kas = als(KASSIER, tabsVon(f));
    assert.strictEqual(fehlerArt(kas.g.apiFinanzenTarifwechselUebernehmen(2027, [kandidat.mitglied_id])).art, 'zugriff');
    const r = ok(g.apiFinanzenTarifwechselUebernehmen(2027, [kandidat.mitglied_id]));
    assert.strictEqual(r.anzahl, 1);
    assert.strictEqual(objekte(f, 'Mitglied').find(m => m.mitglied_id === kandidat.mitglied_id).beitragsart_id, kandidat.nach);
  }
  const bh = ok(g.apiFinanzenBuchhaltung(2026));
  assert.ok(bh.zeilen.length > 0 && !('iban' in bh.zeilen[0]));
  assert.ok(objekte(f, '_Protokoll').some(p => p.aktion === 'exportiert' && /Buchhaltungsexport/.test(p.kommentar)));
});

test('massenAktualisieren: unveränderte Zeilen mit Formel-Anfang bleiben Text', () => {
  const tabs = verein();
  const kopf = tabs.Sollstellung[0];
  const iB = kopf.indexOf('bemerkung');
  tabs.Sollstellung[1][iB] = '=SUMME(A1)';
  const { f, g } = als(MV, tabs);
  const alle = objekte(f, 'Sollstellung');
  const ids = [alle[0].sollstellung_id, alle[2].sollstellung_id];   // Zeile mit Formel-Text liegt dazwischen
  g.DB.mitSperre(() => g.Finanzen.massenAktualisieren('Sollstellung', { [ids[0]]: { mahnstufe: 2 }, [ids[1]]: { mahnstufe: 1 } }, { email: MV }));
  assert.strictEqual(f.daten('Sollstellung')[1][iB], "'=SUMME(A1)");
});
