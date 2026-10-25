/**
 * API Korrespondenz – öffentliche Funktionen für Dokument-Links, Vorlagen und Anschreiben (google.script.run).
 *
 * Zweck:      Dünne Schicht über src/modul/Korrespondenz.js. Jede Funktion läuft über Api.ausfuehren (Rollenprüfung,
 *             generische Fehler, Messung). Parameter aus dem Browser werden hier grob in Form gebracht.
 * Datenquelle: siehe Modul.
 * Wer darf was: dokumente_verwalten (Links), anschreiben_erstellen (Schreiben, Serienbrief-Export, Vorlagen lesen),
 *             stammdaten_bearbeiten (Vorlagen pflegen) – laut src/lib/rechte.js Vorstand, Mitgliederverwalter, Kassier
 *             (Vorlagen pflegen nur Vorstand/Mitgliederverwalter).
 * Besonderheiten: Auswahl der Empfänger als { mitglied_ids | beitragskonto_ids | sollstellung_ids }; die IDs prüft
 *             der Server einzeln gegen den Sichtkreis der Rolle.
 */

/** Auswahl aus dem Browser säubern (nur Zahlen-Listen). */
function korrespondenzAuswahl_(a) {
  a = a || {};
  var o = {};
  ['mitglied_ids', 'beitragskonto_ids', 'sollstellung_ids'].forEach(function (k) {
    if (Array.isArray(a[k])) o[k] = a[k].map(Number).filter(function (n) { return n > 0 && Math.floor(n) === n; });
  });
  return o;
}

/** Zusatzangaben säubern: jahr, faellig_am/wirksam/antwort_bis (JJJJ-MM-TT), mahnstufe, anlass, kanal (Brief|E-Mail). */
function korrespondenzZusatz_(z) {
  z = z || {};
  var o = {};
  if (z.jahr !== undefined && z.jahr !== null && z.jahr !== '') o.jahr = Number(z.jahr);
  if (z.faellig_am) o.faellig_am = String(z.faellig_am).slice(0, 10);
  if (z.mahnstufe) o.mahnstufe = Number(z.mahnstufe) || null;
  if (z.anlass) o.anlass = String(z.anlass).slice(0, 60);
  if (z.wirksam) o.wirksam = String(z.wirksam).slice(0, 10);
  if (z.antwort_bis) o.antwort_bis = String(z.antwort_bis).slice(0, 10);
  if (z.kanal === 'Brief' || z.kanal === 'E-Mail') o.kanal = z.kanal;
  return o;
}

function apiKorrespondenzDokumentSpeichern(werte) {
  return Api.ausfuehren('apiKorrespondenzDokumentSpeichern', 'dokumente_verwalten', function (ktx) {
    return Korrespondenz.dokumentSpeichern(ktx, werte || {});
  });
}

function apiKorrespondenzDokumentEntfernen(id, version) {
  return Api.ausfuehren('apiKorrespondenzDokumentEntfernen', 'dokumente_verwalten', function (ktx) {
    return Korrespondenz.dokumentEntfernen(ktx, Number(id), Number(version) || 0);
  });
}

/** Links aus dem Aufnahmeantrag-Archiv einer Person. */
function apiKorrespondenzAntragsLinks(mitgliedId) {
  return Api.ausfuehren('apiKorrespondenzAntragsLinks', 'dokumente_verwalten', function (ktx) {
    return Korrespondenz.antragsLinks(ktx, Number(mitgliedId));
  });
}

function apiKorrespondenzVorlagen() {
  return Api.ausfuehren('apiKorrespondenzVorlagen', 'anschreiben_erstellen', function (ktx) { return Korrespondenz.vorlagen(ktx); });
}

function apiKorrespondenzVorlageSpeichern(werte) {
  return Api.ausfuehren('apiKorrespondenzVorlageSpeichern', 'stammdaten_bearbeiten', function (ktx) {
    return Korrespondenz.vorlageSpeichern(ktx, werte || {});
  });
}

function apiKorrespondenzVorschau(vorlageId, auswahl, zusatz) {
  return Api.ausfuehren('apiKorrespondenzVorschau', 'anschreiben_erstellen', function (ktx) {
    return Korrespondenz.vorschau(ktx, Number(vorlageId), korrespondenzAuswahl_(auswahl), korrespondenzZusatz_(zusatz));
  });
}

function apiKorrespondenzErstellen(vorlageId, auswahl, zusatz) {
  return Api.ausfuehren('apiKorrespondenzErstellen', 'anschreiben_erstellen', function (ktx) {
    return Korrespondenz.erstellen(ktx, Number(vorlageId), korrespondenzAuswahl_(auswahl), korrespondenzZusatz_(zusatz));
  });
}

/** Ein erstelltes Schreiben vollständig laden (Nachdruck; protokolliert „eingesehen“). */
function apiKorrespondenzAnschreiben(id) {
  return Api.ausfuehren('apiKorrespondenzAnschreiben', 'anschreiben_erstellen', function (ktx) {
    return Korrespondenz.anschreiben(ktx, Number(id));
  });
}

function apiKorrespondenzAnschreibenLink(id, version, link) {
  return Api.ausfuehren('apiKorrespondenzAnschreibenLink', 'anschreiben_erstellen', function (ktx) {
    return Korrespondenz.anschreibenLink(ktx, Number(id), Number(version) || 0, link === null || link === undefined ? '' : String(link));
  });
}

/** Zeilen für den Word-Seriendruck (CSV erzeugt der Browser). */
function apiKorrespondenzSerienExport(auswahl, zusatz) {
  return Api.ausfuehren('apiKorrespondenzSerienExport', 'anschreiben_erstellen', function (ktx) {
    return Korrespondenz.serienExport(ktx, korrespondenzAuswahl_(auswahl), korrespondenzZusatz_(zusatz));
  });
}
