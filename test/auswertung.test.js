/**
 * Tests für die Auswertungen (src/lib/auswertung.js, src/modul/Auswertung.js, src/api/Auswertung.js) und die
 * BLSV-Nachmeldung (src/lib/blsv.js, src/modul/Berichte.js). Kleine handgebaute Fälle für die Regeln, der
 * synthetische Verein (test/daten/generator.js) für Rechte und Plausibilität.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const g = ladeProjekt({});
const A = g.Auswertung;

/** Kleiner Verein: zwei Abteilungen, ein Wiedereintritt, ein Austritt, ein Funktionsträger. */
function kleinerVerein() {
  return {
    Abteilung: [
      { abteilung_id: 1, bezeichnung: 'Fußball', blsv_sportart: 'Fußball', meldepflichtig: true },
      { abteilung_id: 2, bezeichnung: 'Turnen', blsv_sportart: 'Turnen', meldepflichtig: true }
    ],
    Mitglied: [
      { mitglied_id: 1, nachname: 'Alt', vorname: 'Anton', geburtsdatum: '1960-03-01', geschlecht: 'm', plz: '84061', ort: 'Ergoldsbach', beitragsart_id: 1 },
      { mitglied_id: 2, nachname: 'Jung', vorname: 'Jana', geburtsdatum: '2008-05-05', geschlecht: 'w', plz: '84061', ort: 'Ergoldsbach', beitragsart_id: 2 },
      { mitglied_id: 3, nachname: 'Weg', vorname: 'Willi', geburtsdatum: '1990-01-01', geschlecht: 'm', plz: '84028', ort: 'Landshut', beitragsart_id: 1 },
      { mitglied_id: 4, nachname: 'Wieder', vorname: 'Wanda', geburtsdatum: '1980-07-07', geschlecht: 'w', plz: '84061', ort: 'Ergoldsbach', beitragsart_id: 1 },
      { mitglied_id: 5, nachname: 'Extern', vorname: 'Ernst', geburtsdatum: '1975-01-01', geschlecht: 'm', nur_funktionstraeger: true }
    ],
    Mitgliedschaftszeitraum: [
      { mitglied_id: 1, eintrittsdatum: '1990-01-01' },
      { mitglied_id: 2, eintrittsdatum: '2024-04-01' },
      { mitglied_id: 3, eintrittsdatum: '2010-01-01', austrittsdatum: '2025-12-31', austrittsgrund: 'Umzug' },
      { mitglied_id: 4, eintrittsdatum: '2000-01-01', austrittsdatum: '2010-12-31', austrittsgrund: 'Unzufriedenheit' },
      { mitglied_id: 4, eintrittsdatum: '2025-03-01' }
    ],
    Abteilungszugehoerigkeit: [
      { mitglied_id: 1, abteilung_id: 1, status: 'passiv', eintrittsdatum: '1990-01-01' },
      { mitglied_id: 1, abteilung_id: 2, status: 'aktiv', eintrittsdatum: '2026-02-01' },
      { mitglied_id: 2, abteilung_id: 2, status: 'aktiv', eintrittsdatum: '2024-04-01' },
      { mitglied_id: 4, abteilung_id: 1, status: 'aktiv', eintrittsdatum: '2025-03-01' }
    ],
    Funktionsart: [{ funktionsart_id: 10, bezeichnung: 'Schiedsrichter', fz_pflichtig: false }, { funktionsart_id: 8, bezeichnung: 'Trainer', fz_pflichtig: true }],
    Funktion: [
      { funktion_id: 1, mitglied_id: 1, funktionsart_id: 10, abteilung_id: 1, von: '2015-01-01' },
      { funktion_id: 2, mitglied_id: 5, funktionsart_id: 8, abteilung_id: 2, von: '2020-01-01' },
      { funktion_id: 3, mitglied_id: 3, funktionsart_id: 10, abteilung_id: 1, von: '2012-01-01', bis: '2020-01-01' }
    ],
    Beitragsart: [
      { beitragsart_id: 1, bezeichnung: 'Erwachsene', betrag: 100, alter_von: 18, alter_bis: null, aktiv: true },
      { beitragsart_id: 2, bezeichnung: 'Jugendliche', betrag: 45, alter_von: 0, alter_bis: 17, aktiv: true },
      { beitragsart_id: 3, bezeichnung: 'Senioren', betrag: 60, alter_von: 65, alter_bis: null, aktiv: true },
      { beitragsart_id: 4, bezeichnung: 'Fördermitglied', betrag: 50, aktiv: true }
    ],
    Beitragsgemeinschaft: [], Sollstellung: [{ jahr: 2026, soll_betrag: 100, status: 'bezahlt' }, { jahr: 2026, soll_betrag: 45, status: 'storniert' }]
  };
}
const HEUTE = '2026-10-25';

