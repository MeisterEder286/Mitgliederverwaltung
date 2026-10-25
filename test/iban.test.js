/**
 * Tests für src/lib/iban.js – IBAN-Prüfung, Maskierung, BIC, Gläubiger-ID.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt } = require('./hilfe/projekt');
const I = ladeProjekt({}).Iban;

test('IBAN: gültig, normalisiert, Fehlerarten', () => {
  assert.strictEqual(I.pruefe('de89 3704 0044 0532 0130 00').ok, true);
  assert.strictEqual(I.pruefe('DE89-3704-0044-0532-0130-00').iban, 'DE89370400440532013000');
  assert.strictEqual(I.pruefe('').fehler, 'leer');
  assert.strictEqual(I.pruefe('DE88370400440532013000').fehler, 'pruefziffer');
  assert.strictEqual(I.pruefe('DE8937040044053201300').fehler, 'laenge');
  assert.strictEqual(I.pruefe('US89370400440532013000').fehler, 'land');
  assert.strictEqual(I.pruefe('DE89 3704 0044 0532 0130 0X').fehler, 'pruefziffer');
  assert.strictEqual(I.pruefe('AT611904300234573201').ok, true);
  assert.strictEqual(I.pruefe('CH9300762011623852957').ok, true);
  assert.match(I.fehlertext('pruefziffer'), /Prüfziffer/);
});

test('IBAN aus BLZ und Konto, Formatierung, Maskierung', () => {
  assert.strictEqual(I.ausBlzKonto('37040044', '532013000'), 'DE89370400440532013000');
  assert.strictEqual(I.ausBlzKonto('3704004', '1'), null);
  assert.strictEqual(I.formatiere('DE89370400440532013000'), 'DE89 3704 0044 0532 0130 00');
  assert.strictEqual(I.maskiere('DE89370400440532013000'), 'DE89 •••• •••• 3000');
  assert.strictEqual(I.maskiere(''), '');
});

test('BIC und Gläubiger-ID', () => {
  assert.strictEqual(I.pruefeBic('COBADEFFXXX').ok, true);
  assert.strictEqual(I.pruefeBic('BYLADEM1').ok, true);
  assert.strictEqual(I.pruefeBic('').ok, true);
  assert.strictEqual(I.pruefeBic('COBA DE').ok, false);
  assert.strictEqual(I.bicNoetig('DE89370400440532013000'), false);
  assert.strictEqual(I.bicNoetig('AT611904300234573201'), true);
  assert.strictEqual(I.glaeubigerIdPruefen('DE98ZZZ09999999999').ok, true);
  assert.strictEqual(I.glaeubigerIdPruefen('DE98ABC09999999999').ok, true, 'Geschäftsbereich wird ignoriert');
  assert.strictEqual(I.glaeubigerIdPruefen('DE97ZZZ09999999999').fehler, 'pruefziffer');
  assert.strictEqual(I.glaeubigerIdPruefen('DE00ZZZ00000000000').fehler, 'platzhalter');
  assert.strictEqual(I.glaeubigerIdPruefen('DE98ZZZ0999999999').fehler, 'laenge');
});
