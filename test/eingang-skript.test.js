/**
 * Tests für das getrennte Eingangs-Projekt (eingang/Eingang.js): Prüfung der Anfrage (Schlüssel, Größen, PDF,
 * DOCTYPE), Formelschutz, doPost mit kleinen Drive-/ContentService-Fakes (Dateien im Ordner, Zeile angehängt,
 * kein Doppel bei Wiederholung, Stundengrenze), Einrichtung – und der Weg bis zur Übernahme in der WebApp.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const SCHLUESSEL = 'k'.repeat(40);
const EIN = 'EINGANG-TEST';
const XML = fs.readFileSync(path.join(__dirname, 'daten', 'beitritt', 'homepage.xml'), 'utf8');
const PDF = Buffer.from('%PDF-1.4\n% synthetisch\n').toString('base64');

function lade(globale) {
  const ctx = vm.createContext(Object.assign({ console: { log() {}, error() {} } }, globale || {}));
  new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'eingang', 'Eingang.js'), 'utf8'), { filename: 'Eingang.js' }).runInContext(ctx);
  return ctx;
}
const P = lade().EingangPruefung;

/** Fakes: Eingangstabelle als weitere Datei, Drive v3 und ContentService minimal. */
function umgebung(optionen) {
  optionen = optionen || {};
  const dateien = [];
  const Drive = { Files: { create(meta, blob) {
    const id = 'f' + (dateien.length + 1);
    dateien.push({ id, meta, inhalt: blob ? blob.getBytes() : null });
    return { id, webViewLink: 'https://drive.google.com/file/d/' + id + '/view?usp=drivesdk' };
  } } };
  const ContentService = { MimeType: { JSON: 'json' }, createTextOutput(t) { return { text: t, setMimeType() { return this; } }; } };
  const tabs = optionen.tabs || { Eingang: [P.SPALTEN.slice()] };
  const f = erzeugeFakes({ tabs: {}, properties: Object.assign({ SCHLUESSEL, EINGANG_ID: EIN, ORDNER_ID: 'ORD' }, optionen.properties || {}),
    weitereDateien: { [EIN]: tabs } });
  const ctx = lade(Object.assign({}, f.globale, { Drive, ContentService }));
  const sende = (o) => JSON.parse(ctx.doPost({ postData: { contents: typeof o === 'string' ? o : JSON.stringify(o) } }).text);
  const zeilen = () => { const d = f.daten(EIN + '/Eingang'); return d.slice(1).map(z => Object.fromEntries(d[0].map((h, i) => [h, z[i]]))); };
  return { f, ctx, sende, zeilen, dateien };
}
const antrag = (o) => Object.assign({ schluessel: SCHLUESSEL, antrag_id: 'a1b2c3d4-0001', xml: XML, pdf_base64: PDF,
  dateiname: 'tsv-beitritt-Beispiel-2026-10-25-213000.xml', unterschrift_am: '2026-10-25' }, o || {});

test('Spalten wie in der WebApp (src/lib/eingang.js)', () => {
  assert.deepStrictEqual([...P.SPALTEN], [...ladeProjekt({}).Eingang.SPALTEN]);
});

