/**
 * Oberflächentests Mitglieder & Funktionen (Chromium gegen echten Servercode, test/ui/harness.js):
 * Liste/Suche → Detail → Bearbeiten → Speichern; Neues Mitglied; Austritt mit Konto-Guard; Abteilungsleiter
 * (Meine Abteilung, Exaktsuche + Zuordnen, Funktion eintragen) inkl. Negativfällen; mobil 360 px.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

async function navigiere(ui, text) {
  await ui.page.locator('#navigation button', { hasText: text }).first().click();
}
async function keinUeberlauf(ui) {
  const breite = await ui.page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(breite <= 360, 'waagrechtes Scrollen: ' + breite);
}

test('Mitgliederverwalter: suchen, Detail, bearbeiten und speichern', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    const ziel = ui.objekte('Mitglied').find(m => m.nachname && !m.sterbedatum && m.status === 'aktiv');
    await navigiere(ui, 'Mitglieder');
    await ui.page.fill('.filterleiste input[type=search]', String(ziel.mitgliedsnummer));
    await ui.page.waitForTimeout(250);
    await ui.page.locator('tr.klickbar', { hasText: String(ziel.mitgliedsnummer) }).first().click();
    await ui.page.waitForSelector('.mv-kopf');
    assert.match(await ui.page.textContent('.mv-kopf h1'), new RegExp(ziel.nachname));
    await keinUeberlauf(ui);
    // Reiter durchklicken (lädt historie/finanzen nach)
    for (const r of ['Mitgliedschaft', 'Abteilungen', 'Funktionen', 'Beitrag', 'Nachweise', 'Ehrungen', 'Einwilligungen', 'Stammdaten']) {
      await ui.page.locator('.reiter button', { hasText: r }).click();
      await ui.page.waitForTimeout(150);
    }
    await ui.page.locator('button', { hasText: 'Bearbeiten' }).first().click();
    await ui.page.getByLabel('Ort', { exact: true }).fill('Mallersdorf');
    await ui.page.locator('.knopfleiste button', { hasText: 'Speichern' }).click();
    await ui.page.waitForSelector('.mv-kopf');
    const neu = ui.objekte('Mitglied').find(m => m.mitglied_id === ziel.mitglied_id);
    assert.strictEqual(neu.ort, 'Mallersdorf');
    assert.strictEqual(neu.version, (ziel.version || 0) + 1);
    // Feldfehler am Feld: ungültige PLZ
    await ui.page.locator('button', { hasText: 'Bearbeiten' }).first().click();
    await ui.page.getByLabel('PLZ', { exact: true }).fill('123');
    await ui.page.locator('.knopfleiste button', { hasText: 'Speichern' }).click();
    await ui.page.waitForSelector('[aria-invalid="true"]');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Mitgliederverwalter: neues Mitglied mit Abteilung anlegen', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    await navigiere(ui, 'Mitglieder');
    await ui.page.locator('button', { hasText: 'Neues Mitglied' }).click();
    await ui.page.waitForSelector('text=Mitglied anlegen');
    await ui.page.getByLabel('Vorname *').fill('Theresa');
    await ui.page.getByLabel('Nachname *').fill('Zollner');
    await ui.page.getByLabel('Geburtsdatum', { exact: true }).fill('12.03.2012');
    await ui.page.getByLabel('Geburtsdatum', { exact: true }).dispatchEvent('change');
    await ui.page.locator('.mv-abteilungswahl label', { hasText: 'Turnen' }).locator('input').check();
    await ui.page.locator('button', { hasText: 'Mitglied anlegen' }).click();
    await ui.page.waitForSelector('.mv-kopf');
    const m = ui.objekte('Mitglied').find(x => x.nachname === 'Zollner');
    assert.ok(m, 'angelegt');
    assert.strictEqual(m.status, 'aktiv');
    assert.match(m.briefanrede || '', /Liebe Theresa/);
    assert.ok(ui.objekte('Abteilungszugehoerigkeit').some(z => z.mitglied_id === m.mitglied_id && z.abteilung_id === 2));
    assert.ok(m.beitragsart_id, 'Beitragsart nach Alter vorgeschlagen');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Mitgliederverwalter: Austritt eines Kontoinhabers verlangt eine Entscheidung', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    // Kontoinhaber mit weiteren aktiven Zahlern über die Server-Funktion finden
    const kandidat = await ui.page.evaluate(async () => {
      const ms = App.daten.liste('mitglieder').filter(m => m.status_abgeleitet === 'aktiv' && !m.gekuendigt_zum);
      for (const m of ms) {
        const r = await App.rufe('apiMitgliedAustrittVorbereiten', m.mitglied_id, '2026-12-31', App.still);
        if (r.waisen && r.waisen.betroffen) return m.mitglied_id;
      }
      return null;
    });
    assert.ok(kandidat);
    await ui.page.evaluate(id => App.zeige('mitglied', { id }), kandidat);
    await ui.page.locator('button', { hasText: 'Austritt erfassen' }).click();
    await ui.page.waitForSelector('dialog .mv-optionen input[type=radio]');
    await ui.page.locator('dialog button', { hasText: 'Austritt speichern' }).click();
    await ui.page.waitForSelector('dialog .feldfehler:has-text("Möglichkeit")');
    await ui.page.locator('dialog .mv-optionen label', { hasText: 'Zahlweg offen' }).locator('input').check();
    await ui.page.locator('dialog button', { hasText: 'Austritt speichern' }).click();
    await ui.page.waitForSelector('dialog', { state: 'detached' });
    const z = ui.objekte('Mitgliedschaftszeitraum').filter(x => x.mitglied_id === kandidat);
    assert.ok(z.some(x => x.austritt_wirksam), 'Austritt gespeichert');
    assert.ok(ui.objekte('Mitglied').some(m => /Zahlweg offen/.test(m.bemerkung || '')));
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Abteilungsleiter: Meine Abteilung, Exaktsuche + Zuordnen, Funktion eintragen, Negativfälle', async () => {
  const ui = await starteOberflaeche({ rolle: 'Abteilungsleiter' });   // erster AL = Fußball
  try {
    await ui.page.waitForSelector('#navigation button:has-text("Meine Abteilung")');
    await navigiere(ui, 'Meine Abteilung');
    assert.strictEqual(await ui.page.locator('button', { hasText: 'Neues Mitglied' }).count(), 0, 'kein Anlegen für AL');
    await keinUeberlauf(ui);
    // Person ohne Fußball-Bezug suchen und zuordnen
    const sichtbar = await ui.page.evaluate(() => App.daten.liste('mitglieder').map(m => m.mitglied_id));
    const zr = ui.objekte('Mitgliedschaftszeitraum');
    const fremd = ui.objekte('Mitglied').find(m => !sichtbar.includes(m.mitglied_id) && !m.sterbedatum && m.nur_funktionstraeger !== 'ja' &&
      zr.some(z => z.mitglied_id === m.mitglied_id && !z.austrittsdatum && !z.austritt_wirksam));
    await ui.page.getByLabel('Nachname *', { exact: true }).fill(String(fremd.nachname));
    await ui.page.getByLabel('Mitgliedsnummer', { exact: true }).fill(String(fremd.mitgliedsnummer));
    await ui.page.locator('button', { hasText: 'Suchen' }).click();
    await ui.page.waitForSelector('button:has-text("Zuordnen")');
    await ui.page.locator('button', { hasText: 'Zuordnen' }).click();
    await ui.page.waitForSelector('.mv-kopf');
    assert.ok(ui.objekte('Abteilungszugehoerigkeit').some(z => z.mitglied_id === fremd.mitglied_id && z.abteilung_id === 1));
    // Kein Austritt-Knopf, Server weist Austritt und Anlegen ab
    assert.strictEqual(await ui.page.locator('button', { hasText: 'Austritt erfassen' }).count(), 0);
    const arten = await ui.page.evaluate(async (id) => {
      const a = await App.rufe('apiMitgliedAustritt', id, { austritt_wirksam: '2026-12-31' }, App.still).catch(e => e.art);
      const b = await App.rufe('apiMitgliedAnlegen', { mitglied: { vorname: 'X', nachname: 'Y' }, eintrittsdatum: '2026-10-01' }, App.still).catch(e => e.art);
      return [a, b];
    }, fremd.mitglied_id);
    assert.deepStrictEqual(arten, ['zugriff', 'zugriff']);
    // Funktion eintragen über die Funktionen-Ansicht
    await navigiere(ui, 'Funktionen');
    await ui.page.locator('button', { hasText: 'Funktion eintragen' }).first().click();
    await ui.page.waitForSelector('dialog');
    await ui.page.locator('dialog').getByLabel('Person *').selectOption(String(fremd.mitglied_id));
    const trainer = ui.objekte('Funktionsart').find(a => a.ebene === 'Abteilung' && a.aktiv !== 'nein');
    await ui.page.locator('dialog').getByLabel('Funktion *').selectOption(String(trainer.funktionsart_id));
    await ui.page.locator('dialog').getByLabel('Zusatz (Mannschaft/Gruppe)').fill('F-Jugend');
    await ui.page.locator('dialog button', { hasText: 'Eintragen' }).click();
    await ui.page.waitForSelector('dialog', { state: 'detached' });
    assert.ok(ui.objekte('Funktion').some(f => f.mitglied_id === fremd.mitglied_id && f.zusatz === 'F-Jugend' && f.abteilung_id === 1));
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Kassier: Liste lesen ja, Bearbeiten nein (Knopf fehlt, Server weist ab)', async () => {
  const ui = await starteOberflaeche({ rolle: 'Kassier' });
  try {
    await navigiere(ui, 'Mitglieder');
    await ui.page.locator('tr.klickbar').first().click();
    await ui.page.waitForSelector('.mv-kopf');
    assert.strictEqual(await ui.page.locator('.knopfleiste button', { hasText: 'Bearbeiten' }).count(), 0);
    const art = await ui.page.evaluate(async () => {
      const m = App.daten.liste('mitglieder')[0];
      return App.rufe('apiMitgliedSpeichern', m.mitglied_id, m.version, { ort: 'X' }, App.still).then(() => 'ok', e => e.art);
    });
    assert.strictEqual(art, 'zugriff');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('E-Mail-Verteiler: alle aktiven / Abteilung als Adressliste (BCC), Minderjährige über die Vertretung, protokolliert', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    await navigiere(ui, 'Mitglieder');
    await ui.page.locator('button', { hasText: 'Alle aktiven Mitglieder' }).click();
    await ui.page.waitForSelector('dialog textarea');
    const text = (await ui.page.$$eval('dialog textarea', t => t.map(x => x.value))).join('; ');
    const adressen = text.split(/;\s*/).filter(Boolean);
    assert.ok(adressen.length > 0, 'Adressen vorhanden');
    assert.ok(adressen.length <= 50 || (await ui.page.locator('dialog textarea').count()) > 1, 'Blöcke zu 50');
    assert.strictEqual(new Set(adressen.map(a => a.toLowerCase())).size, adressen.length, 'keine doppelten Adressen');
    // Erwartung aus dem Snapshot: Erwachsene mit eigener Adresse, Minderjährige nur über die Vertretung
    const erwartet = await ui.page.evaluate(() => {
      const ok = a => /^[^@\s,;<>()\[\]\\"]+@[^@\s,;<>()\[\]\\"]+\.[A-Za-z]{2,}$/.test(String(a || '').trim());
      const ms = App.daten.liste('mitglieder').filter(m => m.status_abgeleitet === 'aktiv');
      const minder = ms.filter(m => m.alter < 18 && ok(m.email) && !ok(m.vertreter_kontakt) && m.email !== (App.daten.hole('mitglieder', m.vertreter_mitglied_id) || {}).email);
      return { minderEigene: minder.map(m => m.email.trim().toLowerCase()) };
    });
    const klein = new Set(adressen.map(a => a.toLowerCase()));
    // eigene Adresse eines Minderjährigen taucht nur auf, wenn sie zugleich die eines anderen (erwachsenen) Empfängers ist
    const erwachsene = await ui.page.evaluate(() => App.daten.liste('mitglieder').filter(m => !(m.alter < 18)).map(m => String(m.email || '').trim().toLowerCase()));
    erwartet.minderEigene.filter(a => !erwachsene.includes(a)).forEach(a => assert.ok(!klein.has(a), 'Minderjährigen-Adresse nicht direkt: ' + a));
    assert.ok(ui.objekte('_Protokoll').some(x => x.aktion === 'exportiert' && /^mailverteiler: \d+/.test(x.kommentar || '')), 'protokolliert');
    // Trennzeichen umschalten
    await ui.page.locator('dialog').getByLabel('Trennzeichen').selectOption(', ');
    assert.match(await ui.page.locator('dialog textarea').first().inputValue(), /@[^,;]+, /);
    // Weiter zu „Schreiben“ mit Vorauswahl
    await ui.page.locator('dialog button', { hasText: 'Stattdessen über „Schreiben“ senden' }).click();
    await ui.page.waitForSelector('.reiter button[aria-selected="true"]:has-text("Neues Schreiben")');
    // Abteilung
    await navigiere(ui, 'Mitglieder');
    await ui.page.getByLabel('Abteilung für den Verteiler').selectOption({ label: 'Turnen' });
    await ui.page.locator('.knopfleiste button', { hasText: /^Abteilung$/ }).click();
    await ui.page.waitForSelector('dialog h2:has-text("Abteilung Turnen")');
    await keinUeberlauf(ui);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('E-Mail-Verteiler Abteilungsleiter: nur „Meine Abteilung“, nur Adressen aus der eigenen Sicht', async () => {
  const ui = await starteOberflaeche({ rolle: 'Abteilungsleiter' });   // erster AL = Fußball
  try {
    await navigiere(ui, 'Meine Abteilung');
    assert.strictEqual(await ui.page.locator('button', { hasText: 'Alle aktiven Mitglieder' }).count(), 0);
    await ui.page.locator('button', { hasText: 'Meine Abteilung Fußball' }).click();
    await ui.page.waitForSelector('dialog textarea');
    const adressen = (await ui.page.$$eval('dialog textarea', t => t.map(x => x.value))).join('; ').split(/;\s*/).filter(Boolean).map(a => a.toLowerCase());
    const sichtbar = await ui.page.evaluate(() => App.daten.liste('mitglieder').flatMap(m => [m.email, m.vertreter_kontakt]).filter(Boolean).map(a => String(a).trim().toLowerCase()));
    adressen.forEach(a => assert.ok(sichtbar.includes(a), 'nur sichtbare Adressen: ' + a));
    assert.strictEqual(await ui.page.locator('dialog button', { hasText: 'Schreiben' }).count(), 0, 'AL hat kein „Schreiben“');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});
