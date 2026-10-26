/**
 * Oberflächentests: echte Browser-Oberfläche (Chromium über Playwright) gegen den ECHTEN Servercode in Node.
 *
 * Jeder google.script.run-Aufruf im Browser wird über eine Brücke (page.exposeFunction) an die gleichnamige
 * öffentliche Funktion des in Node geladenen Projekts weitergereicht (gegen test/hilfe/gas-fakes, synthetische
 * Daten aus test/daten/generator.js). Damit lassen sich ganze Abläufe testen: anmelden als Rolle X, klicken,
 * speichern, und danach in den Fake-Tabellen nachsehen, was geschrieben wurde.
 *
 *   const { starteOberflaeche } = require('./harness');
 *   const ui = await starteOberflaeche({ rolle: 'Mitgliederverwalter' });
 *   await ui.page.getByRole('button', { name: 'Mitglieder' }).click();
 *   ui.daten('Mitglied')          // rohe Zeilen der Fake-Tabelle
 *   ui.fehler                     // JavaScript-Fehler der Seite (sollte leer bleiben)
 *   await ui.schliessen();
 *
 * Optionen: rolle (erste Benutzerzeile mit dieser Rolle), email (statt rolle), seed, mitglieder (Standard 300 für
 * schnellere Tests), breite (Standard 360 = Mobil), tabs (eigene Tabellen statt Generator), verzoegerungMs.
 * Ausführen: npm run test:ui
 */
'use strict';
const { chromium } = require('playwright');
const { ladeProjekt, rein } = require('../hilfe/projekt');
const { erzeugeFakes } = require('../hilfe/gas-fakes');
const { erzeugeVerein } = require('../daten/generator');
const { baueSeite } = require('../../tools/seite');

const STUB = `<script>
window.google = { script: { run: (function () {
  function laeufer(ok, fehl) {
    return new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (h) { return laeufer(h, fehl); };
      if (name === 'withFailureHandler') return function (h) { return laeufer(ok, h); };
      return function () {
        var args = Array.prototype.slice.call(arguments);
        window.__gas(String(name), JSON.stringify(args)).then(function (text) {
          var a = JSON.parse(text);
          if (a && a.__ausnahme) { if (fehl) fehl(new Error(a.__ausnahme)); } else if (ok) ok(a);
        });
      };
    } });
  }
  return laeufer();
})() } };
</script>`;

async function starteOberflaeche(opt) {
  opt = opt || {};
  const tabs = opt.tabs || erzeugeVerein({ seed: opt.seed || 1, mitglieder: opt.mitglieder || 300 }).tabs;
  let email = opt.email;
  if (!email) {
    const k = tabs.Benutzer[0];
    const z = tabs.Benutzer.slice(1).find(r => r[k.indexOf('rolle')] === (opt.rolle || 'Mitgliederverwalter'));
    if (!z) throw new Error('Keine Benutzerzeile mit Rolle ' + opt.rolle);
    email = z[k.indexOf('email')];
  }
  const f = erzeugeFakes({ tabs, email, eigentuemer: 'verwaltung@tsv-ergoldsbach.de', properties: opt.properties, weitereDateien: opt.weitereDateien });
  const g = ladeProjekt(f.globale);
  const start = g.apiStart();
  if (!start.ok) throw new Error('apiStart: ' + JSON.stringify(start.fehler));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: opt.breite || 360, height: 800 } });
  const fehler = [];
  const aufrufe = [];
  page.on('pageerror', e => fehler.push(e.message));
  page.on('console', m => { if (m.type() === 'error') fehler.push(m.text()); });
  page.on('dialog', d => d.accept());
  // Downloads (CSV, XML) abfangen
  const downloads = [];
  page.on('download', async d => { downloads.push({ name: d.suggestedFilename(), pfad: await d.path() }); });
  await page.exposeFunction('__gas', async (name, argsJson) => {
    aufrufe.push(name);
    if (opt.verzoegerungMs) await new Promise(r => setTimeout(r, opt.verzoegerungMs));
    try {
      if (typeof g[name] !== 'function' || !/^api/.test(name)) return JSON.stringify({ __ausnahme: 'Script function not found: ' + name });
      return JSON.stringify(rein(g[name].apply(null, JSON.parse(argsJson))));
    } catch (e) {
      return JSON.stringify({ __ausnahme: String(e && e.message) });
    }
  });
  await page.setContent(baueSeite(start.daten, STUB), { waitUntil: 'load' });
  await page.waitForSelector('#navigation button');
  return {
    page, browser, g, f, email, fehler, aufrufe, downloads,
    daten: tab => f.daten(tab),
    /** Zeilen eines Fake-Tabs als Objekte (Spaltennamen aus der Kopfzeile, Rohwerte). */
    objekte: tab => { const d = f.daten(tab); return d.slice(1).map(z => Object.fromEntries(d[0].map((k, i) => [k, z[i]]))); },
    schliessen: () => browser.close()
  };
}

module.exports = { starteOberflaeche };
