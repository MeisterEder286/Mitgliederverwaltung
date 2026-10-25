/**
 * Oberflächentest Ehrungen: Liste laden, Jahr wechseln, übernehmen, verleihen (Dialog), Export; Rollen ohne Recht
 * sehen den Menüpunkt nicht. Läuft mit npm run test:ui.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

test('Ehrungen: übernehmen und verleihen als Mitgliederverwalter', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  const p = ui.page;
  try {
    await p.getByRole('button', { name: 'Ehrungen', exact: true }).click();
    await p.waitForSelector('table');
    // Jahr 2027 hat neu fällige Einträge (2026 hat der Generator schon angelegt)
    await p.selectOption('select.ehr-jahr', '2027');
    await p.getByRole('button', { name: /Liste übernehmen/ }).click();
    await p.waitForSelector('.meldung.ok');
    const fae = ui.objekte('Ehrung').filter(e => Number(e.faellig_jahr) === 2027);
    assert.ok(fae.length > 0, 'Ehrungen 2027 angelegt');
    // erste Zeile öffnen → verleihen
    await p.locator('tbody tr').first().click();
    await p.getByRole('button', { name: 'Verleihen …', exact: true }).click();
    await p.locator('dialog input').nth(1).fill('JHV 2028');
    await p.getByRole('button', { name: 'Speichern' }).click();
    await p.waitForSelector('.meldung.ok');
    assert.ok(ui.objekte('Ehrung').some(e => e.status === 'verliehen' && e.veranstaltung === 'JHV 2028'));
    // Sammelverleihung: zwei markieren
    const boxen = p.locator('input.ehr-auswahl');
    await boxen.nth(0).check(); await boxen.nth(1).check();
    await p.getByRole('button', { name: 'Markierte verleihen …' }).click();
    await p.locator('dialog input').nth(1).fill('Weihnachtsfeier');
    await p.getByRole('button', { name: 'Speichern' }).click();
    await p.waitForSelector('.meldung.ok');
    assert.strictEqual(ui.objekte('Ehrung').filter(e => e.veranstaltung === 'Weihnachtsfeier').length, 2);
    // Export CSV
    await p.getByRole('button', { name: 'CSV', exact: true }).click();
    await p.waitForTimeout(500);
    assert.ok(ui.downloads.some(d => /Ehrungen_2027\.csv/.test(d.name)));
    assert.ok(ui.objekte('_Protokoll').some(x => x.aktion === 'exportiert' && x.tabelle === 'Ehrung'));
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Ehrungen: Kassier und Abteilungsleiter sehen den Menüpunkt nicht', async () => {
  for (const rolle of ['Kassier', 'Abteilungsleiter']) {
    const ui = await starteOberflaeche({ rolle });
    try {
      const nav = await ui.page.$$eval('#navigation button', b => b.map(x => x.textContent));
      assert.ok(!nav.includes('Ehrungen'), rolle);
    } finally { await ui.schliessen(); }
  }
});
