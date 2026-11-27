/**
 * Familie – wer fällt aus dem Familienbeitrag heraus, wer bleibt wegen Schule/Studium/Ausbildung, was wäre der
 * Einzelbeitrag (rein, ohne Apps-Script-Dienste).
 *
 * Zweck:      Beitragsgemeinschaften mit Festbetrag (Familie, Ehepaar) decken Kinder nur bis zu einer Altersgrenze
 *             ab. Danach – oder nach dem (prognostizierten) Ende von Schule/Studium/Ausbildung – zahlt die Person
 *             einen Einzelbeitrag. Diese Datei rechnet aus, wen das wann trifft, schlägt die passende Beitragsart
 *             vor und plant die Umstellung. Ändern und Protokollieren macht das Servermodul (src/modul/Familie.js).
 * Datenquelle: `daten` wie in src/lib/beitrag.js (Tab-Listen Mitglied, Mitgliedschaftszeitraum, Beitragsgemeinschaft,
 *             Beitragskonto, Beitragsart, Sollstellung), `konfig` = _Konfig als { schluessel: wert }.
 * Wer darf was: – (Rechenfunktionen). Lesen mit konto_lesen, Umstellen mit mitglied_bearbeiten (Servermodul).
 * Besonderheiten:
 *   - Regeln: je Gemeinschaft aus ihrer Beitragsart „als Gemeinschaft“ (Familienbeitrag/Ehegattenbeitrag: Höchstzahl Erwachsene/
 *     Kinder, kinder_bis_alter, ausbildung_bis_alter, Betrag) – fehlt sie, gelten die _Konfig-Werte.
 *     abweichungen() meldet alles, was davon abweicht (auch Einzel-Beitragsarten, deren Altersgrenze nicht passt).
 *   - _Konfig: familie_kinder_bis_alter (Standard 17), familie_ausbildung_bis_alter (25),
 *     familie_umstellung_stichtag (01.01. – Alter wird zu diesem Tag des Jahres bestimmt, wie beim Tarifwechsel),
 *     ausbildungsnachweis_vorlauf_monate (2).
 *   - [A] Rolle in der Familie (Heuristik, die Daten kennen keine Eltern-Kind-Beziehung): „Erwachsene“ sind der
 *     Kontoinhaber und alle, die höchstens 15 Jahre jünger sind als das älteste Mitglied der Gemeinschaft;
 *     „Kind“ ist, wer jünger ist ODER eine gesetzliche Vertretung eingetragen hat. Nur Kinder fallen heraus.
 *   - [A] Ein Ausbildungsnachweis gilt 12 Monate; älter oder fehlend → „Nachweis anfordern“.
 *   - Ergebnis je Person: bleibt · faellt_raus (datum, grund) · verlaengert_bis (datum) ·
 *     nachweis_anfordern (verlängert, aber Nachweis fällig).
 */
