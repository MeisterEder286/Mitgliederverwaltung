/**
 * Tests für das Servermodul Mitglieder (src/modul/Mitglieder.js) über die öffentlichen api…-Funktionen
 * (src/api/Mitglieder.js) – gegen die Fakes mit einem synthetischen Verein (300 Mitglieder).
 * Schwerpunkte: Anlegen in einer Sperre, Feldfehler, Dubletten, Versionskonflikt, Austritt mit Konto-Guard,
 * Sterbefall, Zeilenschutz für Abteilungsleiter, Exaktsuche (höchstens ein Treffer, Begrenzung), Funktionen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein, entpacke } = require('./hilfe/projekt');
const { erzeugeFakes } = require('./hilfe/gas-fakes');
const { erzeugeVerein, alsObjekte } = require('./daten/generator');

const MV = 'verwaltung@tsv-ergoldsbach.de';
const AL = 'fussball@tsv-ergoldsbach.de';      // Abteilungsleiter Fußball (abteilung_id 1)
const KASSIER = 'kassier@tsv-ergoldsbach.de';

const verein = erzeugeVerein({ seed: 3, mitglieder: 300 });

/** Neue „Ausführung“ als email; gemeinsamer Datenbestand über tabs/cache, damit Abläufe aufeinander aufbauen. */
function als(email, umgebung) {
  const f = erzeugeFakes({ tabs: umgebung ? umgebung.tabs() : verein.tabs, email, eigentuemer: MV });
  if (umgebung) f.globale.CacheService = umgebung.f.globale.CacheService;
  const g = ladeProjekt(f.globale);
  return {
    f, g,
    tabs: () => { const t = {}; f.datei.getSheets().forEach(b => { t[b.getName()] = f.daten(b.getName()).map(z => z.slice()); }); return t; },
    obj: tab => alsObjekte({ [tab]: f.daten(tab) })[tab]
  };
}
function ok(a) { a = rein(a); assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return a.daten; }
function fehler(a, art) { a = rein(a); assert.strictEqual(a.ok, false, 'Fehler erwartet'); assert.strictEqual(a.fehler.art, art, JSON.stringify(a.fehler)); return a.fehler; }
function aktiveMitglieder(u) {
  const zr = u.obj('Mitgliedschaftszeitraum');
  return u.obj('Mitglied').filter(m => !m.sterbedatum && zr.some(z => z.mitglied_id === m.mitglied_id && !z.austrittsdatum && !z.austritt_wirksam));
}

test('Anlegen: Mitglied + Zeitraum + Abteilung in einem Aufruf, Nummer aus _Konfig, Protokoll, Antwort für den Browser', () => {
  const u = als(MV);
  const vorher = u.obj('_Konfig').find(k => k.schluessel === 'mitgliedsnummer_naechste').wert;
  const d = ok(u.g.apiMitgliedAnlegen({
    mitglied: { vorname: 'Erika', nachname: 'Neumaier', geburtsdatum: '2001-04-03', plz: '84061', ort: 'Ergoldsbach', strasse: 'Bahnhofstraße', hausnummer: '3', beitragsart_id: 1 },
    eintrittsdatum: '2026-10-01', abteilungen: [{ abteilung_id: 2, status: 'aktiv' }]
  }));
  const m = u.obj('Mitglied').find(x => x.mitglied_id === d.mitglied_id);
  assert.strictEqual(m.nachname, 'Neumaier');
  assert.strictEqual(m.status, 'aktiv');
  assert.strictEqual(m.version, 1);
  assert.strictEqual(String(m.mitgliedsnummer), d.mitgliedsnummer);
  assert.ok(Number(d.mitgliedsnummer) >= Number(vorher));
  assert.ok(u.obj('Mitgliedschaftszeitraum').some(z => z.mitglied_id === m.mitglied_id && z.eintrittsdatum === '2026-10-01'));
  assert.ok(u.obj('Abteilungszugehoerigkeit').some(z => z.mitglied_id === m.mitglied_id && z.abteilung_id === 2));
  const nachher = u.obj('_Konfig').find(k => k.schluessel === 'mitgliedsnummer_naechste').wert;
  assert.ok(Number(nachher) === Number(d.mitgliedsnummer) + 1);
  assert.ok(d.aktualisiert.mitglieder.some(x => x.mitglied_id === m.mitglied_id), 'Antwort enthält das neue Mitglied');
  assert.ok(d.aktualisiert.zugehoerigkeiten.length === 1);
  const prot = u.obj('_Protokoll');
  assert.ok(prot.some(p => p.aktion === 'angelegt' && p.tabelle === 'Mitglied' && String(p.datensatz_id) === String(m.mitglied_id)));
  // Nummern sind eindeutig
  const nummern = u.obj('Mitglied').map(x => String(x.mitgliedsnummer));
  assert.strictEqual(new Set(nummern).size, nummern.length);
});

