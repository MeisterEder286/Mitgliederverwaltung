/**
 * Messbeginn – Zeitstempel beim Auswerten der Skriptdateien.
 *
 * Zweck:      Hält fest, wann Apps Script begonnen hat, die Skriptdateien dieser Ausführung auszuwerten. Messung
 *             berechnet daraus laden_ms (Zeit bis zum Start der aufgerufenen Funktion: Laden + Auswerten aller
 *             Dateien). Der Name beginnt mit „0_“, damit die Datei möglichst als erste geladen wird.
 * Datenquelle: keine.
 * Wer darf was: –
 * Besonderheiten: [?] Die Ladereihenfolge der Dateien ist in Apps Script nicht zugesichert. Wird diese Datei nicht
 *             zuerst ausgewertet, ist laden_ms zu klein (nie zu groß). Kein Dienstaufruf auf oberster Ebene.
 */
var MESS_T0 = Date.now();
