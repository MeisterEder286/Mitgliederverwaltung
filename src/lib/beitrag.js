/**
 * Beitrag – Beitragsberechnung je Beitragskonto, Klärliste, Tarifwechsel, Waisen bei Austritt (rein).
 *
 * Zweck:      Fachregeln aus Übergabe §4 und den Prüfregeln des Datenmodells:
 *               - Ein Mitglied hat drei unabhängige Bezüge: beitragsart_id (WAS), beitragskonto_id (WER zahlt),
 *                 beitragsgemeinschaft_id (gedeckelter Verbund, optional).
 *               - Berechnet wird JE KONTO: Σ festbetrag jeder distinkten Gemeinschaft auf dem Konto (einmal)
 *                 + Σ Beitragsart-Betrag jedes Mitglieds auf dem Konto ohne Festbetrag-Gemeinschaft.
 *                 Beispiel Wagner: Familie 180 € + erwachsener Sohn Felix 100 € = 280 €.
 *               - Guard statt Cascade: Tritt ein Kontoinhaber aus, werden Abhängige NICHT mit ausgetragen,
 *                 sondern als „Waisen“ gemeldet und müssen neu zugeordnet werden.
 * Datenquelle: `daten` = Objekt mit Tab-Listen wie aus DB.lese bzw. der Snapshot-Basis:
 *             { Mitglied, Mitgliedschaftszeitraum, Beitragsart, Beitragsgemeinschaft, Beitragskonto, Sollstellung,
 *               _Konfig (optional) }. Konfiguration alternativ über optionen.konfig { schluessel: wert }.
 * Wer darf was: – (reine Rechenfunktionen; Rechte prüft das Servermodul).
 * Besonderheiten:
 *   - Wer zählt im Beitragsjahr [A]: Mitgliedschaftszeitraum überschneidet das Kalenderjahr, kein Sterbedatum vor
 *     der Fälligkeit (sepa_faelligkeit, z. B. 15.02.), nicht `nur_funktionstraeger`, nicht anonymisiert.
 *     _Konfig.beitrag_anteilig = 'nein' (Standard): voller Jahresbeitrag. 'halbjahr': halber Beitrag bei Eintritt
 *     ab 01.07. bzw. Austritt bis 30.06. 'monat' (früher 'ja'): monatsgenau anteilig.
 *   - Ehrenmitglieder zahlen normal (beim TSV geklärt: keine Befreiung).
 *   - Beitragsart: Gibt es mehrere Zeilen gleicher Bezeichnung (Preisänderung mit gueltig_ab), gilt die zum
 *     Stichtag gültige aktive Zeile – so bleibt die Historie stimmig, ohne Mitglieder umzuhängen.
 *   - Beitragsänderung (beitragsaenderung): bleibt EINE Zeile je Tarif bzw. Gemeinschaft. Der neue Betrag steht in
 *     betrag/festbetrag, der alte in betrag_vorher/festbetrag_vorher; er gilt vor gueltig_ab/festbetrag_ab. So
 *     rechnen frühere Jahre (Nachlauf, Rechnungen) weiter mit dem alten Betrag, ohne doppelte Tarife in Auswahllisten.
 *   - Kein Wert wird gespeichert: Der errechnete Betrag wird erst in der Sollstellung als Schnappschuss abgelegt.
 */
