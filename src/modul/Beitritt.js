/**
 * BeitrittModul – Beitritts-Anträge aus XML-Dateien übernehmen (Nachfolger des Access-Moduls „BeitrittsXmlImportieren“).
 *
 * Zweck:      Vorschau und Import. Je Antrag (eine XML-Datei, eine oder mehrere Personen) entstehen in EINER Sperre:
 *             ein Beitragskonto (Bankdaten der Person 1), ggf. eine Beitragsgemeinschaft, neue Mitglieder mit NEUER
 *             Mitgliedsnummer (höchste vergebene + 1, keine Lücken), Mitgliedschaftszeitraum, Abteilungszugehörigkeiten.
 *             Bei Dubletten wählt der Benutzer je Person „neu anlegen“ oder „Wiedereintritt“ (neuer Zeitraum an der
 *             bestehenden Person, keine neue Nummer) – oder er überspringt den Antrag.
 * Datenquelle: Vorschau aus dem Snapshot (Snapshot.basis), Import unter der Sperre frisch aus der Tabelle (DB.lese).
 * Wer darf was: mitglied_anlegen (API) UND konto_bearbeiten (Bankdaten) – also Vorstand und Mitgliederverwaltung.
 * Besonderheiten:
 *   - Alles oder nichts je Antrag: Scheitert ein Schreibschritt, werden die bereits geschriebenen Zeilen dieses
 *     Antrags wieder entfernt (DB.entfernen), der Nummernzähler wird erst ganz am Ende fortgeschrieben.
 *   - „Erwartet = importiert“: Die Zahl der <Daten16>-Einträge muss der Zahl angelegter + zugeordneter Personen
 *     entsprechen (wie im Access-Modul), sonst wird zurückgerollt.
 *   - Kein IBAN-Klartext an den Browser und ins Protokoll (nur maskiert).
 *   - Eingang von der Homepage: Online-Anträge stehen als XML im Tab „Eingang“ einer GETRENNTEN Datei (Script
 *     Property EINGANG_ID, nie die Datenbank selbst). Gelesen wird sie mit dem vorhandenen Scope spreadsheets;
 *     die XML zerlegt der Server (src/lib/eingang.js), der Browser bekommt nur Namen und die maskierte Vorschau.
 *     Je Antrag wird unter der Sperre erneut geprüft, ob er noch „neu“ ist, und nach der Übernahme sofort
 *     abgeschlossen – so entsteht kein Antrag doppelt, auch wenn zwei Personen gleichzeitig importieren.
 */
