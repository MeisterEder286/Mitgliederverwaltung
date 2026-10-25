/**
 * Tests für interne Notizen, Rückfragen und Wiedervorlagen (src/lib/notizen.js, src/modul/Notizen.js, api/Notizen.js)
 * über gas-fakes + synthetischen Verein. Prüft: Sichtregel je Leserkreis/Rolle (Negativtests), Schreibrechte
 * (AL keine Finanz-Notiz, keine Person außerhalb des Sichtkreises), Ändern/Löschen, Protokoll ohne Notiztext,
 * Rückfrage „auf wen abbuchen?“ mit Antwort und Folge-Wiedervorlage, Auskunft/Anonymisierung, Fristbereinigung.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein, entpacke } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

const V = erzeugeVerein({ seed: 7, mitglieder: 200 });

function email(rolle, abteilung) {
  const b = V.tabs.Benutzer, k = b[0];
  return b.slice(1).find(r => r[k.indexOf('rolle')] === rolle && (abteilung === undefined || Number(r[k.indexOf('abteilung_id')]) === abteilung))[k.indexOf('email')];
}
function als(rolle, tabs, abteilung) {
  const f = erzeugeFakes({ tabs: tabs || V.tabs, email: email(rolle, abteilung) });
  const g = ladeProjekt(f.globale);
  const obj = tab => { const d = f.daten(tab); return d.slice(1).map(r => Object.fromEntries(d[0].map((h, i) => [h, r[i]]))); };
  const tabsJetzt = () => Object.fromEntries(Object.keys(V.tabs).map(t => [t, f.daten(t)]));
  return { f, g, obj, tabsJetzt };
}
const ok = a => { a = rein(a); assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return a.daten; };
const fehler = (a, art) => { a = rein(a); assert.strictEqual(a.ok, false, 'Fehler erwartet'); if (art) assert.strictEqual(a.fehler.art, art, a.fehler.meldung); return a.fehler; };
const kern = u => entpacke(ok(u.g.apiSnapshot(['kern'])));
const neueNotiz = d => d.aktualisiert.notizen[0];

/** Eine Person, die der Fußball-AL sieht, und eine, die er nicht sieht. */
const MV0 = als('Mitgliederverwalter');
const alleIds = kern(MV0).mitglieder.filter(m => !m.anonymisiert).map(m => m.mitglied_id);
const alIds = kern(als('Abteilungsleiter', null, 1)).mitglieder.map(m => m.mitglied_id);
const IM_KREIS = alIds[0];
const AUSSERHALB = alleIds.find(id => alIds.indexOf(id) < 0);

test('Regeln: Leserkreise je Rolle, Ändern/Löschen', () => {
  const g = ladeProjekt({});
  const K = (rolle, abt) => g.Rechte.kontext([{ email: 'x@tsv.de', rolle, aktiv: true, abteilung_id: abt || null }], 'x@tsv.de');
  const mv = K('Mitgliederverwalter'), ka = K('Kassier'), al = K('Abteilungsleiter', 1), jl = K('Jugendleiter');
  const n = (kreis, abt) => ({ sichtbar_fuer: kreis, abteilung_id: abt || null, erstellt_von: 'y@tsv.de' });
  assert.ok(g.NotizRegeln.sichtbar(mv, n('Verwaltung')) && g.NotizRegeln.sichtbar(mv, n('Abteilung', 2)));
  assert.ok(!g.NotizRegeln.sichtbar(ka, n('Verwaltung')) && g.NotizRegeln.sichtbar(ka, n('Finanzen')));
  assert.ok(!g.NotizRegeln.sichtbar(ka, n('Abteilung', 1)) && !g.NotizRegeln.sichtbar(ka, n('Jugendleitung')));
  assert.ok(g.NotizRegeln.sichtbar(al, n('Abteilung', 1)) && !g.NotizRegeln.sichtbar(al, n('Abteilung', 2)));
  assert.ok(!g.NotizRegeln.sichtbar(al, n('Finanzen')) && !g.NotizRegeln.sichtbar(al, n('Verwaltung')));
  assert.ok(g.NotizRegeln.sichtbar(jl, n('Jugendleitung')) && !g.NotizRegeln.sichtbar(jl, n('Abteilung', 1)));
  assert.ok(!g.NotizRegeln.darfKreis(al, 'Finanzen') && !g.NotizRegeln.darfKreis(al, 'Abteilung', 2) && g.NotizRegeln.darfKreis(al, 'Abteilung', 1));
  assert.ok(!g.NotizRegeln.darfKreis(ka, 'Verwaltung') && g.NotizRegeln.darfKreis(ka, 'Finanzen'));
  // Ändern: Verfasser oder Verwaltung; Löschen nur Verwaltung ohne laufenden Vorgang
  assert.ok(!g.NotizRegeln.darfAendern(ka, n('Finanzen')) && g.NotizRegeln.darfAendern(ka, Object.assign(n('Finanzen'), { erstellt_von: 'X@tsv.de' })));
  assert.strictEqual(g.NotizRegeln.darfLoeschen(ka, n('Finanzen')).grund, 'zugriff');
  assert.strictEqual(g.NotizRegeln.darfLoeschen(mv, Object.assign(n('Finanzen'), { art: 'Rückfrage' })).ok, false);
  assert.strictEqual(g.NotizRegeln.darfLoeschen(mv, Object.assign(n('Finanzen'), { art: 'Rückfrage', erledigt_am: '2026-01-01' })).ok, true);
});

