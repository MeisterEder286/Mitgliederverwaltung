/**
 * Oberflächen-Rundgang: Jede Rolle öffnet jede Ansicht ihrer Navigation (inkl. aller Reiter) und je eine
 * Detailansicht (Mitglied, bei Finanzsicht auch Beitragskonto) – bei 360 px Breite (Handy).
 * Geprüft wird: keine JavaScript-Fehler, kein waagrechtes Scrollen der Seite, genau eine Hauptüberschrift (h1)
 * je Ansicht und keine technischen Datumsangaben (JJJJ-MM-TT) im sichtbaren Text.
 * Läuft mit npm run test:ui (Chromium, synthetische Daten).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

async function pruefe(p, name, maengel) {
  const m = await p.evaluate(() => {
    const inhalt = document.getElementById('inhalt');
    const iso = (inhalt.innerText.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []).slice(0, 3);
    return { breite: document.documentElement.scrollWidth, h1: inhalt.querySelectorAll('h1').length, iso };
  });
  if (m.breite > 360) maengel.push(name + ': waagrechtes Scrollen (' + m.breite + ' px)');
  if (m.h1 !== 1) maengel.push(name + ': ' + m.h1 + ' h1');
  if (m.iso.length) maengel.push(name + ': ISO-Datum im Text ' + m.iso.join(', '));
}

for (const rolle of ['Vorstand', 'Mitgliederverwalter', 'Kassier', 'Abteilungsleiter', 'Jugendleiter']) {
  test('Rundgang ' + rolle + ' (360 px)', async () => {
    const ui = await starteOberflaeche({ rolle, breite: 360 });
    const p = ui.page;
    const maengel = [];
    try {
      const nav = await p.$$eval('#navigation button', b => b.map(x => x.dataset.ansicht));
      for (const k of nav) {
        await p.locator('#navigation button[data-ansicht="' + k + '"]').click();
        await p.waitForTimeout(350);
        await pruefe(p, k, maengel);
        const anzahl = await p.locator('#inhalt .reiter button').count();
        for (let i = 1; i < anzahl; i++) {
          await p.locator('#inhalt .reiter button').nth(i).click();
          await p.waitForTimeout(350);
          await pruefe(p, k + '/Reiter ' + i, maengel);
        }
      }
      const mid = await p.evaluate(() => (App.daten.liste('mitglieder')[0] || {}).mitglied_id);
      await p.evaluate(id => App.zeige('mitglied', { id }), mid);
      await p.waitForTimeout(350);
      await pruefe(p, 'mitglied', maengel);
      if (nav.includes('finanzen')) {
        const kid = await p.evaluate(() => App.daten.lade('finanzen').then(() => (App.daten.liste('konten')[0] || {}).beitragskonto_id));
        await p.evaluate(id => App.zeige('konto', { id }), kid);
        await p.waitForTimeout(350);
        await pruefe(p, 'konto', maengel);
      }
      assert.deepStrictEqual(maengel, []);
      assert.deepStrictEqual(ui.fehler, []);
    } finally { await ui.schliessen(); }
  });
}
