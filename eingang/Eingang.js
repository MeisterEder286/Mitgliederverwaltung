/**
 * Eingang – öffentlicher Empfänger für Online-Aufnahmeanträge der Vereins-Homepage (eigenes Apps-Script-Projekt).
 *
 * Zweck:      WordPress (Child-Theme, inc/eingang-sender.php) schickt nach dem Absenden des Aufnahmeformulars den
 *             Antrag im Format „tsv-antrag-2“ (JSON; übergangsweise auch die Access-XML) und das PDF mit Unterschrift
 *             per HTTPS POST hierher. Dieses Skript legt beide Dateien im Drive-Ordner „Beitritte Eingang“ ab und hängt
 *             eine Zeile an den Tab „Eingang“ der Eingangstabelle (Spalten inhalt und format).
 *             Die Mitgliederverwaltung (WebApp) liest diese Tabelle und übernimmt die Anträge (docs/EINGANG.md).
 * Datenquelle: Script Properties dieses (eigenen!) Projekts:
 *               SCHLUESSEL   gemeinsames Geheimnis mit WordPress (mind. 32 Zeichen; einrichten() erzeugt eines)
 *               EINGANG_ID   ID der Eingangstabelle (dieselbe wie EINGANG_ID in der WebApp, NIE die Datenbank)
 *               ORDNER_ID    Drive-Ordner für XML und PDF (legt einrichten() an)
 * Wer darf was: Web-App „Ausführen als: Ich“, „Zugriff: Jeder“ – sonst kann der WordPress-Server nicht senden.
 *             Angenommen wird nur mit richtigem SCHLUESSEL. Das Skript kann nur ANHÄNGEN: Es liest keine Anträge
 *             aus, ändert keine Zeilen und kennt die Mitglieder-Datenbank nicht (Sicherheitsregel: öffentliche
 *             Schreibziele isoliert, antrag_endpunkt_regel).
 * Besonderheiten:
 *   - Scopes: spreadsheets (Eingangstabelle) und drive.file (nur Dateien und Ordner, die dieses Skript selbst
 *     angelegt hat – kein Zugriff auf das übrige Drive des Funktionskontos). Drive über den erweiterten Dienst v3.
 *   - Antworten sind knapp und ohne Details ({ ok, eingang_id } bzw. { ok: false, fehler: '<code>' }); Einzelheiten
 *     nur im Ausführungsprotokoll, dort ohne personenbezogene Daten.
 *   - Doppelt gesendet (WordPress wiederholt nach Zeitüberschreitung mit derselben antrag_id): keine zweite Zeile,
 *     Antwort { ok: true, doppelt: true }.
 *   - Höchstens MAX_JE_STUNDE angenommene Anträge je Stunde (Schutz gegen massenhaft abgeschickte Formulare).
 *   - Zellen: Text mit = + - @ am Anfang bekommt ein ' vorangestellt (Formelschutz). Inhalt höchstens MAX_INHALT
 *     Zeichen (Google-Sheets-Grenze 50 000 Zeichen je Zelle).
 *   - Die reinen Prüfungen stehen im Namensraum EingangPruefung und sind in Node getestet (test/eingang-skript.test.js).
 */

