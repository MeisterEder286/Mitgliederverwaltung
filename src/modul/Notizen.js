/**
 * Notizen – interne Notizen, Rückfragen und Wiedervorlagen je Person oder Beitragskonto (Tab Notiz).
 *
 * Zweck:      Vermerke („Telefonat am …“), Wiedervorlagen („Nachweis anfordern im März“) und Rückfragen an Mitglieder
 *             (z. B. „Von welchem Konto soll nach der Umstellung auf den Einzelbeitrag abgebucht werden?“) festhalten
 *             und abarbeiten. Fällige Einträge erscheinen auf der Startseite und in der Ansicht „Notizen“.
 * Datenquelle: Snapshot-Basis (Tab Notiz, Mitglied, Konten) für Prüfungen; Schreiben über DB, write-through in den
 *             Snapshot; _Konfig.rueckfrage_wiedervorlage_tage.
 * Wer darf was: Lesen notiz_lesen, Schreiben notiz_schreiben (alle Rollen) – WAS jemand sieht bzw. in welchen Leserkreis
 *             er schreiben darf, regelt src/lib/notizen.js (NotizRegeln). Zusätzlich Zeilenschutz: Notizen nur zu
 *             Personen im eigenen Sichtkreis (Snapshot.pruefeMitglied). Ändern/Erledigen: Verfasser oder Verwaltung;
 *             Löschen: nur Verwaltung und nur ohne laufenden Vorgang.
 * Besonderheiten:
 *   - Das Protokoll enthält NIE den Notiztext (nur Art, Leserkreis, Bezug) – der Text kann Persönliches enthalten.
 *   - Rückfrage Zahler: rueckfrageAnlegen() wird nach dem Versand der Rückfrage-Mail aufgerufen (auch innerhalb einer
 *     bestehenden DB.mitSperre – die Sperre ist wiedereintrittsfähig). Die Antwort ändert BEWUSST kein Konto: Ein
 *     eigenes Konto braucht ein unterschriebenes SEPA-Mandat, also das Kontoformular in „Finanzen“. Die Antwort
 *     erledigt die Rückfrage und legt bei Bedarf eine Folge-Wiedervorlage für die Kasse an („Konto anlegen und Person
 *     umhängen“); der Browser bekommt ein Sprungziel.
 *   - Personenbezogene Notizen sind Teil der Auskunft (Art. 15), werden bei Anonymisierung entfernt und nach der
 *     Aufbewahrungsfrist „Interne Notizen“ in der Wartung gelöscht (fristBereinigung).
 */
