/**
 * Mitglieder – Servermodul für Personen, Mitgliedschaft, Abteilungszugehörigkeiten und Funktionen.
 *
 * Zweck:      Fachliche Abläufe, die mehrere Tabs auf einmal betreffen und deshalb unter EINER Sperre laufen:
 *             Mitglied anlegen (Person + erster Zeitraum + Abteilungen), bearbeiten, Austritt mit Konto-Guard,
 *             Wiedereintritt, Sterbefall, Abteilungszugehörigkeit, Funktionen (Ämter), Exaktsuche des
 *             Abteilungsleiters, Protokollierung von Exporten.
 * Datenquelle: Lesen aus der Snapshot-Basis (Snapshot.basis().tabs – aktuell dank write-through, kein
 *             Tabellenzugriff), Schreiben über DB (einfuegen/aktualisieren unter DB.mitSperre). Jede Änderung
 *             wird protokolliert und über Snapshot.schreibe an den Browser zurückgegeben.
 * Wer darf was: Die Aktion prüft Api.ausfuehren (src/api/Mitglieder.js). Hier zusätzlich der ZEILENSCHUTZ:
 *   - Snapshot.pruefeMitglied: nur Personen, die die Rolle sieht (Abteilungsleiter: eigene Abteilung).
 *   - pruefeAbteilung_: Wer nicht „alle“ sieht (Abteilungsleiter), darf nur in den eigenen Abteilungen
 *     Zugehörigkeiten und Abteilungsämter pflegen – Vereinsämter nie.
 *   - Schreibbare Felder: Rechte.erlaubteSchreibfelder (nur sichtbare Sichtklassen, nie ID/version/auto).
 * Besonderheiten:
 *   - Mitglied.status ist ein Cache (Datenmodell). Er wird hier nach jeder Änderung an Zeiträumen/Sterbedatum
 *     aus Mitgliedschaft.status neu gesetzt. Austritte mit Datum in der Zukunft bleiben bis dahin „aktiv“ –
 *     der Status springt erst um, wenn danach wieder etwas gespeichert wird (OFFEN: nächtlicher Abgleich).
 *   - Mitgliedsnummer: aus _Konfig.mitgliedsnummer_naechste, belegte Nummern werden übersprungen, Nummern
 *     Ausgetretener werden nie neu vergeben (mitgliedsnummer_wiederverwendung = nein).
 *   - Austritt: „Guard statt Cascade“ (Übergabe §4). Ist die Person Inhaber eines Kontos, über das noch andere
 *     zahlen, muss eine Option gewählt werden (Beitrag.waisenBeiAustritt). Konten selbst ändert der
 *     Finanzbereich; hier gibt es nur Merker (Bemerkung) und Protokoll.
 *   - Exaktsuche: höchstens EIN Treffer, nur bei exakter Übereinstimmung, begrenzt auf 30 Suchen je Stunde und
 *     Benutzer – sonst ließe sich der Mitgliederbestand über Suchtreffer abfragen (AL-Mockup).
 *     Das Zuordnen wiederholt die Suche serverseitig, statt eine ID vom Browser anzunehmen.
 */
