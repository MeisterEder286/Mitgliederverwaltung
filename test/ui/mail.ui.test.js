/**
 * Oberflächentest E-Mail-Versand: Austrittsbestätigung per E-Mail im Testmodus (Kanal je Empfänger, Mail-Vorschau,
 * Bestätigungsdialog, Bericht), Postausgang → Vorbereiten → Senden. Mobil 360 px, keine JS-Fehler.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');
const { erzeugeVerein } = require('../daten/generator');
const { ladeProjekt } = require('../hilfe/projekt');
const { isoZuSerial } = require('../hilfe/gas-fakes');

function heute(plus) {
  const d = new Date(); d.setDate(d.getDate() + (plus || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Verein mit Standardvorlagen, Testmodus (mail_test_an) und einer frisch gekündigten Person mit E-Mail. */
function tabsMitMail() {
  const v = erzeugeVerein({ seed: 1, mitglieder: 300 });
  const sb = ladeProjekt({}).Startbelegung.Vorlage;
  const kopf = v.tabs.Vorlage[0];
  sb.zeilen.forEach(z => v.tabs.Vorlage.push(kopf.map(k => { const i = sb.kopf.indexOf(k); return i < 0 ? (k === 'version' ? 1 : '') : z[i]; })));
  const k = v.tabs._Konfig, iS = k[0].indexOf('schluessel'), iW = k[0].indexOf('wert');
  const setze = (s, w) => { const z = k.find(r => r[iS] === s); if (z) z[iW] = w; else k.push(k[0].map((h, j) => j === iS ? s : j === iW ? w : '')); };
  setze('next_id_Vorlage', String(sb.zeilen.length + 1));
  setze('mail_test_an', 'test@tsv-ergoldsbach.de');
  const mk = v.tabs.Mitglied[0], im = n => mk.indexOf(n);
  const person = v.tabs.Mitglied.slice(1).find(r => r[im('status')] === 'aktiv' && r[im('email')] && r[im('versandart')] === 'E-Mail' &&
    r[im('geburtsdatum')] && r[im('geburtsdatum')] < isoZuSerial('1990-01-01'));
  const zk = v.tabs.Mitgliedschaftszeitraum[0], iz = n => zk.indexOf(n);
  const zr = v.tabs.Mitgliedschaftszeitraum.slice(1).filter(r => r[iz('mitglied_id')] === person[im('mitglied_id')]).pop();
  const ende = isoZuSerial(new Date().getFullYear() + '-12-31');
  zr[iz('kuendigung_eingang')] = isoZuSerial(heute(-2));
  zr[iz('austrittsdatum')] = ende;
  zr[iz('austritt_wirksam')] = ende;
  return { tabs: v.tabs, id: person[im('mitglied_id')], email: person[im('email')], nachname: person[im('nachname')] };
}

async function sendenUndPruefen(ui, p) {
  await p.waitForSelector('text=So sieht die E-Mail aus');
  assert.ok(await p.locator('.ko-mailvorschau', { hasText: '[TEST]' }).count() > 0);
  await p.locator('button', { hasText: /E-Mails senden \(1\)/ }).click();
  await p.waitForSelector('dialog >> text=TESTMODUS');
  await p.locator('dialog button', { hasText: 'Senden' }).click();
  await p.waitForSelector('.ko-bericht');
  assert.strictEqual(ui.f.mails.length, 1);
  assert.strictEqual(ui.f.mails[0].to, 'test@tsv-ergoldsbach.de');
  assert.match(ui.f.mails[0].subject, /^\[TEST\] /);
  const z = ui.objekte('Anschreiben');
  assert.strictEqual(z.length, 1);
  assert.strictEqual(z[0].mail_status, 'testmodus');
}

test('Austrittsbestätigung per E-Mail im Testmodus: Kanal, Vorschau, Bestätigung, Bericht, „Erstellte Schreiben“', async () => {
  const d = tabsMitMail();
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter', tabs: d.tabs });
  try {
    const p = ui.page;
    await p.evaluate(id => App.zeige('korrespondenz', { mitglied_ids: [id], anlass: 'Austrittsbestätigung' }), d.id);
    await p.waitForSelector('text=Testmodus: Alle E-Mails gehen nur an die Testadresse');
    await p.locator('button', { hasText: 'Vorschau' }).click();
    await p.waitForSelector('.ko-kanal select');
    assert.strictEqual(await p.locator('.ko-kanal select').first().inputValue(), 'E-Mail');
    assert.match(await p.locator('button', { hasText: 'Erstellen & drucken' }).textContent(), /\(0\)/);
    await sendenUndPruefen(ui, p);
    await p.locator('.reiter button', { hasText: 'Erstellte Schreiben' }).click();
    await p.waitForSelector('text=E-Mail · testmodus');
    const breite = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(breite <= 360, 'waagrechtes Scrollen: ' + breite);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Postausgang → Vorbereiten → E-Mail senden; danach ist der Vorschlag erledigt', async () => {
  const d = tabsMitMail();
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter', tabs: d.tabs });
  try {
    const p = ui.page;
    await p.locator('#navigation button', { hasText: 'Schreiben' }).click();
    await p.waitForSelector('.reiter button:has-text("Postausgang (")');
    const gruppe = p.locator('.ko-gruppe', { hasText: 'Austrittsbestätigung fehlt' });
    await gruppe.waitFor();
    assert.ok((await gruppe.textContent()).includes(d.nachname));
    await gruppe.locator('button', { hasText: 'Vorbereiten' }).click();
    await p.waitForSelector('button:has-text("Vorschau")');
    await p.locator('.reiter button', { hasText: 'Neues Schreiben' }).first().waitFor();
    // nur ausgewählte Person in der Liste
    await p.locator('button', { hasText: 'Vorschau' }).click();
    await sendenUndPruefen(ui, p);
    await p.locator('.reiter button', { hasText: 'Postausgang' }).click();
    await p.waitForFunction(() => !document.querySelector('[role=tabpanel] .laedt') && document.querySelector('[role=tabpanel] .karte'));
    const offen = await p.locator('.ko-gruppe', { hasText: 'Austrittsbestätigung fehlt' }).count();
    if (offen) assert.ok(!(await p.locator('.ko-gruppe', { hasText: 'Austrittsbestätigung fehlt' }).textContent()).includes(d.nachname));
    const breite = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(breite <= 360, 'waagrechtes Scrollen: ' + breite);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});
