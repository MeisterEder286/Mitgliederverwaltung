/**
 * Familie (Servermodul) – Familienübersicht, Ausscheider aus dem Familienbeitrag, Umstellung auf Einzelbeitrag,
 * Ausbildungsangaben, Zahlungshistorie je Person/Konto.
 *
 * Zweck:      Johanns Wunsch: „Bezahlhistorie, Umstellung auf Einzelbeitrag, wenn nicht mehr zugehörig zur Familie,
 *             Übersicht wer rausfällt bzw. Verlängerung wegen Studium mit prognostiziertem Studiumende.“
 *             Ersetzt die Access-Abfrage „FamilienF“. Rechenlogik in src/lib/familie.js (rein, getestet).
 * Datenquelle: Snapshot-Basis (alle Tabs inkl. aller Sollstellungen), _Protokoll (frühere Konten einer Person).
 * Wer darf was: Lesen mit konto_lesen (Vorstand, Mitgliederverwaltung, Kasse – Zeilensicht „alle“);
 *             Umstellen und Ausbildung erfassen mit mitglied_bearbeiten. Zeilenschutz über Snapshot.pruefeMitglied.
 * Besonderheiten:
 *   - Umstellung als EINE Sammelaktion unter einer Sperre (DB.aktualisiereViele), je Person ein Protokolleintrag.
 *   - [A] Frühere Konten einer Person werden aus den Protokolleinträgen „beitragskonto_id“ ermittelt; ältere
 *     Wechsel, die vor dem Protokoll lagen (z. B. vor der Migration), sind nicht bekannt.
 *   - [A] Der „Anteil der Person“ in der Historie wird mit den HEUTIGEN Stammdaten nachgerechnet (Beitragsart,
 *     Gemeinschaft). Der gestellte Betrag selbst ist der unveränderte Schnappschuss der Sollstellung.
 */