var Mitglieder = (function () {
  var EXAKTSUCHE_MAX = 30;
  var EXPORTARTEN = ['liste', 'kontaktliste', 'jahrgangsliste', 'geburtstage', 'passive'];

  // ================================================================== Hilfen

  function heute() { return DB.jetzt().slice(0, 10); }
  function daten() { return Snapshot.basis().tabs; }
  function leer(v) { return v === null || v === undefined || v === ''; }
  function kopie(o) { var x = {}; Object.keys(o || {}).forEach(function (k) { x[k] = o[k]; }); return x; }
  function name(m) { return m ? [m.nachname, m.vorname].filter(Boolean).join(', ') : ''; }
  function falte(s) {
    return String(s || '').trim().toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  }
  function istDatum(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  function finde(tab, feld, id) {
    var l = daten()[tab] || [];
    for (var i = 0; i < l.length; i++) if (String(l[i][feld]) === String(id)) return l[i];
    return null;
  }
  function mitglied(id) {
    var m = finde('Mitglied', 'mitglied_id', id);
    if (!m) throw Fehler.fachlich('Das Mitglied wurde nicht gefunden. Bitte die Ansicht neu laden.');
    return m;
  }
  function zeitraeume(id, zusatz) {
    var l = (daten().Mitgliedschaftszeitraum || []).filter(function (z) { return z.mitglied_id === Number(id); });
    (zusatz || []).forEach(function (z) {
      l = l.filter(function (x) { return x.zeitraum_id !== z.zeitraum_id; }).concat([z]);
    });
    return l.sort(function (a, b) { return String(a.eintrittsdatum).localeCompare(String(b.eintrittsdatum)); });
  }

  /** Zahlen, die als Text aus Formularen kommen (FK, Ganzzahl, Dezimal), in Zahlen umwandeln; '' → null. */
  function typisiere(tab, obj) {
    var t = Schema.TABELLEN[tab];
    Object.keys(obj).forEach(function (k) {
      var sp = t.spalten.filter(function (x) { return x.name === k; })[0];
      if (!sp) return;
      if (obj[k] === '') obj[k] = null;
      if ((sp.typ === 'FK' || sp.typ === 'Ganzzahl' || sp.typ === 'Dezimal') && typeof obj[k] === 'string' && obj[k].trim() !== '' && isFinite(Number(obj[k].replace(',', '.')))) {
        obj[k] = Number(obj[k].replace(',', '.'));
      }
    });
    return obj;
  }

  /** Feldfehler gesammelt werfen (der Browser zeigt sie am Feld). */
  function feldfehler(liste) {
    if (liste.length) throw Fehler.fachlich('Bitte Eingaben prüfen.', liste);
  }
  function pruefeSchema(tab, werte, teilweise) {
    feldfehler(Werte.pruefe(tab, werte, { teilweise: !!teilweise }));
  }

  /** Plausibilitäten am Mitglied, die über das Schema hinausgehen. Liefert [Fehler], [Warnungen]. */
  function plausibel(werte, alt) {
    var f = [], w = [];
    var neu = kopie(alt); Object.keys(werte).forEach(function (k) { neu[k] = werte[k]; });
    var land = neu.land || 'DE';
    if (!leer(werte.plz) && land === 'DE' && !/^\d{5}$/.test(String(werte.plz))) f.push({ feld: 'plz', meldung: 'Postleitzahl: in Deutschland 5 Ziffern.' });
    if (!leer(werte.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(werte.email))) f.push({ feld: 'email', meldung: 'E-Mail: ungültiges Format.' });
    if (!leer(werte.geburtsdatum) && istDatum(werte.geburtsdatum) && werte.geburtsdatum > heute()) f.push({ feld: 'geburtsdatum', meldung: 'Geburtsdatum liegt in der Zukunft.' });
    if (!leer(werte.sterbedatum) && istDatum(werte.sterbedatum) && werte.sterbedatum > heute()) f.push({ feld: 'sterbedatum', meldung: 'Sterbedatum liegt in der Zukunft.' });
    if (!leer(werte.strasse) && /\d/.test(String(werte.strasse)) && leer(neu.hausnummer)) {
      w.push('Die Straße enthält eine Zahl – gehört die Hausnummer ins eigene Feld? (wichtig für strukturierte SEPA-Adressen)');
    }
    return { fehler: f, warnungen: w };
  }

  /** Wer nicht „alle“ sieht, darf nur in eigenen Abteilungen arbeiten. */
  function pruefeAbteilung(ktx, abteilungId) {
    if (Rechte.zeilenSicht(ktx).alle) return;
    if ((ktx.abteilungen || []).indexOf(Number(abteilungId)) < 0) throw Fehler.keinZugriff();
  }

  /** Status-Cache am Mitglied neu setzen, falls er sich ändert. Liefert die geänderte Zeile oder null. */
  function statusNachziehen(ktx, m, zusatzZeitraeume, aenderungen, protokoll) {
    var s = Mitgliedschaft.status(m, zeitraeume(m.mitglied_id, zusatzZeitraeume), heute());
    if (s === (m.status || null)) return m;
    var r = DB.aktualisieren('Mitglied', m.mitglied_id, { status: s }, m.version || 0, ktx);
    protokoll.push.apply(protokoll, Protokoll.ausDiff('Mitglied', m.mitglied_id, r.diff));
    aenderungen.push({ tab: 'Mitglied', neu: r.neu });
    return r.neu;
  }

  /** Bemerkung ergänzen (Merker), ohne Vorhandenes zu überschreiben. */
  function bemerkungAnhaengen(alt, text) {
    var a = leer(alt) ? '' : String(alt) + ' | ';
    return (a + text).slice(0, 2000);
  }

  function antwort(ktx, aenderungen, protokoll, zusatz) {
    if (protokoll.length) Protokoll.schreibe(ktx, protokoll);
    var a = Snapshot.schreibe(ktx, aenderungen);
    Object.keys(zusatz || {}).forEach(function (k) { a[k] = zusatz[k]; });
    return a;
  }

  // ================================================================== _Konfig-Zähler Mitgliedsnummer

  /** Nächste freie Mitgliedsnummer (Text, mind. 4-stellig wie der Bestand) und Zähler erhöhen. Nur in der Sperre. */
  function naechsteMitgliedsnummer() {
    var b = DB.blatt('_Konfig');
    var werte = b.getDataRange().getValues();
    DB.zaehle(2);
    var kopf = werte[0].map(String);
    var iS = kopf.indexOf('schluessel'), iW = kopf.indexOf('wert');
    var zeile = -1, start = 1;
    for (var i = 1; i < werte.length; i++) {
      if (String(werte[i][iS]) === 'mitgliedsnummer_naechste') { zeile = i; start = Number(String(werte[i][iW]).replace(/\D/g, '')) || 1; break; }
    }
    var belegt = {};
    var laenge = 4;
    (daten().Mitglied || []).forEach(function (m) {
      if (leer(m.mitgliedsnummer)) return;
      belegt[Number(String(m.mitgliedsnummer).replace(/\D/g, ''))] = true;
      laenge = Math.max(laenge, String(m.mitgliedsnummer).length);
    });
    var n = start;
    while (belegt[n]) n++;
    var text = String(n);
    while (text.length < laenge) text = '0' + text;
    var naechste = String(n + 1);
    while (naechste.length < laenge) naechste = '0' + naechste;
    if (zeile > 0) {
      b.getRange(zeile + 1, iW + 1).setValue(naechste);
    } else {
      b.appendRow(kopf.map(function (h) {
        return h === 'schluessel' ? 'mitgliedsnummer_naechste' : h === 'wert' ? naechste : h === 'beschreibung' ? 'Nächste freie Mitgliedsnummer' : '';
      }));
    }
    DB.zaehle(1);
    try { Konfig.vergessen(); } catch (e) { /* Cache-Fehler sind unkritisch */ }
    return text;
  }

  // ================================================================== Bearbeiten

  function speichern(ktx, id, version, werte) {
    return DB.mitSperre(function () {
      Snapshot.pruefeMitglied(ktx, id);
      var alt = mitglied(id);
      var felder = typisiere('Mitglied', Rechte.erlaubteSchreibfelder(ktx, 'Mitglied', werte || {}));
      delete felder.status;          // Cache, nur vom Skript
      delete felder.mitgliedsnummer; // bleibt lebenslang gleich
      pruefeSchema('Mitglied', felder, true);
      var p = plausibel(felder, alt);
      feldfehler(p.fehler);
      var r = DB.aktualisieren('Mitglied', id, felder, version, ktx);
      var aenderungen = [{ tab: 'Mitglied', neu: r.neu }];
      var protokoll = Protokoll.ausDiff('Mitglied', id, r.diff);
      if (Object.prototype.hasOwnProperty.call(felder, 'sterbedatum')) statusNachziehen(ktx, r.neu, null, aenderungen, protokoll);
      return antwort(ktx, aenderungen, protokoll, { hinweise: p.warnungen });
    });
  }

  function adresseUngueltig(ktx, id, version, ungueltig) {
    return DB.mitSperre(function () {
      Snapshot.pruefeMitglied(ktx, id);
      var r = DB.aktualisieren('Mitglied', id, {
        adresse_ungueltig: !!ungueltig, adresse_ungueltig_am: ungueltig ? heute() : null
      }, version, ktx);
      return antwort(ktx, [{ tab: 'Mitglied', neu: r.neu }], Protokoll.ausDiff('Mitglied', id, r.diff));
    });
  }

  // ================================================================== Anlegen / Dubletten

  /** Mögliche Dubletten: gleicher Nachname (gefaltet) und gleiches Geburtsdatum. */
  function dubletten(nachname, geburtsdatum) {
    if (leer(nachname) || leer(geburtsdatum)) return [];
    var n = falte(nachname);
    return (daten().Mitglied || []).filter(function (m) {
      return m.anonymisiert !== true && falte(m.nachname) === n && m.geburtsdatum === geburtsdatum;
    }).map(function (m) {
      return { mitglied_id: m.mitglied_id, name: name(m), mitgliedsnummer: m.mitgliedsnummer, status: m.status || null };
    });
  }

  /**
   * Neues Mitglied mit erstem Zeitraum und Abteilungen in EINER Sperre.
   * eingabe: { mitglied: {…}, eintrittsdatum, abteilungen: [{ abteilung_id, status }], trotzDublette }
   */
  function anlegen(ktx, eingabe) {
    eingabe = eingabe || {};
    return DB.mitSperre(function () {
      var felder = typisiere('Mitglied', Rechte.erlaubteSchreibfelder(ktx, 'Mitglied', eingabe.mitglied || {}));
      delete felder.status; delete felder.mitgliedsnummer; delete felder.sterbedatum;
      var fehler = [];
      if (!istDatum(eingabe.eintrittsdatum)) fehler.push({ feld: 'eintrittsdatum', meldung: 'Eintrittsdatum: Angabe fehlt (TT.MM.JJJJ).' });
      var p = plausibel(felder, {});
      fehler = fehler.concat(p.fehler);
      felder.mitgliedsnummer = '0';   // Platzhalter für die Schema-Prüfung, echte Nummer unten
      fehler = fehler.concat(Werte.pruefe('Mitglied', felder).filter(function (f) { return f.feld !== 'mitgliedsnummer'; }));
      feldfehler(fehler);
      var d = dubletten(felder.nachname, felder.geburtsdatum);
      if (d.length && !eingabe.trotzDublette) {
        throw Fehler.fachlich('Mögliche Dublette: ' + d.map(function (x) { return x.name + ' (Nr. ' + x.mitgliedsnummer + ')'; }).join('; ') +
          '. Bitte prüfen – bei einem Wiedereintritt das bestehende Mitglied verwenden.', [{ feld: 'nachname', meldung: 'Gleicher Name und Geburtsdatum vorhanden.' }]);
      }
      if (felder.beitragsgemeinschaft_id) {
        var gleiche = (daten().Mitglied || []).filter(function (m) { return m.beitragsgemeinschaft_id === Number(felder.beitragsgemeinschaft_id); });
        if (gleiche.length && gleiche[0].beitragskonto_id && Number(felder.beitragskonto_id) !== gleiche[0].beitragskonto_id) {
          feldfehler([{ feld: 'beitragskonto_id', meldung: 'Alle Mitglieder einer Beitragsgemeinschaft zahlen über dasselbe Konto (Nr. ' + gleiche[0].beitragskonto_id + ').' }]);
        }
      }
      (eingabe.abteilungen || []).forEach(function (a) { pruefeAbteilung(ktx, a.abteilung_id); });

      felder.mitgliedsnummer = naechsteMitgliedsnummer();
      felder.status = 'aktiv';
      if (leer(felder.land)) felder.land = 'DE';
      var m = DB.einfuegen('Mitglied', felder, ktx);
      var z = DB.einfuegen('Mitgliedschaftszeitraum', { mitglied_id: m.mitglied_id, eintrittsdatum: eingabe.eintrittsdatum, antrag_am: eingabe.antrag_am || null, aufnahme_beschluss_am: eingabe.aufnahme_beschluss_am || null }, ktx);
      var aenderungen = [{ tab: 'Mitglied', neu: m }, { tab: 'Mitgliedschaftszeitraum', neu: z }];
      var protokoll = [
        { aktion: 'angelegt', tabelle: 'Mitglied', datensatz_id: m.mitglied_id, kommentar: 'Nr. ' + m.mitgliedsnummer },
        { aktion: 'angelegt', tabelle: 'Mitgliedschaftszeitraum', datensatz_id: z.zeitraum_id, kommentar: 'Eintritt ' + z.eintrittsdatum }
      ];
      (eingabe.abteilungen || []).forEach(function (a) {
        var zug = DB.einfuegen('Abteilungszugehoerigkeit', {
          mitglied_id: m.mitglied_id, abteilung_id: Number(a.abteilung_id), status: a.status || 'aktiv', eintrittsdatum: eingabe.eintrittsdatum
        }, ktx);
        aenderungen.push({ tab: 'Abteilungszugehoerigkeit', neu: zug });
        protokoll.push({ aktion: 'angelegt', tabelle: 'Abteilungszugehoerigkeit', datensatz_id: zug.zugehoerigkeit_id });
      });
      statusNachziehen(ktx, m, [z], aenderungen, protokoll);
      var hinweise = p.warnungen.slice();
      if (!m.beitragsart_id && !m.beitragsgemeinschaft_id && Rechte.sichtbareSpalten(ktx, 'Mitglied').indexOf('beitragsart_id') >= 0) {
        hinweise.push('Noch keine Beitragsart und keine Beitragsgemeinschaft – bitte ergänzen (sonst Klärliste).');
      }
      if (!m.beitragskonto_id && Rechte.sichtbareSpalten(ktx, 'Mitglied').indexOf('beitragskonto_id') >= 0) {
        hinweise.push('Noch kein Beitragskonto zugeordnet – Konto im Bereich Finanzen anlegen bzw. zuordnen.');
      }
      return antwort(ktx, aenderungen, protokoll, { mitglied_id: m.mitglied_id, mitgliedsnummer: m.mitgliedsnummer, hinweise: hinweise });
    });
  }

  /** Wiedereintritt: neuer Zeitraum für eine bestehende Person (gleiche Nummer). */
  function wiedereintritt(ktx, id, eingabe) {
    eingabe = eingabe || {};
    return DB.mitSperre(function () {
      Snapshot.pruefeMitglied(ktx, id);
      var m = mitglied(id);
      if (!istDatum(eingabe.eintrittsdatum)) feldfehler([{ feld: 'eintrittsdatum', meldung: 'Eintrittsdatum: Angabe fehlt.' }]);
      if (m.sterbedatum) throw Fehler.fachlich('Für eine verstorbene Person ist kein Wiedereintritt möglich.');
      var zr = zeitraeume(id);
      if (Mitgliedschaft.laufenderZeitraum(zr, eingabe.eintrittsdatum) || Mitgliedschaft.laufenderZeitraum(zr, heute())) {
        throw Fehler.fachlich('Die Person ist noch Mitglied – ein Wiedereintritt ist erst nach dem Austritt möglich.');
      }
      var ende = zr.length ? Mitgliedschaft.endeVon(zr[zr.length - 1]) : null;
      if (ende && eingabe.eintrittsdatum <= ende) feldfehler([{ feld: 'eintrittsdatum', meldung: 'Der Eintritt muss nach dem letzten Austritt (' + ende + ') liegen.' }]);
      (eingabe.abteilungen || []).forEach(function (a) { pruefeAbteilung(ktx, a.abteilung_id); });
      var z = DB.einfuegen('Mitgliedschaftszeitraum', { mitglied_id: Number(id), eintrittsdatum: eingabe.eintrittsdatum, bemerkung: 'Wiedereintritt' }, ktx);
      var aenderungen = [{ tab: 'Mitgliedschaftszeitraum', neu: z }];
      var protokoll = [{ aktion: 'angelegt', tabelle: 'Mitgliedschaftszeitraum', datensatz_id: z.zeitraum_id, kommentar: 'Wiedereintritt ' + z.eintrittsdatum }];
      (eingabe.abteilungen || []).forEach(function (a) {
        zugehoerigkeitAnlegenOderReaktivieren(ktx, Number(id), Number(a.abteilung_id), a.status || 'aktiv', eingabe.eintrittsdatum, aenderungen, protokoll);
      });
      statusNachziehen(ktx, m, [z], aenderungen, protokoll);
      return antwort(ktx, aenderungen, protokoll);
    });
  }

  // ================================================================== Austritt / Sterbefall

  function austrittVorbereiten(ktx, id, datum) {
    Snapshot.pruefeMitglied(ktx, id);
    var d = istDatum(datum) ? datum : String(heute()).slice(0, 4) + '-12-31';
    var w = Beitrag.waisenBeiAustritt(Number(id), daten(), d);
    var laufend = Mitgliedschaft.laufenderZeitraum(zeitraeume(id), heute());
    return { waisen: w, laufend: laufend ? { zeitraum_id: laufend.zeitraum_id, eintrittsdatum: laufend.eintrittsdatum } : null, vorschlag_wirksam: d };
  }

  /** Beendet laufende Zugehörigkeiten und Funktionen einer Person zum Datum (nie löschen, nur abschließen). */
  function beendeLaufendes(ktx, id, datum, grund, aenderungen, protokoll) {
    (daten().Abteilungszugehoerigkeit || []).filter(function (a) {
      return a.mitglied_id === Number(id) && (!a.austrittsdatum || a.austrittsdatum > datum);
    }).forEach(function (a) {
      var r = DB.aktualisieren('Abteilungszugehoerigkeit', a.zugehoerigkeit_id, { austrittsdatum: datum }, a.version || 0, ktx);
      aenderungen.push({ tab: 'Abteilungszugehoerigkeit', neu: r.neu });
      protokoll.push({ aktion: 'beendet', tabelle: 'Abteilungszugehoerigkeit', datensatz_id: a.zugehoerigkeit_id, kommentar: grund });
    });
    (daten().Funktion || []).filter(function (f) {
      return f.mitglied_id === Number(id) && (!f.bis || f.bis > datum);
    }).forEach(function (f) {
      var r = DB.aktualisieren('Funktion', f.funktion_id, { bis: datum, beendigungsgrund: f.beendigungsgrund || grund }, f.version || 0, ktx);
      aenderungen.push({ tab: 'Funktion', neu: r.neu });
      protokoll.push({ aktion: 'beendet', tabelle: 'Funktion', datensatz_id: f.funktion_id, kommentar: grund });
    });
  }

  /** Austritt einer Person ohne Konto-Guard (intern; auch für „alle treten aus“). */
  function austrittEinzeln(ktx, id, e, aenderungen, protokoll) {
    var m = mitglied(id);
    var laufend = Mitgliedschaft.laufenderZeitraum(zeitraeume(id), heute());
    if (!laufend) throw Fehler.fachlich(name(m) + ' hat keine laufende Mitgliedschaft.');
    var r = DB.aktualisieren('Mitgliedschaftszeitraum', laufend.zeitraum_id, {
      kuendigung_eingang: e.kuendigung_eingang || null,
      austritt_wirksam: e.austritt_wirksam,
      austrittsdatum: e.austritt_wirksam,
      austrittsgrund: e.austrittsgrund || null
    }, laufend.version || 0, ktx);
    aenderungen.push({ tab: 'Mitgliedschaftszeitraum', neu: r.neu });
    protokoll.push({ aktion: 'beendet', tabelle: 'Mitgliedschaftszeitraum', datensatz_id: laufend.zeitraum_id,
      kommentar: 'Austritt zum ' + e.austritt_wirksam + (e.austrittsgrund ? ' (' + e.austrittsgrund + ')' : '') });
    beendeLaufendes(ktx, id, e.austritt_wirksam, 'Vereinsaustritt', aenderungen, protokoll);
    statusNachziehen(ktx, m, [r.neu], aenderungen, protokoll);
  }

  /**
   * Austritt erfassen. eingabe: { kuendigung_eingang, austritt_wirksam, austrittsgrund,
   *   option: { code: 'uebernahme'|'konto_bleibt'|'zahlweg_offen'|'alle_austreten', konto_id, mitglied_id } }
   */
  function austritt(ktx, id, eingabe) {
    eingabe = eingabe || {};
    return DB.mitSperre(function () {
      Snapshot.pruefeMitglied(ktx, id);
      var f = [];
      if (!istDatum(eingabe.austritt_wirksam)) f.push({ feld: 'austritt_wirksam', meldung: 'Wirksam zum: Angabe fehlt.' });
      if (!leer(eingabe.kuendigung_eingang) && !istDatum(eingabe.kuendigung_eingang)) f.push({ feld: 'kuendigung_eingang', meldung: 'Eingang: ungültiges Datum.' });
      if (istDatum(eingabe.kuendigung_eingang) && istDatum(eingabe.austritt_wirksam) && eingabe.austritt_wirksam < eingabe.kuendigung_eingang) {
        f.push({ feld: 'austritt_wirksam', meldung: 'Der Austritt kann nicht vor dem Eingang der Kündigung liegen.' });
      }
      if (!leer(eingabe.austrittsgrund) && (Schema.LISTEN.austrittsgrund || []).indexOf(eingabe.austrittsgrund) < 0) f.push({ feld: 'austrittsgrund', meldung: 'Grund: kein zulässiger Wert.' });
      feldfehler(f);
      var laufend = Mitgliedschaft.laufenderZeitraum(zeitraeume(id), heute());
      if (laufend && eingabe.austritt_wirksam < laufend.eintrittsdatum) feldfehler([{ feld: 'austritt_wirksam', meldung: 'Der Austritt liegt vor dem Eintritt (' + laufend.eintrittsdatum + ').' }]);

      var w = Beitrag.waisenBeiAustritt(Number(id), daten(), eingabe.austritt_wirksam);
      var opt = eingabe.option || null;
      if (w.betroffen && (!opt || !opt.code)) {
        throw Fehler.fachlich('Über das Konto dieser Person zahlen noch ' + w.betroffen + ' weitere Mitglieder. Bitte festlegen, wie es weitergeht.',
          [{ feld: 'option', meldung: 'Bitte eine Möglichkeit wählen.' }]);
      }
      var aenderungen = [], protokoll = [], hinweise = [];
      austrittEinzeln(ktx, id, eingabe, aenderungen, protokoll);

      if (w.betroffen) {
        var abhaengige = [];
        w.konten.forEach(function (k) { k.abhaengige.forEach(function (a) { abhaengige.push({ konto: k, a: a }); }); });
        var text = 'Kontoinhaber ' + name(mitglied(id)) + ' tritt zum ' + eingabe.austritt_wirksam + ' aus';
        if (opt.code === 'alle_austreten') {
          abhaengige.forEach(function (x) {
            Snapshot.pruefeMitglied(ktx, x.a.mitglied_id);
            austrittEinzeln(ktx, x.a.mitglied_id, eingabe, aenderungen, protokoll);
          });
          hinweise.push(abhaengige.length + ' weitere Person(en) treten mit aus.');
        } else if (opt.code === 'zahlweg_offen') {
          abhaengige.forEach(function (x) {
            var m = finde('Mitglied', 'mitglied_id', x.a.mitglied_id);
            if (!m) return;
            var r = DB.aktualisieren('Mitglied', m.mitglied_id, { bemerkung: bemerkungAnhaengen(m.bemerkung, 'Zahlweg offen: ' + text + '.') }, m.version || 0, ktx);
            aenderungen.push({ tab: 'Mitglied', neu: r.neu });
            protokoll.push({ aktion: 'geändert', tabelle: 'Mitglied', datensatz_id: m.mitglied_id, feld: 'bemerkung', kommentar: 'Zahlweg offen' });
          });
          hinweise.push('Die Abhängigen stehen in der Klärliste des Finanzbereichs und fallen aus dem nächsten SEPA-Lauf.');
        } else if (opt.code === 'uebernahme') {
          var neuerInhaber = finde('Mitglied', 'mitglied_id', opt.mitglied_id);
          var konto = finde('Beitragskonto', 'beitragskonto_id', opt.konto_id);
          if (!neuerInhaber || !konto) feldfehler([{ feld: 'option', meldung: 'Übernahme: Person oder Konto unbekannt.' }]);
          var merker = 'Übernahme durch ' + name(neuerInhaber) + ' vorgesehen (' + text + ') – neues Mandat nötig, Erstlastschrift beim nächsten Lauf.';
          if (Rechte.sichtbareSpalten(ktx, 'Beitragskonto').indexOf('bemerkung') >= 0) {
            var rk = DB.aktualisieren('Beitragskonto', konto.beitragskonto_id, { bemerkung: bemerkungAnhaengen(konto.bemerkung, merker) }, konto.version || 0, ktx);
            aenderungen.push({ tab: 'Beitragskonto', neu: rk.neu });
          }
          protokoll.push({ aktion: 'geändert', tabelle: 'Beitragskonto', datensatz_id: konto.beitragskonto_id, kommentar: merker });
          hinweise.push('Bitte im Bereich Finanzen Kontoinhaber, IBAN und Mandat für ' + name(neuerInhaber) + ' erfassen.');
        } else {
          protokoll.push({ aktion: 'geändert', tabelle: 'Beitragskonto', datensatz_id: w.konten.map(function (k) { return k.konto_id; }).join(','),
            kommentar: 'Konto bleibt, Inhaber zahlt weiter (' + text + ')' });
        }
      }
      return antwort(ktx, aenderungen, protokoll, { hinweise: hinweise });
    });
  }

  /** Sterbefall: Sterbedatum, Zeitraum/Zugehörigkeiten/Funktionen enden, Status „verstorben“. */
  function sterbefall(ktx, id, version, sterbedatum) {
    return DB.mitSperre(function () {
      Snapshot.pruefeMitglied(ktx, id);
      if (!istDatum(sterbedatum)) feldfehler([{ feld: 'sterbedatum', meldung: 'Sterbedatum: Angabe fehlt.' }]);
      if (sterbedatum > heute()) feldfehler([{ feld: 'sterbedatum', meldung: 'Sterbedatum liegt in der Zukunft.' }]);
      var aenderungen = [], protokoll = [];
      var r = DB.aktualisieren('Mitglied', id, { sterbedatum: sterbedatum }, version, ktx);
      aenderungen.push({ tab: 'Mitglied', neu: r.neu });
      protokoll = protokoll.concat(Protokoll.ausDiff('Mitglied', id, r.diff));
      var laufend = Mitgliedschaft.laufenderZeitraum(zeitraeume(id), sterbedatum) ||
        zeitraeume(id).filter(function (z) { var e = Mitgliedschaft.endeVon(z); return !e || e > sterbedatum; }).pop();
      var zusatz = null;
      if (laufend) {
        var rz = DB.aktualisieren('Mitgliedschaftszeitraum', laufend.zeitraum_id, {
          austrittsdatum: sterbedatum, austritt_wirksam: sterbedatum, austrittsgrund: 'verstorben'
        }, laufend.version || 0, ktx);
        aenderungen.push({ tab: 'Mitgliedschaftszeitraum', neu: rz.neu });
        protokoll.push({ aktion: 'beendet', tabelle: 'Mitgliedschaftszeitraum', datensatz_id: laufend.zeitraum_id, kommentar: 'verstorben' });
        zusatz = [rz.neu];
      }
      beendeLaufendes(ktx, id, sterbedatum, 'verstorben', aenderungen, protokoll);
      statusNachziehen(ktx, r.neu, zusatz, aenderungen, protokoll);
      var hinweise = ['Bitte die Kasse informieren: offene Sollstellungen prüfen und ggf. stornieren.'];
      var w = Beitrag.waisenBeiAustritt(Number(id), daten(), sterbedatum);
      if (w.betroffen) hinweise.push('Über das Konto der verstorbenen Person zahlen noch ' + w.betroffen + ' weitere Mitglieder – Konto im Bereich Finanzen klären.');
      return antwort(ktx, aenderungen, protokoll, { hinweise: hinweise });
    });
  }

  // ================================================================== Abteilungszugehörigkeit

  function zugehoerigkeitAnlegenOderReaktivieren(ktx, mitgliedId, abteilungId, status, ab, aenderungen, protokoll) {
    var abt = finde('Abteilung', 'abteilung_id', abteilungId);
    if (!abt) feldfehler([{ feld: 'abteilung_id', meldung: 'Abteilung unbekannt.' }]);
    if (abt.aktiv === false) feldfehler([{ feld: 'abteilung_id', meldung: 'Die Abteilung ' + abt.bezeichnung + ' ruht.' }]);
    var vorhanden = (daten().Abteilungszugehoerigkeit || []).filter(function (a) {
      return a.mitglied_id === mitgliedId && a.abteilung_id === abteilungId;
    })[0];
    if (vorhanden) {
      if (!vorhanden.austrittsdatum || vorhanden.austrittsdatum > ab) {
        throw Fehler.fachlich('Die Person ist der Abteilung ' + abt.bezeichnung + ' bereits zugeordnet.', [{ feld: 'abteilung_id', meldung: 'Bereits zugeordnet.' }]);
      }
      var r = DB.aktualisieren('Abteilungszugehoerigkeit', vorhanden.zugehoerigkeit_id,
        { austrittsdatum: null, status: status, eintrittsdatum: ab }, vorhanden.version || 0, ktx);
      aenderungen.push({ tab: 'Abteilungszugehoerigkeit', neu: r.neu });
      protokoll.push({ aktion: 'geändert', tabelle: 'Abteilungszugehoerigkeit', datensatz_id: vorhanden.zugehoerigkeit_id, kommentar: 'erneut zugeordnet ab ' + ab });
      return r.neu;
    }
    var z = DB.einfuegen('Abteilungszugehoerigkeit', { mitglied_id: mitgliedId, abteilung_id: abteilungId, status: status, eintrittsdatum: ab }, ktx);
    aenderungen.push({ tab: 'Abteilungszugehoerigkeit', neu: z });
    protokoll.push({ aktion: 'angelegt', tabelle: 'Abteilungszugehoerigkeit', datensatz_id: z.zugehoerigkeit_id });
    return z;
  }

  /** Zugehörigkeit neu (zugId leer) oder ändern (Status, Passnummer, Eintritt, Bemerkung). */
  function zugehoerigkeitSpeichern(ktx, zugId, version, werte) {
    werte = werte || {};
    return DB.mitSperre(function () {
      var aenderungen = [], protokoll = [];
      var felder = typisiere('Abteilungszugehoerigkeit', Rechte.erlaubteSchreibfelder(ktx, 'Abteilungszugehoerigkeit', werte));
      if (leer(zugId)) {
        var mid = Number(felder.mitglied_id), aid = Number(felder.abteilung_id);
        if (!mid || !aid) feldfehler([{ feld: 'abteilung_id', meldung: 'Abteilung: Angabe fehlt.' }]);
        Snapshot.pruefeMitglied(ktx, mid);
        pruefeAbteilung(ktx, aid);
        if (!Mitgliedschaft.laufenderZeitraum(zeitraeume(mid), heute()) && mitglied(mid).nur_funktionstraeger !== true) {
          throw Fehler.fachlich('Die Person ist kein Mitglied (keine laufende Mitgliedschaft).');
        }
        var status = felder.status || 'aktiv';
        if ((Schema.LISTEN.zugehoerigkeit || []).indexOf(status) < 0) feldfehler([{ feld: 'status', meldung: 'Status: aktiv oder passiv.' }]);
        var ab = istDatum(felder.eintrittsdatum) ? felder.eintrittsdatum : heute();
        var z = zugehoerigkeitAnlegenOderReaktivieren(ktx, mid, aid, status, ab, aenderungen, protokoll);
        if (!leer(felder.passnummer) || !leer(felder.bemerkung)) {
          var r0 = DB.aktualisieren('Abteilungszugehoerigkeit', z.zugehoerigkeit_id, { passnummer: felder.passnummer || null, bemerkung: felder.bemerkung || null }, z.version, ktx);
          aenderungen.push({ tab: 'Abteilungszugehoerigkeit', neu: r0.neu });
        }
        return antwort(ktx, aenderungen, protokoll);
      }
      var alt = finde('Abteilungszugehoerigkeit', 'zugehoerigkeit_id', zugId);
      if (!alt) throw Fehler.fachlich('Die Zugehörigkeit wurde nicht gefunden.');
      Snapshot.pruefeMitglied(ktx, alt.mitglied_id);
      pruefeAbteilung(ktx, alt.abteilung_id);
      delete felder.mitglied_id; delete felder.abteilung_id;   // Wechsel = beenden + neu
      pruefeSchema('Abteilungszugehoerigkeit', felder, true);
      var r = DB.aktualisieren('Abteilungszugehoerigkeit', zugId, felder, version, ktx);
      return antwort(ktx, [{ tab: 'Abteilungszugehoerigkeit', neu: r.neu }], Protokoll.ausDiff('Abteilungszugehoerigkeit', zugId, r.diff));
    });
  }

  function zugehoerigkeitBeenden(ktx, zugId, version, datum) {
    return DB.mitSperre(function () {
      var alt = finde('Abteilungszugehoerigkeit', 'zugehoerigkeit_id', zugId);
      if (!alt) throw Fehler.fachlich('Die Zugehörigkeit wurde nicht gefunden.');
      Snapshot.pruefeMitglied(ktx, alt.mitglied_id);
      pruefeAbteilung(ktx, alt.abteilung_id);
      var d = istDatum(datum) ? datum : heute();
      if (alt.eintrittsdatum && d < alt.eintrittsdatum) feldfehler([{ feld: 'austrittsdatum', meldung: 'Das Ende liegt vor dem Eintritt in die Abteilung.' }]);
      var r = DB.aktualisieren('Abteilungszugehoerigkeit', zugId, { austrittsdatum: d }, version, ktx);
      var protokoll = [{ aktion: 'beendet', tabelle: 'Abteilungszugehoerigkeit', datensatz_id: zugId, kommentar: 'zum ' + d }];
      var hinweise = ['Nur die Abteilung wurde beendet – die Vereinsmitgliedschaft bleibt bestehen.'];
      return antwort(ktx, [{ tab: 'Abteilungszugehoerigkeit', neu: r.neu }], protokoll, { hinweise: hinweise });
    });
  }

  // ================================================================== Exaktsuche (Abteilungsleiter)

  function begrenze(ktx) {
    var c = CacheService.getScriptCache();
    var key = 'exaktsuche:' + String(ktx.email);
    var n = Number(c.get(key) || 0);
    if (n >= EXAKTSUCHE_MAX) throw Fehler.fachlich('Zu viele Suchen in kurzer Zeit. Bitte später erneut versuchen.');
    c.put(key, String(n + 1), 3600);
  }

  /** Höchstens EIN Treffer, nur bei exakter Übereinstimmung, nur laufende Mitglieder. */
  function exaktTreffer(kriterien) {
    kriterien = kriterien || {};
    var nummer = leer(kriterien.mitgliedsnummer) ? null : String(kriterien.mitgliedsnummer).trim();
    var nachname = leer(kriterien.nachname) ? null : falte(kriterien.nachname);
    var geb = istDatum(kriterien.geburtsdatum) ? kriterien.geburtsdatum : null;
    if (!nummer && !(nachname && geb)) {
      feldfehler([{ feld: 'mitgliedsnummer', meldung: 'Mitgliedsnummer ODER Nachname und Geburtsdatum angeben.' }]);
    }
    var h = heute();
    var kandidaten = (daten().Mitglied || []).filter(function (m) {
      if (m.anonymisiert === true || m.verarbeitung_eingeschraenkt === true || m.sterbedatum) return false;
      if (nummer) return String(m.mitgliedsnummer) === nummer;
      return falte(m.nachname) === nachname && m.geburtsdatum === geb;
    }).filter(function (m) { return Mitgliedschaft.status(m, zeitraeume(m.mitglied_id), h) === 'aktiv'; });
    return kandidaten.length === 1 ? kandidaten[0] : null;
  }

  function sucheExakt(ktx, kriterien) {
    begrenze(ktx);
    var m = exaktTreffer(kriterien);
    Protokoll.schreibe(ktx, [{ aktion: 'eingesehen', tabelle: 'Mitglied', datensatz_id: m ? m.mitglied_id : '-', kommentar: 'Exaktsuche' + (m ? '' : ' ohne Treffer') }]);
    if (!m) return { treffer: null };
    var eigene = (daten().Abteilungszugehoerigkeit || []).filter(function (a) {
      return a.mitglied_id === m.mitglied_id && (!a.austrittsdatum || a.austrittsdatum >= heute()) &&
        (Rechte.zeilenSicht(ktx).alle || (ktx.abteilungen || []).indexOf(a.abteilung_id) >= 0);
    }).map(function (a) { return a.abteilung_id; });
    return {
      treffer: {
        name: name(m), mitgliedsnummer: m.mitgliedsnummer,
        geburtsjahr: m.geburtsdatum ? Number(String(m.geburtsdatum).slice(0, 4)) : null,
        bereits_in: eigene
      }
    };
  }

  /** Zuordnen nach Exaktsuche: Suche wird serverseitig wiederholt (keine ID vom Browser). */
  function zuordnen(ktx, kriterien, abteilungId, status) {
    return DB.mitSperre(function () {
      pruefeAbteilung(ktx, abteilungId);
      var m = exaktTreffer(kriterien);
      if (!m) throw Fehler.fachlich('Kein eindeutiger Treffer – bitte Angaben prüfen.');
      var aenderungen = [], protokoll = [];
      zugehoerigkeitAnlegenOderReaktivieren(ktx, m.mitglied_id, Number(abteilungId), status === 'passiv' ? 'passiv' : 'aktiv', heute(), aenderungen, protokoll);
      return antwort(ktx, aenderungen, protokoll, { mitglied_id: m.mitglied_id });
    });
  }

  // ================================================================== Funktionen

  function funktionEintragen(ktx, werte) {
    werte = werte || {};
    return DB.mitSperre(function () {
      var felder = typisiere('Funktion', Rechte.erlaubteSchreibfelder(ktx, 'Funktion', werte));
      delete felder.bis; delete felder.beendigungsgrund;
      var mid = Number(felder.mitglied_id);
      if (!mid) feldfehler([{ feld: 'mitglied_id', meldung: 'Person: Angabe fehlt.' }]);
      Snapshot.pruefeMitglied(ktx, mid);
      var art = finde('Funktionsart', 'funktionsart_id', felder.funktionsart_id);
      var f = [];
      if (!art) f.push({ feld: 'funktionsart_id', meldung: 'Funktion: Angabe fehlt.' });
      else if (art.aktiv === false) f.push({ feld: 'funktionsart_id', meldung: 'Diese Funktionsart wird nicht mehr vergeben.' });
      if (!istDatum(felder.von)) f.push({ feld: 'von', meldung: 'Seit: Angabe fehlt.' });
      if (art && art.ebene === 'Verein' && !leer(felder.abteilung_id)) f.push({ feld: 'abteilung_id', meldung: 'Vereinsämter haben keine Abteilung.' });
      if (art && art.ebene === 'Abteilung' && leer(felder.abteilung_id)) f.push({ feld: 'abteilung_id', meldung: 'Abteilungsämter brauchen eine Abteilung.' });
      feldfehler(f);
      if (!Rechte.zeilenSicht(ktx).alle) {
        if (art.ebene !== 'Abteilung') throw Fehler.keinZugriff();     // Vereinsämter nur Vorstand/Verwaltung
        pruefeAbteilung(ktx, felder.abteilung_id);
      }
      if (leer(felder.abteilung_id)) felder.abteilung_id = null; else felder.abteilung_id = Number(felder.abteilung_id);
      felder.funktionsart_id = Number(felder.funktionsart_id);
      felder.mitglied_id = mid;
      pruefeSchema('Funktion', felder);
      var neu = DB.einfuegen('Funktion', felder, ktx);
      var a = antwort(ktx, [{ tab: 'Funktion', neu: neu }],
        [{ aktion: 'angelegt', tabelle: 'Funktion', datensatz_id: neu.funktion_id, kommentar: art.bezeichnung + (felder.zusatz ? ' ' + felder.zusatz : '') }]);
      a.hinweise = [];
      if (art.fz_pflichtig === true) {
        var ampel = SnapshotKern.fzAmpel(Snapshot.basis(), mid, heute());
        if (ampel !== 'gruen') a.hinweise.push('Für diese Funktion ist ein erweitertes Führungszeugnis nötig – ' + (ampel === 'gelb' ? 'die Wiedervorlage steht bald an.' : 'es liegt noch kein gültiges vor.') + ' Bitte im Bereich Nachweise erfassen.');
      }
      return a;
    });
  }

  function funktionBeenden(ktx, funktionId, version, werte) {
    werte = werte || {};
    return DB.mitSperre(function () {
      var alt = finde('Funktion', 'funktion_id', funktionId);
      if (!alt) throw Fehler.fachlich('Die Funktion wurde nicht gefunden.');
      Snapshot.pruefeMitglied(ktx, alt.mitglied_id);
      if (!Rechte.zeilenSicht(ktx).alle) {
        if (leer(alt.abteilung_id)) throw Fehler.keinZugriff();
        pruefeAbteilung(ktx, alt.abteilung_id);
      }
      var f = [];
      if (!istDatum(werte.bis)) f.push({ feld: 'bis', meldung: 'Bis: Angabe fehlt.' });
      else if (alt.von && werte.bis < alt.von) f.push({ feld: 'bis', meldung: 'Das Ende liegt vor dem Beginn (' + alt.von + ').' });
      feldfehler(f);
      var r = DB.aktualisieren('Funktion', funktionId, { bis: werte.bis, beendigungsgrund: leer(werte.beendigungsgrund) ? null : String(werte.beendigungsgrund) }, version, ktx);
      return antwort(ktx, [{ tab: 'Funktion', neu: r.neu }],
        [{ aktion: 'beendet', tabelle: 'Funktion', datensatz_id: funktionId, kommentar: 'bis ' + werte.bis + (werte.beendigungsgrund ? ', ' + werte.beendigungsgrund : '') }]);
    });
  }

  /** Funktionsdaten (Zusatz, bestellt am, Bemerkung) korrigieren – Art, Person und Abteilung bleiben. */
  function funktionAendern(ktx, funktionId, version, werte) {
    return DB.mitSperre(function () {
      var alt = finde('Funktion', 'funktion_id', funktionId);
      if (!alt) throw Fehler.fachlich('Die Funktion wurde nicht gefunden.');
      Snapshot.pruefeMitglied(ktx, alt.mitglied_id);
      if (!Rechte.zeilenSicht(ktx).alle) {
        if (leer(alt.abteilung_id)) throw Fehler.keinZugriff();
        pruefeAbteilung(ktx, alt.abteilung_id);
      }
      var felder = typisiere('Funktion', Rechte.erlaubteSchreibfelder(ktx, 'Funktion', werte || {}));
      ['mitglied_id', 'funktionsart_id', 'abteilung_id', 'bis', 'beendigungsgrund'].forEach(function (k) { delete felder[k]; });
      pruefeSchema('Funktion', felder, true);
      if (istDatum(felder.von) && alt.bis && felder.von > alt.bis) feldfehler([{ feld: 'von', meldung: 'Der Beginn liegt nach dem Ende.' }]);
      var r = DB.aktualisieren('Funktion', funktionId, felder, version, ktx);
      return antwort(ktx, [{ tab: 'Funktion', neu: r.neu }], Protokoll.ausDiff('Funktion', funktionId, r.diff));
    });
  }

  // ================================================================== Export-Protokoll

  function exportProtokollieren(ktx, art, anzahl) {
    if (EXPORTARTEN.indexOf(String(art)) < 0) throw Fehler.fachlich('Unbekannte Liste.');
    var n = Math.max(0, Math.min(100000, Number(anzahl) || 0));
    Protokoll.schreibe(ktx, [{ aktion: 'exportiert', tabelle: 'Mitglied', datensatz_id: '-', kommentar: art + ': ' + n + ' Zeilen' }]);
    return { ok: true };
  }

  return {
    EXPORTARTEN: EXPORTARTEN,
    speichern: speichern, adresseUngueltig: adresseUngueltig, dubletten: dubletten, anlegen: anlegen,
    wiedereintritt: wiedereintritt, austrittVorbereiten: austrittVorbereiten, austritt: austritt, sterbefall: sterbefall,
    zugehoerigkeitSpeichern: zugehoerigkeitSpeichern, zugehoerigkeitBeenden: zugehoerigkeitBeenden,
    sucheExakt: sucheExakt, zuordnen: zuordnen,
    funktionEintragen: funktionEintragen, funktionBeenden: funktionBeenden, funktionAendern: funktionAendern,
    exportProtokollieren: exportProtokollieren
  };
})();
