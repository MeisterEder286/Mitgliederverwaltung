/**
 * Tests für SetupPlan (src/lib/setupplan.js): Einrichtung eines leeren Sheets, Idempotenz,
 * Umgang mit abweichenden Kopfzeilen und Schutz bestehender _Konfig-Werte.
 * Lädt nur Schema, Startbelegung und SetupPlan – unabhängig vom Rest des Projekts.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { rein } = require('./hilfe/projekt');

const SRC = path.join(__dirname, '..', 'src', 'lib');

function lade() {
  const ctx = vm.createContext({ console });
  ['schema.js', 'startbelegung.js', 'setupplan.js'].forEach(d => {
    new vm.Script(fs.readFileSync(path.join(SRC, d), 'utf8'), { filename: d }).runInContext(ctx);
  });
  return ctx;
}

/** Simuliert das Ausführen des Plans: liefert den Ist-Zustand, den ein zweiter Lauf sehen würde. */
function wendeAn(g, vorhanden, plan) {
  const v = JSON.parse(JSON.stringify(vorhanden));
  const daten = {};
  Object.keys(v).forEach(t => { daten[t] = []; });
  plan.schritte.forEach(s => {
    if (s.art === 'tab_anlegen') { v[s.tab] = { kopf: [], zeilen: 0 }; daten[s.tab] = []; }
    if (s.art === 'kopf_schreiben') v[s.tab].kopf = s.kopf.slice();
    if (s.art === 'fehlende_spalten') v[s.tab].kopf = v[s.tab].kopf.concat(s.spalten);
    if (s.art === 'startbelegung' || s.art === 'konfig_ergaenzen') {
      v[s.tab].zeilen = (v[s.tab].zeilen || 0) + s.zeilen.length;
      daten[s.tab] = (daten[s.tab] || []).concat(s.zeilen);
    }
  });
  Object.keys(v).forEach(t => {
    const def = g.Schema.TABELLEN[t];
    if (!def || !daten[t] || !daten[t].length) return;
    const kopf = v[t].kopf;
    if (def.idSpalte) {
      const i = kopf.indexOf(def.idSpalte);
      const ids = daten[t].map(z => z[i]).filter(x => typeof x === 'number');
      if (ids.length) v[t].maxId = Math.max(v[t].maxId || 0, ...ids);
    }
    if (t === '_Konfig') {
      const i = kopf.indexOf('schluessel');
      v[t].schluessel = (v[t].schluessel || []).concat(daten[t].map(z => z[i]));
    }
  });
  return v;
}

