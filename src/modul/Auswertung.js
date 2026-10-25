/**
 * AuswertungModul – Serverseite der Ansicht „Auswertungen“ (Nachfolger der Access-Abfragen und -Berichte
 * AltersgruppenA, Gesamtmitglieder, Statistik, Jug19A, 65neuA, SchiriA).
 *
 * Zweck:      Rechnet alle Auswertungen in EINEM Aufruf (der Browser schaltet danach lokal zwischen ihnen um).
 *             Die Zählregeln stehen in src/lib/auswertung.js.
 * Datenquelle: Bereichsdaten.fuer(ktx): bei Zeilensicht „alle“ die vollständige Snapshot-Basis, sonst der
 *             rollenbeschnittene Ausschnitt (Abteilungsleiter: nur Personen seines Sichtkreises, nur sichtbare Felder).
 * Wer darf was: Aktion export (Prüfung in src/api/Auswertung.js). Vereinsweite Auswertungen über die Zeit
 *             (Mitgliederentwicklung, Austrittsgründe) nur mit Zeilensicht „alle“ – für alle anderen wären sie auf
 *             dem Ausschnitt irreführend (ausgetretene Personen fehlen dort). Beitragsstruktur nur mit Sichtklasse finanz.
 * Besonderheiten:
 *   - Eingaben aus dem Browser (Stichtag, Altersgrenzen, Gruppierung) werden geprüft und begrenzt.
 *   - Exporte (CSV/Druck) erzeugt der Browser; er meldet sie über apiAuswertungExportVermerken ins Protokoll.
 */
var AuswertungModul = (function () {
  var NACH = [null, 'abteilung', 'geschlecht'];

  function datum(d, standard, feld) {
    if (d === undefined || d === null || d === '') return standard;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: feld || 'stichtag', meldung: 'Bitte ein gültiges Datum angeben.' }]);
    return String(d);
  }

  function grenzen(g) {
    if (!Array.isArray(g) || !g.length) return Auswertung.VORGABEN.blsv;
    var aus = g.slice(0, 12).map(Number).filter(function (x) { return isFinite(x) && x >= 0 && x <= 120 && Math.floor(x) === x; });
    if (!aus.length) throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'grenzen', meldung: 'Altersgrenzen als ganze Zahlen, z. B. 14, 18, 26.' }]);
    return aus;
  }

  /**
   * Alle Auswertungen für ktx. optionen: { stichtag, grenzen: [..], nach: null|'abteilung'|'geschlecht',
   * altersmodus: 'jahrgang'|'exakt', jahre (Anzahl Jahre der Entwicklung, Standard 10) }.
   */
  function alle(ktx, optionen) {
    optionen = optionen || {};
    var bd = Bereichsdaten.fuer(ktx);
    var stichtag = datum(optionen.stichtag, bd.heute);
    var jahr = Number(stichtag.slice(0, 4));
    var nach = NACH.indexOf(optionen.nach || null) >= 0 ? (optionen.nach || null) : null;
    var modus = optionen.altersmodus === 'exakt' ? 'exakt' : 'jahrgang';
    var jahre = Math.max(2, Math.min(30, Number(optionen.jahre) || 10));
    var konfig = bd.konfig || {};
    var d = bd.daten;
    var finanz = (ktx.sicht || []).indexOf('finanz') >= 0;
    var aus = {
      stichtag: stichtag, verein: bd.alle, finanz: finanz,
      altersgruppen: Auswertung.altersgruppen(d, stichtag, { grenzen: grenzen(optionen.grenzen), nach: nach, modus: modus }),
      gesamt: Auswertung.gesamt(d, stichtag),
      kreuztabelle: Auswertung.kreuztabelle(d, stichtag),
      mitgliedsdauer: Auswertung.mitgliedsdauer(d, stichtag, konfig.ehrung_zaehlweise === 'gesamt' ? 'gesamt' : 'letzter_eintritt'),
      wohnorte: (ktx.sicht || []).indexOf('kontakt') >= 0 ? Auswertung.wohnorte(d, stichtag, 15) : null,
      funktionstraeger: Auswertung.funktionstraeger(d, stichtag),
      schiedsrichter: Auswertung.schiedsrichter(d, stichtag),
      uebergaenge: (ktx.sicht || []).indexOf('kontakt') >= 0 ? Auswertung.uebergaenge(d, jahr + 1, [18, 19, 65], stichtag) : null,
      uebergang_jahr: jahr + 1,
      beitragsstruktur: finanz ? Auswertung.beitragsstruktur(d, stichtag, Number(konfig.beitragsjahr) || jahr) : null,
      entwicklung: null, austrittsgruende: null, hinweise: []
    };
    if (bd.alle) {
      aus.entwicklung = Auswertung.entwicklung(d, jahr - jahre + 1, jahr, stichtag);
      aus.austrittsgruende = Auswertung.austrittsgruende(d, jahr - jahre + 1, jahr);
    } else {
      aus.hinweise.push('Mitgliederentwicklung und Austrittsgründe umfassen den ganzen Verein und stehen nur Vorstand, Mitgliederverwaltung und Kasse zur Verfügung. Alle übrigen Zahlen beziehen sich auf Ihren Sichtbereich.');
    }
    return aus;
  }

  /** Nur die vereinsweite Entwicklung (eigener Aufruf, z. B. mit anderer Jahresspanne). */
  function entwicklung(ktx, vonJahr, bisJahr) {
    if (!Rechte.zeilenSicht(ktx).alle) throw Fehler.fachlich('Diese Auswertung umfasst den ganzen Verein und steht nur Vorstand, Mitgliederverwaltung und Kasse zur Verfügung.');
    var bis = Number(bisJahr), von = Number(vonJahr);
    if (!(bis >= 1900 && bis <= 2200) || !(von >= 1900 && von <= bis) || bis - von > 60) {
      throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'von', meldung: 'Bitte einen gültigen Zeitraum (höchstens 60 Jahre) angeben.' }]);
    }
    var bd = Bereichsdaten.fuer(ktx);
    return { entwicklung: Auswertung.entwicklung(bd.daten, von, bis), austrittsgruende: Auswertung.austrittsgruende(bd.daten, von, bis) };
  }

  /** Im Browser erzeugten Export vermerken (Liste bereinigt, keine Personendaten im Protokoll). */
  function exportVermerken(ktx, liste, anzahl) {
    Protokoll.schreibe(ktx, [{ aktion: 'exportiert', tabelle: 'Auswertung', datensatz_id: '-',
      kommentar: Protokoll.listenname(liste) + ': ' + Math.max(0, Math.min(100000, Number(anzahl) || 0)) + ' Zeilen' }]);
    return true;
  }

  return { alle: alle, entwicklung: entwicklung, exportVermerken: exportVermerken };
})();
