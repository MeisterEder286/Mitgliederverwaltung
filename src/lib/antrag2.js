/**
 * Antrag2 – Online-Aufnahmeantrag im Format „tsv-antrag-2“ (JSON von der Homepage) prüfen und umwandeln (rein).
 *
 * Zweck:      Nachfolger der Access-XML für Online-Anträge. WordPress beschreibt den Antrag so, wie ihn die
 *             Mitgliederverwaltung braucht: Tarif- und Abteilungs-SCHLÜSSEL statt Beträgen und Anzeigenamen,
 *             Anschrift und Konto nur einmal, Unterschriften mit Datum und Rolle, Einwilligungen.
 *             zuAntrag() macht daraus die interne Form des Beitritts-Imports (Personen als Felder wie in Daten16,
 *             dazu „online“ mit Tarif, Abteilungen, Unterschriften, Einwilligungen) – geplant wird in
 *             src/lib/beitritt.js (Beitritt.plane), damit Anschrift, Dubletten und Konto eine Quelle haben.
 * Datenquelle: das JSON (Text oder Objekt) aus der Eingangstabelle bzw. aus einer .json-Datei im Datei-Import.
 * Wer darf was: – (Rechte prüft das Servermodul).
 * Besonderheiten:
 *   - Beschreibung des Formats mit Beispiel: docs/EINGANG.md („Format tsv-antrag-2“).
 *   - Unbekannte Felder werden ignoriert; Texte gekürzt (MAX_TEXT); Daten nur JJJJ-MM-TT.
 *   - Schlüssel (Tarif, Abteilungen, Einwilligungen) werden vereinheitlicht: klein, ohne Umlaute, Leerzeichen → „-“.
 *   - Preise kommen NIE aus dem Antrag: Der Tarif-Schlüssel wird über Beitragsart.online_schluessel aufgelöst.
 */
