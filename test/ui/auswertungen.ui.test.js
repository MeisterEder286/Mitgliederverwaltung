/**
 * Oberflächentest Auswertungen: Reiter je Rolle, Export mit Protokoll, BLSV-Nachmeldung, Eingabehilfen im Formular
 * „Neues Mitglied“ (Anrede → Geschlecht, PLZ → Ort) und Verweis auf den Beitritts-Import. Mobil 360 px.
 * Läuft mit npm run test:ui.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');


test('Auswertungen als Mitgliederverwalter: alle Reiter, Export protokolliert, 360 px ohne Querscrollen', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  const p = ui.page;
  try {
    await p.evaluate(() => App.zeige('auswertungen'));
    await p.waitForSelector('text=aktive Mitglieder');
    const reiter = await p.$$eval('[role=tab]', b => b.map(x => x.textContent));
    ['Überblick', 'Altersgruppen', 'Entwicklung', 'Beiträge', 'Altersübergänge', 'Funktionen', 'Mitgliederlisten'].forEach(r => assert.ok(reiter.includes(r), r));
    for (const r of reiter) {
      await p.getByRole('tab', { name: r, exact: true }).click();
      const breite = await p.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(breite <= 360, r + ': waagrechtes Scrollen ' + breite);
    }
    await p.getByRole('tab', { name: 'Altersgruppen', exact: true }).click();
    await p.locator('.abschnittskopf', { hasText: 'Altersgruppen zum' }).getByRole('button', { name: 'CSV' }).click();
    await p.waitForTimeout(400);
    assert.ok(ui.downloads.some(d => /^Altersgruppen_/.test(d.name)));
    assert.ok(ui.objekte('_Protokoll').some(x => x.aktion === 'exportiert' && x.tabelle === 'Auswertung'));
    // andere Grenzen und Gruppierung je Geschlecht
    await p.getByLabel('Altersgrenzen', { exact: true }).fill('10, 20, 60');
    await p.getByLabel('Altersgruppen je').selectOption('geschlecht');
    await p.getByRole('button', { name: 'Berechnen' }).click();
    await p.getByRole('tab', { name: 'Altersgruppen', exact: true }).click();
    await p.waitForSelector('th:has-text("21–60")');
    await p.waitForSelector('td:has-text("weiblich")');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Auswertungen als Abteilungsleiter: nur Sichtbereich, ohne Entwicklung und Beiträge', async () => {
  const ui = await starteOberflaeche({ rolle: 'Abteilungsleiter' });
  const p = ui.page;
  try {
    await p.evaluate(() => App.zeige('auswertungen'));
    await p.waitForSelector('text=aktiv in Ihrem Sichtbereich');
    const reiter = await p.$$eval('[role=tab]', b => b.map(x => x.textContent));
    assert.ok(!reiter.includes('Entwicklung') && !reiter.includes('Beiträge'));
    assert.ok(await p.isVisible('text=stehen nur Vorstand, Mitgliederverwaltung und Kasse zur Verfügung'));
    // vereinsweite Funktion direkt aufgerufen → abgewiesen
    const e = await p.evaluate(() => App.rufe('apiAuswertungEntwicklung', 2016, 2026, App.still).then(() => 'ok', err => err.art));
    assert.strictEqual(e, 'fachlich');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('BLSV-Nachmeldung in Berichte', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter', breite: 1100 });
  const p = ui.page;
  try {
    await p.getByRole('button', { name: 'Berichte', exact: true }).click();
    await p.waitForSelector('text=Mitglieder im Verein');
    await p.getByLabel('Art der Meldung').selectOption('nachmeldung');
    await p.waitForSelector('text=Neumitglieder im Verein');
    await p.locator('.abschnittskopf', { hasText: 'Nachmeldung' }).getByRole('button', { name: 'CSV' }).click();
    await p.waitForTimeout(400);
    assert.ok(ui.downloads.some(d => /^BLSV_Nachmeldung_/.test(d.name)));
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Neues Mitglied: Anrede → Geschlecht, PLZ → Ort, Verweis auf den Beitritts-Import', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  const p = ui.page;
  try {
    await p.evaluate(() => App.zeige('mitglied_neu'));
    await p.waitForSelector('text=Beitrittsanträge aus XML-Dateien importieren');
    // Anrede → Geschlecht (Divers → d; Access hätte „w“ gesetzt)
    await p.getByLabel('Anrede', { exact: true }).selectOption('Divers');
    assert.strictEqual(await p.getByLabel('Geschlecht', { exact: true }).inputValue(), 'd');
    // PLZ → Ort aus vorhandenen Anschriften
    await p.getByLabel('PLZ', { exact: true }).fill('84061');
    assert.ok((await p.getByLabel('Ort', { exact: true }).inputValue()).length > 0);
    await p.getByLabel('Ort', { exact: true }).fill('');
    await p.getByLabel('Geschlecht', { exact: true }).selectOption('');
    // XML-Import liegt jetzt in der Ansicht „Beitritte importieren“
    await p.locator('a', { hasText: 'Beitrittsanträge aus XML-Dateien importieren' }).click();
    await p.waitForFunction(() => App.aktuell().schluessel === 'beitritt');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});
