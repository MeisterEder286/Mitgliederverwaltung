/**
 * Prüft das erzeugte Schema gegen die CSV-Quellen in docs/daten/ und gegen die freigegebenen
 * Verbesserungen V1–V9. Schlägt fehl, wenn jemand die CSV ändert, ohne `npm run schema` aufzurufen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const csv = require('../tools/csv');
const { ladeProjekt } = require('./hilfe/projekt');

const g = ladeProjekt({});
const T = g.Schema.TABELLEN;
const DATEN = path.join(__dirname, '..', 'docs', 'daten');

test('Schema entspricht feldkatalog.csv (npm run schema vergessen?)', () => {
  const felder = csv.leseObjekte(path.join(DATEN, 'feldkatalog.csv'));
  felder.forEach(f => {
    const s = (T[f.tabelle] || { spalten: [] }).spalten.find(x => x.name === f.spalte);
    assert.ok(s, f.tabelle + '.' + f.spalte + ' fehlt im Schema');
    assert.strictEqual(s.typ, f.typ);
    assert.strictEqual(s.sicht, f.sichtklasse);
  });
  const anzahl = Object.values(T).reduce((n, t) => n + t.spalten.length, 0);
  assert.strictEqual(anzahl, felder.length);
});

test('jede Spalte hat eine gültige Sichtklasse und jede Auswahlliste existiert', () => {
  const klassen = ['intern', 'kontakt', 'finanz', 'hochsensibel', 'verwaltung'];
  Object.entries(T).forEach(([tab, t]) => t.spalten.forEach(s => {
    assert.ok(klassen.includes(s.sicht), tab + '.' + s.name + ': Sichtklasse ' + s.sicht);
    if (s.liste) assert.ok(g.Schema.LISTEN[s.liste], tab + '.' + s.name + ': Liste ' + s.liste + ' fehlt');
  }));
});

test('ID-Spalte steht im Tab, Eindeutigkeiten nennen vorhandene Spalten', () => {
  Object.entries(T).forEach(([tab, t]) => {
    const namen = t.spalten.map(s => s.name);
    if (t.idSpalte) assert.ok(namen.includes(t.idSpalte), tab + ': ID-Spalte fehlt');
    t.eindeutig.forEach(e => e.forEach(sp => assert.ok(namen.includes(sp), tab + ': ' + sp)));
  });
});

test('V1: version/geaendert_am/geaendert_von an allen bearbeitbaren Tabs', () => {
  const ohne = ['_Konfig', '_Protokoll', '_Messung', 'Statistik_Jahr'];
  Object.entries(T).filter(([tab]) => !ohne.includes(tab)).forEach(([tab, t]) => {
    ['version', 'geaendert_am', 'geaendert_von'].forEach(sp =>
      assert.ok(t.spalten.some(s => s.name === sp), tab + ': ' + sp + ' fehlt'));
  });
});

test('V2/V3/V4/V6/V9 umgesetzt', () => {
  assert.deepStrictEqual(Array.from(T.Ehrung.eindeutig[0]), ['mitglied_id', 'ehrungsregel_id', 'funktion_id']);
  assert.deepStrictEqual(Array.from(T.Benutzer.eindeutig[0]), ['email', 'rolle', 'abteilung_id']);
  assert.ok(!g.Schema.LISTEN.intervall.includes('halbjährlich'));
  assert.ok(T.Mitglied.spalten.some(s => s.name === 'nur_funktionstraeger'));
  assert.ok(T._Messung);
});

test('sensible Tabs: keine Spalte mit Sichtklasse intern/kontakt in Beitragskonto, Sollstellung, Qualifikation', () => {
  ['Beitragskonto', 'Sollstellung', 'Qualifikation'].forEach(tab =>
    T[tab].spalten.filter(s => !['version', 'geaendert_am', 'geaendert_von'].includes(s.name))
      .forEach(s => assert.ok(['finanz', 'hochsensibel'].includes(s.sicht), tab + '.' + s.name)));
});

test('Startbelegung: Köpfe passen zum Schema, Ehrungen ab letztem Eintritt', () => {
  Object.entries(g.Startbelegung).forEach(([tab, sb]) => {
    const namen = T[tab].spalten.map(s => s.name);
    sb.kopf.forEach(k => assert.ok(namen.includes(k), tab + ': ' + k));
  });
  const konfig = Object.fromEntries(g.Startbelegung._Konfig.zeilen.map(z => [z[0], z[1]]));
  assert.strictEqual(konfig.ehrung_zaehlweise, 'letzter_eintritt');
  assert.strictEqual(konfig.jugend_bis_alter, '17');
});
