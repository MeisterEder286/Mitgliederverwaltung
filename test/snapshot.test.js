/**
 * Tests für den Snapshot (src/lib/snapshot.js, src/Snapshot.js): Zeilen- und Feldschnitt je Rolle mit
 * Negativtests, IBAN-Freiheit, write-through, Tabellenzugriffe beim Kalt-/Warmstart, Lasttest mit 1200 Personen.
 * Beispieldaten aus test/daten/beispiel (Wagner, Obermeier, Vogl …), Stichtag 25.10.2026.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { ladeProjekt, rein, entpacke } = require('./hilfe/projekt');
const { erzeugeFakes, beispielTabs } = require('./hilfe/gas-fakes');

const HEUTE = '2026-10-25';
const TABS = ['Mitglied', 'Mitgliedschaftszeitraum', 'Abteilung', 'Abteilungszugehoerigkeit', 'Funktionsart', 'Funktion',
  'Beitragsart', 'Beitragsgemeinschaft', 'Beitragskonto', 'Sollstellung', 'Qualifikationsart', 'Qualifikation',
  'Ehrungsregel', 'Ehrung', 'Einwilligung', '_Konfig', 'Benutzer', '_Protokoll', '_Messung'];

function aufbau(email) {
  const f = erzeugeFakes({ tabs: beispielTabs(TABS), email: email || 'verwaltung@tsv-ergoldsbach.de' });
  return { f, g: ladeProjekt(f.globale) };
}

/** Basis aus den Beispieldaten und ein Kontext je Rolle. */
const { g } = aufbau();
const roh = g.DB.lese(TABS);
const konfig = {};
roh._Konfig.forEach(z => { konfig[z.schluessel] = String(z.wert); });
const basis = g.SnapshotKern.basisAusTabs(roh, konfig);
function ktx(rolle, abteilungen) {
  const zeilen = [].concat(rolle).map((r, i) => ({ email: 'x@tsv.de', rolle: r, aktiv: true, abteilung_id: (abteilungen || [])[i] || null }));
  return g.Rechte.kontext(zeilen, 'x@tsv.de');
}
const sicht = (k) => rein(g.SnapshotKern.fuer(basis, k, HEUTE));
const ids = (s) => s.mitglieder.map(m => m.mitglied_id).sort((a, b) => a - b);

test('Mitgliederverwalter: alle Personen inkl. anonymisierter, Finanzlisten ohne IBAN-Klartext', () => {
  const s = sicht(ktx('Mitgliederverwalter'));
  assert.strictEqual(s.mitglieder.length, 14);
  assert.ok(s.konten.length > 0 && s.sollstellungen.length > 0 && s.qualifikationen.length > 0);
  const json = JSON.stringify(s);
  assert.ok(!json.includes('DE89370400440532013000'), 'IBAN-Klartext im Snapshot');
  assert.ok(!json.includes('COBADEFFXXX'), 'BIC im Snapshot');
  s.konten.forEach(k => { assert.ok(!('iban' in k) && !('bic' in k)); });
  const wagner = s.konten.find(k => k.beitragskonto_id === 1);
  assert.strictEqual(wagner.iban_maskiert, 'DE89 •••• 3000');
  assert.strictEqual(wagner.iban_ok, true);
});

test('Abteilungsleiter Fußball: nur Personen mit Fußball-Bezug, nur Fußball-Zeilen, keine Finanzen', () => {
  const s = sicht(ktx('Abteilungsleiter', [1]));
  assert.deepStrictEqual(ids(s), [1, 3, 4, 8, 10, 11, 12, 13]);
  ['konten', 'sollstellungen', 'gemeinschaften'].forEach(l => assert.ok(!(l in s), l + ' sichtbar'));
  s.zugehoerigkeiten.forEach(z => assert.strictEqual(z.abteilung_id, 1));
  s.funktionen.forEach(f => assert.strictEqual(f.abteilung_id, 1));
  const michael = s.mitglieder.find(m => m.mitglied_id === 1);
  assert.deepStrictEqual(michael.abteilungen, [1], 'Stockschützen-Zugehörigkeit darf nicht erscheinen');
  ['beitragskonto_id', 'beitragsart_id', 'beitragsgemeinschaft_id', 'verarbeitung_eingeschraenkt', 'loeschbar_ab']
    .forEach(f => assert.ok(!(f in michael), f + ' sichtbar'));
  // Qualifikationen nur von Personen mit laufender Funktion in Fußball (nicht Anna Huber, Turnen)
  assert.ok(s.qualifikationen.length > 0);
  s.qualifikationen.forEach(q => assert.ok([4, 8, 11, 12, 13].includes(q.mitglied_id), 'Qualifikation ' + q.mitglied_id));
  // Ehrungen/Zeiträume nur von sichtbaren Personen
  s.zeitraeume.forEach(z => assert.ok(ids(s).includes(z.mitglied_id)));
  s.ehrungen.forEach(e => assert.ok(ids(s).includes(e.mitglied_id)));
  assert.ok(!s.mitglieder.some(m => m.mitglied_id === 6), 'Huber (Turnen) sichtbar');
});

