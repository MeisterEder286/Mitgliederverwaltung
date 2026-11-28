/**
 * Oberflächentest Verwaltung (src/client/ansicht_verwaltung.html): Zugang anlegen, Einstellung ändern,
 * Stammdaten anlegen, Datenqualität, System; Abteilungsleiter ohne Zugang; Testdaten einspielen (nur Test-Umgebung).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { starteOberflaeche } = require('./harness');
const { exportiere } = require('../../tools/testdaten-export');

test('Mitgliederverwalter: Benutzer, Einstellungen, Stammdaten, Datenqualität, System', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    const p = ui.page;
    await ui.oeffne('verwaltung');
    await p.getByRole('heading', { name: 'Rechte je Rolle' }).waitFor();
    await p.getByRole('button', { name: 'Zugang anlegen' }).click();
    const d = p.locator('dialog');
    await d.getByLabel('Email *').fill('neu.leitung@tsv-ergoldsbach.de');
    await d.getByLabel('Rolle *').selectOption('Abteilungsleiter');
    await d.getByRole('button', { name: 'Speichern' }).click();
    await d.getByText('Für Abteilungsleiter bitte die Abteilung wählen.').waitFor();
    await d.getByLabel('Abteilung').selectOption({ label: 'Tennis' });
    await d.getByRole('button', { name: 'Speichern' }).click();
    await p.getByRole('cell', { name: 'neu.leitung@tsv-ergoldsbach.de' }).waitFor();
    assert.ok(ui.objekte('Benutzer').some(b => b.email === 'neu.leitung@tsv-ergoldsbach.de' && b.abteilung_id === 3));

    await p.getByRole('tab', { name: 'Einstellungen' }).click();
    const bereiche = p.getByRole('navigation', { name: 'Bereiche der Einstellungen' });
    await bereiche.getByRole('button', { name: /^Verein/ }).waitFor();
    assert.strictEqual(await bereiche.getByRole('button', { name: /^Weitere/ }).count(), 0, 'jeder Schlüssel ist einem Bereich zugeordnet');
    assert.strictEqual(await p.locator('.vw-konfig', { hasText: 'mandat_verfall_monate' }).count(), 0, 'nur der gewählte Bereich ist sichtbar');
    await bereiche.getByRole('button', { name: /^SEPA-Lastschrift/ }).click();
    await p.getByRole('heading', { name: 'Gläubiger und Vereinskonto' }).waitFor();
    await p.locator('.vw-konfig', { hasText: 'verein_glaeubiger_id' }).getByText('offen', { exact: true }).waitFor();
    const zeile = p.locator('.vw-konfig', { hasText: 'mandat_verfall_monate' });
    assert.ok(await zeile.getByRole('button', { name: 'Speichern' }).isDisabled(), 'Speichern erst nach einer Änderung');
    await zeile.locator('input').fill('drei');
    await zeile.getByRole('button', { name: 'Speichern' }).click();
    await zeile.getByText('Bitte eine ganze Zahl angeben.').waitFor();
    await zeile.locator('input').fill('30');
    await zeile.getByRole('button', { name: 'Speichern' }).click();
    await p.getByText('Einstellung „Mandat verfällt nach Monaten“ (mandat_verfall_monate) gespeichert.').waitFor();
    // Suche über alle Bereiche
    await p.getByRole('searchbox', { name: 'Einstellung suchen' }).fill('antwortadresse');
    await p.locator('.vw-konfig', { hasText: 'mail_antwort_an_finanzen' }).waitFor();
    assert.strictEqual(await p.locator('.vw-konfig', { hasText: 'mandat_verfall_monate' }).count(), 0);
    assert.strictEqual(ui.objekte('_Konfig').find(k => k.schluessel === 'mandat_verfall_monate').wert, '30');

    await p.getByRole('tab', { name: 'Stammdaten' }).click();
    await p.getByRole('button', { name: 'Neu' }).click();
    await p.locator('dialog').getByLabel('Bezeichnung *').fill('Volleyball');
    await p.locator('dialog').getByRole('button', { name: 'Speichern' }).click();
    await p.locator('dialog').locator('.feldfehler', { hasText: /Meldepflichtig/ }).waitFor();   // Pflichtfeld fehlt
    await p.locator('dialog').getByLabel('Meldepflichtig *').selectOption('ja');
    await p.locator('dialog').getByRole('button', { name: 'Speichern' }).click();
    await p.getByRole('cell', { name: 'Volleyball', exact: true }).waitFor();
    assert.ok(await p.evaluate(() => App.daten.liste('abteilungen').some(a => a.bezeichnung === 'Volleyball')), 'Snapshot im Browser aktualisiert');
    // Gliederung: Beitragsarten in Einzel- und Familienbeiträge; Familienfelder nur bei „als Gemeinschaft“
    const arten = p.getByRole('navigation', { name: 'Arten der Stammdaten' });
    await arten.getByRole('button', { name: 'Beitragsarten' }).click();
    await p.getByRole('heading', { name: /^Einzelbeiträge \(\d+\)$/ }).waitFor();
    await p.getByRole('heading', { name: /^Familien- und Ehegattenbeiträge \(\d+\)$/ }).waitFor();
    await p.getByRole('button', { name: 'Neu' }).click();
    const dlg = p.locator('dialog');
    await dlg.getByRole('heading', { name: 'Familien- oder Ehegattenbeitrag' }).waitFor();
    assert.ok(!(await dlg.getByLabel('Höchstens Kinder').isVisible()), 'Familienfelder erst bei Familie/Ehepaar');
    await dlg.getByLabel('Als Gemeinschaft (Familie/Ehepaar)').selectOption('Familie');
    assert.ok(await dlg.getByLabel('Höchstens Kinder').isVisible());
    await dlg.getByRole('button', { name: 'Abbrechen' }).click();
    await arten.getByRole('button', { name: 'Abteilungen' }).click();

    await p.getByRole('tab', { name: 'Datenqualität' }).click();
    await p.getByRole('heading', { name: 'Befunde' }).waitFor();
    await p.getByRole('tab', { name: 'System' }).click();
    await p.getByRole('heading', { name: 'Zeilen je Tabelle' }).waitFor();
    await p.getByRole('button', { name: 'Snapshot neu aufbauen' }).click();
    await p.getByText('Snapshot neu aufgebaut und geladen.').waitFor();
    assert.strictEqual(await p.getByRole('heading', { name: /Testdaten einspielen/ }).count(), 0, 'ohne TESTUMGEBUNG kein Import');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Abteilungsleiter und Kassier sehen keine Verwaltung; Server weist ab', async () => {
  for (const rolle of ['Abteilungsleiter', 'Kassier']) {
    const ui = await starteOberflaeche({ rolle });
    try {
      assert.ok(!(await ui.navAnsichten()).includes('Verwaltung'));
      const r = await ui.page.evaluate(() => App.rufe('apiVerwaltungBenutzer', App.still).then(() => 'ok', e => e.art));
      assert.strictEqual(r, 'zugriff');
    } finally { await ui.schliessen(); }
  }
});

test('Test-Umgebung: Testdaten einspielen aus testdaten.json', async () => {
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'testdaten-ui-'));
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter', properties: { TESTUMGEBUNG: 'ja' } });
  try {
    exportiere({ mitglieder: 120, seed: 2, stichtag: '2026-11-27', ziel });
    const datei = JSON.parse(fs.readFileSync(path.join(ziel, 'testdaten.json'), 'utf8'));
    const p = ui.page;
    await ui.oeffne('verwaltung');
    await p.getByRole('tab', { name: 'System' }).click();
    await p.getByRole('heading', { name: 'Testdaten einspielen (Test-Umgebung)' }).waitFor();
    await p.getByLabel('Datei testdaten.json auswählen').setInputFiles(path.join(ziel, 'testdaten.json'));
    await p.getByText('Erzeugt mit seed 2').waitFor();
    await p.getByRole('button', { name: 'Einspielen' }).click();
    await p.locator('dialog').getByRole('button', { name: 'Ersetzen' }).click();
    await p.getByText(/^Testdaten eingespielt: Mitglied /).waitFor({ timeout: 30000 });
    assert.strictEqual(ui.objekte('Mitglied').filter(m => m.mitglied_id !== '').length, datei.tabs.Mitglied.zeilen.length);
    assert.ok(ui.aufrufe.filter(n => n === 'apiTestdatenBlock').length >= 10);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); fs.rmSync(ziel, { recursive: true, force: true }); }
});
