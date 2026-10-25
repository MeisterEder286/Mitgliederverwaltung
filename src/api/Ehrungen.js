/**
 * API Ehrungen – öffentliche Server-Funktionen der Ansicht „Ehrungen“ (google.script.run).
 *
 * Zweck:      Dünne Schicht: Rolle prüfen (Api.ausfuehren) und an EhrungenModul (src/modul/Ehrungen.js) übergeben.
 * Datenquelle: siehe EhrungenModul.
 * Wer darf was: alles hier nur mit Aktion ehrung_bearbeiten (Vorstand, Mitgliederverwalter).
 * Besonderheiten: Antworten von Schreibaufrufen haben die Form { aktualisiert, entfernt } (App.daten.uebernehme).
 */

/** Jahresliste (neu fällige + offene Vorjahre) für `jahr`. */
function apiEhrungenListe(jahr) {
  return Api.ausfuehren('apiEhrungenListe', 'ehrung_bearbeiten', function (ktx) { return EhrungenModul.jahresliste(ktx, jahr); });
}

/** Alle neu fälligen Ehrungen des Jahres als „fällig“ anlegen. */
function apiEhrungenUebernehmen(jahr) {
  return Api.ausfuehren('apiEhrungenUebernehmen', 'ehrung_bearbeiten', function (ktx) { return EhrungenModul.uebernehmen(ktx, jahr); });
}

/** Statuswechsel (verleihen | verschieben | ablehnen | oeffnen) für einen oder mehrere Einträge. */
function apiEhrungenStatus(eintraege, aktion, eingabe) {
  return Api.ausfuehren('apiEhrungenStatus', 'ehrung_bearbeiten', function (ktx) {
    return EhrungenModul.status(ktx, eintraege, String(aktion || ''), eingabe || {});
  });
}

/** Export-Daten (art: 'liste' | 'urkunden'); wird protokolliert. */
function apiEhrungenExport(jahr, art) {
  return Api.ausfuehren('apiEhrungenExport', 'ehrung_bearbeiten', function (ktx) {
    return EhrungenModul.exportiere(ktx, jahr, art === 'urkunden' ? 'urkunden' : 'liste');
  });
}
