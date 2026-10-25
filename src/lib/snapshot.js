/**
 * SnapshotKern – reine Logik des Daten-Snapshots: Basis bauen, rollenbeschnittene Client-Sicht ableiten,
 * Änderungen einspielen (write-through). Keine Apps-Script-Dienste, vollständig in Node getestet.
 *
 * Zweck:      Architektur „einmal laden, lokal arbeiten“ (docs/PHASE0_Konzept.md Abschnitt 6, Vertrag in
 *             docs/ENTWICKLUNG.md §6). Der Server hält EINE Basis (alle Rohzeilen, ohne IBAN-Klartext) im Cache
 *             und schneidet daraus bei jeder Anfrage die Sicht der aufrufenden Rolle.
 * Datenquelle: Rohzeilen aus DB.lese (Datum 'JJJJ-MM-TT', ja/nein als true/false) und _Konfig-Werte.
 * Wer darf was:
 *   - Feldschnitt: Rechte.schneide (Sichtklassen aus dem Feldkatalog).
 *   - Zeilenschnitt je Rolle (Rechte.zeilenSicht, Mehrfachrollen = Vereinigung):
 *       alle      – alle Personen.
 *       abteilung – Personen mit laufender Zugehörigkeit oder laufender Funktion in einer eigenen Abteilung
 *                   (ktx.abteilungen). Von ihnen sind nur Zugehörigkeiten/Funktionen DIESER Abteilungen sichtbar –
 *                   wer auch im Turnen ist, erscheint beim Fußball-AL nur mit „Fußball“ (AL-Mockup).
 *                   Qualifikationen nur von Personen mit laufender Funktion in einer eigenen Abteilung.
 *       jugend    – Personen bis _Konfig.jugend_bis_alter (am heutigen Tag) und alle mit laufender
 *                   FZ-pflichtiger Funktion (die Nachweise betreut die Jugendleitung).
 *   - Gesperrte (verarbeitung_eingeschraenkt) und anonymisierte Personen nur mit Sichtklasse „verwaltung“.
 *   - Finanzlisten (konten, gemeinschaften, sollstellungen) nur mit Sichtklasse „finanz“,
 *     qualifikationen nur mit „hochsensibel“, Ampel fz_ampel nur mit „hochsensibel“.
 * Besonderheiten:
 *   - IBAN/BIC stehen NIE in der Basis und damit nie im Cache oder beim Client. Ersatz: iban_maskiert, iban_ok.
 *     Den Klartext lädt nur die Funktion „IBAN aufdecken“ einzeln und protokolliert (Phase 4).
 *   - Abgeleitete Felder an mitglieder: status_abgeleitet, mitglied_seit, alter, jugend, gekuendigt_zum,
 *     abteilungen (laufende, sichtbare abteilung_ids), funktionen_laufend (funktionsart_ids), fz_ampel.
 *   - Verkleinerung: Felder ohne Wert (null/'') werden im Client-Snapshot weggelassen (im Browser undefined).
 *     Sollstellungen nur der letzten _Konfig.snapshot_sollstellung_jahre Beitragsjahre (Standard 3);
 *     ältere Jahre lädt der Finanzbereich bei Bedarf einzeln.
 *   - Alle Funktionen sind rein: Eingaben werden nicht verändert (aenderungAnwenden liefert eine neue Basis).
 */
