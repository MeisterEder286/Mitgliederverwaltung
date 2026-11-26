/**
 * Oberflächentest Kern-Bausteine (client/kern): Fehler erscheinen im offenen Dialog, Knöpfe sind gegen
 * Doppelklick geschützt, Rückfragen enden bei Escape mit „nein“, Erfolgsmeldung mit „Rückgängig“.
 * Läuft mit npm run test:ui (Chromium).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { starteOberflaeche } = require('./harness');

test('Serverfehler bei offenem Dialog erscheint im Dialog', async () => {
  const ui = await starteOberflaeche({ breite: 1000 });
  try {
    await ui.page.evaluate(() => {
      App.dialog('Test', App.el('p', 'Inhalt'), [{ text: 'Los', art: '', aktion: function () {
        return App.rufe('apiMitgliedAdresseUngueltig', 999999, 1, true).catch(function () {});
      } }]);
    });
    await ui.page.locator('dialog').getByRole('button', { name: 'Los' }).click();
    const meldung = ui.page.locator('dialog .dialog-meldung');
    await meldung.waitFor({ state: 'visible' });
    assert.ok((await meldung.textContent()).length > 5);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('App.fehler zeigt die Servermeldung auch für abgelehnte stille Aufrufe', async () => {
  const ui = await starteOberflaeche({ breite: 1000 });
  try {
    const erwartet = await ui.page.evaluate(() => App.rufe('apiMitgliedAdresseUngueltig', 999999, 1, true, App.still)
      .catch(function (err) { App.fehler(err); return err.message; }));
    const text = await ui.page.locator('#meldung').textContent();
    assert.ok(erwartet && erwartet !== 'Fehler' && text.includes(erwartet), text);
  } finally { await ui.schliessen(); }
});

test('Doppelklick löst nur einen Serveraufruf aus', async () => {
  const ui = await starteOberflaeche({ breite: 1000, verzoegerungMs: 300 });
  try {
    await ui.page.evaluate(() => {
      document.getElementById('inhalt').appendChild(App.knopf('Ping', function () { App.rufe('apiPing'); }));
    });
    const vorher = ui.aufrufe.filter(a => a === 'apiPing').length;
    const knopf = ui.page.getByRole('button', { name: 'Ping' });
    await knopf.dblclick();
    await knopf.click();
    assert.strictEqual(await knopf.getAttribute('aria-busy'), 'true');
    await ui.page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    assert.strictEqual(ui.aufrufe.filter(a => a === 'apiPing').length - vorher, 1);
    assert.strictEqual(await knopf.isDisabled(), false);
  } finally { await ui.schliessen(); }
});

test('Rückfrage: Escape ergibt „nein“, Gefahr-Knopf ist rot markiert', async () => {
  const ui = await starteOberflaeche({ breite: 1000 });
  try {
    await ui.page.evaluate(() => { window.__antwort = App.bestaetige('Löschen', 'Wirklich?', 'Löschen', 'gefahr'); });
    const ja = ui.page.locator('dialog').getByRole('button', { name: 'Löschen' });
    assert.match(await ja.getAttribute('class'), /gefahr/);
    await ui.page.keyboard.press('Escape');
    assert.strictEqual(await ui.page.evaluate(() => window.__antwort), false);
    assert.strictEqual(await ui.page.locator('dialog').count(), 0);
  } finally { await ui.schliessen(); }
});

test('Post kam zurück: Erfolgsmeldung mit Rückgängig stellt den alten Stand her', async () => {
  const ui = await starteOberflaeche({ breite: 1000 });
  try {
    const id = await ui.page.evaluate(() => {
      var m = App.daten.liste('mitglieder').filter(function (x) { return x.status_abgeleitet === 'aktiv' && !x.adresse_ungueltig; })[0];
      App.zeige('mitglied', { id: m.mitglied_id });
      return m.mitglied_id;
    });
    await ui.page.getByRole('button', { name: 'Post kam zurück' }).click();
    const meldung = ui.page.locator('#meldung');
    await meldung.getByText('Adresse als ungültig markiert').waitFor();
    assert.strictEqual(await ui.page.evaluate(i => App.daten.hole('mitglieder', i).adresse_ungueltig, id), true);
    await meldung.getByRole('button', { name: 'Rückgängig' }).click();
    await meldung.getByText('wieder als gültig').waitFor();
    assert.notStrictEqual(await ui.page.evaluate(i => App.daten.hole('mitglieder', i).adresse_ungueltig, id), true);
    await ui.page.getByRole('button', { name: 'Post kam zurück' }).waitFor();
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Browser-Zurück: Mitglied → Liste an derselben Scrollstelle; Anker im Verlauf', async () => {
  const ui = await starteOberflaeche({ breite: 1000 });
  const p = ui.page;
  try {
    await p.getByRole('button', { name: 'Mitglieder', exact: true }).click();
    await p.locator('tr.klickbar').first().waitFor();
    await p.getByRole('button', { name: 'Mehr anzeigen' }).first().click();
    const zeile = p.locator('tr.klickbar').nth(40);
    await zeile.scrollIntoViewIfNeeded();
    const y = await p.evaluate(() => window.scrollY);
    assert.ok(y > 300, 'Liste nicht weit genug gescrollt: ' + y);
    await zeile.click();
    await p.waitForFunction(() => App.aktuell().schluessel === 'mitglied');
    assert.match(await p.evaluate(() => location.hash), /^#mitglied\/\d+$/);
    await p.goBack();
    await p.waitForFunction(() => App.aktuell().schluessel === 'mitglieder');
    assert.ok(Math.abs(await p.evaluate(() => window.scrollY) - y) < 80, 'Scrollstelle nicht wiederhergestellt');
    await p.goForward();
    await p.waitForFunction(() => App.aktuell().schluessel === 'mitglied');
    await p.getByRole('button', { name: '← Zurück' }).dblclick();
    await p.waitForFunction(() => App.aktuell().schluessel === 'mitglieder');
    await p.waitForTimeout(800);   // kein verspätetes zweites Zurück
    assert.strictEqual(await p.evaluate(() => App.aktuell().schluessel), 'mitglieder');
    assert.strictEqual(await p.evaluate(() => location.hash), '#mitglieder');
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Ungespeicherte Eingaben: Rückfrage bei Navigation und Browser-Zurück, nach Speichern keine', async () => {
  const ui = await starteOberflaeche({ breite: 1000 });
  const p = ui.page;
  try {
    const id = await p.evaluate(() => App.daten.liste('mitglieder').filter(function (m) { return m.status_abgeleitet === 'aktiv'; })[0].mitglied_id);
    await p.evaluate(i => App.zeige('mitglied', { id: i }), id);
    await p.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    await p.waitForFunction(() => App.aktuell().schluessel === 'mitglied_bearbeiten');
    await p.getByLabel('Titel', { exact: true }).fill('Dr.');
    // Hauptnavigation → Rückfrage, Abbrechen bleibt auf der Seite
    await p.locator('#navigation').getByRole('button', { name: 'Start' }).click();
    await p.locator('dialog').getByRole('button', { name: 'Abbrechen' }).click();
    assert.strictEqual(await p.evaluate(() => App.aktuell().schluessel), 'mitglied_bearbeiten');
    assert.strictEqual(await p.getByLabel('Titel', { exact: true }).inputValue(), 'Dr.');
    // Browser-Zurück → Rückfrage, Abbrechen bleibt ebenfalls
    await p.goBack();
    await p.locator('dialog').getByRole('button', { name: 'Abbrechen' }).click();
    assert.strictEqual(await p.evaluate(() => App.aktuell().schluessel), 'mitglied_bearbeiten');
    // Speichern → danach ohne Rückfrage weiter
    await p.getByRole('button', { name: 'Speichern', exact: true }).click();
    await p.waitForFunction(() => App.aktuell().schluessel === 'mitglied');
    await p.locator('#navigation').getByRole('button', { name: 'Start' }).click();
    await p.waitForFunction(() => App.aktuell().schluessel === 'start');
    assert.strictEqual(await p.locator('dialog').count(), 0);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Kartentabelle unter 600 px: Karten statt Spalten, Sortierauswahl ersetzt die Spaltenköpfe', async () => {
  const ui = await starteOberflaeche({ breite: 360 });
  const p = ui.page;
  try {
    await p.evaluate(() => {
      var inhalt = App.leere(document.getElementById('inhalt'));
      var zeilen = [{ name: 'Berta Beispiel-Langername', ort: 'Ergoldsbach', betrag: 12 }, { name: 'Anton', ort: 'Landshut', betrag: 30 }];
      window.__geklickt = null;
      inhalt.appendChild(App.tabelle([
        { feld: 'name', titel: 'Name' }, { feld: 'ort', titel: 'Wohnort' }, { feld: 'betrag', titel: 'Betrag', zahl: true, wert: function (z) { return App.betrag(z.betrag); } }
      ], zeilen, { karten: true, kartenTitel: 'name', sortiere: 'name', beiKlick: function (z) { window.__geklickt = z.name; } }));
    });
    const tabelle = p.locator('table.karten');
    assert.strictEqual(await tabelle.locator('thead').isVisible(), false);
    assert.strictEqual(await tabelle.locator('td').nth(1).getAttribute('data-titel'), 'Wohnort');
    assert.strictEqual(await tabelle.locator('td').nth(1).evaluate(td => getComputedStyle(td, '::before').content), '"Wohnort"');
    assert.strictEqual(await tabelle.locator('td.kartentitel').first().evaluate(td => getComputedStyle(td, '::before').content), 'none');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'waagrechter Bildlauf');
    assert.ok(await p.evaluate(() => { var r = document.querySelector('.tabelle-rahmen'); return r.scrollWidth <= r.clientWidth; }));
    const namen = () => p.locator('td.kartentitel').allTextContents();
    assert.deepStrictEqual(await namen(), ['Anton', 'Berta Beispiel-Langername']);
    const wahl = p.getByLabel('Sortieren nach');
    assert.strictEqual(await wahl.inputValue(), 'name|auf');
    await wahl.selectOption('betrag|ab');
    assert.deepStrictEqual(await namen(), ['Anton', 'Berta Beispiel-Langername']);
    await wahl.selectOption('ort|ab');
    assert.deepStrictEqual(await namen(), ['Anton', 'Berta Beispiel-Langername']);
    await wahl.selectOption('ort|auf');
    assert.deepStrictEqual(await namen(), ['Berta Beispiel-Langername', 'Anton']);
    await p.locator('tr.klickbar').first().focus();
    await p.keyboard.press('Enter');
    assert.strictEqual(await p.evaluate(() => window.__geklickt), 'Berta Beispiel-Langername');
    await p.setViewportSize({ width: 1280, height: 800 });
    assert.strictEqual(await tabelle.locator('thead').isVisible(), true);
    assert.strictEqual(await wahl.isVisible(), false);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});

test('Formular: Hinweis „* Pflichtfeld“ einmal, Datumseingaben werden vereinheitlicht', async () => {
  const ui = await starteOberflaeche({ breite: 360 });
  const p = ui.page;
  try {
    await p.evaluate(() => {
      window.__formular = App.formular([
        { name: 'a', titel: 'Name', pflicht: true }, { name: 'b', titel: 'Ort', pflicht: true },
        { name: 'd', titel: 'Eintritt', typ: 'datum' }
      ], {});
      App.leere(document.getElementById('inhalt')).appendChild(window.__formular.element);
    });
    assert.strictEqual(await p.locator('form .pflichthinweis').count(), 1);
    assert.strictEqual(await p.locator('form .pflichthinweis').textContent(), '* Pflichtfeld');
    const datum = p.getByLabel('Eintritt');
    await datum.pressSequentially('01012026');
    assert.strictEqual(await datum.inputValue(), '01.01.2026');
    const blur = async (text) => { await datum.fill(text); await datum.blur(); return datum.inputValue(); };
    assert.strictEqual(await blur('1.1.2026'), '01.01.2026');
    assert.strictEqual(await blur('3.4.1985'), '03.04.1985');
    assert.strictEqual(await blur('1.1.26'), '1.1.26');   // zweistellige Jahre werden nicht geraten
    assert.strictEqual(await blur('2026-02-03'), '03.02.2026');
    assert.strictEqual(await blur('quatsch'), 'quatsch');
    await datum.fill('5.6.2026');
    assert.strictEqual(await p.evaluate(() => window.__formular.werte().d), '2026-06-05');
    assert.strictEqual(await p.evaluate(() => App.formular([{ name: 'x', titel: 'X' }]).element.querySelector('.pflichthinweis')), null);
    assert.deepStrictEqual(ui.fehler, []);
  } finally { await ui.schliessen(); }
});