test('Altersgruppen: eigene Grenzen, je Abteilung, passiv, Funktionsträger und Ausgetretene zählen nicht', () => {
  const d = kleinerVerein();
  assert.deepStrictEqual(rein(A.gruppenAus([26, 14, 18, 18])).map(x => x.titel), ['bis 14', '15–18', '19–26', 'ab 27']);
  const a = rein(A.altersgruppen(d, HEUTE, { grenzen: [17, 64] }));
  assert.deepStrictEqual(a.gruppen.map(x => x.titel), ['bis 17', '18–64', 'ab 65']);
  assert.strictEqual(a.gesamt.gesamt, 3);          // Alt, Jung, Wieder – nicht Weg (ausgetreten), nicht Extern
  assert.deepStrictEqual(a.gesamt.werte, [0, 2, 1]); // Jung wird 2026 18 (Jahrgang) → 18–64; Alt 66
  const je = rein(A.altersgruppen(d, HEUTE, { nach: 'abteilung' }));
  const fb = je.zeilen.find(z => z.titel === 'Fußball');
  assert.strictEqual(fb.gesamt, 2);
  assert.strictEqual(fb.davon_passiv, 1);
  const exakt = rein(A.altersgruppen(d, '2026-05-04', { grenzen: [17], modus: 'exakt' }));
  assert.deepStrictEqual(exakt.gesamt.werte, [1, 2]);  // Jung (geb. 05.05.2008) ist am 04.05.2026 exakt noch 17
});

test('Entwicklung: Eintritte inkl. Wiedereintritt, Austritte im Jahr des Austritts, Bestand zum Jahreswechsel', () => {
  const e = rein(A.entwicklung(kleinerVerein(), 2024, 2026, HEUTE));
  const j = Object.fromEntries(e.map(x => [x.jahr, x]));
  assert.strictEqual(j[2024].eintritte, 1);
  assert.strictEqual(j[2025].eintritte, 1);
  assert.strictEqual(j[2025].davon_wiedereintritte, 1);
  assert.strictEqual(j[2025].austritte, 1);      // Weg zum 31.12.2025
  assert.strictEqual(j[2025].bestand, 3);        // zum 01.01.2026: Alt, Jung, Wieder
  assert.strictEqual(j[2026].bestand_am, HEUTE);
  const gr = rein(A.austrittsgruende(kleinerVerein(), 2000, 2026));
  assert.deepStrictEqual(gr.map(x => x.grund).sort(), ['Umzug', 'Unzufriedenheit']);
});

test('Gesamt, Kreuztabelle, Dauer, Wohnorte, Funktionen, Schiedsrichter', () => {
  const d = kleinerVerein();
  const s = rein(A.gesamt(d, HEUTE));
  assert.deepStrictEqual(s.status, { aktiv: 3, davon_gekuendigt: 0, ausgetreten: 1, verstorben: 0, nur_funktionstraeger: 1 });
  assert.strictEqual(s.anzahl_abteilungen['2'], 1);
  const k = rein(A.kreuztabelle(d, HEUTE));
  const fb = k.abteilungen.findIndex(a => a.bezeichnung === 'Fußball'), tu = k.abteilungen.findIndex(a => a.bezeichnung === 'Turnen');
  assert.strictEqual(k.matrix[fb][tu], 1);
  assert.strictEqual(k.matrix[tu][tu], 2);
  const dauer = rein(A.mitgliedsdauer(d, HEUTE, 'letzter_eintritt'));
  assert.strictEqual(dauer.klassen.reduce((n, x) => n + x.anzahl, 0), 3);
  assert.strictEqual(rein(A.wohnorte(d, HEUTE, 1)).orte[0].ort, '84061 Ergoldsbach');
  const f = rein(A.funktionstraeger(d, HEUTE));
  assert.strictEqual(f.eintraege.length, 2);   // beendete Funktion von Weg zählt nicht
  assert.deepStrictEqual(rein(A.schiedsrichter(d, HEUTE)).map(x => x.name), ['Alt, Anton']);
});

