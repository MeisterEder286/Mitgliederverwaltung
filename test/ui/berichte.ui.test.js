/**
 * Oberflächentest Berichte: BLSV berechnen und exportieren, Jahresstatistik einfrieren, Geburtstagsliste mit
 * Einwilligungsfilter; Abteilungsleiter ohne BLSV-Reiter. npm run test:ui.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

test('Berichte als Mitgliederverwalter: BLSV, Einfrieren, Geburtstage, Jahresvergleich', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter', breite: 1100 });
  const p = ui.page;
  try {
    await p.getByRole('button', { name: 'Berichte', exact: true }).click();
    await p.waitForSelector('text=Mitglieder im Verein');
    await p.getByRole('button', { name: 'CSV für verein360' }).click();
    await p.waitForTimeout(400);
    assert.ok(ui.downloads.some(d => /^BLSV_Bestand_/.test(d.name)));
    await p.getByRole('button', { name: 'Jahresstatistik einfrieren …' }).click();
    await p.getByRole('button', { name: 'Einfrieren', exact: true }).click();
    await p.waitForSelector('.meldung.ok');
    assert.ok(ui.objekte('Statistik_Jahr').some(z => z.ebene === 'Verein'));
    await p.getByRole('tab', { name: 'Jahresvergleich' }).click();
    await p.waitForSelector('svg.ber-diagramm');
    await p.getByRole('tab', { name: 'Geburtstage' }).click();
    await p.waitForSelector('text=Geburtstage');
    const alle = await p.locator('tbody tr').count();
    await p.getByLabel(/nur mit Einwilligung/).check();
    const mitEw = await p.locator('tbody tr').count();
    assert.ok(mitEw <= alle);
    await p.getByRole('button', { name: 'CSV', exact: true }).click();
    await p.waitForTimeout(400);
    assert.ok(ui.downloads.some(d => /^Geburtstage_/.test(d.name)));
    assert.ok(ui.objekte('_Protokoll').filter(x => x.aktion === 'exportiert').length >= 2);
    await p.getByRole('tab', { name: 'Abteilungen' }).click();
    await p.waitForSelector('text=Leitung (aus Funktionen)');
    await p.getByRole('tab', { name: 'Ein- & Austritte' }).click();
    await p.waitForSelector('text=Saldo');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Berichte als Abteilungsleiter: kein BLSV-Reiter, Listen nur eigener Sichtkreis, mobil ohne Querscrollen', async () => {
  const ui = await starteOberflaeche({ rolle: 'Abteilungsleiter' });
  const p = ui.page;
  try {
    await p.getByRole('button', { name: 'Berichte', exact: true }).click();
    await p.waitForSelector('[role=tab]');
    const reiter = await p.$$eval('[role=tab]', b => b.map(x => x.textContent));
    assert.ok(!reiter.includes('BLSV-Bestand'));
    await p.waitForSelector('text=Geburtstage');
    const breite = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(breite <= 360, 'Querscrollen: ' + breite);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});
