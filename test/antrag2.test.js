/**
 * Tests für das Online-Antragsformat „tsv-antrag-2“ (src/lib/antrag2.js) und seine Planung im Beitritts-Import
 * (src/lib/beitritt.js, src/modul/Beitritt.js): Prüfung und Umwandlung, Tarif-Schlüssel → Beitragsart bzw.
 * Gemeinschaft mit Betrag aus den Stammdaten, Abteilungs-Schlüssel, Vertretung, externer Kontoinhaber,
 * Einwilligungen, Mandatsdatum; außerdem: Beitragsänderung zieht Familienpauschalen mit.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');
const { beitragsdaten } = require('./hilfe/beitragsdaten');

const DATEN = path.join(__dirname, 'daten', 'beitritt');
const json = n => fs.readFileSync(path.join(DATEN, n), 'utf8');
const objekt = n => JSON.parse(json(n));

function umgebung() {
  const v = erzeugeVerein({ seed: 5, mitglieder: 300 });
  const k = v.tabs.Benutzer[0];
  const z = v.tabs.Benutzer.slice(1).find(r => r[k.indexOf('rolle')] === 'Mitgliederverwalter');
  const f = erzeugeFakes({ tabs: v.tabs, email: z[k.indexOf('email')] });
  return { f, g: ladeProjekt(f.globale) };
}
function ok(a) { a = rein(a); assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return a.daten; }

test('Umwandlung: Felder wie Daten16, IBAN nur bei Person 1, Schlüssel vereinheitlicht, Einwilligungen, Fehler', () => {
  const { Antrag2 } = ladeProjekt({});
  const a = rein(Antrag2.zuAntrag(json('online-familie.json'), 'f.json'));
  assert.strictEqual(a.personen.length, 3);
  assert.strictEqual(a.personen[0].IBAN, 'DE89370400440532013000');
  assert.ok(!('IBAN' in a.personen[1]), 'Bankdaten nur bei Person 1');
  assert.strictEqual(a.personen[2].Strasse, 'Hauptstraße 5', 'Anschrift für alle');
  assert.strictEqual(a.personen[0].EinDat, '2026-11-01');
  assert.strictEqual(a.unterschrift_am, '2026-10-25');
  assert.deepStrictEqual(a.online.abteilungen, ['fussball', 'fitness-turnen', 'leichtathletik']);
  assert.deepStrictEqual(a.online.einwilligungen, ['Fotos und Videos', 'Ehrungen und Geburtstage in Vereinsmedien']);
  assert.strictEqual(Antrag2.schluessel('Fitness Turnen'), 'fitness-turnen');
  assert.strictEqual(Antrag2.schluessel('Fußball'), 'fussball');
  assert.deepStrictEqual([...Antrag2.schluesselListe('kind, Jugendliche')], ['kind', 'jugendliche']);
  assert.match(Antrag2.zuAntrag('{"format":"anders"}').fehler, /Unbekanntes Format/);
  assert.match(Antrag2.zuAntrag('{kaputt').fehler, /JSON/);
  assert.match(Antrag2.zuAntrag({ format: 'tsv-antrag-2', personen: [{ vorname: 'X' }] }).fehler, /Vor- und Nachname/);
  // Felder, die nicht ins Format gehören, werden ignoriert
  const o = objekt('online-kind.json');
  o.personen[0].iban = 'DE00'; o.gesamtbeitrag = 999;
  const k = rein(Antrag2.zuAntrag(o));
  assert.strictEqual(k.personen[0].IBAN, 'DE89370400440532013000', 'IBAN nur aus „konto“');
  assert.ok(!JSON.stringify(k).includes('999'), 'kein Betrag aus dem Antrag');
});

test('Familie: Gemeinschaft mit Betrag aus den Stammdaten (nicht aus dem Antrag), Abteilungen über Schlüssel, Einwilligungen', () => {
  const { g } = umgebung();
  const v = ok(g.apiBeitrittVorschau([{ datei: 'online-familie.json', json: json('online-familie.json') }]));
  const a = v.antraege[0];
  assert.deepStrictEqual(rein(a.tarif), { schluessel: 'familienbeitrag', beitragsart: 'Familienbeitrag', gemeinschaft: 'Familie Onlinebeispiel', betrag: 180 });
  assert.deepStrictEqual(rein(a.gemeinschaft), { bezeichnung: 'Familie Onlinebeispiel', festbetrag: 180 });
  assert.ok(a.personen.every(p => p.in_gemeinschaft && p.beitragsart_id === null));
  assert.ok(a.personen.every(p => p.abteilungen.length === 2), 'Fußball und Turnen');
  assert.ok(a.warnungen.some(w => /„leichtathletik“ .* keiner Abteilung zugeordnet/.test(w)));
  assert.strictEqual(a.konto.mandatsdatum, '2026-10-25');
  assert.strictEqual(a.konto_extern, false);
  assert.ok(!JSON.stringify(v).includes('0532013000'), 'keine Klartext-IBAN in der Vorschau');

  const r = ok(g.apiBeitrittImportieren([{ datei: 'online-familie.json', json: json('online-familie.json') }], [{ index: 0 }]));
  const ids = r.ergebnisse[0].personen.map(p => p.mitglied_id);
  const db = g.DB.lese(['Mitglied', 'Beitragsgemeinschaft', 'Einwilligung', 'Abteilungszugehoerigkeit', 'Beitragskonto']);
  const neu = db.Mitglied.filter(m => ids.includes(m.mitglied_id));
  const gem = db.Beitragsgemeinschaft.find(x => x.beitragsgemeinschaft_id === neu[0].beitragsgemeinschaft_id);
  assert.strictEqual(gem.festbetrag, 180);
  assert.strictEqual(db.Einwilligung.filter(e => ids.includes(e.mitglied_id)).length, 6, '3 Personen × 2 Einwilligungen');
  const lukas = neu.find(m => m.vorname === 'Lukas');
  const ewLukas = db.Einwilligung.find(e => e.mitglied_id === lukas.mitglied_id);
  assert.deepStrictEqual([ewLukas.erteilt_am, ewLukas.erteilt_form, ewLukas.erteilt_durch], ['2026-10-25', 'Aufnahmeantrag', 'Hans Onlinebeispiel']);
  assert.strictEqual(lukas.vertreter_mitglied_id, ids[0], 'Kind: Vertretung durch Person 1');
  const konto = db.Beitragskonto.find(k => k.beitragskonto_id === r.ergebnisse[0].konto_id);
  assert.strictEqual(konto.kontoinhaber_mitglied_id, ids[0]);
});

test('Kind: Einzeltarif über Schlüssel, Unterschrift durch Erziehungsberechtigte → Vertretung, Konto ohne Mitgliedsbezug', () => {
  const { g } = umgebung();
  const r = ok(g.apiBeitrittImportieren([{ datei: 'online-kind.json', json: json('online-kind.json') }], [{ index: 0 }]));
  const e = r.ergebnisse[0];
  assert.ok(e.ok, JSON.stringify(e));
  assert.ok(e.warnungen.some(w => /keine Person des Antrags/.test(w)));
  const db = g.DB.lese(['Mitglied', 'Beitragskonto', 'Einwilligung']);
  const mia = db.Mitglied.find(m => m.mitglied_id === e.personen[0].mitglied_id);
  assert.deepStrictEqual([mia.beitragsart_id, mia.vertreter_name, mia.beitragsgemeinschaft_id], [2, 'Petra Onlinekind', null]);
  const konto = db.Beitragskonto.find(k => k.beitragskonto_id === e.konto_id);
  assert.deepStrictEqual([konto.kontoinhaber_name, konto.kontoinhaber_mitglied_id, konto.mandatsdatum], ['Petra Onlinekind', null, '2026-10-24']);
  assert.strictEqual(db.Einwilligung.find(x => x.mitglied_id === mia.mitglied_id).erteilt_durch, 'Petra Onlinekind');
});

test('Tarif ohne Zuordnung bzw. mehrdeutig: Warnung, kein Raten über Beträge; Einzeltarif mit unpassendem Alter', () => {
  const { g } = umgebung();
  const vorschau = o => ok(g.apiBeitrittVorschau([{ datei: 'x.json', json: JSON.stringify(o) }])).antraege[0];
  const o = objekt('online-familie.json');
  o.tarif = 'schueler';
  const a = vorschau(o);
  assert.ok(a.warnungen.some(w => /Tarif „schueler“ ist keiner Beitragsart zugeordnet/.test(w)));
  assert.strictEqual(a.gemeinschaft, null);
  o.tarif = 'erwachsene';
  const b = vorschau(o);
  assert.ok(b.warnungen.some(w => /Lukas: Alter \d+ passt nicht zu „Erwachsene“/.test(w)));
  assert.ok(b.personen.every(p => p.beitragsart_id === 1));
});

test('Beitragsänderung: neuer Familientarif zieht bestehende Familienpauschalen mit', () => {
  const { g, d } = beitragsdaten();
  d.Beitragsart.push({ beitragsart_id: 9, bezeichnung: 'Familienbeitrag', betrag: 180, aktiv: true, als_gemeinschaft: 'Familie', online_schluessel: 'familienbeitrag' });
  const r = rein(g.Beitrag.beitragsaenderung(d, 2027, { arten: [{ beitragsart_id: 9, betrag: 200 }], festbetraege: [{ alt: 180, neu: 180 }] }));
  assert.deepStrictEqual(r.fehler, []);
  assert.deepStrictEqual(r.gemeinschaften.map(x => [x.alt, x.neu]), [[180, 200]], 'Familie Wagner zieht mit');
  assert.strictEqual(r.konten.find(k => k.beitragskonto_id === 1).neu, 300);
});
