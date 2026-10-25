/**
 * Generator für SYNTHETISCHE Vereinsdaten (Tests, Lastproben, lokale Vorschau).
 *
 * Zweck:      Erzeugt einen vollständigen, in sich stimmigen „Verein“ mit ~1.200 Mitgliedern in allen Tabs des
 *             Datenmodells – so, wie die Daten nach der Migration im Google Sheet stehen würden.
 * Datenquelle: Schema und Startbelegung aus src/lib/ (erzeugt aus docs/daten/*.csv). Alle Personen, Adressen,
 *             IBANs und Beträge sind frei erfunden. Es gibt KEINE Verbindung zu echten Mitgliedern.
 * Wer darf was: – (nur Entwicklung; landet nie in Google).
 * Besonderheiten:
 *   - Deterministisch: gleicher seed → byte-gleiche Daten (eigener Zufallsgenerator mulberry32).
 *   - Zellformat wie im Sheet: Datum/Zeitpunkt als Seriennummer, ja/nein als 'ja'/'nein', Kopfzeile in
 *     Schema-Reihenfolge. Umwandlung über Werte.objektZuZeile – dieselbe Funktion wie im Produktivcode.
 *   - Die Prüfregeln aus dem Lies-mich des Datenmodells werden eingehalten (Gemeinschaft = ein Konto,
 *     Lastschrift = IBAN + Mandat, aktives Mitglied hat Beitragsart oder Gemeinschaft, …).
 *   - Option fehler: true baut absichtlich je zwei Verstöße ein und meldet sie in `fehlerliste`
 *     ([{ art, tab, id }]) – damit Tests der Prüfregeln sie wiederfinden.
 *
 * Benutzung:
 *   const { erzeugeVerein, alsObjekte } = require('./daten/generator');
 *   const { tabs, fehlerliste } = erzeugeVerein({ seed: 1, mitglieder: 1200, stichtag: '2026-10-25', fehler: false });
 *   const objekte = alsObjekte(tabs);   // { Mitglied: [{…}], … } – Werte wie DB.lese sie liefert
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src', 'lib');

/** Nur die reinen Bibliotheken laden (unabhängig davon, woran in src/ gerade gearbeitet wird). */
function ladeLib() {
  const ctx = vm.createContext({ console });
  ['schema.js', 'startbelegung.js', 'werte.js'].forEach(d => {
    new vm.Script(fs.readFileSync(path.join(SRC, d), 'utf8'), { filename: d }).runInContext(ctx);
  });
  return ctx;
}

// ------------------------------------------------------------------ Zufall

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function zufall(seed) {
  const r = mulberry32(seed);
  const z = {
    r,
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    wahl: (liste) => liste[Math.floor(r() * liste.length)],
    ja: (p) => r() < p,
    gewichtet: (paare) => {          // [[wert, gewicht], …]
      const summe = paare.reduce((s, p) => s + p[1], 0);
      let x = r() * summe;
      for (const [w, g] of paare) { if ((x -= g) < 0) return w; }
      return paare[paare.length - 1][0];
    }
  };
  return z;
}

// ------------------------------------------------------------------ Datumshilfen (ISO-Text, zeitzonenfrei)

const pad = (n, l) => String(n).padStart(l || 2, '0');
function iso(j, m, t) { return j + '-' + pad(m) + '-' + pad(t); }
function tageImMonat(j, m) { return new Date(Date.UTC(j, m, 0)).getUTCDate(); }
function zufallsDatum(z, vonJahr, bisIso) {
  const bis = bisIso.split('-').map(Number);
  if (vonJahr >= bis[0]) vonJahr = bis[0];          // Bereich leer oder nur ein Jahr: nicht endlos suchen
  for (let versuch = 0; versuch < 50; versuch++) {
    const j = z.int(vonJahr, bis[0]);
    const m = z.int(1, 12);
    const t = z.int(1, tageImMonat(j, m));
    const d = iso(j, m, t);
    if (d <= bisIso) return d;
  }
  return bisIso;
}
function plusTage(d, n) {
  const [j, m, t] = d.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t + n)).toISOString().slice(0, 10);
}
function plusMonate(d, n) {
  const [j, m, t] = d.split('-').map(Number);
  const g = j * 12 + (m - 1) + n;
  const jj = Math.floor(g / 12), mm = g % 12 + 1;
  return iso(jj, mm, Math.min(t, tageImMonat(jj, mm)));
}
function max(a, b) { return a > b ? a : b; }
function min(a, b) { return a < b ? a : b; }
const jahrVon = d => Number(String(d).slice(0, 4));

// ------------------------------------------------------------------ Namen, Orte, Banken (erfunden)

const NACHNAMEN = ['Huber', 'Bauer', 'Wagner', 'Maier', 'Müller', 'Schmid', 'Hofmann', 'Gruber', 'Brandl', 'Obermeier',
  'Lehner', 'Wimmer', 'Eder', 'Kellner', 'Steinberger', 'Aigner', 'Sedlmeier', 'Fischer', 'Vogl', 'Denk', 'Riedl',
  'Zellner', 'Hierl', 'Gschwendtner', 'Straßer', 'Bergmaier', 'Hartl', 'Pöschl', 'Reitmeier', 'Kronseder', 'Wittmann',
  'Rieger', 'Lindner', 'Moser', 'Zehetmair', 'Hirschberger', 'Baumgartner', 'Forster', 'Schwaiger', 'Weinzierl',
  'Ostermeier', 'Kagerer', 'Stadler', 'Mittermeier', 'Brunner', 'Hainz', 'Dietl', 'Fuchs', 'Schönberger', 'Sixt',
  'Ertl', 'Weiß', 'Kirchberger', 'Zierer', 'Pfaffinger', 'Lechner', 'Holzner', 'Biersack', 'Unterholzner', 'Feichtner'];
const VORNAMEN = {
  m: { alt: ['Josef', 'Franz', 'Johann', 'Georg', 'Alois', 'Ludwig', 'Anton', 'Max', 'Karl', 'Xaver'],
    mittel: ['Thomas', 'Michael', 'Andreas', 'Stefan', 'Markus', 'Christian', 'Martin', 'Peter', 'Wolfgang', 'Bernhard'],
    jung: ['Felix', 'Lukas', 'Jonas', 'Maximilian', 'Korbinian', 'Leon', 'Elias', 'Quirin', 'Paul', 'Ben', 'Valentin', 'Simon'] },
  w: { alt: ['Maria', 'Anna', 'Theresia', 'Rosa', 'Elisabeth', 'Anneliese', 'Hildegard', 'Rita', 'Gertraud', 'Franziska'],
    mittel: ['Sabine', 'Andrea', 'Petra', 'Claudia', 'Monika', 'Martina', 'Susanne', 'Christine', 'Barbara', 'Katrin'],
    jung: ['Lena', 'Anna', 'Lea', 'Sophia', 'Marie', 'Emilia', 'Hannah', 'Laura', 'Julia', 'Magdalena', 'Vroni', 'Mia'] }
};
const STRASSEN = ['Rosenweg', 'Hauptstraße', 'Lindenallee', 'Schulweg', 'Kirchgasse', 'Bahnhofstraße', 'Birkenweg',
  'Mühlweg', 'Feldstraße', 'Ahornstraße', 'Am Anger', 'Ringstraße', 'Am Bach', 'Sonnenstraße', 'Gartenstraße',
  'Laberstraße', 'Bergstraße', 'Eichenweg', 'Wiesenweg', 'Hopfenweg', 'Pfarrer-Huber-Straße', 'Am Sportplatz',
  'Siedlungsstraße', 'Brunnenweg', 'Kellerberg'];
