/**
 * Startet den PHP-Test des WordPress-Moduls (wordpress/tests/eingang-sender-test.php) mit Syntaxprüfung.
 * Fehlt php auf dem Rechner, wird der Test mit Hinweis übersprungen (wie die XSD-Prüfung ohne xmllint).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const WURZEL = path.join(__dirname, '..');
const php = spawnSync('php', ['-v'], { encoding: 'utf8' });

test('WordPress-Modul eingang-sender.php: Syntax und Ablauf (php)', (t) => {
  if (php.status !== 0) { t.skip('php nicht installiert'); return; }
  for (const datei of ['wordpress/inc/eingang-sender.php', 'wordpress/tests/eingang-sender-test.php']) {
    const l = spawnSync('php', ['-l', path.join(WURZEL, datei)], { encoding: 'utf8' });
    assert.strictEqual(l.status, 0, datei + ': ' + l.stdout + l.stderr);
  }
  const r = spawnSync('php', [path.join(WURZEL, 'wordpress', 'tests', 'eingang-sender-test.php')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /alle Prüfungen ok/);
});
