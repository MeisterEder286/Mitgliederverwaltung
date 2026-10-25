/**
 * Ehrung – Ableitung der jährlichen Ehrungsliste (reine Fachlogik, in Node testbar).
 *
 * Zweck:      Liefert für ein Jahr Y die Liste aller Ehrungen nach Übergabe-Dokument §4:
 *               neu fällige (Stufe im Jahr Y erreicht) + offene Vorjahre (status fällig/verschoben)
 *               − bereits verliehene oder abgelehnte. Kein jährliches Zurücksetzen, keine Doppelehrung.
 *             Dazu die Statusübergänge verleihen / verschieben / ablehnen.
 * Datenquelle: `daten` = Objekt je Tab wie aus DB.lese (z. B. daten.Mitglied, daten.Mitgliedschaftszeitraum,
 *             daten.Funktion, daten.Funktionsart, daten.Ehrungsregel, daten.Ehrung, daten.Abteilung);
 *             `konfig` = Werte aus _Konfig (ehrung_zaehlweise, ehrung_stichtag, funktionsjubilaeum_zaehlweise).
 * Wer darf was: – (Rechteprüfung vor dem Aufruf; schreiben darf die Aktion ehrung_bearbeiten).
 * Besonderheiten:
 *   - Mitgliedsjubiläum: Zählweise laut _Konfig.ehrung_zaehlweise. BESCHLOSSEN 10/2026: 'letzter_eintritt' –
 *     ein Austritt setzt die Zählung zurück. 'gesamt' (alle Zeiträume) bleibt als Umschalter erhalten.
 *   - „Im Jahr Y erreicht“ = Jahre zum 31.12.Y ≥ Schwelle und zum 31.12.(Y−1) < Schwelle. So taucht jede
 *     Stufe genau in einem Jahr neu auf; was danach nicht verliehen wird, bleibt über die Ehrung-Zeile offen.
 *   - Geburtstag: Alter, das im Jahr Y erreicht wird (= Y − Geburtsjahr). Nur lebende, aktive Mitglieder.
 *   - Funktionsjubiläum: nur Funktionsarten mit ehrungsfaehig = ja; Zählweise laut
 *     _Konfig.funktionsjubilaeum_zaehlweise: 'je_funktion' (jede Funktion für sich, Ehrung trägt funktion_id),
 *     'laengste_funktion' (längste einzelne Funktion) oder 'summe_aller' (Summe aller ehrungsfähigen Zeiten,
 *     Überlappungen zählen nur einmal).
 *   - Eindeutig ist eine Ehrung je (mitglied_id, ehrungsregel_id, funktion_id) (Verbesserung V2).
 *   - Nachholen (Option nachholenAb): Stufen, die in einem Vorjahr ≥ nachholenAb erreicht, aber nie als
 *     Ehrung-Zeile angelegt wurden, erscheinen als „nachzuholen“. Ohne Option nicht – sonst stünden beim Start
 *     alle historischen Stufen aller Mitglieder auf der Liste.
 */
