/**
 * Tests für src/lib/vorlagen.js – Platzhalter, Bedingungen, Anschrift (Vertretung, Zahler, abweichende Adresse),
 * keine HTML-Interpretation, IBAN nur maskiert, Drive-Links.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt } = require('./hilfe/projekt');
const V = ladeProjekt({}).Vorlagen;

test('Platzhalter werden ersetzt, unbekannte gemeldet, Bedingungen entfallen bei leerem Wert', () => {
  const r = V.fuelle('{{briefanrede}},\n\nNr. {{mitgliedsnummer}}{{#wenn abteilungen}} – {{abteilungen}}{{/wenn}}. {{tippfehler}}', {
    briefanrede: 'Sehr geehrte Frau Huber', mitgliedsnummer: '0873', abteilungen: '' });
  assert.strictEqual(r.text, 'Sehr geehrte Frau Huber,\n\nNr. 0873. {{tippfehler}}');
  assert.deepStrictEqual(Array.from(r.unbekannt), ['tippfehler']);
  assert.deepStrictEqual(Array.from(V.pruefe('{{#wenn x}}a{{/wenn}} {{name}}')), ['x']);
});

test('Kein HTML: Werte und Vorlagentext bleiben reiner Text', () => {
  const r = V.fuelle('<b>{{name}}</b>', { name: '<script>alert(1)</script>' });
  assert.strictEqual(r.text, '<b><script>alert(1)</script></b>');   // wird im Browser per textContent gesetzt
});

test('Anschrift: Minderjährige an die Vertretung, Rechnung an den Kontoinhaber mit abweichender Adresse', () => {
  const kind = { mitglied_id: 3, vorname: 'Lena', nachname: 'Wagner', strasse: 'Rosenweg', hausnummer: '12', plz: '84061', ort: 'Ergoldsbach', land: 'DE' };
  let a = V.anschrift('Allgemein', { mitglied: kind, alter: 14 });
  assert.deepStrictEqual(Array.from(a.zeilen), ['An die Erziehungsberechtigten von', 'Lena Wagner', 'Rosenweg 12', '84061 Ergoldsbach']);
  a = V.anschrift('Allgemein', { mitglied: Object.assign({ vertreter_name: 'Michael Wagner' }, kind), alter: 14 });
  assert.strictEqual(a.zeilen[0], 'An Michael Wagner');
  const vater = { mitglied_id: 1, anrede: 'Herr', vorname: 'Michael', nachname: 'Wagner', strasse: 'Rosenweg', hausnummer: '12', plz: '84061', ort: 'Ergoldsbach' };
  const konto = { kontoinhaber_name: 'Wagner, Michael', abw_strasse: 'Postfach', abw_hausnummer: '7', abw_plz: '84028', abw_ort: 'Landshut' };
  a = V.anschrift('Rechnung', { mitglied: kind, inhaber: vater, konto, alter: 14 });
  assert.deepStrictEqual(Array.from(a.zeilen), ['Wagner, Michael', 'für Lena Wagner', 'Postfach 7', '84028 Landshut']);
  assert.strictEqual(a.briefanrede, 'Sehr geehrter Herr Wagner');
});

test('Werte: Beträge/Datum deutsch, IBAN nur maskiert, Gläubiger-ID-Platzhalter bleibt leer', () => {
  const w = V.werte({
    mitglied: { vorname: 'Josef', nachname: 'Bauer', mitgliedsnummer: '0873', geburtsdatum: '1951-01-09' },
    konto: { iban: 'DE22740500000012345678', iban_maskiert: 'DE22 •••• 5678', mandatsreferenz: 'TSV-1986-0873', kontoinhaber_name: 'Bauer, Josef' },
    sollstellung: { jahr: 2026, soll_betrag: 1234.5, gebuehr: 5, ist_betrag: 0, mahnstufe: 2, einzugsdatum: '2026-02-15' },
    heute: '2026-10-25', konfig: { verein_glaeubiger_id: 'DE00ZZZ00000000000' }
  });
  assert.strictEqual(w.betrag, '1.234,50 €');
  assert.strictEqual(w.offen, '1.239,50 €');
  assert.strictEqual(w.mahnstufe, '2');
  assert.strictEqual(w.einzugsdatum, '15.02.2026');
  assert.strictEqual(w.faellig_am, '08.11.2026');
  assert.strictEqual(w.iban_maskiert, 'DE22 •••• 5678');
  assert.ok(!JSON.stringify(w).includes('DE22740500000012345678'), 'IBAN-Klartext im Platzhalter');
  assert.strictEqual(w.glaeubiger_id, '');
});

test('Alle Standardvorlagen sind gültig und haben einen Anlass aus der Auswahlliste', () => {
  const g = ladeProjekt({});
  const sb = g.Startbelegung.Vorlage;
  const ix = n => sb.kopf.indexOf(n);
  assert.ok(sb.zeilen.length >= 10);
  sb.zeilen.forEach(z => {
    assert.deepStrictEqual(Array.from(V.pruefe(z[ix('text')])), [], z[ix('bezeichnung')]);
    assert.deepStrictEqual(Array.from(V.pruefe(z[ix('betreff')])), [], z[ix('bezeichnung')]);
    assert.ok(g.Schema.LISTEN.vorlage_anlass.includes(z[ix('anlass')]), z[ix('anlass')]);
  });
});

test('Drive-Links: nur drive.google.com / docs.google.com über https', () => {
  assert.ok(V.istDriveLink('https://drive.google.com/file/d/abc/view'));
  assert.ok(V.istDriveLink('https://docs.google.com/document/d/x/edit'));
  ['http://drive.google.com/x', 'https://drive.google.com.evil.de/x', 'javascript:alert(1)', 'https://example.de/x', ''].forEach(u =>
    assert.ok(!V.istDriveLink(u), u));
});