test('leeres Sheet: alle Tabs, Köpfe, Formate, Startbelegung, ID-Zähler', () => {
  const g = lade();
  const plan = rein(g.SetupPlan.plane({}));
  const tabs = rein(Object.keys(g.Schema.TABELLEN));

  const angelegt = plan.schritte.filter(s => s.art === 'tab_anlegen').map(s => s.tab);
  assert.deepStrictEqual(angelegt, tabs, 'Reihenfolge wie im Schema');

  const mitglied = plan.schritte.find(s => s.art === 'kopf_schreiben' && s.tab === 'Mitglied');
  assert.deepStrictEqual(mitglied.kopf, rein(g.Schema.TABELLEN.Mitglied.spalten.map(s => s.name)));
  assert.ok(mitglied.kopf.includes('version') && mitglied.kopf.includes('nur_funktionstraeger'));

  const formate = plan.schritte.find(s => s.art === 'formate' && s.tab === 'Mitglied').spalten;
  const fmt = n => formate.find(f => f.name === n).format;
  assert.strictEqual(fmt('plz'), '@');
  assert.strictEqual(fmt('geburtsdatum'), 'dd.MM.yyyy');
  assert.strictEqual(fmt('geaendert_am'), 'dd.MM.yyyy HH:mm');
  assert.strictEqual(fmt('mitglied_id'), '0');
  const beitragsart = plan.schritte.find(s => s.art === 'formate' && s.tab === 'Beitragsart').spalten;
  assert.strictEqual(beitragsart.find(f => f.name === 'betrag').format, '#,##0.00');

  const auswahl = plan.schritte.find(s => s.art === 'auswahl' && s.tab === 'Mitglied').spalten;
  assert.deepStrictEqual(auswahl.find(a => a.name === 'anrede').werte, ['Herr', 'Frau', 'Divers']);
  assert.deepStrictEqual(auswahl.find(a => a.name === 'ehrenmitglied').werte, ['ja', 'nein']);

  const seeds = plan.schritte.filter(s => s.art === 'startbelegung').map(s => s.tab).sort();
  assert.deepStrictEqual(seeds, ['Abteilung', 'Aufbewahrungsfrist', 'Beitragsart', 'Ehrungsregel', 'Funktionsart', 'Qualifikationsart']);

  // Startbelegung typgerecht und in Kopf-Reihenfolge, version = 1
  const ba = plan.schritte.find(s => s.art === 'startbelegung' && s.tab === 'Beitragsart');
  const z0 = Object.fromEntries(ba.kopf.map((k, i) => [k, ba.zeilen[0][i]]));
  assert.strictEqual(z0.beitragsart_id, 1);
  assert.strictEqual(z0.betrag, 100);
  assert.strictEqual(z0.gueltig_ab, 45292); // 01.01.2024 als Seriennummer
  assert.strictEqual(z0.version, 1);
  assert.strictEqual(z0.geaendert_von, 'Setup');

  // _Konfig: Startwerte plus next_id_* aus den TATSÄCHLICHEN Daten (nicht aus der Beispiel-Startbelegung)
  const konfig = plan.schritte.find(s => s.art === 'konfig_ergaenzen');
  const kv = Object.fromEntries(konfig.zeilen.map(z => [z[0], z[1]]));
  assert.strictEqual(kv.beitragsjahr, '2026');
  assert.strictEqual(kv.ehrung_zaehlweise, 'letzter_eintritt');
  assert.strictEqual(kv.next_id_Mitglied, '1', 'leere Datenbank beginnt bei 1');
  assert.strictEqual(kv.next_id_Abteilung, '6', 'nach 5 Start-Abteilungen');
  assert.strictEqual(kv.next_id_Funktionsart, '14');
  assert.strictEqual(kv.next_id_Einwilligung, '1', 'Zähler auch für Tabs, die in der Vorlage fehlten');
  assert.ok(!('next_id__Messung' in kv), 'kein Zähler für Tabs ohne ID-Spalte');
  assert.ok(!('next_id__Konfig' in kv));
  assert.strictEqual(new Set(konfig.schluessel).size, konfig.schluessel.length, 'keine doppelten Schlüssel');

  assert.ok(g.SetupPlan.hatAenderungen(plan));
  assert.match(plan.bericht, /Tab angelegt: Mitglied/);
});

test('zweiter Lauf ist idempotent', () => {
  const g = lade();
  const plan1 = rein(g.SetupPlan.plane({}));
  const nachher = wendeAn(g, {}, plan1);
  const plan2 = rein(g.SetupPlan.plane(nachher));
  assert.deepStrictEqual(plan2.schritte.filter(s => s.aendert), []);
  assert.strictEqual(g.SetupPlan.hatAenderungen(plan2), false);
  assert.match(plan2.bericht, /keine Änderungen nötig/);
});

test('vorhandener Tab: keine Umsortierung, Zusatzspalte gemeldet, fehlende angehängt', () => {
  const g = lade();
  const soll = rein(g.Schema.TABELLEN.Abteilung.spalten.map(s => s.name));
  // vertauscht, ohne "version", mit Zusatzspalte
  const ist = ['bezeichnung', 'abteilung_id', 'notiz_alt', 'blsv_sportart', 'meldepflichtig', 'aktiv', 'bemerkung', 'geaendert_am', 'geaendert_von'];
  const plan = rein(g.SetupPlan.plane({ Abteilung: { kopf: ist, zeilen: 5, maxId: 5 } }));
  const s = plan.schritte.filter(x => x.tab === 'Abteilung');

  assert.ok(!s.some(x => x.art === 'tab_anlegen' || x.art === 'kopf_schreiben'));
  const fehlend = s.find(x => x.art === 'fehlende_spalten');
  assert.deepStrictEqual(fehlend.spalten, soll.filter(n => !ist.includes(n)));
  assert.deepStrictEqual(fehlend.spalten, ['version']);
  assert.strictEqual(fehlend.ab, ist.length + 1);
  assert.deepStrictEqual(s.find(x => x.art === 'unbekannte_spalten').spalten, ['notiz_alt']);
  // Formate nur für die neue Spalte, an ihrer tatsächlichen Position
  assert.deepStrictEqual(s.find(x => x.art === 'formate').spalten, [{ name: 'version', spalte: ist.length + 1, format: '0' }]);
  // keine Startbelegung in einen gefüllten Tab
  assert.ok(!s.some(x => x.art === 'startbelegung'));
  // ID-Zähler aus vorhandenen Daten
  const k = plan.schritte.find(x => x.art === 'konfig_ergaenzen');
  assert.strictEqual(Object.fromEntries(k.zeilen.map(z => [z[0], z[1]])).next_id_Abteilung, '6');
});

