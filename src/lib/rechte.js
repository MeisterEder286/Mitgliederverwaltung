/**
 * Rollen- und Rechtematrix (reine Logik, ohne Apps-Script-Dienste, in Node getestet).
 *
 * Zweck:      Legt fest, welche Rolle welche Sichtklassen (Spaltengruppen) sehen und welche Aktionen
 *             ausführen darf, und schneidet Datensätze auf die erlaubten Felder zu.
 * Datenquelle: Die ZUWEISUNG (wer hat welche Rolle) steht im Tab „Benutzer“, eine Zeile je Rolle (V3).
 *             Die MATRIX (was darf eine Rolle) steht bewusst hier im Code (V5): Rechteänderungen sind
 *             sicherheitskritisch und sollen über Git mit Review laufen, nicht über eine Tabellenzelle,
 *             in der ein Tippfehler Daten öffnen könnte.
 * Wer darf was: siehe MATRIX unten. Sichtklassen der Spalten stehen im Feldkatalog (Schema.js):
 *             intern · kontakt · finanz · hochsensibel · verwaltung.
 * Besonderheiten:
 *   - Hat jemand mehrere Rollen, gilt die Vereinigung aller Rechte.
 *   - Der Zeilenschnitt (wen sieht jemand: alle / eigene Abteilung / Jugend) wird hier nur als Kennwort
 *     geliefert; die eigentliche Filterung der Mitglieder folgt in Phase 3.
 */
