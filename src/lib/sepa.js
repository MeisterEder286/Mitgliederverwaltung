/**
 * Sepa – SEPA-Lastschriftlauf und XML-Datei im Format pain.008.001.08 (rein, ohne Apps-Script-Dienste).
 *
 * Zweck:      Aus den Sollstellungen eines Jahres die Einzugsposten bilden (mit Ausschlussgründen) und daraus die
 *             Lastschriftdatei für die Bank erzeugen. Bewusst eigenständig (separat auslieferbar, Frist 15.11.2026):
 *             braucht nur Iban, Beitrag (Adresse, Mandatsstatus) und Mitgliedschaft (Datumsrechnung).
 * Datenquelle: `daten` wie in src/lib/beitrag.js; Beitragskonto MIT Klartext-IBAN – das Servermodul lädt sie gezielt
 *             nur für diesen Lauf (die Snapshot-Basis enthält keine Klartext-IBAN).
 * Wer darf was: – (Rechenfunktionen). Auslösen im Servermodul nur mit Aktion sepa_lauf, jeder Lauf wird protokolliert.
 * Besonderheiten:
 *   - Sequenz: FRST, wenn unter dem aktuellen Mandat noch keine erfolgreiche Lastschrift lief, sonst RCUR.
 *     Seit dem EPC-Rulebook 2016 ist FRST nicht mehr zwingend; optionen.immerRcur = true schreibt nur RCUR.
 *   - Zeichensatz: SEPA-Basiszeichen (a–z A–Z 0–9 / - ? : ( ) . , ' + Leerzeichen). Umlaute werden umgeschrieben
 *     (ä → ae …), alles andere durch Leerzeichen ersetzt. Längen: Name 70, Verwendungszweck 140, IDs 35.
 *   - Strukturierte Adressen (Pflicht ab 11/2026 laut Übergabe): Straße und Hausnummer getrennt (StrtNm/BldgNb),
 *     PLZ, Ort, Land. Unvollständige Adressen werden weggelassen [A: für Zahler im EWR ist die Adresse optional –
 *     mit der Hausbank bestätigen]; die Klärliste (Beitrag.klaerliste) meldet sie.
 *   - Gläubiger-ID wird geprüft; mit dem Platzhalter aus _Konfig entsteht KEINE Datei, sondern eine Fehlerliste.
 *
 * UPDATE-PROZEDUR bei einem künftigen Formatwechsel (Bus-Faktor, Übergabe §7):
 *   1. Neues XSD (z. B. pain.008.001.1x) von der Hausbank bzw. aus der DK-Spezifikation (Anlage 3) besorgen und
 *      unter test/xsd/ ablegen, Quelle in test/xsd/QUELLE.md eintragen.
 *   2. In dieser Datei NAMESPACE anpassen und in xml() die Elemente gemäß der Änderungsliste der Bank ändern.
 *      Die Reihenfolge der Elemente ist im XSD fest vorgegeben – genau einhalten.
 *   3. test/sepa.test.js auf die neue XSD-Datei zeigen lassen, `npm test` ausführen (xmllint validiert).
 *   4. Eine Probedatei aus dem Testsystem bei der Bank als Test einreichen, erst danach produktiv nutzen.
 */