test('Startbelegung folgt der vorhandenen Spaltenreihenfolge', () => {
  const g = lade();
  const ist = ['bezeichnung', 'abteilung_id', 'blsv_sportart', 'meldepflichtig', 'aktiv', 'bemerkung', 'version', 'geaendert_am', 'geaendert_von'];
  const plan = rein(g.SetupPlan.plane({ Abteilung: { kopf: ist, zeilen: 0 } }));
  const sb = plan.schritte.find(x => x.art === 'startbelegung' && x.tab === 'Abteilung');
  assert.deepStrictEqual(sb.kopf, ist);
  assert.deepStrictEqual(sb.zeilen[0].slice(0, 2), ['Fußball', 1]);
});

test('bestehende _Konfig-Werte werden nie überschrieben, nur fehlende ergänzt', () => {
  const g = lade();
  const vorhandeneSchluessel = ['beitragsjahr', 'ehrung_zaehlweise', 'next_id_Mitglied'];
  const plan = rein(g.SetupPlan.plane({
    _Konfig: { kopf: ['schluessel', 'wert', 'beschreibung'], zeilen: 3, schluessel: vorhandeneSchluessel },
    Mitglied: { kopf: g.Schema.TABELLEN.Mitglied.spalten.map(s => s.name), zeilen: 1200, maxId: 1500 }
  }));
  const k = plan.schritte.find(x => x.art === 'konfig_ergaenzen');
  vorhandeneSchluessel.forEach(s => assert.ok(!k.schluessel.includes(s), s + ' darf nicht erneut geschrieben werden'));
  assert.ok(k.schluessel.includes('jugend_bis_alter'));
  // _Konfig-Kopf in anderer Reihenfolge: Zeilen folgen dem vorhandenen Kopf
  const plan2 = rein(g.SetupPlan.plane({ _Konfig: { kopf: ['wert', 'schluessel', 'beschreibung'], zeilen: 0 } }));
  const z = plan2.schritte.find(x => x.art === 'konfig_ergaenzen').zeilen.find(r => r[1] === 'beitragsjahr');
  assert.strictEqual(z[0], '2026');
});

test('fremde Tabs werden nur gemeldet', () => {
  const g = lade();
  const plan = rein(g.SetupPlan.plane({ Tabelle1: { kopf: [], zeilen: 0 } }));
  const f = plan.schritte.find(x => x.art === 'fremde_tabs');
  assert.deepStrictEqual(f.tabs, ['Tabelle1']);
  assert.strictEqual(f.aendert, false);
});

test('zelle(): Typumwandlung der Startbelegung', () => {
  const g = lade();
  assert.strictEqual(g.SetupPlan.zelle('2024-01-01', 'Datum'), 45292);
  assert.strictEqual(g.SetupPlan.zelle('2026-08-17T12:00:00', 'Zeitpunkt'), 46251.5);
  assert.strictEqual(g.SetupPlan.zelle('0873', 'Text'), '0873');
  assert.strictEqual(g.SetupPlan.zelle('12.5', 'Dezimal'), 12.5);
  assert.strictEqual(g.SetupPlan.zelle('', 'Ganzzahl'), '');
  assert.strictEqual(g.SetupPlan.zelle('ja', 'ja/nein'), 'ja');
});
