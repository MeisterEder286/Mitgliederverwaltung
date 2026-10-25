/**
 * API Finanzen – öffentliche Server-Funktionen für den Bereich „Finanzen“ (Beitragskonten, Gemeinschaften,
 * Sollstellungen, SEPA). Die eigentliche Arbeit steckt in src/modul/Finanzen.js.
 *
 * Zweck:      Einzige Einstiegspunkte für google.script.run aus client/ansicht_finanzen.
 * Datenquelle: über Finanzen (Snapshot-Basis, gezielte DB-Lesungen für Klartext-IBAN).
 * Wer darf was: jede Funktion prüft über Api.ausfuehren die Aktion (src/lib/rechte.js):
 *   konto_lesen · iban_aufdecken · konto_bearbeiten · sollstellung_bearbeiten · sepa_lauf · mitglied_bearbeiten · export
 * Besonderheiten: Argumente kommen aus dem Browser und sind nicht vertrauenswürdig – IDs werden als Zahl
 *             gelesen, alles Weitere prüft das Modul. Keine Datei-/Tab-IDs vom Client (A3).
 */

function finanzenZahl_(v) { var n = Number(v); return isFinite(n) ? n : null; }

/** Kennzahlen und Kurzinfo je Konto für ein Beitragsjahr. */
function apiFinanzenUebersicht(jahr) {
  return Api.ausfuehren('apiFinanzenUebersicht', 'konto_lesen', function (ktx) { return Finanzen.uebersicht(ktx, finanzenZahl_(jahr)); });
}

/** Details eines Kontos (Zusammensetzung, Mandat, Prüfungen). */
function apiFinanzenKonto(kontoId, jahr) {
  return Api.ausfuehren('apiFinanzenKonto', 'konto_lesen', function (ktx) { return Finanzen.konto(ktx, finanzenZahl_(kontoId), finanzenZahl_(jahr)); });
}

/** IBAN eines Kontos im Klartext (protokolliert). */
function apiFinanzenIbanAufdecken(kontoId) {
  return Api.ausfuehren('apiFinanzenIbanAufdecken', 'iban_aufdecken', function (ktx) { return Finanzen.ibanAufdecken(ktx, finanzenZahl_(kontoId)); });
}

/** Konto anlegen (kontoId leer) oder ändern. */
function apiFinanzenKontoSpeichern(kontoId, version, werte) {
  return Api.ausfuehren('apiFinanzenKontoSpeichern', 'konto_bearbeiten', function (ktx) {
    return Finanzen.kontoSpeichern(ktx, kontoId === null || kontoId === undefined || kontoId === '' ? null : finanzenZahl_(kontoId), finanzenZahl_(version), werte || {});
  });
}

/** Konto stilllegen (nur ohne aktive Personen). */
function apiFinanzenKontoStilllegen(kontoId, version) {
  return Api.ausfuehren('apiFinanzenKontoStilllegen', 'konto_bearbeiten', function (ktx) { return Finanzen.kontoStilllegen(ktx, finanzenZahl_(kontoId), finanzenZahl_(version)); });
}

/** Person (ggf. mit ganzer Gemeinschaft) einem Konto zuordnen. */
function apiFinanzenPersonZuordnen(mitgliedId, version, kontoId, mitGemeinschaft) {
  return Api.ausfuehren('apiFinanzenPersonZuordnen', 'konto_bearbeiten', function (ktx) {
    return Finanzen.personZuordnen(ktx, finanzenZahl_(mitgliedId), finanzenZahl_(version), finanzenZahl_(kontoId), mitGemeinschaft === true);
  });
}

/** Gemeinschaft anlegen (id leer) oder ändern. */
function apiFinanzenGemeinschaftSpeichern(id, version, werte) {
  return Api.ausfuehren('apiFinanzenGemeinschaftSpeichern', 'konto_bearbeiten', function (ktx) {
    return Finanzen.gemeinschaftSpeichern(ktx, id === null || id === undefined || id === '' ? null : finanzenZahl_(id), finanzenZahl_(version), werte || {});
  });
}

/** Person in Gemeinschaft aufnehmen ('hinzu') oder herausnehmen ('entfernen'). */
function apiFinanzenGemeinschaftMitglied(gemeinschaftId, mitgliedId, version, aktion) {
  return Api.ausfuehren('apiFinanzenGemeinschaftMitglied', 'konto_bearbeiten', function (ktx) {
    return Finanzen.gemeinschaftMitglied(ktx, finanzenZahl_(gemeinschaftId), finanzenZahl_(mitgliedId), finanzenZahl_(version), String(aktion || ''));
  });
}

/** Gemeinschaft auflösen. */
function apiFinanzenGemeinschaftAufloesen(id, version) {
  return Api.ausfuehren('apiFinanzenGemeinschaftAufloesen', 'konto_bearbeiten', function (ktx) { return Finanzen.gemeinschaftAufloesen(ktx, finanzenZahl_(id), finanzenZahl_(version)); });
}