test('Anlegen: Protokoll ohne Text, Snapshot je Rolle, AL ohne Finanz-Notiz und ohne fremde Person', () => {
  const al = als('Abteilungsleiter', null, 1);
  // fremder Leserkreis → Feldfehler am Leserkreis
  assert.ok(fehler(al.g.apiNotizSpeichern({ mitglied_id: IM_KREIS, art: 'Notiz', text: 'x', sichtbar_fuer: 'Finanzen' }), 'fachlich').felder.some(x => x.feld === 'sichtbar_fuer'));
  assert.ok(fehler(al.g.apiNotizSpeichern({ mitglied_id: IM_KREIS, art: 'Notiz', text: 'x', sichtbar_fuer: 'Abteilung', abteilung_id: 2 }), 'fachlich').felder.some(x => x.feld === 'sichtbar_fuer'));
  fehler(al.g.apiNotizSpeichern({ mitglied_id: AUSSERHALB, art: 'Notiz', text: 'x', sichtbar_fuer: 'Abteilung', abteilung_id: 1 }), 'zugriff');
  const d = ok(al.g.apiNotizSpeichern({ mitglied_id: IM_KREIS, art: 'Telefonat', text: 'Geheimer Vermerktext 4711', sichtbar_fuer: 'Abteilung', abteilung_id: 1, erstellt_von: 'faelschung@x.de' }));
  const n = neueNotiz(d);
  assert.strictEqual(n.erstellt_von, email('Abteilungsleiter', 1));
  assert.ok(!JSON.stringify(al.obj('_Protokoll')).includes('4711'), 'Notiztext im Protokoll');
  assert.ok(al.obj('_Protokoll').some(p => p.tabelle === 'Notiz' && p.aktion === 'angelegt'));

  const mv = als('Mitgliederverwalter', al.tabsJetzt());
  ok(mv.g.apiNotizSpeichern({ mitglied_id: IM_KREIS, art: 'Notiz', text: 'nur Verwaltung', sichtbar_fuer: 'Verwaltung' }));
  ok(mv.g.apiNotizSpeichern({ mitglied_id: IM_KREIS, art: 'Notiz', text: 'Kasse', sichtbar_fuer: 'Finanzen' }));
  const t = mv.tabsJetzt();
  const texte = u => kern(u).notizen.map(x => x.text).sort();
  assert.deepStrictEqual(texte(als('Mitgliederverwalter', t)), ['Geheimer Vermerktext 4711', 'Kasse', 'nur Verwaltung']);
  assert.deepStrictEqual(texte(als('Kassier', t)), ['Kasse']);
  assert.deepStrictEqual(texte(als('Abteilungsleiter', t, 1)), ['Geheimer Vermerktext 4711']);
  assert.deepStrictEqual(texte(als('Abteilungsleiter', t, 2)), []);
  // Fremde Notiz ändern/erledigen: Kassier nicht, Verwaltung ja; Löschen nur Verwaltung
  const fremd = als('Kassier', t);
  fehler(fremd.g.apiNotizErledigen(n.notiz_id, n.version, 'x'), 'zugriff');
  fehler(fremd.g.apiNotizLoeschen(n.notiz_id, n.version), 'zugriff');
  const mv2 = als('Mitgliederverwalter', t);
  fehler(mv2.g.apiNotizLoeschen(n.notiz_id, 99), 'konflikt');
  ok(mv2.g.apiNotizLoeschen(n.notiz_id, n.version));
  assert.ok(!mv2.obj('Notiz').some(x => x.notiz_id === n.notiz_id));
});

