/**
 * Oberflächentest Dashboard: Kacheln und Abschnitte je Rolle, Jahreswechsel, Tabellen zu den Diagrammen,
 * kein waagrechtes Scrollen bei 360 px, Abteilungsleitung sieht die Ansicht gar nicht.
 * Läuft mit npm run test:ui.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

test('Dashboard als Mitgliederverwalter: alle Abschnitte, Jahr wechseln, 360 px ohne Querscrollen', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  const p = ui.page;
  try {
    await p.evaluate(() => App.zeige('dashboard'));
    await p.waitForSelector('h2:has-text("Mitgliederverlauf")');
    for (const t of ['Einnahmen', 'Ehrungen in den nächsten Jahren', 'Altersstruktur', 'Abteilungen', 'Austrittsgründe']) {
      assert.ok(await p.isVisible('h2:has-text("' + t + '")'), t);
    }
    assert.ok(await p.isVisible('.kachel-text:has-text("Mitglieder aktuell")'));
    assert.ok(await p.locator('svg.db-diagramm').count() >= 4);
    // Tabellen zu den Diagrammen sind aufklappbar und enthalten zwölf Monate
    await p.locator('summary:has-text("Zahlen als Tabelle")').click();
    assert.strictEqual(await p.locator('details[open] tbody tr').count(), 12);
    // Jahr wechseln → Überschrift passt, Kachel nennt „zum 31.12.“
    const vorjahr = await p.evaluate(() => Number(App.startdaten.heute.slice(0, 4)) - 1);
    await p.getByLabel('Jahr', { exact: true }).selectOption(String(vorjahr));
    await p.waitForSelector('h2:has-text("Mitgliederverlauf ' + vorjahr + '")');
    assert.ok(await p.isVisible('.kachel-text:has-text("zum 31.12.")'));
    const breite = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(breite <= 360, 'waagrechtes Scrollen ' + breite);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Dashboard als Kassier: Einnahmen ja, Ehrungen nein; Abteilungsleiter ohne Navigationspunkt', async () => {
  const kassier = await starteOberflaeche({ rolle: 'Kassier' });
  try {
    await kassier.page.evaluate(() => App.zeige('dashboard'));
    await kassier.page.waitForSelector('h2:has-text("Einnahmen")');
    assert.ok(!(await kassier.page.isVisible('h2:has-text("Ehrungen in den nächsten Jahren")')));
    assert.deepStrictEqual(kassier.fehler, []);
  } finally { await kassier.schliessen(); }
  const al = await starteOberflaeche({ rolle: 'Abteilungsleiter' });
  try {
    const nav = await al.page.$$eval('#navigation button', b => b.map(x => x.dataset.ansicht));
    assert.ok(!nav.includes('dashboard'));
  } finally { await al.schliessen(); }
});
