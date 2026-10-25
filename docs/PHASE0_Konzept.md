# Phase 0 – Konzept Mitgliederverwaltung TSV Ergoldsbach e.V.

Stand: 25.10.2026 · Status: **Entwurf, wartet auf Freigabe durch Johann** · Noch kein Code.

Gelesen wurden:

| Dokument | Fundort im Repo | Rang bei Widerspruch |
|---|---|---|
| Sicherheitsregeln (Teil A–E) | `Sicherheitsregeln.md` (Wurzel) | 1 |
| Aktuellstes Datenmodell (Excel/Spaltenspezifikation) | **fehlt** | 2 |
| Übergabe-Dokument | `UEBERGABE_Mitgliederverwaltung_TSV.md` (Wurzel) | 3 |
| Mockup Mitgliederverwalter | `mockup_rolle_mitgliederverwalter_1.html` | 4 |
| Mockup Abteilungsleiter | `mockup_rolle_abteilungsleiter.html` | 4 |

Kennzeichnung im Text: **[A]** = Annahme, **[?]** = weiß ich nicht / muss gemessen oder geprüft werden, **[E]** = Entscheidung von Johann nötig.

---

## 1. Blocker vorab

1. **Das Datenmodell (Rang 2) liegt nicht im Repo.** Es gibt kein `/docs`, keine Excel-Datei und keine `Datenmodell_Mitgliederverwaltung_TSV.md`. Bis es da ist, nehme ich Abschnitt 3 des Übergabe-Dokuments als Spezifikation. Die Mockups zeigen aber ein **weiterentwickeltes Modell** (siehe W1–W4). Ich vermute, das „aktuellste Datenmodell“ ist genau diese Weiterentwicklung. **[E] Bitte die Datei nachreichen**, bevor Phase 1 die Kopfzeilen festschreibt.
2. **Spaltenliste von `Daten16` fehlt.** Für die Migration brauche ich die Spaltennamen und Datentypen. Echtdaten will ich nicht, nur die Kopfzeile plus 2–3 erfundene Beispielzeilen, vor allem für `Zahler`, `Zahlung`, `EinDat`/`AusDat`, Beitrags- und Adressfelder. Daraus baue ich die synthetischen Testdaten.
3. **Termin SEPA:** Heute ist der 25.10.2026, die Frist ist der 15.11.2026, also in drei Wochen. Laut Mockup läuft der nächste reguläre Einzug am 15.02.2027. **[E] Gibt es zwischen dem 15.11.2026 und Februar noch einen Einzug** (Nachzügler, Neuaufnahmen)? Wenn ja, muss der SEPA-Generator **vor** Phase 1 geliefert werden (siehe Meilenstein S in Abschnitt 8).

---

## 2. Widersprüche zwischen den Dokumenten (gemeldet, nicht aufgelöst)