/** Reine Hilfen ohne Apps-Script-Dienste (in Node testbar). */
var EingangPruefung = (function () {
  var TAB = 'Eingang';
  // Gleiche Spalten wie src/lib/eingang.js (Eingang.SPALTEN) – der Test prüft, dass beide übereinstimmen.
  var SPALTEN = ['eingang_id', 'eingang_am', 'format', 'dateiname', 'inhalt', 'drive_link', 'pdf_link', 'unterschrift_am', 'status', 'erledigt_am', 'erledigt_von', 'ergebnis'];
  var FORMAT = 'tsv-antrag-2';
  var MAX_INHALT = 45000;
  var MAX_PDF_BYTES = 8 * 1024 * 1024;
  var MAX_ANFRAGE = Math.ceil(MAX_PDF_BYTES * 4 / 3) + MAX_INHALT * 2 + 10000;
  var MAX_JE_STUNDE = 30;
  var MIN_SCHLUESSEL = 32;

  /** Vergleich in konstanter Zeit über die Länge des Soll-Schlüssels (kein Rückschluss über die Antwortzeit). */
  function gleich(eingabe, soll) {
    eingabe = String(eingabe || ''); soll = String(soll || '');
    var d = eingabe.length ^ soll.length;
    for (var i = 0; i < soll.length; i++) d |= (eingabe.charCodeAt(i) || 0) ^ soll.charCodeAt(i);
    return d === 0 && soll.length > 0;
  }

  function nein(code) { return { ok: false, fehler: code }; }

  /**
   * Anfrage prüfen. anfrage: geparstes JSON { schluessel, antrag_id, antrag (Objekt „tsv-antrag-2“) ODER xml (Text),
   * pdf_base64, dateiname?, unterschrift_am? }.
   * Liefert { ok: true, antrag: { antrag_id, format, inhalt, endung, typ, pdf_base64, unterschrift_am, dateiname } }
   * oder { ok: false, fehler: code } (nicht_eingerichtet, nicht_berechtigt, ungueltig).
   */
  function pruefeAnfrage(anfrage, schluessel) {
    if (!schluessel || String(schluessel).length < MIN_SCHLUESSEL) return nein('nicht_eingerichtet');
    if (!anfrage || typeof anfrage !== 'object') return nein('ungueltig');
    if (!gleich(anfrage.schluessel, schluessel)) return nein('nicht_berechtigt');
    var id = String(anfrage.antrag_id || '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return nein('ungueltig');
    var inhalt, format, endung, typ, datumAusAntrag = '';
    if (anfrage.antrag && typeof anfrage.antrag === 'object') {
      var a = anfrage.antrag;
      if (a.format !== FORMAT || !Array.isArray(a.personen) || !a.personen.length) return nein('ungueltig');
      inhalt = JSON.stringify(a);
      format = FORMAT; endung = '.json'; typ = 'application/json';
      var us = a.unterschriften && a.unterschriften.sepa, ua = a.unterschriften && a.unterschriften.antrag;
      datumAusAntrag = String((us && us.datum) || (ua && ua.datum) || '');
    } else {
      inhalt = typeof anfrage.xml === 'string' ? anfrage.xml.replace(/^\uFEFF/, '') : '';
      if (!inhalt || !/^\s*</.test(inhalt) || /<!DOCTYPE/i.test(inhalt) || !/<(?:[\w.\-]+:)?Daten16[\s>\/]/.test(inhalt)) return nein('ungueltig');
      format = 'access-xml'; endung = '.xml'; typ = 'text/xml';
    }
    if (inhalt.length > MAX_INHALT) return nein('ungueltig');
    var pdf = typeof anfrage.pdf_base64 === 'string' ? anfrage.pdf_base64.replace(/\s+/g, '') : '';
    if (pdf && (!/^[A-Za-z0-9+\/]+={0,2}$/.test(pdf) || pdf.length > Math.ceil(MAX_PDF_BYTES * 4 / 3))) return nein('ungueltig');
    var u = String(anfrage.unterschrift_am || datumAusAntrag || '');
    if (u && !/^\d{4}-\d{2}-\d{2}$/.test(u)) return nein('ungueltig');
    return { ok: true, antrag: { antrag_id: id, format: format, inhalt: inhalt, endung: endung, typ: typ, pdf_base64: pdf,
      unterschrift_am: u || '', dateiname: basisname(anfrage.dateiname, id) } };
  }

  /** Dateiname ohne Endung, nur sichere Zeichen; Fallback „tsv-beitritt-<id>“. */
  function basisname(name, id) {
    var n = String(name || '').replace(/\.(xml|json|pdf)$/i, '').replace(/[^\w.\-äöüÄÖÜß]/g, '-').replace(/-{2,}/g, '-').slice(0, 100);
    return n.replace(/^[-.]+|[-.]+$/g, '') || ('tsv-beitritt-' + id);
  }

  function istPdf(bytes) {
    return !!bytes && bytes.length > 5 && String.fromCharCode(bytes[0] & 255, bytes[1] & 255, bytes[2] & 255, bytes[3] & 255, bytes[4] & 255) === '%PDF-';
  }

  /** Formelschutz für eine Zelle. */
  function zelle(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  }

  /** Neue Zeile in der Reihenfolge der vorhandenen Kopfzeile. */
  function zeile(kopf, werte) {
    return kopf.map(function (h) { return zelle(werte[String(h).trim()]); });
  }

  function stundenSchluessel(datum) {
    return 'eingang:' + datum.toISOString().slice(0, 13);
  }

  return {
    TAB: TAB, SPALTEN: SPALTEN, FORMAT: FORMAT, MAX_INHALT: MAX_INHALT, MAX_PDF_BYTES: MAX_PDF_BYTES, MAX_ANFRAGE: MAX_ANFRAGE,
    MAX_JE_STUNDE: MAX_JE_STUNDE, MIN_SCHLUESSEL: MIN_SCHLUESSEL,
    gleich: gleich, pruefeAnfrage: pruefeAnfrage, basisname: basisname, istPdf: istPdf, zelle: zelle, zeile: zeile,
    stundenSchluessel: stundenSchluessel
  };
})();

// ================================================================== Web-App

/** Empfang von WordPress. Antwort immer JSON, ohne Einzelheiten. */
function doPost(e) {
  var r;
  try {
    r = eingangAnnehmen_(e);
  } catch (err) {
    console.error('Eingang: interner Fehler: ' + (err && err.message));
    r = { ok: false, fehler: 'intern' };
  }
  if (!r.ok) console.log('Eingang abgewiesen: ' + r.fehler);
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

function eingangAnnehmen_(e) {
  var P = EingangPruefung;
  var props = PropertiesService.getScriptProperties();
  var roh = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  if (!roh || roh.length > P.MAX_ANFRAGE) return { ok: false, fehler: 'ungueltig' };
  var anfrage;
  try { anfrage = JSON.parse(roh); } catch (x) { return { ok: false, fehler: 'ungueltig' }; }
  var p = P.pruefeAnfrage(anfrage, props.getProperty('SCHLUESSEL'));
  if (!p.ok) return p;
  var a = p.antrag;
  var pdfBytes = a.pdf_base64 ? Utilities.base64Decode(a.pdf_base64) : null;
  if (pdfBytes && (!P.istPdf(pdfBytes) || pdfBytes.length > P.MAX_PDF_BYTES)) return { ok: false, fehler: 'ungueltig' };
  var eingangId = props.getProperty('EINGANG_ID'), ordnerId = props.getProperty('ORDNER_ID');
  if (!eingangId || !ordnerId) return { ok: false, fehler: 'nicht_eingerichtet' };

  var sperre = LockService.getScriptLock();
  sperre.waitLock(20000);
  try {
    var blatt = SpreadsheetApp.openById(eingangId).getSheetByName(P.TAB);
    if (!blatt) return { ok: false, fehler: 'nicht_eingerichtet' };
    var werte = blatt.getDataRange().getValues();
    var kopf = werte[0].map(function (k) { return String(k).trim(); });
    var iId = kopf.indexOf('eingang_id');
    if (iId < 0) return { ok: false, fehler: 'nicht_eingerichtet' };
    for (var i = 1; i < werte.length; i++) {
      if (String(werte[i][iId]).trim() === a.antrag_id) return { ok: true, eingang_id: a.antrag_id, doppelt: true };
    }
    // Begrenzung je Stunde (erst nach der Schlüsselprüfung – Fremde können legitime Anträge nicht blockieren)
    var cache = CacheService.getScriptCache();
    var stunde = P.stundenSchluessel(new Date());
    var zahl = Number(cache.get(stunde) || 0);
    if (zahl >= P.MAX_JE_STUNDE) return { ok: false, fehler: 'zu_viele' };
    cache.put(stunde, String(zahl + 1), 3600);

    var datei = dateiAnlegen_(a.dateiname + a.endung, a.typ, Utilities.newBlob(a.inhalt, a.typ, a.dateiname + a.endung), ordnerId);
    var pdfDatei = pdfBytes ? dateiAnlegen_(a.dateiname + '.pdf', 'application/pdf', Utilities.newBlob(pdfBytes, 'application/pdf', a.dateiname + '.pdf'), ordnerId) : null;
    blatt.appendRow(P.zeile(kopf, {
      eingang_id: a.antrag_id,
      eingang_am: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
      format: a.format, dateiname: a.dateiname + a.endung, inhalt: a.inhalt,
      drive_link: datei.webViewLink, pdf_link: pdfDatei ? pdfDatei.webViewLink : '',
      unterschrift_am: a.unterschrift_am, status: 'neu'
    }));
    return { ok: true, eingang_id: a.antrag_id };
  } finally {
    sperre.releaseLock();
  }
}

function dateiAnlegen_(name, typ, blob, ordnerId) {
  return Drive.Files.create({ name: name, mimeType: typ, parents: [ordnerId] }, blob,
    { fields: 'id,webViewLink', supportsAllDrives: true });
}

// ================================================================== Nur im Editor (Funktionskonto)

/**
 * Einmalig ausführen: erzeugt SCHLUESSEL (falls leer), legt den Ordner „Beitritte Eingang“ an (falls ORDNER_ID leer)
 * und prüft die Eingangstabelle (legt den Tab „Eingang“ mit Kopfzeile an, ergänzt fehlende Spalten).
 * Den Schlüssel aus dem Ausführungsprotokoll in wp-config.php übernehmen (TSV_EINGANG_SCHLUESSEL).
 */
function einrichten() {
  var P = EingangPruefung;
  var props = PropertiesService.getScriptProperties();
  var bericht = [];
  if (!props.getProperty('SCHLUESSEL') || props.getProperty('SCHLUESSEL').length < P.MIN_SCHLUESSEL) {
    var s = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('SCHLUESSEL', s);
    bericht.push('SCHLUESSEL neu erzeugt – in wp-config.php eintragen: define( \'TSV_EINGANG_SCHLUESSEL\', \'' + s + '\' );');
  } else bericht.push('SCHLUESSEL vorhanden (unverändert).');
  if (!props.getProperty('ORDNER_ID')) {
    var o = Drive.Files.create({ name: 'Beitritte Eingang', mimeType: 'application/vnd.google-apps.folder' }, null, { fields: 'id,webViewLink' });
    props.setProperty('ORDNER_ID', o.id);
    bericht.push('Ordner „Beitritte Eingang“ angelegt: ' + o.webViewLink + ' – in den geschützten Bereich verschieben, Freigabe nur Funktionskonto.');
  } else bericht.push('ORDNER_ID vorhanden (unverändert).');
  var id = props.getProperty('EINGANG_ID');
  if (!id) throw new Error('Script Property EINGANG_ID fehlt – ID der Eingangstabelle eintragen (docs/EINGANG.md).');
  var ss = SpreadsheetApp.openById(id);
  var b = ss.getSheetByName(P.TAB) || ss.insertSheet(P.TAB);
  var letzte = b.getLastColumn();
  var kopf = letzte ? b.getRange(1, 1, 1, letzte).getValues()[0].map(function (k) { return String(k).trim(); }) : [];
  var fehlt = P.SPALTEN.filter(function (s) { return kopf.indexOf(s) < 0; });
  if (fehlt.length) b.getRange(1, kopf.length + 1, 1, fehlt.length).setValues([fehlt]);
  bericht.push(fehlt.length ? 'Eingang: Spalten ergänzt: ' + fehlt.join(', ') : 'Eingang: Kopfzeile vollständig.');
  var text = bericht.join('\n');
  console.log(text);
  return text;
}
