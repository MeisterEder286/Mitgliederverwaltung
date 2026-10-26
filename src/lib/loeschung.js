/**
 * Loeschung – Löschkonzept in drei Stufen (sperren, anonymisieren, löschen), Fristen, Auskunft nach Art. 15.
 *
 * Zweck:      Rechnet aus dem Tab Aufbewahrungsfrist, ab wann Daten einer Person anonymisiert bzw. gelöscht
 *             werden dürfen, erstellt die Löschliste, plant die Anonymisierung (welche Felder in welchen Tabs),
 *             bestimmt Protokollzeilen zur Bereinigung, die Antwortfrist bei Betroffenenanfragen und erzeugt
 *             eine vollständige Auskunft über die zu einer Person gespeicherten Daten.
 * Datenquelle: `daten` je Tab wie aus DB.lese; `fristen` = Zeilen des Tabs Aufbewahrungsfrist; `konfig` aus _Konfig
 *             (anonym_platzhalter, chronik_bei_anonymisierung).
 * Wer darf was: – (Ausführung nur mit Sichtklasse „verwaltung“ / Aktion benutzer_verwalten, Prüfung vor dem Aufruf).
 * Besonderheiten (Lies-mich des Datenmodells):
 *   - Stufe 1 SPERREN (Art. 18): verarbeitung_eingeschraenkt = ja – Satz verschwindet aus Listen, bleibt für die Frist.
 *   - Stufe 2 ANONYMISIEREN: Name, Anschrift, Kontakt, Geburtsdatum, IBAN, Mandat, Freitexte unwiderruflich
 *     überschreiben. AUCH Restmerkmale (Geburtsdatum, Geschlecht, Abteilung, Eintrittsjahr), weil sie in einem Verein
 *     dieser Größe zur Zuordnung reichen. Die Zeile bleibt als Anker für gesperrte Buchungen.
 *   - Stufe 3 LÖSCHEN: Zeile entfernen, sobald keine Frist mehr läuft.
 *   - Fristende = Bezugspunkt + dauer_monate; „löschbar ab“ = Tag danach. Leere Dauer = unbefristet (blockiert nicht
 *     die Anonymisierung, siehe Zeile „Funktions- und Ehrungshistorie“).
 *   - [A] Einwilligungen werden bei der Anonymisierung ENTFERNT: Ohne Person hat der Nachweis keinen Zweck mehr.
 *   - [A] chronik_bei_anonymisierung: 'namen_entfernen' (Standard) = Funktions-/Ehrungszeilen bleiben als anonyme
 *     Chronik, Freitexte werden geleert; 'vereinsaemter_behalten' = nur Vereinsämter bleiben, Abteilungsfunktionen
 *     und Ehrungen werden entfernt; 'entfernen' = alles entfernen. OFFEN laut Datenmodell.
 *   - Entschieden 10/2026 (X9): mitgliedsnummer bleibt als Anker erhalten (Buchungen, Schreiben, Papierablage);
 *     sie wird nie neu vergeben (mitgliedsnummer_wiederverwendung = nein).
 *   - Diese Datei plant nur. Ausgeführt wird im Servermodul (unter Sperre, mit Protokoll ohne Klartextwerte).
 */
