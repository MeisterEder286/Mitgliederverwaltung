/**
 * Setup – richtet die Datenbank-Tabelle nach dem Datenmodell ein (Tabs, Kopfzeilen, Formate,
 * Auswahllisten, Stammdaten, _Konfig-Schlüssel).
 *
 * Zweck:      Führt den von SetupPlan (src/lib/setupplan.js) berechneten Plan mit SpreadsheetApp aus.
 *             Aufruf im Apps-Script-Editor über die Funktion setup() in src/Einstieg.js.
 * Datenquelle: Die Datenbank-Datei, deren ID in der Script Property DB_ID steht (nie vom Client, A3).
 * Wer darf:   Nur das Funktionskonto (Eigentümer) – setup() prüft das mit Zugriff.nurFunktionskonto().
 * Besonderheiten:
 *   - Nichts wird gelöscht oder überschrieben (siehe SetupPlan). Gefahrlos mehrfach ausführbar; ein zweiter
 *     Lauf meldet „keine Änderungen nötig“. Nach einer Änderung des Datenmodells (npm run schema, clasp push)
 *     einfach erneut ausführen: fehlende Spalten werden angehängt.
 *   - Der Tab _Protokoll ist append-only: Setup schreibt dort nur die Kopfzeile. Zeilen werden vom Skript
 *     ausschließlich angehängt, nie geändert oder gelöscht (außer der Bereinigung alter Werte laut
 *     Aufbewahrungsfrist).
 *   - Formate und Datenprüfung gelten für die Zeilen 2 bis 2000. Wächst ein Tab darüber hinaus, Setup mit
 *     Setup.ausfuehren({ formateErneuern: true }) erneut laufen lassen (ZEILEN_FORMAT in setupplan.js anpassen).
 *   - Viele Einzelaufrufe an die Tabelle (je Spalte Format und Prüfung) – unkritisch, weil Setup selten läuft.
 */
var Setup = (function () {

  function datei_() {
    var id = PropertiesService.getScriptProperties().getProperty('DB_ID');
    if (!id) throw new Error('Script Property DB_ID fehlt – siehe docs/BETRIEB.md (Einrichtung).');
    return SpreadsheetApp.openById(id);
  }

  /** Ist-Zustand des Sheets in der Form, die SetupPlan.plane erwartet. */
  function bestand_(ss) {
    var v = {};
    ss.getSheets().forEach(function (sh) {
      var name = sh.getName();
      var lc = sh.getLastColumn(), lr = sh.getLastRow();
      var kopf = lc > 0 && lr > 0 ? sh.getRange(1, 1, 1, lc).getValues()[0] : [];
      var eintrag = { kopf: kopf, zeilen: Math.max(0, lr - 1) };
      var def = Schema.TABELLEN[name];
      if (def && lr > 1) {
        var idx;
        if (def.idSpalte && (idx = kopf.indexOf(def.idSpalte)) >= 0) {
          eintrag.maxId = sh.getRange(2, idx + 1, lr - 1, 1).getValues().reduce(function (m, z) {
            var n = Number(z[0]);
            return z[0] !== '' && !isNaN(n) && n > m ? n : m;
          }, 0);
        }
        if (name === '_Konfig' && (idx = kopf.indexOf('schluessel')) >= 0) {
          eintrag.schluessel = sh.getRange(2, idx + 1, lr - 1, 1).getValues()
            .map(function (z) { return String(z[0]).trim(); })
            .filter(function (s) { return s !== ''; });
        }
      }
      v[name] = eintrag;
    });
    return v;
  }

  function genugZeilen_(sh, bis) {
    if (sh.getMaxRows() < bis) sh.insertRowsAfter(sh.getMaxRows(), bis - sh.getMaxRows());
  }

  function genugSpalten_(sh, bis) {
    if (sh.getMaxColumns() < bis) sh.insertColumnsAfter(sh.getMaxColumns(), bis - sh.getMaxColumns());
  }

  function fuehreAus_(ss, s) {
    var sh = s.tab ? ss.getSheetByName(s.tab) : null;
    switch (s.art) {
      case 'tab_anlegen':
        ss.insertSheet(s.tab, ss.getSheets().length);
        break;
      case 'kopf_schreiben':
        genugSpalten_(sh, s.kopf.length);
        sh.getRange(1, 1, 1, s.kopf.length).setValues([s.kopf]).setFontWeight('bold');
        sh.setFrozenRows(1);
        break;
      case 'fehlende_spalten':
        genugSpalten_(sh, s.ab + s.spalten.length - 1);
        sh.getRange(1, s.ab, 1, s.spalten.length).setValues([s.spalten]).setFontWeight('bold');
        break;
      case 'formate':
        genugZeilen_(sh, s.zeilenBis);
        s.spalten.forEach(function (sp) {
          sh.getRange(2, sp.spalte, s.zeilenBis - 1, 1).setNumberFormat(sp.format);
        });
        break;
      case 'auswahl':
        genugZeilen_(sh, s.zeilenBis);
        s.spalten.forEach(function (sp) {
          var regel = SpreadsheetApp.newDataValidation()
            .requireValueInList(sp.werte, true)
            .setAllowInvalid(false)
            .build();
          sh.getRange(2, sp.spalte, s.zeilenBis - 1, 1).setDataValidation(regel);
        });
        break;
      case 'startbelegung':
        sh.getRange(2, 1, s.zeilen.length, s.kopf.length).setValues(s.zeilen);
        break;
      case 'konfig_ergaenzen':
        var ab = sh.getLastRow() + 1;
        sh.getRange(ab, 1, s.zeilen.length, s.zeilen[0].length).setValues(s.zeilen);
        break;
      default:
        // unbekannte_spalten, fremde_tabs: nur Meldung im Bericht
        break;
    }
  }

  /**
   * Führt das Setup aus und gibt den Bericht zurück.
   * @param {{formateErneuern: boolean}=} optionen
   */
  function ausfuehren(optionen) {
    var ss = datei_();
    var plan = SetupPlan.plane(bestand_(ss), optionen);
    plan.schritte.forEach(function (s) { fuehreAus_(ss, s); });
    SpreadsheetApp.flush();
    console.log(plan.bericht);
    return plan.bericht;
  }

  return { ausfuehren: ausfuehren };
})();
