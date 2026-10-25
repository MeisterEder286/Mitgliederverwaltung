/**
 * Oberflächentest „Beitritte aus XML importieren“: zwei Dateien (Familie + Einzelperson) auswählen, Vorschau,
 * Import, Bericht, Personen in der Mitgliederliste; mobil 360 px, keine JS-Fehler, keine Klartext-IBAN auf der Seite.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { starteOberflaeche } = require('./harness');

const DATEN = path.join(__dirname, '..', 'daten', 'beitritt');
const datei = n => ({ name: n, mimeType: 'text/xml', buffer: fs.readFileSync(path.join(DATEN, n)) });

test('Mitgliederverwaltung: zwei Beitritts-XML importieren → Bericht, neue Nummern, Personen sichtbar', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  const p = ui.page;
  try {
    await p.locator('#navigation button', { hasText: 'Mitglieder' }).click();
    await p.locator('button', { hasText: 'Beitritte aus XML importieren' }).click();
    await p.waitForSelector('h1:has-text("Beitritte aus XML importieren")');
    await p.getByLabel('Beitritts-XML-Dateien auswählen').setInputFiles([datei('familie.xml'), datei('einzel.xml')]);
    await p.waitForSelector('text=familie.xml – 3 Person(en)');
    await p.waitForSelector('text=einzel.xml – 1 Person(en)');
    assert.ok(await p.isVisible('text=Familie Beispielhuber'));
    const inhalt = await p.content();
    assert.ok(!inhalt.includes('DE89370400440532013000') && !inhalt.includes('0532013000'), 'IBAN im Klartext auf der Seite');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 360, 'waagrechtes Scrollen');
    await p.locator('button', { hasText: 'Importieren' }).click();
    await p.waitForSelector('text=4 neue Person(en) aus 2 Antrag/Anträgen hinzugefügt.');
    assert.ok(await p.isVisible('text=(zahlt selbst)'));
    assert.ok(await p.isVisible('text=Aufnahmebestätigungen erstellen'));
    // In der Fake-Tabelle angelegt, in der lokalen Liste sichtbar
    const neu = ui.objekte('Mitglied').filter(m => m.nachname === 'Beispielhuber' || m.nachname === 'Musterfrau');
    assert.strictEqual(neu.length, 4);
    const lokal = await p.evaluate(() => App.daten.liste('mitglieder').filter(m => m.nachname === 'Beispielhuber').length);
    assert.strictEqual(lokal, 3);
    // Link im Bericht öffnet die Person
    await p.locator('a', { hasText: 'Beispielhuber, Max' }).click();
    await p.waitForFunction(() => App.aktuell().schluessel === 'mitglied');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Abteilungsleitung sieht keinen Import-Knopf; Server weist ab', async () => {
  const ui = await starteOberflaeche({ rolle: 'Abteilungsleiter' });
  try {
    await ui.page.locator('#navigation button', { hasText: 'Meine Abteilung' }).click();
    assert.strictEqual(await ui.page.locator('button', { hasText: 'Beitritte aus XML importieren' }).count(), 0);
    const a = ui.g.apiBeitrittVorschau([{ datei: 'x.xml', personen: [{ Nachname: 'X' }] }]);
    assert.strictEqual(a.fehler.art, 'zugriff');
  } finally { await ui.schliessen(); }
});
