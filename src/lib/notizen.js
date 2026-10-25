/**
 * NotizRegeln – reine Regeln für interne Notizen, Rückfragen und Wiedervorlagen (Tab Notiz).
 *
 * Zweck:      Wer welche Notiz sehen, schreiben, ändern, erledigen und löschen darf, und wann eine Notiz „fällig“
 *             ist. Wird vom Servermodul (src/modul/Notizen.js) UND vom Snapshot (src/lib/snapshot.js) benutzt, damit
 *             es genau eine Regel gibt.
 * Datenquelle: Notiz-Objekte wie aus DB.lese (Datum 'JJJJ-MM-TT') und der Benutzerkontext ktx
 *             ({ email, rollen, sicht, abteilungen }). Keine Apps-Script-Dienste.
 * Wer darf was (Leserkreis = Notiz.sichtbar_fuer):
 *   - „Verwaltung“    → Rollen mit Sichtklasse verwaltung (Vorstand, Mitgliederverwalter).
 *   - „Finanzen“      → Rollen mit Sichtklasse finanz (Kassier, Vorstand, Mitgliederverwalter).
 *   - „Abteilung“     → Abteilungsleitung genau dieser abteilung_id + Verwaltung.
 *   - „Jugendleitung“ → Jugendleitung + Verwaltung.
 *   Schreiben: nur in Leserkreise, zu denen man selbst gehört (AL nur eigene Abteilung, JL nur Jugendleitung,
 *   Kassier nur Finanzen, Vorstand/MV alle). Ändern/Erledigen: Verfasser oder Verwaltung. Löschen: nur Verwaltung
 *   und nur, wenn kein laufender Vorgang daran hängt (offene Rückfrage/Wiedervorlage → stattdessen erledigen).
 * Besonderheiten:
 *   - Der Leserkreis ist eine ZEILEN-Regel (nicht Sichtklasse): die Spalten der Notiz sind alle „intern“.
 *   - Zusätzlich gilt immer der Personen-Sichtkreis (Snapshot/pruefeMitglied) – eine Abteilungs-Notiz zu einer
 *     Person, die der Abteilungsleiter nicht (mehr) sieht, bleibt für ihn unsichtbar.
 */