var FamilieModul = (function () {

  function heute() { return DB.jetzt().slice(0, 10); }

  function daten() {
    var b = Snapshot.basis();
    var d = {};
    Object.keys(b.tabs).forEach(function (t) { d[t] = b.tabs[t]; });
    return { daten: d, konfig: b.konfig || {} };
  }

  function jahrPruefen(jahr, k) {
    var j = Number(jahr || k.beitragsjahr || heute().slice(0, 4));
    if (!(j >= 2000 && j <= 2100) || Math.floor(j) !== j) throw Fehler.fachlich('Bitte ein gültiges Jahr angeben.');
    return j;
  }

  function name(m) { return Beitrag.name(m); }

  /** Liste „Anschreiben vorbereiten“ für die Übergabe an die Korrespondenz-Ansicht. */
  function anschreibenListe(eintraege) {
    var umstellen = eintraege.filter(function (x) { return x.ergebnis === 'faellt_raus'; }).map(function (x) { return x.mitglied_id; });
    var nachweis = eintraege.filter(function (x) { return x.nachweis_faellig; }).map(function (x) { return x.mitglied_id; });
    var aus = [];
    if (umstellen.length) aus.push({ anlass: 'Umstellung Einzelbeitrag', mitglied_ids: umstellen });
    if (nachweis.length) aus.push({ anlass: 'Ausbildungsnachweis anfordern', mitglied_ids: nachweis });
    return aus;
  }

  // ================================================================== Lesen

  /** Alle Gemeinschaften mit Mitgliedern, Rolle, Alter und Bewertung zum Stichtag des Jahres. */
  function uebersicht(ktx, jahr) {
    var x = daten();
    jahr = jahrPruefen(jahr, x.konfig);
    var r = Familie.ausscheider(x.daten, jahr, x.konfig, heute());
    var je = {};
    r.eintraege.forEach(function (e) { (je[e.gemeinschaft_id] = je[e.gemeinschaft_id] || []).push(e); });
    // auch Gemeinschaften ohne Festbetrag/ohne aktive Mitglieder zeigen (zur Kontrolle)
    var bekannt = {};
    r.gemeinschaften.forEach(function (g) { bekannt[g.id] = true; g.personen = je[g.id] || []; g.aktiv = true; });
    (x.daten.Beitragsgemeinschaft || []).forEach(function (g) {
      if (bekannt[g.beitragsgemeinschaft_id]) return;
      r.gemeinschaften.push({ id: g.beitragsgemeinschaft_id, bezeichnung: g.bezeichnung, festbetrag: g.festbetrag === null || g.festbetrag === undefined ? null : Number(g.festbetrag),
        konto_id: null, kontoinhaber: null, mitglieder: [], personen: [], aktiv: g.aktiv !== false,
        hinweis: g.aktiv === false ? 'aufgelöst/inaktiv' : 'keine aktiven Mitglieder oder kein Festbetrag' });
    });
    r.gemeinschaften.sort(function (a, b) { return String(a.bezeichnung).localeCompare(String(b.bezeichnung)); });
    return { jahr: jahr, stichtag: r.stichtag, gemeinschaften: r.gemeinschaften, einstellungen: Familie.einstellungen(x.konfig) };
  }

  /** Ausscheider des Jahres + Prognose für die Folgejahre + Anschreiben-Liste. */
  function ausscheider(ktx, jahr, jahreVoraus) {
    var x = daten();
    jahr = jahrPruefen(jahr, x.konfig);
    var n = Math.max(1, Math.min(10, Number(jahreVoraus) || 5));
    var h = heute();
    var r = Familie.ausscheider(x.daten, jahr, x.konfig, h);
    var relevant = r.eintraege.filter(function (e) { return e.rolle === 'kind' || e.ergebnis !== 'bleibt'; });
    return {
      jahr: jahr, stichtag: r.stichtag, einstellungen: Familie.einstellungen(x.konfig),
      eintraege: relevant,
      prognose: Familie.prognose(x.daten, jahr, n, x.konfig, h),
      anschreiben: anschreibenListe(relevant),
      beitragsarten: (x.daten.Beitragsart || []).filter(function (a) { return a.aktiv !== false; })
        .map(function (a) { return { beitragsart_id: a.beitragsart_id, bezeichnung: a.bezeichnung, betrag: a.betrag }; })
    };
  }

  // ================================================================== Schreiben

  /** Sammel-Umstellung auf Einzelbeitrag. liste: [{ mitglied_id, version, beitragsart_id? }], wirksam: 'JJJJ-MM-TT' (Info). */
  function umstellen(ktx, liste, wirksam) {
    if (!Array.isArray(liste) || !liste.length) throw Fehler.fachlich('Bitte mindestens eine Person auswählen.');
    if (liste.length > 500) throw Fehler.fachlich('Zu viele Personen auf einmal (höchstens 500).');
    wirksam = wirksam ? String(wirksam).slice(0, 10) : null;
    if (wirksam && !/^\d{4}-\d{2}-\d{2}$/.test(wirksam)) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'wirksam', meldung: 'Datum ungültig.' }]);
    return DB.mitSperre(function () {
      var x = daten();
      var jahr = wirksam ? Number(wirksam.slice(0, 4)) : jahrPruefen(null, x.konfig);
      var auswahl = liste.map(function (w) {
        var id = Number(w && w.mitglied_id);
        Snapshot.pruefeMitglied(ktx, id);
        return { mitglied_id: id, beitragsart_id: w.beitragsart_id, version: Number(w.version || 0) };
      });
      var plan = Familie.umstellungPlan(x.daten, auswahl, jahr, x.konfig);
      if (plan.fehler.length) throw Fehler.fachlich(plan.fehler.map(function (f) { return f.meldung; }).join(' '), plan.fehler);
      var versionen = {};
      auswahl.forEach(function (w) { versionen[w.mitglied_id] = w.version; });
      var erg = DB.aktualisiereViele('Mitglied', Object.keys(plan.aenderungen).map(function (id) {
        return { id: Number(id), aenderungen: plan.aenderungen[id], version: versionen[id] };
      }), ktx);
      var prot = [];
      erg.forEach(function (e) {
        Protokoll.ausDiff('Mitglied', e.neu.mitglied_id, e.diff).forEach(function (p) {
          p.kommentar = 'Umstellung auf Einzelbeitrag' + (wirksam ? ' zum ' + wirksam : '');
          prot.push(p);
        });
      });
      Protokoll.schreibe(ktx, prot);
      var a = Snapshot.schreibe(ktx, erg.map(function (e) { return { tab: 'Mitglied', neu: e.neu }; }));
      a.hinweise = plan.hinweise;
      a.anzahl = erg.length;
      a.anschreiben = [{ anlass: 'Umstellung Einzelbeitrag', mitglied_ids: erg.map(function (e) { return e.neu.mitglied_id; }) }];
      return a;
    });
  }

  /** Ausbildung/Studium erfassen: { ausbildung_art, ausbildung_bis, ausbildung_nachweis_am }. */
  function ausbildungSpeichern(ktx, id, version, werte) {
    var w = Werte.ausFormular('Mitglied', {
      ausbildung_art: werte && werte.ausbildung_art, ausbildung_bis: werte && werte.ausbildung_bis,
      ausbildung_nachweis_am: werte && werte.ausbildung_nachweis_am
    });
    var h = heute();
    var fehler = [];
    if (w.ausbildung_bis) {
      if (w.ausbildung_bis < h) fehler.push({ feld: 'ausbildung_bis', meldung: 'Das voraussichtliche Ende liegt in der Vergangenheit – bei beendeter Ausbildung bitte das Feld leeren.' });
      else if (w.ausbildung_bis > Mitgliedschaft.plusMonate(h, 96)) fehler.push({ feld: 'ausbildung_bis', meldung: 'Mehr als 8 Jahre voraus – bitte prüfen.' });
      if (!w.ausbildung_art) fehler.push({ feld: 'ausbildung_art', meldung: 'Bitte die Art angeben (Schule, Studium …).' });
    }
    if (w.ausbildung_nachweis_am && w.ausbildung_nachweis_am > h) fehler.push({ feld: 'ausbildung_nachweis_am', meldung: 'Der Nachweis kann nicht in der Zukunft liegen.' });
    Werte.pruefe('Mitglied', w, { teilweise: true }).forEach(function (f) { if (!fehler.some(function (x) { return x.feld === f.feld; })) fehler.push(f); });
    if (fehler.length) throw Fehler.fachlich('Bitte Eingaben prüfen.', fehler);
    return DB.mitSperre(function () {
      Snapshot.pruefeMitglied(ktx, Number(id));
      var felder = Rechte.erlaubteSchreibfelder(ktx, 'Mitglied', w);
      var r = DB.aktualisieren('Mitglied', Number(id), felder, Number(version || 0), ktx);
      Protokoll.schreibe(ktx, Protokoll.ausDiff('Mitglied', Number(id), r.diff));
      return Snapshot.schreibe(ktx, [{ tab: 'Mitglied', neu: r.neu }]);
    });
  }

  // ================================================================== Zahlungshistorie

  /** Konten, über die eine Person zahlt bzw. gezahlt hat: aktuelles Konto + Konten aus dem Protokoll. */
  function kontenDerPerson(m) {
    var ids = {};
    if (m.beitragskonto_id) ids[m.beitragskonto_id] = 'aktuell';
    (DB.lese(['_Protokoll'])._Protokoll || []).forEach(function (p) {
      if (p.tabelle !== 'Mitglied' || String(p.datensatz_id) !== String(m.mitglied_id) || p.feld !== 'beitragskonto_id') return;
      [p.alt_wert, p.neu_wert].forEach(function (v) {
        var n = Number(v);
        if (n > 0 && !ids[n]) ids[n] = 'früher';
      });
    });
    return ids;
  }

  function zeilenFuer(sollstellungen, konten, d, k, mitgliedId) {
    var kontoName = {};
    (d.Beitragskonto || []).forEach(function (x) { kontoName[x.beitragskonto_id] = x; });
    var anteilCache = {};
    return Beitrag.mitIndex(d, function () {
      return sollstellungen.map(function (s) {
        var anteil = null;
        if (mitgliedId) {
          var key = s.beitragskonto_id + ':' + s.jahr;
          if (!anteilCache[key]) anteilCache[key] = Beitrag.sollJeKonto(s.beitragskonto_id, d, s.jahr, { konfig: k });
          var pos = anteilCache[key].positionen.filter(function (p) { return p.mitglied_ids.indexOf(mitgliedId) >= 0; })[0];
          anteil = pos ? { art: pos.art, bezeichnung: pos.bezeichnung, betrag: pos.betrag } : null;
        }
        var kt = kontoName[s.beitragskonto_id] || {};
        return {
          sollstellung_id: s.sollstellung_id, jahr: s.jahr, beitragskonto_id: s.beitragskonto_id, kontoinhaber: kt.kontoinhaber_name || null,
          konto_bezug: konten ? konten[s.beitragskonto_id] || null : null,
          soll_betrag: s.soll_betrag, ist_betrag: s.ist_betrag, gebuehr: s.gebuehr, status: s.status, sepa_sequenz: s.sepa_sequenz,
          einzugsdatum: s.einzugsdatum, buchungsdatum: s.buchungsdatum, mahnstufe: s.mahnstufe,
          ruecklastschrift_grund: s.ruecklastschrift_grund, bemerkung: s.bemerkung, anteil: anteil
        };
      }).sort(function (a, b) { return b.jahr - a.jahr || a.beitragskonto_id - b.beitragskonto_id; });
    });
  }

  function bezahlhistorie(ktx, mitgliedId) {
    var id = Number(mitgliedId);
    Snapshot.pruefeMitglied(ktx, id);
    var x = daten();
    var m = (x.daten.Mitglied || []).filter(function (z) { return z.mitglied_id === id; })[0];
    if (!m) throw Fehler.fachlich('Das Mitglied wurde nicht gefunden.');
    var konten = kontenDerPerson(m);
    var soll = (x.daten.Sollstellung || []).filter(function (s) { return konten[s.beitragskonto_id]; });
    return {
      mitglied_id: id, name: name(m), konten: Object.keys(konten).map(function (k) { return { beitragskonto_id: Number(k), bezug: konten[k] }; }),
      zeilen: zeilenFuer(soll, konten, x.daten, x.konfig, id),
      jahre: Familie.jahressummen(soll),
      hinweis: 'Gestellte Beträge sind Schnappschüsse; der „Anteil“ der Person ist mit den heutigen Stammdaten nachgerechnet.'
    };
  }

  function kontohistorie(ktx, kontoId) {
    var id = Number(kontoId);
    var x = daten();
    var k = (x.daten.Beitragskonto || []).filter(function (z) { return z.beitragskonto_id === id; })[0];
    if (!k) throw Fehler.fachlich('Das Konto wurde nicht gefunden.');
    var soll = (x.daten.Sollstellung || []).filter(function (s) { return s.beitragskonto_id === id; });
    return { beitragskonto_id: id, kontoinhaber: k.kontoinhaber_name, zeilen: zeilenFuer(soll, null, x.daten, x.konfig, null), jahre: Familie.jahressummen(soll) };
  }

  /** Export-Vermerk (Listenname bereinigt, keine Personendaten im Protokoll). */
  function exportVermerken(ktx, liste, anzahl) {
    Protokoll.schreibe(ktx, [{ aktion: 'exportiert', tabelle: 'Familie', datensatz_id: '-', kommentar: Protokoll.listenname(liste) + ': ' + (Number(anzahl) || 0) + ' Zeilen' }]);
    return true;
  }

  return {
    uebersicht: uebersicht, ausscheider: ausscheider, umstellen: umstellen, ausbildungSpeichern: ausbildungSpeichern,
    bezahlhistorie: bezahlhistorie, kontohistorie: kontohistorie, exportVermerken: exportVermerken
  };
})();