| # | Thema | Übergabe-Dokument | Mockup / Auftrag | Bemerkung |
|---|---|---|---|---|
| W1 | **Funktionen** | `funktion` ist ein Feld an `Abteilungszugehörigkeit` (Spieler/Trainer/AL …) | Eigene Funktionshistorie mit von/bis, Ebene (Verein/Abteilung), Zusatz („E-Jugend“), Ende-Grund; dazu Stammdaten **Funktionsart** (FZ nötig, Bestellung, ehrungsfähig). Spieler bekommen ausdrücklich **keine** Funktion. | Größte Strukturabweichung. Neue Tabs `Funktion`, `Funktionsart`. Vorstandsämter (Ebene „Verein“) passen nicht in die Abteilungszugehörigkeit. |
| W2 | **Funktionsjubiläum** | `Ehrungsregel.typ` kennt „Funktionsjubiläum“, das Modell hat aber keine Funktionshistorie | Mockup leitet es aus der Funktionshistorie ab | Ist nur mit W1 überhaupt berechenbar. |
| W3 | **Rechte Mitgliederverwalter** | sieht **keine** Finanzen, ändert Mitglieder/Abteilungen/Ehrungen | Mockup: „Mitgliederverwalter · Administrator“, sieht alles inkl. Bankdaten, pflegt IBAN/Mandate und **Rechte** | Rollenmatrix, siehe offene Entscheidung O4. |
| W4 | **Rechte Kassier** | darf Konten ändern | Mockup: „keine IBAN-Änderung“, nur Einzug, Buchungsstatus, Mahnstufe | ebenso O4 |
| W5 | **Rechte Abteilungsleiter** | kein FZ; ändert Zugehörigkeit/Funktion | Mockup MV: „Zugehörigkeit, Funktionen und **Nachweise** seiner Abteilung“, Protokoll zeigt, dass ein AL einen FZ-Nachweis anlegt. Mockup AL: nur Ampel, keine Daten | Widerspruch auch zwischen den beiden Mockups (Frage 8 im MV-Mockup). |
| W6 | **Adresse** | `strasse`, `plz`, `ort` | Auftrag + Mockup: `strasse`/`hausnummer` getrennt, Land | Auftrag hat Vorrang vor dem Mockup, aber nicht vor dem fehlenden Datenmodell. Vorschlag: `strasse`, `hausnummer`, `plz`, `ort`, `land` (Default `DE`). |
| W7 | **Bezüge am Mitglied** | Abschnitt 4: Mitglied trägt `beitragsart_id`, `beitragskonto_id`, `beitragsgemeinschaft_id` | In der Feldtabelle `Mitglied` (Abschnitt 3) fehlen diese drei Spalten | Lücke im selben Dokument. Vorschlag: die drei FK-Spalten an `Mitglied` (sie sind nicht sensibel, die Kontodaten selbst bleiben isoliert). |
| W8 | **„passiv“** | `status` aktiv/passiv an der Abteilungszugehörigkeit | Mockup Frage 9: an der Person oder an der Zugehörigkeit? | offen |
| W9 | **Mannschaft** | nicht vorhanden | Beide Mockups fragen nach (Freitext-Zusatz an der Funktion vs. gepflegte Liste) | offen |
| W10 | **Halbjährliches Intervall** | `Beitragsart.intervall` jährlich/halbjährlich, aber `Sollstellung` eindeutig je (Konto, Jahr) | – | Zwei Einzüge pro Jahr passen nicht in diese Eindeutigkeit. Entweder `periode` in den Schlüssel aufnehmen oder „halbjährlich“ streichen. **[E]** |
| W11 | **Denormalisierung** | Abschnitt 7: „Keine verfrühte Denormalisierung. Erst messen.“ | Auftrag: denormalisierter Snapshot als Kern der Architektur | Kein harter Konflikt: Der Snapshot ist ein Cache, keine zweite Datenquelle. Ich melde ihn trotzdem, weil die Dokumente unterschiedliche Grundhaltungen haben. |
| W12 | **Neue Tabs ohne Spezifikation** | nicht enthalten | Auftrag nennt `Aufbewahrungsfrist`, `Einwilligung`, `Betroffenenanfrage` | Spalten muss ich vorschlagen (Abschnitt 4). |
| W13 | **Löschung vs. „nie löschen“** | – | Mockup: „Beendete Funktionen werden nie gelöscht“ ↔ Sicherheitsregel D4 (Löschfristen anwenden) | Vorschlag: Funktionshistorie bleibt, solange die Person Mitglied ist, danach gilt die Frist aus `Aufbewahrungsfrist`. **[E]** |
| W14 | **Kleinkram** | Übergabe-Kopf verweist auf „Abschnitt 10“ für offene Punkte, gemeint ist Abschnitt 9 | Auftrag: 7 Abteilungen; Mockup zeigt 5 (Fußball, Turnen, Tennis, Stockschützen, Ski ruhend) | Nur zur Kenntnis. |
| W15 | **Ablageort** | – | Auftrag: Dokumente in `/docs`; im Repo liegen sie in der Wurzel | Vorschlag: in Phase 1 nach `docs/` verschieben. |

---

## 3. Lücken und Annahmen

**Fachlich**
- L1 **Jugend-Definition:** Für die Zeilensicht des Jugendleiters braucht es eine Grenze (unter 18? unter 27 wie bei der BLSV-/Sportjugend?) und einen Stichtag (heute oder 01.01.). Vorschlag: `_Konfig.jugend_bis_alter = 18`, Stichtag heute. **[E]**
- L2 **Anteiliger Beitrag** bei unterjährigem Ein- oder Austritt (Mockup Frage 6). Bis zur Klärung rechne ich mit dem vollen Jahresbeitrag und lege die Regel als Konfiguration an. **[E]**
- L3 **Kündigungsfrist / „wirksam zum“:** Die Regel aus der Satzung fehlt. Vorschlag: `_Konfig.austritt_wirksam = Jahresende`.
- L4 **Mandatsverfall 36 Monate:** blockieren oder warnen (Mockup Frage 5)? Vorschlag: aus dem Lauf ausschließen und in die Klärliste schreiben, also blockieren, aber mit sichtbarem Grund.
- L5 **Vier-Augen-Prinzip beim SEPA-Lauf** (Mockup Frage 7): Vorschlag: MV oder Kassier erzeugt den Probelauf, eine zweite Rolle gibt ihn frei. Bis zur Entscheidung genügt eine Freigabe.
- L6 **IBAN-Anzeige:** Vorschlag: maskiert (`DE89 •••• 3000`), Klartext per Klick, das Aufdecken wird protokolliert. Das deckt sich mit Auftragspunkt 5.
- L7 **Benutzer mit mehreren Abteilungen:** `Benutzer.abteilung_id` erlaubt nur eine Abteilung. Vorschlag: mehrere IDs, durch Komma getrennt, oder eine Zeile je Abteilung. **[E]**
- L8 **Externe Trainer ohne Mitgliedschaft** (Mockup Frage 4): Vorschlag: `Mitglied`-Zeile ohne Mitgliedschaftszeitraum plus Merker `nur_funktionstraeger`. Dann zählt die Person weder im BLSV-Bestand noch beim Beitrag.
- L9 **BLSV-Altersklassen:** Das Mockup zeigt bis 14 / 15–18 / 19–26 / ab 27. Die echte verein360-Gliederung und die Altersberechnung (Jahrgang oder Stichtag 01.01.) kenne ich nicht. **[?]** Ich lege die Klassen als Konfiguration an und bitte um die aktuelle Importvorlage (Kopfzeile genügt).
- L10 **Mandatsreferenz-Schema:** Das Mockup zeigt `TSV-<Jahr>-<Mitgliedsnr>`. **[A]** Bestehende Referenzen werden unverändert übernommen.

