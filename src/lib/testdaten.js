/**
 * Testdaten – Prüfregeln für das Einspielen eines SYNTHETISCHEN Vereins in die Test-Umgebung (rein).
 *
 * Zweck:      Prüft Aufbau und Inhalt von `testdaten.json` (tools/testdaten-export.js), bevor das Servermodul
 *             src/modul/Testdaten.js die Bewegungsdaten-Tabs der Test-Tabelle ersetzt.
 * Datenquelle: Schema.TABELLEN (Kopfzeilen), die vom Browser gelesene Datei, die Kopfzeilen der Tabelle.
 * Wer darf was: – (reine Prüffunktionen; Schalter, Rolle und Recht prüft das Servermodul).
 * Besonderheiten:
 *   - Nur Bewegungsdaten werden ersetzt (ERLAUBT). Nie: Stammdaten aus der Startbelegung, Benutzer (sonst sperrt
 *     sich der Importierende womöglich selbst aus), _Konfig als Ganzes, Protokoll, Messwerte, Vorlagen, Dokumente.
 *   - In _Konfig werden nur beitragsjahr, mitgliedsnummer_naechste und next_id_<erlaubter Tab> gesetzt.
 *   - Zellen dürfen nur Text, Zahl, ja/nein-Text oder leer sein; Texte mit = + - @ am Anfang werden abgewiesen
 *     (Formelschutz, die Datei kommt aus dem Browser).
 */
