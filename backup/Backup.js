/**
 * Backup – zeitgesteuerte Sicherungskopie der Datenbank-Datei (Sicherheitsregel C3).
 *
 * Zweck:      Legt regelmäßig eine Kopie des Datenbank-Sheets in einem geschützten Backup-Ordner an, räumt alte
 *             Kopien nach einer festen Regel weg und erlaubt einen Wiederherstellungstest.
 * Datenquelle: Script Properties dieses (eigenen!) Projekts:
 *               DB_ID                     ID des Datenbank-Sheets (dieselbe wie in der WebApp)
 *               BACKUP_ORDNER_ID          ID des Backup-Ordners (nur Funktionskonto + höchstens 2 Vorstandspersonen)
 *               BACKUP_AUFBEWAHRUNG_TAGE  tägliche/wöchentliche Kopien so lange behalten (Standard 90)
 *               BACKUP_RHYTHMUS           'taeglich' (Standard) oder 'woechentlich'
 * Wer darf was: Dieses Projekt ist NICHT als WebApp bereitgestellt. Es läuft nur als Trigger bzw. per Hand im
 *             Editor unter dem Funktionskonto. Niemand sonst kann es aufrufen.
 * Besonderheiten:
 *   - Bewusst ein getrenntes Projekt (Entscheidung X7): Die Sicherung braucht Drive-Rechte (Datei kopieren,
 *     in einen Ordner legen, alte Kopien in den Papierkorb). Stünden diese Rechte in der WebApp, hätte jede
 *     Lücke dort Zugriff auf das ganze Drive des Funktionskontos (Sicherheitsregel A5: minimale Scopes).
 *   - Aufbewahrung (BackupPlan.zuLoeschen): Kopien jünger als BACKUP_AUFBEWAHRUNG_TAGE bleiben; älter bleibt nur
 *     die erste Kopie jedes Monats, und zwar 13 Monate lang; alles andere geht in den Papierkorb (dort noch
 *     30 Tage wiederherstellbar).
 *   - Der Backup-Ordner wird vor jeder Sicherung geprüft: Ist er für „jeden mit dem Link“ oder öffentlich
 *     freigegeben, bricht die Sicherung ab und eine Fehlermail geht an das Funktionskonto (C5).
 *   - Es wird NIE automatisch zurückgespielt – siehe LIESMICH.md „Wiederherstellung im Ernstfall“.
 *   - Die reinen Rechenteile stehen im Namensraum BackupPlan und sind in Node getestet (test/backup.test.js).
 */