test('Altersübergänge: werden 18/19/65 mit künftiger Beitragsart; Fördermitglied ohne Wechsel', () => {
  const d = kleinerVerein();
  d.Mitglied.push({ mitglied_id: 6, nachname: 'Rentner', vorname: 'Rudi', geburtsdatum: '1962-02-02', beitragsart_id: 1 });
  d.Mitglied.push({ mitglied_id: 7, nachname: 'Foerder', vorname: 'Frieda', geburtsdatum: '1962-09-09', beitragsart_id: 4 });
  d.Mitgliedschaftszeitraum.push({ mitglied_id: 6, eintrittsdatum: '2000-01-01' }, { mitglied_id: 7, eintrittsdatum: '2000-01-01' });
  d.Mitglied[1].geburtsdatum = '2009-05-05';   // Jung wird 2027 18
  const u = rein(A.uebergaenge(d, 2027, [18, 65], HEUTE));
  const jung = u.find(x => x.mitglied_id === 2), rudi = u.find(x => x.mitglied_id === 6), frieda = u.find(x => x.mitglied_id === 7);
  assert.strictEqual(jung.wird, 18);
  assert.strictEqual(jung.kuenftig, 'Erwachsene');
  assert.strictEqual(jung.wechsel, true);
  assert.strictEqual(rudi.kuenftig, 'Senioren');
  assert.strictEqual(frieda.wechsel, false);
  assert.match(frieda.hinweis, /ohne Altersgrenze/);
});

test('Beitragsstruktur und Formular-Hilfen (Anrede → Geschlecht korrigiert, PLZ → Ort)', () => {
  const b = rein(A.beitragsstruktur(kleinerVerein(), HEUTE, 2026));
  assert.strictEqual(b.soll_jahr, 100);
  assert.strictEqual(b.beitragsarten.find(x => x.bezeichnung === 'Erwachsene').anzahl, 2);
  assert.strictEqual(A.geschlechtAusAnrede('Herr'), 'm');
  assert.strictEqual(A.geschlechtAusAnrede('Frau'), 'w');
  assert.strictEqual(A.geschlechtAusAnrede('Divers'), 'd');
  assert.strictEqual(A.geschlechtAusAnrede(''), null);       // Access setzte hier „w“
  assert.strictEqual(A.geschlechtAusAnrede('Firma'), null);
  assert.deepStrictEqual(rein(A.plzOrte([{ plz: '84061', ort: 'Ergoldsbach' }, { plz: '84061', ort: 'Ergoldsbach' }, { plz: '84061', ort: 'Martinshaun' }])), { 84061: 'Ergoldsbach' });
});

test('BLSV-Nachmeldung: Neumitglieder und neue Sportart seit Stichtag', () => {
  const d = kleinerVerein();
  const n = rein(g.Blsv.nachmeldung(d, '2026-01-01', HEUTE));
  // Alt: seit 01.02.2026 zusätzlich Turnen → neue Sportart; sonst niemand neu (Wieder trat 2025 ein)
  assert.strictEqual(n.verein.gesamt, 0);
  assert.deepStrictEqual(n.sportarten.map(s => [s.sportart, s.neumitglieder, s.neue_sportart]), [['Turnen', 0, 1]]);
  const n2 = rein(g.Blsv.nachmeldung(d, '2025-01-01', HEUTE));
  assert.strictEqual(n2.verein.gesamt, 1);  // Wieder (Wiedereintritt 2025)
  assert.ok(n2.eintraege.some(e => e.mitglied_id === 4 && e.art === 'Neumitglied' && e.sportart === 'Fußball'));
  const csv = g.Blsv.nachmeldungCsv(n2);
  assert.match(csv.split('\r\n')[0], /^Sportart;Neumitglieder;neue Sportart/);
});

