/**
 * API Mail – öffentliche Funktionen für den E-Mail-Versand und den Postausgang (google.script.run).
 *
 * Zweck:      Dünne Schicht über src/modul/Mail.js. Jede Funktion läuft über Api.ausfuehren (Rollenprüfung,
 *             generische Fehler, Messung).
 * Datenquelle: siehe Modul.
 * Wer darf was: mail_senden (Senden, erneut senden – zusätzlich prüft das Modul anschreiben_erstellen),
 *             anschreiben_erstellen (Postausgang, Versandstatus) – laut src/lib/rechte.js Vorstand,
 *             Mitgliederverwalter, Kassier. Abteilungs-/Jugendleitung: abgewiesen.
 * Besonderheiten: Auswahl und Zusatzangaben werden wie bei „Schreiben“ gesäubert (korrespondenzAuswahl_,
 *             korrespondenzZusatz_ aus src/api/Korrespondenz.js). Adressen kommen nie vom Browser, sondern immer aus
 *             den gespeicherten Daten.
 */

function apiMailSenden(vorlageId, auswahl, zusatz) {
  return Api.ausfuehren('apiMailSenden', 'mail_senden', function (ktx) {
    return Mail.senden(ktx, Number(vorlageId), korrespondenzAuswahl_(auswahl), korrespondenzZusatz_(zusatz));
  });
}

/** Fehlgeschlagene E-Mails (Anschreiben-IDs) erneut senden. */
function apiMailErneutSenden(ids) {
  return Api.ausfuehren('apiMailErneutSenden', 'mail_senden', function (ktx) {
    return Mail.erneutSenden(ktx, (Array.isArray(ids) ? ids : [ids]).slice(0, 500).map(Number));
  });
}

function apiMailStatus() {
  return Api.ausfuehren('apiMailStatus', 'anschreiben_erstellen', function (ktx) { return Mail.status(ktx); });
}

/** Postausgang: fällige Schreiben (berechnet, es wird nichts gesendet). */
function apiMailVorschlaege() {
  return Api.ausfuehren('apiMailVorschlaege', 'anschreiben_erstellen', function (ktx) { return Mail.vorschlaege(ktx); });
}

/** Nur die Anzahl der fälligen Schreiben (z. B. für eine Kachel auf der Startseite). */
function apiMailVorschlaegeAnzahl() {
  return Api.ausfuehren('apiMailVorschlaegeAnzahl', 'anschreiben_erstellen', function (ktx) { return Mail.vorschlaegeAnzahl(ktx); });
}
