#!/usr/bin/env node
/**
 * Erzeugt einen SYNTHETISCHEN Altbestand im Format der Access-Tabelle Daten16 – ALLES ERFUNDEN.
 * Keine echte Person, keine echte Bankverbindung (IBANs werden nur mit gültiger Prüfziffer gebildet).
 *
 * Zweck: Test der Migration (src/lib/migration.js, tools/migration-lokal.js) mit realistischen Altlasten und
 *        gezielt eingebauten Sonderfällen. Jeder eingebaute Fall steht in `faelle` mit der erwarteten Prüflisten-Art.
 *
 *   node tools/daten16-synthetisch.js [--anzahl 1200] [--seed 7] [--cp1252] [--ziel test/daten/daten16]
 *     → daten16.csv (Semikolon, TT.MM.JJJJ wie ein Access-Export), austritte.csv (AustritteAb2010), faelle.json
 *
 *   require('./tools/daten16-synthetisch').erzeugeDaten16({ seed, anzahl }) → { kopf, zeilen, austritte, faelle }
 */
'use strict';
const fs = require('fs');
const path = require('path');

const KOPF = ['ID', 'MitglNr', 'Anrede', 'Nachname', 'Vorname', 'Titel', 'Strasse', 'Plz', 'Ort', 'GebDat', 'EinDat', 'AusDat',
  'Telefon', 'Handy', 'email', 'ReZiff', 'BLZ', 'KONTO', 'BANK', 'IBAN', 'BIC', 'Kontoinhaber', 'Gesamtbeitrag', 'Zahler',
  'Bemerkung', 'Abteilung 1', 'Status Abteilung 1', 'Betrag 1', 'Abteilung 2', 'Beitrag Abt 2', 'Betrag 2', 'Abteilung 3',
  'Beitrag Abt 3', 'Betrag 3', 'Abteilung 4', 'Beitrag Abt 4', 'Betrag 4', 'Arbeitsdatum', 'Geschlecht', 'Zahlung'];

const NACHNAMEN = ['Huber', 'Bauer', 'Wagner', 'Maier', 'Schmid', 'Hofmann', 'Brandl', 'Obermeier', 'Lehner', 'Vogl', 'Aigner',
  'Steinberger', 'Kellner', 'Sedlmeier', 'Fischer', 'Neumann', 'Zellner', 'Riedl', 'Gruber', 'Pichler', 'Wimmer', 'Eder',
  'Moser', 'Mayr', 'Holzer', 'Reiter', 'Hartl', 'Forster', 'Kerscher', 'Straßer', 'Dietl', 'Kronseder', 'Pongratz', 'Seidl'];
const VORNAMEN_M = ['Josef', 'Thomas', 'Michael', 'Andreas', 'Stefan', 'Franz', 'Georg', 'Korbinian', 'Felix', 'Lukas', 'Maximilian', 'Johann', 'Sebastian', 'Anton'];
const VORNAMEN_W = ['Anna', 'Maria', 'Sabine', 'Julia', 'Lena', 'Theresa', 'Katharina', 'Rita', 'Marion', 'Petra', 'Sophie', 'Magdalena', 'Laura'];
const STRASSEN = ['Rosenweg', 'Hauptstraße', 'Schulweg', 'Lindenallee', 'Ahornstraße', 'Kirchgasse', 'Bahnhofstraße', 'Birkenweg',
  'Mühlweg', 'Feldstraße', 'Am Anger', 'Ringstraße', 'Am Bach', 'Sonnenstraße', 'Bergstr.'];
const ORTE = [['84061', 'Ergoldsbach'], ['84061', 'Ergoldsbach'], ['84061', 'Ergoldsbach'], ['84085', 'Langquaid'], ['84028', 'Landshut'], ['84079', 'Bruckberg']];
const BANKEN = [['74350000', 'BYLADEM1LAH', 'Sparkasse Landshut'], ['74390000', 'GENODEF1LH1', 'VR-Bank Landshut'], ['74150000', 'BYLADEM1SRG', 'Sparkasse Straubing']];
const ABTEILUNGEN = ['Fußball', 'Turnen', 'Tennis', 'Stockschützen'];

