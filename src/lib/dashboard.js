/**
 * Dashboard – Zahlen für die Ansicht „Dashboard“ (reine Rechenfunktionen, in Node testbar).
 *
 * Zweck:      Mitgliederverlauf über ein Kalenderjahr (Monatsbestand, Eintritte, Austritte, Vorjahresvergleich),
 *             Einnahmen (eingegangene Beiträge je Monat nach Buchungsdatum, Soll/Ist/offen je Beitragsjahr) und
 *             Ehrungs-Vorschau (wie viele Ehrungen in welchem Jahr anstehen, je Ehrung aufgeschlüsselt).
 * Datenquelle: `daten` je Tab wie aus DB.lese bzw. Bereichsdaten.fuer (Mitglied, Mitgliedschaftszeitraum,
 *             Sollstellung, Ehrungsregel, Ehrung, Funktion, Funktionsart, Abteilung); `konfig` aus _Konfig.
 *             Keine Apps-Script-Dienste.
 * Wer darf was: – (reine Rechenfunktionen). Das Servermodul src/modul/Dashboard.js prüft Rolle und Sicht.
 * Besonderheiten:
 *   - Bestand zum Monatsende = Mitglieder am letzten Tag des Monats; wer an diesem Tag ausscheidet, zählt nicht
 *     mehr mit, wer am 1. des Folgemonats eintritt, noch nicht. So gilt immer Bestand = Vormonat + Eintritte −
 *     Austritte. (Auswertung.entwicklung rechnet den Jahresbestand zum 1.1.; Eintritte genau zum 1.1. zählt sie
 *     schon im alten Jahr mit – hier nicht, deshalb kann der Jahresendstand um diese Fälle abweichen.)
 *     Der laufende Monat endet am heutigen Tag, spätere Monate des laufenden Jahres bleiben leer (null).
 *   - Gezählt werden Personen wie in Auswertung (ohne reine Funktionsträger und Anonymisierte).
 *   - Einnahmen: je Monat die Summe der ist_betrag-Werte nach buchungsdatum; Zahlungen ohne Buchungsdatum stehen
 *     gesondert („ohne_datum“), damit die Monatssumme nichts verschweigt. Stornierte Sollstellungen zählen nicht.
 *   - Ehrungs-Vorschau ist eine Prognose bei unverändertem Bestand: wer bis zum Jahresende noch austritt, fällt
 *     heraus. Bereits verliehene/abgelehnte Ehrungen zählen nicht als „anstehend“ (verliehene werden getrennt
 *     ausgewiesen). Aus Vorjahren offen gebliebene Ehrungen stehen als eigener Wert „offen_vorjahre“.
 */
