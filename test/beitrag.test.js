/**
 * Tests für src/lib/beitrag.js – Berechnung je Konto (Wagner 280 €), Klärliste, Mandatsverfall, Tarifwechsel, Waisen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { rein } = require('./hilfe/projekt');
const { beitragsdaten } = require('./hilfe/beitragsdaten');

test('Wagner: Familie 180 € einmal + Felix 100 € = 280 € auf Konto 1', () => {
  const { g, d } = beitragsdaten();
  const s = rein(g.Beitrag.sollJeKonto(1, d, 2026));
  assert.strictEqual(s.betrag, 280);
  assert.strictEqual(s.positionen.length, 2);
  assert.deepStrictEqual(s.positionen[0].mitglied_ids, [1, 2, 3]);
  assert.strictEqual(s.positionen[0].betrag, 180);
  assert.strictEqual(s.positionen[1].betrag, 100);
  assert.match(g.Beitrag.zusammensetzung(s), /Familie Wagner 180,00 \+ Wagner, Felix \(Erwachsene\) 100,00/);
});

test('Gemeinschaft wird einmal gezogen, auch wenn Mitglieder dazukommen', () => {
  const { g, d } = beitragsdaten();
  d.Mitglied.push({ mitglied_id: 99, mitgliedsnummer: '9999', vorname: 'Max', nachname: 'Wagner', beitragskonto_id: 1, beitragsgemeinschaft_id: 1 });
  d.Mitgliedschaftszeitraum.push({ zeitraum_id: 99, mitglied_id: 99, eintrittsdatum: '2025-01-01' });
  assert.strictEqual(g.Beitrag.sollJeKonto(1, d, 2026).betrag, 280);
});

test('Wer zählt: verstorben vor Fälligkeit, Eintritt im Jahr, ausgetreten im Vorjahr, Ehrenmitglied zahlt', () => {
  const { g, d } = beitragsdaten();
  assert.strictEqual(g.Beitrag.sollJeKonto(6, d, 2026).betrag, 0, 'Steinberger † 14.02.2026 vor Fälligkeit 15.02.');
  assert.strictEqual(g.Beitrag.sollJeKonto(9, d, 2026).betrag, 100, 'Vogl Eintritt 01.03.2026 – voller Beitrag (anteilig = nein)');
  assert.strictEqual(g.Beitrag.sollJeKonto(2, d, 2026).betrag, 100, 'Bauer ist Ehrenmitglied ohne Befreiung');
  assert.strictEqual(g.Beitrag.sollJeKonto(11, d, 2026).betrag, 0, 'anonymisiert / ausgetreten');
  // anteilig (vorbereitete Variante): Eintritt März → 10 von 12 Monaten
  assert.strictEqual(g.Beitrag.sollJeKonto(9, d, 2026, { konfig: { beitrag_anteilig: 'ja' } }).betrag, 83.33);
});

test('Beitragsart: zum Jahr gültige Zeile gleicher Bezeichnung (Preisänderung)', () => {
  const { g, d } = beitragsdaten();
  d.Beitragsart.push({ beitragsart_id: 10, bezeichnung: 'Erwachsene', betrag: 120, alter_von: 18, aktiv: true, gueltig_ab: '2027-01-01' });
  assert.strictEqual(g.Beitrag.sollJeKonto(2, d, 2026).betrag, 100);
  assert.strictEqual(g.Beitrag.sollJeKonto(2, d, 2027).betrag, 120);
});

test('Beitragsänderung ab 2027: Vorschau je Konto, Felder mit Stichtag, frühere Jahre rechnen mit altem Betrag', () => {
  const { g, d } = beitragsdaten();
  const r = rein(g.Beitrag.beitragsaenderung(d, 2027, {
    arten: [{ beitragsart_id: 1, betrag: 110 }, { beitragsart_id: 2, betrag: 45 }],
    festbetraege: [{ alt: 180, neu: 200 }]
  }));
  assert.deepStrictEqual(r.fehler, []);
  assert.deepStrictEqual(r.arten, [{ beitragsart_id: 1, bezeichnung: 'Erwachsene', alt: 100, neu: 110 }], 'unveränderte Jugend fehlt');
  assert.deepStrictEqual(r.gemeinschaften.map(x => [x.beitragsgemeinschaft_id, x.alt, x.neu]), [[1, 180, 200]]);
  assert.deepStrictEqual(r.aenderungen.Beitragsart[1], { betrag: 110, betrag_vorher: 100, gueltig_ab: '2027-01-01' });
  assert.deepStrictEqual(r.aenderungen.Beitragsgemeinschaft[1], { festbetrag: 200, festbetrag_vorher: 180, festbetrag_ab: '2027-01-01' });
  const wagner = r.konten.find(k => k.beitragskonto_id === 1);
  assert.deepStrictEqual([wagner.alt, wagner.neu, wagner.differenz], [280, 310, 30]);
  assert.ok(r.konten.every(k => k.differenz !== 0));
  assert.strictEqual(r.summe_neu - r.summe_alt, r.konten.reduce((n, k) => n + k.differenz, 0));

  // Felder übernehmen: 2026 bleibt 280 (Nachlauf/Rechnung), 2027 rechnet 310 – eine Zeile je Tarif
  Object.assign(d.Beitragsart[0], r.aenderungen.Beitragsart[1]);
  Object.assign(d.Beitragsgemeinschaft[0], r.aenderungen.Beitragsgemeinschaft[1]);
  assert.strictEqual(g.Beitrag.sollJeKonto(1, d, 2026).betrag, 280);
  assert.strictEqual(g.Beitrag.sollJeKonto(1, d, 2027).betrag, 310);
  assert.strictEqual(d.Beitragsart.filter(a => a.bezeichnung === 'Erwachsene').length, 1);
  // erneut planen für dasselbe Jahr: der ursprüngliche Vorjahresbetrag bleibt betrag_vorher
  const r2 = rein(g.Beitrag.beitragsaenderung(d, 2027, { arten: [{ beitragsart_id: 1, betrag: 115 }] }));
  assert.deepStrictEqual(r2.aenderungen.Beitragsart[1], { betrag: 115, betrag_vorher: 100, gueltig_ab: '2027-01-01' });
  // Tarifwechsel und Familien-Vorschlag finden die Art auch vor dem Stichtag (mit altem Betrag)
  assert.strictEqual(g.Beitrag.artVerfuegbar(d.Beitragsart[0], '2026-06-01'), true);
  assert.strictEqual(g.Beitrag.betragAm(d.Beitragsart[0], '2026-06-01'), 100);
});

test('Beitragsänderung: gesperrt bei vorhandenen Sollstellungen, Eingabefehler', () => {
  const { g, d } = beitragsdaten();
  const r = rein(g.Beitrag.beitragsaenderung(d, 2026, { arten: [{ beitragsart_id: 1, betrag: 110 }] }));
  assert.match(r.fehler.join(' '), /bereits \d+ Sollstellung/);
  const f = rein(g.Beitrag.beitragsaenderung(d, 2027, { arten: [{ beitragsart_id: 1, betrag: -5 }, { beitragsart_id: 77, betrag: 1 }], festbetraege: [{ alt: 180, neu: null }] }));
  assert.strictEqual(f.fehler.length, 3);
});

test('Mandatsverfall nach 36 Monaten ohne Nutzung (Fischer ohne Einzug seit Mandatsdatum)', () => {
  const { g, d } = beitragsdaten();
  const fischer = d.Beitragskonto.find(k => k.beitragskonto_id === 4);
  // Beispieldaten: 2026 lief noch ein RCUR-Einzug (Rücklastschrift) → genutzt, nicht verfallen
  assert.strictEqual(g.Beitrag.mandatStatus(fischer, d, '2026-10-25').verfallen, false);
  d.Sollstellung = d.Sollstellung.filter(s => s.beitragskonto_id !== 4);
  const ms = rein(g.Beitrag.mandatStatus(fischer, d, '2026-10-25'));
  assert.strictEqual(ms.verfallen, true);
  assert.strictEqual(ms.letzteNutzung, '2001-01-08');
  const k = g.Beitrag.klaerliste(d, 2026, '2026-10-25').filter(e => e.art === 'mandat_verfallen');
  assert.strictEqual(k.length, 1);
  assert.strictEqual(k[0].konto_id, 4);
});

test('Klärliste: Waisen, Gemeinschaft auf zwei Konten, ohne Beitrag, Lastschrift unvollständig, IBAN', () => {
  const { g, d } = beitragsdaten({ gueltigeIbans: true });
  const vorher = rein(g.Beitrag.klaerliste(d, 2026, '2026-10-25'));
  assert.deepStrictEqual(vorher.filter(e => e.schwere === 'fehler').map(e => e.art), [], JSON.stringify(vorher));
  const lena = d.Mitglied.find(m => m.mitglied_id === 3);
  lena.beitragskonto_id = 2;                        // Gemeinschaft Wagner auf zwei Konten
  const felix = d.Mitglied.find(m => m.mitglied_id === 4);
  felix.beitragsart_id = null;                      // weder Art noch Gemeinschaft
  const obermeier = d.Mitglied.find(m => m.mitglied_id === 8);
  obermeier.beitragskonto_id = null;                // Waise
  const lehner = d.Beitragskonto.find(k => k.beitragskonto_id === 10);
  lehner.mandatsreferenz = null;
  d.Beitragskonto.find(k => k.beitragskonto_id === 7).iban = 'DE00740500000005556677';
  const arten = g.Beitrag.klaerliste(d, 2026, '2026-10-25').map(e => e.art);
  ['gemeinschaft_konto', 'ohne_beitrag', 'waise', 'lastschrift_unvollstaendig', 'iban_ungueltig'].forEach(a =>
    assert.ok(arten.includes(a), a + ' fehlt in ' + arten.join(',')));
});

test('Klärliste: Kontoinhaber verstorben / ausgetreten → Abhängige melden', () => {
  const { g, d } = beitragsdaten({ gueltigeIbans: true });
  d.Mitglied.find(m => m.mitglied_id === 1).sterbedatum = '2026-06-01';
  const e = rein(g.Beitrag.klaerliste(d, 2026, '2026-10-25')).filter(x => x.art === 'inhaber_ausgetreten');
  assert.deepStrictEqual(e.map(x => x.mitglied_id).sort(), [2, 3, 4]);
});

test('Tarifwechsel: Jugend → Erwachsene zum 01.01. nach dem 18. Geburtstag', () => {
  const { g, d } = beitragsdaten();
  d.Mitglied.push({ mitglied_id: 50, mitgliedsnummer: '5000', vorname: 'Tim', nachname: 'Jung', geburtsdatum: '2008-05-01', beitragsart_id: 2, beitragskonto_id: 2 });
  d.Mitgliedschaftszeitraum.push({ zeitraum_id: 50, mitglied_id: 50, eintrittsdatum: '2015-01-01' });
  assert.strictEqual(g.Beitrag.tarifwechsel(d, 2026).filter(v => v.mitglied_id === 50).length, 0, 'am 01.01.2026 erst 17');
  const v = g.Beitrag.tarifwechsel(d, 2027).find(x => x.mitglied_id === 50);
  assert.strictEqual(v.von, 2);
  assert.strictEqual(v.nach, 1);
  assert.strictEqual(v.alter, 18);
  // Fördermitglied (ohne Altersgrenze) bleibt
  d.Mitglied.find(m => m.mitglied_id === 50).beitragsart_id = 3;
  assert.strictEqual(g.Beitrag.tarifwechsel(d, 2027).filter(x => x.mitglied_id === 50).length, 0);
});

test('Waisen bei Austritt des Kontoinhabers (Guard statt Cascade)', () => {
  const { g, d } = beitragsdaten();
  const w = rein(g.Beitrag.waisenBeiAustritt(1, d, '2026-12-31'));
  assert.strictEqual(w.betroffen, 3);
  assert.deepStrictEqual(w.konten[0].abhaengige.map(a => a.mitglied_id), [2, 3, 4]);
  const codes = w.optionen.map(o => o.code);
  ['uebernahme', 'konto_bleibt', 'zahlweg_offen', 'alle_austreten'].forEach(c => assert.ok(codes.includes(c)));
  // Lena (minderjährig) wird nicht als Übernehmerin vorgeschlagen
  assert.ok(!w.optionen.some(o => o.code === 'uebernahme' && o.mitglied_id === 3));
  assert.strictEqual(g.Beitrag.waisenBeiAustritt(4, d, '2026-12-31').betroffen, 0, 'Felix ist kein Kontoinhaber');
});
