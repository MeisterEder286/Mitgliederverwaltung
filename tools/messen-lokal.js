#!/usr/bin/env node
/**
 * Lokale Ist-Zählung: Wie viele Blattzugriffe kostet jede Aktion? (docs/LEISTUNG.md, Abschnitt 4)
 *
 * Zweck:      Führt typische Aktionen über apiMessen gegen die Doubles (test/hilfe/gas-fakes) mit synthetischen
 *             Daten aus (1.200 Mitglieder) und gibt je Aktion die Zählung des Messwerks aus: Lesungen (batchGet /
 *             SpreadsheetApp), Meta-Abfragen, Schreibungen, flushes, Tabellen, Zellen, Cache-Zugriffe und das
 *             Zugriffsmuster (Reihenfolge lesen/schreiben). Millisekunden sind hier BEDEUTUNGSLOS (Fakes) – die
 *             Zeiten kommen nur aus der Live-Messung.
 * Datenquelle: test/daten/generator.js (frei erfunden), nie echte Daten.
 * Wer darf was: nur Entwicklung (lokal).
 * Besonderheiten: „kalt“ = leerer Script-Cache (erster Aufruf nach 6 h / nach Wartung), „warm“ = Snapshot, Benutzer und
 *             Konfig im Cache. Aufruf: node tools/messen-lokal.js [--markdown] [--mitglieder 1200]
 */
'use strict';
const path = require('path');
const { ladeProjekt, rein } = require(path.join('..', 'test', 'hilfe', 'projekt'));
const { erzeugeFakes } = require(path.join('..', 'test', 'hilfe', 'gas-fakes'));
const { erzeugeVerein } = require(path.join('..', 'test', 'daten', 'generator'));

const arg = process.argv.slice(2);
const markdown = arg.includes('--markdown');
const anzahl = Number(arg[arg.indexOf('--mitglieder') + 1]) || 1200;

const verein = erzeugeVerein({ seed: 1, mitglieder: anzahl });
const EXPORTART = ladeProjekt(erzeugeFakes({ tabs: {} }).globale).Mitglieder.EXPORTARTEN[0];

function umgebung() {
  const k = verein.tabs.Benutzer[0];
  const z = verein.tabs.Benutzer.slice(1).find(r => r[k.indexOf('rolle')] === 'Mitgliederverwalter');
  const f = erzeugeFakes({ tabs: verein.tabs, email: z[k.indexOf('email')] });
  const g = ladeProjekt(f.globale);
  return { f, g };
}

function objekte(f, tab) {
  const d = f.daten(tab);
  return d.slice(1).map(z => Object.fromEntries(d[0].map((k, i) => [k, z[i]])));
}

/** Aktionen: [name, art, argumente(f)] – Argumente werden aus dem aktuellen Datenstand gebildet. */
const AKTIONEN = [
  ['apiPing', 'lesen', () => []],
  ['apiStart', 'lesen', () => []],
  ['apiSnapshot', 'lesen', () => [['finanzen']]],
  ['apiSnapshot', 'lesen', () => [['historie']]],
  ['apiFinanzenUebersicht', 'lesen', () => [2026]],
  ['apiAuswertungen', 'lesen', () => [{}]],
  ['apiNotizenOffen', 'lesen', () => []],
  ['apiDatenschutzProtokoll', 'lesen', () => [{}, 0]],
  ['apiMitgliederExport', 'protokolliert', () => [EXPORTART, 10]],
  ['apiMitgliedSpeichern', 'schreiben', f => { const m = objekte(f, 'Mitglied').find(x => x.anonymisiert !== 'ja'); return [m.mitglied_id, Number(m.version || 0), { ort: 'Neufahrn' }]; }],
  ['apiMitgliedAdresseUngueltig', 'schreiben', f => { const m = objekte(f, 'Mitglied')[3]; return [m.mitglied_id, Number(m.version || 0), true]; }],
  ['apiMitgliedAnlegen', 'schreiben', () => [{
    mitglied: { vorname: 'Erika', nachname: 'Messmaier', geburtsdatum: '2001-04-03', plz: '84061', ort: 'Ergoldsbach', strasse: 'Bahnhofstraße', hausnummer: '3', beitragsart_id: 1 },
    eintrittsdatum: '2026-10-01', abteilungen: [{ abteilung_id: 2, status: 'aktiv' }], trotzDublette: true
  }]],
  ['apiFunktionEintragen', 'schreiben', f => {
    const m = objekte(f, 'Mitglied').find(x => x.anonymisiert !== 'ja' && !x.austritt_wirksam);
    const fa = objekte(f, 'Funktionsart').find(x => x.ebene === 'Verein') || objekte(f, 'Funktionsart')[0];
    return [{ mitglied_id: m.mitglied_id, funktionsart_id: fa.funktionsart_id, von: '2026-10-01' }];
  }],
  ['apiNotizSpeichern', 'schreiben', f => { const m = objekte(f, 'Mitglied')[5]; return [{ mitglied_id: m.mitglied_id, art: 'Notiz', text: 'Messung', sichtbar_fuer: 'Verwaltung' }]; }],
  ['apiFinanzenKontoSpeichern', 'schreiben', f => { const k = objekte(f, 'Beitragskonto')[0]; return [k.beitragskonto_id, Number(k.version || 0), { bemerkung: 'Messung' }]; }]
];

