/**
 * Beitritt – Beitritts-Anträge aus XML (Access-Format) planen. Reine Funktion, keine Apps-Script-Dienste.
 *
 * Zweck:      Nachfolger des Access-Moduls „BeitrittsXmlImportieren“. Ein Antrag = eine XML-Datei mit einem oder
 *             mehreren <Daten16>-Einträgen. Person 1 zahlt selbst, alle weiteren zahlen über Person 1. Daraus wird
 *             geplant: neue Mitglieder (mit NEUER Mitgliedsnummer, höchste vergebene + 1 – keine Lücken), ein
 *             Beitragskonto aus den Bankdaten der Person 1, ggf. eine Beitragsgemeinschaft (Familie/Ehepaar),
 *             Mitgliedschaftszeitraum und Abteilungszugehörigkeiten. Dubletten im Bestand werden gemeldet; der
 *             Benutzer entscheidet je Person „neu anlegen“ oder „Wiedereintritt“ (bestehende Nummer).
 * Datenquelle: Der Browser liest die XML-Datei (nur dort, nichts wird gespeichert) und schickt je Person die Felder
 *             als Texte; Bestand und Stammdaten kommen vom Servermodul (src/modul/Beitritt.js).
 * Wer darf was: – (Rechte prüft das Servermodul: mitglied_anlegen UND konto_bearbeiten).
 * Besonderheiten:
 *   - Die eigentlichen Regeln (Straße/Hausnummer, Datum, Anrede/Geschlecht, PLZ, Abteilungen, Konto-Cluster und
 *     Familien-Heuristik nach Übergabe §6) stammen aus der Migration (Migration.migriere) – eine Quelle.
 *   - Bankdaten werden übernommen (Entscheidung Johann 10/2026). Eine ungültige IBAN wird NICHT übernommen:
 *     Zahlweg Überweisung + Warnung. Die IBAN verlässt den Server nie im Klartext (nur maskiert).
 *   - Eintritt in der Zukunft: geplant wird zum Eintrittsdatum (die Person gilt als aufgenommen) [A].
 *   - Mandatsdatum: beim Online-Antrag das Unterschriftsdatum (antrag.unterschrift_am), sonst vorläufig der Eintritt
 *     mit Warnung „bitte prüfen“.
 *   - Online-Antrag „tsv-antrag-2“ (antrag.online, src/lib/antrag2.js): Tarif-Schlüssel → Beitragsart bzw.
 *     Beitragsgemeinschaft (Beitragsart.als_gemeinschaft, Betrag aus den Stammdaten), Abteilungs-Schlüssel →
 *     Abteilung (online_schluessel), Unterschrift durch Erziehungsberechtigte → Vertretung, Kontoinhaber ohne
 *     Mitgliedschaft → Konto ohne Personenbezug, Einwilligungen → Zeilen in Einwilligung.
 */
