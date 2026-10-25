/**
 * API Familie – öffentliche Funktionen für Familienübersicht, Ausscheider, Umstellung auf Einzelbeitrag,
 * Ausbildungsangaben und Zahlungshistorie (google.script.run).
 *
 * Zweck:      Dünne Hülle um src/modul/Familie.js; jede Funktion läuft durch Api.ausfuehren (Rollenprüfung, Messung,
 *             generische Fehler).
 * Datenquelle: über FamilieModul.
 * Wer darf was: Lesen konto_lesen; Umstellen und Ausbildung mitglied_bearbeiten; Export-Vermerk export.
 * Besonderheiten: Parameter vom Browser werden hier in Zahlen/Listen umgewandelt, nie ungeprüft weitergereicht.
 */

function familieZahl_(v) { var n = Number(v); return isFinite(n) ? n : null; }

function apiFamilieUebersicht(jahr) {
  return Api.ausfuehren('apiFamilieUebersicht', 'konto_lesen', function (ktx) { return FamilieModul.uebersicht(ktx, familieZahl_(jahr)); });
}

function apiFamilieAusscheider(jahr, jahreVoraus) {
  return Api.ausfuehren('apiFamilieAusscheider', 'konto_lesen', function (ktx) {
    return FamilieModul.ausscheider(ktx, familieZahl_(jahr), familieZahl_(jahreVoraus));
  });
}

/** liste: [{ mitglied_id, version, beitragsart_id? }], wirksam: 'JJJJ-MM-TT'. */
function apiFamilieUmstellen(liste, wirksam) {
  return Api.ausfuehren('apiFamilieUmstellen', 'mitglied_bearbeiten', function (ktx) {
    var l = Array.isArray(liste) ? liste.map(function (w) {
      return { mitglied_id: familieZahl_(w && w.mitglied_id), version: familieZahl_(w && w.version), beitragsart_id: w && w.beitragsart_id ? familieZahl_(w.beitragsart_id) : null };
    }) : [];
    return FamilieModul.umstellen(ktx, l, wirksam ? String(wirksam) : null);
  });
}

function apiFamilieAusbildungSpeichern(mitgliedId, version, werte) {
  return Api.ausfuehren('apiFamilieAusbildungSpeichern', 'mitglied_bearbeiten', function (ktx) {
    return FamilieModul.ausbildungSpeichern(ktx, familieZahl_(mitgliedId), familieZahl_(version), werte || {});
  });
}

function apiFamilieBezahlhistorie(mitgliedId) {
  return Api.ausfuehren('apiFamilieBezahlhistorie', 'konto_lesen', function (ktx) { return FamilieModul.bezahlhistorie(ktx, familieZahl_(mitgliedId)); });
}

function apiFamilieKontohistorie(kontoId) {
  return Api.ausfuehren('apiFamilieKontohistorie', 'konto_lesen', function (ktx) { return FamilieModul.kontohistorie(ktx, familieZahl_(kontoId)); });
}

function apiFamilieExportVermerken(liste, anzahl) {
  return Api.ausfuehren('apiFamilieExportVermerken', 'export', function (ktx) { return FamilieModul.exportVermerken(ktx, liste, familieZahl_(anzahl)); });
}
