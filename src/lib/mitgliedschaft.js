/**
 * Mitgliedschaft – reine Ableitungen rund um Mitglied, Zeiträume und Funktionen.
 *
 * Zweck:      Alles, was laut Datenmodell NICHT gespeichert, sondern berechnet wird: Status, „Mitglied seit“,
 *             Alter, Mitgliedsjahre (für Ehrungen), Jugend-Eigenschaft, laufende Zeiträume/Funktionen.
 * Datenquelle: Objekte aus DB.lese (Datum als 'JJJJ-MM-TT', ja/nein als true/false). Keine Apps-Script-Dienste.
 * Wer darf was: – (reine Rechenfunktionen; die Rechteprüfung passiert vor dem Aufruf).
 * Besonderheiten:
 *   - Datumsvergleiche laufen als Textvergleich auf 'JJJJ-MM-TT' – das ist bei diesem Format korrekt
 *     und frei von Zeitzonen-Problemen.
 *   - Ende einer Mitgliedschaft = austrittsdatum, ersatzweise austritt_wirksam. Eine bereits erfasste Kündigung
 *     mit Austritt in der Zukunft lässt die Person bis dahin „aktiv“ (Merker gekuendigt).
 *   - Mitgliedsjahre für Ehrungen: Modus 'letzter_eintritt' (beschlossen 10/2026, ein Austritt setzt zurück)
 *     oder 'gesamt' (Summe aller Zeiträume), Stichtag 'kalenderjahr' (erreicht bis 31.12.) oder 'exakter_tag'.
 */
