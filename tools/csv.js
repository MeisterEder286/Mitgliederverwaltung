/**
 * CSV-Leser/-Schreiber ohne Abhängigkeiten (RFC 4180: Komma, doppelte Anführungszeichen).
 * Nur für die Werkzeuge in tools/ und für Tests, nicht Teil des Apps-Script-Projekts.
 */
'use strict';
const fs = require('fs');

function parse(text) {
  const zeilen = [];
  let zeile = [], feld = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { feld += '"'; i++; }
      else if (c === '"') inQuote = false;
      else feld += c;
    } else if (c === '"') inQuote = true;
    else if (c === ',') { zeile.push(feld); feld = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      zeile.push(feld); zeilen.push(zeile); zeile = []; feld = '';
    } else feld += c;
  }
  if (feld !== '' || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  return zeilen.filter(z => z.length > 1 || z[0] !== '');
}

/** Liest eine CSV-Datei als Liste von Objekten (Schlüssel = Kopfzeile). */
function leseObjekte(pfad) {
  const [kopf, ...rest] = parse(fs.readFileSync(pfad, 'utf8'));
  return rest.map(z => Object.fromEntries(kopf.map((k, i) => [k, z[i] === undefined ? '' : z[i]])));
}

/** Liest eine CSV-Datei als { kopf, zeilen } (Zeilen als Arrays). */
function leseTabelle(pfad) {
  const [kopf, ...zeilen] = parse(fs.readFileSync(pfad, 'utf8'));
  return { kopf, zeilen };
}

function zelle(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function schreibe(pfad, kopf, zeilen) {
  fs.writeFileSync(pfad, [kopf, ...zeilen].map(z => z.map(zelle).join(',')).join('\n') + '\n');
}

module.exports = { parse, leseObjekte, leseTabelle, schreibe };
