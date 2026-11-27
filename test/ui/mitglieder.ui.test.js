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
    // minderjährig → gesetzliche Vertretung wird abgefragt (hier: jemand außerhalb des Antrags)
    await ui.page.getByLabel('Wer vertritt?').selectOption('frei');
    await ui.page.locator('.mv-vertretung').getByLabel('Name', { exact: true }).fill('Petra Zollner');
    // Wer zahlt: neues Konto; einzige Person ist minderjährig → Kontoinhaber „jemand anderes“ mit Namen
    assert.strictEqual(await ui.page.getByLabel('Kontoinhaber *').inputValue(), 'frei');
    await ui.page.getByLabel('Name des Kontoinhabers').fill('Petra Zollner');
    await ui.page.getByLabel('IBAN', { exact: true }).fill('DE89 3704 0044 0532 0130 00');
    await ui.page.getByLabel('IBAN', { exact: true }).dispatchEvent('change');
    await ui.page.waitForSelector('text=noch kein Konto damit vorhanden');
    await ui.page.locator('button', { hasText: 'Mitglied anlegen' }).click();
    await ui.page.waitForSelector('.mv-kopf');
    const m = ui.objekte('Mitglied').find(x => x.nachname === 'Zollner');
    assert.ok(m, 'angelegt');
    assert.strictEqual(m.status, 'aktiv');
    assert.match(m.briefanrede || '', /Liebe Theresa/);
    assert.strictEqual(m.vertreter_name, 'Petra Zollner');
    assert.ok(ui.objekte('Abteilungszugehoerigkeit').some(z => z.mitglied_id === m.mitglied_id && z.abteilung_id === 2));
    assert.ok(m.beitragsart_id, 'Beitragsart nach Alter vorgeschlagen');
    const k = ui.objekte('Beitragskonto').find(x => x.beitragskonto_id === m.beitragskonto_id);
    assert.ok(k, 'Konto angelegt und zugeordnet');
    assert.strictEqual(k.kontoinhaber_name, 'Petra Zollner');
    assert.strictEqual(k.zahlweg, 'Lastschrift');
    assert.match(String(k.mandatsreferenz), /^TSV-\d{4}-/);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Mitgliederverwalter: Familie aufnehmen, vorhandene IBAN erkennen und Konto mitnutzen', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  const p = ui.page;
  try {
    await navigiere(ui, 'Mitglieder');
    await p.locator('button', { hasText: 'Neues Mitglied' }).click();
    await p.waitForSelector('text=Wer zahlt den Beitrag?');
    await p.getByLabel('Vorname *').fill('Maria');
    await p.getByLabel('Nachname *').fill('Familienprobe');
    await p.getByLabel('Geburtsdatum', { exact: true }).fill('12.03.1984');
    await p.getByLabel('Geburtsdatum', { exact: true }).dispatchEvent('change');
    await p.getByLabel('Ort', { exact: true }).fill('Ergoldsbach');
    // Volljährige: keine gesetzliche Vertretung
    assert.strictEqual(await p.locator('.mv-person').first().locator('.mv-vertretung').isVisible(), false);
    await p.locator('button', { hasText: 'Weitere Person' }).click();
    const kind = p.locator('.mv-person').nth(1);
    assert.strictEqual(await kind.getByLabel('Nachname *').inputValue(), 'Familienprobe', 'Nachname übernommen');
    assert.strictEqual(await kind.getByLabel('Ort', { exact: true }).inputValue(), 'Ergoldsbach', 'Anschrift übernommen');
    await kind.getByLabel('Vorname *').fill('Lena');
    await kind.getByLabel('Geburtsdatum', { exact: true }).fill('01.05.2016');
    await kind.getByLabel('Geburtsdatum', { exact: true }).dispatchEvent('change');
    await kind.locator('.mv-vertretung').waitFor();
    assert.strictEqual(await kind.getByLabel('Wer vertritt?').inputValue(), 'p0', 'Mutter aus dem Antrag vorgeschlagen');
    // IBAN eines vorhandenen Kontos → Hinweis, Konto verwenden
    const konto = ui.objekte('Beitragskonto').find(k => k.iban && (k.aktiv === true || k.aktiv === 'ja'));
    await p.getByLabel('IBAN', { exact: true }).fill(konto.iban);
    await p.getByLabel('IBAN', { exact: true }).dispatchEvent('change');
    await p.waitForSelector('.mv-ibantreffer');
    await p.locator('.mv-ibantreffer button', { hasText: 'Dieses Konto verwenden' }).click();
    assert.strictEqual(await p.locator('#mv-kontowahl').inputValue(), String(konto.beitragskonto_id));
    await keinUeberlauf(ui);
    // Gehört das Konto schon zu einer Gemeinschaft, wird „bestehende“ vorgeschlagen, sonst eine neue Familie
    const gemArt = await p.locator('input[name=mv-gemart]:checked').inputValue();
    if (gemArt !== 'bestehend') {
      assert.strictEqual(gemArt, 'r1', 'mit Kind → Familienbeitrag vorgeschlagen');
      assert.strictEqual(await p.getByLabel('Bezeichnung *').inputValue(), 'Familie Familienprobe');
      assert.strictEqual(await p.getByLabel('Festbetrag', { exact: true }).inputValue(), '180');
      assert.match(await p.locator('.mv-regelpruefung').innerText(), /Passt zur Regel: \d Erwachsene?r?, 1 Kind/);
    }
    await p.locator('button', { hasText: '2 Mitglieder anlegen' }).click();
    await p.waitForSelector('.mv-kopf');
    const neu = ui.objekte('Mitglied').filter(x => x.nachname === 'Familienprobe');
    assert.strictEqual(neu.length, 2);
    const maria = neu.find(x => x.vorname === 'Maria'), lena = neu.find(x => x.vorname === 'Lena');
    assert.strictEqual(maria.beitragskonto_id, konto.beitragskonto_id);
    assert.strictEqual(lena.beitragskonto_id, konto.beitragskonto_id);
    assert.strictEqual(lena.vertreter_mitglied_id, maria.mitglied_id);
    assert.ok(!maria.vertreter_mitglied_id && !maria.vertreter_name);
    assert.ok(lena.beitragsgemeinschaft_id && lena.beitragsgemeinschaft_id === maria.beitragsgemeinschaft_id, 'Familie als Gemeinschaft');
    if (gemArt !== 'bestehend') assert.strictEqual(ui.objekte('Beitragsgemeinschaft').find(g => g.beitragsgemeinschaft_id === lena.beitragsgemeinschaft_id).gemeinschaftsart_id, 1);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Bearbeiten: „Wer zahlt?“ statt Auswahlliste – neues Konto per IBAN; Familienmitglied braucht „ganze Familie“', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  const p = ui.page;
  try {
    const ms = ui.objekte('Mitglied'), zr = ui.objekte('Mitgliedschaftszeitraum');
    const aktiv = m => !m.sterbedatum && zr.some(z => z.mitglied_id === m.mitglied_id && !z.austrittsdatum && !z.austritt_wirksam);
    const einzel = ms.find(m => aktiv(m) && m.beitragskonto_id && !m.beitragsgemeinschaft_id && m.geburtsdatum);
    await p.evaluate(id => App.zeige('mitglied', { id }), einzel.mitglied_id);
    await p.locator('button', { hasText: 'Bearbeiten' }).first().click();
    await p.waitForSelector('text=Wer zahlt den Beitrag?');
    assert.strictEqual(await p.getByLabel('Beitragskonto', { exact: true }).count(), 0, 'keine Auswahlliste Beitragskonto mehr');
    await p.locator('.mv-zahlung label', { hasText: 'Neues Konto anlegen' }).locator('input').check();
    await p.locator('.mv-zahlung').getByLabel('IBAN', { exact: true }).fill('DE02 1203 0000 0000 2020 51');
    await p.locator('.mv-zahlung').getByLabel('IBAN', { exact: true }).dispatchEvent('change');
    await p.waitForSelector('text=noch kein Konto damit vorhanden');
    await keinUeberlauf(ui);
    await p.locator('.knopfleiste button', { hasText: 'Speichern' }).click();
    await p.waitForSelector('.mv-kopf');
    const neu = ui.objekte('Mitglied').find(m => m.mitglied_id === einzel.mitglied_id);
    assert.notStrictEqual(neu.beitragskonto_id, einzel.beitragskonto_id);
    const k = ui.objekte('Beitragskonto').find(x => x.beitragskonto_id === neu.beitragskonto_id);
    assert.strictEqual(k.kontoinhaber_mitglied_id, einzel.mitglied_id);

    // Familienmitglied: anderes Konto → „Ganze Familie wechselt mit“ wird angeboten
    const je = {};
    ms.filter(m => aktiv(m) && m.beitragsgemeinschaft_id).forEach(m => (je[m.beitragsgemeinschaft_id] = je[m.beitragsgemeinschaft_id] || []).push(m));
    const fam = Object.values(je).find(l => l.length >= 2)[0];
    await p.evaluate(id => App.zeige('mitglied', { id }), fam.mitglied_id);
    await p.locator('button', { hasText: 'Bearbeiten' }).first().click();
    await p.waitForSelector('text=Wer zahlt den Beitrag?');
    await p.locator('.mv-zahlung label', { hasText: 'Zahlt über eine andere Person' }).locator('input').check();
    await p.locator('#mv-bz-kontowahl').selectOption({ index: 1 });
    await p.locator('#mv-bz-kontowahl').dispatchEvent('change');
    if (await p.locator('#mv-bz-kontowahl').inputValue() !== String(fam.beitragskonto_id)) {
      await p.waitForSelector('text=Ganze Familie wechselt mit');
      assert.strictEqual(await p.locator('input[name=mv-bz-gemart]:checked').inputValue() !== 'unveraendert', true, 'ohne Familie: Gemeinschaft verlassen');
    }
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
    assert.ok(ui.objekte('Notiz').some(n => /Zahlweg offen/.test(n.text || '') && n.sichtbar_fuer === 'Finanzen'));
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

test('Mitgliederliste: Filter zurücksetzen, Status als Marke mit Symbol', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  try {
    const p = ui.page;
    await navigiere(ui, 'Mitglieder');
    const reset = p.getByRole('button', { name: 'Filter zurücksetzen' });
    assert.strictEqual(await reset.isVisible(), false, 'im Grundzustand kein Zurücksetzen');
    // Status „aktiv“: „davon aktiv“ wäre gleich „angezeigt“ und entfällt
    assert.strictEqual(await p.getByText('davon aktiv').count(), 0);
    await p.locator('.marke.status-aktiv', { hasText: '● aktiv' }).first().waitFor();
    if (!(await p.locator('details.mv-filter').evaluate(d => d.open))) await p.locator('details.mv-filter summary').click();
    await p.selectOption('select[aria-label="Status"]', '');
    await p.fill('.filterleiste input[type=search]', 'zzz-gibt-es-nicht');
    await p.getByText('Keine Mitglieder für diese Auswahl.').waitFor();
    await reset.click();
    assert.strictEqual(await p.inputValue('.filterleiste input[type=search]'), '');
    assert.strictEqual(await p.inputValue('select[aria-label="Status"]'), 'aktiv');
    assert.strictEqual(await reset.isVisible(), false);
    assert.strictEqual(await p.getByText('Keine Mitglieder für diese Auswahl.').count(), 0);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});
test('Neues Mitglied (Kind) zahlt über die Mutter: Familienbeitrag zusammen mit ihr, Beitragsart entfällt', async () => {
  const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
  const p = ui.page;
  try {
    const ms = ui.objekte('Mitglied'), zr = ui.objekte('Mitgliedschaftszeitraum');
    const aktiv = m => !m.sterbedatum && zr.some(z => z.mitglied_id === m.mitglied_id && !z.austrittsdatum && !z.austritt_wirksam);
    const mutter = ms.find(m => aktiv(m) && m.beitragskonto_id && !m.beitragsgemeinschaft_id && m.nachname &&
      !ms.some(x => x !== m && x.beitragskonto_id === m.beitragskonto_id && x.beitragsgemeinschaft_id));
    await p.evaluate(() => App.zeige('mitglied_neu'));
    await p.waitForSelector('text=Wer zahlt den Beitrag?');
    await p.getByLabel('Vorname *').fill('Paul');
    await p.getByLabel('Nachname *').fill(mutter.nachname);
    await p.getByLabel('Geburtsdatum', { exact: true }).fill('01.02.2017');
    await p.getByLabel('Geburtsdatum', { exact: true }).dispatchEvent('change');
    await p.locator('.mv-zahlung label', { hasText: 'Zahlt über eine andere Person' }).locator('input').check();
    await p.locator('#mv-kontowahl').selectOption(String(mutter.beitragskonto_id));
    await p.locator('#mv-kontowahl').dispatchEvent('change');
    await p.waitForSelector('text=Zusammen mit:');
    assert.match(await p.locator('input[name=mv-gemart]:checked').inputValue(), /^r\d+$/);
    assert.strictEqual(await p.getByLabel('Beitragsart', { exact: true }).isDisabled(), true);
    await p.locator('button', { hasText: 'Mitglied anlegen' }).click();
    await p.waitForSelector('.mv-kopf');
    const paul = ui.objekte('Mitglied').find(x => x.vorname === 'Paul' && x.nachname === mutter.nachname);
    const m2 = ui.objekte('Mitglied').find(x => x.mitglied_id === mutter.mitglied_id);
    assert.ok(paul.beitragsgemeinschaft_id && paul.beitragsgemeinschaft_id === m2.beitragsgemeinschaft_id, 'Familie mit der Mutter gebildet');
    assert.ok(!paul.beitragsart_id, 'keine zusätzliche Beitragsart');
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
