/**
 * Integrationstest Phase 1: alle Module zusammen gegen die Fakes aus test/hilfe/gas-fakes.js.
 *
 * Ablauf wie in der Einrichtung (docs/BETRIEB.md): leeres Sheet → setup() durch das Funktionskonto →
 * Benutzer eintragen → Aufrufe verschiedener Rollen. Jeder Nutzer bekommt einen eigenen Projekt-Kontext
 * (eigene „Ausführung“) auf demselben Datenbestand.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes, isoZuSerial } = require('./hilfe/gas-fakes');

const EIGENTUEMER = 'verwaltung@tsv-ergoldsbach.de';

/** Neue „Ausführung“ als `email` auf dem Datenbestand `tabs` (Cache bewusst leer = kalter Start). */
function als(email, tabs) {
  const f = erzeugeFakes({ tabs, email, eigentuemer: EIGENTUEMER });
  return { f, g: ladeProjekt(f.globale), tabs: () => alleTabs(f) };
}
function alleTabs(f) {
  const t = {};
  f.datei.getSheets().forEach(b => { t[b.getName()] = f.daten(b.getName()).map(z => z.slice()); });
  return t;
}

function eingerichtet() {
  const e = als(EIGENTUEMER, {});
  const bericht = e.g.setup();
  assert.match(String(bericht), /Mitglied/);
  // Benutzer eintragen (wie per Hand im Sheet): Kopf über Namen
  const tabs = e.tabs();
  const kopf = tabs.Benutzer[0];
  const zeile = (werte) => kopf.map(k => (k in werte ? werte[k] : ''));
  tabs.Benutzer.push(zeile({ benutzer_id: 1, email: 'mv@tsv-ergoldsbach.de', rolle: 'Mitgliederverwalter', aktiv: 'ja' }));
  tabs.Benutzer.push(zeile({ benutzer_id: 2, email: 'al@tsv-ergoldsbach.de', rolle: 'Abteilungsleiter', abteilung_id: 1, aktiv: 'ja' }));
  tabs.Benutzer.push(zeile({ benutzer_id: 3, email: 'alt@tsv-ergoldsbach.de', rolle: 'Kassier', aktiv: 'nein' }));
  return tabs;
}

test('setup legt alle Tabs aus dem Schema an und ist idempotent', () => {
  const e = als(EIGENTUEMER, {});
  e.g.setup();
  const namen = e.f.datei.getSheets().map(b => b.getName());
  Object.keys(e.g.Schema.TABELLEN).forEach(t => assert.ok(namen.includes(t), t + ' fehlt'));
  const vorher = JSON.stringify(e.tabs());
  e.g.setup();
  assert.strictEqual(JSON.stringify(e.tabs()), vorher, 'zweiter setup-Lauf hat etwas verändert');
});

test('setup darf nur das Funktionskonto', () => {
  const tabs = eingerichtet();
  const mv = als('mv@tsv-ergoldsbach.de', tabs);
  assert.throws(() => mv.g.setup(), e => e.art === 'zugriff');
});

test('apiStart: Mitgliederverwalter bekommt Startdaten, wenige Tabellenzugriffe', () => {
  const tabs = eingerichtet();
  const mv = als('mv@tsv-ergoldsbach.de', tabs);
  const a = rein(mv.g.apiStart());
  assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
  assert.deepStrictEqual(a.daten.benutzer.rollen, ['Mitgliederverwalter']);
  assert.strictEqual(a.daten.abteilungen.length, 5);
  assert.ok(a.daten.aktionen.includes('messung_lesen'));
  assert.ok(a.messung.sheets <= 4, 'Tabellenzugriffe kalt: ' + a.messung.sheets);
  // zweiter Aufruf in derselben Ausführung: Benutzer und Konfig aus dem Cache
  const b = rein(mv.g.apiStart());
  assert.ok(b.messung.sheets <= a.messung.sheets);
});

test('unbekannte und inaktive Nutzer werden abgewiesen und protokolliert, Meldung generisch', () => {
  const tabs = eingerichtet();
  for (const email of ['fremd@tsv-ergoldsbach.de', 'alt@tsv-ergoldsbach.de', '']) {
    const x = als(email, tabs);
    const a = rein(x.g.apiStart());
    assert.strictEqual(a.ok, false);
    assert.strictEqual(a.fehler.art, 'zugriff');
    assert.doesNotMatch(JSON.stringify(a.fehler), /Benutzer|Tab|stack|\.js|Error/);
    const prot = x.f.daten('_Protokoll');
    const iAktion = prot[0].indexOf('aktion');
    assert.ok(prot.slice(1).some(z => z[iAktion] === 'abgewiesen'), 'Abweisung nicht protokolliert: ' + email);
    // doGet liefert eine generische Seite statt der Oberfläche
    assert.ok(x.g.doGet({}));
  }
});

