/**
 * Tests für src/Datenzugriff.js (DB) mit den Fakes aus test/hilfe/gas-fakes.js.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes, beispielTabs } = require('./hilfe/gas-fakes');

const KTX = { email: 'mv@tsv-ergoldsbach.de' };

function aufbau(opt) {
  const f = erzeugeFakes(Object.assign({
    tabs: beispielTabs(['Mitglied', 'Abteilung', 'Abteilungszugehoerigkeit', 'Funktion', '_Konfig'])
  }, opt || {}));
  const g = ladeProjekt(f.globale);
  return { f, g };
}

function wirft(fn, art) {
  try { fn(); } catch (e) { assert.strictEqual(e.art, art, 'Fehlerart: ' + e.message); return e; }
  assert.fail('Fehler der Art ' + art + ' erwartet');
}

test('lese: mehrere Tabs mit genau einem batchGet, Werte umgewandelt', () => {
  const { f, g } = aufbau();
  const d = g.DB.lese(['Mitglied', 'Abteilung', 'Abteilungszugehoerigkeit']);
  assert.strictEqual(f.zaehler.batchGet, 1);
  assert.strictEqual(f.zaehler.sheets, 1);
  assert.strictEqual(g.DB.zaehler().sheets, 1);
  assert.strictEqual(d.Abteilung.length, 5);
  const wagner = d.Mitglied.find(m => m.mitgliedsnummer === '1042');
  assert.strictEqual(wagner.geburtsdatum, '1978-03-14');
  assert.strictEqual(wagner.ehrenmitglied, false);
  assert.strictEqual(wagner.beitragskonto_id, 1);
  assert.strictEqual(d.Mitglied.find(m => m.mitgliedsnummer === '0873').mitgliedsnummer, '0873');
});

test('lese: Spalten über Namen – vertauschte Reihenfolge und Leerzeilen', () => {
  const tabs = beispielTabs(['Abteilung', '_Konfig']);
  const kopf = tabs.Abteilung[0];
  const umgedreht = tabs.Abteilung.map(z => kopf.map((_, i) => z[kopf.length - 1 - i]));
  umgedreht.splice(2, 0, kopf.map(() => ''));
  const f = erzeugeFakes({ tabs: Object.assign(tabs, { Abteilung: umgedreht }) });
  const g = ladeProjekt(f.globale);
  const abt = g.DB.lese(['Abteilung']).Abteilung;
  assert.strictEqual(abt.length, 5);
  assert.strictEqual(abt.find(a => a.abteilung_id === 4).bezeichnung, 'Stockschützen');
});

test('lese: fehlende DB_ID ist ein interner Fehler', () => {
  const { f, g } = aufbau();
  delete f.properties.DB_ID;
  assert.throws(() => g.DB.lese(['Abteilung']), e => !e.art && /DB_ID/.test(e.message));
});

test('einfuegen: nur unter Sperre, ID aus _Konfig, version 1, geaendert_*', () => {
  const { f, g } = aufbau();
  assert.throws(() => g.DB.einfuegen('Abteilung', { bezeichnung: 'Volleyball', meldepflichtig: true, aktiv: true }, KTX), /mitSperre/);
  const neu = g.DB.mitSperre(() => g.DB.einfuegen('Abteilung',
    { bezeichnung: 'Volleyball', meldepflichtig: true, aktiv: true, abteilung_id: 999, version: 7 }, KTX));
  assert.strictEqual(neu.abteilung_id, 6);           // next_id_Abteilung = 6 in der Startbelegung
  assert.strictEqual(neu.version, 1);
  assert.strictEqual(neu.geaendert_von, KTX.email);
  assert.match(neu.geaendert_am, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  const konfig = f.daten('_Konfig').find(z => z[0] === 'next_id_Abteilung');
  assert.strictEqual(konfig[1], '7');
  const zeile = f.daten('Abteilung')[6];
  assert.strictEqual(zeile[f.daten('Abteilung')[0].indexOf('meldepflichtig')], 'ja');
  assert.strictEqual(f.zaehler.releaseLock, 1);
  assert.ok(f.zaehler.flush >= 1);
  // zweiter Eintrag bekommt die nächste ID
  const zweiter = g.DB.mitSperre(() => g.DB.einfuegen('Abteilung', { bezeichnung: 'Boule', meldepflichtig: false, aktiv: true }, KTX));
  assert.strictEqual(zweiter.abteilung_id, 7);
});

test('einfuegen: Pflichtfelder und Auswahllisten → fachlicher Fehler', () => {
  const { g } = aufbau();
  const e = wirft(() => g.DB.mitSperre(() => g.DB.einfuegen('Abteilungszugehoerigkeit',
    { mitglied_id: 1, status: 'halbaktiv' }, KTX)), 'fachlich');
  assert.match(e.meldung, /Abteilung/);
});

test('einfuegen: Eindeutigkeit (mitglied_id + abteilung_id)', () => {
  const { g } = aufbau();
  wirft(() => g.DB.mitSperre(() => g.DB.einfuegen('Abteilungszugehoerigkeit',
    { mitglied_id: 1, abteilung_id: 1, status: 'aktiv' }, KTX)), 'fachlich');
  const ok = g.DB.mitSperre(() => g.DB.einfuegen('Abteilungszugehoerigkeit',
    { mitglied_id: 1, abteilung_id: 2, status: 'aktiv' }, KTX));
  assert.strictEqual(ok.zugehoerigkeit_id, 16);
});

test('neueId: fehlender Zähler wird aus dem Bestand angelegt', () => {
  const { f, g } = aufbau();
  const konfig = f.daten('_Konfig');
  konfig.splice(konfig.findIndex(z => z[0] === 'next_id_Funktion'), 1);
  const id = g.DB.mitSperre(() => g.DB.neueId('Funktion'));
  assert.strictEqual(id, 16);                          // höchste funktion_id im Beispiel = 15
  assert.ok(f.daten('_Konfig').some(z => z[0] === 'next_id_Funktion' && z[1] === '17'));
  assert.strictEqual(g.DB.mitSperre(() => g.DB.neueId('Funktion')), 17);
});

test('aktualisieren: Version, Diff, Schutz technischer Felder', () => {
  const { f, g } = aufbau();
  const vorher = g.DB.lese(['Abteilung']).Abteilung.find(a => a.abteilung_id === 3);
  assert.strictEqual(vorher.version, null);            // Beispieldaten haben noch keine Version
  const r = g.DB.mitSperre(() => g.DB.aktualisieren('Abteilung', 3,
    { bemerkung: 'Neue Plätze', version: 99, abteilung_id: 77 }, 0, KTX));
  assert.deepStrictEqual(rein(r.diff), [{ feld: 'bemerkung', alt: null, neu: 'Neue Plätze' }]);
  assert.strictEqual(r.neu.version, 1);
  assert.strictEqual(r.neu.abteilung_id, 3);
  const r2 = g.DB.mitSperre(() => g.DB.aktualisieren('Abteilung', 3, { aktiv: false }, 1, KTX));
  assert.strictEqual(r2.neu.version, 2);
  assert.strictEqual(r2.neu.bemerkung, 'Neue Plätze');
  const zeile = f.daten('Abteilung').find(z => z[0] === 3);
  assert.strictEqual(zeile[f.daten('Abteilung')[0].indexOf('aktiv')], 'nein');
});

test('aktualisieren: falsche Version → Konflikt mit aktuellem Stand', () => {
  const { g } = aufbau();
  g.DB.mitSperre(() => g.DB.aktualisieren('Abteilung', 2, { bemerkung: 'A' }, 0, KTX));
  const e = wirft(() => g.DB.mitSperre(() => g.DB.aktualisieren('Abteilung', 2, { bemerkung: 'B' }, 0, KTX)), 'konflikt');
  assert.strictEqual(e.aktuell.bemerkung, 'A');
  assert.strictEqual(e.aktuell.version, 1);
});

test('aktualisieren: ohne Änderung kein Schreiben, unbekannte ID fachlich', () => {
  const { f, g } = aufbau();
  const vorher = f.zaehler.setValues || 0;
  const r = g.DB.mitSperre(() => g.DB.aktualisieren('Abteilung', 1, { bezeichnung: 'Fußball' }, 0, KTX));
  assert.strictEqual(r.diff.length, 0);
  assert.strictEqual(f.zaehler.setValues || 0, vorher);
  wirft(() => g.DB.mitSperre(() => g.DB.aktualisieren('Abteilung', 4711, { bemerkung: 'x' }, 0, KTX)), 'fachlich');
});

test('aktualisieren: Eindeutigkeit auch bei Änderung', () => {
  const { g } = aufbau();
  // Zugehörigkeit 1 (Mitglied 1, Abt. 1) auf Abt. 4 ändern – Mitglied 1 ist dort schon (Zugehörigkeit 2)
  wirft(() => g.DB.mitSperre(() => g.DB.aktualisieren('Abteilungszugehoerigkeit', 1, { abteilung_id: 4 }, 0, KTX)), 'fachlich');
});

test('mitSperre: belegte Sperre → fachlicher Hinweis, Sperre immer freigegeben', () => {
  const { g } = aufbau({ sperreBelegt: true });
  const e = wirft(() => g.DB.mitSperre(() => 1), 'fachlich');
  assert.match(e.meldung, /erneut/);
  const b = aufbau();
  assert.throws(() => b.g.DB.mitSperre(() => { throw new Error('kaputt'); }), /kaputt/);
  assert.strictEqual(b.f.zaehler.releaseLock, 1);
  // danach ist wieder außerhalb der Sperre
  assert.throws(() => b.g.DB.neueId('Abteilung'), /mitSperre/);
});

test('jetzt: Format JJJJ-MM-TTThh:mm:ss', () => {
  const { g } = aufbau();
  assert.match(g.DB.jetzt(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

// ------------------------------------------------------------------ Massenschreiben (W3-K)

function einwilligungen(n, start) {
  return Array.from({ length: n }, (_, i) => ({ mitglied_id: (i % 13) + 1, art: 'Fotos und Videos', erteilt_am: '2026-01-' + String((i % 28) + 1).padStart(2, '0'), umfang: start ? '=SUMME(A1)' : 'nur Vereinsmedien' }));
}

function massenAufbau() {
  return aufbau({ tabs: beispielTabs(['Einwilligung', 'Beitragskonto', 'Mitglied', '_Konfig']) });
}

test('einfuegenViele: feste Zahl an Tabellenzugriffen (5 vs. 500), IDs fortlaufend, Zähler erhöht', () => {
  const messe = (n) => {
    const { f, g } = massenAufbau();
    g.DB.zaehlerZuruecksetzen();
    const vorherFake = f.zaehler.sheets;
    const neu = rein(g.DB.mitSperre(() => g.DB.einfuegenViele('Einwilligung', einwilligungen(n), KTX)));
    // DB-Zähler = Tabellenzugriffe laut Messung; Fake-Zähler zählt zusätzlich jede Range-Methode einzeln
    return { zugriffe: g.DB.zaehler().sheets, fake: f.zaehler.sheets - vorherFake, neu, f, g };
  };
  const klein = messe(5), gross = messe(500);
  assert.strictEqual(klein.zugriffe, gross.zugriffe, 'Zugriffe hängen von der Anzahl ab');
  assert.strictEqual(klein.fake, gross.fake, 'Fake-Aufrufe hängen von der Anzahl ab');
  // inkl. Öffnen, Sperr-Konfig, flush beim Freigeben und flush vor dem Lesen über die Sheets-API in der Sperre
  assert.ok(gross.zugriffe <= 17, 'Zugriffe: ' + gross.zugriffe);
  const ids = gross.neu.map(x => x.einwilligung_id);
  assert.deepStrictEqual(ids, ids.map((_, i) => ids[0] + i));
  assert.ok(gross.neu.every(x => x.version === 1 && x.geaendert_von === KTX.email));
  const zaehler = gross.f.daten('_Konfig').find(z => z[0] === 'next_id_Einwilligung');
  assert.strictEqual(Number(zaehler[1]), ids[ids.length - 1] + 1);
  assert.strictEqual(gross.f.daten('Einwilligung').length - 1, 8 + 500);
});

test('einfuegenViele: Feldfehler mit Feldliste und Eintragsnummer, nichts geschrieben', () => {
  const { f, g } = massenAufbau();
  const vorher = f.daten('Einwilligung').length;
  const liste = einwilligungen(3);
  liste[1].art = 'gibt es nicht';
  const e = wirft(() => g.DB.mitSperre(() => g.DB.einfuegenViele('Einwilligung', liste, KTX)), 'fachlich');
  assert.ok(e.felder && e.felder[0].feld === 'art');
  assert.match(e.felder[0].meldung, /Eintrag 2/);
  assert.strictEqual(f.daten('Einwilligung').length, vorher);
});

test('einfuegenViele: Eindeutigkeit gegen Bestand und innerhalb der neuen Datensätze', () => {
  const { g } = massenAufbau();
  const k = { kontoinhaber_name: 'Test', zahlweg: 'Lastschrift', iban: 'DE89370400440532013000', mandatsreferenz: 'TSV-X-1', mandatsdatum: '2026-01-01' };
  wirft(() => g.DB.mitSperre(() => g.DB.einfuegenViele('Beitragskonto', [k, Object.assign({}, k)], KTX)), 'fachlich');
  wirft(() => g.DB.mitSperre(() => g.DB.einfuegenViele('Beitragskonto', [Object.assign({}, k, { mandatsreferenz: 'TSV-2001-1042' })], KTX)), 'fachlich');
});

test('Eindeutigkeit: leere Schlüssel kollidieren nicht (zwei Überweisungskonten ohne Mandatsreferenz)', () => {
  const { g } = massenAufbau();
  const ueberweisung = n => ({ kontoinhaber_name: 'Überweiser ' + n, zahlweg: 'Überweisung', aktiv: true });
  // Einzeln (DB.einfuegen) – im Bestand gibt es bereits Konto 3 ohne Mandatsreferenz
  g.DB.mitSperre(() => g.DB.einfuegen('Beitragskonto', ueberweisung(1), KTX));
  g.DB.mitSperre(() => g.DB.einfuegen('Beitragskonto', ueberweisung(2), KTX));
  // Sammelweise
  const neu = rein(g.DB.mitSperre(() => g.DB.einfuegenViele('Beitragskonto', [ueberweisung(3), ueberweisung(4)], KTX)));
  assert.strictEqual(neu.length, 2);
});

test('aktualisiereViele: feste Zugriffe, Versionen, Formelschutz für mitgeschriebene Zeilen, Konflikt schreibt nichts', () => {
  const { f, g } = massenAufbau();
  const neu = rein(g.DB.mitSperre(() => g.DB.einfuegenViele('Einwilligung', einwilligungen(500, true), KTX)));
  // jede zweite Zeile ändern → viele verstreute Läufe → ein Block
  const liste = neu.filter((_, i) => i % 2 === 0).map(x => ({ id: x.einwilligung_id, version: 1, aenderungen: { widerrufen_am: '2026-10-01' } }));
  g.DB.zaehlerZuruecksetzen();
  const erg = rein(g.DB.mitSperre(() => g.DB.aktualisiereViele('Einwilligung', liste, KTX)));
  const zugriffe = g.DB.zaehler().sheets;
  assert.strictEqual(erg.length, 250);
  assert.ok(zugriffe <= 8, 'Zugriffe: ' + zugriffe);
  assert.ok(erg.every(e => e.neu.version === 2 && e.diff[0].feld === 'widerrufen_am'));
  // unveränderte, aber mitgeschriebene Zeile: Formeltext bleibt Text (mit Schutz-Apostroph im Sheet)
  const roh = f.daten('Einwilligung');
  const iUmfang = roh[0].indexOf('umfang'), iId = roh[0].indexOf('einwilligung_id');
  const unveraendert = roh.find(z => z[iId] === neu[1].einwilligung_id);
  assert.strictEqual(unveraendert[iUmfang], "'=SUMME(A1)");
  // Konflikt: zweiter Datensatz mit veralteter Version → nichts geschrieben
  const stand = JSON.stringify(f.daten('Einwilligung'));
  const e = wirft(() => g.DB.mitSperre(() => g.DB.aktualisiereViele('Einwilligung', [
    { id: neu[1].einwilligung_id, version: 1, aenderungen: { umfang: 'neu' } },
    { id: neu[0].einwilligung_id, version: 1, aenderungen: { umfang: 'neu' } }]), KTX), 'konflikt');
  assert.strictEqual(e.aktuell.einwilligung_id, neu[0].einwilligung_id);
  assert.strictEqual(JSON.stringify(f.daten('Einwilligung')), stand);
  // ohne Version (Systemlauf) und ohne inhaltliche Änderung → leeres Ergebnis
  assert.deepStrictEqual(rein(g.DB.mitSperre(() => g.DB.aktualisiereViele('Einwilligung', [{ id: neu[1].einwilligung_id, aenderungen: { umfang: '=SUMME(A1)' } }], KTX))), []);
  wirft(() => g.DB.mitSperre(() => g.DB.aktualisiereViele('Einwilligung', [{ id: 999999, aenderungen: { umfang: 'x' } }], KTX)), 'fachlich');
});

test('Massenschreiben und entfernen nur unter Sperre', () => {
  const { g } = massenAufbau();
  assert.throws(() => g.DB.einfuegenViele('Einwilligung', einwilligungen(1), KTX), /mitSperre/);
  assert.throws(() => g.DB.aktualisiereViele('Einwilligung', [{ id: 1, aenderungen: {} }], KTX), /mitSperre/);
  assert.throws(() => g.DB.entfernen('Einwilligung', 1), /mitSperre/);
});

test('entfernen: Zeilen über ID löschen, zusammenhängende in einem Schritt; alle Zeilen löschbar', () => {
  const { f, g } = massenAufbau();
  const vorher = f.daten('Einwilligung').length - 1;
  const n = g.DB.mitSperre(() => g.DB.entfernen('Einwilligung', [2, 3, 4, 7]));
  assert.strictEqual(n, 4);
  const ids = f.daten('Einwilligung').slice(1).map(z => z[0]);
  assert.strictEqual(ids.length, vorher - 4);
  assert.ok(!ids.includes(3) && ids.includes(5));
  assert.strictEqual(f.zaehler.deleteRows, 1);
  assert.strictEqual(g.DB.mitSperre(() => g.DB.entfernen('Einwilligung', ids)), ids.length);
  assert.strictEqual(f.daten('Einwilligung').length, 1, 'nur die Kopfzeile bleibt');
});