function zufall(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { r, int: (a, b) => a + Math.floor(r() * (b - a + 1)), wahl: l => l[Math.floor(r() * l.length)], ja: p => r() < p };
}

function iban(blz, konto) {
  const bban = blz + ('0000000000' + konto).slice(-10);
  let rest = 0;
  for (const c of bban + '131400') rest = (rest * 10 + Number(c)) % 97;
  return 'DE' + ('0' + (98 - rest)).slice(-2) + bban;
}
const d = (j, m, t) => ('0' + t).slice(-2) + '.' + ('0' + m).slice(-2) + '.' + j;

function erzeugeDaten16(opt) {
  opt = opt || {};
  const z = zufall(opt.seed || 7);
  const anzahl = opt.anzahl || 1200;
  const zeilen = [], austritte = [], faelle = [];
  let id = 0, nr = 100;
  const fall = (art, zeile, info) => faelle.push({ art, mitglnr: zeile.MitglNr, id: zeile.ID, info: info || null });

  function person(f) {
    id++; nr += z.int(1, 2);
    const w = f.geschlecht === 'w';
    const geb = f.geb || [z.int(1940, 2003), z.int(1, 12), z.int(1, 28)];
    const ein = f.ein || [Math.min(Math.max(geb[0] + z.int(4, 30), 1970), 2025), z.int(1, 12), 1];
    if (f.aus && f.aus[0] <= ein[0]) f.aus = [Math.min(ein[0] + z.int(1, 5), 2025), 12, 31];
    if (f.aus && f.aus[0] <= ein[0]) f.aus = null;
    const [plz, ort] = f.ort || z.wahl(ORTE);
    const strasse = f.strasse || z.wahl(STRASSEN) + ' ' + z.int(1, 60);
    const zeile = Object.fromEntries(KOPF.map(k => [k, '']));
    Object.assign(zeile, {
      ID: String(id), MitglNr: ('0000' + nr).slice(-4), Anrede: f.anrede !== undefined ? f.anrede : (geb[0] > 2008 ? '' : (w ? 'Frau' : 'Herr')),
      Nachname: f.nachname, Vorname: f.vorname || z.wahl(w ? VORNAMEN_W : VORNAMEN_M), Strasse: strasse, Plz: plz, Ort: ort,
      GebDat: d(geb[0], geb[1], geb[2]),
      EinDat: f.ohneEintritt ? '' : d(ein[0], ein[1], ein[2]), AusDat: f.aus ? d(f.aus[0], f.aus[1], f.aus[2]) : '',
      Telefon: z.ja(0.5) ? '09452 ' + z.int(1000, 9999) : '', Handy: z.ja(0.5) ? '0151 ' + z.int(1000000, 9999999) : '',
      email: z.ja(0.6) ? (f.nachname.toLowerCase().replace('ß', 'ss') + '.' + id + '@example.de') : '',
      ReZiff: '0', Gesamtbeitrag: f.beitrag === null ? '' : String(f.beitrag).replace('.', ',') + ',00',
      Zahler: f.zahler || '', Bemerkung: f.bemerkung || '',
      'Abteilung 1': f.abt ? f.abt[0] || '' : '', 'Status Abteilung 1': f.abt && f.abt[0] ? (z.ja(0.15) ? 'passiv' : 'aktiv') : '',
      'Abteilung 2': f.abt ? f.abt[1] || '' : '', 'Abteilung 3': f.abt ? f.abt[2] || '' : '',
      'Betrag 1': '0', 'Beitrag Abt 2': '0', 'Betrag 2': '0',
      Arbeitsdatum: d(2025, z.int(1, 12), z.int(1, 28)), Geschlecht: f.ohneGeschlecht ? '' : (w ? 'w' : 'm'), Zahlung: f.zahlung || ''
    });
    if (f.bank !== false) {
      const b = z.wahl(BANKEN);
      const konto = String(z.int(100000, 9999999999));
      zeile.BLZ = b[0]; zeile.KONTO = konto; zeile.BANK = b[2]; zeile.BIC = b[1];
      zeile.IBAN = f.ohneIban ? '' : iban(b[0], konto);
      zeile.Kontoinhaber = f.nachname + ', ' + zeile.Vorname;
    }
    // Abhängige wohnen in der Regel beim Zahler
    const haupt = f.zahler && zeilen.find(x => x.MitglNr === f.zahler);
    if (haupt && !f.strasse) { zeile.Strasse = haupt.Strasse; zeile.Plz = haupt.Plz; zeile.Ort = haupt.Ort; }
    zeilen.push(zeile);
    return zeile;
  }
  const abt = () => { const l = [z.wahl(ABTEILUNGEN)]; if (z.ja(0.2)) l.push(z.wahl(ABTEILUNGEN.filter(a => a !== l[0]))); return l; };

  // --- gezielte Sonderfälle (je einmal) ---
  // Wagner-Fall: Familie mit Pauschale 180, erwachsener Sohn mit eigenem Beitrag auf dem Elternkonto
  const michael = person({ nachname: 'Wagner', vorname: 'Michael', beitrag: 180, abt: ['Fußball', 'Stockschützen'], geb: [1978, 3, 14], ein: [2001, 9, 1] });
  person({ nachname: 'Wagner', vorname: 'Sabine', geschlecht: 'w', beitrag: 0, zahler: michael.MitglNr, bank: false, abt: ['Turnen'], geb: [1980, 7, 2], ein: [2001, 9, 1] });
  person({ nachname: 'Wagner', vorname: 'Lena', geschlecht: 'w', beitrag: 0, zahler: michael.MitglNr, bank: false, abt: ['Turnen', 'Fußball'], geb: [2011, 11, 21], ein: [2018, 2, 1] });
  const felix = person({ nachname: 'Wagner', vorname: 'Felix', beitrag: 100, zahler: michael.MitglNr, bank: false, abt: ['Fußball'], geb: [2004, 5, 3], ein: [2018, 2, 1] });
  fall('wagner', michael, { felix: felix.MitglNr });
  // Zahler ausgetreten, Abhängige aktiv
  const alt = person({ nachname: 'Brandl', vorname: 'Josef', beitrag: 180, aus: [2024, 12, 31], abt: ['Tennis'] });
  person({ nachname: 'Brandl', vorname: 'Maria', geschlecht: 'w', beitrag: 0, zahler: alt.MitglNr, bank: false, abt: ['Turnen'] });
  person({ nachname: 'Brandl', vorname: 'Laura', geschlecht: 'w', beitrag: 0, zahler: alt.MitglNr, bank: false, geb: [2012, 4, 4] });
  fall('zahler_ausgetreten', alt);
  // Zahler-Verweis ins Leere
  fall('zahler_unbekannt', person({ nachname: 'Pichler', beitrag: 100, zahler: '9999', bank: false, abt: ['Fußball'] }));
  // Unterschiedliche IBAN im Cluster
  const vater = person({ nachname: 'Moser', beitrag: 100, abt: ['Tennis'] });
  fall('iban_abweichend', person({ nachname: 'Moser', vorname: 'Lukas', beitrag: 100, zahler: vater.MitglNr, abt: ['Tennis'] }));
  // Hausnummer-Varianten (werden korrekt getrennt – kein Prüffall) und eine ohne Nummer
  person({ nachname: 'Gruber', beitrag: 100, strasse: 'Am Anger 7 1/2' });
  person({ nachname: 'Gruber', vorname: 'Anton', beitrag: 100, strasse: 'Hauptstraße 12 a' });
  person({ nachname: 'Holzer', beitrag: 100, strasse: 'Lindenstr. 12-14' });
  fall('hausnummer', person({ nachname: 'Hartl', beitrag: 100, strasse: 'Hofmark' }));
  // 4-stellige PLZ
  fall('plz', person({ nachname: 'Reiter', beitrag: 100, ort: ['1067', 'Dresden'] }));
  // fehlendes Geschlecht und keine Anrede
  fall('geschlecht', person({ nachname: 'Eder', beitrag: 100, ohneGeschlecht: true, anrede: '' }));
  // NG-Fälle
  const ng1 = person({ nachname: 'Neumann', vorname: 'Petra', geschlecht: 'w', beitrag: 100, zahlung: 'NG', abt: ['Turnen'] });
  fall('ng', ng1);
  const ng2 = person({ nachname: 'Fischer', vorname: 'Marion', geschlecht: 'w', beitrag: 180, zahlung: 'NG' });
  person({ nachname: 'Fischer', vorname: 'Paul', beitrag: 0, zahler: ng2.MitglNr, bank: false });
  fall('ng', ng2);
  // Dublette
  const dup = person({ nachname: 'Kerscher', vorname: 'Georg', beitrag: 100, geb: [1965, 6, 6] });
  fall('dublette', person({ nachname: 'Kerscher', vorname: 'Georg', beitrag: 100, geb: [1965, 6, 6] }), { erste: dup.MitglNr });
  // Abteilungsnamen: „Fussball“ (tolerant zugeordnet) und unbekannt
  person({ nachname: 'Dietl', beitrag: 100, abt: ['Fussball'] });
  fall('abteilung_unbekannt', person({ nachname: 'Seidl', beitrag: 100, abt: ['Volleyball'] }));
  // nur BLZ/KONTO, keine IBAN
  fall('iban_aus_blz', person({ nachname: 'Kronseder', beitrag: 100, ohneIban: true }));
  // ungültige IBAN
  const ung = person({ nachname: 'Pongratz', beitrag: 100 });
  ung.IBAN = ung.IBAN.slice(0, 4) + (ung.IBAN[4] === '1' ? '2' : '1') + ung.IBAN.slice(5);
  fall('iban_ungueltig', ung);
  // Mischfall: zwei Pauschalen im Cluster
  const mz = person({ nachname: 'Forster', beitrag: 180 });
  person({ nachname: 'Forster', vorname: 'Theresa', geschlecht: 'w', beitrag: 150, zahler: mz.MitglNr, bank: false });
  fall('cluster_mischfall', mz, { grund: 'zwei Pauschalen' });
  // Mischfall: Abhängige ohne Beitrag, aber keine Pauschale
  const oz = person({ nachname: 'Wimmer', beitrag: 100 });
  person({ nachname: 'Wimmer', vorname: 'Sophie', geschlecht: 'w', beitrag: 0, zahler: oz.MitglNr, bank: false, geb: [2010, 1, 1] });
  fall('cluster_mischfall', oz, { grund: 'ohne Beitrag, keine Pauschale' });
  // Beitrag passt zu keiner Beitragsart
  fall('beitrag_unbekannt', person({ nachname: 'Mayr', beitrag: 77 }));
  // Eintritt fehlt
  fall('eintritt_fehlt', person({ nachname: 'Riedl', beitrag: 100, ohneEintritt: true }));
  // unbekannter Zahlungsvermerk
  fall('zahlung_unbekannt', person({ nachname: 'Zellner', beitrag: 100, zahlung: 'OK' }));
  // Wiedereintritt (frühere Mitgliedschaft in AustritteAb2010) und eine Überlappung
  const wd = person({ nachname: 'Bauer', vorname: 'Josef', beitrag: 100, geb: [1951, 1, 9], ein: [1986, 4, 1], abt: ['Stockschützen'] });
  austritte.push({ ID: wd.ID, MitglNr: wd.MitglNr, EinDat: '01.01.1968', AusDat: '31.12.1979', Grund: 'Umzug' });
  fall('wiedereintritt', wd);
  const ub = person({ nachname: 'Aigner', vorname: 'Rosa', geschlecht: 'w', beitrag: 100, ein: [2010, 1, 1] });
  austritte.push({ ID: ub.ID, MitglNr: ub.MitglNr, EinDat: '01.01.2005', AusDat: '31.12.2012', Grund: 'Unzufriedenheit' });
  fall('zeitraum_ueberlappt', ub);

  // --- Rest: realistische Haushalte ---
  while (id < anzahl) {
    const nachname = z.wahl(NACHNAMEN);
    const art = z.r();
    if (art < 0.55) {                       // Einzelperson
      const jung = z.ja(0.25);
      const geb = jung ? [z.int(2009, 2020), z.int(1, 12), z.int(1, 28)] : undefined;
      const aus = z.ja(0.1) ? [z.int(2015, 2025), 12, 31] : undefined;
      person({ nachname, geschlecht: z.ja(0.45) ? 'w' : 'm', beitrag: jung ? 45 : (z.ja(0.04) ? 50 : 100), geb, aus, abt: abt() });
    } else if (art < 0.75) {                // Ehepaar mit Pauschale 150
      const a = person({ nachname, beitrag: 150, abt: abt(), geb: [z.int(1945, 1985), z.int(1, 12), z.int(1, 28)] });
      person({ nachname, geschlecht: 'w', beitrag: 0, zahler: a.MitglNr, bank: false, abt: abt(), geb: [z.int(1945, 1985), z.int(1, 12), z.int(1, 28)] });
    } else {                                // Familie mit Pauschale 180, Kinder
      const a = person({ nachname, beitrag: 180, abt: abt(), geb: [z.int(1970, 1990), z.int(1, 12), z.int(1, 28)] });
      if (z.ja(0.7)) person({ nachname, geschlecht: 'w', beitrag: 0, zahler: a.MitglNr, bank: false, abt: abt(), geb: [z.int(1970, 1990), z.int(1, 12), z.int(1, 28)] });
      const kinder = z.int(1, 3);
      for (let k = 0; k < kinder && id < anzahl; k++) {
        person({ nachname, geschlecht: z.ja(0.5) ? 'w' : 'm', beitrag: 0, zahler: a.MitglNr, bank: false, abt: abt(),
          geb: [z.int(2008, 2020), z.int(1, 12), z.int(1, 28)], ein: [z.int(2015, 2025), z.int(1, 12), 1] });
      }
    }
  }
  return { kopf: KOPF, zeilen, austritte, faelle };
}

