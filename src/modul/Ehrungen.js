/**
 * EhrungenModul – Jahresliste der Ehrungen, Übernahme, Verleihung, Verschieben, Ablehnen, Export.
 *
 * Zweck:      Serverseite der Ansicht „Ehrungen“. Die Fachlogik (wer ist wann fällig) steht in src/lib/ehrung.js;
 *             hier wird sie mit den Daten verbunden, geschrieben, protokolliert und der Snapshot gepflegt.
 * Datenquelle: Snapshot-Basis (Mitglied, Zeiträume, Funktionen, Ehrungsregel, Ehrung, Einwilligung) + _Konfig.
 * Wer darf was: Aktion ehrung_bearbeiten (Vorstand, Mitgliederverwalter) für alles hier – Prüfung in src/api/Ehrungen.js.
 * Besonderheiten:
 *   - Zählweise laut _Konfig.ehrung_zaehlweise (beschlossen: letzter_eintritt; Austritt setzt zurück). Bei
 *     Wiedereintritten zeigt die Liste zum Vergleich beide Zählweisen.
 *   - Die Liste wird IMMER auf dem Server neu berechnet; der Browser schickt nur Jahr und Auswahl.
 *   - Hinweis „Veröffentlichung nicht erlaubt“, wenn die Einwilligung „Ehrungen und Geburtstage in Vereinsmedien“
 *     fehlt – die Verleihung selbst bleibt möglich, nur nicht die Nennung in Vereinsmedien/Presse.
 *   - Ehrungen ohne Zeile (neu fällig) können direkt verliehen/verschoben/abgelehnt werden: die Zeile wird dabei
 *     angelegt. „Liste übernehmen“ legt alle neu fälligen auf einmal als „fällig“ an (Sammelschreiben).
 */
