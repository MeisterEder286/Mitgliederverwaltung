/**
 * Sollstellungslauf – Jahres-Sollstellungen planen, Statusübergänge, Einzugsstand (rein).
 *
 * Zweck:      Eine Sollstellung ist der Schnappschuss „Konto X schuldet im Jahr J den Betrag B“ (Übergabe §3).
 *             Sie wird einmal je Konto und Jahr angelegt und danach nie nachgerechnet – ändert sich später
 *             die Beitragsart oder die Familie, bleibt die Historie stimmig.
 * Datenquelle: `daten` wie in src/lib/beitrag.js (Tab-Listen aus DB.lese bzw. Snapshot-Basis).
 * Wer darf was: – (Rechenfunktionen). Anlegen/Ändern im Servermodul mit Aktion sollstellung_bearbeiten.
 * Besonderheiten:
 *   - Eindeutig je (beitragskonto_id, jahr): plane() schlägt für vorhandene Paare nichts Neues vor.
 *   - Einzugsdatum [A]: Fälligkeit des Jahres (_Konfig.sepa_faelligkeit). Liegt sie bei der Planung schon in der
 *     Vergangenheit (Nachzügler, z. B. Eintritt im Laufe des Jahres), heute + Vorlauf (Standard 14 Tage,
 *     Vorabankündigung) – das endgültige Datum setzt der SEPA-Lauf.
 *   - Statusübergänge folgen dem Enum sollstellung_status: offen → bezahlt | ruecklastschrift | gemahnt |
 *     widerspruch | storniert. „storniert“ ist endgültig.
 */