var Dashboard = (function () {

  function liste(daten, tab) { return (daten && daten[tab]) || []; }
  function zwei(n) { return (n < 10 ? '0' : '') + n; }
  function monatsanfang(jahr, monat) {            // monat 1..12, auch 13 = Januar des Folgejahres
    return monat > 12 ? (jahr + 1) + '-01-01' : jahr + '-' + zwei(monat) + '-01';
  }
  function jahrVon(iso) { return iso ? Number(String(iso).slice(0, 4)) : null; }
  function monatVon(iso) { return iso ? Number(String(iso).slice(5, 7)) : null; }
  function runde(n) { return Math.round(Number(n || 0) * 100) / 100; }

  function zeitraeumeJe(daten) {
    var m = {};
    liste(daten, 'Mitgliedschaftszeitraum').forEach(function (z) { (m[z.mitglied_id] = m[z.mitglied_id] || []).push(z); });
    Object.keys(m).forEach(function (k) {
      m[k].sort(function (a, b) { return String(a.eintrittsdatum).localeCompare(String(b.eintrittsdatum)); });
    });
    return m;
  }

  function zaehlbar(m) { return m.nur_funktionstraeger !== true && m.anonymisiert !== true; }

  // ------------------------------------------------------------------ Mitgliederverlauf

  /**
   * Verlauf eines Kalenderjahres.
   * Ergebnis: { jahr, heute, anfang, aktuell, eintritte, austritte, saldo,
   *             monate: [{ monat, bestand, eintritte, austritte, vorjahr }] }
   *   anfang   Bestand am 1.1.; aktuell Bestand am letzten ausgewerteten Tag (31.12. bzw. heute);
   *   bestand  null für Monate nach „heute“ im laufenden Jahr; vorjahr = Bestand zum selben Monatsende im Vorjahr.
   */
  function verlauf(daten, jahr, heute) {
    var zr = zeitraeumeJe(daten);
    var personen = liste(daten, 'Mitglied').filter(function (m) { return zaehlbar(m) && (zr[m.mitglied_id] || []).length; });
    /** Bestand am Ende des Tages `tag`: wer an diesem Tag ausscheidet, zählt nicht mehr mit (laufend = bis zum Ende des Tages). */
    function bestandAm(tag, mitAustrittAmTag) {
      var n = 0;
      personen.forEach(function (m) {
        var zs = zr[m.mitglied_id];
        if (Mitgliedschaft.status(m, zs, tag) !== 'aktiv') return;
        var lz = Mitgliedschaft.laufenderZeitraum(zs, tag);
        if (!mitAustrittAmTag && lz && Mitgliedschaft.endeVon(lz) === tag) return;
        n++;
      });
      return n;
    }
    function monatsende(j, mon) { return Mitgliedschaft.plusTage(monatsanfang(j, mon + 1), -1); }
    var monate = [];
    for (var mon = 1; mon <= 12; mon++) {
      var von = monatsanfang(jahr, mon), bis = monatsanfang(jahr, mon + 1);
      if (heute && heute < von) { monate.push({ monat: mon, bestand: null, eintritte: null, austritte: null, vorjahr: null }); continue; }
      var laufend = heute && heute < bis;   // laufender Monat: Bestand heute (wer heute geht, ist noch da)
      monate.push({ monat: mon, bestand: laufend ? bestandAm(heute, true) : bestandAm(monatsende(jahr, mon)), eintritte: 0, austritte: 0,
        vorjahr: bestandAm(monatsende(jahr - 1, mon)) });
    }
    var anfang = bestandAm(monatsende(jahr - 1, 12));
    var summeE = 0, summeA = 0;
    personen.forEach(function (m) {
      zr[m.mitglied_id].forEach(function (z) {
        var ein = z.eintrittsdatum, aus = Mitgliedschaft.endeVon(z);
        if (jahrVon(ein) === jahr) {
          var e = monate[monatVon(ein) - 1];
          if (e.bestand !== null && (!heute || ein <= heute)) { e.eintritte++; summeE++; }
        }
        if (aus && jahrVon(aus) === jahr) {
          var a = monate[monatVon(aus) - 1];
          if (a.bestand !== null && (!heute || aus < heute)) { a.austritte++; summeA++; }
        }
      });
    });
    var letzter = null;
    monate.forEach(function (x) { if (x.bestand !== null) letzter = x; });
    return { jahr: jahr, heute: heute || null, anfang: anfang, aktuell: letzter ? letzter.bestand : anfang,
      eintritte: summeE, austritte: summeA, saldo: summeE - summeA, monate: monate };
  }

  // ------------------------------------------------------------------ Einnahmen

  /**
   * Einnahmen aus Sollstellungen.
   * Ergebnis: { jahr, monate: [{ monat, betrag }], summe, ohne_datum,
   *             jahre: [{ jahr, soll, ist, offen, quote, anzahl, ruecklastschriften }] (aufsteigend, höchstens `anzahlJahre`) }
   *   monate  = eingegangene Beträge (ist_betrag) nach Buchungsdatum im Kalenderjahr `jahr`.
   *   quote   = ist / soll in Prozent (null bei soll 0).
   */
  function einnahmen(daten, jahr, anzahlJahre) {
    var sollstellungen = liste(daten, 'Sollstellung');
    var monate = [];
    for (var i = 1; i <= 12; i++) monate.push({ monat: i, betrag: 0 });
    var ohne = 0, summe = 0;
    sollstellungen.forEach(function (s) {
      if (s.status === 'storniert') return;
      var ist = Number(s.ist_betrag || 0);
      if (!ist) return;
      if (!s.buchungsdatum) { if (Number(s.jahr) === jahr) ohne += ist; return; }
      if (jahrVon(s.buchungsdatum) !== jahr) return;
      monate[monatVon(s.buchungsdatum) - 1].betrag += ist;
      summe += ist;
    });
    monate.forEach(function (m) { m.betrag = runde(m.betrag); });
    var jahre = Familie.jahressummen(sollstellungen).filter(function (j) { return j.jahr <= jahr; })
      .slice(0, anzahlJahre || 6).reverse().map(function (j) {
        return { jahr: j.jahr, soll: j.soll, ist: j.ist, offen: j.offen, anzahl: j.anzahl, ruecklastschriften: j.ruecklastschriften,
          quote: j.soll > 0 ? Math.round(j.ist / j.soll * 1000) / 10 : null };
      });
    return { jahr: jahr, monate: monate, summe: runde(summe), ohne_datum: runde(ohne), jahre: jahre };
  }

  // ------------------------------------------------------------------ Ehrungs-Vorschau

  /**
   * Ehrungen je Jahr von `vonJahr` bis `bisJahr` (höchstens 15 Jahre).
   * Ergebnis: [{ jahr, anstehend, verliehen, offen_vorjahre, zeilen: [{ typ, bezeichnung, schwelle, anzahl }] }]
   *   anstehend       in diesem Jahr neu fällig oder bereits angelegt und noch nicht verliehen/abgelehnt
   *   verliehen       in diesem Jahr fällige und schon verliehene Ehrungen (Ehrung-Zeilen)
   *   offen_vorjahre  nur im ersten Jahr: aus früheren Jahren offen (fällig/verschoben)
   */
  function ehrungsvorschau(daten, konfig, vonJahr, bisJahr) {
    bisJahr = Math.min(bisJahr, vonJahr + 14);
    var ergebnis = [];
    for (var y = vonJahr; y <= bisJahr; y++) {
      var eintraege = Ehrung.jahresliste(daten, y, konfig || {});
      var zeilen = {}, anstehend = 0, offenVor = 0;
      eintraege.forEach(function (e) {
        if (e.faellig_jahr < y) { offenVor++; return; }
        if (e.faellig_jahr > y) return;
        anstehend++;
        var k = e.ehrungsregel_id;
        var z = zeilen[k] = zeilen[k] || { typ: e.typ, bezeichnung: e.bezeichnung, schwelle: e.schwelle, anzahl: 0 };
        z.anzahl++;
      });
      var verliehen = liste(daten, 'Ehrung').filter(function (e) { return e.status === 'verliehen' && Number(e.faellig_jahr) === y; }).length;
      ergebnis.push({
        jahr: y, anstehend: anstehend, verliehen: verliehen, offen_vorjahre: y === vonJahr ? offenVor : 0,
        zeilen: Object.keys(zeilen).map(function (k) { return zeilen[k]; })
          .sort(function (a, b) { return String(a.typ).localeCompare(String(b.typ)) || (a.schwelle - b.schwelle); })
      });
    }
    return ergebnis;
  }

  return { verlauf: verlauf, einnahmen: einnahmen, ehrungsvorschau: ehrungsvorschau };
})();
