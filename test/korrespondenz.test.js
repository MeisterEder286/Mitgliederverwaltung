/**
 * Tests für src/modul/Korrespondenz.js über die öffentlichen api…-Funktionen (gas-fakes + synthetischer Verein).
 * Prüft: Dokument-Links (nur Drive), Schreiben erstellen (Zeilen, Protokoll ohne Inhalt), Rechte (AL/JL abgewiesen,
 * Kassier darf Mahnung), Snapshot-Bereich „korrespondenz“ ohne Briefinhalt, Fristbereinigung.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein, entpacke } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

/** Synthetischer Verein + Standardvorlagen aus der Startbelegung (der Generator legt keine Vorlagen an). */
function verein() {
  const v = erzeugeVerein({ seed: 5, mitglieder: 200 });
  const g = ladeProjekt({});
  const sb = g.Startbelegung.Vorlage;
  const kopf = v.tabs.Vorlage[0];
  sb.zeilen.forEach(z => v.tabs.Vorlage.push(kopf.map(k => { const i = sb.kopf.indexOf(k); return i < 0 ? (k === 'version' ? 1 : '') : z[i]; })));
  const k = v.tabs._Konfig, iS = k[0].indexOf('schluessel'), iW = k[0].indexOf('wert');
  const zeile = k.find(r => r[iS] === 'next_id_Vorlage');
  if (zeile) zeile[iW] = String(sb.zeilen.length + 1); else k.push(k[0].map((h, j) => j === iS ? 'next_id_Vorlage' : j === iW ? String(sb.zeilen.length + 1) : ''));
  return v;
}
const V = verein();

function als(rolle, tabs) {
  const b = V.tabs.Benutzer, kb = b[0];
  const z = b.slice(1).find(r => r[kb.indexOf('rolle')] === rolle);
  const f = erzeugeFakes({ tabs: tabs || V.tabs, email: z[kb.indexOf('email')] });
  const g = ladeProjekt(f.globale);
  const obj = tab => { const d = f.daten(tab); return d.slice(1).map(r => Object.fromEntries(d[0].map((h, i) => [h, r[i]]))); };
  return { f, g, obj };
}
const ok = a => { a = rein(a); assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return a.daten; };
const fehler = (a, art) => { a = rein(a); assert.strictEqual(a.ok, false, 'Fehler erwartet'); if (art) assert.strictEqual(a.fehler.art, art, a.fehler.meldung); return a.fehler; };
function vorlageId(u, anlass) { return ok(u.g.apiKorrespondenzVorlagen()).vorlagen.find(v => v.anlass === anlass).vorlage_id; }

test('Dokument-Link: nur Google Drive, mit Bezug, Entfernen mit Version; Abteilungsleiter abgewiesen', () => {
  const u = als('Mitgliederverwalter');
  const m = u.obj('Mitglied').find(x => x.status === 'aktiv');
  const f = fehler(u.g.apiKorrespondenzDokumentSpeichern({ mitglied_id: m.mitglied_id, art: 'Aufnahmeantrag', titel: 'Antrag', link: 'https://example.de/x.pdf' }), 'fachlich');
  assert.ok(f.felder.some(x => x.feld === 'link'));
  const d = ok(u.g.apiKorrespondenzDokumentSpeichern({ mitglied_id: m.mitglied_id, art: 'SEPA-Mandat', titel: 'Mandat 2018', link: 'https://drive.google.com/file/d/abc/view' }));
  const dok = d.aktualisiert.dokumente[0];
  assert.strictEqual(dok.link, 'https://drive.google.com/file/d/abc/view');
  fehler(u.g.apiKorrespondenzDokumentEntfernen(dok.dokument_id, 99), 'konflikt');
  ok(u.g.apiKorrespondenzDokumentEntfernen(dok.dokument_id, dok.version));
  assert.strictEqual(u.obj('Dokument').length, 0);
  assert.ok(u.obj('_Protokoll').some(p => p.tabelle === 'Dokument' && p.aktion === 'angelegt'));
  fehler(als('Abteilungsleiter').g.apiKorrespondenzDokumentSpeichern({ mitglied_id: m.mitglied_id, art: 'Sonstiges', titel: 'x', link: 'https://drive.google.com/x' }), 'zugriff');
});

test('Schreiben erstellen: Vorschau, Serie mit einer Zeile je Empfänger, Protokoll ohne Inhalt, Nachdruck protokolliert', () => {
  const u = als('Mitgliederverwalter');
  const ids = u.obj('Mitglied').filter(x => x.status === 'ausgetreten').slice(0, 3).map(x => x.mitglied_id);
  const vid = vorlageId(u, 'Austrittsbestätigung');
  const v = ok(u.g.apiKorrespondenzVorschau(vid, { mitglied_ids: ids }, {}));
  assert.strictEqual(v.briefe.length, 3);
  assert.deepStrictEqual(v.unbekannt, []);
  assert.match(v.briefe[0].text, /Mitgliedschaft im TSV Ergoldsbach e\. V\. endet zum \d\d\.\d\d\.\d{4}/);
  const e = ok(u.g.apiKorrespondenzErstellen(vid, { mitglied_ids: ids }, {}));
  assert.ok(e.serie);
  const zeilen = u.obj('Anschreiben');
  assert.strictEqual(zeilen.length, 3);
  assert.ok(zeilen.every(z => z.serie === e.serie && z.anlass === 'Austrittsbestätigung' && String(z.inhalt).includes('Kündigung')));
  const prot = u.obj('_Protokoll').filter(p => p.tabelle === 'Anschreiben');
  assert.strictEqual(prot.length, 1);
  assert.ok(!JSON.stringify(prot).includes('Kündigung'), 'Briefinhalt im Protokoll');
  // Snapshot-Antwort ohne inhalt
  assert.ok(e.aktualisiert.anschreiben.every(a => a.inhalt === undefined));
  const a = ok(u.g.apiKorrespondenzAnschreiben(e.briefe[0].anschreiben_id));
  assert.match(a.inhalt, /Kündigung/);
  assert.ok(u.obj('_Protokoll').some(p => p.tabelle === 'Anschreiben' && p.aktion === 'eingesehen'));
  // PDF-Link nachtragen: nur Drive
  fehler(u.g.apiKorrespondenzAnschreibenLink(a.anschreiben_id, a.version, 'https://x.de/a.pdf'), 'fachlich');
  ok(u.g.apiKorrespondenzAnschreibenLink(a.anschreiben_id, a.version, 'https://drive.google.com/file/d/p/view'));
});

