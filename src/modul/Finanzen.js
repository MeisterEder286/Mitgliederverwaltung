/**
 * Finanzen – Servermodul für Beitragskonten, Beitragsgemeinschaften, Sollstellungen und den SEPA-Lauf.
 *
 * Zweck:      Fachabläufe des Bereichs „Finanzen“ (MV-Mockup: Beitragskonten, Einzugsstand, SEPA-Lauf):
 *             Kennzahlen und Kontoinformationen berechnen, Konten/Gemeinschaften pflegen, Personen zuordnen,
 *             Jahres-Sollstellungen anlegen, Zahlungsstatus buchen, SEPA-Datei pain.008.001.08 erzeugen,
 *             Klärliste und Tarifwechsel. Die Rechenregeln stehen in src/lib/beitrag.js, sollstellung.js, sepa.js.
 * Datenquelle: Rechnen auf der Snapshot-Basis (Snapshot.basis(), ohne Klartext-IBAN). Klartext-IBANs werden NUR in
 *             den Funktionen gelesen, die sie brauchen (IBAN aufdecken, SEPA-Datei) – gezielt per DB.lese.
 * Wer darf was (geprüft in src/api/Finanzen.js über Api.ausfuehren):
 *   - konto_lesen: Übersicht, Kontodetails, Klärliste, Tarifwechsel-Vorschläge (Vorstand, MV, Kassier)
 *   - iban_aufdecken: IBAN eines Kontos im Klartext (wird protokolliert: „eingesehen“)
 *   - konto_bearbeiten: Konten, Gemeinschaften, Zuordnungen (Vorstand, MV – der Kassier bewusst NICHT)
 *   - sollstellung_bearbeiten: Jahreslauf anlegen, Zahlungsstatus buchen
 *   - sepa_lauf: Probelauf, Freigabe, XML-Datei
 *   - mitglied_bearbeiten: Tarifwechsel übernehmen (ändert die Beitragsart am Mitglied)
 * Besonderheiten:
 *   - Massenschreiben (Sollstellungslauf ~850 Zeilen, SEPA-Vermerke, Sammelbuchungen) läuft NICHT zeilenweise über
 *     DB.einfuegen/DB.aktualisieren (das wären tausende Tabellenzugriffe), sondern über massenEinfuegen /
 *     massenAktualisieren unten: ein Lesezugriff, ein Schreibzugriff, IDs als Block aus _Konfig. Immer unter Sperre.
 *   - Protokoll: Einzeländerungen feldgenau (bei IBAN/Mandat inkl. alt/neu – so verlangt es das Datenmodell),
 *     Massenvorgänge als EIN Sammeleintrag (Anzahl, Summe). Die SEPA-Datei selbst wird nicht gespeichert.
 *   - Vereinskonto für die SEPA-Datei: _Konfig verein_iban (Pflicht), verein_bic, verein_strasse, verein_hausnummer,
 *     verein_plz, verein_ort (optional). Fehlen sie, entsteht keine Datei, sondern eine klare Meldung.
 *   - Vier-Augen-Prinzip (optional): _Konfig.sepa_vier_augen = ja → vor dem Erzeugen muss eine ANDERE Person den
 *     Probelauf des Jahres freigegeben haben (Vermerk in _Protokoll, Tabelle „SEPA-Freigabe“).
 */
