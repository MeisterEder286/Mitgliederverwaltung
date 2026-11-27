/**
 * NachweiseModul – Führungszeugnisse (FZ) und Lizenzen: Übersicht mit Ampel, Einsicht erfassen, Fristen, Löschung.
 *
 * Zweck:      Serverseite der Ansicht „Nachweise“. Fachregeln (Wiedervorlage, Löschfrist, Ampel, Eingabeprüfung)
 *             stehen in src/lib/fristen.js.
 * Datenquelle: Snapshot-Basis (Qualifikation, Qualifikationsart, Funktion, Funktionsart, Mitglied) + _Konfig.
 * Wer darf was: lesen qualifikation_lesen (Vorstand, Mitgliederverwalter, Jugendleiter, Abteilungsleiter),
 *             erfassen/löschen qualifikation_erfassen (dieselben; Abteilungsleiter beschlossen 10/2026).
 *             Zeilenschutz: Abteilungs-/Jugendleiter sehen und bearbeiten nur Personen ihres Sichtkreises
 *             (Snapshot.pruefeMitglied); „Fristen neu berechnen“ nur mit Zeilensicht „alle“.
 * Besonderheiten:
 *   - § 72a SGB VIII: gespeichert wird nur, DASS eingesehen wurde (ausgestellt_am, eingesehen_am, durch wen,
 *     „ohne einschlägigen Eintrag“, Wiedervorlage) – nie Inhalte, nie ein Dokument. eingesehen_durch setzt der
 *     Server aus dem Benutzerkonto, nicht aus der Eingabe.
 *   - Das Protokoll nennt nur Art und Datensatz, keine Werte (Datensparsamkeit).
 *   - wiedervorlage_am und zu_loeschen_ab werden beim Speichern abgeleitet (Fristen.abgeleitet); die
 *     Löschfrist hängt an ALLEN nachweispflichtigen Funktionen der Person, deshalb rechnet der Server dafür
 *     auf der vollständigen Basis (das Ergebnis ist nur ein Datum).
 */