test('Anlegen: Feldfehler am Feld, Dublette nur mit Bestätigung', () => {
  const u = als(MV);
  const f = fehler(u.g.apiMitgliedAnlegen({ mitglied: { vorname: 'Ohne', plz: '123', email: 'kein-at' }, eintrittsdatum: null }), 'fachlich');
  const felder = f.felder.map(x => x.feld);
  ['eintrittsdatum', 'nachname', 'plz', 'email'].forEach(x => assert.ok(felder.includes(x), x + ' fehlt in ' + felder));
  const vorhanden = u.obj('Mitglied').find(m => m.geburtsdatum && !m.anonymisiert);
  const eingabe = { mitglied: { vorname: 'Doppelt', nachname: vorhanden.nachname.toUpperCase(), geburtsdatum: vorhanden.geburtsdatum }, eintrittsdatum: '2026-10-01' };
  assert.ok(rein(u.g.apiMitgliedDublettenPruefen(vorhanden.nachname, vorhanden.geburtsdatum)).daten.length >= 1);
  const df = fehler(u.g.apiMitgliedAnlegen(eingabe), 'fachlich');
  assert.match(df.meldung, /Dublette/);
  eingabe.trotzDublette = true;
  ok(u.g.apiMitgliedAnlegen(eingabe));
});

test('Bearbeiten: Plausibilität, Versionskonflikt, Status/Nummer nicht änderbar', () => {
  const u = als(MV);
  const m = aktiveMitglieder(u)[0];
  const f = fehler(u.g.apiMitgliedSpeichern(m.mitglied_id, m.version, { plz: '8406' }), 'fachlich');
  assert.strictEqual(f.felder[0].feld, 'plz');
  const d = ok(u.g.apiMitgliedSpeichern(m.mitglied_id, m.version, { ort: 'Neufahrn', status: 'verstorben', mitgliedsnummer: '9999' }));
  const neu = u.obj('Mitglied').find(x => x.mitglied_id === m.mitglied_id);
  assert.strictEqual(neu.ort, 'Neufahrn');
  assert.strictEqual(neu.status, m.status);
  assert.strictEqual(String(neu.mitgliedsnummer), String(m.mitgliedsnummer));
  assert.strictEqual(d.aktualisiert.mitglieder[0].ort, 'Neufahrn');
  fehler(u.g.apiMitgliedSpeichern(m.mitglied_id, m.version, { ort: 'Alt' }), 'konflikt');
});

