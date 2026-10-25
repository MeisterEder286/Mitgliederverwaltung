/**
 * Blsv – Bestandserhebung für den BLSV (Meldung über verein360, Frist 31.01.) und eingefrorene Jahresstatistik.
 *
 * Zweck:      Zählt die Mitglieder zum Stichtag je BLSV-Sportart und für den Verein gesamt (Geschlecht,
 *             Altersklassen, davon passiv), erzeugt daraus die Zeilen für den Tab Statistik_Jahr und eine CSV.
 * Datenquelle: `daten` je Tab wie aus DB.lese (Mitglied, Mitgliedschaftszeitraum, Abteilung,
 *             Abteilungszugehoerigkeit, Funktion, Beitragsgemeinschaft, Sollstellung).
 * Wer darf was: – (Rechteprüfung vor dem Aufruf; Bericht/Export: Aktion export, Einfrieren: Verwaltung).
 * Besonderheiten:
 *   - Eine Person in mehreren Abteilungen zählt je Sportart einmal, im Verein aber nur einmal (Übergabe §7).
 *     Zwei Abteilungen mit gleicher blsv_sportart werden zu einer Sportart zusammengefasst.
 *   - Gezählt werden Personen mit Status „aktiv“ am Stichtag, ohne reine Funktionsträger (V6). Für eine
 *     Sportart zählt die am Stichtag laufende Abteilungszugehörigkeit in einer meldepflichtigen Abteilung.
 *   - [A] Alter nach Jahrgang (Stichtagsjahr − Geburtsjahr), wie bei Verbandsmeldungen üblich. Option
 *     altersmodus: 'exakt' zählt volle Jahre am Stichtag. Klassen wie Statistik_Jahr: bis 14, 15–18, 19–26, ab 27.
 *   - [?] Das genaue Importformat von verein360 ist nicht bekannt. csv() liefert eine lesbare Tabelle als
 *     Vorlage; vor der ersten Meldung mit der aktuellen Importvorlage des BLSV abgleichen.
 *   - Berichtsjahr der Zusatzzahlen (Eintritte, Austritte, Beitragssoll/-ist) = das Jahr VOR dem Stichtag,
 *     wenn der Stichtag ein 01.01. ist (Bestand zum 01.01.2026 → Bewegungen 2025) [A].
 */
