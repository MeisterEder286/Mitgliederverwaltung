/**
 * Auswertung – reine Zählfunktionen für die Ansicht „Auswertungen“ (Nachfolger der Access-Abfragen
 * AltersgruppenA, Gesamtmitglieder, Jug19A, 65neuA, SchiriA, Statistik, Mitgliederliste).
 *
 * Zweck:      Altersgruppen mit frei wählbaren Grenzen, Mitgliederentwicklung je Jahr, Gesamtzahlen nach Status/
 *             Abteilung/Geschlecht, Abteilungs-Kreuztabelle, Beitragsstruktur, Mitgliedsdauer, Wohnorte,
 *             Funktionsträger, Schiedsrichter, Altersübergänge (werden 18/19/65), Austrittsgründe.
 * Datenquelle: `daten` je Tab wie aus DB.lese bzw. Bereichsdaten.fuer (Mitglied, Mitgliedschaftszeitraum, Abteilung,
 *             Abteilungszugehoerigkeit, Funktion, Funktionsart, Beitragsart, Beitragsgemeinschaft, Sollstellung).
 *             Keine Apps-Script-Dienste – läuft in Node (Tests) und Apps Script gleich.
 * Wer darf was: – (reine Rechenfunktionen). Das Servermodul src/modul/Auswertung.js übergibt nur Daten, die der
 *             Aufrufer sehen darf (Abteilungsleiter: Sichtkreis), und rechnet vereinsweite Teile nur bei Sicht „alle“.
 * Besonderheiten:
 *   - Gezählt werden – wenn nicht anders angegeben – Personen mit Status „aktiv“ am Stichtag, ohne reine
 *     Funktionsträger (V6) und ohne anonymisierte Anker. Grundlage ist Mitgliedschaft.status (Zeiträume + Sterbedatum).
 *   - Alter: Standard nach Jahrgang (Stichtagsjahr − Geburtsjahr) wie in der BLSV-Meldung; Option 'exakt'.
 *   - [A] Die Grenzen der früheren Access-Abfrage AltersgruppenA sind nicht bekannt; Voreinstellungen „BLSV“ und
 *     „fein“ (bis 6 / 7–14 / 15–18 / 19–26 / 27–40 / 41–60 / ab 61) – in der Oberfläche frei änderbar.
 */