var NachweiseModul = (function () {

  function heute() { return DB.jetzt().slice(0, 10); }

  function funktionsText(f, arten, abteilungen) {
    var a = arten[f.funktionsart_id] || {};
    var ab = abteilungen[f.abteilung_id];
    return (a.bezeichnung || 'Funktion') + (ab ? ' ' + ab.bezeichnung : '') + (f.zusatz ? ' (' + f.zusatz + ')' : '');
  }

  /** Übersicht für ktx (Sichtkreis beachtet). */
  function uebersicht(ktx) {
    var bd = Bereichsdaten.fuer(ktx);
    var d = bd.daten;
    var u = Fristen.uebersicht(d, bd.heute, bd.konfig);
    var mitglieder = Bereichsdaten.index(d.Mitglied, 'mitglied_id');
    var funktionen = Bereichsdaten.index(d.Funktion, 'funktion_id');
    var fArten = Bereichsdaten.index(d.Funktionsart, 'funktionsart_id');
    var abt = Bereichsdaten.index(d.Abteilung, 'abteilung_id');
    var quals = Bereichsdaten.index(d.Qualifikation, 'qualifikation_id');
    var qArten = Bereichsdaten.index(d.Qualifikationsart, 'qualifikationsart_id');
    var personen = u.personen.filter(function (p) { return mitglieder[p.mitglied_id]; }).map(function (p) {
      var m = mitglieder[p.mitglied_id];
      var q = p.fz ? quals[p.fz.qualifikation_id] || {} : null;
      var fs = p.funktion_ids.map(function (id) { return funktionen[id]; }).filter(Boolean);
      return {
        mitglied_id: p.mitglied_id, mitgliedsnummer: m.mitgliedsnummer || null, name: Bereichsdaten.name(m),
        funktionen: fs.map(function (f) { return funktionsText(f, fArten, abt); }),
        funktion_seit: fs.map(function (f) { return f.von; }).sort()[0] || null,
        funktion_ids: p.funktion_ids,
        fz: p.fz ? { qualifikation_id: p.fz.qualifikation_id, version: q.version || null, ausgestellt_am: q.ausgestellt_am || null,
          eingesehen_am: p.fz.eingesehen_am, eingesehen_durch: q.eingesehen_durch || null, wiedervorlage: p.fz.wiedervorlage } : null,
        ampel: p.ampel, lizenzen: p.lizenzen
      };
    });
    var zuLoeschen = u.zu_loeschen.filter(function (z) { return mitglieder[z.mitglied_id]; }).map(function (z) {
      var q = quals[z.qualifikation_id] || {};
      return { qualifikation_id: z.qualifikation_id, version: q.version || null, mitglied_id: z.mitglied_id,
        name: Bereichsdaten.name(mitglieder[z.mitglied_id]), zu_loeschen_ab: z.zu_loeschen_ab, eingesehen_am: q.eingesehen_am || null };
    });
    var plus3 = Mitgliedschaft.plusMonate(bd.heute, 3);
    var lizenzenAlle = (d.Qualifikation || []).filter(function (q) {
      var a = qArten[q.qualifikationsart_id];
      return a && a.kategorie !== 'Führungszeugnis' && !q.geloescht_am && mitglieder[q.mitglied_id];
    }).map(function (q) {
      var a = qArten[q.qualifikationsart_id];
      var stand = !q.gueltig_bis ? 'unbefristet' : q.gueltig_bis < bd.heute ? 'abgelaufen' : q.gueltig_bis <= plus3 ? 'läuft ab' : 'gültig';
      return { qualifikation_id: q.qualifikation_id, version: q.version || null, mitglied_id: q.mitglied_id,
        name: Bereichsdaten.name(mitglieder[q.mitglied_id]), art: a.bezeichnung, ausgestellt_am: q.ausgestellt_am || null,
        gueltig_bis: q.gueltig_bis || null, stand: stand };
    });
    return {
      heute: bd.heute,
      kennzahlen: {
        gueltig: personen.filter(function (p) { return p.ampel === 'gruen'; }).length,
        wiedervorlage: personen.filter(function (p) { return p.ampel === 'gelb'; }).length,
        fehlt: personen.filter(function (p) { return p.ampel === 'rot'; }).length,
        zu_loeschen: zuLoeschen.length,
        lizenzen_ablauf: lizenzenAlle.filter(function (l) { return l.stand !== 'gültig' && l.stand !== 'unbefristet'; }).length
      },
      personen: personen, zu_loeschen: zuLoeschen, lizenzen: lizenzenAlle,
      arten: (d.Qualifikationsart || []).filter(function (a) { return a.aktiv !== false; }).map(function (a) {
        return { id: a.qualifikationsart_id, bezeichnung: a.bezeichnung, kategorie: a.kategorie,
          max_alter_zeugnis_monate: a.max_alter_zeugnis_monate || null, wiedervorlage_monate: a.wiedervorlage_monate || null };
      }),
      ergebnis_erlaubt: Fristen.ERGEBNIS_ERLAUBT,
      fristen_neu_berechnen: bd.alle
    };
  }

  /**
   * Neue Einsicht (FZ) bzw. Lizenz/Kurs erfassen.
   * eingabe: { mitglied_id, qualifikationsart_id, ausgestellt_am, eingesehen_am, ergebnis, gueltig_bis, bemerkung, funktion_id }
   */
  function erfassen(ktx, eingabe) {
    eingabe = eingabe || {};
    var id = Number(eingabe.mitglied_id);
    if (!id) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'mitglied_id', meldung: 'Bitte eine Person wählen.' }]);
    return DB.mitSperre(function () {
      Snapshot.pruefeMitglied(ktx, id);
      var basis = Snapshot.basis();
      var art = Bereichsdaten.index(basis.tabs.Qualifikationsart, 'qualifikationsart_id')[Number(eingabe.qualifikationsart_id)];
      var istFz = !!art && art.kategorie === 'Führungszeugnis';
      var werte = {
        mitglied_id: id, qualifikationsart_id: art ? art.qualifikationsart_id : null,
        ausgestellt_am: eingabe.ausgestellt_am || null,
        eingesehen_am: istFz ? (eingabe.eingesehen_am || heute()) : null,
        eingesehen_durch: istFz ? (ktx.name || ktx.email) : null,
        ergebnis: istFz ? (eingabe.ergebnis || null) : null,
        gueltig_bis: istFz ? null : (eingabe.gueltig_bis || null),
        bemerkung: eingabe.bemerkung || null
      };
      var fehler = Fristen.pruefeEinsicht(werte, art, heute());
      if (!istFz && art && art.kategorie === 'Lizenz' && !werte.ausgestellt_am && !werte.gueltig_bis) {
        fehler.push({ feld: 'gueltig_bis', meldung: 'Bitte mindestens Ausstellungsdatum oder „gültig bis“ angeben.' });
      }
      if (fehler.length) throw Fehler.fachlich('Bitte Eingaben prüfen.', fehler);
      // Bezug zu einer laufenden nachweispflichtigen Funktion (nur informativ)
      var pf = Fristen.pflichtigeFunktionen(id, basis.tabs).filter(function (f) { return !f.bis || f.bis >= heute(); });
      var gewuenscht = Number(eingabe.funktion_id);
      werte.funktion_id = pf.some(function (f) { return f.funktion_id === gewuenscht; }) ? gewuenscht : (pf[0] ? pf[0].funktion_id : null);
      var abg = Fristen.abgeleitet(werte, basis.tabs, art, heute(), basis.konfig);
      Object.keys(abg).forEach(function (k) { werte[k] = abg[k]; });
      var neu = DB.einfuegen('Qualifikation', werte, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Qualifikation', datensatz_id: neu.qualifikation_id,
        kommentar: (art ? art.bezeichnung : 'Nachweis') + ' für Mitglied ' + id }]);
      return Snapshot.schreibe(ktx, [{ tab: 'Qualifikation', neu: neu }]);
    });
  }

  /** Lizenz/Kurs nachtragen: gueltig_bis, ausgestellt_am, bemerkung (FZ-Vermerke werden nicht geändert, nur neu erfasst). */
  function aendern(ktx, qualifikationId, version, eingabe) {
    eingabe = eingabe || {};
    return DB.mitSperre(function () {
      var basis = Snapshot.basis();
      var q = Bereichsdaten.index(DB.lese(['Qualifikation']).Qualifikation, 'qualifikation_id')[Number(qualifikationId)];
      if (!q) throw Fehler.fachlich('Der Nachweis wurde nicht gefunden. Bitte die Ansicht neu laden.');
      Snapshot.pruefeMitglied(ktx, q.mitglied_id);
      Snapshot.pruefeZeile(ktx, 'Qualifikation', q);   // nur Vermerke, die auch angezeigt werden (z. B. AL: Funktion in eigener Abteilung)
      var art = Bereichsdaten.index(basis.tabs.Qualifikationsart, 'qualifikationsart_id')[q.qualifikationsart_id];
      if (art && art.kategorie === 'Führungszeugnis') throw Fehler.fachlich('Eine Führungszeugnis-Einsicht wird nicht geändert, sondern neu erfasst.');
      var werte = {};
      ['ausgestellt_am', 'gueltig_bis', 'bemerkung'].forEach(function (k) { if (k in eingabe) werte[k] = eingabe[k] || null; });
      var pr = Fristen.pruefeEinsicht({ ausgestellt_am: 'ausgestellt_am' in werte ? werte.ausgestellt_am : q.ausgestellt_am,
        gueltig_bis: 'gueltig_bis' in werte ? werte.gueltig_bis : q.gueltig_bis }, art, heute());
      if (pr.length) throw Fehler.fachlich('Bitte Eingaben prüfen.', pr);
      var r = DB.aktualisieren('Qualifikation', q.qualifikation_id, werte, version, ktx);
      if (r.diff.length) Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: 'Qualifikation', datensatz_id: q.qualifikation_id,
        kommentar: r.diff.map(function (x) { return x.feld; }).join(', ') }]);
      return Snapshot.schreibe(ktx, [{ tab: 'Qualifikation', neu: r.neu }]);
    });
  }

  /** FZ-Vermerke löschen, deren Frist abgelaufen ist (§ 72a Abs. 5). eintraege: [{ qualifikation_id, version }] */
  function loeschen(ktx, eintraege) {
    if (!Array.isArray(eintraege) || !eintraege.length) throw Fehler.fachlich('Bitte mindestens einen Vermerk auswählen.');
    return DB.mitSperre(function () {
      var basis = Snapshot.basis();
      var h = heute();
      var quals = Bereichsdaten.index(DB.lese(['Qualifikation']).Qualifikation, 'qualifikation_id');
      var arten = Bereichsdaten.index(basis.tabs.Qualifikationsart, 'qualifikationsart_id');
      var aenderungen = eintraege.map(function (x) {
        var q = quals[Number(x.qualifikation_id)];
        if (!q) throw Fehler.fachlich('Ein Vermerk wurde nicht gefunden. Bitte die Ansicht neu laden.');
        Snapshot.pruefeMitglied(ktx, q.mitglied_id);
        Snapshot.pruefeZeile(ktx, 'Qualifikation', q);
        var art = arten[q.qualifikationsart_id];
        if (!art || art.kategorie !== 'Führungszeugnis') throw Fehler.fachlich('Gelöscht werden hier nur Führungszeugnis-Vermerke.');
        if (q.geloescht_am) throw Fehler.fachlich('Ein Vermerk ist bereits gelöscht.');
        var ab = Fristen.loeschdatum(q, basis.tabs, art, h);
        if (!ab || ab > h) throw Fehler.fachlich('Die Löschfrist eines Vermerks ist noch nicht erreicht.');
        return { id: q.qualifikation_id, version: x.version, werte: Fristen.loeschAenderungen(h) };
      });
      var r = Bereichsdaten.aktualisieren('Qualifikation', aenderungen, ktx);
      Protokoll.schreibe(ktx, r.map(function (x) {
        return { aktion: 'gelöscht', tabelle: 'Qualifikation', datensatz_id: x.neu.qualifikation_id, kommentar: 'FZ-Vermerk geleert nach Fristablauf (§ 72a Abs. 5 SGB VIII)' };
      }));
      return Snapshot.schreibe(ktx, r.map(function (x) { return { tab: 'Qualifikation', neu: x.neu }; }));
    });
  }

  /** wiedervorlage_am und zu_loeschen_ab aller FZ-Vermerke neu berechnen (z. B. nach Funktionsende). Nur Zeilensicht „alle“. */
  function fristenAktualisieren(ktx) {
    if (!Rechte.zeilenSicht(ktx).alle) throw Fehler.keinZugriff();
    return DB.mitSperre(function () {
      var basis = Snapshot.basis();
      var h = heute();
      var arten = Bereichsdaten.index(basis.tabs.Qualifikationsart, 'qualifikationsart_id');
      var aenderungen = [];
      (DB.lese(['Qualifikation']).Qualifikation || []).forEach(function (q) {
        var art = arten[q.qualifikationsart_id];
        if (!art || art.kategorie !== 'Führungszeugnis' || q.geloescht_am) return;
        var a = Fristen.abgeleitet(q, basis.tabs, art, h, basis.konfig);
        if ((a.wiedervorlage_am || null) !== (q.wiedervorlage_am || null) || (a.zu_loeschen_ab || null) !== (q.zu_loeschen_ab || null)) {
          aenderungen.push({ id: q.qualifikation_id, version: null, werte: a });
        }
      });
      var r = Bereichsdaten.aktualisieren('Qualifikation', aenderungen, ktx);
      if (r.length) Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: 'Qualifikation', datensatz_id: '-',
        kommentar: 'Fristen neu berechnet: ' + r.length + ' Vermerk(e)' }]);
      var antwort = Snapshot.schreibe(ktx, r.map(function (x) { return { tab: 'Qualifikation', neu: x.neu }; }));
      antwort.geaendert = r.length;
      return antwort;
    });
  }

  /** Fälligkeitsliste für Export (CSV/Druck); protokolliert. */
  function exportiere(ktx) {
    var u = uebersicht(ktx);
    Protokoll.schreibe(ktx, [{ aktion: 'exportiert', tabelle: 'Qualifikation', datensatz_id: '-',
      kommentar: 'Fälligkeitsliste Nachweise, ' + u.personen.length + ' Personen' }]);
    return u.personen.map(function (p) {
      return { mitgliedsnummer: p.mitgliedsnummer, name: p.name, funktionen: p.funktionen.join('; '),
        eingesehen_am: p.fz ? p.fz.eingesehen_am : null, wiedervorlage: p.fz ? p.fz.wiedervorlage : null,
        status: p.ampel === 'gruen' ? 'gültig' : p.ampel === 'gelb' ? 'Wiedervorlage bald' : 'fehlt/abgelaufen' };
    });
  }

  return { uebersicht: uebersicht, erfassen: erfassen, aendern: aendern, loeschen: loeschen,
    fristenAktualisieren: fristenAktualisieren, exportiere: exportiere };
})();
