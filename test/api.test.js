/**
 * Tests für Api.ausfuehren, Zugriff, Protokoll und Messung mit kleinen Stubs
 * (unabhängig von den Fakes in test/hilfe/gas-fakes.js).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ladeProjekt, rein } = require('./hilfe/projekt');

/** Minimaler Script-Cache. */
function fakeCache() {
  const m = new Map();
  return { get: k => (m.has(k) ? m.get(k) : null), put: (k, v) => m.set(k, v), remove: k => m.delete(k), _m: m };
}

/** Minimales Blatt mit Kopfzeile. */
function fakeBlatt(kopf) {
  const daten = [kopf.slice()];
  return {
    daten,
    getLastRow: () => daten.length,
    getLastColumn: () => kopf.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => daten.slice(r - 1, r - 1 + nr).map(z => z.slice(c - 1, c - 1 + nc)),
      setValues: (werte) => { werte.forEach((z, i) => { daten[r - 1 + i] = z.slice(); }); }
    })
  };
}

const PROTOKOLL_KOPF = ['protokoll_id', 'zeitpunkt', 'benutzer_email', 'aktion', 'tabelle', 'datensatz_id',
  'feld', 'alt_wert', 'neu_wert', 'kommentar', 'bereinigt_am'];

function umgebung({ email = 'al@tsv.de', effektiv = 'owner@tsv.de', benutzer } = {}) {
  const cache = fakeCache();
  const protokoll = fakeBlatt(PROTOKOLL_KOPF);
  const messungBlatt = fakeBlatt(['zeitpunkt', 'funktion', 'rolle', 'dauer_ms', 'sheets_aufrufe', 'cache', 'client_ms', 'ok']);
  let sheets = 0, leseAufrufe = 0;
  const g = ladeProjekt({
    Session: { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => effektiv }) },
    CacheService: { getScriptCache: () => cache }
  });
  g.DB = {
    lese: (tabs) => { leseAufrufe++; sheets++; return tabs.includes('Benutzer') ? { Benutzer: benutzer || [
      { email: 'al@tsv.de', rolle: 'Abteilungsleiter', abteilung_id: 1, aktiv: true }] } : { _Messung: [] }; },
    blatt: (tab) => (tab === '_Protokoll' ? protokoll : messungBlatt),
    jetzt: () => '2026-10-25T12:00:00',
    zaehler: () => ({ sheets }),
    zaehlerZuruecksetzen: () => { sheets = 0; },
    zaehle: (n) => { sheets += n || 1; }
  };
  g.Werte = g.Werte && g.Werte.zuSerial ? g.Werte : { zuSerial: () => 46320.5 };
  g.Konfig = { wert: () => null };
  return { g, cache, protokoll, messungBlatt, leseAufrufe: () => leseAufrufe };
}

test('erfolgreicher Aufruf liefert ok, Daten und Messung', () => {
  const { g } = umgebung();
  const a = g.Api.ausfuehren('apiTest', 'start', (ktx) => ({ rollen: ktx.rollen, wann: new Date(0) }));
  assert.equal(a.ok, true);
  assert.deepEqual(rein(a.daten.rollen), ['Abteilungsleiter']);
  assert.equal(typeof a.daten.wann, 'string', 'Date wird serialisiert');
  assert.equal(typeof a.messung.server_ms, 'number');
  assert.equal(a.messung.sheets, 1);
});

test('Benutzer werden gecacht: zweiter Aufruf liest die Tabelle nicht erneut', () => {
  const u = umgebung();
  u.g.Api.ausfuehren('a', 'start', () => 1);
  u.g.Api.ausfuehren('a', 'start', () => 1);
  assert.equal(u.leseAufrufe(), 1);
  u.g.Zugriff.vergessen();
  u.g.Api.ausfuehren('a', 'start', () => 1);
  assert.equal(u.leseAufrufe(), 2);
});

test('fehlende Berechtigung → art zugriff, generische Meldung, Protokolleintrag abgewiesen', () => {
  const u = umgebung();
  let ausgefuehrt = false;
  const a = u.g.Api.ausfuehren('apiKonto', 'konto_lesen', () => { ausgefuehrt = true; });
  assert.equal(ausgefuehrt, false);
  assert.deepEqual(rein(a.fehler), { art: 'zugriff', meldung: 'Kein Zugriff.' });
  assert.ok(a.messung);
  const z = u.protokoll.daten[1];
  assert.equal(z[0], 1);
  assert.equal(z[2], 'al@tsv.de');
  assert.equal(z[3], 'abgewiesen');
  assert.equal(z[9], 'konto_lesen');
});

test('leere E-Mail wird abgewiesen', () => {
  const u = umgebung({ email: '' });
  const a = u.g.Api.ausfuehren('apiStart', 'start', () => 1);
  assert.equal(a.fehler.art, 'zugriff');
  assert.equal(u.protokoll.daten[1][2], '(unbekannt)');
});

test('Abweisung bleibt bestehen, auch wenn das Protokoll nicht schreibbar ist', () => {
  const u = umgebung({ email: 'fremd@tsv.de' });
  u.g.DB.blatt = () => { throw new Error('Tabelle weg'); };
  const orig = console.error; console.error = () => {};
  try {
    const a = u.g.Api.ausfuehren('apiStart', 'start', () => 1);
    assert.equal(a.fehler.art, 'zugriff');
  } finally { console.error = orig; }
});

