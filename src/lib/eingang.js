/**
 * Eingang – Beitrittsanträge von der Vereins-Homepage aus der getrennten Eingangstabelle (rein, ohne Dienste).
 *
 * Zweck:      Die Homepage (WordPress) schickt jeden Online-Aufnahmeantrag an ein eigenes, kleines Skriptprojekt –
 *             im Format „tsv-antrag-2“ (JSON, src/lib/antrag2.js) oder übergangsweise als Access-XML (/dataroot/Daten16).
 *             Das Skript legt die Datei im Drive-Ordner ab und schreibt eine Zeile in den Tab „Eingang“ der
 *             Eingangstabelle (Spalte inhalt, Spalte format). Diese Datei liest die WebApp: Spalten prüfen, Inhalt
 *             zerlegen, Liste für den Browser (nur Namen, keine Bankdaten), Zeile nach Übernahme/Ablehnung abschließen.
 * Datenquelle: Zeilen des Tabs „Eingang“ (Kopfzeile = SPALTEN). Die Datei-ID steht in der Script Property EINGANG_ID
 *             (nie vom Client, A3); das Servermodul (src/modul/Beitritt.js) öffnet sie.
 * Wer darf was: – (Rechte prüft das Servermodul: mitglied_anlegen UND konto_bearbeiten).
 * Besonderheiten:
 *   - Der Inhalt wird hier auf dem SERVER zerlegt – anders als beim Datei-Import im Browser, denn sie enthält die
 *     Klartext-IBAN, die den Server nie verlässt. Das Ergebnis entspricht dem Browser-Zerleger
 *     (ansicht_beitritt.html: je <Daten16> ein Objekt Feldname → getrimmter Text).
 *   - Bewusst kleiner Zerleger für flache Access-XML: Kommentare, <?xml?>, CDATA, Entities. DOCTYPE wird
 *     abgelehnt. Kein allgemeiner XML-Parser.
 *   - Nach Übernahme oder Ablehnung wird die Spalte inhalt geleert (Datensparsamkeit); das Original liegt im
 *     eingeschränkten Drive-Ordner (drive_link).
 *   - pdf_link: das von der Homepage erzeugte PDF mit Unterschrift (Antrag und ggf. SEPA-Mandat) im selben Ordner.
 *     Bei der Übernahme entstehen daraus Dokument-Links (dokumente()). unterschrift_am: Datum auf dem PDF (bei
 *     beiden Unterschriften, Antrag und SEPA-Mandat) – wird zum Mandatsdatum; fehlt es, gilt der Tag des Eingangs.
 */