var Mitgliedschaft = (function () {

  function teile(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? { j: +m[1], m: +m[2], t: +m[3] } : null;
  }

  /** Volle Monate zwischen zwei Daten (von ≤ bis), z. B. 2001-09-01 → 2026-08-31 = 299. */
  function volleMonate(von, bis) {
    var a = teile(von), b = teile(bis);
    if (!a || !b || bis < von) return 0;
    var n = (b.j - a.j) * 12 + (b.m - a.m);
    if (b.t < a.t) n--;
    return Math.max(0, n);
  }

  /** Volle Jahre zwischen zwei Daten. */
  function volleJahre(von, bis) { return Math.floor(volleMonate(von, bis) / 12); }

  /** Alter in vollen Jahren am Stichtag (null ohne Geburtsdatum). */
  function alter(geburtsdatum, stichtag) {
    if (!geburtsdatum) return null;
    return volleJahre(geburtsdatum, stichtag);
  }

  /** Alter, das im Kalenderjahr des Stichtags erreicht wird (BLSV-Jahrgangslogik, Geburtstagsehrungen). */
  function alterImJahr(geburtsdatum, jahr) {
    var g = teile(geburtsdatum);
    return g ? jahr - g.j : null;
  }

  /** Läuft ein Zeitraum [von, bis] am Stichtag? bis leer = offen. */
  function laeuft(von, bis, stichtag) {
    if (!von || von > stichtag) return false;
    return !bis || bis >= stichtag;
  }

  function endeVon(z) { return z.austrittsdatum || z.austritt_wirksam || null; }

  /** Zeiträume einer Person, nach Eintritt sortiert. */
  function zeitraeumeVon(mitgliedId, alleZeitraeume) {
    return (alleZeitraeume || []).filter(function (z) { return z.mitglied_id === mitgliedId; })
      .sort(function (a, b) { return String(a.eintrittsdatum).localeCompare(String(b.eintrittsdatum)); });
  }

  /** Der am Stichtag laufende Zeitraum oder null. */
  function laufenderZeitraum(zeitraeume, stichtag) {
    for (var i = zeitraeume.length - 1; i >= 0; i--) {
      if (laeuft(zeitraeume[i].eintrittsdatum, endeVon(zeitraeume[i]), stichtag)) return zeitraeume[i];
    }
    return null;
  }

  /**
   * Status laut Datenmodell: 'verstorben' (Sterbedatum hat Vorrang), 'aktiv' (laufender Zeitraum),
   * 'ausgetreten' (Zeiträume, aber keiner läuft). Ohne Zeiträume: null (z. B. reiner Funktionsträger, V6).
   */
  function status(mitglied, zeitraeume, stichtag) {
    if (mitglied.sterbedatum && mitglied.sterbedatum <= stichtag) return 'verstorben';
    if (!zeitraeume.length) return null;
    return laufenderZeitraum(zeitraeume, stichtag) ? 'aktiv' : 'ausgetreten';
  }

  /** Eintrittsdatum des laufenden (sonst des letzten) Zeitraums – „Mitglied seit“. */
  function mitgliedSeit(zeitraeume, stichtag) {
    var z = laufenderZeitraum(zeitraeume, stichtag) || zeitraeume[zeitraeume.length - 1];
    return z ? z.eintrittsdatum : null;
  }

  /** Kündigung erfasst, Austritt liegt noch in der Zukunft → { austritt } sonst null. */
  function gekuendigt(zeitraeume, stichtag) {
    var z = laufenderZeitraum(zeitraeume, stichtag);
    var ende = z && endeVon(z);
    return ende && ende >= stichtag ? { austritt: ende, eingang: z.kuendigung_eingang || null } : null;
  }

  /** Stichtag für die Jahreszählung: Kalenderjahr → 31.12. des Jahres. */
  function zaehlStichtag(stichtag, stichtagModus) {
    return stichtagModus === 'exakter_tag' ? stichtag : String(stichtag).slice(0, 4) + '-12-31';
  }

  /**
   * Mitgliedsjahre am Stichtag.
   *   modus 'letzter_eintritt': volle Jahre seit dem Eintritt des LAUFENDEN Zeitraums; keine laufende
   *                              Mitgliedschaft → 0 (ein Austritt setzt die Zählung zurück).
   *   modus 'gesamt':           Summe der vollen Monate aller Zeiträume bis zum Stichtag, in Jahren.
   */
  function mitgliedsjahre(zeitraeume, stichtag, modus, stichtagModus) {
    var bis = zaehlStichtag(stichtag, stichtagModus);
    if (modus === 'gesamt') {
      var monate = 0;
      zeitraeume.forEach(function (z) {
        if (!z.eintrittsdatum || z.eintrittsdatum > bis) return;
        var ende = endeVon(z);
        monate += volleMonate(z.eintrittsdatum, ende && ende < bis ? ende : bis);
      });
      return Math.floor(monate / 12);
    }
    var lauf = laufenderZeitraum(zeitraeume, stichtag);
    return lauf ? volleJahre(lauf.eintrittsdatum, bis) : 0;
  }

  /** Volle Jahre einer Funktion bis zum Stichtag (bzw. bis zu ihrem Ende). */
  function funktionsjahre(funktion, stichtag, stichtagModus) {
    var bis = zaehlStichtag(stichtag, stichtagModus);
    if (!funktion.von || funktion.von > bis) return 0;
    return volleJahre(funktion.von, funktion.bis && funktion.bis < bis ? funktion.bis : bis);
  }

  /** Jugend im Sinne der Jugendleiter-Sicht: Alter ≤ bisAlter am Stichtag. */
  function istJugend(geburtsdatum, stichtag, bisAlter) {
    var a = alter(geburtsdatum, stichtag);
    return a !== null && a <= bisAlter;
  }

  /** Laufende Funktionen einer Person (bzw. aller, wenn mitgliedId null). */
  function laufendeFunktionen(funktionen, stichtag, mitgliedId) {
    return (funktionen || []).filter(function (f) {
      return (mitgliedId === null || mitgliedId === undefined || f.mitglied_id === mitgliedId) && laeuft(f.von, f.bis, stichtag);
    });
  }

  /** Datum + n Monate (Monatsende wird gekappt, 31.01. + 1 Monat = 28./29.02.). */
  function plusMonate(iso, n) {
    var d = teile(iso);
    if (!d) return null;
    var gesamt = d.j * 12 + (d.m - 1) + n;
    var j = Math.floor(gesamt / 12), m = gesamt % 12 + 1;
    var tageImMonat = new Date(Date.UTC(j, m, 0)).getUTCDate();
    var t = Math.min(d.t, tageImMonat);
    return j + '-' + ('0' + m).slice(-2) + '-' + ('0' + t).slice(-2);
  }

  /** Datum + n Tage. */
  function plusTage(iso, n) {
    var d = teile(iso);
    if (!d) return null;
    return new Date(Date.UTC(d.j, d.m - 1, d.t + n)).toISOString().slice(0, 10);
  }

  return {
    volleMonate: volleMonate, volleJahre: volleJahre, alter: alter, alterImJahr: alterImJahr,
    laeuft: laeuft, endeVon: endeVon, zeitraeumeVon: zeitraeumeVon, laufenderZeitraum: laufenderZeitraum,
    status: status, mitgliedSeit: mitgliedSeit, gekuendigt: gekuendigt, mitgliedsjahre: mitgliedsjahre,
    funktionsjahre: funktionsjahre, istJugend: istJugend, laufendeFunktionen: laufendeFunktionen,
    plusMonate: plusMonate, plusTage: plusTage
  };
})();
