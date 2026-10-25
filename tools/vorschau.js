#!/usr/bin/env node
/**
 * Lokale Vorschau der Oberfläche ohne Google: setzt client/index.html mit den include_-Dateien zusammen,
 * bettet Startdaten ein und ersetzt google.script.run durch einen Stub mit vorab berechneten Antworten.
 *
 *   node tools/vorschau.js [rolle] [ziel.html] [--gross]
 *     rolle    Mitgliederverwalter (Standard) | Vorstand | Kassier | Abteilungsleiter | Jugendleiter
 *     --gross  synthetischer Verein mit ~1.200 Mitgliedern (test/daten/generator.js) statt leerer Datenbank
 *
 * Nur für Entwicklung und Mobil-Sichtprüfung. Die echte Auslieferung macht doGet in src/Einstieg.js.
 * Die Startdaten werden mit den ECHTEN Server-Modulen gegen die Test-Fakes erzeugt (synthetische Daten).
 * Im Browser sind nur apiStart, apiSnapshot, apiPing, apiMessungen und apiClientMessungen beantwortbar;
 * jeder andere Aufruf liefert die freundliche Meldung „Vorschau: nicht verfügbar“ (keine Schreibzugriffe).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ladeProjekt } = require('../test/hilfe/projekt');
const { erzeugeFakes } = require('../test/hilfe/gas-fakes');

const argumente = process.argv.slice(2);
const gross = argumente.includes('--gross');
const positionen = argumente.filter(a => a !== '--gross');
const rolle = positionen[0] || 'Mitgliederverwalter';
const ziel = positionen[1] || path.join(__dirname, '..', 'vorschau.html');
const SRC = path.join(__dirname, '..', 'src');
const EIG = 'verwaltung@tsv-ergoldsbach.de';

let tabs, nutzer;
if (gross) {
  // 1a. Synthetischer Verein; Benutzer = erster Eintrag mit der gewünschten Rolle
  const { erzeugeVerein } = require('../test/daten/generator');
  tabs = erzeugeVerein({ seed: 1 }).tabs;
  const kopf = tabs.Benutzer[0];
  const zeile = tabs.Benutzer.slice(1).find(z => z[kopf.indexOf('rolle')] === rolle);
  if (!zeile) throw new Error('Keine Rolle ' + rolle + ' im synthetischen Verein');
  nutzer = zeile[kopf.indexOf('email')];
} else {
  // 1b. Leere Datenbank einrichten (wie setup) und einen Benutzer eintragen
  nutzer = 'nutzer@tsv-ergoldsbach.de';
  const e = erzeugeFakes({ tabs: {}, email: EIG, eigentuemer: EIG });
  ladeProjekt(e.globale).setup();
  tabs = {};
  e.datei.getSheets().forEach(b => { tabs[b.getName()] = e.daten(b.getName()).map(z => z.slice()); });
  const kopf = tabs.Benutzer[0];
  tabs.Benutzer.push(kopf.map(k => ({ benutzer_id: 1, email: nutzer, name: 'Vorschau ' + rolle, rolle,
    abteilung_id: rolle === 'Abteilungsleiter' ? 1 : '', aktiv: 'ja' })[k] ?? ''));
}

// 2. Antworten mit den echten Modulen erzeugen
const f = erzeugeFakes({ tabs, email: nutzer, eigentuemer: EIG });
const g = ladeProjekt(f.globale);
const start = g.apiStart();
if (!start.ok) throw new Error('apiStart: ' + JSON.stringify(start.fehler));
const antworten = {
  apiStart: start,
  apiPing: g.apiPing(),
  apiClientMessungen: { ok: true, daten: true, messung: { server_ms: 1, sheets: 0 } }
};
if (typeof g.apiSnapshot === 'function') antworten.apiSnapshot = g.apiSnapshot();
g.apiPing();
antworten.apiMessungen = g.apiMessungen();

// 3. Template zusammensetzen
const lies = n => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
const json = x => JSON.stringify(x).replace(/</g, '\\u003c').replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');
let html = lies('client/index')
  .replace(/<\?!= include_\('([^']+)'\) \?>/g, (_, n) => lies(n))
  .replace('<?!= startdatenJson ?>', json(start.daten));
const stub = `<script>
window.google = { script: { run: (function () {
  var antworten = ${json(antworten)};
  function antwort(name) {
    return antworten[name] || { ok: false, fehler: { art: 'fachlich', meldung: 'Vorschau: „' + name + '“ ist hier nicht verfügbar (keine Verbindung zu Google).' }, messung: { server_ms: 0, sheets: 0 } };
  }
  function laeufer(ok, fehl) {
    return new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (h) { return laeufer(h, fehl); };
      if (name === 'withFailureHandler') return function (h) { return laeufer(ok, h); };
      return function () { setTimeout(function () { if (ok) ok(antwort(name)); }, 250); };
    } });
  }
  return laeufer();
})() } };
</script>`;
html = html.replace('<head>', '<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' + stub);
fs.writeFileSync(ziel, html);
console.log('Vorschau geschrieben: ' + ziel + (gross ? ' (synthetischer Verein, Benutzer ' + nutzer + ')' : ''));
