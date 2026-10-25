/**
 * Vorlagen – Briefvorlagen mit Platzhaltern füllen, Anschrift bestimmen, Werte für Platzhalter aufbereiten.
 *
 * Zweck:      Grundlage für „Schreiben“ (Anschreiben, Serienbriefe, Austrittsbestätigung, Rechnung, Mahnung, SEPA-
 *             Vorabinformation …). Ersetzt die Access-Funktionen MitteilungAustritt, RechnungF, Mahnung_EinzugF
 *             und den Word-Serienbrief (WordStartenM).
 * Datenquelle: Vorlage-Text aus dem Tab Vorlage, Personen-/Konto-/Sollstellungsdaten (bereits nach Rolle
 *             geschnitten – siehe src/modul/Korrespondenz.js), _Konfig (verein_*, brief_*). Rein, keine Dienste.
 * Wer darf was: – (Rechenfunktionen; Rechte prüft das Servermodul).
 * Besonderheiten:
 *   - Platzhalter: {{name}}. Bedingung: {{#wenn name}} … {{/wenn}} (nicht verschachtelt) – Inhalt nur, wenn der
 *     Wert nicht leer ist. Unbekannte Platzhalter werden NICHT still ersetzt, sondern als Fehler gemeldet.
 *   - Ergebnis ist reiner TEXT. Es wird nie HTML erzeugt oder interpretiert; die Anzeige setzt den Text per
 *     textContent. Absätze trennt eine Leerzeile.
 *   - Die IBAN gibt es nur maskiert ({{iban_maskiert}}) – Klartext-IBANs gehören in kein Anschreiben.
 *   - Beträge „1.234,56 €“, Datum „TT.MM.JJJJ“ (deutsche Schreibweise, unabhängig von der Zeitzone).
 */