var BeitrittModul = (function () {

  function heute() { return DB.jetzt().slice(0, 10); }

  function pruefeRechte(ktx) {
    if (!Rechte.darf(ktx, 'konto_bearbeiten')) throw Fehler.keinZugriff();
  }

  function bereinigt(antraege) {
    var b = Beitritt.bereinige(antraege);
    if (b.fehler) throw Fehler.fachlich(b.fehler);
    return b.antraege;
  }

  function kontext(tabs, konfig, nummern) {
    return {
      heute: heute(), beitragsjahr: Number(konfig.beitragsjahr) || Number(heute().slice(0, 4)),
      abteilungen: tabs.Abteilung || [], beitragsarten: tabs.Beitragsart || [],
      bestand: { Mitglied: tabs.Mitglied || [], Mitgliedschaftszeitraum: tabs.Mitgliedschaftszeitraum || [],
        Abteilungszugehoerigkeit: tabs.Abteilungszugehoerigkeit || [], Beitragskonto: tabs.Beitragskonto || [] },
      nummern: nummern
    };
  }

  // ================================================================== Vorschau

  function vorschau(ktx, antraege) {
    pruefeRechte(ktx);
    var liste = bereinigt(antraege);
    var tabs = Snapshot.basis().tabs;
    var konfig = Konfig.alle();
    var nummern = Beitritt.nummernkreis(tabs, konfig.mitgliedsnummer_naechste);
    var kx = kontext(tabs, konfig, nummern);
    return {
      antraege: liste.map(function (a) {
        var p = Beitritt.plane(a, kx);
        // vorläufige Nummern (werden beim Import unter der Sperre endgültig vergeben)
        p.personen.forEach(function (x) { x.nummer_vorlaeufig = nummern.naechste(); });
        return Beitritt.fuerBrowser(p);
      }),
      hinweis: 'Die Mitgliedsnummern sind vorläufig und werden beim Import endgültig vergeben.'
    };
  }

  // ================================================================== Import

  function entscheidungFuer(entscheidungen, i) {
    var e = (Array.isArray(entscheidungen) ? entscheidungen : []).filter(function (x) { return x && Number(x.index) === i; })[0] || {};
    return {
      ueberspringen: e.ueberspringen === true,
      gemeinschaft: e.gemeinschaft !== false,
      personen: e.personen && typeof e.personen === 'object' ? e.personen : {}
    };
  }

  /** Einen Antrag atomar übernehmen. Läuft innerhalb DB.mitSperre. */
  function einen(ktx, antrag, ent) {
    var d = DB.lese(['Mitglied', 'Mitgliedschaftszeitraum', 'Abteilungszugehoerigkeit', 'Beitragskonto', 'Abteilung', 'Beitragsart', '_Konfig']);
    var konfig = {};
    (d._Konfig || []).forEach(function (z) { if (z.schluessel) konfig[z.schluessel] = z.wert === null ? '' : String(z.wert); });
    var nummern = Beitritt.nummernkreis(d, konfig.mitgliedsnummer_naechste);
    var plan = Beitritt.plane(antrag, kontext(d, konfig, nummern));
    var t = plan.tabs, h = heute();

    // Entscheidungen je Person (Dubletten)
    var wieder = {};   // vorläufige ID → bestehendes Mitglied
    plan.personen.forEach(function (p) {
      var wahl = ent.personen[p.index] || ent.personen[String(p.index)] || '';
      if (p.dubletten.length && wahl !== 'neu' && wahl !== 'wiedereintritt') {
        throw Fehler.fachlich(antrag.datei + ': Für ' + p.name + ' gibt es einen ähnlichen Eintrag im Bestand – bitte „neu anlegen“ oder „Wiedereintritt“ wählen.');
      }
      if (wahl === 'wiedereintritt') {
        var dub = p.dubletten[0];
        if (!dub) throw Fehler.fachlich(antrag.datei + ': ' + p.name + ' hat keinen passenden Eintrag für einen Wiedereintritt.');
        if (dub.status === 'aktiv') throw Fehler.fachlich(antrag.datei + ': ' + p.name + ' ist bereits aktives Mitglied (Nr. ' + dub.mitgliedsnummer + ') – Antrag überspringen oder als neue Person anlegen.');
        wieder[t.Mitglied[p.index].mitglied_id] = dub;
      }
    });
    if (!ent.gemeinschaft && t.Beitragsgemeinschaft.length) {
      // Benutzer will keine Gemeinschaft: alle zahlen Einzelbeitrag (Beitragsart nach Gesamtbeitrag/Alter bleibt Hinweis)
      t.Mitglied.forEach(function (m) { m.beitragsgemeinschaft_id = null; });
      t.Beitragsgemeinschaft = [];
    }

    var geschrieben = [];
    function rein(tab, objekte) {
      if (!objekte.length) return [];
      var r = DB.einfuegenViele(tab, objekte, ktx);
      var feld = Schema.TABELLEN[tab].idSpalte;
      geschrieben.push({ tab: tab, ids: r.map(function (x) { return x[feld]; }) });
      return r;
    }
    function ohneId(o, feld) { var x = {}; Object.keys(o).forEach(function (k) { if (k !== feld && k !== 'version' && k !== 'geaendert_am' && k !== 'geaendert_von') x[k] = o[k]; }); return x; }

    try {
      var aenderungen = [], protokoll = [];
      // 1. Konto
      var kontoAlt = t.Beitragskonto[0];
      var kontoNeu = null;
      var vergeben = {};
      (d.Beitragskonto || []).forEach(function (k) { if (k.mandatsreferenz) vergeben[k.mandatsreferenz] = true; });
      // Nummern: neue Personen in Antragsreihenfolge
      var nrVon = {}, idVon = {};
      t.Mitglied.forEach(function (m) {
        if (wieder[m.mitglied_id]) { nrVon[m.mitglied_id] = wieder[m.mitglied_id].mitgliedsnummer; return; }
        nrVon[m.mitglied_id] = nummern.naechste();
      });
      if (kontoAlt) {
        var k = ohneId(kontoAlt, 'beitragskonto_id');
        k.kontoinhaber_mitglied_id = null;   // wird nach dem Anlegen der Person gesetzt
        if (k.zahlweg === 'Lastschrift' && k.iban) {
          var erster = t.Mitglied[0];
          var jahr = String((t.Mitgliedschaftszeitraum.filter(function (z) { return z.mitglied_id === erster.mitglied_id; })[0] || {}).eintrittsdatum || h).slice(0, 4);
          k.mandatsreferenz = Beitritt.mandatsreferenz(jahr, nrVon[erster.mitglied_id], vergeben);
        }
        kontoNeu = rein('Beitragskonto', [k])[0];
      }
      // 2. Gemeinschaft
      var gemNeu = null;
      if (t.Beitragsgemeinschaft.length) gemNeu = rein('Beitragsgemeinschaft', [ohneId(t.Beitragsgemeinschaft[0], 'beitragsgemeinschaft_id')])[0];
      // 3. Neue Mitglieder
      var neuePersonen = t.Mitglied.filter(function (m) { return !wieder[m.mitglied_id]; });
      var neuObjekte = neuePersonen.map(function (m) {
        var o = ohneId(m, 'mitglied_id');
        o.mitgliedsnummer = nrVon[m.mitglied_id];
        o.beitragskonto_id = kontoNeu ? kontoNeu.beitragskonto_id : null;
        o.beitragsgemeinschaft_id = m.beitragsgemeinschaft_id && gemNeu ? gemNeu.beitragsgemeinschaft_id : null;
        o.vertreter_mitglied_id = null;   // nach dem Anlegen
        o.status = 'aktiv';
        return o;
      });
      var angelegt = rein('Mitglied', neuObjekte);
      neuePersonen.forEach(function (m, i) { idVon[m.mitglied_id] = angelegt[i].mitglied_id; });
      // erwartet = importiert (wie im Access-Modul) – VOR allen Änderungen an bestehenden Datensätzen
      var importiert = angelegt.length + Object.keys(wieder).length;
      if (importiert !== plan.erwartet) {
        throw Fehler.fachlich(antrag.datei + ': erwartet ' + plan.erwartet + ' Person(en), übernommen ' + importiert + ' – nichts gespeichert.');
      }
      Object.keys(wieder).forEach(function (vid) { idVon[vid] = wieder[vid].mitglied_id; });
      // 4. Zeiträume und Zugehörigkeiten (auch für Wiedereintritte)
      // Zugehörigkeiten: eindeutig je (Mitglied, Abteilung). Laufende bleiben, beendete (Wiedereintritt) werden
      // wieder aufgenommen (Austritt leeren, neues Eintrittsdatum), sonst neu angelegt.
      var bisherigeZug = {};
      (d.Abteilungszugehoerigkeit || []).forEach(function (z) { bisherigeZug[z.mitglied_id + '|' + z.abteilung_id] = z; });
      var zr = rein('Mitgliedschaftszeitraum', t.Mitgliedschaftszeitraum.map(function (z) {
        var o = ohneId(z, 'zeitraum_id'); o.mitglied_id = idVon[z.mitglied_id];
        o.bemerkung = 'Beitritt aus XML: ' + antrag.datei; o.antrag_am = o.antrag_am || null;
        return o;
      }));
      var zugNeu = [], zugWieder = [];
      t.Abteilungszugehoerigkeit.forEach(function (z) {
        var alt = bisherigeZug[idVon[z.mitglied_id] + '|' + z.abteilung_id];
        if (!alt) { var o = ohneId(z, 'zugehoerigkeit_id'); o.mitglied_id = idVon[z.mitglied_id]; o.bemerkung = null; zugNeu.push(o); return; }
        if (!alt.austrittsdatum || alt.austrittsdatum >= h) return;   // läuft schon
        zugWieder.push({ id: alt.zugehoerigkeit_id, version: alt.version, aenderungen: { austrittsdatum: null, status: z.status, eintrittsdatum: z.eintrittsdatum } });
      });
      var zug = rein('Abteilungszugehoerigkeit', zugNeu);
      DB.aktualisiereViele('Abteilungszugehoerigkeit', zugWieder, ktx).forEach(function (r) { zug.push(r.neu); });
      // 5. Nachträge: Vertretung, Kontoinhaber, Wiedereintritte
      var nachMitglied = [];
      t.Mitglied.forEach(function (m) {
        if (wieder[m.mitglied_id]) return;
        if (m.vertreter_mitglied_id) nachMitglied.push({ id: idVon[m.mitglied_id], aenderungen: { vertreter_mitglied_id: idVon[m.vertreter_mitglied_id] }, version: 1 });
      });
      Object.keys(wieder).forEach(function (vid) {
        var m = t.Mitglied.filter(function (x) { return String(x.mitglied_id) === String(vid); })[0];
        nachMitglied.push({ id: wieder[vid].mitglied_id, version: wieder[vid].version, aenderungen: {
          status: 'aktiv', beitragskonto_id: kontoNeu ? kontoNeu.beitragskonto_id : null,
          beitragsgemeinschaft_id: m.beitragsgemeinschaft_id && gemNeu ? gemNeu.beitragsgemeinschaft_id : null,
          beitragsart_id: m.beitragsart_id || null,
          vertreter_mitglied_id: m.vertreter_mitglied_id ? idVon[m.vertreter_mitglied_id] : undefined
        } });
      });
      nachMitglied.forEach(function (x) { Object.keys(x.aenderungen).forEach(function (f) { if (x.aenderungen[f] === undefined) delete x.aenderungen[f]; }); });
      var mitgliedNeu = {};
      angelegt.forEach(function (m) { mitgliedNeu[m.mitglied_id] = m; });
      DB.aktualisiereViele('Mitglied', nachMitglied, ktx).forEach(function (r) { mitgliedNeu[r.neu.mitglied_id] = r.neu; });
      if (kontoNeu) {
        var inhaberId = idVon[t.Mitglied[0].mitglied_id];
        var kr = DB.aktualisiereViele('Beitragskonto', [{ id: kontoNeu.beitragskonto_id, aenderungen: { kontoinhaber_mitglied_id: inhaberId }, version: 1 }], ktx);
        if (kr.length) kontoNeu = kr[0].neu;
      }

      // 6. Nummernzähler fortschreiben (zuletzt – nur wenn alles geklappt hat)
      if (angelegt.length) Konfig.setze('mitgliedsnummer_naechste', nummern.stand(), 'Nächste freie Mitgliedsnummer');

      // Protokoll (ohne IBAN-Klartext) und Snapshot
      if (kontoNeu) {
        aenderungen.push({ tab: 'Beitragskonto', neu: kontoNeu });
        protokoll.push({ aktion: 'angelegt', tabelle: 'Beitragskonto', datensatz_id: kontoNeu.beitragskonto_id,
          kommentar: 'Beitritt aus XML, ' + kontoNeu.zahlweg + (kontoNeu.iban ? ', IBAN ' + Beitritt.maskiere(kontoNeu.iban) : '') });
      }
      if (gemNeu) aenderungen.push({ tab: 'Beitragsgemeinschaft', neu: gemNeu });
      Object.keys(mitgliedNeu).forEach(function (id) { aenderungen.push({ tab: 'Mitglied', neu: mitgliedNeu[id] }); });
      zr.forEach(function (z) { aenderungen.push({ tab: 'Mitgliedschaftszeitraum', neu: z }); });
      zug.forEach(function (z) { aenderungen.push({ tab: 'Abteilungszugehoerigkeit', neu: z }); });
      var zeilen = t.Mitglied.map(function (m, i) {
        var id = idVon[m.mitglied_id];
        var x = mitgliedNeu[id] || {};
        return { mitglied_id: id, nummer: nrVon[m.mitglied_id], name: [x.nachname || m.nachname, x.vorname || m.vorname].filter(Boolean).join(', '),
          rolle: i === 0 ? 'zahlt selbst' : 'Zahler: ' + nrVon[t.Mitglied[0].mitglied_id], wiedereintritt: !!wieder[m.mitglied_id] };
      });
      protokoll.push({ aktion: 'angelegt', tabelle: 'Mitglied', datensatz_id: zeilen.map(function (z) { return z.mitglied_id; }).join(','),
        kommentar: 'Beitritt aus XML ' + Protokoll.listenname(antrag.datei) + ': ' + zeilen.length + ' Person(en)' +
          (kontoNeu ? ', Konto ' + kontoNeu.beitragskonto_id : '') + (Object.keys(wieder).length ? ', davon Wiedereintritt: ' + Object.keys(wieder).length : '') });
      Protokoll.schreibe(ktx, protokoll);
      var snap = Snapshot.schreibe(ktx, aenderungen);
      return { datei: antrag.datei, ok: true, personen: zeilen, konto_id: kontoNeu ? kontoNeu.beitragskonto_id : null,
        gemeinschaft: gemNeu ? gemNeu.bezeichnung : null, warnungen: plan.warnungen, snapshot: snap };
    } catch (e) {
      // Zurückrollen: bereits geschriebene Zeilen dieses Antrags wieder entfernen (rückwärts)
      for (var i = geschrieben.length - 1; i >= 0; i--) {
        try { DB.entfernen(geschrieben[i].tab, geschrieben[i].ids); } catch (e2) { console.error('Beitritt: Zurückrollen ' + geschrieben[i].tab + ' fehlgeschlagen: ' + (e2 && e2.message)); }
      }
      throw e;
    }
  }

  /**
   * haken (optional, Eingang): { vorher(i) → Grund zum Auslassen oder null, nachher(i, ergebnis) } – beide laufen
   * innerhalb derselben Sperre wie der Antrag.
   */
  function importieren(ktx, antraege, entscheidungen, haken) {
    pruefeRechte(ktx);
    var liste = bereinigt(antraege);
    var ergebnisse = [], aktualisiert = {}, entfernt = {};
    liste.forEach(function (a, i) {
      var ent = entscheidungFuer(entscheidungen, i);
      if (ent.ueberspringen) { ergebnisse.push({ datei: a.datei, ok: false, grund: 'übersprungen' }); return; }
      try {
        var r = DB.mitSperre(function () {
          var grund = haken && haken.vorher ? haken.vorher(i) : null;
          if (grund) return { datei: a.datei, ok: false, grund: grund };
          var e = einen(ktx, a, ent);
          // Der Antrag ist gespeichert – ein Fehler danach (Eingang abschließen, PDF verknüpfen) darf ihn nicht als
          // „nicht importiert“ melden, sonst würde er ein zweites Mal übernommen.
          if (haken && haken.nachher) {
            try { haken.nachher(i, e); } catch (e2) {
              console.error('Beitritt ' + a.datei + ': Nacharbeit fehlgeschlagen: ' + (e2 && e2.message));
              e.warnungen = (e.warnungen || []).concat(['Übernommen, aber der Online-Antrag konnte nicht abgeschlossen werden – bitte mit „Nicht übernehmen“ (Grund: bereits übernommen) schließen und das PDF als Dokument nachtragen.']);
            }
          }
          return e;
        });
        if (!r.ok) { ergebnisse.push(r); return; }
        Object.keys(r.snapshot.aktualisiert || {}).forEach(function (k) { aktualisiert[k] = (aktualisiert[k] || []).concat(r.snapshot.aktualisiert[k]); });
        Object.keys(r.snapshot.entfernt || {}).forEach(function (k) { entfernt[k] = (entfernt[k] || []).concat(r.snapshot.entfernt[k]); });
        delete r.snapshot;
        ergebnisse.push(r);
      } catch (e) {
        var art = Fehler.artVon(e);
        if (art === 'zugriff') throw e;
        if (!art) console.error('Beitritt ' + a.datei + ': ' + (e && e.message) + '\n' + (e && e.stack));
        ergebnisse.push({ datei: a.datei, ok: false, grund: art ? e.meldung : 'Interner Fehler – nichts gespeichert.' });
      }
    });
    var ok = ergebnisse.filter(function (r) { return r.ok; });
    var personen = ok.reduce(function (n, r) { return n + r.personen.length; }, 0);
    var nicht = ergebnisse.length - ok.length;
    return {
      kopf: personen + ' neue Person(en) aus ' + ok.length + ' Antrag/Anträgen hinzugefügt.' + (nicht ? ' ' + nicht + ' Datei(en) NICHT importiert.' : ''),
      ergebnisse: ergebnisse,
      mitglied_ids: ok.reduce(function (l, r) { return l.concat(r.personen.map(function (p) { return p.mitglied_id; })); }, []),
      aenderung: { aktualisiert: aktualisiert, entfernt: entfernt }
    };
  }

  // ================================================================== Eingang von der Homepage

  var EINGANG_CACHE = 'eingang:offen';

  /** ID der Eingangstabelle aus den Script Properties (nie vom Client); null = nicht eingerichtet. */
  function eingangId() {
    var p = PropertiesService.getScriptProperties();
    var id = p.getProperty('EINGANG_ID');
    if (!id) return null;
    if (id === p.getProperty('DB_ID')) throw new Error('EINGANG_ID darf nicht die Datenbank sein – siehe docs/BETRIEB.md');
    return id;
  }

  function eingangBlatt() {
    var id = eingangId();
    if (!id) return null;
    var b = SpreadsheetApp.openById(id).getSheetByName(Eingang.TAB);
    DB.zaehle(2);
    if (!b) throw Fehler.fachlich('In der Eingangstabelle fehlt der Tab „' + Eingang.TAB + '“ – bitte eingangEinrichten() ausführen (docs/BETRIEB.md).');
    return b;
  }

  function zeitText(v) {
    if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
    return v === '' || v === null || v === undefined ? null : String(v);
  }

  /** Tab lesen → { kopf, zeilen }. Prüft die Pflichtspalten. */
  function eingangLesen(b) {
    var werte = b.getDataRange().getValues();
    DB.zaehle(2);
    var fehlt = Eingang.fehlendeSpalten(werte[0] || []);
    if (fehlt.length) throw Fehler.fachlich('Eingangstabelle: Spalte(n) ' + fehlt.join(', ') + ' fehlen – bitte eingangEinrichten() ausführen.');
    var zeilen = Eingang.zeilen(werte);
    zeilen.forEach(function (z) { z.eingang_am = zeitText(z.eingang_am); });
    return { kopf: werte[0].map(function (k) { return String(k).trim(); }), zeilen: zeilen };
  }

  function eingangAbschliessen(b, kopf, zeile, werte) {
    kopf.forEach(function (h, j) {
      if (!Object.prototype.hasOwnProperty.call(werte, h)) return;
      b.getRange(zeile.zeile, j + 1).setValue(Werte.zelleSchreiben(String(werte[h]), { typ: 'Text' }));   // Formelschutz
      DB.zaehle(1);
    });
    try { CacheService.getScriptCache().remove(EINGANG_CACHE); } catch (e) { /* nur Zähler */ }
  }

  function idListe(ids) {
    if (!Array.isArray(ids) || !ids.length) throw Fehler.fachlich('Bitte mindestens einen Antrag auswählen.');
    if (ids.length > Beitritt.MAX_ANTRAEGE) throw Fehler.fachlich('Höchstens ' + Beitritt.MAX_ANTRAEGE + ' Anträge auf einmal.');
    return ids.map(function (x) { return String(x).trim(); });
  }

  /** Offene Zeilen zu den IDs in Auswahlreihenfolge. */
  function auswahl(zeilen, ids) {
    var je = {};
    zeilen.forEach(function (z) { if (Eingang.offen(z)) je[z.eingang_id] = z; });
    return ids.map(function (id) { return je[id]; }).filter(Boolean);
  }

  /** Übersicht: offene Anträge (nur Namen) und die letzten erledigten. */
  function eingang(ktx) {
    pruefeRechte(ktx);
    var b = eingangBlatt();
    if (!b) return { eingerichtet: false };
    var e = eingangLesen(b);
    var offen = e.zeilen.filter(Eingang.offen);
    var erledigt = e.zeilen.filter(function (z) { return !Eingang.offen(z); }).slice(-10).reverse();
    return {
      eingerichtet: true,
      offen: offen.map(Eingang.fuerListe),
      erledigt: erledigt.map(function (z) {
        return { eingang_id: z.eingang_id, datei: Eingang.fuerListe(z).datei, status: z.status, erledigt_am: zeitText(z.erledigt_am), ergebnis: String(z.ergebnis || '') };
      })
    };
  }

  /** Zahl offener Anträge für die Startseite (10 min zwischengespeichert); null = nicht eingerichtet. */
  function eingangAnzahl(ktx) {
    pruefeRechte(ktx);
    if (!eingangId()) return null;
    var c = CacheService.getScriptCache();
    var v = c.get(EINGANG_CACHE);
    if (v !== null && v !== undefined) return { anzahl: Number(v) };
    var n = eingangLesen(eingangBlatt()).zeilen.filter(Eingang.offen).length;
    c.put(EINGANG_CACHE, String(n), 600);
    return { anzahl: n };
  }

  /** Anträge zu den IDs zerlegen; nicht lesbare getrennt. */
  function eingangAntraege(ids) {
    var b = eingangBlatt();
    if (!b) throw Fehler.fachlich('Die Eingangstabelle ist nicht eingerichtet (Script Property EINGANG_ID).');
    var e = eingangLesen(b);
    var gute = [], schlecht = [];
    auswahl(e.zeilen, ids).forEach(function (z) {
      var a = Eingang.antrag(z);
      if (a.fehler) schlecht.push({ eingang_id: z.eingang_id, datei: a.datei, fehler: a.fehler });
      else gute.push({ eingang_id: z.eingang_id, antrag: a });
    });
    return { blatt: b, gute: gute, schlecht: schlecht };
  }

  function eingangVorschau(ktx, ids) {
    pruefeRechte(ktx);
    var x = eingangAntraege(idListe(ids));
    var v = x.gute.length ? vorschau(ktx, x.gute.map(function (g) { return g.antrag; })) : { antraege: [], hinweis: null };
    v.antraege.forEach(function (a, i) { a.eingang_id = x.gute[i].eingang_id; });
    v.nicht_lesbar = x.schlecht;
    return v;
  }

  /** entscheidungen tragen eingang_id statt index (die Reihenfolge kann sich seit der Vorschau geändert haben). */
  function eingangImportieren(ktx, ids, entscheidungen) {
    pruefeRechte(ktx);
    var x = eingangAntraege(idListe(ids));
    if (!x.gute.length) throw Fehler.fachlich('Keiner der ausgewählten Anträge ist (noch) offen und lesbar.');
    var ent = (Array.isArray(entscheidungen) ? entscheidungen : []).map(function (e) {
      var i = -1;
      x.gute.forEach(function (g, j) { if (e && String(e.eingang_id) === g.eingang_id) i = j; });
      return i < 0 ? null : Object.assign({}, e, { index: i });
    }).filter(Boolean);
    var aktuell = null;
    var r = importieren(ktx, x.gute.map(function (g) { return g.antrag; }), ent, {
      vorher: function (i) {
        aktuell = eingangLesen(x.blatt);   // unter der Sperre frisch: noch offen?
        var z = auswahl(aktuell.zeilen, [x.gute[i].eingang_id])[0];
        return z ? null : 'bereits von jemand anderem übernommen oder abgelehnt';
      },
      nachher: function (i, e) {
        var z = auswahl(aktuell.zeilen, [x.gute[i].eingang_id])[0];
        var nummern = e.personen.map(function (p) { return p.nummer; }).join(', ');
        // Unterschriebenes PDF verknüpfen (Aufnahmeantrag je Person, SEPA-Mandat am Konto)
        var konto = e.konto_id ? (DB.lese(['Beitragskonto']).Beitragskonto || []).filter(function (k) { return k.beitragskonto_id === e.konto_id; })[0] : null;
        var doks = Eingang.dokumente(z, e, !!(konto && konto.zahlweg === 'Lastschrift'));
        if (doks.length) {
          var neu = DB.einfuegenViele('Dokument', doks, ktx);
          var snap = Snapshot.schreibe(ktx, neu.map(function (d) { return { tab: 'Dokument', neu: d }; }));
          e.snapshot.aktualisiert = e.snapshot.aktualisiert || {};
          Object.keys(snap.aktualisiert || {}).forEach(function (k) { e.snapshot.aktualisiert[k] = (e.snapshot.aktualisiert[k] || []).concat(snap.aktualisiert[k]); });
          Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Dokument', datensatz_id: neu.map(function (d) { return d.dokument_id; }).join(','), kommentar: 'Unterschriebener Online-Antrag verknüpft' }]);
          e.dokumente = neu.length;
        } else if (!z.pdf_link) {
          e.warnungen = (e.warnungen || []).concat(['Kein unterschriebenes PDF im Eingang – Antrag/Mandat bitte als Dokument nachtragen.']);
        }
        eingangAbschliessen(x.blatt, aktuell.kopf, z, Eingang.abschluss(Eingang.STATUS.uebernommen, DB.jetzt(), ktx.email, 'Nr. ' + nummern));
        Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: 'Eingang', datensatz_id: x.gute[i].eingang_id, feld: 'status', neu_wert: 'uebernommen', kommentar: 'Online-Antrag übernommen: Nr. ' + nummern }]);
      }
    });
    r.ergebnisse.forEach(function (e, i) { e.eingang_id = x.gute[i] ? x.gute[i].eingang_id : null; });
    r.nicht_lesbar = x.schlecht;
    return r;
  }

  /** Antrag ablehnen bzw. als erledigt markieren (z. B. Doppel-Absendung). grund: kurzer Text, ohne Bankdaten. */
  function eingangAblehnen(ktx, id, grund) {
    pruefeRechte(ktx);
    var g = String(grund || '').replace(/\s+/g, ' ').trim();
    if (!g) throw Fehler.fachlich('Bitte eingeben.', [{ feld: 'grund', meldung: 'Bitte kurz angeben, warum der Antrag nicht übernommen wird.' }]);
    return DB.mitSperre(function () {
      var b = eingangBlatt();
      if (!b) throw Fehler.fachlich('Die Eingangstabelle ist nicht eingerichtet (Script Property EINGANG_ID).');
      var e = eingangLesen(b);
      var z = auswahl(e.zeilen, [String(id)])[0];
      if (!z) throw Fehler.fachlich('Dieser Antrag ist nicht mehr offen. Bitte die Ansicht neu laden.');
      eingangAbschliessen(b, e.kopf, z, Eingang.abschluss(Eingang.STATUS.abgelehnt, DB.jetzt(), ktx.email, g));
      // Grund bewusst nicht ins Protokoll (Freitext, N1)
      Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: 'Eingang', datensatz_id: z.eingang_id, feld: 'status', neu_wert: 'abgelehnt', kommentar: 'Online-Antrag nicht übernommen' }]);
      return { eingang_id: z.eingang_id, status: Eingang.STATUS.abgelehnt };
    });
  }

  /** Nur Funktionskonto (Editor): Tab „Eingang“ in der Eingangstabelle anlegen bzw. fehlende Spalten anhängen. */
  function eingangEinrichten() {
    var id = eingangId();
    if (!id) throw new Error('Script Property EINGANG_ID fehlt – siehe docs/BETRIEB.md');
    var ss = SpreadsheetApp.openById(id);
    var b = ss.getSheetByName(Eingang.TAB) || ss.insertSheet(Eingang.TAB);
    var letzte = b.getLastColumn();
    var kopf = letzte ? b.getRange(1, 1, 1, letzte).getValues()[0].map(function (k) { return String(k).trim(); }) : [];
    var fehlt = Eingang.SPALTEN.filter(function (s) { return kopf.indexOf(s) < 0; });
    if (fehlt.length) b.getRange(1, kopf.length + 1, 1, fehlt.length).setValues([fehlt]);
    b.setFrozenRows(1);
    var text = fehlt.length ? 'Eingang: Spalten ergänzt: ' + fehlt.join(', ') : 'Eingang: keine Änderungen nötig.';
    console.log(text);
    return text;
  }

  return {
    vorschau: vorschau, importieren: importieren,
    eingang: eingang, eingangAnzahl: eingangAnzahl, eingangVorschau: eingangVorschau, eingangImportieren: eingangImportieren,
    eingangAblehnen: eingangAblehnen, eingangEinrichten: eingangEinrichten
  };
})();
