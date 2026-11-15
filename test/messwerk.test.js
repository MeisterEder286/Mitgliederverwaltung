/**
 * Messwerk (docs/LEISTUNG.md): Abschnitte, Zählung, Bericht _mess nur für Rollen mit messung_lesen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const verein = erzeugeVerein({ seed: 5, mitglieder: 150 });
function als(rolle) {
  const k = verein.tabs.Benutzer[0];
  const z = verein.tabs.Benutzer.slice(1).find(r => r[k.indexOf('rolle')] === rolle && r[k.indexOf('aktiv')] !== 'nein');
  const f = erzeugeFakes({ tabs: verein.tabs, email: z[k.indexOf('email')] });
  return { f, g: ladeProjekt(f.globale), email: z[k.indexOf('email')] };
}
function erstesMitglied(f) {
  const d = f.daten('Mitglied');
  const k = d[0];
  const z = d.slice(1).find(r => r[k.indexOf('anonymisiert')] !== 'ja' && r[k.indexOf('verarbeitung_eingeschraenkt')] !== 'ja');
  return { id: z[k.indexOf('mitglied_id')], version: Number(z[k.indexOf('version')] || 0), nachname: z[k.indexOf('nachname')] };
}

test('Abschnitte: exklusive Zeiten + rest = gesamt, inklusive Zeiten enthalten Verschachteltes', () => {
  const { g } = als('Mitgliederverwalter');
  const M = g.Messung;
  let jetzt = 1000;
  const D = require('vm').runInContext('Date', g);   // Date des vm-Kontexts steuern
  const echt = D.now;
  D.now = () => jetzt;
  try {
    const h = M.start('probe');
    jetzt += 5;                                    // rest
    M.abschnitt('handler', () => {
      jetzt += 10;
      M.abschnitt('log', () => { jetzt += 7; M.miss('schreiben', { methode: 'setValues', tab: 'X', zellen: 3 }, () => { jetzt += 20; }); });
      jetzt += 3;
    });
    M.ende(h, { ok: true });
    const b = rein(M.bericht());
    assert.strictEqual(b.gesamt_ms, 45);
    assert.strictEqual(b.abschnitte.handler.ms, 13);
    assert.strictEqual(b.abschnitte.handler.inkl, 40);
    assert.strictEqual(b.abschnitte.log.ms, 7);
    assert.strictEqual(b.abschnitte.schreiben.ms, 20);
    assert.strictEqual(b.rest_ms, 5);
    assert.strictEqual(b.schreibungen, 1);
    assert.strictEqual(b.zellen_geschrieben, 3);
    assert.strictEqual(b.spur[0].in, 'log');
  } finally { D.now = echt; }
});

test('apiMessen: Schreibaktion als Mitgliederverwalter liefert _mess mit Sperre, Zugriffen und Tabellen', () => {
  const { f, g, email } = als('Mitgliederverwalter');
  const m = erstesMitglied(f);
  const a = rein(g.apiMessen('apiMitgliedSpeichern', [m.id, m.version, { ort: 'Neufahrn' }]));
  assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
  const b = a._mess;
  assert.ok(b, '_mess fehlt');
  assert.strictEqual(b.funktion, 'apiMitgliedSpeichern');
  for (const n of ['pruefkette', 'handler', 'ansicht', 'sperre', 'schreiben', 'flush']) assert.ok(b.abschnitte[n], 'Abschnitt ' + n);
  assert.ok(b.abschnitte.log, 'Protokoll-Abschnitt');
  assert.ok(b.lesungen >= 1 && b.schreibungen >= 2 && b.flushes >= 1, JSON.stringify(b));
  assert.ok(b.tabellen.includes('Mitglied'));
  assert.ok(b.zellen_geschrieben > 0);
  const summe = Object.values(b.abschnitte).reduce((s, x) => s + x.ms, 0) + b.rest_ms;
  assert.ok(Math.abs(summe - b.gesamt_ms) <= 1, summe + ' vs ' + b.gesamt_ms);
  const text = JSON.stringify(b);
  assert.ok(!text.includes(email) && !text.includes('@'), 'keine E-Mail im Bericht');
  assert.ok(!text.includes(m.nachname), 'keine Zellinhalte im Bericht');
});

test('_mess nur auf Anforderung und nur mit messung_lesen; Anforderung gilt für genau einen Aufruf', () => {
  const mv = als('Mitgliederverwalter');
  assert.strictEqual(rein(mv.g.apiPing())._mess, undefined, 'ohne apiMessen kein Bericht');
  assert.ok(rein(mv.g.apiMessen('apiPing', []))._mess);
  assert.strictEqual(rein(mv.g.apiPing())._mess, undefined, 'Anforderung darf nicht nachwirken');

  const al = als('Abteilungsleiter');
  const a = rein(al.g.apiMessen('apiPing', []));
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a._mess, undefined, 'Abteilungsleiter hat kein messung_lesen');

  const fremd = erzeugeFakes({ tabs: verein.tabs, email: 'fremd@example.org' });
  const r = rein(ladeProjekt(fremd.globale).apiMessen('apiPing', []));
  assert.strictEqual(r.fehler.art, 'zugriff');
  assert.strictEqual(r._mess, undefined);
});

test('apiMessen ruft nur öffentliche api…-Funktionen', () => {
  const { g } = als('Mitgliederverwalter');
  for (const n of ['doGet', 'setup', 'apiMessen', 'Api', 'api', 'apiGibtEsNicht', 'Messung.bericht', null]) {
    const a = rein(g.apiMessen(n, []));
    assert.strictEqual(a.ok, false, String(n));
    assert.strictEqual(a.fehler.art, 'fachlich');
  }
  assert.strictEqual(rein(g.apiPing())._mess, undefined);
});

test('doGet?messen=1 bettet den Bericht nur für Rollen mit messung_lesen ein', () => {
  const mv = als('Mitgliederverwalter');
  const seite = mv.g.doGet({ parameter: { messen: '1' } });
  assert.match(seite.getContent(), /id="mess-start"/);
  const json = /id="mess-start">(.*)<\/script>/.exec(seite.getContent())[1];
  const b = JSON.parse(json);
  assert.strictEqual(b.funktion, 'doGet');
  assert.strictEqual(typeof b.seite_ms, 'number');
  assert.doesNotMatch(mv.g.doGet({ parameter: {} }).getContent(), /mess-start/);
  const al = als('Abteilungsleiter');
  assert.doesNotMatch(al.g.doGet({ parameter: { messen: '1' } }).getContent(), /mess-start/);
});

test('Messhülle verändert das Verhalten der Datenschicht nicht (Zähler der Fakes gleich)', () => {
  const { f, g } = als('Mitgliederverwalter');
  const m = erstesMitglied(f);
  f.zaehler.sheets = 0;
  const a = rein(g.apiMitgliedSpeichern(m.id, m.version, { ort: 'Bachhausen' }));
  assert.strictEqual(a.ok, true);
  const b = als('Mitgliederverwalter');
  b.f.zaehler.sheets = 0;
  const c = rein(b.g.apiMessen('apiMitgliedSpeichern', [m.id, m.version, { ort: 'Bachhausen' }]));
  assert.strictEqual(c.ok, true);
  assert.strictEqual(b.f.zaehler.sheets, f.zaehler.sheets, 'apiMessen darf keine zusätzlichen Blattzugriffe auslösen');
});
