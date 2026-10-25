/**
 * Tests der Rechtematrix (src/lib/rechte.js) – vor allem Negativtests: Wer darf etwas NICHT sehen?
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ladeProjekt, rein } = require('./hilfe/projekt');

const g = ladeProjekt();
const R = g.Rechte;

const zeilen = [
  { email: 'vorstand@tsv.de', name: 'Vorstand', rolle: 'Vorstand', abteilung_id: null, aktiv: true },
  { email: 'kassier@tsv.de', rolle: 'Kassier', abteilung_id: null, aktiv: true },
  { email: 'AL@tsv.de', rolle: 'Abteilungsleiter', abteilung_id: 1, aktiv: true },
  { email: 'al@tsv.de', rolle: 'Abteilungsleiter', abteilung_id: 2, aktiv: true },
  { email: 'al@tsv.de', rolle: 'Jugendleiter', abteilung_id: null, aktiv: true },
  { email: 'alt@tsv.de', rolle: 'Mitgliederverwalter', aktiv: false },
  { email: 'fremd@tsv.de', rolle: 'Hausmeister', aktiv: true },
  { email: 'nurkassier@tsv.de', rolle: 'Kassier', aktiv: true },
  { email: 'nurkassier@tsv.de', rolle: 'Abteilungsleiter', abteilung_id: 3, aktiv: 'ja' } // kein boolean → inaktiv
];

const spaltenMitKlasse = (tab, klassen) =>
  g.Schema.TABELLEN[tab].spalten.filter(s => klassen.includes(s.sicht)).map(s => s.name);

test('unbekannte, inaktive und leere Nutzer bekommen keinen Kontext', () => {
  assert.equal(R.kontext(zeilen, 'niemand@tsv.de'), null);
  assert.equal(R.kontext(zeilen, 'alt@tsv.de'), null);
  assert.equal(R.kontext(zeilen, ''), null);
  assert.equal(R.kontext(zeilen, null), null);
  assert.equal(R.kontext(zeilen, 'fremd@tsv.de'), null, 'unbekannte Rolle wird ignoriert');
  assert.equal(R.kontext([], 'vorstand@tsv.de'), null);
});

test('E-Mail wird ohne Groß-/Kleinschreibung und Leerzeichen verglichen', () => {
  const k = R.kontext(zeilen, '  Vorstand@TSV.de ');
  assert.deepEqual(rein(k.rollen), ['Vorstand']);
  assert.equal(k.zeilen, 'alle');
});

test('Abteilungsleiter zweier Abteilungen plus Jugendleiter: Vereinigung der Rechte (V3)', () => {
  const k = R.kontext(zeilen, 'al@tsv.de');
  assert.deepEqual(rein(k.rollen).sort(), ['Abteilungsleiter', 'Jugendleiter']);
  assert.deepEqual(rein(k.abteilungen).sort(), [1, 2]);
  assert.equal(k.zeilen, 'abteilung');
  assert.ok(R.darf(k, 'qualifikation_erfassen'));
  assert.ok(R.darf(k, 'funktion_bearbeiten'));
});

test('Abteilungsleiter sieht keine Finanz- und Verwaltungsspalten', () => {
  const k = R.kontext([zeilen[2]], 'al@tsv.de');
  const sichtbar = rein(R.sichtbareSpalten(k, 'Mitglied'));
  spaltenMitKlasse('Mitglied', ['finanz', 'verwaltung']).forEach(s => assert.ok(!sichtbar.includes(s), s));
  assert.ok(sichtbar.includes('nachname'));
  assert.ok(sichtbar.includes('telefon'));
  assert.deepEqual(rein(R.sichtbareSpalten(k, 'Beitragskonto')), []);
  assert.deepEqual(rein(R.sichtbareSpalten(k, 'Sollstellung')), []);
  assert.deepEqual(rein(R.sichtbareSpalten(k, 'Benutzer')), []);
  assert.deepEqual(rein(R.sichtbareSpalten(k, '_Protokoll')), []);
});

test('Abteilungsleiter darf keinen Vereinsaustritt, keine Konten, keine Benutzer', () => {
  const k = R.kontext(zeilen, 'al@tsv.de');
  ['austritt_erfassen', 'konto_lesen', 'iban_aufdecken', 'benutzer_verwalten', 'konfig_aendern', 'sepa_lauf', 'mitglied_anlegen']
    .forEach(a => assert.ok(!R.darf(k, a), a));
});

test('Kassier sieht Finanzen, aber nie Qualifikationen und ändert keine IBAN', () => {
  const k = R.kontext(zeilen, 'kassier@tsv.de');
  assert.deepEqual(rein(R.sichtbareSpalten(k, 'Qualifikation')), []);
  assert.ok(R.sichtbareSpalten(k, 'Beitragskonto').includes('iban'));
  assert.ok(!R.darf(k, 'konto_bearbeiten'));
  assert.ok(!R.darf(k, 'qualifikation_lesen'));
  assert.ok(R.darf(k, 'sepa_lauf'));
});

test('Zeile mit aktiv="ja" statt true zählt nicht (nur boolean true)', () => {
  const k = R.kontext(zeilen, 'nurkassier@tsv.de');
  assert.deepEqual(rein(k.rollen), ['Kassier']);
  assert.deepEqual(rein(k.abteilungen), []);
});

test('Jugendleiter sieht hochsensibel, aber keine Finanzen', () => {
  const k = R.kontext([{ email: 'j@tsv.de', rolle: 'Jugendleiter', aktiv: true }], 'j@tsv.de');
  assert.equal(k.zeilen, 'jugend');
  assert.ok(R.sichtbareSpalten(k, 'Qualifikation').length > 0);
  assert.deepEqual(rein(R.sichtbareSpalten(k, 'Beitragskonto')), []);
});

test('schneide entfernt nicht erlaubte Felder', () => {
  const k = R.kontext([zeilen[2]], 'al@tsv.de');
  const m = { mitglied_id: 1, nachname: 'Wagner', beitragskonto_id: 7, sperre_grund: 'x', telefon: '1' };
  assert.deepEqual(rein(R.schneide(k, 'Mitglied', m)), { mitglied_id: 1, nachname: 'Wagner', telefon: '1' });
  assert.deepEqual(rein(R.schneide(null, 'Mitglied', m)), {});
});

test('Vorstand und Mitgliederverwalter dürfen alle Aktionen', () => {
  ['Vorstand', 'Mitgliederverwalter'].forEach(r => {
    const k = R.kontext([{ email: 'x@tsv.de', rolle: r, aktiv: true }], 'x@tsv.de');
    R.AKTIONEN.forEach(a => assert.ok(R.darf(k, a), r + ' ' + a));
  });
});

test('Matrix nennt nur bekannte Aktionen und Sichtklassen', () => {
  Object.keys(R.MATRIX).forEach(r => {
    R.MATRIX[r].aktionen.forEach(a => assert.ok(R.AKTIONEN.includes(a), r + ': ' + a));
    R.MATRIX[r].sicht.forEach(s => assert.ok(R.SICHTKLASSEN.includes(s), r + ': ' + s));
  });
  assert.deepEqual(rein(R.ROLLEN).sort(), rein(g.Schema.LISTEN.rolle).sort(), 'Rollen = Auswahlliste rolle');
});
