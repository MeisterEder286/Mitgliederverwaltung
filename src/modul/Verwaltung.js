/**
 * Verwaltung – Servermodul für Benutzer & Rechte, Einstellungen (_Konfig), Stammdaten, Datenqualität und System.
 *
 * Zweck:      Pflege der Zugänge (Tab Benutzer), der Einstellungen (Tab _Konfig) und der Stammdaten-Tabs;
 *             Datenqualitäts-Prüfung über den ganzen Bestand (src/lib/pruefregeln.js); Hinweise für die Startseite;
 *             Systeminfo und Neuaufbau des Snapshot-Caches.
 * Datenquelle: DB (Benutzer, _Konfig, Stammdaten-Tabs, alle Snapshot-Tabs für die Prüfung), Snapshot-Basis.
 * Wer darf was (geprüft in src/api/Verwaltung.js über Api.ausfuehren):
 *   - benutzer_verwalten: Benutzer anlegen/ändern/deaktivieren (Vorstand, Mitgliederverwalter).
 *   - konfig_aendern: _Konfig ändern, Systeminfo, Snapshot neu aufbauen, Hinweise (Sicherheitsregel A8: nicht jede
 *     Rolle darf Konfiguration ändern).
 *   - stammdaten_bearbeiten: Stammdaten-Tabs, Datenqualität.
 * Besonderheiten:
 *   - Rollenmatrix (welche Rolle was darf) steht bewusst im Code (src/lib/rechte.js, V5) und wird hier nur angezeigt.
 *   - Selbstschutz: Niemand kann sich selbst die letzte Verwaltungsrolle (Vorstand/Mitgliederverwalter) entziehen,
 *     und es bleibt immer mindestens ein aktiver Verwaltungszugang.
 *   - Nach jeder Benutzeränderung wird der Benutzer-Cache verworfen (Zugriff.vergessen), sonst gälten alte Rechte
 *     bis zu 5 Minuten weiter.
 *   - Zugang folgt NICHT automatisch dem Amt (V10). Stattdessen gibt es eine Warnliste: aktiver Zugang ohne
 *     laufendes passendes Amt.
 *   - Stammdaten werden nie gelöscht, nur auf aktiv = nein gesetzt (Historie bleibt verständlich).
 *   - _Konfig: ID-Zähler (next_id_*) und mitgliedsnummer_naechste sind nur lesbar – sie verwaltet das Skript.
 */
