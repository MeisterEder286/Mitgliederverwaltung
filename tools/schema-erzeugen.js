#!/usr/bin/env node
/**
 * Erzeugt src/lib/schema.js und src/lib/startbelegung.js aus den CSV-Dateien in docs/daten/.
 *
 * Maßgebliche Quelle des Datenmodells sind die CSV-Dateien:
 *   docs/daten/tabellen.csv        Tabs, ID-Spalte, Eindeutigkeiten
 *   docs/daten/feldkatalog.csv     jede Spalte mit Typ, Pflicht, Auswahlliste, Sichtklasse
 *   docs/daten/auswahllisten.csv   erlaubte Werte je Auswahlliste
 *   docs/daten/startbelegung/*.csv Startzeilen der Stammdaten-Tabs und _Konfig
 * Wer das Datenmodell ändert, ändert die CSV und ruft danach  npm run schema  auf.
 * Die erzeugten Dateien nie von Hand bearbeiten.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const csv = require('./csv');

const WURZEL = path.join(__dirname, '..');
const DATEN = path.join(WURZEL, 'docs', 'daten');

/** Ein Tab je Block, eine Spalte je Zeile – gut lesbar in Diffs. */
function kompakt(tabellen) {
  return '{\n' + Object.keys(tabellen).map(name => {
    const t = tabellen[name];
    return '    ' + JSON.stringify(name) + ': {\n' +
      '      gruppe: ' + JSON.stringify(t.gruppe) + ', idSpalte: ' + JSON.stringify(t.idSpalte) +
      ', eindeutig: ' + JSON.stringify(t.eindeutig) + ',\n' +
      '      spalten: [\n' + t.spalten.map(s => '        ' + JSON.stringify(s)).join(',\n') + '\n      ]\n    }';
  }).join(',\n') + '\n  }';
}

function erzeugeSchema() {
  const tabellen = csv.leseObjekte(path.join(DATEN, 'tabellen.csv'));
  const felder = csv.leseObjekte(path.join(DATEN, 'feldkatalog.csv'));
  const listen = csv.leseObjekte(path.join(DATEN, 'auswahllisten.csv'));

  const TABELLEN = {};
  tabellen.forEach(t => {
    TABELLEN[t.tabelle] = {
      gruppe: t.gruppe,
      idSpalte: t.id_spalte || null,
      eindeutig: t.eindeutig ? t.eindeutig.split(' ').map(e => e.split('+')) : [],
      spalten: []
    };
  });
  felder.forEach(f => {
    const t = TABELLEN[f.tabelle];
    if (!t) throw new Error('Feldkatalog nennt unbekannten Tab: ' + f.tabelle);
    t.spalten.push({
      name: f.spalte, typ: f.typ, pflicht: f.pflicht,
      liste: f.auswahlliste || null, sicht: f.sichtklasse
    });
  });
  const LISTEN = {};
  listen.forEach(l => { (LISTEN[l.liste] = LISTEN[l.liste] || []).push(l.wert); });

  const startDir = path.join(DATEN, 'startbelegung');
  const START = {};
  fs.readdirSync(startDir).filter(d => d.endsWith('.csv')).sort().forEach(d => {
    START[d.replace(/\.csv$/, '')] = csv.leseTabelle(path.join(startDir, d));
  });

  const kopf = (zweck) => `/**
 * ${zweck}
 *
 * ERZEUGTE DATEI – nicht von Hand ändern. Quelle: docs/daten/*.csv, Erzeugung: npm run schema
 * (tools/schema-erzeugen.js). Läuft unverändert in Apps Script und in Node (Tests).
 */
`;
  const schema = kopf('Datenmodell: alle Tabs mit Spalten, Typen, Pflichtangaben, Auswahllisten und\n * Sichtklassen (intern / kontakt / finanz / hochsensibel / verwaltung). Grundlage für Setup,\n * Datenzugriff und Rollenfilter.') +
`var Schema = (function () {
  var TABELLEN = ${kompakt(TABELLEN)};
  var LISTEN = {
${Object.keys(LISTEN).map(k => '    ' + JSON.stringify(k) + ': ' + JSON.stringify(LISTEN[k])).join(',\n')}
  };
  return { TABELLEN: TABELLEN, LISTEN: LISTEN };
})();
`;
  const start = kopf('Startbelegung der Stammdaten-Tabs und von _Konfig (Beträge und Stufen sind BEISPIELE,\n * vor dem Echtbetrieb prüfen). Wird nur vom Setup verwendet und nur in leere Tabs geschrieben.\n * Datumswerte stehen als JJJJ-MM-TT.') +
`var Startbelegung = {
${Object.keys(START).map(k => '  ' + JSON.stringify(k) + ': {\n    kopf: ' + JSON.stringify(START[k].kopf) +
  ',\n    zeilen: [\n' + START[k].zeilen.map(z => '      ' + JSON.stringify(z)).join(',\n') + '\n    ]\n  }').join(',\n')}
};
`;
  fs.writeFileSync(path.join(WURZEL, 'src', 'lib', 'schema.js'), schema);
  fs.writeFileSync(path.join(WURZEL, 'src', 'lib', 'startbelegung.js'), start);
  console.log('src/lib/schema.js und src/lib/startbelegung.js erzeugt (' + Object.keys(TABELLEN).length + ' Tabs).');
}

erzeugeSchema();
