/**
 * Tests für src/Datenzugriff.js (DB) mit den Fakes aus test/hilfe/gas-fakes.js.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes, beispielTabs } = require('./hilfe/gas-fakes');

const KTX = { email: 'mv@tsv-ergoldsbach.de' };

function aufbau(opt) {
  const f = erzeugeFakes(Object.assign({
    tabs: beispielTabs(['Mitglied', 'Abteilung', 'Abteilungszugehoerigkeit', 'Funktion', '_Konfig'])
  }, opt || {}));
  const g = ladeProjekt(f.globale);
  return { f, g };
}

function wirft(fn, art) {
  try { fn(); } catch (e) { assert.strictEqual(e.art, art, 'Fehlerart: ' + e.message); return e; }
  assert.fail('Fehler der Art ' + art + ' erwartet');
}

test('lese: mehrere Tabs mit genau einem batchGet, Werte umgewandelt', () => {
  const { f, g } = aufbau();
  const d = g.DB.lese(['Mitglied', 'Abteilung', 'Abteilungszugehoerigkeit']);
  assert.strictEqual(f.zaehler.batchGet, 1);
  assert.strictEqual(f.zaehler.sheets, 1);
  assert.strictEqual(g.DB.zaehler().sheets, 1);
  assert.strictEqual(d.Abteilung.length, 5);
  const wagner = d.Mitglied.find(m => m.mitgliedsnummer === '1042');
  assert.strictEqual(wagner.geburtsdatum, '1978-03-14');
  assert.strictEqual(wagner.ehrenmitglied, false);
  assert.strictEqual(wagner.beitragskonto_id, 1);
  assert.strictEqual(d.Mitglied.find(m => m.mitgliedsnummer === '0873').mitgliedsnummer, '0873');
});

test('lese: Spalten über Namen – vertauschte Reihenfolge und Leerzeilen', () => {
  const tabs = beispielTabs(['Abteilung', '_Konfig']);
  const kopf = tabs.Abteilung[0];
  const umgedreht = tabs.Abteilung.map(z => kopf.map((_, i) => z[kopf.length - 1 - i]));
  umgedreht.splice(2, 0, kopf.map(() => ''));
  const f = erzeugeFakes({ tabs: Object.assign(tabs, { Abteilung: umgedreht }) });
  const g = ladeProjekt(f.globale);
  const abt = g.DB.lese(['Abteilung']).Abteilung;
  assert.strictEqual(abt.length, 5);
  assert.strictEqual(abt.find(a => a.abteilung_id === 4).bezeichnung, 'Stockschützen');
});

test('lese: fehlende DB_ID ist ein interner Fehler', () => {
  const { f, g } = aufbau();
  delete f.properties.DB_ID;
  assert.throws(() => g.DB.lese(['Abteilung']), e => !e.art && /DB_ID/.test(e.message));
});

test('einfuegen: nur unter Sperre, ID aus _Konfig, version 1, geaendert_*', () => {
  const { f, g } = aufbau();
  assert.throws(() => g.DB.einfuegen('Abteilung', { bezeichnung: 'Volleyball', meldepflichtig: true, aktiv: true }, KTX), /mitSperre/);
  const neu = g.DB.mitSperre(() => g.DB.einfuegen('Abteilung',
    { bezeichnung: 'Volleyball', meldepflichtig: true, aktiv: true, abteilung_id: 999, version: 7 }, KTX));
  assert.strictEqual(neu.abteilung_id, 6);           // next_id_Abteilung = 6 in der Startbelegung
  assert.strictEqual(neu.version, 1);
  assert.strictEqual(neu.geaendert_von, KTX.email);
  assert.match(neu.geaendert_am, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  const konfig = f.daten('_Konfig').find(z => z[0] === 'next_id_Abteilung');
  assert.strictEqual(konfig[1], '7');
  const zeile = f.daten('Abteilung')[6];
  assert.strictEqual(zeile[f.daten('Abteilung')[0].indexOf('meldepflichtig')], 'ja');
  assert.strictEqual(f.zaehler.releaseLock, 1);
  assert.ok(f.zaehler.flush >= 1);
  // zweiter Eintrag bekommt die nächste ID
  const zweiter = g.DB.mitSperre(() => g.DB.einfuegen('Abteilung', { bezeichnung: 'Boule', meldepflichtig: false, aktiv: true }, KTX));
  assert.strictEqual(zweiter.abteilung_id, 7);
});

test('einfuegen: Pflichtfelder und Auswahllisten → fachlicher Fehler', () => {
  const { g } = aufbau();
  const e = wirft(() => g.DB.mitSperre(() => g.DB.einfuegen('Abteilungszugehoerigkeit',
    { mitglied_id: 1, status: 'halbaktiv' }, KTX)), 'fachlich');
  assert.match(e.meldung, /Abteilung/);
});

test('einfuegen: Eindeutigkeit (mitglied_id + abteilung_id)', () => {
  const { g } = aufbau();
  wirft(() => g.DB.mitSperre(() => g.DB.einfuegen('Abteilungszugehoerigkeit',
    { mitglied_id: 1, abteilung_id: 1, status: 'aktiv' }, KTX)), 'fachlich');
  const ok = g.DB.mitSperre(() => g.DB.einfuegen('Abteilungszugehoerigkeit',
    { mitglied_id: 1, abteilung_id: 2, status: 'aktiv' }, KTX));
  assert.strictEqual(ok.zugehoerigkeit_id, 16);
});

test('neueId: fehlender Zähler wird aus dem Bestand angelegt', () => {
  const { f, g } = aufbau();
  const konfig = f.daten('_Konfig');
  konfig.splice(konfig.findIndex(z => z[0] === 'next_id_Funktion'), 1);
  const id = g.DB.mitSperre(() => g.DB.neueId('Funktion'));
  assert.strictEqual(id, 16);                          // höchste funktion_id im Beispiel = 15
  assert.ok(f.daten('_Konfig').some(z => z[0] === 'next_id_Funktion' && z[1] === '17'));
  assert.strictEqual(g.DB.mitSperre(() => g.DB.neueId('Funktion')), 17);
});

test('aktualisieren: Version, Diff, Schutz technischer Felder', () => {
  const { f, g } = aufbau();
  const vorher = g.DB.lese(['Abteilung']).Abteilung.find(a => a.abteilung_id === 3);
  assert.strictEqual(vorher.version, null);            // Beispieldaten haben noch keine Version
  const r = g.DB.mitSperre(() => g.DB.aktualisieren('Abteilung', 3,
    { bemerkung: 'Neue Plätze', version: 99, abteilung_id: 77 }, 0, KTX));
  assert.deepStrictEqual(rein(r.diff), [{ feld: 'bemerkung', alt: null, neu: 'Neue Plätze' }]);
  assert.strictEqual(r.neu.version, 1);
  assert.strictEqual(r.neu.abteilung_id, 3);
  const r2 = g.DB.mitSperre(() => g.DB.aktualisieren('Abteilung', 3, { aktiv: false }, 1, KTX));
  assert.strictEqual(r2.neu.version, 2);
  assert.strictEqual(r2.neu.bemerkung, 'Neue Plätze');
  const zeile = f.daten('Abteilung').find(z => z[0] === 3);
  assert.strictEqual(zeile[f.daten('Abteilung')[0].indexOf('aktiv')], 'nein');
});

test('aktualisieren: falsche Version → Konflikt mit aktuellem Stand', () => {
  const { g } = aufbau();
  g.DB.mitSperre(() => g.DB.aktualisieren('Abteilung', 2, { bemerkung: 'A' }, 0, KTX));
  const e = wirft(() => g.DB.mitSperre(() => g.DB.aktualisieren('Abteilung', 2, { bemerkung: 'B' }, 0, KTX)), 'konflikt');
  assert.strictEqual(e.aktuell.bemerkung, 'A');
  assert.strictEqual(e.aktuell.version, 1);
});

test('aktualisieren: ohne Änderung kein Schreiben, unbekannte ID fachlich', () => {
  const { f, g } = aufbau();
  const vorher = f.zaehler.setValues || 0;
  const r = g.DB.mitSperre(() => g.DB.aktualisieren('Abteilung', 1, { bezeichnung: 'Fußball' }, 0, KTX));
  assert.strictEqual(r.diff.length, 0);
  assert.strictEqual(f.zaehler.setValues || 0, vorher);
  wirft(() => g.DB.mitSperre(() => g.DB.aktualisieren('Abteilung', 4711, { bemerkung: 'x' }, 0, KTX)), 'fachlich');
});

test('aktualisieren: Eindeutigkeit auch bei Änderung', () => {
  const { g } = aufbau();
  // Zugehörigkeit 1 (Mitglied 1, Abt. 1) auf Abt. 4 ändern – Mitglied 1 ist dort schon (Zugehörigkeit 2)
  wirft(() => g.DB.mitSperre(() => g.DB.aktualisieren('Abteilungszugehoerigkeit', 1, { abteilung_id: 4 }, 0, KTX)), 'fachlich');
});

test('mitSperre: belegte Sperre → fachlicher Hinweis, Sperre immer freigegeben', () => {
  const { g } = aufbau({ sperreBelegt: true });
  const e = wirft(() => g.DB.mitSperre(() => 1), 'fachlich');
  assert.match(e.meldung, /erneut/);
  const b = aufbau();
  assert.throws(() => b.g.DB.mitSperre(() => { throw new Error('kaputt'); }), /kaputt/);
  assert.strictEqual(b.f.zaehler.releaseLock, 1);
  // danach ist wieder außerhalb der Sperre
  assert.throws(() => b.g.DB.neueId('Abteilung'), /mitSperre/);
});

test('jetzt: Format JJJJ-MM-TTThh:mm:ss', () => {
  const { g } = aufbau();
  assert.match(g.DB.jetzt(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});