var Verwaltung = (function () {

  var VERWALTUNGSROLLEN = ['Vorstand', 'Mitgliederverwalter'];
  var STAMMDATEN = ['Abteilung', 'Funktionsart', 'Beitragsart', 'Qualifikationsart', 'Ehrungsregel', 'Aufbewahrungsfrist'];
  var SNAPSHOT_TABS = ['Abteilung', 'Funktionsart', 'Beitragsart', 'Qualifikationsart', 'Ehrungsregel'];
  var PRUEF_TABS = ['Mitglied', 'Mitgliedschaftszeitraum', 'Abteilung', 'Abteilungszugehoerigkeit', 'Funktionsart', 'Funktion',
    'Beitragsart', 'Beitragsgemeinschaft', 'Beitragskonto', 'Sollstellung', 'Qualifikationsart', 'Qualifikation',
    'Ehrungsregel', 'Ehrung', 'Einwilligung'];
  // Welche Ämter (Funktionsart.bezeichnung, Anfang) zu welcher Rolle passen – für die Warnliste (V10)
  var AMT_ZU_ROLLE = {
    Abteilungsleiter: ['Abteilungsleiter'],
    Jugendleiter: ['Jugendleiter'],
    Kassier: ['Kassier'],
    Vorstand: ['1. Vorsitzender', '2. Vorsitzender', '1./2. Vorsitzender']
  };
  var CACHE_PRUEFUNG = 'verwaltung:pruefung';

  function heute() { return DB.jetzt().slice(0, 10); }
  function hat(liste, x) { return (liste || []).indexOf(x) >= 0; }

  /**
   * Zahlfelder (Ganzzahl, FK, Dezimal) aus Formularen kommen oft als Text ("3", "5,00"). Hier in Zahlen wandeln,
   * damit die Typprüfung in DB/Werte greift; leere Texte werden zu null. Andere Felder bleiben unverändert.
   */
  function zahlenNormalisieren(tab, felder) {
    var spalten = {};
    Schema.TABELLEN[tab].spalten.forEach(function (s) { spalten[s.name] = s.typ; });
    Object.keys(felder).forEach(function (k) {
      var typ = spalten[k], v = felder[k];
      if ((typ === 'Ganzzahl' || typ === 'FK' || typ === 'Dezimal') && typeof v === 'string') {
        var t = v.trim().replace(',', '.');
        felder[k] = t === '' ? null : (isFinite(Number(t)) ? Number(t) : v);
      }
    });
    return felder;
  }
  function norm(e) { return String(e || '').trim().toLowerCase(); }

  // ------------------------------------------------------------------ Benutzer

  function warnliste(benutzer, basis) {
    var h = heute();
    var arten = {};
    (basis.tabs.Funktionsart || []).forEach(function (a) { arten[a.funktionsart_id] = a; });
    var personen = {};
    (basis.tabs.Mitglied || []).forEach(function (m) { personen[m.mitglied_id] = m; });
    var warn = [];
    benutzer.forEach(function (b) {
      if (b.aktiv !== true || !AMT_ZU_ROLLE[b.rolle]) return;
      if (!b.mitglied_id) {
        warn.push({ benutzer_id: b.benutzer_id, email: b.email, rolle: b.rolle,
          meldung: 'Zugang ist keiner Person zugeordnet – passendes Amt kann nicht geprüft werden.' });
        return;
      }
      var passend = (basis.tabs.Funktion || []).some(function (f) {
        if (f.mitglied_id !== b.mitglied_id || !Mitgliedschaft.laeuft(f.von, f.bis, h)) return false;
        var name = String((arten[f.funktionsart_id] || {}).bezeichnung || '');
        var amtOk = AMT_ZU_ROLLE[b.rolle].some(function (a) { return name.indexOf(a) === 0; });
        if (!amtOk) return false;
        return b.rolle !== 'Abteilungsleiter' || f.abteilung_id === b.abteilung_id;
      });
      if (!passend) {
        var p = personen[b.mitglied_id];
        warn.push({ benutzer_id: b.benutzer_id, email: b.email, rolle: b.rolle,
          person: p ? [p.nachname, p.vorname].join(', ') : '',
          meldung: 'Aktiver Zugang „' + b.rolle + '“, aber kein laufendes passendes Amt' +
            (b.rolle === 'Abteilungsleiter' ? ' in dieser Abteilung' : '') + '. Bitte prüfen, ob der Zugang noch nötig ist.' });
      }
    });
    return warn;
  }

  function benutzer(ktx) {
    var liste = DB.lese(['Benutzer']).Benutzer || [];
    var basis = Snapshot.basis();
    var matrix = {};
    Object.keys(Rechte.MATRIX).forEach(function (r) {
      matrix[r] = { sicht: Rechte.MATRIX[r].sicht, aktionen: Rechte.MATRIX[r].aktionen, zeilen: Rechte.MATRIX[r].zeilen };
    });
    return {
      benutzer: liste.slice().sort(function (a, b) { return norm(a.email).localeCompare(norm(b.email)); }),
      warnungen: warnliste(liste, basis),
      matrix: matrix,
      rollen: Schema.LISTEN.rolle || Rechte.ROLLEN,
      eigene_domain: norm(ktx.email).split('@')[1] || ''
    };
  }

  function benutzerSpeichern(ktx, id, version, werte) {
    werte = werte || {};
    return DB.mitSperre(function () {
      var alle = DB.lese(['Benutzer', 'Abteilung']);
      var liste = alle.Benutzer || [];
      var felder = zahlenNormalisieren('Benutzer', Rechte.erlaubteSchreibfelder(ktx, 'Benutzer', werte));
      var bisher = id ? liste.filter(function (b) { return String(b.benutzer_id) === String(id); })[0] : null;
      if (id && !bisher) throw Fehler.fachlich('Der Zugang wurde nicht gefunden.');
      var kuenftig = {};
      Object.keys(bisher || {}).forEach(function (k) { kuenftig[k] = bisher[k]; });
      Object.keys(felder).forEach(function (k) { kuenftig[k] = felder[k]; });
      if (felder.email !== undefined) felder.email = kuenftig.email = norm(felder.email);
      if (!id && kuenftig.aktiv === undefined) felder.aktiv = kuenftig.aktiv = true;

      var fehler = [];
      if (!kuenftig.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(kuenftig.email)) fehler.push({ feld: 'email', meldung: 'Bitte eine gültige E-Mail-Adresse (Google-Konto) angeben.' });
      if (!hat(Schema.LISTEN.rolle, kuenftig.rolle)) fehler.push({ feld: 'rolle', meldung: 'Bitte eine Rolle wählen.' });
      if (kuenftig.rolle === 'Abteilungsleiter') {
        var abt = (alle.Abteilung || []).some(function (a) { return a.abteilung_id === Number(kuenftig.abteilung_id); });
        if (!abt) fehler.push({ feld: 'abteilung_id', meldung: 'Für Abteilungsleiter bitte die Abteilung wählen.' });
      } else if (kuenftig.abteilung_id) {
        felder.abteilung_id = kuenftig.abteilung_id = null;
      }
      var doppelt = liste.some(function (b) {
        return String(b.benutzer_id) !== String(id) && norm(b.email) === kuenftig.email && b.rolle === kuenftig.rolle &&
          String(b.abteilung_id || '') === String(kuenftig.abteilung_id || '');
      });
      if (doppelt) fehler.push({ feld: 'rolle', meldung: 'Diese E-Mail hat diese Rolle bereits.' });
      if (fehler.length) throw Fehler.fachlich('Bitte Eingaben prüfen.', fehler);

      // Selbstschutz und „mindestens ein Verwaltungszugang“
      var danach = liste.filter(function (b) { return String(b.benutzer_id) !== String(id); }).concat([kuenftig]);
      var verwaltend = function (b) { return b.aktiv === true && hat(VERWALTUNGSROLLEN, b.rolle); };
      if (!danach.some(function (b) { return verwaltend(b) && norm(b.email) === norm(ktx.email); })) {
        throw Fehler.fachlich('Sie können sich nicht selbst die letzte Verwaltungsrolle entziehen. Bitte eine andere Person mit Verwaltungsrecht darum bitten.');
      }
      if (!danach.some(verwaltend)) throw Fehler.fachlich('Es muss mindestens ein aktiver Verwaltungszugang bleiben.');

      var gespeichert;
      if (id) {
        var r = DB.aktualisieren('Benutzer', id, felder, version, ktx);
        gespeichert = r.neu;
        Protokoll.schreibe(ktx, Protokoll.ausDiff('Benutzer', id, r.diff));
      } else {
        felder.angelegt_am = heute();
        gespeichert = DB.einfuegen('Benutzer', felder, ktx);
        Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: 'Benutzer', datensatz_id: gespeichert.benutzer_id,
          kommentar: gespeichert.email + ' – ' + gespeichert.rolle }]);
      }
      Zugriff.vergessen();
      var domain = norm(ktx.email).split('@')[1];
      return {
        benutzer: gespeichert,
        hinweis: domain && kuenftig.email.split('@')[1] !== domain
          ? 'Die Adresse gehört nicht zur Vereinsdomain @' + domain + ' – die WebApp ist nur für Konten dieser Domain erreichbar.'
          : null
      };
    });
  }

  // ------------------------------------------------------------------ Einstellungen (_Konfig)

  var ZAHLEN = ['beitragsjahr', 'mandat_verfall_monate', 'fz_wiedervorlage_monate', 'antrag_erinnerung_tage', 'loeschantwort_frist_tage',
    'jugend_bis_alter', 'messung_puffer_max', 'sperre_wartezeit_ms', 'snapshot_sollstellung_jahre'];
  var JANEIN = ['beitrag_anteilig', 'antrag_doppelte_bestaetigung', 'mitgliedsnummer_wiederverwendung', 'tarifwechsel_automatisch',
    'snapshot_einbetten', 'cache_warmhalten'];
  var AUSWAHL = {
    ehrung_zaehlweise: ['letzter_eintritt', 'gesamt'],
    ehrung_stichtag: ['kalenderjahr', 'exakter_tag'],
    funktionsjubilaeum_zaehlweise: ['je_funktion', 'laengste_funktion', 'summe_aller'],
    chronik_bei_anonymisierung: ['namen_entfernen', 'vereinsaemter_behalten', 'entfernen'],
    sepa_format: ['pain.008.001.08', 'pain.008.001.02']
  };
  var TAGMONAT = ['sepa_faelligkeit', 'tarifwechsel_stichtag', 'statistik_einfrieren_am'];
  var URLS = ['impressum_url', 'datenschutz_url'];

  function bearbeitbar(schluessel) {
    return !/^next_id_/.test(schluessel) && schluessel !== 'mitgliedsnummer_naechste';
  }

  function typVon(s) {
    if (hat(ZAHLEN, s)) return 'zahl';
    if (hat(JANEIN, s)) return 'janein';
    if (AUSWAHL[s]) return 'auswahl';
    if (hat(TAGMONAT, s)) return 'tagmonat';
    if (hat(URLS, s)) return 'url';
    if (s === 'verein_glaeubiger_id') return 'glaeubiger';
    if (s === 'ruecklastschrift_gebuehr') return 'betrag';
    return 'text';
  }

  function konfig(ktx) {
    var zeilen = DB.lese(['_Konfig'])._Konfig || [];
    return zeilen.filter(function (z) { return z.schluessel; }).map(function (z) {
      return { schluessel: z.schluessel, wert: z.wert === null ? '' : String(z.wert), beschreibung: z.beschreibung || '',
        bearbeitbar: bearbeitbar(z.schluessel), typ: typVon(z.schluessel), auswahl: AUSWAHL[z.schluessel] || null };
    });
  }

  /** Prüft einen Konfig-Wert; liefert den normalisierten Wert oder wirft einen Feldfehler. */
  function pruefeKonfig(s, wert) {
    var w = String(wert === null || wert === undefined ? '' : wert).trim();
    function nein(text) { throw Fehler.fachlich('Bitte Eingabe prüfen.', [{ feld: 'wert', meldung: text }]); }
    switch (typVon(s)) {
      case 'zahl':
        if (!/^\d+$/.test(w)) nein('Bitte eine ganze Zahl angeben.');
        if (s === 'beitragsjahr' && !/^20\d\d$/.test(w)) nein('Bitte ein Jahr wie 2027 angeben.');
        return w;
      case 'janein':
        if (w !== 'ja' && w !== 'nein') nein('Bitte „ja“ oder „nein“.');
        return w;
      case 'auswahl':
        if (!hat(AUSWAHL[s], w)) nein('Erlaubt: ' + AUSWAHL[s].join(', '));
        return w;
      case 'tagmonat':
        if (!/^(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.$/.test(w)) nein('Bitte im Format TT.MM. angeben, z. B. 15.02.');
        return w;
      case 'url':
        if (!/^https:\/\/[^\s]+$/i.test(w)) nein('Bitte eine Adresse mit https:// angeben.');
        return w;
      case 'betrag':
        if (!/^\d+(,\d{1,2})?$/.test(w)) nein('Bitte einen Betrag wie 5,00 angeben.');
        return w;
      case 'glaeubiger':
        var p = Iban.glaeubigerIdPruefen(w);
        if (!p.ok) nein(p.fehler === 'platzhalter' ? 'Das ist noch der Platzhalter – bitte die echte Gläubiger-ID eintragen.' : 'Die Gläubiger-ID ist ungültig (Format oder Prüfziffer).');
        return p.id;
      default:
        if (w.length > 500) nein('Höchstens 500 Zeichen.');
        return w;
    }
  }

  function konfigSpeichern(ktx, schluessel, wert, bisher) {
    var s = String(schluessel || '');
    if (!bearbeitbar(s)) throw Fehler.fachlich('Dieser Wert wird vom System verwaltet und kann nicht geändert werden.');
    var neu = pruefeKonfig(s, wert);
    return DB.mitSperre(function () {
      var b = DB.blatt('_Konfig');
      var kopf = b.getRange(1, 1, 1, b.getLastColumn()).getValues()[0].map(function (k) { return String(k).trim(); });
      var letzte = b.getLastRow();
      DB.zaehle(3);
      var iS = kopf.indexOf('schluessel'), iW = kopf.indexOf('wert');
      var werte = letzte >= 2 ? b.getRange(2, 1, letzte - 1, kopf.length).getValues() : [];
      DB.zaehle(1);
      var nr = -1, alt = null;
      for (var i = 0; i < werte.length; i++) {
        if (String(werte[i][iS]).trim() === s) { nr = i + 2; alt = werte[i][iW] === null ? '' : String(werte[i][iW]); break; }
      }
      if (nr < 0) throw Fehler.fachlich('Diesen Schlüssel gibt es nicht. Neue Einstellungen legt nur das Setup an.');
      if (bisher !== undefined && bisher !== null && String(bisher) !== alt) {
        throw Fehler.konflikt({ schluessel: s, wert: alt });
      }
      if (alt === neu) return { schluessel: s, wert: neu, geaendert: false };
      b.getRange(nr, iW + 1).setValue(String(neu));
      DB.zaehle(1);
      DB.vorratLeeren();
      Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: '_Konfig', datensatz_id: s, feld: 'wert', alt_wert: alt, neu_wert: neu }]);
      Konfig.vergessen();
      Snapshot.verwerfen();
      return { schluessel: s, wert: neu, geaendert: true };
    });
  }

  // ------------------------------------------------------------------ Stammdaten

  function pruefeStammTab(tab) {
    if (!hat(STAMMDATEN, tab)) throw Fehler.fachlich('Unbekannte Stammdaten-Art.');
  }

  function stammdaten(ktx, tab) {
    pruefeStammTab(tab);
    var zeilen = DB.lese([tab])[tab] || [];
    return { tab: tab, idSpalte: Schema.TABELLEN[tab].idSpalte, zeilen: zeilen.map(function (z) { return Rechte.schneide(ktx, tab, z); }) };
  }

  function stammdatenSpeichern(ktx, tab, id, version, werte) {
    pruefeStammTab(tab);
    return DB.mitSperre(function () {
      var felder = zahlenNormalisieren(tab, Rechte.erlaubteSchreibfelder(ktx, tab, werte || {}));
      if (!id && felder.aktiv === undefined && Schema.TABELLEN[tab].spalten.some(function (s) { return s.name === 'aktiv'; })) felder.aktiv = true;
      if (tab === 'Funktionsart' && felder.ebene === 'Verein' && felder.fz_pflichtig === undefined) { /* nichts erzwingen */ }
      var gespeichert, idSpalte = Schema.TABELLEN[tab].idSpalte;
      if (id) {
        var r = DB.aktualisieren(tab, id, felder, version, ktx);
        gespeichert = r.neu;
        Protokoll.schreibe(ktx, Protokoll.ausDiff(tab, id, r.diff));
      } else {
        gespeichert = DB.einfuegen(tab, felder, ktx);
        Protokoll.schreibe(ktx, [{ aktion: 'angelegt', tabelle: tab, datensatz_id: gespeichert[idSpalte],
          kommentar: gespeichert.bezeichnung || gespeichert.datenkategorie || '' }]);
      }
      var antwort = hat(SNAPSHOT_TABS, tab) ? Snapshot.schreibe(ktx, [{ tab: tab, neu: gespeichert }]) : { aktualisiert: {}, entfernt: {} };
      antwort.datensatz = Rechte.schneide(ktx, tab, gespeichert);
      return antwort;
    });
  }

  // ------------------------------------------------------------------ Datenqualität

  function pruefung() {
    var d = DB.lese(PRUEF_TABS);
    var befunde = Pruefregeln.pruefe(d, heute(), Konfig.alle());
    var namen = {};
    (d.Mitglied || []).forEach(function (m) { namen[m.mitglied_id] = [m.nachname, m.vorname].filter(Boolean).join(', ') + ' (' + (m.mitgliedsnummer || '') + ')'; });
    befunde.forEach(function (b) {
      b.titel = (Pruefregeln.REGELN[b.regel] || {}).titel || b.regel;
      if (b.mitglied_id) b.person = namen[b.mitglied_id] || '';
    });
    var z = Pruefregeln.zusammenfassung(befunde);
    try { CacheService.getScriptCache().put(CACHE_PRUEFUNG, JSON.stringify({ fehler: z.fehler, warnung: z.warnung, hinweis: z.hinweis, stand: DB.jetzt() }), 900); } catch (e) { /* nur Beschleunigung */ }
    return { befunde: befunde, zusammenfassung: z };
  }

  /** Nur die Zählung (für die Startseite) – 15 Minuten im Cache, damit der Start nicht jedes Mal alles prüft. */
  function pruefungZusammenfassung() {
    try {
      var c = CacheService.getScriptCache().get(CACHE_PRUEFUNG);
      if (c) return JSON.parse(c);
    } catch (e) { /* neu rechnen */ }
    var z = pruefung().zusammenfassung;
    return { fehler: z.fehler, warnung: z.warnung, hinweis: z.hinweis, stand: DB.jetzt() };
  }

  // ------------------------------------------------------------------ Hinweise und System

  function hinweise(ktx) {
    var k = Konfig.alle();
    var d = DB.lese(['Beitragsart', 'Ehrungsregel', 'Funktionsart', 'Qualifikationsart', 'Aufbewahrungsfrist', 'Benutzer', 'Betroffenenanfrage']);
    var h = [];
    var g = Iban.glaeubigerIdPruefen(k.verein_glaeubiger_id || '');
    if (!g.ok) h.push({ art: 'warnung', text: g.fehler === 'platzhalter' ? 'Die SEPA-Gläubiger-ID ist noch der Platzhalter.' : 'Die SEPA-Gläubiger-ID ist ungültig.', ziel: { ansicht: 'verwaltung', param: { reiter: 'einstellungen' } } });
    if (k.sepa_format && k.sepa_format !== 'pain.008.001.08') h.push({ art: 'hinweis', text: 'SEPA-Format steht auf ' + k.sepa_format + ' – für künftige Läufe pain.008.001.08.', ziel: { ansicht: 'verwaltung', param: { reiter: 'einstellungen' } } });
    [['Beitragsart', 'Beitragsarten'], ['Ehrungsregel', 'Ehrungsstufen'], ['Funktionsart', 'Funktionsarten'], ['Qualifikationsart', 'Nachweisarten'], ['Aufbewahrungsfrist', 'Aufbewahrungsfristen']].forEach(function (p) {
      var n = (d[p[0]] || []).filter(function (z) { return /BEISPIEL|PRÜFEN|VORSCHLAG/.test(String(z.bemerkung || '') + ' ' + String(z.rechtsgrundlage || '')); }).length;
      if (n) h.push({ art: 'hinweis', text: n + ' ' + p[1] + ' sind noch als BEISPIEL/PRÜFEN/VORSCHLAG markiert – bitte bestätigen oder anpassen.', ziel: { ansicht: 'verwaltung', param: { reiter: 'stammdaten', tab: p[0] } } });
    });
    var rollen = (d.Benutzer || []).filter(function (b) { return b.aktiv === true; }).map(function (b) { return b.rolle; });
    if (rollen.indexOf('Kassier') < 0) h.push({ art: 'hinweis', text: 'Es gibt keinen aktiven Zugang mit der Rolle Kassier.', ziel: { ansicht: 'verwaltung', param: { reiter: 'benutzer' } } });
    var ueberfaellig = (d.Betroffenenanfrage || []).filter(function (a) { return Loeschung.betroffenenFrist(a, heute()).status === 'überfällig'; }).length;
    if (ueberfaellig) h.push({ art: 'warnung', text: ueberfaellig + ' Betroffenenanfrage(n) sind über der Monatsfrist (Art. 12 DSGVO).', ziel: { ansicht: 'datenschutz', param: { reiter: 'anfragen' } } });
    return h;
  }

  function system(ktx) {
    var basis = Snapshot.basis();
    var zeilen = {};
    Object.keys(basis.tabs || {}).forEach(function (t) { zeilen[t] = (basis.tabs[t] || []).length; });
    ['Benutzer', 'Aufbewahrungsfrist', 'Betroffenenanfrage', 'Statistik_Jahr', 'Aufnahmeantrag', '_Protokoll', '_Messung'].forEach(function (t) {
      try { zeilen[t] = Math.max(0, DB.blatt(t).getLastRow() - 1); DB.zaehle(2); } catch (e) { zeilen[t] = null; }
    });
    return {
      snapshot_gebaut_am: basis.gebaut_am || null,
      cache: Snapshot.letzterCache(),
      zeilen: zeilen,
      jetzt: DB.jetzt()
    };
  }

  function snapshotNeu(ktx) {
    Snapshot.verwerfen();
    Konfig.vergessen();
    Zugriff.vergessen();
    try { CacheService.getScriptCache().remove(CACHE_PRUEFUNG); } catch (e) { /* egal */ }
    DB.vorratLeeren();
    var b = Snapshot.basis();
    Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: '_Konfig', datensatz_id: '-', kommentar: 'Snapshot-Cache neu aufgebaut' }]);
    return { snapshot_gebaut_am: b.gebaut_am || null };
  }

  return {
    benutzer: benutzer, benutzerSpeichern: benutzerSpeichern, warnliste: warnliste,
    konfig: konfig, konfigSpeichern: konfigSpeichern, pruefeKonfig: pruefeKonfig,
    stammdaten: stammdaten, stammdatenSpeichern: stammdatenSpeichern, STAMMDATEN: STAMMDATEN,
    pruefung: pruefung, pruefungZusammenfassung: pruefungZusammenfassung,
    hinweise: hinweise, system: system, snapshotNeu: snapshotNeu
  };
})();
