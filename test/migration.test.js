/**
 * Tests für die Migration Daten16 → neues Modell (src/lib/migration.js, tools/migration-lokal.js) mit dem
 * SYNTHETISCHEN Altbestand aus tools/daten16-synthetisch.js (alles erfunden).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeDaten16, alsCp1252, csvText, KOPF } = require('../tools/daten16-synthetisch');
const { fuehreAus } = require('../tools/migration-lokal');

const g = ladeProjekt({});
const M = g.Migration;
const SCRATCH = fs.mkdtempSync(path.join(require('os').tmpdir(), 'migration-test-'));
const objekte = tab => g.Startbelegung[tab].zeilen.map(z => g.Werte.zeileZuObjekt(g.Startbelegung[tab].kopf, z, tab));
const OPT = { beitragsjahr: 2026, stichtag: '2026-10-25', abteilungen: objekte('Abteilung'), beitragsarten: objekte('Beitragsart') };

test('Straße und Hausnummer trennen', () => {
  const t = s => rein(M.teileStrasse(s));
  assert.deepStrictEqual(t('Rosenweg 12'), { strasse: 'Rosenweg', hausnummer: '12', sicher: true });
  assert.strictEqual(t('Hauptstr. 12a').hausnummer, '12a');
  assert.strictEqual(t('Hauptstraße 12 a').hausnummer, '12a');
  assert.strictEqual(t('Lindenstr. 12-14').hausnummer, '12-14');
  assert.strictEqual(t('Weg 12/1').hausnummer, '12/1');
  assert.deepStrictEqual([t('Am Anger 7 1/2').strasse, t('Am Anger 7 1/2').hausnummer], ['Am Anger', '7 1/2']);
  assert.deepStrictEqual([t('Straße des 17. Juni 5').strasse, t('Straße des 17. Juni 5').hausnummer], ['Straße des 17. Juni', '5']);
  assert.strictEqual(t('Hofmark').sicher, false);
});

test('Datumsformate, Beträge, PLZ, Geschlecht, Anrede', () => {
  assert.strictEqual(M.datum('17.08.2026').wert, '2026-08-17');
  assert.strictEqual(M.datum('17.08.2026 00:00:00').wert, '2026-08-17');
  assert.strictEqual(M.datum('2026-08-17').wert, '2026-08-17');
  assert.strictEqual(M.datum('45000').wert, '2023-03-15');
  assert.strictEqual(M.datum('1.2.75', 2026).wert, '1975-02-01');
  assert.ok(M.datum('31.02.2020').fehler);
  assert.strictEqual(M.betrag('180,00 €'), 180);
  assert.strictEqual(M.betrag('1.234,50'), 1234.5);
  assert.strictEqual(M.plzNorm('84061').wert, '84061');
  assert.strictEqual(M.plzNorm('1067').wert, '01067');
  assert.ok(M.plzNorm('A-4020').fehler);
  assert.strictEqual(M.geschlechtNorm('männlich').wert, 'm');
  assert.strictEqual(M.geschlechtNorm('', 'Frau').wert, 'w');
  assert.ok(M.geschlechtNorm('', null).fehler);
  assert.strictEqual(M.anredeNorm('Hr.').wert, 'Herr');
});

test('Spaltennamen tolerant, fehlende Pflichtspalte wird gemeldet', () => {
  const sp = rein(M.ordneSpalten(['ID', 'Mitgl Nr', 'NACHNAME', 'Ein Dat', 'Beitrag Abt2', 'Unsinn'], M.SPALTEN));
  assert.strictEqual(sp.zu.mitglnr, 'Mitgl Nr');
  assert.strictEqual(sp.zu.eindat, 'Ein Dat');
  assert.strictEqual(sp.zu.beitragabt2, 'Beitrag Abt2');
  assert.deepStrictEqual(sp.unbekannt, ['Unsinn']);
  const e = rein(M.migriere([{ ID: '1', Nachname: 'X' }], OPT));
  assert.ok(e.bericht.pruefliste.some(p => p.art === 'spalte_fehlt' && p.schwere === 'fehler'));
});

test('Wagner-Fall: Pauschale 180 für Michael, Sabine, Lena; Felix eigener Beitrag auf demselben Konto → Soll 280 €', () => {
  const z = (o) => Object.assign(Object.fromEntries(KOPF.map(k => [k, ''])), o);
  const zeilen = [
    z({ ID: '1', MitglNr: '1042', Anrede: 'Herr', Nachname: 'Wagner', Vorname: 'Michael', Strasse: 'Rosenweg 12', Plz: '84061', Ort: 'Ergoldsbach', GebDat: '14.03.1978', EinDat: '01.09.2001', IBAN: 'DE89370400440532013000', Gesamtbeitrag: '180,00', Geschlecht: 'm', 'Abteilung 1': 'Fußball' }),
    z({ ID: '2', MitglNr: '1043', Anrede: 'Frau', Nachname: 'Wagner', Vorname: 'Sabine', GebDat: '02.07.1980', EinDat: '01.09.2001', Gesamtbeitrag: '0', Zahler: '1042', Geschlecht: 'w' }),
    z({ ID: '3', MitglNr: '1044', Nachname: 'Wagner', Vorname: 'Lena', GebDat: '21.11.2011', EinDat: '01.02.2018', Zahler: '1042', Geschlecht: 'w', 'Abteilung 1': 'Turnen', 'Abteilung 2': 'Fussball' }),
    z({ ID: '4', MitglNr: '1187', Anrede: 'Herr', Nachname: 'Wagner', Vorname: 'Felix', GebDat: '03.05.2004', EinDat: '01.02.2018', Gesamtbeitrag: '100,00', Zahler: '1042', Geschlecht: 'm', Zahlung: 'NG' })
  ];
  const e = rein(M.migriere(zeilen, OPT));
  assert.strictEqual(e.tabs.Beitragskonto.length, 1);
  const k = e.tabs.Beitragskonto[0];
  assert.strictEqual(k.zahlweg, 'Lastschrift');
  assert.strictEqual(k.mandatsreferenz, 'TSV-2001-1042');
  assert.strictEqual(k.kontoinhaber_mitglied_id, 1);
  assert.strictEqual(e.tabs.Beitragsgemeinschaft.length, 1);
  assert.strictEqual(e.tabs.Beitragsgemeinschaft[0].festbetrag, 180);
  const m = id => e.tabs.Mitglied.find(x => x.mitglied_id === id);
  [1, 2, 3].forEach(id => assert.strictEqual(m(id).beitragsgemeinschaft_id, 1));
  assert.strictEqual(m(4).beitragsgemeinschaft_id, null);
  assert.strictEqual(m(4).beitragsart_id, 1);
  assert.ok(e.tabs.Mitglied.every(x => x.beitragskonto_id === 1));
  // NG → Sollstellung mit dem Konto-Soll 180 + 100
  assert.strictEqual(e.tabs.Sollstellung.length, 1);
  assert.strictEqual(e.tabs.Sollstellung[0].soll_betrag, 280);
  assert.strictEqual(e.tabs.Sollstellung[0].status, 'ruecklastschrift');
  // Lena: „Fussball“ wird Fußball (1), Turnen (2); Abt 2 als aktiv
  assert.deepStrictEqual(e.tabs.Abteilungszugehoerigkeit.filter(a => a.mitglied_id === 3).map(a => a.abteilung_id).sort(), [1, 2]);
  assert.strictEqual(m(1).briefanrede, 'Sehr geehrter Herr Wagner');
  assert.strictEqual(m(3).briefanrede, 'Liebe Lena');
  assert.strictEqual(m(1).strasse + '|' + m(1).hausnummer, 'Rosenweg|12');
  assert.ok(e.bericht.annahmen.some(a => /Mandatsreferenz/.test(a)), 'Mandats-Annahme im Bericht');
});

test('synthetischer Altbestand: alle eingebauten Fälle landen in der Prüfliste, Ergebnis besteht die Prüfregeln', () => {
  const d = erzeugeDaten16({ seed: 7, anzahl: 600 });
  const e = rein(M.migriere(d.zeilen, Object.assign({ austritte: d.austritte }, OPT)));
  const erwartet = { zahler_ausgetreten: 'zahler_ausgetreten', zahler_unbekannt: 'zahler_unbekannt', iban_abweichend: 'iban_abweichend',
    hausnummer: 'hausnummer', plz: 'plz', geschlecht: 'geschlecht', dublette: 'dublette', abteilung_unbekannt: 'abteilung_unbekannt',
    iban_aus_blz: 'iban_aus_blz', iban_ungueltig: 'iban_ungueltig', cluster_mischfall: 'cluster_mischfall',
    beitrag_unbekannt: 'beitrag_unbekannt', eintritt_fehlt: 'eintritt_fehlt', zahlung_unbekannt: 'zahlung_unbekannt',
    zeitraum_ueberlappt: 'zeitraum_ueberlappt' };
  d.faelle.forEach(f => {
    if (!erwartet[f.art]) return;
    assert.ok(e.bericht.pruefliste.some(p => p.art === erwartet[f.art] && p.mitglnr === f.mitglnr), 'nicht gemeldet: ' + f.art + ' ' + f.mitglnr);
  });
  // NG-Fälle → Sollstellungen; Wiedereintritt → zwei Zeiträume
  const ng = d.faelle.filter(f => f.art === 'ng');
  assert.strictEqual(e.tabs.Sollstellung.length, ng.length);
  const wd = d.faelle.find(f => f.art === 'wiedereintritt');
  assert.strictEqual(e.tabs.Mitgliedschaftszeitraum.filter(z => z.mitglied_id === Number(wd.id)).length, 2);
  // Prüfregeln auf das Ergebnis: harte Regeln nur dort, wo die Prüfliste es bereits meldet
  const daten = Object.assign({}, e.tabs, { Abteilung: objekte('Abteilung'), Beitragsart: objekte('Beitragsart'), Funktion: [], Funktionsart: objekte('Funktionsart'),
    Qualifikation: [], Qualifikationsart: objekte('Qualifikationsart'), Ehrung: [], Ehrungsregel: objekte('Ehrungsregel'), Einwilligung: [], _Konfig: objekte('_Konfig') });
  const befunde = rein(g.Pruefregeln.pruefe(daten, '2026-10-25', {}));
  const gemeldet = new Set(e.bericht.pruefliste.map(p => p.mitglnr));
  const nrVon = {}; e.tabs.Mitglied.forEach(m => { nrVon[m.mitglied_id] = m.mitgliedsnummer; });
  const kontoInhaber = {}; e.tabs.Beitragskonto.forEach(k => { kontoInhaber[k.beitragskonto_id] = k.kontoinhaber_mitglied_id; });
  const harte = ['zeitraum_fehlt', 'lastschrift_unvollstaendig', 'gemeinschaft_konten', 'eindeutigkeit', 'verweis_ungueltig', 'iban_ungueltig', 'aktiv_ohne_beitrag'];
  const offen = befunde.filter(b => harte.includes(b.regel)).filter(b => {
    const mid = b.mitglied_id || (b.tab === 'Beitragskonto' ? kontoInhaber[b.id] : null);
    return !gemeldet.has(nrVon[mid]);
  });
  assert.deepStrictEqual(offen.map(b => b.regel + ' ' + b.tab + ' ' + b.id + ' ' + b.meldung).slice(0, 5), []);
});

test('CLI: cp1252-Datei mit Semikolon, Ausgabe lässt sich ins Sheet übernehmen und die App startet', () => {
  const d = erzeugeDaten16({ seed: 11, anzahl: 250 });
  const datei = path.join(SCRATCH, 'daten16_cp1252.csv');
  fs.writeFileSync(datei, alsCp1252(csvText(d.kopf, d.zeilen)));
  const aus = path.join(SCRATCH, 'ausgabe');
  const r = fuehreAus({ datei, ziel: aus, beitragsjahr: 2026, stichtag: '2026-10-25', pauschalen: [180, 150] });
  assert.strictEqual(r.info.zeichensatz, 'Windows-1252');
  assert.strictEqual(r.csv.trenn, ';');
  assert.ok(r.ergebnis.tabs.Mitglied.some(m => m.nachname === 'Straßer' || m.nachname === 'Wagner'));
  ['Mitglied.tsv', 'Beitragskonto.tsv', 'pruefbericht.html', 'pruefbericht.csv', 'konfig_werte.txt'].forEach(f => assert.ok(fs.existsSync(path.join(aus, f)), f));
  const html = fs.readFileSync(path.join(aus, 'pruefbericht.html'), 'utf8');
  assert.match(html, /Echtdaten/);
  assert.doesNotMatch(html, /<script[^>]+src=/);

  // Rundlauf: leeres Sheet einrichten, TSV-Inhalte ab A2 „einfügen“ (wie Strg+Umschalt+V), _Konfig-Zähler setzen
  const EIG = 'verwaltung@tsv-ergoldsbach.de';
  const e = erzeugeFakes({ tabs: {}, email: EIG, eigentuemer: EIG });
  const s = ladeProjekt(e.globale);
  s.setup();
  const tabs = {};
  e.datei.getSheets().forEach(b => { tabs[b.getName()] = e.daten(b.getName()).map(z => z.slice()); });
  ['Mitglied', 'Mitgliedschaftszeitraum', 'Abteilungszugehoerigkeit', 'Beitragskonto', 'Beitragsgemeinschaft', 'Sollstellung'].forEach(tab => {
    const [kopf, ...zeilen] = fs.readFileSync(path.join(aus, tab + '.tsv'), 'utf8').trim().split(/\r?\n/).map(z => z.split('\t'));
    const spalten = Object.fromEntries(s.Schema.TABELLEN[tab].spalten.map(sp => [sp.name, sp]));
    const ziel = tabs[tab][0];
    zeilen.forEach(z => tabs[tab].push(ziel.map(k => { const i = kopf.indexOf(k); return i < 0 || z[i] === '' ? '' : s.Werte.zelleSchreiben(z[i], spalten[k]); })));
  });
  const kk = tabs._Konfig[0];
  const werte = Object.fromEntries(fs.readFileSync(path.join(aus, 'konfig_werte.txt'), 'utf8').trim().split(/\r?\n/).map(z => z.split('\t')));
  tabs._Konfig.forEach(z => { if (werte[z[kk.indexOf('schluessel')]] !== undefined) z[kk.indexOf('wert')] = werte[z[kk.indexOf('schluessel')]]; });
  const bk = tabs.Benutzer[0];
  tabs.Benutzer.push(bk.map(k => ({ benutzer_id: 1, email: 'mv@tsv-ergoldsbach.de', rolle: 'Mitgliederverwalter', aktiv: 'ja' })[k] ?? ''));
  const f = erzeugeFakes({ tabs, email: 'mv@tsv-ergoldsbach.de', eigentuemer: EIG });
  const app = ladeProjekt(f.globale);
  const start = rein(app.apiStart());
  assert.strictEqual(start.ok, true, JSON.stringify(start.fehler));
  const anzahl = start.daten.snapshot.listen.mitglieder.z.length;
  assert.strictEqual(anzahl, r.ergebnis.tabs.Mitglied.length);
  // führende Nullen der Mitgliedsnummer bleiben erhalten
  const nrSpalte = start.daten.snapshot.listen.mitglieder.k.indexOf('mitgliedsnummer');
  assert.ok(start.daten.snapshot.listen.mitglieder.z.every(z => /^\d{4}$/.test(z[nrSpalte])));
  // Beitrag lässt sich für ein migriertes Konto berechnen
  const fin = rein(app.apiFinanzenUebersicht(2026));
  assert.strictEqual(fin.ok, true, JSON.stringify(fin.fehler));
});