var Vorlagen = (function () {

  /** Platzhalter-Katalog (für die Hilfe in der Oberfläche und die Prüfung auf Tippfehler). */
  var KATALOG = [
    ['briefanrede', 'Briefanrede, z. B. „Sehr geehrter Herr Bauer“ (Vorschlag, wenn leer)', 'Person'],
    ['anrede', 'Herr / Frau', 'Person'], ['titel', 'Akademischer Titel', 'Person'],
    ['vorname', 'Vorname', 'Person'], ['nachname', 'Nachname', 'Person'], ['name', 'Vorname Nachname', 'Person'],
    ['strasse', 'Straße', 'Person'], ['hausnummer', 'Hausnummer', 'Person'], ['plz', 'PLZ', 'Person'], ['ort', 'Ort', 'Person'],
    ['mitgliedsnummer', 'Mitgliedsnummer', 'Mitgliedschaft'], ['geburtsdatum', 'Geburtsdatum', 'Person'],
    ['alter', 'Alter (im Briefjahr erreicht)', 'Person'],
    ['eintrittsdatum', 'Eintritt (laufende bzw. letzte Mitgliedschaft)', 'Mitgliedschaft'],
    ['austrittsdatum', 'Austrittsdatum', 'Mitgliedschaft'], ['austritt_wirksam', 'Austritt wirksam zum', 'Mitgliedschaft'],
    ['kuendigung_eingang', 'Eingang der Kündigung', 'Mitgliedschaft'],
    ['abteilungen', 'Laufende Abteilungen, durch Komma getrennt', 'Mitgliedschaft'],
    ['funktion', 'Laufende Funktionen (Ämter)', 'Mitgliedschaft'],
    ['ausbildung_bis', 'Prognostiziertes Ende von Schule/Studium/Ausbildung', 'Beitrag'],
    ['beitragsart', 'Beitragsart (bzw. Gemeinschaft)', 'Beitrag'], ['beitrag', 'Jahresbeitrag der Person bzw. Festbetrag der Gemeinschaft', 'Beitrag'],
    ['jahr', 'Beitragsjahr', 'Beitrag'], ['betrag', 'Soll-Betrag der Sollstellung', 'Beitrag'],
    ['offen', 'Offener Betrag (Soll + Gebühr − eingegangen)', 'Beitrag'], ['gebuehr', 'Rücklastschrift-/Mahngebühr', 'Beitrag'],
    ['mahnstufe', 'Mahnstufe (Zahl)', 'Beitrag'], ['faellig_am', 'Zahlungsziel (Standard: Briefdatum + 14 Tage)', 'Beitrag'],
    ['einzugsdatum', 'Einzugsdatum der Lastschrift', 'Beitrag'],
    ['mandatsreferenz', 'SEPA-Mandatsreferenz', 'Konto'], ['iban_maskiert', 'IBAN, nur maskiert (DE89 •••• 3000)', 'Konto'],
    ['kontoinhaber', 'Kontoinhaber', 'Konto'], ['glaeubiger_id', 'Gläubiger-ID des Vereins', 'Verein'],
    ['verein_name', 'Name des Vereins', 'Verein'], ['verein_anschrift', 'Anschrift des Vereins (einzeilig)', 'Verein'],
    ['datum', 'Briefdatum', 'Verein'], ['ehrung', 'Ehrungsstufe (bei Ehrungen)', 'Ehrung']
  ].map(function (k) { return { name: k[0], beschreibung: k[1], gruppe: k[2] }; });
  var BEKANNT = {};
  KATALOG.forEach(function (k) { BEKANNT[k.name] = true; });

  // ------------------------------------------------------------------ Formatierung

  function datum(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? m[3] + '.' + m[2] + '.' + m[1] : (iso ? String(iso) : '');
  }
  function betrag(n) {
    if (n === null || n === undefined || n === '' || !isFinite(Number(n))) return '';
    var x = Math.round(Number(n) * 100) / 100;
    var teile = Math.abs(x).toFixed(2).split('.');
    var ganz = teile[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (x < 0 ? '−' : '') + ganz + ',' + teile[1] + ' €';
  }
  function leer(v) { return v === null || v === undefined || v === ''; }
  function name(m) { return m ? [m.titel, m.vorname, m.nachname].filter(function (x) { return !leer(x); }).join(' ') : ''; }

  /** Briefanrede-Vorschlag, falls keine gepflegt ist. */
  function briefanredeVorschlag(m, alter) {
    if (!m) return 'Sehr geehrte Damen und Herren';
    if (alter !== null && alter !== undefined && alter < 18 && m.vorname) {
      return (m.anrede === 'Herr' ? 'Lieber ' : m.anrede === 'Frau' ? 'Liebe ' : 'Hallo ') + m.vorname;
    }
    if (m.anrede === 'Herr') return 'Sehr geehrter Herr ' + [m.titel, m.nachname].filter(Boolean).join(' ');
    if (m.anrede === 'Frau') return 'Sehr geehrte Frau ' + [m.titel, m.nachname].filter(Boolean).join(' ');
    return 'Guten Tag ' + name(m);
  }

  // ------------------------------------------------------------------ Ersetzen

  /**
   * Füllt einen Vorlagentext. werte: { platzhalter: Text }. Liefert { text, unbekannt: [namen], leer: [namen] }.
   * Bedingungsblöcke mit leerem Wert entfallen. Platzhalter mit leerem Wert werden zu ''.
   */
  function fuelle(text, werte) {
    werte = werte || {};
    var unbekannt = [], leerGenutzt = [];
    function merke(liste, x) { if (liste.indexOf(x) < 0) liste.push(x); }
    var s = String(text || '').replace(/\r\n?/g, '\n');
    s = s.replace(/\{\{#wenn\s+([a-z_]+)\s*\}\}([\s\S]*?)\{\{\/wenn\}\}/g, function (_, feld, inhalt) {
      if (!BEKANNT[feld]) { merke(unbekannt, feld); return ''; }
      return leer(werte[feld]) ? '' : inhalt;
    });
    s = s.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, function (_, feld) {
      if (!BEKANNT[feld]) { merke(unbekannt, feld); return '{{' + feld + '}}'; }
      var v = werte[feld];
      if (leer(v)) { merke(leerGenutzt, feld); return ''; }
      return String(v);
    });
    // nicht geschlossene Blöcke sichtbar lassen, aber melden
    if (/\{\{#wenn|\{\{\/wenn\}\}/.test(s)) merke(unbekannt, '#wenn (nicht geschlossen)');
    s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { text: s, unbekannt: unbekannt, leer: leerGenutzt };
  }

  /** Prüft einen Vorlagentext (z. B. beim Speichern): unbekannte Platzhalter und offene Blöcke. */
  function pruefe(text) {
    return fuelle(text, {}).unbekannt;
  }

  // ------------------------------------------------------------------ Anschrift

  var AN_ZAHLER = ['Rechnung', 'Mahnung', 'SEPA-Vorabinformation'];

  /**
   * Empfängeranschrift (Zeilen) und Briefanrede.
   *   anlass Rechnung/Mahnung/SEPA-Vorabinformation mit Konto: an den Kontoinhaber, abweichende Rechnungsadresse
   *   des Kontos (abw_*) hat Vorrang, sonst Anschrift des Inhaber-Mitglieds, sonst des Mitglieds.
   *   Minderjährige (alter < 18) ohne Zahlerbezug: an die gesetzliche Vertretung („An die Erziehungsberechtigten
   *   von …“ bzw. vertreter_name).
   * daten: { mitglied, inhaber (Mitglied des Kontoinhabers), konto, alter }
   */
  function anschrift(anlass, daten) {
    var m = daten.mitglied || null, k = daten.konto || null, inh = daten.inhaber || null;
    var zeilen = [], anrede = null;
    var adr = function (q) {
      return { strasse: [q.strasse, q.hausnummer].filter(function (x) { return !leer(x); }).join(' '),
        ort: [q.plz, q.ort].filter(function (x) { return !leer(x); }).join(' '), land: q.land && q.land !== 'DE' ? q.land : '' };
    };
    if (k && AN_ZAHLER.indexOf(anlass) >= 0) {
      zeilen.push(k.kontoinhaber_name || name(inh || m));
      var a = !leer(k.abw_strasse) || !leer(k.abw_ort)
        ? adr({ strasse: k.abw_strasse, hausnummer: k.abw_hausnummer, plz: k.abw_plz, ort: k.abw_ort, land: k.abw_land })
        : adr(inh || m || {});
      [a.strasse, a.ort, a.land].forEach(function (x) { if (x) zeilen.push(x); });
      anrede = inh ? (inh.briefanrede || briefanredeVorschlag(inh, null)) : 'Sehr geehrte Damen und Herren';
      if (m && inh && m.mitglied_id !== inh.mitglied_id) zeilen.splice(1, 0, 'für ' + name(m));
      return { zeilen: zeilen.filter(Boolean), briefanrede: anrede };
    }
    if (!m) return { zeilen: [], briefanrede: 'Sehr geehrte Damen und Herren' };
    var minder = daten.alter !== null && daten.alter !== undefined && daten.alter < 18;
    if (minder) {
      zeilen.push(!leer(m.vertreter_name) ? 'An ' + m.vertreter_name : 'An die Erziehungsberechtigten von');
      zeilen.push(name(m));
      anrede = 'Liebe Eltern, ' + (m.briefanrede || briefanredeVorschlag(m, daten.alter));
    } else {
      zeilen.push(name(m));
      anrede = m.briefanrede || briefanredeVorschlag(m, daten.alter);
    }
    var b = adr(m);
    [b.strasse, b.ort, b.land].forEach(function (x) { if (x) zeilen.push(x); });
    return { zeilen: zeilen, briefanrede: anrede };
  }

  // ------------------------------------------------------------------ Werte

  /**
   * Platzhalterwerte aus (bereits nach Rolle geschnittenen) Daten. Fehlende Felder bleiben leer.
   * d: { mitglied, konto, inhaber, sollstellung, zeitraum (laufend/letzter), abteilungen: [Text], funktionen: [Text],
   *      beitragsart: { bezeichnung, betrag }, gemeinschaft: { bezeichnung, festbetrag }, alter, alter_im_jahr, jahr, heute,
   *      konfig, ehrung, zusatz: { faellig_am, … } }
   */
  function werte(d) {
    var m = d.mitglied || {}, k = d.konto || {}, s = d.sollstellung || null, z = d.zeitraum || {};
    var c = d.konfig || {};
    var heute = d.heute;
    var zusatz = d.zusatz || {};
    var faellig = zusatz.faellig_am || (heute ? plusTage(heute, 14) : null);
    var offen = s ? Math.max(0, Number(s.soll_betrag || 0) + Number(s.gebuehr || 0) - Number(s.ist_betrag || 0)) : null;
    var beitrag = d.gemeinschaft && !leer(d.gemeinschaft.festbetrag) ? d.gemeinschaft.festbetrag
      : d.beitragsart ? d.beitragsart.betrag : null;
    var w = {
      anrede: m.anrede, titel: m.titel, vorname: m.vorname, nachname: m.nachname, name: name(m),
      strasse: m.strasse, hausnummer: m.hausnummer, plz: m.plz, ort: m.ort,
      mitgliedsnummer: m.mitgliedsnummer, geburtsdatum: datum(m.geburtsdatum),
      // Platzhalter {{alter}} = im Briefjahr erreichtes Alter (Geburtstagsbriefe); die Anschrift nutzt das genaue Alter
      alter: !leer(d.alter_im_jahr) ? String(d.alter_im_jahr) : leer(d.alter) ? '' : String(d.alter),
      eintrittsdatum: datum(z.eintrittsdatum), austrittsdatum: datum(z.austrittsdatum),
      austritt_wirksam: datum(z.austritt_wirksam || z.austrittsdatum), kuendigung_eingang: datum(z.kuendigung_eingang),
      abteilungen: (d.abteilungen || []).join(', '), funktion: (d.funktionen || []).join(', '),
      ausbildung_bis: datum(m.ausbildung_bis),
      beitragsart: d.gemeinschaft ? d.gemeinschaft.bezeichnung : d.beitragsart ? d.beitragsart.bezeichnung : '',
      beitrag: betrag(beitrag),
      jahr: s ? String(s.jahr) : String(d.jahr || ''),
      betrag: s ? betrag(s.soll_betrag) : '', offen: s ? betrag(offen) : '',
      gebuehr: s && Number(s.gebuehr) ? betrag(s.gebuehr) : '',
      mahnstufe: s && Number(s.mahnstufe) ? String(s.mahnstufe) : (zusatz.mahnstufe ? String(zusatz.mahnstufe) : ''),
      faellig_am: datum(faellig), einzugsdatum: datum(s && s.einzugsdatum),
      mandatsreferenz: k.mandatsreferenz, iban_maskiert: k.iban_maskiert, kontoinhaber: k.kontoinhaber_name,
      glaeubiger_id: c.verein_glaeubiger_id && !/^DE00ZZZ0+$/.test(c.verein_glaeubiger_id) ? c.verein_glaeubiger_id : '',
      verein_name: c.verein_name || 'TSV Ergoldsbach e. V.',
      verein_anschrift: [[c.verein_strasse, c.verein_hausnummer].filter(Boolean).join(' '), [c.verein_plz, c.verein_ort].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      datum: datum(heute), ehrung: d.ehrung || zusatz.ehrung || ''
    };
    Object.keys(w).forEach(function (x) { if (w[x] === null || w[x] === undefined) w[x] = ''; });
    return w;
  }

  function plusTage(iso, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10);
  }

  /**
   * Einen Brief bauen: { betreff, text, empfaenger (Zeilen), absender, ort_datum, gruss, unbekannt, leer }.
   * vorlage: { betreff, text, anlass }; daten wie bei werte() plus anschrift-Daten.
   */
  function brief(vorlage, daten) {
    var adr = anschrift(vorlage.anlass, daten);
    var w = werte(daten);
    w.briefanrede = adr.briefanrede;
    var b = fuelle(vorlage.betreff, w), t = fuelle(vorlage.text, w);
    var c = daten.konfig || {};
    return {
      betreff: b.text, text: t.text, empfaenger: adr.zeilen,
      absender: c.brief_absender || (c.verein_name || 'TSV Ergoldsbach e. V.'),
      ort_datum: [c.brief_ort || c.verein_ort || '', datum(daten.heute)].filter(Boolean).join(', '),
      gruss: c.brief_unterschrift || c.verein_name || '',
      unbekannt: b.unbekannt.concat(t.unbekannt.filter(function (x) { return b.unbekannt.indexOf(x) < 0; })),
      leer: t.leer
    };
  }

  /** Vollständiger Brief als Text (für die Ablage in Anschreiben.inhalt und für mailto:). */
  function alsText(b) {
    return [b.ort_datum, '', b.text, '', b.gruss].join('\n');
  }

  /** Link nur auf Google Drive / Docs (Dokument-Ablage im eingeschränkten Ordner). */
  function istDriveLink(url) {
    return /^https:\/\/(drive|docs)\.google\.com\/[^\s<>"']+$/.test(String(url || '').trim());
  }

  return {
    KATALOG: KATALOG, fuelle: fuelle, pruefe: pruefe, anschrift: anschrift, werte: werte, brief: brief,
    alsText: alsText, briefanredeVorschlag: briefanredeVorschlag, istDriveLink: istDriveLink,
    datum: datum, betrag: betrag
  };
})();