**SEPA**
- L11 **[?]** Was die Frist 15.11.2026 genau verlangt (Formatversion .08, Wegfall unstrukturierter Adressen oder beides), sollte die Hausbank bestätigen. Bitte fragt sie auch nach der Version der DK-Spezifikation (Anlage 3), die sie erwartet.
- L12 **[A, bitte prüfen]** Nach meinem Kenntnisstand ist die Schuldneradresse bei SEPA-Lastschriften nur Pflicht, wenn die Bank des Zahlers außerhalb des EWR sitzt. Stimmt das, sind unvollständige Adressen für die allermeisten Konten **nicht blockierend**. Der Generator schreibt die Adresse trotzdem strukturiert, sobald sie vollständig ist.
- L13 Die Gläubiger-ID gehört in `PropertiesService` oder `_Konfig`. Das ist kein Secret, aber Konfiguration. Vorschlag: `_Konfig`.
- L14 Für die Testvalidierung brauche ich das **XSD pain.008.001.08**. `xmllint` ist hier vorhanden. **[E]** Darf ich das XSD aus der offiziellen Quelle (ISO 20022 / EBICS.de) ins Repo legen?

**Apps Script (alles [?] bis gemessen)**
- `Session.getActiveUser().getEmail()` liefert bei „Ausführen als Ich“ und Domain-Beschränkung die Adresse des Aufrufers, wenn er zur selben Workspace-Domain gehört. Das entspricht der dokumentierten Funktionsweise. Ich prüfe beim Start trotzdem auf einen leeren String und weise dann ab.
- CacheService: höchstens 100 KB je Wert, höchstens 6 h (21.600 s) Gültigkeit, `putAll`/`getAll` vorhanden. **Eine Gesamtgrenze je Cache kenne ich nicht verlässlich.** Einträge können jederzeit vorzeitig verfallen, deshalb ist der Cache nie die Wahrheit.
- PropertiesService: etwa 9 KB je Wert, etwa 500 KB gesamt. Für den Snapshot ungeeignet.
- Laufzeit: 6 min je Ausführung. Trigger-Laufzeit gesamt meines Wissens 6 h/Tag bei Workspace-Konten. Bitte für Nonprofits in den aktuellen Quotas prüfen.
- Die Zahl gleichzeitiger Ausführungen und die maximale Größe einer `HtmlOutput` kenne ich nicht sicher. Bei ca. 0,5–1 MB eingebettetem JSON rechne ich mit keinem Problem **[A]**, prüfe es aber in Phase 3 mit einem Messlauf.
- Die Overhead-Werte aus dem Auftrag (0,3–0,8 s je `google.script.run`, 0,5–2 s Kaltstart) decken sich mit meiner Erfahrung, bleiben aber **Annahmen**. Phase 1 liefert die Messung, mit der wir sie ersetzen.

---

## 4. Vorschlag Tab-Struktur (Grundlage für das Setup-Skript, vorbehaltlich Datenmodell)

Übernommen aus der Übergabe: `Mitglied`, `Mitgliedschaftszeitraum`, `Abteilung`, `Abteilungszugehoerigkeit`, `Beitragskonto`, `Beitragsgemeinschaft`, `Beitragsart`, `Sollstellung`, `Ehrungsregel`, `Ehrung`, `Qualifikation`, `Benutzer`, `_Konfig`, `_Protokoll`.