var Finanzen = (function () {

  // ================================================================== Hilfen

  function heute() { return DB.jetzt().slice(0, 10); }

  function basis() { return Snapshot.basis(); }

  /** Rechen-Daten aus der Basis (Tab-Listen wie DB.lese) + Konfiguration. */
  function daten(b) {
    b = b || basis();
    var d = {};
    Object.keys(b.tabs).forEach(function (t) { d[t] = b.tabs[t]; });
    return { daten: d, konfig: b.konfig || {} };
  }

  function konfigWert(k, schluessel) {
    var v = k[schluessel];
    return v === undefined || v === null ? '' : String(v);
  }

  function beitragsjahr(k) {
    var j = Number(konfigWert(k, 'beitragsjahr'));
    return j > 2000 ? j : Number(heute().slice(0, 4));
  }

  function jahrPruefen(jahr, k) {
    var j = Number(jahr || beitragsjahr(k));
    if (!(j >= 2000 && j <= 2100) || Math.floor(j) !== j) throw Fehler.fachlich('Bitte ein gültiges Beitragsjahr angeben.');
    return j;
  }

  function nachId(liste, feld) {
    var m = {};
    (liste || []).forEach(function (z) { m[z[feld]] = z; });
    return m;
  }

  function name(m) { return Beitrag.name(m); }

  function datumPruefen(iso, feld, titel) {
    if (iso === null || iso === undefined || iso === '') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: feld, meldung: titel + ': bitte als TT.MM.JJJJ angeben.' }]);
    return String(iso);
  }

  function euro(n) { return Beitrag.euro(Number(n || 0)) + ' €'; }

  // ================================================================== Massenschreiben (ein Lese-, ein Schreibzugriff)

  function kopfVon(b) {
    var spalten = b.getLastColumn();
    var kopf = b.getRange(1, 1, 1, spalten).getValues()[0].map(function (k) { return String(k).trim(); });
    DB.zaehle(2);
    return kopf;
  }

  /** Reserviert n fortlaufende IDs aus _Konfig.next_id_<Tab>. Nur unter Sperre. */
  function reserviereIds(tab, n) {
    var t = Schema.TABELLEN[tab];
    var k = DB.blatt('_Konfig');
    var kopf = kopfVon(k);
    var sS = kopf.indexOf('schluessel'), sW = kopf.indexOf('wert');
    var letzte = k.getLastRow();
    DB.zaehle(1);
    var schluessel = 'next_id_' + tab;
    if (letzte >= 2) {
      var zeilen = k.getRange(2, 1, letzte - 1, kopf.length).getValues();
      DB.zaehle(1);
      for (var i = 0; i < zeilen.length; i++) {
        if (String(zeilen[i][sS]).trim() === schluessel) {
          var start = Number(zeilen[i][sW]);
          if (!(start > 0)) throw new Error('Zähler ' + schluessel + ' ist ungültig');
          k.getRange(i + 2, sW + 1).setValue(String(start + n));
          DB.zaehle(1);
          return start;
        }
      }
    }
    var max = 0;
    DB.lese([tab])[tab].forEach(function (z) { var v = Number(z[t.idSpalte]); if (v > max) max = v; });
    k.appendRow(kopf.map(function (h) {
      return h === 'schluessel' ? schluessel : h === 'wert' ? String(max + 1 + n) : h === 'beschreibung' ? 'ID-Zähler — nur vom Skript erhöhen' : '';
    }));
    DB.zaehle(1);
    return max + 1;
  }

  /**
   * Legt viele Datensätze mit EINEM Schreibzugriff an. objekte ohne ID. Liefert die gespeicherten Objekte.
   * Prüft Felder (Werte.pruefe); Eindeutigkeiten muss der Aufrufer vorher sicherstellen.
   */
  function massenEinfuegen(tab, objekte, ktx) {
    if (!objekte.length) return [];
    var t = Schema.TABELLEN[tab];
    var start = reserviereIds(tab, objekte.length);
    var jetzt = DB.jetzt();
    var b = DB.blatt(tab);
    var kopf = kopfVon(b);
    var neu = objekte.map(function (o, i) {
      var x = {};
      Object.keys(o).forEach(function (f) { x[f] = o[f]; });
      var fehler = Werte.pruefe(tab, x);
      if (fehler.length) throw Fehler.fachlich(fehler.map(function (f) { return f.meldung; }).join(' '));
      x[t.idSpalte] = start + i;
      x.version = 1; x.geaendert_am = jetzt; x.geaendert_von = (ktx && ktx.email) || null;
      return x;
    });
    var zeilen = neu.map(function (x) { return Werte.objektZuZeile(kopf, x, tab); });
    DB.anhaengen(b, zeilen);
    return zeilen.map(function (z) { return Werte.zeileZuObjekt(kopf, z, tab); });
  }

  /**
   * Ändert viele Datensätze: aenderungen = { id: { feld: wert } }. Ein Lese-, ein Schreibzugriff (zusammenhängender
   * Block von der ersten bis zur letzten geänderten Zeile). versionen (optional) = { id: erwartete Version }.
   * Liefert [{ alt, neu, diff }]. Unveränderte Zeilen im Block werden unverändert zurückgeschrieben (Texte mit
   * Formelschutz, damit z. B. „=…“ nicht zur Formel wird).
   */
  function massenAktualisieren(tab, aenderungen, ktx, versionen) {
    var ids = Object.keys(aenderungen);
    if (!ids.length) return [];
    var t = Schema.TABELLEN[tab];
    var b = DB.blatt(tab);
    var letzte = b.getLastRow();
    var spalten = b.getLastColumn();
    DB.zaehle(2);
    if (letzte < 2) throw Fehler.fachlich('Die Datensätze wurden nicht gefunden. Bitte die Ansicht neu laden.');
    var werte = b.getRange(1, 1, letzte, spalten).getValues();
    DB.zaehle(1);
    var kopf = werte[0].map(function (k) { return String(k).trim(); });
    var sId = kopf.indexOf(t.idSpalte);
    var jetzt = DB.jetzt();
    var ergebnis = [], min = Infinity, max = -1, gefunden = {};
    for (var r = 1; r < werte.length; r++) {
      var id = String(werte[r][sId]);
      if (id === '' || !Object.prototype.hasOwnProperty.call(aenderungen, id)) continue;
      gefunden[id] = true;
      var alt = Werte.zeileZuObjekt(kopf, werte[r], tab);
      if (versionen && versionen[id] !== undefined && Number(alt.version || 0) !== Number(versionen[id])) throw Fehler.konflikt(alt);
      var aend = aenderungen[id];
      var fehler = Werte.pruefe(tab, aend, { teilweise: true });
      if (fehler.length) throw Fehler.fachlich(fehler.map(function (f) { return f.meldung; }).join(' '));
      var d = Werte.diff(tab, alt, aend);
      if (!d.length) continue;
      var neu = {};
      Object.keys(alt).forEach(function (f) { neu[f] = alt[f]; });
      Object.keys(aend).forEach(function (f) { neu[f] = aend[f]; });
      neu.version = Number(alt.version || 0) + 1; neu.geaendert_am = jetzt; neu.geaendert_von = (ktx && ktx.email) || null;
      werte[r] = Werte.objektZuZeile(kopf, neu, tab, werte[r]);
      werte[r].__geaendert = true;
      ergebnis.push({ alt: alt, neu: Werte.zeileZuObjekt(kopf, werte[r], tab), diff: d });
      if (r < min) min = r;
      if (r > max) max = r;
    }
    var fehlend = ids.filter(function (i) { return !gefunden[i]; });
    if (fehlend.length) throw Fehler.fachlich('Einige Datensätze wurden nicht gefunden (' + fehlend.slice(0, 5).join(', ') + '). Bitte die Ansicht neu laden.');
    if (max < 0) return [];
    var block = werte.slice(min, max + 1).map(function (z) {
      if (z.__geaendert) { var k = z.slice(); return k; }
      return z.map(function (v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; });
    });
    b.getRange(min + 1, 1, block.length, spalten).setValues(block);
    DB.zaehle(1);
    return ergebnis;
  }

  // ================================================================== Lesen: Übersicht und Konto

  function mandatKurz(konto, d, k, h) {
    if (konto.zahlweg !== 'Lastschrift') return { status: 'kein', text: 'kein Einzug' };
    if (!konto.mandatsreferenz || !konto.mandatsdatum) return { status: 'fehlt', text: 'Mandat fehlt' };
    var ms = Beitrag.mandatStatus(konto, d, h, { konfig: k });
    var nie = !Beitrag.letzteMandatsnutzung(konto, d) || Beitrag.letzteMandatsnutzung(konto, d) === konto.mandatsdatum;
    if (ms.verfallen) return { status: 'verfallen', text: 'verfallen', letzte: ms.letzteNutzung, verfaelltAm: ms.verfaelltAm };
    return { status: nie ? 'ungenutzt' : 'gueltig', text: nie ? 'noch nicht genutzt' : 'gültig', letzte: ms.letzteNutzung, verfaelltAm: ms.verfaelltAm };
  }

  /** Kennzahlen + Kurzinfo je Konto (Soll lfd. Jahr, Mandatsstatus, Personen, Probleme) in EINEM Aufruf. */
  function uebersicht(ktx, jahr) {
    var x = daten();
    var d = x.daten, k = x.konfig, h = heute();
    jahr = jahrPruefen(jahr, k);
    return Beitrag.mitIndex(d, function () {
      var ix = Beitrag.index(d);
      var stand = Sollstellungslauf.einzugsstand(d, jahr, h, k);
      var klaer = Beitrag.klaerliste(d, jahr, h, { konfig: k });
      var problemeJe = {};
      klaer.forEach(function (e) { if (e.konto_id) problemeJe[e.konto_id] = (problemeJe[e.konto_id] || 0) + 1; });
      var konten = {};
      (d.Beitragskonto || []).forEach(function (konto) {
        var id = konto.beitragskonto_id;
        var personen = (ix.mitgliederJeKonto[id] || []).filter(function (m) { return Beitrag.pflicht(m, d, jahr, { konfig: k }).pflichtig; }).length;
        var soll = konto.aktiv === false ? { betrag: 0 } : Beitrag.sollJeKonto(id, d, jahr, { konfig: k });
        var m = mandatKurz(konto, d, k, h);
        konten[id] = { soll: soll.betrag, mandat: m.status, mandat_text: m.text, personen: personen, probleme: problemeJe[id] || 0 };
      });
      var jahre = {};
      (d.Sollstellung || []).forEach(function (s) { jahre[s.jahr] = true; });
      jahre[beitragsjahr(k)] = true;
      return {
        jahr: jahr, beitragsjahr: beitragsjahr(k),
        jahre: Object.keys(jahre).map(Number).sort(function (a, b) { return b - a; }),
        einzugsstand: stand, konten: konten,
        klaerliste: { fehler: klaer.filter(function (e) { return e.schwere === 'fehler'; }).length, warnungen: klaer.filter(function (e) { return e.schwere !== 'fehler'; }).length },
        vier_augen: konfigWert(k, 'sepa_vier_augen') === 'ja'
      };
    });
  }

  /** Details eines Kontos: Zusammensetzung des Solls, Mandatsstatus, Zahleranschrift, Prüfungen. */
  function konto(ktx, id, jahr) {
    var x = daten();
    var d = x.daten, k = x.konfig, h = heute();
    jahr = jahrPruefen(jahr, k);
    var kt = nachId(d.Beitragskonto, 'beitragskonto_id')[id];
    if (!kt) throw Fehler.fachlich('Das Konto wurde nicht gefunden. Bitte die Ansicht neu laden.');
    return Beitrag.mitIndex(d, function () {
      var soll = Beitrag.sollJeKonto(id, d, jahr, { konfig: k });
      var m = mandatKurz(kt, d, k, h);
      return {
        konto_id: id, jahr: jahr, soll: soll, zusammensetzung: Beitrag.zusammensetzung(soll),
        mandat: m, adresse: Beitrag.zahleradresse(kt, d),
        pruefung: Beitrag.pruefeKonto(id, d, jahr, h, { konfig: k }),
        mandatsvorschlag: mandatsvorschlag(d, kt.kontoinhaber_mitglied_id, h)
      };
    });
  }

  /** Klartext-IBAN eines Kontos (gezielt gelesen, protokolliert). */
  function ibanAufdecken(ktx, id) {
    var kt = (DB.lese(['Beitragskonto']).Beitragskonto || []).filter(function (z) { return String(z.beitragskonto_id) === String(id); })[0];
    if (!kt) throw Fehler.fachlich('Das Konto wurde nicht gefunden.');
    DB.mitSperre(function () {
      Protokoll.schreibe(ktx, [{ aktion: 'eingesehen', tabelle: 'Beitragskonto', datensatz_id: id, feld: 'iban', kommentar: 'IBAN im Klartext angezeigt' }]);
    });
    return { konto_id: id, iban: kt.iban ? Iban.formatiere(kt.iban) : null, bic: kt.bic || null };
  }

  /** Vorschlag TSV-<Jahr>-<Mitgliedsnr>, eindeutig gegen vorhandene Referenzen. */
  function mandatsvorschlag(d, inhaberId, h) {
    var m = inhaberId ? nachId(d.Mitglied, 'mitglied_id')[inhaberId] : null;
    var basisText = 'TSV-' + String(h).slice(0, 4) + '-' + (m && m.mitgliedsnummer ? m.mitgliedsnummer : 'E' + Date.now().toString().slice(-6));
    var vorhanden = {};
    (d.Beitragskonto || []).forEach(function (z) { if (z.mandatsreferenz) vorhanden[z.mandatsreferenz] = true; });
    if (!vorhanden[basisText]) return basisText;
    for (var i = 2; i < 100; i++) if (!vorhanden[basisText + '-' + i]) return basisText + '-' + i;
    return basisText + '-' + Date.now();
  }

  // ================================================================== Konto anlegen / bearbeiten

  var KONTO_FELDER = ['kontoinhaber_name', 'kontoinhaber_mitglied_id', 'zahlweg', 'iban', 'bic', 'mandatsreferenz', 'mandatsdatum',
    'abw_strasse', 'abw_hausnummer', 'abw_plz', 'abw_ort', 'abw_land', 'aktiv', 'bemerkung'];

  /** Prüft und normalisiert Kontoangaben. Wirft Feldfehler. */
  function kontoPruefen(werte, bestehend, alleKonten) {
    var w = {};
    KONTO_FELDER.forEach(function (f) { if (Object.prototype.hasOwnProperty.call(werte, f)) w[f] = werte[f] === '' ? null : werte[f]; });
    if (w.kontoinhaber_mitglied_id !== undefined && w.kontoinhaber_mitglied_id !== null) w.kontoinhaber_mitglied_id = Number(w.kontoinhaber_mitglied_id);
    if (w.iban) w.iban = Iban.normalisiere(w.iban);
    if (w.bic) w.bic = String(w.bic).replace(/\s+/g, '').toUpperCase();
    ['abw_land'].forEach(function (f) { if (w[f]) w[f] = String(w[f]).toUpperCase(); });
    var ziel = {};
    Object.keys(bestehend || {}).forEach(function (f) { ziel[f] = bestehend[f]; });
    Object.keys(w).forEach(function (f) { ziel[f] = w[f]; });
    var fehler = [];
    if (!ziel.kontoinhaber_name) fehler.push({ feld: 'kontoinhaber_name', meldung: 'Kontoinhaber: Angabe fehlt.' });
    if (!ziel.zahlweg) fehler.push({ feld: 'zahlweg', meldung: 'Zahlweg: Angabe fehlt.' });
    if (ziel.iban) {
      var pr = Iban.pruefe(ziel.iban);
      if (!pr.ok) fehler.push({ feld: 'iban', meldung: Iban.fehlertext(pr.fehler) });
      else if (Object.prototype.hasOwnProperty.call(w, 'iban')) w.iban = pr.iban;
    }
    if (ziel.bic) {
      var bic = Iban.pruefeBic(ziel.bic);
      if (!bic.ok) fehler.push({ feld: 'bic', meldung: 'Der BIC ist ungültig.' });
      else if (Object.prototype.hasOwnProperty.call(w, 'bic')) w.bic = bic.bic;
    }
    if (ziel.zahlweg === 'Lastschrift') {
      if (!ziel.iban) fehler.push({ feld: 'iban', meldung: 'Bei Lastschrift ist die IBAN Pflicht.' });
      if (!ziel.mandatsreferenz) fehler.push({ feld: 'mandatsreferenz', meldung: 'Bei Lastschrift ist die Mandatsreferenz Pflicht.' });
      if (!ziel.mandatsdatum) fehler.push({ feld: 'mandatsdatum', meldung: 'Bei Lastschrift ist das Mandatsdatum (Unterschrift) Pflicht.' });
      else if (ziel.mandatsdatum > heute()) fehler.push({ feld: 'mandatsdatum', meldung: 'Das Mandatsdatum liegt in der Zukunft.' });
      if (ziel.mandatsreferenz && !/^[A-Za-z0-9+?\/\-:().,' ]{1,35}$/.test(ziel.mandatsreferenz)) {
        fehler.push({ feld: 'mandatsreferenz', meldung: 'Mandatsreferenz: höchstens 35 Zeichen, nur Buchstaben, Ziffern und - / ? : ( ) . , \' +' });
      }
    }
    if (ziel.mandatsreferenz) {
      var doppelt = (alleKonten || []).some(function (k) {
        return k.mandatsreferenz === ziel.mandatsreferenz && (!bestehend || k.beitragskonto_id !== bestehend.beitragskonto_id);
      });
      if (doppelt) fehler.push({ feld: 'mandatsreferenz', meldung: 'Diese Mandatsreferenz ist bereits vergeben – sie darf nie wiederverwendet werden.' });
    }
    var typ = Werte.pruefe('Beitragskonto', w, { teilweise: true });
    typ.forEach(function (f) { if (!fehler.some(function (x) { return x.feld === f.feld; })) fehler.push(f); });
    if (fehler.length) throw Fehler.fachlich('Bitte Eingaben prüfen.', fehler);
    return w;
  }

  function kontoSpeichern(ktx, id, version, werte) {
    werte = werte || {};
    return DB.mitSperre(function () {
      var konten = DB.lese(['Beitragskonto']).Beitragskonto;   // mit Klartext – nur hier, nur zum Prüfen/Schreiben
      var hinweise = [];
      if (id === null || id === undefined || id === '') {
        var w = kontoPruefen(werte, null, konten);
        if (w.aktiv === undefined || w.aktiv === null) w.aktiv = true;
        var neu = DB.einfuegen('Beitragskonto', w, ktx);
        var prot = [{ aktion: 'angelegt', tabelle: 'Beitragskonto', datensatz_id: neu.beitragskonto_id, kommentar: neu.kontoinhaber_name + ' · ' + neu.zahlweg }];
        if (neu.iban) prot.push({ aktion: 'geändert', tabelle: 'Beitragskonto', datensatz_id: neu.beitragskonto_id, feld: 'iban', alt_wert: '', neu_wert: neu.iban });
        if (neu.mandatsreferenz) prot.push({ aktion: 'geändert', tabelle: 'Beitragskonto', datensatz_id: neu.beitragskonto_id, feld: 'mandatsreferenz', alt_wert: '', neu_wert: neu.mandatsreferenz });
        Protokoll.schreibe(ktx, prot);
        var a = Snapshot.schreibe(ktx, [{ tab: 'Beitragskonto', neu: neu }]);
        a.konto_id = neu.beitragskonto_id;
        if (neu.zahlweg === 'Lastschrift') hinweise.push('Neues Mandat: Der erste Einzug läuft als Erstlastschrift (FRST).');
        a.hinweise = hinweise;
        return a;
      }
      var alt = nachId(konten, 'beitragskonto_id')[id];
      if (!alt) throw Fehler.fachlich('Das Konto wurde nicht gefunden. Bitte die Ansicht neu laden.');
      var w2 = kontoPruefen(werte, alt, konten);
      if (w2.iban !== undefined && Iban.normalisiere(w2.iban || '') === Iban.normalisiere(alt.iban || '')) delete w2.iban;
      if (w2.aktiv === false) pruefeStilllegen(id);
      var r = DB.aktualisieren('Beitragskonto', id, w2, version, ktx);
      Protokoll.schreibe(ktx, Protokoll.ausDiff('Beitragskonto', id, r.diff));
      var felder = r.diff.map(function (x) { return x.feld; });
      if (felder.indexOf('kontoinhaber_name') >= 0 || felder.indexOf('kontoinhaber_mitglied_id') >= 0) {
        hinweise.push('Neuer Kontoinhaber: Dafür ist ein neues, unterschriebenes Mandat nötig (neue Mandatsreferenz und -datum, erster Einzug als FRST).');
      } else if (felder.indexOf('iban') >= 0) {
        hinweise.push('IBAN geändert: Bei gleichem Kontoinhaber gilt das Mandat weiter (Mandatsänderung wird beim nächsten Einzug wirksam).');
      }
      var antwort = Snapshot.schreibe(ktx, [{ tab: 'Beitragskonto', neu: r.neu }]);
      antwort.hinweise = hinweise;
      antwort.konto_id = id;
      return antwort;
    });
  }

  function aktivePersonenAufKonto(kontoId) {
    var b = basis(), h = heute();
    var zr = {};
    b.tabs.Mitgliedschaftszeitraum.forEach(function (z) { (zr[z.mitglied_id] = zr[z.mitglied_id] || []).push(z); });
    return b.tabs.Mitglied.filter(function (m) {
      return m.beitragskonto_id === kontoId && Mitgliedschaft.status(m, zr[m.mitglied_id] || [], h) === 'aktiv';
    });
  }

  function pruefeStilllegen(kontoId) {
    var aktive = aktivePersonenAufKonto(Number(kontoId));
    if (aktive.length) {
      throw Fehler.fachlich('Das Konto kann nicht stillgelegt werden: ' + aktive.length + ' aktive Person(en) zahlen darüber (' +
        aktive.slice(0, 3).map(name).join('; ') + (aktive.length > 3 ? ' …' : '') + '). Bitte zuerst neu zuordnen.');
    }
  }

  function kontoStilllegen(ktx, id, version) {
    return kontoSpeichern(ktx, id, version, { aktiv: false });
  }

  // ================================================================== Personen zuordnen, Gemeinschaften

  function mitgliedLesen(id) {
    var m = nachId(basis().tabs.Mitglied, 'mitglied_id')[id];
    if (!m) throw Fehler.fachlich('Die Person wurde nicht gefunden. Bitte die Ansicht neu laden.');
    return m;
  }

  /**
   * Hängt eine Person an ein anderes Konto. Gehört sie zu einer Gemeinschaft, muss die ganze Gemeinschaft mit
   * (Konsistenzregel); mitGemeinschaft = true hängt alle aktiven Mitglieder der Gemeinschaft um.
   */
  function personZuordnen(ktx, mitgliedId, version, kontoId, mitGemeinschaft) {
    return DB.mitSperre(function () {
      Snapshot.pruefeMitglied(ktx, mitgliedId);
      var b = basis();
      var m = mitgliedLesen(mitgliedId);
      var kt = nachId(b.tabs.Beitragskonto, 'beitragskonto_id')[kontoId];
      if (!kt) throw Fehler.fachlich('Das Zielkonto wurde nicht gefunden.');
      if (kt.aktiv === false) throw Fehler.fachlich('Das Zielkonto ist stillgelegt.');
      var aenderungen = {}, versionen = {};
      aenderungen[mitgliedId] = { beitragskonto_id: kontoId };
      versionen[mitgliedId] = version;
      if (m.beitragsgemeinschaft_id) {
        var andere = b.tabs.Mitglied.filter(function (x) {
          return x.beitragsgemeinschaft_id === m.beitragsgemeinschaft_id && x.mitglied_id !== mitgliedId && x.beitragskonto_id !== kontoId && x.anonymisiert !== true;
        });
        if (andere.length && !mitGemeinschaft) {
          throw Fehler.fachlich('Die Person gehört zu einer Beitragsgemeinschaft. Alle Mitglieder einer Gemeinschaft müssen dasselbe Konto haben – bitte „ganze Gemeinschaft umhängen“ wählen oder die Person zuerst aus der Gemeinschaft nehmen.');
        }
        andere.forEach(function (x) { aenderungen[x.mitglied_id] = { beitragskonto_id: kontoId }; });
      }
      var erg = massenAktualisieren('Mitglied', aenderungen, ktx, versionen);
      var prot = [];
      erg.forEach(function (e) { prot = prot.concat(Protokoll.ausDiff('Mitglied', e.neu.mitglied_id, e.diff)); });
      Protokoll.schreibe(ktx, prot);
      return Snapshot.schreibe(ktx, erg.map(function (e) { return { tab: 'Mitglied', neu: e.neu }; }));
    });
  }

  function gemeinschaftSpeichern(ktx, id, version, werte) {
    werte = werte || {};
    var w = {};
    ['bezeichnung', 'festbetrag', 'aktiv', 'bemerkung'].forEach(function (f) { if (Object.prototype.hasOwnProperty.call(werte, f)) w[f] = werte[f]; });
    var fehler = [];
    if ((id === null || id === undefined || id === '' || w.bezeichnung !== undefined) && !w.bezeichnung) fehler.push({ feld: 'bezeichnung', meldung: 'Bezeichnung: Angabe fehlt.' });
    if (w.festbetrag !== undefined && w.festbetrag !== null && !(Number(w.festbetrag) >= 0)) fehler.push({ feld: 'festbetrag', meldung: 'Festbetrag: bitte einen Betrag ≥ 0 angeben.' });
    Werte.pruefe('Beitragsgemeinschaft', w, { teilweise: true }).forEach(function (f) { if (!fehler.some(function (x) { return x.feld === f.feld; })) fehler.push(f); });
    if (fehler.length) throw Fehler.fachlich('Bitte Eingaben prüfen.', fehler);
    return DB.mitSperre(function () {
      if (id === null || id === undefined || id === '') {
        if (w.aktiv === undefined || w.aktiv === null) w.aktiv = true;
        var neu = DB.einfuegen('Beitragsgemeinschaft', w, ktx);
        Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Beitragsgemeinschaft', datensatz_id: neu.beitragsgemeinschaft_id, kommentar: neu.bezeichnung + (neu.festbetrag !== null && neu.festbetrag !== undefined ? ' · ' + euro(neu.festbetrag) : '') }]);
        var a = Snapshot.schreibe(ktx, [{ tab: 'Beitragsgemeinschaft', neu: neu }]);
        a.gemeinschaft_id = neu.beitragsgemeinschaft_id;
        return a;
      }
      var r = DB.aktualisieren('Beitragsgemeinschaft', id, w, version, ktx);
      Protokoll.schreibe(ktx, Protokoll.ausDiff('Beitragsgemeinschaft', id, r.diff));
      return Snapshot.schreibe(ktx, [{ tab: 'Beitragsgemeinschaft', neu: r.neu }]);
    });
  }

  /**
   * Person in eine Gemeinschaft aufnehmen ('hinzu') oder herausnehmen ('entfernen').
   * Aufnehmen hängt die Person an das Konto der Gemeinschaft (Konsistenzregel).
   */
  function gemeinschaftMitglied(ktx, gemeinschaftId, mitgliedId, version, aktion) {
    return DB.mitSperre(function () {
      Snapshot.pruefeMitglied(ktx, mitgliedId);
      var b = basis();
      var g = nachId(b.tabs.Beitragsgemeinschaft, 'beitragsgemeinschaft_id')[gemeinschaftId];
      if (!g) throw Fehler.fachlich('Die Gemeinschaft wurde nicht gefunden.');
      var m = mitgliedLesen(mitgliedId);
      var hinweise = [];
      var aend = {};
      if (aktion === 'hinzu') {
        if (g.aktiv === false) throw Fehler.fachlich('Die Gemeinschaft ist aufgelöst.');
        if (m.beitragsgemeinschaft_id && m.beitragsgemeinschaft_id !== gemeinschaftId) throw Fehler.fachlich('Die Person gehört bereits zu einer anderen Gemeinschaft. Bitte dort zuerst herausnehmen.');
        var mitglieder = b.tabs.Mitglied.filter(function (x) { return x.beitragsgemeinschaft_id === gemeinschaftId && x.mitglied_id !== mitgliedId; });
        var konto = mitglieder.length ? mitglieder[0].beitragskonto_id : m.beitragskonto_id;
        aend.beitragsgemeinschaft_id = gemeinschaftId;
        if (konto && konto !== m.beitragskonto_id) { aend.beitragskonto_id = konto; hinweise.push('Die Person zahlt jetzt über das Konto der Gemeinschaft (Konto ' + konto + ').'); }
        if (g.festbetrag !== null && g.festbetrag !== undefined && m.beitragsart_id) hinweise.push('Die Beitragsart bleibt hinterlegt, wird aber durch den Festbetrag der Gemeinschaft ersetzt.');
      } else if (aktion === 'entfernen') {
        if (m.beitragsgemeinschaft_id !== gemeinschaftId) throw Fehler.fachlich('Die Person gehört nicht zu dieser Gemeinschaft.');
        aend.beitragsgemeinschaft_id = null;
        if (!m.beitragsart_id) hinweise.push('Die Person hat keine eigene Beitragsart – bitte eine Beitragsart zuweisen (sonst Klärliste „ohne Beitrag“).');
      } else {
        throw Fehler.fachlich('Unbekannte Aktion.');
      }
      var r = DB.aktualisieren('Mitglied', mitgliedId, aend, version, ktx);
      Protokoll.schreibe(ktx, Protokoll.ausDiff('Mitglied', mitgliedId, r.diff));
      var a = Snapshot.schreibe(ktx, [{ tab: 'Mitglied', neu: r.neu }]);
      a.hinweise = hinweise;
      return a;
    });
  }

  /** Gemeinschaft auflösen: aktiv = nein, alle Mitglieder herausnehmen (mit Hinweis auf fehlende Beitragsarten). */
  function gemeinschaftAufloesen(ktx, id, version) {
    return DB.mitSperre(function () {
      var b = basis();
      var r = DB.aktualisieren('Beitragsgemeinschaft', id, { aktiv: false }, version, ktx);
      var aend = {};
      var ohneArt = 0;
      b.tabs.Mitglied.forEach(function (m) {
        if (m.beitragsgemeinschaft_id === id) { aend[m.mitglied_id] = { beitragsgemeinschaft_id: null }; if (!m.beitragsart_id) ohneArt++; }
      });
      var erg = massenAktualisieren('Mitglied', aend, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'beendet', tabelle: 'Beitragsgemeinschaft', datensatz_id: id, kommentar: 'aufgelöst, ' + erg.length + ' Person(en) herausgenommen' }]);
      var a = Snapshot.schreibe(ktx, [{ tab: 'Beitragsgemeinschaft', neu: r.neu }].concat(erg.map(function (e) { return { tab: 'Mitglied', neu: e.neu }; })));
      a.hinweise = ohneArt ? [ohneArt + ' Person(en) ohne eigene Beitragsart – bitte zuweisen (Klärliste).'] : [];
      return a;
    });
  }

  // ================================================================== Sollstellungen

  function sollstellungPlanen(ktx, jahr) {
    var x = daten();
    jahr = jahrPruefen(jahr, x.konfig);
    var p = Sollstellungslauf.plane(x.daten, jahr, heute(), x.konfig);
    var konten = nachId(x.daten.Beitragskonto, 'beitragskonto_id');
    return {
      jahr: jahr, anzahl: p.neu.length, summe: p.summe, einzugsdatum: p.einzugsdatum, vorhanden: p.vorhanden.length,
      uebersprungen: p.uebersprungen,
      neu: p.neu.map(function (s) {
        var k = konten[s.beitragskonto_id] || {};
        return { konto_id: s.beitragskonto_id, name: k.kontoinhaber_name, zahlweg: k.zahlweg, betrag: s.soll_betrag, zusammensetzung: s.bemerkung };
      })
    };
  }

  /** Jahreslauf anlegen: unter Sperre frisch geplant (keine Doppelten), alle Zeilen mit einem Schreibzugriff. */
  function sollstellungAnlegen(ktx, jahr, erwarteteAnzahl) {
    return DB.mitSperre(function () {
      var frisch = DB.lese(['Sollstellung']).Sollstellung;
      var x = daten();
      x.daten.Sollstellung = frisch;
      jahr = jahrPruefen(jahr, x.konfig);
      var p = Sollstellungslauf.plane(x.daten, jahr, heute(), x.konfig);
      if (!p.neu.length) throw Fehler.fachlich('Für ' + jahr + ' gibt es keine neuen Sollstellungen anzulegen.');
      if (erwarteteAnzahl !== undefined && erwarteteAnzahl !== null && Number(erwarteteAnzahl) !== p.neu.length) {
        throw Fehler.fachlich('Seit dem Probelauf hat sich der Bestand geändert (' + p.neu.length + ' statt ' + erwarteteAnzahl + ' Konten). Bitte den Probelauf neu ausführen.');
      }
      var neu = massenEinfuegen('Sollstellung', p.neu, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Sollstellung', datensatz_id: 'Jahr ' + jahr,
        kommentar: 'Sollstellungslauf ' + jahr + ': ' + neu.length + ' Konten, Summe ' + euro(p.summe) + ', Einzug ' + p.einzugsdatum }]);
      var a = Snapshot.schreibe(ktx, neu.map(function (s) { return { tab: 'Sollstellung', neu: s }; }));
      a.anzahl = neu.length; a.summe = p.summe;
      return a;
    });
  }

  var EREIGNISSE = ['bezahlt', 'ruecklastschrift', 'gemahnt', 'widerspruch', 'storniert'];

  function sollstellungStatus(ktx, id, version, ereignis) {
    ereignis = ereignis || {};
    if (EREIGNISSE.indexOf(ereignis.art) < 0) throw Fehler.fachlich('Unbekannter Zahlungsstatus.');
    var e = {
      art: ereignis.art,
      datum: datumPruefen(ereignis.datum, 'datum', 'Datum'),
      grund: ereignis.grund ? String(ereignis.grund).slice(0, 200) : null,
      betrag: ereignis.betrag === null || ereignis.betrag === undefined || ereignis.betrag === '' ? undefined : Number(ereignis.betrag),
      gebuehr: ereignis.gebuehr === null || ereignis.gebuehr === undefined || ereignis.gebuehr === '' ? undefined : Number(ereignis.gebuehr)
    };
    if (e.betrag !== undefined && !(e.betrag >= 0)) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'betrag', meldung: 'Betrag: bitte eine Zahl ≥ 0 angeben.' }]);
    if (e.gebuehr !== undefined && !(e.gebuehr >= 0)) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'gebuehr', meldung: 'Gebühr: bitte eine Zahl ≥ 0 angeben.' }]);
    if ((e.art === 'ruecklastschrift' || e.art === 'storniert') && !e.grund) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'grund', meldung: 'Bitte einen Grund angeben.' }]);
    return DB.mitSperre(function () {
      var alt = (DB.lese(['Sollstellung']).Sollstellung || []).filter(function (s) { return String(s.sollstellung_id) === String(id); })[0];
      if (!alt) throw Fehler.fachlich('Die Sollstellung wurde nicht gefunden. Bitte die Ansicht neu laden.');
      if (Number(alt.version || 0) !== Number(version)) throw Fehler.konflikt(alt);
      var aend = Sollstellungslauf.naechsterStatus(alt, e, Konfig.alle());
      var r = DB.aktualisieren('Sollstellung', id, aend, version, ktx);
      Protokoll.schreibe(ktx, Protokoll.ausDiff('Sollstellung', id, r.diff));
      return Snapshot.schreibe(ktx, [{ tab: 'Sollstellung', neu: r.neu }]);
    });
  }

  /**
   * Sammelbuchung nach dem Einzug: alle angegebenen (bzw. alle offenen eingezogenen) Sollstellungen des Jahres als
   * bezahlt buchen. Nur Sollstellungen im Status „offen“ mit SEPA-Sequenz (= in einer Lastschriftdatei enthalten).
   */
  function sammelBezahlt(ktx, jahr, ids, datum) {
    datum = datumPruefen(datum, 'datum', 'Buchungsdatum') || heute();
    return DB.mitSperre(function () {
      var alle = DB.lese(['Sollstellung']).Sollstellung || [];
      var kandidaten = alle.filter(function (s) {
        return s.jahr === Number(jahr) && s.status === 'offen' && s.sepa_sequenz && (!ids || !ids.length || ids.indexOf(s.sollstellung_id) >= 0);
      });
      if (!kandidaten.length) throw Fehler.fachlich('Es gibt keine offenen eingezogenen Sollstellungen für ' + jahr + '.');
      var aend = {};
      var summe = 0;
      kandidaten.forEach(function (s) {
        aend[s.sollstellung_id] = Sollstellungslauf.naechsterStatus(s, { art: 'bezahlt', datum: datum });
        summe += Number(s.soll_betrag || 0);
      });
      var erg = massenAktualisieren('Sollstellung', aend, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: 'Sollstellung', datensatz_id: 'Jahr ' + jahr, feld: 'status',
        neu_wert: 'bezahlt', kommentar: 'Sammelbuchung: ' + erg.length + ' Sollstellungen als bezahlt (' + euro(summe) + '), Buchungsdatum ' + datum }]);
      var a = Snapshot.schreibe(ktx, erg.map(function (e) { return { tab: 'Sollstellung', neu: e.neu }; }));
      a.anzahl = erg.length; a.summe = Beitrag.runde(summe);
      return a;
    });
  }

  // ================================================================== SEPA

  function glaeubiger(k) {
    return {
      name: konfigWert(k, 'verein_name'),
      glaeubigerId: konfigWert(k, 'verein_glaeubiger_id'),
      iban: konfigWert(k, 'verein_iban'),
      bic: konfigWert(k, 'verein_bic') || null,
      adresse: konfigWert(k, 'verein_strasse') ? {
        strasse: konfigWert(k, 'verein_strasse'), hausnummer: konfigWert(k, 'verein_hausnummer') || null,
        plz: konfigWert(k, 'verein_plz'), ort: konfigWert(k, 'verein_ort'), land: konfigWert(k, 'verein_land') || 'DE'
      } : null
    };
  }

  /** Vier-Augen-Freigabe aus dem Protokoll: { freigegeben, von, am } für das Jahr. */
  function freigabe(jahr) {
    var prot = DB.lese(['_Protokoll'])._Protokoll || [];
    var letzte = null;
    prot.forEach(function (p) {
      if (p.tabelle === 'SEPA-Freigabe' && String(p.datensatz_id) === String(jahr)) letzte = p;
    });
    return letzte ? { freigegeben: true, von: letzte.benutzer_email, am: letzte.zeitpunkt } : { freigegeben: false };
  }

  function sepaOptionen(k, einzugsdatum) {
    return { heute: heute(), konfig: k, einzugsdatum: einzugsdatum || undefined };
  }

  /** Probelauf ohne Klartext-IBAN: Posten (maskiert), Ausschlüsse, Summen je Sequenz, Hinweise. */
  function sepaProbelauf(ktx, jahr, einzugsdatum) {
    einzugsdatum = datumPruefen(einzugsdatum, 'einzugsdatum', 'Einzugsdatum');
    var x = daten();
    jahr = jahrPruefen(jahr, x.konfig);
    // IBANs für die Prüfung gezielt lesen; sie verlassen den Server nur maskiert
    var mitIban = DB.lese(['Beitragskonto']).Beitragskonto;
    x.daten.Beitragskonto = mitIban;
    var l = Sepa.lauf(x.daten, jahr, sepaOptionen(x.konfig, einzugsdatum));
    var jeSeq = {};
    l.posten.forEach(function (p) {
      var s = jeSeq[p.sequenz] = jeSeq[p.sequenz] || { anzahl: 0, summe: 0 };
      s.anzahl++; s.summe = Beitrag.runde(s.summe + p.betrag);
    });
    var warnungen = [];
    var ohneAdresse = l.posten.filter(function (p) { return !(p.adresse && p.adresse.strasse && p.adresse.plz && p.adresse.ort); }).length;
    if (ohneAdresse) warnungen.push(ohneAdresse + ' Zahler ohne vollständige Anschrift – die Adresse wird in der Datei weggelassen (mit der Hausbank klären, ob das zulässig ist).');
    var g = glaeubiger(x.konfig);
    var pruef = Sepa.pruefeFuerDatei(l.posten.length ? l : { posten: [{ betrag: 1, einzugsdatum: '2000-01-01', mandatsreferenz: 'X', konto: 0 }] }, g)
      .filter(function (t) { return !/^Konto /.test(t); });
    var vierAugen = konfigWert(x.konfig, 'sepa_vier_augen') === 'ja';
    return {
      jahr: jahr, anzahl: l.anzahl, summe: l.summe, je_sequenz: jeSeq,
      posten: Sepa.kontrollliste(l), ausgeschlossen: l.ausgeschlossen,
      warnungen: warnungen, glaeubiger_fehler: pruef,
      vier_augen: vierAugen, freigabe: vierAugen ? freigabe(jahr) : null
    };
  }

  function sepaFreigeben(ktx, jahr) {
    var k = Konfig.alle();
    jahr = jahrPruefen(jahr, k);
    return DB.mitSperre(function () {
      Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: 'SEPA-Freigabe', datensatz_id: jahr, kommentar: 'Probelauf ' + jahr + ' geprüft und freigegeben' }]);
      return { freigegeben: true, von: ktx.email };
    });
  }

  /**
   * SEPA-Datei erzeugen: Lauf mit Klartext-IBAN, XML pain.008.001.08, in den Sollstellungen sepa_sequenz und
   * einzugsdatum vermerken (eine Sperre), Protokoll „exportiert“ (ohne IBANs). Liefert { dateiname, xml, … }.
   */
  function sepaXml(ktx, jahr, einzugsdatum) {
    einzugsdatum = datumPruefen(einzugsdatum, 'einzugsdatum', 'Einzugsdatum');
    if (einzugsdatum && einzugsdatum < heute()) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'einzugsdatum', meldung: 'Das Einzugsdatum liegt in der Vergangenheit.' }]);
    return DB.mitSperre(function () {
      var x = daten();
      jahr = jahrPruefen(jahr, x.konfig);
      if (konfigWert(x.konfig, 'sepa_vier_augen') === 'ja') {
        var f = freigabe(jahr);
        if (!f.freigegeben) throw Fehler.fachlich('Vier-Augen-Prinzip: Der Probelauf ' + jahr + ' muss zuerst von einer zweiten Person freigegeben werden.');
        if (String(f.von).toLowerCase() === String(ktx.email).toLowerCase()) throw Fehler.fachlich('Vier-Augen-Prinzip: Die Freigabe muss von einer ANDEREN Person stammen als der, die die Datei erzeugt.');
      }
      var frisch = DB.lese(['Beitragskonto', 'Sollstellung']);
      x.daten.Beitragskonto = frisch.Beitragskonto;
      x.daten.Sollstellung = frisch.Sollstellung;
      var l = Sepa.lauf(x.daten, jahr, sepaOptionen(x.konfig, einzugsdatum));
      if (!l.posten.length) throw Fehler.fachlich('Der Lauf enthält keine Posten – es gibt keine offenen, einziehbaren Sollstellungen für ' + jahr + '.');
      var datei = Sepa.xml(l, glaeubiger(x.konfig), { erstelltAm: DB.jetzt() });
      if (!datei.ok) throw Fehler.fachlich('Die SEPA-Datei kann noch nicht erzeugt werden: ' + datei.fehler.join(' '));
      var aend = {};
      l.posten.forEach(function (p) { aend[p.sollstellung_id] = { sepa_sequenz: p.sequenz, einzugsdatum: p.einzugsdatum }; });
      var erg = massenAktualisieren('Sollstellung', aend, ktx);
      Protokoll.schreibe(ktx, [{ aktion: 'exportiert', tabelle: 'Sollstellung', datensatz_id: 'Jahr ' + jahr,
        kommentar: 'SEPA-Datei ' + datei.dateiname + ' (' + datei.msgId + '): ' + datei.anzahl + ' Lastschriften, ' + euro(datei.summe) }]);
      var a = Snapshot.schreibe(ktx, erg.map(function (e) { return { tab: 'Sollstellung', neu: e.neu }; }));
      a.dateiname = datei.dateiname; a.xml = datei.xml; a.anzahl = datei.anzahl; a.summe = datei.summe; a.msgId = datei.msgId;
      return a;
    });
  }

  // ================================================================== Klärliste, Tarifwechsel, Export

  function klaerliste(ktx, jahr) {
    var x = daten();
    jahr = jahrPruefen(jahr, x.konfig);
    var mitglieder = nachId(x.daten.Mitglied, 'mitglied_id');
    return Beitrag.klaerliste(x.daten, jahr, heute(), { konfig: x.konfig }).map(function (e) {
      e.mitglied_name = e.mitglied_id && mitglieder[e.mitglied_id] ? name(mitglieder[e.mitglied_id]) : null;
      return e;
    });
  }

  function tarifwechsel(ktx, jahr) {
    var x = daten();
    jahr = jahrPruefen(jahr, x.konfig);
    return Beitrag.tarifwechsel(x.daten, jahr, { konfig: x.konfig });
  }

  function tarifwechselUebernehmen(ktx, jahr, mitgliedIds) {
    if (!Array.isArray(mitgliedIds) || !mitgliedIds.length) throw Fehler.fachlich('Bitte mindestens einen Vorschlag auswählen.');
    return DB.mitSperre(function () {
      var vorschlaege = tarifwechsel(ktx, jahr);
      var aend = {};
      vorschlaege.forEach(function (v) {
        if (v.nach && mitgliedIds.indexOf(v.mitglied_id) >= 0) aend[v.mitglied_id] = { beitragsart_id: v.nach };
      });
      if (!Object.keys(aend).length) throw Fehler.fachlich('Keiner der ausgewählten Vorschläge ist (noch) übernehmbar. Bitte die Liste neu laden.');
      Object.keys(aend).forEach(function (id) { Snapshot.pruefeMitglied(ktx, Number(id)); });
      var erg = massenAktualisieren('Mitglied', aend, ktx);
      var prot = [];
      erg.forEach(function (e) { prot = prot.concat(Protokoll.ausDiff('Mitglied', e.neu.mitglied_id, e.diff).map(function (p) { p.kommentar = 'Tarifwechsel ' + jahr; return p; })); });
      Protokoll.schreibe(ktx, prot);
      var a = Snapshot.schreibe(ktx, erg.map(function (e) { return { tab: 'Mitglied', neu: e.neu }; }));
      a.anzahl = erg.length;
      return a;
    });
  }

  /** Buchhaltungs-Export eines Jahres (ohne IBAN), protokolliert. */
  function buchhaltung(ktx, jahr) {
    var x = daten();
    jahr = jahrPruefen(jahr, x.konfig);
    var konten = nachId(x.daten.Beitragskonto, 'beitragskonto_id');
    var zeilen = (DB.lese(['Sollstellung']).Sollstellung || []).filter(function (s) { return s.jahr === jahr; })
      .sort(function (a, b) { return a.beitragskonto_id - b.beitragskonto_id; }).map(function (s) {
        var k = konten[s.beitragskonto_id] || {};
        return {
          sollstellung_id: s.sollstellung_id, konto: s.beitragskonto_id, inhaber: k.kontoinhaber_name || '', zahlweg: k.zahlweg || '',
          mandatsreferenz: k.mandatsreferenz || '', soll: s.soll_betrag, ist: s.ist_betrag, gebuehr: s.gebuehr, status: s.status,
          sequenz: s.sepa_sequenz || '', einzugsdatum: s.einzugsdatum || '', buchungsdatum: s.buchungsdatum || '', mahnstufe: s.mahnstufe || 0,
          grund: s.ruecklastschrift_grund || ''
        };
      });
    exportVermerken(ktx, 'Buchhaltungsexport ' + jahr, zeilen.length);
    return { jahr: jahr, zeilen: zeilen };
  }

  /** Exporte, die der Browser aus seinen Daten erzeugt (Mahnliste, Kontenliste), werden hier protokolliert. */
  function exportVermerken(ktx, liste, anzahl) {
    DB.mitSperre(function () {
      Protokoll.schreibe(ktx, [{ aktion: 'exportiert', tabelle: 'Finanzen', datensatz_id: '-', kommentar: String(liste).slice(0, 100) + ': ' + Number(anzahl || 0) + ' Zeilen' }]);
    });
    return true;
  }

  return {
    uebersicht: uebersicht, konto: konto, ibanAufdecken: ibanAufdecken,
    kontoSpeichern: kontoSpeichern, kontoStilllegen: kontoStilllegen, personZuordnen: personZuordnen,
    gemeinschaftSpeichern: gemeinschaftSpeichern, gemeinschaftMitglied: gemeinschaftMitglied, gemeinschaftAufloesen: gemeinschaftAufloesen,
    sollstellungPlanen: sollstellungPlanen, sollstellungAnlegen: sollstellungAnlegen, sollstellungStatus: sollstellungStatus,
    sammelBezahlt: sammelBezahlt,
    sepaProbelauf: sepaProbelauf, sepaFreigeben: sepaFreigeben, sepaXml: sepaXml,
    klaerliste: klaerliste, tarifwechsel: tarifwechsel, tarifwechselUebernehmen: tarifwechselUebernehmen,
    buchhaltung: buchhaltung, exportVermerken: exportVermerken,
    // für Tests
    massenEinfuegen: massenEinfuegen, massenAktualisieren: massenAktualisieren
  };
})();