// ------------------------------------------------------------------ Rechte und Sichtkreis (Servermodul)

const verein = erzeugeVerein({ seed: 5, mitglieder: 250 });
function als(rolle) {
  const k = verein.tabs.Benutzer[0];
  const z = verein.tabs.Benutzer.slice(1).find(r => r[k.indexOf('rolle')] === rolle);
  const f = erzeugeFakes({ tabs: verein.tabs, email: z[k.indexOf('email')] });
  return { f, g: ladeProjekt(f.globale) };
}

test('apiAuswertungen: Mitgliederverwaltung bekommt alles inkl. Entwicklung und Beitragsstruktur', () => {
  const { g: s } = als('Mitgliederverwalter');
  const a = rein(s.apiAuswertungen({ grenzen: [14, 18, 26], nach: 'abteilung' }));
  assert.strictEqual(a.ok, true, JSON.stringify(a.fehler));
  assert.strictEqual(a.daten.verein, true);
  assert.ok(a.daten.entwicklung.length === 10 && a.daten.beitragsstruktur && a.daten.uebergaenge);
  assert.ok(a.daten.gesamt.status.aktiv > 100);
  assert.strictEqual(a.messung.sheets <= 1, true);
});

test('apiAuswertungen: Abteilungsleiter nur Sichtkreis, keine vereinsweiten/finanziellen Teile', () => {
  const mv = rein(als('Mitgliederverwalter').g.apiAuswertungen({})).daten;
  const { g: s } = als('Abteilungsleiter');
  const a = rein(s.apiAuswertungen({}));
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.daten.verein, false);
  assert.strictEqual(a.daten.entwicklung, null);
  assert.strictEqual(a.daten.beitragsstruktur, null);
  assert.ok(a.daten.gesamt.status.aktiv < mv.gesamt.status.aktiv, 'nur eigener Sichtkreis');
  assert.strictEqual(a.daten.gesamt.status.ausgetreten, 0);
  const e = rein(s.apiAuswertungEntwicklung(2016, 2026));
  assert.strictEqual(e.ok, false);
  assert.strictEqual(e.fehler.art, 'fachlich');
  const n = rein(s.apiBerichteBlsvNachmeldung('2026-01-01'));
  assert.strictEqual(n.ok, false);
});

test('apiAuswertungen: ungültige Eingaben → Feldfehler; Export-Vermerk bereinigt', () => {
  const { f, g: s } = als('Kassier');
  assert.strictEqual(rein(s.apiAuswertungen({ stichtag: 'gestern' })).fehler.art, 'fachlich');
  assert.strictEqual(rein(s.apiAuswertungen({ grenzen: ['x'] })).fehler.felder[0].feld, 'grenzen');
  assert.strictEqual(rein(s.apiAuswertungExportVermerken('=Liste<b>', 12)).ok, true);
  const p = f.daten('_Protokoll');
  const z = p[p.length - 1];
  assert.strictEqual(z[p[0].indexOf('aktion')], 'exportiert');
  assert.strictEqual(z[p[0].indexOf('kommentar')], 'Listeb: 12 Zeilen');
  const ent = rein(s.apiAuswertungEntwicklung(2020, 2026));
  assert.strictEqual(ent.ok, true);
  assert.strictEqual(ent.daten.entwicklung.length, 7);
  const nm = rein(s.apiBerichteBlsvNachmeldung('2026-01-01', '2026-10-25'));
  assert.strictEqual(nm.ok, true, JSON.stringify(nm.fehler));
  assert.ok(Array.isArray(nm.daten.eintraege));
});