var Rechte = (function () {
  var ROLLEN = ['Vorstand', 'Mitgliederverwalter', 'Kassier', 'Abteilungsleiter', 'Jugendleiter'];

  var SICHTKLASSEN = ['intern', 'kontakt', 'finanz', 'hochsensibel', 'verwaltung'];

  var AKTIONEN = [
    'start', 'mitglied_lesen', 'mitglied_suchen_exakt', 'mitglied_anlegen', 'mitglied_bearbeiten',
    'austritt_erfassen', 'zugehoerigkeit_bearbeiten', 'funktion_bearbeiten', 'qualifikation_lesen',
    'qualifikation_erfassen', 'konto_lesen', 'konto_bearbeiten', 'iban_aufdecken', 'sollstellung_bearbeiten',
    'sepa_lauf', 'ehrung_bearbeiten', 'export', 'protokoll_lesen', 'benutzer_verwalten', 'konfig_aendern',
    'messung_lesen', 'datenschutz_bearbeiten', 'stammdaten_bearbeiten', 'anschreiben_erstellen', 'dokumente_verwalten',
    'mail_senden', 'notiz_lesen', 'notiz_schreiben'
  ];

  // Rangfolge der Zeilensicht: die weiteste Sicht gewinnt bei Mehrfachrollen.
  var ZEILEN_RANG = { alle: 3, abteilung: 2, jugend: 1 };

  var MATRIX = {
    Vorstand: { sicht: SICHTKLASSEN.slice(), aktionen: AKTIONEN.slice(), zeilen: 'alle' },
    // Datenmodell/Mockup: Mitgliederverwalter = Administrator, sieht und pflegt alles.
    Mitgliederverwalter: { sicht: SICHTKLASSEN.slice(), aktionen: AKTIONEN.slice(), zeilen: 'alle' },
    Kassier: {
      sicht: ['intern', 'kontakt', 'finanz'],
      // OFFEN: kein konto_bearbeiten – Kassier ändert keine IBAN (Datenmodell/Mockup). Bestätigung ausstehend.
      aktionen: ['start', 'mitglied_lesen', 'konto_lesen', 'iban_aufdecken', 'sollstellung_bearbeiten',
        'sepa_lauf', 'export', 'protokoll_lesen', 'anschreiben_erstellen', 'dokumente_verwalten',
        'mail_senden', 'notiz_lesen', 'notiz_schreiben'],
      zeilen: 'alle'
    },
    Jugendleiter: {
      sicht: ['intern', 'kontakt', 'hochsensibel'],
      aktionen: ['start', 'mitglied_lesen', 'qualifikation_lesen', 'qualifikation_erfassen', 'export', 'notiz_lesen', 'notiz_schreiben'],
      zeilen: 'jugend'
    },
    Abteilungsleiter: {
      // BESCHLOSSEN 10/2026: AL darf Führungszeugnis-Einsichten erfassen.
      // OFFEN: Sicht auf Qualifikationen nur für Personen mit laufender Funktion in seiner Abteilung –
      // dieser Zeilenschnitt wird in Phase 3 umgesetzt.
      sicht: ['intern', 'kontakt', 'hochsensibel'],
      // Kein austritt_erfassen: Der Vereinsaustritt bleibt bei der Mitgliederverwaltung.
      aktionen: ['start', 'mitglied_lesen', 'mitglied_suchen_exakt', 'zugehoerigkeit_bearbeiten',
        'funktion_bearbeiten', 'qualifikation_lesen', 'qualifikation_erfassen', 'export', 'notiz_lesen', 'notiz_schreiben'],
      zeilen: 'abteilung'
    }
  };

  function normEmail(e) {
    return String(e || '').trim().toLowerCase();
  }

  function vereinige(liste, neu) {
    neu.forEach(function (x) { if (liste.indexOf(x) < 0) liste.push(x); });
  }

  /**
   * Baut den Rechte-Kontext eines Benutzers aus allen aktiven Zeilen des Tabs „Benutzer“.
   * @return {null|{email,name,rollen,abteilungen,sicht,aktionen,zeilen}}
   */
  function kontext(benutzerZeilen, email) {
    var gesucht = normEmail(email);
    if (!gesucht) return null;
    var ktx = { email: gesucht, name: null, rollen: [], abteilungen: [], sicht: [], aktionen: [], zeilen: null };
    (benutzerZeilen || []).forEach(function (z) {
      if (!z || z.aktiv !== true || normEmail(z.email) !== gesucht) return;
      var m = MATRIX[z.rolle];
      if (!m) return; // unbekannte Rolle: ignorieren statt raten
      if (ktx.rollen.indexOf(z.rolle) < 0) ktx.rollen.push(z.rolle);
      if (!ktx.name && z.name) ktx.name = z.name;
      vereinige(ktx.sicht, m.sicht);
      vereinige(ktx.aktionen, m.aktionen);
      if (z.rolle === 'Abteilungsleiter' && z.abteilung_id !== null && z.abteilung_id !== undefined && z.abteilung_id !== '') {
        vereinige(ktx.abteilungen, [Number(z.abteilung_id)]);
      }
      if (!ktx.zeilen || ZEILEN_RANG[m.zeilen] > ZEILEN_RANG[ktx.zeilen]) ktx.zeilen = m.zeilen;
    });
    return ktx.rollen.length ? ktx : null;
  }

  function darf(ktx, aktion) {
    return !!(ktx && ktx.aktionen && ktx.aktionen.indexOf(aktion) >= 0);
  }

  // Technische Spalten (V1) tragen die Sichtklasse „intern“, gehören aber zum jeweiligen Tab. Sie sind nur
  // sichtbar, wenn auch mindestens eine fachliche Spalte des Tabs sichtbar ist – sonst würde z. B. ein
  // Abteilungsleiter von Beitragskonten zwar keine IBAN, aber deren Änderungsdaten sehen.
  var TECHNISCH = ['version', 'geaendert_am', 'geaendert_von'];

  /** Namen der Spalten eines Tabs, die der Kontext sehen darf. */
  function sichtbareSpalten(ktx, tab) {
    var t = Schema.TABELLEN[tab];
    if (!t || !ktx) return [];
    var namen = t.spalten.filter(function (s) { return ktx.sicht.indexOf(s.sicht) >= 0; })
      .map(function (s) { return s.name; });
    var fachlich = namen.filter(function (n) { return TECHNISCH.indexOf(n) < 0 && n !== t.idSpalte; });
    return fachlich.length ? namen : [];
  }

  /** Kopie des Datensatzes, nur mit den sichtbaren Feldern (Feldschnitt). */
  function schneide(ktx, tab, obj) {
    var erg = {};
    if (!obj) return erg;
    sichtbareSpalten(ktx, tab).forEach(function (n) {
      if (Object.prototype.hasOwnProperty.call(obj, n)) erg[n] = obj[n];
    });
    return erg;
  }

  /**
   * Felder, die der Kontext in diesem Tab schreiben darf: nur Felder sichtbarer Sichtklassen, nie die ID,
   * nie version/geaendert_* und nie vom Skript abgeleitete Felder (pflicht 'auto', 'PK').
   * Liefert eine Kopie von `werte` nur mit diesen Feldern; unbekannte Felder fallen still weg.
   */
  function erlaubteSchreibfelder(ktx, tab, werte) {
    var t = Schema.TABELLEN[tab];
    var erg = {};
    if (!t || !ktx || !werte) return erg;
    var sichtbar = sichtbareSpalten(ktx, tab);
    t.spalten.forEach(function (sp) {
      if (sichtbar.indexOf(sp.name) < 0) return;
      if (sp.name === t.idSpalte || sp.pflicht === 'PK' || sp.pflicht === 'auto') return;
      if (TECHNISCH.indexOf(sp.name) >= 0) return;
      if (Object.prototype.hasOwnProperty.call(werte, sp.name)) erg[sp.name] = werte[sp.name];
    });
    return erg;
  }

  /**
   * Zeilensicht je Rolle getrennt (für Mehrfachrollen): { alle, abteilung, jugend } als Wahrheitswerte.
   * Beispiel: Abteilungsleiter + Jugendleiter → abteilung UND jugend (Vereinigung beider Personenkreise).
   */
  function zeilenSicht(ktx) {
    var z = { alle: false, abteilung: false, jugend: false };
    ((ktx && ktx.rollen) || []).forEach(function (r) {
      var m = MATRIX[r];
      if (m) z[m.zeilen] = true;
    });
    return z;
  }

  /**
   * Mehrfachrollen, bei denen kontext() mehr Rechte ergibt als jede Rolle für sich (Prüfbefund H3 10/2026):
   * Sichtklassen und Zeilensicht werden getrennt vereinigt. Hat eine Rolle die Zeilensicht „alle“ und eine andere
   * eine Sichtklasse, die keiner der „alle“-Rollen zusteht (z. B. Kassier + Abteilungsleiter → hochsensibel),
   * gilt diese Sichtklasse für den ganzen Verein; Abteilungsgrenzen beim Schreiben entfallen ebenfalls.
   * Nur Meldung – die Rechte selbst bleiben unverändert (Änderung braucht Freigabe).
   * Liefert [{ email, rollen, sicht: [zusätzlich vereinsweit sichtbare Klassen], meldung }].
   */
  function mehrfachrollenWarnungen(benutzerZeilen) {
    var jeEmail = {};
    (benutzerZeilen || []).forEach(function (z) {
      if (!z || z.aktiv !== true || !MATRIX[z.rolle]) return;
      var e = normEmail(z.email);
      if (!e) return;
      var x = jeEmail[e] = jeEmail[e] || { email: e, rollen: [], benutzer_id: z.benutzer_id };
      if (x.rollen.indexOf(z.rolle) < 0) x.rollen.push(z.rolle);
    });
    var warn = [];
    Object.keys(jeEmail).sort().forEach(function (e) {
      var x = jeEmail[e];
      var alle = x.rollen.filter(function (r) { return MATRIX[r].zeilen === 'alle'; });
      var begrenzt = x.rollen.filter(function (r) { return MATRIX[r].zeilen !== 'alle'; });
      if (!alle.length || !begrenzt.length) return;
      var sichtAlle = [];
      alle.forEach(function (r) { vereinige(sichtAlle, MATRIX[r].sicht); });
      var zusatz = [];
      begrenzt.forEach(function (r) { MATRIX[r].sicht.forEach(function (s) { if (sichtAlle.indexOf(s) < 0 && zusatz.indexOf(s) < 0) zusatz.push(s); }); });
      var aktionenAlle = [];
      alle.forEach(function (r) { vereinige(aktionenAlle, MATRIX[r].aktionen); });
      var schreibt = begrenzt.some(function (r) {
        return MATRIX[r].aktionen.some(function (a) {
          return aktionenAlle.indexOf(a) < 0 && ['zugehoerigkeit_bearbeiten', 'funktion_bearbeiten', 'qualifikation_erfassen'].indexOf(a) >= 0;
        });
      });
      if (!zusatz.length && !schreibt) return;
      warn.push({
        benutzer_id: x.benutzer_id, email: e, rollen: x.rollen.slice(), sicht: zusatz,
        meldung: 'Mehrfachrolle ' + x.rollen.join(' + ') + ': Die Zeilensicht „alle“ (' + alle.join(', ') + ') gilt auch für die Rechte von ' +
          begrenzt.join(', ') + (zusatz.length ? ' – Sichtklasse ' + zusatz.join(', ') + ' damit für den ganzen Verein' : '') +
          (schreibt ? '; Bearbeiten ohne Abteilungs-/Jugendgrenze' : '') + '. Bitte prüfen, ob die Kombination nötig ist (getrennte Google-Konten vermeiden das).'
      });
    });
    return warn;
  }

  return {
    ROLLEN: ROLLEN, SICHTKLASSEN: SICHTKLASSEN, AKTIONEN: AKTIONEN, MATRIX: MATRIX,
    kontext: kontext, darf: darf, sichtbareSpalten: sichtbareSpalten, schneide: schneide,
    erlaubteSchreibfelder: erlaubteSchreibfelder, zeilenSicht: zeilenSicht, mehrfachrollenWarnungen: mehrfachrollenWarnungen
  };
})();