var Eingang = (function () {
  var TAB = 'Eingang';
  var SPALTEN = ['eingang_id', 'eingang_am', 'format', 'dateiname', 'inhalt', 'drive_link', 'pdf_link', 'unterschrift_am', 'status', 'erledigt_am', 'erledigt_von', 'ergebnis'];
  var PFLICHT = ['eingang_id', 'inhalt', 'status'];
  var STATUS = { neu: 'neu', uebernommen: 'uebernommen', abgelehnt: 'abgelehnt' };
  var MAX_XML = 500000;   // wie beim Datei-Import im Browser

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function entities(s) {
    return s.replace(/&(#x[0-9A-Fa-f]+|#\d+|[A-Za-z]+);/g, function (m, e) {
      if (e.charAt(0) === '#') {
        var n = e.charAt(1) === 'x' || e.charAt(1) === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(n) && n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
    });
  }

  /** Textinhalt eines Elements (wie textContent): CDATA wörtlich, verschachtelte Tags weg, Entities aufgelöst. */
  function textInhalt(inneres) {
    var teile = String(inneres).split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
    return teile.map(function (t) {
      var c = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(t);
      return c ? c[1] : entities(t.replace(/<[^>]*>/g, ''));
    }).join('');
  }

  /** Feldnamen ohne Namensraum-Präfix, Access-Kodierung „_x0020_“ aufgelöst (wie Beitritt.dekodiere). */
  function feldname(tag) {
    var n = String(tag).replace(/^[^:]*:/, '');
    return n.replace(/_x([0-9A-Fa-f]{4})_/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
  }

  /**
   * XML-Text → { personen: [{ Feld: 'Text' }] } oder { fehler: 'Text' }.
   */
  function zerlege(xml) {
    var s = String(xml === null || xml === undefined ? '' : xml);
    if (!s.trim()) return { fehler: 'Leere Datei.' };
    if (s.length > MAX_XML) return { fehler: 'Datei zu groß.' };
    if (/<!DOCTYPE/i.test(s)) return { fehler: 'XML mit DOCTYPE wird nicht angenommen.' };
    s = s.replace(/^\uFEFF/, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    if (!/^\s*</.test(s)) return { fehler: 'Keine gültige XML-Datei.' };
    var personen = [];
    var eintrag = /<((?:[\w.\-]+:)?Daten16)(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/\1\s*>)/g;
    var m;
    while ((m = eintrag.exec(s))) {
      var o = {};
      var kind = /<((?:[\w.\-]+:)?[A-Za-z_][\w.\-]*)(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/\1\s*>)/g;
      var k, inneres = m[2] || '';
      while ((k = kind.exec(inneres))) o[feldname(k[1])] = textInhalt(k[2] || '').trim();
      personen.push(o);
    }
    if (!personen.length) return { fehler: 'Keine Datensätze (<Daten16>) in der Datei.' };
    return { personen: personen };
  }

  /** Kopfzeile prüfen: liefert fehlende Pflichtspalten (leer = in Ordnung). */
  function fehlendeSpalten(kopf) {
    var k = (kopf || []).map(function (x) { return String(x).trim(); });
    return PFLICHT.filter(function (s) { return k.indexOf(s) < 0; });
  }

  /** Tabellenwerte (inkl. Kopfzeile) → Objekte mit zeile (1-basiert, nur zum Zurückschreiben). */
  function zeilen(werte) {
    if (!werte || !werte.length) return [];
    var kopf = werte[0].map(function (x) { return String(x).trim(); });
    return werte.slice(1).map(function (z, i) {
      var o = { zeile: i + 2 };
      kopf.forEach(function (h, j) { if (h) o[h] = z[j] === undefined || z[j] === null ? '' : z[j]; });
      o.eingang_id = String(o.eingang_id || '').trim();
      o.status = String(o.status || '').trim() || STATUS.neu;
      return o;
    }).filter(function (o) { return o.eingang_id || String(o.inhalt || '').trim(); });
  }

  function offen(z) { return z.status === STATUS.neu; }

  function driveLink(v) {
    var s = String(v || '').trim();
    return /^https:\/\/(drive|docs)\.google\.com\//.test(s) ? s : null;
  }

  function dateiname(z) {
    var n = String(z.dateiname || '').replace(/[^\w .()\-äöüÄÖÜß]/g, '').slice(0, 120);
    return n || ('Online-Antrag ' + z.eingang_id);
  }

  /** Name „Nachname, Vorname“ aus den Access-Feldern (Schreibweise egal). */
  function name(p) {
    function f(namen) {
      var ks = Object.keys(p);
      for (var i = 0; i < ks.length; i++) if (namen.indexOf(ks[i].toLowerCase().replace(/[\s_]/g, '')) >= 0) return String(p[ks[i]] || '').trim();
      return '';
    }
    return [f(['nachname', 'name']), f(['vorname'])].filter(Boolean).join(', ') || '(ohne Namen)';
  }

  /** JSON-Antrag (tsv-antrag-2)? Spalte format oder Inhalt beginnt mit „{“. */
  function istJson(z) {
    return String(z.format || '').trim() === Antrag2.FORMAT || /^\s*\{/.test(String(z.inhalt || ''));
  }

  /**
   * Antrag für BeitrittModul aus einer Zeile: { datei, json } (tsv-antrag-2, wandelt Beitritt.bereinige um),
   * { datei, personen, unterschrift_am } (XML) oder { datei, fehler }.
   */
  function antrag(z) {
    var d = dateiname(z);
    if (!z.eingang_id) return { datei: d, fehler: 'Zeile ohne eingang_id.' };
    if (istJson(z)) {
      var v2 = Antrag2.zuAntrag(String(z.inhalt || ''), d);
      return v2.fehler ? { datei: d, fehler: v2.fehler } : { datei: d, json: String(z.inhalt), personen: v2.personen };
    }
    var r = zerlege(z.inhalt);
    if (r.fehler) return { datei: d, fehler: r.fehler };
    var u = String(z.unterschrift_am || z.eingang_am || '').slice(0, 10);
    return { datei: d, personen: r.personen, unterschrift_am: /^\d{4}-\d{2}-\d{2}$/.test(u) ? u : null };
  }

  /** Eintrag für den Browser: ohne XML und ohne Bankdaten – nur Eingang, Datei, Namen, Link. */
  function fuerListe(z) {
    var a = antrag(z);
    return {
      eingang_id: z.eingang_id, eingang_am: z.eingang_am ? String(z.eingang_am) : null, datei: a.datei,
      drive_link: driveLink(z.drive_link), pdf_link: driveLink(z.pdf_link),
      status: z.status, personen: a.personen ? a.personen.map(name) : [], fehler: a.fehler || null
    };
  }

  /**
   * Dokument-Zeilen zum unterschriebenen PDF nach der Übernahme: „Aufnahmeantrag“ je Person des Antrags (auch Wiedereintritt) und
   * „SEPA-Mandat“ am Konto (bei Lastschrift). ergebnis: Ergebnis von BeitrittModul (personen, konto_id),
   * lastschrift: true/false. Ohne gültigen Drive-Link: [].
   */
  function dokumente(z, ergebnis, lastschrift) {
    var link = driveLink(z.pdf_link);
    if (!link || !ergebnis) return [];
    var datum = z.eingang_am ? String(z.eingang_am).slice(0, 10) : null;
    var titel = 'Online-Aufnahmeantrag' + (datum ? ' ' + datum.split('-').reverse().join('.') : '') + ' (unterschrieben)';
    var liste = (ergebnis.personen || []).map(function (p) {
      return { mitglied_id: p.mitglied_id, beitragskonto_id: null, art: 'Aufnahmeantrag', titel: titel, link: link, datum: datum,
        bemerkung: 'Eingang ' + z.eingang_id };
    });
    if (lastschrift && ergebnis.konto_id && liste.length) {
      liste.push({ mitglied_id: liste[0].mitglied_id, beitragskonto_id: ergebnis.konto_id, art: 'SEPA-Mandat',
        titel: 'SEPA-Mandat online' + (datum ? ' ' + datum.split('-').reverse().join('.') : '') + ' (unterschrieben)', link: link, datum: datum,
        bemerkung: 'Eingang ' + z.eingang_id });
    }
    return liste;
  }

  /** Werte zum Abschließen einer Zeile (inhalt wird geleert). ergebnis: kurzer Text ohne Bankdaten. */
  function abschluss(status, jetzt, email, ergebnis) {
    return { status: status, erledigt_am: jetzt, erledigt_von: email || '', ergebnis: String(ergebnis || '').slice(0, 200), inhalt: '' };
  }

  return {
    TAB: TAB, SPALTEN: SPALTEN, STATUS: STATUS, MAX_XML: MAX_XML,
    zerlege: zerlege, fehlendeSpalten: fehlendeSpalten, zeilen: zeilen, offen: offen, antrag: antrag,
    fuerListe: fuerListe, abschluss: abschluss, name: name, dokumente: dokumente
  };
})();