test('Abteilungsleiter ohne Abteilung sieht niemanden', () => {
  assert.strictEqual(sicht(ktx('Abteilungsleiter')).mitglieder.length, 0);
});

test('Kassier: alle Mitglieder (ohne anonymisierte), Finanzen ja, Qualifikationen und Ampel nein', () => {
  const s = sicht(ktx('Kassier'));
  assert.strictEqual(s.mitglieder.length, 13);
  assert.ok(!('qualifikationen' in s));
  s.mitglieder.forEach(m => assert.ok(!('fz_ampel' in m)));
  assert.ok(s.konten.length > 0);
});

test('Jugendleiter: Minderjährige und Personen mit FZ-pflichtiger laufender Funktion', () => {
  const s = sicht(ktx('Jugendleiter'));
  assert.deepStrictEqual(ids(s), [3, 4, 6, 8, 11, 12, 13]);
  assert.ok(!('konten' in s));
  assert.strictEqual(s.mitglieder.find(m => m.mitglied_id === 3).jugend, true);
});

test('Mehrfachrolle Abteilungsleiter + Jugendleiter = Vereinigung der Personenkreise', () => {
  const s = sicht(ktx(['Abteilungsleiter', 'Jugendleiter'], [1]));
  assert.deepStrictEqual(ids(s), [1, 3, 4, 6, 8, 10, 11, 12, 13]);
});

test('gesperrte Personen nur für Rollen mit Sichtklasse verwaltung', () => {
  const b2 = g.SnapshotKern.aenderungAnwenden(basis, [{ tab: 'Mitglied', neu: Object.assign({}, roh.Mitglied.find(m => m.mitglied_id === 7), { verarbeitung_eingeschraenkt: true }) }]);
  assert.ok(!rein(g.SnapshotKern.fuer(b2, ktx('Kassier'), HEUTE)).mitglieder.some(m => m.mitglied_id === 7));
  assert.ok(rein(g.SnapshotKern.fuer(b2, ktx('Mitgliederverwalter'), HEUTE)).mitglieder.some(m => m.mitglied_id === 7));
  assert.strictEqual(g.SnapshotKern.mitgliedSichtbar(b2, ktx('Kassier'), HEUTE, 7), false);
});

test('abgeleitete Felder und FZ-Ampel', () => {
  const s = sicht(ktx('Mitgliederverwalter'));
  const m = (id) => s.mitglieder.find(x => x.mitglied_id === id);
  assert.strictEqual(m(5).mitglied_seit, '1986-04-01');
  assert.strictEqual(m(9).status_abgeleitet, 'verstorben');
  assert.strictEqual(m(12).fz_ampel, 'rot', 'Vogl: FZ fehlt');
  assert.strictEqual(m(13).fz_ampel, 'rot', 'Lehner: Wiedervorlage 18.10.2026 überschritten');
  assert.strictEqual(m(4).fz_ampel, 'gruen');
  assert.strictEqual(m(1).fz_ampel, null, 'ohne FZ-pflichtige Funktion keine Ampel');
  assert.deepStrictEqual(m(8).funktionen_laufend, [7]);
  assert.strictEqual(m(3).alter, 14);
});

