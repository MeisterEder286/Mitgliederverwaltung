/**
 * Fristen – Nachweise (erweitertes Führungszeugnis, Lizenzen, Kurse): Wiedervorlage, Löschfrist, Ampel.
 *
 * Zweck:      Berechnet je Person mit nachweispflichtiger Funktion, ob ein gültiges Führungszeugnis (FZ)
 *             vorliegt, wann es wieder vorzulegen ist, welche Lizenzen ablaufen und welche FZ-Vermerke
 *             zu löschen sind. Prüft Eingaben bei der Einsichtnahme.
 * Datenquelle: `daten` je Tab wie aus DB.lese (Qualifikation, Qualifikationsart, Funktion, Funktionsart, Mitglied);
 *             `konfig` aus _Konfig (fz_wiedervorlage_monate als Fallback).
 * Wer darf was: – (lesen: qualifikation_lesen, erfassen: qualifikation_erfassen – auch Abteilungsleiter, beschlossen 10/2026).
 * Besonderheiten:
 *   - § 72a SGB VIII: Gespeichert wird nur, DASS eingesehen wurde, wann, von wem, und bis wann es gilt –
 *     nie der Inhalt. ergebnis darf nur „ohne einschlägigen Eintrag“ sein.
 *   - Vorrang der Fristen (X4): Werte aus Qualifikationsart gehen vor _Konfig.fz_wiedervorlage_monate.
 *   - Ein FZ gilt der PERSON: Wer zwei nachweispflichtige Ämter hat, braucht nur eines. Die Löschfrist
 *     beginnt erst, wenn das LETZTE nachweispflichtige Amt endet (+ loeschfrist_monate der Qualifikationsart).
 *   - Ampel: rot = kein gültiges FZ / Wiedervorlage überschritten; gelb = Wiedervorlage in ≤ 3 Monaten;
 *     grün = gültig. Lizenzen: abgelaufen / läuft ab (≤ 3 Monate) / gültig.
 */