test('Rückfrage „auf wen abbuchen?“: Wiedervorlage, Antwort ohne Kontoänderung, Folge-Wiedervorlage für die Kasse', () => {
  const mv = als('Mitgliederverwalter');
  const m = mv.obj('Mitglied').find(x => x.status === 'aktiv' && x.beitragskonto_id);
  const mvKtx = mv.g.Rechte.kontext([{ email: 'verwaltung@tsv-ergoldsbach.de', rolle: 'Mitgliederverwalter', aktiv: true }], 'verwaltung@tsv-ergoldsbach.de');
  // aufgerufen wie aus einem anderen Modul heraus: innerhalb einer bestehenden Sperre
  const rf = rein(mv.g.DB.mitSperre(() => mv.g.Notizen.rueckfrageAnlegen(mvKtx, { mitglied_id: m.mitglied_id, beitragskonto_id: m.beitragskonto_id })));
  assert.strictEqual(rf.art, 'Rückfrage');
  assert.strictEqual(rf.sichtbar_fuer, 'Finanzen');
  assert.ok(rf.wiedervorlage_am > mv.g.DB.jetzt().slice(0, 10));
  const ka = als('Kassier', mv.tabsJetzt());
  const offen = ok(ka.g.apiNotizenOffen());
  assert.ok(offen.offen.some(x => x.notiz_id === rf.notiz_id));
  fehler(ka.g.apiNotizRueckfrageAntwort(rf.notiz_id, rf.version, { entscheidung: 'quatsch' }), 'fachlich');
  const konten = JSON.stringify(ka.obj('Beitragskonto'));
  const a = ok(ka.g.apiNotizRueckfrageAntwort(rf.notiz_id, rf.version, { entscheidung: 'eigenes_konto', bemerkung: 'ruft zurück' }));
  assert.deepStrictEqual(a.sprung, { ansicht: 'konto', param: { id: m.beitragskonto_id } });
  assert.strictEqual(JSON.stringify(ka.obj('Beitragskonto')), konten, 'Konto darf sich nicht ändern');
  const alle = ka.obj('Notiz');
  const erledigt = alle.find(x => x.notiz_id === rf.notiz_id);
  assert.ok(erledigt.erledigt_am && /eigenes Konto/.test(erledigt.ergebnis));
  const folge = alle.find(x => x.art === 'Wiedervorlage' && x.mitglied_id === m.mitglied_id);
  assert.ok(folge && folge.sichtbar_fuer === 'Finanzen' && !folge.erledigt_am);
  fehler(ka.g.apiNotizRueckfrageAntwort(rf.notiz_id, Number(rf.version) + 1, { entscheidung: 'konto_bleibt' }), 'fachlich');
  // Folge-Wiedervorlage ist heute fällig
  assert.ok(ok(ka.g.apiNotizenOffen()).faellig.some(x => x.art === 'Wiedervorlage'));
  // Abteilungsleiter sieht die Finanz-Rückfrage nicht
  assert.ok(!kern(als('Abteilungsleiter', ka.tabsJetzt(), 1)).notizen.some(x => x.sichtbar_fuer === 'Finanzen'));
});

test('Auskunft enthält Notizen, Anonymisierungsplan entfernt sie', () => {
  const mv = als('Mitgliederverwalter');
  const m = mv.obj('Mitglied').find(x => x.status === 'ausgetreten');
  ok(mv.g.apiNotizSpeichern({ mitglied_id: m.mitglied_id, art: 'Notiz', text: 'Auskunftstest', sichtbar_fuer: 'Verwaltung' }));
  const t = mv.tabsJetzt();
  const mv2 = als('Mitgliederverwalter', t);
  const ausk = JSON.stringify(ok(mv2.g.apiDatenschutzAuskunft(m.mitglied_id)));
  assert.ok(ausk.includes('Interne Notizen') && ausk.includes('Auskunftstest'));
  const plan = JSON.stringify(ok(mv2.g.apiDatenschutzAnonymisierungsplan(m.mitglied_id)));
  assert.ok(plan.includes('Notiz'), plan.slice(0, 400));
});

test('Fristbereinigung: erledigte Notizen ausgetretener Personen nach 36 Monaten, offene bleiben', () => {
  const mv = als('Mitgliederverwalter');
  const m = mv.obj('Mitglied').find(x => x.status === 'ausgetreten');
  ok(mv.g.apiNotizSpeichern({ mitglied_id: m.mitglied_id, art: 'Notiz', text: 'alt', sichtbar_fuer: 'Verwaltung' }));
  const n = mv.obj('Notiz')[0];
  ok(mv.g.apiNotizErledigen(n.notiz_id, n.version, 'fertig'));
  ok(mv.g.apiNotizSpeichern({ mitglied_id: m.mitglied_id, art: 'Wiedervorlage', text: 'offen', sichtbar_fuer: 'Verwaltung', wiedervorlage_am: '2030-01-01' }));
  assert.strictEqual(rein(mv.g.Notizen.fristBereinigung('2026-10-25')).anzahl, 0);
  assert.strictEqual(rein(mv.g.Notizen.fristBereinigung('2099-01-01')).anzahl, 1);
  assert.deepStrictEqual(mv.obj('Notiz').map(x => x.text), ['offen']);
  assert.ok(!JSON.stringify(mv.obj('_Protokoll')).includes('"alt"'));
});
