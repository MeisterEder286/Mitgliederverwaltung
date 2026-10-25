/**
 * MailBau – baut E-Mails (HTML + Klartext) aus einem fertigen Brief: Briefkopf, Betreff, Text, Gruß, Fußzeile.
 *
 * Zweck:      Grundlage für den E-Mail-Versand aus „Schreiben“ (Austritts-/Aufnahmebestätigung, Rückfrage Zahler,
 *             SEPA-Vorabinformation, Mahnung …). Gleiche Inhalte wie der gedruckte Brief (src/lib/vorlagen.js),
 *             nur in Mailform.
 * Datenquelle: Brief aus Vorlagen.brief bzw. ein gespeichertes Anschreiben (Text), _Konfig (mail_briefkopf,
 *             mail_logo_url, mail_fusszeile, brief_unterschrift, mail_antwort_an*). Rein, keine Dienste.
 * Wer darf was: – (Rechenfunktionen; Rechte prüft src/modul/Mail.js).
 * Besonderheiten:
 *   - Alle Texte (Vorlagen, Namen, Briefkopf) sind REINER TEXT und werden vollständig HTML-escaped. Nichts aus den
 *     Daten kann HTML oder Skript in die Mail bringen. Das Logo wird nur als https-Adresse übernommen.
 *   - Mailtaugliches HTML: Tabellenlayout, Inline-CSS, max. 640 px, Systemschriften (Mailprogramme ignorieren
 *     <style>-Blöcke oft).
 *   - Schutz vor Header-Injection: Betreff ohne Zeilenumbrüche, Empfänger-/Antwortadresse genau EINE Adresse ohne
 *     Komma, Semikolon, Leer- oder Steuerzeichen.
 */
