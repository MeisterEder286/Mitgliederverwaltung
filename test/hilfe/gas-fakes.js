/**
 * Test-Hilfe: Nachbildungen (Fakes) der Apps-Script-Dienste für Node-Tests.
 *
 * Bildet nur das Verhalten nach, das unser Code nutzt – kein vollständiger Ersatz. Echtes Verhalten
 * (Quoten, Laufzeiten, Berechtigungen) muss in Google geprüft werden.
 *
 * Benutzung:
 *   const { erzeugeFakes, beispielTabs } = require('./hilfe/gas-fakes');
 *   const f = erzeugeFakes({ tabs: beispielTabs(['Mitglied', '_Konfig']), email: 'mv@verein.de' });
 *   const g = ladeProjekt(f.globale);       // aus ./hilfe/projekt
 *   g.DB.lese(['Mitglied']);
 *   f.zaehler.batchGet  // 1
 *   f.daten('Mitglied') // rohe Zellwerte [[kopf…], [zeile…], …]
 *
 * Optionen von erzeugeFakes:
 *   tabs         { Tab: [[kopf…], [zeile…], …] }  Zellwerte wie im Sheet (Datum = Seriennummer)
 *   email        aktiver Nutzer (Session.getActiveUser), Standard 'mv@tsv-ergoldsbach.de'; '' = unbekannt
 *   eigentuemer  Funktionskonto (Session.getEffectiveUser), Standard 'verwaltung@tsv-ergoldsbach.de'
 *   dbId         Standard 'DB-TEST' (steht als Script Property DB_ID bereit)
 *   properties   weitere Script Properties
 *   sperreBelegt true → LockService.waitLock wirft (Sperre durch andere Ausführung)
 *   zeitzone     Standard 'Europe/Berlin'
 *   jetzt        Date für Utilities.formatDate(new Date()) ist NICHT steuerbar; Tests prüfen das Format.
 *
 * Zeilen: deleteRow(nr) / deleteRows(nr, anzahl) entfernen Zeilen (Raster schrumpft wie in Sheets).
 *
 * Weitere Dateien: opt.weitereDateien = { 'ID': { Tab: [[Kopf…], …] } } – openById('ID') liefert sie; ihre Tabs
 *   liest der Test über daten('ID/Tab').
 *
 * Rückgabe: { globale, datei, daten(tab), zaehler, cache, properties, trigger }
 *   zaehler.sheets  alle Aufrufe an SpreadsheetApp/Sheet/Range/Sheets-API (Builder ausgenommen)
 *   zaehler.<methode>  Aufrufe je Methode, z. B. batchGet, getValues, setValues, appendRow, openById
 *
 * beispielTabs(namen): lädt Stammdaten aus docs/daten/startbelegung/ bzw. Beispieldaten aus
 *   test/daten/beispiel/, ergänzt im Schema neu hinzugekommene Spalten (leer) und wandelt Datumsangaben (JJJJ-MM-TT) gemäß Schema in Seriennummern,
 *   Zahlen in number. Fehlt eine Datei, entsteht ein Tab nur mit Kopfzeile aus dem Schema.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const csv = require('../../tools/csv');

const WURZEL = path.join(__dirname, '..', '..');
const CACHE_MAX_BYTES = 100 * 1024;

function erzeugeFakes(opt) {
  opt = opt || {};
  const email = opt.email === undefined ? 'mv@tsv-ergoldsbach.de' : opt.email;
  const eigentuemer = opt.eigentuemer || 'verwaltung@tsv-ergoldsbach.de';
  const dbId = opt.dbId || 'DB-TEST';
  const zeitzone = opt.zeitzone || 'Europe/Berlin';
  const zaehler = { sheets: 0 };
  const zaehle = (name) => { zaehler[name] = (zaehler[name] || 0) + 1; zaehler.sheets++; };

  // ---------- Tabellen ----------
  const tabs = {};
  // Rastergröße wie in Google Sheets: Ein neuer Tab hat 1000 Zeilen × 26 Spalten. getRange außerhalb
  // davon wirft (wie das Original); appendRow und insertRowsAfter/insertColumnsAfter vergrößern.
  const groesse = {};
  Object.keys(opt.tabs || {}).forEach(t => {
    tabs[t] = (opt.tabs[t] || []).map(z => z.slice());
    groesse[t] = { zeilen: Math.max(1000, tabs[t].length), spalten: Math.max(26, ...tabs[t].map(z => z.length)) };
  });
  // Weitere Dateien (z. B. Eingangstabelle): Tabs liegen intern unter „<Datei-ID>/<Tab>“
  const weitere = opt.weitereDateien || {};
  Object.keys(weitere).forEach(id => {
    Object.keys(weitere[id]).forEach(t => {
      const n = id + '/' + t;
      tabs[n] = weitere[id][t].map(z => z.slice());
      groesse[n] = { zeilen: Math.max(1000, tabs[n].length), spalten: Math.max(26, ...tabs[n].map(z => z.length)) };
    });
  });

  function letzteZeile(daten) {
    let n = daten.length;
    while (n > 0 && daten[n - 1].every(v => v === '' || v === null || v === undefined)) n--;
    return n;
  }
  function letzteSpalte(daten) {
    return daten.reduce((m, z) => {
      let n = z.length;
      while (n > 0 && (z[n - 1] === '' || z[n - 1] === null || z[n - 1] === undefined)) n--;
      return Math.max(m, n);
    }, 0);
  }

  function bereich(name, r, c, nr, nc) {
    if (typeof r !== 'number') throw new Error('Fake: getRange nur mit Zahlen (Zeile, Spalte, Anzahl, Anzahl)');
    nr = nr || 1; nc = nc || 1;
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('Fake: ungültiger Bereich');
    if (r + nr - 1 > groesse[name].zeilen || c + nc - 1 > groesse[name].spalten) {
      throw new Error('Fake: Die Koordinaten des Bereichs liegen außerhalb der Tabellengröße (' + name + ').');
    }
    const daten = tabs[name];
    function schreib(werte) {
      if (werte.length !== nr || werte.some(z => z.length !== nc)) {
        throw new Error('Fake: Die Anzahl der Zeilen/Spalten stimmt nicht mit dem Bereich überein');
      }
      for (let i = 0; i < nr; i++) {
        while (daten.length < r + i) daten.push([]);
        const z = daten[r - 1 + i];
        for (let j = 0; j < nc; j++) {
          while (z.length < c - 1 + j) z.push('');
          z[c - 1 + j] = werte[i][j];
        }
      }
    }
    const range = {
      getValues() {
        zaehle('getValues');
        const out = [];
        for (let i = 0; i < nr; i++) {
          const z = daten[r - 1 + i] || [];
          const zeile = [];
          for (let j = 0; j < nc; j++) {
            const v = z[c - 1 + j];
            zeile.push(v === undefined || v === null ? '' : v);
          }
          out.push(zeile);
        }
        return out;
      },
      getValue() { return range.getValues()[0][0]; },
      setValues(werte) { zaehle('setValues'); schreib(werte); return range; },
      setValue(v) { zaehle('setValue'); schreib([[v]]); return range; },
      setNumberFormat() { zaehle('setNumberFormat'); return range; },
      setNumberFormats() { zaehle('setNumberFormats'); return range; },
      setDataValidation() { zaehle('setDataValidation'); return range; },
      clearDataValidations() { zaehle('clearDataValidations'); return range; },
      setFontWeight() { zaehle('setFontWeight'); return range; },
      setBackground() { zaehle('setBackground'); return range; },
      getRow() { return r; }, getColumn() { return c; },
      getNumRows() { return nr; }, getNumColumns() { return nc; }
    };
    return range;
  }

  function blatt(name) {
    return {
      getName() { return name.slice(name.indexOf('/') + 1); },
      getLastRow() { zaehle('getLastRow'); return letzteZeile(tabs[name]); },
      getLastColumn() { zaehle('getLastColumn'); return letzteSpalte(tabs[name]); },
      getMaxRows() { zaehle('getMaxRows'); return groesse[name].zeilen; },
      getMaxColumns() { zaehle('getMaxColumns'); return groesse[name].spalten; },
      insertRowsAfter(nach, anzahl) { zaehle('insertRowsAfter'); groesse[name].zeilen += anzahl; return this; },
      insertColumnsAfter(nach, anzahl) { zaehle('insertColumnsAfter'); groesse[name].spalten += anzahl; return this; },
      // Zeilen löschen wie in Sheets: nachfolgende Zeilen rücken nach oben, das Raster schrumpft entsprechend.
      deleteRow(nr) { zaehle('deleteRow'); return this.__entferne(nr, 1); },
      deleteRows(nr, anzahl) { zaehle('deleteRows'); return this.__entferne(nr, anzahl); },
      __entferne(nr, anzahl) {
        if (nr < 1 || nr + anzahl - 1 > groesse[name].zeilen) throw new Error('Fake: Zeilen außerhalb der Tabelle');
        tabs[name].splice(nr - 1, anzahl);
        groesse[name].zeilen -= anzahl;
        return this;
      },
      getRange(r, c, nr, nc) { zaehle('getRange'); return bereich(name, r, c, nr, nc); },
      getDataRange() {
        zaehle('getDataRange');
        return bereich(name, 1, 1, Math.max(1, letzteZeile(tabs[name])), Math.max(1, letzteSpalte(tabs[name])));
      },
      appendRow(zeile) {
        zaehle('appendRow');
        const d = tabs[name];
        d.length = letzteZeile(d);
        d.push(zeile.slice());
        if (d.length > groesse[name].zeilen) groesse[name].zeilen = d.length;
        if (zeile.length > groesse[name].spalten) groesse[name].spalten = zeile.length;
        return this;
      },
      setFrozenRows() { zaehle('setFrozenRows'); return this; },
      setTabColor() { zaehle('setTabColor'); return this; },
      autoResizeColumns() { zaehle('autoResizeColumns'); return this; },
      clear() { zaehle('clear'); tabs[name].length = 0; return this; }
    };
  }

  const datei = {
    getId() { return dbId; },
    getName() { return 'Mitgliederverwaltung (Test)'; },
    getSheetByName(n) { zaehle('getSheetByName'); return tabs[n] ? blatt(n) : null; },
    getSheets() { zaehle('getSheets'); return Object.keys(tabs).filter(n => n.indexOf('/') < 0).map(blatt); },
    insertSheet(n) {
      zaehle('insertSheet');
      if (tabs[n]) throw new Error('Fake: Tab existiert bereits: ' + n);
      tabs[n] = [];
      groesse[n] = { zeilen: 1000, spalten: 26 };
      return blatt(n);
    }
  };

  function validierungsBuilder() {
    const b = {};
    ['requireValueInList', 'requireValueInRange', 'requireCheckbox', 'setAllowInvalid', 'setHelpText',
      'requireDate', 'requireNumberBetween'].forEach(m => { b[m] = () => b; });
    b.build = () => ({ fakeValidierung: true });
    return b;
  }

  function weitereDatei(id) {
    const n = t => id + '/' + t;
    return {
      getId() { return id; },
      getName() { return 'Weitere Datei ' + id; },
      getSheetByName(t) { zaehle('getSheetByName'); return tabs[n(t)] ? blatt(n(t)) : null; },
      getSheets() { zaehle('getSheets'); return Object.keys(tabs).filter(x => x.indexOf(id + '/') === 0).map(blatt); },
      insertSheet(t) {
        zaehle('insertSheet');
        if (tabs[n(t)]) throw new Error('Fake: Tab existiert bereits: ' + t);
        tabs[n(t)] = [];
        groesse[n(t)] = { zeilen: 1000, spalten: 26 };
        return blatt(n(t));
      }
    };
  }

  const SpreadsheetApp = {
    openById(id) {
      zaehle('openById');
      if (weitere[id]) return weitereDatei(id);
      if (id !== dbId) throw new Error('Fake: unbekannte Datei-ID ' + id);
      return datei;
    },
    flush() { zaehle('flush'); },
    newDataValidation: validierungsBuilder
  };

  function tabAusBereich(r) {
    const m = /^'((?:[^']|'')*)'(?:!.*)?$/.exec(r) || /^([^!]+)(?:!.*)?$/.exec(r);
    return m[1].replace(/''/g, "'");
  }

  const Sheets = {
    Spreadsheets: {
      Values: {
        batchGet(id, optionen) {
          zaehle('batchGet');
          if (id !== dbId) throw new Error('Fake: unbekannte Datei-ID ' + id);
          return {
            valueRanges: (optionen.ranges || []).map(r => {
              const name = tabAusBereich(r);
              if (!tabs[name]) throw new Error('Unable to parse range: ' + r);
              // Wie die echte API: leere Zeilen/Zellen am Ende werden abgeschnitten
              const d = tabs[name].slice(0, letzteZeile(tabs[name])).map(z => {
                const zeile = z.map(v => (v === null || v === undefined ? '' : v));
                let n = zeile.length;
                while (n > 0 && zeile[n - 1] === '') n--;
                return zeile.slice(0, n);
              });
              return d.length ? { range: r, values: d } : { range: r };
            })
          };
        }
      }
    }
  };

  // ---------- Sperre, Cache, Properties ----------
  let gesperrt = false;
  const LockService = {
    getScriptLock() {
      return {
        waitLock() {
          zaehler.waitLock = (zaehler.waitLock || 0) + 1;
          if (opt.sperreBelegt) throw new Error('Lock timeout: another process was holding the lock for too long.');
          gesperrt = true;
        },
        tryLock() { if (opt.sperreBelegt) return false; gesperrt = true; return true; },
        releaseLock() { zaehler.releaseLock = (zaehler.releaseLock || 0) + 1; gesperrt = false; },
        hasLock() { return gesperrt; }
      };
    }
  };

  const cacheSpeicher = {};
  function cache() {
    const c = {
      get(k) { return Object.prototype.hasOwnProperty.call(cacheSpeicher, k) ? cacheSpeicher[k] : null; },
      put(k, v, ttl) {
        if (typeof v !== 'string') throw new Error('Fake-Cache: Wert muss Text sein');
        if (Buffer.byteLength(v, 'utf8') > CACHE_MAX_BYTES) throw new Error('Argument too large: value');
        if (ttl !== undefined && ttl > 21600) throw new Error('Fake-Cache: maximal 21600 s');
        cacheSpeicher[k] = v;
      },
      remove(k) { delete cacheSpeicher[k]; },
      putAll(werte, ttl) { Object.keys(werte).forEach(k => c.put(k, werte[k], ttl)); },
      getAll(keys) {
        const o = {};
        keys.forEach(k => { if (Object.prototype.hasOwnProperty.call(cacheSpeicher, k)) o[k] = cacheSpeicher[k]; });
        return o;
      },
      removeAll(keys) { keys.forEach(k => delete cacheSpeicher[k]); }
    };
    return c;
  }
  const CacheService = { getScriptCache: cache, getUserCache: cache, getDocumentCache: cache };

  const properties = Object.assign({ DB_ID: dbId }, opt.properties || {});
  function props(speicher) {
    return {
      getProperty(k) { return Object.prototype.hasOwnProperty.call(speicher, k) ? speicher[k] : null; },
      setProperty(k, v) { speicher[k] = String(v); return this; },
      deleteProperty(k) { delete speicher[k]; return this; },
      getProperties() { return Object.assign({}, speicher); },
      setProperties(o) { Object.keys(o).forEach(k => { speicher[k] = String(o[k]); }); return this; }
    };
  }
  const nutzerProps = {};
  const PropertiesService = {
    getScriptProperties: () => props(properties),
    getUserProperties: () => props(nutzerProps)
  };

  const Session = {
    getActiveUser: () => ({ getEmail: () => email }),
    getEffectiveUser: () => ({ getEmail: () => eigentuemer }),
    getScriptTimeZone: () => zeitzone
  };

  // ---------- Utilities ----------
  function formatDate(datum, tz, muster) {
    const teile = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(datum).forEach(p => { teile[p.type] = p.value; });
    if (teile.hour === '24') teile.hour = '00';
    const ersatz = { yyyy: teile.year, MM: teile.month, dd: teile.day, HH: teile.hour, mm: teile.minute, ss: teile.second };
    // Text in einfachen Anführungszeichen ist Literal (wie bei SimpleDateFormat)
    return muster.split(/('[^']*')/).map(s => {
      if (/^'.*'$/.test(s)) return s.slice(1, -1);
      return s.replace(/yyyy|MM|dd|HH|mm|ss/g, m => ersatz[m]);
    }).join('');
  }
  const Utilities = {
    formatDate,
    getUuid: () => require('crypto').randomUUID(),
    sleep: () => {},
    // Blob: Text oder Byte-Array (wie in Apps Script); getBytes liefert ein Array von Zahlen.
    newBlob: (daten, typ) => blob(Array.isArray(daten) || Buffer.isBuffer(daten) ? Buffer.from(daten) : Buffer.from(String(daten), 'utf8'), typ),
    gzip: (b) => blob(require('zlib').gzipSync(Buffer.from(b.getBytes())), 'application/x-gzip'),
    ungzip: (b) => blob(require('zlib').gunzipSync(Buffer.from(b.getBytes())), 'application/octet-stream'),
    base64Encode: (daten) => Buffer.from(Array.isArray(daten) ? daten.map(x => x & 255) : String(daten)).toString('base64'),
    base64Decode: (text) => Array.from(Buffer.from(String(text), 'base64'))
  };
  function blob(buf, typ) {
    return {
      getBytes: () => Array.from(buf),
      getDataAsString: () => buf.toString('utf8'),
      getContentType: () => typ || null
    };
  }

  // ---------- HtmlService, ScriptApp, Logger ----------
  function htmlAusgabe(inhalt) {
    const o = {
      inhalt: inhalt || '', titel: '', meta: [], xframe: null,
      setTitle(t) { o.titel = t; return o; },
      addMetaTag(n, w) { o.meta.push([n, w]); return o; },
      setXFrameOptionsMode(m) { o.xframe = m; return o; },
      setSandboxMode() { return o; },
      getContent() { return o.inhalt; },
      append(t) { o.inhalt += t; return o; },
      // PDF-Umwandlung (E-Mail-Anhang): liefert einen Blob-Fake; opt.pdfFehler simuliert einen Fehlschlag
      getAs(mime) {
        if (opt.pdfFehler) throw new Error('PDF-Umwandlung fehlgeschlagen');
        let name = 'Dokument.pdf';
        const b = {
          inhalt: o.inhalt,
          getBytes: () => Buffer.from(o.inhalt),
          getContentType: () => mime,
          getName: () => name,
          setName(n) { name = n; return b; }
        };
        return b;
      }
    };
    return o;
  }

  // E-Mail-Versand: zeichnet jede Mail auf (mails). opt.mailKontingent = Tageskontingent,
  // opt.mailFehlerAn = Liste von Adressen, für die sendEmail scheitert.
  const mails = [];
  let kontingent = opt.mailKontingent === undefined ? 100 : opt.mailKontingent;
  const MailApp = {
    getRemainingDailyQuota: () => kontingent,
    sendEmail(nachricht) {
      if (typeof nachricht !== 'object') throw new Error('Fake: nur sendEmail({ … }) wird unterstützt');
      if ((opt.mailFehlerAn || []).indexOf(nachricht.to) >= 0) throw new Error('Invalid email: ' + nachricht.to);
      if (kontingent <= 0) throw new Error('Service invoked too many times for one day: email.');
      kontingent--;
      mails.push(Object.assign({}, nachricht));
    }
  };
  const HtmlService = {
    XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
    SandboxMode: { IFRAME: 'IFRAME' },
    createHtmlOutput: htmlAusgabe,
    createHtmlOutputFromFile: (name) => htmlAusgabe('<!-- ' + name + ' -->'),
    createTemplateFromFile(name) {
      const t = { name, evaluate: () => htmlAusgabe('<!-- Vorlage ' + name + ' -->') };
      return t;
    }
  };

  const trigger = [];
  const ScriptApp = {
    getProjectTriggers: () => trigger.slice(),
    deleteTrigger: (t) => { const i = trigger.indexOf(t); if (i >= 0) trigger.splice(i, 1); },
    newTrigger(funktion) {
      const t = { funktion, art: null, getHandlerFunction: () => funktion };
      const b = {
        timeBased() { t.art = 'zeit'; return b; },
        everyHours(n) { t.stunden = n; return b; },
        everyMinutes(n) { t.minuten = n; return b; },
        everyDays(n) { t.tage = n; return b; },
        atHour(h) { t.stunde = h; return b; },
        nearMinute(m) { t.minute = m; return b; },
        inTimezone(z) { t.zeitzone = z; return b; },
        after(ms) { t.nachMs = ms; return b; },
        create() { trigger.push(t); return t; }
      };
      return b;
    }
  };

  const Logger = { log() {} };

  return {
    globale: {
      SpreadsheetApp, Sheets, LockService, CacheService, PropertiesService, Session, Utilities,
      HtmlService, ScriptApp, Logger, MailApp
    },
    mails,
    datei,
    daten: (tab) => tabs[tab],
    zaehler,
    cache: cacheSpeicher,
    properties,
    trigger
  };
}

// ---------- Beispieldaten ----------
let schemaCache = null;
function schema() {
  if (!schemaCache) {
    const ctx = vm.createContext({});
    new vm.Script(fs.readFileSync(path.join(WURZEL, 'src', 'lib', 'schema.js'), 'utf8')).runInContext(ctx);
    schemaCache = ctx.Schema;
  }
  return schemaCache;
}

function isoZuSerial(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return s;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 86400000 + 25569;
}

/** Lädt Tabs als Zellwerte wie im Sheet (siehe Kopfkommentar). */
function beispielTabs(namen) {
  const S = schema();
  const ergebnis = {};
  namen.forEach(tab => {
    const t = S.TABELLEN[tab];
    if (!t) throw new Error('Unbekannter Tab ' + tab);
    const kandidaten = [
      path.join(WURZEL, 'docs', 'daten', 'startbelegung', tab + '.csv'),
      path.join(WURZEL, 'test', 'daten', 'beispiel', tab + '.csv')
    ];
    const datei = kandidaten.find(p => fs.existsSync(p));
    if (!datei) { ergebnis[tab] = [t.spalten.map(s => s.name)]; return; }
    const gelesen = csv.leseTabelle(datei);
    // Spalten, die das Schema inzwischen zusätzlich kennt (z. B. version, V1), leer ergänzen – wie setup()
    const kopf = gelesen.kopf.concat(t.spalten.map(s => s.name).filter(n => gelesen.kopf.indexOf(n) < 0));
    const zeilen = gelesen.zeilen;
    const typen = kopf.map(k => { const s = t.spalten.find(x => x.name === k); return s ? s.typ : 'Text'; });
    ergebnis[tab] = [kopf].concat(zeilen.map(z => kopf.map((_, i) => {
      const v = z[i] === undefined ? '' : z[i];
      if (v === '') return '';
      const typ = typen[i];
      if (typ === 'Datum' || typ === 'Zeitpunkt') return isoZuSerial(v);
      if (typ === 'Ganzzahl' || typ === 'FK' || typ === 'Dezimal') { const n = Number(v); return isFinite(n) ? n : v; }
      return v;
    })));
  });
  return ergebnis;
}

module.exports = { erzeugeFakes, beispielTabs, isoZuSerial };
