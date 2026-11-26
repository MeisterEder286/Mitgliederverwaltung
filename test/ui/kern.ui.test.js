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
