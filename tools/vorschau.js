#!/usr/bin/env node
/**
 * Lokale Vorschau der Oberfläche ohne Google: setzt client/index.html mit den include_-Dateien zusammen,
 * bettet Beispiel-Startdaten ein und ersetzt google.script.run durch einen Stub mit Beispielantworten.
 *
 *   node tools/vorschau.js [rolle] [ziel.html]     rolle: Mitgliederverwalter (Standard) | Abteilungsleiter | …
 *
 * Nur für Entwicklung und Mobil-Sichtprüfung. Die echte Auslieferung macht doGet in src/Einstieg.js.
 * Die Startdaten werden mit den echten Server-Modulen gegen die Test-Fakes erzeugt (synthetische Daten).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ladeProjekt } = require('../test/hilfe/projekt');
const { erzeugeFakes } = require('../test/hilfe/gas-fakes');

const rolle = process.argv[2] || 'Mitgliederverwalter';
const ziel = process.argv[3] || path.join(__dirname, '..', 'vorschau.html');
const SRC = path.join(__dirname, '..', 'src');
const EIG = 'verwaltung@tsv-ergoldsbach.de';
const NUTZER = 'nutzer@tsv-ergoldsbach.de';

// 1. Datenbank einrichten (wie setup) und Benutzer eintragen
const e = erzeugeFakes({ tabs: {}, email: EIG, eigentuemer: EIG });
ladeProjekt(e.globale).setup();
const tabs = {};
e.datei.getSheets().forEach(b => { tabs[b.getName()] = e.daten(b.getName()).map(z => z.slice()); });
const kopf = tabs.Benutzer[0];
tabs.Benutzer.push(kopf.map(k => ({ benutzer_id: 1, email: NUTZER, name: 'Vorschau ' + rolle, rolle,
  abteilung_id: rolle === 'Abteilungsleiter' ? 1 : '', aktiv: 'ja' })[k] ?? ''));

// 2. Startdaten mit den echten Modulen erzeugen
const f = erzeugeFakes({ tabs, email: NUTZER, eigentuemer: EIG });
const g = ladeProjekt(f.globale);
const start = g.apiStart();
if (!start.ok) throw new Error('apiStart: ' + JSON.stringify(start.fehler));
g.apiPing(); g.apiPing();
const messungen = g.apiMessungen();

// 3. Template zusammensetzen
const lies = n => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
let html = lies('client/index')
  .replace(/<\?!= include_\('([^']+)'\) \?>/g, (_, n) => lies(n))
  .replace('<?!= startdatenJson ?>', JSON.stringify(start.daten).replace(/</g, '\\u003c'));
const stub = `<script>
window.google = { script: { run: (function () {
  var antworten = { apiStart: ${JSON.stringify(start)}, apiPing: { ok: true, daten: { pong: true }, messung: { server_ms: 3, sheets: 0 } },
    apiMessungen: ${JSON.stringify(messungen)}, apiClientMessungen: { ok: true, daten: true, messung: { server_ms: 1, sheets: 0 } } };
  function läufer(ok, fehl) {
    return new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (h) { return läufer(h, fehl); };
      if (name === 'withFailureHandler') return function (h) { return läufer(ok, h); };
      return function () { setTimeout(function () { ok && ok(antworten[name] || { ok: false, fehler: { art: 'intern', meldung: 'Vorschau: ' + name } }); }, 300); };
    } });
  }
  return läufer();
})() } };
</script>`;
html = html.replace('<head>', '<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' + stub);
fs.writeFileSync(ziel, html);
console.log('Vorschau geschrieben: ' + ziel);
