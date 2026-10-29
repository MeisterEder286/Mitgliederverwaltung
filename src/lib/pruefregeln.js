/**
 * Pruefregeln – Integritäts- und Datenqualitätsprüfung über den gesamten Bestand (Mängelliste).
 *
 * Zweck:      Setzt die „Prüfregeln, die das Skript erzwingen muss“ aus dem Lies-mich des Datenmodells um und
 *             ergänzt Datenqualitätsregeln (Adresse, PLZ, E-Mail, Widersprüche). Liefert eine Liste von Befunden
 *             für die Ansicht „Datenqualität“ und für Prüfberichte (z. B. nach der Migration).
 * Datenquelle: `daten` je Tab wie aus DB.lese; Eindeutigkeiten aus Schema.TABELLEN.
 * Wer darf was: – (Anzeige für Rollen mit Sichtklasse „verwaltung“; Prüfung vor dem Aufruf).
 * Besonderheiten:
 *   - Befund: { regel, schwere: 'fehler'|'warnung'|'hinweis', tab, id, mitglied_id, meldung }.
 *   - Die Integritätsregeln werden beim Schreiben zusätzlich in den Fachmodulen erzwungen; diese Prüfung findet
 *     Altlasten, Migrationsfehler und Handänderungen im Sheet.
 *   - IBAN: nutzt Iban.gueltig/Iban.pruefe aus src/lib/iban.js, falls vorhanden, sonst eigene Prüfziffer (mod 97).
 *   - Anonymisierte Anker und reine Funktionsträger sind von Mitgliedschaftsregeln ausgenommen.
 */
