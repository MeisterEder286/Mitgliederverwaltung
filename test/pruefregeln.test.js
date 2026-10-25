/**
 * Tests für src/lib/pruefregeln.js – Integritäts- und Datenqualitätsregeln (Mängelliste).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ladeFachdaten, kopie } = require('./hilfe/fachdaten');

const HEUTE = '2026-10-25';
function regeln(b) { return new Set(b.map(x => x.regel)); }

test('Beispieldaten: FZ-Mängel (Vogl, Lehner) werden gefunden', () => {
  const { g, daten, konfig } = ladeFachdaten();
  const b = kopie(g.Pruefregeln.pruefe(daten, HEUTE, konfig));
  assert.deepStrictEqual(b.filter(x => x.regel === 'fz_fehlt').map(x => x.mitglied_id).sort(), [12, 13]);
  assert.ok(!b.some(x => x.regel === 'zeitraum_fehlt' && x.mitglied_id === 14), 'anonymisierter Anker ist ausgenommen');
  const z = kopie(g.Pruefregeln.zusammenfassung(b));
  assert.strictEqual(z.fehler + z.warnung + z.hinweis, b.length);
});

test('eingebaute Fehler werden alle erkannt', () => {
  const { g, daten, konfig } = ladeFachdaten();
  const m = id => daten.Mitglied.find(x => x.mitglied_id === id);
  daten.Mitgliedschaftszeitraum = daten.Mitgliedschaftszeitraum.filter(z => z.mitglied_id !== 11);       // zeitraum_fehlt
  daten.Beitragskonto.find(k => k.beitragskonto_id === 5).mandatsreferenz = null;                     // lastschrift_unvollstaendig
  daten.Beitragskonto.find(k => k.beitragskonto_id === 1).iban = 'DE89370400440532013001';            // iban_ungueltig
  m(4).beitragsart_id = null;                                                                          // aktiv_ohne_beitrag
  m(13).beitragskonto_id = null;                                                                       // aktiv_ohne_konto
  m(12).beitragskonto_id = 6;                                                                          // konto_inaktiv
  m(8).beitragsgemeinschaft_id = 1;                                                                    // gemeinschaft_konten (Konto 5)
  m(12).beitragsart_id = 77;                                                                           // verweis_ungueltig
  daten.Funktion.push({ funktion_id: 90, mitglied_id: 6, funktionsart_id: 1, abteilung_id: 2, von: '2020-01-01' }); // amt_ebene
  daten.Abteilungszugehoerigkeit.push({ zugehoerigkeit_id: 99, mitglied_id: 1, abteilung_id: 1, status: 'aktiv' });   // eindeutigkeit
  daten.Mitglied.push(Object.assign({}, m(2), { mitglied_id: 50, mitgliedsnummer: '9999' }));         // dublette (+ zeitraum_fehlt)
  m(11).strasse = 'Birkenweg 5'; m(11).hausnummer = null;                                             // strasse_hausnummer
  m(13).plz = '8406';                                                                                  // plz_format
  m(12).email = 'kein-at.example.de';                                                                  // email_format
  m(6).geschlecht = null;                                                                              // geschlecht_fehlt
  m(3).vertreter_mitglied_id = null;                                                                   // minderjaehrig_ohne_vertretung
  m(10).sterbedatum = '2026-01-01';                                                                    // verstorben_laufend
  m(1).status = 'ausgetreten';                                                                         // status_veraltet
  daten.Mitgliedschaftszeitraum.find(z => z.mitglied_id === 7).austrittsdatum = '2025-12-31';          // ausgetreten_laufend
  const b = kopie(g.Pruefregeln.pruefe(daten, HEUTE, konfig));
  const gefunden = regeln(b);
  ['zeitraum_fehlt', 'lastschrift_unvollstaendig', 'iban_ungueltig', 'aktiv_ohne_beitrag', 'aktiv_ohne_konto', 'konto_inaktiv',
    'gemeinschaft_konten', 'verweis_ungueltig', 'amt_ebene', 'eindeutigkeit', 'dublette', 'strasse_hausnummer', 'plz_format',
    'email_format', 'geschlecht_fehlt', 'minderjaehrig_ohne_vertretung', 'verstorben_laufend', 'status_veraltet',
    'ausgetreten_laufend', 'fz_fehlt', 'gemeinschaft_und_beitragsart']
    .forEach(r => assert.ok(gefunden.has(r), 'Regel nicht ausgelöst: ' + r));
  Object.keys(g.Pruefregeln.REGELN).forEach(r => assert.ok(g.Pruefregeln.REGELN[r].titel));
});

test('IBAN-Prüfziffer (eigene Prüfung bzw. Iban aus src/lib/iban.js)', () => {
  const { g } = ladeFachdaten();
  assert.strictEqual(g.Pruefregeln.ibanOk('DE89 3704 0044 0532 0130 00'), true);
  assert.strictEqual(g.Pruefregeln.ibanOk('DE89370400440532013001'), false);
  assert.strictEqual(g.Pruefregeln.ibanOk(''), false);
});

const GENERATOR = path.join(__dirname, 'daten', 'generator.js');
const ZUORDNUNG = {   // Fehlerart des Generators → Prüfregel
  lastschrift_ohne_mandat: 'lastschrift_unvollstaendig', gemeinschaft_zwei_konten: 'gemeinschaft_konten',
  aktiv_ohne_beitrag: 'aktiv_ohne_beitrag', waise: 'waise', hausnummer_in_strasse: 'strasse_hausnummer',
  geschlecht_fehlt: 'geschlecht_fehlt', geburtsdatum_fehlt: 'geburtsdatum_fehlt'
};

test('synthetischer Verein (1.200 Mitglieder): sauber ohne Fehler, alle eingebauten Fehler gefunden', { skip: !fs.existsSync(GENERATOR) }, () => {
  const { erzeugeVerein, alsObjekte } = require(GENERATOR);
  const { g } = ladeFachdaten();
  const sauber = erzeugeVerein({ seed: 1, mitglieder: 1200, stichtag: HEUTE, fehler: false });
  const bs = kopie(g.Pruefregeln.pruefe(alsObjekte(sauber.tabs), HEUTE, {}));
  // Kernregeln aus dem Lies-mich müssen im sauberen Datensatz eingehalten sein. (fz_fehlt ist realistisch gewollt;
  // konto_inaktiv: Generator legt bei Neuaufnahmen teils stillgelegte Konten an – an W1-G gemeldet.)
  const kern = ['zeitraum_fehlt', 'lastschrift_unvollstaendig', 'aktiv_ohne_beitrag', 'gemeinschaft_konten', 'amt_ebene',
    'eindeutigkeit', 'verweis_ungueltig', 'iban_ungueltig', 'verstorben_laufend'];
  const harte = bs.filter(x => kern.indexOf(x.regel) >= 0);
  assert.deepStrictEqual(harte.map(x => x.regel + ' ' + x.tab + ' ' + x.id + ': ' + x.meldung).slice(0, 10), [], 'Fehler im sauberen Datensatz');

  const mitFehlern = erzeugeVerein({ seed: 1, mitglieder: 1200, stichtag: HEUTE, fehler: true });
  const b = kopie(g.Pruefregeln.pruefe(alsObjekte(mitFehlern.tabs), HEUTE, {}));
  mitFehlern.fehlerliste.forEach(f => {
    const regel = ZUORDNUNG[f.art];
    assert.ok(regel, 'unbekannte Fehlerart des Generators: ' + f.art);
    const passt = b.some(x => x.regel === regel && (x.id === f.id || x.mitglied_id === f.id || (x.tab === f.tab && x.id === f.id)));
    assert.ok(passt, 'nicht gefunden: ' + f.art + ' ' + f.tab + ' ' + f.id);
  });
});
