/**
 * Tests für src/lib/werte.js – Umwandlung Zelle ↔ Programm, Prüfung, Unterschiede.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');

const { Werte } = ladeProjekt({});
const sp = (typ, extra) => Object.assign({ name: 'x', typ, pflicht: 'nein', liste: null }, extra);

test('Seriennummer ↔ Datum', () => {
  assert.strictEqual(Werte.serialZuDatum(1), '1899-12-31');
  assert.strictEqual(Werte.serialZuDatum(25569), '1970-01-01');
  assert.strictEqual(Werte.serialZuDatum(46251), '2026-08-17');
  assert.strictEqual(Werte.zuSerial('2026-08-17'), 46251);
  assert.strictEqual(Werte.zuSerial('17.08.2026'), 46251);
  // Schaltjahr
  assert.strictEqual(Werte.serialZuDatum(Werte.zuSerial('2024-02-29')), '2024-02-29');
  assert.strictEqual(Werte.zuSerial('2024-03-01') - Werte.zuSerial('2024-02-28'), 2);
  assert.throws(() => Werte.zuSerial('2025-02-29'));
  assert.throws(() => Werte.zuSerial('31.04.2026'));
});

test('Seriennummer ↔ Zeitpunkt, zeitzonenfrei', () => {
  const n = Werte.zuSerial('2026-08-17T19:42:05');
  assert.strictEqual(Werte.serialZuZeitpunkt(n), '2026-08-17T19:42:05');
  assert.strictEqual(Werte.serialZuZeitpunkt(Werte.zuSerial('17.08.2026 19:42')), '2026-08-17T19:42:00');
  // Tag der Zeitumstellung: keine Verschiebung
  assert.strictEqual(Werte.serialZuZeitpunkt(Werte.zuSerial('2026-03-29T02:30:00')), '2026-03-29T02:30:00');
  assert.strictEqual(Werte.serialZuDatum(n), '2026-08-17');
});

test('zelleLesen / zelleSchreiben je Typ', () => {
  assert.strictEqual(Werte.zelleLesen('', sp('Text')), null);
  assert.strictEqual(Werte.zelleLesen(46251, sp('Datum')), '2026-08-17');
  assert.strictEqual(Werte.zelleLesen('17.08.2026', sp('Datum')), '2026-08-17');
  assert.strictEqual(Werte.zelleLesen('ja', sp('ja/nein')), true);
  assert.strictEqual(Werte.zelleLesen('Nein', sp('ja/nein')), false);
  assert.strictEqual(Werte.zelleLesen('5,50', sp('Dezimal')), 5.5);
  assert.strictEqual(Werte.zelleLesen(84061, sp('Text')), '84061');
  assert.strictEqual(Werte.zelleLesen('0873', sp('Text')), '0873');
  assert.strictEqual(Werte.zelleSchreiben(true, sp('ja/nein')), 'ja');
  assert.strictEqual(Werte.zelleSchreiben(false, sp('ja/nein')), 'nein');
  assert.strictEqual(Werte.zelleSchreiben(null, sp('Datum')), '');
  assert.strictEqual(Werte.zelleSchreiben('2026-08-17', sp('Datum')), 46251);
  assert.strictEqual(Werte.zelleSchreiben(10.005, sp('Dezimal')), 10.01);
  assert.throws(() => Werte.zelleSchreiben('vielleicht', sp('ja/nein')));
});

test('Zeile ↔ Objekt über Spaltennamen, fremde Spalten bleiben erhalten', () => {
  const kopf = ['nachname', 'abteilung_id', 'notiz_extern', 'bezeichnung', 'aktiv'];
  const zeile = ['ignoriert', 3, 'bleibt', 'Tennis', 'ja'];
  const obj = Werte.zeileZuObjekt(kopf, zeile, 'Abteilung');
  assert.strictEqual(obj.abteilung_id, 3);
  assert.strictEqual(obj.bezeichnung, 'Tennis');
  assert.strictEqual(obj.aktiv, true);
  assert.strictEqual(obj.meldepflichtig, null);
  assert.ok(!('nachname' in obj));
  const neu = Werte.objektZuZeile(kopf, { bezeichnung: 'Tennis & Padel', aktiv: false }, 'Abteilung', zeile);
  assert.deepStrictEqual(rein(neu), ['ignoriert', 3, 'bleibt', 'Tennis & Padel', 'nein']);
});

test('pruefe: Pflicht, Typ, Auswahlliste, unbekannte Felder, teilweise', () => {
  const ok = { mitglied_id: 1, abteilung_id: 2, status: 'aktiv', eintrittsdatum: '2026-01-01' };
  assert.deepStrictEqual(rein(Werte.pruefe('Abteilungszugehoerigkeit', ok)), []);
  const fehler = rein(Werte.pruefe('Abteilungszugehoerigkeit',
    { mitglied_id: 'eins', status: 'halb', eintrittsdatum: '2026-13-01', gibtsnicht: 1 }));
  const felder = fehler.map(f => f.feld).sort();
  assert.deepStrictEqual(felder, ['abteilung_id', 'eintrittsdatum', 'gibtsnicht', 'mitglied_id', 'status']);
  assert.ok(fehler.every(f => typeof f.meldung === 'string' && f.meldung.length > 5));
  // teilweise: fehlende Pflichtfelder sind kein Fehler
  assert.deepStrictEqual(rein(Werte.pruefe('Abteilungszugehoerigkeit', { status: 'passiv' }, { teilweise: true })), []);
  assert.strictEqual(Werte.pruefe('Abteilungszugehoerigkeit', { status: null }, { teilweise: true }).length, 1);
  // PK und auto werden nicht verlangt
  assert.deepStrictEqual(rein(Werte.pruefe('Abteilungszugehoerigkeit', Object.assign({ version: null }, ok))), []);
});

test('diff ignoriert technische Felder und behandelt leer = null', () => {
  const alt = { bezeichnung: 'Tennis', bemerkung: null, version: 3, geaendert_am: '2026-01-01T00:00:00' };
  const neu = { bezeichnung: 'Tennis', bemerkung: '', version: 4, geaendert_am: '2026-02-01T00:00:00', aktiv: false };
  assert.deepStrictEqual(rein(Werte.diff('Abteilung', alt, neu)), [{ feld: 'aktiv', alt: null, neu: false }]);
});

test('Formelschutz: Texte mit = + - @ am Anfang werden beim Schreiben entschärft und beim Lesen wiederhergestellt', () => {
  const g = ladeProjekt({});
  const sp = { name: 'bemerkung', typ: 'Langtext' };
  assert.strictEqual(g.Werte.zelleSchreiben('=HYPERLINK("x")', sp), '\'=HYPERLINK("x")');
  assert.strictEqual(g.Werte.zelleSchreiben('+49 170', sp), "'+49 170");
  assert.strictEqual(g.Werte.zelleSchreiben('normal', sp), 'normal');
  assert.strictEqual(g.Werte.zelleLesen("'+49 170", sp), '+49 170');
  assert.strictEqual(g.Werte.zelleLesen('+49 170', sp), '+49 170');
  assert.strictEqual(g.Werte.zelleLesen("'Apostroph", sp), "'Apostroph");
});