var SnapshotKern = (function () {

  /** Tabs der Basis und ihr Listenname beim Client. */
  var LISTEN = {
    Mitglied: 'mitglieder',
    Mitgliedschaftszeitraum: 'zeitraeume',
    Abteilung: 'abteilungen',
    Abteilungszugehoerigkeit: 'zugehoerigkeiten',
    Funktionsart: 'funktionsarten',
    Funktion: 'funktionen',
    Beitragsart: 'beitragsarten',
    Beitragsgemeinschaft: 'gemeinschaften',
    Beitragskonto: 'konten',
    Sollstellung: 'sollstellungen',
    Qualifikationsart: 'qualifikationsarten',
    Qualifikation: 'qualifikationen',
    Ehrungsregel: 'ehrungsregeln',
    Ehrung: 'ehrungen',
    Einwilligung: 'einwilligungen'
  };
  var TABS = Object.keys(LISTEN);
  var STAMMDATEN = ['Abteilung', 'Funktionsart', 'Beitragsart', 'Qualifikationsart', 'Ehrungsregel'];
  var FINANZ = ['Beitragsgemeinschaft', 'Beitragskonto', 'Sollstellung'];

  function idSpalte(tab) { return Schema.TABELLEN[tab].idSpalte; }

  // ------------------------------------------------------------------ IBAN (bewusst eigenständig)

  /** Prüfziffer nach ISO 13616 (mod 97). */
  function ibanOk(iban) {
    var s = String(iban || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    var umgestellt = s.slice(4) + s.slice(0, 4);
    var rest = 0;
    for (var i = 0; i < umgestellt.length; i++) {
      var c = umgestellt.charCodeAt(i);
      var ziffern = c >= 65 ? String(c - 55) : umgestellt.charAt(i);
      for (var j = 0; j < ziffern.length; j++) rest = (rest * 10 + Number(ziffern.charAt(j))) % 97;
    }
    return rest === 1;
  }

  /** 'DE89370400440532013000' → 'DE89 •••• 3000'. */
  function ibanMaskiert(iban) {
    var s = String(iban || '').replace(/\s+/g, '').toUpperCase();
    if (s.length < 8) return s ? '••••' : null;
    return s.slice(0, 4) + ' •••• ' + s.slice(-4);
  }

  // ------------------------------------------------------------------ Basis

  /**
   * Baut die Basis aus Rohzeilen. tabs: { Tab: [zeilen] } (fehlende Tabs = leer), konfig: { schluessel: wert }.
   * Ergebnis: { tabs: {…}, konfig: {…} } – Beitragskonto ohne iban/bic, dafür iban_maskiert/iban_ok.
   */
  function basisAusTabs(tabs, konfig) {
    var basis = { tabs: {}, konfig: konfig || {} };
    TABS.forEach(function (tab) {
      var zeilen = (tabs && tabs[tab]) || [];
      basis.tabs[tab] = tab === 'Beitragskonto' ? zeilen.map(kontoOhneIban) : zeilen.slice();
    });
    return basis;
  }

  function kontoOhneIban(k) {
    var o = {};
    Object.keys(k).forEach(function (f) { if (f !== 'iban' && f !== 'bic') o[f] = k[f]; });
    o.iban_maskiert = k.iban ? ibanMaskiert(k.iban) : null;
    o.iban_ok = k.iban ? ibanOk(k.iban) : null;
    return o;
  }

  // ------------------------------------------------------------------ Hilfen

  function nachFeld(liste, feld) {
    var m = {};
    liste.forEach(function (z) { var k = z[feld]; (m[k] = m[k] || []).push(z); });
    return m;
  }
  function nachId(liste, feld) {
    var m = {};
    liste.forEach(function (z) { m[z[feld]] = z; });
    return m;
  }
  function hat(liste, x) { return liste.indexOf(x) >= 0; }

  /** Feldschnitt plus Verkleinerung: leere Felder (null/'') entfallen – im Browser sind sie dann undefined. */
  function schnitt(ktx, tab, z) {
    var o = Rechte.schneide(ktx, tab, z);
    Object.keys(o).forEach(function (k) { if (o[k] === null || o[k] === '') delete o[k]; });
    return o;
  }

  /** Ältestes Beitragsjahr, dessen Sollstellungen im Snapshot stehen (ältere lädt der Finanzbereich bei Bedarf). */
  function abJahr(konfig, heute) {
    var jahr = Number(konfig.beitragsjahr) || Number(String(heute).slice(0, 4));
    var n = Number(konfig.snapshot_sollstellung_jahre) || 3;
    return jahr - n + 1;
  }

  /** Ampel Führungszeugnis einer Person (null = keine laufende FZ-pflichtige Funktion). */
  function fzAmpel(mitgliedId, ix, heute) {
    var pflicht = (ix.funktionenJe[mitgliedId] || []).some(function (f) {
      var art = ix.funktionsart[f.funktionsart_id];
      return art && art.fz_pflichtig === true && Mitgliedschaft.laeuft(f.von, f.bis, heute);
    });
    if (!pflicht) return null;
    var beste = null;
    (ix.qualifikationenJe[mitgliedId] || []).forEach(function (q) {
      var art = ix.qualifikationsart[q.qualifikationsart_id];
      if (!art || art.kategorie !== 'Führungszeugnis' || q.geloescht_am || !q.eingesehen_am) return;
      var monate = Number(art.wiedervorlage_monate) || Number(ix.konfig.fz_wiedervorlage_monate) || 60;
      var wv = q.wiedervorlage_am || Mitgliedschaft.plusMonate(q.eingesehen_am, monate);
      if (!beste || wv > beste) beste = wv;
    });
    if (!beste || beste < heute) return 'rot';
    return beste <= Mitgliedschaft.plusMonate(heute, 3) ? 'gelb' : 'gruen';
  }

  function indexiere(basis) {
    var t = basis.tabs;
    return {
      konfig: basis.konfig || {},
      zeitraeumeJe: nachFeld(t.Mitgliedschaftszeitraum, 'mitglied_id'),
      zugehJe: nachFeld(t.Abteilungszugehoerigkeit, 'mitglied_id'),
      funktionenJe: nachFeld(t.Funktion, 'mitglied_id'),
      qualifikationenJe: nachFeld(t.Qualifikation, 'mitglied_id'),
      funktionsart: nachId(t.Funktionsart, 'funktionsart_id'),
      qualifikationsart: nachId(t.Qualifikationsart, 'qualifikationsart_id')
    };
  }

  /**
   * Personenkreis eines Kontexts: { ids: {id: true}, eigeneAbteilung: {id: true} (Personen mit Bezug zu einer
   * eigenen Abteilung), funktionEigeneAbt: {id: true}, jugend: {id: true} } – je nach Zeilensicht.
   */
  function personenkreis(basis, ix, ktx, heute) {
    var z = Rechte.zeilenSicht(ktx);
    var verwaltung = hat(ktx.sicht || [], 'verwaltung');
    var abt = (ktx.abteilungen || []).map(Number);
    var bisAlter = Number(ix.konfig.jugend_bis_alter);
    if (!isFinite(bisAlter) || ix.konfig.jugend_bis_alter === undefined || ix.konfig.jugend_bis_alter === '') bisAlter = 17;
    var kreis = { ids: {}, eigeneAbteilung: {}, funktionEigeneAbt: {}, jugend: {}, sicht: z };
    basis.tabs.Mitglied.forEach(function (m) {
      var id = m.mitglied_id;
      if ((m.verarbeitung_eingeschraenkt === true || m.anonymisiert === true) && !verwaltung) return;
      if (z.alle) { kreis.ids[id] = true; return; }
      if (z.abteilung && abt.length) {
        var zug = (ix.zugehJe[id] || []).some(function (a) {
          return hat(abt, Number(a.abteilung_id)) && Mitgliedschaft.laeuft(a.eintrittsdatum || '0000-01-01', a.austrittsdatum, heute);
        });
        var fkt = (ix.funktionenJe[id] || []).some(function (f) {
          return f.abteilung_id !== null && hat(abt, Number(f.abteilung_id)) && Mitgliedschaft.laeuft(f.von, f.bis, heute);
        });
        if (zug || fkt) { kreis.ids[id] = true; kreis.eigeneAbteilung[id] = true; }
        if (fkt) kreis.funktionEigeneAbt[id] = true;
      }
      if (z.jugend) {
        var jung = Mitgliedschaft.istJugend(m.geburtsdatum, heute, bisAlter);
        var fzPflicht = (ix.funktionenJe[id] || []).some(function (f) {
          var art = ix.funktionsart[f.funktionsart_id];
          return art && art.fz_pflichtig === true && Mitgliedschaft.laeuft(f.von, f.bis, heute);
        });
        if (jung || fzPflicht) { kreis.ids[id] = true; kreis.jugend[id] = true; }
      }
    });
    return kreis;
  }

  /** Darf diese Zeile einer personenbezogenen Liste gesehen werden? */
  function zeileSichtbar(tab, zeile, kreis, ktx) {
    var mid = zeile.mitglied_id;
    if (!kreis.ids[mid]) return false;
    if (kreis.sicht.alle) return true;
    var abt = (ktx.abteilungen || []).map(Number);
    if (kreis.jugend[mid]) return true;   // Jugendleitung sieht die Person vollständig
    if (tab === 'Abteilungszugehoerigkeit') return hat(abt, Number(zeile.abteilung_id));
    if (tab === 'Funktion') return zeile.abteilung_id !== null && hat(abt, Number(zeile.abteilung_id));
    if (tab === 'Qualifikation') return !!kreis.funktionEigeneAbt[mid];
    return true;
  }

  // ------------------------------------------------------------------ Client-Sicht

  /** Rollenbeschnittener Client-Snapshot (siehe Kopfkommentar). */
  function fuer(basis, ktx, heute) {
    var ix = indexiere(basis);
    var kreis = personenkreis(basis, ix, ktx, heute);
    var sicht = ktx.sicht || [];
    var aus = {};

    TABS.forEach(function (tab) {
      var liste = LISTEN[tab];
      if (hat(FINANZ, tab) && !hat(sicht, 'finanz')) return;
      if (tab === 'Qualifikation' && !hat(sicht, 'hochsensibel')) return;
      var zeilen = basis.tabs[tab];
      if (hat(STAMMDATEN, tab)) {
        aus[liste] = zeilen.map(function (z) { return schnitt(ktx, tab, z); });
        return;
      }
      if (tab === 'Mitglied') return;   // unten mit abgeleiteten Feldern
      if (tab === 'Beitragskonto' || tab === 'Beitragsgemeinschaft' || tab === 'Sollstellung') {
        var ab = abJahr(ix.konfig, heute);
        aus[liste] = finanzZeilen(basis, tab, kreis).filter(function (z) {
          return tab !== 'Sollstellung' || Number(z.jahr) >= ab;
        }).map(function (z) {
          var o = schnitt(ktx, tab, z);
          if (tab === 'Beitragskonto') { o.iban_maskiert = z.iban_maskiert; o.iban_ok = z.iban_ok; }
          return o;
        });
        return;
      }
      aus[liste] = zeilen.filter(function (z) { return zeileSichtbar(tab, z, kreis, ktx); })
        .map(function (z) { return schnitt(ktx, tab, z); });
    });

    aus.mitglieder = basis.tabs.Mitglied.filter(function (m) { return kreis.ids[m.mitglied_id]; })
      .map(function (m) { return mitgliedFuer(m, ix, kreis, ktx, heute); });
    return aus;
  }

  /** Finanzzeilen: bei Zeilensicht „alle“ alles, sonst nur Konten/Gemeinschaften sichtbarer Personen. */
  function finanzZeilen(basis, tab, kreis) {
    var zeilen = basis.tabs[tab];
    if (kreis.sicht.alle) return zeilen;
    var konten = {}, gemeinschaften = {};
    basis.tabs.Mitglied.forEach(function (m) {
      if (!kreis.ids[m.mitglied_id]) return;
      if (m.beitragskonto_id) konten[m.beitragskonto_id] = true;
      if (m.beitragsgemeinschaft_id) gemeinschaften[m.beitragsgemeinschaft_id] = true;
    });
    if (tab === 'Beitragsgemeinschaft') return zeilen.filter(function (g) { return gemeinschaften[g.beitragsgemeinschaft_id]; });
    return zeilen.filter(function (z) { return konten[z.beitragskonto_id]; });
  }

  function mitgliedFuer(m, ix, kreis, ktx, heute) {
    var sicht = ktx.sicht || [];
    var o = schnitt(ktx, 'Mitglied', m);
    var id = m.mitglied_id;
    var zeitraeume = (ix.zeitraeumeJe[id] || []).slice().sort(function (a, b) {
      return String(a.eintrittsdatum).localeCompare(String(b.eintrittsdatum));
    });
    o.status_abgeleitet = Mitgliedschaft.status(m, zeitraeume, heute);
    o.mitglied_seit = Mitgliedschaft.mitgliedSeit(zeitraeume, heute);
    var gek = Mitgliedschaft.gekuendigt(zeitraeume, heute);
    o.gekuendigt_zum = gek ? gek.austritt : null;
    if (hat(sicht, 'kontakt')) {
      o.alter = Mitgliedschaft.alter(m.geburtsdatum, heute);
      var bisAlter = Number(ix.konfig.jugend_bis_alter);
      o.jugend = Mitgliedschaft.istJugend(m.geburtsdatum, heute, isFinite(bisAlter) && ix.konfig.jugend_bis_alter !== '' && ix.konfig.jugend_bis_alter !== undefined ? bisAlter : 17);
    }
    o.abteilungen = (ix.zugehJe[id] || []).filter(function (a) {
      return Mitgliedschaft.laeuft(a.eintrittsdatum || '0000-01-01', a.austrittsdatum, heute) && zeileSichtbar('Abteilungszugehoerigkeit', a, kreis, ktx);
    }).map(function (a) { return a.abteilung_id; });
    o.funktionen_laufend = (ix.funktionenJe[id] || []).filter(function (f) {
      return Mitgliedschaft.laeuft(f.von, f.bis, heute) && zeileSichtbar('Funktion', f, kreis, ktx);
    }).map(function (f) { return f.funktionsart_id; });
    if (hat(sicht, 'hochsensibel')) o.fz_ampel = fzAmpel(id, ix, heute);
    return o;
  }

  /** Ist die Person für den Kontext sichtbar (Zeilenschutz bei Schreibzugriffen)? */
  function mitgliedSichtbar(basis, ktx, heute, id) {
    var ix = indexiere(basis);
    return !!personenkreis(basis, ix, ktx, heute).ids[Number(id)];
  }

  // ------------------------------------------------------------------ Write-through

  /**
   * Spielt Änderungen in eine Kopie der Basis ein.
   * aenderungen: [{ tab, neu: zeile } | { tab, entfernt: id }]; Tabs außerhalb der Basis werden ignoriert.
   */
  function aenderungAnwenden(basis, aenderungen) {
    var neu = { tabs: {}, konfig: basis.konfig };
    TABS.forEach(function (t) { neu.tabs[t] = basis.tabs[t]; });
    (aenderungen || []).forEach(function (a) {
      if (!LISTEN[a.tab]) return;
      var feld = idSpalte(a.tab);
      var liste = neu.tabs[a.tab] = neu.tabs[a.tab].slice();
      if (a.neu) {
        var zeile = a.tab === 'Beitragskonto' ? kontoOhneIban(a.neu) : a.neu;
        var i = -1;
        for (var j = 0; j < liste.length; j++) if (String(liste[j][feld]) === String(zeile[feld])) { i = j; break; }
        if (i >= 0) liste[i] = zeile; else liste.push(zeile);
      } else if (a.entfernt !== undefined) {
        neu.tabs[a.tab] = liste.filter(function (z) { return String(z[feld]) !== String(a.entfernt); });
      }
    });
    return neu;
  }

  /**
   * Antwort an den Browser nach einem Schreibzugriff: { aktualisiert: { liste: [..] }, entfernt: { liste: [ids] } }.
   * Enthält die geänderten Zeilen (soweit sichtbar) und alle betroffenen Mitglieder neu abgeleitet. Zeilen, die
   * durch die Änderung unsichtbar wurden, stehen unter entfernt.
   */
  function antwortFuer(basisNeu, ktx, heute, aenderungen) {
    var sicht = fuer(basisNeu, ktx, heute);
    var aktualisiert = {}, entfernt = {};
    var betroffen = {};
    function merke(liste, z) { (aktualisiert[liste] = aktualisiert[liste] || []).push(z); }
    function weg(liste, id) { (entfernt[liste] = entfernt[liste] || []).push(id); }

    (aenderungen || []).forEach(function (a) {
      var liste = LISTEN[a.tab];
      if (!liste) return;
      var feld = idSpalte(a.tab);
      if (a.tab === 'Mitglied') {
        betroffen[a.neu ? a.neu.mitglied_id : a.entfernt] = true;
        return;
      }
      if (a.neu && a.neu.mitglied_id !== undefined && a.neu.mitglied_id !== null) betroffen[a.neu.mitglied_id] = true;
      if (a.tab === 'Beitragskonto' && a.neu) {
        basisNeu.tabs.Mitglied.forEach(function (m) { if (m.beitragskonto_id === a.neu.beitragskonto_id) betroffen[m.mitglied_id] = true; });
      }
      if (!sicht[liste]) return;   // Liste für diese Rolle nicht sichtbar
      var id = a.neu ? a.neu[feld] : a.entfernt;
      var gefunden = sicht[liste].filter(function (z) { return String(z[feld]) === String(id); })[0];
      if (gefunden) merke(liste, gefunden); else weg(liste, id);
    });
    Object.keys(betroffen).forEach(function (id) {
      var m = sicht.mitglieder.filter(function (x) { return String(x.mitglied_id) === String(id); })[0];
      if (m) merke('mitglieder', m); else weg('mitglieder', Number(id));
    });
    return { aktualisiert: aktualisiert, entfernt: entfernt };
  }

  return {
    LISTEN: LISTEN, TABS: TABS,
    ibanOk: ibanOk, ibanMaskiert: ibanMaskiert,
    basisAusTabs: basisAusTabs, fuer: fuer, mitgliedSichtbar: mitgliedSichtbar,
    aenderungAnwenden: aenderungAnwenden, antwortFuer: antwortFuer, fzAmpel: function (basis, id, heute) {
      return fzAmpel(id, indexiere(basis), heute);
    }
  };
})();