test('Prüfung: Schlüssel, IDs, XML (Daten16, kein DOCTYPE, Größe), PDF, Datum, Dateiname', () => {
  assert.strictEqual(P.pruefeAnfrage(antrag(), '').fehler, 'nicht_eingerichtet');
  assert.strictEqual(P.pruefeAnfrage(antrag(), 'zu-kurz').fehler, 'nicht_eingerichtet');
  assert.strictEqual(P.pruefeAnfrage(antrag({ schluessel: 'falsch' }), SCHLUESSEL).fehler, 'nicht_berechtigt');
  assert.strictEqual(P.pruefeAnfrage(antrag({ schluessel: SCHLUESSEL + 'x' }), SCHLUESSEL).fehler, 'nicht_berechtigt');
  assert.strictEqual(P.pruefeAnfrage(antrag({ antrag_id: 'x' }), SCHLUESSEL).fehler, 'ungueltig');
  assert.strictEqual(P.pruefeAnfrage(antrag({ xml: '<dataroot/>' }), SCHLUESSEL).fehler, 'ungueltig');
  assert.strictEqual(P.pruefeAnfrage(antrag({ xml: '<!DOCTYPE x><dataroot><Daten16/></dataroot>' }), SCHLUESSEL).fehler, 'ungueltig');
  assert.strictEqual(P.pruefeAnfrage(antrag({ xml: '<dataroot><Daten16>' + 'x'.repeat(P.MAX_XML) + '</Daten16></dataroot>' }), SCHLUESSEL).fehler, 'ungueltig');
  assert.strictEqual(P.pruefeAnfrage(antrag({ pdf_base64: 'kein base64!' }), SCHLUESSEL).fehler, 'ungueltig');
  assert.strictEqual(P.pruefeAnfrage(antrag({ unterschrift_am: '25.10.2026' }), SCHLUESSEL).fehler, 'ungueltig');
  const ok = P.pruefeAnfrage(antrag(), SCHLUESSEL);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.antrag.dateiname, 'tsv-beitritt-Beispiel-2026-10-25-213000');
  assert.strictEqual(P.basisname('../../etc/passwd', 'id1'), 'etc-passwd');
  assert.strictEqual(P.basisname('', 'id1'), 'tsv-beitritt-id1');
  assert.strictEqual(P.istPdf([...Buffer.from('%PDF-1.7')]), true);
  assert.strictEqual(P.istPdf([...Buffer.from('<html>')]), false);
  assert.deepStrictEqual([...P.zeile(['a', 'b', 'c'], { a: '=HYPERLINK("x")', b: '+49 171', c: 'normal' })], ["'=HYPERLINK(\"x\")", "'+49 171", 'normal']);
});

