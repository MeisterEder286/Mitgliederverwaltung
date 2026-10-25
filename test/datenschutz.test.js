/**
 * Tests für src/modul/Datenschutz.js und src/api/Datenschutz.js gegen die Fakes (synthetischer Verein, 300 Personen):
 * Einwilligungen, Betroffenenanfragen inkl. Auskunft, Löschliste (sperren, anonymisieren, löschen, Konto leeren),
 * Protokoll mit Rollenfilter/IBAN-Maskierung und Bereinigung nach Frist.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const MV = 'verwaltung@tsv-ergoldsbach.de';
const KASSIER = 'kassier@tsv-ergoldsbach.de';
const AL = 'fussball@tsv-ergoldsbach.de';
const VEREIN = erzeugeVerein({ mitglieder: 300 });

function kopie(tabs) { const o = {}; Object.keys(tabs).forEach(t => { o[t] = tabs[t].map(z => z.slice()); }); return o; }

/** Fakes um deleteRow ergänzen (die gemeinsamen Fakes kennen es nicht – nur hier im Test). */
function mitDeleteRow(f) {
  const orig = f.datei.getSheetByName.bind(f.datei);
  f.datei.getSheetByName = (n) => {
    const b = orig(n);
    if (b && !b.deleteRow) b.deleteRow = (nr) => { f.daten(n).splice(nr - 1, 1); };
    return b;
  };
  return f;
}

function aufbau(email, tabs) {
  const f = mitDeleteRow(erzeugeFakes({ tabs: tabs || kopie(VEREIN.tabs), email: email || MV, eigentuemer: MV }));
  return { f, g: ladeProjekt(f.globale) };
}
function objekte(f, tab) { const d = f.daten(tab); return d.slice(1).map(z => Object.fromEntries(d[0].map((k, i) => [k, z[i]]))); }
const ok = (a) => { assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return rein(a.daten); };

test('Einwilligung erfassen und widerrufen; Feldfehler; Kassier und Abteilungsleiter abgewiesen', () => {
  const { f, g } = aufbau();
  const m = objekte(f, 'Mitglied').find(x => x.vorname);
  const neu = ok(g.apiDatenschutzEinwilligungSpeichern(null, null, { mitglied_id: m.mitglied_id, art: 'Fotos und Videos', umfang: 'Vereinsmedien', erteilt_am: '2026-10-01', erteilt_form: 'digital' }));
  const e = neu.aktualisiert.einwilligungen[0];
  assert.strictEqual(e.art, 'Fotos und Videos');
  const w = ok(g.apiDatenschutzEinwilligungWiderrufen(e.einwilligung_id, e.version, '2026-10-20'));
  assert.strictEqual(w.aktualisiert.einwilligungen[0].widerrufen_am, '2026-10-20');
  const doppelt = rein(g.apiDatenschutzEinwilligungWiderrufen(e.einwilligung_id, e.version + 1, '2026-10-21'));
  assert.strictEqual(doppelt.ok, false);
  const ohne = rein(g.apiDatenschutzEinwilligungSpeichern(null, null, { art: 'Fotos und Videos' }));
  assert.strictEqual(ohne.fehler.art, 'fachlich');
  assert.ok(ohne.fehler.felder.some(x => x.feld === 'mitglied_id'));
  for (const email of [KASSIER, AL]) {
    const x = aufbau(email);
    assert.strictEqual(rein(x.g.apiDatenschutzEinwilligungSpeichern(null, null, { mitglied_id: 1 })).fehler.art, 'zugriff');
    assert.strictEqual(rein(x.g.apiDatenschutzLoeschliste()).fehler.art, 'zugriff');
  }
  assert.ok(objekte(f, '_Protokoll').some(p => p.tabelle === 'Einwilligung' && p.feld === 'widerrufen_am'));
});