Ergänzungen (jeweils **[E]**):

| Tab | Zweck | Kernspalten (Vorschlag) |
|---|---|---|
| `Funktion` (W1) | Amts- und Tätigkeitshistorie | `funktion_id`, `mitglied_id`, `funktionsart_id`, `abteilung_id` (leer = Verein), `zusatz`, `von`, `bis`, `ende_grund` |
| `Funktionsart` (W1) | Stammdaten | `funktionsart_id`, `bezeichnung`, `ebene`, `fz_noetig`, `bestellung`, `ehrungsfaehig`, `aktiv` |
| `GesetzlicherVertreter` (O5) | Erziehungsberechtigte | `vertreter_id`, `mitglied_id`, `vertreter_mitglied_id` (optional), `name`, `telefon`, `email`, `beziehung`, `bemerkung` |
| `Einwilligung` | ersetzt/ergänzt `foto_ok` | `einwilligung_id`, `mitglied_id`, `art` (Foto, E-Mail …), `erteilt_am`, `erteilt_durch` (selbst/Vertreter), `widerrufen_am` |
| `Betroffenenanfrage` | DSGVO Art. 15–21 | `anfrage_id`, `mitglied_id`, `art`, `eingang`, `frist` (abgeleitet +1 Monat), `erledigt_am`, `bearbeiter`, `bemerkung` |
| `Aufbewahrungsfrist` | Löschkonzept als Daten | `frist_id`, `datenkategorie`, `bezug` (z. B. Austritt, Funktionsende), `dauer_monate`, `aktion` (löschen/anonymisieren), `ausloeser` (manuell/Trigger) |
| `_Messung` | Zeitmessung, siehe 5.8 | `zeit`, `funktion`, `dauer_ms`, `sheets_aufrufe`, `cache` (hit/miss), `rolle` |

Technische Zusatzspalte je Datentab: `version` (Ganzzahl), siehe 5.4. Sie hängt an allen Tabs mit Bearbeitung, nicht nur an `Mitglied`.

Bei `foto_ok`/`foto_am`/`foto_widerruf` an `Mitglied` gibt es eine Doppelung mit `Einwilligung`. Vorschlag: Die Foto-Felder wandern nach `Einwilligung`. **[E]**

---

## 5. Performance-Architektur

### 5.1 Grundsatz
Bei ~1.200 Mitgliedern sind die Datenmengen klein (geschätzt **[A]**: 300–600 KB JSON für den vollen Snapshot). Der Engpass sind Round-Trips und Sheets-Aufrufe, nicht die Rechenzeit. Deshalb gilt: **wenige, gebündelte Aufrufe, Arbeit im Browser.** Den Vorschlag aus dem Auftrag halte ich im Kern für richtig. Unten bewerte ich jeden Punkt mit Alternativen.

### 5.2 Datenfluss (Empfehlung)

```
Sheets ──(1 batchGet über alle nicht sensiblen Tabs)──► Basis-Snapshot (voll, nur serverseitig)
                                                          │  in CacheService, gzip+Chunks
Anfrage ─► Rolle ermitteln ─► Rollen-Schnitt (Zeilen+Felder, rein, in Node testbar) ─► Client
                                  ▲
Schreiben ─► Lock ─► Versionsprüfung ─► Zeile schreiben ─► Basis-Snapshot patchen ─► Antwort mit Datensatz
```

**Kernentscheidung:** Gecacht wird **ein** voller Basis-Snapshot, nicht ein Snapshot je Rolle. Den Rollen-Schnitt rechnet der Server bei jeder Anfrage neu. Bei 1.200 Zeilen dauert das im Speicher wenige Millisekunden **[A]**. Vorteile: Ein Schreibvorgang muss nur einen Cache-Eintrag aktualisieren, und es gibt keine Gefahr, dass ein Abteilungs-Snapshot veraltet. Der Basis-Snapshot verlässt den Server nie. Sensible Tabs (`Beitragskonto`, `Qualifikation`, `GesetzlicherVertreter`, `Betroffenenanfrage`) sind **nicht** im Basis-Snapshot. Die Sicherheitsregel gilt damit doppelt: Was nicht geladen wird, kann nicht durchrutschen.

Ausnahme: Kassier und Admin brauchen Konto-Übersichten. Dafür gibt es einen **eigenen** Finanz-Snapshot (Konten ohne IBAN-Klartext, Sollstellungen), den nur diese Rollen laden und der getrennt gecacht wird.

### 5.3 Bewertung der Auftragspunkte

