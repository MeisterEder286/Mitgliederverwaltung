/**
 * Migration – Altbestand (Access-Tabelle Daten16) → neues Datenmodell. Reine Funktion, keine Apps-Script-Dienste.
 *
 * Zweck:      Einmalige Übernahme. Aus jeder Daten16-Zeile entstehen Mitglied, Mitgliedschaftszeitraum(e),
 *             Abteilungszugehörigkeiten; aus dem Feld „Zahler“ (= MitglNr des Zahlers) entstehen Beitragskonten und
 *             – nach der Heuristik aus dem Übergabe-Dokument §6 – Beitragsgemeinschaften; „Zahlung = NG“ wird zur
 *             Sollstellung mit Status ruecklastschrift. Alles, was nicht eindeutig ist, landet in der PRÜFLISTE –
 *             es wird nicht geraten.
 * Datenquelle: Zeilen als Objekte (Kopfzeile des CSV-Exports als Schlüssel). Aufruf lokal über
 *             tools/migration-lokal.js – die Echtdaten verlassen den Rechner nicht.
 * Wer darf was: – (Werkzeug für den Einrichtenden; das Ergebnis wird von Hand ins Sheet übernommen, docs/MIGRATION.md).
 * Besonderheiten:
 *   - SPALTEN (unten) ordnet die Access-Spaltennamen tolerant zu (Groß/Klein, Leerzeichen, Umlaute egal). Weicht ein
 *     Name im echten Export ab, dort einen weiteren Alias eintragen.
 *   - ANNAHMEN, die vor dem Echtlauf bestätigt werden müssen, stehen im Bericht (bericht.annahmen), u. a. das Schema
 *     der Mandatsreferenz (Daten16 hat keine Mandatsspalten) und die Erkennung von Familienpauschalen.
 *   - Ergebnis im Format von DB.lese: Datum 'JJJJ-MM-TT', ja/nein als true/false, leere Werte null.
 *   - Optionale Nutzung von Iban, Beitrag, Mitgliedschaft (falls geladen) – sonst eigene Minimal-Logik.
 */
