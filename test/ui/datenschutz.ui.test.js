/**
 * Oberflächentest Datenschutz (src/client/ansicht_datenschutz.html): Einwilligung erfassen, Betroffenenanfrage mit
 * Auskunft, Anonymisieren über die Löschliste (mit Bestätigungswort), Protokoll; Kassier sieht nur das Protokoll.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

test('Einwilligung erfassen und Anfrage mit Auskunft', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    const p = ui.page;
    await p.getByRole('button', { name: 'Datenschutz' }).click();
    await p.getByText('Übersicht je Art').waitFor();
    const m = await p.evaluate(() => App.daten.liste('mitglieder').find(x => x.status_abgeleitet === 'aktiv' && x.nachname));
    const vorher = ui.objekte('Einwilligung').length;
    await p.getByRole('searchbox', { name: 'Person suchen' }).fill(m.mitgliedsnummer);
    await p.locator('.ds-person li button').first().click();
    await p.getByRole('button', { name: 'Einwilligung erfassen' }).click();
    const dlg = p.locator('dialog');
    await dlg.getByLabel('Art *').selectOption('Fotos und Videos');
    await dlg.getByRole('button', { name: 'Speichern' }).click();
    await p.getByText('Einwilligung gespeichert.').waitFor();
    assert.strictEqual(ui.objekte('Einwilligung').length, vorher + 1);

    await p.getByRole('tab', { name: 'Anfragen' }).click();
    await p.getByRole('button', { name: 'Neue Anfrage' }).click();
    const d2 = p.locator('dialog');
    await d2.getByRole('searchbox').fill(m.mitgliedsnummer);
    await d2.locator('.ds-person li button').first().click();
    await d2.getByLabel('Art').selectOption('Auskunft (Art. 15)');
    await d2.getByLabel('Umfang').fill('Alle Daten');
    await d2.getByRole('button', { name: 'Speichern' }).click();
    await p.getByText('Anfrage gespeichert.').waitFor();
    assert.strictEqual(ui.objekte('Betroffenenanfrage').length, 1);
    await p.locator('table tbody tr').first().click();
    await p.locator('dialog').getByRole('button', { name: 'Auskunft erstellen' }).click();
    await p.getByText(/Auskunft nach Art. 15 DSGVO –/).waitFor();
    assert.ok(ui.objekte('_Protokoll').some(x => x.aktion === 'exportiert'));
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Löschliste: anonymisieren nur mit Bestätigungswort; Protokoll zeigt den Vorgang', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    const p = ui.page;
    await p.evaluate(() => App.zeige('datenschutz', { reiter: 'loeschliste' }));
    await p.getByRole('heading', { name: /^Anonymisieren/ }).waitFor();
    await p.getByRole('button', { name: 'Vorschau …' }).first().click();
    const dlg = p.locator('dialog');
    await dlg.getByText(/wird anonymisiert/).waitFor();
    await dlg.getByLabel('Bestätigungswort ANONYMISIEREN').fill('falsch');
    await dlg.getByRole('button', { name: 'Anonymisieren' }).click();
    await p.getByText('Bitte genau ANONYMISIEREN eingeben.').waitFor();
    assert.ok(!ui.objekte('Mitglied').some(m => m.anonymisiert === 'ja' && m.version > 1));
    await dlg.getByLabel('Bestätigungswort ANONYMISIEREN').fill('ANONYMISIEREN');
    await dlg.getByRole('button', { name: 'Anonymisieren' }).click();
    await p.getByText(/^Anonymisiert:/).waitFor();
    assert.ok(ui.objekte('Mitglied').some(m => m.anonymisiert === 'ja'));
    await p.getByRole('tab', { name: 'Protokoll' }).click();
    await p.getByRole('cell', { name: 'anonymisiert', exact: true }).first().waitFor();
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Kassier sieht nur das (gefilterte) Protokoll, Abteilungsleiter gar nichts', async () => {
  const ui = await starteOberflaeche({ rolle: 'Kassier' });
  try {
    const p = ui.page;
    await p.getByRole('button', { name: 'Datenschutz' }).click();
    await p.getByRole('heading', { name: 'Änderungsprotokoll' }).waitFor();
    assert.strictEqual(await p.getByRole('tab', { name: 'Einwilligungen' }).count(), 0);
    await p.getByText(/Seite 1 von/).waitFor();
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
  const al = await starteOberflaeche({ rolle: 'Abteilungsleiter' });
  try {
    assert.strictEqual(await al.page.getByRole('button', { name: 'Datenschutz' }).count(), 0);
    const r = await al.page.evaluate(() => App.rufe('apiDatenschutzLoeschliste', App.still).then(() => 'ok', e => e.art));
    assert.strictEqual(r, 'zugriff');
  } finally { await al.schliessen(); }
});