var Familie = (function () {

  var NACHWEIS_GUELTIG_MONATE = 12;
  var GENERATIONEN_ABSTAND = 15;

  function zahl(v, standard) { var n = Number(v); return v === null || v === undefined || v === '' || !isFinite(n) ? standard : n; }

  function einstellungen(konfig) {
    konfig = konfig || {};
    return {
      kinderBis: zahl(konfig.familie_kinder_bis_alter, 17),
      ausbildungBis: zahl(konfig.familie_ausbildung_bis_alter, 25),
      stichtagTtmm: String(konfig.familie_umstellung_stichtag || '01.01.'),
      vorlauf: zahl(konfig.ausbildungsnachweis_vorlauf_monate, 2)
    };
  }

  /** 'TT.MM.' + Jahr → 'JJJJ-MM-TT'. */
  function stichtag(konfig, jahr) {
    var m = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(einstellungen(konfig).stichtagTtmm.trim());
    if (!m) return jahr + '-01-01';
    return jahr + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }

  /** 'JJJJ-MM-TT' → 'TT.MM.JJJJ' für Texte, die im Browser angezeigt werden. */
  function de(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '.' + m[2] + '.' + m[1] : String(iso || ''); }

  function name(m) { return m ? [m.nachname, m.vorname].filter(Boolean).join(', ') : '?'; }
  function hat(v) { return v !== null && v !== undefined && v !== ''; }

  /** Tag, an dem jemand ein Alter überschreitet (Geburtstag zum Alter+1) → 'JJJJ-MM-TT'. */
  function tagNachAlter(geburtsdatum, alter) {
    return geburtsdatum ? Mitgliedschaft.plusMonate(geburtsdatum, (alter + 1) * 12) : null;
  }

  function index(daten) {
    var ix = { mitglied: {}, zeitraeume: {}, gemeinschaft: {}, konto: {}, jeGemeinschaft: {} };
    (daten.Mitglied || []).forEach(function (m) { ix.mitglied[m.mitglied_id] = m; });
    (daten.Mitgliedschaftszeitraum || []).forEach(function (z) { (ix.zeitraeume[z.mitglied_id] = ix.zeitraeume[z.mitglied_id] || []).push(z); });
    (daten.Beitragsgemeinschaft || []).forEach(function (g) { ix.gemeinschaft[g.beitragsgemeinschaft_id] = g; });
    (daten.Beitragskonto || []).forEach(function (k) { ix.konto[k.beitragskonto_id] = k; });
    (daten.Mitglied || []).forEach(function (m) {
      if (m.beitragsgemeinschaft_id) (ix.jeGemeinschaft[m.beitragsgemeinschaft_id] = ix.jeGemeinschaft[m.beitragsgemeinschaft_id] || []).push(m);
    });
    return ix;
  }

  function aktivAm(m, ix, tag) {
    var zr = (ix.zeitraeume[m.mitglied_id] || []).slice().sort(function (a, b) { return String(a.eintrittsdatum).localeCompare(String(b.eintrittsdatum)); });
    return Mitgliedschaft.status(m, zr, tag) === 'aktiv';
  }

  function hatFestbetrag(g) { return g && hat(g.festbetrag) && g.aktiv !== false; }

  /** Rollen innerhalb einer Gemeinschaft: { mitglied_id: 'erwachsen'|'kind' } (Heuristik siehe Kopf). */
  function rollen(mitglieder, konto, tag) {
    var alter = {}, aeltester = null;
    mitglieder.forEach(function (m) {
      var a = Mitgliedschaft.alter(m.geburtsdatum, tag);
      alter[m.mitglied_id] = a;
      if (a !== null && (aeltester === null || a > aeltester)) aeltester = a;
    });
    var r = {};
    mitglieder.forEach(function (m) {
      var a = alter[m.mitglied_id];
      var inhaber = konto && konto.kontoinhaber_mitglied_id === m.mitglied_id;
      var vertreten = hat(m.vertreter_mitglied_id) || hat(m.vertreter_name);
      if (inhaber && !vertreten) r[m.mitglied_id] = 'erwachsen';
      else if (vertreten) r[m.mitglied_id] = 'kind';
      else if (a === null || aeltester === null) r[m.mitglied_id] = 'erwachsen';
      else r[m.mitglied_id] = a >= aeltester - GENERATIONEN_ABSTAND ? 'erwachsen' : 'kind';
    });
    return r;
  }

  /** Passende Einzel-Beitragsart nach Alter (aktive Arten mit Altersgrenze bevorzugt). */
  function vorschlagArt(daten, alter, tag) {
    var aktive = (daten.Beitragsart || []).filter(function (a) { return Beitrag.artVerfuegbar(a, tag) && !a.als_gemeinschaft; });
    var mitGrenze = function (a) { return hat(a.alter_von) || hat(a.alter_bis); };
    var passt = aktive.filter(function (a) { return Beitrag.altersbereichPasst(a, alter); });
    var art = passt.filter(mitGrenze)[0] || passt[0] || null;
    return art ? { beitragsart_id: art.beitragsart_id, bezeichnung: art.bezeichnung, betrag: Beitrag.betragAm(art, tag) } : null;
  }

  /** Bewertung eines Kindes zum Stichtag. */
  function bewerte(m, tag, heute, e) {
    var alter = Mitgliedschaft.alter(m.geburtsdatum, tag);
    var aus = { alter: alter, ergebnis: 'bleibt', datum: null, grund: null, verlaengert_bis: null, nachweis_faellig: false };
    if (alter === null) { aus.grund = 'Geburtsdatum fehlt – Altersgrenze nicht prüfbar'; return aus; }
    if (alter <= e.kinderBis) {
      aus.bleibt_bis = tagNachAlter(m.geburtsdatum, e.kinderBis);   // ab diesem Tag zu alt (Prognose)
      return aus;
    }
    var bis = m.ausbildung_bis || null;
    if (bis && bis >= tag && e.ausbildungBis !== null && alter <= e.ausbildungBis) {
      var grenzeTag = tagNachAlter(m.geburtsdatum, e.ausbildungBis);
      aus.verlaengert_bis = grenzeTag && grenzeTag <= bis ? grenzeTag : bis;
      var nachweisAlt = !m.ausbildung_nachweis_am || Mitgliedschaft.plusMonate(m.ausbildung_nachweis_am, NACHWEIS_GUELTIG_MONATE) < heute;
      var endeNah = Mitgliedschaft.plusMonate(bis, -e.vorlauf) <= heute;
      aus.nachweis_faellig = !!(nachweisAlt || endeNah);
      aus.ergebnis = aus.nachweis_faellig ? 'nachweis_anfordern' : 'verlaengert_bis';
      aus.grund = (m.ausbildung_art || 'Ausbildung') + ' bis ' + de(bis) + (aus.verlaengert_bis !== bis ? ' (Altersgrenze ' + e.ausbildungBis + ' früher erreicht)' : '') +
        (aus.nachweis_faellig ? (nachweisAlt ? ' · Nachweis fehlt oder älter als 12 Monate' : ' · Ende naht – neuen Nachweis anfordern') : '');
      return aus;
    }
    aus.ergebnis = 'faellt_raus';
    aus.datum = tag;
    if (bis && bis < tag) aus.grund = 'Ausbildung endet (prognostiziert ' + de(bis) + ')';
    else if (bis && e.ausbildungBis !== null && alter > e.ausbildungBis) aus.grund = 'Ausbildungsgrenze erreicht (Alter ' + alter + ' > ' + e.ausbildungBis + ')';
    else aus.grund = 'Altersgrenze erreicht (Alter ' + alter + ' > ' + e.kinderBis + ')';
    return aus;
  }

  /**
   * Alle Personen in Gemeinschaften mit Festbetrag, bewertet zum Umstellungs-Stichtag des Jahres.
   * Liefert { jahr, stichtag, eintraege: [...], gemeinschaften: [{ id, bezeichnung, festbetrag, konto_id, mitglieder, hinweis }] }.
   */
  function ausscheider(daten, jahr, konfig, heute) {
    var tag = stichtag(konfig, jahr);
    heute = heute || tag;
    var ix = index(daten);
    var artVon = {};
    (daten.Beitragsart || []).forEach(function (a) { artVon[a.beitragsart_id] = a; });
    var eintraege = [], gemeinschaften = [];
    Object.keys(ix.jeGemeinschaft).forEach(function (gid) {
      var g = ix.gemeinschaft[gid];
      if (!hatFestbetrag(g)) return;
      var mitglieder = ix.jeGemeinschaft[gid].filter(function (m) { return aktivAm(m, ix, tag); });
      if (!mitglieder.length) return;
      var konto = ix.konto[mitglieder[0].beitragskonto_id] || null;
      var rolle = rollen(mitglieder, konto, tag);
      var e = einstellungenFuer(konfig, hat(g.beitragsart_id) ? artVon[g.beitragsart_id] : null);
      var bleibende = 0, liste = [];
      mitglieder.forEach(function (m) {
        var b = rolle[m.mitglied_id] === 'kind' ? bewerte(m, tag, heute, e)
          : { alter: Mitgliedschaft.alter(m.geburtsdatum, tag), ergebnis: 'bleibt', datum: null, grund: null };
        if (b.ergebnis !== 'faellt_raus') bleibende++;
        var hinweise = [];
        var vorschlag = null;
        if (b.ergebnis === 'faellt_raus') {
          vorschlag = vorschlagArt(daten, b.alter, tag);
          if (!vorschlag) hinweise.push('Keine passende Beitragsart für Alter ' + b.alter + ' – bitte von Hand wählen.');
          if (b.alter !== null && b.alter >= 18) hinweise.push('Volljährig – zahlt weiter über Konto ' + (m.beitragskonto_id || '?') + '; ggf. eigenes Konto/Mandat vereinbaren.');
        }
        var eintrag = {
          mitglied_id: m.mitglied_id, name: name(m), mitgliedsnummer: m.mitgliedsnummer || null, geburtsdatum: m.geburtsdatum || null,
          version: m.version || 0, gemeinschaft_id: g.beitragsgemeinschaft_id, gemeinschaft: g.bezeichnung, festbetrag: Number(g.festbetrag),
          konto_id: m.beitragskonto_id || null, rolle: rolle[m.mitglied_id], alter: b.alter, ergebnis: b.ergebnis, datum: b.datum,
          grund: b.grund, verlaengert_bis: b.verlaengert_bis || null, bleibt_bis: b.bleibt_bis || null, nachweis_faellig: !!b.nachweis_faellig,
          ausbildung_art: m.ausbildung_art || null, ausbildung_bis: m.ausbildung_bis || null, ausbildung_nachweis_am: m.ausbildung_nachweis_am || null,
          vorschlag: vorschlag, hinweise: hinweise
        };
        liste.push(eintrag);
        eintraege.push(eintrag);
      });
      var hinweis = null;
      if (liste.some(function (x) { return x.ergebnis === 'faellt_raus'; }) && bleibende <= 1) {
        hinweis = 'Danach nur noch ' + bleibende + ' Person in der Gemeinschaft – Gemeinschaft auflösen bzw. auf Einzelbeitrag umstellen.';
        liste.forEach(function (x) { if (x.ergebnis !== 'faellt_raus') x.hinweise.push(hinweis); });
      }
      gemeinschaften.push({
        id: g.beitragsgemeinschaft_id, bezeichnung: g.bezeichnung, festbetrag: Number(g.festbetrag), konto_id: konto ? konto.beitragskonto_id : null,
        kontoinhaber: konto ? konto.kontoinhaber_name : null, mitglieder: liste.map(function (x) { return x.mitglied_id; }), hinweis: hinweis
      });
    });
    eintraege.sort(function (a, b) { return String(a.gemeinschaft).localeCompare(String(b.gemeinschaft)) || String(a.name).localeCompare(String(b.name)); });
    return { jahr: jahr, stichtag: tag, eintraege: eintraege, gemeinschaften: gemeinschaften };
  }

  /**
   * Prognose für die Jahre abJahr … abJahr+jahre−1: wer fällt in welchem Jahr ERSTMALS heraus, mit Grund
   * (z. B. „Ausbildung endet (prognostiziert …)“) und Beitragswirkung (Einzelbeitrag kommt hinzu).
   * Liefert [{ jahr, anzahl, mehreinnahmen, personen: [{ mitglied_id, name, grund, ausbildung_bis, vorschlag }] }].
   */
  function prognose(daten, abJahr, jahre, konfig, heute) {
    var schonRaus = {};
    var vorher = ausscheider(daten, abJahr - 1, konfig, heute);
    vorher.eintraege.forEach(function (x) { if (x.ergebnis === 'faellt_raus') schonRaus[x.mitglied_id] = true; });
    var aus = [];
    for (var j = abJahr; j < abJahr + jahre; j++) {
      var r = ausscheider(daten, j, konfig, heute);
      var personen = r.eintraege.filter(function (x) { return x.ergebnis === 'faellt_raus' && !schonRaus[x.mitglied_id]; });
      personen.forEach(function (x) { schonRaus[x.mitglied_id] = true; });
      aus.push({
        jahr: j, anzahl: personen.length,
        mehreinnahmen: Beitrag.runde(personen.reduce(function (s, x) { return s + (x.vorschlag ? x.vorschlag.betrag : 0); }, 0)),
        personen: personen.map(function (x) {
          return { mitglied_id: x.mitglied_id, name: x.name, gemeinschaft: x.gemeinschaft, grund: x.grund, ausbildung_bis: x.ausbildung_bis, vorschlag: x.vorschlag };
        })
      });
    }
    return aus;
  }

  /**
   * Plant die Umstellung auf Einzelbeitrag. auswahl: [{ mitglied_id, beitragsart_id? }] (ohne Art → Vorschlag).
   * Liefert { aenderungen: { mitglied_id: { beitragsgemeinschaft_id: null, beitragsart_id } }, hinweise: [text], fehler: [{ feld, meldung }] }.
   */
  function umstellungPlan(daten, auswahl, jahr, konfig) {
    var tag = stichtag(konfig, jahr);
    var ix = index(daten);
    var arten = {};
    (daten.Beitragsart || []).forEach(function (a) { arten[a.beitragsart_id] = a; });
    var aenderungen = {}, hinweise = [], fehler = [];
    (auswahl || []).forEach(function (w) {
      var m = ix.mitglied[w.mitglied_id];
      if (!m) { fehler.push({ feld: 'mitglied_id', meldung: 'Mitglied ' + w.mitglied_id + ' unbekannt.' }); return; }
      if (!m.beitragsgemeinschaft_id) { fehler.push({ feld: 'mitglied_id', meldung: name(m) + ' ist in keiner Beitragsgemeinschaft.' }); return; }
      var artId = hat(w.beitragsart_id) ? Number(w.beitragsart_id) : null;
      if (!artId) {
        var v = vorschlagArt(daten, Mitgliedschaft.alter(m.geburtsdatum, tag), tag);
        artId = v ? v.beitragsart_id : null;
      }
      if (!artId || !arten[artId] || arten[artId].aktiv === false) {
        fehler.push({ feld: 'beitragsart_id', meldung: name(m) + ': bitte eine gültige Beitragsart wählen.' });
        return;
      }
      aenderungen[m.mitglied_id] = { beitragsgemeinschaft_id: null, beitragsart_id: artId };
      var gestellt = (daten.Sollstellung || []).some(function (s) { return s.beitragskonto_id === m.beitragskonto_id && s.jahr === jahr && s.status !== 'storniert'; });
      if (gestellt) hinweise.push(name(m) + ': Für ' + jahr + ' ist die Sollstellung von Konto ' + m.beitragskonto_id + ' schon angelegt – sie bleibt unverändert, die Umstellung wirkt ab dem nächsten Lauf (ggf. Nachforderung über Finanzen).');
      var rest = (ix.jeGemeinschaft[m.beitragsgemeinschaft_id] || []).filter(function (x) { return x.mitglied_id !== m.mitglied_id && !aenderungen[x.mitglied_id] && aktivAm(x, ix, tag); });
      if (rest.length <= 1) hinweise.push('Gemeinschaft „' + ((ix.gemeinschaft[m.beitragsgemeinschaft_id] || {}).bezeichnung || m.beitragsgemeinschaft_id) + '“ hat danach nur noch ' + rest.length + ' Person – bitte prüfen (auflösen/Einzelbeitrag).');
    });
    return { aenderungen: aenderungen, hinweise: hinweise.filter(function (h, i, a) { return a.indexOf(h) === i; }), fehler: fehler };
  }

  // ================================================================== Regeln je Familien-/Ehegattenbeitrag, Abweichungen

  /** Titel und Schwere der Abweichungen (Bericht „Abweichungen von den Beitragsregeln“, Datenqualität). */
  var ABWEICHUNGEN = {
    zu_viele_erwachsene: { schwere: 'warnung', titel: 'Mehr Erwachsene als die Regel erlaubt' },
    zu_viele_kinder: { schwere: 'warnung', titel: 'Mehr Kinder als die Regel erlaubt' },
    kind_zu_alt: { schwere: 'warnung', titel: 'Kind über der Altersgrenze (ohne gültige Ausbildung)' },
    ausbildung_ende_fehlt: { schwere: 'warnung', titel: 'In Ausbildung, aber voraussichtliches Ende fehlt' },
    nachweis_faellig: { schwere: 'hinweis', titel: 'Ausbildungsnachweis fehlt oder ist älter als 12 Monate' },
    betrag_abweichend: { schwere: 'hinweis', titel: 'Festbetrag weicht vom Betrag der Regel ab' },
    nur_eine_person: { schwere: 'warnung', titel: 'Gemeinschaft mit nur einer aktiven Person' },
    ohne_regel: { schwere: 'hinweis', titel: 'Gemeinschaft mit Festbetrag ohne zugeordnete Regel (Familien-/Ehegattenbeitrag)' },
    regel_inaktiv: { schwere: 'warnung', titel: 'Zugeordnete Regel ist nicht mehr aktiv' },
    beitragsart_alter: { schwere: 'warnung', titel: 'Beitragsart passt nicht zum Alter (z. B. Kinderbeitrag über 18)' },
    beitragsart_gemeinschaft: { schwere: 'warnung', titel: 'Familien-/Ehegattenbeitrag als Beitragsart einer einzelnen Person' }
  };

  /**
   * Einstellungen für eine Gemeinschaft: die Regel (Beitragsart mit als_gemeinschaft) geht vor _Konfig.
   * ausbildungBis === null heißt: keine Verlängerung durch Ausbildung (z. B. Ehegattenbeitrag).
   */
  function einstellungenFuer(konfig, art) {
    var e = einstellungen(konfig);
    if (!art) return e;
    if (hat(art.kinder_bis_alter)) e.kinderBis = Number(art.kinder_bis_alter);
    e.ausbildungBis = hat(art.ausbildung_bis_alter) ? Number(art.ausbildung_bis_alter) : null;
    e.maxErwachsene = hat(art.max_erwachsene) ? Number(art.max_erwachsene) : null;
    e.maxKinder = hat(art.max_kinder) ? Number(art.max_kinder) : null;
    return e;
  }

  /** Kurzbeschreibung einer Regel für Anzeigen: „2 Erwachsene, beliebig viele Kinder bis 18, mit Ausbildung bis 25“. */
  function regelText(art, konfig) {
    if (!art) return '';
    var e = einstellungenFuer(konfig, art);
    var t = [];
    t.push(e.maxErwachsene === null ? 'beliebig viele Erwachsene' : e.maxErwachsene + (e.maxErwachsene === 1 ? ' Erwachsener' : ' Erwachsene'));
    if (e.maxKinder === 0) t.push('keine Kinder');
    else t.push((e.maxKinder === null ? 'beliebig viele' : e.maxKinder) + ' Kinder bis ' + (e.kinderBis + 1) +
      (e.ausbildungBis !== null ? ', in Ausbildung bis ' + e.ausbildungBis : ''));
    return t.join(', ');
  }

  /**
   * Prüft eine Gemeinschaft (oder eine geplante) gegen ihre Regel zum Stichtag tag.
   * mitglieder: aktive Personen (Mitglied-Zeilen, bei geplanten mit vorläufigen IDs). art: Beitragsart (als Gemeinschaft) oder null.
   * Liefert { erwachsene, kinder, abweichungen: [{ regel, schwere, titel, meldung, mitglied_id }] }.
   */
  function pruefeGemeinschaft(g, art, mitglieder, konto, tag, heute, konfig) {
    var e = einstellungenFuer(konfig, art);
    var ab = [];
    function melde(regel, meldung, m) {
      ab.push({ regel: regel, schwere: ABWEICHUNGEN[regel].schwere, titel: ABWEICHUNGEN[regel].titel, meldung: meldung, mitglied_id: m ? m.mitglied_id : null, name: m ? name(m) : null });
    }
    var rolle = rollen(mitglieder, konto, tag);
    var erwachsene = 0, kinder = 0;
    mitglieder.forEach(function (m) {
      if (rolle[m.mitglied_id] !== 'kind') { erwachsene++; return; }
      var b = bewerte(m, tag, heute, e);
      if (b.ergebnis === 'faellt_raus' && hat(m.ausbildung_art) && !hat(m.ausbildung_bis) && e.ausbildungBis !== null && b.alter !== null && b.alter <= e.ausbildungBis) {
        melde('ausbildung_ende_fehlt', name(m) + ': ' + m.ausbildung_art + ' angegeben, aber „Ausbildung voraussichtlich abgeschlossen am“ fehlt – ohne Datum zählt die Person nicht mehr zum ' + (art ? art.bezeichnung : 'Familienbeitrag') + '.', m);
        return;
      }
      if (b.ergebnis === 'faellt_raus') { melde('kind_zu_alt', name(m) + ': ' + b.grund + ' – gehört nicht mehr in den ' + (art ? art.bezeichnung : 'Familienbeitrag') + '.', m); return; }
      kinder++;
      if (b.ergebnis === 'nachweis_anfordern') melde('nachweis_faellig', name(m) + ': ' + b.grund, m);
    });
    if (art) {
      if (art.aktiv === false) melde('regel_inaktiv', '„' + g.bezeichnung + '“: Regel „' + art.bezeichnung + '“ ist nicht mehr aktiv.');
      if (e.maxErwachsene !== null && erwachsene > e.maxErwachsene) melde('zu_viele_erwachsene', '„' + g.bezeichnung + '“: ' + erwachsene + ' Erwachsene, ' + art.bezeichnung + ' erlaubt ' + e.maxErwachsene + '.');
      if (e.maxKinder !== null && kinder > e.maxKinder) melde('zu_viele_kinder', '„' + g.bezeichnung + '“: ' + kinder + (kinder === 1 ? ' Kind' : ' Kinder') + ', ' + art.bezeichnung + ' erlaubt ' + (e.maxKinder === 0 ? 'keine' : e.maxKinder) + '.');
      if (hat(g.festbetrag) && hat(art.betrag) && Math.abs(Number(g.festbetrag) - Number(art.betrag)) > 0.004) {
        melde('betrag_abweichend', '„' + g.bezeichnung + '“: Festbetrag ' + Number(g.festbetrag).toFixed(2).replace('.', ',') + ' €, ' + art.bezeichnung + ' sieht ' + Number(art.betrag).toFixed(2).replace('.', ',') + ' € vor.');
      }
    } else if (hasFest(g)) melde('ohne_regel', '„' + g.bezeichnung + '“ hat einen Festbetrag, aber keine Regel (Familien-/Ehegattenbeitrag) – bitte zuordnen.');
    if (mitglieder.length === 1) melde('nur_eine_person', '„' + g.bezeichnung + '“ hat nur noch eine aktive Person (' + name(mitglieder[0]) + ') – auflösen bzw. Einzelbeitrag.', mitglieder[0]);
    return { erwachsene: erwachsene, kinder: kinder, abweichungen: ab };
  }
  function hasFest(g) { return g && hat(g.festbetrag); }

  /**
   * Alle Abweichungen im Bestand zum Stichtag des laufenden Jahres (wie Tarifwechsel/Umstellung: Alter zum
   * familie_umstellung_stichtag): je aktive Gemeinschaft gegen ihre Regel, dazu Einzel-Beitragsarten, deren
   * Altersgrenze nicht (mehr) passt. Liefert [{ regel, schwere, titel, meldung, mitglied_id, name, gemeinschaft_id, gemeinschaft }].
   */
  function abweichungen(daten, konfig, heute) {
    var tag = stichtag(konfig, Number(String(heute).slice(0, 4)));
    var ix = index(daten);
    var arten = {};
    (daten.Beitragsart || []).forEach(function (a) { arten[a.beitragsart_id] = a; });
    var aus = [];
    Object.keys(ix.jeGemeinschaft).forEach(function (gid) {
      var g = ix.gemeinschaft[gid];
      if (!g || g.aktiv === false) return;
      var mitglieder = ix.jeGemeinschaft[gid].filter(function (m) { return m.anonymisiert !== true && aktivAm(m, ix, heute); });
      if (!mitglieder.length) return;
      var konto = ix.konto[mitglieder[0].beitragskonto_id] || null;
      var art = hat(g.beitragsart_id) ? arten[g.beitragsart_id] || null : null;
      pruefeGemeinschaft(g, art, mitglieder, konto, tag, heute, konfig).abweichungen.forEach(function (a) {
        a.gemeinschaft_id = g.beitragsgemeinschaft_id; a.gemeinschaft = g.bezeichnung; a.regel_name = art ? art.bezeichnung : null;
        aus.push(a);
      });
    });
    var bArten = {};
    (daten.Beitragsart || []).forEach(function (a) { bArten[a.beitragsart_id] = a; });
    (daten.Mitglied || []).forEach(function (m) {
      if (!m.beitragsart_id || m.anonymisiert === true || !aktivAm(m, ix, heute)) return;
      var g = m.beitragsgemeinschaft_id ? ix.gemeinschaft[m.beitragsgemeinschaft_id] : null;
      if (hatFestbetrag(g)) return;   // zahlt über die Pauschale, die Einzelart wirkt nicht
      var a = bArten[m.beitragsart_id];
      if (a && a.als_gemeinschaft) {
        aus.push({ regel: 'beitragsart_gemeinschaft', schwere: ABWEICHUNGEN.beitragsart_gemeinschaft.schwere, titel: ABWEICHUNGEN.beitragsart_gemeinschaft.titel,
          meldung: name(m) + ': „' + a.bezeichnung + '“ ist als Beitragsart eingetragen – Familien-/Ehegattenbeitrag läuft über eine Beitragsgemeinschaft.',
          mitglied_id: m.mitglied_id, name: name(m), gemeinschaft_id: null, gemeinschaft: null, regel_name: a.bezeichnung });
        return;
      }
      var alter = Mitgliedschaft.alter(m.geburtsdatum, tag);
      // passt zum Stichtag ODER heute → keine Abweichung (der Wechsel kommt mit dem Tarifwechsel zum Jahreswechsel)
      if (!a || alter === null || Beitrag.altersbereichPasst(a, alter) || Beitrag.altersbereichPasst(a, Mitgliedschaft.alter(m.geburtsdatum, heute))) return;
      aus.push({ regel: 'beitragsart_alter', schwere: ABWEICHUNGEN.beitragsart_alter.schwere, titel: ABWEICHUNGEN.beitragsart_alter.titel,
        meldung: name(m) + ': „' + a.bezeichnung + '“, aber ' + alter + ' Jahre (zum ' + de(tag) + ').', mitglied_id: m.mitglied_id, name: name(m),
        gemeinschaft_id: null, gemeinschaft: null, regel_name: a.bezeichnung });
    });
    var rang = { fehler: 0, warnung: 1, hinweis: 2 };
    aus.sort(function (a, b) { return rang[a.schwere] - rang[b.schwere] || String(a.gemeinschaft || a.name).localeCompare(String(b.gemeinschaft || b.name)); });
    return aus;
  }

  /**
   * Zahlungshistorie für Sollstellungen (alle Jahre): Summen je Jahr { jahr, soll, ist, gebuehr, offen, anzahl }.
   * offen = Soll + Gebühr − Ist (nie negativ) für nicht stornierte, nicht bezahlte Posten.
   */
  function jahressummen(sollstellungen) {
    var je = {};
    (sollstellungen || []).forEach(function (s) {
      var j = je[s.jahr] = je[s.jahr] || { jahr: s.jahr, anzahl: 0, soll: 0, ist: 0, gebuehr: 0, offen: 0, ruecklastschriften: 0, storniert: 0 };
      j.anzahl++;
      if (s.status === 'storniert') { j.storniert++; return; }
      j.soll += Number(s.soll_betrag || 0);
      j.ist += Number(s.ist_betrag || 0);
      j.gebuehr += Number(s.gebuehr || 0);
      if (s.status === 'ruecklastschrift' || s.ruecklastschrift_grund) j.ruecklastschriften++;
      if (s.status !== 'bezahlt') j.offen += Math.max(0, Number(s.soll_betrag || 0) + Number(s.gebuehr || 0) - Number(s.ist_betrag || 0));
    });
    return Object.keys(je).map(function (k) {
      var j = je[k];
      ['soll', 'ist', 'gebuehr', 'offen'].forEach(function (f) { j[f] = Beitrag.runde(j[f]); });
      return j;
    }).sort(function (a, b) { return b.jahr - a.jahr; });
  }

  /**
   * Sammelzuordnung: Vorschlag einer Regel (Beitragsart „als Gemeinschaft“) für jede aktive Gemeinschaft ohne Regel.
   * Reihenfolge der Gründe: 1. Bezeichnung („Ehepaar …“ → Ehepaar, „Familie …“ → Familie), 2. Festbetrag gleich dem
   * Betrag genau einer Regel, 3. Zusammensetzung (Kinder dabei → Familie, genau zwei Erwachsene → Ehepaar, sonst Familie).
   * Liefert [{ gemeinschaft_id, bezeichnung, version, festbetrag, personen: [{ name, alter, rolle }], vorschlag, grund,
   *           folgen: [Meldung …] }] – folgen = Abweichungen, die mit dem Vorschlag gemeldet würden.
   */
  function regelVorschlaege(daten, konfig, heute) {
    var tag = stichtag(konfig, Number(String(heute).slice(0, 4)));
    var ix = index(daten);
    var regeln = (daten.Beitragsart || []).filter(function (a) { return a.aktiv !== false && a.als_gemeinschaft; });
    var familie = regeln.filter(function (a) { return a.als_gemeinschaft === 'Familie'; })[0] || null;
    var ehepaar = regeln.filter(function (a) { return a.als_gemeinschaft === 'Ehepaar'; })[0] || null;
    var aus = [];
    Object.keys(ix.jeGemeinschaft).forEach(function (gid) {
      var g = ix.gemeinschaft[gid];
      if (!g || g.aktiv === false || hat(g.beitragsart_id)) return;
      var mitglieder = ix.jeGemeinschaft[gid].filter(function (m) { return m.anonymisiert !== true && aktivAm(m, ix, heute); });
      if (!mitglieder.length) return;
      var konto = ix.konto[mitglieder[0].beitragskonto_id] || null;
      var rolle = rollen(mitglieder, konto, tag);
      var kinder = mitglieder.filter(function (m) { return rolle[m.mitglied_id] === 'kind'; }).length;
      var vorschlag = null, grund = null;
      var bez = String(g.bezeichnung || '').toLowerCase();
      if (/^(ehepaar|ehegatt|eheleute)/.test(bez) && ehepaar) { vorschlag = ehepaar; grund = 'Bezeichnung „' + g.bezeichnung + '“'; }
      else if (/^familie/.test(bez) && familie) { vorschlag = familie; grund = 'Bezeichnung „' + g.bezeichnung + '“'; }
      if (!vorschlag && hat(g.festbetrag)) {
        var gleich = regeln.filter(function (a) { return hat(a.betrag) && Math.abs(Number(a.betrag) - Number(g.festbetrag)) < 0.005; });
        if (gleich.length === 1) { vorschlag = gleich[0]; grund = 'Festbetrag ' + Number(g.festbetrag).toFixed(2).replace('.', ',') + ' € = ' + gleich[0].bezeichnung; }
      }
      if (!vorschlag) {
        if (kinder && familie) { vorschlag = familie; grund = kinder + (kinder === 1 ? ' Kind' : ' Kinder') + ' in der Gemeinschaft'; }
        else if (!kinder && mitglieder.length === 2 && ehepaar) { vorschlag = ehepaar; grund = 'zwei Erwachsene ohne Kinder'; }
        else if (familie || regeln[0]) { vorschlag = familie || regeln[0]; grund = 'keine eindeutigen Merkmale – bitte prüfen'; }
      }
      var folgen = vorschlag ? pruefeGemeinschaft(g, vorschlag, mitglieder, konto, tag, heute, konfig).abweichungen
        .filter(function (a) { return a.regel !== 'nachweis_faellig'; }).map(function (a) { return a.meldung; }) : [];
      aus.push({
        gemeinschaft_id: g.beitragsgemeinschaft_id, bezeichnung: g.bezeichnung, version: g.version || 0,
        festbetrag: hat(g.festbetrag) ? Number(g.festbetrag) : null, konto_id: konto ? konto.beitragskonto_id : null,
        personen: mitglieder.map(function (m) { return { mitglied_id: m.mitglied_id, name: name(m), alter: Mitgliedschaft.alter(m.geburtsdatum, tag), rolle: rolle[m.mitglied_id] }; }),
        vorschlag: vorschlag ? vorschlag.beitragsart_id : null, grund: grund, folgen: folgen
      });
    });
    aus.sort(function (a, b) { return String(a.bezeichnung).localeCompare(String(b.bezeichnung)); });
    return aus;
  }

  return {
    einstellungen: einstellungen, stichtag: stichtag, rollen: rollen, vorschlagArt: vorschlagArt,
    ausscheider: ausscheider, prognose: prognose, umstellungPlan: umstellungPlan, jahressummen: jahressummen,
    ABWEICHUNGEN: ABWEICHUNGEN, einstellungenFuer: einstellungenFuer, regelText: regelText,
    pruefeGemeinschaft: pruefeGemeinschaft, abweichungen: abweichungen, regelVorschlaege: regelVorschlaege
  };
})();
