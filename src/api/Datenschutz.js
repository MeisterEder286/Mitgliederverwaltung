/**
 * API Datenschutz – öffentliche Funktionen für den Browser (google.script.run) und den Bereinigungs-Trigger.
 *
 * Zweck:      Einwilligungen, Betroffenenanfragen, Auskunft nach Art. 15, Löschliste (sperren, anonymisieren,
 *             löschen, Konto leeren) und das Änderungsprotokoll.
 * Datenquelle: src/modul/Datenschutz.js.
 * Wer darf was: jede Funktion prüft ihr Recht über Api.ausfuehren – datenschutz_bearbeiten (Vorstand,
 *             Mitgliederverwalter), Protokoll lesen mit protokoll_lesen (zusätzlich Kassier, gefiltert).
 *             protokollBereinigenTrigger läuft nur als Funktionskonto (Zeit-Trigger).
 * Besonderheiten: Antworten von Schreibfunktionen haben die Form { aktualisiert, entfernt } (App.daten.uebernehme).
 */

function apiDatenschutzUebersicht() {
  return Api.ausfuehren('apiDatenschutzUebersicht', 'datenschutz_bearbeiten', function (ktx) { return Datenschutz.uebersicht(ktx); });
}

function apiDatenschutzEinwilligungSpeichern(id, version, werte) {
  return Api.ausfuehren('apiDatenschutzEinwilligungSpeichern', 'datenschutz_bearbeiten', function (ktx) {
    return Datenschutz.einwilligungSpeichern(ktx, id || null, version, werte);
  });
}

function apiDatenschutzEinwilligungWiderrufen(id, version, datum) {
  return Api.ausfuehren('apiDatenschutzEinwilligungWiderrufen', 'datenschutz_bearbeiten', function (ktx) {
    return Datenschutz.einwilligungWiderrufen(ktx, id, version, datum || null);
  });
}

function apiDatenschutzAnfragen() {
  return Api.ausfuehren('apiDatenschutzAnfragen', 'datenschutz_bearbeiten', function (ktx) { return Datenschutz.anfragen(ktx); });
}

function apiDatenschutzAnfrageSpeichern(id, version, werte) {
  return Api.ausfuehren('apiDatenschutzAnfrageSpeichern', 'datenschutz_bearbeiten', function (ktx) {
    return Datenschutz.anfrageSpeichern(ktx, id || null, version, werte);
  });
}

function apiDatenschutzAuskunft(mitgliedId) {
  return Api.ausfuehren('apiDatenschutzAuskunft', 'datenschutz_bearbeiten', function (ktx) { return Datenschutz.auskunft(ktx, mitgliedId); });
}

function apiDatenschutzLoeschliste() {
  return Api.ausfuehren('apiDatenschutzLoeschliste', 'datenschutz_bearbeiten', function (ktx) { return Datenschutz.loeschliste(ktx); });
}

function apiDatenschutzSperren(mitgliedId, version, sperre) {
  return Api.ausfuehren('apiDatenschutzSperren', 'datenschutz_bearbeiten', function (ktx) {
    return Datenschutz.sperren(ktx, mitgliedId, version, sperre !== false);
  });
}

function apiDatenschutzAnonymisierungsplan(mitgliedId) {
  return Api.ausfuehren('apiDatenschutzAnonymisierungsplan', 'datenschutz_bearbeiten', function (ktx) {
    return Datenschutz.anonymisierungsplan(ktx, mitgliedId);
  });
}

function apiDatenschutzAnonymisieren(mitgliedId, bestaetigung) {
  return Api.ausfuehren('apiDatenschutzAnonymisieren', 'datenschutz_bearbeiten', function (ktx) {
    return Datenschutz.anonymisieren(ktx, mitgliedId, bestaetigung);
  });
}

function apiDatenschutzLoeschen(mitgliedId, bestaetigung) {
  return Api.ausfuehren('apiDatenschutzLoeschen', 'datenschutz_bearbeiten', function (ktx) {
    return Datenschutz.loeschen(ktx, mitgliedId, bestaetigung);
  });
}

function apiDatenschutzKontoLeeren(kontoId, version) {
  return Api.ausfuehren('apiDatenschutzKontoLeeren', 'datenschutz_bearbeiten', function (ktx) {
    return Datenschutz.kontoLeeren(ktx, kontoId, version);
  });
}

function apiDatenschutzProtokoll(filter, seite) {
  return Api.ausfuehren('apiDatenschutzProtokoll', 'protokoll_lesen', function (ktx) {
    return Datenschutz.protokoll(ktx, filter || {}, seite || 0);
  });
}

function apiDatenschutzProtokollBereinigen() {
  return Api.ausfuehren('apiDatenschutzProtokollBereinigen', 'datenschutz_bearbeiten', function (ktx) {
    return Datenschutz.protokollBereinigen(ktx);
  });
}

/** Zeit-Trigger (z. B. monatlich): Protokollwerte nach Frist leeren. Nur als Funktionskonto. */
function protokollBereinigenTrigger() {
  try {
    var ktx = Zugriff.nurFunktionskonto();
    Datenschutz.protokollBereinigen(ktx);
  } catch (e) {
    console.error('protokollBereinigenTrigger fehlgeschlagen: ' + (e && e.message));
  }
}
