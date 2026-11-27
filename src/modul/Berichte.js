/**
 * BerichteModul – BLSV-Bestandserhebung, eingefrorene Jahresstatistik, Jahresvergleich und Listen
 * (Geburtstage/Jubiläen fürs Gemeindeblatt, Abteilungsübersicht, Ein- und Austritte).
 *
 * Zweck:      Serverseite der Ansicht „Berichte“ (inkl. BLSV-Nachmeldung). Zählregeln stehen in src/lib/blsv.js und src/lib/mitgliedschaft.js.
 * Datenquelle: Snapshot-Basis bzw. der rollenbeschnittene Ausschnitt (Bereichsdaten.fuer); Tab Statistik_Jahr
 *             (nicht in der Basis) wird bei Bedarf gelesen.
 * Wer darf was: Aktion export für alles Lesende. BLSV, Jahresvergleich und Einfrieren nur mit Zeilensicht „alle“
 *             (Vereinszahlen); Einfrieren zusätzlich Aktion konfig_aendern (Prüfung in src/api/Berichte.js).
 *             Abteilungs-/Jugendleiter bekommen Listen nur über ihren Sichtkreis.
 * Besonderheiten:
 *   - Gemeindeblatt-Listen enthalten NUR Personen mit gültiger Einwilligung „Ehrungen und Geburtstage in
 *     Vereinsmedien“; die Gesamtliste (intern) zeigt alle, markiert aber die fehlende Einwilligung.
 *   - Statistik_Jahr wird je Jahr nur einmal eingefroren (Lies-mich: Statistik bleibt stabil, auch wenn
 *     später gelöscht/anonymisiert wird). Ein zweiter Versuch liefert einen Hinweis statt doppelter Zeilen.
 *   - Jeder Export wird protokolliert (Aktion exportiert): wer, wann, welche Liste.
 */