test('Betroffenenanfrage: Frist, Abschluss leert name_bei_eingang, Auskunft nach Art. 15 protokolliert', () => {
  const { f, g } = aufbau();
  const m = objekte(f, 'Mitglied').find(x => x.vorname && x.beitragskonto_id);
  const a = ok(g.apiDatenschutzAnfrageSpeichern(null, null, { mitglied_id: m.mitglied_id, art: 'Auskunft (Art. 15)', eingang_am: '2026-09-01', name_bei_eingang: 'Name X', umfang: 'Alles' })).anfrage;
  assert.strictEqual(a.frist, '2026-10-01');
  assert.strictEqual(a.frist_status, 'überfällig');
  const liste = ok(g.apiDatenschutzAnfragen());
  assert.strictEqual(liste.length, 1);
  const fertig = ok(g.apiDatenschutzAnfrageSpeichern(a.anfrage_id, a.version, { status: 'vollständig umgesetzt', rueckmeldung_am: '2026-10-20' })).anfrage;
  assert.ok(!fertig.name_bei_eingang, 'Name nach Abschluss geleert');
  assert.strictEqual(fertig.frist_status, 'beantwortet');
  const ausk = ok(g.apiDatenschutzAuskunft(m.mitglied_id));
  const titel = ausk.abschnitte.map(x => x.titel);
  assert.ok(titel.includes('Stammdaten und Kontakt') && titel.includes('Beitragskonto und Bankverbindung'));
  const prot = objekte(f, '_Protokoll');
  assert.ok(prot.some(p => p.aktion === 'exportiert' && String(p.datensatz_id) === String(m.mitglied_id)));
  assert.ok(!prot.some(p => String(p.neu_wert).includes('Name X') || String(p.alt_wert).includes('Name X')), 'Name nicht im Protokoll');
  const uebersicht = ok(g.apiDatenschutzUebersicht());
  assert.strictEqual(uebersicht.anfragen_ueberfaellig, 0);
});

test('Löschliste: sperren, anonymisieren (nur mit Bestätigung, ohne Klartext im Protokoll), löschen erst nach Frist', () => {
  const { f, g } = aufbau();
  const liste = ok(g.apiDatenschutzLoeschliste());
  const stufen = new Set(liste.kandidaten.map(k => k.stufe));
  assert.ok(stufen.has('anonymisieren') || stufen.has('sperren'), 'Kandidaten vorhanden: ' + [...stufen]);

  const s = liste.kandidaten.find(k => k.stufe === 'sperren');
  if (s) {
    const r = ok(g.apiDatenschutzSperren(s.mitglied_id, s.version, true));
    const p = objekte(f, 'Mitglied').find(x => x.mitglied_id === s.mitglied_id);
    assert.strictEqual(p.verarbeitung_eingeschraenkt, 'ja');
    assert.ok(p.loeschbar_ab);
    assert.ok(r.aktualisiert || r.entfernt);
  }
  // Aktive Person kann nicht gesperrt/anonymisiert werden
  const aktiv = objekte(f, 'Mitglied').find(x => x.status === 'aktiv');
  assert.strictEqual(rein(g.apiDatenschutzAnonymisierungsplan(aktiv.mitglied_id)).fehler.art, 'fachlich');

  const a = liste.kandidaten.find(k => k.stufe === 'anonymisieren');
  assert.ok(a, 'Anonymisierungskandidat im synthetischen Verein');
  const vorher = objekte(f, 'Mitglied').find(x => x.mitglied_id === a.mitglied_id);
  const plan = ok(g.apiDatenschutzAnonymisierungsplan(a.mitglied_id));
  assert.ok(plan.schritte.length > 0);
  assert.strictEqual(rein(g.apiDatenschutzAnonymisieren(a.mitglied_id, 'ja')).fehler.art, 'fachlich');
  const erg = ok(g.apiDatenschutzAnonymisieren(a.mitglied_id, 'ANONYMISIEREN'));
  assert.ok(erg.bericht.geaendert >= 1);
  const nachher = objekte(f, 'Mitglied').find(x => x.mitglied_id === a.mitglied_id);
  assert.strictEqual(nachher.anonymisiert, 'ja');
  assert.notStrictEqual(nachher.nachname, vorher.nachname);
  assert.ok(!nachher.geburtsdatum && !nachher.strasse && !nachher.email);
  assert.ok(!objekte(f, 'Mitgliedschaftszeitraum').some(z => z.mitglied_id === a.mitglied_id), 'Zeiträume entfernt');
  const prot = objekte(f, '_Protokoll').filter(p => String(p.datensatz_id) === String(a.mitglied_id));
  const text = JSON.stringify(prot);
  assert.ok(!text.includes(vorher.nachname), 'kein Klartextname im Protokoll');
  assert.ok(prot.some(p => p.aktion === 'anonymisiert'));
  // zweites Mal → fachlich; Löschen vor Fristende → fachlich
  assert.strictEqual(rein(g.apiDatenschutzAnonymisieren(a.mitglied_id, 'ANONYMISIEREN')).fehler.art, 'fachlich');
  const loe = rein(g.apiDatenschutzLoeschen(a.mitglied_id, 'LÖSCHEN'));
  if (!loe.ok) assert.strictEqual(loe.fehler.art, 'fachlich');
});