var Migration = (function () {

  /** Access-Spalte → Liste erlaubter (normalisierter) Namen. Hier anpassen, falls der Export anders heißt. */
  var SPALTEN = {
    id: ['id'],
    mitglnr: ['mitglnr', 'mitgliedsnr', 'mitgliedsnummer', 'mitglnummer'],
    anrede: ['anrede'],
    nachname: ['nachname', 'name'],
    vorname: ['vorname'],
    titel: ['titel', 'tit'],
    strasse: ['strasse', 'str'],
    plz: ['plz', 'postleitzahl'],
    ort: ['ort', 'wohnort'],
    gebdat: ['gebdat', 'geburtsdatum', 'gebdatum'],
    eindat: ['eindat', 'eintritt', 'eintrittsdatum'],
    ausdat: ['ausdat', 'austritt', 'austrittsdatum'],
    telefon: ['telefon', 'tel'],
    handy: ['handy', 'mobil'],
    email: ['email', 'mail'],
    reziff: ['reziff'],
    blz: ['blz'],
    konto: ['konto', 'kontonr', 'kontonummer'],
    bank: ['bank'],
    iban: ['iban'],
    bic: ['bic'],
    kontoinhaber: ['kontoinhaber'],
    gesamtbeitrag: ['gesamtbeitrag', 'gesamtbeit'],
    zahler: ['zahler'],
    bemerkung: ['bemerkung', 'bemerkungen'],
    abt1: ['abteilung1'], status1: ['statusabteilung1', 'status1'], betrag1: ['betrag1'],
    abt2: ['abteilung2'], beitragabt2: ['beitragabt2'], betrag2: ['betrag2'],
    abt3: ['abteilung3'], beitragabt3: ['beitragabt3'], betrag3: ['betrag3'],
    abt4: ['abteilung4'], beitragabt4: ['beitragabt4'], betrag4: ['betrag4'],
    arbeitsdatum: ['arbeitsdatum'],
    geschlecht: ['geschlecht'],
    zahlung: ['zahlung']
  };
  var PFLICHT_SPALTEN = ['id', 'mitglnr', 'nachname', 'eindat'];
  /** Spalten, die gelesen, aber bewusst nicht übernommen werden (Übergabe §6). */
  var VERWORFEN = ['reziff', 'blz', 'konto', 'bank', 'betrag1', 'betrag2', 'betrag3', 'betrag4', 'beitragabt2', 'beitragabt3', 'beitragabt4'];

  /** AustritteAb2010 – Spalten tolerant (Bezug über ID oder MitglNr). */
  var SPALTEN_AUSTRITTE = {
    id: ['id', 'mitgliedid'], mitglnr: ['mitglnr', 'mitgliedsnr', 'mitgliedsnummer'],
    eindat: ['eindat', 'eintritt', 'eintrittsdatum'], ausdat: ['ausdat', 'austritt', 'austrittsdatum'],
    grund: ['grund', 'austrittsgrund']
  };

  var SCHWERE = { fehler: 1, warnung: 2, hinweis: 3 };

  // ================================================================== kleine Helfer

  function falte(s) {
    return String(s === null || s === undefined ? '' : s).toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]/g, '');
  }
  function text(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).replace(/\s+/g, ' ').trim();
    return s === '' ? null : s;
  }
  function pad2(n) { return ('0' + n).slice(-2); }

  /** Spaltenzuordnung: Kopf → { schluessel: tatsächlicher Spaltenname }. */
  function ordneSpalten(kopf, tabelle) {
    var zu = {}, bekannt = {};
    Object.keys(tabelle).forEach(function (k) { tabelle[k].forEach(function (a) { bekannt[a] = k; }); });
    var unbekannt = [];
    (kopf || []).forEach(function (name) {
      var k = bekannt[falte(name)];
      if (k && !zu[k]) zu[k] = name; else if (!k && text(name)) unbekannt.push(name);
    });
    return { zu: zu, unbekannt: unbekannt };
  }

  /**
   * Datum tolerant lesen → 'JJJJ-MM-TT' oder null (ungueltig: { fehler }).
   * TT.MM.JJJJ [hh:mm[:ss]], T.M.JJ, JJJJ-MM-TT, Excel-/Sheets-Seriennummer.
   */
  function datum(wert, jahrHeute) {
    var s = text(wert);
    if (!s) return { wert: null };
    var m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s);
    var j, mo, t, hinweis = null;
    if (m) {
      t = +m[1]; mo = +m[2]; j = +m[3];
      if (m[3].length === 2) {
        var pivot = (jahrHeute || 2026) % 100;
        j = j <= pivot ? 2000 + j : 1900 + j;
        hinweis = 'zweistelliges Jahr als ' + j + ' gelesen';
      }
    } else if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(s))) {
      j = +m[1]; mo = +m[2]; t = +m[3];
    } else if (/^\d{1,6}(?:[.,]\d+)?$/.test(s)) {
      var n = Math.floor(Number(s.replace(',', '.')));
      var d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      j = d.getUTCFullYear(); mo = d.getUTCMonth() + 1; t = d.getUTCDate();
    } else {
      return { wert: null, fehler: 'unlesbares Datum „' + s + '“' };
    }
    var probe = new Date(Date.UTC(j, mo - 1, t));
    if (probe.getUTCFullYear() !== j || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== t || j < 1850 || j > 2100) {
      return { wert: null, fehler: 'ungültiges Datum „' + s + '“' };
    }
    return { wert: j + '-' + pad2(mo) + '-' + pad2(t), hinweis: hinweis };
  }

  /** Betrag „180,00 €“, „180.00“, „1.234,50“ → Zahl oder null. */
  function betrag(wert) {
    var s = text(wert);
    if (!s) return null;
    s = s.replace(/€|eur/gi, '').replace(/\s/g, '');
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    var n = Number(s);
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  /**
   * Straße und Hausnummer trennen. Hausnummer = letzter Teil mit Ziffer: „12“, „12a“, „12 a“, „12-14“, „12/1“,
   * „7 1/2“. Liefert { strasse, hausnummer, sicher } – sicher=false, wenn keine Nummer erkannt wurde.
   */
  function teileStrasse(wert) {
    var s = text(wert);
    if (!s) return { strasse: null, hausnummer: null, sicher: true };
    var m = /^(.*?[^\d\s,])[\s,]*(\d+(?:\s?[a-zA-Z](?![a-zA-Z]))?(?:\s*[-\/]\s*\d+(?:\s?[a-zA-Z](?![a-zA-Z]))?)?(?:\s+\d+\/\d+)?)$/.exec(s);
    if (!m) return { strasse: s, hausnummer: null, sicher: false };
    var nr = m[2].replace(/(\d)\s([a-zA-Z])$/, '$1$2').replace(/\s*([-\/])\s*/g, '$1').replace(/(\d)\s([a-zA-Z])-/, '$1$2-');
    if (/\s\d+\/\d+$/.test(m[2])) nr = m[2].replace(/\s+/g, ' ');   // „7 1/2“ behält das Leerzeichen
    return { strasse: m[1].trim(), hausnummer: nr, sicher: true };
  }

  function anredeNorm(wert) {
    var f = falte(wert);
    if (!f) return { wert: null };
    if (f === 'herr' || f === 'hr' || f === 'herrn') return { wert: 'Herr' };
    if (f === 'frau' || f === 'fr') return { wert: 'Frau' };
    if (f === 'divers' || f === 'd') return { wert: 'Divers' };
    return { wert: null, fehler: 'Anrede „' + text(wert) + '“ nicht zuordenbar' };
  }

  function geschlechtNorm(wert, anrede) {
    var f = falte(wert);
    if (f === 'm' || f === 'maennlich' || f === 'mann' || f === 'male') return { wert: 'm' };
    if (f === 'w' || f === 'weiblich' || f === 'f' || f === 'frau' || f === 'female') return { wert: 'w' };
    if (f === 'd' || f === 'divers' || f === 'x') return { wert: 'd' };
    if (!f && anrede === 'Herr') return { wert: 'm', hinweis: 'aus Anrede abgeleitet' };
    if (!f && anrede === 'Frau') return { wert: 'w', hinweis: 'aus Anrede abgeleitet' };
    return { wert: null, fehler: f ? 'Geschlecht „' + text(wert) + '“ unbekannt' : 'Geschlecht fehlt' };
  }

  function plzNorm(wert) {
    var s = text(wert);
    if (!s) return { wert: null };
    var ziffern = s.replace(/\s/g, '');
    if (/^\d{5}$/.test(ziffern)) return { wert: ziffern };
    if (/^\d{4}$/.test(ziffern)) return { wert: '0' + ziffern, hinweis: 'führende 0 ergänzt (' + ziffern + ' → 0' + ziffern + ')' };
    return { wert: s, fehler: 'PLZ „' + s + '“ ist keine deutsche PLZ – Land prüfen' };
  }

  function emailNorm(wert) {
    var s = text(wert);
    if (!s) return { wert: null };
    s = s.toLowerCase().replace(/^mailto:/, '');
    return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s) ? { wert: s } : { wert: s, fehler: 'E-Mail „' + s + '“ hat kein gültiges Format' };
  }

  function alterAm(geb, stichtag) {
    if (typeof Mitgliedschaft !== 'undefined') return Mitgliedschaft.alter(geb, stichtag);
    if (!geb) return null;
    var a = +stichtag.slice(0, 4) - +geb.slice(0, 4);
    return stichtag.slice(5) < geb.slice(5) ? a - 1 : a;
  }

  function nummerSchluessel(nr) { var s = text(nr); return s ? s.replace(/^0+(?=\d)/, '') : null; }

  function ibanNorm(wert) { return String(wert || '').replace(/\s+/g, '').toUpperCase(); }
  function ibanOk(iban) {
    if (typeof Iban !== 'undefined' && Iban.pruefe) return Iban.pruefe(iban).ok;
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
    var u = iban.slice(4) + iban.slice(0, 4), rest = 0;
    for (var i = 0; i < u.length; i++) {
      var c = u.charCodeAt(i), teil = c >= 65 ? String(c - 55) : u[i];
      for (var j = 0; j < teil.length; j++) rest = (rest * 10 + +teil[j]) % 97;
    }
    return rest === 1;
  }
  function ibanAusBlz(blz, konto) {
    if (typeof Iban !== 'undefined' && Iban.ausBlzKonto) return Iban.ausBlzKonto(blz, konto);
    return null;
  }

  // ================================================================== Hauptfunktion

  /**
   * zeilen: [{ Spaltenname: Wert }] aus Daten16; optionen siehe Kopfkommentar / docs/MIGRATION.md.
   * Liefert { tabs, bericht: { zaehler, pruefliste, annahmen, spalten, naechsteIds } }.
   */
  function migriere(zeilen, optionen) {
    optionen = optionen || {};
    var heute = optionen.stichtag || new Date().toISOString().slice(0, 10);
    var jahr = Number(optionen.beitragsjahr || heute.slice(0, 4));
    var abteilungen = optionen.abteilungen || [];      // [{ abteilung_id, bezeichnung, blsv_sportart }]
    var beitragsarten = (optionen.beitragsarten || []).filter(function (a) { return a.aktiv !== false; });
    var pauschalen = (optionen.pauschalbetraege || []).map(Number);
    var muster = optionen.mandatsreferenzMuster || 'TSV-{jahr}-{mitglnr}';
    var pruefliste = [];
    var zaehler = { zeilen: (zeilen || []).length };

    function pruefe(art, schwere, p, meldung, vorschlag) {
      pruefliste.push({ art: art, schwere: schwere, mitglnr: p ? p.mitglnr : null, id: p ? p.id : null,
        name: p ? [p.nachname, p.vorname].filter(Boolean).join(', ') : null, meldung: meldung, vorschlag: vorschlag || null });
    }

    // ---- Spalten
    var kopf = zeilen && zeilen.length ? Object.keys(zeilen[0]) : [];
    var sp = ordneSpalten(kopf, SPALTEN);
    PFLICHT_SPALTEN.forEach(function (k) { if (!sp.zu[k]) pruefe('spalte_fehlt', 'fehler', null, 'Pflichtspalte „' + k + '“ fehlt im Export.', 'Alias in SPALTEN (src/lib/migration.js) ergänzen'); });
    Object.keys(SPALTEN).forEach(function (k) {
      if (!sp.zu[k] && PFLICHT_SPALTEN.indexOf(k) < 0 && VERWORFEN.indexOf(k) < 0) pruefe('spalte_fehlt', 'hinweis', null, 'Spalte „' + k + '“ nicht gefunden – Feld bleibt leer.');
    });
    sp.unbekannt.forEach(function (n) { pruefe('spalte_unbekannt', 'hinweis', null, 'Spalte „' + n + '“ ist unbekannt und wird nicht übernommen.'); });
    function wert(z, k) { return sp.zu[k] ? z[sp.zu[k]] : null; }

    // ---- Abteilungen tolerant zuordnen
    var abtIndex = {};
    abteilungen.forEach(function (a) {
      [a.bezeichnung, a.blsv_sportart].forEach(function (n) { if (n) abtIndex[falte(n)] = a.abteilung_id; });
    });
    Object.keys(optionen.abteilungAlias || {}).forEach(function (n) { abtIndex[falte(n)] = optionen.abteilungAlias[n]; });

    // ---- 1. Personen lesen
    var personen = [];
    var breite = 0;
    (zeilen || []).forEach(function (z, nr) {
      var id = Number(text(wert(z, 'id')));
      var p = { zeile: nr + 2, id: id, mitglnr: text(wert(z, 'mitglnr')), roh: z, nachname: text(wert(z, 'nachname')), vorname: text(wert(z, 'vorname')) };
      if (!(id > 0) || Math.floor(id) !== id) { pruefe('id_fehlt', 'fehler', p, 'Zeile ' + p.zeile + ': ID fehlt oder ist keine ganze Zahl – Zeile übersprungen.'); return; }
      if (!p.mitglnr) { pruefe('mitglnr_fehlt', 'fehler', p, 'Mitgliedsnummer fehlt – Zeile übersprungen.'); return; }
      if (/^\d+$/.test(p.mitglnr)) breite = Math.max(breite, p.mitglnr.length);
      personen.push(p);
    });
    // Mitgliedsnummer: einheitliche Breite mit führenden Nullen (wie im Bestand üblich)
    personen.forEach(function (p) { if (/^\d+$/.test(p.mitglnr) && p.mitglnr.length < breite) p.mitglnr = ('0000000000' + p.mitglnr).slice(-breite); });

    // doppelte IDs / Nummern
    var nachIdx = {}, nachNr = {};
    personen = personen.filter(function (p) {
      if (nachIdx[p.id]) { pruefe('id_doppelt', 'fehler', p, 'ID ' + p.id + ' kommt mehrfach vor – zweite Zeile übersprungen.'); return false; }
      nachIdx[p.id] = p;
      var k = nummerSchluessel(p.mitglnr);
      if (nachNr[k]) pruefe('mitglnr_doppelt', 'fehler', p, 'Mitgliedsnummer ' + p.mitglnr + ' auch bei ID ' + nachNr[k].id + '.');
      else nachNr[k] = p;
      return true;
    });

    // ---- 2. Mitglied, Zeiträume, Zugehörigkeiten
    var mitglieder = [], zeitraeume = [], zugehoerigkeiten = [];
    var nextZeitraum = 1, nextZug = 1;
    var hinweisV8 = 0;

    // Austritte (frühere Zeiträume) vorbereiten
    var frueher = {};
    if (optionen.austritte && optionen.austritte.length) {
      var spA = ordneSpalten(Object.keys(optionen.austritte[0]), SPALTEN_AUSTRITTE);
      optionen.austritte.forEach(function (a, i) {
        var g = function (k) { return spA.zu[k] ? a[spA.zu[k]] : null; };
        var p = null;
        var aid = Number(text(g('id')));
        if (aid && nachIdx[aid]) p = nachIdx[aid];
        else if (text(g('mitglnr'))) p = nachNr[nummerSchluessel(g('mitglnr'))];
        if (!p) { pruefe('austritt_ohne_person', 'warnung', null, 'AustritteAb2010 Zeile ' + (i + 2) + ': keine passende Person (ID/MitglNr).'); return; }
        var ein = datum(g('eindat'), +heute.slice(0, 4)), aus = datum(g('ausdat'), +heute.slice(0, 4));
        if (!ein.wert || !aus.wert) { pruefe('austritt_datum', 'warnung', p, 'AustritteAb2010: Ein-/Austrittsdatum fehlt oder ungültig – Zeitraum nicht übernommen.'); return; }
        (frueher[p.id] = frueher[p.id] || []).push({ eintrittsdatum: ein.wert, austrittsdatum: aus.wert, austrittsgrund: text(g('grund')) });
      });
    }

    personen.forEach(function (p) {
      var z = p.roh;
      var j0 = +heute.slice(0, 4);
      var geb = datum(wert(z, 'gebdat'), j0), ein = datum(wert(z, 'eindat'), j0), aus = datum(wert(z, 'ausdat'), j0);
      [['Geburtsdatum', geb], ['Eintritt', ein], ['Austritt', aus]].forEach(function (x) {
        if (x[1].fehler) pruefe('datum_ungueltig', 'warnung', p, x[0] + ': ' + x[1].fehler + '.');
        if (x[1].hinweis) pruefe('datum_zweistellig', 'hinweis', p, x[0] + ': ' + x[1].hinweis + '.');
      });
      p.geburtsdatum = geb.wert; p.eintritt = ein.wert; p.austritt = aus.wert;
      var anrede = anredeNorm(wert(z, 'anrede'));
      if (anrede.fehler) pruefe('anrede', 'hinweis', p, anrede.fehler + '.');
      var ges = geschlechtNorm(wert(z, 'geschlecht'), anrede.wert);
      if (ges.fehler) pruefe('geschlecht', 'warnung', p, ges.fehler + ' (für die BLSV-Meldung nötig).');
      var str = teileStrasse(wert(z, 'strasse'));
      if (!str.sicher) pruefe('hausnummer', 'hinweis', p, 'Keine Hausnummer erkannt in „' + str.strasse + '“.', 'Straße/Hausnummer von Hand trennen');
      var plz = plzNorm(wert(z, 'plz'));
      if (plz.hinweis) pruefe('plz', 'hinweis', p, 'PLZ: ' + plz.hinweis + '.');
      if (plz.fehler) pruefe('plz', 'warnung', p, plz.fehler + '.');
      var mail = emailNorm(wert(z, 'email'));
      if (mail.fehler) pruefe('email', 'hinweis', p, mail.fehler + '.');
      var titel = text(wert(z, 'titel'));
      var alter = alterAm(p.geburtsdatum, heute);
      var briefanrede = null;
      if (alter !== null && alter < 18 && p.vorname) briefanrede = (ges.wert === 'w' ? 'Liebe ' : 'Lieber ') + p.vorname;
      else if (anrede.wert === 'Herr' || anrede.wert === 'Frau') briefanrede = (anrede.wert === 'Herr' ? 'Sehr geehrter Herr ' : 'Sehr geehrte Frau ') + (titel ? titel + ' ' : '') + (p.nachname || '');
      if (!p.nachname) pruefe('name', 'fehler', p, 'Nachname fehlt.');
      if (!p.vorname) pruefe('name', 'warnung', p, 'Vorname fehlt.');

      // Zeiträume (frühere aus AustritteAb2010, dann der aus Daten16)
      var liste = (frueher[p.id] || []).slice().sort(function (a, b) { return a.eintrittsdatum.localeCompare(b.eintrittsdatum); });
      if (p.eintritt) liste.push({ eintrittsdatum: p.eintritt, austrittsdatum: p.austritt, austrittsgrund: null, haupt: true });
      else pruefe('eintritt_fehlt', 'fehler', p, 'Eintrittsdatum fehlt – kein Mitgliedschaftszeitraum.', 'Eintritt aus Unterlagen nachtragen');
      if (p.austritt && p.eintritt && p.austritt < p.eintritt) pruefe('zeitraum', 'fehler', p, 'Austritt liegt vor dem Eintritt.');
      var eigene = [];
      liste.forEach(function (zr, i) {
        var vorher = eigene[eigene.length - 1];
        if (vorher && (!vorher.austrittsdatum || vorher.austrittsdatum >= zr.eintrittsdatum)) {
          pruefe('zeitraum_ueberlappt', 'warnung', p, 'Zeiträume überschneiden sich (' + vorher.eintrittsdatum + ' / ' + zr.eintrittsdatum + ') – früherer Zeitraum nicht übernommen.');
          if (!zr.haupt) return;
          eigene.pop(); zeitraeume.pop();
        }
        var o = { zeitraum_id: nextZeitraum++, mitglied_id: p.id, antrag_am: null, aufnahme_beschluss_am: null, aufnahmeantrag_id: null,
          eintrittsdatum: zr.eintrittsdatum, austrittsdatum: zr.austrittsdatum || null, kuendigung_eingang: null,
          austritt_wirksam: null, austrittsgrund: zr.austrittsgrund || null,
          bemerkung: zr.haupt ? null : 'Migration: aus AustritteAb2010', version: 1, geaendert_am: null, geaendert_von: 'migration' };
        eigene.push(o); zeitraeume.push(o);
      });
      if ((frueher[p.id] || []).length) zaehler.wiedereintritte = (zaehler.wiedereintritte || 0) + 1;

      // Abteilungen 1–4
      var gesehen = {};
      [1, 2, 3, 4].forEach(function (n) {
        var name = text(wert(z, 'abt' + n));
        if (!name) return;
        var aid = abtIndex[falte(name)];
        if (!aid) { pruefe('abteilung_unbekannt', 'warnung', p, 'Abteilung „' + name + '“ unbekannt.', 'Alias über optionen.abteilungAlias ergänzen oder Abteilung anlegen'); return; }
        if (gesehen[aid]) return;
        gesehen[aid] = true;
        var status = 'aktiv';
        if (n === 1) {
          var st = falte(wert(z, 'status1'));
          if (st === 'passiv' || st === 'p') status = 'passiv';
          else if (st && st !== 'aktiv' && st !== 'a') pruefe('abteilung_status', 'hinweis', p, 'Status Abteilung 1 „' + text(wert(z, 'status1')) + '“ unbekannt – als aktiv übernommen.');
        } else hinweisV8++;
        zugehoerigkeiten.push({ zugehoerigkeit_id: nextZug++, mitglied_id: p.id, abteilung_id: aid, passnummer: null, status: status,
          eintrittsdatum: p.eintritt, austrittsdatum: p.austritt || null, bemerkung: n > 1 ? 'Migration: Status in Daten16 nur für Abteilung 1 vorhanden' : null,
          version: 1, geaendert_am: null, geaendert_von: 'migration' });
      });

      var arbeit = datum(wert(z, 'arbeitsdatum'), j0).wert;
      var m = {
        mitglied_id: p.id, mitgliedsnummer: p.mitglnr, anrede: anrede.wert, briefanrede: briefanrede, titel: titel,
        vorname: p.vorname, nachname: p.nachname, strasse: str.strasse, hausnummer: str.hausnummer, plz: plz.wert,
        ort: text(wert(z, 'ort')), land: 'DE', geburtsdatum: p.geburtsdatum, geschlecht: ges.wert,
        telefon: text(wert(z, 'telefon')), handy: text(wert(z, 'handy')), email: mail.wert,
        versandart: mail.wert ? 'E-Mail' : 'Post', adresse_ungueltig: false, adresse_ungueltig_am: null,
        ehrenmitglied: false, ehrenmitglied_seit: null, nur_funktionstraeger: false, sterbedatum: null, status: null,
        beitragsart_id: null, beitragskonto_id: null, beitragsgemeinschaft_id: null,
        vertreter_mitglied_id: null, vertreter_name: null, vertreter_kontakt: null,
        bemerkung: text(wert(z, 'bemerkung')), geaendert_am: arbeit ? arbeit + 'T00:00:00' : null, geaendert_von: 'migration',
        verarbeitung_eingeschraenkt: false, sperre_grund: null, loeschbar_ab: null, anonymisiert: false, anonymisiert_am: null, version: 1
      };
      if (typeof Mitgliedschaft !== 'undefined') m.status = Mitgliedschaft.status(m, eigene, heute);
      else m.status = eigene.length ? (eigene.some(function (e) { return !e.austrittsdatum || e.austrittsdatum >= heute; }) ? 'aktiv' : 'ausgetreten') : null;
      p.m = m; p.alter = alter;
      p.beitrag = betrag(wert(z, 'gesamtbeitrag'));
      p.aktiv = m.status === 'aktiv';
      mitglieder.push(m);
    });
    if (hinweisV8) pruefe('status_abteilung', 'hinweis', null, hinweisV8 + ' Zugehörigkeiten zu Abteilung 2–4 als „aktiv“ übernommen (Daten16 kennt den Status nur für Abteilung 1).', 'Bei Bedarf in der Oberfläche auf passiv setzen');

    // Dubletten Nachname + Geburtsdatum
    var dub = {};
    personen.forEach(function (p) {
      if (!p.m || !p.geburtsdatum || !p.nachname) return;
      var k = falte(p.nachname) + '|' + p.geburtsdatum;
      if (dub[k]) pruefe('dublette', 'warnung', p, 'Gleicher Nachname und Geburtsdatum wie ' + dub[k].mitglnr + ' (ID ' + dub[k].id + ').', 'Prüfen, ob dieselbe Person – ggf. als Wiedereintritt zusammenführen');
      else dub[k] = p;
    });

    // ---- 3. Konten-Cluster über „Zahler“
    var cluster = {}, reihenfolge = [];
    personen.forEach(function (p) {
      if (!p.m) return;
      var zNr = nummerSchluessel(wert(p.roh, 'zahler'));
      var eigen = nummerSchluessel(p.mitglnr);
      var zahler = p;
      if (zNr && zNr !== eigen) {
        if (nachNr[zNr]) zahler = nachNr[zNr];
        else pruefe('zahler_unbekannt', 'fehler', p, 'Zahler ' + text(wert(p.roh, 'zahler')) + ' existiert nicht – Person zahlt vorläufig selbst (Waise).', 'Zahler klären: neuer Zahler mit Mandat oder Selbstzahler');
      }
      if (zahler !== p) {
        var zz = nummerSchluessel(wert(zahler.roh, 'zahler'));
        if (zz && zz !== nummerSchluessel(zahler.mitglnr)) pruefe('zahler_kette', 'warnung', p, 'Zahler ' + zahler.mitglnr + ' zahlt selbst über ' + text(wert(zahler.roh, 'zahler')) + ' – Kette.', 'Zahler direkt eintragen');
      }
      var k = zahler.id;
      if (!cluster[k]) { cluster[k] = { zahler: zahler, personen: [] }; reihenfolge.push(k); }
      cluster[k].personen.push(p);
    });
    // Zahler gehört immer zu seinem Cluster (auch wenn er selbst anderswo zahlt, steht er dort zusätzlich als Inhaber)

    var konten = [], gemeinschaften = [], sollstellungen = [];
    var nextKonto = 1, nextGem = 1, nextSoll = 1;
    var referenzen = {};
    var maxEinzel = beitragsarten.reduce(function (m, a) { return Math.max(m, Number(a.betrag) || 0); }, 0);
    function istPauschale(b) {
      if (b === null || b === 0) return false;
      if (pauschalen.length) return pauschalen.indexOf(b) >= 0;
      return maxEinzel > 0 && b > maxEinzel && !beitragsarten.some(function (a) { return Number(a.betrag) === b; });
    }
    function beitragsartFuer(p) {
      var passend = beitragsarten.filter(function (a) { return Number(a.betrag) === p.beitrag; });
      if (passend.length > 1 && p.alter !== null) {
        var nachAlter = passend.filter(function (a) {
          return (a.alter_von === null || a.alter_von === undefined || p.alter >= a.alter_von) && (a.alter_bis === null || a.alter_bis === undefined || p.alter <= a.alter_bis);
        });
        if (nachAlter.length) passend = nachAlter;
      }
      if (passend.length === 1) return passend[0].beitragsart_id;
      if (p.aktiv) {
        if (!passend.length) pruefe('beitrag_unbekannt', 'warnung', p, 'Gesamtbeitrag ' + (p.beitrag === null ? '(leer)' : p.beitrag.toFixed(2).replace('.', ',') + ' €') + ' passt zu keiner Beitragsart.', 'Beitragsart von Hand zuordnen');
        else pruefe('beitragsart_mehrdeutig', 'warnung', p, 'Gesamtbeitrag passt zu mehreren Beitragsarten (' + passend.map(function (a) { return a.bezeichnung; }).join(', ') + ').', 'Beitragsart von Hand wählen');
      }
      return null;
    }

    reihenfolge.forEach(function (k) {
      var c = cluster[k], zahler = c.zahler;
      var zr = zahler.roh;
      var iban = ibanNorm(wert(zr, 'iban'));
      var bic = text(wert(zr, 'bic'));
      var kontoId = nextKonto++;
      // IBANs der übrigen Cluster-Zeilen vergleichen (nicht raten)
      c.personen.forEach(function (p) {
        if (p === zahler) return;
        var andere = ibanNorm(wert(p.roh, 'iban'));
        if (andere && andere !== iban) pruefe('iban_abweichend', 'warnung', p, 'Eigene IBAN weicht von der des Zahlers ' + zahler.mitglnr + ' ab – Konto des Zahlers übernommen.', 'Prüfen, wer tatsächlich zahlt');
      });
      var zahlweg = 'Überweisung';
      if (iban) {
        zahlweg = 'Lastschrift';
        if (!ibanOk(iban)) pruefe('iban_ungueltig', 'fehler', zahler, 'IBAN ' + iban.slice(0, 4) + '… hat eine falsche Prüfziffer oder Länge.', 'IBAN beim Mitglied erfragen');
      } else if (text(wert(zr, 'blz')) && text(wert(zr, 'konto'))) {
        var vorschlag = ibanAusBlz(wert(zr, 'blz'), wert(zr, 'konto'));
        if (vorschlag) {
          iban = vorschlag; zahlweg = 'Lastschrift';
          pruefe('iban_aus_blz', 'warnung', zahler, 'Keine IBAN, IBAN aus BLZ/Konto errechnet (' + vorschlag.slice(0, 4) + '…). Manche Banken haben Sonderregeln.', 'Errechnete IBAN bestätigen lassen');
        }
      }
      var aktive = c.personen.filter(function (p) { return p.aktiv; });
      if (!iban && aktive.length) pruefe('ohne_iban', 'hinweis', zahler, 'Keine Bankverbindung – Zahlweg „Überweisung“ angenommen.');
      var referenz = null, mandatsdatum = null;
      if (zahlweg === 'Lastschrift') {
        mandatsdatum = zahler.eintritt || null;
        referenz = muster.replace('{jahr}', (zahler.eintritt || String(jahr)).slice(0, 4)).replace('{mitglnr}', zahler.mitglnr).replace('{id}', String(zahler.id));
        if (referenzen[referenz]) {
          var n = 2;
          while (referenzen[referenz + '-' + n]) n++;
          pruefe('mandatsreferenz_doppelt', 'warnung', zahler, 'Mandatsreferenz ' + referenz + ' entstünde doppelt – mit Zusatz -' + n + '.');
          referenz = referenz + '-' + n;
        }
        referenzen[referenz] = true;
      }
      var inhaber = text(wert(zr, 'kontoinhaber')) || [zahler.nachname, zahler.vorname].filter(Boolean).join(', ');
      konten.push({
        beitragskonto_id: kontoId, kontoinhaber_name: inhaber, kontoinhaber_mitglied_id: zahler.m ? zahler.id : null,
        zahlweg: zahlweg, iban: iban || null, bic: iban && bic ? bic.replace(/\s/g, '').toUpperCase() : null,
        mandatsreferenz: referenz, mandatsdatum: mandatsdatum,
        abw_strasse: null, abw_hausnummer: null, abw_plz: null, abw_ort: null, abw_land: null,
        aktiv: aktive.length > 0, bemerkung: c.personen.length > 1 ? 'Migration: Zahler-Cluster ' + zahler.mitglnr + ' (' + c.personen.length + ' Personen)' : null,
        version: 1, geaendert_am: null, geaendert_von: 'migration'
      });
      c.personen.forEach(function (p) { p.m.beitragskonto_id = kontoId; });
      c.konto = konten[konten.length - 1];

      // Waise: Zahler nicht mehr aktiv, Abhängige schon
      if (!zahler.aktiv && aktive.some(function (p) { return p !== zahler; })) {
        pruefe('zahler_ausgetreten', 'fehler', zahler, 'Zahler ist ' + (zahler.m.status || 'nicht aktiv') + ', ' + aktive.length + ' aktive Person(en) zahlen weiter über sein Konto.', 'Neuen Zahler mit Mandat bestimmen, Selbstzahler oder Austritt (Übergabe §4)');
      }

      // ---- 4. Gemeinschaft oder nur gemeinsames Konto (Übergabe §6)
      var pauschal = aktive.filter(function (p) { return istPauschale(p.beitrag); });
      var ohne = aktive.filter(function (p) { return p.beitrag === null || p.beitrag === 0; });
      var mitEigenem = aktive.filter(function (p) { return p.beitrag !== null && p.beitrag > 0 && !istPauschale(p.beitrag); });
      if (pauschal.length === 1 && ohne.length >= 1) {
        var pz = pauschal[0];
        var glieder = [pz].concat(ohne);
        var g = { beitragsgemeinschaft_id: nextGem++, bezeichnung: (glieder.length === 2 && glieder.every(function (x) { return x.alter === null || x.alter >= 18; }) ? 'Ehepaar ' : 'Familie ') + (pz.nachname || zahler.nachname),
          festbetrag: pz.beitrag, aktiv: true, bemerkung: 'Migration: Pauschale aus Gesamtbeitrag von ' + pz.mitglnr, version: 1, geaendert_am: null, geaendert_von: 'migration' };
        gemeinschaften.push(g);
        glieder.forEach(function (x) { x.m.beitragsgemeinschaft_id = g.beitragsgemeinschaft_id; x.m.beitragsart_id = null; x.m.beitragskonto_id = kontoId; });
        mitEigenem.forEach(function (x) { x.m.beitragsart_id = beitragsartFuer(x); });
        if (pz !== zahler && zahler.aktiv) pruefe('cluster_mischfall', 'hinweis', pz, 'Pauschale steht nicht beim Zahler ' + zahler.mitglnr + ' – Gemeinschaft trotzdem gebildet.');
        zaehler.gemeinschaften = (zaehler.gemeinschaften || 0) + 1;
      } else {
        if (pauschal.length > 1) {
          pruefe('cluster_mischfall', 'warnung', zahler, 'Mehrere Pauschalen im Konto-Cluster (' + pauschal.map(function (x) { return x.mitglnr; }).join(', ') + ') – keine Gemeinschaft gebildet.', 'Gemeinschaft(en) von Hand anlegen');
        } else if (pauschal.length === 1 && !ohne.length) {
          pruefe('cluster_mischfall', 'warnung', pauschal[0], 'Pauschale ' + pauschal[0].beitrag.toFixed(2).replace('.', ',') + ' €, aber niemand im Cluster ohne eigenen Beitrag – keine Gemeinschaft gebildet.', 'Beitrag prüfen');
        } else if (!pauschal.length && ohne.length && aktive.length > 1) {
          pruefe('cluster_mischfall', 'warnung', zahler, ohne.length + ' Person(en) ohne Beitrag auf dem Konto, aber keine Pauschale erkennbar.', 'Pauschalbeträge über --pauschalen angeben oder Gemeinschaft von Hand anlegen');
        }
        aktive.forEach(function (x) {
          if (x.beitrag === null || x.beitrag === 0) {
            if (aktive.length === 1 || !(pauschal.length > 1 || (!pauschal.length && ohne.length && aktive.length > 1))) pruefe('ohne_beitrag', 'warnung', x, 'Aktives Mitglied ohne Gesamtbeitrag.', 'Beitragsart zuordnen oder in eine Gemeinschaft aufnehmen');
            return;
          }
          if (istPauschale(x.beitrag)) return;
          x.m.beitragsart_id = beitragsartFuer(x);
        });
      }
    });

    // Abschlusskontrolle: jedes aktive Mitglied braucht Beitragsart oder Gemeinschaft (Prüfregel aus dem Datenmodell).
    // Wer durch einen Mischfall ohne Beitrag bleibt, wird einzeln gemeldet, sofern er noch nicht auf der Liste steht.
    var gemeldetOhne = {};
    pruefliste.forEach(function (x) { if (x.art === 'ohne_beitrag' || x.art === 'beitrag_unbekannt' || x.art === 'beitragsart_mehrdeutig') gemeldetOhne[x.id] = true; });
    personen.forEach(function (p) {
      if (!p.m || !p.aktiv || p.m.beitragsart_id || p.m.beitragsgemeinschaft_id || gemeldetOhne[p.id]) return;
      pruefe('ohne_beitrag', 'warnung', p, 'Nach der Übernahme ohne Beitragsart und ohne Gemeinschaft (Konto-Cluster von ' +
        (nachIdx[p.id] && p.m.beitragskonto_id ? 'Konto ' + p.m.beitragskonto_id : '–') + ').', 'Beitragsart zuordnen oder in eine Gemeinschaft aufnehmen');
    });

    // ---- 5. Zahlung = NG → Sollstellung ruecklastschrift
    var tabs = { Mitglied: mitglieder, Mitgliedschaftszeitraum: zeitraeume, Abteilungszugehoerigkeit: zugehoerigkeiten,
      Beitragskonto: konten, Beitragsgemeinschaft: gemeinschaften, Sollstellung: sollstellungen };
    var ngKonten = {};
    personen.forEach(function (p) {
      if (!p.m) return;
      var zahlung = text(wert(p.roh, 'zahlung'));
      if (!zahlung) return;
      if (falte(zahlung) !== 'ng') { pruefe('zahlung_unbekannt', 'hinweis', p, 'Zahlung „' + zahlung + '“ unbekannt (erwartet nur NG) – ignoriert.'); return; }
      ngKonten[p.m.beitragskonto_id] = ngKonten[p.m.beitragskonto_id] || [];
      ngKonten[p.m.beitragskonto_id].push(p);
    });
    Object.keys(ngKonten).forEach(function (kid) {
      kid = Number(kid);
      var soll = null;
      if (typeof Beitrag !== 'undefined' && Beitrag.sollJeKonto) {
        var daten = { Mitglied: mitglieder, Mitgliedschaftszeitraum: zeitraeume, Beitragsart: optionen.beitragsarten || [],
          Beitragsgemeinschaft: gemeinschaften, Beitragskonto: konten, Sollstellung: [], _Konfig: [] };
        try { soll = Beitrag.sollJeKonto(kid, daten, jahr, { konfig: optionen.konfig || {} }).betrag; } catch (e) { soll = null; }
      }
      if (soll === null) {
        soll = 0;
        var gezaehlt = {};
        mitglieder.forEach(function (m) {
          if (m.beitragskonto_id !== kid) return;
          if (m.beitragsgemeinschaft_id) {
            if (!gezaehlt[m.beitragsgemeinschaft_id]) {
              gezaehlt[m.beitragsgemeinschaft_id] = true;
              gemeinschaften.forEach(function (g) { if (g.beitragsgemeinschaft_id === m.beitragsgemeinschaft_id) soll += Number(g.festbetrag) || 0; });
            }
          } else nachIdx[m.mitglied_id] && (soll += nachIdx[m.mitglied_id].beitrag || 0);
        });
      }
      sollstellungen.push({ sollstellung_id: nextSoll++, beitragskonto_id: kid, jahr: jahr, soll_betrag: soll, ist_betrag: 0, gebuehr: null,
        status: 'ruecklastschrift', sepa_sequenz: null, einzugsdatum: null, buchungsdatum: null, mahnstufe: 0,
        ruecklastschrift_grund: 'Migration: Daten16.Zahlung = NG (beim Einzug nicht gezahlt)',
        bemerkung: 'Migration – Personen: ' + ngKonten[kid].map(function (p) { return p.mitglnr; }).join(', '), version: 1, geaendert_am: null, geaendert_von: 'migration' });
      if (!soll) pruefe('ng_ohne_betrag', 'warnung', ngKonten[kid][0], 'NG-Vermerk, aber kein Soll-Betrag ermittelbar.', 'Soll von Hand eintragen');
    });

    // ---- Zähler, nächste IDs, Annahmen
    zaehler.mitglieder = mitglieder.length;
    zaehler.aktiv = mitglieder.filter(function (m) { return m.status === 'aktiv'; }).length;
    zaehler.ausgetreten = mitglieder.filter(function (m) { return m.status === 'ausgetreten'; }).length;
    zaehler.zeitraeume = zeitraeume.length;
    zaehler.zugehoerigkeiten = zugehoerigkeiten.length;
    zaehler.konten = konten.length;
    zaehler.lastschrift = konten.filter(function (k) { return k.zahlweg === 'Lastschrift'; }).length;
    zaehler.gemeinschaften = gemeinschaften.length;
    zaehler.sollstellungen_ng = sollstellungen.length;
    zaehler.pruefliste = { fehler: 0, warnung: 0, hinweis: 0 };
    pruefliste.forEach(function (x) { zaehler.pruefliste[x.schwere]++; });
    pruefliste.sort(function (a, b) { return SCHWERE[a.schwere] - SCHWERE[b.schwere] || String(a.art).localeCompare(String(b.art)); });

    function maxId(liste, feld) { return liste.reduce(function (m, z) { return Math.max(m, Number(z[feld]) || 0); }, 0); }
    var maxNr = mitglieder.reduce(function (m, x) { return /^\d+$/.test(x.mitgliedsnummer) ? Math.max(m, Number(x.mitgliedsnummer)) : m; }, 0);
    var naechsteIds = {
      next_id_Mitglied: maxId(mitglieder, 'mitglied_id') + 1,
      next_id_Mitgliedschaftszeitraum: maxId(zeitraeume, 'zeitraum_id') + 1,
      next_id_Abteilungszugehoerigkeit: maxId(zugehoerigkeiten, 'zugehoerigkeit_id') + 1,
      next_id_Beitragskonto: maxId(konten, 'beitragskonto_id') + 1,
      next_id_Beitragsgemeinschaft: maxId(gemeinschaften, 'beitragsgemeinschaft_id') + 1,
      next_id_Sollstellung: maxId(sollstellungen, 'sollstellung_id') + 1,
      mitgliedsnummer_naechste: String(maxNr + 1)
    };
    var annahmen = [
      'Mandatsreferenz nach Muster „' + muster + '“ ({jahr} = Eintrittsjahr des Zahlers) und Mandatsdatum = Eintrittsdatum des Zahlers – Daten16 enthält KEINE Mandatsspalten. Vor dem Echtlauf mit dem Schema des bisherigen Access-Exports abgleichen (sonst gilt jedes Mandat als neu → FRST bzw. neue Unterschrift).',
      pauschalen.length ? 'Pauschalbeträge (Gemeinschaft): ' + pauschalen.join(', ') + ' €.' :
        'Pauschalen erkannt als: Gesamtbeitrag größer als die höchste Einzel-Beitragsart (' + maxEinzel + ' €) und keiner Beitragsart gleich. Besser: --pauschalen mit den echten Beträgen angeben (Rückfrage M8).',
      'Versandart = E-Mail, wenn eine E-Mail-Adresse vorhanden ist, sonst Post.',
      'Abteilung 2–4: Status „aktiv“ (nur für Abteilung 1 gibt es einen Status).',
      'Zahlung = NG → Sollstellung ' + jahr + ' mit Status ruecklastschrift (Entscheidung 10/2026).',
      'Felder ohne Quelle in Daten16 bleiben leer: Ehrenmitglied, Sterbedatum, Adresse ungültig, gesetzliche Vertretung, Funktionen, Einwilligungen.'
    ];
    return { tabs: tabs, bericht: { zaehler: zaehler, pruefliste: pruefliste, annahmen: annahmen, spalten: sp, naechsteIds: naechsteIds,
      cluster: reihenfolge.map(function (k) {
        var c = cluster[k];
        return { konto: c.konto.beitragskonto_id, zahler: c.zahler.mitglnr, inhaber: c.konto.kontoinhaber_name, zahlweg: c.konto.zahlweg,
          personen: c.personen.map(function (p) { return { mitglnr: p.mitglnr, name: [p.nachname, p.vorname].filter(Boolean).join(', '), status: p.m.status,
            beitrag: p.beitrag, gemeinschaft: p.m.beitragsgemeinschaft_id, beitragsart: p.m.beitragsart_id }; }) };
      }).filter(function (c) { return c.personen.length > 1; }) } };
  }

  return {
    SPALTEN: SPALTEN, migriere: migriere,
    // Einzelregeln (für Tests und Nachkontrolle)
    datum: datum, betrag: betrag, teileStrasse: teileStrasse, anredeNorm: anredeNorm, geschlechtNorm: geschlechtNorm,
    plzNorm: plzNorm, emailNorm: emailNorm, falte: falte, ordneSpalten: ordneSpalten
  };
})();