/** Reine Hilfen ohne Apps-Script-Dienste (in Node testbar). */
var BackupPlan = (function () {
  var PRAEFIX = 'Mitgliederverwaltung Backup ';
  var MONATE_MONATSSICHERUNG = 13;

  function zwei(n) { return ('0' + n).slice(-2); }

  /** Dateiname „Mitgliederverwaltung Backup JJJJ-MM-TT HH-mm“ aus Ortszeit-Bestandteilen. */
  function dateiname(t) {
    return PRAEFIX + t.jahr + '-' + zwei(t.monat) + '-' + zwei(t.tag) + ' ' + zwei(t.stunde) + '-' + zwei(t.minute);
  }

  /** Zeitpunkt aus einem Backup-Dateinamen oder null (fremde Dateien im Ordner werden so nie angefasst). */
  function zeitAusName(name) {
    var m = /^Mitgliederverwaltung Backup (\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})$/.exec(String(name || ''));
    if (!m) return null;
    return { jahr: +m[1], monat: +m[2], tag: +m[3], stunde: +m[4], minute: +m[5],
      schluessel: m[1] + m[2] + m[3] + m[4] + m[5], monatSchluessel: m[1] + '-' + m[2] };
  }

  function tageZwischen(a, b) {
    return Math.floor((Date.UTC(b.jahr, b.monat - 1, b.tag) - Date.UTC(a.jahr, a.monat - 1, a.tag)) / 86400000);
  }
  function monateZwischen(a, b) { return (b.jahr - a.jahr) * 12 + (b.monat - a.monat); }

  /**
   * Welche Backups dürfen weg? dateien: [{ id, name }], heute: { jahr, monat, tag }, aufbewahrungTage: Zahl.
   * Liefert die ids. Regel: jünger als aufbewahrungTage → bleibt; sonst bleibt nur die erste Sicherung eines
   * Monats, solange der Monat höchstens 13 Monate zurückliegt. Dateien mit fremdem Namen bleiben immer.
   */
  function zuLoeschen(dateien, heute, aufbewahrungTage) {
    var tage = Number(aufbewahrungTage) > 0 ? Number(aufbewahrungTage) : 90;
    var mitZeit = dateien.map(function (d) { return { id: d.id, zeit: zeitAusName(d.name) }; })
      .filter(function (d) { return d.zeit; })
      .sort(function (a, b) { return a.zeit.schluessel < b.zeit.schluessel ? -1 : 1; });
    var ersteJeMonat = {};
    mitZeit.forEach(function (d) { if (!ersteJeMonat[d.zeit.monatSchluessel]) ersteJeMonat[d.zeit.monatSchluessel] = d.id; });
    return mitZeit.filter(function (d) {
      if (tageZwischen(d.zeit, heute) < tage) return false;
      var istMonatssicherung = ersteJeMonat[d.zeit.monatSchluessel] === d.id;
      return !(istMonatssicherung && monateZwischen(d.zeit, heute) <= MONATE_MONATSSICHERUNG);
    }).map(function (d) { return d.id; });
  }

  /** Jüngstes Backup aus [{ id, name }] oder null. */
  function juengstes(dateien) {
    var beste = null;
    dateien.forEach(function (d) {
      var z = zeitAusName(d.name);
      if (z && (!beste || z.schluessel > beste.zeit.schluessel)) beste = { id: d.id, name: d.name, zeit: z };
    });
    return beste;
  }

  /**
   * Vergleich Original ↔ Backup für den Wiederherstellungstest. original/kopie: { Tabname: Zeilenzahl }.
   * Liefert { ok, zeilen: [Text], fehlend: [tabs] }. Weniger Zeilen in der Kopie ist normal, wenn seit der
   * Sicherung Daten dazukamen; fehlende Tabs sind ein Fehler.
   */
  function vergleiche(original, kopie) {
    var fehlend = Object.keys(original).filter(function (t) { return !(t in kopie); });
    var zeilen = Object.keys(original).sort().map(function (t) {
      return t + ': Original ' + original[t] + ' Zeilen, Backup ' + (t in kopie ? kopie[t] : 'FEHLT');
    });
    return { ok: fehlend.length === 0, zeilen: zeilen, fehlend: fehlend };
  }

  /** Ist eine Freigabe zu offen? access: DriveApp.Access-Name als Text (ANYONE, ANYONE_WITH_LINK, DOMAIN, …). */
  function freigabeZuOffen(access) {
    return ['ANYONE', 'ANYONE_WITH_LINK'].indexOf(String(access)) >= 0;
  }

  return { dateiname: dateiname, zeitAusName: zeitAusName, zuLoeschen: zuLoeschen, juengstes: juengstes,
    vergleiche: vergleiche, freigabeZuOffen: freigabeZuOffen, PRAEFIX: PRAEFIX };
})();

/** Einstellungen aus den Script Properties; fehlt Pflichtangabe → Fehler mit klarer Meldung. */
function backupEinstellungen_() {
  var p = PropertiesService.getScriptProperties();
  var e = {
    dbId: p.getProperty('DB_ID'),
    ordnerId: p.getProperty('BACKUP_ORDNER_ID'),
    tage: Number(p.getProperty('BACKUP_AUFBEWAHRUNG_TAGE')) || 90,
    rhythmus: p.getProperty('BACKUP_RHYTHMUS') === 'woechentlich' ? 'woechentlich' : 'taeglich'
  };
  if (!e.dbId || !e.ordnerId) throw new Error('Script Properties DB_ID und BACKUP_ORDNER_ID müssen gesetzt sein (siehe LIESMICH.md).');
  return e;
}

function backupJetzt_() {
  var tz = Session.getScriptTimeZone();
  var d = new Date();
  var f = function (muster) { return Number(Utilities.formatDate(d, tz, muster)); };
  return { jahr: f('yyyy'), monat: f('MM'), tag: f('dd'), stunde: f('HH'), minute: f('mm') };
}

