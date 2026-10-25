/**
 * Setzt die Oberfläche (src/client/index.html mit allen include_-Dateien) zu einer eigenständigen HTML-Seite
 * zusammen – wie doGet es in Apps Script tut. Genutzt von tools/vorschau.js und den Oberflächentests (test/ui).
 *
 *   baueSeite(startdaten, stubSkript) → HTML-Text
 *     startdaten  wird wie bei _Konfig.snapshot_einbetten = ja in <script type="application/json"> eingebettet
 *     stubSkript  <script>…</script>, das window.google.script.run bereitstellt (läuft vor allen anderen Skripten)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const lies = n => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');

/** JSON gefahrlos in <script type="application/json"> (wie JsonEinbetten_ in src/Einstieg.js). */
function jsonEinbetten(x) {
  return JSON.stringify(x).replace(/</g, '\\u003c')
    .replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');
}

function baueSeite(startdaten, stubSkript) {
  const html = lies('client/index')
    .replace(/<\?!= include_\('([^']+)'\) \?>/g, (_, n) => lies(n))
    .replace('<?!= startdatenJson ?>', startdaten ? jsonEinbetten(startdaten) : '');
  return html.replace('<head>', '<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' + (stubSkript || ''));
}

module.exports = { baueSeite, jsonEinbetten };