var Testdaten = (function () {
  var ART = 'mitgliederverwaltung-testdaten';
  var ERLAUBT = ['Mitglied', 'Mitgliedschaftszeitraum', 'Abteilungszugehoerigkeit', 'Funktion', 'Beitragsgemeinschaft',
    'Beitragskonto', 'Sollstellung', 'Qualifikation', 'Ehrung', 'Einwilligung'];
  var MAX_BLOCK = 1000;   // Zeilen je Aufruf vom Browser

  function istTestName(name) { return /test/i.test(String(name || '')); }

  function sollKopf(tab) {
    var t = Schema.TABELLEN[tab];
    return t ? t.spalten.map(function (s) { return s.name; }) : null;
  }

  /**
   * Kopfdaten der Datei prüfen. info: { art, version, synthetisch, tabs: { Tab: { kopf, anzahl } }, konfig }.
   * Liefert { fehler: [Text], tabs: [Tab in Schema-Reihenfolge], uebersprungen: [Tab] }.
   */
  function pruefeKopfdaten(info) {
    var f = [], tabs = [], weg = [];
    if (!info || typeof info !== 'object') return { fehler: ['Datei ist kein JSON-Objekt'], tabs: [], uebersprungen: [] };
    if (info.art !== ART) f.push('Datei ist keine Testdaten-Datei (npm run testdaten).');
    if (info.version !== 1) f.push('Unbekannte Dateiversion ' + info.version + '.');
    if (info.synthetisch !== true) f.push('Datei ist nicht als synthetisch gekennzeichnet.');
    var inDatei = info.tabs && typeof info.tabs === 'object' ? Object.keys(info.tabs) : [];
    inDatei.forEach(function (tab) { if (ERLAUBT.indexOf(tab) < 0) weg.push(tab); });
    ERLAUBT.forEach(function (tab) {
      if (inDatei.indexOf(tab) < 0) return;
      var t = info.tabs[tab], soll = sollKopf(tab);
      if (!t || !Array.isArray(t.kopf)) { f.push('Tab ' + tab + ': Kopfzeile fehlt.'); return; }
      if (t.kopf.join('\t') !== soll.join('\t')) {
        f.push('Tab ' + tab + ': Spalten der Datei passen nicht zu diesem Programmstand – Export und WebApp auf denselben Stand bringen.');
        return;
      }
      if (!(t.anzahl >= 0) || Math.floor(t.anzahl) !== t.anzahl) { f.push('Tab ' + tab + ': Zeilenzahl fehlt.'); return; }
      tabs.push(tab);
    });
    if (!tabs.length && !f.length) f.push('Die Datei enthält keine Tabs, die eingespielt werden dürfen.');
    konfigWerte(info.konfig, tabs).fehler.forEach(function (x) { f.push(x); });
    return { fehler: f, tabs: tabs, uebersprungen: weg };
  }

  /** Kopfzeile der Tabelle gegen das Schema: gleiche Spalten am Anfang (hinten mehr ist erlaubt). Fehlertext oder null. */
  function pruefeTabellenkopf(tab, ist) {
    if (!ist) return 'Tab ' + tab + ' fehlt in der Tabelle – zuerst setup ausführen.';
    var soll = sollKopf(tab);
    for (var i = 0; i < soll.length; i++) {
      if (String(ist[i] === undefined ? '' : ist[i]).trim() !== soll[i]) {
        return 'Tab ' + tab + ': Kopfzeile der Tabelle weicht ab (Spalte ' + (i + 1) + ' „' + (ist[i] || '') + '“ statt „' + soll[i] +
          '“) – setup ausführen.';
      }
    }
    return null;
  }

  /** Zeilenblock prüfen: Liste von Listen mit genau `spalten` Zellen, nur Text/Zahl/leer, kein Formelanfang. */
  function pruefeBlock(tab, zeilen) {
    var soll = sollKopf(tab);
    if (ERLAUBT.indexOf(tab) < 0 || !soll) return 'Tab ' + tab + ' darf nicht eingespielt werden.';
    if (!Array.isArray(zeilen) || zeilen.length > MAX_BLOCK) return 'Ungültiger Zeilenblock für ' + tab + '.';
    for (var i = 0; i < zeilen.length; i++) {
      var z = zeilen[i];
      if (!Array.isArray(z) || z.length !== soll.length) return tab + ': Zeile mit falscher Spaltenzahl.';
      for (var j = 0; j < z.length; j++) {
        var v = z[j], typ = typeof v;
        if (v === null || v === '') continue;
        if (typ === 'number') { if (!isFinite(v)) return tab + ': ungültige Zahl.'; continue; }
        if (typ !== 'string') return tab + ': ungültiger Zellwert in Spalte ' + soll[j] + '.';
        if (/^[=+\-@]/.test(v)) return tab + ': Zellwert mit Formelzeichen in Spalte ' + soll[j] + '.';
      }
    }
    return null;
  }

  /** _Konfig-Werte aus der Datei, eingeschränkt auf erlaubte Schlüssel. Liefert { werte: [[k, 'v']], fehler }. */
  function konfigWerte(konfig, tabs) {
    var werte = [], f = [];
    if (konfig !== undefined && !Array.isArray(konfig)) return { werte: [], fehler: ['konfig ist keine Liste.'] };
    (konfig || []).forEach(function (kv) {
      if (!Array.isArray(kv) || kv.length < 2) { f.push('konfig: ungültiger Eintrag.'); return; }
      var k = String(kv[0]), w = String(kv[1]);
      var erlaubt = k === 'beitragsjahr' || k === 'mitgliedsnummer_naechste' ||
        (k.indexOf('next_id_') === 0 && tabs.indexOf(k.slice(8)) >= 0);
      if (!erlaubt) return;   // z. B. next_id_Benutzer: wird mit Benutzer übersprungen
      if (!/^\d{1,9}$/.test(w)) { f.push('konfig: ' + k + ' ist keine Zahl.'); return; }
      werte.push([k, w]);
    });
    return { werte: werte, fehler: f };
  }

  return { ART: ART, ERLAUBT: ERLAUBT, MAX_BLOCK: MAX_BLOCK, istTestName: istTestName, pruefeKopfdaten: pruefeKopfdaten,
    pruefeTabellenkopf: pruefeTabellenkopf, pruefeBlock: pruefeBlock, konfigWerte: konfigWerte };
})();
