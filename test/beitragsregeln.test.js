/**
 * Tests für die Beitragsregeln (Beitragsarten „als Gemeinschaft“: Familienbeitrag, Ehegattenbeitrag) in src/lib/familie.js:
 * Einstellungen je Regel, Prüfung einer Gemeinschaft, Bericht der Abweichungen, Datenqualität (Pruefregeln),
 * Übernahme bei der Neuaufnahme und im Finanzbereich.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein, alsObjekte } = require('./daten/generator');

const HEUTE = '2026-10-25';
const g0 = ladeProjekt({});
const KONFIG = { familie_kinder_bis_alter: '17', familie_ausbildung_bis_alter: '25', familie_umstellung_stichtag: '01.01.' };
const FAMILIE = { beitragsart_id: 4, als_gemeinschaft: 'Familie', bezeichnung: 'Familienbeitrag', betrag: 180, max_erwachsene: 2, max_kinder: null, kinder_bis_alter: 17, ausbildung_bis_alter: 25, aktiv: true };
const EHE = { beitragsart_id: 5, als_gemeinschaft: 'Ehepaar', bezeichnung: 'Ehegattenbeitrag', betrag: 150, max_erwachsene: 2, max_kinder: 0, kinder_bis_alter: null, ausbildung_bis_alter: null, aktiv: true };

function bestand(gemeinschaft, personen) {
  const d = {
    Beitragsart: [
      { beitragsart_id: 1, bezeichnung: 'Erwachsene', betrag: 100, alter_von: 18, alter_bis: null, aktiv: true },
      { beitragsart_id: 2, bezeichnung: 'Kinderbeitrag (bis 18)', betrag: 45, alter_von: 0, alter_bis: 17, aktiv: true },
      FAMILIE, EHE
    ],
    Beitragsgemeinschaft: [Object.assign({ beitragsgemeinschaft_id: 1, bezeichnung: 'Familie Huber', aktiv: true }, gemeinschaft)],
    Beitragskonto: [{ beitragskonto_id: 1, kontoinhaber_name: 'Huber, Max', kontoinhaber_mitglied_id: 1, zahlweg: 'Lastschrift', aktiv: true }],
    Mitglied: [], Mitgliedschaftszeitraum: []
  };
  personen.forEach((p, i) => d.Mitglied.push(Object.assign({ mitglied_id: i + 1, vorname: 'P' + i, nachname: 'Huber', beitragskonto_id: 1, beitragsgemeinschaft_id: 1, version: 1 }, p)));
  d.Mitglied.forEach(m => d.Mitgliedschaftszeitraum.push({ zeitraum_id: m.mitglied_id, mitglied_id: m.mitglied_id, eintrittsdatum: '2010-01-01' }));
  return d;
}
const regeln = l => rein(l).map(a => a.regel).sort();

test('Familienbeitrag nach Regel: 2 Erwachsene + Kinder passen, Kind in Ausbildung zählt mit', () => {
  const d = bestand({ beitragsart_id: 4, festbetrag: 180 }, [
    { geburtsdatum: '1975-03-01' }, { geburtsdatum: '1977-06-01' }, { geburtsdatum: '2012-01-01' }, { geburtsdatum: '2014-01-01' },
    { geburtsdatum: '2004-05-01', ausbildung_art: 'Studium', ausbildung_bis: '2028-09-30', ausbildung_nachweis_am: '2026-09-01' }
  ]);
  assert.deepStrictEqual(regeln(g0.Familie.abweichungen(d, KONFIG, HEUTE)), []);
  assert.strictEqual(g0.Familie.regelText(FAMILIE, KONFIG), '2 Erwachsene, beliebig viele Kinder bis 18, in Ausbildung bis 25');
});

test('Abweichungen: Kind zu alt ohne Ausbildung, Ausbildungsende fehlt, Festbetrag abweichend, Kinderbeitrag über 18', () => {
  const d = bestand({ beitragsart_id: 4, festbetrag: 170 }, [
    { geburtsdatum: '1975-03-01' }, { geburtsdatum: '1977-06-01' },
    { geburtsdatum: '2005-02-01' },                                   // 20, keine Ausbildung → fällt raus
    { geburtsdatum: '2006-02-01', ausbildung_art: 'Ausbildung' }      // 19, Art ohne Ende
  ]);
  d.Mitglied.push({ mitglied_id: 9, vorname: 'Einzel', nachname: 'Groß', geburtsdatum: '2007-01-15', beitragsart_id: 2, version: 1 });
  d.Mitgliedschaftszeitraum.push({ zeitraum_id: 9, mitglied_id: 9, eintrittsdatum: '2015-01-01' });
  const l = g0.Familie.abweichungen(d, KONFIG, HEUTE);
  const r = regeln(l);
  assert.ok(r.includes('kind_zu_alt'), r);
  assert.ok(r.includes('ausbildung_ende_fehlt'), r);
  assert.ok(r.includes('betrag_abweichend'), r);
  assert.ok(r.includes('beitragsart_alter'), r);
  assert.ok(l.find(a => a.regel === 'beitragsart_alter').meldung.includes('Kinderbeitrag'));
  const d2 = bestand({ beitragsart_id: 4, festbetrag: 180 }, [{ geburtsdatum: '1975-03-01' }, { geburtsdatum: '1977-06-01' }]);
  d2.Mitglied.push({ mitglied_id: 9, vorname: 'Falsch', nachname: 'Tarif', geburtsdatum: '1990-01-15', beitragsart_id: 4, version: 1 });
  d2.Mitgliedschaftszeitraum.push({ zeitraum_id: 9, mitglied_id: 9, eintrittsdatum: '2015-01-01' });
  assert.ok(regeln(g0.Familie.abweichungen(d2, KONFIG, HEUTE)).includes('beitragsart_gemeinschaft'));
  assert.ok(l.every(a => a.titel && a.schwere));
});

test('Ehegattenbeitrag: Kind und dritter Erwachsener sind Abweichungen, keine Verlängerung durch Ausbildung', () => {
  const d = bestand({ beitragsart_id: 5, festbetrag: 150, bezeichnung: 'Ehepaar Huber' }, [
    { geburtsdatum: '1975-03-01' }, { geburtsdatum: '1977-06-01' }, { geburtsdatum: '1976-01-01' }, { geburtsdatum: '2015-01-01' }
  ]);
  const r = regeln(g0.Familie.abweichungen(d, KONFIG, HEUTE));
  assert.ok(r.includes('zu_viele_erwachsene'), r);
  assert.ok(r.includes('zu_viele_kinder'), r);
  const e = g0.Familie.einstellungenFuer(KONFIG, EHE);
  assert.strictEqual(e.ausbildungBis, null);
});

test('Gemeinschaft ohne Regel und mit nur einer Person wird gemeldet; Datenqualität enthält die Beitragsregeln', () => {
  const d = bestand({ festbetrag: 180 }, [{ geburtsdatum: '1975-03-01' }]);
  const r = regeln(g0.Familie.abweichungen(d, KONFIG, HEUTE));
  assert.ok(r.includes('ohne_regel') && r.includes('nur_eine_person'), r);
  const befunde = rein(g0.Pruefregeln.pruefe(d, HEUTE, KONFIG));
  assert.ok(befunde.some(b => b.regel === 'beitrag_ohne_regel'));
  assert.ok(g0.Pruefregeln.REGELN.beitrag_nur_eine_person.titel.startsWith('Beitragsregel'));
});

const MV = 'verwaltung@tsv-ergoldsbach.de';
function als(email) {
  const verein = erzeugeVerein({ seed: 9, mitglieder: 150 });
  const f = erzeugeFakes({ tabs: verein.tabs, email, eigentuemer: MV });
  return { f, g: ladeProjekt(f.globale), obj: tab => alsObjekte({ [tab]: f.daten(tab) })[tab] };
}
function ok(a) { a = rein(a); assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return a.daten; }

test('Neuaufnahme mit Regel: Festbetrag aus der Regel, Abweichungen als Hinweis; Bericht über die API', () => {
  const u = als(MV);
  const d = ok(u.g.apiMitgliedAufnehmen({
    eintrittsdatum: '2026-11-01',
    personen: [
      { mitglied: { vorname: 'Ada', nachname: 'Regelprobe', geburtsdatum: '1980-01-01' } },
      { mitglied: { vorname: 'Bo', nachname: 'Regelprobe', geburtsdatum: '1981-01-01' } },
      { mitglied: { vorname: 'Cy', nachname: 'Regelprobe', geburtsdatum: '1979-01-01' } }
    ],
    zahlung: { art: 'neu', inhaber: { art: 'antrag', index: 0 }, konto: { zahlweg: 'Überweisung' } },
    gemeinschaft: { art: 'neu', beitragsart_id: 5, bezeichnung: 'Ehepaar Regelprobe' }
  }));
  const gem = u.obj('Beitragsgemeinschaft').find(x => x.beitragsgemeinschaft_id === d.gemeinschaft_id);
  assert.strictEqual(gem.beitragsart_id, 5);
  assert.strictEqual(gem.festbetrag, 150);
  assert.ok(d.hinweise.some(h => /^Abweichung: .*3 Erwachsene/.test(h)), JSON.stringify(d.hinweise));
  const b = ok(u.g.apiFamilieAbweichungen());
  assert.ok(b.regeln.some(r => r.bezeichnung === 'Ehegattenbeitrag' && /keine Kinder/.test(r.text)));
  assert.ok(b.abweichungen.some(a => a.gemeinschaft_id === d.gemeinschaft_id && a.regel === 'zu_viele_erwachsene'));
});

test('Finanzen: Gemeinschaft mit Regel anlegen übernimmt deren Betrag, leerer Festbetrag beim Bearbeiten ebenso', () => {
  const u = als(MV);
  const r = ok(u.g.apiFinanzenGemeinschaftSpeichern(null, null, { bezeichnung: 'Familie Test', beitragsart_id: 4 }));
  let g = u.obj('Beitragsgemeinschaft').find(x => x.beitragsgemeinschaft_id === r.gemeinschaft_id);
  assert.strictEqual(g.festbetrag, 180);
  ok(u.g.apiFinanzenGemeinschaftSpeichern(g.beitragsgemeinschaft_id, g.version, { festbetrag: 200 }));
  g = u.obj('Beitragsgemeinschaft').find(x => x.beitragsgemeinschaft_id === r.gemeinschaft_id);
  assert.strictEqual(g.festbetrag, 200);
  ok(u.g.apiFinanzenGemeinschaftSpeichern(g.beitragsgemeinschaft_id, g.version, { beitragsart_id: 5, festbetrag: null }));
  g = u.obj('Beitragsgemeinschaft').find(x => x.beitragsgemeinschaft_id === r.gemeinschaft_id);
  assert.strictEqual(g.festbetrag, 150);
  const f = rein(u.g.apiFinanzenGemeinschaftSpeichern(null, null, { bezeichnung: 'X', beitragsart_id: 1 }));
  assert.strictEqual(f.ok, false);
});
