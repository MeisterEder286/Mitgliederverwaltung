/**
 * API Dashboard – öffentliche Funktion für die Ansicht „Dashboard“.
 *
 * Zweck:      Dünne Schicht: Rolle prüfen (Api.ausfuehren) und an DashboardModul (src/modul/Dashboard.js) übergeben.
 * Datenquelle: siehe DashboardModul (Snapshot-Basis, nur lesend).
 * Wer darf was: Aktion dashboard_lesen (Vorstand, Mitgliederverwalter, Kassier). Abschnitte Einnahmen und Ehrungen
 *             erscheinen nur mit Finanzsicht bzw. Recht ehrung_bearbeiten (im Modul entschieden).
 * Besonderheiten: Läuft über Api.ausfuehren (Rollenprüfung, generische Fehler, Messung).
 */

/** Alle Dashboard-Zahlen für ein Kalenderjahr (ohne Angabe: laufendes Jahr). */
function apiDashboard(jahr) {
  return Api.ausfuehren('apiDashboard', 'dashboard_lesen', function (ktx) { return DashboardModul.alle(ktx, { jahr: jahr }); });
}