test('Austritt: Kontoinhaber mit Abhängigen braucht eine Option; „alle treten aus“ beendet alles', () => {
  const u = als(MV);
  const g = u.g;
  // Kontoinhaber mit mindestens einem weiteren aktiven Zahler auf seinem Konto finden
  let inhaber = null, info = null;
  for (const m of aktiveMitglieder(u)) {
    const w = rein(g.apiMitgliedAustrittVorbereiten(m.mitglied_id, '2026-12-31'));
    if (w.ok && w.daten.waisen.betroffen) { inhaber = m; info = w.daten; break; }
  }
  assert.ok(inhaber, 'Testdaten: kein Kontoinhaber mit Abhängigen');
  const f = fehler(g.apiMitgliedAustritt(inhaber.mitglied_id, { austritt_wirksam: '2026-10-20', kuendigung_eingang: '2026-09-01', austrittsgrund: 'Umzug' }), 'fachlich');
  assert.strictEqual(f.felder[0].feld, 'option');
  const d = ok(g.apiMitgliedAustritt(inhaber.mitglied_id, { austritt_wirksam: '2026-10-20', kuendigung_eingang: '2026-09-01', austrittsgrund: 'Umzug', option: { code: 'alle_austreten' } }));
  const ids = [inhaber.mitglied_id].concat(info.waisen.konten[0].abhaengige.map(a => a.mitglied_id));
  const mitglieder = u.obj('Mitglied');
  ids.forEach(id => assert.strictEqual(mitglieder.find(m => m.mitglied_id === id).status, 'ausgetreten', 'Status ' + id));
  const zug = u.obj('Abteilungszugehoerigkeit').filter(z => ids.includes(z.mitglied_id));
  zug.forEach(z => assert.ok(z.austrittsdatum && z.austrittsdatum <= '2026-10-20'));
  assert.ok(d.aktualisiert.zeitraeume === undefined || Array.isArray(d.aktualisiert.zeitraeume));
});

test('Austritt zum Jahresende: bleibt bis dahin aktiv, Option „Zahlweg offen“ setzt Merker; Wiedereintritt danach', () => {
  const u = als(MV);
  let inhaber = null;
  for (const m of aktiveMitglieder(u)) {
    const w = rein(u.g.apiMitgliedAustrittVorbereiten(m.mitglied_id, '2026-12-31'));
    if (w.ok && w.daten.waisen.betroffen) { inhaber = { m, w: w.daten.waisen }; break; }
  }
  ok(u.g.apiMitgliedAustritt(inhaber.m.mitglied_id, { austritt_wirksam: '2026-12-31', austrittsgrund: 'Umzug', option: { code: 'zahlweg_offen' } }));
  const m = u.obj('Mitglied');
  assert.strictEqual(m.find(x => x.mitglied_id === inhaber.m.mitglied_id).status, 'aktiv');
  const abh = inhaber.w.konten[0].abhaengige[0].mitglied_id;
  assert.match(m.find(x => x.mitglied_id === abh).bemerkung, /Zahlweg offen/);
  // Wiedereintritt geht erst nach dem Austritt
  fehler(u.g.apiMitgliedWiedereintritt(inhaber.m.mitglied_id, { eintrittsdatum: '2027-02-01' }), 'fachlich');
});

test('Wiedereintritt nach Austritt: neuer Zeitraum, gleiche Nummer, Status aktiv', () => {
  const u = als(MV);
  const zr = u.obj('Mitgliedschaftszeitraum');
  const ausgetreten = u.obj('Mitglied').find(m => m.status === 'ausgetreten' && !m.sterbedatum &&
    !zr.some(z => z.mitglied_id === m.mitglied_id && (!z.austrittsdatum || z.austrittsdatum > '2026-10-25')));
  ok(u.g.apiMitgliedWiedereintritt(ausgetreten.mitglied_id, { eintrittsdatum: '2026-10-25', abteilungen: [{ abteilung_id: 3 }] }));
  const m = u.obj('Mitglied').find(x => x.mitglied_id === ausgetreten.mitglied_id);
  assert.strictEqual(m.status, 'aktiv');
  assert.strictEqual(String(m.mitgliedsnummer), String(ausgetreten.mitgliedsnummer));
  assert.strictEqual(u.obj('Mitgliedschaftszeitraum').filter(z => z.mitglied_id === m.mitglied_id).length, zr.filter(z => z.mitglied_id === m.mitglied_id).length + 1);
});