var Ehrung = (function () {

  var M = function () { return Mitgliedschaft; };

  function fehler(meldung) {
    return typeof Fehler !== 'undefined' ? Fehler.fachlich(meldung) : new Error(meldung);
  }
  function liste(daten, tab) { return (daten && daten[tab]) || []; }
  function jahresende(j) { return j + '-12-31'; }
  function deDatum(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : ''; }
  function schluessel(mitgliedId, regelId, funktionId) {
    return mitgliedId + '|' + regelId + '|' + (funktionId === null || funktionId === undefined ? '' : funktionId);
  }
  function nachId(rows, feld) { var m = {}; rows.forEach(function (r) { m[r[feld]] = r; }); return m; }

  /** Summe der vollen Monate über vereinigte Intervalle [von, bis] bis zum Stichtag (Überlappung einmal). */
  function monateVereinigt(funktionen, stichtag) {
    var iv = funktionen.filter(function (f) { return f.von && f.von <= stichtag; }).map(function (f) {
      return [f.von, f.bis && f.bis < stichtag ? f.bis : stichtag];
    }).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    var monate = 0, akt = null;
    iv.forEach(function (i) {
      if (akt && i[0] <= M().plusTage(akt[1], 1)) { if (i[1] > akt[1]) akt[1] = i[1]; return; }
      if (akt) monate += M().volleMonate(akt[0], M().plusTage(akt[1], 1));
      akt = [i[0], i[1]];
    });
    if (akt) monate += M().volleMonate(akt[0], M().plusTage(akt[1], 1));
    return monate;
  }

  function aktivAm(mitglied, zeitraeume, stichtag) {
    return M().status(mitglied, zeitraeume, stichtag) === 'aktiv';
  }

  /**
   * Kandidaten (erreichte Stufen) für ein Mitglied in Jahr y. Liefert [{regel, funktion_id, jahre, grundlage, vergleich}].
   * Für das Nachholen wird dieselbe Funktion mit früheren Jahren aufgerufen.
   */
  function erreichtImJahr(ctx, m, y) {
    var ergebnis = [];
    var ende = jahresende(y), vorher = jahresende(y - 1);
    var zr = ctx.zeitraeume[m.mitglied_id] || [];
    var lebend = !(m.sterbedatum && m.sterbedatum <= ende);
    if (!lebend || m.anonymisiert === true) return ergebnis;
    var istAktiv = aktivAm(m, zr, ende);

    ctx.regeln.forEach(function (r) {
      var s = Number(r.schwelle);
      if (!isFinite(s)) return;
      if (r.typ === 'Mitgliedsjubiläum') {
        if (!istAktiv) return;
        var jetzt = M().mitgliedsjahre(zr, ende, ctx.zaehlweise, ctx.stichtagModus);
        var davor = M().mitgliedsjahre(zr, vorher, ctx.zaehlweise, ctx.stichtagModus);
        if (jetzt >= s && davor < s) {
          var seit = M().mitgliedSeit(zr, ende);
          var grundlage = ctx.zaehlweise === 'gesamt'
            ? s + ' J. Mitgliedschaft gesamt (' + zr.length + ' Zeitraum/Zeiträume)'
            : s + ' J. seit ' + deDatum(seit);
          var vergleich = null;
          if (zr.length > 1) {
            vergleich = {
              letzter_eintritt: M().mitgliedsjahre(zr, ende, 'letzter_eintritt', ctx.stichtagModus),
              gesamt: M().mitgliedsjahre(zr, ende, 'gesamt', ctx.stichtagModus)
            };
          }
          ergebnis.push({ regel: r, funktion_id: null, jahre: jetzt, grundlage: grundlage, vergleich: vergleich });
        }
      } else if (r.typ === 'Geburtstag') {
        if (!istAktiv || !m.geburtsdatum) return;
        if (M().alterImJahr(m.geburtsdatum, y) === s) {
          ergebnis.push({ regel: r, funktion_id: null, jahre: s,
            grundlage: s + '. Geburtstag am ' + deDatum(y + m.geburtsdatum.slice(4)), vergleich: null });
        }
      } else if (r.typ === 'Funktionsjubiläum') {
        if (!istAktiv && m.nur_funktionstraeger !== true) return;
        var fs = (ctx.funktionen[m.mitglied_id] || []).filter(function (f) {
          var art = ctx.funktionsarten[f.funktionsart_id];
          return art && art.ehrungsfaehig === true;
        });
        if (!fs.length) return;
        if (ctx.funktionsweise === 'summe_aller') {
          var mj = Math.floor(monateVereinigt(fs, ende) / 12), mv = Math.floor(monateVereinigt(fs, vorher) / 12);
          if (mj >= s && mv < s) {
            ergebnis.push({ regel: r, funktion_id: null, jahre: mj,
              grundlage: s + ' J. Ehrenamt gesamt (' + fs.length + ' Funktion(en))', vergleich: null });
          }
        } else if (ctx.funktionsweise === 'laengste_funktion') {
          var best = null, bestJ = -1, bestV = -1;
          fs.forEach(function (f) {
            var j = M().funktionsjahre(f, ende, 'kalenderjahr');
            if (j > bestJ) { bestJ = j; best = f; }
            bestV = Math.max(bestV, M().funktionsjahre(f, vorher, 'kalenderjahr'));
          });
          if (bestJ >= s && bestV < s) {
            ergebnis.push({ regel: r, funktion_id: best.funktion_id, jahre: bestJ,
              grundlage: s + ' J. ' + funktionsText(ctx, best), vergleich: null });
          }
        } else { // je_funktion
          fs.forEach(function (f) {
            var j = M().funktionsjahre(f, ende, 'kalenderjahr');
            var v = M().funktionsjahre(f, vorher, 'kalenderjahr');
            if (j >= s && v < s) {
              ergebnis.push({ regel: r, funktion_id: f.funktion_id, jahre: j,
                grundlage: s + ' J. ' + funktionsText(ctx, f), vergleich: null });
            }
          });
        }
      }
    });
    return ergebnis;
  }

  function funktionsText(ctx, f) {
    var art = ctx.funktionsarten[f.funktionsart_id];
    var abt = f.abteilung_id ? ctx.abteilungen[f.abteilung_id] : null;
    return (art ? art.bezeichnung : 'Funktion') + (abt ? ' (' + abt.bezeichnung + ')' : '') + ' seit ' + deDatum(f.von);
  }

  function kontext(daten, konfig) {
    konfig = konfig || {};
    var zeitraeume = {}, funktionen = {};
    liste(daten, 'Mitgliedschaftszeitraum').forEach(function (z) { (zeitraeume[z.mitglied_id] = zeitraeume[z.mitglied_id] || []).push(z); });
    Object.keys(zeitraeume).forEach(function (k) {
      zeitraeume[k].sort(function (a, b) { return String(a.eintrittsdatum).localeCompare(String(b.eintrittsdatum)); });
    });
    liste(daten, 'Funktion').forEach(function (f) { (funktionen[f.mitglied_id] = funktionen[f.mitglied_id] || []).push(f); });
    return {
      zeitraeume: zeitraeume,
      funktionen: funktionen,
      funktionsarten: nachId(liste(daten, 'Funktionsart'), 'funktionsart_id'),
      abteilungen: nachId(liste(daten, 'Abteilung'), 'abteilung_id'),
      regeln: liste(daten, 'Ehrungsregel').filter(function (r) { return r.aktiv !== false; }),
      zaehlweise: konfig.ehrung_zaehlweise === 'gesamt' ? 'gesamt' : 'letzter_eintritt',
      stichtagModus: konfig.ehrung_stichtag === 'exakter_tag' ? 'exakter_tag' : 'kalenderjahr',
      funktionsweise: ['laengste_funktion', 'summe_aller'].indexOf(konfig.funktionsjubilaeum_zaehlweise) >= 0
        ? konfig.funktionsjubilaeum_zaehlweise : 'je_funktion'
    };
  }

  /**
   * Ehrungsliste für Jahr `jahr`.
   * optionen: { nachholenAb: Jahr } – erreichte, aber nie angelegte Stufen ab diesem Jahr als 'nachzuholen'.
   * Eintrag: { ehrung_id, version, mitglied_id, ehrungsregel_id, funktion_id, typ, bezeichnung, schwelle, verband,
   *            faellig_jahr, status, grundlage, neu, nachzuholen, vergleich }
   */
  function jahresliste(daten, jahr, konfig, optionen) {
    optionen = optionen || {};
    var ctx = kontext(daten, konfig);
    var regelnNachId = nachId(liste(daten, 'Ehrungsregel'), 'ehrungsregel_id');
    var vorhanden = {};
    liste(daten, 'Ehrung').forEach(function (e) { vorhanden[schluessel(e.mitglied_id, e.ehrungsregel_id, e.funktion_id)] = e; });
    var ergebnis = [];
    var gesehen = {};

    function eintrag(m, k, y, nachzuholen) {
      var key = schluessel(m.mitglied_id, k.regel.ehrungsregel_id, k.funktion_id);
      if (gesehen[key]) return;
      var e = vorhanden[key];
      if (e && (e.status === 'verliehen' || e.status === 'abgelehnt')) { gesehen[key] = true; return; }
      if (e) return;  // vorhandene offene Zeile kommt unten über die Ehrung-Zeilen
      gesehen[key] = true;
      ergebnis.push({
        ehrung_id: null, version: null,
        mitglied_id: m.mitglied_id, ehrungsregel_id: k.regel.ehrungsregel_id, funktion_id: k.funktion_id,
        typ: k.regel.typ, bezeichnung: k.regel.bezeichnung, schwelle: Number(k.regel.schwelle), verband: k.regel.verband || null,
        faellig_jahr: y, status: 'fällig', grundlage: k.grundlage, neu: true, nachzuholen: !!nachzuholen, vergleich: k.vergleich
      });
    }

    var mitglieder = liste(daten, 'Mitglied');
    mitglieder.forEach(function (m) {
      erreichtImJahr(ctx, m, jahr).forEach(function (k) { eintrag(m, k, jahr, false); });
      if (optionen.nachholenAb && optionen.nachholenAb < jahr) {
        for (var y = jahr - 1; y >= optionen.nachholenAb; y--) {
          erreichtImJahr(ctx, m, y).forEach(function (k) { eintrag(m, k, y, true); });
        }
      }
    });

    // Offene Zeilen (fällig/verschoben) bis einschließlich Jahr Y
    var mitgliedNachId = nachId(mitglieder, 'mitglied_id');
    liste(daten, 'Ehrung').forEach(function (e) {
      if (e.status !== 'fällig' && e.status !== 'verschoben') return;
      if (e.faellig_jahr && Number(e.faellig_jahr) > jahr) return;
      var m = mitgliedNachId[e.mitglied_id];
      if (!m || m.anonymisiert === true) return;
      if (m.sterbedatum && m.sterbedatum <= jahresende(jahr)) return;
      var r = regelnNachId[e.ehrungsregel_id] || {};
      var key = schluessel(e.mitglied_id, e.ehrungsregel_id, e.funktion_id);
      if (gesehen[key]) return;
      gesehen[key] = true;
      // Grundlage für die Anzeige neu berechnen, falls die Stufe im Jahr der Fälligkeit erreicht wurde
      var k = erreichtImJahr(ctx, m, Number(e.faellig_jahr) || jahr).filter(function (x) {
        return x.regel.ehrungsregel_id === e.ehrungsregel_id && (x.funktion_id || null) === (e.funktion_id || null);
      })[0];
      ergebnis.push({
        ehrung_id: e.ehrung_id, version: e.version === undefined ? null : e.version,
        mitglied_id: e.mitglied_id, ehrungsregel_id: e.ehrungsregel_id, funktion_id: e.funktion_id || null,
        typ: r.typ || null, bezeichnung: r.bezeichnung || null, schwelle: r.schwelle === undefined ? null : Number(r.schwelle),
        verband: r.verband || null, faellig_jahr: Number(e.faellig_jahr) || jahr, status: e.status,
        grundlage: k ? k.grundlage : (e.bemerkung || null), neu: false,
        nachzuholen: Number(e.faellig_jahr) < jahr, vergleich: k ? k.vergleich : null
      });
    });

    ergebnis.sort(function (a, b) {
      return (a.faellig_jahr - b.faellig_jahr) || String(a.typ).localeCompare(String(b.typ)) ||
        (a.schwelle - b.schwelle) || (a.mitglied_id - b.mitglied_id);
    });
    return ergebnis;
  }

  /** Neue Ehrung-Zeilen (ohne ID, die vergibt DB.einfuegen) für alle Einträge mit neu = true. */
  function materialisiere(eintraege) {
    return (eintraege || []).filter(function (e) { return e.neu; }).map(function (e) {
      return {
        mitglied_id: e.mitglied_id, ehrungsregel_id: e.ehrungsregel_id, funktion_id: e.funktion_id || null,
        faellig_jahr: e.faellig_jahr, status: 'fällig', verliehen_am: null, veranstaltung: null,
        bemerkung: e.grundlage || null
      };
    });
  }

  function pruefeOffen(ehrung) {
    if (!ehrung) throw fehler('Ehrung nicht gefunden.');
    if (ehrung.status === 'verliehen') throw fehler('Diese Ehrung ist bereits verliehen.');
  }

  /** Änderungen für „verliehen“. datum 'JJJJ-MM-TT' (Pflicht), veranstaltung optional. */
  function verleihe(ehrung, datum, veranstaltung) {
    pruefeOffen(ehrung);
    if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw fehler('Bitte das Datum der Verleihung angeben.');
    return { status: 'verliehen', verliehen_am: datum, veranstaltung: veranstaltung || ehrung.veranstaltung || null };
  }

  /** Änderungen für „verschoben“ (bleibt offen und erscheint im Folgejahr wieder). */
  function verschiebe(ehrung, grund) {
    pruefeOffen(ehrung);
    return { status: 'verschoben', bemerkung: grund ? String(grund) : ehrung.bemerkung || null };
  }

  /** Änderungen für „abgelehnt“ (z. B. Person verzichtet) – erscheint nicht wieder. */
  function lehneAb(ehrung, grund) {
    pruefeOffen(ehrung);
    return { status: 'abgelehnt', bemerkung: grund ? String(grund) : ehrung.bemerkung || null };
  }

  /** Rücknahme eines Versehens: verliehene/abgelehnte Ehrung wieder öffnen. */
  function oeffne(ehrung) {
    if (!ehrung) throw fehler('Ehrung nicht gefunden.');
    return { status: 'fällig', verliehen_am: null };
  }

  return {
    jahresliste: jahresliste, materialisiere: materialisiere,
    verleihe: verleihe, verschiebe: verschiebe, lehneAb: lehneAb, oeffne: oeffne,
    erreichtImJahr: function (daten, konfig, mitglied, jahr) { return erreichtImJahr(kontext(daten, konfig), mitglied, jahr); }
  };
})();
