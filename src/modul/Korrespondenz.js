/**
 * Korrespondenz – Dokument-Links (Aufnahmeantrag, SEPA-Mandat …), Briefvorlagen und Anschreiben.
 *
 * Zweck:      Serverseite der Ansicht „Schreiben“ und der Reiter „Dokumente & Schreiben“ im Mitglied-Detail.
 *             Ersetzt die Access-Funktionen MitteilungAustritt (Austrittsbestätigung), RechnungF (Rechnung),
 *             Mahnung_EinzugF (Mahnung) und WordStartenM (Serienbrief-Export für Word).
 * Datenquelle: Snapshot-Basis (Mitglied, Zeiträume, Zugehörigkeiten, Funktionen, Konten ohne IBAN-Klartext,
 *             Gemeinschaften, Sollstellungen, Ehrungen, Dokument, Anschreiben ohne Inhalt), Tab Vorlage (Text) und
 *             Tab Anschreiben (Inhalt) bei Bedarf, _Konfig (verein_*, brief_*).
 * Wer darf was:
 *   - Dokument-Links anlegen/entfernen: dokumente_verwalten (Vorstand, Mitgliederverwalter, Kassier).
 *   - Schreiben erstellen, ansehen, Serienbrief-Export: anschreiben_erstellen (dieselben Rollen).
 *   - Vorlagen pflegen: stammdaten_bearbeiten (Vorstand, Mitgliederverwalter).
 *   Platzhalter werden nur aus Feldern gefüllt, die die Rolle sehen darf (Rechte.schneide); was sie nicht sehen
 *   darf, bleibt im Brief leer. Personenbezogenes immer mit Zeilenschutz (Snapshot.pruefeMitglied).
 * Besonderheiten:
 *   - Keine Dateien in der WebApp (keine Drive-Berechtigung): Dokumente sind LINKS in den eingeschränkten
 *     Drive-Ordner; erlaubt sind nur drive.google.com/docs.google.com.
 *   - Der Brieftext wird beim Erstellen vollständig in Anschreiben.inhalt abgelegt (Nachweis, Nachdruck). Im
 *     Snapshot steht er nicht; „ansehen“ lädt ihn einzeln und protokolliert das als „eingesehen“.
 *   - Protokoll ohne Briefinhalte: ein Sammeleintrag je Erstellung (Anlass, Anzahl, Serie).
 *   - fristBereinigung() leert Inhalt und Anschrift alter Schreiben nach der Aufbewahrungsfrist „Anschreiben“
 *     (Tab Aufbewahrungsfrist, Standard 72 Monate ab Ende Geschäftsjahr) – Datum, Anlass, Betreff bleiben.
 *     Gedacht für die nächtliche Wartung (src/modul/Wartung.js).
 */