test('aenderungAnwenden ist rein und antwortFuer liefert Zeile + neu abgeleitetes Mitglied', () => {
  const vorher = JSON.stringify(basis);
  const z = Object.assign({}, roh.Abteilungszugehoerigkeit.find(a => a.zugehoerigkeit_id === 2), { austrittsdatum: '2026-10-01' });
  const b2 = g.SnapshotKern.aenderungAnwenden(basis, [{ tab: 'Abteilungszugehoerigkeit', neu: z }]);
  assert.strictEqual(JSON.stringify(basis), vorher, 'Basis wurde verändert');
  const a = rein(g.SnapshotKern.antwortFuer(b2, ktx('Mitgliederverwalter'), HEUTE, [{ tab: 'Abteilungszugehoerigkeit', neu: z }]));
  assert.strictEqual(a.aktualisiert.zugehoerigkeiten[0].austrittsdatum, '2026-10-01');
  assert.deepStrictEqual(a.aktualisiert.mitglieder[0].abteilungen, [1]);
  // Für den Fußball-AL ist die Stockschützen-Zeile unsichtbar → steht unter entfernt, nicht unter aktualisiert
  const al = rein(g.SnapshotKern.antwortFuer(b2, ktx('Abteilungsleiter', [1]), HEUTE, [{ tab: 'Abteilungszugehoerigkeit', neu: z }]));
  assert.ok(!al.aktualisiert.zugehoerigkeiten);
  assert.deepStrictEqual(al.entfernt.zugehoerigkeiten, [2]);
  // IBAN einer neuen Kontozeile wird beim Einspielen entfernt
  const k = Object.assign({}, roh.Beitragskonto[0], { iban: 'DE89370400440532013000' });
  const b3 = g.SnapshotKern.aenderungAnwenden(basis, [{ tab: 'Beitragskonto', neu: k }]);
  assert.ok(!JSON.stringify(b3).includes('DE89370400440532013000'));
});

test('Rechte.erlaubteSchreibfelder: keine ID, keine technischen/auto-Felder, nur sichtbare Klassen', () => {
  const w = { mitglied_id: 99, version: 7, status: 'aktiv', loeschbar_ab: '2030-01-01', ort: 'X', beitragskonto_id: 3, vorname: 'Y' };
  assert.deepStrictEqual(rein(g.Rechte.erlaubteSchreibfelder(ktx('Abteilungsleiter', [1]), 'Mitglied', w)), { vorname: 'Y', ort: 'X' });
  assert.deepStrictEqual(rein(g.Rechte.erlaubteSchreibfelder(ktx('Mitgliederverwalter'), 'Mitglied', w)), { vorname: 'Y', ort: 'X', beitragskonto_id: 3 });
});

// ---------------------------------------------------------------- Server-Modul mit Fakes

test('apiStart kalt: 1 Tabellenzugriff, warm (neue Ausführung, gleicher Cache): 0', () => {
  const { f, g: s } = aufbau();
  const a = rein(s.apiStart());
  assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
  assert.strictEqual(a.messung.sheets, 1, 'kalt');
  assert.strictEqual(f.zaehler.batchGet, 1);
  assert.strictEqual(entpacke(a.daten.snapshot).mitglieder.length, 14);
  assert.strictEqual(a.daten.heute.length, 10);
  assert.ok(a.daten.konfig.beitragsjahr);
  // neue Ausführung (eigener Kontext) mit demselben CacheService
  const f2 = erzeugeFakes({ tabs: beispielTabs(TABS), email: 'verwaltung@tsv-ergoldsbach.de' });
  f2.globale.CacheService = f.globale.CacheService;
  const s2 = ladeProjekt(f2.globale);
  const b = rein(s2.apiStart());
  assert.strictEqual(b.messung.sheets, 0, 'warm');
  assert.strictEqual(f2.zaehler.sheets, 0);
  assert.strictEqual(entpacke(rein(s2.apiSnapshot()).daten).mitglieder.length, 14);
});

