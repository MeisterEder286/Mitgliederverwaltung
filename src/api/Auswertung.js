/**
 * API Auswertungen – öffentliche Funktionen für die Ansicht „Auswertungen“.
 *
 * Zweck:      Alle Auswertungen in einem Aufruf (apiAuswertungen), vereinsweite Entwicklung über einen
 *             frei gewählten Zeitraum (apiAuswertungEntwicklung), Export-Vermerk ins Protokoll.
 * Datenquelle: AuswertungModul (src/modul/Auswertung.js) auf Bereichsdaten (Sichtkreis des Aufrufers).
 * Wer darf was: Aktion export (Vorstand, Mitgliederverwaltung, Kasse, Abteilungs- und Jugendleitung); vereinsweite
 *             Teile nur mit Zeilensicht „alle“ (im Modul geprüft).
 * Besonderheiten: Jede Funktion läuft über Api.ausfuehren (Rollenprüfung, generische Fehler, Messung).
 */

/** Alle Auswertungen: optionen { stichtag, grenzen, nach, altersmodus, jahre }. */
function apiAuswertungen(optionen) {
  return Api.ausfuehren('apiAuswertungen', 'export', function (ktx) {
    return AuswertungModul.alle(ktx, optionen && typeof optionen === 'object' ? optionen : {});
  });
}

/** Mitgliederentwicklung und Austrittsgründe von vonJahr bis bisJahr (nur Sicht auf den ganzen Verein). */
function apiAuswertungEntwicklung(vonJahr, bisJahr) {
  return Api.ausfuehren('apiAuswertungEntwicklung', 'export', function (ktx) { return AuswertungModul.entwicklung(ktx, vonJahr, bisJahr); });
}

/** Im Browser erzeugten Export (CSV/Druck) protokollieren. */
function apiAuswertungExportVermerken(liste, anzahl) {
  return Api.ausfuehren('apiAuswertungExportVermerken', 'export', function (ktx) { return AuswertungModul.exportVermerken(ktx, liste, anzahl); });
}
