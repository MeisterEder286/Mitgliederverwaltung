/**
 * Datenschutz – Servermodul für Einwilligungen, Betroffenenanfragen (DSGVO Kap. III), Löschkonzept und Protokoll.
 *
 * Zweck:      Führt aus, was src/lib/loeschung.js plant: Sperren (Art. 18), Anonymisieren, endgültig Löschen,
 *             IBAN/Mandat leeren; erfasst und widerruft Einwilligungen; verwaltet Betroffenenanfragen mit Frist und
 *             erzeugt die Auskunft nach Art. 15; liest das Änderungsprotokoll rollengefiltert und bereinigt es
 *             nach Frist (Sicherheitsregeln A10, D4).
 * Datenquelle: DB (Tabs Einwilligung, Betroffenenanfrage, Aufbewahrungsfrist, _Protokoll und alle Snapshot-Tabs),
 *             Snapshot (write-through), Konfig (anonym_platzhalter, chronik_bei_anonymisierung).
 * Wer darf was (geprüft in src/api/Datenschutz.js über Api.ausfuehren):
 *   - datenschutz_bearbeiten (Vorstand, Mitgliederverwalter): alles außer dem Lesen des Protokolls.
 *   - protokoll_lesen (Vorstand, Mitgliederverwalter, Kassier): Protokoll. Der Kassier sieht nur Einträge zu
 *     Beitragskonten, Sollstellungen, Beitragsgemeinschaften und SEPA-Läufen.
 * Besonderheiten:
 *   - Alle Schreibvorgänge unter DB.mitSperre, mit Protokolleintrag. Bei Anonymisierung/Löschung werden bewusst
 *     KEINE Klartextwerte protokolliert (sonst lebten die gelöschten Daten im Protokoll weiter).
 *   - IBAN-Werte im Protokoll werden vor der Auslieferung maskiert – Klartext verlässt den Server hier nie.
 *   - Zeilen löschen: DB kennt kein Löschen (Absicht – im Normalbetrieb wird nichts gelöscht). Für Stufe 2/3 des
 *     Löschkonzepts löscht dieses Modul Zeilen gezielt über die ID (zeileLoeschen_), immer von unten nach oben.
 *   - Die Anonymisierung ist unwiderruflich; der Browser verlangt die Eingabe „ANONYMISIEREN“, der Server prüft
 *     dasselbe Wort noch einmal.
 *   - [A] Eine Betroffenenanfrage überlebt das endgültige Löschen der Person (Rechenschaft nach Art. 5 Abs. 2);
 *     mitglied_id zeigt dann auf eine nicht mehr vorhandene ID (IDs werden nie wiederverwendet).
 */
