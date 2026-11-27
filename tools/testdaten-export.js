#!/usr/bin/env node
/**
 * Export eines SYNTHETISCHEN Vereins (test/daten/generator.js, ~1.200 Mitglieder) zum Einfügen in eine
 * TEST-Tabelle in Google Sheets – ALLES ERFUNDEN, keine Verbindung zu echten Mitgliedern.
 *
 * Zweck:      Die Testumgebung (docs/BETRIEB.md, Abschnitt 3) mit einem vollständigen Verein in allen Tabs füllen:
 *             Mitglieder, Zeiträume, Abteilungen, Funktionen, Konten, Gemeinschaften, Sollstellungen mehrerer Jahre,
 *             Qualifikationen, Ehrungen, Einwilligungen. Anders als der Migrationsweg (tools/daten16-synthetisch.js →
 *             tools/migration-lokal.js) sind damit auch Finanzhistorie, Nachweise, Ehrungen und Datenschutz testbar.
 * Datenquelle: test/daten/generator.js (deterministisch über --seed).
 * Wer darf was: – (Entwicklungswerkzeug; nur für die Test-Tabelle, NIE in die Produktiv-Datenbank einfügen).
 * Besonderheiten:
 *   - Zellformat wie beim Migrationsweg (tools/migration-lokal.js, zelle): Datum TT.MM.JJJJ, ja/nein als Text,
 *     Beträge mit Dezimalkomma – passend zum Gebietsschema Deutschland der Tabelle.
 *   - Nicht exportiert werden die Stammdaten-Tabs aus der Startbelegung (legt `setup` identisch an), _Konfig
 *     (stattdessen konfig_werte.txt), _Protokoll, _Messung und leere Tabs.
 *   - Benutzer: Der Generator erfindet Konten unter der Vereinsdomain. Die werden NIE exportiert, damit kein echtes
 *     Postfach Zugang zur Testumgebung bekommt. Mit --benutzer <E-Mail> entsteht eine Zeile Mitgliederverwalter.
 *
 *   node tools/testdaten-export.js [--mitglieder 1200] [--seed 1] [--stichtag JJJJ-MM-TT] [--ziel testdaten/ausgabe]
 *                                  [--benutzer ich@example.org]
 *     → <Tab>.tsv je Tab, konfig_werte.txt, LIESMICH.txt (Einfüge-Reihenfolge und Zeilenzahlen),
 *       testdaten.json (alles in einer Datei, Zellformat der Tabelle) für den Import per Skript (testimport/)
 *
 *   require('./tools/testdaten-export').exportiere({ mitglieder, seed, stichtag, ziel, benutzer }) → { tabs, dateien, konfig }
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { erzeugeVerein, alsObjekte } = require('../test/daten/generator');
const { zelle } = require('./migration-lokal');
const { ladeProjekt } = require('../test/hilfe/projekt');

/** Tabs, die `setup` aus der Startbelegung identisch anlegt (der Generator übernimmt sie unverändert). */
const STAMMDATEN = ['Abteilung', 'Funktionsart', 'Beitragsart', 'Qualifikationsart', 'Ehrungsregel', 'Aufbewahrungsfrist'];
const NIE = ['_Konfig', '_Protokoll', '_Messung', 'Benutzer'];

function heute() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Erzeugt den Verein und schreibt die Dateien.
 * opt: { mitglieder = 1200, seed = 1, stichtag = heute, ziel, benutzer: [E-Mail] }
 * Liefert { tabs: { Tab: Zeilenzahl }, dateien: [Name], konfig: [[schluessel, wert]] }.
 */