| # | Vorschlag | Bewertung | Empfehlung |
|---|---|---|---|
| 1 | Einmal laden, lokal arbeiten; Einbettung in `doGet` | Spart einen Round-Trip (meist der teuerste, weil kalt). Risiko: `doGet` wird langsamer, bis das erste Byte kommt, und die Seite bleibt weiß. | **Ja, mit Einbettung.** Alternative: leere Hülle plus ein Aufruf `ladeStart()`. Zeigt schneller ein Gerüst, kostet aber +1 Round-Trip. Beide Varianten baue ich schaltbar (`_Konfig.snapshot_einbetten`), damit wir in Produktion messen statt raten. |
| 2 | Write-through in CacheService, Chunking, Rebuild per `batchGet` | Richtig. `batchGet` (Advanced Service Sheets) braucht **denselben** Scope `spreadsheets` wie `SpreadsheetApp`, weitet also nichts auf **[A, im Manifest prüfen]**. Gzip über `Utilities.gzip` + Base64 verkleinert den Snapshot geschätzt um Faktor 4–8 **[A]**, also auf 1–2 Chunks statt 6. | **Ja.** Schlüssel mit Generationszähler (`snap:v17:0..n`), damit Leser nie eine halb geschriebene Chunk-Mischung bekommen. Der Generationszähler liegt ebenfalls im Cache. Fehlt ein Chunk, wird neu gebaut. |
| 2b | Weitere Persistenzschicht? | Optionen: **(a)** keine, Rebuild aus Sheets (geschätzt 1–2 s **[?]**); **(b)** Tab `_Snapshot` mit JSON-Chunks in Zellen (max. 50.000 Zeichen je Zelle), ohne neuen Scope; **(c)** Drive-Datei, braucht den Drive-Scope, verworfen. | **(a)**. (b) nur, wenn Messungen zeigen, dass der kalte Rebuild über 4 s liegt. (b) ist eine zweite Kopie, die veralten kann, und das ist bei einem nicht technischen Nachfolger ein Risiko. |
| 3 | Schreibaufrufe liefern den Datensatz zurück | Klar richtig. | **Ja.** Antwortformat einheitlich: `{ok, daten, version, messung}`. |
| 4 | Optimistische Konsistenz über `geaendert_am` | `geaendert_am` hat Formatierungs- und Zeitzonentücken (Sheets wandelt Datumswerte). | **Spalte `version` (Ganzzahl)**, +1 je Schreibvorgang; `geaendert_am` bleibt als Info. Bei Konflikt gibt der Server den aktuellen Stand zurück, und der Client zeigt „wurde inzwischen geändert“. **[E]** |
| 5 | Sensible Felder einzeln nachladen und protokollieren | Richtig, kostet aber pro Datensatz einen Round-Trip. | **Ja.** Für die Kassier-Massenansicht gibt es maskierte Werte im Finanz-Snapshot, den Klartext nur einzeln. |
| 6 | Virtualisieren/Paginieren | 1.200 Zeilen im DOM sind auf alten Handys spürbar **[A]**. | **Einfaches Paginieren/„mehr laden“ (50er-Blöcke)**. Echte Virtualisierung ist mehr Code für den Nachfolger und lohnt sich hier nicht. |
| 7 | Warmhalte-Trigger | Hält den **Cache** warm. Ob er auch die **Laufzeitumgebung** (Kaltstart) für Webapp-Aufrufe warm hält, **weiß ich nicht**. Trigger-Laufzeit zählt aufs Tageskontingent. | **Optional, aus per Default.** Trigger alle 5 h baut den Snapshot neu, ca. 5 Läufe × 2 s pro Tag, vernachlässigbar. Ob es den Kaltstart verbessert, messen wir in Produktion. |
| 8 | Messbarkeit | Pflicht, siehe 5.8 | **Ja.** |

### 5.4 Schreibpfad im Detail
1. Rolle prüfen, Eingaben validieren (reine Funktion).
2. `LockService.getScriptLock().waitLock(…)`. Bei Timeout kommt eine generische Meldung „Bitte erneut versuchen“.
3. Zeilenposition finden: **eine** Lesung der ID-Spalte des Ziel-Tabs (IDs nie über Zeilenposition, Übergabe Abschnitt 7).
4. Versionsprüfung gegen die Zeile, Zeile schreiben (ein `setValues`), Protokolleintrag (ein `appendRow`), ID-Zähler in `_Konfig`, falls neu.
5. Basis-Snapshot im Cache patchen (lesen → ändern → schreiben, **innerhalb** des Locks), Generationszähler +1.
6. Lock freigeben, rollenbeschnittenen Datensatz zurückgeben.

Erwartung **[A]**: 4–6 Sheets-Aufrufe, Ziel ≤ 1,5 s ist realistisch.