var Beitrag = (function () {

  var STANDARD = {
    sepa_faelligkeit: '15.02.', beitrag_anteilig: 'nein', mandat_verfall_monate: '36',
    tarifwechsel_stichtag: '01.01.', tarifwechsel_automatisch: 'ja'
  };

  // ------------------------------------------------------------------ Hilfen

  /** Konfigurationswert aus optionen.konfig, daten._Konfig oder Standard. */
  function konfig(daten, optionen, schluessel) {
    var k = optionen && optionen.konfig;
    if (k && k[schluessel] !== undefined && k[schluessel] !== null && k[schluessel] !== '') return String(k[schluessel]);
    var zeilen = (daten && daten._Konfig) || [];
    for (var i = 0; i < zeilen.length; i++) {
      if (zeilen[i].schluessel === schluessel && zeilen[i].wert !== null && zeilen[i].wert !== '') return String(zeilen[i].wert);
    }
    return STANDARD[schluessel] !== undefined ? STANDARD[schluessel] : null;
  }

  /** 'TT.MM.' + Jahr → 'JJJJ-MM-TT'. */
  function tagImJahr(ttmm, jahr) {
    var m = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(String(ttmm || '').trim());
    if (!m) return jahr + '-01-01';
    return jahr + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }

  function faelligkeit(daten, optionen, jahr) {
    return tagImJahr(konfig(daten, optionen, 'sepa_faelligkeit'), jahr);
  }

  function nachId(liste, feld) {
    var m = {};
    (liste || []).forEach(function (z) { m[z[feld]] = z; });
    return m;
  }
  function gruppiere(liste, feld) {
    var m = {};
    (liste || []).forEach(function (z) { (m[z[feld]] = m[z[feld]] || []).push(z); });
    return m;
  }

  // Nachschlage-Strukturen gelten nur für die Dauer EINES äußeren Aufrufs (mitIndex). Ein dauerhafter Cache
  // würde Änderungen an `daten` (z. B. nach einem Schreibvorgang) übersehen.
  var aktuell = null;

  /** Führt fn mit einem einmal gebauten Index über `daten` aus; verschachtelte Aufrufe nutzen ihn mit. */
  function mitIndex(daten, fn) {
    if (aktuell && aktuell.daten === daten) return fn();
    var vorher = aktuell;
    aktuell = { daten: daten, ix: baueIndex(daten) };
    try { return fn(); } finally { aktuell = vorher; }
  }

  /** Index über `daten`: innerhalb mitIndex der gemeinsame, sonst ein frisch gebauter. */
  function index(daten) {
    return aktuell && aktuell.daten === daten ? aktuell.ix : baueIndex(daten);
  }

  function baueIndex(daten) {
    var ix = {
      mitglied: nachId(daten.Mitglied, 'mitglied_id'),
      zeitraeume: gruppiere(daten.Mitgliedschaftszeitraum, 'mitglied_id'),
      art: nachId(daten.Beitragsart, 'beitragsart_id'),
      gemeinschaft: nachId(daten.Beitragsgemeinschaft, 'beitragsgemeinschaft_id'),
      konto: nachId(daten.Beitragskonto, 'beitragskonto_id'),
      mitgliederJeKonto: gruppiere(daten.Mitglied, 'beitragskonto_id'),
      sollJeKonto: gruppiere(daten.Sollstellung, 'beitragskonto_id')
    };
    Object.keys(ix.zeitraeume).forEach(function (k) {
      ix.zeitraeume[k].sort(function (a, b) { return String(a.eintrittsdatum).localeCompare(String(b.eintrittsdatum)); });
    });
    return ix;
  }

  function name(m) { return m ? [m.nachname, m.vorname].filter(Boolean).join(', ') : '?'; }
  function euro(n) { return (Math.round(n * 100) / 100).toFixed(2).replace('.', ','); }
  function runde(n) { return Math.round(n * 100) / 100; }

  // ------------------------------------------------------------------ Wer zahlt

  /**
   * Beitragspflicht eines Mitglieds im Jahr. Liefert { pflichtig, anteil (0..1), grund }.
   */
  function pflicht(m, daten, jahr, optionen) {
    if (!m) return { pflichtig: false, anteil: 0, grund: 'unbekannt' };
    if (m.nur_funktionstraeger === true) return { pflichtig: false, anteil: 0, grund: 'nur Funktionsträger' };
    if (m.anonymisiert === true) return { pflichtig: false, anteil: 0, grund: 'anonymisiert' };
    var faellig = faelligkeit(daten, optionen, jahr);
    if (m.sterbedatum && m.sterbedatum < faellig) return { pflichtig: false, anteil: 0, grund: 'verstorben vor Fälligkeit' };
    var jahrAnfang = jahr + '-01-01', jahrEnde = jahr + '-12-31';
    var zeitraeume = index(daten).zeitraeume[m.mitglied_id] || [];
    var monate = 0, ueberschneidung = false, frueh = null, spaet = null;
    zeitraeume.forEach(function (z) {
      var von = z.eintrittsdatum, bis = Mitgliedschaft.endeVon(z);
      if (!von || von > jahrEnde || (bis && bis < jahrAnfang)) return;
      ueberschneidung = true;
      var a = von > jahrAnfang ? von : jahrAnfang;
      var e = bis && bis < jahrEnde ? bis : jahrEnde;
      if (frueh === null || a < frueh) frueh = a;
      if (spaet === null || e > spaet) spaet = e;
      // angefangene Monate zählen voll
      monate += (Number(e.slice(5, 7)) - Number(a.slice(5, 7))) + 1;
    });
    if (!ueberschneidung) return { pflichtig: false, anteil: 0, grund: 'keine Mitgliedschaft im Jahr' };
    return { pflichtig: true, anteil: anteil(konfig(daten, optionen, 'beitrag_anteilig'), monate, frueh, spaet, jahr), grund: null };
  }

  /**
   * Beitragsanteil im Jahr je _Konfig.beitrag_anteilig:
   *   'nein' (Standard)   voller Beitrag
   *   'halbjahr'          halber Beitrag, wenn die Mitgliedschaft im Jahr erst ab 01.07. beginnt ODER schon bis 30.06.
   *                       endet (wie früher „Laufender Einzug Halb“ in Access); beides zusammen bleibt halb
   *   'monat' bzw. 'ja'   monatsgenau, angefangene Monate zählen voll
   */
  function anteil(modus, monate, frueh, spaet, jahr) {
    if (modus === 'halbjahr') {
      return (frueh >= jahr + '-07-01' || spaet <= jahr + '-06-30') ? 0.5 : 1;
    }
    if (modus === 'monat' || modus === 'ja') return Math.min(1, monate / 12);
    return 1;
  }

  function leer(x) { return x === null || x === undefined || x === ''; }

  /** Betrag einer Beitragsart zum Stichtag: vor gueltig_ab gilt betrag_vorher (falls gesetzt). */
  function betragAm(art, stichtag) {
    if (!art) return 0;
    if (art.gueltig_ab && stichtag < art.gueltig_ab && !leer(art.betrag_vorher)) return Number(art.betrag_vorher);
    return Number(art.betrag || 0);
  }

  /** Festbetrag einer Gemeinschaft zum Stichtag (null = keine Pauschale): vor festbetrag_ab gilt festbetrag_vorher. */
  function festbetragAm(g, stichtag) {
    if (!g) return null;
    var wert = g.festbetrag_ab && stichtag < g.festbetrag_ab ? g.festbetrag_vorher : g.festbetrag;
    return leer(wert) ? null : Number(wert);
  }

  /** Beitragsart am Tag wählbar: aktiv und schon gültig – oder mit betrag_vorher (gilt dann mit dem alten Betrag). */
  function artVerfuegbar(a, tag) {
    return a.aktiv !== false && (!a.gueltig_ab || a.gueltig_ab <= tag || !leer(a.betrag_vorher));
  }

  /** Die zum Stichtag gültige Beitragsart zur referenzierten Art (gleiche Bezeichnung, jüngstes gueltig_ab). */
  function artFuerJahr(artId, daten, stichtag) {
    var ix = index(daten);
    var ref = ix.art[artId];
    if (!ref) return null;
    var kandidaten = (daten.Beitragsart || []).filter(function (a) {
      return a.bezeichnung === ref.bezeichnung && artVerfuegbar(a, stichtag);
    }).sort(function (a, b) { return String(b.gueltig_ab || '').localeCompare(String(a.gueltig_ab || '')); });
    return kandidaten[0] || ref;
  }

  // ------------------------------------------------------------------ Berechnung je Konto

  /**
   * Soll-Betrag eines Kontos im Jahr.
   * Liefert { betrag, positionen: [{ art, bezeichnung, mitglied_ids, betrag }], hinweise: [text] }.
   */
  function sollJeKonto(kontoId, daten, jahr, optionen) {
    var ix = index(daten);
    var stichtag = faelligkeit(daten, optionen, jahr);
    var positionen = [], hinweise = [];
    var gemeinschaften = {};
    (ix.mitgliederJeKonto[kontoId] || []).forEach(function (m) {
      var p = pflicht(m, daten, jahr, optionen);
      if (!p.pflichtig) return;
      var g = m.beitragsgemeinschaft_id ? ix.gemeinschaft[m.beitragsgemeinschaft_id] : null;
      var fest = festbetragAm(g, stichtag);
      if (g && fest !== null && g.aktiv !== false) {
        var eintrag = gemeinschaften[g.beitragsgemeinschaft_id] = gemeinschaften[g.beitragsgemeinschaft_id] ||
          { art: 'gemeinschaft', bezeichnung: g.bezeichnung, mitglied_ids: [], betrag: 0, anteil: 0 };
        eintrag.mitglied_ids.push(m.mitglied_id);
        eintrag.anteil = Math.max(eintrag.anteil, p.anteil);
        eintrag.betrag = runde(fest * eintrag.anteil);
        return;
      }
      if (!m.beitragsart_id) {
        hinweise.push(name(m) + ': keine Beitragsart und keine Gemeinschaft mit Festbetrag');
        return;
      }
      var art = artFuerJahr(m.beitragsart_id, daten, stichtag);
      if (!art) { hinweise.push(name(m) + ': Beitragsart ' + m.beitragsart_id + ' unbekannt'); return; }
      positionen.push({
        art: 'einzel', bezeichnung: name(m) + ' (' + art.bezeichnung + ')', mitglied_ids: [m.mitglied_id],
        betrag: runde(betragAm(art, stichtag) * p.anteil)
      });
    });
    var gem = Object.keys(gemeinschaften).map(function (k) {
      var e = gemeinschaften[k]; delete e.anteil; return e;
    });
    positionen = gem.concat(positionen);
    var betrag = runde(positionen.reduce(function (s, p) { return s + p.betrag; }, 0));
    return { betrag: betrag, positionen: positionen, hinweise: hinweise };
  }

  /** Kurzer Text für Sollstellung.bemerkung: „Familie Wagner 180,00 + Wagner, Felix (Erwachsene) 100,00“. */
  function zusammensetzung(soll) {
    return soll.positionen.map(function (p) { return p.bezeichnung + ' ' + euro(p.betrag); }).join(' + ');
  }

  // ------------------------------------------------------------------ Mandat

  /** Datum der letzten Nutzung des Mandats (jüngster Einzug, nicht storniert) bzw. Mandatsdatum. */
  function letzteMandatsnutzung(konto, daten) {
    var soll = index(daten).sollJeKonto[konto.beitragskonto_id] || [];
    var letzte = null;
    soll.forEach(function (s) {
      if (!s.sepa_sequenz || s.status === 'storniert' || !s.einzugsdatum) return;
      if (konto.mandatsdatum && s.einzugsdatum < konto.mandatsdatum) return;   // gehört zu einem früheren Mandat
      if (!letzte || s.einzugsdatum > letzte) letzte = s.einzugsdatum;
    });
    return letzte || konto.mandatsdatum || null;
  }

  /** Verfällt das Mandat (36 Monate ungenutzt)? Liefert { verfallen, letzteNutzung, verfaelltAm }. */
  function mandatStatus(konto, daten, heute, optionen) {
    var letzte = letzteMandatsnutzung(konto, daten);
    if (!letzte) return { verfallen: false, letzteNutzung: null, verfaelltAm: null };
    var monate = Number(konfig(daten, optionen, 'mandat_verfall_monate')) || 36;
    var am = Mitgliedschaft.plusMonate(letzte, monate);
    return { verfallen: am < heute, letzteNutzung: letzte, verfaelltAm: am };
  }

  // ------------------------------------------------------------------ Adresse

  /**
   * Postanschrift des Zahlers: abweichende Rechnungsanschrift am Konto, sonst Anschrift des Inhaber-Mitglieds.
   * Liefert { strasse, hausnummer, plz, ort, land, quelle } oder null.
   */
  function zahleradresse(konto, daten) {
    if (konto.abw_strasse || konto.abw_plz || konto.abw_ort) {
      return { strasse: konto.abw_strasse || null, hausnummer: konto.abw_hausnummer || null, plz: konto.abw_plz || null,
        ort: konto.abw_ort || null, land: konto.abw_land || 'DE', quelle: 'konto' };
    }
    var m = konto.kontoinhaber_mitglied_id ? index(daten).mitglied[konto.kontoinhaber_mitglied_id] : null;
    if (!m) return null;
    return { strasse: m.strasse || null, hausnummer: m.hausnummer || null, plz: m.plz || null, ort: m.ort || null,
      land: m.land || 'DE', quelle: 'mitglied' };
  }

  // ------------------------------------------------------------------ Tarifwechsel

  function altersbereichPasst(art, alter) {
    if (alter === null) return true;
    var von = art.alter_von, bis = art.alter_bis;
    if ((von === null || von === undefined || von === '') && (bis === null || bis === undefined || bis === '')) return true;
    if (von !== null && von !== undefined && von !== '' && alter < Number(von)) return false;
    if (bis !== null && bis !== undefined && bis !== '' && alter > Number(bis)) return false;
    return true;
  }

  /**
   * Vorschläge für den automatischen Tarifwechsel zum Stichtag (_Konfig.tarifwechsel_stichtag, Standard 01.01.)
   * des Jahres: [{ mitglied_id, name, von, nach, alter, grund }]. nach = null → keine passende Beitragsart.
   * Nur Beitragsarten mit Altersgrenze werden gewechselt (Fördermitglied o. ä. bleibt).
   */
  function tarifwechsel(daten, jahr, optionen) {
    var stichtag = tagImJahr(konfig(daten, optionen, 'tarifwechsel_stichtag'), jahr);
    var ix = index(daten);
    var aktive = (daten.Beitragsart || []).filter(function (a) {
      return artVerfuegbar(a, stichtag) && !a.als_gemeinschaft &&
        ((a.alter_von !== null && a.alter_von !== undefined && a.alter_von !== '') || (a.alter_bis !== null && a.alter_bis !== undefined && a.alter_bis !== ''));
    });
    var vorschlaege = [];
    (daten.Mitglied || []).forEach(function (m) {
      if (!m.beitragsart_id || !m.geburtsdatum) return;
      var zr = ix.zeitraeume[m.mitglied_id] || [];
      if (Mitgliedschaft.status(m, zr, stichtag) !== 'aktiv') return;
      var art = ix.art[m.beitragsart_id];
      if (!art) return;
      var alter = Mitgliedschaft.alter(m.geburtsdatum, stichtag);
      if (altersbereichPasst(art, alter)) return;
      var hatGrenze = (art.alter_von !== null && art.alter_von !== undefined && art.alter_von !== '') ||
        (art.alter_bis !== null && art.alter_bis !== undefined && art.alter_bis !== '');
      if (!hatGrenze) return;
      var ziel = aktive.filter(function (a) { return altersbereichPasst(a, alter); })[0] || null;
      vorschlaege.push({
        mitglied_id: m.mitglied_id, name: name(m), alter: alter,
        von: art.beitragsart_id, von_bezeichnung: art.bezeichnung,
        nach: ziel ? ziel.beitragsart_id : null, nach_bezeichnung: ziel ? ziel.bezeichnung : null,
        grund: ziel ? 'Alter ' + alter + ' am ' + stichtag.split('-').reverse().join('.') + ' passt nicht zu „' + art.bezeichnung + '“'
          : 'keine passende Beitragsart für Alter ' + alter
      });
    });
    return vorschlaege;
  }

  // ------------------------------------------------------------------ Beitragsänderung

  /**
   * Beitragsänderung ab 01.01. eines Jahres (z. B. nach JHV-Beschluss): Vorschau und zu schreibende Felder.
   * eingabe: { arten: [{ beitragsart_id, betrag }], festbetraege: [{ alt, neu }] } – Pauschalen werden über ihren
   *          bisherigen Betrag zugeordnet (alle aktiven Gemeinschaften mit 180 € → 200 €).
   * Liefert { jahr, ab, fehler: [Text], arten: [{ beitragsart_id, bezeichnung, alt, neu }],
   *           gemeinschaften: [{ beitragsgemeinschaft_id, bezeichnung, alt, neu }],
   *           konten: [{ beitragskonto_id, inhaber, zahlweg, alt, neu, differenz }] (nur mit Differenz),
   *           summe_alt, summe_neu, aenderungen: { Beitragsart: { id: felder }, Beitragsgemeinschaft: { id: felder } } }.
   * Gesperrt, sobald für das Jahr Sollstellungen bestehen (deren Beträge sind Schnappschüsse und blieben sonst alt).
   */
  function beitragsaenderung(daten, jahr, eingabe, optionen) {
    eingabe = eingabe || {};
    var ab = jahr + '-01-01', vortag = (jahr - 1) + '-12-31';
    var fehler = [];
    var r = { jahr: jahr, ab: ab, fehler: fehler, arten: [], gemeinschaften: [], konten: [], summe_alt: 0, summe_neu: 0,
      aenderungen: { Beitragsart: {}, Beitragsgemeinschaft: {} } };
    function betragOk(x) { return !leer(x) && isFinite(Number(x)) && Number(x) >= 0 && Number(x) < 100000; }

    var vorhanden = (daten.Sollstellung || []).filter(function (s) { return s.jahr === jahr; }).length;
    if (vorhanden) fehler.push('Für ' + jahr + ' gibt es bereits ' + vorhanden + ' Sollstellung(en). Eine Beitragsänderung ist nur für ein Jahr ohne Sollstellungen möglich.');

    var arten = nachId(daten.Beitragsart, 'beitragsart_id');
    (eingabe.arten || []).forEach(function (e) {
      var a = arten[Number(e.beitragsart_id)];
      if (!a || a.aktiv === false) { fehler.push('Beitragsart ' + e.beitragsart_id + ' gibt es nicht (mehr).'); return; }
      if (!betragOk(e.betrag)) { fehler.push(a.bezeichnung + ': bitte einen Betrag ≥ 0 angeben.'); return; }
      var alt = betragAm(a, ab), neu = runde(Number(e.betrag));
      if (neu === alt) return;
      r.arten.push({ beitragsart_id: a.beitragsart_id, bezeichnung: a.bezeichnung, alt: alt, neu: neu });
      r.aenderungen.Beitragsart[a.beitragsart_id] = { betrag: neu, betrag_vorher: betragAm(a, vortag), gueltig_ab: ab };
    });
    var zuordnung = {};
    (eingabe.festbetraege || []).forEach(function (e) {
      if (!betragOk(e.alt) || !betragOk(e.neu)) { fehler.push('Pauschale: bitte bisherigen und neuen Betrag ≥ 0 angeben.'); return; }
      if (runde(Number(e.alt)) !== runde(Number(e.neu))) zuordnung[runde(Number(e.alt))] = runde(Number(e.neu));
    });
    // Neuer Gemeinschaftstarif (Familie/Ehepaar): bestehende Gemeinschaften mit dem bisherigen Tarifbetrag ziehen mit,
    // sofern für diesen Betrag nichts anderes eingetragen ist
    r.arten.forEach(function (x) {
      if (arten[x.beitragsart_id].als_gemeinschaft && zuordnung[x.alt] === undefined) zuordnung[x.alt] = x.neu;
    });
    (daten.Beitragsgemeinschaft || []).forEach(function (g) {
      var alt = festbetragAm(g, ab);
      if (g.aktiv === false || alt === null || zuordnung[alt] === undefined) return;
      r.gemeinschaften.push({ beitragsgemeinschaft_id: g.beitragsgemeinschaft_id, bezeichnung: g.bezeichnung, alt: alt, neu: zuordnung[alt] });
      r.aenderungen.Beitragsgemeinschaft[g.beitragsgemeinschaft_id] = { festbetrag: zuordnung[alt], festbetrag_vorher: festbetragAm(g, vortag), festbetrag_ab: ab };
    });

    // Wirkung je Konto: Soll des Jahres mit bisherigen gegen neue Beträge
    function mit(tab, feld) {
      var aend = r.aenderungen[tab];
      return (daten[tab] || []).map(function (z) { return aend[z[feld]] ? Object.assign({}, z, aend[z[feld]]) : z; });
    }
    var neuDaten = Object.assign({}, daten, { Beitragsart: mit('Beitragsart', 'beitragsart_id'), Beitragsgemeinschaft: mit('Beitragsgemeinschaft', 'beitragsgemeinschaft_id') });
    var altSoll = {};
    mitIndex(daten, function () {
      (daten.Beitragskonto || []).forEach(function (k) { if (k.aktiv !== false) altSoll[k.beitragskonto_id] = sollJeKonto(k.beitragskonto_id, daten, jahr, optionen).betrag; });
    });
    mitIndex(neuDaten, function () {
      (daten.Beitragskonto || []).forEach(function (k) {
        if (k.aktiv === false) return;
        var alt = altSoll[k.beitragskonto_id], neu = sollJeKonto(k.beitragskonto_id, neuDaten, jahr, optionen).betrag;
        r.summe_alt += alt; r.summe_neu += neu;
        if (neu !== alt) r.konten.push({ beitragskonto_id: k.beitragskonto_id, inhaber: k.kontoinhaber_name, zahlweg: k.zahlweg, alt: alt, neu: neu, differenz: runde(neu - alt) });
      });
    });
    r.summe_alt = runde(r.summe_alt); r.summe_neu = runde(r.summe_neu);
    return r;
  }

  // ------------------------------------------------------------------ Klärliste

  /**
   * Prüft alle Konten und beitragspflichtigen Mitglieder. Liefert eine Liste
   * [{ art, schwere: 'fehler'|'warnung', konto_id, mitglied_id, text }].
   * art: waise · inhaber_ausgetreten · gemeinschaft_konto · ohne_beitrag · lastschrift_unvollstaendig ·
   *      iban_ungueltig · mandat_verfallen · mandat_doppelt · adresse_unvollstaendig · hausnummer_fehlt · tarif_alter
   */
  function klaerliste(daten, jahr, heute, optionen) {
    var ix = index(daten);
    var liste = [];
    function melde(art, schwere, kontoId, mitgliedId, text) {
      liste.push({ art: art, schwere: schwere, konto_id: kontoId || null, mitglied_id: mitgliedId || null, text: text });
    }
    var genutzteKonten = {};

    // Mitglieder
    (daten.Mitglied || []).forEach(function (m) {
      var p = pflicht(m, daten, jahr, optionen);
      var zr = ix.zeitraeume[m.mitglied_id] || [];
      if (!p.pflichtig || Mitgliedschaft.status(m, zr, heute) !== 'aktiv') return;
      var k = m.beitragskonto_id ? ix.konto[m.beitragskonto_id] : null;
      if (!m.beitragskonto_id) melde('waise', 'fehler', null, m.mitglied_id, name(m) + ': kein Beitragskonto zugeordnet');
      else if (!k) melde('waise', 'fehler', m.beitragskonto_id, m.mitglied_id, name(m) + ': Beitragskonto ' + m.beitragskonto_id + ' existiert nicht');
      else if (k.aktiv === false) melde('waise', 'fehler', k.beitragskonto_id, m.mitglied_id, name(m) + ': Beitragskonto ' + k.beitragskonto_id + ' ist stillgelegt');
      else {
        genutzteKonten[k.beitragskonto_id] = true;
        var inhaber = k.kontoinhaber_mitglied_id ? ix.mitglied[k.kontoinhaber_mitglied_id] : null;
        if (inhaber && inhaber.mitglied_id !== m.mitglied_id) {
          var st = Mitgliedschaft.status(inhaber, ix.zeitraeume[inhaber.mitglied_id] || [], heute);
          if (st === 'ausgetreten' || st === 'verstorben') {
            melde('inhaber_ausgetreten', st === 'verstorben' ? 'fehler' : 'warnung', k.beitragskonto_id, m.mitglied_id,
              name(m) + ': Kontoinhaber ' + name(inhaber) + ' ist ' + st + ' – Zahler und Mandat klären');
          }
        }
      }
      var g = m.beitragsgemeinschaft_id ? ix.gemeinschaft[m.beitragsgemeinschaft_id] : null;
      var mitFestbetrag = g && g.festbetrag !== null && g.festbetrag !== undefined && g.festbetrag !== '';
      if (!m.beitragsart_id && !mitFestbetrag) {
        melde('ohne_beitrag', 'fehler', m.beitragskonto_id, m.mitglied_id, name(m) + ': weder Beitragsart noch Gemeinschaft mit Festbetrag');
      }
    });

    // Gemeinschaften: alle aktiven Mitglieder auf demselben Konto
    var jeGemeinschaft = {};
    (daten.Mitglied || []).forEach(function (m) {
      if (!m.beitragsgemeinschaft_id) return;
      if (Mitgliedschaft.status(m, ix.zeitraeume[m.mitglied_id] || [], heute) !== 'aktiv') return;
      (jeGemeinschaft[m.beitragsgemeinschaft_id] = jeGemeinschaft[m.beitragsgemeinschaft_id] || []).push(m);
    });
    Object.keys(jeGemeinschaft).forEach(function (gid) {
      var konten = {};
      jeGemeinschaft[gid].forEach(function (m) { konten[m.beitragskonto_id || 'ohne'] = true; });
      if (Object.keys(konten).length > 1) {
        var g = ix.gemeinschaft[gid];
        melde('gemeinschaft_konto', 'fehler', null, null, 'Gemeinschaft „' + (g ? g.bezeichnung : gid) +
          '“: Mitglieder hängen an verschiedenen Konten (' + Object.keys(konten).join(', ') + ')');
      }
    });

    // Konten
    var referenzen = {};
    (daten.Beitragskonto || []).forEach(function (k) {
      if (k.aktiv === false || !genutzteKonten[k.beitragskonto_id]) return;
      var id = k.beitragskonto_id;
      if (k.zahlweg !== 'Lastschrift') return;
      var hatIban = !!(k.iban || k.iban_maskiert);
      var fehlt = [];
      if (!hatIban) fehlt.push('IBAN');
      if (!k.mandatsreferenz) fehlt.push('Mandatsreferenz');
      if (!k.mandatsdatum) fehlt.push('Mandatsdatum');
      if (fehlt.length) melde('lastschrift_unvollstaendig', 'fehler', id, k.kontoinhaber_mitglied_id, 'Konto ' + id + ' (' + k.kontoinhaber_name + '): Lastschrift ohne ' + fehlt.join(', '));
      if (k.iban) {
        var pr = Iban.pruefe(k.iban);
        if (!pr.ok) melde('iban_ungueltig', 'fehler', id, k.kontoinhaber_mitglied_id, 'Konto ' + id + ' (' + k.kontoinhaber_name + '): ' + Iban.fehlertext(pr.fehler));
      } else if (k.iban_ok === false) {
        melde('iban_ungueltig', 'fehler', id, k.kontoinhaber_mitglied_id, 'Konto ' + id + ' (' + k.kontoinhaber_name + '): IBAN ungültig');
      }
      if (k.mandatsreferenz) {
        if (referenzen[k.mandatsreferenz]) melde('mandat_doppelt', 'fehler', id, null, 'Mandatsreferenz ' + k.mandatsreferenz + ' auch an Konto ' + referenzen[k.mandatsreferenz]);
        referenzen[k.mandatsreferenz] = id;
      }
      var ms = mandatStatus(k, daten, heute, optionen);
      if (ms.verfallen) melde('mandat_verfallen', 'fehler', id, k.kontoinhaber_mitglied_id, 'Konto ' + id + ' (' + k.kontoinhaber_name +
        '): Mandat seit ' + ms.letzteNutzung.split('-').reverse().join('.') + ' ungenutzt – verfallen, neues Mandat nötig');
      var adr = zahleradresse(k, daten);
      if (!adr || !adr.strasse || !adr.plz || !adr.ort) {
        melde('adresse_unvollstaendig', 'warnung', id, k.kontoinhaber_mitglied_id, 'Konto ' + id + ' (' + k.kontoinhaber_name + '): Anschrift des Zahlers unvollständig (für strukturierte Adressen)');
      } else if (!adr.hausnummer) {
        melde('hausnummer_fehlt', 'warnung', id, k.kontoinhaber_mitglied_id, 'Konto ' + id + ' (' + k.kontoinhaber_name + '): Hausnummer fehlt in der Anschrift');
      }
    });

    tarifwechsel(daten, jahr, optionen).forEach(function (v) {
      melde('tarif_alter', 'warnung', null, v.mitglied_id, v.name + ': ' + v.grund + (v.nach_bezeichnung ? ' → „' + v.nach_bezeichnung + '“' : ''));
    });
    return liste;
  }

  /** Prüfung eines einzelnen Kontos (Ausschnitt der Klärliste). */
  function pruefeKonto(kontoId, daten, jahr, heute, optionen) {
    return klaerliste(daten, jahr, heute, optionen).filter(function (e) { return e.konto_id === kontoId; });
  }

  // ------------------------------------------------------------------ Waisen bei Austritt

  /**
   * Was passiert mit Konten, deren Inhaber austritt? (Übergabe §4 „Guard statt Cascade“, MV-Mockup-Dialog)
   * Liefert { konten: [{ konto_id, kontoinhaber_name, abhaengige: [{ mitglied_id, name, volljaehrig }] }],
   *           optionen: [{ code, text, mitglied_id? }], betroffen: Anzahl Abhängiger }.
   */
  function waisenBeiAustritt(mitgliedId, daten, austrittDatum) {
    var ix = index(daten);
    var konten = (daten.Beitragskonto || []).filter(function (k) {
      return k.kontoinhaber_mitglied_id === mitgliedId && k.aktiv !== false;
    }).map(function (k) {
      var abh = (ix.mitgliederJeKonto[k.beitragskonto_id] || []).filter(function (m) {
        if (m.mitglied_id === mitgliedId) return false;
        return Mitgliedschaft.status(m, ix.zeitraeume[m.mitglied_id] || [], austrittDatum) === 'aktiv' &&
          !(Mitgliedschaft.gekuendigt(ix.zeitraeume[m.mitglied_id] || [], austrittDatum) || {}).austritt;
      }).map(function (m) {
        var a = Mitgliedschaft.alter(m.geburtsdatum, austrittDatum);
        return { mitglied_id: m.mitglied_id, name: name(m), volljaehrig: a === null || a >= 18 };
      });
      return { konto_id: k.beitragskonto_id, kontoinhaber_name: k.kontoinhaber_name, abhaengige: abh };
    }).filter(function (k) { return k.abhaengige.length; });

    var betroffen = konten.reduce(function (n, k) { return n + k.abhaengige.length; }, 0);
    var opt = [];
    if (betroffen) {
      konten.forEach(function (k) {
        k.abhaengige.filter(function (a) { return a.volljaehrig; }).forEach(function (a) {
          opt.push({ code: 'uebernahme', konto_id: k.konto_id, mitglied_id: a.mitglied_id,
            text: a.name + ' übernimmt Konto und Mandat (neues Mandat nötig, Erstlastschrift beim nächsten Lauf)' });
        });
      });
      opt.push({ code: 'konto_bleibt', text: 'Konto bleibt, der Inhaber zahlt weiter für die übrigen (Mandat bleibt gültig)' });
      opt.push({ code: 'zahlweg_offen', text: 'Die Abhängigen bekommen den Merker „Zahlweg offen“ (Klärliste, fallen aus dem nächsten SEPA-Lauf)' });
      opt.push({ code: 'alle_austreten', text: 'Alle treten zum selben Datum aus' });
    }
    return { konten: konten, optionen: opt, betroffen: betroffen };
  }

  /** Öffentliche Fassung: jede Funktion baut ihren Index höchstens einmal. */
  function gebunden(fn, datenPos) {
    return function () {
      var args = arguments, self = this;
      return mitIndex(args[datenPos], function () { return fn.apply(self, args); });
    };
  }

  return {
    mitIndex: mitIndex,
    konfig: konfig, tagImJahr: tagImJahr, faelligkeit: faelligkeit, index: index, pflicht: pflicht,
    artFuerJahr: artFuerJahr, betragAm: betragAm, festbetragAm: festbetragAm, artVerfuegbar: artVerfuegbar,
    beitragsaenderung: beitragsaenderung, anteil: anteil, altersbereichPasst: altersbereichPasst, sollJeKonto: sollJeKonto, zusammensetzung: zusammensetzung,
    letzteMandatsnutzung: letzteMandatsnutzung, mandatStatus: mandatStatus, zahleradresse: zahleradresse,
    tarifwechsel: tarifwechsel, klaerliste: klaerliste, pruefeKonto: pruefeKonto, waisenBeiAustritt: waisenBeiAustritt,
    name: name, runde: runde, euro: euro
  };
})();
