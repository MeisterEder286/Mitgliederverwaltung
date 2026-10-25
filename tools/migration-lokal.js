#!/usr/bin/env node
/**
 * Migration LOKAL ausführen: Access-Export von Daten16 (CSV) → je Tab eine Datei zum Einfügen ins Google Sheet
 * + Prüfbericht. Die Echtdaten verlassen den Rechner nicht; es wird nichts hochgeladen.
 *
 *   node tools/migration-lokal.js <daten16.csv> [--austritte <AustritteAb2010.csv>] [--ziel migration/ausgabe]
 *                                 [--beitragsjahr 2026] [--stichtag 2026-10-25] [--pauschalen 180,150]
 *                                 [--muster TSV-{jahr}-{mitglnr}]
 *
 * Eingabe: CSV mit Kopfzeile, Trennzeichen Semikolon oder Komma (wird erkannt), Zeichensatz UTF-8 oder
 *          Windows-1252 (Access-Standard, wird erkannt). Spaltennamen tolerant (src/lib/migration.js, SPALTEN).
 * Ausgabe (Zielordner, Standard migration/ausgabe/ – steht in .gitignore):
 *   <Tab>.tsv   zum Einfügen ab Zelle A2 (Tabulator-getrennt, Datum TT.MM.JJJJ, ja/nein als Text) – empfohlen
 *   <Tab>.csv   dieselben Daten als CSV (Semikolon) zum Ansehen in Excel
 *   pruefbericht.html / pruefbericht.csv   alles, was von Hand geklärt werden muss
 *   konfig_werte.txt   Werte für _Konfig (next_id_*, mitgliedsnummer_naechste)
 * Ablauf und Einfügen ins Sheet: docs/MIGRATION.md.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ladeProjekt } = require('../test/hilfe/projekt');

const TABS = ['Mitglied', 'Mitgliedschaftszeitraum', 'Abteilungszugehoerigkeit', 'Beitragskonto', 'Beitragsgemeinschaft', 'Sollstellung'];

/** Datei lesen: BOM entfernen, UTF-8 oder Windows-1252 erkennen. */
function leseText(datei) {
  let b = fs.readFileSync(datei);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) b = b.slice(3);
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), zeichensatz: 'UTF-8' }; }
  catch (e) { return { text: new TextDecoder('windows-1252').decode(b), zeichensatz: 'Windows-1252' }; }
}

/** CSV mit erkanntem Trennzeichen (; oder ,) → Objekte. Anführungszeichen nach RFC 4180. */
function parseCsv(text) {
  const ersteZeile = text.split(/\r?\n/)[0] || '';
  const trenn = (ersteZeile.match(/;/g) || []).length >= (ersteZeile.match(/,/g) || []).length ? ';' : ',';
  const zeilen = []; let zeile = [], feld = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { feld += '"'; i++; } else if (c === '"') inQ = false; else feld += c;
    } else if (c === '"') inQ = true;
    else if (c === trenn) { zeile.push(feld); feld = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; zeile.push(feld); zeilen.push(zeile); zeile = []; feld = ''; }
    else feld += c;
  }
  if (feld !== '' || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  const nichtLeer = zeilen.filter(z => z.some(x => String(x).trim() !== ''));
  const [kopf, ...rest] = nichtLeer;
  return { trenn, kopf: kopf || [], objekte: rest.map(z => Object.fromEntries((kopf || []).map((k, i) => [k.trim(), z[i] === undefined ? '' : z[i]]))) };
}

/** Wert eines Ergebnis-Objekts → Zellinhalt für das deutsche Sheet. */
function zelle(wert, spalte) {
  if (wert === null || wert === undefined) return '';
  if (spalte.typ === 'ja/nein') return wert === true ? 'ja' : wert === false ? 'nein' : String(wert);
  if (spalte.typ === 'Datum' || spalte.typ === 'Zeitpunkt') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}:\d{2}))?/.exec(String(wert));
    return m ? m[3] + '.' + m[2] + '.' + m[1] + (spalte.typ === 'Zeitpunkt' && m[4] ? ' ' + m[4] : '') : String(wert);
  }
  if (spalte.typ === 'Dezimal' && typeof wert === 'number') return wert.toFixed(2).replace('.', ',');
  return String(wert).replace(/[\t\r\n]+/g, ' ');
}