var NotizRegeln = (function () {
  var KREISE = ['Verwaltung', 'Finanzen', 'Abteilung', 'Jugendleitung'];
  var VORGANG_ARTEN = ['Rückfrage', 'Wiedervorlage'];

  function hat(liste, x) { return (liste || []).indexOf(x) >= 0; }
  function istVerwaltung(ktx) { return hat(ktx && ktx.sicht, 'verwaltung'); }
  function istFinanzen(ktx) { return hat(ktx && ktx.sicht, 'finanz'); }
  function istJugendleitung(ktx) { return hat(ktx && ktx.rollen, 'Jugendleiter'); }
  function eigeneAbteilungen(ktx) {
    return hat(ktx && ktx.rollen, 'Abteilungsleiter') ? ((ktx && ktx.abteilungen) || []).map(Number) : [];
  }
  function gleicheEmail(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() && !!a; }

  /** Gehört ktx zum Leserkreis der Notiz (ohne Personen-Sichtkreis)? */
  function sichtbar(ktx, notiz) {
    if (!notiz) return false;
    if (istVerwaltung(ktx)) return true;
    switch (notiz.sichtbar_fuer) {
      case 'Finanzen': return istFinanzen(ktx);
      case 'Abteilung': return notiz.abteilung_id !== null && notiz.abteilung_id !== undefined &&
        hat(eigeneAbteilungen(ktx), Number(notiz.abteilung_id));
      case 'Jugendleitung': return istJugendleitung(ktx);
      default: return false;   // 'Verwaltung' und Unbekanntes
    }
  }

  /** Leserkreise, die ktx beim Schreiben wählen darf: [{ kreis, abteilung_id? }]. */
  function erlaubteKreise(ktx) {
    var aus = [];
    if (istVerwaltung(ktx)) aus.push({ kreis: 'Verwaltung' });
    if (istFinanzen(ktx)) aus.push({ kreis: 'Finanzen' });
    if (istVerwaltung(ktx)) aus.push({ kreis: 'Abteilung' }, { kreis: 'Jugendleitung' });
    else {
      eigeneAbteilungen(ktx).forEach(function (a) { aus.push({ kreis: 'Abteilung', abteilung_id: a }); });
      if (istJugendleitung(ktx)) aus.push({ kreis: 'Jugendleitung' });
    }
    return aus;
  }

  /** Darf ktx eine Notiz mit diesem Leserkreis (und ggf. dieser Abteilung) anlegen? */
  function darfKreis(ktx, kreis, abteilungId) {
    if (KREISE.indexOf(kreis) < 0) return false;
    if (istVerwaltung(ktx)) return kreis !== 'Abteilung' || (abteilungId !== null && abteilungId !== undefined && abteilungId !== '');
    if (kreis === 'Finanzen') return istFinanzen(ktx);
    if (kreis === 'Jugendleitung') return istJugendleitung(ktx);
    if (kreis === 'Abteilung') return hat(eigeneAbteilungen(ktx), Number(abteilungId));
    return false;
  }

  /** Ändern/Erledigen: Verfasser (und weiterhin im Leserkreis) oder Verwaltung. */
  function darfAendern(ktx, notiz) {
    if (!notiz) return false;
    if (istVerwaltung(ktx)) return true;
    return gleicheEmail(notiz.erstellt_von, ktx && ktx.email) && sichtbar(ktx, notiz);
  }

  /** Läuft an der Notiz noch ein Vorgang (offene Rückfrage/Wiedervorlage)? */
  function laufenderVorgang(notiz) {
    return !!notiz && !notiz.erledigt_am && (hat(VORGANG_ARTEN, notiz.art) || !!notiz.wiedervorlage_am);
  }

  /** Löschen: nur Verwaltung und nur ohne laufenden Vorgang. Liefert { ok, grund }. */
  function darfLoeschen(ktx, notiz) {
    if (!istVerwaltung(ktx)) return { ok: false, grund: 'zugriff' };
    if (laufenderVorgang(notiz)) return { ok: false, grund: 'Offene Rückfragen und Wiedervorlagen bitte erledigen statt löschen.' };
    return { ok: true };
  }

  /** Offen = nicht erledigt. Fällig = offen und Wiedervorlage ≤ Stichtag (ohne Datum: Rückfrage ist sofort offen, nicht fällig). */
  function offen(notiz) { return !!notiz && !notiz.erledigt_am; }
  function faellig(notiz, heute) {
    return offen(notiz) && !!notiz.wiedervorlage_am && String(notiz.wiedervorlage_am) <= String(heute);
  }

  /** Sortierung „zu erledigen“: fällige zuerst nach Datum, dann offene Rückfragen ohne Datum, neueste zuerst. */
  function sortiereZuErledigen(liste) {
    return liste.slice().sort(function (a, b) {
      var x = a.wiedervorlage_am || '9999-99-99', y = b.wiedervorlage_am || '9999-99-99';
      if (x !== y) return x < y ? -1 : 1;
      return Number(b.notiz_id || 0) - Number(a.notiz_id || 0);
    });
  }

  /** Text des Ergebnisses einer beantworteten Zahler-Rückfrage. */
  var ANTWORTEN = {
    konto_bleibt: 'Antwort: Abbuchung weiterhin über das bisherige Konto.',
    eigenes_konto: 'Antwort: eigenes Konto – neues SEPA-Mandat nötig (Konto anlegen und Person umhängen).',
    ueberweisung: 'Antwort: zahlt künftig per Überweisung (Konto mit Zahlweg Überweisung anlegen und Person umhängen).'
  };

  return {
    KREISE: KREISE, ANTWORTEN: ANTWORTEN, sichtbar: sichtbar, erlaubteKreise: erlaubteKreise, darfKreis: darfKreis,
    darfAendern: darfAendern, darfLoeschen: darfLoeschen, laufenderVorgang: laufenderVorgang,
    offen: offen, faellig: faellig, sortiereZuErledigen: sortiereZuErledigen
  };
})();