test('fachliche Fehler und Konflikte werden mit ihrer Meldung durchgereicht', () => {
  const { g } = umgebung();
  const f = g.Api.ausfuehren('x', 'start', () => { throw g.Fehler.fachlich('Mitgliedsnummer ist schon vergeben.'); });
  assert.deepEqual(rein(f.fehler), { art: 'fachlich', meldung: 'Mitgliedsnummer ist schon vergeben.' });
  const k = g.Api.ausfuehren('x', 'start', () => { throw g.Fehler.konflikt({ mitglied_id: 1, version: 4 }); });
  assert.equal(k.fehler.art, 'konflikt');
  assert.deepEqual(rein(k.fehler.aktuell), { mitglied_id: 1, version: 4 });
});

test('interne Fehler: generische Meldung mit Nr., keine Interna; Details nur im Log', () => {
  const { g } = umgebung();
  const log = [];
  const orig = console.error; console.error = (m) => log.push(m);
  let a;
  try {
    a = g.Api.ausfuehren('apiGeheim', 'start', () => { throw new TypeError("Cannot read 'iban' of Beitragskonto"); });
  } finally { console.error = orig; }
  assert.equal(a.fehler.art, 'intern');
  assert.match(a.fehler.meldung, /^Es ist ein Fehler aufgetreten\. .*Fehler-Nr\. [A-Z0-9]+\)\.$/);
  const text = JSON.stringify(a);
  assert.ok(!/iban|Beitragskonto|TypeError|at /.test(text), 'keine Interna in der Antwort: ' + text);
  assert.ok(log[0].includes(a.fehler.nr) && log[0].includes('Beitragskonto'));
});

test('Messung wird auch bei Fehlern beendet und gepuffert', () => {
  const u = umgebung();
  const orig = console.error; console.error = () => {};
  try { u.g.Api.ausfuehren('apiKaputt', 'start', () => { throw new Error('x'); }); } finally { console.error = orig; }
  const puffer = JSON.parse(u.cache.get('messung:puffer'));
  assert.equal(puffer.length, 1);
  assert.equal(puffer[0].funktion, 'apiKaputt');
  assert.equal(puffer[0].ok, false);
  assert.equal(puffer[0].rolle, 'Abteilungsleiter');
  assert.ok(!JSON.stringify(puffer).includes('@'), 'keine E-Mail im Messwert');
});

test('Messung: Puffer wird begrenzt, Client-Werte geprüft, Puffer wird nach _Messung geschrieben', () => {
  const u = umgebung();
  u.g.Konfig = { wert: () => '3' };
  for (let i = 0; i < 5; i++) u.g.Messung.ende(u.g.Messung.start('f' + i), { ok: true });
  let puffer = JSON.parse(u.cache.get('messung:puffer'));
  assert.deepEqual(puffer.map(p => p.funktion), ['f2', 'f3', 'f4']);
  u.g.Konfig = { wert: () => null };
  const n = u.g.Messung.clientWerte([{ name: 'apiStart', client_ms: 812.4 }, { name: '<script>', client_ms: 1 },
    { name: 'apiPing', client_ms: 'x' }, null]);
  assert.equal(n, 1);
  assert.equal(u.g.Messung.schreibePuffer(), 4);
  assert.equal(u.messungBlatt.daten.length, 5);
  const letzte = u.messungBlatt.daten[4];
  assert.equal(letzte[1], 'apiStart');
  assert.equal(letzte[6], 812);
  assert.equal(letzte[7], 'ja');
  assert.deepEqual(JSON.parse(u.cache.get('messung:puffer')), []);
});

test('Messung: Cache-Fehler lassen den Aufruf nicht scheitern', () => {
  const u = umgebung();
  u.g.Zugriff.pruefe('start'); // füllt nichts Kritisches
  const kaputt = { get: () => { throw new Error('Cache'); }, put: () => { throw new Error('Cache'); }, remove() {} };
  u.g.CacheService = { getScriptCache: () => kaputt };
  const a = u.g.Api.ausfuehren('apiStart', 'start', () => 42);
  assert.equal(a.ok, true);
  assert.equal(a.daten, 42);
});

test('Protokoll: fortlaufende IDs, ein Schreibzugriff, Kürzung und Formelschutz', () => {
  const u = umgebung();
  const ktx = { email: 'mv@tsv.de' };
  u.g.Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Mitglied', datensatz_id: 5 }]);
  u.g.Protokoll.schreibe(ktx, u.g.Protokoll.ausDiff('Mitglied', 5, [
    { feld: 'bemerkung', alt: '=HYPERLINK("x")', neu: 'a'.repeat(800) },
    { feld: 'ort', alt: null, neu: 'Ergoldsbach' }
  ]));
  const d = u.protokoll.daten;
  assert.deepEqual(d.slice(1).map(z => z[0]), [1, 2, 3]);
  assert.equal(d[2][3], 'geändert');
  assert.equal(d[2][6], 'bemerkung');
  assert.equal(d[2][7], '\'=HYPERLINK("x")');
  assert.equal(d[2][8].length, 500);
  assert.equal(d[3][7], '');
  assert.equal(u.g.Protokoll.schreibe(ktx, []), 0);
});

test('nurFunktionskonto: nur wenn aktiver = effektiver Nutzer', () => {
  const ok = umgebung({ email: 'Owner@tsv.de', effektiv: 'owner@tsv.de' });
  assert.equal(ok.g.Zugriff.nurFunktionskonto().email, 'owner@tsv.de');
  const nein = umgebung({ email: 'al@tsv.de', effektiv: 'owner@tsv.de' });
  assert.throws(() => nein.g.Zugriff.nurFunktionskonto(), (e) => e.art === 'zugriff');
  const leer = umgebung({ email: '', effektiv: 'owner@tsv.de' });
  assert.throws(() => leer.g.Zugriff.nurFunktionskonto(), (e) => e.art === 'zugriff');
});
