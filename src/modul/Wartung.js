/**
 * Wartung – nächtliche Pflegearbeiten, die kein Mensch auslösen muss (Zeit-Trigger wartungNachts, ca. 02:00).
 *
 * Zweck:       Abgeleitete und fristgebundene Werte aktuell halten, ohne dass jemand daran denken muss:
 *              (a) Status-Cache Mitglied.status nachziehen (z. B. Austritt zum 31.12. ist erreicht),
 *              (b) Fristen der Führungszeugnis-Vermerke neu berechnen (Wiedervorlage, zu_loeschen_ab),
 *              (c) loeschbar_ab / sperre_grund ausgetretener Mitglieder nach Tab Aufbewahrungsfrist setzen
 *                  (nur Felder setzen – gelöscht wird hier NICHTS; das bleibt eine bewusste Handlung, D4),
 *              (d) am 1. eines Monats: Protokoll-Bereinigung nach Frist (alt_wert/neu_wert leeren),
 *              (e) Messwerte (_Messung) älter als 3 Monate entfernen,
 *              (f) Snapshot-Cache verwerfen und gleich neu bauen (morgens ist der Start dann warm).
 * Datenquelle: alle Tabs über DB; Schreiben mit DB.aktualisiereViele (feste Zahl an Tabellenzugriffen).
 * Wer darf was: Läuft nur als Funktionskonto (Zugriff.nurFunktionskonto im Trigger). Intern arbeitet sie mit einem
 *              System-Kontext (volle Zeilen-/Feldsicht), der nie einen Browser erreicht.
 * Besonderheiten:
 *   - Jeder Schritt läuft für sich in try/catch: Ein Fehler in einem Schritt hält die anderen nicht auf; Details
 *     stehen im Ausführungsprotokoll (console.error), im _Protokoll steht ein Sammeleintrag (Tabelle „Wartung“).
 *   - Laufzeitschutz (Sicherheitsregel C4, max. 6 Minuten je Ausführung): Nach 4,5 Minuten wird abgebrochen, der
 *     Fortschritt in den Script Properties (wartung_fortschritt) festgehalten und ein einmaliger Folge-Trigger in
 *     einer Minute angelegt, der die restlichen Schritte erledigt. Erledigte Schritte laufen am selben Tag nicht doppelt.
 */
