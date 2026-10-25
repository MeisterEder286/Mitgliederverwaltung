/**
 * Oberflächentest Start: Seite lädt je Rolle ohne JavaScript-Fehler, Navigation passt zur Rolle,
 * Bereiche werden nachgeladen. Läuft mit npm run test:ui (Chromium).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

for (const rolle of ['Vorstand', 'Mitgliederverwalter', 'Kassier', 'Abteilungsleiter', 'Jugendleiter']) {
  test('Start als ' + rolle + ': ohne Fehler, kein waagrechtes Scrollen bei 360 px', async () => {
    const ui = await starteOberflaeche({ rolle });
    try {
      const nav = await ui.page.$$eval('#navigation button', b => b.map(x => x.textContent));
      assert.ok(nav.includes('Start'));
      const breite = await ui.page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(breite <= 360, 'waagrechtes Scrollen: ' + breite);
      const bereiche = await ui.page.evaluate(() => App.daten.lade('finanzen', 'historie').then(() => App.daten.bereiche));
      assert.ok(bereiche.includes('historie'));
      assert.deepStrictEqual(ui.fehler, []);
    } finally { await ui.schliessen(); }
  });
}