var Auswertung = (function () {

  var VORGABEN = {
    blsv: [14, 18, 26],
    fein: [6, 14, 18, 26, 40, 60]
  };

  function liste(daten, tab) { return (daten && daten[tab]) || []; }
  function laeuft(von, bis, tag) { return (!von || von <= tag) && (!bis || bis >= tag); }
  function jahrVon(iso) { return iso ? Number(String(iso).slice(0, 4)) : null; }

  function gruppiere(zeilen, feld) {
    var m = {};
    zeilen.forEach(function (z) { (m[z[feld]] = m[z[feld]] || []).push(z); });
    return m;
  }

  /** Gemeinsamer Index: Zeiträume, Zugehörigkeiten, Funktionen je Person; Abteilungen, Funktionsarten je ID. */
  function index(daten) {
    var ix = {
      zeitraeume: gruppiere(liste(daten, 'Mitgliedschaftszeitraum'), 'mitglied_id'),
      zugehoerig: gruppiere(liste(daten, 'Abteilungszugehoerigkeit'), 'mitglied_id'),
      funktionen: gruppiere(liste(daten, 'Funktion'), 'mitglied_id'),
      abteilung: {}, funktionsart: {}, beitragsart: {}
    };
    liste(daten, 'Abteilung').forEach(function (a) { ix.abteilung[a.abteilung_id] = a; });
    liste(daten, 'Funktionsart').forEach(function (f) { ix.funktionsart[f.funktionsart_id] = f; });
    liste(daten, 'Beitragsart').forEach(function (b) { ix.beitragsart[b.beitragsart_id] = b; });
    return ix;
  }

  function zeitraeume(ix, id) {
    return (ix.zeitraeume[id] || []).slice().sort(function (a, b) { return String(a.eintrittsdatum).localeCompare(String(b.eintrittsdatum)); });
  }

  /** Zählt die Person überhaupt als Mitglied (nicht reiner Funktionsträger, nicht anonymisiert)? */
  function zaehlbar(m) { return m.nur_funktionstraeger !== true && m.anonymisiert !== true; }

  /** Aktive Mitglieder am Stichtag. */
  function aktive(daten, ix, stichtag) {
    return liste(daten, 'Mitglied').filter(function (m) {
      return zaehlbar(m) && Mitgliedschaft.status(m, zeitraeume(ix, m.mitglied_id), stichtag) === 'aktiv';
    });
  }

  function alterVon(m, stichtag, modus) {
    if (!m.geburtsdatum) return null;
    return modus === 'exakt' ? Mitgliedschaft.alter(m.geburtsdatum, stichtag) : Mitgliedschaft.alterImJahr(m.geburtsdatum, jahrVon(stichtag));
  }

  function laufendeZugehoerigkeiten(ix, id, stichtag) {
    return (ix.zugehoerig[id] || []).filter(function (z) { return laeuft(z.eintrittsdatum, z.austrittsdatum, stichtag); });
  }

  // ------------------------------------------------------------------ Altersgruppen

  /** Gruppen aus Obergrenzen: [14, 18, 26] → bis 14 / 15–18 / 19–26 / ab 27. */
  function gruppenAus(grenzen) {
    var g = (grenzen || VORGABEN.blsv).map(Number).filter(function (x) { return isFinite(x) && x >= 0; })
      .sort(function (a, b) { return a - b; })
      .filter(function (x, i, arr) { return i === 0 || x !== arr[i - 1]; });
    var gruppen = [], von = 0;
    g.forEach(function (bis) {
      gruppen.push({ titel: von === 0 ? 'bis ' + bis : von + '–' + bis, von: von, bis: bis });
      von = bis + 1;
    });
    gruppen.push({ titel: 'ab ' + von, von: von, bis: 999 });
    return gruppen;
  }

  /**
   * Altersgruppen der aktiven Mitglieder.
   * optionen: { grenzen: [Obergrenzen], nach: null | 'abteilung' | 'geschlecht', modus: 'jahrgang' | 'exakt' }
   * Ergebnis: { gruppen, zeilen: [{ titel, werte: [n…], gesamt, davon_passiv }], gesamt: {…}, ohne_geburtsdatum }
   * Bei nach = 'abteilung' zählt eine Person in jeder Abteilung, in der sie am Stichtag ist (aktiv oder passiv).
   */
  function altersgruppen(daten, stichtag, optionen) {
    optionen = optionen || {};
    var ix = index(daten);
    var gruppen = gruppenAus(optionen.grenzen);
    function leer(titel) { return { titel: titel, werte: gruppen.map(function () { return 0; }), gesamt: 0, davon_passiv: 0, ohne_geburtsdatum: 0 }; }
    var zeilen = {}, gesamt = leer('Gesamt');
    function zaehle(z, alter, passiv) {
      z.gesamt++;
      if (passiv) z.davon_passiv++;
      if (alter === null) { z.ohne_geburtsdatum++; return; }
      for (var i = 0; i < gruppen.length; i++) if (alter >= gruppen[i].von && alter <= gruppen[i].bis) { z.werte[i]++; return; }
    }
    var GESCHLECHT = { m: 'männlich', w: 'weiblich', d: 'divers' };
    aktive(daten, ix, stichtag).forEach(function (m) {
      var alter = alterVon(m, stichtag, optionen.modus);
      var zs = laufendeZugehoerigkeiten(ix, m.mitglied_id, stichtag);
      var allePassiv = zs.length > 0 && zs.every(function (z) { return z.status === 'passiv'; });
      zaehle(gesamt, alter, allePassiv);
      if (optionen.nach === 'abteilung') {
        if (!zs.length) { zaehle(zeilen._ohne = zeilen._ohne || leer('ohne Abteilung'), alter, false); return; }
        zs.forEach(function (z) {
          var a = ix.abteilung[z.abteilung_id];
          var k = 'a' + z.abteilung_id;
          zaehle(zeilen[k] = zeilen[k] || leer(a ? a.bezeichnung : 'Abteilung ' + z.abteilung_id), alter, z.status === 'passiv');
        });
      } else if (optionen.nach === 'geschlecht') {
        var g = GESCHLECHT[m.geschlecht] || 'ohne Angabe';
        zaehle(zeilen[g] = zeilen[g] || leer(g), alter, allePassiv);
      }
    });
    var liste_ = Object.keys(zeilen).map(function (k) { return zeilen[k]; })
      .sort(function (a, b) { return a.titel === 'ohne Abteilung' ? 1 : b.titel === 'ohne Abteilung' ? -1 : String(a.titel).localeCompare(String(b.titel)); });
    return { stichtag: stichtag, gruppen: gruppen, zeilen: liste_, gesamt: gesamt };
  }

  // ------------------------------------------------------------------ Entwicklung

  /**
   * Eintritte/Austritte je Kalenderjahr und Bestand zum Jahreswechsel (inkl. Wiedereintritte als Eintritt).
   * Austritt = Ende eines Zeitraums (austrittsdatum bzw. austritt_wirksam) – auch Sterbefälle.
   * Ergebnis: [{ jahr, eintritte, davon_wiedereintritte, austritte, saldo, bestand, bestand_am }]
   * bisTag (optional): Bestand des letzten Jahres zu diesem Tag statt 31.12. (laufendes Jahr: „bis heute“).
   */
  function entwicklung(daten, vonJahr, bisJahr, bisTag) {
    var ix = index(daten);
    var jahre = {};
    for (var j = vonJahr; j <= bisJahr; j++) {
      // Bestand zum Jahreswechsel (1.1. des Folgejahres – Austritte zum 31.12. sind dann draußen);
      // laufendes Jahr: zum übergebenen Tag.
      var tag = j === bisJahr && bisTag && bisTag < j + '-12-31' ? bisTag : (j + 1) + '-01-01';
      jahre[j] = { jahr: j, eintritte: 0, davon_wiedereintritte: 0, austritte: 0, saldo: 0, bestand: 0, bestand_am: tag };
    }
    var mitglieder = liste(daten, 'Mitglied').filter(zaehlbar);
    mitglieder.forEach(function (m) {
      var zs = zeitraeume(ix, m.mitglied_id);
      zs.forEach(function (z, i) {
        var je = jahrVon(z.eintrittsdatum);
        if (jahre[je] && (z.eintrittsdatum <= jahre[je].bestand_am)) { jahre[je].eintritte++; if (i > 0) jahre[je].davon_wiedereintritte++; }
        var ende = Mitgliedschaft.endeVon(z);
        var ja = jahrVon(ende);
        if (ja && jahre[ja] && ende < jahre[ja].bestand_am) jahre[ja].austritte++;
      });
      if (!zs.length) return;
      Object.keys(jahre).forEach(function (k) {
        if (Mitgliedschaft.status(m, zs, jahre[k].bestand_am) === 'aktiv') jahre[k].bestand++;
      });
    });
    return Object.keys(jahre).map(function (k) { var x = jahre[k]; x.saldo = x.eintritte - x.austritte; return x; })
      .sort(function (a, b) { return a.jahr - b.jahr; });
  }

  /** Austrittsgründe je Jahr: [{ grund, gesamt, je_jahr: { 2024: n } }] */
  function austrittsgruende(daten, vonJahr, bisJahr) {
    var ix = index(daten), m = {};
    liste(daten, 'Mitglied').filter(zaehlbar).forEach(function (p) {
      zeitraeume(ix, p.mitglied_id).forEach(function (z) {
        var j = jahrVon(Mitgliedschaft.endeVon(z));
        if (!j || j < vonJahr || j > bisJahr) return;
        var g = z.austrittsgrund || (p.sterbedatum && Mitgliedschaft.endeVon(z) >= p.sterbedatum ? 'verstorben' : 'ohne Angabe');
        var e = m[g] = m[g] || { grund: g, gesamt: 0, je_jahr: {} };
        e.gesamt++;
        e.je_jahr[j] = (e.je_jahr[j] || 0) + 1;
      });
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.gesamt - a.gesamt; });
  }

  // ------------------------------------------------------------------ Gesamtzahlen (Access „Gesamtmitglieder“)

  /**
   * Summen am Stichtag: Status (aktiv, davon gekündigt, ausgetreten, verstorben, ohne Mitgliedschaft),
   * je Abteilung (aktiv/passiv), je Geschlecht, Anzahl Abteilungen je Person.
   */
  function gesamt(daten, stichtag) {
    var ix = index(daten);
    var status = { aktiv: 0, davon_gekuendigt: 0, ausgetreten: 0, verstorben: 0, nur_funktionstraeger: 0 };
    var geschlecht = { maennlich: 0, weiblich: 0, divers: 0, ohne_angabe: 0 };
    var abteilungen = {}, anzahlAbteilungen = { 0: 0, 1: 0, 2: 0, '3+': 0 };
    liste(daten, 'Mitglied').forEach(function (m) {
      if (m.anonymisiert === true) return;
      if (m.nur_funktionstraeger === true) { status.nur_funktionstraeger++; return; }
      var zs = zeitraeume(ix, m.mitglied_id);
      var s = Mitgliedschaft.status(m, zs, stichtag);
      if (s === 'verstorben') { status.verstorben++; return; }
      if (s !== 'aktiv') { if (s === 'ausgetreten') status.ausgetreten++; return; }
      status.aktiv++;
      if (Mitgliedschaft.gekuendigt(zs, stichtag)) status.davon_gekuendigt++;
      var g = { m: 'maennlich', w: 'weiblich', d: 'divers' }[m.geschlecht] || 'ohne_angabe';
      geschlecht[g]++;
      var laufend = laufendeZugehoerigkeiten(ix, m.mitglied_id, stichtag);
      var n = laufend.length;
      anzahlAbteilungen[n >= 3 ? '3+' : n]++;
      laufend.forEach(function (z) {
        var a = ix.abteilung[z.abteilung_id];
        var e = abteilungen[z.abteilung_id] = abteilungen[z.abteilung_id] ||
          { abteilung_id: z.abteilung_id, bezeichnung: a ? a.bezeichnung : String(z.abteilung_id), gesamt: 0, aktiv: 0, passiv: 0 };
        e.gesamt++;
        if (z.status === 'passiv') e.passiv++; else e.aktiv++;
      });
    });
    return {
      stichtag: stichtag, status: status, geschlecht: geschlecht, anzahl_abteilungen: anzahlAbteilungen,
      abteilungen: Object.keys(abteilungen).map(function (k) { return abteilungen[k]; })
        .sort(function (a, b) { return String(a.bezeichnung).localeCompare(String(b.bezeichnung)); })
    };
  }

  /** Kreuztabelle: Wie viele aktive Personen sind gleichzeitig in Abteilung X und Y? { abteilungen: [..], matrix: [[n]] } */
  function kreuztabelle(daten, stichtag) {
    var ix = index(daten);
    var abt = liste(daten, 'Abteilung').slice().sort(function (a, b) { return String(a.bezeichnung).localeCompare(String(b.bezeichnung)); });
    var pos = {};
    abt.forEach(function (a, i) { pos[a.abteilung_id] = i; });
    var matrix = abt.map(function () { return abt.map(function () { return 0; }); });
    aktive(daten, ix, stichtag).forEach(function (m) {
      var ids = laufendeZugehoerigkeiten(ix, m.mitglied_id, stichtag).map(function (z) { return z.abteilung_id; })
        .filter(function (id, i, arr) { return pos[id] !== undefined && arr.indexOf(id) === i; });
      ids.forEach(function (a) { ids.forEach(function (b) { matrix[pos[a]][pos[b]]++; }); });
    });
    return { stichtag: stichtag, abteilungen: abt.map(function (a) { return { abteilung_id: a.abteilung_id, bezeichnung: a.bezeichnung }; }), matrix: matrix };
  }

  // ------------------------------------------------------------------ Beitragsstruktur

  /**
   * Wer zahlt was (aktive Mitglieder am Stichtag): je Beitragsart (ohne Personen in einer Gemeinschaft mit Festbetrag)
   * Anzahl und rechnerische Summe; Gemeinschaften (Anzahl, Personen, Summe Festbetrag); Soll des Jahres aus
   * Sollstellung (ohne storniert). Braucht Finanzsicht.
   */
  function beitragsstruktur(daten, stichtag, jahr) {
    var ix = index(daten);
    var gem = {};
    liste(daten, 'Beitragsgemeinschaft').forEach(function (g) { gem[g.beitragsgemeinschaft_id] = g; });
    var arten = {}, gemeinschaften = {}, ohne = 0;
    aktive(daten, ix, stichtag).forEach(function (m) {
      var g = m.beitragsgemeinschaft_id ? gem[m.beitragsgemeinschaft_id] : null;
      if (g && g.festbetrag !== null && g.festbetrag !== undefined && g.festbetrag !== '') {
        var e = gemeinschaften[g.beitragsgemeinschaft_id] = gemeinschaften[g.beitragsgemeinschaft_id] ||
          { beitragsgemeinschaft_id: g.beitragsgemeinschaft_id, bezeichnung: g.bezeichnung, festbetrag: Number(g.festbetrag), personen: 0 };
        e.personen++;
        return;
      }
      var b = ix.beitragsart[m.beitragsart_id];
      if (!b) { ohne++; return; }
      var a = arten[b.beitragsart_id] = arten[b.beitragsart_id] ||
        { beitragsart_id: b.beitragsart_id, bezeichnung: b.bezeichnung, betrag: Number(b.betrag) || 0, anzahl: 0, summe: 0 };
      a.anzahl++;
      a.summe = Math.round(a.anzahl * a.betrag * 100) / 100;
    });
    var gl = Object.keys(gemeinschaften).map(function (k) { return gemeinschaften[k]; });
    var soll = liste(daten, 'Sollstellung').filter(function (s) { return Number(s.jahr) === Number(jahr) && s.status !== 'storniert'; })
      .reduce(function (n, s) { return n + (Number(s.soll_betrag) || 0); }, 0);
    return {
      stichtag: stichtag, jahr: jahr,
      beitragsarten: Object.keys(arten).map(function (k) { return arten[k]; }).sort(function (a, b) { return b.anzahl - a.anzahl; }),
      gemeinschaften: { anzahl: gl.length, personen: gl.reduce(function (n, g) { return n + g.personen; }, 0),
        summe: Math.round(gl.reduce(function (n, g) { return n + g.festbetrag; }, 0) * 100) / 100,
        je_betrag: gl.reduce(function (o, g) { o[g.festbetrag] = (o[g.festbetrag] || 0) + 1; return o; }, {}) },
      ohne_beitrag: ohne,
      soll_jahr: Math.round(soll * 100) / 100
    };
  }

  // ------------------------------------------------------------------ Dauer, Wohnorte, Funktionen

  /** Verteilung der Mitgliedsjahre (Klassen à 5 Jahre, ab 50 zusammengefasst). modus wie _Konfig.ehrung_zaehlweise. */
  function mitgliedsdauer(daten, stichtag, modus) {
    var ix = index(daten);
    var klassen = [];
    for (var v = 0; v < 50; v += 5) klassen.push({ titel: v + '–' + (v + 4) + ' Jahre', von: v, bis: v + 4, anzahl: 0 });
    klassen.push({ titel: 'ab 50 Jahre', von: 50, bis: 999, anzahl: 0 });
    var summe = 0, n = 0;
    aktive(daten, ix, stichtag).forEach(function (m) {
      var j = Mitgliedschaft.mitgliedsjahre(zeitraeume(ix, m.mitglied_id), stichtag, modus || 'letzter_eintritt', 'exakter_tag');
      summe += j; n++;
      for (var i = 0; i < klassen.length; i++) if (j >= klassen[i].von && j <= klassen[i].bis) { klassen[i].anzahl++; break; }
    });
    return { stichtag: stichtag, klassen: klassen, durchschnitt: n ? Math.round(summe / n * 10) / 10 : null };
  }

  /** Wohnorte der aktiven Mitglieder (PLZ + Ort), absteigend; Rest als „übrige“. */
  function wohnorte(daten, stichtag, anzahl) {
    var ix = index(daten), m = {}, n = 0;
    aktive(daten, ix, stichtag).forEach(function (p) {
      var k = (p.plz || '') + ' ' + (p.ort || '');
      k = k.trim() || 'ohne Anschrift';
      m[k] = (m[k] || 0) + 1; n++;
    });
    var l = Object.keys(m).map(function (k) { return { ort: k, anzahl: m[k], anteil: n ? Math.round(m[k] / n * 1000) / 10 : 0 }; })
      .sort(function (a, b) { return b.anzahl - a.anzahl || a.ort.localeCompare(b.ort); });
    var top = l.slice(0, anzahl || 15);
    var rest = l.slice(anzahl || 15).reduce(function (s, x) { return s + x.anzahl; }, 0);
    if (rest) top.push({ ort: 'übrige Orte', anzahl: rest, anteil: n ? Math.round(rest / n * 1000) / 10 : 0 });
    return { stichtag: stichtag, gesamt: n, orte: top };
  }

  /** Laufende Funktionen am Stichtag: je Funktionsart und Ebene/Abteilung + Liste. */
  function funktionstraeger(daten, stichtag) {
    var ix = index(daten);
    var mitglied = {};
    liste(daten, 'Mitglied').forEach(function (m) { mitglied[m.mitglied_id] = m; });
    var eintraege = liste(daten, 'Funktion').filter(function (f) { return laeuft(f.von, f.bis, stichtag); }).map(function (f) {
      var art = ix.funktionsart[f.funktionsart_id] || {};
      var a = f.abteilung_id ? ix.abteilung[f.abteilung_id] : null;
      var m = mitglied[f.mitglied_id] || {};
      return { funktion_id: f.funktion_id, mitglied_id: f.mitglied_id, mitgliedsnummer: m.mitgliedsnummer || null,
        name: [m.nachname, m.vorname].filter(Boolean).join(', '), funktion: art.bezeichnung || '–',
        ebene: a ? a.bezeichnung : 'Verein', zusatz: f.zusatz || null, seit: f.von, fz_pflichtig: art.fz_pflichtig === true };
    });
    var je = {};
    eintraege.forEach(function (e) {
      var k = e.funktion + '|' + e.ebene;
      (je[k] = je[k] || { funktion: e.funktion, ebene: e.ebene, anzahl: 0 }).anzahl++;
    });
    return {
      stichtag: stichtag, personen: eintraege.map(function (e) { return e.mitglied_id; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).length,
      je_funktion: Object.keys(je).map(function (k) { return je[k]; }).sort(function (a, b) { return b.anzahl - a.anzahl || a.funktion.localeCompare(b.funktion); }),
      eintraege: eintraege.sort(function (a, b) { return a.name.localeCompare(b.name); })
    };
  }

  /** Schiedsrichter (Access SchiriA): laufende Funktionen, deren Funktionsart „Schiedsrichter“ enthält. */
  function schiedsrichter(daten, stichtag) {
    return funktionstraeger(daten, stichtag).eintraege.filter(function (e) { return /schiedsricht/i.test(e.funktion); });
  }

  // ------------------------------------------------------------------ Altersübergänge (Jug19A, 65neuA)

  /** Passende Beitragsart für ein Alter (aktive Arten mit Altersgrenzen; ohne Grenzen – z. B. Fördermitglied – nie). */
  function artFuerAlter(beitragsarten, alter) {
    var passend = beitragsarten.filter(function (b) {
      if (b.aktiv === false) return false;
      var von = b.alter_von === null || b.alter_von === undefined || b.alter_von === '' ? null : Number(b.alter_von);
      var bis = b.alter_bis === null || b.alter_bis === undefined || b.alter_bis === '' ? null : Number(b.alter_bis);
      if (von === null && bis === null) return false;
      return (von === null || alter >= von) && (bis === null || alter <= bis);
    });
    // engste Spanne zuerst (z. B. „Senioren ab 65“ vor „Erwachsene ab 18“)
    passend.sort(function (a, b) { return (Number(b.alter_von) || 0) - (Number(a.alter_von) || 0); });
    return passend[0] || null;
  }

  /**
   * Aktive Mitglieder, die im Kalenderjahr `jahr` eines der `alter` (Standard 18, 19, 65) erreichen – mit aktueller und
   * künftiger Beitragsart (Tarifwechsel zum Jahreswechsel). Personen in einer Gemeinschaft mit Festbetrag: Hinweis
   * auf die Familienübersicht statt automatischem Wechsel.
   */
  function uebergaenge(daten, jahr, alter, stichtag) {
    var ix = index(daten);
    var grenzen = (alter && alter.length ? alter : [18, 19, 65]).map(Number);
    var gem = {};
    liste(daten, 'Beitragsgemeinschaft').forEach(function (g) { gem[g.beitragsgemeinschaft_id] = g; });
    var arten = liste(daten, 'Beitragsart');
    var aus = [];
    aktive(daten, ix, stichtag || (jahr - 1) + '-12-31').forEach(function (m) {
      var a = m.geburtsdatum ? Mitgliedschaft.alterImJahr(m.geburtsdatum, jahr) : null;
      if (a === null || grenzen.indexOf(a) < 0) return;
      var aktuell = ix.beitragsart[m.beitragsart_id] || null;
      var g = m.beitragsgemeinschaft_id ? gem[m.beitragsgemeinschaft_id] : null;
      var kuenftig = artFuerAlter(arten, a);
      var hinweis = null;
      if (g && g.festbetrag !== null && g.festbetrag !== undefined && g.festbetrag !== '') hinweis = 'in Gemeinschaft „' + g.bezeichnung + '“ – siehe Familienübersicht';
      else if (aktuell && (aktuell.alter_von === null || aktuell.alter_von === undefined) && (aktuell.alter_bis === null || aktuell.alter_bis === undefined)) hinweis = 'Beitragsart ohne Altersgrenze – kein Wechsel';
      aus.push({
        mitglied_id: m.mitglied_id, mitgliedsnummer: m.mitgliedsnummer, name: [m.nachname, m.vorname].filter(Boolean).join(', '),
        geburtsdatum: m.geburtsdatum, wird: a,
        aktuell: aktuell ? aktuell.bezeichnung : (g ? g.bezeichnung : null),
        kuenftig: hinweis ? null : (kuenftig ? kuenftig.bezeichnung : null),
        wechsel: !hinweis && !!kuenftig && (!aktuell || kuenftig.beitragsart_id !== aktuell.beitragsart_id),
        hinweis: hinweis
      });
    });
    return aus.sort(function (x, y) { return x.wird - y.wird || String(x.geburtsdatum).localeCompare(String(y.geburtsdatum)); });
  }

  /** PLZ → häufigster Ort (für Formular-Vorschläge). */
  function plzOrte(mitglieder) {
    var z = {};
    (mitglieder || []).forEach(function (m) {
      if (!m.plz || !m.ort) return;
      var e = z[m.plz] = z[m.plz] || {};
      e[m.ort] = (e[m.ort] || 0) + 1;
    });
    var aus = {};
    Object.keys(z).forEach(function (p) {
      aus[p] = Object.keys(z[p]).sort(function (a, b) { return z[p][b] - z[p][a] || a.localeCompare(b); })[0];
    });
    return aus;
  }

  /** Anrede → Geschlecht (korrigiert den Access-Fehler: alles außer „Herr“ wurde „w“). Unbekannt → null. */
  function geschlechtAusAnrede(anrede) {
    return { Herr: 'm', Frau: 'w', Divers: 'd' }[String(anrede || '').trim()] || null;
  }

  return {
    VORGABEN: VORGABEN, gruppenAus: gruppenAus, altersgruppen: altersgruppen, entwicklung: entwicklung,
    austrittsgruende: austrittsgruende, gesamt: gesamt, kreuztabelle: kreuztabelle, beitragsstruktur: beitragsstruktur,
    mitgliedsdauer: mitgliedsdauer, wohnorte: wohnorte, funktionstraeger: funktionstraeger, schiedsrichter: schiedsrichter,
    uebergaenge: uebergaenge, artFuerAlter: artFuerAlter, plzOrte: plzOrte, geschlechtAusAnrede: geschlechtAusAnrede
  };
})();
