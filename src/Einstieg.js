/**
 * Einstieg – alle öffentlich erreichbaren Funktionen der WebApp an einer Stelle.
 *
 * Zweck:      doGet liefert die Oberfläche aus; die api…-Funktionen sind die einzigen Ziele für
 *             google.script.run aus dem Browser. Dazu Funktionen für den Eigentümer im Editor (setup,
 *             triggerEinrichten) und der Zeit-Trigger messungSchreiben.
 * Datenquelle: über DB, Konfig, Messung – nie direkt.
 * Wer darf was:
 *   - Jede api…-Funktion läuft durch Api.ausfuehren(name, aktion, fn). Das prüft die Rolle des Aufrufers
 *     gegen den Tab Benutzer (Sicherheitsregel A2) – auch wenn jemand die Funktion aus der Browser-Konsole
 *     direkt aufruft. Welche Rolle welche Aktion darf, steht in src/lib/rechte.js.
 *   - setup, triggerEinrichten und messungSchreiben dürfen nur im Kontext des Funktionskontos laufen
 *     (Zugriff.nurFunktionskonto) – also im Editor oder als Trigger, nicht aus dem Browser eines Nutzers.
 * Besonderheiten:
 *   - Neue öffentliche Funktionen IMMER hier anlegen und IMMER über Api.ausfuehren. Alles, was nicht
 *     öffentlich sein soll, endet auf „_“ (Apps Script blendet solche Funktionen für google.script.run aus).
 *   - Startdaten werden je nach _Konfig.snapshot_einbetten direkt in die Seite eingebettet (spart einen
 *     Server-Aufruf) oder vom Browser über apiStart nachgeladen – schaltbar, damit beides messbar ist.
 *   - Kein setXFrameOptionsMode(ALLOWALL): Die Homepage leitet per Redirect weiter, kein iFrame (B3).
 *   - Fehlerseiten sind bewusst nichtssagend (A9); Details stehen nur im Ausführungsprotokoll.
 */

/** Liefert die Oberfläche aus. */
function doGet(e) {
  var antwort = Api.ausfuehren('doGet', 'start', function (ktx) {
    return Konfig.wert('snapshot_einbetten') === 'ja' ? Startdaten_(ktx) : null;
  });
  if (!antwort || !antwort.ok) {
    return KeinZugang_(antwort && antwort.fehler && antwort.fehler.art);
  }
  var t = HtmlService.createTemplateFromFile('client/index');
  t.startdatenJson = antwort.daten ? JsonEinbetten_(antwort.daten) : '';
  return Seite_(t);
}

/** Titel und Viewport für jede ausgelieferte Seite (mobile-first, B7). */
function Seite_(template) {
  return template.evaluate()
    .setTitle('Mitgliederverwaltung TSV Ergoldsbach')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Startdaten für den Browser – nur, was die Rolle sehen darf (Phase 1: Benutzer, Konfig, Abteilungen). */
function Startdaten_(ktx) {
  var abteilungen = (DB.lese(['Abteilung']).Abteilung || []).map(function (a) {
    return { id: a.abteilung_id, bezeichnung: a.bezeichnung, aktiv: a.aktiv };
  });
  return {
    benutzer: {
      name: ktx.name || ktx.email,
      email: ktx.email,
      rollen: ktx.rollen,
      abteilungen: ktx.abteilungen
    },
    aktionen: ktx.aktionen,
    sicht: ktx.sicht,
    beitragsjahr: Konfig.wert('beitragsjahr'),
    impressum_url: Konfig.wert('impressum_url'),
    datenschutz_url: Konfig.wert('datenschutz_url'),
    abteilungen: abteilungen,
    erzeugt: DB.jetzt()
  };
}

/** JSON so aufbereiten, dass es gefahrlos in <script type="application/json"> steht. */
function JsonEinbetten_(daten) {
  return JSON.stringify(daten)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Generische Seite ohne Details – bei fehlender Berechtigung und bei internen Fehlern. */
function KeinZugang_(art) {
  var t = HtmlService.createTemplateFromFile('client/kein_zugang');
  t.zugriff = art === 'zugriff';
  t.impressumUrl = '';
  t.datenschutzUrl = '';
  try {
    t.impressumUrl = Konfig.wert('impressum_url') || '';
    t.datenschutzUrl = Konfig.wert('datenschutz_url') || '';
  } catch (err) {
    console.error('KeinZugang_: Konfig nicht lesbar', err);
  }
  return Seite_(t);
}

/** Bindet eine HTML-Datei (z. B. client/stil) in ein Template ein. */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ---------------------------------------------------------------------------------------------
// Aufrufe aus dem Browser (google.script.run)
// ---------------------------------------------------------------------------------------------

/** Startdaten nachladen (wenn nicht eingebettet). */
function apiStart() {
  return Api.ausfuehren('apiStart', 'start', function (ktx) { return Startdaten_(ktx); });
}

/** Leerer Aufruf zum Messen des reinen Round-Trip-Overheads. */
function apiPing() {
  return Api.ausfuehren('apiPing', 'start', function () { return { pong: true }; });
}

/** Auswertung der Server-Messwerte für die Admin-Ansicht. */
function apiMessungen() {
  return Api.ausfuehren('apiMessungen', 'messung_lesen', function () { return Messung.auswertung(); });
}

/** Nimmt die im Browser gemessenen Zeiten gebündelt entgegen (höchstens 200 je Aufruf). */
function apiClientMessungen(liste) {
  return Api.ausfuehren('apiClientMessungen', 'start', function () {
    Messung.clientWerte(Array.isArray(liste) ? liste.slice(0, 200) : []);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Nur für das Funktionskonto: im Apps-Script-Editor ausführen bzw. als Trigger
// ---------------------------------------------------------------------------------------------

/** Richtet die Datenbank-Tabelle ein bzw. bringt sie auf den Stand des Datenmodells. */
function setup() {
  Zugriff.nurFunktionskonto();
  return Setup.ausfuehren();
}

/** Legt den stündlichen Trigger zum Wegschreiben der Messwerte an (vorhandene werden ersetzt). */
function triggerEinrichten() {
  Zugriff.nurFunktionskonto();
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'messungSchreiben') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('messungSchreiben').timeBased().everyHours(1).create();
  var text = 'Trigger messungSchreiben (stündlich) eingerichtet.';
  console.log(text);
  return text;
}

/** Zeit-Trigger: gepufferte Messwerte nach _Messung schreiben. */
function messungSchreiben() {
  try {
    Zugriff.nurFunktionskonto();
    Messung.schreibePuffer();
  } catch (err) {
    console.error('messungSchreiben fehlgeschlagen', err);
  }
}
