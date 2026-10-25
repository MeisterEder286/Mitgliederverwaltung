/**
 * SetupPlan – plant die Einrichtung der Datenbank-Tabelle, ohne sie anzufassen (reine Logik).
 *
 * Zweck:      Aus dem Datenmodell (Schema, Startbelegung) und dem, was im Sheet schon vorhanden ist,
 *             wird eine Liste von Schritten berechnet: Tabs anlegen, Kopfzeilen schreiben, fehlende
 *             Spalten anhängen, Formate und Auswahllisten setzen, Stammdaten vorbelegen, _Konfig ergänzen.
 *             Ausgeführt werden die Schritte von src/Setup.js.
 * Datenquelle: Schema.TABELLEN / Schema.LISTEN (src/lib/schema.js), Startbelegung (src/lib/startbelegung.js),
 *             dazu die Beschreibung des Ist-Zustands, die Setup.js aus dem Sheet liest:
 *               vorhanden = { [tab]: { kopf: [...], zeilen: <Anzahl Datenzeilen>,
 *                                      maxId: <größte ID>, schluessel: [<_Konfig-Schlüssel>] } }
 * Wer darf:   Nur das Funktionskonto (Eigentümer) führt das Setup aus – geprüft in src/Einstieg.js.
 * Besonderheiten (wichtig für Nachfolger):
 *   - Es wird NIE etwas gelöscht, umsortiert oder überschrieben. Vorhandene Spalten bleiben, wo sie sind;
 *     fehlende werden rechts angehängt; unbekannte Spalten werden nur gemeldet.
 *   - Bestehende _Konfig-Werte bleiben unverändert. Fehlende Schlüssel kommen aus der Startbelegung.
 *     Die ID-Zähler next_id_<Tab> werden aus den tatsächlich vorhandenen Daten berechnet (größte ID + 1),
 *     nicht aus der Startbelegung – die enthält Zählerstände der Beispieldaten.
 *   - Stammdaten werden nur in LEERE Tabs geschrieben.
 *   - Idempotent: Ein zweiter Lauf auf einem fertig eingerichteten Sheet erzeugt keine Änderungsschritte.
 *     Formate und Auswahllisten werden nur für neue Spalten gesetzt; mit { formateErneuern: true } für alle.
 *   - Datumswerte der Startbelegung (JJJJ-MM-TT) werden in Sheets-Seriennummern umgerechnet.
 */
