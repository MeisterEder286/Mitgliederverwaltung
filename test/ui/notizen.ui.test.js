/**
 * Oberflächentest „Notizen“: Wiedervorlage im Mitglied-Detail anlegen (Art.-9-Hinweis), auf der Startseite unter
 * „Wiedervorlagen“ sehen, in der Ansicht „Notizen“ erledigen; Abteilungsleiter: nur eigene Abteilung als Leserkreis,
 * Verwaltungs-Notiz unsichtbar. Mobil 360 px, keine JS-Fehler.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

const keinQuerscrollen = async (p, wo) => {
  const breite = await p.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(breite <= 360, wo + ': waagrechtes Scrollen ' + breite);
};

test('Mitgliederverwalter: Wiedervorlage anlegen, auf der Startseite sehen, erledigen', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    const p = ui.page;
    const m = ui.objekte('Mitglied').find(x => x.status === 'aktiv');
    const heute = await p.evaluate(() => App.startdaten.heute || App.heute());
    await p.evaluate(id => App.zeige('mitglied', { id }), m.mitglied_id);
    await p.locator('.reiter button', { hasText: 'Notizen' }).click();
    await p.locator('button', { hasText: 'Notiz hinzufügen' }).click();
    await p.waitForSelector('text=Art. 9 DSGVO');
    await p.getByLabel('Art *').selectOption('Wiedervorlage');
    await p.getByLabel('Text *').fill('Beitragsfrage klären');
    await p.getByLabel('Wiedervorlage am').fill(heute.split('-').reverse().join('.'));
    await p.locator('dialog button', { hasText: 'Speichern' }).click();
    await p.waitForSelector('.nz-karte:has-text("Beitragsfrage klären")');
    assert.strictEqual(ui.objekte('Notiz').length, 1);
    await keinQuerscrollen(p, 'Mitglied-Detail');
    // Startseite
    await p.evaluate(() => App.zeige('start'));
    await p.waitForSelector('.start-wiedervorlagen :text("Beitragsfrage klären")');
    await keinQuerscrollen(p, 'Startseite');
    await p.locator('.start-wiedervorlagen button', { hasText: 'alle anzeigen' }).click();
    await p.waitForSelector('h1:has-text("Notizen")');
    await p.locator('.nz-karte button', { hasText: 'Erledigen' }).click();
    await p.getByLabel('Ergebnis (optional)').fill('geklärt');
    await p.locator('dialog button', { hasText: 'Erledigt' }).click();
    await p.waitForSelector('text=Nichts zu erledigen.');
    assert.ok(ui.objekte('Notiz')[0].erledigt_am);
    await p.locator('.reiter button', { hasText: 'Alle Notizen' }).click();
    await p.waitForSelector('text=Ergebnis: geklärt');
    await keinQuerscrollen(p, 'Notizen');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Abteilungsleiter: nur Leserkreis Abteilung wählbar, Notiz wird angelegt', async () => {
  const ui = await starteOberflaeche({ rolle: 'Abteilungsleiter' });
  try {
    const p = ui.page;
    const id = await p.evaluate(() => App.daten.liste('mitglieder')[0].mitglied_id);
    await p.evaluate(x => App.zeige('mitglied', { id: x, reiter: 'notizen' }), id);
    await p.locator('button', { hasText: 'Notiz hinzufügen' }).click();
    const kreise = await p.getByLabel('Sichtbar für *').locator('option').allTextContents();
    assert.deepStrictEqual(kreise.filter(x => x && x !== '–'), ['Abteilung']);
    await p.getByLabel('Text *').fill('Trainingszeit besprochen');
    await p.locator('dialog button', { hasText: 'Speichern' }).click();
    await p.waitForSelector('.nz-karte:has-text("Trainingszeit besprochen")');
    assert.strictEqual(ui.objekte('Notiz')[0].sichtbar_fuer, 'Abteilung');
    await keinQuerscrollen(p, 'AL Notizen');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});