var Korrespondenz = (function () {
  var ART_LISTE = 'dokument_art';

  function heute() { return DB.jetzt().slice(0, 10); }
  function leer(v) { return v === null || v === undefined || v === ''; }
  function feldfehler(liste) { if (liste.length) throw Fehler.fachlich('Bitte Eingaben prüfen.', liste); }
  function nachId(liste, feld) { var m = {}; (liste || []).forEach(function (z) { m[z[feld]] = z; }); return m; }

  function basis() { return Snapshot.basis(); }

  // ================================================================== Dokument-Links

  function dokumentSpeichern(ktx, werte) {
    return DB.mitSperre(function () {
      var w = Werte.ausFormular('Dokument', Rechte.erlaubteSchreibfelder(ktx, 'Dokument', werte || {}));
      var id = Number((werte || {}).dokument_id) || null;
      var f = [];
      if (leer(w.titel)) f.push({ feld: 'titel', meldung: 'Titel: Angabe fehlt.' });
      if (leer(w.art) || (Schema.LISTEN[ART_LISTE] || []).indexOf(w.art) < 0) f.push({ feld: 'art', meldung: 'Art: bitte auswählen.' });
      if (!Vorlagen.istDriveLink(w.link)) {
        f.push({ feld: 'link', meldung: 'Nur Links auf Google Drive (https://drive.google.com/… oder https://docs.google.com/…).' });
      }
      if (leer(w.mitglied_id) && leer(w.beitragskonto_id)) f.push({ feld: 'mitglied_id', meldung: 'Bitte eine Person oder ein Konto zuordnen.' });
      feldfehler(f);
      w.link = String(w.link).trim();
      var d = basis().tabs;
      if (!leer(w.mitglied_id)) Snapshot.pruefeMitglied(ktx, Number(w.mitglied_id));
      if (!leer(w.beitragskonto_id) && !nachId(d.Beitragskonto, 'beitragskonto_id')[w.beitragskonto_id]) {
        feldfehler([{ feld: 'beitragskonto_id', meldung: 'Konto nicht gefunden.' }]);
      }
      var neu;
      if (id) {
        var alt = nachId(d.Dokument, 'dokument_id')[id];
        if (!alt) throw Fehler.fachlich('Das Dokument wurde nicht gefunden.');
        if (!leer(alt.mitglied_id)) Snapshot.pruefeMitglied(ktx, alt.mitglied_id);
        neu = DB.aktualisieren('Dokument', id, w, Number((werte || {}).version || 0), ktx).neu;
        Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: 'Dokument', datensatz_id: id, kommentar: w.art }]);
      } else {
        neu = DB.einfuegen('Dokument', w, ktx);
        Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Dokument', datensatz_id: neu.dokument_id, kommentar: w.art }]);
      }
      return Snapshot.schreibe(ktx, [{ tab: 'Dokument', neu: neu }]);
    });
  }

  function dokumentEntfernen(ktx, id, version) {
    return DB.mitSperre(function () {
      var alt = nachId(basis().tabs.Dokument, 'dokument_id')[Number(id)];
      if (!alt) throw Fehler.fachlich('Das Dokument wurde nicht gefunden.');
      if (!leer(alt.mitglied_id)) Snapshot.pruefeMitglied(ktx, alt.mitglied_id);
      if (Number(alt.version || 0) !== Number(version || 0)) throw Fehler.konflikt(null);
      DB.entfernen('Dokument', Number(id));
      Protokoll.schreibe(ktx, [{ aktion: 'gelöscht', tabelle: 'Dokument', datensatz_id: id, kommentar: 'Link entfernt (' + alt.art + ')' }]);
      return Snapshot.schreibe(ktx, [{ tab: 'Dokument', entfernt: Number(id) }]);
    });
  }

  /** Links aus dem Aufnahmeantrag-Archiv einer Person (Tab Aufnahmeantrag, Verweis über den Zeitraum). */
  function antragsLinks(ktx, mitgliedId) {
    Snapshot.pruefeMitglied(ktx, Number(mitgliedId));
    var d = DB.lese(['Aufnahmeantrag']).Aufnahmeantrag || [];
    var ids = {};
    (basis().tabs.Mitgliedschaftszeitraum || []).forEach(function (z) {
      if (z.mitglied_id === Number(mitgliedId) && !leer(z.aufnahmeantrag_id)) ids[z.aufnahmeantrag_id] = true;
    });
    return d.filter(function (a) { return (ids[a.antrag_id] || a.mitglied_id === Number(mitgliedId)) && Vorlagen.istDriveLink(a.formular_link); })
      .map(function (a) { return { titel: 'Aufnahmeantrag ' + Vorlagen.datum(a.formular_eingang_am || a.eingang_am), link: a.formular_link, datum: a.formular_eingang_am || null }; });
  }

  // ================================================================== Vorlagen

  function vorlagenLesen() { return DB.lese(['Vorlage']).Vorlage || []; }

  function vorlagen(ktx) {
    return { vorlagen: vorlagenLesen(), katalog: Vorlagen.KATALOG, anlaesse: Schema.LISTEN.vorlage_anlass || [] };
  }

  function vorlageSpeichern(ktx, werte) {
    return DB.mitSperre(function () {
      var w = Werte.ausFormular('Vorlage', Rechte.erlaubteSchreibfelder(ktx, 'Vorlage', werte || {}));
      var id = Number((werte || {}).vorlage_id) || null;
      var f = [];
      if (leer(w.bezeichnung)) f.push({ feld: 'bezeichnung', meldung: 'Bezeichnung: Angabe fehlt.' });
      if (leer(w.anlass)) f.push({ feld: 'anlass', meldung: 'Anlass: bitte auswählen.' });
      ['betreff', 'text'].forEach(function (x) {
        if (leer(w[x])) { f.push({ feld: x, meldung: (x === 'text' ? 'Text' : 'Betreff') + ': Angabe fehlt.' }); return; }
        var u = Vorlagen.pruefe(w[x]);
        if (u.length) f.push({ feld: x, meldung: 'Unbekannte Platzhalter: ' + u.join(', ') });
      });
      feldfehler(f);
      var neu;
      if (id) {
        var r = DB.aktualisieren('Vorlage', id, w, Number((werte || {}).version || 0), ktx);
        neu = r.neu;
        Protokoll.schreibe(ktx, Protokoll.ausDiff('Vorlage', id, r.diff.map(function (d) { return { feld: d.feld, alt: '…', neu: '…' }; })));
      } else {
        if (leer(w.aktiv)) w.aktiv = true;
        neu = DB.einfuegen('Vorlage', w, ktx);
        Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Vorlage', datensatz_id: neu.vorlage_id, kommentar: w.bezeichnung }]);
      }
      var antwort = Snapshot.schreibe(ktx, [{ tab: 'Vorlage', neu: neu }]);
      antwort.vorlage = neu;
      return antwort;
    });
  }

  // ================================================================== Briefe bauen

  /**
   * Empfängerliste aus der Auswahl { mitglied_ids | beitragskonto_ids | sollstellung_ids } (höchstens 500).
   * Jeder Eintrag: { mitglied, konto, inhaber, sollstellung } – roh (Schnitt folgt in kontext()).
   */
  function empfaenger(ktx, auswahl, jahr) {
    auswahl = auswahl || {};
    var d = basis().tabs;
    var mitglieder = nachId(d.Mitglied, 'mitglied_id'), konten = nachId(d.Beitragskonto, 'beitragskonto_id');
    var sollJe = {};
    (d.Sollstellung || []).forEach(function (s) { if (s.jahr === jahr) sollJe[s.beitragskonto_id] = s; });
    var liste = [];
    function zahl(x) { return Number(x); }
    var mIds = (auswahl.mitglied_ids || []).map(zahl), kIds = (auswahl.beitragskonto_ids || []).map(zahl),
      sIds = (auswahl.sollstellung_ids || []).map(zahl);
    if (mIds.length + kIds.length + sIds.length > 500) throw Fehler.fachlich('Höchstens 500 Empfänger je Schreiben.');
    mIds.forEach(function (id) {
      var m = mitglieder[id];
      if (!m) throw Fehler.fachlich('Eine ausgewählte Person wurde nicht gefunden.');
      Snapshot.pruefeMitglied(ktx, id);
      var k = m.beitragskonto_id ? konten[m.beitragskonto_id] : null;
      liste.push({ mitglied: m, konto: k, inhaber: k && k.kontoinhaber_mitglied_id ? mitglieder[k.kontoinhaber_mitglied_id] : null,
        sollstellung: k ? sollJe[k.beitragskonto_id] || null : null, quelle: { art: 'mitglied', id: id } });
    });
    function ausKonto(k, s, quelle) {
      if (!k) throw Fehler.fachlich('Ein ausgewähltes Konto wurde nicht gefunden.');
      var inh = k.kontoinhaber_mitglied_id ? mitglieder[k.kontoinhaber_mitglied_id] : null;
      if (inh) Snapshot.pruefeMitglied(ktx, inh.mitglied_id);
      else if (!Rechte.zeilenSicht(ktx).alle) throw Fehler.keinZugriff();
      liste.push({ mitglied: inh, konto: k, inhaber: inh, sollstellung: s, quelle: quelle });
    }
    kIds.forEach(function (id) { ausKonto(konten[id], sollJe[id] || null, { art: 'konto', id: id }); });
    if (sIds.length) {
      var soll = nachId(d.Sollstellung, 'sollstellung_id');
      sIds.forEach(function (id) {
        var s = soll[id];
        if (!s) throw Fehler.fachlich('Eine ausgewählte Sollstellung wurde nicht gefunden.');
        ausKonto(konten[s.beitragskonto_id], s, { art: 'soll', id: id });
      });
    }
    if (!liste.length) throw Fehler.fachlich('Bitte mindestens einen Empfänger auswählen.');
    return liste;
  }

  /** Daten für Vorlagen.brief – nur Felder, die die Rolle sehen darf. */
  function kontext(ktx, e, jahr, zusatz, anlass) {
    var b = basis(), d = b.tabs, h = heute();
    var m = e.mitglied ? Rechte.schneide(ktx, 'Mitglied', e.mitglied) : null;
    var k = null;
    if (e.konto && Rechte.sichtbareSpalten(ktx, 'Beitragskonto').length) {
      k = Rechte.schneide(ktx, 'Beitragskonto', e.konto);
      k.iban_maskiert = e.konto.iban_maskiert;
    }
    var inh = e.inhaber ? Rechte.schneide(ktx, 'Mitglied', e.inhaber) : null;
    var s = e.sollstellung && Rechte.sichtbareSpalten(ktx, 'Sollstellung').length ? Rechte.schneide(ktx, 'Sollstellung', e.sollstellung) : null;
    var zr = e.mitglied ? Mitgliedschaft.zeitraeumeVon(e.mitglied.mitglied_id, d.Mitgliedschaftszeitraum) : [];
    var zeitraum = zr.length ? (Mitgliedschaft.laufenderZeitraum(zr, h) || zr[zr.length - 1]) : null;
    var abt = nachId(d.Abteilung, 'abteilung_id'), arten = nachId(d.Funktionsart, 'funktionsart_id');
    var abteilungen = [], funktionen = [];
    if (e.mitglied) {
      (d.Abteilungszugehoerigkeit || []).forEach(function (z) {
        if (z.mitglied_id === e.mitglied.mitglied_id && Mitgliedschaft.laeuft(z.eintrittsdatum || '0000-01-01', z.austrittsdatum, h) && abt[z.abteilung_id]) abteilungen.push(abt[z.abteilung_id].bezeichnung);
      });
      Mitgliedschaft.laufendeFunktionen(d.Funktion, h, e.mitglied.mitglied_id).forEach(function (f) {
        var a = arten[f.funktionsart_id];
        if (a) funktionen.push(a.bezeichnung + (f.abteilung_id && abt[f.abteilung_id] ? ' ' + abt[f.abteilung_id].bezeichnung : ''));
      });
    }
    var beitragsart = null, gemeinschaft = null;
    if (m && !leer(m.beitragsgemeinschaft_id)) gemeinschaft = nachId(d.Beitragsgemeinschaft, 'beitragsgemeinschaft_id')[m.beitragsgemeinschaft_id] || null;
    if (m && !leer(m.beitragsart_id)) beitragsart = nachId(d.Beitragsart, 'beitragsart_id')[m.beitragsart_id] || null;
    var ehrung = '';
    if (anlass === 'Ehrung' && e.mitglied) {
      var regeln = nachId(d.Ehrungsregel, 'ehrungsregel_id');
      var offen = (d.Ehrung || []).filter(function (x) { return x.mitglied_id === e.mitglied.mitglied_id && x.status !== 'verliehen' && x.status !== 'abgelehnt'; })
        .sort(function (a, c) { return (c.faellig_jahr || 0) - (a.faellig_jahr || 0); })[0];
      if (offen && regeln[offen.ehrungsregel_id]) ehrung = regeln[offen.ehrungsregel_id].bezeichnung;
    }
    // Ansprechpartner: laufende Abteilungsleitung der ersten (laufenden) Abteilung – nur der Name
    var ansprechpartner = '';
    if (e.mitglied && abteilungen.length) {
      var ersteAbt = (d.Abteilung || []).filter(function (a) { return a.bezeichnung === abteilungen[0]; })[0];
      var alArt = (d.Funktionsart || []).filter(function (a) { return a.bezeichnung === 'Abteilungsleiter'; })[0];
      if (ersteAbt && alArt) {
        var al = Mitgliedschaft.laufendeFunktionen(d.Funktion, h).filter(function (f) {
          return f.funktionsart_id === alArt.funktionsart_id && f.abteilung_id === ersteAbt.abteilung_id;
        })[0];
        var alM = al ? nachId(d.Mitglied, 'mitglied_id')[al.mitglied_id] : null;
        if (alM) ansprechpartner = [alM.vorname, alM.nachname].filter(Boolean).join(' ');
      }
    }
    var geb = e.mitglied ? e.mitglied.geburtsdatum : null;   // Alter steuert die Anschrift (Vertretung) – kein Feldinhalt
    return {
      mitglied: m, konto: k, inhaber: inh, sollstellung: s, zeitraum: zeitraum,
      abteilungen: abteilungen, funktionen: funktionen, beitragsart: beitragsart, gemeinschaft: gemeinschaft,
      alter: geb ? Mitgliedschaft.alter(geb, h) : null,
      alter_im_jahr: geb && m && !leer(m.geburtsdatum) ? Mitgliedschaft.alterImJahr(geb, Number(h.slice(0, 4))) : null,
      jahr: jahr, heute: h, konfig: b.konfig || {}, ehrung: ehrung, ansprechpartner: ansprechpartner, zusatz: zusatz || {}
    };
  }

  function vorlageHolen(vorlageId) {
    var v = vorlagenLesen().filter(function (x) { return x.vorlage_id === Number(vorlageId); })[0];
    if (!v) throw Fehler.fachlich('Bitte eine Vorlage auswählen.');
    if (v.aktiv === false) throw Fehler.fachlich('Diese Vorlage ist nicht mehr aktiv.');
    return v;
  }

  function jahrAus(zusatz) {
    var j = Number((zusatz || {}).jahr) || Number(basis().konfig.beitragsjahr) || Number(heute().slice(0, 4));
    if (!(j >= 1900 && j <= 2200)) throw Fehler.fachlich('Bitte ein gültiges Jahr angeben.');
    return j;
  }

  /**
   * E-Mail-Ziel eines Schreibens (nur Felder, die die Rolle sehen darf):
   *   - Zahler-Anlässe (Rechnung, Mahnung, Vorabinformation, Rückfrage Zahler …) mit Konto: der Kontoinhaber, falls
   *     er Mitglied ist (dessen E-Mail); externer Zahler ohne Mitgliedsdatensatz → keine Adresse (Brief).
   *   - Minderjährige: vertreter_kontakt, wenn dort eine E-Mail-Adresse steht, sonst die E-Mail der Vertretung
   *     (vertreter_mitglied_id).
   *   - sonst die E-Mail der Person.
   * Liefert { email, versandart (des Adressaten), hinweis }.
   */
  function mailZiel(ktx, e, anlass, alter, mitglieder) {
    function sicht(x) { return x ? Rechte.schneide(ktx, 'Mitglied', x) : null; }
    if (e.konto && Vorlagen.AN_ZAHLER.indexOf(anlass) >= 0) {
      var inh = sicht(e.inhaber);
      if (!inh) return { email: null, versandart: 'Post', hinweis: 'Externer Zahler ohne E-Mail-Adresse – Brief.' };
      return { email: MailBau.adresseOk(inh.email) ? String(inh.email).trim() : null, versandart: inh.versandart || 'Post', hinweis: null };
    }
    var m = sicht(e.mitglied);
    if (!m) return { email: null, versandart: 'Post', hinweis: null };
    if (alter !== null && alter !== undefined && alter < 18) {
      if (MailBau.adresseOk(m.vertreter_kontakt)) return { email: String(m.vertreter_kontakt).trim(), versandart: m.versandart || 'Post', hinweis: 'An die gesetzliche Vertretung.' };
      var v = sicht(m.vertreter_mitglied_id ? mitglieder[m.vertreter_mitglied_id] : null);
      if (v && MailBau.adresseOk(v.email)) return { email: String(v.email).trim(), versandart: m.versandart || v.versandart || 'Post', hinweis: 'An die gesetzliche Vertretung.' };
      return { email: null, versandart: m.versandart || 'Post', hinweis: 'Minderjährig: keine E-Mail der Vertretung – Brief.' };
    }
    return { email: MailBau.adresseOk(m.email) ? String(m.email).trim() : null, versandart: m.versandart || 'Post', hinweis: null };
  }

  function briefe(ktx, vorlageId, auswahl, zusatz) {
    var v = vorlageHolen(vorlageId);
    zusatz = zusatz || {};
    var f = [];
    ['faellig_am', 'wirksam', 'antwort_bis'].forEach(function (x) {
      if (!leer(zusatz[x]) && !/^\d{4}-\d{2}-\d{2}$/.test(String(zusatz[x]))) f.push({ feld: x, meldung: 'Datum bitte als TT.MM.JJJJ.' });
    });
    feldfehler(f);
    var jahr = jahrAus(zusatz);
    var mitglieder = nachId(basis().tabs.Mitglied, 'mitglied_id');
    return { vorlage: v, jahr: jahr, liste: empfaenger(ktx, auswahl, jahr).map(function (e) {
      var kx = kontext(ktx, e, jahr, zusatz, v.anlass);
      var b = Vorlagen.brief(v, kx);
      var m = e.mitglied ? Rechte.schneide(ktx, 'Mitglied', e.mitglied) : {};
      b.mitglied_id = e.mitglied ? e.mitglied.mitglied_id : null;
      b.beitragskonto_id = e.konto ? e.konto.beitragskonto_id : null;
      b.name = e.mitglied ? [e.mitglied.nachname, e.mitglied.vorname].filter(Boolean).join(', ') : (e.konto ? e.konto.kontoinhaber_name : '');
      b.versandart = m.versandart || 'Post';
      var ziel = mailZiel(ktx, e, v.anlass, kx.alter, mitglieder);
      b.email = ziel.email;
      // Kanal: E-Mail nur, wenn eine Adresse vorhanden ist und der Adressat Post per E-Mail wünscht
      b.kanal = ziel.email && ziel.versandart === 'E-Mail' ? 'E-Mail' : 'Brief';
      b.kanal_hinweis = ziel.hinweis || (ziel.versandart === 'E-Mail' && !ziel.email ? 'Keine gültige E-Mail-Adresse – Brief.' : null);
      b.anlass = v.anlass;
      b.quelle = e.quelle;
      return b;
    }) };
  }

  /** Vorschau ohne Speichern. Warnungen: unbekannte Platzhalter, leere Pflichtangaben (z. B. Betrag bei Rechnung). */
  function vorschau(ktx, vorlageId, auswahl, zusatz) {
    var r = briefe(ktx, vorlageId, auswahl, zusatz);
    var unbekannt = {}, leerFelder = {};
    r.liste.forEach(function (b) {
      b.unbekannt.forEach(function (x) { unbekannt[x] = true; });
      b.leer.forEach(function (x) { leerFelder[x] = (leerFelder[x] || 0) + 1; });
    });
    return { anlass: r.vorlage.anlass, jahr: r.jahr, briefe: r.liste, unbekannt: Object.keys(unbekannt), leer: leerFelder };
  }

  /** Erstellen: je Empfänger eine Anschreiben-Zeile (EIN Schreibzugriff), Protokoll-Sammeleintrag ohne Inhalte. */
  function erstellen(ktx, vorlageId, auswahl, zusatz) {
    return DB.mitSperre(function () {
      var r = briefe(ktx, vorlageId, auswahl, zusatz);
      var falsch = r.liste.filter(function (b) { return b.unbekannt.length; });
      if (falsch.length) throw Fehler.fachlich('Die Vorlage enthält unbekannte Platzhalter: ' + falsch[0].unbekannt.join(', ') + '. Bitte die Vorlage korrigieren.');
      var h = heute();
      var serie = r.liste.length > 1 ? 'S' + DB.jetzt().replace(/\D/g, '').slice(0, 14) : null;
      var zeilen = r.liste.map(function (b) {
        return {
          mitglied_id: b.mitglied_id, beitragskonto_id: b.beitragskonto_id, vorlage_id: r.vorlage.vorlage_id,
          anlass: r.vorlage.anlass, datum: h, betreff: b.betreff, inhalt: Vorlagen.alsText(b),
          empfaenger: b.empfaenger.join('\n'), serie: serie,
          // gedruckte Briefe (Kanal „Brief“) sind Post – auch wenn die Person sonst E-Mail bevorzugt
          versandart: (zusatz || {}).kanal === 'Brief' ? 'Post' : (b.versandart === 'E-Mail' ? 'E-Mail' : 'Post')
        };
      });
      var neu = DB.einfuegenViele('Anschreiben', zeilen, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Anschreiben', datensatz_id: serie || neu[0].anschreiben_id,
        kommentar: r.vorlage.anlass + ': ' + neu.length + ' Schreiben' }]);
      var antwort = Snapshot.schreibe(ktx, neu.map(function (z) { return { tab: 'Anschreiben', neu: z }; }));
      antwort.briefe = r.liste.map(function (b, i) { b.anschreiben_id = neu[i].anschreiben_id; return b; });
      antwort.serie = serie;
      return antwort;
    });
  }

  function anschreibenZeile(ktx, id) {
    var a = (DB.lese(['Anschreiben']).Anschreiben || []).filter(function (x) { return x.anschreiben_id === Number(id); })[0];
    if (!a) throw Fehler.fachlich('Das Schreiben wurde nicht gefunden.');
    if (!leer(a.mitglied_id)) Snapshot.pruefeMitglied(ktx, a.mitglied_id);
    else if (!Rechte.zeilenSicht(ktx).alle) throw Fehler.keinZugriff();
    return a;
  }

  /** Ein erstelltes Schreiben vollständig laden (Nachdruck) – protokolliert als „eingesehen“. */
  function anschreiben(ktx, id) {
    var a = anschreibenZeile(ktx, id);
    Protokoll.schreibe(ktx, [{ aktion: 'eingesehen', tabelle: 'Anschreiben', datensatz_id: a.anschreiben_id, kommentar: a.anlass }]);
    var c = basis().konfig || {};
    return {
      anschreiben_id: a.anschreiben_id, mitglied_id: a.mitglied_id, beitragskonto_id: a.beitragskonto_id, anlass: a.anlass,
      datum: a.datum, betreff: a.betreff, inhalt: a.inhalt || '', empfaenger: String(a.empfaenger || '').split('\n').filter(Boolean),
      absender: c.brief_absender || c.verein_name || '', versandart: a.versandart, dokument_link: a.dokument_link || null,
      version: a.version, bereinigt: !a.inhalt
    };
  }

  /** PDF-/Ablage-Link zu einem Schreiben nachtragen. */
  function anschreibenLink(ktx, id, version, link) {
    return DB.mitSperre(function () {
      var a = anschreibenZeile(ktx, id);
      if (!leer(link) && !Vorlagen.istDriveLink(link)) feldfehler([{ feld: 'dokument_link', meldung: 'Nur Links auf Google Drive (https://drive.google.com/…).' }]);
      var r = DB.aktualisieren('Anschreiben', a.anschreiben_id, { dokument_link: leer(link) ? null : String(link).trim() }, Number(version || 0), ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: 'Anschreiben', datensatz_id: a.anschreiben_id, feld: 'dokument_link' }]);
      return Snapshot.schreibe(ktx, [{ tab: 'Anschreiben', neu: r.neu }]);
    });
  }

  // ================================================================== Serienbrief-Export (Word)

  /** Zeilen für den Word-Seriendruck (Access „WordStartenM“). Protokolliert als „exportiert“ (ohne Personendaten). */
  function serienExport(ktx, auswahl, zusatz) {
    var jahr = jahrAus(zusatz);
    var liste = empfaenger(ktx, auswahl, jahr);
    var zeilen = liste.map(function (e) {
      var kx = kontext(ktx, e, jahr, zusatz || {}, (zusatz || {}).anlass || 'Allgemein');
      var adr = Vorlagen.anschrift((zusatz || {}).anlass || 'Allgemein', kx);
      var w = Vorlagen.werte(kx);
      var m = kx.mitglied || {};
      return {
        mitgliedsnummer: m.mitgliedsnummer || '', anrede: m.anrede || '', briefanrede: adr.briefanrede,
        titel: m.titel || '', vorname: m.vorname || '', nachname: m.nachname || '',
        anschrift1: adr.zeilen[0] || '', anschrift2: adr.zeilen[1] || '', anschrift3: adr.zeilen[2] || '', anschrift4: adr.zeilen[3] || '',
        strasse: w.strasse ? [w.strasse, w.hausnummer].filter(Boolean).join(' ') : '', plz: w.plz, ort: w.ort,
        email: m.email || '', versandart: m.versandart || '', beitrag: w.beitrag, betrag: w.betrag, offen: w.offen
      };
    });
    DB.mitSperre(function () {
      Protokoll.schreibe(ktx, [{ aktion: 'exportiert', tabelle: 'Anschreiben', datensatz_id: '-', kommentar: 'Serienbrief-Export: ' + zeilen.length + ' Zeilen' }]);
    });
    return { zeilen: zeilen };
  }

  // ================================================================== Aufbewahrung

  /**
   * Leert Inhalt und Anschrift von Schreiben, deren Aufbewahrungsfrist abgelaufen ist (Tab Aufbewahrungsfrist,
   * Zeile mit betrifft_tab „Anschreiben“; Bezugspunkt Ende Geschäftsjahr = 31.12. des Briefjahres).
   * Für die nächtliche Wartung. Liefert die Anzahl bereinigter Schreiben.
   */
  function fristBereinigung(stichtag) {
    var h = stichtag || heute();
    var ktx = { email: 'wartung@system', rollen: [], aktionen: [], sicht: [] };
    return DB.mitSperre(function () {
      var d = DB.lese(['Anschreiben', 'Aufbewahrungsfrist']);
      var frist = (d.Aufbewahrungsfrist || []).filter(function (f) {
        return f.aktiv !== false && String(f.betrifft_tab || '').split(/\s*,\s*/).indexOf('Anschreiben') >= 0;
      })[0];
      if (!frist || leer(frist.dauer_monate)) return 0;
      var monate = Number(frist.dauer_monate);
      var liste = (d.Anschreiben || []).filter(function (a) {
        if (leer(a.inhalt) && leer(a.empfaenger) && leer(a.email_an)) return false;
        var bezug = frist.bezugspunkt === 'Ende Geschäftsjahr' ? String(a.datum).slice(0, 4) + '-12-31' : a.datum;
        return Mitgliedschaft.plusMonate(bezug, monate) < h;
      }).map(function (a) { return { id: a.anschreiben_id, aenderungen: { inhalt: null, empfaenger: null, email_an: null }, version: null }; });
      if (!liste.length) return 0;
      var r = DB.aktualisiereViele('Anschreiben', liste, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: 'Anschreiben', datensatz_id: '-', kommentar: 'Fristbereinigung: Inhalt von ' + r.length + ' Schreiben geleert' }]);
      try { Snapshot.schreibe(ktx, r.map(function (x) { return { tab: 'Anschreiben', neu: x.neu }; })); }
      catch (e) { Snapshot.verwerfen(); }   // Systemlauf ohne Rolle: im Zweifel Cache neu aufbauen lassen
      return r.length;
    });
  }

  return {
    dokumentSpeichern: dokumentSpeichern, dokumentEntfernen: dokumentEntfernen, antragsLinks: antragsLinks,
    vorlagen: vorlagen, vorlageSpeichern: vorlageSpeichern,
    vorschau: vorschau, erstellen: erstellen, anschreiben: anschreiben, anschreibenLink: anschreibenLink,
    briefe: briefe, anschreibenZeile: anschreibenZeile,
    serienExport: serienExport, fristBereinigung: fristBereinigung
  };
})();