const ORTE = [['Ergoldsbach', '84061', 70], ['Neufahrn i. NB', '84088', 6], ['Essenbach', '84051', 5],
  ['Bayerbach b. Ergoldsbach', '84092', 6], ['Hohenthann', '84098', 4], ['Mallersdorf-Pfaffenberg', '84066', 4],
  ['Landshut', '84028', 5]];
const BANKEN = [['74350000', 'BYLADEM1LAH'], ['74050000', 'BYLADEM1SRG'], ['74390000', 'GENODEF1LH1'],
  ['74150000', 'BYLADEM1DQE'], ['37040044', 'COBADEFFXXX'], ['74320073', 'HYVEDEMM433']];
const MANNSCHAFTEN = {
  1: ['Herren I', 'Herren II', 'A-Jugend', 'B-Jugend', 'C-Jugend', 'D-Jugend', 'E-Jugend', 'F-Jugend', 'G-Jugend', 'Damen'],
  2: ['Kinderturnen', 'Eltern-Kind-Turnen', 'Gymnastik Damen', 'Seniorensport', 'Leistungsturnen'],
  3: ['Jugendtraining', 'Herren 40', 'Damen'], 4: ['Mannschaft 1', 'Jugend'], 5: ['Skigymnastik']
};

/** Deutsche IBAN mit korrekter Prüfziffer (ISO 7064 mod 97-10). */
function iban(blz, konto) {
  const bban = blz + konto;
  const rest = BigInt(bban + '131400') % 97n;     // D=13, E=14
  return 'DE' + pad(Number(98n - rest)) + bban;
}

// ------------------------------------------------------------------ Generator