var BerichteModul = (function () {
  var EINWILLIGUNG = 'Ehrungen und Geburtstage in Vereinsmedien';

  function datumPruefen(d, feld) {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: feld || 'stichtag', meldung: 'Bitte ein gültiges Datum angeben.' }]);
    return String(d);
  }
  function nurAlle(ktx) {
    if (!Rechte.zeilenSicht(ktx).alle) throw Fehler.fachlich('Dieser Bericht umfasst den ganzen Verein und steht nur Vorstand, Mitgliederverwaltung und Kasse zur Verfügung.');
  }
  function exportiert(ktx, liste, anzahl) {
    Protokoll.schreibe(ktx, [{ aktion: 'exportiert', tabelle: 'Bericht', datensatz_id: '-', kommentar: liste + (anzahl !== undefined ? ', ' + anzahl + ' Zeilen' : '') }]);
  }

  /**
   * Gesperrte (Art. 18) und anonymisierte Personen sind nur mit Sichtklasse „verwaltung“ namentlich sichtbar –
   * dieselbe Regel wie im Snapshot (src/lib/snapshot.js, personenkreis). In vereinsweiten Berichten zählen sie
   * weiter mit, erscheinen für andere Rollen aber ohne Namen, Nummer und Bezug.
   */
  function verborgen(ktx, p) {
    return !!p && (p.verarbeitung_eingeschraenkt === true || p.anonymisiert === true) && (ktx.sicht || []).indexOf('verwaltung') < 0;
  }
  var GESPERRT = 'Datensatz gesperrt';
  function benenne(ktx, eintrag, p) {
    if (verborgen(ktx, p)) { eintrag.name = GESPERRT; eintrag.mitgliedsnummer = null; eintrag.mitglied_id = null; return eintrag; }
    eintrag.name = Bereichsdaten.name(p); eintrag.mitgliedsnummer = (p || {}).mitgliedsnummer || null;
    return eintrag;
  }

  /** BLSV-Bestand zum Stichtag inkl. Prüfliste mit Namen. */
  function blsv(ktx, stichtag) {
    nurAlle(ktx);
    stichtag = datumPruefen(stichtag);
    var bd = Bereichsdaten.fuer(ktx);
    var b = Blsv.bestand(bd.daten, stichtag);
    var m = Bereichsdaten.index(bd.daten.Mitglied, 'mitglied_id');
    b.pruefliste.forEach(function (p) {
      if (p.mitglied_id) benenne(ktx, p, m[p.mitglied_id]);
    });
    return b;
  }

  function blsvExport(ktx, stichtag) {
    var b = blsv(ktx, stichtag);
    exportiert(ktx, 'BLSV-Bestandserhebung zum ' + b.stichtag, b.sportarten.length + 1);
    return { dateiname: 'BLSV_Bestand_' + b.stichtag + '.csv', inhalt: Blsv.csv(b) };
  }

  /**
   * BLSV-Nachmeldung: Neumitglieder und neue Sportarten zwischen Meldestichtag und `bis` (Standard heute).
   * Vereinsweit → nur Zeilensicht „alle“. Liste mit Namen für die interne Prüfung.
   */
  function blsvNachmeldung(ktx, stichtag, bis) {
    nurAlle(ktx);
    stichtag = datumPruefen(stichtag);
    var bd = Bereichsdaten.fuer(ktx);
    bis = bis ? datumPruefen(bis, 'bis') : bd.heute;
    if (bis < stichtag) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'bis', meldung: '„bis“ liegt vor dem Stichtag.' }]);
    var n = Blsv.nachmeldung(bd.daten, stichtag, bis);
    var m = Bereichsdaten.index(bd.daten.Mitglied, 'mitglied_id');
    n.eintraege.forEach(function (e) { benenne(ktx, e, m[e.mitglied_id]); });
    return n;
  }

  function blsvNachmeldungExport(ktx, stichtag, bis) {
    var n = blsvNachmeldung(ktx, stichtag, bis);
    exportiert(ktx, 'BLSV-Nachmeldung ' + n.stichtag + ' bis ' + n.bis, n.sportarten.length + 1);
    return { dateiname: 'BLSV_Nachmeldung_' + n.stichtag + '_' + n.bis + '.csv', inhalt: Blsv.nachmeldungCsv(n) };
  }

  /** Statistik_Jahr für `jahr` einfrieren (Verein + je Abteilung). */
  function einfrieren(ktx, jahr, stichtag, gemeldetAm) {
    nurAlle(ktx);
    jahr = Number(jahr);
    if (!(jahr >= 1990 && jahr <= 2200)) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'jahr', meldung: 'Bitte ein gültiges Jahr angeben.' }]);
    stichtag = datumPruefen(stichtag || (jahr + '-01-01'));
    if (gemeldetAm) gemeldetAm = datumPruefen(gemeldetAm, 'blsv_gemeldet_am');
    return DB.mitSperre(function () {
      var vorhanden = (DB.lese(['Statistik_Jahr']).Statistik_Jahr || []).filter(function (z) { return Number(z.jahr) === jahr; });
      if (vorhanden.length) throw Fehler.fachlich('Für ' + jahr + ' ist die Jahresstatistik bereits eingefroren (am ' + (vorhanden[0].eingefroren_am || '–') + '). Eingefrorene Zahlen werden nicht überschrieben.');
      var bd = Bereichsdaten.fuer(ktx);
      var b = Blsv.bestand(bd.daten, stichtag);
      var zeilen = Blsv.statistikZeilen(b, jahr, stichtag, Blsv.kennzahlen(bd.daten, stichtag), bd.heute, gemeldetAm || null);
      var neu = Bereichsdaten.einfuegen('Statistik_Jahr', zeilen, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Statistik_Jahr', datensatz_id: String(jahr), kommentar: 'Jahresstatistik eingefroren (' + neu.length + ' Zeilen)' }]);
      return { jahr: jahr, zeilen: neu.length };
    });
  }

  /** Jahresvergleich (Verein): eingefrorene Jahre + aktueller, nicht eingefrorener Stand. */
  function jahresvergleich(ktx) {
    nurAlle(ktx);
    var jahre = (DB.lese(['Statistik_Jahr']).Statistik_Jahr || []).filter(function (z) { return z.ebene === 'Verein'; })
      .map(function (z) {
        return { jahr: Number(z.jahr), stichtag: z.stichtag, mitglieder: z.mitglieder_gesamt, passiv: z.davon_passiv,
          eintritte: z.eintritte, austritte: z.austritte, beitragssoll: z.beitragssoll, beitragsist: z.beitragsist, eingefroren: true };
      }).sort(function (a, b) { return a.jahr - b.jahr; });
    var bd = Bereichsdaten.fuer(ktx);
    var b = Blsv.bestand(bd.daten, bd.heute);
    var k = Blsv.kennzahlen(bd.daten, bd.heute);
    jahre.push({ jahr: Number(bd.heute.slice(0, 4)), stichtag: bd.heute, mitglieder: b.verein.gesamt, passiv: b.verein.davon_passiv,
      eintritte: k.eintritte, austritte: k.austritte, beitragssoll: null, beitragsist: null, eingefroren: false });
    return { jahre: jahre };
  }

  /** Geburtstage im Zeitraum [von, bis] (aktive Mitglieder im Sichtkreis). */
  function geburtstage(ktx, von, bis) {
    von = datumPruefen(von, 'von'); bis = datumPruefen(bis, 'bis');
    if (bis < von) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'bis', meldung: '„Bis“ liegt vor „von“.' }]);
    var bd = Bereichsdaten.fuer(ktx);
    var d = bd.daten;
    var zr = {};
    (d.Mitgliedschaftszeitraum || []).forEach(function (z) { (zr[z.mitglied_id] = zr[z.mitglied_id] || []).push(z); });
    var aus = [];
    (d.Mitglied || []).forEach(function (m) {
      if (!m.geburtsdatum || m.anonymisiert === true || m.verarbeitung_eingeschraenkt === true) return;
      if (Mitgliedschaft.status(m, zr[m.mitglied_id] || [], bd.heute) !== 'aktiv') return;
      for (var j = Number(von.slice(0, 4)); j <= Number(bis.slice(0, 4)); j++) {
        var tag = j + m.geburtsdatum.slice(4);
        if (m.geburtsdatum.slice(5) === '02-29' && !(j % 4 === 0 && (j % 100 !== 0 || j % 400 === 0))) tag = j + '-02-28';
        if (tag < von || tag > bis) continue;
        var alter = j - Number(m.geburtsdatum.slice(0, 4));
        aus.push({ mitglied_id: m.mitglied_id, mitgliedsnummer: m.mitgliedsnummer || null, name: Bereichsdaten.name(m), geburtstag: tag, alter: alter,
          rund: alter % 10 === 0 || (alter >= 70 && alter % 5 === 0) || alter === 18,
          einwilligung: Bereichsdaten.hatEinwilligung(d.Einwilligung, m.mitglied_id, EINWILLIGUNG, bd.heute) });
      }
    });
    aus.sort(function (a, b) { return a.geburtstag.localeCompare(b.geburtstag) || a.name.localeCompare(b.name); });
    return { von: von, bis: bis, eintraege: aus };
  }

  /** Mitgliedsjubiläen (Stufen aus Ehrungsregel), die im Jahr erreicht werden – Grundlage fürs Gemeindeblatt. */
  function jubilaeen(ktx, jahr) {
    jahr = Number(jahr);
    if (!(jahr >= 1990 && jahr <= 2200)) throw Fehler.fachlich('Bitte ein gültiges Jahr angeben.');
    var bd = Bereichsdaten.fuer(ktx);
    var d = bd.daten;
    var konfig = { ehrung_zaehlweise: bd.konfig.ehrung_zaehlweise, ehrung_stichtag: bd.konfig.ehrung_stichtag,
      funktionsjubilaeum_zaehlweise: bd.konfig.funktionsjubilaeum_zaehlweise };
    var aus = [];
    (d.Mitglied || []).forEach(function (m) {
      if (m.anonymisiert === true || m.verarbeitung_eingeschraenkt === true) return;
      Ehrung.erreichtImJahr(d, konfig, m, jahr).forEach(function (k) {
        if (k.regel.typ !== 'Mitgliedsjubiläum') return;
        aus.push({ mitglied_id: m.mitglied_id, mitgliedsnummer: m.mitgliedsnummer || null, name: Bereichsdaten.name(m),
          jahre: Number(k.regel.schwelle), stufe: k.regel.bezeichnung, grundlage: k.grundlage,
          einwilligung: Bereichsdaten.hatEinwilligung(d.Einwilligung, m.mitglied_id, EINWILLIGUNG, bd.heute) });
      });
    });
    aus.sort(function (a, b) { return b.jahre - a.jahre || a.name.localeCompare(b.name); });
    return { jahr: jahr, eintraege: aus };
  }

  /** Abteilungsübersicht: Mitglieder, aktiv/passiv, Leitung (aus laufender Funktion „Abteilungsleiter“). */
  function abteilungen(ktx) {
    var bd = Bereichsdaten.fuer(ktx);
    var d = bd.daten;
    var m = Bereichsdaten.index(d.Mitglied, 'mitglied_id');
    var arten = Bereichsdaten.index(d.Funktionsart, 'funktionsart_id');
    return (d.Abteilung || []).map(function (a) {
      var zug = (d.Abteilungszugehoerigkeit || []).filter(function (z) {
        return z.abteilung_id === a.abteilung_id && Mitgliedschaft.laeuft(z.eintrittsdatum || '0000-01-01', z.austrittsdatum, bd.heute) && m[z.mitglied_id];
      });
      var leitung = (d.Funktion || []).filter(function (f) {
        var fa = arten[f.funktionsart_id];
        return f.abteilung_id === a.abteilung_id && Mitgliedschaft.laeuft(f.von, f.bis, bd.heute) && fa && /abteilungsleit/i.test(fa.bezeichnung);
      }).map(function (f) { return { name: Bereichsdaten.name(m[f.mitglied_id]), seit: f.von }; });
      return { abteilung_id: a.abteilung_id, bezeichnung: a.bezeichnung, blsv_sportart: a.blsv_sportart || null,
        meldepflichtig: a.meldepflichtig === true, aktiv_abteilung: a.aktiv !== false,
        mitglieder: zug.length, aktiv: zug.filter(function (z) { return z.status !== 'passiv'; }).length,
        passiv: zug.filter(function (z) { return z.status === 'passiv'; }).length, leitung: leitung };
    });
  }

  /** Ein- und Austritte (Vereinsmitgliedschaft) im Zeitraum. */
  function bewegungen(ktx, von, bis) {
    von = datumPruefen(von, 'von'); bis = datumPruefen(bis, 'bis');
    var bd = Bereichsdaten.fuer(ktx);
    var m = Bereichsdaten.index(bd.daten.Mitglied, 'mitglied_id');
    var aus = [];
    (bd.daten.Mitgliedschaftszeitraum || []).forEach(function (z) {
      var p = m[z.mitglied_id];
      if (!p) return;
      var gesperrt = verborgen(ktx, p);
      if (z.eintrittsdatum && z.eintrittsdatum >= von && z.eintrittsdatum <= bis) {
        aus.push(benenne(ktx, { art: 'Eintritt', datum: z.eintrittsdatum, mitglied_id: p.mitglied_id, grund: null }, p));
      }
      var ende = z.austrittsdatum || z.austritt_wirksam;
      if (ende && ende >= von && ende <= bis) {
        aus.push(benenne(ktx, { art: 'Austritt', datum: ende, mitglied_id: p.mitglied_id, grund: gesperrt ? null : z.austrittsgrund || null }, p));
      }
    });
    aus.sort(function (a, b) { return a.datum.localeCompare(b.datum); });
    return { von: von, bis: bis, eintraege: aus,
      eintritte: aus.filter(function (x) { return x.art === 'Eintritt'; }).length,
      austritte: aus.filter(function (x) { return x.art === 'Austritt'; }).length };
  }

  return { blsv: blsv, blsvExport: blsvExport, einfrieren: einfrieren, jahresvergleich: jahresvergleich,
    geburtstage: geburtstage, jubilaeen: jubilaeen, abteilungen: abteilungen, bewegungen: bewegungen, exportiert: exportiert, blsvNachmeldung: blsvNachmeldung, blsvNachmeldungExport: blsvNachmeldungExport };
})();
