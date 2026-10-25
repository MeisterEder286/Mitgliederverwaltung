/**
 * API Mitglieder – öffentliche Server-Funktionen für Mitglieder, Zugehörigkeiten und Funktionen.
 *
 * Zweck:      Einzige Ziele für google.script.run aus den Ansichten „Mitglieder“ und „Funktionen“.
 * Datenquelle: über das Servermodul Mitglieder (src/modul/Mitglieder.js) – nie direkt.
 * Wer darf was: Jede Funktion läuft durch Api.ausfuehren mit der genannten Aktion (Rollenmatrix in
 *             src/lib/rechte.js). Den Zeilenschutz (wen darf die Rolle anfassen) erzwingt das Modul.
 * Besonderheiten: Schreibfunktionen liefern { aktualisiert, entfernt, hinweise? } – der Browser übernimmt das
 *             mit App.daten.uebernehme, ein zweiter Aufruf ist nicht nötig. Datumsangaben als 'JJJJ-MM-TT'.
 */

/** Stammdaten eines Mitglieds ändern. werte: Felder aus dem Feldkatalog (nur sichtbare werden übernommen). */
function apiMitgliedSpeichern(id, version, werte) {
  return Api.ausfuehren('apiMitgliedSpeichern', 'mitglied_bearbeiten', function (ktx) {
    return Mitglieder.speichern(ktx, Number(id), Number(version), werte);
  });
}

/** „Post kam zurück“ markieren bzw. aufheben. */
function apiMitgliedAdresseUngueltig(id, version, ungueltig) {
  return Api.ausfuehren('apiMitgliedAdresseUngueltig', 'mitglied_bearbeiten', function (ktx) {
    return Mitglieder.adresseUngueltig(ktx, Number(id), Number(version), !!ungueltig);
  });
}

/** Vorab-Prüfung beim Anlegen: gleicher Nachname + Geburtsdatum vorhanden? */
function apiMitgliedDublettenPruefen(nachname, geburtsdatum) {
  return Api.ausfuehren('apiMitgliedDublettenPruefen', 'mitglied_anlegen', function () {
    return Mitglieder.dubletten(String(nachname || ''), String(geburtsdatum || ''));
  });
}

/** Neues Mitglied: { mitglied: {…}, eintrittsdatum, abteilungen: [{ abteilung_id, status }], trotzDublette }. */
function apiMitgliedAnlegen(eingabe) {
  return Api.ausfuehren('apiMitgliedAnlegen', 'mitglied_anlegen', function (ktx) {
    return Mitglieder.anlegen(ktx, eingabe);
  });
}

/** Wiedereintritt: { eintrittsdatum, abteilungen: [{ abteilung_id, status }] }. */
function apiMitgliedWiedereintritt(id, eingabe) {
  return Api.ausfuehren('apiMitgliedWiedereintritt', 'mitglied_anlegen', function (ktx) {
    return Mitglieder.wiedereintritt(ktx, Number(id), eingabe);
  });
}

/** Vor dem Austritt: betroffene Abhängige auf Konten der Person und Optionen (Guard, Übergabe §4). */
function apiMitgliedAustrittVorbereiten(id, datum) {
  return Api.ausfuehren('apiMitgliedAustrittVorbereiten', 'austritt_erfassen', function (ktx) {
    return Mitglieder.austrittVorbereiten(ktx, Number(id), datum);
  });
}

/** Austritt: { kuendigung_eingang, austritt_wirksam, austrittsgrund, option: { code, konto_id, mitglied_id } }. */
function apiMitgliedAustritt(id, eingabe) {
  return Api.ausfuehren('apiMitgliedAustritt', 'austritt_erfassen', function (ktx) {
    return Mitglieder.austritt(ktx, Number(id), eingabe);
  });
}

/** Sterbefall erfassen. */
function apiMitgliedSterbefall(id, version, sterbedatum) {
  return Api.ausfuehren('apiMitgliedSterbefall', 'austritt_erfassen', function (ktx) {
    return Mitglieder.sterbefall(ktx, Number(id), Number(version), sterbedatum);
  });
}

/** Abteilungszugehörigkeit anlegen (zugId leer; werte.mitglied_id, abteilung_id, status …) oder ändern. */
function apiZugehoerigkeitSpeichern(zugId, version, werte) {
  return Api.ausfuehren('apiZugehoerigkeitSpeichern', 'zugehoerigkeit_bearbeiten', function (ktx) {
    return Mitglieder.zugehoerigkeitSpeichern(ktx, zugId === null || zugId === undefined || zugId === '' ? null : Number(zugId), Number(version || 0), werte);
  });
}

/** Abteilungszugehörigkeit beenden (nicht den Vereinsaustritt!). */
function apiZugehoerigkeitBeenden(zugId, version, datum) {
  return Api.ausfuehren('apiZugehoerigkeitBeenden', 'zugehoerigkeit_bearbeiten', function (ktx) {
    return Mitglieder.zugehoerigkeitBeenden(ktx, Number(zugId), Number(version), datum);
  });
}

/** Exaktsuche: { mitgliedsnummer } oder { nachname, geburtsdatum } → höchstens ein Treffer (ohne ID). */
function apiMitgliedSucheExakt(kriterien) {
  return Api.ausfuehren('apiMitgliedSucheExakt', 'mitglied_suchen_exakt', function (ktx) {
    return Mitglieder.sucheExakt(ktx, kriterien);
  });
}

/** Nach der Exaktsuche der eigenen Abteilung zuordnen – nur mit dem Einmal-Token aus apiMitgliedSucheExakt. */
function apiMitgliedZuordnen(token, abteilungId, status) {
  return Api.ausfuehren('apiMitgliedZuordnen', 'zugehoerigkeit_bearbeiten', function (ktx) {
    return Mitglieder.zuordnen(ktx, typeof token === 'string' ? token : '', Number(abteilungId), status);
  });
}

/** Funktion (Amt/Tätigkeit) eintragen: { mitglied_id, funktionsart_id, abteilung_id, zusatz, von, bestellt_am, bemerkung }. */
function apiFunktionEintragen(werte) {
  return Api.ausfuehren('apiFunktionEintragen', 'funktion_bearbeiten', function (ktx) {
    return Mitglieder.funktionEintragen(ktx, werte);
  });
}

/** Funktion beenden: { bis, beendigungsgrund } – Funktionen werden nie gelöscht. */
function apiFunktionBeenden(funktionId, version, werte) {
  return Api.ausfuehren('apiFunktionBeenden', 'funktion_bearbeiten', function (ktx) {
    return Mitglieder.funktionBeenden(ktx, Number(funktionId), Number(version), werte);
  });
}

/** Funktion korrigieren (Zusatz, von, bestellt am, Bemerkung). */
function apiFunktionAendern(funktionId, version, werte) {
  return Api.ausfuehren('apiFunktionAendern', 'funktion_bearbeiten', function (ktx) {
    return Mitglieder.funktionAendern(ktx, Number(funktionId), Number(version), werte);
  });
}

/** Export protokollieren (vor dem Herunterladen/Drucken im Browser): art, anzahl – ohne Personendaten. */
function apiMitgliederExport(art, anzahl) {
  return Api.ausfuehren('apiMitgliederExport', 'export', function (ktx) {
    return Mitglieder.exportProtokollieren(ktx, art, anzahl);
  });
}
