/**
 * Tests für src/Einstieg.js mit Platzhaltern (Stubs) für Api, Zugriff, Konfig, DB, Messung,
 * HtmlService und ScriptApp. Geprüft wird die Verdrahtung: Rollenprüfung über Api.ausfuehren,
 * Einbettung der Startdaten (inkl. Schutz gegen </script>), generische Fehlerseite,
 * Funktionskonto-Pflicht für setup/triggerEinrichten.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { rein } = require('./hilfe/projekt');

function lade(optionen) {
  const o = Object.assign({ einbetten: 'ja', zugriff: true, funktionskonto: true }, optionen);
  const protokoll = { aktionen: [], templates: [], trigger: [], messungen: null, setup: 0 };
  const ktx = { email: 'kassier@tsv.example', name: 'Rita <b>', rollen: ['Kassier'], abteilungen: [], aktionen: ['start'], sicht: ['intern'] };

  function template(datei) {
    const t = { datei, evaluate() {
      const ausgabe = { titel: null, meta: {}, setTitle(x) { this.titel = x; return this; },
        addMetaTag(k, v) { this.meta[k] = v; return this; }, template: t };
      protokoll.templates.push(t);
      return ausgabe;
    } };
    return t;
  }
  const ctx = vm.createContext({
    console,
    Api: { ausfuehren(name, aktion, fn) {
      protokoll.aktionen.push([name, aktion]);
      if (!o.zugriff) return { ok: false, fehler: { art: 'zugriff', meldung: 'Kein Zugriff', nr: 'X1' } };
      try { return { ok: true, daten: fn(ktx), messung: {} }; }
      catch (e) { return { ok: false, fehler: { art: 'intern', meldung: 'intern' } }; }
    } },
    Zugriff: { nurFunktionskonto() { if (!o.funktionskonto) throw new Error('kein Zugriff'); } },
    Konfig: {
      alle() { return { snapshot_einbetten: o.einbetten, beitragsjahr: '2026', impressum_url: 'https://x/impressum', datenschutz_url: 'https://x/ds' }; },
      wert(k) { return this.alle()[k]; }
    },
    Schema: { TABELLEN: { Abteilung: { spalten: [{ name: 'bezeichnung', typ: 'Text', sicht: 'intern' }] } }, LISTEN: { ja_nein: ['ja', 'nein'] } },
    Rechte: { sichtbareSpalten() { return ['bezeichnung']; } },
    Snapshot: { fuerClient() { return { bereiche: ['kern'], listen: { abteilungen: { k: ['abteilung_id', 'bezeichnung', 'aktiv', 'version'], z: [[1, 'Fußball</script>', true, 1]] }, mitglieder: { k: [], z: [] } } }; } },
    DB: { lese(tabs) { return { Abteilung: [{ abteilung_id: 1, bezeichnung: 'Fußball</script>', aktiv: true, version: 1 }] }; },
      jetzt() { return '2026-10-25T10:00:00'; } },
    Messung: { auswertung() { return [{ funktion: 'apiPing' }]; }, clientWerte(l) { protokoll.messungen = l; } },
    Setup: { ausfuehren() { protokoll.setup++; return 'Bericht'; } },
    HtmlService: { createTemplateFromFile: template, createHtmlOutputFromFile(n) { return { getContent: () => '<!-- ' + n + ' -->' }; } },
    ScriptApp: {
      getProjectTriggers() { return [{ getHandlerFunction: () => 'messungSchreiben', id: 'alt' }, { getHandlerFunction: () => 'anderes' }]; },
      deleteTrigger(t) { protokoll.trigger.push(['geloescht', t.id]); },
      newTrigger(f) {
        const t = { f, takt: null };
        const b = {
          timeBased() { return b; },
          everyHours(h) { t.takt = h + 'h'; return b; },
          everyDays(d) { t.takt = d + 'd'; return b; },
          atHour(h) { t.takt += '@' + h; return b; },
          inTimezone() { return b; },
          create() { protokoll.trigger.push(['neu', t.f, t.takt]); }
        };
        return b;
      }
    }
  });
  new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'src', 'Einstieg.js'), 'utf8')).runInContext(ctx);
  return { g: ctx, protokoll };
}

test('doGet bettet rollengeprüfte Startdaten ein und maskiert < gegen Skript-Ausbruch', () => {
  const { g, protokoll } = lade();
  const seite = g.doGet({});
  assert.deepStrictEqual(rein(protokoll.aktionen[0]), ['doGet', 'start']);
  assert.strictEqual(seite.template.datei, 'client/index');
  assert.strictEqual(seite.titel, 'Mitgliederverwaltung TSV Ergoldsbach');
  assert.strictEqual(seite.meta.viewport, 'width=device-width, initial-scale=1');
  const json = seite.template.startdatenJson;
  assert.ok(!json.includes('<'), 'kein rohes < im eingebetteten JSON');
  const daten = JSON.parse(json);
  assert.strictEqual(daten.abteilungen[0].bezeichnung, 'Fußball</script>');
  assert.deepStrictEqual(Object.keys(daten.abteilungen[0]).sort(), ['aktiv', 'bezeichnung', 'id']);
  assert.strictEqual(daten.beitragsjahr, '2026');
  assert.ok(daten.snapshot && daten.snapshot.listen && daten.snapshot.listen.mitglieder, 'Snapshot eingebettet (Spaltenform)');
  assert.strictEqual(daten.heute, '2026-10-25');
  assert.deepStrictEqual(daten.benutzer.rollen, ['Kassier']);
});

test('doGet ohne Einbettung liefert leeren Startdaten-Block', () => {
  const { g } = lade({ einbetten: 'nein' });
  assert.strictEqual(g.doGet({}).template.startdatenJson, '');
});

test('doGet ohne Berechtigung zeigt die generische Seite', () => {
  const { g } = lade({ zugriff: false });
  const seite = g.doGet({});
  assert.strictEqual(seite.template.datei, 'client/kein_zugang');
  assert.strictEqual(seite.template.zugriff, true);
  assert.strictEqual(seite.template.impressumUrl, 'https://x/impressum');
});

test('api-Funktionen laufen über Api.ausfuehren mit der richtigen Aktion', () => {
  const { g, protokoll } = lade();
  assert.strictEqual(g.apiPing().daten.pong, true);
  g.apiMessungen();
  g.apiStart();
  g.apiClientMessungen(new Array(250).fill({ funktion: 'x', client_ms: 1 }));
  assert.deepStrictEqual(rein(protokoll.aktionen), [
    ['apiPing', 'start'], ['apiMessungen', 'messung_lesen'], ['apiStart', 'start'], ['apiClientMessungen', 'start']
  ]);
  assert.strictEqual(protokoll.messungen.length, 200, 'höchstens 200 Client-Messungen je Aufruf');
  g.apiClientMessungen('kein Array');
  assert.strictEqual(protokoll.messungen.length, 0);
});

test('setup und triggerEinrichten nur für das Funktionskonto', () => {
  const fremd = lade({ funktionskonto: false });
  assert.throws(() => fremd.g.setup());
  assert.throws(() => fremd.g.triggerEinrichten());
  assert.strictEqual(fremd.protokoll.setup, 0);
  assert.deepStrictEqual(fremd.protokoll.trigger, []);

  const eigen = lade();
  assert.strictEqual(eigen.g.setup(), 'Bericht');
  eigen.g.triggerEinrichten();
  assert.deepStrictEqual(rein(eigen.protokoll.trigger), [['geloescht', 'alt'], ['neu', 'messungSchreiben', '1h'], ['neu', 'wartungNachts', '1d@2']]);
});

test('messungSchreiben wirft nie (Trigger), auch ohne Berechtigung', () => {
  const { g } = lade({ funktionskonto: false });
  assert.doesNotThrow(() => g.messungSchreiben());
});
