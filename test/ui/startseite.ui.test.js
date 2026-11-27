/**
 * Oberflächentest Startseite (src/client/ansicht_start.html): Kacheln je Rolle, Zusatzinfos nur mit Recht,
 * Schnellsuche, Hinweise. Läuft mit npm run test:ui (Chromium gegen echten Servercode).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

const warte = (ms) => new Promise(r => setTimeout(r, ms));

test('Mitgliederverwalter: Kennzahlen, Datenqualität, Hinweise, Schnellsuche', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    const p = ui.page;
    await p.getByText('aktive Mitglieder').waitFor();
    await p.getByText('Datenfehler (Prüfregeln)').waitFor();
    await p.getByText('Zu erledigen').waitFor();
    await p.getByText(/Gläubiger-ID ist noch der Platzhalter/).waitFor();
    const m = await p.evaluate(() => App.daten.liste('mitglieder').find(x => x.status_abgeleitet === 'aktiv'));
    await p.getByRole('combobox', { name: 'Mitglied suchen' }).fill(m.nachname);
    await p.locator('.start-vorschlaege li').first().waitFor();
    // Hinweis-Link führt in die Verwaltung (Einstellungen)
    await p.getByText(/Gläubiger-ID ist noch der Platzhalter/).click();
    assert.strictEqual(await p.evaluate(() => App.aktuell().schluessel), 'verwaltung');
    assert.ok(ui.aufrufe.includes('apiVerwaltungPruefregelnZusammenfassung'));
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Abteilungsleiter: „meine Abteilung“, keine Verwaltungs-Aufrufe, keine Finanzen', async () => {
  const ui = await starteOberflaeche({ rolle: 'Abteilungsleiter' });
  try {
    const p = ui.page;
    await p.getByText('aktiv in meiner Abteilung').waitFor();
    await warte(300);
    assert.ok(!ui.aufrufe.some(a => /^apiVerwaltung|^apiDatenschutz/.test(a)), 'keine Verwaltungsaufrufe: ' + ui.aufrufe);
    assert.strictEqual(await p.getByText('Summe offen').count(), 0);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Kassier: offene Beiträge werden nach Laden der Finanzen gezeigt', async () => {
  const ui = await starteOberflaeche({ rolle: 'Kassier' });
  try {
    await ui.page.getByText(/Summe offen/).waitFor();
    assert.ok(ui.aufrufe.includes('apiSnapshot'));
    assert.ok(!ui.aufrufe.includes('apiVerwaltungHinweise'));
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Startseite: Kachelgruppen mit Überschrift, Schnellsuche per Tastatur', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    const p = ui.page;
    for (const h of ['Mitglieder', 'Zu erledigen']) await p.getByRole('heading', { name: h, exact: true }).waitFor();
    const m = await p.evaluate(() => App.daten.liste('mitglieder').find(x => x.status_abgeleitet === 'aktiv'));
    const feld = p.getByRole('combobox', { name: 'Mitglied suchen' });
    await feld.fill(m.nachname);
    await p.getByRole('option').first().waitFor();
    assert.strictEqual(await feld.getAttribute('aria-expanded'), 'true');
    await feld.press('Escape');
    assert.strictEqual(await feld.getAttribute('aria-expanded'), 'false');
    await feld.press('ArrowDown');
    const erste = p.getByRole('option').first();
    assert.strictEqual(await erste.getAttribute('aria-selected'), 'true');
    assert.strictEqual(await feld.getAttribute('aria-activedescendant'), await erste.getAttribute('id'));
    const id = Number(await erste.getAttribute('data-id'));
    await feld.press('Enter');
    await p.waitForSelector('.mv-kopf');
    assert.deepStrictEqual(await p.evaluate(() => [App.aktuell().schluessel, App.aktuell().param.id]), ['mitglied', id]);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});
test('Schnellsuche: neue Eingabe verwirft alte Auswahl; Trefferliste zeigt alle Status; Zurück behält eigene Filter', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter', breite: 1000 });
  const p = ui.page;
  try {
    const feld = p.getByRole('combobox');
    await feld.fill('a');
    await p.locator('#start-vorschlaege li').first().waitFor();
    await feld.press('ArrowDown'); await feld.press('ArrowDown');
    await feld.fill('ai');
    await p.waitForTimeout(300);
    assert.strictEqual(await feld.getAttribute('aria-activedescendant'), null);
    // Enter ohne Auswahl → Liste mit Suchbegriff, ohne Statusfilter
    await feld.press('Enter');
    await p.waitForFunction(() => App.aktuell().schluessel === 'mitglieder');
    assert.strictEqual(await p.getByLabel('Status', { exact: true }).inputValue(), '');
    assert.strictEqual(await p.evaluate(() => location.hash), '#mitglieder');
    // eigene Änderung, Mitglied öffnen, zurück → eigene Suche bleibt
    await p.getByRole('searchbox').fill('Aigner');
    await p.waitForTimeout(300);
    await p.locator('tr.klickbar').first().click();
    await p.waitForFunction(() => App.aktuell().schluessel === 'mitglied');
    await p.goBack();
    await p.waitForFunction(() => App.aktuell().schluessel === 'mitglieder');
    assert.strictEqual(await p.getByRole('searchbox').inputValue(), 'Aigner');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});
