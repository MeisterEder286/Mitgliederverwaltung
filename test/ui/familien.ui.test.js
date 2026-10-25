/**
 * Oberflächentest Familien & Zahlungen: Familien-Ansicht (alle Reiter), Umstellung eines Ausscheiders auf
 * Einzelbeitrag, Reiter „Zahlungen“ im Mitglied-Detail, Zahlungshistorie im Konto-Detail, Finanzen-Reiter
 * „Rechnungen“/„Jahresübersicht“; 360 px ohne waagrechtes Scrollen, keine JS-Fehler. Läuft mit npm run test:ui.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');
const { erzeugeVerein } = require('../daten/generator');
const { isoZuSerial } = require('../hilfe/gas-fakes');

async function breiteOk(ui) {
  const b = await ui.page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(b <= 360, 'waagrechtes Scrollen: ' + b);
}

/** Synthetischer Verein, in dem ein Kind sicher 2027 aus der Familie fällt (Geburtsdatum auf 2008-05-10 gesetzt). */
function vereinMitAusscheider() {
  const tabs = erzeugeVerein({ seed: 1, mitglieder: 300 }).tabs;
  const m = tabs.Mitglied, k = m[0];
  const gemeinschaft = {};
  m.slice(1).forEach(z => { const g = z[k.indexOf('beitragsgemeinschaft_id')]; if (g) (gemeinschaft[g] = gemeinschaft[g] || []).push(z); });
  const familie = Object.values(gemeinschaft).find(l => l.length >= 3);
  const kind = familie.slice().sort((a, b) => b[k.indexOf('geburtsdatum')] - a[k.indexOf('geburtsdatum')])[0];
  kind[k.indexOf('geburtsdatum')] = isoZuSerial('2008-05-10');
  return { tabs, kindId: kind[k.indexOf('mitglied_id')] };
}

test('Familien: Übersicht, Ausscheider umstellen, Ausbildung, Prognose (Mitgliederverwalter, 360 px)', async () => {
  const { tabs, kindId } = vereinMitAusscheider();
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter', tabs });
  try {
    await ui.page.locator('#navigation button', { hasText: 'Familien' }).click();
    await ui.page.waitForSelector('.fam-karte');
    await breiteOk(ui);
    await ui.page.getByRole('tab', { name: 'Fallen heraus' }).click();
    await ui.page.waitForSelector('text=Auf Einzelbeitrag umstellen');
    await breiteOk(ui);
    const vorher = ui.objekte('Mitglied').find(m => m.mitglied_id === kindId);
    assert.ok(vorher.beitragsgemeinschaft_id, 'Kind ist in der Familie');
    await ui.page.locator('button', { hasText: 'Auf Einzelbeitrag umstellen' }).click();
    await ui.page.locator('dialog button', { hasText: 'Umstellen' }).click();
    await ui.page.waitForSelector('.meldung:not([hidden])');
    const nachher = ui.objekte('Mitglied').find(m => m.mitglied_id === kindId);
    assert.strictEqual(nachher.beitragsgemeinschaft_id, '', 'aus der Gemeinschaft genommen');
    assert.ok(nachher.beitragsart_id, 'Einzelbeitrag gesetzt');
    assert.strictEqual(nachher.beitragskonto_id, vorher.beitragskonto_id, 'gleiches Konto');
    await ui.page.getByRole('tab', { name: 'Ausbildung/Studium' }).click();
    await ui.page.waitForSelector('text=mit Ausbildung/Studium');
    await ui.page.getByRole('tab', { name: 'Prognose' }).click();
    await ui.page.waitForSelector('.fam-balken svg');
    await breiteOk(ui);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Mitglied-Detail: Reiter „Zahlungen“ mit Historie und Ausbildung erfassen; Konto-Detail mit Zahlungshistorie', async () => {
  const { tabs } = vereinMitAusscheider();
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter', tabs });
  try {
    const m = ui.objekte('Mitglied').find(x => x.beitragsgemeinschaft_id && x.beitragskonto_id);
    await ui.page.evaluate(id => App.zeige('mitglied', { id: id, reiter: 'zahlungen' }), m.mitglied_id);
    await ui.page.waitForSelector('text=Zahlungshistorie (alle Jahre)');
    await ui.page.waitForSelector('text=Einzelne Sollstellungen');
    await breiteOk(ui);
    // Ausbildung erfassen
    await ui.page.getByLabel('Schule/Studium/Ausbildung').selectOption('Studium');
    await ui.page.getByLabel('voraussichtlich bis (prognostiziert)').fill('30.09.2028');
    await ui.page.locator('button', { hasText: 'Ausbildung speichern' }).click();
    for (let i = 0; i < 50 && ui.objekte('Mitglied').find(x => x.mitglied_id === m.mitglied_id).ausbildung_art !== 'Studium'; i++) await ui.page.waitForTimeout(100);
    const neu = ui.objekte('Mitglied').find(x => x.mitglied_id === m.mitglied_id);
    assert.strictEqual(neu.ausbildung_art, 'Studium');
    // Konto-Detail
    await ui.page.evaluate(id => App.daten.lade('finanzen').then(() => App.zeige('konto', { id: id })), m.beitragskonto_id);
    await ui.page.waitForSelector('text=Zahlungshistorie (alle Jahre)');
    await ui.page.locator('button', { hasText: /^Anzeigen$/ }).click();
    await ui.page.waitForFunction(() => Array.from(document.querySelectorAll('th')).some(t => /Gebühren/.test(t.textContent)));
    await breiteOk(ui);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Finanzen: Rechnungen und Jahresübersicht (Kasse); Abteilungsleiter sieht weder Familien noch Zahlungen', async () => {
  const ui = await starteOberflaeche({ rolle: 'Kassier' });
  try {
    await ui.page.locator('#navigation button', { hasText: 'Finanzen' }).click();
    await ui.page.getByRole('tab', { name: 'Rechnungen' }).click();
    await ui.page.waitForSelector('text=offene Rechnungen');
    await ui.page.getByRole('tab', { name: 'Jahresübersicht' }).click();
    await ui.page.waitForSelector('text=Summen aller Beitragsjahre');
    await breiteOk(ui);
    // Kasse darf nicht umstellen: Knopf fehlt
    await ui.page.locator('#navigation button', { hasText: 'Familien' }).click();
    await ui.page.getByRole('tab', { name: 'Fallen heraus' }).click();
    await ui.page.waitForSelector('text=aus dem Familienbeitrag heraus');
    assert.strictEqual(await ui.page.locator('button', { hasText: 'Auf Einzelbeitrag umstellen' }).count(), 0);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
  const al = await starteOberflaeche({ rolle: 'Abteilungsleiter' });
  try {
    const nav = await al.page.$$eval('#navigation button', b => b.map(x => x.textContent));
    assert.ok(!nav.includes('Familien'));
    const a = await al.page.evaluate(() => new Promise(r => google.script.run.withSuccessHandler(r).apiFamilieBezahlhistorie(1)));
    assert.strictEqual(a.ok, false);
    assert.strictEqual(a.fehler.art, 'zugriff');
  } finally { await al.schliessen(); }
});