var MailBau = (function () {

  /** Anlässe, bei denen Antworten an die Kasse gehen (replyTo = mail_antwort_an_finanzen). */
  var FINANZ_ANLAESSE = ['Rechnung', 'Mahnung', 'SEPA-Vorabinformation', 'Rückfrage Zahler', 'Rücklastschrift', 'Bankverbindung geändert'];
  /** Anlässe, bei denen ein PDF des Briefs angehängt werden kann (mail_pdf_anhang = ja). */
  var PDF_ANLAESSE = ['Austrittsbestätigung', 'Aufnahmebestätigung', 'Kündigungseingang'];

  function leer(v) { return v === null || v === undefined || String(v).trim() === ''; }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Genau eine E-Mail-Adresse? (einfaches Muster, keine Listen, keine Header-Tricks) */
  function adresseOk(a) {
    var s = String(a === null || a === undefined ? '' : a).trim();
    if (!s || s.length > 254) return false;
    if (/[\s,;<>()\[\]\\"]/.test(s) || /[\u0000-\u001f\u007f]/.test(s)) return false;
    return /^[^@]+@[^@]+\.[A-Za-z]{2,}$/.test(s);
  }

  /** Betreff: Steuerzeichen/Zeilenumbrüche entfernen (Header-Injection), Länge begrenzen. */
  function betreff(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  function zeilen(konfigWert) {
    return String(konfigWert || '').split('|').map(function (z) { return z.trim(); }).filter(Boolean);
  }

  function logoUrl(konfig) {
    var u = String((konfig || {}).mail_logo_url || '').trim();
    return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
  }

  /** replyTo je Anlass: Finanzthemen an die Kasse, sonst allgemein; ungültig/leer → null. */
  function antwortAn(anlass, konfig) {
    konfig = konfig || {};
    var a = FINANZ_ANLAESSE.indexOf(anlass) >= 0 && !leer(konfig.mail_antwort_an_finanzen) ? konfig.mail_antwort_an_finanzen : konfig.mail_antwort_an;
    return adresseOk(a) ? String(a).trim() : null;
  }

  /**
   * Brieftext für die Mail. brief: { betreff, text, ort_datum?, gruss? } oder { betreff, volltext } (gespeichertes
   * Anschreiben: Inhalt enthält Datum, Text und Gruß bereits).
   */
  function koerper(brief, konfig) {
    if (!leer(brief.volltext)) return String(brief.volltext);
    var gruss = brief.gruss || (konfig || {}).brief_unterschrift || '';
    return [brief.text || '', '', gruss].join('\n').trim();
  }

  /** Klartext-Fassung (für Mailprogramme ohne HTML). */
  function text(brief, konfig) {
    konfig = konfig || {};
    var kopf = zeilen(konfig.mail_briefkopf);
    var fuss = zeilen(konfig.mail_fusszeile);
    var teile = [];
    if (kopf.length) teile.push(kopf.join('\n'), '');
    teile.push(koerper(brief, konfig));
    if (fuss.length) teile.push('', '--', fuss.join('\n'));
    return teile.join('\n');
  }

  /** HTML-Fassung (vollständiges Dokument, alles escaped). */
  function html(brief, konfig) {
    konfig = konfig || {};
    var kopf = zeilen(konfig.mail_briefkopf);
    var fuss = zeilen(konfig.mail_fusszeile);
    var logo = logoUrl(konfig);
    var absaetze = koerper(brief, konfig).replace(/\r\n?/g, '\n').split(/\n{2,}/).map(function (a) {
      return '<p style="margin:0 0 14px;line-height:1.5">' + esc(a).replace(/\n/g, '<br>') + '</p>';
    }).join('');
    var schrift = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
    var kopfHtml = '<tr><td style="background:#0b4f8a;color:#ffffff;padding:16px 24px;' + schrift + '">' +
      (logo ? '<img src="' + esc(logo) + '" alt="" height="40" style="display:block;margin:0 0 8px;border:0">' : '') +
      kopf.map(function (z, i) {
        return '<div style="' + (i === 0 ? 'font-size:18px;font-weight:bold' : 'font-size:13px;opacity:0.9') + '">' + esc(z) + '</div>';
      }).join('') + '</td></tr>';
    var titel = '<tr><td style="padding:20px 24px 0;' + schrift + 'font-size:17px;font-weight:bold;color:#1b1f24">' + esc(betreff(brief.betreff)) + '</td></tr>';
    var inhalt = '<tr><td style="padding:12px 24px 8px;' + schrift + 'font-size:15px;color:#1b1f24">' + absaetze + '</td></tr>';
    var fussHtml = fuss.length ? '<tr><td style="padding:12px 24px 20px;border-top:1px solid #c9d1da;' + schrift + 'font-size:12px;color:#4a5560">' +
      fuss.map(esc).join('<br>') + '</td></tr>' : '';
    return '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(betreff(brief.betreff)) + '</title></head><body style="margin:0;padding:0;background:#f3f5f8">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f8"><tr><td align="center" style="padding:16px 8px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #c9d1da;border-radius:6px">' +
      kopfHtml + titel + inhalt + fussHtml + '</table></td></tr></table></body></html>';
  }

  /** Druckfassung (A4) für den PDF-Anhang – gleicher Aufbau wie der gedruckte Brief, alles escaped. */
  function druckHtml(brief, konfig) {
    konfig = konfig || {};
    var absender = brief.absender || konfig.brief_absender || konfig.verein_name || '';
    return '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;margin:20mm 20mm 20mm 25mm;color:#000}' +
      '.abs{font-size:7pt;border-bottom:0.3pt solid #000;width:85mm;margin-top:25mm}.an{white-space:pre-line;margin:2mm 0 18mm;min-height:30mm}' +
      '.datum{text-align:right}.betreff{font-weight:bold;margin:8mm 0 6mm}.text{white-space:pre-wrap;line-height:1.45}.gruss{margin-top:8mm;white-space:pre-line}' +
      '</style></head><body>' +
      '<div class="abs">' + esc(absender) + '</div>' +
      '<div class="an">' + esc((brief.empfaenger || []).join('\n')) + '</div>' +
      '<div class="datum">' + esc(brief.ort_datum || '') + '</div>' +
      '<div class="betreff">' + esc(betreff(brief.betreff)) + '</div>' +
      '<div class="text">' + esc(leer(brief.volltext) ? brief.text : brief.volltext) + '</div>' +
      (leer(brief.volltext) ? '<div class="gruss">' + esc(brief.gruss || konfig.brief_unterschrift || '') + '</div>' : '') +
      '</body></html>';
  }

  /** Dateiname für den PDF-Anhang (nur sichere Zeichen). */
  function pdfName(brief, anlass) {
    var n = (String(anlass || 'Schreiben') + ' ' + String(brief.name || '')).replace(/[^0-9A-Za-zÄÖÜäöüß ._-]/g, '').trim().replace(/\s+/g, '_');
    return (n || 'Schreiben').slice(0, 80) + '.pdf';
  }

  return {
    FINANZ_ANLAESSE: FINANZ_ANLAESSE, PDF_ANLAESSE: PDF_ANLAESSE,
    esc: esc, adresseOk: adresseOk, betreff: betreff, antwortAn: antwortAn,
    html: html, text: text, druckHtml: druckHtml, pdfName: pdfName
  };
})();