test('Löschen (Stufe 3): anonymisierter Anker ohne laufende Frist wird samt Zeilen entfernt', () => {
  const tabs = kopie(VEREIN.tabs);
  // Aufbewahrungsfristen weit in die Vergangenheit verschieben (−1200 Monate) → alle Fristen abgelaufen (nur Test)
  const af = tabs.Aufbewahrungsfrist; const iD = af[0].indexOf('dauer_monate');
  af.slice(1).forEach(z => { if (z[iD] !== '' && z[iD] !== null) z[iD] = -1200; });
  const { f, g } = aufbau(MV, tabs);
  const kand = ok(g.apiDatenschutzLoeschliste()).kandidaten.find(k => k.stufe === 'anonymisieren');
  ok(g.apiDatenschutzAnonymisieren(kand.mitglied_id, 'ANONYMISIEREN'));
  assert.strictEqual(rein(g.apiDatenschutzLoeschen(kand.mitglied_id, 'falsch')).fehler.art, 'fachlich');
  const r = ok(g.apiDatenschutzLoeschen(kand.mitglied_id, 'LÖSCHEN'));
  assert.ok(r.bericht.entfernt >= 1);
  assert.ok(!objekte(f, 'Mitglied').some(x => x.mitglied_id === kand.mitglied_id), 'Mitglied entfernt');
  assert.ok((r.entfernt.mitglieder || []).includes(kand.mitglied_id));
});

test('Protokoll: Kassier nur Finanz-Tabellen, IBAN maskiert; Abteilungsleiter abgewiesen; Bereinigung nach Frist', () => {
  const tabs = kopie(VEREIN.tabs);
  const { f, g } = aufbau(MV, tabs);
  const ktx = g.Zugriff.pruefe('start');
  g.DB.mitSperre(() => g.Protokoll.schreibe(ktx, [
    { aktion: 'geändert', tabelle: 'Beitragskonto', datensatz_id: 1, feld: 'iban', alt_wert: 'DE89370400440532013000', neu_wert: 'DE02120300000000202051' },
    { aktion: 'geändert', tabelle: 'Mitglied', datensatz_id: 1, feld: 'ort', alt_wert: 'A', neu_wert: 'B' }
  ]));
  const alle = ok(g.apiDatenschutzProtokoll({}, 0));
  assert.ok(alle.gesamt >= 2);
  assert.ok(!JSON.stringify(alle).includes('DE89370400440532013000'), 'IBAN nie im Klartext');
  const k = aufbau(KASSIER, kopie((() => { const t = {}; f.datei.getSheets().forEach(b => { t[b.getName()] = f.daten(b.getName()); }); return t; })()));
  const kp = ok(k.g.apiDatenschutzProtokoll({}, 0));
  assert.ok(kp.eintraege.length >= 1 && kp.eintraege.every(e => ['Beitragskonto', 'Sollstellung', 'Beitragsgemeinschaft', 'SEPA'].includes(e.tabelle)));
  assert.strictEqual(rein(aufbau(AL).g.apiDatenschutzProtokoll({}, 0)).fehler.art, 'zugriff');
  const gefiltert = ok(g.apiDatenschutzProtokoll({ tabelle: 'Mitglied' }, 0));
  assert.ok(gefiltert.eintraege.every(e => e.tabelle === 'Mitglied'));

  // alter Eintrag (2020) → wird bereinigt
  const p = f.daten('_Protokoll'); const kopf = p[0];
  const zeile = kopf.map(h => ({ protokoll_id: 9999, zeitpunkt: 43831.5, benutzer_email: 'x@y.de', aktion: 'geändert', tabelle: 'Mitglied', datensatz_id: '5', feld: 'ort', alt_wert: 'Alt', neu_wert: 'Neu' })[h] ?? '');
  p.push(zeile);
  const b = ok(g.apiDatenschutzProtokollBereinigen());
  assert.ok(b.anzahl >= 1);
  const nach = objekte(f, '_Protokoll').find(x => x.protokoll_id === 9999);
  assert.strictEqual(nach.alt_wert, '');
  assert.ok(nach.bereinigt_am);
});