var Loeschung = (function () {

  function liste(daten, tab) { return (daten && daten[tab]) || []; }
  function deDatum(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : ''; }
  function betrifft(frist, tab) {
    return String(frist.betrifft_tab || '').split(/[,;]/).map(function (s) { return s.trim(); }).indexOf(tab) >= 0;
  }
  function aktiveFristen(fristen) { return (fristen || []).filter(function (f) { return f.aktiv !== false; }); }

  function zeitraeume(daten, id) { return Mitgliedschaft.zeitraeumeVon(id, liste(daten, 'Mitgliedschaftszeitraum')); }

  /** Konten, die die Person betreffen: eigenes Beitragskonto und Konten, deren Inhaber sie ist. */
  function kontenVon(mitglied, daten) {
    return liste(daten, 'Beitragskonto').filter(function (k) {
      return k.beitragskonto_id === mitglied.beitragskonto_id || k.kontoinhaber_mitglied_id === mitglied.mitglied_id;
    });
  }

  /** Ende der Mitgliedschaft: Sterbedatum oder Ende des letzten Zeitraums (null, wenn sie noch läuft). */
  function mitgliedschaftsende(mitglied, daten, heute) {
    var zr = zeitraeume(daten, mitglied.mitglied_id);
    if (mitglied.sterbedatum) return mitglied.sterbedatum;
    if (Mitgliedschaft.laufenderZeitraum(zr, heute)) return null;
    var enden = zr.map(Mitgliedschaft.endeVon).filter(Boolean).sort();
    if (enden.length) return enden[enden.length - 1];
    // Anonymisierter Anker: Zeiträume sind bereits entfernt – maßgeblich ist der Tag der Anonymisierung.
    if (mitglied.anonymisiert === true) return mitglied.anonymisiert_am || heute;
    return null;
  }

  /**
   * Fristen einer Person. Liefert
   * { laeuft_noch: true } solange die Mitgliedschaft läuft, sonst
   * { anonymisieren_ab, loeschbar_ab, sperre_grund, fristen: [{ kategorie, bis, rechtsgrundlage, blockiert }] }.
   *   anonymisieren_ab = Ende der Stammdatenfrist (+1 Tag); loeschbar_ab = Ende der längsten Frist (+1 Tag).
   */
  function loeschbarAb(mitgliedId, daten, fristen, heute) {
    heute = heute || '9999-12-31';
    var m = liste(daten, 'Mitglied').filter(function (x) { return x.mitglied_id === mitgliedId; })[0];
    if (!m) return null;
    if (m.nur_funktionstraeger === true) {
      var laufendeFkt = Mitgliedschaft.laufendeFunktionen(liste(daten, 'Funktion'), heute, mitgliedId);
      if (laufendeFkt.length) return { laeuft_noch: true };
    }
    var ende = mitgliedschaftsende(m, daten, heute);
    if (!ende && m.nur_funktionstraeger !== true) return { laeuft_noch: true };
    if (!ende) {   // reiner Funktionsträger: Ende der letzten Funktion
      ende = liste(daten, 'Funktion').filter(function (f) { return f.mitglied_id === mitgliedId && f.bis; })
        .map(function (f) { return f.bis; }).sort().pop() || heute;
    }
    var ergebnis = [];
    var konten = kontenVon(m, daten);
    var kontoIds = konten.map(function (k) { return k.beitragskonto_id; });
    aktiveFristen(fristen).forEach(function (f) {
      if (f.dauer_monate === null || f.dauer_monate === undefined || f.dauer_monate === '') return;
      var dauer = Number(f.dauer_monate);
      var bezug = null;
      if (betrifft(f, 'Mitglied') && f.bezugspunkt === 'Austritt') bezug = ende;
      else if (betrifft(f, 'Sollstellung') && f.bezugspunkt === 'Ende Geschäftsjahr') {
        var jahre = liste(daten, 'Sollstellung').filter(function (s) { return kontoIds.indexOf(s.beitragskonto_id) >= 0; })
          .map(function (s) { return Number(s.jahr); });
        if (jahre.length) bezug = Math.max.apply(null, jahre) + '-12-31';
      }
      if (!bezug) return;
      var bis = Mitgliedschaft.plusMonate(bezug, dauer);
      ergebnis.push({ kategorie: f.datenkategorie, bis: bis, rechtsgrundlage: f.rechtsgrundlage || '',
        stammdaten: betrifft(f, 'Mitglied') });
    });
    var stamm = ergebnis.filter(function (e) { return e.stammdaten; }).map(function (e) { return e.bis; }).sort().pop() || ende;
    var laengste = ergebnis.slice().sort(function (a, b) { return a.bis < b.bis ? -1 : 1; }).pop();
    var loeschBis = laengste ? (laengste.bis > stamm ? laengste.bis : stamm) : stamm;
    var grund = laengste
      ? String(laengste.rechtsgrundlage).replace(/\s*—\s*VORSCHLAG$/, '') + ' — ' + laengste.kategorie + ' bis ' + deDatum(laengste.bis)
      : null;
    return {
      laeuft_noch: false,
      mitgliedschaft_endete: ende,
      anonymisieren_ab: Mitgliedschaft.plusTage(stamm, 1),
      loeschbar_ab: Mitgliedschaft.plusTage(loeschBis, 1),
      sperre_grund: grund,
      fristen: ergebnis.map(function (e) { return { kategorie: e.kategorie, bis: e.bis, rechtsgrundlage: e.rechtsgrundlage }; })
    };
  }

  /**
   * Löschliste zum Stichtag heute. Kandidaten:
   *   { stufe: 'sperren'|'anonymisieren'|'loeschen'|'konto_leeren'|'fz_loeschen'|'protokoll_bereinigen', tab, id, mitglied_id, grund, ab }
   * Die Liste ist ein Vorschlag – entschieden und ausgelöst wird von Hand (D4: Zuständigkeit Verwaltung).
   */
  function loeschliste(daten, fristen, heute, konfig) {
    var k = [];
    liste(daten, 'Mitglied').forEach(function (m) {
      var f = loeschbarAb(m.mitglied_id, daten, fristen, heute);
      if (!f || f.laeuft_noch) return;
      if (m.anonymisiert === true) {
        var referenziert = liste(daten, 'Sollstellung').some(function (s) {
          return kontenVon(m, daten).some(function (kk) { return kk.beitragskonto_id === s.beitragskonto_id; });
        });
        if (f.loeschbar_ab <= heute) {
          k.push({ stufe: 'loeschen', tab: 'Mitglied', id: m.mitglied_id, mitglied_id: m.mitglied_id, ab: f.loeschbar_ab,
            grund: 'Alle Fristen abgelaufen' + (referenziert ? ' – zugehörige Sollstellungen und Konto ebenfalls entfernen.' : '.') });
        }
        return;
      }
      if (f.anonymisieren_ab <= heute) {
        k.push({ stufe: 'anonymisieren', tab: 'Mitglied', id: m.mitglied_id, mitglied_id: m.mitglied_id, ab: f.anonymisieren_ab,
          grund: 'Mitgliedschaft endete ' + deDatum(f.mitgliedschaft_endete) + '; Frist für Stammdaten abgelaufen.' +
            (f.sperre_grund && f.loeschbar_ab > heute ? ' Buchungen bleiben gesperrt: ' + f.sperre_grund + '.' : '') });
      } else if (m.verarbeitung_eingeschraenkt !== true) {
        k.push({ stufe: 'sperren', tab: 'Mitglied', id: m.mitglied_id, mitglied_id: m.mitglied_id, ab: f.mitgliedschaft_endete,
          grund: 'Mitgliedschaft beendet; Aufbewahrung läuft bis ' + deDatum(Mitgliedschaft.plusTage(f.anonymisieren_ab, -1)) + ' – Sperre empfohlen.' });
      }
    });
    // IBAN/Mandat: letzter Einzug + Frist „SEPA-Mandat und IBAN“
    var mandatsfrist = aktiveFristen(fristen).filter(function (f) { return f.bezugspunkt === 'letzter Einzug' && betrifft(f, 'Beitragskonto'); })[0];
    if (mandatsfrist) {
      var aktiveKonten = {};
      var zrAlle = liste(daten, 'Mitgliedschaftszeitraum');
      liste(daten, 'Mitglied').forEach(function (m) {
        if (m.beitragskonto_id && Mitgliedschaft.status(m, Mitgliedschaft.zeitraeumeVon(m.mitglied_id, zrAlle), heute) === 'aktiv') aktiveKonten[m.beitragskonto_id] = true;
      });
      liste(daten, 'Beitragskonto').forEach(function (konto) {
        if (aktiveKonten[konto.beitragskonto_id] || (!konto.iban && !konto.mandatsreferenz)) return;
        var letzter = liste(daten, 'Sollstellung').filter(function (s) { return s.beitragskonto_id === konto.beitragskonto_id && s.einzugsdatum; })
          .map(function (s) { return s.einzugsdatum; }).sort().pop() || konto.mandatsdatum;
        if (!letzter) return;
        var ab = Mitgliedschaft.plusTage(Mitgliedschaft.plusMonate(letzter, Number(mandatsfrist.dauer_monate)), 1);
        if (ab <= heute) k.push({ stufe: 'konto_leeren', tab: 'Beitragskonto', id: konto.beitragskonto_id, mitglied_id: konto.kontoinhaber_mitglied_id || null, ab: ab,
          grund: 'Kein aktives Mitglied mehr auf dem Konto; letzter Einzug ' + deDatum(letzter) + ' – IBAN und Mandat leeren.' });
      });
    }
    if (typeof Fristen !== 'undefined') {
      Fristen.uebersicht(daten, heute, konfig).zu_loeschen.forEach(function (z) {
        k.push({ stufe: 'fz_loeschen', tab: 'Qualifikation', id: z.qualifikation_id, mitglied_id: z.mitglied_id, ab: z.zu_loeschen_ab,
          grund: 'Führungszeugnis-Vermerk: nachweispflichtige Tätigkeit beendet (§ 72a Abs. 5 SGB VIII).' });
      });
    }
    var protokollfrist = aktiveFristen(fristen).filter(function (f) { return betrifft(f, '_Protokoll'); })[0];
    if (protokollfrist) {
      protokollBereinigung(liste(daten, '_Protokoll'), protokollfrist, heute).forEach(function (id) {
        k.push({ stufe: 'protokoll_bereinigen', tab: '_Protokoll', id: id, mitglied_id: null, ab: null, grund: 'Protokollwerte älter als die Frist.' });
      });
    }
    return k;
  }

  /**
   * Plan für Stufe 2. Liefert { aenderungen: { Tab: [{ id, felder }] }, entfernen: { Tab: [ids] }, protokoll_bereinigen: [protokoll_ids],
   * hinweise: [Text] }.
   * heute 'JJJJ-MM-TT'; fristInfo = loeschbarAb(…) (für sperre_grund/loeschbar_ab, optional).
   */
  function anonymisierePlan(mitglied, daten, konfig, heute, fristInfo) {
    konfig = konfig || {};
    var platz = konfig.anonym_platzhalter || '(anonymisiert)';
    var chronik = konfig.chronik_bei_anonymisierung || 'namen_entfernen';
    var id = mitglied.mitglied_id;
    var plan = { aenderungen: {}, entfernen: {}, protokoll_bereinigen: [], hinweise: [] };
    function aendere(tab, rid, felder) { (plan.aenderungen[tab] = plan.aenderungen[tab] || []).push({ id: rid, felder: felder }); }
    function entferne(tab, rid) { (plan.entfernen[tab] = plan.entfernen[tab] || []).push(rid); }

    var mf = {
      anrede: null, briefanrede: null, titel: null, vorname: platz, nachname: platz,
      strasse: null, hausnummer: null, plz: null, ort: null, land: null, geburtsdatum: null, geschlecht: null,
      telefon: null, handy: null, email: null, versandart: null, adresse_ungueltig: null, adresse_ungueltig_am: null,
      ehrenmitglied: null, ehrenmitglied_seit: null, sterbedatum: null,
      vertreter_mitglied_id: null, vertreter_name: null, vertreter_kontakt: null, bemerkung: null,
      verarbeitung_eingeschraenkt: true, anonymisiert: true, anonymisiert_am: heute
    };
    if (fristInfo && !fristInfo.laeuft_noch) {
      mf.loeschbar_ab = fristInfo.loeschbar_ab;
      mf.sperre_grund = fristInfo.sperre_grund || null;
    }
    aendere('Mitglied', id, mf);
    plan.hinweise.push('Die Mitgliedsnummer bleibt als Anker erhalten und wird nicht neu vergeben.');

    liste(daten, 'Mitgliedschaftszeitraum').forEach(function (z) { if (z.mitglied_id === id) entferne('Mitgliedschaftszeitraum', z.zeitraum_id); });
    liste(daten, 'Abteilungszugehoerigkeit').forEach(function (z) { if (z.mitglied_id === id) entferne('Abteilungszugehoerigkeit', z.zugehoerigkeit_id); });
    liste(daten, 'Einwilligung').forEach(function (e) { if (e.mitglied_id === id) entferne('Einwilligung', e.einwilligung_id); });
    liste(daten, 'Qualifikation').forEach(function (q) { if (q.mitglied_id === id) entferne('Qualifikation', q.qualifikation_id); });
    // Interne Notizen zur Person: vollständig entfernen (Freitext, kein Nachweiszweck)
    liste(daten, 'Notiz').forEach(function (n) { if (n.mitglied_id === id) entferne('Notiz', n.notiz_id); });
    // Anschreiben: Datum/Anlass bleiben als Nachweis, Inhalt und Anschrift werden geleert
    liste(daten, 'Anschreiben').forEach(function (a) {
      if (a.mitglied_id === id) aendere('Anschreiben', a.anschreiben_id, { inhalt: null, empfaenger: null, betreff: 'Schreiben (anonymisiert)', dokument_link: null, bemerkung: null });
    });
    // Dokument-Links: entfernen – außer SEPA-Mandat (Nachweis für gesperrte Buchungen, Personenbezug gelöst)
    liste(daten, 'Dokument').forEach(function (doc) {
      if (doc.mitglied_id !== id) return;
      if (doc.art === 'SEPA-Mandat' && doc.beitragskonto_id) aendere('Dokument', doc.dokument_id, { mitglied_id: null, titel: 'SEPA-Mandat (anonymisiert)', bemerkung: null });
      else entferne('Dokument', doc.dokument_id);
    });

    var fArten = {};
    liste(daten, 'Funktionsart').forEach(function (a) { fArten[a.funktionsart_id] = a; });
    liste(daten, 'Funktion').forEach(function (f) {
      if (f.mitglied_id !== id) return;
      var verein = (fArten[f.funktionsart_id] || {}).ebene === 'Verein';
      if (chronik === 'entfernen' || (chronik === 'vereinsaemter_behalten' && !verein)) entferne('Funktion', f.funktion_id);
      else aendere('Funktion', f.funktion_id, { zusatz: null, bestellt_am: null, beendigungsgrund: null, bemerkung: null });
    });
    liste(daten, 'Ehrung').forEach(function (e) {
      if (e.mitglied_id !== id) return;
      if (chronik === 'namen_entfernen') aendere('Ehrung', e.ehrung_id, { veranstaltung: null, bemerkung: null });
      else entferne('Ehrung', e.ehrung_id);
    });

    // Konten: Inhaber-Daten leeren, solange kein anderes aktives Mitglied darauf zahlt
    var zrAlle = liste(daten, 'Mitgliedschaftszeitraum');
    kontenVon(mitglied, daten).forEach(function (k) {
      var andere = liste(daten, 'Mitglied').filter(function (x) {
        return x.mitglied_id !== id && x.beitragskonto_id === k.beitragskonto_id &&
          Mitgliedschaft.status(x, Mitgliedschaft.zeitraeumeVon(x.mitglied_id, zrAlle), heute) === 'aktiv';
      });
      if (andere.length) {
        plan.hinweise.push('Konto ' + k.beitragskonto_id + ' trägt noch ' + andere.length + ' aktive(s) Mitglied(er) – erst neuen Zahler zuordnen, Konto bleibt unverändert.');
        return;
      }
      aendere('Beitragskonto', k.beitragskonto_id, {
        kontoinhaber_name: platz,
        iban: null, bic: null, mandatsreferenz: null, mandatsdatum: null,
        abw_strasse: null, abw_hausnummer: null, abw_plz: null, abw_ort: null, abw_land: null, aktiv: false, bemerkung: null
      });
      liste(daten, 'Sollstellung').forEach(function (s) {
        if (s.beitragskonto_id === k.beitragskonto_id && (s.bemerkung || s.ruecklastschrift_grund)) {
          aendere('Sollstellung', s.sollstellung_id, { bemerkung: null, ruecklastschrift_grund: null });
        }
      });
    });
    liste(daten, 'Betroffenenanfrage').forEach(function (a) {
      if (a.mitglied_id === id && a.name_bei_eingang) aendere('Betroffenenanfrage', a.anfrage_id, { name_bei_eingang: null });
    });
    var prot = liste(daten, '_Protokoll').filter(function (p) {
      return p.tabelle === 'Mitglied' && String(p.datensatz_id) === String(id) && (p.alt_wert || p.neu_wert);
    }).map(function (p) { return p.protokoll_id; });
    plan.protokoll_bereinigen = prot;   // alt_wert/neu_wert leeren, bereinigt_am = heute
    return plan;
  }

  /** Protokoll-IDs, deren alt_wert/neu_wert nach Frist zu leeren sind (Zeitstempel bleiben). */
  function protokollBereinigung(zeilen, frist, heute) {
    var monate = Number(frist && frist.dauer_monate);
    if (!monate) return [];
    return (zeilen || []).filter(function (p) {
      if (p.bereinigt_am || (!p.alt_wert && !p.neu_wert) || !p.zeitpunkt) return false;
      return Mitgliedschaft.plusMonate(String(p.zeitpunkt).slice(0, 10), monate) < heute;
    }).map(function (p) { return p.protokoll_id; });
  }

  /** Antwortfrist einer Betroffenenanfrage (Art. 12 Abs. 3: ein Monat ab Eingang). */
  function betroffenenFrist(anfrage, heute) {
    var frist = anfrage && anfrage.eingang_am ? Mitgliedschaft.plusMonate(anfrage.eingang_am, 1) : null;
    var erledigt = !!(anfrage && anfrage.rueckmeldung_am);
    var tage = null;
    if (frist && heute) tage = Math.round((Date.parse(frist + 'T00:00:00Z') - Date.parse(heute + 'T00:00:00Z')) / 86400000);
    return {
      frist: frist,
      status: erledigt ? 'beantwortet' : !frist ? 'unbekannt' : heute && heute > frist ? 'überfällig' : 'offen',
      tage_rest: erledigt ? null : tage
    };
  }

  var TECHNISCH = ['version', 'geaendert_am', 'geaendert_von'];
  function lesbar(tab, obj, aufloesen) {
    var o = {};
    Object.keys(obj).forEach(function (k) {
      if (TECHNISCH.indexOf(k) >= 0 || k === 'mitglied_id' && tab !== 'Mitglied') return;
      if (typeof Schema !== 'undefined' && Schema.TABELLEN[tab] && Schema.TABELLEN[tab].idSpalte === k && tab !== 'Mitglied') return;
      var v = obj[k];
      if (v === null || v === undefined || v === '') return;
      if (aufloesen[k]) v = aufloesen[k](v);
      if (v === true) v = 'ja'; else if (v === false) v = 'nein';
      else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) v = deDatum(v) + (v.length > 10 ? ' ' + v.slice(11, 16) : '');
      var name = typeof Werte !== 'undefined' && Werte.feldname ? Werte.feldname(k) : k;
      o[name] = v;
    });
    return o;
  }

  /**
   * Auskunft nach Art. 15: alle zu einer Person gespeicherten Daten, nach Bereichen gegliedert, Verweise aufgelöst
   * (Abteilung, Funktion, Beitragsart … als Klartext). Technische Felder (version, geaendert_*) bleiben weg.
   * Ergebnis: { abschnitte: [{ titel, eintraege: [ {Feld: Wert} ] }] }
   */
  function auskunft(mitgliedId, daten) {
    function nach(tab, feld, text) {
      var m = {}; liste(daten, tab).forEach(function (r) { m[r[feld]] = r[text]; });
      return function (v) { return m[v] !== undefined ? m[v] : v; };
    }
    var aufloesen = {
      abteilung_id: nach('Abteilung', 'abteilung_id', 'bezeichnung'),
      funktionsart_id: nach('Funktionsart', 'funktionsart_id', 'bezeichnung'),
      beitragsart_id: nach('Beitragsart', 'beitragsart_id', 'bezeichnung'),
      beitragsgemeinschaft_id: nach('Beitragsgemeinschaft', 'beitragsgemeinschaft_id', 'bezeichnung'),
      ehrungsregel_id: nach('Ehrungsregel', 'ehrungsregel_id', 'bezeichnung'),
      qualifikationsart_id: nach('Qualifikationsart', 'qualifikationsart_id', 'bezeichnung')
    };
    var m = liste(daten, 'Mitglied').filter(function (x) { return x.mitglied_id === mitgliedId; })[0];
    if (!m) return { abschnitte: [] };
    var konten = kontenVon(m, daten);
    var kontoIds = konten.map(function (k) { return k.beitragskonto_id; });
    function von(tab) { return liste(daten, tab).filter(function (r) { return r.mitglied_id === mitgliedId; }); }
    var abschnitte = [
      { titel: 'Stammdaten und Kontakt', eintraege: [lesbar('Mitglied', m, aufloesen)] },
      { titel: 'Mitgliedschaftszeiträume', eintraege: von('Mitgliedschaftszeitraum').map(function (r) { return lesbar('Mitgliedschaftszeitraum', r, aufloesen); }) },
      { titel: 'Abteilungen', eintraege: von('Abteilungszugehoerigkeit').map(function (r) { return lesbar('Abteilungszugehoerigkeit', r, aufloesen); }) },
      { titel: 'Ämter und Tätigkeiten', eintraege: von('Funktion').map(function (r) { return lesbar('Funktion', r, aufloesen); }) },
      { titel: 'Beitragskonto und Bankverbindung', eintraege: konten.map(function (r) { return lesbar('Beitragskonto', r, aufloesen); }) },
      { titel: 'Beitragsbuchungen', eintraege: liste(daten, 'Sollstellung').filter(function (s) { return kontoIds.indexOf(s.beitragskonto_id) >= 0; })
        .map(function (r) { return lesbar('Sollstellung', r, aufloesen); }) },
      { titel: 'Nachweise (Führungszeugnis, Lizenzen)', eintraege: von('Qualifikation').map(function (r) { return lesbar('Qualifikation', r, aufloesen); }) },
      { titel: 'Ehrungen', eintraege: von('Ehrung').map(function (r) { return lesbar('Ehrung', r, aufloesen); }) },
      { titel: 'Einwilligungen', eintraege: von('Einwilligung').map(function (r) { return lesbar('Einwilligung', r, aufloesen); }) },
      { titel: 'Interne Notizen', eintraege: von('Notiz').map(function (r) { return lesbar('Notiz', r, aufloesen); }) },
      { titel: 'Anfragen nach DSGVO', eintraege: von('Betroffenenanfrage').map(function (r) { return lesbar('Betroffenenanfrage', r, aufloesen); }) }
    ];
    return { abschnitte: abschnitte.filter(function (a) { return a.eintraege.length; }) };
  }

  return {
    loeschbarAb: loeschbarAb, loeschliste: loeschliste, anonymisierePlan: anonymisierePlan,
    protokollBereinigung: protokollBereinigung, betroffenenFrist: betroffenenFrist, auskunft: auskunft
  };
})();
