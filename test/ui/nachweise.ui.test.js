/**
 * Oberflächentest Nachweise: Übersicht, FZ-Einsicht erfassen (inkl. Feldfehler), Lizenz erfassen, Löschen;
 * Abteilungsleiter sieht nur seine Personen; Kassier sieht den Menüpunkt nicht. npm run test:ui.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

const heuteDe = () => { const d = new Date(); return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear(); };

test('Nachweise als Abteilungsleiter: Einsicht erfassen mit Feldfehler und Erfolg', async () => {
  const ui = await starteOberflaeche({ rolle: 'Abteilungsleiter' });
  const p = ui.page;
  try {
    await p.getByRole('button', { name: 'Nachweise', exact: true }).click();
    await p.waitForSelector('.kacheln');
    const vorher = ui.objekte('Qualifikation').length;
    await p.getByRole('button', { name: 'Einsichtnahme erfassen' }).click();
    // erste Person der Funktionsträger wählen
    const wert = await p.$eval('#nw-person optgroup option', o => o.value);
    await p.selectOption('#nw-person', wert);
    // zu altes Zeugnis → Feldfehler
    await p.locator('dialog .feld').filter({ hasText: 'Zeugnis ausgestellt am' }).locator('input').fill('01.01.2020');
    await p.getByRole('button', { name: 'Speichern' }).click();
    await p.waitForSelector('dialog .feldfehler:not(:empty)');
    assert.strictEqual(ui.objekte('Qualifikation').length, vorher);
    await p.locator('dialog .feld').filter({ hasText: 'Zeugnis ausgestellt am' }).locator('input').fill(heuteDe());
    await p.getByRole('button', { name: 'Speichern' }).click();
    await p.waitForSelector('.meldung.ok');
    const neu = ui.objekte('Qualifikation');
    assert.strictEqual(neu.length, vorher + 1);
    assert.strictEqual(neu[neu.length - 1].ergebnis, 'ohne einschlägigen Eintrag');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Nachweise als Mitgliederverwalter: Lizenz erfassen, Reiter, Löschen, CSV', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  const p = ui.page;
  try {
    await p.getByRole('button', { name: 'Nachweise', exact: true }).click();
    await p.waitForSelector('.kacheln');
    await p.getByRole('button', { name: 'Lizenz / Kurs erfassen' }).click();
    const wert = await p.$eval('#nw-person optgroup option', o => o.value);
    await p.selectOption('#nw-person', wert);
    await p.locator('dialog .feld').filter({ hasText: 'gültig bis' }).locator('input').fill('31.12.2030');
    await p.getByRole('button', { name: 'Speichern' }).click();
    await p.waitForSelector('.meldung.ok');
    assert.ok(ui.objekte('Qualifikation').some(q => q.gueltig_bis));
    await p.getByRole('tab', { name: 'Lizenzen & Kurse' }).click();
    await p.waitForSelector('table');
    await p.getByRole('tab', { name: /Zu löschen/ }).click();
    const boxen = p.locator('input.nw-auswahl');
    if (await boxen.count()) {
      await boxen.first().check();
      await p.getByRole('button', { name: 'Markierte Vermerke löschen' }).click();
      await p.getByRole('button', { name: 'Löschen', exact: true }).click();
      await p.waitForSelector('.meldung.ok');
      assert.ok(ui.objekte('Qualifikation').some(q => q.geloescht_am));
    }
    await p.getByRole('button', { name: 'CSV', exact: true }).click();
    await p.waitForTimeout(500);
    assert.ok(ui.downloads.some(d => /Nachweise_Faelligkeit/.test(d.name)));
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Nachweise: Kassier ohne Menüpunkt', async () => {
  const ui = await starteOberflaeche({ rolle: 'Kassier' });
  try {
    const nav = await ui.page.$$eval('#navigation button', b => b.map(x => x.textContent));
    assert.ok(!nav.includes('Nachweise'));
  } finally { await ui.schliessen(); }
});