test('Rechte: Kassier darf Mahnung an Konten, Abteilungs- und Jugendleiter dürfen keine Schreiben', () => {
  const k = als('Kassier');
  const soll = k.obj('Sollstellung').filter(s => ['ruecklastschrift', 'gemahnt', 'offen'].includes(s.status)).slice(0, 2);
  assert.ok(soll.length);
  const vid = vorlageId(k, 'Mahnung');
  const e = ok(k.g.apiKorrespondenzErstellen(vid, { sollstellung_ids: soll.map(s => s.sollstellung_id) }, { faellig_am: '2026-11-30' }));
  assert.strictEqual(e.briefe.length, soll.length);
  assert.match(e.briefe[0].text, /Offener Betrag: \d/);
  assert.match(e.briefe[0].text, /30\.11\.2026/);
  for (const rolle of ['Abteilungsleiter', 'Jugendleiter']) {
    fehler(als(rolle).g.apiKorrespondenzErstellen(vid, { sollstellung_ids: [soll[0].sollstellung_id] }, {}), 'zugriff');
    fehler(als(rolle).g.apiKorrespondenzVorlagen(), 'zugriff');
  }
  // Vorlagen pflegen darf der Kassier nicht
  fehler(k.g.apiKorrespondenzVorlageSpeichern({ bezeichnung: 'x', anlass: 'Allgemein', betreff: 'x', text: 'x' }), 'zugriff');
});

test('Vorlage speichern: unbekannte Platzhalter werden abgelehnt', () => {
  const u = als('Mitgliederverwalter');
  const f = fehler(u.g.apiKorrespondenzVorlageSpeichern({ bezeichnung: 'Test', anlass: 'Allgemein', betreff: 'Hallo', text: '{{briefanrede}} {{iban}}' }), 'fachlich');
  assert.ok(f.felder.some(x => x.feld === 'text' && /iban/.test(x.meldung)));
  const d = ok(u.g.apiKorrespondenzVorlageSpeichern({ bezeichnung: 'Test', anlass: 'Allgemein', betreff: 'Hallo {{vorname}}', text: '{{briefanrede}},\n\nText.' }));
  assert.ok(d.vorlage.vorlage_id > 10);
});

test('Snapshot-Bereich korrespondenz: ohne Briefinhalt; Abteilungsleiter bekommt nichts', () => {
  const u = als('Mitgliederverwalter');
  const ids = u.obj('Mitglied').filter(x => x.status === 'aktiv').slice(0, 2).map(x => x.mitglied_id);
  ok(u.g.apiKorrespondenzErstellen(vorlageId(u, 'Geburtstag'), { mitglied_ids: ids }, {}));
  const tabs = {};
  u.f.datei.getSheets().forEach(b => { tabs[b.getName()] = u.f.daten(b.getName()).map(z => z.slice()); });
  const mv = entpacke(ok(als('Mitgliederverwalter', tabs).g.apiSnapshot(['korrespondenz'])));
  assert.strictEqual(mv.anschreiben.length, 2);
  assert.ok(mv.anschreiben.every(a => a.inhalt === undefined && a.betreff));
  const kern = entpacke(ok(als('Mitgliederverwalter', tabs).g.apiSnapshot(['kern'])));
  assert.ok(kern.vorlagen.length >= 10 && kern.vorlagen.every(v => v.text === undefined));
  const al = ok(als('Abteilungsleiter', tabs).g.apiSnapshot(['korrespondenz']));
  assert.ok(!al.listen.anschreiben && !al.listen.dokumente);
});

test('Serienbrief-Export (Word) und Fristbereinigung alter Schreiben', () => {
  const u = als('Mitgliederverwalter');
  const ids = u.obj('Mitglied').filter(x => x.status === 'aktiv').slice(0, 4).map(x => x.mitglied_id);
  const ex = ok(u.g.apiKorrespondenzSerienExport({ mitglied_ids: ids }, {}));
  assert.strictEqual(ex.zeilen.length, 4);
  assert.ok(ex.zeilen[0].briefanrede && ex.zeilen[0].anschrift1);
  assert.ok(u.obj('_Protokoll').some(p => p.aktion === 'exportiert' && /Serienbrief/.test(p.kommentar)));
  ok(u.g.apiKorrespondenzErstellen(vorlageId(u, 'Geburtstag'), { mitglied_ids: ids.slice(0, 1) }, {}));
  assert.strictEqual(u.g.Korrespondenz.fristBereinigung('2030-01-01'), 0);   // 6 Jahre ab Ende 2026 noch nicht um
  assert.strictEqual(u.g.Korrespondenz.fristBereinigung('2033-01-02'), 1);
  const a = u.obj('Anschreiben')[0];
  assert.ok(!a.inhalt && a.betreff, 'Inhalt geleert, Betreff bleibt');
});
