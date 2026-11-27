/**
 * Test-Hilfe für Beitrag/Sollstellung/SEPA: lädt die Beispieldaten (test/daten/beispiel + Startbelegung) über die
 * echten Module (DB.lese → Werte) und liefert { g, d } – g = Projekt-Kontext, d = Tab-Listen wie aus DB.lese.
 * gueltigeIbans: true rechnet die erfundenen Beispiel-IBANs (falsche Prüfziffern) in gültige um.
 */
'use strict';
const { ladeProjekt } = require('./projekt');
const { erzeugeFakes, beispielTabs } = require('./gas-fakes');

const TABS = ['Mitglied', 'Mitgliedschaftszeitraum', 'Beitragsart', 'Beitragsgemeinschaft', 'Beitragskonto', 'Sollstellung', '_Konfig'];

function beitragsdaten(optionen) {
  optionen = optionen || {};
  const f = erzeugeFakes({ tabs: beispielTabs(TABS) });
  const g = ladeProjekt(f.globale);
  const d = g.DB.lese(TABS);
  if (optionen.gueltigeIbans) {
    d.Beitragskonto.forEach(k => { if (k.iban) k.iban = g.Iban.ausBlzKonto(k.iban.slice(4, 12), k.iban.slice(12)); });
  }
  return { g, d };
}

module.exports = { beitragsdaten, TABS };