function exportiere(opt) {
  const o = Object.assign({ mitglieder: 1200, seed: 1, stichtag: heute(), benutzer: [] }, opt || {});
  if (!o.ziel) throw new Error('Zielordner fehlt');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.stichtag)) throw new Error('Stichtag im Format JJJJ-MM-TT angeben');
  const projekt = ladeProjekt({});
  const schema = projekt.Schema.TABELLEN;
  const roh = erzeugeVerein({ seed: o.seed, mitglieder: o.mitglieder, stichtag: o.stichtag, fehler: false }).tabs;
  const verein = alsObjekte(roh);

  const benutzer = (o.benutzer || []).map((email, i) => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Keine gültige E-Mail-Adresse: ' + email);
    return {
      benutzer_id: i + 1, email, name: 'Test ' + (i + 1), rolle: 'Mitgliederverwalter', abteilung_id: null, mitglied_id: null,
      aktiv: true, angelegt_am: o.stichtag, bemerkung: 'Testumgebung', version: 1, geaendert_am: o.stichtag + 'T09:00:00',
      geaendert_von: 'testdaten-export'
    };
  });

  fs.mkdirSync(o.ziel, { recursive: true });
  const tabs = {}, dateien = [], json = {};
  const schreibeTab = (tab, objekte, zellen) => {
    const spalten = schema[tab].spalten;
    const zeilen = [spalten.map(s => s.name)].concat(objekte.map(ob => spalten.map(sp => zelle(ob[sp.name], sp))));
    fs.writeFileSync(path.join(o.ziel, tab + '.tsv'), zeilen.map(z => z.join('\t')).join('\r\n') + '\r\n');
    tabs[tab] = objekte.length;
    dateien.push(tab + '.tsv');
    // testdaten.json: Zellformat, wie die Tabelle es speichert (Datum/Zeitpunkt als Seriennummer, ja/nein als Text)
    json[tab] = { kopf: zellen[0], zeilen: zellen.slice(1) };
  };
  Object.keys(schema).forEach(tab => {
    if (STAMMDATEN.includes(tab) || NIE.includes(tab) || !(verein[tab] || []).length) return;
    schreibeTab(tab, verein[tab], roh[tab]);
  });
  if (benutzer.length) {
    const kopf = Array.from(schema.Benutzer.spalten, s => s.name);
    schreibeTab('Benutzer', benutzer, [kopf].concat(benutzer.map(b =>
      Array.from(projekt.Werte.objektZuZeile(kopf, b, 'Benutzer'), v => v === undefined || v === null ? '' : v))));
  }

  // _Konfig: nur Zähler der exportierten Tabs, Nummernkreis und Beitragsjahr. Die Anwendung nimmt ohnehin nie eine
  // ID unter „höchste vorhandene + 1“ (DB.neueId) – die Werte halten die Tabelle trotzdem stimmig.
  const k = {};
  verein._Konfig.forEach(z => { k[z.schluessel] = z.wert; });
  const konfig = [['beitragsjahr', k.beitragsjahr], ['mitgliedsnummer_naechste', k.mitgliedsnummer_naechste]]
    .concat(Object.keys(tabs).map(t => ['next_id_' + t, t === 'Benutzer' ? String(benutzer.length + 1) : k['next_id_' + t]]))
    .filter(([, w]) => w !== undefined && w !== null && w !== '');
  fs.writeFileSync(path.join(o.ziel, 'konfig_werte.txt'), konfig.map(z => z.join('\t')).join('\r\n') + '\r\n');
  dateien.push('konfig_werte.txt');

  // Eine Datei für den Import per Skript (testimport/Import.js): in den Drive-Ordner hochladen, dort ausführen.
  fs.writeFileSync(path.join(o.ziel, 'testdaten.json'), JSON.stringify({
    art: 'mitgliederverwaltung-testdaten', version: 1, synthetisch: true,
    erzeugt: { seed: o.seed, mitglieder: o.mitglieder, stichtag: o.stichtag },
    tabs: json, konfig
  }));
  dateien.push('testdaten.json');

  const liesmich = [
    'SYNTHETISCHE TESTDATEN – alles erfunden. Nur in die TEST-Tabelle einfügen, nie in die Produktiv-Datenbank.',
    'Erzeugt: seed ' + o.seed + ', ' + o.mitglieder + ' Mitglieder, Stichtag ' + o.stichtag + '.',
    '',
    'Voraussetzung: Test-Tabelle mit eigenem Skriptprojekt (DB_ID), `setup` ausgeführt, Gebietsschema Deutschland.',
    '',
    'EINFACHER: testdaten.json in den Drive-Ordner des Import-Projekts laden und dort testdatenImportieren',
    'ausführen (testimport/LIESMICH.md). Sonst von Hand:',
    '',
    'Je Tab: alle Zeilen unter der Kopfzeile löschen, <Tab>.tsv im Texteditor öffnen, ab Zeile 2 kopieren,',
    'im Sheet Zelle A2 anklicken, Strg+Umschalt+V (nur Werte).',
    ''
  ].concat(Object.keys(tabs).map(t => '  ' + (t + '.tsv').padEnd(34) + String(tabs[t]).padStart(6) + ' Zeilen'), [
    '',
    benutzer.length
      ? 'Benutzer.tsv: nur die mit --benutzer angegebenen Adressen (Mitgliederverwalter); ersetzt den ganzen Tab.'
      : 'Benutzer: nicht enthalten – im Tab Benutzer die eigene Adresse eintragen (wie bei der Einrichtung).',
    'Tab _Konfig: die Werte aus konfig_werte.txt bei den gleichnamigen Schlüsseln eintragen.',
    'Danach in der Oberfläche: Verwaltung → System → „Snapshot neu aufbauen“.',
    'E-Mail: vor Versandtests in _Konfig mail_test_an setzen (die erfundenen Adressen sind @example.de).'
  ]);
  fs.writeFileSync(path.join(o.ziel, 'LIESMICH.txt'), liesmich.join('\r\n') + '\r\n');
  dateien.push('LIESMICH.txt');
  return { tabs, dateien, konfig };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const wert = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const r = exportiere({
    mitglieder: Number(wert('--mitglieder') || 1200),
    seed: Number(wert('--seed') || 1),
    stichtag: wert('--stichtag') || heute(),
    ziel: wert('--ziel') || path.join('testdaten', 'ausgabe'),
    benutzer: (wert('--benutzer') || '').split(',').map(s => s.trim()).filter(Boolean)
  });
  const ziel = wert('--ziel') || path.join('testdaten', 'ausgabe');
  console.log('Synthetischer Verein exportiert nach ' + ziel + ':');
  Object.keys(r.tabs).forEach(t => console.log('  ' + t.padEnd(26) + String(r.tabs[t]).padStart(6)));
  console.log('Werte für _Konfig:');
  r.konfig.forEach(([s, w]) => console.log('  ' + s + ' = ' + w));
  console.log('Anleitung: ' + path.join(ziel, 'LIESMICH.txt'));
}

module.exports = { exportiere };
