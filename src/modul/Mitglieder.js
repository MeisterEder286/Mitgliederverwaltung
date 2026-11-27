/**
 * Mitglieder – Servermodul für Personen, Mitgliedschaft, Abteilungszugehörigkeiten und Funktionen.
 *
 * Zweck:      Fachliche Abläufe, die mehrere Tabs auf einmal betreffen und deshalb unter EINER Sperre laufen:
 *             Mitglied anlegen (Person + erster Zeitraum + Abteilungen), Neuaufnahme einer Person oder Familie
 *             samt Zahler (neues Konto / vorhandenes Konto, Beitragsgemeinschaft – aufnehmen), bearbeiten, Austritt mit Konto-Guard,
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
  var EXAKTSUCHE_MAX = 30;          // Suchen je Benutzer und Stunde
  var EXAKTSUCHE_MAX_TAG = 60;      // Suchen je Benutzer und Tag (Befund M3: Durchzählen erschweren)
  var TOKEN_DAUER_S = 600;          // so lange gilt ein Treffer-Token für „Zuordnen“
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

  /** Formulareingaben typgerecht wandeln (gemeinsame Hilfe Werte.ausFormular). */
  function typisiere(tab, obj) { return Werte.ausFormular(tab, obj); }

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
    var roh = DB.zaehlerWert('mitgliedsnummer_naechste');   // _Konfig je Sperre nur einmal gelesen
    var start = roh === null ? 1 : Number(String(roh).replace(/\D/g, '')) || 1;
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
    DB.zaehlerSetzen('mitgliedsnummer_naechste', naechste, 'Nächste freie Mitgliedsnummer');
    try { Konfig.vergessen(); } catch (e) { /* Cache-Fehler sind unkritisch */ }
    return text;
  }

  // ================================================================== Bearbeiten

  /**
   * Stammdaten speichern; optional in derselben Sperre auch „Wer zahlt?“ ändern (zahlungEingabe, siehe zahlungAendern).
   */
  function speichern(ktx, id, version, werte, zahlungEingabe) {
    var zahlungGeaendert = zahlungEingabe && ((zahlungEingabe.zahlung || {}).art || 'unveraendert') + '|' + ((zahlungEingabe.gemeinschaft || {}).art || 'unveraendert') !== 'unveraendert|unveraendert';
    if (zahlungGeaendert && !Rechte.darf(ktx, 'konto_bearbeiten')) throw Fehler.keinZugriff();
    return DB.mitSperre(function () {
      Snapshot.pruefeMitglied(ktx, id);
      var alt = mitglied(id);
      var felder = typisiere('Mitglied', Rechte.erlaubteSchreibfelder(ktx, 'Mitglied', werte || {}));
      delete felder.status;          // Cache, nur vom Skript
      delete felder.mitgliedsnummer; // bleibt lebenslang gleich
      if (zahlungEingabe) { delete felder.beitragskonto_id; delete felder.beitragsgemeinschaft_id; }   // laufen über zahlungAendern
      // Datenschutz-Status nur über den Datenschutz-Ablauf (Sperren/Anonymisieren mit Protokoll), nicht per
      // normalem Bearbeiten (Befund N2 der Sicherheitsprüfung).
      ['anonymisiert', 'anonymisiert_am', 'verarbeitung_eingeschraenkt', 'sperre_grund', 'loeschbar_ab']
        .forEach(function (f) { delete felder[f]; });
      pruefeSchema('Mitglied', felder, true);
      var p = plausibel(felder, alt);
      feldfehler(p.fehler);
      var hinweise = p.warnungen.slice();
      var plan = zahlungGeaendert ? zahlungPlanen(ktx, alt, zahlungEingabe) : null;   // prüft alles VOR dem ersten Schreiben
      var r = DB.aktualisieren('Mitglied', id, felder, version, ktx);
      var aenderungen = [{ tab: 'Mitglied', neu: r.neu }];
      var protokoll = Protokoll.ausDiff('Mitglied', id, r.diff);
      if (Object.prototype.hasOwnProperty.call(felder, 'sterbedatum')) statusNachziehen(ktx, r.neu, null, aenderungen, protokoll);
      if (plan) zahlungSchreiben(ktx, plan, aenderungen[aenderungen.length - 1].neu, aenderungen, protokoll, hinweise);
      return antwort(ktx, aenderungen, protokoll, { hinweise: hinweise });
    });
  }

  /**
   * „Wer zahlt?“ für ein bestehendes Mitglied prüfen. eingabe: {
   *   zahlung: { art: 'unveraendert' } | { art: 'neu', konto: {…}, inhaber: { art: 'selbst' } | { art: 'mitglied', mitglied_id } | null, trotzIban }
   *          | { art: 'konto', beitragskonto_id } | { art: 'keine' },
   *   mitGemeinschaft: true → die übrigen aktiven Mitglieder der bisherigen Gemeinschaft wechseln mit auf das neue Konto,
   *   gemeinschaft: { art: 'unveraendert' | 'keine' } | { art: 'bestehend', beitragsgemeinschaft_id }
   *              | { art: 'neu', gemeinschaftsart_id, bezeichnung, festbetrag, mit: [mitglied_id …] (weitere Zahler des Kontos) } }
   * Wirft Feldfehler (bereich 'zahlung' / 'gemeinschaft'); liefert den Plan für zahlungSchreiben.
   */
  function zahlungPlanen(ktx, m, eingabe) {
    var h = heute(), fehler = [];
    var z = eingabe.zahlung || { art: 'unveraendert' }, gw = eingabe.gemeinschaft || { art: 'unveraendert' };
    if (['unveraendert', 'neu', 'konto', 'keine'].indexOf(z.art) < 0) throw Fehler.fachlich('Bitte angeben, wer den Beitrag zahlt.');
    if (['unveraendert', 'keine', 'bestehend', 'neu'].indexOf(gw.art) < 0) throw Fehler.fachlich('Unbekannte Auswahl bei der Beitragsgemeinschaft.');
    function aktiv(x) { return x.anonymisiert !== true && Mitgliedschaft.status(x, zeitraeume(x.mitglied_id), h) === 'aktiv'; }
    var plan = { zielKonto: m.beitragskonto_id || null, kontoNeu: null, gemNeu: null, zielGem: m.beitragsgemeinschaft_id || null, mitziehen: [], aufnehmen: [] };

    if (z.art === 'keine') plan.zielKonto = null;
    else if (z.art === 'konto') {
      var k = finde('Beitragskonto', 'beitragskonto_id', z.beitragskonto_id);
      if (!k) fehler.push({ bereich: 'zahlung', feld: 'beitragskonto_id', meldung: 'Das gewählte Konto wurde nicht gefunden.' });
      else if (k.aktiv === false) fehler.push({ bereich: 'zahlung', feld: 'beitragskonto_id', meldung: 'Das gewählte Konto ist stillgelegt.' });
      else plan.zielKonto = k.beitragskonto_id;
    } else if (z.art === 'neu') {
      var zz = {};
      Object.keys(z).forEach(function (f) { zz[f] = z[f]; });
      if (zz.inhaber && zz.inhaber.art === 'selbst') zz.inhaber = { art: 'mitglied', mitglied_id: m.mitglied_id };
      plan.kontoNeu = pruefeKontoNeu(zz, null, fehler);
      plan.bezugNr = m.mitgliedsnummer;
      if (zz.inhaber && zz.inhaber.art === 'mitglied') { var im = finde('Mitglied', 'mitglied_id', zz.inhaber.mitglied_id); if (im) plan.bezugNr = im.mitgliedsnummer; }
      plan.zielKonto = 'neu';
    }
    var kontoWechsel = plan.zielKonto !== (m.beitragskonto_id || null);

    // Bisherige Gemeinschaft: ganze Familie mitnehmen?
    var altGem = m.beitragsgemeinschaft_id || null;
    var andereAlt = altGem ? (daten().Mitglied || []).filter(function (x) { return x.mitglied_id !== m.mitglied_id && x.beitragsgemeinschaft_id === altGem && aktiv(x); }) : [];
    if (kontoWechsel && eingabe.mitGemeinschaft === true && altGem) {
      if (plan.zielKonto === null) fehler.push({ bereich: 'zahlung', feld: 'beitragskonto_id', meldung: 'Eine Familie kann nicht ohne Konto weitergeführt werden – bitte ein Konto wählen oder die Gemeinschaft verlassen.' });
      plan.mitziehen = andereAlt;
    }

    if (gw.art === 'keine') plan.zielGem = null;
    else if (gw.art === 'unveraendert') {
      if (altGem && kontoWechsel && andereAlt.length && !plan.mitziehen.length) {
        fehler.push({ bereich: 'gemeinschaft', feld: 'beitragsgemeinschaft_id', meldung: 'Die Person gehört zu einer Beitragsgemeinschaft, deren übrige Mitglieder über Konto ' + m.beitragskonto_id +
          ' zahlen. Bitte „ganze Familie wechselt mit“ wählen oder die Gemeinschaft verlassen.' });
      }
    } else if (gw.art === 'bestehend') {
      var g = finde('Beitragsgemeinschaft', 'beitragsgemeinschaft_id', gw.beitragsgemeinschaft_id);
      if (!g || g.aktiv === false) fehler.push({ bereich: 'gemeinschaft', feld: 'beitragsgemeinschaft_id', meldung: 'Die Beitragsgemeinschaft wurde nicht gefunden.' });
      else {
        var gk = kontoDerGemeinschaft(g.beitragsgemeinschaft_id, m.mitglied_id);
        if (gk && gk !== plan.zielKonto) fehler.push({ bereich: 'gemeinschaft', feld: 'beitragsgemeinschaft_id', meldung: 'Alle Mitglieder einer Beitragsgemeinschaft zahlen über dasselbe Konto (Nr. ' + gk + ') – bitte dieses Konto als Zahler wählen.' });
        plan.zielGem = g.beitragsgemeinschaft_id;
      }
    } else if (gw.art === 'neu') {
      plan.gemNeu = pruefeGemeinschaftNeu(gw, fehler);
      if (plan.zielKonto === null) fehler.push({ bereich: 'gemeinschaft', feld: 'bezeichnung', meldung: 'Für eine Beitragsgemeinschaft muss feststehen, über welches Konto gezahlt wird.' });
      (Array.isArray(gw.mit) ? gw.mit : []).forEach(function (mid) {
        var x = finde('Mitglied', 'mitglied_id', mid);
        if (!x || x.mitglied_id === m.mitglied_id || !aktiv(x)) return;
        var kontoX = plan.mitziehen.indexOf(x) >= 0 ? plan.zielKonto : x.beitragskonto_id;
        if (kontoX !== plan.zielKonto) { fehler.push({ bereich: 'gemeinschaft', feld: 'bezeichnung', meldung: name(x) + ' zahlt über ein anderes Konto und kann nicht in diese Gemeinschaft.' }); return; }
        if (x.beitragsgemeinschaft_id && x.beitragsgemeinschaft_id !== altGem) { fehler.push({ bereich: 'gemeinschaft', feld: 'bezeichnung', meldung: name(x) + ' gehört schon zu einer anderen Gemeinschaft.' }); return; }
        plan.aufnehmen.push(x);
      });
      plan.zielGem = 'neu';
    }
    feldfehler(fehler);
    plan.altKonto = m.beitragskonto_id || null;
    plan.altGem = altGem;
    plan.andereAlt = andereAlt;
    plan.kontoWechsel = kontoWechsel;
    return plan;
  }

  /** Plan aus zahlungPlanen schreiben (in derselben Sperre); m = aktuelle Zeile des Mitglieds nach dem Speichern der Stammdaten. */
  function zahlungSchreiben(ktx, plan, m, aenderungen, protokoll, hinweise) {
    var h = heute();
    var konto = null;
    if (plan.kontoNeu) {
      konto = schreibeKontoNeu(ktx, plan.kontoNeu, plan.bezugNr, h, 'Zahlerwechsel ' + h, protokoll, function (tab, o) { return DB.einfuegen(tab, o, ktx); });
      aenderungen.push({ tab: 'Beitragskonto', neu: konto });
      if (konto.zahlweg === 'Lastschrift') hinweise.push('Neues Mandat ' + konto.mandatsreferenz + ': Der erste Einzug läuft als Erstlastschrift (FRST).');
    }
    var kontoId = plan.zielKonto === 'neu' ? konto.beitragskonto_id : plan.zielKonto;
    var gem = null;
    if (plan.gemNeu) {
      gem = DB.einfuegen('Beitragsgemeinschaft', plan.gemNeu, ktx);
      aenderungen.push({ tab: 'Beitragsgemeinschaft', neu: gem });
      protokoll.push({ aktion: 'angelegt', tabelle: 'Beitragsgemeinschaft', datensatz_id: gem.beitragsgemeinschaft_id, kommentar: gem.bezeichnung });
    }
    var gemId = plan.zielGem === 'neu' ? gem.beitragsgemeinschaft_id : plan.zielGem;
    var neu = {};   // mitglied_id → neue Zeile
    function setze(x, werte) {
      var aend = {};
      Object.keys(werte).forEach(function (f) { if ((x[f] || null) !== (werte[f] || null)) aend[f] = werte[f]; });
      if (!Object.keys(aend).length) { neu[x.mitglied_id] = x; return; }
      var r = DB.aktualisieren('Mitglied', x.mitglied_id, aend, x.version, ktx);
      neu[x.mitglied_id] = r.neu;
      aenderungen.push({ tab: 'Mitglied', neu: r.neu });
      Protokoll.ausDiff('Mitglied', x.mitglied_id, r.diff).forEach(function (pr) { pr.kommentar = 'Zahler geändert'; protokoll.push(pr); });
    }
    setze(m, { beitragskonto_id: kontoId, beitragsgemeinschaft_id: gemId });
    plan.mitziehen.forEach(function (x) { setze(x, { beitragskonto_id: kontoId, beitragsgemeinschaft_id: plan.zielGem === 'neu' || plan.zielGem === plan.altGem ? gemId : x.beitragsgemeinschaft_id }); });
    plan.aufnehmen.forEach(function (x) { setze(neu[x.mitglied_id] || x, { beitragsgemeinschaft_id: gemId }); });

    // Hinweise: altes Konto, alte Gemeinschaft, Regel der neuen Gemeinschaft
    var bewegt = {};
    Object.keys(neu).forEach(function (k) { bewegt[k] = true; });
    var alle = (daten().Mitglied || []).map(function (x) { return neu[x.mitglied_id] || x; });
    function aktiv(x) { return x.anonymisiert !== true && Mitgliedschaft.status(x, zeitraeume(x.mitglied_id), h) === 'aktiv'; }
    if (plan.altKonto && plan.altKonto !== kontoId) {
      var rest = alle.filter(function (x) { return x.beitragskonto_id === plan.altKonto && aktiv(x); });
      var altK = finde('Beitragskonto', 'beitragskonto_id', plan.altKonto);
      if (!rest.length) hinweise.push('Über Konto ' + plan.altKonto + ' zahlt jetzt niemand mehr – in Finanzen stilllegen.');
      else if (altK && altK.kontoinhaber_mitglied_id === m.mitglied_id) hinweise.push(name(m) + ' ist Inhaber von Konto ' + plan.altKonto + ', über das weiter ' + rest.map(name).join(', ') + ' zahlen – bitte prüfen, ob das so bleiben soll.');
    }
    if (plan.altGem && plan.altGem !== gemId) {
      var restG = alle.filter(function (x) { return x.beitragsgemeinschaft_id === plan.altGem && aktiv(x); });
      if (restG.length <= 1) hinweise.push('In der bisherigen Gemeinschaft ' + (restG.length ? 'bleibt nur ' + name(restG[0]) : 'bleibt niemand') + ' – in Finanzen auflösen bzw. Einzelbeitrag.');
    }
    if (gemId) {
      var g = gem || finde('Beitragsgemeinschaft', 'beitragsgemeinschaft_id', gemId);
      regelHinweise(g, konto || finde('Beitragskonto', 'beitragskonto_id', kontoId), h, hinweise, alle);
    }
    if (!kontoId && Rechte.sichtbareSpalten(ktx, 'Mitglied').indexOf('beitragskonto_id') >= 0) hinweise.push('Kein Beitragskonto – Zahlweg offen (Klärliste).');
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
      // Status gleich richtig schreiben (statt Einfügen + zweitem Änderungslauf an derselben Zeile)
      felder.status = Mitgliedschaft.status(felder, [{ eintrittsdatum: eingabe.eintrittsdatum, austrittsdatum: null }], heute());
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

  // ================================================================== Aufnahme (eine oder mehrere Personen + Zahlung)

  var VERTRETUNG_FELDER = ['vertreter_mitglied_id', 'vertreter_name', 'vertreter_kontakt'];
  var ZAHLUNG_FELDER = ['beitragskonto_id', 'beitragsgemeinschaft_id'];

  /** Alter in vollen Jahren am Stichtag (beides 'JJJJ-MM-TT'); null ohne Geburtsdatum. */
  function alterAm(geb, tag) {
    if (!istDatum(geb) || !istDatum(tag)) return null;
    return Number(tag.slice(0, 4)) - Number(geb.slice(0, 4)) - (tag.slice(5) < geb.slice(5) ? 1 : 0);
  }

  /**
   * Neues Beitragskonto prüfen (gemeinsam für Neuaufnahme und Bearbeiten). inhaberName(index) liefert den Namen
   * einer Person aus dem Antrag (nur Neuaufnahme). Feldfehler landen mit bereich 'zahlung' in fehler.
   * Liefert { werte, inhaberIndex, kontenKlar } – werte null, wenn die Prüfung scheiterte.
   */
  function pruefeKontoNeu(zahlung, inhaberName, fehler) {
    var k = {};
    Object.keys(zahlung.konto || {}).forEach(function (f) { k[f] = zahlung.konto[f]; });
    delete k.mandatsreferenz; delete k.kontoinhaber_mitglied_id; delete k.aktiv;
    var inh = zahlung.inhaber || null, inhaberIndex = null;
    if (inh && inh.art === 'antrag' && inhaberName) {
      inhaberIndex = Number(inh.index);
      var n = inhaberName(inhaberIndex);
      if (n === null) fehler.push({ bereich: 'zahlung', feld: 'kontoinhaber_name', meldung: 'Kontoinhaber: Person nicht im Antrag.' });
      else if (!k.kontoinhaber_name) k.kontoinhaber_name = n;
    } else if (inh && inh.art === 'mitglied') {
      var im = finde('Mitglied', 'mitglied_id', inh.mitglied_id);
      if (!im) fehler.push({ bereich: 'zahlung', feld: 'kontoinhaber_name', meldung: 'Kontoinhaber: Mitglied nicht gefunden.' });
      else { k.kontoinhaber_mitglied_id = im.mitglied_id; if (!k.kontoinhaber_name) k.kontoinhaber_name = [im.vorname, im.nachname].filter(Boolean).join(' '); }
    }
    if (k.zahlweg === 'Lastschrift') k.mandatsreferenz = 'TSV-PRUEFUNG';   // echte Referenz erst beim Schreiben
    var kontenKlar = DB.lese(['Beitragskonto']).Beitragskonto || [];
    var werte = null;
    try { werte = Finanzen.kontoPruefen(k, null, kontenKlar); } catch (e) {
      if (Fehler.artVon(e) !== 'fachlich') throw e;
      (e.felder || [{ feld: 'iban', meldung: e.meldung }]).forEach(function (f) { f.bereich = 'zahlung'; fehler.push(f); });
    }
    if (werte && werte.iban && zahlung.trotzIban !== true) {
      var gleich = kontenKlar.filter(function (x) { return x.iban && x.aktiv !== false && Iban.normalisiere(x.iban) === werte.iban; });
      if (gleich.length) fehler.push({ bereich: 'zahlung', feld: 'iban', meldung: 'Diese IBAN gehört bereits zu Konto ' +
        gleich.map(function (x) { return x.beitragskonto_id + ' (' + x.kontoinhaber_name + ')'; }).join(', ') + ' – bitte dieses Konto verwenden oder bestätigen, dass ein eigenes Konto nötig ist.' });
    }
    return { werte: werte, inhaberIndex: inhaberIndex, kontenKlar: kontenKlar };
  }

  /** Neues Konto schreiben: Mandatsreferenz TSV-<Jahr>-<Mitgliedsnr> vergeben, einfügen, Protokoll vormerken. */
  function schreibeKontoNeu(ktx, plan, bezugNr, h, bemerkung, protokoll, einfuegen) {
    var w = plan.werte;
    if (w.zahlweg === 'Lastschrift') {
      var vergeben = {};
      plan.kontenKlar.forEach(function (x) { if (x.mandatsreferenz) vergeben[x.mandatsreferenz] = true; });
      w.mandatsreferenz = Beitritt.mandatsreferenz(String(w.mandatsdatum || h).slice(0, 4), bezugNr, vergeben);
    } else w.mandatsreferenz = null;
    w.aktiv = true;
    if (!w.bemerkung) w.bemerkung = bemerkung;
    var konto = einfuegen('Beitragskonto', w);
    protokoll.push({ aktion: 'angelegt', tabelle: 'Beitragskonto', datensatz_id: konto.beitragskonto_id,
      kommentar: bemerkung + ': ' + konto.kontoinhaber_name + ' · ' + konto.zahlweg + (konto.iban ? ', IBAN ' + Iban.maskiere(konto.iban) : '') });
    if (konto.mandatsreferenz) protokoll.push({ aktion: 'geändert', tabelle: 'Beitragskonto', datensatz_id: konto.beitragskonto_id, feld: 'mandatsreferenz', alt_wert: '', neu_wert: konto.mandatsreferenz });
    return konto;
  }

  /** Neue Beitragsgemeinschaft prüfen (mit Regel: Betrag der Regel, falls kein eigener Festbetrag). Liefert Werte oder null. */
  function pruefeGemeinschaftNeu(gemWahl, fehler) {
    var w = { bezeichnung: String(gemWahl.bezeichnung || '').trim() || null, festbetrag: gemWahl.festbetrag === '' || gemWahl.festbetrag === undefined ? null : gemWahl.festbetrag, aktiv: true };
    if (w.festbetrag !== null) w.festbetrag = Number(String(w.festbetrag).replace(',', '.'));
    if (!leer(gemWahl.gemeinschaftsart_id)) {
      var gArt = finde('Gemeinschaftsart', 'gemeinschaftsart_id', gemWahl.gemeinschaftsart_id);
      if (!gArt || gArt.aktiv === false) fehler.push({ bereich: 'gemeinschaft', feld: 'gemeinschaftsart_id', meldung: 'Die gewählte Regel (Familien-/Ehegattenbeitrag) gibt es nicht (mehr).' });
      else {
        w.gemeinschaftsart_id = gArt.gemeinschaftsart_id;
        if (w.festbetrag === null && !leer(gArt.betrag)) w.festbetrag = Number(gArt.betrag);
      }
    }
    if (!w.bezeichnung) fehler.push({ bereich: 'gemeinschaft', feld: 'bezeichnung', meldung: 'Bezeichnung: Angabe fehlt (z. B. „Familie Muster“).' });
    if (w.festbetrag !== null && !(w.festbetrag >= 0)) fehler.push({ bereich: 'gemeinschaft', feld: 'festbetrag', meldung: 'Festbetrag: bitte einen Betrag ≥ 0 angeben.' });
    return w;
  }

  /** Konto, über das die (aktiven) Mitglieder einer Gemeinschaft zahlen – oder null. */
  function kontoDerGemeinschaft(gid, ohne) {
    var m = (daten().Mitglied || []).filter(function (x) { return x.beitragsgemeinschaft_id === gid && x.beitragskonto_id && x.mitglied_id !== ohne && x.anonymisiert !== true; })[0];
    return m ? m.beitragskonto_id : null;
  }

  /** Regel einer Gemeinschaft prüfen und Abweichungen als Hinweise anhängen. */
  function regelHinweise(gem, konto, h, hinweise, alle) {
    if (!gem) return;
    var konfig = Konfig.alle();
    var art = !leer(gem.gemeinschaftsart_id) ? finde('Gemeinschaftsart', 'gemeinschaftsart_id', gem.gemeinschaftsart_id) : null;
    var mitglieder = (alle || daten().Mitglied || []).filter(function (m) {
      return m.beitragsgemeinschaft_id === gem.beitragsgemeinschaft_id && m.anonymisiert !== true && Mitgliedschaft.status(m, zeitraeume(m.mitglied_id), h) === 'aktiv';
    });
    if (!mitglieder.length) return;
    Familie.pruefeGemeinschaft(gem, art, mitglieder, konto, Familie.stichtag(konfig, Number(h.slice(0, 4))), h, konfig)
      .abweichungen.forEach(function (a) { if (a.regel !== 'nachweis_faellig') hinweise.push('Abweichung: ' + a.meldung); });
  }

  /**
   * Neuaufnahme in EINER Sperre: eine Person oder eine ganze Familie, dazu wer zahlt und ggf. die Beitragsgemeinschaft.
   * eingabe: {
   *   eintrittsdatum, antrag_am?,
   *   personen: [{ mitglied: {…}, abteilungen: [{ abteilung_id, status }], trotzDublette,
   *                vertretung: null | { art: 'antrag', index } | { art: 'mitglied', mitglied_id } | { art: 'frei', name, kontakt } }],
   *   zahlung: { art: 'neu', konto: { zahlweg, iban, bic, mandatsdatum, kontoinhaber_name, abw_… }, inhaber: { art: 'antrag', index } | { art: 'mitglied', mitglied_id } | null, trotzIban }
   *          | { art: 'konto', beitragskonto_id } | { art: 'spaeter' },
   *   gemeinschaft: { art: 'keine' } | { art: 'neu', gemeinschaftsart_id, bezeichnung, festbetrag, mit: [mitglied_id …] } | { art: 'bestehend', beitragsgemeinschaft_id }
   *   (mit = Personen, die schon über das gewählte Konto zahlen und mit in die neue Gemeinschaft kommen)
   *   (gemeinschaftsart_id = Regel, z. B. Familienbeitrag; ohne festbetrag gilt deren Betrag)
   * }
   * Feldfehler tragen { person: i } bzw. { bereich: 'zahlung' | 'gemeinschaft' }, damit der Browser sie zuordnen kann.
   * Gesetzliche Vertretung wird nur bei Minderjährigen übernommen. Scheitert ein Schreibschritt, werden die bereits
   * geschriebenen Zeilen wieder entfernt (alles oder nichts).
   */
  function aufnehmen(ktx, eingabe) {
    eingabe = eingabe || {};
    var personenRoh = Array.isArray(eingabe.personen) ? eingabe.personen : [];
    if (!personenRoh.length) throw Fehler.fachlich('Bitte mindestens eine Person erfassen.');
    if (personenRoh.length > 20) throw Fehler.fachlich('Höchstens 20 Personen in einem Antrag.');
    var zahlung = eingabe.zahlung || { art: 'spaeter' };
    var gemWahl = eingabe.gemeinschaft || { art: 'keine' };
    if (['neu', 'konto', 'spaeter'].indexOf(zahlung.art) < 0) throw Fehler.fachlich('Bitte angeben, wer den Beitrag zahlt.');
    if (['keine', 'neu', 'bestehend'].indexOf(gemWahl.art) < 0) throw Fehler.fachlich('Unbekannte Auswahl bei der Beitragsgemeinschaft.');
    var finanzRecht = Rechte.darf(ktx, 'konto_bearbeiten');
    if ((zahlung.art !== 'spaeter' || gemWahl.art !== 'keine') && !finanzRecht) throw Fehler.keinZugriff();

    return DB.mitSperre(function () {
      var h = heute();
      var fehler = [], hinweise = [];
      var eintritt = eingabe.eintrittsdatum;
      if (!istDatum(eintritt)) fehler.push({ feld: 'eintrittsdatum', meldung: 'Eintrittsdatum: Angabe fehlt (TT.MM.JJJJ).' });

      // 1. Personen prüfen
      var personen = personenRoh.map(function (p, i) {
        p = p || {};
        var felder = typisiere('Mitglied', Rechte.erlaubteSchreibfelder(ktx, 'Mitglied', p.mitglied || {}));
        ['status', 'mitgliedsnummer', 'sterbedatum'].concat(VERTRETUNG_FELDER, ZAHLUNG_FELDER).forEach(function (f) { delete felder[f]; });
        var pr = plausibel(felder, {});
        var fl = pr.fehler.slice();
        felder.mitgliedsnummer = '0';
        fl = fl.concat(Werte.pruefe('Mitglied', felder).filter(function (f) { return f.feld !== 'mitgliedsnummer'; }));
        delete felder.mitgliedsnummer;
        fl.forEach(function (f) { f.person = i; fehler.push(f); });
        pr.warnungen.forEach(function (w) { hinweise.push((personenRoh.length > 1 ? (felder.vorname || 'Person ' + (i + 1)) + ': ' : '') + w); });
        var d = dubletten(felder.nachname, felder.geburtsdatum);
        if (d.length && p.trotzDublette !== true) {
          fehler.push({ person: i, feld: 'nachname', meldung: 'Gleicher Name und Geburtsdatum vorhanden: ' +
            d.map(function (x) { return x.name + ' (Nr. ' + x.mitgliedsnummer + ')'; }).join('; ') + '.' });
        }
        (p.abteilungen || []).forEach(function (a) { pruefeAbteilung(ktx, a.abteilung_id); });
        var alter = alterAm(felder.geburtsdatum, h);
        return { felder: felder, abteilungen: p.abteilungen || [], alter: alter, minderjaehrig: alter !== null && alter < 18, vertretung: p.vertretung || null };
      });

      // 2. Gesetzliche Vertretung (nur Minderjährige)
      personen.forEach(function (p, i) {
        var v = p.vertretung;
        if (!p.minderjaehrig) { p.vertretung = null; return; }   // Volljährige: keine gesetzliche Vertretung
        if (!v) { hinweise.push((p.felder.vorname || 'Person ' + (i + 1)) + ' ist minderjährig – gesetzliche Vertretung noch nicht erfasst.'); return; }
        if (v.art === 'antrag') {
          var j = Number(v.index);
          var ziel = personen[j];
          if (!ziel || j === i) fehler.push({ person: i, feld: 'vertretung', meldung: 'Gesetzliche Vertretung: Bitte eine andere Person aus diesem Antrag wählen.' });
          else if (ziel.minderjaehrig) fehler.push({ person: i, feld: 'vertretung', meldung: 'Gesetzliche Vertretung: Die gewählte Person ist selbst minderjährig.' });
          p.vertretung = { art: 'antrag', index: j };
        } else if (v.art === 'mitglied') {
          var vm = finde('Mitglied', 'mitglied_id', v.mitglied_id);
          if (!vm || vm.anonymisiert === true) fehler.push({ person: i, feld: 'vertretung', meldung: 'Gesetzliche Vertretung: Das Mitglied wurde nicht gefunden.' });
          p.vertretung = { art: 'mitglied', mitglied_id: vm ? vm.mitglied_id : null };
        } else if (v.art === 'frei') {
          var vn = String(v.name || '').trim().slice(0, 200);
          if (!vn) fehler.push({ person: i, feld: 'vertretung', meldung: 'Gesetzliche Vertretung: Name fehlt.' });
          p.vertretung = { art: 'frei', name: vn, kontakt: String(v.kontakt || '').trim().slice(0, 200) || null };
        } else {
          p.vertretung = null;
          hinweise.push((p.felder.vorname || 'Person ' + (i + 1)) + ' ist minderjährig – gesetzliche Vertretung noch nicht erfasst.');
        }
      });

      // 3. Zahlung
      var kontoBestehend = null, kontoNeuWerte = null, inhaberIndex = null;
      var kontenKlar = null;
      if (zahlung.art === 'konto') {
        kontoBestehend = finde('Beitragskonto', 'beitragskonto_id', zahlung.beitragskonto_id);
        if (!kontoBestehend) fehler.push({ bereich: 'zahlung', feld: 'beitragskonto_id', meldung: 'Das gewählte Konto wurde nicht gefunden.' });
        else if (kontoBestehend.aktiv === false) fehler.push({ bereich: 'zahlung', feld: 'beitragskonto_id', meldung: 'Das gewählte Konto ist stillgelegt.' });
      } else if (zahlung.art === 'neu') {
        var kp = pruefeKontoNeu(zahlung, function (i) { var ip = personen[i]; return ip ? [ip.felder.vorname, ip.felder.nachname].filter(Boolean).join(' ') : null; }, fehler);
        kontoNeuWerte = kp.werte; inhaberIndex = kp.inhaberIndex; kontenKlar = kp.kontenKlar;
      }

      // 4. Beitragsgemeinschaft (alle Mitglieder einer Gemeinschaft zahlen über dasselbe Konto)
      var gemBestehend = null, gemNeuWerte = null, gemMit = [];
      if (gemWahl.art === 'bestehend') {
        gemBestehend = finde('Beitragsgemeinschaft', 'beitragsgemeinschaft_id', gemWahl.beitragsgemeinschaft_id);
        if (!gemBestehend || gemBestehend.aktiv === false) fehler.push({ bereich: 'gemeinschaft', feld: 'beitragsgemeinschaft_id', meldung: 'Die Beitragsgemeinschaft wurde nicht gefunden.' });
        else {
          var gKonto = ((daten().Mitglied || []).filter(function (m) { return m.beitragsgemeinschaft_id === gemBestehend.beitragsgemeinschaft_id && m.beitragskonto_id; })[0] || {}).beitragskonto_id;
          var unserKonto = kontoBestehend ? kontoBestehend.beitragskonto_id : null;
          if (gKonto && gKonto !== unserKonto) fehler.push({ bereich: 'gemeinschaft', feld: 'beitragsgemeinschaft_id', meldung: 'Alle Mitglieder einer Beitragsgemeinschaft zahlen über dasselbe Konto (Nr. ' + gKonto + ') – bitte dieses Konto als Zahler wählen.' });
        }
      } else if (gemWahl.art === 'neu') {
        gemNeuWerte = pruefeGemeinschaftNeu(gemWahl, fehler);
        if (zahlung.art === 'spaeter') fehler.push({ bereich: 'gemeinschaft', feld: 'bezeichnung', meldung: 'Für eine Beitragsgemeinschaft muss feststehen, über welches Konto gezahlt wird.' });
        // weitere Personen, die schon über das gewählte Konto zahlen (z. B. Eltern), kommen mit in die neue Gemeinschaft
        (Array.isArray(gemWahl.mit) ? gemWahl.mit : []).forEach(function (mid) {
          var x = finde('Mitglied', 'mitglied_id', mid);
          if (!x || x.anonymisiert === true || Mitgliedschaft.status(x, zeitraeume(x.mitglied_id), heute()) !== 'aktiv') return;
          if (!kontoBestehend || x.beitragskonto_id !== kontoBestehend.beitragskonto_id) { fehler.push({ bereich: 'gemeinschaft', feld: 'bezeichnung', meldung: name(x) + ' zahlt über ein anderes Konto und kann nicht in diese Gemeinschaft.' }); return; }
          if (x.beitragsgemeinschaft_id) { fehler.push({ bereich: 'gemeinschaft', feld: 'bezeichnung', meldung: name(x) + ' gehört schon zu einer Gemeinschaft.' }); return; }
          gemMit.push(x);
        });
      }
      feldfehler(fehler);

      // 5. Schreiben – alles oder nichts
      var geschrieben = [];
      function rein(tab, obj) {
        var neu = DB.einfuegen(tab, obj, ktx);
        geschrieben.push({ tab: tab, id: neu[Schema.TABELLEN[tab].idSpalte] });
        return neu;
      }
      try {
        var aenderungen = [], protokoll = [];
        var nummern = personen.map(function () { return naechsteMitgliedsnummer(); });
        var konto = kontoBestehend;
        if (kontoNeuWerte) {
          konto = schreibeKontoNeu(ktx, { werte: kontoNeuWerte, kontenKlar: kontenKlar }, inhaberIndex !== null ? nummern[inhaberIndex] : nummern[0], h,
            'Neuaufnahme ' + h, protokoll, rein);
        }
        var gem = gemBestehend;
        if (gemNeuWerte) {
          gem = rein('Beitragsgemeinschaft', gemNeuWerte);
          aenderungen.push({ tab: 'Beitragsgemeinschaft', neu: gem });
          protokoll.push({ aktion: 'angelegt', tabelle: 'Beitragsgemeinschaft', datensatz_id: gem.beitragsgemeinschaft_id, kommentar: gem.bezeichnung });
        }
        var neue = personen.map(function (p, i) {
          var f = kopie(p.felder);
          f.mitgliedsnummer = nummern[i];
          f.status = Mitgliedschaft.status(f, [{ eintrittsdatum: eintritt, austrittsdatum: null }], h);
          if (leer(f.land)) f.land = 'DE';
          if (konto) f.beitragskonto_id = konto.beitragskonto_id;
          if (gem) {
            f.beitragsgemeinschaft_id = gem.beitragsgemeinschaft_id;
            if (!leer(gem.festbetrag)) f.beitragsart_id = null;   // die Pauschale deckt den Beitrag – keine zusätzliche Beitragsart
          }
          if (p.vertretung && p.vertretung.art === 'mitglied') f.vertreter_mitglied_id = p.vertretung.mitglied_id;
          if (p.vertretung && p.vertretung.art === 'frei') { f.vertreter_name = p.vertretung.name; f.vertreter_kontakt = p.vertretung.kontakt; }
          var m = rein('Mitglied', f);
          var z = rein('Mitgliedschaftszeitraum', { mitglied_id: m.mitglied_id, eintrittsdatum: eintritt, antrag_am: istDatum(eingabe.antrag_am) ? eingabe.antrag_am : null });
          aenderungen.push({ tab: 'Mitgliedschaftszeitraum', neu: z });
          protokoll.push({ aktion: 'angelegt', tabelle: 'Mitglied', datensatz_id: m.mitglied_id, kommentar: 'Nr. ' + m.mitgliedsnummer + (personen.length > 1 ? ' (Aufnahme mit ' + personen.length + ' Personen)' : '') });
          protokoll.push({ aktion: 'angelegt', tabelle: 'Mitgliedschaftszeitraum', datensatz_id: z.zeitraum_id, kommentar: 'Eintritt ' + z.eintrittsdatum });
          p.abteilungen.forEach(function (a) {
            var zug = rein('Abteilungszugehoerigkeit', { mitglied_id: m.mitglied_id, abteilung_id: Number(a.abteilung_id), status: a.status || 'aktiv', eintrittsdatum: eintritt });
            aenderungen.push({ tab: 'Abteilungszugehoerigkeit', neu: zug });
            protokoll.push({ aktion: 'angelegt', tabelle: 'Abteilungszugehoerigkeit', datensatz_id: zug.zugehoerigkeit_id });
          });
          return m;
        });
        // Nachträge, die die neuen IDs brauchen: Vertretung innerhalb des Antrags, Kontoinhaber aus dem Antrag
        neue = neue.map(function (m, i) {
          var v = personen[i].vertretung;
          if (!v || v.art !== 'antrag') return m;
          var r = DB.aktualisieren('Mitglied', m.mitglied_id, { vertreter_mitglied_id: neue[v.index].mitglied_id }, m.version, ktx);
          return r.neu;
        });
        neue.forEach(function (m) { aenderungen.push({ tab: 'Mitglied', neu: m }); });
        if (kontoNeuWerte && inhaberIndex !== null) {
          konto = DB.aktualisieren('Beitragskonto', konto.beitragskonto_id, { kontoinhaber_mitglied_id: neue[inhaberIndex].mitglied_id }, konto.version, ktx).neu;
        }
        if (kontoNeuWerte) {
          aenderungen.push({ tab: 'Beitragskonto', neu: konto });
          if (konto.zahlweg === 'Lastschrift') hinweise.push('Neues Mandat ' + konto.mandatsreferenz + ': Der erste Einzug läuft als Erstlastschrift (FRST).');
        }
        if (zahlung.art === 'spaeter' && Rechte.sichtbareSpalten(ktx, 'Mitglied').indexOf('beitragskonto_id') >= 0) {
          hinweise.push('Noch kein Beitragskonto zugeordnet – bitte im Bereich Finanzen nachtragen.');
        }
        var gemMitNeu = gemMit.map(function (x) {
          var r = DB.aktualisieren('Mitglied', x.mitglied_id, { beitragsgemeinschaft_id: gem.beitragsgemeinschaft_id }, x.version, ktx);
          aenderungen.push({ tab: 'Mitglied', neu: r.neu });
          Protokoll.ausDiff('Mitglied', x.mitglied_id, r.diff).forEach(function (pr) { pr.kommentar = 'Gemeinschaft bei Neuaufnahme gebildet'; protokoll.push(pr); });
          return r.neu;
        });
        if (gem) {
          // Regel der Gemeinschaft prüfen (neue + bisherige aktive Mitglieder) – Abweichungen sind erlaubt, werden aber gemeldet
          var konfig = Konfig.alle();
          var gArtNeu = !leer(gem.gemeinschaftsart_id) ? finde('Gemeinschaftsart', 'gemeinschaftsart_id', gem.gemeinschaftsart_id) : null;
          var neuIds = {};
          neue.forEach(function (m) { neuIds[m.mitglied_id] = true; });
          var mitIds = {};
          gemMitNeu.forEach(function (m) { mitIds[m.mitglied_id] = true; });
          var bisher = (daten().Mitglied || []).filter(function (m) {
            return !neuIds[m.mitglied_id] && !mitIds[m.mitglied_id] && m.beitragsgemeinschaft_id === gem.beitragsgemeinschaft_id && m.anonymisiert !== true &&
              Mitgliedschaft.status(m, zeitraeume(m.mitglied_id), h) === 'aktiv';
          }).concat(gemMitNeu);
          Familie.pruefeGemeinschaft(gem, gArtNeu, bisher.concat(neue), konto, Familie.stichtag(konfig, Number(h.slice(0, 4))), h, konfig)
            .abweichungen.forEach(function (a) { if (a.regel !== 'nachweis_faellig') hinweise.push('Abweichung: ' + a.meldung); });
        }
        neue.forEach(function (m) {
          if (!m.beitragsart_id && !m.beitragsgemeinschaft_id && Rechte.sichtbareSpalten(ktx, 'Mitglied').indexOf('beitragsart_id') >= 0) {
            hinweise.push(name(m) + ': noch keine Beitragsart – bitte ergänzen (sonst Klärliste).');
          }
        });
        return antwort(ktx, aenderungen, protokoll, {
          mitglieder: neue.map(function (m) { return { mitglied_id: m.mitglied_id, mitgliedsnummer: m.mitgliedsnummer, name: name(m) }; }),
          konto_id: konto ? konto.beitragskonto_id : null, gemeinschaft_id: gem ? gem.beitragsgemeinschaft_id : null,
          hinweise: hinweise
        });
      } catch (e) {
        for (var i = geschrieben.length - 1; i >= 0; i--) {
          try { DB.entfernen(geschrieben[i].tab, [geschrieben[i].id]); } catch (e2) { console.error('Aufnahme: Zurückrollen ' + geschrieben[i].tab + ' fehlgeschlagen: ' + (e2 && e2.message)); }
        }
        throw e;
      }
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

  /**
   * Ratenbegrenzung je Benutzer (Stunde + Tag). Zählt UNTER der Sperre, damit parallele Aufrufe den Zähler nicht
   * umgehen können (Befund M3 der Sicherheitsprüfung).
   */
  function begrenze(ktx) {
    DB.mitSperre(function () {
      var c = CacheService.getScriptCache();
      var stunde = 'exaktsuche:h:' + String(ktx.email), tag = 'exaktsuche:t:' + String(ktx.email) + ':' + heute();
      var nh = Number(c.get(stunde) || 0), nt = Number(c.get(tag) || 0);
      if (nh >= EXAKTSUCHE_MAX || nt >= EXAKTSUCHE_MAX_TAG) throw Fehler.fachlich('Zu viele Suchen in kurzer Zeit. Bitte später erneut versuchen.');
      c.put(stunde, String(nh + 1), 3600);
      c.put(tag, String(nt + 1), 21600);
    });
  }

  /** Höchstens EIN Treffer, nur bei exakter Übereinstimmung, nur laufende Mitglieder. */
  function exaktTreffer(kriterien) {
    kriterien = kriterien || {};
    var nummer = leer(kriterien.mitgliedsnummer) ? null : String(kriterien.mitgliedsnummer).trim();
    var nachname = leer(kriterien.nachname) ? null : falte(kriterien.nachname);
    var geb = istDatum(kriterien.geburtsdatum) ? kriterien.geburtsdatum : null;
    // Immer ZWEI Merkmale (Befund H1/M3): Nummer + Nachname oder Nachname + Geburtsdatum. Die Nummer allein
    // ließe sich durchzählen und würde fremde Mitglieder nacheinander offenlegen.
    if (!nachname || !(nummer || geb)) {
      feldfehler([{ feld: 'nachname', meldung: 'Nachname und dazu Mitgliedsnummer oder Geburtsdatum angeben.' }]);
    }
    var h = heute();
    var kandidaten = (daten().Mitglied || []).filter(function (m) {
      if (m.anonymisiert === true || m.verarbeitung_eingeschraenkt === true || m.sterbedatum) return false;
      if (falte(m.nachname) !== nachname) return false;
      if (nummer && String(m.mitgliedsnummer) !== nummer) return false;
      return !geb || m.geburtsdatum === geb;
    }).filter(function (m) { return Mitgliedschaft.status(m, zeitraeume(m.mitglied_id), h) === 'aktiv'; });
    return kandidaten.length === 1 ? kandidaten[0] : null;
  }

  function sucheExakt(ktx, kriterien) {
    begrenze(ktx);
    var m = exaktTreffer(kriterien);
    Protokoll.schreibe(ktx, [{ aktion: 'eingesehen', tabelle: 'Mitglied', datensatz_id: m ? m.mitglied_id : '-', kommentar: 'Exaktsuche' + (m ? '' : ' ohne Treffer') }]);
    if (!m) return { treffer: null };
    // Einmal-Token statt ID: „Zuordnen“ ist nur für genau diesen Treffer, nur für diesen Benutzer und nur
    // kurze Zeit möglich (Befund H1 – vorher genügte die Nummer allein, ohne vorherige Suche).
    var token = Utilities.getUuid();
    CacheService.getScriptCache().put('exakttoken:' + String(ktx.email) + ':' + token, String(m.mitglied_id), TOKEN_DAUER_S);
    var eigene = (daten().Abteilungszugehoerigkeit || []).filter(function (a) {
      return a.mitglied_id === m.mitglied_id && (!a.austrittsdatum || a.austrittsdatum >= heute()) &&
        (Rechte.zeilenSicht(ktx).alle || (ktx.abteilungen || []).indexOf(a.abteilung_id) >= 0);
    }).map(function (a) { return a.abteilung_id; });
    return {
      treffer: {
        name: name(m), mitgliedsnummer: m.mitgliedsnummer,
        geburtsjahr: m.geburtsdatum ? Number(String(m.geburtsdatum).slice(0, 4)) : null,
        bereits_in: eigene,
        token: token
      }
    };
  }

  /** Zuordnen nur mit dem Einmal-Token aus einer vorangegangenen Exaktsuche desselben Benutzers. */
  function zuordnen(ktx, token, abteilungId, status) {
    return DB.mitSperre(function () {
      pruefeAbteilung(ktx, abteilungId);
      var c = CacheService.getScriptCache();
      var schluessel = 'exakttoken:' + String(ktx.email) + ':' + String(token || '');
      var id = typeof token === 'string' && token ? Number(c.get(schluessel)) : 0;
      if (!id) throw Fehler.fachlich('Bitte zuerst erneut suchen – der Treffer ist nicht mehr gültig.');
      c.remove(schluessel);
      var m = (daten().Mitglied || []).filter(function (x) { return x.mitglied_id === id; })[0];
      if (!m || Mitgliedschaft.status(m, zeitraeume(m.mitglied_id), heute()) !== 'aktiv') {
        throw Fehler.fachlich('Kein eindeutiger Treffer – bitte Angaben prüfen.');
      }
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
    speichern: speichern, adresseUngueltig: adresseUngueltig, dubletten: dubletten, anlegen: anlegen, aufnehmen: aufnehmen,
    wiedereintritt: wiedereintritt, austrittVorbereiten: austrittVorbereiten, austritt: austritt, sterbefall: sterbefall,
    zugehoerigkeitSpeichern: zugehoerigkeitSpeichern, zugehoerigkeitBeenden: zugehoerigkeitBeenden,
    sucheExakt: sucheExakt, zuordnen: zuordnen,
    funktionEintragen: funktionEintragen, funktionBeenden: funktionBeenden, funktionAendern: funktionAendern,
    exportProtokollieren: exportProtokollieren
  };
})();
