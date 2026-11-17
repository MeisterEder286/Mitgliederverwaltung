/**
 * DashboardModul – Serverseite der Ansicht „Dashboard“ (Vereinsüberblick auf einen Blick).
 *
 * Zweck:      Liefert in EINEM Aufruf alle Zahlen des Dashboards: Mitgliederverlauf über das Jahr, Altersstruktur,
 *             Abteilungen, Austrittsgründe, Einnahmen und die Ehrungs-Vorschau der nächsten Jahre. Die Rechenregeln
 *             stehen in src/lib/dashboard.js (und Auswertung/Ehrung/Familie).
 * Datenquelle: Bereichsdaten.fuer(ktx) – das Dashboard ist vereinsweit und nur mit Zeilensicht „alle“ erlaubt.
 * Wer darf was: Aktion dashboard_lesen (Vorstand, Mitgliederverwalter, Kassier; Prüfung in src/api/Dashboard.js).
 *             Einnahmen nur mit Sichtklasse finanz, Ehrungs-Vorschau nur mit Recht ehrung_bearbeiten – sonst fehlt der
 *             Abschnitt (null) in der Antwort.
 * Besonderheiten:
 *   - Nur lesend, keine Personennamen in der Antwort (nur Zahlen) – deshalb kein Exportvermerk im Protokoll.
 *   - Das Jahr wird geprüft und begrenzt; ohne Angabe gilt das laufende Jahr.
 */
var DashboardModul = (function () {

  function jahrPruefen(jahr, standard) {
    if (jahr === undefined || jahr === null || jahr === '') return standard;
    var j = Number(jahr);
    if (!(j >= 1900 && j <= 2200) || Math.floor(j) !== j) {
      throw Fehler.fachlich('Bitte Eingaben prüfen.', [{ feld: 'jahr', meldung: 'Bitte ein gültiges Jahr angeben.' }]);
    }
    return j;
  }

  /** Alle Dashboard-Zahlen. optionen: { jahr } (Standard: laufendes Jahr). */
  function alle(ktx, optionen) {
    if (!Rechte.zeilenSicht(ktx).alle) throw Fehler.fachlich('Das Dashboard umfasst den ganzen Verein und steht nur Vorstand, Mitgliederverwaltung und Kasse zur Verfügung.');
    optionen = optionen || {};
    var bd = Bereichsdaten.fuer(ktx);
    var heute = bd.heute;
    var aktuellesJahr = Number(heute.slice(0, 4));
    var jahr = jahrPruefen(optionen.jahr, aktuellesJahr);
    // Vergangene Jahre ganz, das laufende Jahr bis heute, spätere Jahre gibt es nicht
    if (jahr > aktuellesJahr) jahr = aktuellesJahr;
    var stichtag = jahr < aktuellesJahr ? jahr + '-12-31' : heute;
    var d = bd.daten;
    var k = bd.konfig || {};
    var finanz = (ktx.sicht || []).indexOf('finanz') >= 0;
    var ehrungen = Rechte.darf(ktx, 'ehrung_bearbeiten');
    var gesamt = Auswertung.gesamt(d, stichtag);
    var alter = Auswertung.altersgruppen(d, stichtag, { grenzen: Auswertung.VORGABEN.fein });
    return {
      jahr: jahr, heute: heute, stichtag: stichtag,
      jahre: [aktuellesJahr - 10, aktuellesJahr],
      verlauf: Dashboard.verlauf(d, jahr, jahr === aktuellesJahr ? heute : null),
      status: gesamt.status,
      abteilungen: gesamt.abteilungen,
      altersgruppen: { gruppen: alter.gruppen, werte: alter.gesamt.werte, ohne_geburtsdatum: alter.gesamt.ohne_geburtsdatum, gesamt: alter.gesamt.gesamt },
      austrittsgruende: Auswertung.austrittsgruende(d, jahr, jahr),
      einnahmen: finanz ? Dashboard.einnahmen(d, jahr, 6) : null,
      ehrungen: ehrungen ? Dashboard.ehrungsvorschau(d, {
        ehrung_zaehlweise: k.ehrung_zaehlweise, ehrung_stichtag: k.ehrung_stichtag, funktionsjubilaeum_zaehlweise: k.funktionsjubilaeum_zaehlweise
      }, aktuellesJahr, aktuellesJahr + 5) : null
    };
  }

  return { alle: alle };
})();
