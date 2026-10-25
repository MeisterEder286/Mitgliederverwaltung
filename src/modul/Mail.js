/**
 * Mail – E-Mail-Versand von Schreiben (Briefkopf, Text, Fußzeile, ggf. PDF) und der „Postausgang“ (Vorschläge).
 *
 * Zweck:      „Schreiben“ kann Briefe nicht nur drucken, sondern direkt als E-Mail senden: Austritts- und
 *             Aufnahmebestätigung, Rückfrage an den Zahler bei Umstellung auf Einzelbeitrag, SEPA-Vorabinformation,
 *             Rücklastschrift, Bankverbindung geändert, Mahnung … Der Postausgang zeigt, welche Schreiben fällig wären
 *             (berechnet, es wird NIE automatisch etwas gesendet).
 * Datenquelle: Briefe aus Korrespondenz.briefe (Vorlage + nach Rolle geschnittene Daten), Tab Anschreiben,
 *             _Konfig (mail_*), für den Postausgang Snapshot.fuer(ktx) (Sichtkreis), Familie.ausscheider und – nur mit
 *             protokoll_lesen – _Protokoll (Umstellungen, IBAN-Änderungen der letzten Wochen; nur Datum und ID werden
 *             genutzt, nie alte/neue Werte).
 * Wer darf was:
 *   - Senden / erneut senden: mail_senden UND anschreiben_erstellen (Vorstand, Mitgliederverwalter, Kassier).
 *     Abteilungs- und Jugendleitung dürfen keine Mails senden.
 *   - Postausgang, Versandstatus: anschreiben_erstellen.
 * Besonderheiten:
 *   - Versand nur, wenn mail_aktiv = ja ODER mail_test_an gesetzt ist. Testmodus: ALLE Mails gehen an mail_test_an,
 *     Betreff „[TEST] …“, Status „testmodus“ (C2). email_an speichert immer den eigentlichen Empfänger.
 *   - Absender ist immer das Funktionskonto (WebApp „Ausführen als Ich“); angezeigter Name mail_absendername,
 *     Antwortadresse fachlich: Finanzthemen → mail_antwort_an_finanzen, sonst mail_antwort_an (C5).
 *   - Kontingent (C4): vorher MailApp.getRemainingDailyQuota() und mail_max_je_lauf prüfen – reicht es nicht,
 *     wird gar nichts gesendet (kein Teilversand).
 *   - Ablauf: (1) unter der Sperre Anschreiben-Zeilen mit Status „entwurf“ speichern, (2) OHNE Sperre senden (je
 *     Empfänger try/catch), (3) unter der Sperre Status, gesendet_am und Protokoll schreiben. Bricht der Lauf
 *     zwischen (1) und (3) ab, bleiben Zeilen als „entwurf“ stehen – sichtbar unter „Erstellte Schreiben“.
 *   - Protokoll: ein Sammeleintrag „exportiert“ (Tabelle „E-Mail“) mit Anlass und Anzahl – ohne Adressen und Inhalte.
 *     Fehlerdetails einzelner Empfänger nur in console.error, der Browser erhält „fehlgeschlagen“.
 *   - PDF-Anhang (mail_pdf_anhang = ja) für Austritts-/Aufnahmebestätigung und Kündigungseingang:
 *     HtmlService.createHtmlOutput(html).getAs('application/pdf'). [?] ANNAHME: Diese Umwandlung braucht keinen
 *     zusätzlichen OAuth-Scope (läuft im Apps-Script-Dienst). Schlägt sie fehl, geht die Mail ohne Anhang raus,
 *     mit Hinweis im Bericht.
 *   - Rückfrage Zahler: Nach erfolgreichem Versand legt Notizen.rueckfrageAnlegen (falls vorhanden) eine
 *     Wiedervorlage an; ohne dieses Modul steht ein Hinweis im Bericht.
 */
