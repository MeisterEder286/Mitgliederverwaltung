/**
 * Tests für src/lib/sollstellung.js – Jahresplanung ohne Doppelte, Statusübergänge, Einzugsstand.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { rein } = require('./hilfe/projekt');
const { beitragsdaten } = require('./hilfe/beitragsdaten');

test('plane: neues Jahr für alle aktiven Konten, Summe, stillgelegte übersprungen', () => {
  const { g, d } = beitragsdaten();
  const p = rein(g.Sollstellungslauf.plane(d, 2027, '2026-10-25'));
  assert.strictEqual(p.neu.length, 9);
  assert.strictEqual(p.summe, 1080);
  const wagner = p.neu.find(s => s.beitragskonto_id === 1);
  assert.strictEqual(wagner.soll_betrag, 280);
  assert.strictEqual(wagner.status, 'offen');
  assert.strictEqual(wagner.einzugsdatum, '2027-02-15');
  assert.match(wagner.bemerkung, /Familie Wagner/);
  assert.deepStrictEqual(p.uebersprungen.map(u => u.konto_id).sort(), [11, 6]);
});

test('plane: vorhandene (Konto, Jahr) nie doppelt; Nachzügler mit Vorlauf', () => {
  const { g, d } = beitragsdaten();
  const p = g.Sollstellungslauf.plane(d, 2026, '2026-10-25');
  const vorhandeneKonten = d.Sollstellung.filter(s => s.jahr === 2026).map(s => s.beitragskonto_id);
  p.neu.forEach(s => assert.ok(!vorhandeneKonten.includes(s.beitragskonto_id), 'doppelt: ' + s.beitragskonto_id));
  assert.strictEqual(p.vorhanden.length, vorhandeneKonten.length);
  p.neu.forEach(s => assert.strictEqual(s.einzugsdatum, '2026-11-08', 'Fälligkeit vorbei → heute + 14 Tage'));
});

test('naechsterStatus: Übergänge, Mahnstufe, Gebühr, unzulässige Wechsel', () => {
  const { g } = beitragsdaten();
  const N = g.Sollstellungslauf.naechsterStatus;
  const s = { status: 'offen', soll_betrag: 100, mahnstufe: 0 };
  assert.deepStrictEqual(rein(N(s, { art: 'bezahlt', datum: '2026-02-15' })), { status: 'bezahlt', ist_betrag: 100, buchungsdatum: '2026-02-15' });
  const r = rein(N({ status: 'bezahlt', soll_betrag: 100 }, { art: 'ruecklastschrift', grund: 'Konto erloschen', datum: '2026-02-20' }, { ruecklastschrift_gebuehr: '5,00' }));
  assert.strictEqual(r.status, 'ruecklastschrift');
  assert.strictEqual(r.gebuehr, 5);
  assert.strictEqual(r.ist_betrag, 0);
  assert.strictEqual(N({ status: 'ruecklastschrift', mahnstufe: 1 }, { art: 'gemahnt' }).mahnstufe, 2);
  assert.strictEqual(N({ status: 'ruecklastschrift', soll_betrag: 100, gebuehr: 5 }, { art: 'bezahlt' }).ist_betrag, 105);
  assert.throws(() => N({ status: 'storniert' }, { art: 'bezahlt' }), e => e.art === 'fachlich');
  assert.throws(() => N({ status: 'bezahlt' }, { art: 'gemahnt' }), e => e.art === 'fachlich');
  assert.throws(() => N(s, { art: 'storniert' }), e => /Grund/.test(e.meldung));
  assert.match(N({ status: 'offen', bemerkung: 'x' }, { art: 'storniert', grund: 'verstorben' }).bemerkung, /x · Storniert: verstorben/);
});

test('einzugsstand: Kennzahlen 2026 der Beispieldaten', () => {
  const { g, d } = beitragsdaten();
  const k = rein(g.Sollstellungslauf.einzugsstand(d, 2026, '2026-10-25'));
  assert.strictEqual(k.anzahl, 10);
  assert.strictEqual(k.ruecklastschriften, 1);
  assert.strictEqual(k.storniert, 1);
  assert.strictEqual(k.offen, 2);
  assert.strictEqual(k.soll_gesamt, 1080);
  assert.strictEqual(k.ist_gesamt, 780);
  assert.strictEqual(k.streitig_betrag, 105);
});