/** Alle Dateien des Ordners als [{ id, name, datei }]. */
function backupDateien_(ordner) {
  var aus = [];
  var it = ordner.getFiles();
  while (it.hasNext()) { var f = it.next(); aus.push({ id: f.getId(), name: f.getName(), datei: f }); }
  return aus;
}

/** Fehlermail an das Funktionskonto (Sicherheitsregel C5: Trigger-Fehler nicht an Einzelpersonen). */
function backupFehlerMelden_(betreff, text) {
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[Mitgliederverwaltung Backup] ' + betreff, text);
  } catch (e) { console.error('Fehlermail konnte nicht gesendet werden: ' + e); }
}

/** Trigger: Sicherung anlegen und alte Kopien aufräumen. */
function backupErstellen() {
  try {
    var e = backupEinstellungen_();
    var ordner = DriveApp.getFolderById(e.ordnerId);
    var access = String(ordner.getSharingAccess());
    if (BackupPlan.freigabeZuOffen(access)) {
      throw new Error('Der Backup-Ordner ist zu offen freigegeben (' + access + '). Sicherung abgebrochen – ' +
        'Freigabe auf „Eingeschränkt“ setzen (Sicherheitsregel A4/C3).');
    }
    var jetzt = backupJetzt_();
    var name = BackupPlan.dateiname(jetzt);
    var kopie = DriveApp.getFileById(e.dbId).makeCopy(name, ordner);
    var dateien = backupDateien_(ordner);
    var weg = BackupPlan.zuLoeschen(dateien, jetzt, e.tage);
    dateien.forEach(function (d) { if (weg.indexOf(d.id) >= 0) d.datei.setTrashed(true); });
    console.log('Backup angelegt: ' + name + ' (' + kopie.getId() + '), ' + weg.length + ' alte Kopie(n) in den Papierkorb.');
    return { name: name, entfernt: weg.length };
  } catch (err) {
    console.error('Backup fehlgeschlagen: ' + (err && err.stack || err));
    backupFehlerMelden_('Sicherung fehlgeschlagen', String(err && err.message || err));
    throw err;
  }
}

/**
 * Wiederherstellungstest (C3: mindestens einmal tun, danach z. B. jährlich): öffnet das jüngste Backup und
 * vergleicht Tabs und Zeilenzahlen mit dem Original. Ändert nichts. Bericht im Ausführungsprotokoll.
 */
function wiederherstellungTest() {
  var e = backupEinstellungen_();
  var ordner = DriveApp.getFolderById(e.ordnerId);
  var j = BackupPlan.juengstes(backupDateien_(ordner));
  if (!j) throw new Error('Im Backup-Ordner liegt noch keine Sicherung.');
  var zaehle = function (ss) {
    var o = {};
    ss.getSheets().forEach(function (s) { o[s.getName()] = s.getLastRow(); });
    return o;
  };
  var v = BackupPlan.vergleiche(zaehle(SpreadsheetApp.openById(e.dbId)), zaehle(SpreadsheetApp.openById(j.id)));
  var bericht = 'Wiederherstellungstest mit „' + j.name + '“: ' + (v.ok ? 'IN ORDNUNG' : 'FEHLER – fehlende Tabs: ' + v.fehlend.join(', ')) +
    '\n' + v.zeilen.join('\n');
  console.log(bericht);
  if (!v.ok) backupFehlerMelden_('Wiederherstellungstest fehlgeschlagen', bericht);
  return bericht;
}

/** Einmal im Editor ausführen: legt den Zeit-Trigger an (vorhandene für backupErstellen werden ersetzt). */
function triggerEinrichten() {
  var e = backupEinstellungen_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupErstellen') ScriptApp.deleteTrigger(t);
  });
  var b = ScriptApp.newTrigger('backupErstellen').timeBased();
  if (e.rhythmus === 'woechentlich') b = b.everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY);
  else b = b.everyDays(1);
  b.atHour(3).nearMinute(15).inTimezone('Europe/Berlin').create();
  console.log('Trigger angelegt: backupErstellen ' + e.rhythmus + ' gegen 03:15 Uhr.');
}