var SetupPlan = (function () {
  var ZEILEN_FORMAT = 2000; // Formate und Datenprüfung gelten für die Zeilen 2 bis 2000

  var FORMAT = {
    'Text': '@', 'Langtext': '@', 'Auswahl': '@', 'ja/nein': '@',
    'Datum': 'dd.MM.yyyy', 'Zeitpunkt': 'dd.MM.yyyy HH:mm',
    'Dezimal': '#,##0.00', 'Ganzzahl': '0', 'FK': '0'
  };

  var ID_ZAEHLER_BESCHREIBUNG = 'ID-Zähler — nur vom Skript erhöhen';

  /** Sheets-Seriennummer (Tage seit 30.12.1899) aus "JJJJ-MM-TT" bzw. "JJJJ-MM-TTThh:mm(:ss)". */
  function serial_(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
    if (!m) return null;
    var tage = (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000;
    var anteil = ((+(m[4] || 0)) * 3600 + (+(m[5] || 0)) * 60 + (+(m[6] || 0))) / 86400;
    return tage + anteil;
  }

  /** Wandelt einen Wert der Startbelegung (immer Text) in den Wert für die Zelle um. */
  function zelle(wert, typ) {
    if (wert === null || wert === undefined || wert === '') return '';
    var s = String(wert);
    if (typ === 'Datum' || typ === 'Zeitpunkt') {
      var n = serial_(s);
      return n === null ? s : n;
    }
    if (typ === 'Ganzzahl' || typ === 'FK' || typ === 'Dezimal') {
      return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
    }
    return s;
  }

  function sauber_(kopf) {
    var k = (kopf || []).map(function (x) { return x === null || x === undefined ? '' : String(x).trim(); });
    while (k.length && k[k.length - 1] === '') k.pop();
    return k;
  }

  function spaltenDef_(tab, name) {
    var sp = Schema.TABELLEN[tab].spalten;
    for (var i = 0; i < sp.length; i++) if (sp[i].name === name) return sp[i];
    return null;
  }

  /** Startzeilen in die Spaltenreihenfolge des Sheets bringen und typgerecht umwandeln. */
  function ordneZeilen_(tab, seed, kopf) {
    return seed.zeilen.map(function (z) {
      var obj = {};
      seed.kopf.forEach(function (k, i) { obj[k] = z[i]; });
      return kopf.map(function (name) {
        if (name === 'version') return 1;
        if (name === 'geaendert_von') return 'Setup';
        var def = spaltenDef_(tab, name);
        return def ? zelle(obj[name], def.typ) : '';
      });
    });
  }

  function formatSchritte_(tab, kopf, namen) {
    var formate = [], auswahl = [];
    namen.forEach(function (name) {
      var def = spaltenDef_(tab, name);
      if (!def) return;
      var spalte = kopf.indexOf(name) + 1;
      formate.push({ name: name, spalte: spalte, format: FORMAT[def.typ] || '@' });
      if (def.typ === 'ja/nein') auswahl.push({ name: name, spalte: spalte, werte: ['ja', 'nein'] });
      else if (def.typ === 'Auswahl' && def.liste && Schema.LISTEN[def.liste]) {
        auswahl.push({ name: name, spalte: spalte, werte: Schema.LISTEN[def.liste].slice() });
      }
    });
    var s = [];
    if (formate.length) s.push({ art: 'formate', tab: tab, zeilenBis: ZEILEN_FORMAT, spalten: formate, aendert: true });
    if (auswahl.length) s.push({ art: 'auswahl', tab: tab, zeilenBis: ZEILEN_FORMAT, spalten: auswahl, aendert: true });
    return s;
  }

  /**
   * Hauptfunktion. Liefert { schritte: [...], bericht: 'Text' }.
   * Jeder Schritt hat art, tab und aendert (false nur bei reinen Meldungen).
   */
  function plane(vorhanden, optionen) {
    vorhanden = vorhanden || {};
    optionen = optionen || {};
    var schritte = [];
    var kopfJeTab = {};
    var maxIds = {};

    Object.keys(Schema.TABELLEN).forEach(function (tab) {
      var def = Schema.TABELLEN[tab];
      var soll = def.spalten.map(function (s) { return s.name; });
      var ist = vorhanden[tab];
      var istKopf = ist ? sauber_(ist.kopf) : [];
      var kopf, neueSpalten;

      if (!ist) {
        schritte.push({ art: 'tab_anlegen', tab: tab, aendert: true });
      }
      if (!istKopf.length) {
        schritte.push({ art: 'kopf_schreiben', tab: tab, kopf: soll.slice(), aendert: true });
        kopf = soll.slice();
        neueSpalten = soll.slice();
      } else {
        var fehlend = soll.filter(function (n) { return istKopf.indexOf(n) < 0; });
        var unbekannt = istKopf.filter(function (n) { return n !== '' && soll.indexOf(n) < 0; });
        if (fehlend.length) {
          schritte.push({ art: 'fehlende_spalten', tab: tab, spalten: fehlend, ab: istKopf.length + 1, aendert: true });
        }
        if (unbekannt.length) {
          schritte.push({ art: 'unbekannte_spalten', tab: tab, spalten: unbekannt, aendert: false });
        }
        kopf = istKopf.concat(fehlend);
        neueSpalten = fehlend;
      }
      kopfJeTab[tab] = kopf;

      var formatNamen = optionen.formateErneuern ? soll : neueSpalten;
      schritte = schritte.concat(formatSchritte_(tab, kopf, formatNamen));

      var datenZeilen = ist ? (ist.zeilen || 0) : 0;
      maxIds[tab] = ist && ist.maxId ? Number(ist.maxId) || 0 : 0;
      if (tab !== '_Konfig' && Startbelegung[tab] && datenZeilen === 0 && Startbelegung[tab].zeilen.length) {
        var zeilen = ordneZeilen_(tab, Startbelegung[tab], kopf);
        schritte.push({ art: 'startbelegung', tab: tab, kopf: kopf.slice(), zeilen: zeilen, aendert: true });
        if (def.idSpalte) {
          var idx = kopf.indexOf(def.idSpalte);
          zeilen.forEach(function (z) {
            if (typeof z[idx] === 'number' && z[idx] > maxIds[tab]) maxIds[tab] = z[idx];
          });
        }
      }
    });

    // _Konfig ergänzen: fehlende Schlüssel, nie überschreiben
    var vorhandeneSchluessel = (vorhanden._Konfig && vorhanden._Konfig.schluessel || []).map(String);
    var konfigNeu = [];
    var schonGeplant = {};
    function neu(schluessel, wert, beschreibung) {
      if (vorhandeneSchluessel.indexOf(schluessel) >= 0 || schonGeplant[schluessel]) return;
      schonGeplant[schluessel] = true;
      konfigNeu.push({ schluessel: schluessel, wert: wert, beschreibung: beschreibung });
    }
    var seedKonfig = Startbelegung._Konfig;
    var iS = seedKonfig.kopf.indexOf('schluessel'), iW = seedKonfig.kopf.indexOf('wert'), iB = seedKonfig.kopf.indexOf('beschreibung');
    seedKonfig.zeilen.forEach(function (z) {
      if (String(z[iS]).indexOf('next_id_') === 0) return; // Zähler werden aus den Daten berechnet
      neu(String(z[iS]), String(z[iW]), String(z[iB] || ''));
    });
    Object.keys(Schema.TABELLEN).forEach(function (tab) {
      // _Protokoll ist append-only und nummeriert über die Zeilennummer (src/Protokoll.js) – kein Zähler.
      if (!Schema.TABELLEN[tab].idSpalte || tab === '_Protokoll') return;
      neu('next_id_' + tab, String((maxIds[tab] || 0) + 1), ID_ZAEHLER_BESCHREIBUNG);
    });
    if (konfigNeu.length) {
      var kKopf = kopfJeTab._Konfig;
      schritte.push({
        art: 'konfig_ergaenzen', tab: '_Konfig', aendert: true,
        schluessel: konfigNeu.map(function (k) { return k.schluessel; }),
        zeilen: konfigNeu.map(function (k) {
          return kKopf.map(function (n) { return k.hasOwnProperty(n) ? k[n] : ''; });
        })
      });
    }

    // Tabs im Sheet, die das Datenmodell nicht kennt (nur melden)
    var fremde = Object.keys(vorhanden).filter(function (t) { return !Schema.TABELLEN[t]; });
    if (fremde.length) schritte.push({ art: 'fremde_tabs', tab: null, tabs: fremde, aendert: false });

    return { schritte: schritte, bericht: bericht(schritte) };
  }

  function hatAenderungen(plan) {
    return plan.schritte.some(function (s) { return s.aendert; });
  }

  /** Lesbarer Bericht für das Ausführungsprotokoll im Apps-Script-Editor. */
  function bericht(schritte) {
    var z = [];
    schritte.forEach(function (s) {
      switch (s.art) {
        case 'tab_anlegen': z.push('Tab angelegt: ' + s.tab); break;
        case 'kopf_schreiben': z.push('  Kopfzeile geschrieben (' + s.kopf.length + ' Spalten): ' + s.tab); break;
        case 'fehlende_spalten': z.push('Spalten angehängt in ' + s.tab + ': ' + s.spalten.join(', ')); break;
        case 'unbekannte_spalten': z.push('HINWEIS: ' + s.tab + ' hat Spalten, die das Datenmodell nicht kennt (bleiben unverändert): ' + s.spalten.join(', ')); break;
        case 'formate': z.push('  Formate gesetzt für ' + s.spalten.length + ' Spalte(n): ' + s.tab); break;
        case 'auswahl': z.push('  Auswahllisten gesetzt für ' + s.spalten.length + ' Spalte(n): ' + s.tab); break;
        case 'startbelegung': z.push('Startbelegung geschrieben: ' + s.tab + ' (' + s.zeilen.length + ' Zeilen) – Werte mit BEISPIEL/PRÜFEN anpassen'); break;
        case 'konfig_ergaenzen': z.push('_Konfig ergänzt: ' + s.schluessel.join(', ')); break;
        case 'fremde_tabs': z.push('HINWEIS: Tabs ohne Bedeutung für das Datenmodell (bleiben unverändert): ' + s.tabs.join(', ')); break;
      }
    });
    if (!schritte.some(function (s) { return s.aendert; })) z.unshift('Setup: keine Änderungen nötig – Tabelle ist auf dem Stand des Datenmodells.');
    else z.unshift('Setup: ' + schritte.filter(function (s) { return s.aendert; }).length + ' Änderungsschritt(e).');
    return z.join('\n');
  }

  return { plane: plane, hatAenderungen: hatAenderungen, zelle: zelle, FORMAT: FORMAT, ZEILEN_FORMAT: ZEILEN_FORMAT };
})();
