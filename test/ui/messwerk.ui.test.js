/**
 * Oberflächentest Messwerk: App.messen(true) leitet Aufrufe über apiMessen, App.messzeilen() listet Browserzeit,
 * Serverzeit und Differenz je Aufruf; ohne messung_lesen gibt es keinen Server-Bericht. Läuft mit npm run test:ui.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

test('Messmodus: Bericht je Aufruf mit Browser-, Serverzeit und Differenz; Ansicht zeigt Tabelle', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    const zeilen = await ui.page.evaluate(() => {
      App.messen(true);
      return App.rufe('apiPing').then(() => App.rufe('apiSnapshot', ['historie'])).then(() => App.messzeilen());
    });
    assert.deepStrictEqual(zeilen.map(z => z.funktion), ['apiPing', 'apiSnapshot']);
    zeilen.forEach(z => {
      assert.strictEqual(typeof z.server_ms, 'number');
      assert.strictEqual(z.differenz_ms, z.browser_ms - z.server_ms);
    });
    assert.ok(zeilen[1].lesungen >= 0 && typeof zeilen[1].pruefkette === 'number');
    assert.ok(ui.aufrufe.includes('apiMessen'));
    await ui.page.evaluate(() => App.zeige('messwerte'));
    await ui.page.getByText('Messmodus (Einzelaufrufe)').waitFor();
    assert.ok(await ui.page.getByRole('button', { name: 'Messmodus aus' }).isVisible());
    assert.strictEqual(await ui.page.evaluate(() => App.messen(false)), false);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Messmodus ohne messung_lesen: Aufrufe funktionieren, aber kein Server-Bericht', async () => {
  const ui = await starteOberflaeche({ rolle: 'Abteilungsleiter' });
  try {
    const r = await ui.page.evaluate(() => { App.messen(true); return App.rufe('apiPing').then(d => ({ d, z: App.messzeilen() })); });
    assert.strictEqual(r.d.pong, true);
    assert.strictEqual(r.z.length, 0);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});