Alternative: das Append-only-Journal (wie Schichtplan). Für Stammdaten-Bearbeitung halte ich es für unpassend: Man müsste den Zustand immer aus dem Journal zurückrechnen, und der Klartext-Fallback „Sheet lesen“ ginge verloren. Für `_Protokoll` ist es ohnehin das Muster.

### 5.5 Abteilungsleiter-Suche
Das Mockup verlangt: Ein AL darf ein **vereinsweites** Mitglied nur mit **exakter** Angabe (Mitgliedsnummer **oder** Nachname + Geburtsdatum) finden, höchstens ein Treffer. Das läuft **serverseitig** gegen den Basis-Snapshot und wird protokolliert. Im AL-Snapshot sind fremde Mitglieder nicht enthalten.

### 5.6 Client
- Vanilla JS, eine `index.html` plus Include-Dateien (`<?!= include('…') ?>`), Systemschriften, keine CDNs.
- Lokaler Index (normalisierte Suchstrings, Umlaute gefaltet). Ziel < 100 ms ist bei 1.200 Zeilen problemlos **[A]**.
- Ein Wrapper `rufe(fn, …args)` um `google.script.run` misst die Zeit, sammelt sie und zeigt sie im Admin-Bereich.
- Fußzeile mit Impressum und Datenschutz (D1).

### 5.7 Schichtung im Server
```
Einstieg (doGet, öffentliche API-Funktionen)  ← nur hier google.script.run-Ziele
   └ Guard: rolle = pruefeZugriff(aktion)      ← jede API-Funktion, ohne Ausnahme
       └ Fachmodule (Mitglied, Beitrag, SEPA, Ehrung …)  ← reine Logik in lib/, testbar
           └ Datenzugriff (DAL): lesen/schreiben/batch, zählt Sheets-Aufrufe
               └ Sheets
```
Konvention: Nur Funktionen **ohne** abschließenden Unterstrich sind vom Client aufrufbar. Apps Script macht Funktionen mit `_` am Ende für `google.script.run` unsichtbar. Alles Interne endet auf `_`. Damit ist auch die Angriffsfläche aus der Browser-Konsole klar umrissen.

### 5.8 Messung
- Der Server misst je API-Aufruf: Dauer, Zahl der Sheets-Aufrufe (Zähler in der DAL), Cache-Treffer. Der Wert geht **mit der Antwort** zurück (kostet nichts) und kommt in einen Ringpuffer im Cache.
- Ein stündlicher Trigger, sofern freigegeben, schreibt den Ringpuffer gesammelt nach `_Messung`. So entsteht kein Schreibzugriff pro Nutzeraktion. Nachteil: Bei Cache-Verfall gehen Messwerte verloren, das ist akzeptabel.
- Der Admin-Bereich zeigt Median und P90 je Funktion, Client- und Serverzeit nebeneinander. Die Differenz entspricht dem Round-Trip-Overhead, und so ersetzen wir die Annahmen aus 3. durch Messwerte.

---

## 6. Offene Entscheidungen (Übergabe Abschnitt 9) – je ein Vorschlag

Alles wird Konfiguration bzw. Seed-Zeilen, kein Hardcode.

| # | Frage | Vorschlag | Umsetzung |
|---|---|---|---|
| O1 | Ehrungsjahre: letzter Eintritt oder gesamt? | **Gesamt** (Summe aller Zeiträume). Wirkt fairer bei Unterbrechungen und ist im Verein meist üblich **[A]**. Satzung bzw. Ehrungsordnung prüfen. | `_Konfig.ehrung_jahre_modus = gesamt \| letzter_eintritt`; beide Berechnungen in `lib/ehrung.js`. Die Prüfliste zeigt bei Abweichung beide Werte (Mockup: Bauer 40 vs. 51). |
| O2 | Stichtag | **Kalenderjahr** (wie empfohlen); Jahre = Jahr − Eintrittsjahr; Teiljahre bei „gesamt“ nach vollen Monaten. | `_Konfig.ehrung_stichtag = kalenderjahr \| exakt` |
| O3 | Ehrungsstufen | Platzhalter-Seeds: Mitgliedsjubiläum 10/25/40/50/60/70; Geburtstag 70/75/80/85/90/95/100; Funktionsjubiläum 10/20/25. BLSV-Ehrungen als `verband=BLSV`, leer bis geklärt. | Tab `Ehrungsregel`, im Setup als „Platzhalter“ markiert. Das Funktionsjubiläum zählt **je Funktion getrennt** (Mockup Frage 10), umschaltbar. |
| O4 | Rollenmatrix | Siehe unten. Kompromiss aus Übergabe und Mockups, wobei die **Übergabe-Version strenger** ist. | Matrix als Daten: Tab `_Rechte` (Rolle × Aktion → ja/nein) und Feldklassen je Rolle; Benutzer pflegt nur `Admin`. |
| O5 | Gesetzliche Vertreter | **Eigener Tab `GesetzlicherVertreter`**, mit optionalem Verweis auf ein Mitglied **und** freien Kontaktfeldern. Das deckt zwei Elternteile, externe Eltern und den späteren Fall „Vertreter tritt aus“ ab. Mit dem 18. Geburtstag erscheint der Eintrag auf der Löschliste. | Neuer Tab, Sichtbarkeit wie „Kontakt“. Alternativen: Felder am Mitglied (einfach, aber nur 1–2 Personen und Doppelpflege bei Geschwistern) oder nur ein Verweis (scheitert bei Eltern, die keine Mitglieder sind). |

