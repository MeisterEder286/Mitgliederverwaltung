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
    await p.getByRole('searchbox', { name: 'Mitglied suchen' }).fill(m.nachname);
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