test('Sterbefall: Status verstorben, Funktionen und Zugehörigkeiten enden, Hinweis an die Kasse', () => {
  const u = als(MV);
  const fkt = u.obj('Funktion').find(f => !f.bis);
  const m = u.obj('Mitglied').find(x => x.mitglied_id === fkt.mitglied_id);
  const d = ok(u.g.apiMitgliedSterbefall(m.mitglied_id, m.version, '2026-10-10'));
  assert.ok(d.hinweise.some(h => /Kasse/.test(h)));
  assert.strictEqual(u.obj('Mitglied').find(x => x.mitglied_id === m.mitglied_id).status, 'verstorben');
  assert.ok(u.obj('Funktion').filter(f => f.mitglied_id === m.mitglied_id).every(f => f.bis && f.bis <= '2026-10-10'));
  const z = u.obj('Mitgliedschaftszeitraum').filter(x => x.mitglied_id === m.mitglied_id);
  assert.ok(z.some(x => x.austrittsgrund === 'verstorben'));
});

test('Abteilungsleiter: nur eigene Abteilung, kein Austritt, keine Vereinsämter', () => {
  const u = als(AL);
  const snap = entpacke(rein(u.g.apiSnapshot()).daten);
  const sichtbar = new Set(snap.mitglieder.map(m => m.mitglied_id));
  const fremd = aktiveMitglieder(u).find(m => !sichtbar.has(m.mitglied_id));
  const eigen = snap.mitglieder.find(m => m.status_abgeleitet === 'aktiv');
  fehler(u.g.apiMitgliedSpeichern(fremd.mitglied_id, fremd.version, { ort: 'X' }), 'zugriff');
  fehler(u.g.apiMitgliedAustritt(eigen.mitglied_id, { austritt_wirksam: '2026-12-31' }), 'zugriff');
  fehler(u.g.apiZugehoerigkeitSpeichern(null, 0, { mitglied_id: eigen.mitglied_id, abteilung_id: 2, status: 'aktiv' }), 'zugriff');
  const vereinsamt = u.obj('Funktionsart').find(a => a.ebene === 'Verein');
  const abteilungsamt = u.obj('Funktionsart').find(a => a.ebene === 'Abteilung' && a.aktiv !== false);
  fehler(u.g.apiFunktionEintragen({ mitglied_id: eigen.mitglied_id, funktionsart_id: vereinsamt.funktionsart_id, von: '2026-10-01' }), 'zugriff');
  fehler(u.g.apiFunktionEintragen({ mitglied_id: eigen.mitglied_id, funktionsart_id: abteilungsamt.funktionsart_id, abteilung_id: 2, von: '2026-10-01' }), 'zugriff');
  const d = ok(u.g.apiFunktionEintragen({ mitglied_id: eigen.mitglied_id, funktionsart_id: abteilungsamt.funktionsart_id, abteilung_id: 1, zusatz: 'E-Jugend', von: '2026-10-01' }));
  const neu = d.aktualisiert.funktionen[0];
  assert.strictEqual(neu.zusatz, 'E-Jugend');
  ok(u.g.apiFunktionBeenden(neu.funktion_id, neu.version, { bis: '2026-10-20', beendigungsgrund: 'Test' }));
  fehler(u.g.apiFunktionBeenden(neu.funktion_id, neu.version + 1, { bis: '2026-09-01' }), 'fachlich');
  // Kassier darf keine Funktionen eintragen
  const k = als(KASSIER);
  fehler(k.g.apiFunktionEintragen({ mitglied_id: eigen.mitglied_id, funktionsart_id: abteilungsamt.funktionsart_id, abteilung_id: 1, von: '2026-10-01' }), 'zugriff');
});

