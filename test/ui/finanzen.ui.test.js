/**
 * Oberflächentests Finanzen (Chromium gegen den echten Servercode, synthetischer Verein mit 300 Mitgliedern).
 * Abläufe: Einzugsstand → Konten → Konto → IBAN aufdecken (protokolliert); Konto anlegen mit IBAN-Prüfung;
 * Kassier: Jahreslauf anlegen, SEPA-Probelauf, Datei erzeugen (Download); Abteilungsleiter sieht keine Finanzen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { starteOberflaeche } = require('./harness');
const { erzeugeVerein } = require('../daten/generator');

function vereinMitVereinskonto() {
  const tabs = erzeugeVerein({ seed: 1, mitglieder: 300 }).tabs;
  const k = tabs._Konfig;
  const neu = { verein_iban: 'DE89370400440532013000', verein_glaeubiger_id: 'DE98ZZZ09999999999', verein_strasse: 'Sportplatzweg',
    verein_hausnummer: '1', verein_plz: '84061', verein_ort: 'Ergoldsbach' };
  Object.keys(neu).forEach(s => k.push(k[0].map(h => (h === 'schluessel' ? s : h === 'wert' ? neu[s] : ''))));
  return tabs;
}

async function reiter(page, name) {
  await page.getByRole('tab', { name }).click();
}

test('Mitgliederverwalter: Einzugsstand, Kontenliste, Kontodetail, IBAN aufdecken', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Finanzen' }).click();
    await page.getByText('Soll gesamt').waitFor();
    await page.getByText('Offen und streitig 2026').waitFor();
    await reiter(page, 'Konten');
    await page.locator('table tbody tr').first().waitFor();
    const anzahlVorher = await page.locator('table tbody tr').count();
    assert.ok(anzahlVorher > 10);
    const ersterInhaber = await page.locator('table tbody tr').first().locator('td').nth(1).textContent();
    await page.getByRole('searchbox').fill(ersterInhaber.split(',')[0]);
    await page.waitForTimeout(300);
    assert.ok(await page.locator('table tbody tr').count() <= anzahlVorher);
    await page.locator('table tbody tr').first().click();
    await page.getByRole('heading', { level: 1, name: /^Konto \d+/ }).waitFor();
    await page.getByText(/^Summe 2026:/).waitFor();
    const knopf = page.getByRole('button', { name: 'aufdecken' });
    if (await knopf.count()) {
      await knopf.click();
      await page.locator('.fin-iban', { hasText: /^DE\d{2} \d{4}/ }).waitFor();
      assert.ok(ui.objekte('_Protokoll').some(p => p.aktion === 'eingesehen' && p.feld === 'iban'));
    }
    const breite = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(breite <= 360, 'waagrechtes Scrollen: ' + breite);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Konto anlegen: IBAN-Prüfung beim Tippen, Feldfehler vom Server, Speichern', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Finanzen' }).click();
    await reiter(page, 'Konten');
    await page.getByRole('button', { name: 'Konto anlegen' }).click();
    const dlg = page.locator('dialog');
    await dlg.getByLabel(/Kontoinhaber/).fill('Probe, Paula');
    await dlg.getByLabel(/^IBAN/).fill('DE89 3704 0044 0532 0130 01');
    await dlg.getByText(/IBAN ungültig/).waitFor();
    await dlg.getByLabel(/^IBAN/).fill('DE89 3704 0044 0532 0130 00');
    await dlg.getByText(/Prüfziffer stimmt/).waitFor();
    await dlg.getByLabel('Mandatsdatum (Unterschrift)').fill('01.10.2026');
    await dlg.getByRole('button', { name: 'Speichern' }).click();
    await dlg.getByText(/Mandatsreferenz Pflicht/).waitFor();     // Feldfehler vom Server
    await dlg.getByLabel('Mandatsreferenz').fill('TSV-2026-PROBE');
    await dlg.getByRole('button', { name: 'Speichern' }).click();
    await page.getByRole('heading', { level: 1, name: /Probe, Paula/ }).waitFor();
    const k = ui.objekte('Beitragskonto').find(x => x.kontoinhaber_name === 'Probe, Paula');
    assert.ok(k && k.iban === 'DE89370400440532013000' && k.mandatsreferenz === 'TSV-2026-PROBE');
    assert.ok(!(await page.content()).includes('DE89370400440532013000'), 'Klartext-IBAN in der Seite');
    assert.deepStrictEqual(ui.fehler.filter(f => !/status of 4|Failed to load/.test(f)), []);
  } finally { await ui.schliessen(); }
});

test('Kassier: Jahreslauf anlegen, SEPA-Probelauf, Datei erzeugen; kein „Konto anlegen“', async () => {
  const ui = await starteOberflaeche({ rolle: 'Kassier', tabs: vereinMitVereinskonto() });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Finanzen' }).click();
    await reiter(page, 'Konten');
    await page.locator('table tbody tr').first().waitFor();
    assert.strictEqual(await page.getByRole('button', { name: 'Konto anlegen' }).count(), 0);
    await reiter(page, 'Sollstellungen');
    await page.getByLabel('Beitragsjahr').selectOption('2027');
    await page.getByRole('button', { name: 'Jahreslauf planen …' }).click();
    await page.locator('dialog').getByText('neue Sollstellungen', { exact: true }).waitFor();
    await page.locator('dialog').getByRole('button', { name: 'Sollstellungen anlegen' }).click();
    await page.getByText(/Sollstellungen für 2027 angelegt/).waitFor();
    assert.ok(ui.objekte('Sollstellung').some(s => s.jahr === 2027));
    await reiter(page, 'SEPA-Lauf');
    await page.getByRole('button', { name: 'Probelauf' }).click();
    await page.getByText('Lastschriften', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'SEPA-Datei erzeugen' }).click();
    await page.locator('dialog').getByRole('button', { name: 'Datei erzeugen' }).click();
    await page.getByText(/SEPA-Datei SEPA-Lastschrift_2027_.* erzeugt/).waitFor();
    await page.waitForTimeout(300);
    assert.strictEqual(ui.downloads.length, 1);
    assert.match(ui.downloads[0].name, /^SEPA-Lastschrift_2027_.*\.xml$/);
    assert.ok(fs.readFileSync(ui.downloads[0].pfad, 'utf8').includes('pain.008.001.08'));
    assert.ok(ui.objekte('Sollstellung').filter(s => s.jahr === 2027).some(s => s.sepa_sequenz === 'FRST' || s.sepa_sequenz === 'RCUR'));
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Abteilungsleiter: keine Finanzen in der Navigation, Server verweigert', async () => {
  const ui = await starteOberflaeche({ rolle: 'Abteilungsleiter' });
  const { page } = ui;
  try {
    const nav = await page.$$eval('#navigation button', b => b.map(x => x.textContent));
    assert.ok(!nav.includes('Finanzen'));
    const art = await page.evaluate(() => App.rufe('apiFinanzenUebersicht', 2026, App.still).then(() => 'ok', e => e.art));
    assert.strictEqual(art, 'zugriff');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Startseite und Finanzen zeigen dieselbe Summe offen/strittig', async () => {
  const { starteOberflaeche } = require('./harness');
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    await ui.page.waitForSelector('text=Summe offen/strittig');
    const start = await ui.page.locator('.kachel', { hasText: 'Summe offen/strittig' }).locator('.kachel-zahl').textContent();
    await ui.page.locator('#navigation button', { hasText: 'Finanzen' }).click();
    await ui.page.waitForSelector('.fin-summe');
    const fin = await ui.page.locator('.fin-summe').textContent();
    assert.ok(fin.replace(/\s/g, ' ').includes(start.replace(/\s/g, ' ')), start + ' ≠ ' + fin);
  } finally { await ui.schliessen(); }
});