function muster(spur) {
  // Kurzform der Zugriffsfolge: L = Lesen (SpreadsheetApp), V = Vorladen (batchGet), S = Schreiben, F = flush, Meta weggelassen
  return spur.map(s => ({ lesen: 'L', vorladen: 'V', schreiben: 'S', flush: 'F' })[s.art] || '').join('');
}

function messe(g, f, [name, art, args]) {
  const a = rein(g.apiMessen(name, args(f)));
  const b = a._mess || {};
  return {
    aktion: name + (name === 'apiSnapshot' ? '(' + args(f)[0][0] + ')' : ''), art, ok: a.ok ? 'ja' : (a.fehler && a.fehler.art),
    batchget: (b.spur || []).filter(s => s.art === 'vorladen').length,
    lesen_ssa: (b.spur || []).filter(s => s.art === 'lesen').length,
    meta: b.meta, schreib: b.schreibungen, flush: b.flushes,
    tabellen: (b.tabellen || []).length,
    tabellen_ssa: [...new Set((b.spur || []).filter(s => s.art === 'lesen' || s.art === 'meta' || s.art === 'schreiben').map(s => s.tab))].length,
    zellen_l: b.zellen_gelesen, zellen_s: b.zellen_geschrieben,
    cache: b.cache, sperre: b.abschnitte && b.abschnitte.sperre ? 'ja' : '–',
    muster: muster(b.spur || [])
  };
}

// Jede Aktion in einem FRISCH geladenen Projekt (wie eine neue Apps-Script-Ausführung: keine Modul-Memos).
// warm: dieselben Doubles (Tabellen + Script-Cache) wie ein vorangegangener apiStart; kalt: leerer Cache.
function lauf(warm) {
  const basis = umgebung();
  if (warm) { basis.g.apiStart(); ladeProjekt(basis.f.globale).apiSnapshot(['finanzen', 'historie']); }
  return AKTIONEN.map(a => {
    const f = warm ? basis.f : umgebung().f;
    return messe(ladeProjekt(f.globale), f, a);
  });
}

const SPALTEN = ['aktion', 'art', 'ok', 'batchget', 'lesen_ssa', 'meta', 'schreib', 'flush', 'tabellen', 'tabellen_ssa', 'zellen_l', 'zellen_s', 'cache', 'sperre', 'muster'];
function ausgeben(titel, zeilen) {
  if (!markdown) { console.log('\n' + titel); console.table(zeilen); return; }
  console.log('\n#### ' + titel + '\n');
  console.log('| ' + SPALTEN.join(' | ') + ' |');
  console.log('|' + SPALTEN.map(() => '---').join('|') + '|');
  zeilen.forEach(z => console.log('| ' + SPALTEN.map(s => z[s] === undefined || z[s] === null ? '' : String(z[s])).join(' | ') + ' |'));
}

ausgeben('warm (Cache gefüllt), ' + anzahl + ' Mitglieder', lauf(true));
ausgeben('kalt (Script-Cache leer), ' + anzahl + ' Mitglieder', lauf(false));
