/**
 * Test-Hilfe für Fachlogik-Tests: lädt die Beispiel- und Startbelegungs-Tabs als Objekte – genau so,
 * wie DB.lese sie liefern würde (Datum 'JJJJ-MM-TT', ja/nein als true/false, Zahlen als number).
 *
 *   const { ladeFachdaten } = require('./hilfe/fachdaten');
 *   const { g, daten, konfig } = ladeFachdaten();   // g = Projekt-Kontext (ladeProjekt)
 */
'use strict';
const { ladeProjekt } = require('./projekt');
const { beispielTabs } = require('./gas-fakes');

const ALLE = ['Mitglied', 'Mitgliedschaftszeitraum', 'Abteilung', 'Abteilungszugehoerigkeit', 'Funktionsart', 'Funktion',
  'Beitragsart', 'Beitragsgemeinschaft', 'Beitragskonto', 'Sollstellung', 'Qualifikationsart', 'Qualifikation',
  'Ehrungsregel', 'Ehrung', 'Einwilligung', 'Aufbewahrungsfrist', 'Betroffenenanfrage', '_Protokoll', '_Konfig', 'Benutzer'];

function ladeFachdaten(globale) {
  const g = ladeProjekt(globale || {});
  const roh = beispielTabs(ALLE);
  const daten = {};
  ALLE.forEach(tab => {
    const [kopf, ...zeilen] = roh[tab];
    daten[tab] = zeilen.map(z => g.Werte.zeileZuObjekt(kopf, z, tab));
  });
  const konfig = {};
  daten._Konfig.forEach(z => { konfig[z.schluessel] = z.wert; });
  return { g, daten, konfig };
}

/** Tiefe Kopie (auch zum Vergleichen von Objekten aus dem vm-Kontext). */
function kopie(x) { return JSON.parse(JSON.stringify(x)); }

module.exports = { ladeFachdaten, kopie };