var Wartung = (function () {
  var MAX_MS = 4.5 * 60 * 1000;
  var FORTSCHRITT = 'wartung_fortschritt';
  var MESSUNG_MONATE = 3;
  var SCHRITTE = ['status', 'fristen', 'loeschbarkeit', 'protokoll', 'messung', 'korrespondenz', 'notizen', 'snapshot'];

  function heute() { return DB.jetzt().slice(0, 10); }

  /** System-Kontext: volle Sicht, Rollen wie Vorstand – nur serverintern (Wartungslauf). */
  function systemKontext(email) {
    var ktx = Rechte.kontext([{ email: email || 'wartung', rolle: 'Vorstand', aktiv: true }], email || 'wartung');
    ktx.name = 'Wartung (automatisch)';
    ktx.system = true;
    return ktx;
  }

  // ------------------------------------------------------------------ Schritte

  /** (a) Mitglied.status an den abgeleiteten Status angleichen. */
  function statusNachziehen(ktx) {
    return DB.mitSperre(function () {
      var d = DB.lese(['Mitglied', 'Mitgliedschaftszeitraum']);
      var h = heute();
      var liste = [];
      d.Mitglied.forEach(function (m) {
        if (m.anonymisiert === true) return;
        var soll = Mitgliedschaft.status(m, Mitgliedschaft.zeitraeumeVon(m.mitglied_id, d.Mitgliedschaftszeitraum), h);
        if ((soll || null) !== (m.status || null)) liste.push({ id: m.mitglied_id, aenderungen: { status: soll } });
      });
      var r = DB.aktualisiereViele('Mitglied', liste, ktx);
      if (r.length) Snapshot.schreibe(ktx, r.map(function (x) { return { tab: 'Mitglied', neu: x.neu }; }));
      return r.length;
    });
  }

  /** (b) Fristen der FZ-Vermerke (vorhandene Funktion des Nachweis-Moduls). */
  function fristenNeu(ktx) {
    var a = NachweiseModul.fristenAktualisieren(ktx);
    return a && a.geaendert ? a.geaendert : 0;
  }

  /** (c) loeschbar_ab / sperre_grund für beendete Mitgliedschaften setzen. */
  function loeschbarkeit(ktx) {
    return DB.mitSperre(function () {
      var d = DB.lese(['Mitglied', 'Mitgliedschaftszeitraum', 'Funktion', 'Beitragskonto', 'Sollstellung', 'Aufbewahrungsfrist']);
      var h = heute();
      var liste = [];
      d.Mitglied.forEach(function (m) {
        if (m.anonymisiert === true || (m.status !== 'ausgetreten' && m.status !== 'verstorben' && m.nur_funktionstraeger !== true)) return;
        var f = Loeschung.loeschbarAb(m.mitglied_id, d, d.Aufbewahrungsfrist, h);
        if (!f || f.laeuft_noch) return;
        var neu = { loeschbar_ab: f.loeschbar_ab || null, sperre_grund: f.sperre_grund || null };
        if ((neu.loeschbar_ab || null) !== (m.loeschbar_ab || null) || (neu.sperre_grund || null) !== (m.sperre_grund || null)) {
          liste.push({ id: m.mitglied_id, aenderungen: neu });
        }
      });
      var r = DB.aktualisiereViele('Mitglied', liste, ktx);
      if (r.length) Snapshot.schreibe(ktx, r.map(function (x) { return { tab: 'Mitglied', neu: x.neu }; }));
      return r.length;
    });
  }

  /** (d) Protokoll-Bereinigung – nur am 1. eines Monats. */
  function protokoll(ktx) {
    if (heute().slice(8, 10) !== '01') return 'nicht fällig';
    var r = Datenschutz.protokollBereinigen(ktx);
    return r && r.anzahl !== undefined ? r.anzahl : 'erledigt';
  }

  /** (e) Messwerte älter als 3 Monate entfernen (sie stehen chronologisch – nur der Anfang wird gelöscht). */
  function messungAufraeumen() {
    return DB.mitSperre(function () {
      var grenze = Werte.zuSerial(Mitgliedschaft.plusMonate(heute(), -MESSUNG_MONATE));
      var b = DB.blatt('_Messung');
      var letzte = b.getLastRow(), spalten = b.getLastColumn();
      DB.zaehle(2);
      if (letzte < 2) return 0;
      var werte = b.getRange(1, 1, letzte, spalten).getValues();
      DB.zaehle(1);
      var iZeit = werte[0].map(String).indexOf('zeitpunkt');
      var n = 0;
      for (var i = 1; i < werte.length; i++) {
        var z = werte[i][iZeit];
        var serial = typeof z === 'number' ? z : (z ? Werte.zuSerial(Werte.zelleLesen(z, { typ: 'Zeitpunkt' })) : 0);
        if (serial && serial < grenze) n = i; else break;
      }
      if (!n) return 0;
      var zeilen = [];
      for (var r = 2; r <= n + 1; r++) zeilen.push(r);
      return DB.zeilenEntfernen(b, zeilen);
    });
  }

  /** (f) Snapshot neu bauen, damit der erste Start am Morgen warm ist. */
  function snapshotNeu() {
    Snapshot.verwerfen();
    DB.vorratLeeren();
    Snapshot.basis();
    return 'neu gebaut';
  }

  // ------------------------------------------------------------------ Ablauf

  function leseFortschritt(h) {
    try {
      var t = PropertiesService.getScriptProperties().getProperty(FORTSCHRITT);
      var f = t ? JSON.parse(t) : null;
      return f && f.datum === h ? f : { datum: h, erledigt: [] };
    } catch (e) { return { datum: h, erledigt: [] }; }
  }
  function speichereFortschritt(f) {
    try { PropertiesService.getScriptProperties().setProperty(FORTSCHRITT, JSON.stringify(f)); } catch (e) { /* unkritisch */ }
  }

  /**
   * Führt die (noch offenen) Schritte aus. optionen: { jetztMs: Funktion für Tests, maxMs, email }.
   * Liefert { ergebnisse: { schritt: Wert|'Fehler: …' }, abgebrochen, offen }.
   */
  function ausfuehren(optionen) {
    optionen = optionen || {};
    var uhr = optionen.jetztMs || function () { return Date.now(); };
    var start = uhr();
    var max = optionen.maxMs || MAX_MS;
    var ktx = systemKontext(optionen.email);
    var h = heute();
    var f = leseFortschritt(h);
    var ergebnisse = {}, abgebrochen = false;
    var arbeit = {
      status: function () { return statusNachziehen(ktx); },
      fristen: function () { return fristenNeu(ktx); },
      loeschbarkeit: function () { return loeschbarkeit(ktx); },
      protokoll: function () { return protokoll(ktx); },
      messung: messungAufraeumen,
      // (g) Anschreiben: Inhalt/Anschrift nach Aufbewahrungsfrist leeren (Aufbewahrungsfrist „Anschreiben“)
      korrespondenz: function () { var r = Korrespondenz.fristBereinigung(); return r && r.anzahl !== undefined ? r.anzahl : r; },
      // (h) erledigte interne Notizen nach Aufbewahrungsfrist „Interne Notizen“ entfernen
      notizen: function () { var r = Notizen.fristBereinigung(); return r && r.anzahl !== undefined ? r.anzahl : r; },
      snapshot: snapshotNeu
    };
    for (var i = 0; i < SCHRITTE.length; i++) {
      var s = SCHRITTE[i];
      if (f.erledigt.indexOf(s) >= 0) continue;
      if (uhr() - start > max) { abgebrochen = true; break; }
      try {
        ergebnisse[s] = arbeit[s]();
      } catch (e) {
        ergebnisse[s] = 'Fehler: ' + (e && (e.meldung || e.message));
        console.error('Wartung, Schritt ' + s + ': ' + (e && e.message) + '\n' + (e && e.stack));
      }
      f.erledigt.push(s);
      speichereFortschritt(f);
    }
    var offen = SCHRITTE.filter(function (x) { return f.erledigt.indexOf(x) < 0; });
    if (abgebrochen) folgeTrigger();
    try {
      Protokoll.schreibe(ktx, [{ aktion: 'geändert', tabelle: 'Wartung', datensatz_id: h,
        kommentar: Object.keys(ergebnisse).map(function (k) { return k + ': ' + ergebnisse[k]; }).join('; ') +
          (abgebrochen ? ' – abgebrochen (Laufzeit), Rest folgt: ' + offen.join(', ') : '') }]);
    } catch (e) { console.error('Wartung: Protokoll fehlgeschlagen ' + (e && e.message)); }
    return { ergebnisse: ergebnisse, abgebrochen: abgebrochen, offen: offen };
  }

  /** Einmaliger Folge-Trigger in einer Minute (nur wenn noch keiner wartet). */
  function folgeTrigger() {
    try {
      var vorhanden = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'wartungFortsetzen'; });
      if (!vorhanden.length) ScriptApp.newTrigger('wartungFortsetzen').timeBased().after(60 * 1000).create();
    } catch (e) { console.error('Wartung: Folge-Trigger nicht angelegt ' + (e && e.message)); }
  }

  /** Einmal-Trigger aufräumen (nach dem Fortsetzen). */
  function folgeTriggerEntfernen() {
    try {
      ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === 'wartungFortsetzen') ScriptApp.deleteTrigger(t);
      });
    } catch (e) { /* unkritisch */ }
  }

  return {
    SCHRITTE: SCHRITTE, ausfuehren: ausfuehren, folgeTriggerEntfernen: folgeTriggerEntfernen,
    statusNachziehen: statusNachziehen, loeschbarkeit: loeschbarkeit, messungAufraeumen: messungAufraeumen,
    systemKontext: systemKontext
  };
})();
