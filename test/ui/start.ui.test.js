/**
 * Oberflächentest Start: Seite lädt je Rolle ohne JavaScript-Fehler, Navigation passt zur Rolle,
 * Bereiche werden nachgeladen. Läuft mit npm run test:ui (Chromium).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

test('Nachlauf: nach einem Schreibaufruf stößt der Browser still apiNachlauf an', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    await ui.page.evaluate(() => App.rufe('apiMitgliedAnlegen', { mitglied: { vorname: 'Nach', nachname: 'Lauf' }, eintrittsdatum: '2026-10-01' }));
    const bis = Date.now() + 5000;
    while (!ui.aufrufe.includes('apiNachlauf') && Date.now() < bis) await new Promise(r => setTimeout(r, 100));
    assert.ok(ui.aufrufe.includes('apiNachlauf'), 'apiNachlauf nicht aufgerufen: ' + ui.aufrufe.join(', '));
    assert.strictEqual(ui.aufrufe.filter(a => a === 'apiNachlauf').length, 1);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Vorladen: Historie (und für Finanzrollen Schriftverkehr) kommt nach dem Start still im Hintergrund', async () => {
  for (const [rolle, erwartet] of [['Kassier', ['historie', 'korrespondenz']], ['Abteilungsleiter', ['historie']]]) {
    const ui = await starteOberflaeche({ rolle });
    try {
      await ui.page.waitForFunction(e => e.every(b => App.daten.bereiche.includes(b)), erwartet, { timeout: 10000 });
      const bereiche = await ui.page.evaluate(() => App.daten.bereiche);
      if (!erwartet.includes('korrespondenz')) assert.ok(!bereiche.includes('korrespondenz'), rolle + ': Schriftverkehr vorgeladen');
      assert.deepStrictEqual(ui.fehler, []);
    } finally { await ui.schliessen(); }
  }
});

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