**Vorschlag Rollenmatrix (O4)**

| Rolle | Zeilen | Kontakt | Finanzen | FZ/Quali | Ändern |
|---|---|---|---|---|---|
| Admin (Vorstand) | alle | ✔ | ✔ | ✔ | alles inkl. Benutzer, `_Konfig` |
| Mitgliederverwalter | alle | ✔ | maskiert; IBAN/Mandat pflegen **[E: W3]** | – | Mitglied, Zeitraum, Zugehörigkeit, Funktion, Ehrung, Einwilligung |
| Kassier | alle | ✔ | ✔ | – | Sollstellung, Mahnung, SEPA-Lauf; Konto-Stammdaten **[E: W4]** |
| Jugendleiter | Jugend (L1) | ✔ | – | ✔ (Jugend + Funktionsträger mit FZ-Pflicht) | Qualifikation |
| Abteilungsleiter | eigene Abteilung(en) | ✔ | – | nur Ampel (Mockup b) | Zugehörigkeit/Funktion der eigenen Abteilung; **kein** Vereinsaustritt |

Zusätzlich: `_Konfig` darf nur Admin ändern (A8). Die Kopplung „Zugang folgt dem Amt“ (Mockup Frage 12) ist praktisch, hebelt aber die bewusste Vergabe aus. Vorschlag: Das System **meldet** beendete Ämter mit aktivem Zugang im Admin-Bereich, entzieht aber nicht automatisch.

---

## 7. Repo-Struktur und Teststrategie

```
/
├─ package.json            npm run check | test | push
├─ .clasp.json             (scriptId, rootDir: src)  – nicht im Repo, Vorlage .clasp.json.beispiel
├─ .claspignore
├─ docs/                   Ausgangsdokumente, dieses Konzept, Register C6, VVT D2, Betrieb, SEPA-Update-Prozedur
├─ src/
│  ├─ appsscript.json      Scopes [A]: spreadsheets, userinfo.email, script.scriptapp (nur für Trigger); Advanced Service Sheets
│  ├─ Einstieg.js          doGet, include, API-Funktionen (dünn)
│  ├─ Rechte.js            Rollenermittlung, Guard
│  ├─ Datenzugriff.js      DAL inkl. Zähler, Lock, ID-Vergabe
│  ├─ Cache.js             Snapshot, Chunking, Generation
│  ├─ Protokoll.js  Messung.js  Fehler.js
│  ├─ Setup.js             Tabs/Kopfzeilen aus lib/schema.js
│  ├─ modul/Mitglied.js Beitrag.js Sepa.js Ehrung.js Blsv.js Datenschutz.js …
│  ├─ lib/                 REINE Funktionen, kein Apps-Script-Service
│  │   schema.js rollenfilter.js beitrag.js sepa.js iban.js ehrung.js blsv.js migration.js validierung.js
│  └─ client/              index.html, stil.html, app.html, client-logik.html
├─ tools/
│  ├─ check.js             vm.Script je Datei + Gesamtprüfung (s. u.)
│  └─ migration-lokal.js   Node-CLI: Daten16-Export (CSV) → Tab-CSVs + Prüfbericht
├─ test/                   node:test, synthetische Daten in test/daten/
└─ fixtures/xsd/           pain.008.001.08.xsd (falls erlaubt, L14)
```

