/**
 * Tests für das getrennte Backup-Projekt (backup/Backup.js): Aufbewahrungsregel, Dateinamen, Freigabeprüfung,
 * Wiederherstellungsvergleich und der Ablauf von backupErstellen mit kleinen Drive-Fakes.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function lade(globale) {
  const ctx = vm.createContext(Object.assign({ console: { log() {}, error() {} } }, globale || {}));
  new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'backup', 'Backup.js'), 'utf8'), { filename: 'Backup.js' }).runInContext(ctx);
  return ctx;
}
const P = lade().BackupPlan;
const name = (j, m, t, h = 3, mi = 15) => P.dateiname({ jahr: j, monat: m, tag: t, stunde: h, minute: mi });

test('Dateiname und Rückweg', () => {
  assert.strictEqual(name(2026, 1, 5, 3, 7), 'Mitgliederverwaltung Backup 2026-01-05 03-07');
  assert.strictEqual(P.zeitAusName(name(2026, 1, 5)).monatSchluessel, '2026-01');
  assert.strictEqual(P.zeitAusName('Notizen.txt'), null);
});

test('Aufbewahrung: 90 Tage täglich, danach erste je Monat 13 Monate, fremde Dateien bleiben', () => {
  const dateien = [];
  // tägliche Sicherungen über ~20 Monate
  for (let d = new Date(Date.UTC(2025, 2, 1)); d <= new Date(Date.UTC(2026, 9, 25)); d.setUTCDate(d.getUTCDate() + 1)) {
    dateien.push({ id: d.toISOString().slice(0, 10), name: name(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) });
  }
  dateien.push({ id: 'fremd', name: 'Liste.xlsx' });
  const weg = new Set(P.zuLoeschen(dateien, { jahr: 2026, monat: 10, tag: 25 }, 90));
  assert.ok(!weg.has('fremd'));
  assert.ok(!weg.has('2026-10-24') && !weg.has('2026-08-01'), 'jüngste 90 Tage bleiben');
  assert.ok(weg.has('2026-07-15'), 'mitten im Monat außerhalb 90 Tage → weg');
  assert.ok(!weg.has('2026-07-01') && !weg.has('2025-10-01'), 'Monatssicherungen bis 13 Monate bleiben');
  assert.ok(!weg.has('2025-09-01'), 'genau 13 Monate zurück bleibt');
  assert.ok(weg.has('2025-03-01') && weg.has('2025-08-01'), 'Monatssicherungen älter als 13 Monate → weg');
  const bleiben = dateien.filter(d => !weg.has(d.id)).length;
  assert.ok(bleiben < 120, 'überschaubare Anzahl: ' + bleiben);
});

test('Freigabe zu offen, jüngstes Backup, Vergleich', () => {
  assert.strictEqual(P.freigabeZuOffen('ANYONE_WITH_LINK'), true);
  assert.strictEqual(P.freigabeZuOffen('PRIVATE'), false);
  assert.strictEqual(P.juengstes([{ id: 'a', name: name(2026, 1, 1) }, { id: 'b', name: name(2026, 2, 1) }]).id, 'b');
  const v = P.vergleiche({ Mitglied: 1201, _Konfig: 60 }, { Mitglied: 1199 });
  assert.strictEqual(v.ok, false);
  assert.deepStrictEqual(Array.from(v.fehlend), ['_Konfig']);
});

function drive(access) {
  const dateien = [{ id: 'alt', name: name(2025, 3, 10), papierkorb: false }];
  const mails = [];
  const ordner = {
    getSharingAccess: () => access,
    getFiles() { const l = dateien.slice(); let i = 0; return { hasNext: () => i < l.length, next: () => { const d = l[i++]; return { getId: () => d.id, getName: () => d.name, setTrashed: v => { d.papierkorb = v; } }; } }; }
  };
  const globale = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => ({ DB_ID: 'db', BACKUP_ORDNER_ID: 'ordner' })[k] || null }) },
    DriveApp: {
      getFolderById: () => ordner,
      getFileById: () => ({ makeCopy: (n) => { dateien.push({ id: 'neu', name: n, papierkorb: false }); return { getId: () => 'neu' }; } })
    },
    Session: { getScriptTimeZone: () => 'Europe/Berlin', getEffectiveUser: () => ({ getEmail: () => 'verwaltung@tsv-ergoldsbach.de' }) },
    Utilities: { formatDate: (d, tz, m) => ({ yyyy: '2026', MM: '10', dd: '25', HH: '03', mm: '15' })[m] },
    MailApp: { sendEmail: (an, betreff) => mails.push([an, betreff]) }
  };
  return { dateien, mails, g: lade(globale) };
}

test('backupErstellen: Kopie anlegen, alte in den Papierkorb', () => {
  const d = drive('PRIVATE');
  const r = d.g.backupErstellen();
  assert.strictEqual(r.name, 'Mitgliederverwaltung Backup 2026-10-25 03-15');
  assert.ok(d.dateien.find(x => x.id === 'neu'));
  assert.strictEqual(d.dateien.find(x => x.id === 'alt').papierkorb, true);
  assert.strictEqual(d.mails.length, 0);
});

test('backupErstellen: zu offen freigegebener Ordner → Abbruch + Fehlermail ans Funktionskonto', () => {
  const d = drive('ANYONE_WITH_LINK');
  assert.throws(() => d.g.backupErstellen(), /zu offen/);
  assert.ok(!d.dateien.find(x => x.id === 'neu'), 'keine Kopie');
  assert.deepStrictEqual(d.mails.map(m => m[0]), ['verwaltung@tsv-ergoldsbach.de']);
});

test('Manifest des Backup-Projekts: kein Web-App-Abschnitt', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'backup', 'appsscript.json'), 'utf8'));
  assert.ok(!m.webapp);
  assert.ok(m.oauthScopes.includes('https://www.googleapis.com/auth/drive'));
});
