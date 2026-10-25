#!/usr/bin/env node
/**
 * npm run check – Prüfung vor jedem clasp push.
 *
 *  1. Syntax jeder .js-Datei unter src/ (Node vm.Script).
 *  2. Alle Server-Dateien GEMEINSAM in einem Kontext ausführen – wie in Apps Script, wo alle Dateien
 *     einen globalen Namensraum teilen. Findet doppelte Top-Level-Namen und Dienstaufrufe auf
 *     oberster Ebene (die in Apps Script von der Ladereihenfolge abhängen würden).
 *  3. <script>-Blöcke der HTML-Dateien unter src/client/ auf Syntax prüfen.
 *  4. Kopfkommentar in jeder Code-Datei (Sicherheitsregel C7).
 *  5. appsscript.json: gültiges JSON, nur erlaubte OAuth-Scopes (Sicherheitsregel A5).
 *  6. Getrenntes Backup-Projekt backup/: Syntax, Kopfkommentar, eigene Scope-Liste, KEINE Web-App.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const ERLAUBTE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/script.scriptapp'
];

const fehler = [];

function dateien(dir, endung) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return dateien(p, endung);
    return p.endsWith(endung) ? [p] : [];
  }).sort();
}
const rel = p => path.relative(path.join(__dirname, '..'), p);

// 1 + 4
const js = dateien(SRC, '.js');
js.forEach(p => {
  const code = fs.readFileSync(p, 'utf8');
  try { new vm.Script(code, { filename: rel(p) }); } catch (e) { fehler.push(rel(p) + ': ' + e.message); }
  if (!/^\s*\/\*\*/.test(code)) fehler.push(rel(p) + ': Kopfkommentar /** … */ fehlt (C7)');
});

// 2
if (!fehler.length) {
  const ctx = vm.createContext({ console });
  js.forEach(p => {
    try { new vm.Script(fs.readFileSync(p, 'utf8'), { filename: rel(p) }).runInContext(ctx); }
    catch (e) { fehler.push(rel(p) + ' (gemeinsamer Kontext): ' + e.message); }
  });
}

// 3 + 4
dateien(SRC, '.html').forEach(p => {
  const html = fs.readFileSync(p, 'utf8');
  if (!/^\s*<!--/.test(html)) fehler.push(rel(p) + ': Kopfkommentar <!-- … --> fehlt (C7)');
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m, nr = 0;
  while ((m = re.exec(html))) {
    nr++;
    const attr = m[1] || '';
    if (/\bsrc=/.test(attr)) { fehler.push(rel(p) + ': externes <script src> verboten (B8)'); continue; }
    if (/type=["'](?!text\/javascript|module)/.test(attr)) continue; // z. B. application/json
    if (/<\?/.test(m[2])) { fehler.push(rel(p) + ' Skript ' + nr + ': Scriptlets <? ?> in <script> nicht erlaubt – Daten über <script type="application/json"> übergeben'); continue; }
    try { new vm.Script(m[2], { filename: rel(p) + '#script' + nr }); }
    catch (e) { fehler.push(rel(p) + ' Skript ' + nr + ': ' + e.message); }
  }
  if (/https?:\/\/(fonts\.googleapis|cdn|unpkg|ajax\.googleapis)/i.test(html)) fehler.push(rel(p) + ': externe Ressource (B8)');
});

// 5
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'));
  (manifest.oauthScopes || []).forEach(s => {
    if (!ERLAUBTE_SCOPES.includes(s)) fehler.push('appsscript.json: nicht freigegebener Scope ' + s + ' (A5)');
  });
  if (!manifest.oauthScopes) fehler.push('appsscript.json: oauthScopes fehlen – Scopes immer explizit angeben (A5)');
  if (manifest.webapp && manifest.webapp.executeAs !== 'USER_DEPLOYING') fehler.push('appsscript.json: webapp.executeAs muss USER_DEPLOYING sein (A1)');
  if (manifest.webapp && manifest.webapp.access !== 'DOMAIN') fehler.push('appsscript.json: webapp.access muss DOMAIN sein (A1)');
} catch (e) { fehler.push('appsscript.json: ' + e.message); }

// 6 – Backup-Projekt (eigenes Apps-Script-Projekt mit Drive-Scope; wird nie in src/ gepusht)
const BACKUP = path.join(__dirname, '..', 'backup');
const BACKUP_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/script.send_mail'
];
if (fs.existsSync(BACKUP)) {
  const bjs = dateien(BACKUP, '.js');
  const bctx = vm.createContext({ console });
  bjs.forEach(p => {
    const code = fs.readFileSync(p, 'utf8');
    if (!/^\s*\/\*\*/.test(code)) fehler.push(rel(p) + ': Kopfkommentar /** … */ fehlt (C7)');
    try { new vm.Script(code, { filename: rel(p) }).runInContext(bctx); } catch (e) { fehler.push(rel(p) + ': ' + e.message); }
  });
  try {
    const bm = JSON.parse(fs.readFileSync(path.join(BACKUP, 'appsscript.json'), 'utf8'));
    (bm.oauthScopes || []).forEach(s => { if (!BACKUP_SCOPES.includes(s)) fehler.push('backup/appsscript.json: nicht freigegebener Scope ' + s); });
    if (!bm.oauthScopes) fehler.push('backup/appsscript.json: oauthScopes fehlen');
    if (bm.webapp) fehler.push('backup/appsscript.json: das Backup-Projekt darf keine Web-App sein');
  } catch (e) { fehler.push('backup/appsscript.json: ' + e.message); }
}

if (fehler.length) {
  console.error('npm run check: ' + fehler.length + ' Fehler\n  ' + fehler.join('\n  '));
  process.exit(1);
}
console.log('npm run check: ' + js.length + ' JS-Dateien und HTML-Skripte in Ordnung.');
