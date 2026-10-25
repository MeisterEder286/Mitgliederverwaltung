/** Tests der Messwert-Auswertung (src/lib/statistik.js). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ladeProjekt, rein } = require('./hilfe/projekt');

const S = ladeProjekt().Statistik;

test('Median und P90', () => {
  assert.equal(S.median([3, 1, 2]), 2);
  assert.equal(S.median([4, 1, 2, 3]), 2.5);
  assert.equal(S.median([]), null);
  assert.equal(S.median([null, undefined, 'x']), null);
  const zehn = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(S.perzentil(zehn, 90), 9);
  assert.equal(S.perzentil([5], 90), 5);
});

test('auswerten gruppiert je Funktion und ignoriert fehlende Werte', () => {
  const erg = rein(S.auswerten([
    { funktion: 'apiStart', dauer_ms: 100, sheets_aufrufe: 1, client_ms: null, ok: true },
    { funktion: 'apiStart', dauer_ms: 300, sheets_aufrufe: 3, client_ms: null, ok: false },
    { funktion: 'apiStart', dauer_ms: null, sheets_aufrufe: null, client_ms: 900, ok: true },
    { funktion: 'apiPing', dauer_ms: 5, sheets_aufrufe: 0, client_ms: 400 },
    { dauer_ms: 1 }
  ]));
  assert.equal(erg.length, 2);
  assert.equal(erg[0].funktion, 'apiPing');
  const s = erg[1];
  assert.equal(s.anzahl, 3);
  assert.equal(s.fehler, 1);
  assert.equal(s.server_ms.median, 200);
  assert.equal(s.server_ms.anzahl, 2);
  assert.equal(s.client_ms.median, 900);
});