test('Exaktsuche: nur ein Treffer ohne ID, mehrdeutig → kein Treffer, Zuordnen macht die Person sichtbar, Begrenzung', () => {
  const u = als(AL);
  const snap = entpacke(rein(u.g.apiSnapshot()).daten);
  const sichtbar = new Set(snap.mitglieder.map(m => m.mitglied_id));
  const fremd = aktiveMitglieder(u).find(m => !sichtbar.has(m.mitglied_id) && m.geburtsdatum && !m.nur_funktionstraeger);
  // Nummer allein genügt nicht mehr (Befund H1/M3): immer zwei Merkmale
  fehler(u.g.apiMitgliedSucheExakt({ mitgliedsnummer: String(fremd.mitgliedsnummer) }), 'fachlich');
  const t = ok(u.g.apiMitgliedSucheExakt({ mitgliedsnummer: String(fremd.mitgliedsnummer), nachname: fremd.nachname }));
  assert.ok(t.treffer);
  assert.deepStrictEqual(Object.keys(t.treffer).sort(), ['bereits_in', 'geburtsjahr', 'mitgliedsnummer', 'name', 'token']);
  assert.ok(!JSON.stringify(t).includes(String(fremd.mitglied_id) + ','), 'keine ID');
  assert.strictEqual(ok(u.g.apiMitgliedSucheExakt({ nachname: fremd.nachname, geburtsdatum: '1900-01-01' })).treffer, null);
  assert.ok(ok(u.g.apiMitgliedSucheExakt({ nachname: fremd.nachname.toLowerCase(), geburtsdatum: fremd.geburtsdatum })).treffer);
  fehler(u.g.apiMitgliedSucheExakt({}), 'fachlich');
  // Zuordnen ohne gültiges Token (z. B. nur mit Kriterien oder erfundenem Token) scheitert
  fehler(u.g.apiMitgliedZuordnen({ mitgliedsnummer: String(fremd.mitgliedsnummer) }, 1, 'aktiv'), 'fachlich');
  fehler(u.g.apiMitgliedZuordnen('erfunden', 1, 'aktiv'), 'fachlich');
  fehler(u.g.apiMitgliedZuordnen(t.treffer.token, 2, 'aktiv'), 'zugriff');   // fremde Abteilung
  const z = ok(u.g.apiMitgliedZuordnen(t.treffer.token, 1, 'aktiv'));
  assert.ok(z.aktualisiert.mitglieder.some(m => m.mitglied_id === fremd.mitglied_id), 'jetzt sichtbar');
  fehler(u.g.apiMitgliedZuordnen(t.treffer.token, 1, 'aktiv'), 'fachlich');   // Token nur einmal gültig
  assert.ok(u.obj('_Protokoll').some(p => p.aktion === 'eingesehen' && /Exaktsuche/.test(p.kommentar)));
  // Begrenzung: nach 30 Suchen je Stunde ist Schluss (die bisherigen zählen mit)
  for (let i = 0; i < 30; i++) u.g.apiMitgliedSucheExakt({ mitgliedsnummer: '0000', nachname: 'Niemand' });
  assert.match(fehler(u.g.apiMitgliedSucheExakt({ mitgliedsnummer: '0000', nachname: 'Niemand' }), 'fachlich').meldung, /Zu viele/);
});

test('Zugehörigkeit: passiv setzen, beenden; Export wird protokolliert', () => {
  const u = als(MV);
  const zug = u.obj('Abteilungszugehoerigkeit').find(z => !z.austrittsdatum && z.status === 'aktiv');
  const d = ok(u.g.apiZugehoerigkeitSpeichern(zug.zugehoerigkeit_id, zug.version, { status: 'passiv', passnummer: 'P-1' }));
  assert.strictEqual(d.aktualisiert.zugehoerigkeiten[0].status, 'passiv');
  const neu = u.obj('Abteilungszugehoerigkeit').find(z => z.zugehoerigkeit_id === zug.zugehoerigkeit_id);
  ok(u.g.apiZugehoerigkeitBeenden(zug.zugehoerigkeit_id, neu.version, '2026-10-24'));
  assert.strictEqual(u.obj('Abteilungszugehoerigkeit').find(z => z.zugehoerigkeit_id === zug.zugehoerigkeit_id).austrittsdatum, '2026-10-24');
  ok(u.g.apiMitgliederExport('kontaktliste', 42));
  fehler(u.g.apiMitgliederExport('alles', 1), 'fachlich');
  const p = u.obj('_Protokoll').filter(x => x.aktion === 'exportiert');
  assert.ok(p.some(x => /kontaktliste: 42/.test(x.kommentar)));
  const al = als(AL);
  ok(al.g.apiMitgliederExport('kontaktliste', 3));   // Abteilungsleiter dürfen Listen ihrer Abteilung exportieren
});