function erzeugeVerein(optionen) {
  const opt = Object.assign({ seed: 1, mitglieder: 1200, stichtag: '2026-10-25', fehler: false }, optionen || {});
  const lib = ladeLib();
  const Schema = lib.Schema, Werte = lib.Werte, Start = lib.Startbelegung;
  const z = zufall(opt.seed);
  const STICHTAG = opt.stichtag;
  const JAHR = jahrVon(STICHTAG);
  const AENDERUNG = STICHTAG + 'T09:00:00';

  const daten = {};   // Tab → [obj]
  Object.keys(Schema.TABELLEN).forEach(t => { daten[t] = []; });
  const ids = {};
  const neueId = t => (ids[t] = (ids[t] || 0) + 1);
  const fehlerliste = [];

  // ---- Stammdaten aus der Startbelegung
  ['Abteilung', 'Funktionsart', 'Beitragsart', 'Qualifikationsart', 'Ehrungsregel', 'Aufbewahrungsfrist'].forEach(tab => {
    const sb = Start[tab];
    sb.zeilen.forEach(zeile => {
      const o = {};
      sb.kopf.forEach((k, i) => { o[k] = zeile[i] === '' ? null : zeile[i]; });
      daten[tab].push(o);
      const idSp = Schema.TABELLEN[tab].idSpalte;
      ids[tab] = Math.max(ids[tab] || 0, Number(o[idSp]));
    });
  });
  const funktionsart = id => daten.Funktionsart.find(f => Number(f.funktionsart_id) === id);
  const FESTBETRAG_FAMILIE = 180, FESTBETRAG_PAAR = 150;
  const BEITRAG = { 1: 100, 2: 45, 3: 50 };

  // ---- Personen und Haushalte
  const personen = [];        // Mitglied-Objekte + interne Felder (_haushalt, _alter …)
  const haushalte = [];
  const nummern = new Set();
  let naechsteNr = 100;
  function neueNummer() {
    naechsteNr += z.int(1, 3);
    const n = pad(naechsteNr, 4);
    nummern.add(n);
    return n;
  }
  function geburtsdatumFuerAlter(alter) {
    const j = JAHR - alter - (z.ja(0.5) ? 1 : 0);
    const m = z.int(1, 12);
    let d = iso(j, m, z.int(1, tageImMonat(j, m)));
    // Alter exakt am Stichtag einstellen
    const a = (b) => { const [bj, bm, bt] = b.split('-').map(Number); const [sj, sm, st] = STICHTAG.split('-').map(Number); return sj - bj - ((sm < bm || (sm === bm && st < bt)) ? 1 : 0); };
    while (a(d) > alter) d = iso(jahrVon(d) + 1, Number(d.slice(5, 7)), Math.min(Number(d.slice(8)), tageImMonat(jahrVon(d) + 1, Number(d.slice(5, 7)))));
    while (a(d) < alter) d = iso(jahrVon(d) - 1, Number(d.slice(5, 7)), Math.min(Number(d.slice(8)), tageImMonat(jahrVon(d) - 1, Number(d.slice(5, 7)))));
    return d;
  }
  function vorname(geschlecht, alter) {
    const g = geschlecht === 'd' ? z.wahl(['m', 'w']) : geschlecht;
    const ep = alter >= 60 ? 'alt' : alter >= 30 ? 'mittel' : 'jung';
    return z.wahl(VORNAMEN[g][ep]);
  }
  function adresse() {
    const ort = z.gewichtet(ORTE.map(o => [o, o[2]]));
    return { strasse: z.wahl(STRASSEN), hausnummer: String(z.int(1, 60)) + (z.ja(0.06) ? z.wahl(['a', 'b']) : ''), plz: ort[1], ort: ort[0], land: 'DE' };
  }
  function telefon() { return '09452 ' + z.int(1000, 9999); }
  function handy() { return z.wahl(['0151', '0160', '0170', '0171', '0176']) + ' ' + z.int(1000000, 9999999); }

  function person(h, nachname, geschlecht, alter, rolle) {
    const p = {
      mitglied_id: null, mitgliedsnummer: null,
      anrede: alter >= 18 ? (geschlecht === 'm' ? 'Herr' : geschlecht === 'w' ? 'Frau' : 'Divers') : null,
      briefanrede: null, titel: alter > 35 && z.ja(0.02) ? 'Dr.' : null,
      vorname: vorname(geschlecht, alter), nachname,
      strasse: h.adresse.strasse, hausnummer: h.adresse.hausnummer, plz: h.adresse.plz, ort: h.adresse.ort, land: 'DE',
      geburtsdatum: geburtsdatumFuerAlter(alter), geschlecht,
      telefon: h.telefon, handy: alter >= 14 && z.ja(0.6) ? handy() : null,
      email: null, versandart: null,
      adresse_ungueltig: false, adresse_ungueltig_am: null, ehrenmitglied: false, ehrenmitglied_seit: null,
      nur_funktionstraeger: false, sterbedatum: null, status: null,
      beitragsart_id: null, beitragskonto_id: null, beitragsgemeinschaft_id: null,
      vertreter_mitglied_id: null, vertreter_name: null, vertreter_kontakt: null, bemerkung: null,
      geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de',
      verarbeitung_eingeschraenkt: false, sperre_grund: null, loeschbar_ab: null, anonymisiert: false, anonymisiert_am: null,
      version: 1,
      _alter: alter, _rolle: rolle, _haushalt: h, _zeitraeume: []
    };
    if (alter >= 16 && z.ja(0.55)) {
      p.email = (p.vorname + '.' + nachname).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss') + z.int(1, 99) + '@example.de';
    }
    p.versandart = p.email && z.ja(0.8) ? 'E-Mail' : 'Post';
    if (alter >= 18) p.briefanrede = (geschlecht === 'w' ? 'Sehr geehrte Frau ' : geschlecht === 'm' ? 'Sehr geehrter Herr ' : 'Guten Tag ') + nachname;
    else p.briefanrede = (geschlecht === 'w' ? 'Liebe ' : 'Lieber ') + p.vorname;
    if (alter >= 70 && z.ja(0.15)) { p.ehrenmitglied = true; p.ehrenmitglied_seit = iso(JAHR - z.int(1, 15), 3, z.int(1, 28)); }
    personen.push(p);
    h.personen.push(p);
    return p;
  }

  function erwachsenenAlter() {
    return z.gewichtet([[z.int(19, 26), 14], [z.int(27, 40), 20], [z.int(41, 60), 34], [z.int(61, 75), 22], [z.int(76, 92), 8]]);
  }

  let externe = 0;
  while (personen.length < opt.mitglieder) {
    const typ = z.gewichtet([['einzel', 74], ['paar', 9], ['familie', 15], ['kind_extern', externe < 4 ? 1.2 : 0]]);
    const h = { typ, adresse: adresse(), telefon: z.ja(0.6) ? telefon() : null, personen: [], nachname: z.wahl(NACHNAMEN) };
    haushalte.push(h);
    if (typ === 'einzel') {
      const g = z.gewichtet([['m', 52], ['w', 47], ['d', 1]]);
      // Einzelne Jugendliche 15–18 (z. B. Tennis), sonst Erwachsene
      const alter = z.ja(0.06) ? z.int(15, 18) : erwachsenenAlter();
      person(h, h.nachname, g, alter, 'zahler');
    } else if (typ === 'paar') {
      const a = z.int(30, 80);
      person(h, h.nachname, 'm', a, 'zahler');
      person(h, h.nachname, 'w', Math.max(19, a + z.int(-6, 3)), 'partner');
    } else if (typ === 'familie') {
      const a = z.int(30, 52);
      const zweiEltern = z.ja(0.7);
      const ersteG = z.wahl(['m', 'w']);
      person(h, h.nachname, ersteG, a, 'zahler');
      if (zweiEltern) person(h, h.nachname, ersteG === 'm' ? 'w' : 'm', Math.max(25, a + z.int(-5, 4)), 'partner');
      const kinder = z.gewichtet([[1, 35], [2, 45], [3, 20]]);
      for (let i = 0; i < kinder; i++) person(h, h.nachname, z.wahl(['m', 'w']), Math.min(a - 20, z.gewichtet([[z.int(3, 14), 82], [z.int(15, 17), 18]])), 'kind');
      if (a >= 42 && z.ja(0.3)) person(h, h.nachname, z.wahl(['m', 'w']), z.int(19, 26), 'kind_erwachsen');   // Fall „Felix“
    } else {
      externe++;
      h.externerZahler = z.wahl(VORNAMEN.w.mittel.concat(VORNAMEN.m.mittel)) + ' ' + h.nachname;
      person(h, h.nachname, z.wahl(['m', 'w']), z.int(6, 16), 'kind');
    }
  }
  // Auf genaue Anzahl kürzen (letzter Haushalt ggf. teilweise)
  while (personen.length > opt.mitglieder) {
    const p = personen.pop();
    p._haushalt.personen.splice(p._haushalt.personen.indexOf(p), 1);
  }
  const haushalteMitPersonen = haushalte.filter(h => h.personen.length);

  // Zwei reine Funktionsträger ohne Mitgliedschaft (V6) – zählen zusätzlich
  const extTrainer = [];
  for (let i = 0; i < 2; i++) {
    const h = { typ: 'extern', adresse: adresse(), telefon: null, personen: [], nachname: z.wahl(NACHNAMEN) };
    const p = person(h, h.nachname, z.wahl(['m', 'w']), z.int(25, 50), 'extern');
    p.nur_funktionstraeger = true;
    p.bemerkung = 'Externe Übungsleitung ohne Vereinsmitgliedschaft';
    extTrainer.push(p);
  }

  // IDs und Mitgliedsnummern vergeben (Haushaltsreihenfolge)
  personen.forEach(p => { p.mitglied_id = neueId('Mitglied'); p.mitgliedsnummer = neueNummer(); });

  // ---- Mitgliedschaftszeiträume und Status (je Haushalt gemeinsam)
  function zeitraum(p, ein, aus, grund, kuendigung) {
    const zr = {
      zeitraum_id: null, mitglied_id: p.mitglied_id, antrag_am: null, aufnahme_beschluss_am: null, aufnahmeantrag_id: null,
      eintrittsdatum: ein, austrittsdatum: aus || null, kuendigung_eingang: kuendigung || null,
      austritt_wirksam: aus || null, austrittsgrund: grund || null, bemerkung: null,
      version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
    };
    p._zeitraeume.push(zr);
    return zr;
  }
  haushalteMitPersonen.forEach(h => {
    const status = z.gewichtet([['aktiv', 84], ['ausgetreten', 12.5], ['gekuendigt', 1.5]]);
    h.status = status;
    const aelteste = h.personen.reduce((m, p) => Math.max(m, p._alter), 0);
    // Gemeinsames Eintrittsdatum des Haushalts: frühestens mit 6 Jahren der ältesten Person, nicht vor 1960
    const fruehest = Math.max(1960, JAHR - aelteste + 6);
    const einH = zufallsDatum(z, Math.min(fruehest, JAHR), STICHTAG);
    h.eintritt = einH.slice(0, 8) + '01';
    h.personen.forEach(p => {
      let ein = max(h.eintritt, plusTage(p.geburtsdatum, 30));
      if (ein > STICHTAG) ein = STICHTAG.slice(0, 8) + '01';
      if (status === 'ausgetreten') {
        const ausJ = Math.min(JAHR - 1, Math.max(jahrVon(ein) + 1, z.int(Math.max(jahrVon(ein) + 1, JAHR - 15), JAHR - 1)));
        if (ausJ >= jahrVon(ein) + 1 && ausJ < JAHR) {
          zeitraum(p, ein, iso(ausJ, 12, 31), z.gewichtet([['Umzug', 4], ['Unzufriedenheit', 1], ['Beitrag', 1], ['Vereinswechsel', 2], ['ohne Angabe', 3]]), iso(ausJ, z.int(8, 9), z.int(1, 28)));
          p.status = 'ausgetreten';
          return;
        }
      }
      if (status === 'gekuendigt' && p._alter >= 18) {
        zeitraum(p, ein, iso(JAHR, 12, 31), z.wahl(['Umzug', 'ohne Angabe', 'Vereinswechsel']), iso(JAHR, z.int(6, 9), z.int(1, 28)));
      } else zeitraum(p, ein);
      p.status = 'aktiv';
    });
  });
  // Wiedereintritte (~3 %): aktive Erwachsene mit langer Mitgliedschaft bekommen einen früheren, beendeten Zeitraum
  personen.filter(p => p.status === 'aktiv' && p._alter >= 40 && !p.nur_funktionstraeger).forEach(p => {
    if (!z.ja(0.08)) return;
    const z0 = p._zeitraeume[0];
    const startJ = Math.max(jahrVon(p.geburtsdatum) + 8, 1960);
    if (jahrVon(z0.eintrittsdatum) - startJ < 6) return;
    const ein = iso(z.int(startJ, jahrVon(z0.eintrittsdatum) - 5), 1, 1);
    const ausJ = z.int(jahrVon(ein) + 2, jahrVon(z0.eintrittsdatum) - 2);
    const alt = zeitraum(p, ein, iso(ausJ, 12, 31), 'Umzug', iso(ausJ, 9, 15));   // hängt hinten an …
    p._zeitraeume.pop();
    p._zeitraeume.unshift(alt);                                                   // … gehört aber nach vorn
    z0.bemerkung = 'Wiedereintritt – gleiche Mitgliedsnummer, neue Zeile';
  });
  // Verstorbene (~2 %): ältere aktive Einzelpersonen
  personen.filter(p => p.status === 'aktiv' && p._alter >= 70 && p._haushalt.typ === 'einzel').forEach(p => {
    if (!z.ja(0.35)) return;
    const letzter = p._zeitraeume[p._zeitraeume.length - 1];
    const tod = zufallsDatum(z, Math.max(JAHR - 6, jahrVon(letzter.eintrittsdatum) + 1), STICHTAG);
    if (tod <= letzter.eintrittsdatum) return;
    p.sterbedatum = tod;
    p.status = 'verstorben';
    letzter.austrittsdatum = tod; letzter.austritt_wirksam = tod; letzter.austrittsgrund = 'verstorben';
    letzter.bemerkung = 'Ende durch Sterbedatum';
    p._haushalt.status = 'verstorben';
  });
  personen.forEach(p => p._zeitraeume.forEach(zr => { zr.zeitraum_id = neueId('Mitgliedschaftszeitraum'); daten.Mitgliedschaftszeitraum.push(zr); }));
  extTrainer.forEach(p => { p.status = null; });
  const istAktiv = p => p.status === 'aktiv';
  const austrittVon = p => { const l = p._zeitraeume[p._zeitraeume.length - 1]; return l ? l.austrittsdatum : null; };

  // Vertretung Minderjähriger
  personen.forEach(p => {
    if (p._alter >= 18 || p.nur_funktionstraeger) return;
    const eltern = p._haushalt.personen.filter(x => x._rolle === 'zahler' || x._rolle === 'partner');
    if (eltern.length) p.vertreter_mitglied_id = eltern[0].mitglied_id;
    else { p.vertreter_name = p._haushalt.externerZahler; p.vertreter_kontakt = handy(); }
  });

  // ---- Beitragsgemeinschaften, Konten, Beitragsarten
  const konten = [];
  haushalteMitPersonen.forEach(h => {
    const zahler = h.personen[0];
    let gemeinschaft = null;
    if ((h.typ === 'paar' && h.personen.length >= 2) || (h.typ === 'familie' && h.personen.filter(p => p._rolle !== 'kind_erwachsen').length >= 2)) {
      gemeinschaft = {
        beitragsgemeinschaft_id: neueId('Beitragsgemeinschaft'),
        bezeichnung: (h.typ === 'paar' ? 'Ehepaar ' : 'Familie ') + h.nachname,
        festbetrag: h.typ === 'paar' ? FESTBETRAG_PAAR : FESTBETRAG_FAMILIE,
        aktiv: h.status !== 'ausgetreten', bemerkung: null,
        version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
      };
      daten.Beitragsgemeinschaft.push(gemeinschaft);
    }
    const zahlweg = z.gewichtet([['Lastschrift', 90], ['Überweisung', 8], ['bar', 2]]);
    const extern = h.typ === 'kind_extern';
    const konto = {
      beitragskonto_id: neueId('Beitragskonto'),
      kontoinhaber_name: extern ? h.nachname + ', ' + h.externerZahler.split(' ')[0] : zahler.nachname + ', ' + zahler.vorname,
      kontoinhaber_mitglied_id: extern ? null : zahler.mitglied_id,
      zahlweg, iban: null, bic: null, mandatsreferenz: null, mandatsdatum: null,
      abw_strasse: null, abw_hausnummer: null, abw_plz: null, abw_ort: null, abw_land: null,
      aktiv: h.status !== 'ausgetreten' && h.status !== 'verstorben', bemerkung: extern ? 'Kontoinhaber ist kein Mitglied (Elternteil)' : null,
      version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de',
      _haushalt: h
    };
    if (zahlweg === 'Lastschrift') {
      const bank = z.wahl(BANKEN);
      konto.iban = iban(bank[0], pad(z.int(1, 9999999999), 10));
      konto.bic = bank[1];
      const mdat = max(h.eintritt, zufallsDatum(z, jahrVon(h.eintritt), min(STICHTAG, plusMonate(h.eintritt, 6))));
      konto.mandatsdatum = mdat;
      konto.mandatsreferenz = 'TSV-' + jahrVon(mdat) + '-' + (extern ? 'E' + zahler.mitgliedsnummer : zahler.mitgliedsnummer);
    }
    if (z.ja(0.006) || (extern && z.ja(0.5))) {
      const a = adresse();
      Object.assign(konto, { abw_strasse: a.strasse, abw_hausnummer: a.hausnummer, abw_plz: a.plz, abw_ort: a.ort, abw_land: 'DE' });
    }
    konten.push(konto);
    h.konto = konto;
    h.personen.forEach(p => {
      p.beitragskonto_id = konto.beitragskonto_id;
      if (gemeinschaft && p._rolle !== 'kind_erwachsen') p.beitragsgemeinschaft_id = gemeinschaft.beitragsgemeinschaft_id;
      else p.beitragsart_id = p._alter <= 17 ? 2 : (z.ja(0.04) ? 3 : 1);
    });
  });
  // Ehrenmitglieder ohne Beitragsbefreiung: nichts zu tun. Externe Funktionsträger: kein Konto, kein Beitrag.
  daten.Beitragskonto = konten;

  // ---- Abteilungszugehörigkeiten
  const ABT = [[1, 35], [2, 22], [3, 12], [4, 5]];
  personen.forEach(p => {
    if (p.nur_funktionstraeger) return;
    const anzahl = z.gewichtet([[1, 74], [2, 21], [3, 5]]);
    const gewaehlt = new Set();
    while (gewaehlt.size < anzahl) {
      const gew = ABT.map(([a, g]) => [a, a === 4 ? (p._alter > 45 ? g * 3 : g * 0.3) : a === 3 ? g : (a === 1 || a === 2) && p._alter < 18 ? g * 1.6 : g]);
      gewaehlt.add(z.gewichtet(gew));
    }
    const ersterZr = p._zeitraeume[p._zeitraeume.length - 1];
    gewaehlt.forEach(a => {
      const ein = max(ersterZr.eintrittsdatum, zufallsDatum(z, jahrVon(ersterZr.eintrittsdatum), min(STICHTAG, plusMonate(ersterZr.eintrittsdatum, 36))));
      daten.Abteilungszugehoerigkeit.push({
        zugehoerigkeit_id: neueId('Abteilungszugehoerigkeit'), mitglied_id: p.mitglied_id, abteilung_id: a, passnummer: a === 1 && z.ja(0.4) ? 'SP-' + z.int(100000, 999999) : null,
        status: p._alter > 50 && z.ja(0.25) || z.ja(0.06) ? 'passiv' : 'aktiv',
        eintrittsdatum: ein, austrittsdatum: istAktiv(p) ? null : austrittVon(p),
        bemerkung: p.status === 'verstorben' ? 'Ende durch Sterbedatum' : null,
        version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
      });
    });
  });
  // Historische Skiabteilung (ruht seit 2019): einige beendete Zugehörigkeiten
  personen.filter(p => p._alter > 40 && !p.nur_funktionstraeger && jahrVon(p._zeitraeume[0].eintrittsdatum) < 2010).slice(0, 25).forEach(p => {
    daten.Abteilungszugehoerigkeit.push({
      zugehoerigkeit_id: neueId('Abteilungszugehoerigkeit'), mitglied_id: p.mitglied_id, abteilung_id: 5, passnummer: null, status: 'aktiv',
      eintrittsdatum: p._zeitraeume[0].eintrittsdatum, austrittsdatum: min(iso(2019, 3, 31), austrittVon(p) || '9999-12-31'),
      bemerkung: 'Skiabteilung ruht seit 2019', version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
    });
  });

  // ---- Funktionen
  const aktiveErwachsene = personen.filter(p => istAktiv(p) && p._alter >= 21 && p._alter <= 70);
  const benutzt = new Set();
  function holeTraeger(filter) {
    let kandidaten = aktiveErwachsene.filter(p => !benutzt.has(p.mitglied_id) && (!filter || filter(p)));
    if (!kandidaten.length) kandidaten = aktiveErwachsene.filter(p => !filter || filter(p));   // kleiner Verein: Ämterhäufung
    if (!kandidaten.length) kandidaten = aktiveErwachsene;
    const p = z.wahl(kandidaten);
    benutzt.add(p.mitglied_id);
    return p;
  }
  function funktion(p, artId, abtId, zusatz, von, bis, grund) {
    const f = {
      funktion_id: neueId('Funktion'), mitglied_id: p.mitglied_id, funktionsart_id: artId, abteilung_id: abtId || null,
      zusatz: zusatz || null, von, bis: bis || null, bestellt_am: null, beendigungsgrund: grund || null, bemerkung: null,
      version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
    };
    daten.Funktion.push(f);
    return f;
  }
  const seitMitglied = p => p._zeitraeume[p._zeitraeume.length - 1].eintrittsdatum;
  function vonFuer(p, minJahre) {
    const fruehest = max(seitMitglied(p), iso(jahrVon(p.geburtsdatum) + 20, 1, 1));
    const v = zufallsDatum(z, jahrVon(fruehest), STICHTAG);
    return max(fruehest, minJahre ? min(v, plusMonate(STICHTAG, -12 * minJahre)) : v).slice(0, 8) + '01';
  }
  const laufend = {};
  // Vereinsämter
  [[1, 1], [2, 1], [3, 1], [4, 1], [5, 3], [6, 1], [11, 1], [12, 1], [13, 2]].forEach(([art, n]) => {
    for (let i = 0; i < n; i++) {
      const p = holeTraeger(art === 6 ? (x => x._alter < 45) : null);
      const f = funktion(p, art, null, null, vonFuer(p, art === 3 ? 12 : 0));
      (laufend[art] = laufend[art] || []).push({ p, f });
    }
  });
  // Abteilungsämter
  [1, 2, 3, 4].forEach(abt => {
    const mitglieder = new Set(daten.Abteilungszugehoerigkeit.filter(a => a.abteilung_id === abt && !a.austrittsdatum).map(a => a.mitglied_id));
    const inAbt = p => mitglieder.has(p.mitglied_id);
    const al = holeTraeger(inAbt);
    (laufend['7_' + abt] = []).push({ p: al, f: funktion(al, 7, abt, null, vonFuer(al, abt === 1 ? 10 : 0)) });
    const trainer = { 1: 8, 2: 5, 3: 2, 4: 1 }[abt];
    for (let i = 0; i < trainer; i++) {
      const p = holeTraeger(x => inAbt(x) && x._alter <= 60);
      (laufend[8] = laufend[8] || []).push({ p, f: funktion(p, 8, abt, z.wahl(MANNSCHAFTEN[abt]), vonFuer(p)) });
    }
    const betreuer = { 1: 3, 2: 2, 3: 1, 4: 0 }[abt];
    for (let i = 0; i < betreuer; i++) {
      const p = holeTraeger(inAbt);
      (laufend[9] = laufend[9] || []).push({ p, f: funktion(p, 9, abt, z.wahl(MANNSCHAFTEN[abt]), vonFuer(p)) });
    }
  });
  for (let i = 0; i < 2; i++) { const p = holeTraeger(); funktion(p, 10, 1, null, vonFuer(p)); }
  // Externe Übungsleitung (V6)
  extTrainer.forEach((p, i) => { (laufend[8] = laufend[8] || []).push({ p, f: funktion(p, 8, 2, z.wahl(MANNSCHAFTEN[2]), iso(JAHR - 1 - i, 9, 1)) }); });
  // Beendete Funktionen (Historie)
  const GRUENDE = ['Rücktritt', 'nicht wiedergewählt', 'beruflich', 'Umzug', 'Wechsel ins Amt der Abteilungsleitung', 'Altersgründe'];
  const historisch = personen.filter(p => p._alter >= 30 && !p.nur_funktionstraeger && jahrVon(p._zeitraeume[0].eintrittsdatum) <= JAHR - 4);
  const endeFZ = [];
  for (let i = 0; i < 150; i++) {
    const p = z.wahl(historisch);
    const art = z.gewichtet([[8, 45], [9, 20], [7, 8], [5, 8], [4, 4], [11, 5], [10, 5], [13, 5]]);
    const ebene = funktionsart(art).ebene;
    const zrs = p._zeitraeume;
    const zr = z.wahl(zrs);
    const ende = zr.austrittsdatum || STICHTAG;
    const fruehest = max(zr.eintrittsdatum, iso(jahrVon(p.geburtsdatum) + 18, 1, 1));
    if (fruehest >= ende) continue;
    const von = zufallsDatum(z, jahrVon(fruehest), ende);
    if (von < fruehest) continue;
    let bis = zufallsDatum(z, jahrVon(von), ende);
    if (bis <= von) bis = min(ende, plusMonate(von, 12));
    if (bis >= STICHTAG) bis = plusTage(STICHTAG, -z.int(30, 400));
    if (bis <= von) continue;
    const abt = ebene === 'Abteilung' ? z.wahl([1, 1, 2, 2, 3, 4]) : null;
    const f = funktion(p, art, abt, abt && z.ja(0.6) ? z.wahl(MANNSCHAFTEN[abt]) : null, von.slice(0, 8) + '01', bis, z.wahl(GRUENDE));
    if (funktionsart(art).fz_pflichtig === 'ja' && bis >= plusMonate(STICHTAG, -3)) endeFZ.push({ p, f });
  }

  // ---- Qualifikationen (Führungszeugnis + Lizenzen)
  const fzPersonen = new Map();
  Object.keys(laufend).forEach(k => laufend[k].forEach(({ p, f }) => {
    if (funktionsart(f.funktionsart_id).fz_pflichtig === 'ja' && !fzPersonen.has(p.mitglied_id)) fzPersonen.set(p.mitglied_id, { p, f });
  }));
  function quali(p, artId, f, werte) {
    daten.Qualifikation.push(Object.assign({
      qualifikation_id: neueId('Qualifikation'), mitglied_id: p.mitglied_id, qualifikationsart_id: artId, funktion_id: f ? f.funktion_id : null,
      ausgestellt_am: null, eingesehen_am: null, eingesehen_durch: null, ergebnis: null, gueltig_bis: null,
      wiedervorlage_am: null, zu_loeschen_ab: null, geloescht_am: null, bemerkung: null,
      version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
    }, werte));
  }
  const alNamen = (laufend['7_1'] || []).map(x => x.p.nachname + ', ' + x.p.vorname);
  fzPersonen.forEach(({ p, f }) => {
    const lage = z.gewichtet([['gueltig', 80], ['laeuft_ab', 8], ['fehlt', 7], ['abgelaufen', 5]]);
    if (lage === 'fehlt') return;
    let eingesehen;
    if (lage === 'gueltig') eingesehen = zufallsDatum(z, JAHR - 4, plusMonate(STICHTAG, -1));
    else if (lage === 'laeuft_ab') eingesehen = plusTage(plusMonate(STICHTAG, -60), z.int(5, 80));
    else eingesehen = plusTage(plusMonate(STICHTAG, -60), -z.int(20, 300));
    quali(p, 1, f, {
      ausgestellt_am: plusTage(eingesehen, -z.int(5, 40)), eingesehen_am: eingesehen,
      eingesehen_durch: z.ja(0.6) ? 'Vorstandschaft' : z.wahl(alNamen.length ? alNamen : ['Vorstandschaft']),
      ergebnis: 'ohne einschlägigen Eintrag', wiedervorlage_am: plusMonate(eingesehen, 60),
      bemerkung: lage === 'laeuft_ab' ? 'Wiedervorlage steht an' : null
    });
    if (f.funktionsart_id === 8 && z.ja(0.6)) {
      const aus = zufallsDatum(z, JAHR - 5, STICHTAG);
      quali(p, z.wahl([2, 2, 3, 4]), f, { ausgestellt_am: aus, gueltig_bis: iso(jahrVon(aus) + 4, 12, 31) });
    }
    if (z.ja(0.5)) {
      const aus = zufallsDatum(z, JAHR - 3, STICHTAG);
      quali(p, 5, f, { ausgestellt_am: aus, gueltig_bis: plusMonate(aus, 24) });
    }
  });
  // Ende der Funktion vor kurzem, keine andere FZ-pflichtige laufende Funktion → Vermerk ist zu löschen
  endeFZ.filter(({ p }) => !fzPersonen.has(p.mitglied_id)).slice(0, 3).forEach(({ p, f }) => {
    const eing = plusMonate(f.von, 1);
    quali(p, 1, f, {
      ausgestellt_am: plusTage(eing, -14), eingesehen_am: eing, eingesehen_durch: 'Vorstandschaft',
      ergebnis: 'ohne einschlägigen Eintrag', wiedervorlage_am: plusMonate(eing, 60), zu_loeschen_ab: plusMonate(f.bis, 3),
      bemerkung: 'Funktion beendet – Vermerk nach Frist löschen'
    });
  });

  // ---- Sollstellungen (letzte 3 Jahre)
  const jahre = [JAHR - 2, JAHR - 1, JAHR];
  const ungenutzt = konten.filter(k => k.zahlweg === 'Lastschrift' && k.aktiv && jahrVon(k.mandatsdatum) < JAHR - 6).slice(0, 2);
  konten.forEach(k => {
    const h = k._haushalt;
    let gesehenFrst = false;
    const jahreKonto = ungenutzt.includes(k) ? [JAHR - 4, JAHR] : jahre;
    jahreKonto.forEach(j => {
      const stichJ = iso(j, 2, 15);
      const zahlende = h.personen.filter(p => p._zeitraeume.some(zr => zr.eintrittsdatum <= iso(j, 12, 31) && (!zr.austrittsdatum || zr.austrittsdatum >= iso(j, 1, 1))));
      if (!zahlende.length) return;
      const gemeinschaften = new Set();
      let betrag = 0;
      zahlende.forEach(p => {
        if (p.beitragsgemeinschaft_id) {
          if (!gemeinschaften.has(p.beitragsgemeinschaft_id)) {
            gemeinschaften.add(p.beitragsgemeinschaft_id);
            betrag += daten.Beitragsgemeinschaft.find(g => g.beitragsgemeinschaft_id === p.beitragsgemeinschaft_id).festbetrag;
          }
        } else if (p.beitragsart_id) betrag += BEITRAG[p.beitragsart_id];
      });
      if (!betrag) return;
      const lastschrift = k.zahlweg === 'Lastschrift';
      const ersteMoeglich = lastschrift && !gesehenFrst && (jahrVon(k.mandatsdatum) >= j || j === jahreKonto[0] && jahrVon(k.mandatsdatum) === j);
      const tot = zahlende.every(p => p.sterbedatum && jahrVon(p.sterbedatum) === j && p.sterbedatum < stichJ);
      let status = tot ? 'storniert' : z.gewichtet([['bezahlt', 95], ['ruecklastschrift', lastschrift ? 2.2 : 0], ['gemahnt', 1.2], ['offen', j === JAHR && !lastschrift ? 30 : 0.3]]);
      if (ungenutzt.includes(k) && j === JAHR) status = 'offen';
      const sequenz = !lastschrift || tot || (ungenutzt.includes(k) && j === JAHR) ? null : (ersteMoeglich || !gesehenFrst && jahrVon(k.mandatsdatum) === j ? 'FRST' : 'RCUR');
      if (sequenz) gesehenFrst = true;
      const einzug = jahrVon(k.mandatsdatum || h.eintritt) === j && (k.mandatsdatum || h.eintritt) > stichJ ? iso(j, 9, 15) : stichJ;
      daten.Sollstellung.push({
        sollstellung_id: neueId('Sollstellung'), beitragskonto_id: k.beitragskonto_id, jahr: j, soll_betrag: betrag,
        ist_betrag: status === 'bezahlt' ? betrag : status === 'ruecklastschrift' || status === 'gemahnt' ? 0 : null,
        gebuehr: status === 'ruecklastschrift' ? 5 : null, status, sepa_sequenz: sequenz,
        einzugsdatum: einzug, buchungsdatum: status === 'bezahlt' ? (lastschrift ? einzug : plusTage(einzug, z.int(1, 60))) : null,
        mahnstufe: status === 'gemahnt' ? z.int(1, 2) : status === 'ruecklastschrift' ? 1 : 0,
        ruecklastschrift_grund: status === 'ruecklastschrift' ? z.wahl(['Konto erloschen', 'keine Deckung', 'Widerspruch']) : null,
        bemerkung: tot ? 'Verstorben – Sollstellung storniert' : ungenutzt.includes(k) && j === JAHR ? 'Mandat seit über 36 Monaten ungenutzt – Verfall prüfen' : null,
        version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
      });
    });
  });

  // ---- Ehrungen
  const regeln = daten.Ehrungsregel.map(r => ({ id: Number(r.ehrungsregel_id), typ: r.typ, schwelle: Number(r.schwelle) }));
  const jhv = j => 'Jahreshauptversammlung ' + (j + 1);
  personen.forEach(p => {
    if (!istAktiv(p)) return;
    const seit = jahrVon(seitMitglied(p));
    regeln.filter(r => r.typ === 'Mitgliedsjubiläum').forEach(r => {
      const j = seit + r.schwelle;
      if (j < JAHR - 2 || j > JAHR) return;
      const status = j === JAHR ? 'fällig' : z.gewichtet([['verliehen', 85], ['verschoben', 10], ['abgelehnt', 5]]);
      daten.Ehrung.push({
        ehrung_id: neueId('Ehrung'), mitglied_id: p.mitglied_id, ehrungsregel_id: r.id, funktion_id: null, faellig_jahr: j, status,
        verliehen_am: status === 'verliehen' ? iso(j + 1, 3, z.int(5, 25)) : null, veranstaltung: status === 'verliehen' || status === 'fällig' ? jhv(j) : null,
        bemerkung: status === 'verschoben' ? 'Nicht erschienen – nachholen' : null,
        version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
      });
    });
    regeln.filter(r => r.typ === 'Geburtstag').forEach(r => {
      if (jahrVon(p.geburtsdatum) + r.schwelle !== JAHR) return;
      daten.Ehrung.push({
        ehrung_id: neueId('Ehrung'), mitglied_id: p.mitglied_id, ehrungsregel_id: r.id, funktion_id: null, faellig_jahr: JAHR,
        status: p.geburtsdatum.slice(5) < STICHTAG.slice(5) && z.ja(0.7) ? 'verliehen' : 'fällig',
        verliehen_am: null, veranstaltung: null, bemerkung: null,
        version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
      });
    });
  });
  daten.Ehrung.filter(e => e.status === 'verliehen' && !e.verliehen_am).forEach(e => { e.verliehen_am = plusTage(STICHTAG, -z.int(5, 200)); });
  // Funktionsjubiläum (je Funktion) für laufende ehrungsfähige Funktionen
  daten.Funktion.filter(f => !f.bis).forEach(f => {
    const jahreF = JAHR - jahrVon(f.von);
    const r = regeln.find(x => x.typ === 'Funktionsjubiläum' && x.schwelle === jahreF);
    if (!r || funktionsart(f.funktionsart_id).ehrungsfaehig !== 'ja') return;
    daten.Ehrung.push({
      ehrung_id: neueId('Ehrung'), mitglied_id: f.mitglied_id, ehrungsregel_id: r.id, funktion_id: f.funktion_id, faellig_jahr: JAHR,
      status: 'fällig', verliehen_am: null, veranstaltung: jhv(JAHR), bemerkung: null,
      version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
    });
  });

  // ---- Einwilligungen
  personen.forEach(p => {
    if (p.nur_funktionstraeger) return;
    const vertreter = p._alter < 18 ? (p.vertreter_name || (() => { const v = personen.find(x => x.mitglied_id === p.vertreter_mitglied_id); return v ? v.nachname + ', ' + v.vorname : null; })()) : null;
    const seit = p._zeitraeume[p._zeitraeume.length - 1].eintrittsdatum;
    const basis = max(seit, '2018-05-25');
    if (z.ja(0.62)) {
      const am = basis > STICHTAG ? STICHTAG : basis;
      const widerruf = z.ja(0.05) ? zufallsDatum(z, jahrVon(am), STICHTAG) : null;
      daten.Einwilligung.push({
        einwilligung_id: neueId('Einwilligung'), mitglied_id: p.mitglied_id, art: 'Fotos und Videos',
        umfang: z.wahl(['Vereinsmedien und Presse', 'nur Vereinsmedien']), erteilt_am: am,
        erteilt_form: seit >= '2018-05-25' ? 'Aufnahmeantrag' : 'gesondert schriftlich',
        erteilt_durch: vertreter ? vertreter + ' (gesetzliche Vertretung)' : null,
        widerrufen_am: widerruf && widerruf > am ? widerruf : null, nachweis_ort: 'Ordner Einwilligungen ' + jahrVon(am),
        bemerkung: widerruf && widerruf > am ? 'Widerruf – seither keine Fotos verwenden' : null,
        version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
      });
    }
    if (p._alter >= 60 && z.ja(0.4)) {
      daten.Einwilligung.push({
        einwilligung_id: neueId('Einwilligung'), mitglied_id: p.mitglied_id, art: 'Ehrungen und Geburtstage in Vereinsmedien',
        umfang: 'Mitteilungsblatt der Gemeinde', erteilt_am: basis > STICHTAG ? STICHTAG : basis, erteilt_form: 'gesondert schriftlich',
        erteilt_durch: null, widerrufen_am: null, nachweis_ort: 'Ordner Einwilligungen', bemerkung: null,
        version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
      });
    }
    if (p.email && z.ja(0.3)) {
      daten.Einwilligung.push({
        einwilligung_id: neueId('Einwilligung'), mitglied_id: p.mitglied_id, art: 'Newsletter per E-Mail', umfang: 'Vereinsnachrichten',
        erteilt_am: basis > STICHTAG ? STICHTAG : basis, erteilt_form: 'digital', erteilt_durch: null, widerrufen_am: null,
        nachweis_ort: 'Bestätigungsmail', bemerkung: null,
        version: 1, geaendert_am: AENDERUNG, geaendert_von: 'migration@tsv-ergoldsbach.de'
      });
    }
  });

  // ---- Benutzer (eine Person mit zwei Rollen: Abteilungsleitung Turnen + Jugendleitung)
  const vorsitz = laufend[1][0].p, kassier = laufend[3][0].p, alF = laufend['7_1'][0].p, alT = laufend['7_2'][0].p;
  // Jugendleiter-Funktion an die AL Turnen übergeben, damit Amt und Zugang zusammenpassen
  const jlF = laufend[6][0].f;
  jlF.mitglied_id = alT.mitglied_id;
  const benutzer = [
    ['vorstand@tsv-ergoldsbach.de', vorsitz, 'Vorstand', null],
    ['verwaltung@tsv-ergoldsbach.de', null, 'Mitgliederverwalter', null],
    ['kassier@tsv-ergoldsbach.de', kassier, 'Kassier', null],
    ['fussball@tsv-ergoldsbach.de', alF, 'Abteilungsleiter', 1],
    ['turnen@tsv-ergoldsbach.de', alT, 'Abteilungsleiter', 2],
    ['turnen@tsv-ergoldsbach.de', alT, 'Jugendleiter', null]
  ];
  benutzer.forEach(([email, p, rolle, abt]) => daten.Benutzer.push({
    benutzer_id: neueId('Benutzer'), email, name: p ? p.vorname + ' ' + p.nachname : 'Mitgliederverwaltung', rolle,
    abteilung_id: abt, mitglied_id: p ? p.mitglied_id : null, aktiv: true, angelegt_am: iso(JAHR, 9, 1),
    bemerkung: rolle === 'Mitgliederverwalter' ? 'Funktionskonto – Administrator' : null,
    version: 1, geaendert_am: AENDERUNG, geaendert_von: 'verwaltung@tsv-ergoldsbach.de'
  }));

  // ---- Absichtliche Datenfehler (nur mit Option fehler)
  if (opt.fehler) {
    const merke = (art, tab, id) => fehlerliste.push({ art, tab, id });
    konten.filter(k => k.zahlweg === 'Lastschrift' && k.aktiv).slice(3, 5).forEach(k => { k.mandatsreferenz = null; k.mandatsdatum = null; merke('lastschrift_ohne_mandat', 'Beitragskonto', k.beitragskonto_id); });
    haushalteMitPersonen.filter(h => h.typ === 'familie' && h.status === 'aktiv' && h.personen.filter(p => p.beitragsgemeinschaft_id).length >= 3).slice(0, 2).forEach(h => {
      const p = h.personen.filter(x => x.beitragsgemeinschaft_id)[2];
      const anderes = konten.find(k => k.aktiv && k !== h.konto && k.zahlweg === 'Lastschrift');
      p.beitragskonto_id = anderes.beitragskonto_id;
      merke('gemeinschaft_zwei_konten', 'Beitragsgemeinschaft', p.beitragsgemeinschaft_id);
    });
    personen.filter(p => istAktiv(p) && p.beitragsart_id && !p.beitragsgemeinschaft_id && p._haushalt.typ === 'einzel').slice(0, 2).forEach(p => { p.beitragsart_id = null; merke('aktiv_ohne_beitrag', 'Mitglied', p.mitglied_id); });
    haushalteMitPersonen.filter(h => h.typ === 'familie' && h.status === 'aktiv' && h.personen.length >= 3 && h.personen[0].status === 'aktiv').slice(5, 7).forEach(h => {
      const z0 = h.personen[0];
      const zr = z0._zeitraeume[z0._zeitraeume.length - 1];
      zr.austrittsdatum = iso(JAHR - 1, 12, 31); zr.austritt_wirksam = zr.austrittsdatum; zr.austrittsgrund = 'Umzug';
      z0.status = 'ausgetreten';
      merke('waise', 'Beitragskonto', h.konto.beitragskonto_id);
    });
    personen.filter(p => istAktiv(p) && p.hausnummer).slice(10, 12).forEach(p => { p.strasse = p.strasse + ' ' + p.hausnummer; p.hausnummer = null; merke('hausnummer_in_strasse', 'Mitglied', p.mitglied_id); });
    personen.filter(istAktiv).slice(20, 22).forEach(p => { p.geschlecht = null; merke('geschlecht_fehlt', 'Mitglied', p.mitglied_id); });
    personen.filter(istAktiv).slice(30, 32).forEach(p => { p.geburtsdatum = null; merke('geburtsdatum_fehlt', 'Mitglied', p.mitglied_id); });
  }

  // ---- Mitglieder übernehmen (interne Felder entfernen)
  daten.Mitglied = personen.map(p => {
    const o = {};
    Object.keys(p).forEach(k => { if (k[0] !== '_') o[k] = p[k]; });
    return o;
  });
  daten.Beitragskonto = konten.map(k => { const o = Object.assign({}, k); delete o._haushalt; return o; });

  // ---- _Konfig: Startbelegung + passende ID-Zähler
  const kSb = Start._Konfig;
  const iS = kSb.kopf.indexOf('schluessel');
  kSb.zeilen.forEach(zeile => {
    if (String(zeile[iS]).indexOf('next_id_') === 0) return;
    const o = {}; kSb.kopf.forEach((k, i) => { o[k] = zeile[i]; });
    if (o.schluessel === 'beitragsjahr') o.wert = String(JAHR);
    if (o.schluessel === 'mitgliedsnummer_naechste') o.wert = pad(naechsteNr + 1, 4);
    daten._Konfig.push(o);
  });
  Object.keys(Schema.TABELLEN).forEach(t => {
    const idSp = Schema.TABELLEN[t].idSpalte;
    if (!idSp || t === '_Protokoll') return;
    const maxId = daten[t].reduce((m, o) => Math.max(m, Number(o[idSp]) || 0), 0);
    daten._Konfig.push({ schluessel: 'next_id_' + t, wert: String(maxId + 1), beschreibung: 'ID-Zähler – nur vom Skript erhöhen' });
  });

  // ---- In Zellformat wandeln
  const tabs = {};
  Object.keys(Schema.TABELLEN).forEach(t => {
    // Array.from: Arrays aus dem vm-Kontext in normale Arrays dieses Prozesses wandeln (deepStrictEqual, JSON)
    const kopf = Array.from(Schema.TABELLEN[t].spalten, s => s.name);
    tabs[t] = [kopf].concat(daten[t].map(o => Array.from(Werte.objektZuZeile(kopf, o, t), v => v === undefined ? '' : v)));
  });
  return { tabs, fehlerliste, stichtag: STICHTAG };
}

/** Zellformat → Objekte wie DB.lese (Datum 'JJJJ-MM-TT', ja/nein → true/false, leer → null). */
function alsObjekte(tabs) {
  const Werte = ladeLib().Werte;
  const out = {};
  Object.keys(tabs).forEach(t => {
    const [kopf, ...zeilen] = tabs[t];
    out[t] = zeilen.map(z => JSON.parse(JSON.stringify(Werte.zeileZuObjekt(kopf, z, t))));
  });
  return out;
}

module.exports = { erzeugeVerein, alsObjekte, iban };
