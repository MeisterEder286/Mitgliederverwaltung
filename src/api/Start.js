/**
 * API Start – Snapshot nachladen und Cache warmhalten.
 *
 * Zweck:      apiSnapshot liefert den rollenbeschnittenen Datenbestand erneut (z. B. nach einem Versionskonflikt
 *             oder „Neu laden“ im Browser). apiStart (Startdaten inkl. Snapshot) steht in src/Einstieg.js.
 * Datenquelle: Snapshot (Cache, sonst Tabelle).
 * Wer darf was: jeder aktive Benutzer (Aktion 'start'); was er sieht, schneidet Snapshot.fuer nach Rolle.
 * Besonderheiten: snapshotWarmhalten ist eine Trigger-Funktion (nur Funktionskonto) und tut nur etwas,
 *             wenn _Konfig.cache_warmhalten = ja. Eingerichtet wird der Trigger über triggerEinrichten().
 */

/** Rollenbeschnittener Snapshot neu vom Server. */
function apiSnapshot(bereiche) {
  return Api.ausfuehren('apiSnapshot', 'start', function (ktx) {
    return Snapshot.fuerClient(ktx, Array.isArray(bereiche) ? bereiche.map(String) : ['kern']);
  });
}

/** Zeit-Trigger (stündlich): Konfig auffrischen, Snapshot-Basis neu bauen, wenn sie fehlt oder altert. */
function snapshotWarmhalten() {
  try {
    Zugriff.nurFunktionskonto();
    Snapshot.warmhalten();
  } catch (err) {
    console.error('snapshotWarmhalten fehlgeschlagen', err);
  }
}
