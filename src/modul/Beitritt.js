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
        // wie Mitglieder.wiedereintritt: für eine verstorbene Person kein Wiedereintritt
        if (dub.status === 'verstorben') throw Fehler.fachlich(antrag.datei + ': ' + p.name + ' (Nr. ' + dub.mitgliedsnummer + ') ist als verstorben erfasst – kein Wiedereintritt möglich.');
        wieder[t.Mitglied[p.index].mitglied_id] = dub;
      }
    });
    // Ohne gültiges Eintrittsdatum legt die Migration keinen Mitgliedschaftszeitraum an (Prüfliste eintritt_fehlt) –
    // die Person wäre ohne Status, Beitrag und BLSV-Zählung. Dann nichts speichern.
    t.Mitglied.forEach(function (m, i) {
      if (!(t.Mitgliedschaftszeitraum || []).some(function (z) { return z.mitglied_id === m.mitglied_id; })) {
        throw Fehler.fachlich(antrag.datei + ': Das Eintrittsdatum von ' + (plan.personen[i] ? plan.personen[i].name : 'Person ' + (i + 1)) + ' ist ungültig – bitte im Antrag korrigieren.');
      }
    });
    if (!ent.gemeinschaft && t.Beitragsgemeinschaft.length) {
      // Benutzer will keine Gemeinschaft: alle zahlen Einzelbeitrag (Beitragsart nach Gesamtbeitrag/Alter bleibt Hinweis)
      t.Mitglied.forEach(function (m) { m.beitragsgemeinschaft_id = null; });
      t.Beitragsgemeinschaft = [];
    }

    // Für das Zurückrollen: eingefügte Zeilen (werden entfernt), Änderungen an Zeilen (alte Werte werden
    // zurückgeschrieben) und der Nummernzähler (alter Wert). Vorher wurden nur Einfügungen zurückgenommen –
    // ein Wiedereintritt blieb dann halb gespeichert, der Zähler sprang trotz „nichts gespeichert“ (Prüfbefund H4).
    var geschrieben = [], geaendert = [], zaehler = null;
    function aendere(tab, liste) {
      var r = DB.aktualisiereViele(tab, liste, ktx);
      var feld = Schema.TABELLEN[tab].idSpalte;
      r.forEach(function (x) {
        var alt = {};
        x.diff.forEach(function (d) { alt[d.feld] = d.alt; });
        geaendert.push({ tab: tab, id: x.neu[feld], alt: alt });
      });
      return r;
    }
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
      aendere('Abteilungszugehoerigkeit', zugWieder).forEach(function (r) { zug.push(r.neu); });
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
      aendere('Mitglied', nachMitglied).forEach(function (r) { mitgliedNeu[r.neu.mitglied_id] = r.neu; });
      if (kontoNeu) {
        var inhaberId = idVon[t.Mitglied[0].mitglied_id];
        var kr = aendere('Beitragskonto', [{ id: kontoNeu.beitragskonto_id, aenderungen: { kontoinhaber_mitglied_id: inhaberId }, version: 1 }]);
        if (kr.length) kontoNeu = kr[0].neu;
      }

      // 6. Nummernzähler fortschreiben (zuletzt – nur wenn alles geklappt hat)
      if (angelegt.length) zaehler = { alt: Konfig.setze('mitgliedsnummer_naechste', nummern.stand(), 'Nächste freie Mitgliedsnummer') };

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
      // Zurückrollen (rückwärts): 1. Zähler, 2. Änderungen an bestehenden Zeilen, 3. eingefügte Zeilen entfernen
      if (zaehler) {
        try { Konfig.setze('mitgliedsnummer_naechste', zaehler.alt === null ? '' : zaehler.alt, 'Nächste freie Mitgliedsnummer'); }
        catch (e2) { console.error('Beitritt: Zurückrollen Nummernzähler fehlgeschlagen: ' + (e2 && e2.message)); }
      }
      for (var j = geaendert.length - 1; j >= 0; j--) {
        try { DB.aktualisiereViele(geaendert[j].tab, [{ id: geaendert[j].id, aenderungen: geaendert[j].alt, version: null }], ktx); }
        catch (e2) { console.error('Beitritt: Zurückrollen ' + geaendert[j].tab + ' ' + geaendert[j].id + ' fehlgeschlagen: ' + (e2 && e2.message)); }
      }
      for (var i = geschrieben.length - 1; i >= 0; i--) {
        try { DB.entfernen(geschrieben[i].tab, geschrieben[i].ids); } catch (e2) { console.error('Beitritt: Zurückrollen ' + geschrieben[i].tab + ' fehlgeschlagen: ' + (e2 && e2.message)); }
      }
      // Der Cache kann schon Zeilen dieses Antrags enthalten (Fehler nach Snapshot.schreibe) – neu aufbauen lassen
      if (geschrieben.length || geaendert.length) { try { Snapshot.verwerfen(); } catch (e2) { /* unkritisch */ } }
      throw e;
    }
  }

  function importieren(ktx, antraege, entscheidungen) {
    pruefeRechte(ktx);
    var liste = bereinigt(antraege);
    var ergebnisse = [], aktualisiert = {}, entfernt = {};
    liste.forEach(function (a, i) {
      var ent = entscheidungFuer(entscheidungen, i);
      if (ent.ueberspringen) { ergebnisse.push({ datei: a.datei, ok: false, grund: 'übersprungen' }); return; }
      try {
        var r = DB.mitSperre(function () { return einen(ktx, a, ent); });
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

  return { vorschau: vorschau, importieren: importieren };
})();
