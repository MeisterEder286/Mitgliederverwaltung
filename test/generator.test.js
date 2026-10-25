/**
 * Tests für den Generator synthetischer Vereinsdaten (test/daten/generator.js):
 * Determinismus, Größenordnungen und Konsistenz mit den Prüfregeln des Datenmodells.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { erzeugeVerein, alsObjekte } = require('./daten/generator');
const { ladeProjekt, rein } = require('./hilfe/projekt');

const g = ladeProjekt({});
const T = g.Schema.TABELLEN;
const t0 = Date.now();
const verein = erzeugeVerein({ seed: 1 });
const dauer = Date.now() - t0;
const o = alsObjekte(verein.tabs);

function ibanOk(iban) {
  const s = iban.slice(4) + iban.slice(0, 4);
  const zahl = s.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  return BigInt(zahl) % 97n === 1n;
}

test('deterministisch: gleicher Seed → gleiche Daten, anderer Seed → andere', () => {
  assert.strictEqual(JSON.stringify(erzeugeVerein({ seed: 1 }).tabs), JSON.stringify(verein.tabs));
  assert.notStrictEqual(JSON.stringify(erzeugeVerein({ seed: 2 }).tabs.Mitglied), JSON.stringify(verein.tabs.Mitglied));
});

test('Laufzeit und Größenordnungen', () => {
  assert.ok(dauer < 2000, 'Laufzeit ' + dauer + ' ms');
  assert.ok(o.Mitglied.length >= 1200 && o.Mitglied.length <= 1205);
  assert.ok(o.Beitragskonto.length > 650 && o.Beitragskonto.length < 1000, 'Konten ' + o.Beitragskonto.length);
  assert.ok(o.Beitragsgemeinschaft.length > 120 && o.Beitragsgemeinschaft.length < 280);
  const aktiv = o.Mitglied.filter(m => m.status === 'aktiv').length / o.Mitglied.length;
  assert.ok(aktiv > 0.78 && aktiv < 0.92, 'aktiv ' + aktiv);
  assert.ok(o.Mitglied.some(m => m.status === 'verstorben'));
  const laufend = o.Funktion.filter(f => !f.bis).length;
  assert.ok(laufend >= 35 && laufend <= 50, 'laufende Funktionen ' + laufend);
  assert.ok(o.Funktion.length - laufend >= 100);
  const ext = o.Beitragskonto.filter(k => !k.kontoinhaber_mitglied_id).length;
  assert.ok(ext >= 3 && ext <= 5, 'externe Kontoinhaber ' + ext);
  assert.strictEqual(o.Benutzer.length, 6);
  assert.ok(new Set(o.Benutzer.map(b => b.email)).size === 5, 'eine Person mit zwei Rollen');
});

test('Kopfzeilen = Schema, Mitgliedsnummern 4-stellig mit führenden Nullen', () => {
  Object.keys(T).forEach(t => assert.deepStrictEqual(verein.tabs[t][0], rein(T[t].spalten.map(s => s.name))));
  assert.ok(o.Mitglied.every(m => /^\d{4}$/.test(m.mitgliedsnummer)));
  assert.ok(o.Mitglied.some(m => m.mitgliedsnummer.startsWith('0')));
});

test('IDs eindeutig, Eindeutigkeiten aus dem Schema eingehalten, next_id_ > max ID', () => {
  const konfig = Object.fromEntries(o._Konfig.map(k => [k.schluessel, k.wert]));
  Object.entries(T).forEach(([tab, t]) => {
    const zeilen = o[tab];
    if (t.idSpalte) {
      const ids = zeilen.map(z => z[t.idSpalte]);
      assert.strictEqual(new Set(ids).size, ids.length, tab + ': doppelte ID');
      if (tab !== '_Protokoll') {
        const max = ids.reduce((m, x) => Math.max(m, x), 0);
        assert.ok(Number(konfig['next_id_' + tab]) > max, tab + ': next_id');
      }
    }
    t.eindeutig.forEach(e => {
      // Leere Schlüssel (z. B. keine Mandatsreferenz bei Überweisung) zählen nicht
      const schl = zeilen.filter(z => e.some(sp => z[sp] !== null)).map(z => e.map(sp => z[sp]).join('|'));
      assert.strictEqual(new Set(schl).size, schl.length, tab + ': eindeutig ' + e.join('+'));
    });
  });
});

test('Fremdschlüssel zeigen auf existierende Zeilen', () => {
  const ids = (tab, sp) => new Set(o[tab].map(z => z[sp]));
  const m = ids('Mitglied', 'mitglied_id');
  const pruefe = (tab, sp, ziel) => o[tab].forEach(z => { if (z[sp] !== null) assert.ok(ziel.has(z[sp]), tab + '.' + sp + '=' + z[sp]); });
  ['Mitgliedschaftszeitraum', 'Abteilungszugehoerigkeit', 'Funktion', 'Qualifikation', 'Ehrung', 'Einwilligung'].forEach(t => pruefe(t, 'mitglied_id', m));
  pruefe('Mitglied', 'vertreter_mitglied_id', m);
  pruefe('Mitglied', 'beitragskonto_id', ids('Beitragskonto', 'beitragskonto_id'));
  pruefe('Mitglied', 'beitragsgemeinschaft_id', ids('Beitragsgemeinschaft', 'beitragsgemeinschaft_id'));
  pruefe('Mitglied', 'beitragsart_id', ids('Beitragsart', 'beitragsart_id'));
  pruefe('Beitragskonto', 'kontoinhaber_mitglied_id', m);
  pruefe('Sollstellung', 'beitragskonto_id', ids('Beitragskonto', 'beitragskonto_id'));
  pruefe('Abteilungszugehoerigkeit', 'abteilung_id', ids('Abteilung', 'abteilung_id'));
  pruefe('Funktion', 'funktionsart_id', ids('Funktionsart', 'funktionsart_id'));
  pruefe('Funktion', 'abteilung_id', ids('Abteilung', 'abteilung_id'));
  pruefe('Qualifikation', 'funktion_id', ids('Funktion', 'funktion_id'));
  pruefe('Ehrung', 'ehrungsregel_id', ids('Ehrungsregel', 'ehrungsregel_id'));
  pruefe('Benutzer', 'mitglied_id', m);
});

test('Prüfregeln des Datenmodells (ohne fehler-Option)', () => {
  const art = Object.fromEntries(o.Funktionsart.map(f => [f.funktionsart_id, f]));
  // jedes Mitglied hat einen Zeitraum – außer reine Funktionsträger (V6)
  const mitZr = new Set(o.Mitgliedschaftszeitraum.map(z => z.mitglied_id));
  o.Mitglied.forEach(mm => assert.ok(mitZr.has(mm.mitglied_id) || mm.nur_funktionstraeger, 'ohne Zeitraum: ' + mm.mitglied_id));
  // Lastschrift → IBAN (gültig) + Mandat
  o.Beitragskonto.filter(k => k.zahlweg === 'Lastschrift').forEach(k => {
    assert.ok(k.iban && ibanOk(k.iban), 'IBAN ' + k.iban);
    assert.ok(k.mandatsreferenz && k.mandatsdatum, 'Mandat fehlt: ' + k.beitragskonto_id);
  });
  // aktives Mitglied hat Beitragsart oder Gemeinschaft
  o.Mitglied.filter(mm => mm.status === 'aktiv').forEach(mm =>
    assert.ok(mm.beitragsart_id || mm.beitragsgemeinschaft_id, 'ohne Beitrag: ' + mm.mitglied_id));
  // Gemeinschaft = ein Konto
  const kontoJeGem = {};
  o.Mitglied.filter(mm => mm.beitragsgemeinschaft_id).forEach(mm => {
    (kontoJeGem[mm.beitragsgemeinschaft_id] = kontoJeGem[mm.beitragsgemeinschaft_id] || new Set()).add(mm.beitragskonto_id);
  });
  Object.values(kontoJeGem).forEach(s => assert.strictEqual(s.size, 1));
  // Vereinsämter ohne, Abteilungsämter mit Abteilung
  o.Funktion.forEach(f => {
    if (art[f.funktionsart_id].ebene === 'Verein') assert.strictEqual(f.abteilung_id, null);
    else assert.ok(f.abteilung_id, 'Abteilungsamt ohne Abteilung: ' + f.funktion_id);
  });
  // Minderjährige haben eine Vertretung
  const M = g.Mitgliedschaft;
  o.Mitglied.filter(mm => mm.status === 'aktiv' && M.alter(mm.geburtsdatum, verein.stichtag) < 18)
    .forEach(mm => assert.ok(mm.vertreter_mitglied_id || mm.vertreter_name, 'ohne Vertretung: ' + mm.mitglied_id));
  // Fall „Felix“: Mitglied mit eigener Beitragsart auf einem Konto mit Gemeinschaft
  assert.ok(o.Mitglied.some(mm => mm.beitragsart_id && o.Mitglied.some(x => x.beitragskonto_id === mm.beitragskonto_id && x.beitragsgemeinschaft_id)));
  // Zeitraumlogik: Status passt zu Mitgliedschaft.status
  o.Mitglied.forEach(mm => {
    const zr = M.zeitraeumeVon(mm.mitglied_id, o.Mitgliedschaftszeitraum);
    assert.strictEqual(M.status(mm, zr, verein.stichtag), mm.status, 'Status ' + mm.mitglied_id);
  });
  assert.strictEqual(verein.fehlerliste.length, 0);
});

test('Option fehler: Verstöße werden eingebaut und gemeldet', () => {
  const v = erzeugeVerein({ seed: 1, fehler: true });
  const arten = new Set(v.fehlerliste.map(f => f.art));
  ['lastschrift_ohne_mandat', 'gemeinschaft_zwei_konten', 'aktiv_ohne_beitrag', 'waise', 'hausnummer_in_strasse',
    'geschlecht_fehlt', 'geburtsdatum_fehlt'].forEach(a => assert.ok(arten.has(a), a));
  const ob = alsObjekte(v.tabs);
  const f = v.fehlerliste.find(x => x.art === 'lastschrift_ohne_mandat');
  assert.strictEqual(ob.Beitragskonto.find(k => k.beitragskonto_id === f.id).mandatsreferenz, null);
});

test('kleiner Verein funktioniert ebenfalls', () => {
  const v = alsObjekte(erzeugeVerein({ seed: 7, mitglieder: 150 }).tabs);
  assert.ok(v.Mitglied.length >= 150);
  assert.ok(v.Funktion.length > 0);
});