var Blsv = (function () {

  var KLASSEN = [
    { feld: 'alter_bis_14', von: 0, bis: 14 },
    { feld: 'alter_15_18', von: 15, bis: 18 },
    { feld: 'alter_19_26', von: 19, bis: 26 },
    { feld: 'alter_ab_27', von: 27, bis: 999 }
  ];

  function liste(daten, tab) { return (daten && daten[tab]) || []; }
  function laeuft(von, bis, tag) { return (!von || von <= tag) && (!bis || bis >= tag); }

  function leereZahlen() {
    var z = { gesamt: 0, maennlich: 0, weiblich: 0, divers: 0, ohne_geschlecht: 0, davon_passiv: 0, ohne_geburtsdatum: 0 };
    KLASSEN.forEach(function (k) { z[k.feld] = 0; });
    return z;
  }

  function zaehle(z, m, alter, passiv) {
    z.gesamt++;
    if (m.geschlecht === 'm') z.maennlich++;
    else if (m.geschlecht === 'w') z.weiblich++;
    else if (m.geschlecht === 'd') z.divers++;
    else z.ohne_geschlecht++;
    if (alter === null) z.ohne_geburtsdatum++;
    else KLASSEN.forEach(function (k) { if (alter >= k.von && alter <= k.bis) z[k.feld]++; });
    if (passiv) z.davon_passiv++;
  }

  /**
   * Bestand zum Stichtag. optionen: { altersmodus: 'jahrgang' (Standard) | 'exakt' }.
   * Ergebnis: { stichtag, verein, sportarten: [{ sportart, abteilung_ids, ... }], abteilungen: [...],
   *             summe_sportarten, mehrfach (Personen in >1 Sportart), pruefliste: [{ art, mitglied_id|abteilung_id, meldung }] }
   */
  function bestand(daten, stichtag, optionen) {
    optionen = optionen || {};
    var M = Mitgliedschaft;
    var zeitraeume = {};
    liste(daten, 'Mitgliedschaftszeitraum').forEach(function (z) { (zeitraeume[z.mitglied_id] = zeitraeume[z.mitglied_id] || []).push(z); });
    var abteilungen = {};
    liste(daten, 'Abteilung').forEach(function (a) { abteilungen[a.abteilung_id] = a; });
    var zugehoerig = {};
    liste(daten, 'Abteilungszugehoerigkeit').forEach(function (z) {
      if (laeuft(z.eintrittsdatum, z.austrittsdatum, stichtag)) (zugehoerig[z.mitglied_id] = zugehoerig[z.mitglied_id] || []).push(z);
    });

    var pruefliste = [];
    var verein = leereZahlen();
    var proSportart = {}, proAbteilung = {};
    var mehrfach = 0;

    Object.keys(abteilungen).forEach(function (id) {
      var a = abteilungen[id];
      if (a.meldepflichtig === true && !a.blsv_sportart) {
        pruefliste.push({ art: 'sportart_fehlt', abteilung_id: a.abteilung_id, meldung: 'Abteilung „' + a.bezeichnung + '“ ist meldepflichtig, hat aber keine BLSV-Sportart.' });
      }
    });

    liste(daten, 'Mitglied').forEach(function (m) {
      if (m.nur_funktionstraeger === true || m.anonymisiert === true) return;
      if (M.status(m, zeitraeume[m.mitglied_id] || [], stichtag) !== 'aktiv') return;
      var alter = !m.geburtsdatum ? null
        : optionen.altersmodus === 'exakt' ? M.alter(m.geburtsdatum, stichtag) : M.alterImJahr(m.geburtsdatum, Number(stichtag.slice(0, 4)));
      var zs = (zugehoerig[m.mitglied_id] || []).filter(function (z) {
        var a = abteilungen[z.abteilung_id];
        return a && a.meldepflichtig === true;
      });
      var allePassiv = zs.length > 0 && zs.every(function (z) { return z.status === 'passiv'; });
      zaehle(verein, m, alter, allePassiv);
      if (!m.geburtsdatum) pruefliste.push({ art: 'geburtsdatum_fehlt', mitglied_id: m.mitglied_id, meldung: 'Geburtsdatum fehlt (Altersklasse).' });
      if (!m.geschlecht) pruefliste.push({ art: 'geschlecht_fehlt', mitglied_id: m.mitglied_id, meldung: 'Geschlecht fehlt.' });

      var sportartenDerPerson = {};
      zs.forEach(function (z) {
        var a = abteilungen[z.abteilung_id];
        var pa = proAbteilung[a.abteilung_id] = proAbteilung[a.abteilung_id] ||
          { abteilung_id: a.abteilung_id, bezeichnung: a.bezeichnung, sportart: a.blsv_sportart || null, zahlen: leereZahlen() };
        zaehle(pa.zahlen, m, alter, z.status === 'passiv');
        if (!a.blsv_sportart) return;
        var s = sportartenDerPerson[a.blsv_sportart] = sportartenDerPerson[a.blsv_sportart] || { passiv: true };
        if (z.status !== 'passiv') s.passiv = false;
        var ps = proSportart[a.blsv_sportart] = proSportart[a.blsv_sportart] ||
          { sportart: a.blsv_sportart, abteilung_ids: [], zahlen: leereZahlen() };
        if (ps.abteilung_ids.indexOf(a.abteilung_id) < 0) ps.abteilung_ids.push(a.abteilung_id);
      });
      var namen = Object.keys(sportartenDerPerson);
      namen.forEach(function (n) { zaehle(proSportart[n].zahlen, m, alter, sportartenDerPerson[n].passiv); });
      if (namen.length > 1) mehrfach++;
    });

    function flach(o) { var r = {}; Object.keys(o).forEach(function (k) { if (k !== 'zahlen') r[k] = o[k]; }); Object.keys(o.zahlen).forEach(function (k) { r[k] = o.zahlen[k]; }); return r; }
    var sportarten = Object.keys(proSportart).sort().map(function (k) { return flach(proSportart[k]); });
    return {
      stichtag: stichtag,
      verein: verein,
      sportarten: sportarten,
      abteilungen: Object.keys(proAbteilung).map(function (k) { return flach(proAbteilung[k]); })
        .sort(function (a, b) { return String(a.bezeichnung).localeCompare(String(b.bezeichnung)); }),
      summe_sportarten: sportarten.reduce(function (s, x) { return s + x.gesamt; }, 0),
      mehrfach: mehrfach,
      pruefliste: pruefliste
    };
  }

  /** Bewegungs- und Finanzkennzahlen des Berichtsjahres (Jahr vor dem Stichtag bei Stichtag 01.01.). */
  function kennzahlen(daten, stichtag) {
    var j = Number(stichtag.slice(0, 4));
    var berichtsjahr = stichtag.slice(5) === '01-01' ? j - 1 : j;
    var von = berichtsjahr + '-01-01', bis = berichtsjahr + '-12-31';
    var ein = 0, aus = 0;
    liste(daten, 'Mitgliedschaftszeitraum').forEach(function (z) {
      if (z.eintrittsdatum && z.eintrittsdatum >= von && z.eintrittsdatum <= bis) ein++;
      var ende = z.austrittsdatum || z.austritt_wirksam;
      if (ende && ende >= von && ende <= bis) aus++;
    });
    var ftVerein = {}, ftAbt = {};
    liste(daten, 'Funktion').forEach(function (f) {
      if (!laeuft(f.von, f.bis, stichtag)) return;
      ftVerein[f.mitglied_id] = true;
      if (f.abteilung_id) { ftAbt[f.abteilung_id] = ftAbt[f.abteilung_id] || {}; ftAbt[f.abteilung_id][f.mitglied_id] = true; }
    });
    var abtEin = {}, abtAus = {};
    liste(daten, 'Abteilungszugehoerigkeit').forEach(function (z) {
      if (z.eintrittsdatum && z.eintrittsdatum >= von && z.eintrittsdatum <= bis) abtEin[z.abteilung_id] = (abtEin[z.abteilung_id] || 0) + 1;
      if (z.austrittsdatum && z.austrittsdatum >= von && z.austrittsdatum <= bis) abtAus[z.abteilung_id] = (abtAus[z.abteilung_id] || 0) + 1;
    });
    var soll = 0, ist = 0;
    liste(daten, 'Sollstellung').forEach(function (s) {
      if (Number(s.jahr) !== berichtsjahr || s.status === 'storniert') return;
      soll += Number(s.soll_betrag) || 0;
      ist += Number(s.ist_betrag) || 0;
    });
    var gemeinschaften = liste(daten, 'Beitragsgemeinschaft').filter(function (g) { return g.aktiv !== false; }).length;
    return {
      berichtsjahr: berichtsjahr,
      eintritte: ein, austritte: aus, funktionstraeger: Object.keys(ftVerein).length,
      beitragsgemeinschaften: gemeinschaften,
      beitragssoll: Math.round(soll * 100) / 100, beitragsist: Math.round(ist * 100) / 100,
      abteilung: { eintritte: abtEin, austritte: abtAus,
        funktionstraeger: Object.keys(ftAbt).reduce(function (o, k) { o[k] = Object.keys(ftAbt[k]).length; return o; }, {}) }
    };
  }

  /**
   * Zeilen für Statistik_Jahr (ohne statistik_id – vergibt DB.einfuegen). Eine Zeile „Verein“, je Abteilung eine Zeile.
   * zusatz = kennzahlen(daten, stichtag); eingefrorenAm 'JJJJ-MM-TT'.
   */
  function statistikZeilen(b, jahr, stichtag, zusatz, eingefrorenAm, blsvGemeldetAm) {
    zusatz = zusatz || {};
    var abt = zusatz.abteilung || { eintritte: {}, austritte: {}, funktionstraeger: {} };
    function zeile(ebene, id, name, z, extra) {
      var r = { jahr: jahr, stichtag: stichtag, ebene: ebene, abteilung_id: id, abteilung_bezeichnung: name,
        mitglieder_gesamt: z.gesamt, davon_passiv: z.davon_passiv, maennlich: z.maennlich, weiblich: z.weiblich, divers: z.divers };
      KLASSEN.forEach(function (k) { r[k.feld] = z[k.feld]; });
      Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
      r.eingefroren_am = eingefrorenAm || null;
      r.blsv_gemeldet_am = blsvGemeldetAm || null;
      r.bemerkung = null;
      return r;
    }
    var zeilen = [zeile('Verein', null, 'TSV Ergoldsbach', b.verein, {
      eintritte: zusatz.eintritte === undefined ? null : zusatz.eintritte,
      austritte: zusatz.austritte === undefined ? null : zusatz.austritte,
      funktionstraeger: zusatz.funktionstraeger === undefined ? null : zusatz.funktionstraeger,
      beitragsgemeinschaften: zusatz.beitragsgemeinschaften === undefined ? null : zusatz.beitragsgemeinschaften,
      beitragssoll: zusatz.beitragssoll === undefined ? null : zusatz.beitragssoll,
      beitragsist: zusatz.beitragsist === undefined ? null : zusatz.beitragsist
    })];
    b.abteilungen.forEach(function (a) {
      var r = zeile('Abteilung', a.abteilung_id, a.bezeichnung, a, {
        eintritte: abt.eintritte[a.abteilung_id] || 0, austritte: abt.austritte[a.abteilung_id] || 0,
        funktionstraeger: abt.funktionstraeger[a.abteilung_id] || 0,
        beitragsgemeinschaften: null, beitragssoll: null, beitragsist: null
      });
      if (a.sportart && a.sportart !== a.bezeichnung) r.bemerkung = 'BLSV-Sportart: ' + a.sportart;
      zeilen.push(r);
    });
    return zeilen;
  }

  /** Tabelle als CSV (Semikolon, eine Zeile je Sportart + Verein). [?] Format von verein360 vor Nutzung prüfen. */
  function csv(b) {
    var kopf = ['Sportart', 'gesamt', 'männlich', 'weiblich', 'divers', 'bis 14', '15–18', '19–26', 'ab 27'];
    function z(name, x) {
      return [name, x.gesamt, x.maennlich, x.weiblich, x.divers, x.alter_bis_14, x.alter_15_18, x.alter_19_26, x.alter_ab_27].join(';');
    }
    return [kopf.join(';')].concat(b.sportarten.map(function (s) { return z(s.sportart, s); }))
      .concat([z('Mitglieder im Verein', b.verein)]).join('\r\n');
  }

  return { KLASSEN: KLASSEN, bestand: bestand, kennzahlen: kennzahlen, statistikZeilen: statistikZeilen, csv: csv };
})();