- **Reine Funktionen in Node:** `lib/*.js` sind normale Apps-Script-Dateien mit globalen Funktionen. Am Ende steht `if (typeof module !== 'undefined') module.exports = {…}`. Apps Script ignoriert diese Zeile, Node nutzt sie. Es gibt keinen Build-Schritt, und der Code im Editor entspricht dem Code im Repo. Das ist wichtig für den Nachfolger.
- **`npm run check`:** (1) `new vm.Script` je Datei, (2) **zusätzlich alle Server-Dateien zusammen** in einem Kontext ausführen. Apps Script teilt einen globalen Namensraum, ein doppeltes `const` über zwei Dateien hinweg fällt sonst erst in Google auf. (3) `<script>`-Blöcke aus den HTML-Dateien extrahieren und ebenso prüfen.
- **Tests:** `node --test`, keine Abhängigkeiten. Schwerpunkte: Beitragsberechnung (Wagner = 280 €), Rollenfilter (Negativtests: „AL sieht nie Fremdabteilung, nie Finanzfelder“), SEPA (XSD-Validierung mit `xmllint`, FRST/RCUR, Mandatsverfall, Summen-Prüfsummen `CtrlSum`/`NbOfTxs`), Ehrungen (Nachholung, keine Doppelehrung), Migration (Zahler-Cluster, Mischfälle landen in der Prüfliste).
- **Apps-Script-Teile** (DAL, Cache, Lock) teste ich in Node mit kleinen Fakes für `SpreadsheetApp`/`CacheService`. Echtes Verhalten prüfst du in Google (Liste in 9).
- **Migration läuft lokal in Node** gegen einen CSV-Export von `Daten16`. Die Echtdaten verlassen deinen Rechner nicht, die erzeugten Tab-CSVs importierst du ins Sheet. Alternativ läuft dieselbe `lib/migration.js` in Apps Script gegen einen Import-Tab. **[E]** Welcher Weg?

---

## 8. Meilensteinplan

| MS | Inhalt | Abnahme |
|---|---|---|
| **S (vorgezogen, falls O-Blocker 3 = ja)** | `lib/sepa.js` eigenständig: pain.008.001.08, strukturierte Adressen, FRST/RCUR-Ableitung, Mandatsverfall, CLI `tools/sepa-lokal.js` (CSV → XML) für den Übergang aus Access | XSD-valide, Tests grün, Testdatei bei der Bank einreichbar |
| 1 Fundament | Setup, DAL, ID-Vergabe, `Benutzer`/`_Rechte`, `_Protokoll`, Fehler, Messung, Skelett-UI mit Login-Prüfung und Admin-Messansicht | check+Tests grün; E: Scopes, Fehler generisch, Audit, Kopfkommentare |
| 2 Migration | `lib/migration.js`, lokales CLI, Prüfbericht (Zahler-Mischfälle, Adresstrennung Straße/Hausnr., Dubletten), synthetische Testdaten | Prüfbericht mit Testdaten, Round-Trip-Test |
| 3 Snapshot + Mitglieder | Cache, Rollenschnitt, Liste/Detail/Bearbeiten je Rolle, Versionsprüfung, AL-Exaktsuche, Exporte mit Protokoll | Zielwerte gemessen (Test-Deployment), Mobiltest |
| 4 Beiträge | Konten, Gemeinschaften, Guards (Waisen bei Austritt), `Sollstellung`, SEPA im UI, Klärliste | Wagner-Fall, Probelauf vs. Altsystem |
| 5 Ehrungen / BLSV / DSGVO | Ehrungsableitung, BLSV-Export, `Einwilligung`, `Betroffenenanfrage`, Löschlauf aus `Aufbewahrungsfrist`, Backup-Trigger (C3) | Go-Live-Checkliste vollständig |

Je Phase: Doku-Update in `docs/` (Register C6, VVT D2) und eine Liste dessen, was du in Google prüfen musst.

---

## 9. Was du schon jetzt in Google klären/prüfen solltest (vorläufig)
- Funktionskonto als Eigentümer, Ablage in geteilter Ablage, Zugang mehrfach hinterlegt (C1).
- Ordnerfreigaben der künftigen DB-Datei: niemand außer dem Funktionskonto (A4).
- Gibt es für Nonprofits abweichende Quoten (Trigger-Laufzeit, gleichzeitige Ausführungen)?
- Hausbank: Format, Frist und Testeinreichung pain.008.001.08 (L11/L12).

---

## 10. Was ich von dir zur Freigabe brauche
1. Datenmodell-Datei und `Daten16`-Kopfzeile (Blocker 1+2).
2. SEPA vorziehen ja/nein (Blocker 3).
3. Entscheidungen zu W1 (Funktions-Tabs), W3–W5/O4 (Rollen), W6 (Adressfelder), W10 (Intervall), O1–O3, O5, L1, L7, `version`-Spalte (5.3 #4), Migrationsweg (7).
4. Freigabe der Architektur 5.2: ein Basis-Snapshot im Cache, Rollenschnitt pro Anfrage, Einbettung schaltbar, keine zweite Persistenzschicht bis zur Messung.

Wo du nichts anderes sagst, setze ich meinen Vorschlag als Konfiguration oder Platzhalter um und markiere ihn im Code als `// OFFEN: …`.
