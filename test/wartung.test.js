/**
 * Tests für die nächtliche Wartung (src/modul/Wartung.js, src/api/Wartung.js) mit gas-fakes + synthetischem Verein:
 * Status-Cache, Löschbarkeit, Messwerte aufräumen, Snapshot neu, nur Funktionskonto, Laufzeitschutz mit Fortsetzung.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes, isoZuSerial } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const EIG = 'verwaltung@tsv-ergoldsbach.de';
const VEREIN = erzeugeVerein({ mitglieder: 300 });
function kopie(tabs) { const o = {}; Object.keys(tabs).forEach(t => { o[t] = tabs[t].map(z => z.slice()); }); return o; }
function objekte(f, tab) { const d = f.daten(tab); return d.slice(1).map(z => Object.fromEntries(d[0].map((k, i) => [k, z[i]]))); }

/** Synthetischer Verein, ein aktives Mitglied mit Austritt in der Vergangenheit, alte und neue Messwerte. */
function vorbereitet() {
  const tabs = kopie(VEREIN.tabs);
  const zk = tabs.Mitgliedschaftszeitraum[0], mk = tabs.Mitglied[0];
  const aktiv = tabs.Mitglied.slice(1).find(z => z[mk.indexOf('status')] === 'aktiv' && !z[mk.indexOf('sterbedatum')]);
  const id = aktiv[mk.indexOf('mitglied_id')];
  const zeitraum = tabs.Mitgliedschaftszeitraum.slice(1).filter(z => z[zk.indexOf('mitglied_id')] === id).pop();
  zeitraum[zk.indexOf('austrittsdatum')] = isoZuSerial('2020-12-31');
  const kopf = tabs._Messung[0];
  const zeile = (zeit, fn) => kopf.map(k => ({ zeitpunkt: isoZuSerial(zeit), funktion: fn, dauer_ms: 100, sheets_aufrufe: 1, ok: 'ja' })[k] ?? '');
  tabs._Messung.push(zeile('2020-01-01T10:00:00', 'alt1'), zeile('2020-02-01T10:00:00', 'alt2'), zeile('2099-01-01T10:00:00', 'neu'));
  return { tabs, id };
}

test('wartungNachts: Status nachgezogen, Löschbarkeit gesetzt, alte Messwerte entfernt, Snapshot warm, Protokoll', () => {
  const { tabs, id } = vorbereitet();
  const f = erzeugeFakes({ tabs, email: EIG, eigentuemer: EIG });
  const g = ladeProjekt(f.globale);
  const erg = rein(g.wartungNachts());
  assert.ok(erg && !erg.abgebrochen, JSON.stringify(erg));
  assert.deepStrictEqual(Object.keys(erg.ergebnisse), ['status', 'fristen', 'loeschbarkeit', 'protokoll', 'messung', 'korrespondenz', 'notizen', 'snapshot']);
  Object.values(erg.ergebnisse).forEach(v => assert.ok(!String(v).startsWith('Fehler'), JSON.stringify(erg.ergebnisse)));
  const m = objekte(f, 'Mitglied').find(x => x.mitglied_id === id);
  assert.strictEqual(m.status, 'ausgetreten');
  assert.ok(erg.ergebnisse.status >= 1);
  // Löschbarkeit für Ausgetretene gesetzt (nur Felder, nichts gelöscht)
  const ausgetreten = objekte(f, 'Mitglied').filter(x => x.status === 'ausgetreten' && x.anonymisiert !== 'ja');
  assert.ok(ausgetreten.some(x => x.loeschbar_ab), 'loeschbar_ab nirgends gesetzt');
  assert.strictEqual(objekte(f, 'Mitglied').length, VEREIN.tabs.Mitglied.length - 1, 'keine Zeile gelöscht');
  // Messwerte: die beiden alten sind weg, der neue bleibt
  assert.deepStrictEqual(objekte(f, '_Messung').map(x => x.funktion), ['neu']);
  // Snapshot neu im Cache
  assert.ok(f.globale.CacheService.getScriptCache().get('snapshot:basis:kopf'), 'Snapshot nicht im Cache');
  // Sammeleintrag im Protokoll
  const p = objekte(f, '_Protokoll').filter(x => x.tabelle === 'Wartung');
  assert.strictEqual(p.length, 1);
  assert.match(p[0].kommentar, /status: \d+/);
  // Zweiter Lauf am selben Tag: alles erledigt, nichts mehr zu tun
  const zwei = rein(g.wartungNachts());
  assert.deepStrictEqual(zwei.ergebnisse, {});
});

test('wartungNachts nur als Funktionskonto', () => {
  const { tabs, id } = vorbereitet();
  const f = erzeugeFakes({ tabs, email: 'mv@tsv-ergoldsbach.de', eigentuemer: EIG });
  const g = ladeProjekt(f.globale);
  assert.strictEqual(g.wartungNachts(), null);
  assert.strictEqual(objekte(f, 'Mitglied').find(x => x.mitglied_id === id).status, 'aktiv');
});

test('Laufzeitschutz: Abbruch nach Zeitgrenze, Folge-Trigger, Fortsetzen erledigt nur den Rest', () => {
  const { tabs } = vorbereitet();
  const f = erzeugeFakes({ tabs, email: EIG, eigentuemer: EIG });
  const g = ladeProjekt(f.globale);
  let t = 0;
  const uhr = () => (t += 2 * 60 * 1000);   // jeder Blick auf die Uhr: +2 Minuten
  const erst = rein(g.Wartung.ausfuehren({ email: EIG, jetztMs: uhr }));
  assert.strictEqual(erst.abgebrochen, true);
  assert.ok(erst.offen.length > 0 && erst.offen.length < 7, JSON.stringify(erst));
  assert.ok(f.trigger.some(x => x.funktion === 'wartungFortsetzen' && x.nachMs === 60000), 'Folge-Trigger fehlt');
  const rest = rein(g.wartungFortsetzen());
  assert.deepStrictEqual(Object.keys(rest.ergebnisse), erst.offen);
  assert.deepStrictEqual(rest.offen, []);
  assert.ok(!f.trigger.some(x => x.funktion === 'wartungFortsetzen'), 'Folge-Trigger nicht aufgeräumt');
});

test('Fehler in einem Schritt hält die anderen nicht auf', () => {
  const { tabs } = vorbereitet();
  const f = erzeugeFakes({ tabs, email: EIG, eigentuemer: EIG });
  const g = ladeProjekt(f.globale);
  g.NachweiseModul.fristenAktualisieren = () => { throw new Error('kaputt'); };
  const erg = rein(g.wartungNachts());
  assert.match(String(erg.ergebnisse.fristen), /^Fehler/);
  assert.ok(typeof erg.ergebnisse.status === 'number');
  assert.strictEqual(erg.ergebnisse.snapshot, 'neu gebaut');
});