var Sepa = (function () {
  var NAMESPACE = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08';
  var ERFOLGREICH = ['bezahlt'];

  // ------------------------------------------------------------------ Zeichen und Formate

  var UMLAUTE = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss', '&': '+' };

  /** Text auf SEPA-Basiszeichen bringen und auf max Zeichen kürzen. */
  function bereinige(text, max) {
    var s = String(text === null || text === undefined ? '' : text)
      .replace(/[äöüÄÖÜß&]/g, function (c) { return UMLAUTE[c]; })
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9\/\-?:().,'+ ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max).trim() : s;
  }

  /** Kennung (MsgId, EndToEndId, Mandatsreferenz): keine Leerzeichen, kein führendes/abschließendes „/“, kein „//“. */
  function kennung(text, max) {
    var s = bereinige(text).replace(/ /g, '').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
    return s.slice(0, max || 35);
  }

  function escape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function betrag(n) { return (Math.round(Number(n) * 100) / 100).toFixed(2); }

  // ------------------------------------------------------------------ Sequenz

  /**
   * FRST oder RCUR für ein Konto. sollstellungen: alle Sollstellungen (beliebiger Konten), mandat: { mandatsdatum },
   * optionen: { ausser: sollstellung_id (die gerade einzuziehende), immerRcur }.
   */
  function sequenz(kontoId, sollstellungen, mandat, optionen) {
    optionen = optionen || {};
    if (optionen.immerRcur) return 'RCUR';
    var seit = (mandat && mandat.mandatsdatum) || '';
    var frueher = (sollstellungen || []).some(function (s) {
      return s.beitragskonto_id === kontoId && s.sollstellung_id !== optionen.ausser && s.sepa_sequenz &&
        ERFOLGREICH.indexOf(s.status) >= 0 && (!seit || !s.einzugsdatum || s.einzugsdatum >= seit);
    });
    return frueher ? 'RCUR' : 'FRST';
  }

  // ------------------------------------------------------------------ Lauf

  function verwendungszweck(vorlage, werte) {
    return String(vorlage).replace(/\{(\w+)\}/g, function (_, k) { return werte[k] === undefined || werte[k] === null ? '' : werte[k]; });
  }

  /**
   * Einzugsposten eines Jahres aus den offenen Sollstellungen.
   * optionen: { heute (JJJJ-MM-TT, Pflicht für Mandatsprüfung), einzugsdatum (überschreibt), konfig, immerRcur,
   *             status: ['offen'] (welche Sollstellungen eingezogen werden), zweck: Vorlage mit {jahr} {konto} {name} {nummern} }
   * Liefert { posten, ausgeschlossen: [{ sollstellung_id, konto_id, name, grund, art: 'fehler'|'info' }], summe, anzahl, jahr }.
   */
  function lauf(daten, jahr, optionen) {
    return Beitrag.mitIndex(daten, function () { return laufIntern(daten, jahr, optionen); });
  }
  function laufIntern(daten, jahr, optionen) {
    optionen = optionen || {};
    var heute = optionen.heute || (jahr + '-01-01');
    var statusListe = optionen.status || ['offen'];
    var opt = { konfig: optionen.konfig || null };
    var ix = Beitrag.index(daten);
    var vorlage = optionen.zweck || 'Mitgliedsbeitrag {jahr} TSV Ergoldsbach e.V. Mitgl.-Nr. {nummern}';
    var posten = [], ausgeschlossen = [], summe = 0;

    (daten.Sollstellung || []).filter(function (s) {
      return s.jahr === jahr && statusListe.indexOf(s.status) >= 0;
    }).sort(function (a, b) { return a.beitragskonto_id - b.beitragskonto_id; }).forEach(function (s) {
      var k = ix.konto[s.beitragskonto_id];
      var name = k ? k.kontoinhaber_name : '?';
      function aus(grund, art) {
        ausgeschlossen.push({ sollstellung_id: s.sollstellung_id, konto_id: s.beitragskonto_id, name: name, grund: grund, art: art || 'fehler' });
      }
      if (!k) return aus('Beitragskonto fehlt');
      if (k.aktiv === false) return aus('Konto stillgelegt');
      if (k.zahlweg !== 'Lastschrift') return aus('Zahlweg ' + (k.zahlweg || 'unbekannt') + ' – kein Einzug', 'info');
      var b = Number(s.soll_betrag || 0);
      if (!(b > 0)) return aus('Betrag 0', 'info');
      var pr = Iban.pruefe(k.iban);
      if (!pr.ok) return aus(Iban.fehlertext(pr.fehler));
      if (!k.mandatsreferenz || !k.mandatsdatum) return aus('Mandat unvollständig (Referenz oder Datum fehlt)');
      if (k.mandatsdatum > heute) return aus('Mandatsdatum liegt in der Zukunft');
      var einzug = optionen.einzugsdatum || s.einzugsdatum || Beitrag.faelligkeit(daten, opt, jahr);
      // Verfall zum Einzugsdatum prüfen: ein Mandat, das bis zur Fälligkeit 36 Monate ungenutzt ist, deckt den Einzug nicht
      var ms = Beitrag.mandatStatus(k, daten, einzug > heute ? einzug : heute, opt);
      if (ms.verfallen) return aus('Mandat verfallen (zuletzt genutzt ' + ms.letzteNutzung + ')');
      var bic = Iban.pruefeBic(k.bic);
      var nummern = (ix.mitgliederJeKonto[k.beitragskonto_id] || []).filter(function (m) {
        return Beitrag.pflicht(m, daten, jahr, opt).pflichtig;
      }).map(function (m) { return m.mitgliedsnummer; }).filter(Boolean).join(' ');
      var p = {
        sollstellung_id: s.sollstellung_id,
        konto: k.beitragskonto_id,
        betrag: Beitrag.runde(b),
        sequenz: sequenz(k.beitragskonto_id, daten.Sollstellung, k, { ausser: s.sollstellung_id, immerRcur: optionen.immerRcur }),
        mandatsreferenz: k.mandatsreferenz,
        mandatsdatum: k.mandatsdatum,
        name: k.kontoinhaber_name,
        iban: pr.iban,
        bic: bic.ok ? bic.bic : '',
        adresse: Beitrag.zahleradresse(k, daten),
        verwendungszweck: bereinige(verwendungszweck(vorlage, { jahr: jahr, konto: k.beitragskonto_id, name: k.kontoinhaber_name, nummern: nummern }), 140),
        endToEndId: kennung('TSV-' + jahr + '-K' + k.beitragskonto_id + '-S' + s.sollstellung_id),
        einzugsdatum: einzug
      };
      posten.push(p);
      summe += p.betrag;
    });
    return { jahr: jahr, posten: posten, ausgeschlossen: ausgeschlossen, summe: Beitrag.runde(summe), anzahl: posten.length };
  }

  // ------------------------------------------------------------------ XML

  /** ISO-Ländercode der Adresse (Standard DE) oder null, wenn das Freitextfeld keinen zweistelligen Code enthält. */
  function landCode(a) {
    var l = String((a && a.land) || 'DE').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(l) ? l : null;
  }

  /** Vollständig für die strukturierte Adresse: Straße, PLZ, Ort und ein gültiger Ländercode (sonst lehnt das XSD ab). */
  function adresseVollstaendig(a) { return !!(a && a.strasse && a.plz && a.ort && landCode(a)); }

  function adresseXml(a, einr) {
    if (!adresseVollstaendig(a)) return '';
    var e = einr || '';
    return e + '<PstlAdr>' +
      '<StrtNm>' + escape(bereinige(a.strasse, 70)) + '</StrtNm>' +
      (a.hausnummer ? '<BldgNb>' + escape(bereinige(a.hausnummer, 16)) + '</BldgNb>' : '') +
      '<PstCd>' + escape(bereinige(a.plz, 16)) + '</PstCd>' +
      '<TwnNm>' + escape(bereinige(a.ort, 35)) + '</TwnNm>' +
      '<Ctry>' + landCode(a) + '</Ctry>' +
      '</PstlAdr>';
  }

  function agentXml(bic) {
    return '<FinInstnId>' + (bic ? '<BICFI>' + escape(bic) + '</BICFI>' : '<Othr><Id>NOTPROVIDED</Id></Othr>') + '</FinInstnId>';
  }

  /**
   * Prüft Gläubigerangaben und Lauf. Liefert eine Liste von Fehlertexten (leer = in Ordnung).
   * heute ('JJJJ-MM-TT', optional): Einzugsdaten davor sind unzulässig (die Bank lehnt die Datei ab).
   */
  function pruefeFuerDatei(lauf, glaeubiger, heute) {
    var f = [];
    if (!glaeubiger) return ['Gläubigerdaten fehlen.'];
    var gid = Iban.glaeubigerIdPruefen(glaeubiger.glaeubigerId);
    if (!gid.ok) f.push(gid.fehler === 'platzhalter' ? 'Die Gläubiger-ID ist noch der Platzhalter aus _Konfig (verein_glaeubiger_id).'
      : 'Die Gläubiger-ID ist ungültig (' + gid.fehler + ').');
    if (!bereinige(glaeubiger.name)) f.push('Name des Vereins (verein_name) fehlt.');
    var gi = Iban.pruefe(glaeubiger.iban);
    if (!gi.ok) f.push('IBAN des Vereinskontos: ' + Iban.fehlertext(gi.fehler));
    if (glaeubiger.bic && !Iban.pruefeBic(glaeubiger.bic).ok) f.push('BIC des Vereinskontos ist ungültig.');
    if (!lauf || !lauf.posten || !lauf.posten.length) f.push('Der Lauf enthält keine Posten.');
    (lauf && lauf.posten || []).forEach(function (p) {
      if (!kennung(p.mandatsreferenz)) f.push('Konto ' + p.konto + ': Mandatsreferenz enthält keine gültigen Zeichen.');
      if (!(p.betrag > 0) || p.betrag > 999999999.99) f.push('Konto ' + p.konto + ': ungültiger Betrag.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.einzugsdatum || ''))) f.push('Konto ' + p.konto + ': Einzugsdatum fehlt.');
    });
    var vergangen = heute ? (lauf && lauf.posten || []).filter(function (p) { return p.einzugsdatum && p.einzugsdatum < heute; }).length : 0;
    if (vergangen) f.push(vergangen + ' Lastschrift(en) mit Einzugsdatum in der Vergangenheit – bitte ein neues Einzugsdatum angeben.');
    return f;
  }

  /**
   * Erzeugt die pain.008.001.08-Datei.
   * glaeubiger: { name, iban, bic?, glaeubigerId, adresse?: { strasse, hausnummer, plz, ort, land } }
   * optionen:   { erstelltAm: 'JJJJ-MM-TTThh:mm:ss' (Standard: jetzt, UTC), msgId, batchBooking (Standard true),
   *               heute: 'JJJJ-MM-TT' (prüft, dass kein Einzugsdatum in der Vergangenheit liegt) }
   * Liefert { ok: true, xml, msgId, anzahl, summe, dateiname } oder { ok: false, fehler: [texte] }.
   */
  function xml(lauf, glaeubiger, optionen) {
    optionen = optionen || {};
    var fehler = pruefeFuerDatei(lauf, glaeubiger, optionen.heute);
    if (fehler.length) return { ok: false, fehler: fehler };

    var erstellt = optionen.erstelltAm || new Date().toISOString().slice(0, 19);
    var msgId = kennung(optionen.msgId || ('TSV-LS-' + erstellt.replace(/\D/g, '').slice(0, 14)));
    var gid = Iban.glaeubigerIdPruefen(glaeubiger.glaeubigerId).id;
    var gIban = Iban.normalisiere(glaeubiger.iban);
    var gBic = glaeubiger.bic ? Iban.pruefeBic(glaeubiger.bic).bic : '';
    var gName = bereinige(glaeubiger.name, 70);

    // Gruppen je Sequenz und Einzugsdatum (ein PmtInf je Gruppe)
    var gruppen = {}, reihenfolge = [];
    lauf.posten.forEach(function (p) {
      var schl = p.sequenz + '|' + p.einzugsdatum;
      if (!gruppen[schl]) { gruppen[schl] = []; reihenfolge.push(schl); }
      gruppen[schl].push(p);
    });
    reihenfolge.sort();

    var gesamt = 0, anzahl = 0;
    var pmtInf = reihenfolge.map(function (schl, i) {
      var liste = gruppen[schl];
      var seq = schl.split('|')[0], datum = schl.split('|')[1];
      var summe = liste.reduce(function (s, p) { return s + Math.round(p.betrag * 100); }, 0) / 100;
      gesamt += Math.round(summe * 100); anzahl += liste.length;
      var tx = liste.map(function (p) {
        return '      <DrctDbtTxInf>' +
          '<PmtId><EndToEndId>' + escape(kennung(p.endToEndId)) + '</EndToEndId></PmtId>' +
          '<InstdAmt Ccy="EUR">' + betrag(p.betrag) + '</InstdAmt>' +
          '<DrctDbtTx><MndtRltdInf><MndtId>' + escape(kennung(p.mandatsreferenz)) + '</MndtId>' +
          '<DtOfSgntr>' + escape(p.mandatsdatum) + '</DtOfSgntr></MndtRltdInf></DrctDbtTx>' +
          '<DbtrAgt>' + agentXml(p.bic) + '</DbtrAgt>' +
          '<Dbtr><Nm>' + escape(bereinige(p.name, 70)) + '</Nm>' + adresseXml(p.adresse) + '</Dbtr>' +
          '<DbtrAcct><Id><IBAN>' + escape(p.iban) + '</IBAN></Id></DbtrAcct>' +
          '<RmtInf><Ustrd>' + escape(bereinige(p.verwendungszweck, 140) || 'Mitgliedsbeitrag') + '</Ustrd></RmtInf>' +
          '</DrctDbtTxInf>';
      }).join('\n');
      return '    <PmtInf>\n' +
        '      <PmtInfId>' + escape(kennung(msgId + '-' + (i + 1) + '-' + seq)) + '</PmtInfId>\n' +
        '      <PmtMtd>DD</PmtMtd>\n' +
        '      <BtchBookg>' + (optionen.batchBooking === false ? 'false' : 'true') + '</BtchBookg>\n' +
        '      <NbOfTxs>' + liste.length + '</NbOfTxs>\n' +
        '      <CtrlSum>' + betrag(summe) + '</CtrlSum>\n' +
        '      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>' + seq + '</SeqTp></PmtTpInf>\n' +
        '      <ReqdColltnDt>' + escape(datum) + '</ReqdColltnDt>\n' +
        '      <Cdtr><Nm>' + escape(gName) + '</Nm>' + adresseXml(glaeubiger.adresse) + '</Cdtr>\n' +
        '      <CdtrAcct><Id><IBAN>' + escape(gIban) + '</IBAN></Id></CdtrAcct>\n' +
        '      <CdtrAgt>' + agentXml(gBic) + '</CdtrAgt>\n' +
        '      <ChrgBr>SLEV</ChrgBr>\n' +
        '      <CdtrSchmeId><Id><PrvtId><Othr><Id>' + escape(gid) + '</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>\n' +
        tx + '\n' +
        '    </PmtInf>';
    });

    var text = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Document xmlns="' + NAMESPACE + '" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
      '  <CstmrDrctDbtInitn>\n' +
      '    <GrpHdr>\n' +
      '      <MsgId>' + escape(msgId) + '</MsgId>\n' +
      '      <CreDtTm>' + escape(erstellt) + '</CreDtTm>\n' +
      '      <NbOfTxs>' + anzahl + '</NbOfTxs>\n' +
      '      <CtrlSum>' + betrag(gesamt / 100) + '</CtrlSum>\n' +
      '      <InitgPty><Nm>' + escape(gName) + '</Nm></InitgPty>\n' +
      '    </GrpHdr>\n' +
      pmtInf.join('\n') + '\n' +
      '  </CstmrDrctDbtInitn>\n' +
      '</Document>\n';
    return {
      ok: true, xml: text, msgId: msgId, anzahl: anzahl, summe: gesamt / 100,
      dateiname: 'SEPA-Lastschrift_' + lauf.jahr + '_' + erstellt.replace(/\D/g, '').slice(0, 12) + '.xml'
    };
  }

  /** Zeilen für eine Kontrollliste (CSV/Druck) zum Lauf – ohne volle IBAN. */
  function kontrollliste(lauf) {
    return lauf.posten.map(function (p) {
      return { konto: p.konto, name: p.name, iban: Iban.maskiere(p.iban), mandat: p.mandatsreferenz, sequenz: p.sequenz,
        einzug: p.einzugsdatum, betrag: p.betrag, zweck: p.verwendungszweck };
    });
  }

  return {
    NAMESPACE: NAMESPACE, bereinige: bereinige, kennung: kennung, sequenz: sequenz, lauf: lauf,
    pruefeFuerDatei: pruefeFuerDatei, xml: xml, kontrollliste: kontrollliste, adresseVollstaendig: adresseVollstaendig
  };
})();