/** Text → Windows-1252-Bytes (für Testdateien wie aus Access). */
function alsCp1252(text) {
  const sonder = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97 };
  const b = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = c.charCodeAt(0);
    b[i] = sonder[c] !== undefined ? sonder[c] : (n < 256 ? n : 0x3F);
  }
  return b;
}

function csvText(kopf, zeilen) {
  const zelle = v => { const s = v === null || v === undefined ? '' : String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [kopf.join(';')].concat(zeilen.map(z => kopf.map(k => zelle(z[k])).join(';'))).join('\r\n') + '\r\n';
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const wert = (n, s) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : s; };
  const ziel = wert('--ziel', path.join(__dirname, '..', 'test', 'daten', 'daten16'));
  const e = erzeugeDaten16({ anzahl: Number(wert('--anzahl', 1200)), seed: Number(wert('--seed', 7)) });
  fs.mkdirSync(ziel, { recursive: true });
  const schreibe = (datei, text) => fs.writeFileSync(path.join(ziel, datei), args.includes('--cp1252') ? alsCp1252(text) : text);
  schreibe('daten16.csv', csvText(e.kopf, e.zeilen));
  schreibe('austritte.csv', csvText(['ID', 'MitglNr', 'EinDat', 'AusDat', 'Grund'], e.austritte));
  fs.writeFileSync(path.join(ziel, 'faelle.json'), JSON.stringify(e.faelle, null, 2) + '\n');
  console.log(e.zeilen.length + ' synthetische Zeilen in ' + ziel + ' (ALLES ERFUNDEN). Eingebaute Fälle:');
  e.faelle.forEach(f => console.log('  ' + f.art.padEnd(20) + ' MitglNr ' + f.mitglnr));
}

module.exports = { erzeugeDaten16, alsCp1252, csvText, KOPF };
