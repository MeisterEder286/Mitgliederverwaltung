#!/usr/bin/env node
/**
 * npm test / npm run test:ui – startet den Node-Testrunner mit ausdrücklichen Dateipfaden.
 *
 *   node tools/tests.js       Unit-Tests: test/*.test.js (nicht rekursiv)
 *   node tools/tests.js ui    Oberflächentests: test/ui/*.ui.test.js, nacheinander (--test-concurrency=1)
 *
 * Grund: Glob-Muster wie "test/*.test.js" wertet `node --test` erst ab Node 21 selbst aus; package.json
 * verlangt aber nur Node >= 20. Ohne Abhängigkeiten; Ausgabe und Exit-Code werden durchgereicht.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ui = process.argv[2] === 'ui';
const ordner = path.join(__dirname, '..', 'test', ui ? 'ui' : '');
const endung = ui ? '.ui.test.js' : '.test.js';
const dateien = fs.readdirSync(ordner)
  .filter(n => n.endsWith(endung) && fs.statSync(path.join(ordner, n)).isFile())
  .sort()
  .map(n => path.join(ordner, n));
if (!dateien.length) { console.error('Keine Testdateien in ' + ordner); process.exit(1); }

const argumente = ['--test'].concat(ui ? ['--test-concurrency=1'] : [], dateien);
const r = spawnSync(process.execPath, argumente, { stdio: 'inherit' });
if (r.error) { console.error(r.error.message); process.exit(1); }
process.exit(r.status === null ? 1 : r.status);