var Pruefregeln = (function () {

  var REGELN = {
    zeitraum_fehlt: { schwere: 'fehler', titel: 'Mitglied ohne Mitgliedschaftszeitraum' },
    lastschrift_unvollstaendig: { schwere: 'fehler', titel: 'Lastschrift ohne IBAN, Mandatsreferenz oder Mandatsdatum' },
    iban_ungueltig: { schwere: 'fehler', titel: 'IBAN mit falscher Prüfziffer' },
    aktiv_ohne_beitrag: { schwere: 'fehler', titel: 'Aktives Mitglied ohne Beitragsart und ohne Beitragsgemeinschaft' },
    aktiv_ohne_konto: { schwere: 'warnung', titel: 'Aktives Mitglied ohne Beitragskonto (Zahlweg offen)' },
    konto_inaktiv: { schwere: 'fehler', titel: 'Aktives Mitglied auf stillgelegtem Beitragskonto' },
    gemeinschaft_konten: { schwere: 'fehler', titel: 'Beitragsgemeinschaft mit mehreren Beitragskonten' },
    gemeinschaft_und_beitragsart: { schwere: 'warnung', titel: 'Mitglied in Gemeinschaft mit Festbetrag hat zusätzlich eine Beitragsart' },
    amt_ebene: { schwere: 'fehler', titel: 'Vereinsamt mit Abteilung bzw. Abteilungsamt ohne Abteilung' },
    eindeutigkeit: { schwere: 'fehler', titel: 'Eindeutigkeit verletzt' },
    verweis_ungueltig: { schwere: 'fehler', titel: 'Verweis auf nicht vorhandenen Datensatz' },
    fz_fehlt: { schwere: 'fehler', titel: 'Laufende nachweispflichtige Funktion ohne gültiges Führungszeugnis' },
    dublette: { schwere: 'warnung', titel: 'Mögliche Dublette (Nachname + Geburtsdatum)' },
    strasse_hausnummer: { schwere: 'warnung', titel: 'Hausnummer steht in der Straße' },
    plz_format: { schwere: 'warnung', titel: 'PLZ nicht fünfstellig (Deutschland)' },
    email_format: { schwere: 'warnung', titel: 'E-Mail-Adresse ungültig' },
    geschlecht_fehlt: { schwere: 'hinweis', titel: 'Geschlecht fehlt (BLSV)' },
    geburtsdatum_fehlt: { schwere: 'hinweis', titel: 'Geburtsdatum fehlt (BLSV, Tarif, Ehrungen)' },
    verstorben_laufend: { schwere: 'fehler', titel: 'Verstorben, aber noch laufende Mitgliedschaft/Abteilung/Funktion' },
    ausgetreten_laufend: { schwere: 'warnung', titel: 'Ausgetreten, aber noch laufende Abteilungszugehörigkeit oder Funktion' },
    status_veraltet: { schwere: 'hinweis', titel: 'Gespeicherter Status weicht vom abgeleiteten ab' },
    minderjaehrig_ohne_vertretung: { schwere: 'hinweis', titel: 'Minderjährig ohne gesetzliche Vertretung' },
    konto_ohne_mitglied: { schwere: 'hinweis', titel: 'Aktives Beitragskonto ohne aktives Mitglied' },
    waise: { schwere: 'warnung', titel: 'Kontoinhaber nicht mehr aktiv, Abhängige zahlen weiter über sein Mandat' },
    // Zeitachsen (Prüfung 10/2026): finden Altlasten aus Migration, Handänderungen und abgebrochenen Abläufen
    zeitraum_ueberlappung: { schwere: 'fehler', titel: 'Mehrere offene oder überlappende Mitgliedschaftszeiträume' },
    datum_reihenfolge: { schwere: 'fehler', titel: 'Ende liegt vor dem Beginn' },
    funktion_doppelt: { schwere: 'warnung', titel: 'Gleiche Funktion zeitgleich mehrfach eingetragen' }
  };

  function liste(daten, tab) { return (daten && daten[tab]) || []; }
  function nachId(rows, feld) { var m = {}; rows.forEach(function (r) { m[r[feld]] = r; }); return m; }

  /** IBAN-Prüfziffer (ISO 13616, mod 97). */
  function ibanOk(iban) {
    if (typeof Iban !== 'undefined') {
      if (typeof Iban.gueltig === 'function') return !!Iban.gueltig(iban);
      if (typeof Iban.pruefe === 'function') { var r = Iban.pruefe(iban); return r === true || (r && r.ok === true); }
    }
    var s = String(iban || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    if (s.slice(0, 2) === 'DE' && s.length !== 22) return false;
    var umgestellt = s.slice(4) + s.slice(0, 4);
    var rest = 0;
    for (var i = 0; i < umgestellt.length; i++) {
      var c = umgestellt.charCodeAt(i);
      var teil = c >= 65 ? String(c - 55) : umgestellt[i];
      for (var j = 0; j < teil.length; j++) rest = (rest * 10 + Number(teil[j])) % 97;
    }
    return rest === 1;
  }

  /**
   * Prüft den Bestand. heute 'JJJJ-MM-TT'; konfig aus _Konfig (z. B. fz_wiedervorlage_monate).
   * Liefert Befunde, sortiert nach Schwere.
   */
  function pruefe(daten, heute, konfig) {
    var b = [];
    function befund(regel, tab, id, mitgliedId, meldung) {
      b.push({ regel: regel, schwere: REGELN[regel].schwere, tab: tab, id: id === undefined ? null : id,
        mitglied_id: mitgliedId === undefined ? null : mitgliedId, meldung: meldung || REGELN[regel].titel });
    }
    var M = Mitgliedschaft;
    var mitglieder = liste(daten, 'Mitglied');
    var mNachId = nachId(mitglieder, 'mitglied_id');
    var zr = {};
    liste(daten, 'Mitgliedschaftszeitraum').forEach(function (z) { (zr[z.mitglied_id] = zr[z.mitglied_id] || []).push(z); });
    Object.keys(zr).forEach(function (k) { zr[k].sort(function (a, c) { return String(a.eintrittsdatum).localeCompare(String(c.eintrittsdatum)); }); });
    var konten = nachId(liste(daten, 'Beitragskonto'), 'beitragskonto_id');
    var gemeinschaften = nachId(liste(daten, 'Beitragsgemeinschaft'), 'beitragsgemeinschaft_id');
    var beitragsarten = nachId(liste(daten, 'Beitragsart'), 'beitragsart_id');
    var abteilungen = nachId(liste(daten, 'Abteilung'), 'abteilung_id');
    var fArten = nachId(liste(daten, 'Funktionsart'), 'funktionsart_id');
    var status = {};

    // ---------- Mitglied
    var dubletten = {};
    mitglieder.forEach(function (m) {
      var id = m.mitglied_id;
      var zs = zr[id] || [];
      var st = M.status(m, zs, heute);
      status[id] = st;
      if (m.anonymisiert === true) return;
      if (!zs.length && m.nur_funktionstraeger !== true) befund('zeitraum_fehlt', 'Mitglied', id, id);
      if (m.status && st && m.status !== st) befund('status_veraltet', 'Mitglied', id, id, 'Gespeichert „' + m.status + '“, abgeleitet „' + st + '“.');
      if (st === 'aktiv') {
        var gem = m.beitragsgemeinschaft_id ? gemeinschaften[m.beitragsgemeinschaft_id] : null;
        if (!m.beitragsart_id && !m.beitragsgemeinschaft_id && m.nur_funktionstraeger !== true) befund('aktiv_ohne_beitrag', 'Mitglied', id, id);
        if (gem && gem.festbetrag !== null && gem.festbetrag !== undefined && m.beitragsart_id) befund('gemeinschaft_und_beitragsart', 'Mitglied', id, id);
        if (!m.beitragskonto_id && m.nur_funktionstraeger !== true) befund('aktiv_ohne_konto', 'Mitglied', id, id);
        else if (m.beitragskonto_id && konten[m.beitragskonto_id] && konten[m.beitragskonto_id].aktiv === false) befund('konto_inaktiv', 'Mitglied', id, id);
        if (!m.geschlecht) befund('geschlecht_fehlt', 'Mitglied', id, id);
        if (!m.geburtsdatum) befund('geburtsdatum_fehlt', 'Mitglied', id, id);
        var alter = M.alter(m.geburtsdatum, heute);
        if (alter !== null && alter < 18 && !m.vertreter_mitglied_id && !m.vertreter_name) befund('minderjaehrig_ohne_vertretung', 'Mitglied', id, id);
      }
      if (m.beitragsart_id && !beitragsarten[m.beitragsart_id]) befund('verweis_ungueltig', 'Mitglied', id, id, 'Beitragsart ' + m.beitragsart_id + ' existiert nicht.');
      if (m.beitragskonto_id && !konten[m.beitragskonto_id]) befund('verweis_ungueltig', 'Mitglied', id, id, 'Beitragskonto ' + m.beitragskonto_id + ' existiert nicht.');
      if (m.beitragsgemeinschaft_id && !gemeinschaften[m.beitragsgemeinschaft_id]) befund('verweis_ungueltig', 'Mitglied', id, id, 'Beitragsgemeinschaft ' + m.beitragsgemeinschaft_id + ' existiert nicht.');
      if (m.vertreter_mitglied_id && !mNachId[m.vertreter_mitglied_id]) befund('verweis_ungueltig', 'Mitglied', id, id, 'Vertretung (Mitglied ' + m.vertreter_mitglied_id + ') existiert nicht.');
      if (m.strasse && !m.hausnummer && /\d/.test(m.strasse)) befund('strasse_hausnummer', 'Mitglied', id, id, 'Straße „' + m.strasse + '“ enthält eine Zahl, Hausnummer ist leer.');
      if (m.plz && (!m.land || m.land === 'DE') && !/^\d{5}$/.test(String(m.plz))) befund('plz_format', 'Mitglied', id, id, 'PLZ „' + m.plz + '“.');
      if (m.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m.email)) befund('email_format', 'Mitglied', id, id, 'E-Mail „' + m.email + '“.');
      if (m.nachname && m.geburtsdatum) {
        var key = (typeof Migration !== 'undefined' && Migration.falte ? Migration.falte(m.nachname) : String(m.nachname).toLowerCase().trim()) + '|' + m.geburtsdatum;
        (dubletten[key] = dubletten[key] || []).push(id);
      }
      if (m.sterbedatum && zs.some(function (z) { return !M.endeVon(z) || M.endeVon(z) > m.sterbedatum; })) {
        befund('verstorben_laufend', 'Mitglied', id, id, 'Mitgliedschaftszeitraum läuft über das Sterbedatum hinaus.');
      }
    });
    Object.keys(dubletten).forEach(function (k) {
      if (dubletten[k].length > 1) dubletten[k].forEach(function (id) {
        befund('dublette', 'Mitglied', id, id, 'Gleicher Nachname und Geburtsdatum wie Mitglied ' + dubletten[k].filter(function (x) { return x !== id; }).join(', ') + '.');
      });
    });

    // ---------- Zeitachsen: Mitgliedschaftszeiträume
    liste(daten, 'Mitgliedschaftszeitraum').forEach(function (z) {
      if (!mNachId[z.mitglied_id]) befund('verweis_ungueltig', 'Mitgliedschaftszeitraum', z.zeitraum_id, z.mitglied_id, 'Mitglied ' + z.mitglied_id + ' existiert nicht.');
      var ende = M.endeVon(z);
      if (z.eintrittsdatum && ende && ende < z.eintrittsdatum) {
        befund('datum_reihenfolge', 'Mitgliedschaftszeitraum', z.zeitraum_id, z.mitglied_id, 'Austritt ' + ende + ' liegt vor dem Eintritt ' + z.eintrittsdatum + '.');
      }
    });
    Object.keys(zr).forEach(function (mid) {
      var zs = zr[mid];
      if (mNachId[mid] && mNachId[mid].anonymisiert === true) return;
      var offen = zs.filter(function (z) { return !M.endeVon(z); });
      if (offen.length > 1) {
        befund('zeitraum_ueberlappung', 'Mitgliedschaftszeitraum', offen[1].zeitraum_id, Number(mid), offen.length + ' offene Zeiträume (Eintritte ' + offen.map(function (z) { return z.eintrittsdatum; }).join(', ') + ').');
        return;
      }
      for (var i = 1; i < zs.length; i++) {
        var vorher = M.endeVon(zs[i - 1]);
        if (!vorher || (zs[i].eintrittsdatum && vorher >= zs[i].eintrittsdatum)) {
          befund('zeitraum_ueberlappung', 'Mitgliedschaftszeitraum', zs[i].zeitraum_id, Number(mid), 'Eintritt ' + zs[i].eintrittsdatum + ' liegt vor dem Ende des vorigen Zeitraums (' + (vorher || 'offen') + ').');
        }
      }
    });

    // ---------- Zugehörigkeit / Funktion: laufend trotz Tod/Austritt, Verweise, Ebene
    function laufendNach(von, bis, ende) { return !bis || bis > ende; }
    liste(daten, 'Abteilungszugehoerigkeit').forEach(function (z) {
      var m = mNachId[z.mitglied_id];
      if (!m) { befund('verweis_ungueltig', 'Abteilungszugehoerigkeit', z.zugehoerigkeit_id, z.mitglied_id, 'Mitglied ' + z.mitglied_id + ' existiert nicht.'); return; }
      if (!abteilungen[z.abteilung_id]) befund('verweis_ungueltig', 'Abteilungszugehoerigkeit', z.zugehoerigkeit_id, z.mitglied_id, 'Abteilung ' + z.abteilung_id + ' existiert nicht.');
      if (z.eintrittsdatum && z.austrittsdatum && z.austrittsdatum < z.eintrittsdatum) {
        befund('datum_reihenfolge', 'Abteilungszugehoerigkeit', z.zugehoerigkeit_id, z.mitglied_id, 'Austritt ' + z.austrittsdatum + ' liegt vor dem Eintritt ' + z.eintrittsdatum + '.');
      }
      if (m.anonymisiert === true) return;
      if (m.sterbedatum && laufendNach(z.eintrittsdatum, z.austrittsdatum, m.sterbedatum)) befund('verstorben_laufend', 'Abteilungszugehoerigkeit', z.zugehoerigkeit_id, m.mitglied_id, 'Abteilungszugehörigkeit nach dem Sterbedatum offen.');
      else if (status[m.mitglied_id] === 'ausgetreten' && !z.austrittsdatum) befund('ausgetreten_laufend', 'Abteilungszugehoerigkeit', z.zugehoerigkeit_id, m.mitglied_id, 'Abteilungszugehörigkeit ohne Austrittsdatum.');
    });
    var funktionenJe = {};
    liste(daten, 'Funktion').forEach(function (f) {
      var m = mNachId[f.mitglied_id];
      var art = fArten[f.funktionsart_id];
      if (!m) { befund('verweis_ungueltig', 'Funktion', f.funktion_id, f.mitglied_id, 'Mitglied ' + f.mitglied_id + ' existiert nicht.'); return; }
      if (!art) befund('verweis_ungueltig', 'Funktion', f.funktion_id, f.mitglied_id, 'Funktionsart ' + f.funktionsart_id + ' existiert nicht.');
      else if (art.ebene === 'Verein' && f.abteilung_id) befund('amt_ebene', 'Funktion', f.funktion_id, f.mitglied_id, '„' + art.bezeichnung + '“ ist ein Vereinsamt und darf keine Abteilung haben.');
      else if (art.ebene === 'Abteilung' && !f.abteilung_id) befund('amt_ebene', 'Funktion', f.funktion_id, f.mitglied_id, '„' + art.bezeichnung + '“ ist ein Abteilungsamt und braucht eine Abteilung.');
      if (f.abteilung_id && !abteilungen[f.abteilung_id]) befund('verweis_ungueltig', 'Funktion', f.funktion_id, f.mitglied_id, 'Abteilung ' + f.abteilung_id + ' existiert nicht.');
      if (f.von && f.bis && f.bis < f.von) befund('datum_reihenfolge', 'Funktion', f.funktion_id, f.mitglied_id, 'Ende ' + f.bis + ' liegt vor dem Beginn ' + f.von + '.');
      var schluessel = [f.mitglied_id, f.funktionsart_id, f.abteilung_id || '', String(f.zusatz || '').trim().toLowerCase()].join('|');
      (funktionenJe[schluessel] = funktionenJe[schluessel] || []).push(f);
      if (m.anonymisiert === true) return;
      if (m.sterbedatum && laufendNach(f.von, f.bis, m.sterbedatum)) befund('verstorben_laufend', 'Funktion', f.funktion_id, m.mitglied_id, 'Funktion nach dem Sterbedatum nicht beendet.');
      else if (status[m.mitglied_id] === 'ausgetreten' && !f.bis && m.nur_funktionstraeger !== true) befund('ausgetreten_laufend', 'Funktion', f.funktion_id, m.mitglied_id, 'Funktion ohne Ende trotz Austritt.');
    });

    // Gleiche Funktion (Person, Art, Abteilung, Zusatz) zeitlich überlappend – z. B. Doppelklick beim Eintragen
    Object.keys(funktionenJe).forEach(function (k) {
      var fs = funktionenJe[k].slice().sort(function (a, c) { return String(a.von).localeCompare(String(c.von)); });
      for (var i = 1; i < fs.length; i++) {
        var vorher = fs[i - 1];
        if (!vorher.bis || (fs[i].von && vorher.bis >= fs[i].von)) {
          befund('funktion_doppelt', 'Funktion', fs[i].funktion_id, fs[i].mitglied_id, 'Überschneidet sich mit Funktion ' + vorher.funktion_id + ' (ab ' + vorher.von + ').');
        }
      }
    });

    // ---------- Weitere Verweise (Fremdschlüssel)
    liste(daten, 'Sollstellung').forEach(function (s) {
      if (!konten[s.beitragskonto_id]) befund('verweis_ungueltig', 'Sollstellung', s.sollstellung_id, null, 'Beitragskonto ' + s.beitragskonto_id + ' existiert nicht.');
    });
    liste(daten, 'Beitragskonto').forEach(function (k) {
      if (k.kontoinhaber_mitglied_id && !mNachId[k.kontoinhaber_mitglied_id]) {
        befund('verweis_ungueltig', 'Beitragskonto', k.beitragskonto_id, null, 'Kontoinhaber (Mitglied ' + k.kontoinhaber_mitglied_id + ') existiert nicht.');
      }
    });
    liste(daten, 'Benutzer').forEach(function (u) {
      if (u.mitglied_id && !mNachId[u.mitglied_id]) befund('verweis_ungueltig', 'Benutzer', u.benutzer_id, null, 'Zugang ' + u.email + ': Mitglied ' + u.mitglied_id + ' existiert nicht.');
      if (u.abteilung_id && !abteilungen[u.abteilung_id]) befund('verweis_ungueltig', 'Benutzer', u.benutzer_id, null, 'Zugang ' + u.email + ': Abteilung ' + u.abteilung_id + ' existiert nicht.');
    });
    liste(daten, 'Notiz').forEach(function (n) {
      if (n.mitglied_id && !mNachId[n.mitglied_id]) befund('verweis_ungueltig', 'Notiz', n.notiz_id, null, 'Mitglied ' + n.mitglied_id + ' existiert nicht.');
      if (n.beitragskonto_id && !konten[n.beitragskonto_id]) befund('verweis_ungueltig', 'Notiz', n.notiz_id, n.mitglied_id || null, 'Beitragskonto ' + n.beitragskonto_id + ' existiert nicht.');
    });

    // ---------- Konten und Gemeinschaften
    var kontoNutzer = {};
    mitglieder.forEach(function (m) {
      if (m.beitragskonto_id && status[m.mitglied_id] === 'aktiv') kontoNutzer[m.beitragskonto_id] = true;
    });
    liste(daten, 'Beitragskonto').forEach(function (k) {
      if (k.aktiv === false) return;
      if (k.zahlweg === 'Lastschrift') {
        var fehlt = ['iban', 'mandatsreferenz', 'mandatsdatum'].filter(function (f) { return !k[f]; });
        if (fehlt.length) befund('lastschrift_unvollstaendig', 'Beitragskonto', k.beitragskonto_id, k.kontoinhaber_mitglied_id, 'Es fehlt: ' + fehlt.join(', ') + '.');
      }
      if (k.iban && !ibanOk(k.iban)) befund('iban_ungueltig', 'Beitragskonto', k.beitragskonto_id, k.kontoinhaber_mitglied_id);
      if (!kontoNutzer[k.beitragskonto_id]) befund('konto_ohne_mitglied', 'Beitragskonto', k.beitragskonto_id, k.kontoinhaber_mitglied_id);
      else if (k.kontoinhaber_mitglied_id && mNachId[k.kontoinhaber_mitglied_id] && status[k.kontoinhaber_mitglied_id] !== 'aktiv') {
        // Guard statt Cascade (Übergabe §4): Abhängige werden zu Waisen und müssen neu zugeordnet werden.
        befund('waise', 'Beitragskonto', k.beitragskonto_id, k.kontoinhaber_mitglied_id,
          'Inhaber (Mitglied ' + k.kontoinhaber_mitglied_id + ') ist ' + (status[k.kontoinhaber_mitglied_id] || 'kein Mitglied') + ' – neuen Zahler/Mandat zuordnen.');
      }
    });
    var gemKonten = {};
    mitglieder.forEach(function (m) {
      if (!m.beitragsgemeinschaft_id || m.anonymisiert === true || status[m.mitglied_id] !== 'aktiv') return;
      var s = gemKonten[m.beitragsgemeinschaft_id] = gemKonten[m.beitragsgemeinschaft_id] || {};
      s[m.beitragskonto_id === null || m.beitragskonto_id === undefined ? 'leer' : m.beitragskonto_id] = true;
    });
    Object.keys(gemKonten).forEach(function (g) {
      var ks = Object.keys(gemKonten[g]);
      if (ks.length > 1) befund('gemeinschaft_konten', 'Beitragsgemeinschaft', Number(g), null, 'Gemeinschaft ' + g + ' verteilt sich auf Konten ' + ks.join(', ') + '.');
    });

    // ---------- Eindeutigkeiten (Schema) und doppelte IDs
    if (typeof Schema !== 'undefined') {
      Object.keys(daten || {}).forEach(function (tab) {
        var t = Schema.TABELLEN[tab];
        if (!t) return;
        var regeln = (t.eindeutig || []).slice();
        if (t.idSpalte) regeln.push([t.idSpalte]);
        regeln.forEach(function (spalten) {
          var gesehen = {};
          liste(daten, tab).forEach(function (r) {
            var werte = spalten.map(function (s) {
              if (r[s] === null || r[s] === undefined) return '';
              return s === 'email' ? String(r[s]).trim().toLowerCase() : String(r[s]);   // wie DB/Rechteprüfung
            });
            if (spalten.length === 1 && werte[0] === '') return;
            var key = werte.join('|');
            if (gesehen[key] !== undefined) {
              befund('eindeutigkeit', tab, t.idSpalte ? r[t.idSpalte] : null, r.mitglied_id === undefined ? null : r.mitglied_id,
                spalten.join(' + ') + ' = ' + werte.join(' / ') + ' kommt mehrfach vor.');
            }
            gesehen[key] = true;
          });
        });
      });
    }

    // ---------- Führungszeugnisse
    if (typeof Fristen !== 'undefined') {
      Fristen.uebersicht(daten, heute, konfig).maengel.forEach(function (x) { befund('fz_fehlt', 'Qualifikation', null, x.mitglied_id, x.meldung); });
    }

    var rang = { fehler: 0, warnung: 1, hinweis: 2 };
    b.sort(function (x, y) { return rang[x.schwere] - rang[y.schwere] || String(x.regel).localeCompare(String(y.regel)) || (x.mitglied_id || 0) - (y.mitglied_id || 0); });
    return b;
  }

  /** { fehler, warnung, hinweis, je_regel: { regel: { anzahl, schwere, titel } } } */
  function zusammenfassung(befunde) {
    var z = { fehler: 0, warnung: 0, hinweis: 0, je_regel: {} };
    (befunde || []).forEach(function (x) {
      z[x.schwere]++;
      var r = z.je_regel[x.regel] = z.je_regel[x.regel] || { anzahl: 0, schwere: x.schwere, titel: (REGELN[x.regel] || {}).titel || x.regel };
      r.anzahl++;
    });
    return z;
  }

  return { REGELN: REGELN, pruefe: pruefe, zusammenfassung: zusammenfassung, ibanOk: ibanOk };
})();
