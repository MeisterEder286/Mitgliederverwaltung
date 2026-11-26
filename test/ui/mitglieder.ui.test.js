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
  // Gruppe der Hauptnavigation, sonst Unterreiter, sonst die Ansicht mit diesem Titel direkt (z. B. aus einem Detail)
  const knopf = ui.page.locator('#navigation button:visible, .unterreiter button', { hasText: text });
  if (await knopf.count()) { await knopf.first().click(); return; }
  const k = await ui.page.evaluate(t => App.sichtbareAnsichten().find(s => App.titelVon(s) === t), text);
  assert.ok(k, 'Ansicht „' + text + '“ für diese Rolle nicht erreichbar');
  await ui.oeffne(k);
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
    for (const r of ['Mitgliedschaft & Abteilungen', 'Beitrag & Zahlungen', 'Nachweise & Ehrungen', 'Einwilligungen', 'Dokumente & Notizen', 'Stammdaten']) {
      await ui.page.getByRole('tab', { name: r, exact: true }).click();
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

test('Mitglied-Detail: sechs zusammengefasste Reiter, Abschnitte, alte Reiter-Schlüssel', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter', breite: 1000 });
  try {
    const p = ui.page;
    const m = ui.objekte('Mitglied').find(x => x.status === 'aktiv' && x.beitragskonto_id);
    await p.evaluate(id => App.zeige('mitglied', { id }), m.mitglied_id);
    await p.waitForSelector('.mv-kopf');
    const reiter = await p.$$eval('[role=tab]', b => b.map(x => x.textContent));
    assert.deepStrictEqual(reiter, ['Stammdaten', 'Mitgliedschaft & Abteilungen', 'Beitrag & Zahlungen', 'Nachweise & Ehrungen', 'Einwilligungen', 'Dokumente & Notizen']);
    await p.getByRole('tab', { name: 'Mitgliedschaft & Abteilungen' }).click();
    assert.strictEqual(await p.getByRole('tab', { name: 'Mitgliedschaft & Abteilungen' }).getAttribute('aria-selected'), 'true');
    const abschnitte = await p.$$eval('[role=tabpanel] .mv-teil > h2', h => h.map(x => x.textContent));
    assert.deepStrictEqual(abschnitte, ['Mitgliedschaft', 'Abteilungen', 'Funktionen']);
    await p.waitForFunction(() => !document.querySelector('[role=tabpanel] .laedt'));
    // alter Schlüssel 'zahlungen' → „Beitrag & Zahlungen“, Abschnitt vorhanden
    await p.evaluate(id => App.zeige('mitglied', { id, reiter: 'zahlungen' }), m.mitglied_id);
    await p.waitForSelector('#mitglied-teil-zahlungen');
    assert.strictEqual(await p.getByRole('tab', { name: 'Beitrag & Zahlungen' }).getAttribute('aria-selected'), 'true');
    assert.deepStrictEqual(await p.$$eval('[role=tabpanel] .mv-teil > h2', h => h.map(x => x.textContent)), ['Beitrag', 'Zahlungen']);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Mitglied-Detail als Abteilungsleiter: weniger Reiter, alle ohne Fehler', async () => {
  const ui = await starteOberflaeche({ rolle: 'Abteilungsleiter', breite: 1000 });
  try {
    const p = ui.page;
    await p.waitForSelector('#navigation button');
    const id = await p.evaluate(() => App.daten.liste('mitglieder')[0].mitglied_id);
    await p.evaluate(x => App.zeige('mitglied', { id: x, reiter: 'zahlungen' }), id);
    await p.waitForSelector('.mv-kopf');
    const reiter = await p.$$eval('[role=tab]', b => b.map(x => x.textContent));
    assert.ok(reiter.length < 6 && reiter.includes('Stammdaten') && reiter.includes('Mitgliedschaft & Abteilungen'), reiter.join(', '));
    assert.ok(!reiter.includes('Beitrag & Zahlungen'));
    assert.strictEqual(await p.locator('[role=tab][aria-selected=true]').textContent(), 'Stammdaten', 'unsichtbarer Teil → erster Reiter');
    for (const r of reiter) {
      await p.getByRole('tab', { name: r, exact: true }).click();
      await p.waitForFunction(() => !document.querySelector('[role=tabpanel] .laedt'));
    }
    assert.strictEqual(await p.locator('text=Konnte nicht angezeigt werden.').count(), 0);
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

test('Alter Reiter-Schlüssel „notizen“: springt zum Abschnitt, auch wenn Abschnitte darüber nachladen', async () => {
  const ui = await starteOberflaeche({ breite: 1000, verzoegerungMs: 300 });
  try {
    const p = ui.page;
    const id = await p.evaluate(() => App.daten.liste('mitglieder').filter(function (m) { return m.status_abgeleitet === 'aktiv'; })[0].mitglied_id);
    await p.evaluate(i => App.zeige('mitglied', { id: i, reiter: 'notizen' }), id);
    await p.waitForTimeout(1800);   // Dokumente darüber laden verzögert nach
    assert.strictEqual(await p.getByRole('tab', { selected: true }).textContent(), 'Dokumente & Notizen');
    const [oben, y, max] = await p.evaluate(() => [document.getElementById('mitglied-teil-notizen').getBoundingClientRect().top, scrollY, document.documentElement.scrollHeight - innerHeight]);
    // ganz oben – oder so weit unten wie möglich, wenn die Seite dafür zu kurz ist
    assert.ok(Math.abs(oben) < 40 || (max > 0 && y >= max - 2), 'Abschnitt Notizen nicht angesprungen: top ' + oben + ', scrollY ' + y + '/' + max);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});