/** Probelauf Sollstellungen eines Jahres (schreibt nichts). */
function apiFinanzenSollstellungPlanen(jahr) {
  return Api.ausfuehren('apiFinanzenSollstellungPlanen', 'sollstellung_bearbeiten', function (ktx) { return Finanzen.sollstellungPlanen(ktx, finanzenZahl_(jahr)); });
}

/** Sollstellungen eines Jahres anlegen (erwarteteAnzahl aus dem Probelauf als Schutz gegen veraltete Vorschau). */
function apiFinanzenSollstellungAnlegen(jahr, erwarteteAnzahl) {
  return Api.ausfuehren('apiFinanzenSollstellungAnlegen', 'sollstellung_bearbeiten', function (ktx) {
    return Finanzen.sollstellungAnlegen(ktx, finanzenZahl_(jahr), erwarteteAnzahl === undefined ? null : finanzenZahl_(erwarteteAnzahl));
  });
}

/** Zahlungsstatus einer Sollstellung buchen: ereignis = { art, datum, grund, betrag, gebuehr }. */
function apiFinanzenSollstellungStatus(id, version, ereignis) {
  return Api.ausfuehren('apiFinanzenSollstellungStatus', 'sollstellung_bearbeiten', function (ktx) {
    return Finanzen.sollstellungStatus(ktx, finanzenZahl_(id), finanzenZahl_(version), ereignis || {});
  });
}

/** Sammelbuchung „bezahlt“ nach dem Einzug. ids leer = alle offenen eingezogenen des Jahres. */
function apiFinanzenSammelBezahlt(jahr, ids, datum) {
  return Api.ausfuehren('apiFinanzenSammelBezahlt', 'sollstellung_bearbeiten', function (ktx) {
    return Finanzen.sammelBezahlt(ktx, finanzenZahl_(jahr), Array.isArray(ids) ? ids.map(finanzenZahl_) : null, datum || null);
  });
}

/** SEPA-Probelauf (ohne Klartext-IBAN). */
function apiFinanzenSepaProbelauf(jahr, einzugsdatum) {
  return Api.ausfuehren('apiFinanzenSepaProbelauf', 'sepa_lauf', function (ktx) { return Finanzen.sepaProbelauf(ktx, finanzenZahl_(jahr), einzugsdatum || null); });
}

/** Vier-Augen-Freigabe des Probelaufs. */
function apiFinanzenSepaFreigeben(jahr) {
  return Api.ausfuehren('apiFinanzenSepaFreigeben', 'sepa_lauf', function (ktx) { return Finanzen.sepaFreigeben(ktx, finanzenZahl_(jahr)); });
}

/** SEPA-Datei pain.008.001.08 erzeugen (vermerkt Sequenz/Einzugsdatum in den Sollstellungen). */
function apiFinanzenSepaXml(jahr, einzugsdatum) {
  return Api.ausfuehren('apiFinanzenSepaXml', 'sepa_lauf', function (ktx) { return Finanzen.sepaXml(ktx, finanzenZahl_(jahr), einzugsdatum || null); });
}

/** Klärliste (Waisen, Mandate, Gemeinschaften …). */
function apiFinanzenKlaerliste(jahr) {
  return Api.ausfuehren('apiFinanzenKlaerliste', 'konto_lesen', function (ktx) { return Finanzen.klaerliste(ktx, finanzenZahl_(jahr)); });
}

/** Tarifwechsel-Vorschläge (Altersgrenzen der Beitragsarten). */
function apiFinanzenTarifwechsel(jahr) {
  return Api.ausfuehren('apiFinanzenTarifwechsel', 'konto_lesen', function (ktx) { return Finanzen.tarifwechsel(ktx, finanzenZahl_(jahr)); });
}

/** Ausgewählte Tarifwechsel übernehmen (ändert Mitglied.beitragsart_id). */
function apiFinanzenTarifwechselUebernehmen(jahr, mitgliedIds) {
  return Api.ausfuehren('apiFinanzenTarifwechselUebernehmen', 'mitglied_bearbeiten', function (ktx) {
    return Finanzen.tarifwechselUebernehmen(ktx, finanzenZahl_(jahr), Array.isArray(mitgliedIds) ? mitgliedIds.map(finanzenZahl_) : []);
  });
}

/** Buchhaltungs-Export eines Jahres (ohne IBAN). */
function apiFinanzenBuchhaltung(jahr) {
  return Api.ausfuehren('apiFinanzenBuchhaltung', 'export', function (ktx) { return Finanzen.buchhaltung(ktx, finanzenZahl_(jahr)); });
}

/** Im Browser erzeugten Export protokollieren (Liste, Anzahl). */
function apiFinanzenExportVermerken(liste, anzahl) {
  return Api.ausfuehren('apiFinanzenExportVermerken', 'export', function (ktx) { return Finanzen.exportVermerken(ktx, String(liste || ''), finanzenZahl_(anzahl)); });
}
