/**
 * Oberflächentest Navigation: Gruppen in der Hauptnavigation, Unterreiter, Leiste unten auf dem Handy mit „Mehr“,
 * dynamischer Titel „Meine Abteilung“ für Abteilungsleiter.
 * Ausführen: npm run test:ui
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

const sichtbareGruppen = p => p.$$eval('#navigation button', b => b.filter(x => x.offsetParent !== null).map(x => x.querySelector('.nav-text').textContent));
const aktuelleGruppe = p => p.$eval('#navigation button[aria-current="page"] .nav-text', x => x.textContent);

test('Mitgliederverwalter (Desktop): 6 Gruppen, Unterreiter, aria-current auf der Gruppe', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter', breite: 1024 });
  const p = ui.page;
  try {
    assert.deepStrictEqual(await sichtbareGruppen(p), ['Start', 'Mitglieder', 'Finanzen', 'Schreiben', 'Berichte', 'Verwaltung']);
    assert.strictEqual(await p.locator('.unterreiter').count(), 0, 'Start hat keine Unterreiter');
    await p.locator('#navigation').getByRole('button', { name: 'Mitglieder' }).click();
    const pillen = p.getByRole('navigation', { name: 'Unterbereiche' });
    assert.deepStrictEqual(await pillen.getByRole('button').allTextContents(), ['Mitglieder', 'Familien', 'Funktionen', 'Nachweise', 'Ehrungen']);
    assert.strictEqual(await pillen.locator('[aria-current="page"]').textContent(), 'Mitglieder');
    await pillen.getByRole('button', { name: 'Nachweise' }).click();
    await p.waitForFunction(() => App.aktuell().schluessel === 'nachweise');
    assert.strictEqual(await aktuelleGruppe(p), 'Mitglieder');
    assert.strictEqual(await p.locator('.unterreiter [aria-current="page"]').textContent(), 'Nachweise');
    // Detailansicht: Gruppe bleibt markiert, aber keine Unterreiter
    const mid = await p.evaluate(() => App.daten.liste('mitglieder')[0].mitglied_id);
    await ui.oeffne('mitglied', { id: mid });
    assert.strictEqual(await aktuelleGruppe(p), 'Mitglieder');
    assert.strictEqual(await p.locator('.unterreiter').count(), 0);
    assert.ok(await p.locator('.kopf .kopf-benutzer').isVisible(), 'Benutzer im Kopf (Desktop)');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Mitgliederverwalter (360 px): Leiste unten mit 4 Gruppen + „Mehr“, kein waagrechtes Scrollen', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  const p = ui.page;
  try {
    assert.deepStrictEqual(await sichtbareGruppen(p), ['Start', 'Mitglieder', 'Finanzen', 'Schreiben', 'Mehr']);
    const leiste = await p.locator('#navigation').boundingBox();
    assert.ok(leiste.y + leiste.height >= 799, 'Leiste unten');
    assert.ok(!(await p.locator('.kopf .kopf-benutzer').isVisible()), 'Kopf ohne Benutzerzeile');
    const mehr = p.locator('#navigation').getByRole('button', { name: 'Mehr' });
    await mehr.click();
    assert.strictEqual(await mehr.getAttribute('aria-expanded'), 'true');
    await p.keyboard.press('Escape');
    assert.ok(await p.locator('#mehr-liste').isHidden(), 'Escape schließt');
    await mehr.click();
    await p.locator('#mehr-liste').getByRole('button', { name: 'Verwaltung' }).click();
    await p.waitForFunction(() => App.aktuell().schluessel === 'verwaltung');
    assert.ok(await p.locator('#mehr-liste').isHidden());
    assert.ok(await p.locator('#nav-mehr.aktiv').isVisible(), '„Mehr“ zeigt die aktive Gruppe an');
    assert.deepStrictEqual(await p.locator('.unterreiter button').allTextContents(), ['Verwaltung', 'Datenschutz', 'Messwerte']);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 360, 'waagrechtes Scrollen');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Abteilungsleiter: „Meine Abteilung“ als Gruppe und Unterreiter, ohne „Mehr“', async () => {
  const ui = await starteOberflaeche({ rolle: 'Abteilungsleiter' });
  const p = ui.page;
  try {
    const gruppen = await sichtbareGruppen(p);
    assert.strictEqual(gruppen[0], 'Start');
    assert.strictEqual(gruppen[1], 'Meine Abteilung');
    assert.ok(gruppen.length <= 5 && !gruppen.includes('Mehr') && !gruppen.includes('Finanzen'), gruppen.join(' · '));
    await p.locator('#navigation').getByRole('button', { name: 'Meine Abteilung' }).click();
    await p.waitForFunction(() => App.aktuell().schluessel === 'mitglieder');
    if (await p.locator('.unterreiter').count()) {
      assert.strictEqual(await p.locator('.unterreiter [aria-current="page"]').textContent(), 'Meine Abteilung');
    }
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 360, 'waagrechtes Scrollen');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});