function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function berichtHtml(e, info) {
  const b = e.bericht;
  const zeilen = b.pruefliste.map(p => `<tr data-schwere="${esc(p.schwere)}" data-art="${esc(p.art)}"><td class="${esc(p.schwere)}">${esc(p.schwere)}</td><td>${esc(p.art)}</td><td>${esc(p.mitglnr)}</td><td>${esc(p.name)}</td><td>${esc(p.meldung)}</td><td>${esc(p.vorschlag)}</td></tr>`).join('\n');
  const arten = [...new Set(b.pruefliste.map(p => p.art))].sort();
  const cluster = b.cluster.map(c => `<tr><td>${c.konto}</td><td>${esc(c.zahler)}</td><td>${esc(c.inhaber)}</td><td>${esc(c.zahlweg)}</td><td>${c.personen.map(p =>
    esc(p.mitglnr + ' ' + p.name + ' (' + (p.status || '–') + ', ' + (p.beitrag === null ? 'ohne Beitrag' : String(p.beitrag).replace('.', ',') + ' €') + (p.gemeinschaft ? ', Gemeinschaft ' + p.gemeinschaft : '') + ')')).join('<br>')}</td></tr>`).join('\n');
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prüfbericht Migration Daten16</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;color:#1b1f24}h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:24px}
.warnbox{background:#fdecec;color:#8a1111;padding:12px;border-radius:6px;font-weight:600}
table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{border-bottom:1px solid #c9d1da;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f3f5f8}td.fehler{color:#8a1111;font-weight:600}td.warnung{color:#7a5600;font-weight:600}td.hinweis{color:#4a5560}
.filter{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.filter select,.filter input{padding:6px;font:inherit}
.kennzahlen{display:flex;flex-wrap:wrap;gap:8px}.kennzahlen div{border:1px solid #c9d1da;border-radius:6px;padding:8px 12px}
li{margin:4px 0}
</style></head><body>
<h1>Prüfbericht Migration Daten16</h1>
<p class="warnbox">Enthält Echtdaten – nicht weitergeben, nicht hochladen, nach Abschluss der Migration löschen.</p>
<p>Erzeugt ${esc(info.erzeugt)} aus ${esc(info.datei)} (${esc(info.zeichensatz)}, Trennzeichen „${esc(info.trenn)}“), Beitragsjahr ${esc(info.beitragsjahr)}.</p>
<div class="kennzahlen">${Object.entries(b.zaehler).filter(([, v]) => typeof v === 'number').map(([k, v]) => `<div><strong>${v}</strong> ${esc(k)}</div>`).join('')}
<div><strong>${b.zaehler.pruefliste.fehler}</strong> Fehler</div><div><strong>${b.zaehler.pruefliste.warnung}</strong> Warnungen</div><div><strong>${b.zaehler.pruefliste.hinweis}</strong> Hinweise</div></div>
<h2>Annahmen – vor dem Echtlauf bestätigen</h2><ul>${b.annahmen.map(a => '<li>' + esc(a) + '</li>').join('')}</ul>
<h2>Werte für _Konfig</h2><ul>${Object.entries(b.naechsteIds).map(([k, v]) => '<li><code>' + esc(k) + '</code> = ' + esc(v) + '</li>').join('')}</ul>
<h2>Prüfliste (${b.pruefliste.length})</h2>
<div class="filter"><select id="schwere" aria-label="Schwere"><option value="">Schwere: alle</option><option>fehler</option><option>warnung</option><option>hinweis</option></select>
<select id="art" aria-label="Art"><option value="">Art: alle</option>${arten.map(a => '<option>' + esc(a) + '</option>').join('')}</select>
<input id="suche" type="search" placeholder="Suchen …" aria-label="Suchen"></div>
<table><thead><tr><th>Schwere</th><th>Art</th><th>MitglNr</th><th>Name</th><th>Meldung</th><th>Vorschlag</th></tr></thead><tbody id="liste">
${zeilen}
</tbody></table>
<h2>Konto-Cluster mit mehreren Personen (${b.cluster.length})</h2>
<table><thead><tr><th>Konto</th><th>Zahler</th><th>Inhaber</th><th>Zahlweg</th><th>Personen</th></tr></thead><tbody>
${cluster}
</tbody></table>
<script>
(function(){var s=document.getElementById('schwere'),a=document.getElementById('art'),q=document.getElementById('suche');
function f(){var t=q.value.toLowerCase();Array.prototype.forEach.call(document.querySelectorAll('#liste tr'),function(r){
r.hidden=!!((s.value&&r.dataset.schwere!==s.value)||(a.value&&r.dataset.art!==a.value)||(t&&r.textContent.toLowerCase().indexOf(t)<0));});}
s.onchange=a.onchange=f;q.oninput=f;})();
</script></body></html>
`;
}

/**
 * Migration ausführen. Liefert { ergebnis, dateien }.
 * opt: { datei, austritte, ziel, beitragsjahr, stichtag, pauschalen: [Zahl], muster }
 */
function fuehreAus(opt) {
  const g = ladeProjekt({});
  const ein = leseText(opt.datei);
  const csv = parseCsv(ein.text);
  const austritte = opt.austritte ? parseCsv(leseText(opt.austritte).text).objekte : null;
  const objekte = tab => {
    const sb = g.Startbelegung[tab];
    return sb ? sb.zeilen.map(z => g.Werte.zeileZuObjekt(sb.kopf, z, tab)) : [];
  };
  const konfig = {};
  objekte('_Konfig').forEach(k => { konfig[k.schluessel] = k.wert; });
  const stichtag = opt.stichtag || new Date().toISOString().slice(0, 10);
  const ergebnis = g.Migration.migriere(csv.objekte, {
    beitragsjahr: Number(opt.beitragsjahr || konfig.beitragsjahr || stichtag.slice(0, 4)),
    stichtag, abteilungen: objekte('Abteilung'), beitragsarten: objekte('Beitragsart'),
    pauschalbetraege: opt.pauschalen || [], mandatsreferenzMuster: opt.muster, austritte, konfig
  });
  const ziel = opt.ziel;
  fs.mkdirSync(ziel, { recursive: true });
  const dateien = [];
  TABS.forEach(tab => {
    const spalten = g.Schema.TABELLEN[tab].spalten;
    const zeilen = ergebnis.tabs[tab].map(o => spalten.map(sp => zelle(o[sp.name], sp)));
    const tsv = [spalten.map(s => s.name).join('\t')].concat(zeilen.map(z => z.join('\t'))).join('\r\n') + '\r\n';
    const csvZelle = v => /[";\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    const csvText = '﻿' + [spalten.map(s => s.name).join(';')].concat(zeilen.map(z => z.map(csvZelle).join(';'))).join('\r\n') + '\r\n';
    fs.writeFileSync(path.join(ziel, tab + '.tsv'), tsv);
    fs.writeFileSync(path.join(ziel, tab + '.csv'), csvText);
    dateien.push(tab + '.tsv', tab + '.csv');
  });
  const info = { erzeugt: new Date().toLocaleString('de-DE'), datei: path.basename(opt.datei), zeichensatz: ein.zeichensatz, trenn: csv.trenn, beitragsjahr: ergebnis.tabs.Sollstellung[0] ? ergebnis.tabs.Sollstellung[0].jahr : opt.beitragsjahr || konfig.beitragsjahr };
  fs.writeFileSync(path.join(ziel, 'pruefbericht.html'), berichtHtml(ergebnis, info));
  const pz = v => { const s = v === null || v === undefined ? '' : String(v); return /[";\r\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
  fs.writeFileSync(path.join(ziel, 'pruefbericht.csv'), '﻿' + ['schwere;art;mitglnr;id;name;meldung;vorschlag'].concat(
    ergebnis.bericht.pruefliste.map(p => [p.schwere, p.art, p.mitglnr, p.id, p.name, p.meldung, p.vorschlag].map(pz).join(';'))).join('\r\n') + '\r\n');
  fs.writeFileSync(path.join(ziel, 'konfig_werte.txt'), Object.entries(ergebnis.bericht.naechsteIds).map(([k, v]) => k + '\t' + v).join('\r\n') + '\r\n');
  dateien.push('pruefbericht.html', 'pruefbericht.csv', 'konfig_werte.txt');
  return { ergebnis, dateien, info, csv };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const wert = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const datei = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!datei) { console.error('Aufruf: node tools/migration-lokal.js <daten16.csv> [--austritte <csv>] [--ziel <ordner>] [--beitragsjahr 2026] [--pauschalen 180,150]'); process.exit(1); }
  const ziel = wert('--ziel') || path.join(__dirname, '..', 'migration', 'ausgabe');
  const r = fuehreAus({ datei, austritte: wert('--austritte'), ziel, beitragsjahr: wert('--beitragsjahr'), stichtag: wert('--stichtag'),
    pauschalen: wert('--pauschalen') ? wert('--pauschalen').split(',').map(x => Number(x.replace(',', '.'))) : [], muster: wert('--muster') });
  const z = r.ergebnis.bericht.zaehler;
  console.log('Gelesen: ' + z.zeilen + ' Zeilen (' + r.info.zeichensatz + ', Trennzeichen „' + r.csv.trenn + '“).');
  console.log('Ergebnis: ' + z.mitglieder + ' Mitglieder (' + z.aktiv + ' aktiv), ' + z.konten + ' Konten, ' + z.gemeinschaften + ' Gemeinschaften, ' + z.sollstellungen_ng + ' NG-Sollstellungen.');
  console.log('Prüfliste: ' + z.pruefliste.fehler + ' Fehler, ' + z.pruefliste.warnung + ' Warnungen, ' + z.pruefliste.hinweis + ' Hinweise → ' + path.join(ziel, 'pruefbericht.html'));
  console.log('Werte für _Konfig:'); Object.entries(r.ergebnis.bericht.naechsteIds).forEach(([k, v]) => console.log('  ' + k + ' = ' + v));
  console.log('ACHTUNG: Der Zielordner enthält Echtdaten – nicht weitergeben, nach Abschluss löschen.');
}

module.exports = { fuehreAus, parseCsv, leseText, zelle };