var Datenschutz = (function () {

  var BASIS_TABS = ['Mitglied', 'Mitgliedschaftszeitraum', 'Abteilung', 'Abteilungszugehoerigkeit', 'Funktionsart', 'Funktion',
    'Beitragsart', 'Beitragsgemeinschaft', 'Beitragskonto', 'Sollstellung', 'Qualifikationsart', 'Qualifikation',
    'Ehrungsregel', 'Ehrung', 'Einwilligung', 'Anschreiben', 'Dokument'];
  var KASSIER_TABELLEN = ['Beitragskonto', 'Sollstellung', 'Beitragsgemeinschaft', 'SEPA'];
  var ABGESCHLOSSEN = ['vollständig umgesetzt', 'teilweise umgesetzt', 'abgelehnt'];
  var SEITE = 50;

  function heute() { return DB.jetzt().slice(0, 10); }

  /**
   * Platzhalter statt leerer Mandatsreferenz. Grund: DB.pruefeEindeutig wertet zwei LEERE Werte als gleich – eine
   * geleerte Mandatsreferenz kollidierte sonst mit allen Überweisungskonten (Wunsch an DB: leere Einzelschlüssel nicht
   * prüfen). Der Platzhalter enthält keinen Personenbezug und verhindert zugleich die Wiederverwendung.
   */
  function mandatPlatzhalter(kontoId) { return 'GELOESCHT-' + kontoId; }
  function hat(liste, x) { return (liste || []).indexOf(x) >= 0; }

  /**
   * Formulareingaben typgerecht wandeln (gemeinsame Hilfe Werte.ausFormular): Zahlen aus Text, '' → null.
   * Schreibt das Ergebnis in `felder` zurück (Aufrufer nutzen teils das übergebene Objekt weiter).
   */
  function zahlenNormalisieren(tab, felder) {
    var t = Werte.ausFormular(tab, felder);
    Object.keys(t).forEach(function (k) { felder[k] = t[k]; });
    return felder;
  }

  function konfig() {
    try { return Konfig.alle(); } catch (e) { return {}; }
  }

  /** Alle Daten für Löschliste/Anonymisierung/Auskunft – EIN Lesezugriff (inkl. IBAN, nur serverseitig). */
  function alleDaten(mitProtokoll) {
    var tabs = BASIS_TABS.concat(['Aufbewahrungsfrist', 'Betroffenenanfrage']);
    if (mitProtokoll) tabs.push('_Protokoll');
    return DB.lese(tabs);
  }

  function mitgliedVon(daten, id) {
    return (daten.Mitglied || []).filter(function (m) { return String(m.mitglied_id) === String(id); })[0] || null;
  }

  function anzeigename(m) {
    if (!m) return '';
    return [m.nachname, m.vorname].filter(Boolean).join(', ') + (m.mitgliedsnummer ? ' (' + m.mitgliedsnummer + ')' : '');
  }

  // ------------------------------------------------------------------ Zeilen löschen (nur Löschkonzept)

  /** Löscht die Zeilen mit diesen IDs aus einem Tab (DB.entfernen). Nur innerhalb DB.mitSperre. Liefert die Anzahl. */
  function zeilenLoeschen_(tab, ids) {
    if (!ids || !ids.length) return 0;
    return DB.entfernen(tab, ids);
  }

  // ------------------------------------------------------------------ Übersicht (Startseite)

  function uebersicht(ktx) {
    var h = heute();
    var anfragen = DB.lese(['Betroffenenanfrage']).Betroffenenanfrage || [];
    var offen = 0, ueberfaellig = 0;
    anfragen.forEach(function (a) {
      var f = Loeschung.betroffenenFrist(a, h);
      if (f.status === 'offen') offen++;
      if (f.status === 'überfällig') ueberfaellig++;
    });
    return { anfragen_offen: offen, anfragen_ueberfaellig: ueberfaellig };
  }

  // ------------------------------------------------------------------ Einwilligungen

  function einwilligungSpeichern(ktx, id, version, werte) {
    werte = werte || {};
    return DB.mitSperre(function () {
      var felder = zahlenNormalisieren('Einwilligung', Rechte.erlaubteSchreibfelder(ktx, 'Einwilligung', werte));
      var fehler = [];
      if (!id && !felder.mitglied_id) fehler.push({ feld: 'mitglied_id', meldung: 'Bitte eine Person wählen.' });
      if (!id && !felder.erteilt_am) fehler.push({ feld: 'erteilt_am', meldung: 'Bitte das Datum der Einwilligung angeben.' });
      if (felder.widerrufen_am && felder.erteilt_am && felder.widerrufen_am < felder.erteilt_am) {
        fehler.push({ feld: 'widerrufen_am', meldung: 'Der Widerruf kann nicht vor der Erteilung liegen.' });
      }
      if (fehler.length) throw Fehler.fachlich('Bitte Eingaben prüfen.', fehler);
      var ergebnis;
      if (id) {
        delete felder.mitglied_id;   // Zuordnung zur Person bleibt fest
        var bisher = (DB.lese(['Einwilligung']).Einwilligung || []).filter(function (e) { return String(e.einwilligung_id) === String(id); })[0];
        if (!bisher) throw Fehler.fachlich('Die Einwilligung wurde nicht gefunden.');
        Snapshot.pruefeMitglied(ktx, bisher.mitglied_id);
        var r = DB.aktualisieren('Einwilligung', id, felder, version, ktx);
        Protokoll.schreibe(ktx, Protokoll.ausDiff('Einwilligung', id, r.diff));
        ergebnis = r.neu;
      } else {
        Snapshot.pruefeMitglied(ktx, felder.mitglied_id);
        ergebnis = DB.einfuegen('Einwilligung', felder, ktx);
        Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Einwilligung', datensatz_id: ergebnis.einwilligung_id,
          kommentar: (ergebnis.art || '') + ' für Mitglied ' + ergebnis.mitglied_id }]);
      }
      return Snapshot.schreibe(ktx, [{ tab: 'Einwilligung', neu: ergebnis }]);
    });
  }

  function einwilligungWiderrufen(ktx, id, version, datum) {
    var d = datum || heute();
    return DB.mitSperre(function () {
      var vorher = (DB.lese(['Einwilligung']).Einwilligung || []).filter(function (e) { return String(e.einwilligung_id) === String(id); })[0];
      if (!vorher) throw Fehler.fachlich('Die Einwilligung wurde nicht gefunden.');
      Snapshot.pruefeMitglied(ktx, vorher.mitglied_id);
      if (vorher.widerrufen_am) throw Fehler.fachlich('Diese Einwilligung ist bereits widerrufen.');
      if (vorher.erteilt_am && d < vorher.erteilt_am) {
        throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'widerrufen_am', meldung: 'Der Widerruf kann nicht vor der Erteilung liegen.' }]);
      }
      var r = DB.aktualisieren('Einwilligung', id, { widerrufen_am: d }, version, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: 'Einwilligung', datensatz_id: id, feld: 'widerrufen_am',
        alt_wert: '', neu_wert: d, kommentar: 'Widerruf (' + (vorher.art || '') + ')' }]);
      return Snapshot.schreibe(ktx, [{ tab: 'Einwilligung', neu: r.neu }]);
    });
  }

  // ------------------------------------------------------------------ Betroffenenanfragen

  function mitFrist(a, h, daten) {
    var o = {};
    Object.keys(a).forEach(function (k) { o[k] = a[k]; });
    var f = Loeschung.betroffenenFrist(a, h);
    o.frist = f.frist;
    o.frist_status = f.status;
    o.tage_rest = f.tage_rest;
    var m = daten ? mitgliedVon(daten, a.mitglied_id) : null;
    o.person = m ? anzeigename(m) : (a.name_bei_eingang || '(nicht mehr vorhanden)');
    return o;
  }

  function anfragen(ktx) {
    var d = DB.lese(['Betroffenenanfrage', 'Mitglied']);
    var h = heute();
    return (d.Betroffenenanfrage || []).map(function (a) { return mitFrist(a, h, d); })
      .sort(function (a, b) { return String(b.eingang_am || '').localeCompare(String(a.eingang_am || '')); });
  }

  function anfrageSpeichern(ktx, id, version, werte) {
    werte = werte || {};
    return DB.mitSperre(function () {
      var felder = zahlenNormalisieren('Betroffenenanfrage', Rechte.erlaubteSchreibfelder(ktx, 'Betroffenenanfrage', werte));
      var fehler = [];
      if (!id) {
        if (!felder.mitglied_id) fehler.push({ feld: 'mitglied_id', meldung: 'Bitte die betroffene Person wählen.' });
        if (!felder.eingang_am) fehler.push({ feld: 'eingang_am', meldung: 'Bitte das Eingangsdatum angeben (Fristbeginn).' });
        if (!felder.status) felder.status = 'eingegangen';
      }
      if (fehler.length) throw Fehler.fachlich('Bitte Eingaben prüfen.', fehler);
      var gespeichert;
      if (id) {
        var r = DB.aktualisieren('Betroffenenanfrage', id, felder, version, ktx);
        gespeichert = r.neu;
        // Datenmodell: name_bei_eingang nur bis zum Abschluss – danach leeren (sonst lebte der Name hier weiter)
        if (gespeichert.name_bei_eingang && gespeichert.rueckmeldung_am && hat(ABGESCHLOSSEN, gespeichert.status)) {
          gespeichert = DB.aktualisieren('Betroffenenanfrage', id, { name_bei_eingang: null }, gespeichert.version, ktx).neu;
          r.diff.push({ feld: 'name_bei_eingang', alt: '(Name)', neu: null });
        }
        Protokoll.schreibe(ktx, r.diff.map(function (x) {
          var name = x.feld === 'name_bei_eingang';
          return { aktion: 'geändert', tabelle: 'Betroffenenanfrage', datensatz_id: id, feld: x.feld,
            alt_wert: name ? '' : x.alt, neu_wert: name ? '' : x.neu, kommentar: name ? 'Name nicht protokolliert' : '' };
        }));
      } else {
        gespeichert = DB.einfuegen('Betroffenenanfrage', felder, ktx);
        Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Betroffenenanfrage', datensatz_id: gespeichert.anfrage_id,
          kommentar: (gespeichert.art || '') + ' – Mitglied ' + gespeichert.mitglied_id }]);
      }
      return { anfrage: mitFrist(gespeichert, heute(), DB.lese(['Mitglied'])) };
    });
  }

  /** Auskunft nach Art. 15 – vollständig (inkl. Bankverbindung, sie ist ja für die betroffene Person bestimmt). */
  function auskunft(ktx, mitgliedId) {
    var d = alleDaten(false);
    var m = mitgliedVon(d, mitgliedId);
    if (!m) throw Fehler.fachlich('Die Person wurde nicht gefunden.');
    var a = Loeschung.auskunft(m.mitglied_id, d);
    DB.mitSperre(function () {
      Protokoll.schreibe(ktx, [
        { aktion: 'eingesehen', tabelle: 'Mitglied', datensatz_id: m.mitglied_id, kommentar: 'Auskunft nach Art. 15 DSGVO erstellt' },
        { aktion: 'exportiert', tabelle: 'Mitglied', datensatz_id: m.mitglied_id, kommentar: 'Auskunft nach Art. 15 DSGVO (alle Bereiche)' }
      ]);
    });
    return {
      person: anzeigename(m), mitglied_id: m.mitglied_id, erstellt_am: DB.jetzt(),
      verein: konfig().verein_name || 'TSV Ergoldsbach e. V.',
      abschnitte: a.abschnitte
    };
  }

  // ------------------------------------------------------------------ Löschliste

  function loeschliste(ktx) {
    var d = alleDaten(true);
    var h = heute();
    var liste = Loeschung.loeschliste(d, d.Aufbewahrungsfrist || [], h, konfig());
    var protokoll = 0;
    var kandidaten = [];
    liste.forEach(function (k) {
      if (k.stufe === 'protokoll_bereinigen') { protokoll++; return; }
      var m = k.mitglied_id ? mitgliedVon(d, k.mitglied_id) : null;
      var o = { stufe: k.stufe, tab: k.tab, id: k.id, mitglied_id: k.mitglied_id, grund: k.grund, ab: k.ab,
        person: m ? anzeigename(m) : '' };
      if (k.tab === 'Mitglied' && m) o.version = m.version || 0;
      if (k.tab === 'Beitragskonto') {
        var konto = (d.Beitragskonto || []).filter(function (x) { return x.beitragskonto_id === k.id; })[0];
        if (konto) { o.version = konto.version || 0; o.person = o.person || konto.kontoinhaber_name || ''; }
      }
      kandidaten.push(o);
    });
    return { kandidaten: kandidaten, protokoll_bereinigen: protokoll, stand: h };
  }

  function sperren(ktx, mitgliedId, version, sperre) {
    return DB.mitSperre(function () {
      var d = alleDaten(false);
      var m = mitgliedVon(d, mitgliedId);
      if (!m) throw Fehler.fachlich('Die Person wurde nicht gefunden.');
      var felder;
      if (sperre === false) {
        if (m.anonymisiert === true) throw Fehler.fachlich('Anonymisierte Datensätze bleiben gesperrt.');
        felder = { verarbeitung_eingeschraenkt: false, sperre_grund: null };
      } else {
        var f = Loeschung.loeschbarAb(m.mitglied_id, d, d.Aufbewahrungsfrist || [], heute());
        if (!f || f.laeuft_noch) throw Fehler.fachlich('Die Mitgliedschaft läuft noch – gesperrt werden können nur beendete Mitgliedschaften.');
        felder = { verarbeitung_eingeschraenkt: true, loeschbar_ab: f.loeschbar_ab,
          sperre_grund: f.sperre_grund || ('Aufbewahrung bis ' + f.loeschbar_ab) };
      }
      var r = DB.aktualisieren('Mitglied', m.mitglied_id, felder, version, ktx);
      Protokoll.schreibe(ktx, [{ aktion: sperre === false ? 'geändert' : 'gesperrt', tabelle: 'Mitglied', datensatz_id: m.mitglied_id,
        feld: 'verarbeitung_eingeschraenkt', alt_wert: String(!!m.verarbeitung_eingeschraenkt), neu_wert: String(sperre !== false),
        kommentar: sperre === false ? 'Sperre aufgehoben' : 'Art. 18 DSGVO – ' + (felder.sperre_grund || '') }]);
      return Snapshot.schreibe(ktx, [{ tab: 'Mitglied', neu: r.neu }]);
    });
  }

  /** Lesbare Vorschau: welche Tabs/Felder geändert, welche Zeilen entfernt werden. Keine Klartextwerte nötig. */
  function planBeschreiben(plan) {
    var schritte = [];
    Object.keys(plan.aenderungen).forEach(function (tab) {
      plan.aenderungen[tab].forEach(function (a) {
        schritte.push({ art: 'ändern', tab: tab, id: a.id,
          felder: Object.keys(a.felder).map(function (f) { return Werte.feldname ? Werte.feldname(f) : f; }) });
      });
    });
    Object.keys(plan.entfernen).forEach(function (tab) {
      schritte.push({ art: 'entfernen', tab: tab, anzahl: plan.entfernen[tab].length });
    });
    if (plan.protokoll_bereinigen.length) {
      schritte.push({ art: 'protokoll', tab: '_Protokoll', anzahl: plan.protokoll_bereinigen.length });
    }
    return schritte;
  }

  function planFuer(d, m) {
    var f = Loeschung.loeschbarAb(m.mitglied_id, d, d.Aufbewahrungsfrist || [], heute());
    if (!f || f.laeuft_noch) {
      throw Fehler.fachlich('Die Mitgliedschaft läuft noch. Vor einer Anonymisierung muss der Austritt erfasst sein.');
    }
    if (m.anonymisiert === true) throw Fehler.fachlich('Dieser Datensatz ist bereits anonymisiert.');
    return { frist: f, plan: Loeschung.anonymisierePlan(m, d, konfig(), heute(), f) };
  }

  function anonymisierungsplan(ktx, mitgliedId) {
    var d = alleDaten(true);
    var m = mitgliedVon(d, mitgliedId);
    if (!m) throw Fehler.fachlich('Die Person wurde nicht gefunden.');
    var p = planFuer(d, m);
    return {
      person: anzeigename(m), mitglied_id: m.mitglied_id,
      anonymisieren_ab: p.frist.anonymisieren_ab, loeschbar_ab: p.frist.loeschbar_ab, sperre_grund: p.frist.sperre_grund,
      vorzeitig: p.frist.anonymisieren_ab > heute(),
      schritte: planBeschreiben(p.plan), hinweise: p.plan.hinweise
    };
  }

  function kopfVon(b) {
    var spalten = b.getLastColumn();
    var kopf = b.getRange(1, 1, 1, spalten).getValues()[0].map(function (k) { return String(k).trim(); });
    DB.zaehle(2);
    return kopf;
  }

  /** Unverändert zurückgeschriebene Texte gegen Formel-Ausführung schützen (Werte beginnend mit = + - @). */
  function schutz(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }

  /** Protokollzeilen: alt_wert/neu_wert leeren, bereinigt_am setzen. Liefert die Anzahl. Nur in mitSperre. */
  function protokollLeeren_(ids) {
    if (!ids || !ids.length) return 0;
    var b = DB.blatt('_Protokoll');
    var kopf = kopfVon(b);
    var letzte = b.getLastRow();
    DB.zaehle(1);
    if (letzte < 2) return 0;
    var iId = kopf.indexOf('protokoll_id'), iAlt = kopf.indexOf('alt_wert'), iNeu = kopf.indexOf('neu_wert'), iBer = kopf.indexOf('bereinigt_am');
    var werte = b.getRange(2, 1, letzte - 1, kopf.length).getValues();
    DB.zaehle(1);
    var gesucht = {};
    ids.forEach(function (i) { gesucht[String(i)] = true; });
    var heuteSerial = Werte.zuSerial(heute());
    var n = 0;
    werte.forEach(function (z) {
      if (!gesucht[String(z[iId])]) return;
      z[iAlt] = ''; z[iNeu] = ''; z[iBer] = heuteSerial; n++;
    });
    if (n) {
      // nur die drei betroffenen Spalten zurückschreiben (Zeitstempel und Rest bleiben unangetastet)
      b.getRange(2, iAlt + 1, werte.length, 1).setValues(werte.map(function (z) { return [schutz(z[iAlt])]; }));
      b.getRange(2, iNeu + 1, werte.length, 1).setValues(werte.map(function (z) { return [schutz(z[iNeu])]; }));
      b.getRange(2, iBer + 1, werte.length, 1).setValues(werte.map(function (z) { return [z[iBer]]; }));
      DB.zaehle(3);
    }
    DB.vorratLeeren();
    return n;
  }

  function anonymisieren(ktx, mitgliedId, bestaetigung) {
    if (bestaetigung !== 'ANONYMISIEREN') {
      throw Fehler.fachlich('Zur Bestätigung bitte das Wort ANONYMISIEREN eingeben.', [{ feld: 'bestaetigung', meldung: 'Bitte ANONYMISIEREN eingeben.' }]);
    }
    return DB.mitSperre(function () {
      var d = alleDaten(true);   // unter der Sperre frisch gelesen
      var m = mitgliedVon(d, mitgliedId);
      if (!m) throw Fehler.fachlich('Die Person wurde nicht gefunden.');
      var plan = planFuer(d, m).plan;
      var aenderungen = [];
      var geaendert = 0, entfernt = 0;
      Object.keys(plan.aenderungen).forEach(function (tab) {
        var idFeld = Schema.TABELLEN[tab].idSpalte;
        plan.aenderungen[tab].forEach(function (a) {
          var zeile = (d[tab] || []).filter(function (z) { return String(z[idFeld]) === String(a.id); })[0];
          if (!zeile) return;
          var felder = a.felder;
          if (tab === 'Beitragskonto' && Object.prototype.hasOwnProperty.call(felder, 'mandatsreferenz') && !felder.mandatsreferenz) {
            felder = Object.assign({}, felder, { mandatsreferenz: mandatPlatzhalter(a.id) });
          }
          var r = DB.aktualisieren(tab, a.id, felder, zeile.version || 0, ktx);
          geaendert++;
          aenderungen.push({ tab: tab, neu: r.neu });
        });
      });
      Object.keys(plan.entfernen).forEach(function (tab) {
        entfernt += zeilenLoeschen_(tab, plan.entfernen[tab]);
        plan.entfernen[tab].forEach(function (id) { aenderungen.push({ tab: tab, entfernt: id }); });
      });
      var bereinigt = protokollLeeren_(plan.protokoll_bereinigen);
      Protokoll.schreibe(ktx, [{ aktion: 'anonymisiert', tabelle: 'Mitglied', datensatz_id: m.mitglied_id,
        kommentar: geaendert + ' Datensätze überschrieben, ' + entfernt + ' entfernt, ' + bereinigt +
          ' Protokollwerte geleert – Klartextwerte bewusst nicht protokolliert' }]);
      var antwort = Snapshot.schreibe(ktx, aenderungen);
      antwort.bericht = { geaendert: geaendert, entfernt: entfernt, protokoll_bereinigt: bereinigt, hinweise: plan.hinweise };
      return antwort;
    });
  }

  /** Stufe 3: Zeile endgültig entfernen – nur anonymisierte Anker, deren Fristen alle abgelaufen sind. */
  function loeschen(ktx, mitgliedId, bestaetigung) {
    if (bestaetigung !== 'LÖSCHEN') {
      throw Fehler.fachlich('Zur Bestätigung bitte das Wort LÖSCHEN eingeben.', [{ feld: 'bestaetigung', meldung: 'Bitte LÖSCHEN eingeben.' }]);
    }
    return DB.mitSperre(function () {
      var d = alleDaten(false);
      var m = mitgliedVon(d, mitgliedId);
      if (!m) throw Fehler.fachlich('Die Person wurde nicht gefunden.');
      if (m.anonymisiert !== true) throw Fehler.fachlich('Endgültig gelöscht werden nur bereits anonymisierte Datensätze.');
      var f = Loeschung.loeschbarAb(m.mitglied_id, d, d.Aufbewahrungsfrist || [], heute());
      if (!f || f.laeuft_noch || f.loeschbar_ab > heute()) {
        throw Fehler.fachlich('Es läuft noch eine Aufbewahrungsfrist' + (f && f.loeschbar_ab ? ' (löschbar ab ' + f.loeschbar_ab.split('-').reverse().join('.') + ')' : '') + '.');
      }
      var id = m.mitglied_id;
      var verweise = (d.Mitglied || []).filter(function (x) { return x.mitglied_id !== id && x.vertreter_mitglied_id === id; });
      if (verweise.length) throw Fehler.fachlich('Die Person ist noch als gesetzliche Vertretung bei ' + verweise.length + ' Mitglied(ern) eingetragen.');
      // Konten, die nur noch diese Person betreffen, samt Sollstellungen entfernen
      var konten = (d.Beitragskonto || []).filter(function (k) {
        if (k.kontoinhaber_mitglied_id !== id && k.beitragskonto_id !== m.beitragskonto_id) return false;
        return !(d.Mitglied || []).some(function (x) { return x.mitglied_id !== id && x.beitragskonto_id === k.beitragskonto_id; });
      }).map(function (k) { return k.beitragskonto_id; });
      var soll = (d.Sollstellung || []).filter(function (s) { return konten.indexOf(s.beitragskonto_id) >= 0; }).map(function (s) { return s.sollstellung_id; });
      var plan = {
        Sollstellung: soll,
        Beitragskonto: konten,
        Mitgliedschaftszeitraum: (d.Mitgliedschaftszeitraum || []).filter(function (z) { return z.mitglied_id === id; }).map(function (z) { return z.zeitraum_id; }),
        Abteilungszugehoerigkeit: (d.Abteilungszugehoerigkeit || []).filter(function (z) { return z.mitglied_id === id; }).map(function (z) { return z.zugehoerigkeit_id; }),
        Funktion: (d.Funktion || []).filter(function (z) { return z.mitglied_id === id; }).map(function (z) { return z.funktion_id; }),
        Ehrung: (d.Ehrung || []).filter(function (z) { return z.mitglied_id === id; }).map(function (z) { return z.ehrung_id; }),
        Qualifikation: (d.Qualifikation || []).filter(function (z) { return z.mitglied_id === id; }).map(function (z) { return z.qualifikation_id; }),
        Einwilligung: (d.Einwilligung || []).filter(function (z) { return z.mitglied_id === id; }).map(function (z) { return z.einwilligung_id; }),
        Mitglied: [id]
      };
      var aenderungen = [], anzahl = 0;
      Object.keys(plan).forEach(function (tab) {
        anzahl += zeilenLoeschen_(tab, plan[tab]);
        plan[tab].forEach(function (x) { aenderungen.push({ tab: tab, entfernt: x }); });
      });
      Protokoll.schreibe(ktx, [{ aktion: 'gelöscht', tabelle: 'Mitglied', datensatz_id: id,
        kommentar: 'Stufe 3 – ' + anzahl + ' Zeilen endgültig entfernt (Fristen abgelaufen)' }]);
      var antwort = Snapshot.schreibe(ktx, aenderungen);
      antwort.bericht = { entfernt: anzahl };
      return antwort;
    });
  }

  /** IBAN und Mandat eines nicht mehr genutzten Kontos leeren (Frist „SEPA-Mandat und IBAN“). */
  function kontoLeeren(ktx, kontoId, version) {
    return DB.mitSperre(function () {
      var d = alleDaten(true);
      var kandidat = Loeschung.loeschliste(d, d.Aufbewahrungsfrist || [], heute(), konfig()).filter(function (k) {
        return k.stufe === 'konto_leeren' && String(k.id) === String(kontoId);
      })[0];
      if (!kandidat) throw Fehler.fachlich('Für dieses Konto ist die Frist noch nicht abgelaufen oder es wird noch genutzt.');
      var r = DB.aktualisieren('Beitragskonto', kontoId, { iban: null, bic: null, mandatsreferenz: mandatPlatzhalter(kontoId), mandatsdatum: null, aktiv: false }, version, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'gelöscht', tabelle: 'Beitragskonto', datensatz_id: kontoId, feld: 'iban',
        kommentar: 'IBAN, BIC und Mandat nach Frist geleert – Klartextwerte bewusst nicht protokolliert' }]);
      return Snapshot.schreibe(ktx, [{ tab: 'Beitragskonto', neu: r.neu }]);
    });
  }

  // ------------------------------------------------------------------ Protokoll

  function maskiert(feld, wert) {
    if (wert === null || wert === undefined || wert === '') return wert;
    var s = String(wert);
    if (feld === 'iban' || /^[A-Z]{2}\d{2}[A-Z0-9 ]{10,}$/.test(s.replace(/\s/g, '').toUpperCase())) {
      if (typeof Iban !== 'undefined' && Iban.maskiere) return Iban.maskiere(s);
      return s.slice(0, 4) + ' •••• ' + s.slice(-4);
    }
    return s;
  }

  function nurKassier(ktx) {
    return !hat(ktx.sicht, 'verwaltung') && hat(ktx.sicht, 'finanz');
  }

  /**
   * Protokoll lesen: filter { von, bis (JJJJ-MM-TT), benutzer, tabelle, aktion, datensatz }, seite ab 0, 50 je Seite,
   * neueste zuerst. Rollenfilter siehe Kopfkommentar; IBAN-Werte maskiert.
   */
  function protokoll(ktx, filter, seite) {
    filter = filter || {};
    var zeilen = DB.lese(['_Protokoll'])._Protokoll || [];
    if (nurKassier(ktx)) zeilen = zeilen.filter(function (z) { return hat(KASSIER_TABELLEN, z.tabelle); });
    var tabellen = {}, aktionen = {};
    zeilen.forEach(function (z) { if (z.tabelle) tabellen[z.tabelle] = 1; if (z.aktion) aktionen[z.aktion] = 1; });
    var b = String(filter.benutzer || '').toLowerCase();
    var treffer = zeilen.filter(function (z) {
      var tag = String(z.zeitpunkt || '').slice(0, 10);
      if (filter.von && tag < filter.von) return false;
      if (filter.bis && tag > filter.bis) return false;
      if (b && String(z.benutzer_email || '').toLowerCase().indexOf(b) < 0) return false;
      if (filter.tabelle && z.tabelle !== filter.tabelle) return false;
      if (filter.aktion && z.aktion !== filter.aktion) return false;
      if (filter.datensatz && String(z.datensatz_id) !== String(filter.datensatz)) return false;
      return true;
    }).sort(function (x, y) { return Number(y.protokoll_id || 0) - Number(x.protokoll_id || 0); });
    var s = Math.max(0, Number(seite) || 0);
    var eintraege = treffer.slice(s * SEITE, (s + 1) * SEITE).map(function (z) {
      return {
        protokoll_id: z.protokoll_id, zeitpunkt: z.zeitpunkt, benutzer_email: z.benutzer_email, aktion: z.aktion,
        tabelle: z.tabelle, datensatz_id: z.datensatz_id, feld: z.feld,
        alt_wert: maskiert(z.feld, z.alt_wert), neu_wert: maskiert(z.feld, z.neu_wert),
        kommentar: z.kommentar, bereinigt_am: z.bereinigt_am
      };
    });
    return {
      eintraege: eintraege, gesamt: treffer.length, seite: s, seiten: Math.max(1, Math.ceil(treffer.length / SEITE)),
      tabellen: Object.keys(tabellen).sort(), aktionen: Object.keys(aktionen).sort()
    };
  }

  /** alt_wert/neu_wert nach Frist (Aufbewahrungsfrist für _Protokoll) leeren. Auch für einen Zeit-Trigger geeignet. */
  function protokollBereinigen(ktx) {
    return DB.mitSperre(function () {
      var d = DB.lese(['_Protokoll', 'Aufbewahrungsfrist']);
      var frist = (d.Aufbewahrungsfrist || []).filter(function (f) {
        return f.aktiv !== false && String(f.betrifft_tab || '').split(/\s*,\s*/).indexOf('_Protokoll') >= 0;
      })[0];
      if (!frist) return { anzahl: 0, hinweis: 'Keine aktive Frist für _Protokoll im Tab Aufbewahrungsfrist.' };
      var ids = Loeschung.protokollBereinigung(d._Protokoll || [], frist, heute());
      var n = protokollLeeren_(ids);
      if (n) {
        Protokoll.schreibe(ktx, [{ aktion: 'gelöscht', tabelle: '_Protokoll', datensatz_id: '-',
          kommentar: 'Bereinigung nach Frist (' + frist.dauer_monate + ' Monate): Werte in ' + n + ' Einträgen geleert' }]);
      }
      return { anzahl: n, frist_monate: frist.dauer_monate };
    });
  }

  return {
    uebersicht: uebersicht,
    einwilligungSpeichern: einwilligungSpeichern, einwilligungWiderrufen: einwilligungWiderrufen,
    anfragen: anfragen, anfrageSpeichern: anfrageSpeichern, auskunft: auskunft,
    loeschliste: loeschliste, sperren: sperren, anonymisierungsplan: anonymisierungsplan, anonymisieren: anonymisieren,
    loeschen: loeschen, kontoLeeren: kontoLeeren,
    protokoll: protokoll, protokollBereinigen: protokollBereinigen
  };
})();