var Mail = (function () {
  var POSTAUSGANG_TAGE = 60;
  var BANK_TAGE = 30;

  function heute() { return DB.jetzt().slice(0, 10); }
  function leer(v) { return v === null || v === undefined || v === ''; }
  function ja(v) { return v === true || /^(ja|true|1)$/i.test(String(v === null || v === undefined ? '' : v).trim()); }
  function minusTage(iso, n) { return Mitgliedschaft.plusTage(iso, -n); }
  function nameVon(m) { return m ? [m.nachname, m.vorname].filter(Boolean).join(', ') : ''; }

  function einstellungen() {
    var k = Konfig.alle();
    var test = MailBau.adresseOk(k.mail_test_an) ? String(k.mail_test_an).trim() : null;
    return {
      konfig: k, aktiv: ja(k.mail_aktiv), test_an: test,
      max: Number(k.mail_max_je_lauf) > 0 ? Math.floor(Number(k.mail_max_je_lauf)) : 100,
      pdf: ja(k.mail_pdf_anhang)
    };
  }

  function pruefeEingeschaltet(e) {
    if (!e.aktiv && !e.test_an) throw Fehler.fachlich('E-Mail-Versand ist ausgeschaltet (Verwaltung → Einstellungen).');
  }

  function kontingent() {
    try { return MailApp.getRemainingDailyQuota(); } catch (err) {
      console.error('Mail: Kontingent nicht abfragbar – ' + (err && err.message));
      throw Fehler.fachlich('Das E-Mail-Kontingent konnte nicht abgefragt werden. Bitte später erneut versuchen.');
    }
  }

  function pruefeMenge(e, n) {
    if (n > e.max) throw Fehler.fachlich('Höchstens ' + e.max + ' E-Mails je Versand (Einstellung mail_max_je_lauf). Bitte die Auswahl aufteilen.');
    var rest = kontingent();
    if (n > rest) {
      throw Fehler.fachlich('Heute können nur noch ' + rest + ' E-Mails gesendet werden (Tageskontingent von Google). Es wurde nichts gesendet – bitte die Auswahl verkleinern oder morgen senden.');
    }
  }

  /** Eine Mail senden. brief: { betreff, text|volltext, empfaenger, name, ort_datum, gruss }. Liefert { ok, hinweis }. */
  function sendeEine(e, brief, anlass, an) {
    var k = e.konfig;
    var betreff = MailBau.betreff((e.test_an ? '[TEST] ' : '') + brief.betreff);
    var ziel = e.test_an || an;
    if (!MailBau.adresseOk(ziel)) return { ok: false, hinweis: 'Ungültige E-Mail-Adresse.' };
    var nachricht = {
      to: ziel, subject: betreff,
      body: MailBau.text(brief, k), htmlBody: MailBau.html(brief, k),
      name: MailBau.betreff(k.mail_absendername || k.verein_name || 'Mitgliederverwaltung')
    };
    var antwort = MailBau.antwortAn(anlass, k);
    if (antwort) nachricht.replyTo = antwort;
    var hinweis = null;
    if (e.pdf && MailBau.PDF_ANLAESSE.indexOf(anlass) >= 0) {
      try {
        nachricht.attachments = [HtmlService.createHtmlOutput(MailBau.druckHtml(brief, k)).getAs('application/pdf').setName(MailBau.pdfName(brief, anlass))];
      } catch (err) {
        console.error('Mail: PDF-Anhang nicht erzeugt – ' + (err && err.message));
        hinweis = 'PDF-Anhang konnte nicht erzeugt werden – Mail ohne Anhang gesendet.';
      }
    }
    try {
      MailApp.sendEmail(nachricht);
      return { ok: true, hinweis: hinweis };
    } catch (err) {
      console.error('Mail: Versand fehlgeschlagen (' + anlass + ') – ' + (err && err.message));
      return { ok: false, hinweis: 'Versand fehlgeschlagen.' };
    }
  }

  /** Statuszeilen + Protokoll + Snapshot (unter der Sperre). ergebnisse: [{ id, ok }] */
  function abschliessen(ktx, e, ergebnisse, anlass, kennung, zusatzZeilen) {
    return DB.mitSperre(function () {
      var zeit = DB.jetzt();
      var status = e.test_an ? 'testmodus' : 'gesendet';
      var r = DB.aktualisiereViele('Anschreiben', ergebnisse.map(function (x) {
        return { id: x.id, version: null, aenderungen: x.ok ? { mail_status: status, gesendet_am: zeit } : { mail_status: 'fehlgeschlagen' } };
      }), ktx);
      var ok = ergebnisse.filter(function (x) { return x.ok; }).length;
      Protokoll.schreibe(ktx, [{ aktion: 'exportiert', tabelle: 'E-Mail', datensatz_id: kennung,
        kommentar: anlass + ': ' + ok + ' gesendet' + (ergebnisse.length - ok ? ', ' + (ergebnisse.length - ok) + ' fehlgeschlagen' : '') + (e.test_an ? ' (Testmodus)' : '') }]);
      return Snapshot.schreibe(ktx, r.map(function (x) { return { tab: 'Anschreiben', neu: x.neu }; }).concat(zusatzZeilen || []));
    });
  }

  /** Rückfrage Zahler: Wiedervorlage über das Notizmodul (falls vorhanden). Liefert { zeilen, hinweis }. */
  function rueckfragen(ktx, liste, konfig) {
    if (typeof Notizen === 'undefined' || !Notizen.rueckfrageAnlegen) {
      return { zeilen: [], hinweis: 'Hinweis: Die Wiedervorlage für die Rückfrage bitte selbst notieren (Notizfunktion nicht verfügbar).' };
    }
    var tage = Number(konfig.rueckfrage_wiedervorlage_tage) || 21;
    var zeilen = [], fehler = 0;
    liste.forEach(function (b) {
      if (leer(b.mitglied_id)) return;
      try {
        var n = Notizen.rueckfrageAnlegen(ktx, { mitglied_id: b.mitglied_id, beitragskonto_id: b.beitragskonto_id,
          anschreiben_id: b.anschreiben_id, wiedervorlage_am: Mitgliedschaft.plusTage(heute(), tage) });
        if (n) zeilen.push({ tab: 'Notiz', neu: n });
      } catch (err) {
        fehler++;
        console.error('Mail: Rückfrage-Notiz nicht angelegt – ' + (err && err.message));
      }
    });
    return { zeilen: zeilen, hinweis: fehler ? fehler + ' Wiedervorlage(n) konnten nicht angelegt werden – bitte selbst notieren.' : null };
  }

  // ================================================================== Senden

  /**
   * Briefe aus einer Vorlage als E-Mail senden. Gesendet wird an alle Empfänger der Auswahl, die eine E-Mail-Adresse
   * haben (der Browser schickt nur die Empfänger mit Kanal „E-Mail“). Ohne Adresse → im Bericht „ohne Adresse“.
   */
  function senden(ktx, vorlageId, auswahl, zusatz) {
    if (!Rechte.darf(ktx, 'anschreiben_erstellen')) throw Fehler.keinZugriff();
    var e = einstellungen();
    pruefeEingeschaltet(e);
    var r = Korrespondenz.briefe(ktx, vorlageId, auswahl, zusatz);
    var falsch = r.liste.filter(function (b) { return b.unbekannt.length; });
    if (falsch.length) throw Fehler.fachlich('Die Vorlage enthält unbekannte Platzhalter: ' + falsch[0].unbekannt.join(', ') + '. Bitte die Vorlage korrigieren.');
    var mit = r.liste.filter(function (b) { return b.email; });
    var ohne = r.liste.filter(function (b) { return !b.email; });
    if (!mit.length) throw Fehler.fachlich('Keiner der ausgewählten Empfänger hat eine gültige E-Mail-Adresse. Bitte als Brief drucken.');
    pruefeMenge(e, mit.length);
    var anlass = r.vorlage.anlass;
    var h = heute();
    var serie = mit.length > 1 ? 'M' + DB.jetzt().replace(/\D/g, '').slice(0, 14) : null;
    // (1) Entwürfe speichern
    var neu = DB.mitSperre(function () {
      return DB.einfuegenViele('Anschreiben', mit.map(function (b) {
        return {
          mitglied_id: b.mitglied_id, beitragskonto_id: b.beitragskonto_id, vorlage_id: r.vorlage.vorlage_id,
          anlass: anlass, datum: h, betreff: b.betreff, inhalt: Vorlagen.alsText(b), empfaenger: b.empfaenger.join('\n'),
          versandart: 'E-Mail', serie: serie, email_an: b.email, mail_status: 'entwurf'
        };
      }), ktx);
    });
    // (2) Senden – ohne Sperre, je Empfänger einzeln
    var bericht = mit.map(function (b, i) {
      b.anschreiben_id = neu[i].anschreiben_id;
      var s = sendeEine(e, b, anlass, b.email);
      return { id: b.anschreiben_id, ok: s.ok, name: b.name, hinweis: s.hinweis, brief: b };
    });
    // (3) Rückfrage-Wiedervorlagen, Status, Protokoll
    var hinweise = [];
    var notizZeilen = [];
    var erfolgreich = bericht.filter(function (x) { return x.ok; }).map(function (x) { return x.brief; });
    if (anlass === 'Rückfrage Zahler' && erfolgreich.length) {
      var rf = rueckfragen(ktx, erfolgreich, e.konfig);
      notizZeilen = rf.zeilen;
      if (rf.hinweis) hinweise.push(rf.hinweis);
    }
    var antwort = abschliessen(ktx, e, bericht, anlass, serie || String(neu[0].anschreiben_id), notizZeilen);
    var status = e.test_an ? 'testmodus' : 'gesendet';
    antwort.bericht = bericht.map(function (x) {
      return { anschreiben_id: x.id, name: x.name, status: x.ok ? status : 'fehlgeschlagen', hinweis: x.hinweis };
    }).concat(ohne.map(function (b) { return { anschreiben_id: null, name: b.name, status: 'ohne Adresse', hinweis: b.kanal_hinweis || 'Keine E-Mail-Adresse – bitte als Brief.' }; }));
    antwort.gesendet = erfolgreich.length;
    antwort.fehlgeschlagen = bericht.length - erfolgreich.length;
    antwort.testmodus = !!e.test_an;
    antwort.hinweise = hinweise;
    antwort.serie = serie;
    return antwort;
  }

  /** Fehlgeschlagene (oder als Entwurf hängengebliebene) E-Mails erneut senden – Inhalt wie gespeichert. */
  function erneutSenden(ktx, ids) {
    if (!Rechte.darf(ktx, 'anschreiben_erstellen')) throw Fehler.keinZugriff();
    var e = einstellungen();
    pruefeEingeschaltet(e);
    ids = (ids || []).map(Number).filter(function (n) { return n > 0; });
    if (!ids.length) throw Fehler.fachlich('Bitte mindestens ein Schreiben auswählen.');
    var alle = {};
    (DB.lese(['Anschreiben']).Anschreiben || []).forEach(function (a) { alle[a.anschreiben_id] = a; });
    var liste = ids.map(function (id) {
      var a = alle[id];
      if (!a) throw Fehler.fachlich('Das Schreiben wurde nicht gefunden.');
      if (!leer(a.mitglied_id)) Snapshot.pruefeMitglied(ktx, a.mitglied_id);
      else if (!Rechte.zeilenSicht(ktx).alle) throw Fehler.keinZugriff();
      if (a.mail_status !== 'fehlgeschlagen' && a.mail_status !== 'entwurf') throw Fehler.fachlich('Nur fehlgeschlagene E-Mails können erneut gesendet werden.');
      if (leer(a.inhalt)) throw Fehler.fachlich('Der Inhalt eines Schreibens wurde nach Ablauf der Frist gelöscht – bitte neu erstellen.');
      if (!MailBau.adresseOk(a.email_an)) throw Fehler.fachlich('Ein Schreiben hat keine gültige E-Mail-Adresse – bitte neu erstellen.');
      return a;
    });
    pruefeMenge(e, liste.length);
    var bericht = liste.map(function (a) {
      var b = { betreff: a.betreff, volltext: a.inhalt, empfaenger: String(a.empfaenger || '').split('\n').filter(Boolean), name: '' };
      var s = sendeEine(e, b, a.anlass, a.email_an);
      return { id: a.anschreiben_id, ok: s.ok, hinweis: s.hinweis, anlass: a.anlass, a: a };
    });
    var anlass = liste[0].anlass + (liste.some(function (a) { return a.anlass !== liste[0].anlass; }) ? ' u. a.' : '');
    var hinweise = [], notizZeilen = [];
    var rfListe = bericht.filter(function (x) { return x.ok && x.anlass === 'Rückfrage Zahler'; }).map(function (x) {
      return { mitglied_id: x.a.mitglied_id, beitragskonto_id: x.a.beitragskonto_id, anschreiben_id: x.id };
    });
    if (rfListe.length) {
      var rf = rueckfragen(ktx, rfListe, e.konfig);
      notizZeilen = rf.zeilen;
      if (rf.hinweis) hinweise.push(rf.hinweis);
    }
    var antwort = abschliessen(ktx, e, bericht, 'Erneut gesendet – ' + anlass, String(liste[0].anschreiben_id), notizZeilen);
    var status = e.test_an ? 'testmodus' : 'gesendet';
    antwort.bericht = bericht.map(function (x) { return { anschreiben_id: x.id, status: x.ok ? status : 'fehlgeschlagen', hinweis: x.hinweis }; });
    antwort.gesendet = bericht.filter(function (x) { return x.ok; }).length;
    antwort.fehlgeschlagen = bericht.length - antwort.gesendet;
    antwort.testmodus = !!e.test_an;
    antwort.hinweise = hinweise;
    return antwort;
  }

  /** Versandstatus für die Oberfläche (Schalter, Testmodus, Kontingent). */
  function status(ktx) {
    var e = einstellungen();
    var rest = null;
    if ((e.aktiv || e.test_an) && Rechte.darf(ktx, 'mail_senden')) { try { rest = MailApp.getRemainingDailyQuota(); } catch (err) { rest = null; } }
    return { aktiv: e.aktiv, testmodus: !!e.test_an, test_an: e.test_an, max: e.max, kontingent: rest,
      darf_senden: Rechte.darf(ktx, 'mail_senden'), pdf: e.pdf,
      // für die Mail-Vorschau im Browser (reiner Text, die Anzeige setzt ihn per textContent)
      briefkopf: String(e.konfig.mail_briefkopf || '').split('|').map(function (z) { return z.trim(); }).filter(Boolean),
      fusszeile: String(e.konfig.mail_fusszeile || '').split('|').map(function (z) { return z.trim(); }).filter(Boolean),
      absendername: e.konfig.mail_absendername || '' };
  }

  // ================================================================== Postausgang (Vorschläge)

  /**
   * Fällige Schreiben, berechnet aus dem Sichtkreis der Rolle. Nichts wird gesendet. Gruppen:
   * { id, titel, anlass, beschreibung, auswahl: { mitglied_ids | beitragskonto_ids | sollstellung_ids }, eintraege: [{ name, info }], zusatz }
   */
  function vorschlaege(ktx) {
    var s = Snapshot.fuer(ktx);
    var h = heute(), grenze = minusTage(h, POSTAUSGANG_TAGE);
    var mitglieder = {};
    (s.mitglieder || []).forEach(function (m) { mitglieder[m.mitglied_id] = m; });
    var briefe = s.anschreiben || [];
    var finanz = (ktx.sicht || []).indexOf('finanz') >= 0;
    // Schreiben je Person / Konto und Anlass: jüngstes Datum
    var proPerson = {}, proKonto = {};
    briefe.forEach(function (a) {
      if (a.mail_status === 'fehlgeschlagen' || a.mail_status === 'entwurf') return;   // nicht angekommen
      if (!leer(a.mitglied_id)) { var k1 = a.mitglied_id + '|' + a.anlass; if (!proPerson[k1] || proPerson[k1] < a.datum) proPerson[k1] = a.datum; }
      if (!leer(a.beitragskonto_id)) { var k2 = a.beitragskonto_id + '|' + a.anlass; if (!proKonto[k2] || proKonto[k2] < a.datum) proKonto[k2] = a.datum; }
    });
    function hatPerson(id, anlaesse, ab) { return anlaesse.some(function (x) { var d = proPerson[id + '|' + x]; return d && d >= (ab || '0000'); }); }
    function hatKonto(id, anlaesse, ab) { return anlaesse.some(function (x) { var d = proKonto[id + '|' + x]; return d && d >= (ab || '0000'); }); }
    var zrJe = {};
    (s.zeitraeume || []).forEach(function (z) { (zrJe[z.mitglied_id] = zrJe[z.mitglied_id] || []).push(z); });
    Object.keys(zrJe).forEach(function (id) { zrJe[id].sort(function (a, b) { return String(a.eintrittsdatum).localeCompare(String(b.eintrittsdatum)); }); });
    var gruppen = [];
    function gruppe(id, titel, anlass, beschreibung, art, eintraege, zusatz) {
      if (!eintraege.length) return;
      var auswahl = {};
      auswahl[art] = eintraege.map(function (x) { return x.id; });
      gruppen.push({ id: id, titel: titel, anlass: anlass, beschreibung: beschreibung, auswahl: auswahl,
        eintraege: eintraege.map(function (x) { return { id: x.id, name: x.name, info: x.info }; }), zusatz: zusatz || {} });
    }

    // 1) Austritte ohne Bestätigung
    var austritte = [];
    Object.keys(zrJe).forEach(function (id) {
      var m = mitglieder[id];
      if (!m || !leer(m.sterbedatum) || m.anonymisiert === true) return;
      var z = zrJe[id][zrJe[id].length - 1];
      if (leer(z.austrittsdatum) && leer(z.austritt_wirksam)) return;
      // Bezug: Eingang der Kündigung, sonst das Austrittsdatum (NICHT geaendert_am – nach der Migration wäre das bei allen „heute“)
      var bezug = z.kuendigung_eingang || z.austrittsdatum || z.austritt_wirksam;
      if (!bezug || bezug < grenze) return;
      if (hatPerson(m.mitglied_id, ['Austrittsbestätigung', 'Kündigungseingang'], z.eintrittsdatum)) return;
      austritte.push({ id: m.mitglied_id, name: nameVon(m), info: 'Austritt zum ' + Vorlagen.datum(z.austritt_wirksam || z.austrittsdatum) });
    });
    gruppe('austritt', 'Austrittsbestätigung fehlt', 'Austrittsbestätigung', 'Kündigung in den letzten ' + POSTAUSGANG_TAGE + ' Tagen erfasst, aber noch keine Bestätigung verschickt.', 'mitglied_ids', austritte);

    // 2) Neue Mitglieder ohne Aufnahmebestätigung / Willkommen
    var neue = [];
    Object.keys(zrJe).forEach(function (id) {
      var m = mitglieder[id];
      if (!m || (m.status_abgeleitet || m.status) !== 'aktiv') return;
      var z = Mitgliedschaft.laufenderZeitraum(zrJe[id], h);
      if (!z || !z.eintrittsdatum || z.eintrittsdatum < grenze || z.eintrittsdatum > Mitgliedschaft.plusTage(h, 31)) return;
      if (hatPerson(m.mitglied_id, ['Aufnahmebestätigung', 'Willkommen'], minusTage(z.eintrittsdatum, 31))) return;
      neue.push({ id: m.mitglied_id, name: nameVon(m), info: 'Eintritt ' + Vorlagen.datum(z.eintrittsdatum) });
    });
    gruppe('aufnahme', 'Neue Mitglieder ohne Aufnahmebestätigung', 'Aufnahmebestätigung', 'Eintritt in den letzten ' + POSTAUSGANG_TAGE + ' Tagen, noch keine Aufnahmebestätigung oder Willkommensmail.', 'mitglied_ids', neue);

    if (finanz) {
      var konten = {};
      (s.konten || []).forEach(function (k) { konten[k.beitragskonto_id] = k; });
      var protokoll = Rechte.darf(ktx, 'protokoll_lesen') ? (DB.lese(['_Protokoll'])._Protokoll || []) : [];
      var protGrenze = grenze + 'T00:00:00', bankGrenze = minusTage(h, BANK_TAGE) + 'T00:00:00';

      // 3) Umstellung auf Einzelbeitrag, Person zahlt weiter über das Konto eines anderen Mitglieds → Rückfrage
      var umgestellt = {};
      protokoll.forEach(function (p) {
        if (p.tabelle !== 'Mitglied' || String(p.zeitpunkt || '') < protGrenze) return;
        var umst = /Umstellung auf Einzelbeitrag/.test(String(p.kommentar || ''));
        if (!umst && !(p.feld === 'beitragsgemeinschaft_id' && leer(p.neu_wert) && !leer(p.alt_wert))) return;
        var id = Number(p.datensatz_id), w = /zum (\d{4}-\d{2}-\d{2})/.exec(String(p.kommentar || ''));
        var alt = umgestellt[id];
        if (!alt || alt.datum < String(p.zeitpunkt)) umgestellt[id] = { datum: String(p.zeitpunkt), wirksam: w ? w[1] : (alt && alt.wirksam) || null };
      });
      var rueck = [], wirksamZaehler = {};
      Object.keys(umgestellt).forEach(function (id) {
        var m = mitglieder[id], u = umgestellt[id];
        if (!m || (m.status_abgeleitet || m.status) !== 'aktiv' || !leer(m.beitragsgemeinschaft_id)) return;
        var k = m.beitragskonto_id ? konten[m.beitragskonto_id] : null;
        if (!k || leer(k.kontoinhaber_mitglied_id) || k.kontoinhaber_mitglied_id === m.mitglied_id) return;
        if (hatPerson(m.mitglied_id, ['Rückfrage Zahler'], u.datum.slice(0, 10))) return;
        if (u.wirksam) wirksamZaehler[u.wirksam] = (wirksamZaehler[u.wirksam] || 0) + 1;
        rueck.push({ id: m.mitglied_id, name: nameVon(m), info: 'zahlt über Konto von ' + (k.kontoinhaber_name || 'anderem Mitglied') + (u.wirksam ? ' · ab ' + Vorlagen.datum(u.wirksam) : '') });
      });
      var wirksam = Object.keys(wirksamZaehler).sort(function (a, b) { return wirksamZaehler[b] - wirksamZaehler[a]; })[0];
      gruppe('rueckfrage', 'Rückfrage an den Zahler', 'Rückfrage Zahler', 'Auf Einzelbeitrag umgestellt, der Beitrag läuft aber noch über das Konto eines anderen Mitglieds (z. B. der Eltern): Von welchem Konto soll künftig abgebucht werden?', 'mitglied_ids', rueck, wirksam ? { wirksam: wirksam } : {});

      // 4) SEPA-Vorabinformation zum anstehenden Einzug
      var vorab = [];
      (s.sollstellungen || []).forEach(function (x) {
        if (leer(x.sepa_sequenz) || leer(x.einzugsdatum) || x.einzugsdatum < h || x.status === 'storniert') return;
        var k = konten[x.beitragskonto_id];
        if (!k || hatKonto(k.beitragskonto_id, ['SEPA-Vorabinformation'], minusTage(x.einzugsdatum, POSTAUSGANG_TAGE))) return;
        vorab.push({ id: x.sollstellung_id, name: k.kontoinhaber_name || ('Konto ' + k.beitragskonto_id), info: 'Einzug ' + Vorlagen.datum(x.einzugsdatum) + ' · ' + Vorlagen.betrag(x.soll_betrag) });
      });
      gruppe('vorab', 'SEPA-Vorabinformation zum nächsten Einzug', 'SEPA-Vorabinformation', 'Für den anstehenden Lastschrifteinzug wurde noch keine Vorabinformation verschickt.', 'sollstellung_ids', vorab);

      // 5) Rücklastschriften ohne Schreiben
      var rl = [];
      (s.sollstellungen || []).forEach(function (x) {
        if (x.status !== 'ruecklastschrift') return;
        var k = konten[x.beitragskonto_id];
        var ab = x.geaendert_am ? String(x.geaendert_am).slice(0, 10) : String(x.jahr) + '-01-01';
        if (!k || hatKonto(k.beitragskonto_id, ['Rücklastschrift', 'Mahnung'], ab)) return;
        rl.push({ id: x.sollstellung_id, name: k.kontoinhaber_name || ('Konto ' + k.beitragskonto_id),
          info: 'Beitrag ' + x.jahr + ' · offen ' + Vorlagen.betrag(Math.max(0, Number(x.soll_betrag || 0) + Number(x.gebuehr || 0) - Number(x.ist_betrag || 0))) });
      });
      gruppe('ruecklastschrift', 'Rücklastschrift – Zahler informieren', 'Rücklastschrift', 'Lastschrift kam zurück, noch kein Schreiben an den Zahler.', 'sollstellung_ids', rl);

      // 6) Bankverbindung geändert → Bestätigung
      var bank = {};
      protokoll.forEach(function (p) {
        if (p.tabelle !== 'Beitragskonto' || p.feld !== 'iban' || p.aktion !== 'geändert' || String(p.zeitpunkt || '') < bankGrenze) return;
        if (leer(p.alt_wert) && !p.bereinigt_am) return;   // neues Konto, keine Änderung
        var id = Number(p.datensatz_id);
        if (!bank[id] || bank[id] < String(p.zeitpunkt)) bank[id] = String(p.zeitpunkt);
      });
      var bk = [];
      Object.keys(bank).forEach(function (id) {
        var k = konten[id];
        if (!k || k.aktiv === false || hatKonto(k.beitragskonto_id, ['Bankverbindung geändert'], bank[id].slice(0, 10))) return;
        bk.push({ id: k.beitragskonto_id, name: k.kontoinhaber_name || ('Konto ' + k.beitragskonto_id), info: 'geändert am ' + Vorlagen.datum(bank[id]) });
      });
      gruppe('bank', 'Bankverbindung geändert – Bestätigung', 'Bankverbindung geändert', 'IBAN in den letzten ' + BANK_TAGE + ' Tagen geändert, noch keine Bestätigung an den Kontoinhaber.', 'beitragskonto_ids', bk);

      // 7) Ausbildungsnachweis fällig (Familienbeitrag)
      if (typeof Familie !== 'undefined' && typeof Familie.ausscheider === 'function') {
        var nachweis = [];
        try {
          var b = Snapshot.basis();
          var jahr = Number((b.konfig || {}).beitragsjahr) || Number(h.slice(0, 4));
          var aus = Familie.ausscheider(b.tabs, jahr, b.konfig || {}, h);
          (aus.eintraege || []).forEach(function (x) {
            var m = mitglieder[x.mitglied_id];
            if (!x.nachweis_faellig || !m) return;
            if (hatPerson(m.mitglied_id, ['Ausbildungsnachweis anfordern'], grenze)) return;
            nachweis.push({ id: m.mitglied_id, name: nameVon(m), info: 'Nachweis für ' + jahr });
          });
        } catch (err) {
          console.error('Mail: Ausscheider nicht berechnet – ' + (err && err.message));
        }
        gruppe('nachweis', 'Ausbildungsnachweis anfordern', 'Ausbildungsnachweis anfordern', 'Für den Familienbeitrag ist ein Nachweis über Schule, Studium oder Ausbildung fällig.', 'mitglied_ids', nachweis);
      }
    }
    var anzahl = 0;
    gruppen.forEach(function (g) { anzahl += g.eintraege.length; });
    return { gruppen: gruppen, anzahl: anzahl, stand: h };
  }

  /** Nur die Zahl (für eine Kachel auf der Startseite). */
  function vorschlaegeAnzahl(ktx) {
    return { anzahl: vorschlaege(ktx).anzahl };
  }

  return {
    senden: senden, erneutSenden: erneutSenden, status: status,
    vorschlaege: vorschlaege, vorschlaegeAnzahl: vorschlaegeAnzahl
  };
})();