test('write-through: Änderung steht ohne erneutes Lesen im nächsten Snapshot; AL darf fremde Person nicht', () => {
  const { f, g: s } = aufbau();
  s.apiStart();   // Cache füllen
  const k = s.Zugriff.pruefe('mitglied_bearbeiten');
  const antwort = rein(s.DB.mitSperre(() => {
    s.Snapshot.pruefeMitglied(k, 7);
    const r = s.DB.aktualisieren('Mitglied', 7, { ort: 'Landshut' }, 0, k);
    return s.Snapshot.schreibe(k, [{ tab: 'Mitglied', neu: r.neu }]);
  }));
  assert.strictEqual(antwort.aktualisiert.mitglieder[0].ort, 'Landshut');
  const f2 = erzeugeFakes({ tabs: beispielTabs(TABS), email: 'verwaltung@tsv-ergoldsbach.de' });   // Tabelle bewusst ALT
  f2.globale.CacheService = f.globale.CacheService;
  const s2 = ladeProjekt(f2.globale);
  const snap = rein(s2.apiSnapshot());
  assert.strictEqual(f2.zaehler.batchGet || 0, 0, 'kein Lesezugriff');
  assert.strictEqual(entpacke(snap.daten).mitglieder.find(m => m.mitglied_id === 7).ort, 'Landshut');
  // Abteilungsleiter Fußball → Fischer (Tennis) ist nicht sichtbar
  const f3 = erzeugeFakes({ tabs: beispielTabs(TABS), email: 'obermeier@tsv-ergoldsbach.de' });
  const s3 = ladeProjekt(f3.globale);
  const kAl = s3.Zugriff.pruefe('start');
  assert.throws(() => s3.Snapshot.pruefeMitglied(kAl, 7), e => e.art === 'zugriff');
  s3.Snapshot.pruefeMitglied(kAl, 12);
});

test('Lasttest 1200 Personen: Größe und Laufzeit', () => {
  const { erzeugeVerein, alsObjekte } = require('./daten/generator');
  const { tabs } = erzeugeVerein({ seed: 7, mitglieder: 1200, stichtag: HEUTE });
  const o = alsObjekte(tabs);
  const kf = {};
  (o._Konfig || []).forEach(z => { kf[z.schluessel] = String(z.wert); });
  const b = g.SnapshotKern.basisAusTabs(o, kf);
  const basisJson = JSON.stringify(b);
  const gz = zlib.gzipSync(basisJson).length;
  const zeiten = {};
  const groessen = {};
  [['Mitgliederverwalter'], ['Kassier'], ['Abteilungsleiter', [1]], ['Jugendleiter']].forEach(([r, a]) => {
    const t0 = process.hrtime.bigint();
    const s = g.SnapshotKern.fuer(b, ktx(r, a), HEUTE);
    zeiten[r] = Number(process.hrtime.bigint() - t0) / 1e6;
    groessen[r] = Math.round(JSON.stringify(s).length / 1024);
  });
  console.log('# Basis JSON ' + Math.round(basisJson.length / 1024) + ' KB, gzip ' + Math.round(gz / 1024) +
    ' KB (Base64 ≈ ' + Math.round(gz * 4 / 3 / 1024) + ' KB); Client-Snapshot KB ' + JSON.stringify(groessen) +
    '; fuer() ms ' + JSON.stringify(Object.fromEntries(Object.entries(zeiten).map(([k, v]) => [k, Math.round(v)]))));
  assert.ok(gz < 500 * 1024, 'gzip-Basis zu groß: ' + gz);
  Object.values(zeiten).forEach(ms => assert.ok(ms < 300, 'fuer() zu langsam: ' + ms));
  assert.ok(!basisJson.includes('"iban"'), 'IBAN-Feld in der Basis');
});

test('Bereiche und Spaltenform: Start nur Kern, Finanzen/Historie auf Anforderung, Rolle ohne Finanzsicht bekommt keine', () => {
  const f = erzeugeFakes({ tabs: beispielTabs(TABS), email: 'verwaltung@tsv-ergoldsbach.de' });
  const g = ladeProjekt(f.globale);
  const kern = rein(g.apiSnapshot()).daten;
  assert.deepStrictEqual(kern.bereiche, ['kern']);
  assert.ok(kern.listen.mitglieder.k.includes('mitglied_id'));
  assert.ok(!kern.listen.konten && !kern.listen.zeitraeume);
  const fin = entpacke(rein(g.apiSnapshot(['finanzen', 'historie'])).daten);
  assert.ok(fin.konten.length && fin.zeitraeume.length && !fin.mitglieder);
  const al = ladeProjekt(erzeugeFakes({ tabs: beispielTabs(TABS), email: 'obermeier@tsv-ergoldsbach.de' }).globale);
  const alFin = rein(al.apiSnapshot(['finanzen'])).daten;
  assert.ok(!alFin.listen.konten && !alFin.listen.sollstellungen, 'AL bekommt keine Finanzlisten');
});
