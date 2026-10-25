/**
 * Oberflächentest „Schreiben“: Austrittsbestätigung aus dem Mitglied-Detail erstellen und drucken (Druckfenster
 * abgefangen), Reiter „Dokumente & Schreiben“, Dokument verknüpfen, Konto-Abschnitt Mandat; Abteilungsleiter ohne
 * Zugang. Mobil 360 px.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');
const { erzeugeVerein } = require('../daten/generator');
const { ladeProjekt } = require('../hilfe/projekt');

function tabsMitVorlagen() {
  const v = erzeugeVerein({ seed: 1, mitglieder: 300 });
  const sb = ladeProjekt({}).Startbelegung.Vorlage;
  const kopf = v.tabs.Vorlage[0];
  sb.zeilen.forEach(z => v.tabs.Vorlage.push(kopf.map(k => { const i = sb.kopf.indexOf(k); return i < 0 ? (k === 'version' ? 1 : '') : z[i]; })));
  const k = v.tabs._Konfig, iS = k[0].indexOf('schluessel'), iW = k[0].indexOf('wert');
  const zeile = k.find(r => r[iS] === 'next_id_Vorlage');
  if (zeile) zeile[iW] = String(sb.zeilen.length + 1);
  return v.tabs;
}

/** Druckfenster im Browser abfangen: gedruckter Text landet in window.__gedruckt. */
async function druckAbfangen(page) {
  await page.evaluate(() => {
    window.__gedruckt = [];
    window.open = function () {
      const d = document.implementation.createHTMLDocument('druck');
      return { document: d, focus() {}, print() { window.__gedruckt.push(d.body.textContent); } };
    };
  });
}

test('Mitgliederverwalter: Austrittsbestätigung aus dem Detail, Druck, Ablage unter „Erstellte Schreiben“', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter', tabs: tabsMitVorlagen() });
  try {
    const p = ui.page;
    await druckAbfangen(p);
    const ausgetreten = ui.objekte('Mitglied').find(m => m.status === 'ausgetreten');
    await p.evaluate(id => App.zeige('mitglied', { id }), ausgetreten.mitglied_id);
    await p.locator('button', { hasText: 'Austrittsbestätigung schreiben' }).click();
    await p.waitForSelector('h1:has-text("Schreiben")');
    await p.locator('button', { hasText: 'Vorschau' }).click();
    await p.waitForSelector('.ko-brief');
    await p.locator('button', { hasText: 'Erstellen & drucken' }).click();
    await p.waitForFunction(() => window.__gedruckt && window.__gedruckt.length === 1);
    const text = await p.evaluate(() => window.__gedruckt[0]);
    assert.match(text, /Bestätigung Ihres Austritts/);
    assert.match(text, new RegExp(ausgetreten.nachname));
    assert.strictEqual(ui.objekte('Anschreiben').length, 1);
    await p.locator('.reiter button', { hasText: 'Erstellte Schreiben' }).click();
    await p.waitForSelector('text=Bestätigung Ihres Austritts');
    // Reiter im Mitglied-Detail
    await p.evaluate(id => App.zeige('mitglied', { id }), ausgetreten.mitglied_id);
    await p.locator('.reiter button', { hasText: 'Dokumente & Schreiben' }).click();
    await p.waitForSelector('text=Bestätigung Ihres Austritts');
    await p.locator('button', { hasText: 'Dokument verknüpfen' }).click();
    await p.getByLabel('Titel *').fill('Aufnahmeantrag 2010');
    await p.getByLabel('Link (Google Drive) *').fill('https://example.de/x.pdf');
    await p.locator('dialog button', { hasText: 'Speichern' }).click();
    await p.waitForSelector('text=Nur Links auf Google Drive');
    await p.getByLabel('Link (Google Drive) *').fill('https://drive.google.com/file/d/abc/view');
    await p.locator('dialog button', { hasText: 'Speichern' }).click();
    await p.waitForSelector('.ko-doks a:has-text("Aufnahmeantrag 2010")');
    assert.strictEqual(await p.locator('.ko-doks a', { hasText: 'Aufnahmeantrag 2010' }).getAttribute('rel'), 'noopener noreferrer');
    assert.strictEqual(ui.objekte('Dokument').length, 1);
    const breite = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(breite <= 360, 'waagrechtes Scrollen: ' + breite);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Konto-Detail: Hinweis auf fehlendes SEPA-Mandat; Kassier sieht „Schreiben“, Abteilungsleiter nicht', async () => {
  const ui = await starteOberflaeche({ rolle: 'Kassier', tabs: tabsMitVorlagen() });
  try {
    const p = ui.page;
    const konto = ui.objekte('Beitragskonto').find(k => k.zahlweg === 'Lastschrift' && k.aktiv === 'ja');
    await p.evaluate(() => App.daten.lade('finanzen'));
    await p.evaluate(id => App.zeige('konto', { id }), konto.beitragskonto_id);
    await p.waitForSelector('text=SEPA-Mandat & Dokumente');
    await p.waitForSelector('text=kein unterschriebenes SEPA-Mandat');
    const nav = await p.$$eval('#navigation button', b => b.map(x => x.textContent));
    assert.ok(nav.includes('Schreiben'));
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
  const al = await starteOberflaeche({ rolle: 'Abteilungsleiter', tabs: tabsMitVorlagen() });
  try {
    const nav = await al.page.$$eval('#navigation button', b => b.map(x => x.textContent));
    assert.ok(!nav.includes('Schreiben'));
    const r = await al.page.evaluate(() => App.rufe('apiKorrespondenzVorlagen', App.still).then(() => 'ok', e => e.art));
    assert.strictEqual(r, 'zugriff');
  } finally { await al.schliessen(); }
});

test('Kasse: „Mahnungen erstellen“ im Einzugsstand übergibt die offenen Sollstellungen an „Schreiben“', async () => {
  const { starteOberflaeche } = require('./harness');
  const ui = await starteOberflaeche({ rolle: 'Kassier' });
  try {
    await ui.page.locator('#navigation button', { hasText: 'Finanzen' }).click();
    await ui.page.locator('button', { hasText: 'Mahnungen erstellen' }).click();
    await ui.page.waitForFunction(() => App.aktuell().schluessel === 'korrespondenz');
    const param = await ui.page.evaluate(() => App.aktuell().param);
    assert.strictEqual(param.anlass, 'Mahnung');
    assert.ok(param.sollstellung_ids.length > 0);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});
