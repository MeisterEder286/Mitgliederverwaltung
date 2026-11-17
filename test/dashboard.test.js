/**
 * Tests für das Dashboard (src/lib/dashboard.js, src/modul/Dashboard.js, src/api/Dashboard.js):
 * Monatsverlauf mit Eintritten/Austritten/Vorjahr, Einnahmen nach Buchungsdatum, Ehrungs-Vorschau und Rechte.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const g = ladeProjekt({});
const D = g.Dashboard;

function verein() {
  return {
    Mitglied: [
      { mitglied_id: 1, nachname: 'A', vorname: 'a', geburtsdatum: '1960-03-01' },
      { mitglied_id: 2, nachname: 'B', vorname: 'b', geburtsdatum: '2008-05-05' },
      { mitglied_id: 3, nachname: 'C', vorname: 'c', geburtsdatum: '1990-01-01' },
      { mitglied_id: 4, nachname: 'D', vorname: 'd', geburtsdatum: '1980-07-07' },
      { mitglied_id: 5, nachname: 'E', vorname: 'e', geburtsdatum: '1975-01-01', nur_funktionstraeger: true }
    ],
    Mitgliedschaftszeitraum: [
      { mitglied_id: 1, eintrittsdatum: '1990-01-01' },
      { mitglied_id: 2, eintrittsdatum: '2026-04-10' },
      { mitglied_id: 3, eintrittsdatum: '2010-01-01', austrittsdatum: '2026-06-30', austrittsgrund: 'Umzug' },
      { mitglied_id: 4, eintrittsdatum: '2025-03-01' }
    ],
    Sollstellung: [
      { jahr: 2026, soll_betrag: 100, ist_betrag: 100, status: 'bezahlt', buchungsdatum: '2026-03-15' },
      { jahr: 2026, soll_betrag: 50, ist_betrag: 20, status: 'offen', buchungsdatum: '2026-03-20' },
      { jahr: 2026, soll_betrag: 45, ist_betrag: 0, status: 'storniert' },
      { jahr: 2026, soll_betrag: 60, ist_betrag: 60, status: 'bezahlt' },
      { jahr: 2025, soll_betrag: 100, ist_betrag: 100, status: 'bezahlt', buchungsdatum: '2025-03-01' }
    ],
    Ehrungsregel: [
      { ehrungsregel_id: 1, typ: 'Mitgliedsjubiläum', schwelle: 40, bezeichnung: '40 Jahre', aktiv: true },
      { ehrungsregel_id: 2, typ: 'Geburtstag', schwelle: 70, bezeichnung: '70. Geburtstag', aktiv: true }
    ],
    Ehrung: [], Funktion: [], Funktionsart: [], Abteilung: []
  };
}

test('Verlauf: Monatsbestand, Eintritte/Austritte je Monat, Vorjahr, Zukunft bleibt leer', () => {
  const v = rein(D.verlauf(verein(), 2026, '2026-10-25'));
  assert.strictEqual(v.anfang, 3);                     // 1, 3, 4 – nicht 2 (noch nicht da), nicht 5 (Funktionsträger)
  assert.strictEqual(v.monate[2].bestand, 3);          // Ende März
  assert.strictEqual(v.monate[3].bestand, 4);          // Eintritt am 10.04.
  assert.strictEqual(v.monate[3].eintritte, 1);
  assert.strictEqual(v.monate[5].austritte, 1);        // Austritt 30.06.
  assert.strictEqual(v.monate[5].bestand, 3);          // Ende Juni: 1, 2, 4 – C (Austritt 30.06.) zählt am 01.07. nicht mehr
  assert.strictEqual(v.monate[6].bestand, 3);
  assert.strictEqual(v.monate[9].bestand, 3);          // Oktober bis heute
  assert.strictEqual(v.monate[10].bestand, null);      // November/Dezember liegen in der Zukunft
  assert.strictEqual(v.monate[11].vorjahr, null);
  assert.strictEqual(v.monate[1].vorjahr, 2);          // Ende Februar 2025: 1, 3 (D tritt erst 03/2025 ein)
  assert.strictEqual(v.aktuell, 3);
  assert.strictEqual(v.eintritte, 1);
  assert.strictEqual(v.austritte, 1);
  assert.strictEqual(v.saldo, 0);
});

test('Verlauf: vergangenes Jahr komplett, Summe der Monate = Saldo', () => {
  const v = rein(D.verlauf(verein(), 2025, null));
  assert.ok(v.monate.every(m => m.bestand !== null));
  assert.strictEqual(v.eintritte, 1);                  // D im März 2025
  assert.strictEqual(v.aktuell, v.anfang + v.saldo);
});

test('Einnahmen: Monatssummen nach Buchungsdatum, ohne Datum gesondert, Storno zählt nicht, Jahresquote', () => {
  const e = rein(D.einnahmen(verein(), 2026, 6));
  assert.strictEqual(e.monate[2].betrag, 120);
  assert.strictEqual(e.summe, 120);
  assert.strictEqual(e.ohne_datum, 60);
  assert.deepStrictEqual(e.jahre.map(j => j.jahr), [2025, 2026]);
  const j = e.jahre[1];
  assert.strictEqual(j.soll, 210);                     // 100 + 50 + 60, storniert nicht
  assert.strictEqual(j.ist, 180);
  assert.strictEqual(j.offen, 30);
  assert.strictEqual(j.quote, 85.7);
});

test('Ehrungs-Vorschau: Jahre, Aufschlüsselung, Summe stimmt mit der Jahresliste überein', () => {
  const d = verein();
  d.Mitgliedschaftszeitraum[0].eintrittsdatum = '1988-06-01';   // Mitglied 1: 40 Jahre im Jahr 2028
  d.Mitglied[0].geburtsdatum = '1957-03-01';                     // 70. Geburtstag 2027
  const v = rein(D.ehrungsvorschau(d, {}, 2026, 2029));
  assert.deepStrictEqual(v.map(x => x.jahr), [2026, 2027, 2028, 2029]);
  assert.strictEqual(v[1].anstehend, 1);
  assert.strictEqual(v[1].zeilen[0].typ, 'Geburtstag');
  assert.strictEqual(v[2].anstehend, 1);
  assert.strictEqual(v[2].zeilen[0].bezeichnung, '40 Jahre');
  v.forEach(x => {
    const liste = rein(g.Ehrung.jahresliste(d, x.jahr, {})).filter(e => e.faellig_jahr === x.jahr);
    assert.strictEqual(x.anstehend, liste.length);
  });
  // Verliehene zählen nicht als anstehend, werden aber getrennt gezeigt
  d.Ehrung.push({ ehrung_id: 1, mitglied_id: 1, ehrungsregel_id: 2, faellig_jahr: 2027, status: 'verliehen' });
  const v2 = rein(D.ehrungsvorschau(d, {}, 2026, 2027));
  assert.strictEqual(v2[1].anstehend, 0);
  assert.strictEqual(v2[1].verliehen, 1);
});

function als(rolle) {
  const verein = erzeugeVerein({ seed: 1, mitglieder: 120 });
  const k = verein.tabs.Benutzer[0];
  const z = verein.tabs.Benutzer.slice(1).find(r => r[k.indexOf('rolle')] === rolle);
  const f = erzeugeFakes({ tabs: verein.tabs, email: z[k.indexOf('email')] });
  return ladeProjekt(f.globale);
}

test('apiDashboard: Mitgliederverwaltung sieht alle Abschnitte; Kassier ohne Ehrungen; Rest abgewiesen', () => {
  const mv = rein(als('Mitgliederverwalter').apiDashboard());
  assert.strictEqual(mv.ok, true);
  assert.strictEqual(mv.daten.verlauf.monate.length, 12);
  assert.ok(mv.daten.einnahmen && mv.daten.ehrungen);
  assert.strictEqual(mv.daten.ehrungen.length, 6);
  assert.ok(mv.daten.altersgruppen.gesamt > 0);
  const kassier = rein(als('Kassier').apiDashboard(2025));
  assert.strictEqual(kassier.ok, true);
  assert.ok(kassier.daten.einnahmen);
  assert.strictEqual(kassier.daten.ehrungen, null);
  ['Abteilungsleiter', 'Jugendleiter'].forEach(r => {
    const a = rein(als(r).apiDashboard());
    assert.strictEqual(a.ok, false, r);
    assert.strictEqual(a.fehler.art, 'zugriff', r);
  });
});

test('apiDashboard: ungültiges Jahr → Feldfehler; zukünftiges Jahr wird auf das laufende begrenzt; nur Zahlen in der Antwort', () => {
  const s = als('Vorstand');
  assert.strictEqual(rein(s.apiDashboard('abc')).fehler.art, 'fachlich');
  const heuteJahr = rein(s.apiDashboard()).daten.jahr;
  assert.strictEqual(rein(s.apiDashboard(heuteJahr + 3)).daten.jahr, heuteJahr);
  const text = JSON.stringify(rein(s.apiDashboard()).daten);
  assert.ok(!/nachname|iban|email/i.test(text));
});

test('Verlauf mit synthetischem Verein: Bestand = Vormonat + Eintritte − Austritte, für jedes Jahr', () => {
  const s = als('Mitgliederverwalter');
  const heuteJahr = rein(s.apiDashboard()).daten.jahr;
  for (let j = heuteJahr; j >= heuteJahr - 4; j--) {
    const v = rein(s.apiDashboard(j)).daten.verlauf;
    let stand = v.anfang;
    v.monate.forEach(m => {
      if (m.bestand === null) return;
      stand += m.eintritte - m.austritte;
      assert.strictEqual(m.bestand, stand, j + '/' + m.monat);
    });
    assert.strictEqual(v.aktuell, stand);
  }
});