var Sollstellungslauf = (function () {

  var VORLAUF_TAGE = 14;

  /**
   * Plant die Sollstellungen eines Jahres.
   * Liefert { neu: [zeilen ohne ID], vorhanden: [sollstellungen], uebersprungen: [{ konto_id, name, grund }], summe }.
   * konfig: { schluessel: wert } (wie Beitrag.konfig), optionen.vorlaufTage.
   */
  function plane(daten, jahr, heute, konfig, optionen) {
    return Beitrag.mitIndex(daten, function () { return planeIntern(daten, jahr, heute, konfig, optionen); });
  }
  function planeIntern(daten, jahr, heute, konfig, optionen) {
    optionen = optionen || {};
    var opt = { konfig: konfig || null };
    var ix = Beitrag.index(daten);
    var faellig = Beitrag.faelligkeit(daten, opt, jahr);
    var einzug = faellig >= heute ? faellig : Mitgliedschaft.plusTage(heute, optionen.vorlaufTage || VORLAUF_TAGE);
    var vorhandenPaar = {};
    (daten.Sollstellung || []).forEach(function (s) { if (s.jahr === jahr) vorhandenPaar[s.beitragskonto_id] = s; });

    var neu = [], vorhanden = [], uebersprungen = [], summe = 0;
    (daten.Beitragskonto || []).forEach(function (k) {
      var id = k.beitragskonto_id;
      if (vorhandenPaar[id]) { vorhanden.push(vorhandenPaar[id]); return; }
      if (k.aktiv === false) { if ((ix.mitgliederJeKonto[id] || []).length) uebersprungen.push({ konto_id: id, name: k.kontoinhaber_name, grund: 'Konto stillgelegt' }); return; }
      var soll = Beitrag.sollJeKonto(id, daten, jahr, opt);
      if (soll.hinweise.length) uebersprungen.push({ konto_id: id, name: k.kontoinhaber_name, grund: soll.hinweise.join('; '), teilweise: soll.betrag > 0 });
      if (!(soll.betrag > 0)) {
        if (!soll.hinweise.length && (ix.mitgliederJeKonto[id] || []).length) uebersprungen.push({ konto_id: id, name: k.kontoinhaber_name, grund: 'kein beitragspflichtiges Mitglied im Jahr' });
        return;
      }
      neu.push({
        beitragskonto_id: id, jahr: jahr, soll_betrag: soll.betrag, ist_betrag: null, gebuehr: null,
        status: 'offen', sepa_sequenz: null, einzugsdatum: einzug, buchungsdatum: null, mahnstufe: 0,
        ruecklastschrift_grund: null, bemerkung: Beitrag.zusammensetzung(soll).slice(0, 500)
      });
      summe += soll.betrag;
    });
    return { neu: neu, vorhanden: vorhanden, uebersprungen: uebersprungen, summe: Beitrag.runde(summe), einzugsdatum: einzug };
  }

  function fehler(meldung) {
    if (typeof Fehler !== 'undefined' && Fehler.fachlich) return Fehler.fachlich(meldung);
    var e = new Error(meldung); e.art = 'fachlich'; e.meldung = meldung; return e;
  }

  var ERLAUBT = {
    offen: ['bezahlt', 'ruecklastschrift', 'gemahnt', 'widerspruch', 'storniert'],
    bezahlt: ['ruecklastschrift', 'widerspruch', 'storniert'],
    ruecklastschrift: ['bezahlt', 'gemahnt', 'widerspruch', 'storniert'],
    gemahnt: ['bezahlt', 'gemahnt', 'ruecklastschrift', 'widerspruch', 'storniert'],
    widerspruch: ['bezahlt', 'gemahnt', 'storniert'],
    storniert: []
  };

  /**
   * Nächster Zustand einer Sollstellung nach einem Ereignis. Liefert die geänderten Felder (Teilobjekt),
   * wirft einen fachlichen Fehler bei unzulässigem Übergang.
   * ereignis: { art: 'bezahlt', betrag?, datum } · { art: 'ruecklastschrift', grund, gebuehr?, datum } ·
   *           { art: 'gemahnt', gebuehr? } · { art: 'widerspruch', datum } · { art: 'storniert', grund }
   */
  function naechsterStatus(s, ereignis, konfig) {
    var art = ereignis && ereignis.art;
    var von = s.status || 'offen';
    if (!ERLAUBT[von] || ERLAUBT[von].indexOf(art) < 0) {
      throw fehler('Statuswechsel von „' + von + '“ nach „' + art + '“ ist nicht möglich.');
    }
    var gebuehrStandard = konfig && konfig.ruecklastschrift_gebuehr ? Number(String(konfig.ruecklastschrift_gebuehr).replace(',', '.')) : 0;
    var aenderung = { status: art };
    var bisherigeGebuehr = Number(s.gebuehr || 0);
    if (art === 'bezahlt') {
      aenderung.ist_betrag = ereignis.betrag !== undefined && ereignis.betrag !== null ? Beitrag.runde(Number(ereignis.betrag))
        : Beitrag.runde(Number(s.soll_betrag || 0) + bisherigeGebuehr);
      aenderung.buchungsdatum = ereignis.datum || null;
    } else if (art === 'ruecklastschrift') {
      if (!ereignis.grund) throw fehler('Bitte den Grund der Rücklastschrift angeben.');
      var g = ereignis.gebuehr !== undefined && ereignis.gebuehr !== null ? Number(ereignis.gebuehr) : gebuehrStandard;
      aenderung.ist_betrag = 0;
      aenderung.gebuehr = Beitrag.runde(bisherigeGebuehr + (g || 0)) || null;
      aenderung.ruecklastschrift_grund = String(ereignis.grund);
      aenderung.buchungsdatum = ereignis.datum || null;
    } else if (art === 'gemahnt') {
      aenderung.mahnstufe = Number(s.mahnstufe || 0) + 1;
      if (ereignis.gebuehr) aenderung.gebuehr = Beitrag.runde(bisherigeGebuehr + Number(ereignis.gebuehr));
    } else if (art === 'widerspruch') {
      aenderung.ist_betrag = 0;
      aenderung.ruecklastschrift_grund = s.ruecklastschrift_grund || 'Widerspruch';
      aenderung.buchungsdatum = ereignis.datum || null;
    } else if (art === 'storniert') {
      if (!ereignis.grund) throw fehler('Bitte den Grund der Stornierung angeben.');
      aenderung.bemerkung = ((s.bemerkung ? s.bemerkung + ' · ' : '') + 'Storniert: ' + ereignis.grund).slice(0, 500);
    }
    return aenderung;
  }

  /**
   * Kennzahlen zum Einzugsstand eines Jahres (Mockup „Einzugsstand“).
   */
  function einzugsstand(daten, jahr, heute, konfig) {
    return Beitrag.mitIndex(daten, function () { return einzugsstandIntern(daten, jahr, heute, konfig); });
  }
  function einzugsstandIntern(daten, jahr, heute, konfig) {
    var soll = (daten.Sollstellung || []).filter(function (s) { return s.jahr === jahr; });
    var k = {
      anzahl: soll.length, soll_gesamt: 0, ist_gesamt: 0, gebuehren: 0, bezahlt: 0, offen: 0, offen_betrag: 0,
      ruecklastschriften: 0, gemahnt: 0, widerspruch: 0, storniert: 0, streitig_betrag: 0, ohne_mandat: 0,
      je_mahnstufe: {}
    };
    soll.forEach(function (s) {
      var b = Number(s.soll_betrag || 0);
      if (s.status !== 'storniert') k.soll_gesamt += b;
      k.ist_gesamt += Number(s.ist_betrag || 0);
      k.gebuehren += Number(s.gebuehr || 0);
      if (s.status === 'bezahlt') k.bezahlt++;
      if (s.status === 'offen') { k.offen++; k.offen_betrag += b; }
      if (s.status === 'ruecklastschrift') k.ruecklastschriften++;
      if (s.status === 'gemahnt') k.gemahnt++;
      if (s.status === 'widerspruch') k.widerspruch++;
      if (s.status === 'storniert') k.storniert++;
      if (['ruecklastschrift', 'gemahnt', 'widerspruch'].indexOf(s.status) >= 0) {
        k.streitig_betrag += Math.max(0, b + Number(s.gebuehr || 0) - Number(s.ist_betrag || 0));
      }
      if (s.mahnstufe) k.je_mahnstufe[s.mahnstufe] = (k.je_mahnstufe[s.mahnstufe] || 0) + 1;
    });
    var opt = { konfig: konfig || null };
    var ix = Beitrag.index(daten);
    (daten.Beitragskonto || []).forEach(function (konto) {
      if (konto.aktiv === false || konto.zahlweg !== 'Lastschrift') return;
      if (!(ix.mitgliederJeKonto[konto.beitragskonto_id] || []).length) return;
      var fehlt = !konto.mandatsreferenz || !konto.mandatsdatum || !(konto.iban || konto.iban_maskiert);
      if (fehlt || (heute && Beitrag.mandatStatus(konto, daten, heute, opt).verfallen)) k.ohne_mandat++;
    });
    ['soll_gesamt', 'ist_gesamt', 'gebuehren', 'offen_betrag', 'streitig_betrag'].forEach(function (f) { k[f] = Beitrag.runde(k[f]); });
    return k;
  }

  return { plane: plane, naechsterStatus: naechsterStatus, einzugsstand: einzugsstand, ERLAUBT: ERLAUBT };
})();
