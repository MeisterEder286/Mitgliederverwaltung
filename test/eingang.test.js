/**
 * Tests Online-Anträge aus der Eingangstabelle (src/lib/eingang.js, src/modul/Beitritt.js, src/api/Beitritt.js).
 * Die Homepage legt je Antrag eine Zeile mit der XML (Access-Format) und dem Link auf das unterschriebene PDF in den
 * Tab „Eingang“ einer getrennten Datei. Geprüft: Zerleger wie im Browser, keine Klartext-IBAN an den Browser,
 * Übernahme schließt die Zeile ab und verknüpft das PDF, kein Doppel-Import, Ablehnen, Rechte, Einrichtung.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const DATEN = path.join(__dirname, 'daten', 'beitritt');
const IBAN_FAMILIE = 'DE89370400440532013000';
const EIN = 'EINGANG-TEST';
const PDF = 'https://drive.google.com/file/d/pdf-familie/view';

const xml = datei => fs.readFileSync(path.join(DATEN, datei), 'utf8');

function eingangTab(g) {
  const kopf = g.Eingang.SPALTEN;
  const zeile = o => kopf.map(k => (o[k] === undefined ? '' : o[k]));
  return [kopf,
    zeile({ eingang_id: '1', eingang_am: '2026-10-24T18:03:00', dateiname: 'antrag-beispielhuber.xml', xml: xml('familie.xml'), pdf_link: PDF, status: 'neu' }),
    zeile({ eingang_id: '2', eingang_am: '2026-10-25T09:00:00', dateiname: 'antrag-einzel.xml', xml: xml('einzel.xml'), status: 'neu' }),
    zeile({ eingang_id: '3', eingang_am: '2026-10-25T10:00:00', dateiname: 'kaputt.xml', xml: '<dataroot><nix/></dataroot>', status: 'neu' }),
    zeile({ eingang_id: '4', eingang_am: '2026-10-25T21:30:00', unterschrift_am: '2026-10-25', dateiname: 'homepage.xml', xml: xml('homepage.xml'), pdf_link: PDF, status: 'neu' })];
}

function umgebung(rolle, optionen) {
  optionen = optionen || {};
  const v = erzeugeVerein({ seed: 5, mitglieder: 300 });
  const k = v.tabs.Benutzer[0];
  const z = v.tabs.Benutzer.slice(1).find(r => r[k.indexOf('rolle')] === (rolle || 'Mitgliederverwalter'));
  const vorab = ladeProjekt({});
  const f = erzeugeFakes({ tabs: v.tabs, email: z[k.indexOf('email')],
    properties: optionen.ohneEingang ? {} : { EINGANG_ID: optionen.eingangId || EIN },
    weitereDateien: { [EIN]: { Eingang: eingangTab(vorab) } } });
  const g = ladeProjekt(f.globale);
  const obj = tab => { const d = f.daten(tab); return d.slice(1).map(r => Object.fromEntries(d[0].map((h, i) => [h, r[i]]))); };
  return { f, g, obj, eingang: () => obj(EIN + '/Eingang') };
}
function ok(a) { a = rein(a); assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return a.daten; }
function fehler(a, art) { a = rein(a); assert.strictEqual(a.ok, false, 'Fehler erwartet'); if (art) assert.strictEqual(a.fehler.art, art, a.fehler.meldung); return a.fehler; }

test('Zerleger: wie der Browser (je <Daten16> Feld → Text), Entities, CDATA, DOCTYPE abgelehnt', () => {
  const { Eingang } = ladeProjekt({});
  const r = rein(Eingang.zerlege(xml('familie.xml')));
  assert.strictEqual(r.personen.length, 3);
  assert.strictEqual(r.personen[0].Nachname, 'Beispielhuber');
  assert.strictEqual(r.personen[0]['Abteilung 1'], 'Fussball', 'Access-Kodierung _x0020_ aufgelöst');
  assert.strictEqual(r.personen[0].IBAN, 'DE89 3704 0044 0532 0130 00');
  const s = rein(Eingang.zerlege('<?xml version="1.0"?><dataroot><Daten16><Nachname>M&#252;ller &amp; S&ouml;hne</Nachname>' +
    '<Vorname><![CDATA[Jo <B>]]></Vorname><Titel/><od:Ort xmlns:od="x"> Ergoldsbach </od:Ort></Daten16></dataroot>'));
  assert.deepStrictEqual(s.personen[0], { Nachname: 'Müller & S&ouml;hne', Vorname: 'Jo <B>', Titel: '', Ort: 'Ergoldsbach' });
  assert.match(Eingang.zerlege('<!DOCTYPE x [<!ENTITY a "b">]><dataroot/>').fehler, /DOCTYPE/);
  assert.match(Eingang.zerlege('<dataroot></dataroot>').fehler, /Daten16/);
  assert.match(Eingang.zerlege('').fehler, /Leer/);
});

test('Übersicht: offene Anträge nur mit Namen und PDF-Link, nicht lesbare markiert, keine Bankdaten', () => {
  const u = umgebung();
  const e = ok(u.g.apiBeitrittEingang());
  assert.strictEqual(e.eingerichtet, true);
  assert.strictEqual(e.offen.length, 4);
  assert.deepStrictEqual(e.offen[0].personen, ['Beispielhuber, Max', 'Beispielhuber, Anna', 'Beispielhuber, Lena']);
  assert.strictEqual(e.offen[0].pdf_link, PDF);
  assert.strictEqual(e.offen[0].eingang_am, '2026-10-24T18:03:00');
  assert.match(e.offen[2].fehler, /Daten16/);
  const text = JSON.stringify(e);
  assert.ok(!text.includes('0532') && !text.includes('<dataroot') && !text.includes('<IBAN>'), 'Bankdaten oder XML an den Browser');
  assert.deepStrictEqual(ok(u.g.apiBeitrittEingangAnzahl()), { anzahl: 4 });
});

test('Nicht eingerichtet, Datenbank als Eingang, Rechte', () => {
  assert.deepStrictEqual(ok(umgebung('Mitgliederverwalter', { ohneEingang: true }).g.apiBeitrittEingang()), { eingerichtet: false });
  assert.strictEqual(ok(umgebung('Mitgliederverwalter', { ohneEingang: true }).g.apiBeitrittEingangAnzahl()), null);
  fehler(umgebung('Mitgliederverwalter', { eingangId: 'DB-TEST' }).g.apiBeitrittEingang());
  for (const rolle of ['Kassier', 'Abteilungsleiter']) fehler(umgebung(rolle).g.apiBeitrittEingang(), 'zugriff');
});

test('Vorschau und Übernahme: Zeile abgeschlossen (XML geleert), PDF als Aufnahmeantrag je Person und SEPA-Mandat am Konto, kein Doppel-Import', () => {
  const u = umgebung();
  const v = ok(u.g.apiBeitrittEingangVorschau(['1', '3']));
  assert.strictEqual(v.antraege.length, 1);
  assert.strictEqual(v.antraege[0].eingang_id, '1');
  assert.strictEqual(v.nicht_lesbar[0].eingang_id, '3');
  assert.ok(!JSON.stringify(v).includes(IBAN_FAMILIE));

  const r = ok(u.g.apiBeitrittEingangImportieren(['1'], [{ eingang_id: '1' }]));
  assert.match(r.kopf, /^3 neue Person\(en\)/);
  const erg = r.ergebnisse[0];
  assert.strictEqual(erg.eingang_id, '1');
  assert.strictEqual(erg.dokumente, 4);
  const zeile = u.eingang().find(z => z.eingang_id === '1');
  assert.strictEqual(zeile.status, 'uebernommen');
  assert.strictEqual(zeile.xml, '', 'XML nach Übernahme geleert');
  assert.match(zeile.ergebnis, /^Nr\. \d+, \d+, \d+$/);
  const konto = u.obj('Beitragskonto').find(k => k.beitragskonto_id === erg.konto_id);
  assert.strictEqual(konto.iban, IBAN_FAMILIE);
  const doks = u.obj('Dokument').filter(d => d.link === PDF);
  assert.deepStrictEqual(doks.map(d => d.art).sort(), ['Aufnahmeantrag', 'Aufnahmeantrag', 'Aufnahmeantrag', 'SEPA-Mandat']);
  assert.ok(doks.filter(d => d.art === 'Aufnahmeantrag').every(d => erg.personen.some(p => p.mitglied_id === d.mitglied_id)));
  assert.strictEqual(doks.find(d => d.art === 'SEPA-Mandat').beitragskonto_id, erg.konto_id);
  assert.ok(u.obj('_Protokoll').some(p => p.tabelle === 'Eingang' && p.datensatz_id === '1' && p.neu_wert === 'uebernommen'));
  assert.ok(!JSON.stringify(u.obj('_Protokoll')).includes(IBAN_FAMILIE));
  // erneut: nichts mehr offen → kein Doppel-Import
  fehler(u.g.apiBeitrittEingangImportieren(['1'], [{ eingang_id: '1' }]), 'fachlich');
  assert.deepStrictEqual(ok(u.g.apiBeitrittEingangAnzahl()), { anzahl: 3 }, 'Zähler nach Übernahme neu');
});

test('Übernahme ohne PDF: Hinweis; Ablehnen mit Grund schließt die Zeile ab', () => {
  const u = umgebung();
  const r = ok(u.g.apiBeitrittEingangImportieren(['2'], [{ eingang_id: '2' }]));
  assert.ok(r.ergebnisse[0].ok, JSON.stringify(r.ergebnisse[0]));
  assert.ok(r.ergebnisse[0].warnungen.some(w => /Kein unterschriebenes PDF/.test(w)));
  fehler(u.g.apiBeitrittEingangAblehnen('3', '  '), 'fachlich');
  ok(u.g.apiBeitrittEingangAblehnen('3', 'doppelt abgeschickt'));
  const z = u.eingang().find(x => x.eingang_id === '3');
  assert.deepStrictEqual([z.status, z.ergebnis, z.xml], ['abgelehnt', 'doppelt abgeschickt', '']);
  assert.ok(!u.obj('_Protokoll').some(p => String(p.kommentar).includes('doppelt abgeschickt')), 'Freitext nicht ins Protokoll');
  fehler(u.g.apiBeitrittEingangAblehnen('3', 'nochmal'), 'fachlich');
  const e = ok(u.g.apiBeitrittEingang());
  assert.strictEqual(e.offen.length, 2);
  assert.deepStrictEqual(e.erledigt.map(x => x.status), ['abgelehnt', 'uebernommen']);
});

test('eingangEinrichten: legt Tab und Kopfzeile an bzw. ergänzt fehlende Spalten', () => {
  const v = erzeugeVerein({ seed: 5, mitglieder: 50 });
  const f = erzeugeFakes({ tabs: v.tabs, email: 'verwaltung@tsv-ergoldsbach.de', properties: { EINGANG_ID: EIN },
    weitereDateien: { [EIN]: { Tabelle1: [] } } });
  const g = ladeProjekt(f.globale);
  assert.match(g.eingangEinrichten(), /Spalten ergänzt/);
  assert.deepStrictEqual(f.daten(EIN + '/Eingang')[0], [...g.Eingang.SPALTEN]);
  assert.match(g.eingangEinrichten(), /keine Änderungen/);
});

test('Fehler beim Abschließen der Eingangszeile: Antrag bleibt übernommen, Hinweis statt „nicht importiert“', () => {
  const u = umgebung();
  const orig = u.g.Werte.zelleSchreiben;
  u.g.Werte.zelleSchreiben = function (w, s) { if (s && s.typ === 'Text' && w === 'uebernommen') throw new Error('Zeitüberschreitung'); return orig(w, s); };
  const r = ok(u.g.apiBeitrittEingangImportieren(['2'], [{ eingang_id: '2' }]));
  u.g.Werte.zelleSchreiben = orig;
  assert.strictEqual(r.ergebnisse[0].ok, true);
  assert.ok(r.ergebnisse[0].warnungen.some(w => /nicht abgeschlossen werden/.test(w)));
  assert.ok(u.obj('Mitglied').some(m => m.nachname === 'Musterfrau'));
});

test('XML im Format der Homepage: Beitragsstatus ohne Warnung, Telefon „0“ leer, Mandatsdatum = Unterschrift', () => {
  const u = umgebung();
  const v = ok(u.g.apiBeitrittEingangVorschau(['4']));
  const a = v.antraege[0];
  assert.strictEqual(a.personen.length, 3);
  assert.strictEqual(a.gemeinschaft.festbetrag, 140);
  assert.strictEqual(a.konto.mandatsdatum, '2026-10-25');
  const alle = a.warnungen.concat(...a.personen.map(p => p.warnungen)).join(' | ');
  assert.ok(!/Familien|Beitragsfrei|Mandatsdatum vorläufig/.test(alle), alle);
  const r = ok(u.g.apiBeitrittEingangImportieren(['4'], [{ eingang_id: '4' }]));
  const ids = r.ergebnisse[0].personen.map(p => p.mitglied_id);
  const neu = u.g.DB.lese(['Mitglied']).Mitglied.filter(m => ids.includes(m.mitglied_id));
  assert.strictEqual(neu.find(m => m.vorname === 'Hans').telefon, '08771 12345');
  assert.ok(neu.filter(m => m.vorname !== 'Hans').every(m => !m.telefon), 'Platzhalter-Telefon „0“');
  const konto = u.g.DB.lese(['Beitragskonto']).Beitragskonto.find(k => k.beitragskonto_id === r.ergebnisse[0].konto_id);
  assert.strictEqual(konto.mandatsdatum, '2026-10-25');
});

test('Beispiele aus WordPress (alte Struktur): 1 Person mit eigenem Konto, Familie mit 3 Personen', () => {
  const { g } = umgebung();
  const vorschau = datei => rein(g.apiBeitrittVorschau([Object.assign({ datei }, rein(g.Eingang.zerlege(xml(datei))), { unterschrift_am: '2026-09-25' })])).daten.antraege[0];
  const eins = vorschau('homepage-1person.xml');
  assert.deepStrictEqual(eins.personen.map(p => p.name), ['Mustermann, Max']);
  assert.strictEqual(eins.konto.zahlweg, 'Lastschrift');
  assert.strictEqual(eins.konto.mandatsdatum, '2026-09-25');
  assert.strictEqual(eins.gemeinschaft, null);
  assert.ok(!eins.personen[0].warnungen.some(w => /Status Abteilung/.test(w)), '„Erwachsene“ als Beitragsstatus');
  const drei = vorschau('homepage-3personen.xml');
  assert.deepStrictEqual(drei.personen.map(p => p.rolle), ['zahlt selbst', 'Zahler: Person 1', 'Zahler: Person 1']);
  assert.strictEqual(drei.gemeinschaft.festbetrag, 140, 'Pauschale heute aus dem von WordPress berechneten Gesamtbeitrag');
  assert.ok(drei.personen.every(p => p.in_gemeinschaft));
});