var Beitritt = (function () {
  var MAX_ANTRAEGE = 50;
  var MAX_PERSONEN = 20;
  var MAX_LAENGE = 500;
  var TEMP_NR = 900000;
  /** Prüflisten-Arten der Migration, die beim Beitritt keine Rolle spielen. */
  /** Beim Online-Antrag zusätzlich ohne Belang: Beitrags-Heuristik über Beträge (der Tarif kommt als Schlüssel). */
  var ONLINE_UNWICHTIG = ['beitrag_unbekannt', 'beitragsart_mehrdeutig', 'cluster_mischfall', 'ohne_beitrag'];
  var UNWICHTIG = ['spalte_fehlt', 'spalte_unbekannt', 'status_abteilung', 'id_fehlt', 'id_doppelt', 'mitglnr_fehlt', 'mitglnr_doppelt',
    'dublette', 'zahlung_unbekannt', 'iban_ungueltig'];

  /** Access-XML-Elementnamen entschlüsseln: „Abteilung_x0020_1“ → „Abteilung 1“. */
  function dekodiere(name) {
    return String(name).replace(/_x([0-9A-Fa-f]{4})_/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
  }

  function text(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).replace(/\s+/g, ' ').trim();
    return s === '' ? null : s;
  }

  /**
   * Eingaben aus dem Browser prüfen und säubern. antraege = [{ datei, personen: [{ Feld: 'Text' }] }].
   * Liefert { antraege } oder { fehler: 'Text' }.
   */
  function bereinige(antraege) {
    if (!Array.isArray(antraege) || !antraege.length) return { fehler: 'Keine Anträge übergeben.' };
    if (antraege.length > MAX_ANTRAEGE) return { fehler: 'Höchstens ' + MAX_ANTRAEGE + ' Anträge auf einmal.' };
    var aus = [];
    for (var i = 0; i < antraege.length; i++) {
      var a = antraege[i] || {};
      var datei = String(a.datei || 'Antrag ' + (i + 1)).replace(/[^\w .()\-äöüÄÖÜß]/g, '').slice(0, 120) || 'Antrag ' + (i + 1);
      // Online-Antrag „tsv-antrag-2“: nur als JSON annehmen und selbst umwandeln (nie ein fertiges „online“ vom Browser)
      if (a.json !== undefined && a.json !== null) {
        var v2 = Antrag2.zuAntrag(typeof a.json === 'string' ? a.json.slice(0, Antrag2.MAX_JSON + 1) : a.json, datei);
        if (v2.fehler) return { fehler: datei + ': ' + v2.fehler };
        aus.push(v2);
        continue;
      }
      if (!Array.isArray(a.personen) || !a.personen.length) return { fehler: datei + ': keine Personen (<Daten16>) gefunden.' };
      if (a.personen.length > MAX_PERSONEN) return { fehler: datei + ': mehr als ' + MAX_PERSONEN + ' Personen in einem Antrag.' };
      var personen = [];
      for (var j = 0; j < a.personen.length; j++) {
        var p = a.personen[j];
        if (!p || typeof p !== 'object' || Array.isArray(p)) return { fehler: datei + ': Person ' + (j + 1) + ' ist ungültig.' };
        var o = {}, n = 0;
        Object.keys(p).forEach(function (k) {
          if (++n > 80) return;
          var name = dekodiere(k).slice(0, 60);
          var v = p[k];
          if (v === null || v === undefined) return;
          if (typeof v !== 'string' && typeof v !== 'number') return;
          o[name] = String(v).slice(0, MAX_LAENGE);
        });
        personen.push(o);
      }
      // Unterschriftsdatum (nur Online-Antrag aus dem Eingang): wird zum Mandatsdatum
      var u = /^\d{4}-\d{2}-\d{2}$/.test(String(a.unterschrift_am || '')) ? String(a.unterschrift_am) : null;
      aus.push(u ? { datei: datei, personen: personen, unterschrift_am: u } : { datei: datei, personen: personen });
    }
    return { antraege: aus };
  }

  function falte(s) { return Migration.falte(s); }

  /** Feldwert unabhängig von der Schreibweise des Feldnamens (wie die Migration). */
  function feld(p, namen) {
    var ks = Object.keys(p);
    for (var i = 0; i < namen.length; i++) {
      for (var j = 0; j < ks.length; j++) if (falte(ks[j]) === namen[i]) return text(p[ks[j]]);
    }
    return null;
  }

  /** Dubletten im Bestand: Nachname + Vorname (+ Geburtsdatum, falls beide bekannt), Umlaute gefaltet. */
  function dubletten(m, bestand, heute) {
    var nn = falte(m.nachname), vn = falte(m.vorname);
    if (!nn) return [];
    var zr = bestand.Mitgliedschaftszeitraum || [];
    return (bestand.Mitglied || []).filter(function (x) {
      if (x.anonymisiert === true) return false;
      if (falte(x.nachname) !== nn || falte(x.vorname) !== vn) return false;
      return !(m.geburtsdatum && x.geburtsdatum && m.geburtsdatum !== x.geburtsdatum);
    }).map(function (x) {
      var eigene = zr.filter(function (z) { return z.mitglied_id === x.mitglied_id; });
      var status = typeof Mitgliedschaft !== 'undefined' ? Mitgliedschaft.status(x, Mitgliedschaft.zeitraeumeVon(x.mitglied_id, zr), heute) : x.status;
      // Zeitraum mit Eintritt in der Zukunft und ohne Ende = bereits aufgenommen → als aktiv behandeln
      if (status !== 'aktiv' && status !== 'verstorben' && eigene.some(function (z) { return !z.austrittsdatum && !z.austritt_wirksam; })) status = 'aktiv';
      var letzte = eigene.map(function (z) { return z.austrittsdatum || z.austritt_wirksam; }).filter(Boolean).sort().pop() || null;
      return { mitglied_id: x.mitglied_id, mitgliedsnummer: x.mitgliedsnummer, status: status, ausgetreten_am: status === 'aktiv' ? null : letzte, version: x.version };
    });
  }

  /** Nummernkreis: höchste vergebene + 1 bzw. _Konfig.mitgliedsnummer_naechste, nie eine belegte Nummer. */
  function nummernkreis(bestand, konfigNaechste) {
    var belegt = {}, max = 0, laenge = 4;
    (bestand.Mitglied || []).forEach(function (m) {
      var s = String(m.mitgliedsnummer || '');
      var n = Number(s.replace(/\D/g, ''));
      if (!s || !n) return;
      belegt[n] = true;
      if (n > max) max = n;
      laenge = Math.max(laenge, s.length);
    });
    var start = Math.max(max + 1, Number(String(konfigNaechste || '').replace(/\D/g, '')) || 0);
    return {
      laenge: laenge,
      naechste: function () {
        while (belegt[start]) start++;
        belegt[start] = true;
        var t = String(start++);
        while (t.length < laenge) t = '0' + t;
        return t;
      },
      stand: function () { var t = String(start); while (t.length < laenge) t = '0' + t; return t; }
    };
  }

  function maskiere(iban) {
    if (!iban) return null;
    if (typeof Iban !== 'undefined' && Iban.maskiere) return Iban.maskiere(iban);
    return iban.slice(0, 4) + ' •••• ' + iban.slice(-4);
  }

  /** Eindeutige Mandatsreferenz TSV-<Jahr>-<Nr> (mit -2, -3 … falls schon vergeben). */
  function mandatsreferenz(jahr, nr, vergeben) {
    var r = 'TSV-' + jahr + '-' + nr;
    if (!vergeben[r]) return r;
    var n = 2;
    while (vergeben[r + '-' + n]) n++;
    return r + '-' + n;
  }

  /**
   * Tarif des Online-Antrags anwenden (verändert tabs): Gemeinschaftstarif → eine Beitragsgemeinschaft mit dem
   * Betrag aus den Stammdaten für alle Personen; sonst die Beitragsart für jede Person. Liefert die Anzeige
   * { schluessel, beitragsart, gemeinschaft } oder null (dann bleibt der Vorschlag nach Alter).
   */
  function tarifAnwenden(online, tabs, kontext, stichtag, warnungen) {
    var arten = (kontext.beitragsarten || []).filter(function (a) {
      return a.aktiv !== false && online.tarif && Antrag2.schluesselListe(a.online_schluessel).indexOf(online.tarif) >= 0;
    });
    // ohne zugeordneten Tarif: keine Gemeinschaft aus einer Betrags-Heuristik
    tabs.Beitragsgemeinschaft = [];
    tabs.Mitglied.forEach(function (mm) { mm.beitragsgemeinschaft_id = null; mm.beitragsart_id = null; });
    if (!online.tarif) { warnungen.push('Kein Tarif im Online-Antrag – Beitragsart bitte wählen.'); return null; }
    if (arten.length !== 1) {
      warnungen.push(arten.length ? 'Tarif „' + online.tarif + '“ ist mehreren Beitragsarten zugeordnet (' + arten.map(function (a) { return a.bezeichnung; }).join(', ') + ') – bitte eindeutig machen.'
        : 'Tarif „' + online.tarif + '“ ist keiner Beitragsart zugeordnet (Stammdaten → Beitragsart → Schlüssel im Online-Formular) – Beitragsart bitte wählen.');
      return { schluessel: online.tarif, beitragsart: null, gemeinschaft: null };
    }
    var art = arten[0];
    var betrag = typeof Beitrag !== 'undefined' ? Beitrag.betragAm(art, stichtag) : Number(art.betrag || 0);
    if (art.als_gemeinschaft) {
      var p1 = tabs.Mitglied[0];
      tabs.Beitragsgemeinschaft = [{ beitragsgemeinschaft_id: 1, bezeichnung: art.als_gemeinschaft + ' ' + (p1.nachname || ''), festbetrag: betrag,
        aktiv: true, bemerkung: null, version: 1, geaendert_am: null, geaendert_von: null }];
      tabs.Mitglied.forEach(function (mm) { mm.beitragsgemeinschaft_id = 1; });
      if (art.als_gemeinschaft === 'Ehepaar' && tabs.Mitglied.length !== 2) warnungen.push('Ehegattenbeitrag mit ' + tabs.Mitglied.length + ' Person(en) – bitte prüfen.');
      if (tabs.Mitglied.length < 2) warnungen.push(art.bezeichnung + ' mit nur einer Person – bitte prüfen.');
      return { schluessel: online.tarif, beitragsart: art.bezeichnung, gemeinschaft: tabs.Beitragsgemeinschaft[0].bezeichnung, betrag: betrag };
    }
    tabs.Mitglied.forEach(function (mm) {
      mm.beitragsart_id = art.beitragsart_id;
      var alter = typeof Mitgliedschaft !== 'undefined' && mm.geburtsdatum ? Mitgliedschaft.alter(mm.geburtsdatum, stichtag) : null;
      if (alter !== null && typeof Beitrag !== 'undefined' && !Beitrag.altersbereichPasst(art, alter)) {
        warnungen.push([mm.nachname, mm.vorname].filter(Boolean).join(', ') + ': Alter ' + alter + ' passt nicht zu „' + art.bezeichnung + '“ – bitte prüfen.');
      }
    });
    return { schluessel: online.tarif, beitragsart: art.bezeichnung, gemeinschaft: null, betrag: betrag };
  }

  /** Ist der Kontoinhaber eine andere Person als die im Antrag? (Name in beiden Schreibweisen verglichen) */
  function kontoinhaberExtern(inhaber, mitglieder) {
    if (!inhaber) return false;
    var i = falte(inhaber);
    return !mitglieder.some(function (mm) {
      return i === falte((mm.vorname || '') + (mm.nachname || '')) || i === falte((mm.nachname || '') + (mm.vorname || ''));
    });
  }

  /**
   * Plant einen Antrag.
   * kontext: { heute, beitragsjahr, abteilungen, beitragsarten, pauschalbetraege, bestand: { Mitglied,
   *            Mitgliedschaftszeitraum, Abteilungszugehoerigkeit, Beitragskonto }, nummern (aus nummernkreis) }
   * Liefert { datei, personen: [...], konto, gemeinschaft, warnungen, tabs } – tabs enthält die geplanten Zeilen
   * (vorläufige IDs 1..n) inkl. Klartext-IBAN und ist NUR für den Server bestimmt.
   */
  function plane(antrag, kontext) {
    var heute = kontext.heute;
    var rohe = antrag.personen;
    // Eintritt in der Zukunft → zum spätesten Eintritt planen, damit Status/Familien-Heuristik „aktiv“ sehen
    var stichtag = heute;
    rohe.forEach(function (p) {
      var e = Migration.datum(feld(p, ['eindat', 'eintritt', 'eintrittsdatum']), +heute.slice(0, 4)).wert;
      if (e && e > stichtag) stichtag = e;
    });
    var zeilen = rohe.map(function (p, i) {
      var z = {};
      Object.keys(p).forEach(function (k) {
        var f = falte(k);
        if (['id', 'mitglnr', 'zahler', 'ausdat', 'zahlung', 'arbeitsdatum', 'reziff'].indexOf(f) >= 0) return;
        z[k] = p[k];
      });
      z.ID = String(i + 1);
      z.MitglNr = String(TEMP_NR + i + 1);
      z.Zahler = i === 0 ? '' : String(TEMP_NR + 1);
      if (!feld(p, ['eindat', 'eintritt', 'eintrittsdatum'])) z.EinDat = heute;
      return z;
    });
    var online = antrag.online || null;
    var warnungen = [];
    if (online) {
      // Abteilungs-Schlüssel des Formulars → Abteilung (online_schluessel), für jede Person des Antrags
      var namen = [];
      online.abteilungen.forEach(function (k) {
        var abt = (kontext.abteilungen || []).filter(function (x) { return x.aktiv !== false && Antrag2.schluesselListe(x.online_schluessel).indexOf(k) >= 0; })[0];
        if (abt) { if (namen.indexOf(abt.bezeichnung) < 0) namen.push(abt.bezeichnung); }
        else warnungen.push('Abteilung „' + k + '“ aus dem Online-Formular ist keiner Abteilung zugeordnet (Stammdaten → Abteilung → Schlüssel im Online-Formular).');
      });
      zeilen.forEach(function (z) {
        namen.slice(0, 4).forEach(function (n, j) { z['Abteilung ' + (j + 1)] = n; });
        if (namen.length) z['Status Abteilung 1'] = 'aktiv';
      });
      if (namen.length > 4) warnungen.push('Mehr als vier Abteilungen gewählt – nur die ersten vier übernommen.');
    }
    // Erste Zeile bestimmt die Spalten der Migration → alle Feldnamen in jede Zeile übernehmen
    var alle = {};
    zeilen.forEach(function (z) { Object.keys(z).forEach(function (k) { alle[k] = true; }); });
    zeilen = zeilen.map(function (z) { var o = {}; Object.keys(alle).forEach(function (k) { o[k] = z[k] === undefined ? '' : z[k]; }); return o; });
    // Bankdaten nur von Person 1 (Zahler); weitere Personen zahlen über Person 1
    var p1 = rohe[0];
    var iban = String(feld(p1, ['iban']) || '').replace(/\s+/g, '').toUpperCase();
    var ibanGueltig = iban ? (typeof Iban !== 'undefined' ? Iban.pruefe(iban).ok : true) : false;
    zeilen.forEach(function (z, i) {
      Object.keys(z).forEach(function (k) {
        var f = falte(k);
        if (i > 0 && ['iban', 'bic', 'kontoinhaber', 'blz', 'konto', 'bank'].indexOf(f) >= 0) z[k] = '';
        if (i === 0 && f === 'iban' && iban && !ibanGueltig) z[k] = '';   // ungültige IBAN nicht übernehmen
      });
    });

    var m = Migration.migriere(zeilen, {
      stichtag: stichtag, beitragsjahr: kontext.beitragsjahr, abteilungen: kontext.abteilungen || [],
      beitragsarten: kontext.beitragsarten || [], pauschalbetraege: kontext.pauschalbetraege || [],
      abteilungAlias: kontext.abteilungAlias || {}
    });
    var tabs = m.tabs;
    var proPerson = {};
    m.bericht.pruefliste.forEach(function (x) {
      if (UNWICHTIG.indexOf(x.art) >= 0) return;
      if (online && ONLINE_UNWICHTIG.indexOf(x.art) >= 0) return;   // Tarif kommt als Schlüssel, nicht als Betrag
      var meldung = String(x.meldung || '').replace(/\b9000(\d\d)\b/g, function (s, n) { return 'Person ' + Number(n); });
      if (x.id) (proPerson[x.id] = proPerson[x.id] || []).push(meldung);
      else warnungen.push(meldung);
    });
    if (iban && !ibanGueltig) warnungen.push('IBAN ' + maskiere(iban) + ' ist ungültig (Prüfziffer/Länge) – nicht übernommen, Zahlweg Überweisung. Bitte beim Mitglied erfragen.');

    // Konto: genau eines (Person 1); Konto-Bemerkung/Referenz neu
    var konto = tabs.Beitragskonto[0];
    if (konto) {
      konto.bemerkung = 'Beitritt aus XML: ' + antrag.datei;
      konto.geaendert_von = null;
      konto.mandatsreferenz = null;
      if (konto.zahlweg === 'Lastschrift' && konto.iban && antrag.unterschrift_am && antrag.unterschrift_am <= heute) {
        konto.mandatsdatum = antrag.unterschrift_am;   // online unterschrieben (PDF im Eingang)
      } else if (konto.zahlweg === 'Lastschrift' && konto.iban) {
        konto.mandatsdatum = konto.mandatsdatum || heute;
        warnungen.push('Mandatsdatum vorläufig = Eintritt (' + konto.mandatsdatum + ') – Datum der Unterschrift auf dem Formular prüfen.');
      } else konto.mandatsdatum = null;
    }
    var tarif = null, kontoExtern = false;
    if (online) {
      tarif = tarifAnwenden(online, tabs, kontext, stichtag, warnungen);
      if (konto) {
        konto.bemerkung = 'Online-Antrag: ' + antrag.datei;
        kontoExtern = kontoinhaberExtern(online.kontoinhaber, tabs.Mitglied);
        if (kontoExtern) warnungen.push('Kontoinhaber „' + online.kontoinhaber + '“ ist keine Person des Antrags – Konto ohne Verknüpfung zu einem Mitglied angelegt.');
      }
      if (!online.bestaetigt.datenschutz) warnungen.push('Datenschutzhinweise im Formular nicht bestätigt.');
      if (konto && konto.zahlweg === 'Lastschrift' && !online.bestaetigt.sepa_mandat) warnungen.push('SEPA-Mandat im Formular nicht bestätigt – vor dem ersten Einzug klären.');
      if (online.bemerkung) warnungen.push('Bemerkung im Antrag: ' + online.bemerkung);
    }
    var gem = tabs.Beitragsgemeinschaft[0] || null;
    if (gem) gem.bemerkung = (online ? 'Online-Antrag: ' : 'Beitritt aus XML: ') + antrag.datei;

    // Personen nachbearbeiten: Beitragsart nach Alter (falls nichts erkannt), Vertretung für Minderjährige
    var ersterErwachsen = null;
    var personen = tabs.Mitglied.map(function (mm, i) {
      var alter = typeof Mitgliedschaft !== 'undefined' ? Mitgliedschaft.alter(mm.geburtsdatum, heute) : null;
      var w = (proPerson[mm.mitglied_id] || []).slice();
      if (i === 0) ersterErwachsen = alter === null || alter >= 18;
      mm.status = 'aktiv';
      mm.geaendert_von = null; mm.geaendert_am = null;
      if (!mm.beitragsgemeinschaft_id && !mm.beitragsart_id) {
        var passend = (kontext.beitragsarten || []).filter(function (a) {
          return a.aktiv !== false && !a.als_gemeinschaft && alter !== null && (a.alter_von === null || a.alter_von === undefined || alter >= a.alter_von) &&
            (a.alter_bis === null || a.alter_bis === undefined || alter <= a.alter_bis);
        });
        if (passend.length === 1) { mm.beitragsart_id = passend[0].beitragsart_id; w.push('Beitragsart nach Alter vorgeschlagen: ' + passend[0].bezeichnung + '.'); }
      }
      if (i > 0 && alter !== null && alter < 18) {
        if (ersterErwachsen) mm.vertreter_mitglied_id = tabs.Mitglied[0].mitglied_id;
        else w.push('Minderjährig, aber Person 1 ist nicht volljährig – gesetzliche Vertretung bitte eintragen.');
      }
      if (online && alter !== null && alter < 18 && !mm.vertreter_mitglied_id && online.antrag_unterschrift.als === 'erziehungsberechtigt') {
        if (online.antrag_unterschrift.name) mm.vertreter_name = online.antrag_unterschrift.name;
        else w.push('Unterschrieben von Erziehungsberechtigten, Name fehlt – gesetzliche Vertretung bitte eintragen.');
      }
      if (i === 0 && alter !== null && alter < 18 && !mm.vertreter_name) w.push('Person 1 (Zahler) ist minderjährig – Kontoinhaber/Vertretung prüfen.');
      var dub = dubletten(mm, kontext.bestand || {}, heute);
      return {
        index: i, name: [mm.nachname, mm.vorname].filter(Boolean).join(', '), geburtsdatum: mm.geburtsdatum,
        alter: alter, rolle: i === 0 ? 'zahlt selbst' : 'Zahler: Person 1',
        beitragsart_id: mm.beitragsart_id || null, in_gemeinschaft: !!mm.beitragsgemeinschaft_id,
        abteilungen: tabs.Abteilungszugehoerigkeit.filter(function (z) { return z.mitglied_id === mm.mitglied_id; })
          .map(function (z) { return { abteilung_id: z.abteilung_id, status: z.status }; }),
        dubletten: dub, warnungen: w
      };
    });
    // Einwilligungen aus dem Online-Formular: je Person und Art eine Zeile (erteilt mit der Unterschrift)
    tabs.Einwilligung = [];
    if (online && online.einwilligungen.length) {
      var erteilt = online.antrag_unterschrift.datum || antrag.unterschrift_am || heute;
      tabs.Mitglied.forEach(function (mm) {
        var minder = typeof Mitgliedschaft !== 'undefined' && mm.geburtsdatum && Mitgliedschaft.alter(mm.geburtsdatum, heute) < 18;
        online.einwilligungen.forEach(function (art) {
          tabs.Einwilligung.push({ mitglied_id: mm.mitglied_id, art: art, umfang: null, erteilt_am: erteilt, erteilt_form: 'Aufnahmeantrag',
            erteilt_durch: minder ? (online.antrag_unterschrift.name || mm.vertreter_name || null) : null, widerrufen_am: null,
            nachweis_ort: 'Online-Aufnahmeantrag (PDF mit Unterschrift, Dokumente)', bemerkung: null });
        });
      });
    }
    return {
      datei: antrag.datei, erwartet: rohe.length,
      tarif: tarif, einwilligungen: online ? online.einwilligungen : [], konto_extern: kontoExtern,
      personen: personen,
      konto: konto ? { inhaber: konto.kontoinhaber_name, zahlweg: konto.zahlweg, iban_maskiert: maskiere(konto.iban), bic: konto.bic || null,
        mandatsdatum: konto.mandatsdatum } : null,
      gemeinschaft: gem ? { bezeichnung: gem.bezeichnung, festbetrag: gem.festbetrag } : null,
      warnungen: warnungen,
      tabs: tabs
    };
  }

  /** Vorschau ohne interne Daten (keine Klartext-IBAN) – für die Antwort an den Browser. */
  function fuerBrowser(plan) {
    var o = {};
    Object.keys(plan).forEach(function (k) { if (k !== 'tabs') o[k] = plan[k]; });
    return o;
  }

  return {
    MAX_ANTRAEGE: MAX_ANTRAEGE, MAX_PERSONEN: MAX_PERSONEN,
    dekodiere: dekodiere, bereinige: bereinige, dubletten: dubletten, nummernkreis: nummernkreis,
    mandatsreferenz: mandatsreferenz, plane: plane, fuerBrowser: fuerBrowser, maskiere: maskiere
  };
})();