var EhrungenModul = (function () {
  var EINWILLIGUNG = 'Ehrungen und Geburtstage in Vereinsmedien';

  function konfigAus(k) {
    return { ehrung_zaehlweise: k.ehrung_zaehlweise, ehrung_stichtag: k.ehrung_stichtag, funktionsjubilaeum_zaehlweise: k.funktionsjubilaeum_zaehlweise };
  }

  function jahrPruefen(jahr) {
    var j = Number(jahr);
    if (!(j >= 1900 && j <= 2200) || Math.floor(j) !== j) throw Fehler.fachlich('Bitte ein gültiges Jahr angeben.');
    return j;
  }

  /** Berechnet die Jahresliste und reichert sie für die Anzeige an. */
  function berechne(jahr) {
    var basis = Snapshot.basis();
    var d = basis.tabs;
    var k = basis.konfig || {};
    var heute = DB.jetzt().slice(0, 10);
    var liste = Ehrung.jahresliste(d, jahr, konfigAus(k));
    var mitglieder = Bereichsdaten.index(d.Mitglied, 'mitglied_id');
    var funktionen = Bereichsdaten.index(d.Funktion, 'funktion_id');
    var arten = Bereichsdaten.index(d.Funktionsart, 'funktionsart_id');
    var abteilungen = Bereichsdaten.index(d.Abteilung, 'abteilung_id');
    var stichtag = jahr + '-12-31' < heute ? jahr + '-12-31' : heute;
    liste.forEach(function (e) {
      var m = mitglieder[e.mitglied_id] || {};
      e.name = Bereichsdaten.name(m);
      e.mitgliedsnummer = m.mitgliedsnummer || null;
      e.anrede = m.anrede || null;
      e.briefanrede = m.briefanrede || null;
      e.veroeffentlichung_erlaubt = Bereichsdaten.hatEinwilligung(d.Einwilligung, e.mitglied_id, EINWILLIGUNG, stichtag);
      if (e.funktion_id) {
        var f = funktionen[e.funktion_id] || {};
        var a = arten[f.funktionsart_id] || {};
        var ab = abteilungen[f.abteilung_id];
        e.funktion_text = (a.bezeichnung || 'Funktion') + (ab ? ' ' + ab.bezeichnung : '') + (f.zusatz ? ' (' + f.zusatz + ')' : '');
      }
    });
    return {
      jahr: jahr, eintraege: liste,
      einstellungen: konfigAus(k),
      anzahl: { gesamt: liste.length, neu: liste.filter(function (e) { return e.neu; }).length,
        offen_vorjahre: liste.filter(function (e) { return e.faellig_jahr < jahr; }).length }
    };
  }

  function jahresliste(ktx, jahr) { return berechne(jahrPruefen(jahr)); }

  /** Alle neu fälligen Einträge des Jahres als Ehrung-Zeilen (status fällig) anlegen – ein Schreibzugriff. */
  function uebernehmen(ktx, jahr) {
    jahr = jahrPruefen(jahr);
    return DB.mitSperre(function () {
      var neu = Ehrung.materialisiere(berechne(jahr).eintraege);
      if (!neu.length) return { aktualisiert: {}, entfernt: {}, angelegt: 0 };
      var zeilen = Bereichsdaten.einfuegen('Ehrung', neu, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Ehrung', datensatz_id: zeilen[0].ehrung_id + '–' + zeilen[zeilen.length - 1].ehrung_id,
        kommentar: zeilen.length + ' fällige Ehrungen für ' + jahr + ' übernommen' }]);
      var antwort = Snapshot.schreibe(ktx, zeilen.map(function (z) { return { tab: 'Ehrung', neu: z }; }));
      antwort.angelegt = zeilen.length;
      return antwort;
    });
  }

  function werteFuer(aktion, ehrung, eingabe) {
    eingabe = eingabe || {};
    if (aktion === 'verleihen') {
      if (!eingabe.verliehen_am) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'verliehen_am', meldung: 'Bitte das Datum der Verleihung angeben.' }]);
      return Ehrung.verleihe(ehrung, eingabe.verliehen_am, eingabe.veranstaltung);
    }
    if (aktion === 'verschieben') return Ehrung.verschiebe(ehrung, eingabe.bemerkung);
    if (aktion === 'ablehnen') return Ehrung.lehneAb(ehrung, eingabe.bemerkung);
    if (aktion === 'oeffnen') return Ehrung.oeffne(ehrung);
    throw Fehler.fachlich('Unbekannte Aktion.');
  }

  /**
   * Statuswechsel für einen oder mehrere Einträge.
   * eintraege: [{ ehrung_id, version } | { mitglied_id, ehrungsregel_id, funktion_id, faellig_jahr }] (letztere = neu fällig)
   * aktion: verleihen | verschieben | ablehnen | oeffnen; eingabe: { verliehen_am, veranstaltung, bemerkung }
   */
  function status(ktx, eintraege, aktion, eingabe) {
    if (!Array.isArray(eintraege) || !eintraege.length) throw Fehler.fachlich('Bitte mindestens eine Ehrung auswählen.');
    if (eintraege.length > 500) throw Fehler.fachlich('Zu viele Einträge auf einmal.');
    return DB.mitSperre(function () {
      var vorhanden = Bereichsdaten.index(DB.lese(['Ehrung']).Ehrung, 'ehrung_id');
      var aenderungen = [], anlegen = [], neuJahre = {};
      eintraege.forEach(function (x) {
        if (x.ehrung_id) {
          var e = vorhanden[x.ehrung_id];
          if (!e) throw Fehler.fachlich('Eine Ehrung wurde nicht gefunden. Bitte die Liste neu laden.');
          aenderungen.push({ id: e.ehrung_id, version: x.version, werte: werteFuer(aktion, e, eingabe) });
        } else {
          neuJahre[Number(x.faellig_jahr)] = true;
          anlegen.push(x);
        }
      });
      // Neu fällige nur, wenn sie wirklich auf der (serverseitig berechneten) Liste stehen
      var gueltig = {};
      Object.keys(neuJahre).forEach(function (j) {
        berechne(jahrPruefen(j)).eintraege.forEach(function (e) {
          if (e.neu) gueltig[[e.mitglied_id, e.ehrungsregel_id, e.funktion_id || '', e.faellig_jahr].join('|')] = e;
        });
      });
      var neueZeilen = anlegen.map(function (x) {
        var e = gueltig[[x.mitglied_id, x.ehrungsregel_id, x.funktion_id || '', x.faellig_jahr].join('|')];
        if (!e) throw Fehler.fachlich('Eine Ehrung ist nicht (mehr) fällig. Bitte die Liste neu laden.');
        var z = Ehrung.materialisiere([e])[0];
        var w = werteFuer(aktion === 'oeffnen' ? 'verschieben' : aktion, z, eingabe);
        Object.keys(w).forEach(function (k) { z[k] = w[k]; });
        return z;
      });
      var geaendert = Bereichsdaten.aktualisieren('Ehrung', aenderungen, ktx);
      var angelegt = Bereichsdaten.einfuegen('Ehrung', neueZeilen, ktx);
      var prot = [];
      geaendert.forEach(function (r) {
        prot.push({ aktion: 'geändert', tabelle: 'Ehrung', datensatz_id: r.neu.ehrung_id, feld: 'status', alt_wert: r.alt.status, neu_wert: r.neu.status,
          kommentar: r.neu.veranstaltung || null });
      });
      angelegt.forEach(function (z) {
        prot.push({ aktion: 'angelegt', tabelle: 'Ehrung', datensatz_id: z.ehrung_id, feld: 'status', neu_wert: z.status, kommentar: z.veranstaltung || null });
      });
      if (prot.length) Protokoll.schreibe(ktx, prot);
      return Snapshot.schreibe(ktx, geaendert.map(function (r) { return { tab: 'Ehrung', neu: r.neu }; })
        .concat(angelegt.map(function (z) { return { tab: 'Ehrung', neu: z }; })));
    });
  }

  /** Daten für Serienbrief/Urkunden bzw. JHV-Liste; wird protokolliert (exportiert). */
  function export_(ktx, jahr, art) {
    jahr = jahrPruefen(jahr);
    var l = berechne(jahr).eintraege.filter(function (e) { return art === 'urkunden' ? e.status !== 'abgelehnt' : true; });
    Protokoll.schreibe(ktx, [{ aktion: 'exportiert', tabelle: 'Ehrung', datensatz_id: String(jahr),
      kommentar: (art === 'urkunden' ? 'Urkunden-/Serienbriefdaten' : 'Ehrungsliste') + ', ' + l.length + ' Einträge' }]);
    return l.map(function (e) {
      return { mitgliedsnummer: e.mitgliedsnummer, name: e.name, anrede: e.anrede, briefanrede: e.briefanrede,
        anlass: e.typ, stufe: e.bezeichnung, schwelle: e.schwelle, verband: e.verband, grundlage: e.grundlage,
        funktion: e.funktion_text || null, faellig_jahr: e.faellig_jahr, status: e.status,
        veroeffentlichung_erlaubt: e.veroeffentlichung_erlaubt ? 'ja' : 'nein' };
    });
  }

  return { jahresliste: jahresliste, uebernehmen: uebernehmen, status: status, exportiere: export_ };
})();
