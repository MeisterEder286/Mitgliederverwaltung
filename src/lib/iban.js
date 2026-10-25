/**
 * Iban – Prüfung und Darstellung von IBAN, BIC und Gläubiger-Identifikationsnummer (rein, ohne Dienste).
 *
 * Zweck:      Eingaben im Beitragskonto prüfen, IBAN für die Anzeige maskieren (Snapshot, Listen), Daten für den
 *             SEPA-Lauf (src/lib/sepa.js) absichern.
 * Datenquelle: übergebene Texte. Speichert nichts.
 * Wer darf was: – (die Klartext-IBAN sehen nur Rollen mit Aktion iban_aufdecken; das regelt das Servermodul).
 * Besonderheiten:
 *   - Prüfziffer nach ISO 13616 (mod 97 = 1). Länderlängen für alle SEPA-Teilnehmerländer.
 *   - Gläubiger-ID (Creditor Identifier) nach EPC262-08: CC + 2 Prüfziffern + 3 Zeichen Geschäftsbereich
 *     (bei der Prüfung ignoriert, meist „ZZZ“) + nationale Kennung. Prüfziffer wie IBAN, aber OHNE den
 *     Geschäftsbereich. Deutsches Beispiel der Bundesbank: DE98ZZZ09999999999.
 *   - Bei deutschen IBANs ist der BIC entbehrlich (IBAN-only); in der SEPA-Datei steht dann „NOTPROVIDED“.
 */
var Iban = (function () {
  // Länge der IBAN je Land (SEPA-Raum inkl. EWR, CH, GB, MC, SM, VA, AD).
  var LAENGE = {
    AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27,
    GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27,
    MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22
  };

  /** Leerzeichen/Bindestriche entfernen, Großbuchstaben. */
  function normalisiere(iban) {
    return String(iban || '').replace(/[\s\-.]/g, '').toUpperCase();
  }

  /** Rest modulo 97 einer Ziffern-/Buchstabenfolge (Buchstaben A=10 … Z=35), stückweise gerechnet. */
  function mod97(text) {
    var ziffern = text.replace(/[A-Z]/g, function (c) { return String(c.charCodeAt(0) - 55); });
    var rest = 0;
    for (var i = 0; i < ziffern.length; i += 7) rest = Number(String(rest) + ziffern.slice(i, i + 7)) % 97;
    return rest;
  }

  /**
   * Prüft eine IBAN. Liefert { ok, iban (normalisiert), land, fehler }.
   * fehler: 'leer' | 'format' | 'land' | 'laenge' | 'pruefziffer'
   */
  function pruefe(iban) {
    var n = normalisiere(iban);
    if (!n) return { ok: false, iban: n, land: null, fehler: 'leer' };
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(n)) return { ok: false, iban: n, land: null, fehler: 'format' };
    var land = n.slice(0, 2);
    if (!LAENGE[land]) return { ok: false, iban: n, land: land, fehler: 'land' };
    if (n.length !== LAENGE[land]) return { ok: false, iban: n, land: land, fehler: 'laenge' };
    if (mod97(n.slice(4) + n.slice(0, 4)) !== 1) return { ok: false, iban: n, land: land, fehler: 'pruefziffer' };
    return { ok: true, iban: n, land: land, fehler: null };
  }

  var FEHLERTEXT = {
    leer: 'Keine IBAN angegeben.',
    format: 'Die IBAN hat ein ungültiges Format.',
    land: 'Das Land der IBAN gehört nicht zum SEPA-Raum.',
    laenge: 'Die IBAN hat für dieses Land die falsche Länge.',
    pruefziffer: 'Die Prüfziffer der IBAN stimmt nicht – bitte auf Tippfehler prüfen.'
  };
  function fehlertext(code) { return FEHLERTEXT[code] || 'Die IBAN ist ungültig.'; }

  /** In 4er-Gruppen: 'DE89 3704 0044 0532 0130 00'. */
  function formatiere(iban) {
    return normalisiere(iban).replace(/(.{4})/g, '$1 ').trim();
  }

  /** Für Listen und Snapshot: Land, Prüfziffer und letzte vier Stellen, z. B. 'DE89 •••• •••• 3000'. */
  function maskiere(iban) {
    var n = normalisiere(iban);
    if (n.length < 8) return n ? '••••' : '';
    return n.slice(0, 4) + ' •••• •••• ' + n.slice(-4);
  }

  /** Muss ein BIC mitgegeben werden? Inländisch (DE) nein; sonst empfohlen (Bank fragen). */
  function bicNoetig(iban) {
    var n = normalisiere(iban);
    return n.slice(0, 2) !== 'DE';
  }

  /** Format-Prüfung BIC (8 oder 11 Zeichen). Leer ist erlaubt (IBAN-only). */
  function pruefeBic(bic) {
    var b = String(bic || '').replace(/\s/g, '').toUpperCase();
    if (!b) return { ok: true, bic: '' };
    return { ok: /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b), bic: b };
  }

  /** Prüft eine Gläubiger-Identifikationsnummer. Liefert { ok, id, fehler }. */
  function glaeubigerIdPruefen(id) {
    var n = normalisiere(id);
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(n)) return { ok: false, id: n, fehler: 'format' };
    if (n.slice(0, 2) === 'DE' && n.length !== 18) return { ok: false, id: n, fehler: 'laenge' };
    var national = n.slice(7);
    if (/^0+$/.test(national)) return { ok: false, id: n, fehler: 'platzhalter' };
    if (mod97(national + n.slice(0, 2) + n.slice(2, 4)) !== 1) return { ok: false, id: n, fehler: 'pruefziffer' };
    return { ok: true, id: n, fehler: null };
  }

  /**
   * Deutsche IBAN aus Bankleitzahl (8 Stellen) und Kontonummer (bis 10 Stellen) bilden.
   * Hinweis: Manche Banken haben Sonderregeln für die Umrechnung (Bundesbank „IBAN-Regeln“); für den
   * Altbestand also nur als Plausibilitätshilfe nutzen, die gespeicherte IBAN hat Vorrang.
   */
  function ausBlzKonto(blz, konto) {
    var b = String(blz || '').replace(/\D/g, ''), k = String(konto || '').replace(/\D/g, '');
    if (b.length !== 8 || !k || k.length > 10) return null;
    var bban = b + ('0000000000' + k).slice(-10);
    var pz = 98 - mod97(bban + 'DE00');
    return 'DE' + ('0' + pz).slice(-2) + bban;
  }

  return {
    ausBlzKonto: ausBlzKonto,
    normalisiere: normalisiere, pruefe: pruefe, fehlertext: fehlertext, formatiere: formatiere,
    maskiere: maskiere, bicNoetig: bicNoetig, pruefeBic: pruefeBic, glaeubigerIdPruefen: glaeubigerIdPruefen,
    LAENGE: LAENGE
  };
})();