test('doPost: XML und PDF im Ordner, Zeile „neu“ angehängt, Antwort ohne Details; Wiederholung ohne Doppel', () => {
  const u = umgebung();
  const r = u.sende(antrag());
  assert.deepStrictEqual(r, { ok: true, eingang_id: 'a1b2c3d4-0001' });
  assert.deepStrictEqual(u.dateien.map(d => [d.meta.name, d.meta.mimeType, d.meta.parents[0]]),
    [['tsv-beitritt-Beispiel-2026-10-25-213000.xml', 'text/xml', 'ORD'], ['tsv-beitritt-Beispiel-2026-10-25-213000.pdf', 'application/pdf', 'ORD']]);
  assert.strictEqual(Buffer.from(u.dateien[1].inhalt).toString().slice(0, 5), '%PDF-');
  const z = u.zeilen();
  assert.strictEqual(z.length, 1);
  assert.strictEqual(z[0].status, 'neu');
  assert.strictEqual(z[0].xml, XML);
  assert.strictEqual(z[0].unterschrift_am, '2026-10-25');
  assert.match(z[0].pdf_link, /^https:\/\/drive\.google\.com\/file\/d\/f2\//);
  assert.match(z[0].eingang_am, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  // WordPress wiederholt nach Zeitüberschreitung mit derselben antrag_id
  assert.deepStrictEqual(u.sende(antrag()), { ok: true, eingang_id: 'a1b2c3d4-0001', doppelt: true });
  assert.strictEqual(u.zeilen().length, 1);
  assert.strictEqual(u.dateien.length, 2);
});

test('doPost: abgewiesen bei falschem Schlüssel, kaputtem JSON, Nicht-PDF, fehlender Einrichtung; Stundengrenze', () => {
  const u = umgebung();
  assert.deepStrictEqual(u.sende(antrag({ schluessel: 'falsch' })), { ok: false, fehler: 'nicht_berechtigt' });
  assert.deepStrictEqual(u.sende('{kein json'), { ok: false, fehler: 'ungueltig' });
  assert.deepStrictEqual(u.sende(antrag({ pdf_base64: Buffer.from('<html>').toString('base64') })), { ok: false, fehler: 'ungueltig' });
  assert.strictEqual(u.zeilen().length, 0);
  assert.strictEqual(umgebung({ properties: { ORDNER_ID: '' } }).sende(antrag()).fehler, 'nicht_eingerichtet');
  assert.strictEqual(umgebung({ tabs: { Tabelle1: [] } }).sende(antrag()).fehler, 'nicht_eingerichtet');
  // ohne PDF: angenommen, pdf_link leer (die WebApp weist beim Übernehmen darauf hin)
  const ohne = umgebung();
  assert.strictEqual(ohne.sende(antrag({ pdf_base64: '' })).ok, true);
  assert.strictEqual(ohne.zeilen()[0].pdf_link, '');
  const v = umgebung();
  for (let i = 0; i < P.MAX_JE_STUNDE; i++) assert.strictEqual(v.sende(antrag({ antrag_id: 'grenze-' + String(i).padStart(4, '0') })).ok, true);
  assert.deepStrictEqual(v.sende(antrag({ antrag_id: 'grenze-zuviel' })), { ok: false, fehler: 'zu_viele' });
});

test('einrichten: Schlüssel und Ordner einmalig, Tab mit Kopfzeile, zweiter Lauf ändert nichts', () => {
  const u = umgebung({ tabs: { Tabelle1: [] }, properties: { SCHLUESSEL: '', ORDNER_ID: '' } });
  const text = u.ctx.einrichten();
  assert.match(text, /TSV_EINGANG_SCHLUESSEL', '[0-9a-f]{64}'/);
  assert.match(text, /Ordner „Beitritte Eingang“ angelegt/);
  assert.strictEqual(u.f.properties.ORDNER_ID, 'f1');
  assert.deepStrictEqual(u.f.daten(EIN + '/Eingang')[0], [...P.SPALTEN]);
  const zweiter = u.ctx.einrichten();
  assert.match(zweiter, /SCHLUESSEL vorhanden/);
  assert.match(zweiter, /Kopfzeile vollständig/);
});

test('Ganzer Weg: Homepage → Eingangs-Skript → WebApp übernimmt, Mandatsdatum = Unterschrift, PDF verknüpft', () => {
  const e = umgebung();
  assert.strictEqual(e.sende(antrag()).ok, true);
  const v = erzeugeVerein({ seed: 5, mitglieder: 300 });
  const k = v.tabs.Benutzer[0];
  const mv = v.tabs.Benutzer.slice(1).find(r => r[k.indexOf('rolle')] === 'Mitgliederverwalter');
  const f = erzeugeFakes({ tabs: v.tabs, email: mv[k.indexOf('email')], properties: { EINGANG_ID: EIN },
    weitereDateien: { [EIN]: { Eingang: e.f.daten(EIN + '/Eingang') } } });
  const g = ladeProjekt(f.globale);
  const liste = rein(g.apiBeitrittEingang()).daten;
  assert.deepStrictEqual(liste.offen.map(o => o.personen.length), [3]);
  const r = rein(g.apiBeitrittEingangImportieren(['a1b2c3d4-0001'], [{ eingang_id: 'a1b2c3d4-0001' }]));
  assert.strictEqual(r.ok, true, JSON.stringify(r.fehler));
  const erg = r.daten.ergebnisse[0];
  assert.strictEqual(erg.dokumente, 4);
  const konto = g.DB.lese(['Beitragskonto']).Beitragskonto.find(x => x.beitragskonto_id === erg.konto_id);
  assert.strictEqual(konto.mandatsdatum, '2026-10-25');
  assert.strictEqual(f.daten(EIN + '/Eingang')[1][P.SPALTEN.indexOf('status')], 'uebernommen');
});