var Fristen = (function () {

  var VORLAUF_MONATE = 3;
  var ERGEBNIS_ERLAUBT = 'ohne einschlägigen Eintrag';

  function liste(daten, tab) { return (daten && daten[tab]) || []; }
  function nachId(rows, feld) { var m = {}; rows.forEach(function (r) { m[r[feld]] = r; }); return m; }
  function istFz(art) { return !!art && art.kategorie === 'Führungszeugnis'; }
  function laeuft(f, tag) { return !!f.von && f.von <= tag && (!f.bis || f.bis >= tag); }

  /** Wiedervorlagedatum: FZ = eingesehen_am + Monate (Qualifikationsart vor _Konfig), sonst gueltig_bis. */
  function wiedervorlage(q, art, konfig) {
    if (!q) return null;
    if (istFz(art)) {
      if (q.wiedervorlage_am) return q.wiedervorlage_am;
      if (!q.eingesehen_am) return null;
      var monate = Number(art.wiedervorlage_monate) || Number(konfig && konfig.fz_wiedervorlage_monate) || 60;
      return Mitgliedschaft.plusMonate(q.eingesehen_am, monate);
    }
    return q.gueltig_bis || null;
  }

  function pflichtigeFunktionen(personId, daten) {
    var arten = nachId(liste(daten, 'Funktionsart'), 'funktionsart_id');
    return liste(daten, 'Funktion').filter(function (f) {
      var a = arten[f.funktionsart_id];
      return f.mitglied_id === personId && a && a.fz_pflichtig === true;
    });
  }

  /**
   * Ab wann ein FZ-Vermerk einer Person zu löschen ist ('JJJJ-MM-TT') oder null, solange eine nachweispflichtige
   * Funktion läuft. Keine nachweispflichtige Funktion (mehr) vorhanden → heute (sofort löschbar).
   */
  function zuLoeschenAb(personId, daten, art, heute) {
    var fs = pflichtigeFunktionen(personId, daten);
    if (fs.some(function (f) { return !f.bis || f.bis >= heute; })) return null;
    if (!fs.length) return heute;
    var letztesEnde = fs.map(function (f) { return f.bis; }).sort().pop();
    var monate = art && art.loeschfrist_monate !== null && art.loeschfrist_monate !== undefined ? Number(art.loeschfrist_monate) : 3;
    return Mitgliedschaft.plusMonate(letztesEnde, monate);
  }

  /**
   * Feldprüfung einer Eingabe (neue Einsichtnahme bzw. Lizenz). Liefert [{ feld, meldung }] (leer = in Ordnung).
   * heute optional ('JJJJ-MM-TT') für „nicht in der Zukunft“.
   */
  function pruefeEinsicht(eingabe, art, heute) {
    var f = [];
    eingabe = eingabe || {};
    if (!art) return [{ feld: 'qualifikationsart_id', meldung: 'Bitte die Art des Nachweises wählen.' }];
    if (istFz(art)) {
      if (!eingabe.ausgestellt_am) f.push({ feld: 'ausgestellt_am', meldung: 'Ausstellungsdatum des Führungszeugnisses fehlt.' });
      if (!eingabe.eingesehen_am) f.push({ feld: 'eingesehen_am', meldung: 'Datum der Einsichtnahme fehlt.' });
      if (heute && eingabe.eingesehen_am && eingabe.eingesehen_am > heute) f.push({ feld: 'eingesehen_am', meldung: 'Die Einsichtnahme darf nicht in der Zukunft liegen.' });
      if (eingabe.ausgestellt_am && eingabe.eingesehen_am) {
        if (eingabe.eingesehen_am < eingabe.ausgestellt_am) {
          f.push({ feld: 'eingesehen_am', meldung: 'Die Einsichtnahme liegt vor dem Ausstellungsdatum.' });
        } else if (art.max_alter_zeugnis_monate) {
          var grenze = Mitgliedschaft.plusMonate(eingabe.ausgestellt_am, Number(art.max_alter_zeugnis_monate));
          if (eingabe.eingesehen_am > grenze) {
            f.push({ feld: 'ausgestellt_am', meldung: 'Das Zeugnis war bei der Einsichtnahme älter als ' + art.max_alter_zeugnis_monate + ' Monate.' });
          }
        }
      }
      if (!eingabe.eingesehen_durch) f.push({ feld: 'eingesehen_durch', meldung: 'Bitte angeben, wer Einsicht genommen hat.' });
      if (eingabe.ergebnis !== ERGEBNIS_ERLAUBT) f.push({ feld: 'ergebnis', meldung: 'Erfasst wird nur „' + ERGEBNIS_ERLAUBT + '“ – niemals Inhalte (§ 72a SGB VIII).' });
      if (eingabe.gueltig_bis) f.push({ feld: 'gueltig_bis', meldung: 'Beim Führungszeugnis ergibt sich die Wiedervorlage automatisch.' });
    } else {
      ['eingesehen_am', 'eingesehen_durch', 'ergebnis'].forEach(function (n) {
        if (eingabe[n]) f.push({ feld: n, meldung: 'Dieses Feld gilt nur für das Führungszeugnis.' });
      });
      if (eingabe.ausgestellt_am && eingabe.gueltig_bis && eingabe.gueltig_bis < eingabe.ausgestellt_am) {
        f.push({ feld: 'gueltig_bis', meldung: '„Gültig bis“ liegt vor dem Ausstellungsdatum.' });
      }
    }
    return f;
  }

  function ampelFuerDatum(datum, heute) {
    if (!datum || datum < heute) return 'rot';
    return datum <= Mitgliedschaft.plusMonate(heute, VORLAUF_MONATE) ? 'gelb' : 'gruen';
  }

  /** Aktuell maßgebliches (neuestes, nicht gelöschtes) FZ einer Person oder null. */
  function aktuellesFz(personId, quals, arten) {
    return quals.filter(function (q) {
      return q.mitglied_id === personId && istFz(arten[q.qualifikationsart_id]) && !q.geloescht_am && q.eingesehen_am;
    }).sort(function (a, b) { return String(a.eingesehen_am).localeCompare(String(b.eingesehen_am)); }).pop() || null;
  }

  /** FZ-Ampel einer Person ('gruen'|'gelb'|'rot'|null wenn keine pflichtige Funktion läuft). */
  function ampelFuer(personId, daten, heute, konfig) {
    var laufend = pflichtigeFunktionen(personId, daten).filter(function (f) { return laeuft(f, heute); });
    if (!laufend.length) return null;
    var arten = nachId(liste(daten, 'Qualifikationsart'), 'qualifikationsart_id');
    var q = aktuellesFz(personId, liste(daten, 'Qualifikation'), arten);
    return q ? ampelFuerDatum(wiedervorlage(q, arten[q.qualifikationsart_id], konfig), heute) : 'rot';
  }

  /**
   * Übersicht für die Ansicht „Nachweise“.
   * { personen: [{ mitglied_id, funktion_ids, fz: { qualifikation_id, eingesehen_am, wiedervorlage, ampel } | null,
   *               ampel, lizenzen: [{ qualifikation_id, art, gueltig_bis, stand }] }],
   *   zu_loeschen: [{ qualifikation_id, mitglied_id, zu_loeschen_ab }],
   *   maengel: [{ mitglied_id, meldung }] }
   */
  function uebersicht(daten, heute, konfig) {
    var arten = nachId(liste(daten, 'Qualifikationsart'), 'qualifikationsart_id');
    var fArten = nachId(liste(daten, 'Funktionsart'), 'funktionsart_id');
    var quals = liste(daten, 'Qualifikation');
    var proPerson = {};
    liste(daten, 'Funktion').forEach(function (f) {
      var a = fArten[f.funktionsart_id];
      if (!a || a.fz_pflichtig !== true || !laeuft(f, heute)) return;
      (proPerson[f.mitglied_id] = proPerson[f.mitglied_id] || []).push(f.funktion_id);
    });
    var personen = [], maengel = [];
    Object.keys(proPerson).forEach(function (k) {
      var id = Number(k);
      var q = aktuellesFz(id, quals, arten);
      var wv = q ? wiedervorlage(q, arten[q.qualifikationsart_id], konfig) : null;
      var ampel = q ? ampelFuerDatum(wv, heute) : 'rot';
      var lizenzen = quals.filter(function (x) {
        return x.mitglied_id === id && !istFz(arten[x.qualifikationsart_id]) && !x.geloescht_am;
      }).map(function (x) {
        var a = arten[x.qualifikationsart_id];
        var stand = !x.gueltig_bis ? 'unbefristet' : x.gueltig_bis < heute ? 'abgelaufen'
          : x.gueltig_bis <= Mitgliedschaft.plusMonate(heute, VORLAUF_MONATE) ? 'läuft ab' : 'gültig';
        return { qualifikation_id: x.qualifikation_id, art: a ? a.bezeichnung : null, gueltig_bis: x.gueltig_bis || null, stand: stand };
      });
      personen.push({
        mitglied_id: id, funktion_ids: proPerson[k],
        fz: q ? { qualifikation_id: q.qualifikation_id, eingesehen_am: q.eingesehen_am, wiedervorlage: wv, ampel: ampel } : null,
        ampel: ampel, lizenzen: lizenzen
      });
      if (!q) maengel.push({ mitglied_id: id, meldung: 'Laufende nachweispflichtige Funktion ohne Führungszeugnis.' });
      else if (ampel === 'rot') maengel.push({ mitglied_id: id, meldung: 'Führungszeugnis abgelaufen (Wiedervorlage ' + wv + ').' });
    });
    var zuLoeschen = [];
    quals.forEach(function (q) {
      var a = arten[q.qualifikationsart_id];
      if (!istFz(a) || q.geloescht_am) return;
      var ab = q.zu_loeschen_ab || zuLoeschenAb(q.mitglied_id, daten, a, heute);
      if (ab && ab <= heute) zuLoeschen.push({ qualifikation_id: q.qualifikation_id, mitglied_id: q.mitglied_id, zu_loeschen_ab: ab });
    });
    personen.sort(function (a, b) { return ['rot', 'gelb', 'gruen'].indexOf(a.ampel) - ['rot', 'gelb', 'gruen'].indexOf(b.ampel) || a.mitglied_id - b.mitglied_id; });
    return { personen: personen, zu_loeschen: zuLoeschen, maengel: maengel };
  }

  /**
   * Werte, die beim Speichern einer FZ-Einsicht abgeleitet und mitgeschrieben werden (wiedervorlage_am, zu_loeschen_ab).
   */
  function abgeleitet(q, daten, art, heute, konfig) {
    if (!istFz(art)) return {};
    return {
      wiedervorlage_am: q.eingesehen_am ? Mitgliedschaft.plusMonate(q.eingesehen_am, Number(art.wiedervorlage_monate) || Number(konfig && konfig.fz_wiedervorlage_monate) || 60) : null,
      zu_loeschen_ab: zuLoeschenAb(q.mitglied_id, daten, art, heute)
    };
  }

  /** Leert einen FZ-Vermerk (Löschung nach § 72a Abs. 5): Feldänderungen. Die Zeile bleibt als „gelöscht am“. */
  function loeschAenderungen(heute) {
    return { ausgestellt_am: null, eingesehen_am: null, eingesehen_durch: null, ergebnis: null, gueltig_bis: null,
      wiedervorlage_am: null, bemerkung: null, geloescht_am: heute };
  }

  return {
    ERGEBNIS_ERLAUBT: ERGEBNIS_ERLAUBT, wiedervorlage: wiedervorlage, zuLoeschenAb: zuLoeschenAb,
    pruefeEinsicht: pruefeEinsicht, ampelFuer: ampelFuer, uebersicht: uebersicht, abgeleitet: abgeleitet,
    loeschAenderungen: loeschAenderungen, pflichtigeFunktionen: pflichtigeFunktionen
  };
})();