var Notizen = (function () {
  var TEXT_MAX = 4000;

  function heute() { return DB.jetzt().slice(0, 10); }
  function leer(v) { return v === null || v === undefined || v === ''; }
  function feldfehler(liste) { if (liste.length) throw Fehler.fachlich('Bitte Eingaben prüfen.', liste); }
  function basisTabs() { return Snapshot.basis().tabs; }
  function finde(id) {
    return (basisTabs().Notiz || []).filter(function (n) { return Number(n.notiz_id) === Number(id); })[0] || null;
  }

  /** Bezug prüfen: Person im Sichtkreis, Konto existiert und (bei eingeschränkter Sicht) gehört zu einer sichtbaren Person. */
  function pruefeBezug(ktx, w) {
    if (!leer(w.mitglied_id)) Snapshot.pruefeMitglied(ktx, Number(w.mitglied_id));
    if (!leer(w.beitragskonto_id)) {
      var t = basisTabs();
      var konto = (t.Beitragskonto || []).filter(function (k) { return Number(k.beitragskonto_id) === Number(w.beitragskonto_id); })[0];
      if (!konto) feldfehler([{ feld: 'beitragskonto_id', meldung: 'Konto nicht gefunden.' }]);
      if (!Rechte.zeilenSicht(ktx).alle) {
        var ok = (t.Mitglied || []).some(function (m) {
          return Number(m.beitragskonto_id) === Number(w.beitragskonto_id) && SnapshotKern.mitgliedSichtbar(Snapshot.basis(), ktx, heute(), m.mitglied_id);
        });
        if (!ok) throw Fehler.keinZugriff();
      }
    }
  }

  /** Lesezugriff auf eine bestehende Notiz: Leserkreis + Bezug sichtbar, sonst keinZugriff. */
  function pruefeLesbar(ktx, n) {
    if (!n) throw Fehler.fachlich('Die Notiz wurde nicht gefunden.');
    if (!NotizRegeln.sichtbar(ktx, n)) throw Fehler.keinZugriff();
    pruefeBezug(ktx, n);
  }

  function eingaben(ktx, werte) {
    var w = Werte.ausFormular('Notiz', Rechte.erlaubteSchreibfelder(ktx, 'Notiz', werte || {}));
    delete w.erstellt_von; delete w.erledigt_am; delete w.ergebnis; delete w.anschreiben_id;
    if (w.text !== null && w.text !== undefined) w.text = String(w.text).trim();
    if (w.sichtbar_fuer !== 'Abteilung') w.abteilung_id = null;
    return w;
  }

  function pruefeEingaben(ktx, w, neu) {
    var f = [];
    if (neu || w.text !== undefined) {
      if (leer(w.text)) f.push({ feld: 'text', meldung: 'Text: Angabe fehlt.' });
      else if (w.text.length > TEXT_MAX) f.push({ feld: 'text', meldung: 'Text: höchstens ' + TEXT_MAX + ' Zeichen.' });
    }
    if (neu || w.art !== undefined) {
      if ((Schema.LISTEN.notiz_art || []).indexOf(w.art) < 0) f.push({ feld: 'art', meldung: 'Art: bitte auswählen.' });
    }
    if (neu || w.sichtbar_fuer !== undefined) {
      if (!NotizRegeln.darfKreis(ktx, w.sichtbar_fuer, w.abteilung_id)) {
        f.push({ feld: 'sichtbar_fuer', meldung: w.sichtbar_fuer === 'Abteilung' && leer(w.abteilung_id)
          ? 'Bitte die Abteilung wählen.' : 'Diesen Leserkreis können Sie nicht wählen.' });
      }
    }
    if (neu && leer(w.mitglied_id) && leer(w.beitragskonto_id)) f.push({ feld: 'mitglied_id', meldung: 'Bitte eine Person oder ein Konto zuordnen.' });
    if (!leer(w.wiedervorlage_am) && !/^\d{4}-\d{2}-\d{2}$/.test(String(w.wiedervorlage_am))) {
      f.push({ feld: 'wiedervorlage_am', meldung: 'Wiedervorlage: Datum als TT.MM.JJJJ.' });
    }
    feldfehler(f);
  }

  /** Anlegen (ohne notiz_id) oder ändern (mit notiz_id + version). */
  function speichern(ktx, werte) {
    werte = werte || {};
    return DB.mitSperre(function () {
      var id = Number(werte.notiz_id) || null;
      var w = eingaben(ktx, werte);
      var neu;
      if (id) {
        var alt = finde(id);
        pruefeLesbar(ktx, alt);
        if (!NotizRegeln.darfAendern(ktx, alt)) throw Fehler.keinZugriff();
        // Bezug einer bestehenden Notiz bleibt; nur Inhalt, Art, Leserkreis, Wiedervorlage sind änderbar
        delete w.mitglied_id; delete w.beitragskonto_id;
        if (w.sichtbar_fuer === undefined) { w.sichtbar_fuer = alt.sichtbar_fuer; if (w.abteilung_id === null) w.abteilung_id = alt.abteilung_id; }
        pruefeEingaben(ktx, w, false);
        neu = DB.aktualisieren('Notiz', id, w, Number(werte.version) || 0, ktx).neu;
        Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: 'Notiz', datensatz_id: id, kommentar: neu.art + ' · ' + neu.sichtbar_fuer }]);
      } else {
        pruefeEingaben(ktx, w, true);
        pruefeBezug(ktx, w);
        w.erstellt_von = ktx.email;
        neu = DB.einfuegen('Notiz', w, ktx);
        Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Notiz', datensatz_id: neu.notiz_id,
          kommentar: neu.art + ' · ' + neu.sichtbar_fuer + (neu.mitglied_id ? ' · Mitglied ' + neu.mitglied_id : ' · Konto ' + neu.beitragskonto_id) }]);
      }
      return Snapshot.schreibe(ktx, [{ tab: 'Notiz', neu: neu }]);
    });
  }

  /** Erledigen mit kurzem Ergebnis. */
  function erledigen(ktx, id, version, ergebnis) {
    return DB.mitSperre(function () {
      var alt = finde(id);
      pruefeLesbar(ktx, alt);
      if (!NotizRegeln.darfAendern(ktx, alt)) throw Fehler.keinZugriff();
      if (alt.erledigt_am) throw Fehler.fachlich('Diese Notiz ist bereits erledigt.');
      var r = DB.aktualisieren('Notiz', Number(id), { erledigt_am: heute(), ergebnis: leer(ergebnis) ? null : String(ergebnis).trim().slice(0, 500) },
        Number(version) || 0, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'beendet', tabelle: 'Notiz', datensatz_id: id, kommentar: alt.art + ' erledigt' }]);
      return Snapshot.schreibe(ktx, [{ tab: 'Notiz', neu: r.neu }]);
    });
  }

  function loeschen(ktx, id, version) {
    return DB.mitSperre(function () {
      var alt = finde(id);
      pruefeLesbar(ktx, alt);
      var d = NotizRegeln.darfLoeschen(ktx, alt);
      if (!d.ok) { if (d.grund === 'zugriff') throw Fehler.keinZugriff(); throw Fehler.fachlich(d.grund); }
      if (Number(alt.version || 0) !== Number(version || 0)) throw Fehler.konflikt(null);
      DB.entfernen('Notiz', Number(id));
      Protokoll.schreibe(ktx, [{ aktion: 'gelöscht', tabelle: 'Notiz', datensatz_id: id, kommentar: alt.art }]);
      return Snapshot.schreibe(ktx, [{ tab: 'Notiz', entfernt: Number(id) }]);
    });
  }

  /** Offene/fällige Rückfragen und Wiedervorlagen im Sichtkreis (für Startseite/„Zu erledigen“). */
  function offene(ktx) {
    var h = heute();
    var sicht = SnapshotKern.fuer(Snapshot.basis(), ktx, h).notizen || [];
    var liste = sicht.filter(function (n) { return NotizRegeln.offen(n) && (n.art === 'Rückfrage' || n.wiedervorlage_am); });
    return {
      heute: h,
      faellig: NotizRegeln.sortiereZuErledigen(liste.filter(function (n) { return NotizRegeln.faellig(n, h); })),
      offen: NotizRegeln.sortiereZuErledigen(liste)
    };
  }

  /**
   * Rückfrage „auf wen abbuchen?“ anlegen – intern (z. B. von src/modul/Mail.js nach Versand der Rückfrage-Mail).
   * opt: { mitglied_id, beitragskonto_id?, anschreiben_id?, wiedervorlage_am?, text? }. Funktioniert innerhalb einer
   * bestehenden Sperre. Liefert die neue Notiz (Snapshot wird mit aktualisiert).
   */
  function rueckfrageAnlegen(ktx, opt) {
    opt = opt || {};
    return DB.mitSperre(function () {
      if (leer(opt.mitglied_id)) throw Fehler.fachlich('Rückfrage: Person fehlt.');
      Snapshot.pruefeMitglied(ktx, Number(opt.mitglied_id));
      var tage = Number(Konfig.wert('rueckfrage_wiedervorlage_tage')) || 21;
      var w = {
        mitglied_id: Number(opt.mitglied_id),
        beitragskonto_id: leer(opt.beitragskonto_id) ? null : Number(opt.beitragskonto_id),
        art: 'Rückfrage',
        text: opt.text || 'Rückfrage: Von welchem Konto soll künftig abgebucht werden?',
        sichtbar_fuer: 'Finanzen',
        wiedervorlage_am: opt.wiedervorlage_am || Mitgliedschaft.plusTage(heute(), tage),
        anschreiben_id: leer(opt.anschreiben_id) ? null : Number(opt.anschreiben_id),
        erstellt_von: ktx.email
      };
      var neu = DB.einfuegen('Notiz', w, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Notiz', datensatz_id: neu.notiz_id, kommentar: 'Rückfrage Zahler · Mitglied ' + w.mitglied_id }]);
      Snapshot.schreibe(ktx, [{ tab: 'Notiz', neu: neu }]);
      return neu;
    });
  }

  /**
   * Antwort auf eine Rückfrage: entscheidung 'konto_bleibt' | 'eigenes_konto' | 'ueberweisung'.
   * Ändert kein Konto (Mandat/Unterschrift nötig) – erledigt die Rückfrage und legt bei Kontowechsel eine
   * Folge-Wiedervorlage für die Kasse an. Rückgabe: Snapshot-Antwort + sprung { ansicht, param } für den Browser.
   */
  function rueckfrageAntwort(ktx, id, version, antwort) {
    antwort = antwort || {};
    var text = NotizRegeln.ANTWORTEN[antwort.entscheidung];
    if (!text) feldfehler([{ feld: 'entscheidung', meldung: 'Bitte eine Antwort wählen.' }]);
    return DB.mitSperre(function () {
      var alt = finde(id);
      pruefeLesbar(ktx, alt);
      if (alt.art !== 'Rückfrage') throw Fehler.fachlich('Das ist keine Rückfrage.');
      if (alt.erledigt_am) throw Fehler.fachlich('Diese Rückfrage ist bereits beantwortet.');
      if (!NotizRegeln.darfAendern(ktx, alt) && !NotizRegeln.sichtbar(ktx, alt)) throw Fehler.keinZugriff();
      var ergebnis = text + (leer(antwort.bemerkung) ? '' : ' ' + String(antwort.bemerkung).trim().slice(0, 300));
      var r = DB.aktualisieren('Notiz', Number(id), { erledigt_am: heute(), ergebnis: ergebnis }, Number(version) || 0, ktx);
      var aenderungen = [{ tab: 'Notiz', neu: r.neu }];
      var protokoll = [{ aktion: 'beendet', tabelle: 'Notiz', datensatz_id: id, kommentar: 'Rückfrage beantwortet: ' + antwort.entscheidung }];
      var sprung = null;
      if (antwort.entscheidung !== 'konto_bleibt') {
        var folge = DB.einfuegen('Notiz', {
          mitglied_id: alt.mitglied_id, beitragskonto_id: alt.beitragskonto_id, art: 'Wiedervorlage',
          text: antwort.entscheidung === 'eigenes_konto'
            ? 'Eigenes Konto anlegen (SEPA-Mandat mit Unterschrift einholen) und Person umhängen.'
            : 'Konto mit Zahlweg Überweisung anlegen und Person umhängen.',
          sichtbar_fuer: 'Finanzen', wiedervorlage_am: heute(), erstellt_von: ktx.email
        }, ktx);
        aenderungen.push({ tab: 'Notiz', neu: folge });
        protokoll.push({ aktion: 'angelegt', tabelle: 'Notiz', datensatz_id: folge.notiz_id, kommentar: 'Folge-Wiedervorlage Konto' });
        sprung = alt.beitragskonto_id ? { ansicht: 'konto', param: { id: alt.beitragskonto_id } } : { ansicht: 'finanzen', param: null };
      }
      Protokoll.schreibe(ktx, protokoll);
      var a = Snapshot.schreibe(ktx, aenderungen);
      a.sprung = sprung;
      return a;
    });
  }

  /**
   * Wartung: erledigte Notizen nach der Aufbewahrungsfrist „Interne Notizen“ (Tab Aufbewahrungsfrist, betrifft_tab
   * enthält 'Notiz'; Standard 36 Monate ab Austritt) entfernen. Erledigte Notizen ohne Personenbezug bzw. zu
   * Personen ohne Austritt bleiben. Liefert { anzahl }.
   */
  function fristBereinigung(stichtag) {
    var h = stichtag || heute();
    var ktx = { email: 'wartung@system', rollen: [], aktionen: [], sicht: [] };
    return DB.mitSperre(function () {
      var d = DB.lese(['Notiz', 'Mitglied', 'Mitgliedschaftszeitraum', 'Aufbewahrungsfrist', 'Beitragskonto']);
      var frist = (d.Aufbewahrungsfrist || []).filter(function (f) {
        return f.aktiv !== false && String(f.betrifft_tab || '').indexOf('Notiz') >= 0;
      })[0];
      var monate = frist && frist.dauer_monate !== null && frist.dauer_monate !== undefined ? Number(frist.dauer_monate) : 36;
      if (!isFinite(monate)) return { anzahl: 0 };
      var personen = {}, konten = {};
      (d.Mitglied || []).forEach(function (m) { personen[m.mitglied_id] = m; });
      (d.Beitragskonto || []).forEach(function (k) { konten[k.beitragskonto_id] = k; });
      var weg = (d.Notiz || []).filter(function (n) {
        if (!n.erledigt_am) return false;
        // Notiz nur am Konto (ohne Person): weg, wenn das Konto fehlt oder nach Löschkonzept geleert ist
        // (stillgelegt, ohne IBAN und Mandatsdatum – siehe Datenschutz.kontoLeeren). Vorher blieben sie für immer.
        if (leer(n.mitglied_id)) {
          if (leer(n.beitragskonto_id)) return false;
          var k = konten[n.beitragskonto_id];
          return !k || (k.aktiv === false && leer(k.iban) && leer(k.mandatsdatum));
        }
        var m = personen[n.mitglied_id];
        if (!m) return true;   // Person gelöscht → Notiz verwaist
        var zr = Mitgliedschaft.zeitraeumeVon(m.mitglied_id, d.Mitgliedschaftszeitraum);
        if (Mitgliedschaft.status(m, zr, h) === 'aktiv' || !zr.length) return false;
        var ende = m.sterbedatum || Mitgliedschaft.endeVon(zr[zr.length - 1]);
        return !!ende && Mitgliedschaft.plusMonate(ende, monate) <= h;
      }).map(function (n) { return n.notiz_id; });
      if (!weg.length) return { anzahl: 0 };
      weg.forEach(function (id) { DB.entfernen('Notiz', id); });
      Protokoll.schreibe(ktx, [{ aktion: 'gelöscht', tabelle: 'Notiz', datensatz_id: '-', kommentar: weg.length + ' erledigte Notizen nach Aufbewahrungsfrist bzw. geleertem Konto entfernt' }]);
      Snapshot.schreibe(ktx, weg.map(function (id) { return { tab: 'Notiz', entfernt: id }; }));
      return { anzahl: weg.length };
    });
  }

  /** Export-Vermerk (CSV im Browser erzeugt; nur Verwaltung). */
  function exportVermerken(ktx, anzahl) {
    if ((ktx.sicht || []).indexOf('verwaltung') < 0) throw Fehler.keinZugriff();
    Protokoll.schreibe(ktx, [{ aktion: 'exportiert', tabelle: 'Notiz', datensatz_id: '-', kommentar: 'Notizen: ' + (Number(anzahl) || 0) + ' Zeilen' }]);
    return true;
  }

  return {
    speichern: speichern, erledigen: erledigen, loeschen: loeschen, offene: offene,
    rueckfrageAnlegen: rueckfrageAnlegen, rueckfrageAntwort: rueckfrageAntwort,
    fristBereinigung: fristBereinigung, exportVermerken: exportVermerken
  };
})();