var Antrag2 = (function () {
  var FORMAT = 'tsv-antrag-2';
  var MAX_PERSONEN = 10;
  var MAX_TEXT = 200;
  var MAX_JSON = 60000;
  /** Einwilligungs-Schlüssel des Formulars → Auswahlliste einwilligung_art. */
  var EINWILLIGUNGEN = {
    fotos: 'Fotos und Videos',
    newsletter: 'Newsletter per E-Mail',
    ehrungen: 'Ehrungen und Geburtstage in Vereinsmedien',
    messenger: 'Messenger-Gruppe'
  };

  function text(v, max) {
    if (v === null || v === undefined || typeof v === 'object') return null;
    var s = String(v).replace(/\s+/g, ' ').trim();
    return s === '' ? null : s.slice(0, max || MAX_TEXT);
  }
  function datum(v) {
    var s = text(v, 10);
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  /** Schlüssel vereinheitlichen: „Fitness Turnen“ → „fitness-turnen“, „Fußball“ → „fussball“. */
  function schluessel(v) {
    var s = String(v === null || v === undefined ? '' : v).toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[\s_]+/g, '-').replace(/[^a-z0-9\-]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
    return s.slice(0, 40) || null;
  }
  /** „a, b“ bzw. Liste → vereinheitlichte Schlüssel. */
  function schluesselListe(v) {
    var l = Array.isArray(v) ? v : String(v === null || v === undefined ? '' : v).split(',');
    var aus = [];
    l.forEach(function (x) { var k = schluessel(x); if (k && aus.indexOf(k) < 0) aus.push(k); });
    return aus;
  }

  function istFormat(o) { return !!o && typeof o === 'object' && o.format === FORMAT; }

  /** Text oder Objekt → Objekt; { fehler } bei ungültigem JSON. */
  function lies(json) {
    if (json && typeof json === 'object') return { objekt: json };
    var s = String(json === null || json === undefined ? '' : json);
    if (!s.trim()) return { fehler: 'Leerer Antrag.' };
    if (s.length > MAX_JSON) return { fehler: 'Antrag zu groß.' };
    try { return { objekt: JSON.parse(s) }; } catch (e) { return { fehler: 'Kein gültiges JSON.' }; }
  }

  /**
   * Antrag (Text oder Objekt) → { datei, personen: [{ Feld: 'Text' }], unterschrift_am, online } oder { datei, fehler }.
   * personen: Felder wie in Daten16 (Anrede, Nachname, …, IBAN nur bei Person 1), Eintritt = mitglied_ab.
   * online: { tarif, abteilungen: [Schlüssel], kontoinhaber, antrag_unterschrift: { datum, name, als },
   *           sepa_unterschrift: { datum, name }, bestaetigt: { datenschutz, sepa_mandat }, einwilligungen: [Art],
   *           bemerkung }
   */
  function zuAntrag(json, datei) {
    var d = String(datei || 'Online-Antrag');
    var l = lies(json);
    if (l.fehler) return { datei: d, fehler: l.fehler };
    var o = l.objekt;
    if (!istFormat(o)) return { datei: d, fehler: 'Unbekanntes Format (erwartet „' + FORMAT + '“).' };
    if (!Array.isArray(o.personen) || !o.personen.length) return { datei: d, fehler: 'Keine Personen im Antrag.' };
    if (o.personen.length > MAX_PERSONEN) return { datei: d, fehler: 'Mehr als ' + MAX_PERSONEN + ' Personen in einem Antrag.' };
    var a = o.anschrift && typeof o.anschrift === 'object' ? o.anschrift : {};
    var k = o.konto && typeof o.konto === 'object' ? o.konto : {};
    var u = o.unterschriften && typeof o.unterschriften === 'object' ? o.unterschriften : {};
    var ua = u.antrag && typeof u.antrag === 'object' ? u.antrag : {};
    var us = u.sepa && typeof u.sepa === 'object' ? u.sepa : {};
    var eintritt = datum(o.mitglied_ab);
    var personen = [];
    for (var i = 0; i < o.personen.length; i++) {
      var p = o.personen[i];
      if (!p || typeof p !== 'object') return { datei: d, fehler: 'Person ' + (i + 1) + ' ist ungültig.' };
      if (!text(p.nachname) || !text(p.vorname)) return { datei: d, fehler: 'Person ' + (i + 1) + ': Vor- und Nachname fehlen.' };
      var z = {
        Anrede: text(p.anrede, 20), Titel: text(p.titel, 40), Nachname: text(p.nachname), Vorname: text(p.vorname),
        GebDat: datum(p.geburtsdatum), Geschlecht: text(p.geschlecht, 10),
        Strasse: text(p.strasse) || text(a.strasse), Plz: text(p.plz, 10) || text(a.plz, 10), Ort: text(p.ort) || text(a.ort),
        Telefon: text(p.telefon, 40), Handy: text(p.handy, 40), email: text(p.email),
        EinDat: eintritt, Bemerkung: 'Online-Antrag' + (datum(ua.datum) ? ' vom ' + datum(ua.datum).split('-').reverse().join('.') : '')
      };
      if (i === 0) { z.IBAN = text(k.iban, 40); z.BIC = text(k.bic, 11); z.Kontoinhaber = text(k.kontoinhaber); }
      var sauber = {};
      Object.keys(z).forEach(function (f) { if (z[f] !== null) sauber[f] = z[f]; });
      personen.push(sauber);
    }
    var ein = [];
    var e = o.einwilligungen && typeof o.einwilligungen === 'object' ? o.einwilligungen : {};
    Object.keys(e).forEach(function (x) {
      var art = EINWILLIGUNGEN[schluessel(x)];
      if (art && e[x] === true && ein.indexOf(art) < 0) ein.push(art);
    });
    var b = o.bestaetigt && typeof o.bestaetigt === 'object' ? o.bestaetigt : {};
    var unterschrift = datum(us.datum) || datum(ua.datum);
    return {
      datei: d,
      personen: personen,
      unterschrift_am: unterschrift,
      online: {
        tarif: schluessel(o.tarif),
        abteilungen: schluesselListe(o.abteilungen).slice(0, 10),
        kontoinhaber: text(k.kontoinhaber),
        antrag_unterschrift: { datum: datum(ua.datum), name: text(ua.name), als: ua.als === 'erziehungsberechtigt' ? 'erziehungsberechtigt' : 'selbst' },
        sepa_unterschrift: { datum: datum(us.datum), name: text(us.name) },
        bestaetigt: { datenschutz: b.datenschutz === true, sepa_mandat: b.sepa_mandat === true },
        einwilligungen: ein,
        bemerkung: text(o.bemerkung, 500)
      }
    };
  }

  return {
    FORMAT: FORMAT, EINWILLIGUNGEN: EINWILLIGUNGEN, MAX_JSON: MAX_JSON,
    istFormat: istFormat, lies: lies, zuAntrag: zuAntrag, schluessel: schluessel, schluesselListe: schluesselListe
  };
})();
