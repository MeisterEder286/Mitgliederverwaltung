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
    if (bis && bis >= tag && alter <= e.ausbildungBis) {
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
    else if (bis && alter > e.ausbildungBis) aus.grund = 'Ausbildungsgrenze erreicht (Alter ' + alter + ' > ' + e.ausbildungBis + ')';
    else aus.grund = 'Altersgrenze erreicht (Alter ' + alter + ' > ' + e.kinderBis + ')';
    return aus;
  }

  /**
   * Alle Personen in Gemeinschaften mit Festbetrag, bewertet zum Umstellungs-Stichtag des Jahres.
   * Liefert { jahr, stichtag, eintraege: [...], gemeinschaften: [{ id, bezeichnung, festbetrag, konto_id, mitglieder, hinweis }] }.
   */
  function ausscheider(daten, jahr, konfig, heute) {
    var e = einstellungen(konfig);
    var tag = stichtag(konfig, jahr);
    heute = heute || tag;
    var ix = index(daten);
    var eintraege = [], gemeinschaften = [];
    Object.keys(ix.jeGemeinschaft).forEach(function (gid) {
      var g = ix.gemeinschaft[gid];
      if (!hatFestbetrag(g)) return;
      var mitglieder = ix.jeGemeinschaft[gid].filter(function (m) { return aktivAm(m, ix, tag); });
      if (!mitglieder.length) return;
      var konto = ix.konto[mitglieder[0].beitragskonto_id] || null;
      var rolle = rollen(mitglieder, konto, tag);
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

  return {
    einstellungen: einstellungen, stichtag: stichtag, rollen: rollen, vorschlagArt: vorschlagArt,
    ausscheider: ausscheider, prognose: prognose, umstellungPlan: umstellungPlan, jahressummen: jahressummen
  };
})();