test('Abteilungsleiter: Start ja, Messwerte nein', () => {
  const tabs = eingerichtet();
  const al = als('al@tsv-ergoldsbach.de', tabs);
  assert.strictEqual(rein(al.g.apiStart()).ok, true);
  const m = rein(al.g.apiMessungen());
  assert.strictEqual(m.ok, false);
  assert.strictEqual(m.fehler.art, 'zugriff');
});

test('Schreiben: einfuegen unter Sperre, Protokoll, Versionskonflikt', () => {
  const tabs = eingerichtet();
  const mv = als('mv@tsv-ergoldsbach.de', tabs);
  const ktx = mv.g.Zugriff.pruefe('mitglied_anlegen');
  const neu = rein(mv.g.DB.mitSperre(() => {
    const m = mv.g.DB.einfuegen('Mitglied', { mitgliedsnummer: '0001', vorname: 'Erika', nachname: 'Muster', status: 'aktiv' }, ktx);
    mv.g.Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Mitglied', datensatz_id: m.mitglied_id }]);
    return m;
  }));
  assert.strictEqual(neu.version, 1);
  assert.strictEqual(neu.mitgliedsnummer, '0001');
  const r = rein(mv.g.DB.mitSperre(() => mv.g.DB.aktualisieren('Mitglied', neu.mitglied_id, { ort: 'Ergoldsbach' }, 1, ktx)));
  assert.strictEqual(r.neu.version, 2);
  assert.throws(() => mv.g.DB.mitSperre(() => mv.g.DB.aktualisieren('Mitglied', neu.mitglied_id, { ort: 'Landshut' }, 1, ktx)),
    e => e.art === 'konflikt' && e.aktuell && e.aktuell.ort === 'Ergoldsbach');
  // Doppelte Mitgliedsnummer wird abgelehnt
  assert.throws(() => mv.g.DB.mitSperre(() => mv.g.DB.einfuegen('Mitglied', { mitgliedsnummer: '0001', vorname: 'X', nachname: 'Y' }, ktx)),
    e => e.art === 'fachlich');
  const prot = mv.f.daten('_Protokoll');
  assert.ok(prot.length >= 2);
});

test('Messung: Puffer → _Messung über den Trigger (nur Funktionskonto)', () => {
  const tabs = eingerichtet();
  const mv = als('mv@tsv-ergoldsbach.de', tabs);
  mv.g.apiStart(); mv.g.apiPing();
  mv.g.messungSchreiben();   // Trigger-Funktion verschluckt Fehler bewusst; als Nutzer darf sie nichts schreiben
  assert.strictEqual(mv.f.daten('_Messung').length, 1, 'Nutzer konnte _Messung schreiben');
  // Trigger läuft als Eigentümer in derselben Umgebung (gleicher Cache)
  const f = erzeugeFakes({ tabs: alleTabs(mv.f), email: EIGENTUEMER, eigentuemer: EIGENTUEMER });
  f.globale.CacheService = mv.f.globale.CacheService;
  const t = ladeProjekt(f.globale);
  t.messungSchreiben();
  const zeilen = f.daten('_Messung').slice(1);
  assert.ok(zeilen.length >= 2, 'Messwerte nicht geschrieben');
  const iRolle = f.daten('_Messung')[0].indexOf('rolle');
  assert.ok(zeilen.every(z => !String(z[iRolle]).includes('@')), 'keine E-Mail in _Messung');
});

test('Protokoll wächst über die 1000-Zeilen-Grenze eines neuen Tabs hinaus', () => {
  const tabs = eingerichtet();
  const mv = als('mv@tsv-ergoldsbach.de', tabs);
  const ktx = mv.g.Zugriff.pruefe('start');
  const viele = Array.from({ length: 1200 }, (_, i) => ({ aktion: 'geändert', tabelle: 'Mitglied', datensatz_id: i }));
  mv.g.Protokoll.schreibe(ktx, viele);
  mv.g.Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Mitglied', datensatz_id: 9999 }]);
  const prot = mv.f.daten('_Protokoll');
  assert.strictEqual(prot.length, 1 + 1201);
  const iId = prot[0].indexOf('protokoll_id');
  assert.strictEqual(prot[prot.length - 1][iId], 1201, 'protokoll_id fortlaufend');
});
