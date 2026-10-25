# Phase 0 – Konzept Mitgliederverwaltung TSV Ergoldsbach e.V.

Stand: 25.10.2026 · **Fassung 2** · Status: **wartet auf Freigabe durch Johann** · Noch kein Code.

Änderungen gegenüber Fassung 1:
- Datenmodell `Mitgliederverwaltung_TSV_Ergoldsbach.xlsx` und die Kopfzeile von `Daten16` (Screenshot) eingearbeitet.
- SEPA-Vorziehen gestrichen: Für 2026 gibt es eine Lösung. Der Generator muss nur künftig passen und bleibt in Phase 4.
- Neu: Verbesserungsvorschläge zum Datenmodell (Abschnitt 5) und ein Migrations-Mapping mit Rückfragen (Abschnitt 5b).

Kennzeichnung: **[A]** = Annahme, **[?]** = weiß ich nicht / messen oder prüfen, **[E]** = Entscheidung von Johann nötig.

## 1. Grundlagen

| Dokument | Fundort | Rang |
|---|---|---|
| Sicherheitsregeln (Teil A–E) | `Sicherheitsregeln.md` | 1 |
| **Datenmodell** (22 Tabs, `_Feldkatalog`, `_Enums`, Prüfregeln, Löschkonzept) | `Mitgliederverwaltung_TSV_Ergoldsbach.xlsx` | 2 |
| Eingangsdatei Aufnahmeanträge | `Aufnahmeantraege_TSV_Ergoldsbach.xlsx` | 2 (nicht Teil dieses Auftrags) |
| Übergabe-Dokument | `UEBERGABE_Mitgliederverwaltung_TSV.md` | 3 |
| Mockups MV / AL | `mockup_rolle_*.html` | 4 |
| Kopfzeile `Daten16` | Screenshot im Chat | Migrationsquelle |

Das Datenmodell ist laut Johann **noch nicht festgeschrieben**. Abschnitt 5 macht dazu Verbesserungsvorschläge. Bis zur Freigabe gilt es als Spezifikation für das Setup-Skript, und `_Feldkatalog` wird die Quelle für `lib/schema.js`.

---

## 2. Durch das Datenmodell erledigt (aus Fassung 1)

| Punkt Fassung 1 | Erledigt durch |
|---|---|
| W1/W2 Funktionshistorie, Funktionsjubiläum | Tabs `Funktion`, `Funktionsart` (mit `fz_pflichtig`, `ehrungsfaehig`); `Abteilungszugehoerigkeit` ohne Funktionsfeld |
| W6 Adresse | `strasse`, `hausnummer`, `plz`, `ort`, `land` am Mitglied; `abw_*` am Konto |
| W7 Bezüge am Mitglied | `beitragsart_id`, `beitragskonto_id`, `beitragsgemeinschaft_id` vorhanden |
| W9 Mannschaft | `Funktion.zusatz` als Freitext |
| W12 neue Tabs | `Einwilligung`, `Aufbewahrungsfrist`, `Betroffenenanfrage` vollständig spezifiziert, dazu `Statistik_Jahr`, `Qualifikationsart` |
| L2/L3 anteiliger Beitrag | `_Konfig.beitrag_anteilig = nein` (Default, offen) |
| L4 Mandatsverfall | `_Konfig.mandat_verfall_monate = 36` |
| O1–O3 als Konfiguration | `_Konfig.ehrung_zaehlweise`, `ehrung_stichtag`, `funktionsjubilaeum_zaehlweise`; Seeds in `Ehrungsregel` |
| O5 Vertreter | `Mitglied.vertreter_mitglied_id / vertreter_name / vertreter_kontakt` (als OFFEN markiert, siehe O5 unten) |
| Löschkonzept | 3 Stufen (sperren, anonymisieren, löschen), `loeschbar_ab`, `Statistik_Jahr` als eingefrorene anonyme Summen |

---

## 3. Widersprüche (gemeldet, nicht aufgelöst)

### 3a. Weiterhin offen

| # | Thema | Quellen | Bemerkung |
|---|---|---|---|
| W3 | **Rechte Mitgliederverwalter** | Übergabe: keine Finanzen. Datenmodell (Benutzer-Beispiel) und MV-Mockup: „Administrator, sieht und pflegt alles“ | Das Datenmodell hat Vorrang, die Aussage steht dort aber nur in einer Bemerkungszelle, nicht als Regel. **[E]** |
| W4 | **Rechte Kassier** | Übergabe: darf Konten ändern. Datenmodell + Mockup: „keine IBAN-Änderung“ | wie W3 |
| W5 | **Abteilungsleiter und FZ** | Übergabe: kein FZ. Datenmodell: `Qualifikation.eingesehen_durch = "Obermeier, Thomas"` (AL) und `_Protokoll` zeigt, dass ein AL eine Funktion anlegt. AL-Mockup: nur Ampel | Darf ein AL Einsicht in FZ **erfassen**, darf er sie dann auch **sehen**? **[E]** |
| W8 | „passiv“ an Person oder Zugehörigkeit | Datenmodell: an der Zugehörigkeit. `Daten16`: nur `Status Abteilung 1` | siehe M5 |
| W10 | **Halbjährliches Intervall** | `_Enums.intervall` enthält „halbjährlich“, aber `Sollstellung` ist eindeutig je (Konto, Jahr) | V4 |
| W13 | Funktionshistorie „nie löschen“ vs. Löschfrist | `Funktion.bis`: „Zeilen werden NIE gelöscht“. `Aufbewahrungsfrist` Zeile 6: „OFFENER PUNKT“ | im Datenmodell selbst als offen markiert |

### 3b. Neu aus Datenmodell und `Daten16`

| # | Thema | Befund |
|---|---|---|
| X1 | **Ehrung-Eindeutigkeit** | `Ehrung` ist eindeutig je (`mitglied_id`, `ehrungsregel_id`), aber `funktionsjubilaeum_zaehlweise = je_funktion`. Zwei Ämter mit je 10 Jahren (Anna Huber: ÜL seit 1998, AL seit 2011) treffen dieselbe Regel → Verstoß gegen die Eindeutigkeit. Vorschlag V2. |
| X2 | **`Gesamtbeitrag` verwerfen vs. Zahler-Heuristik** | Übergabe §6: `Gesamtbeitrag` und `Betrag`-Spalten verwerfen. Dieselbe Heuristik braucht aber „Zahler trägt Pauschalbetrag / Abhängiger hat eigenen Beitrag“. `Daten16` hat **keine Beitragsart-Spalte**, also stecken diese Informationen nur in `Gesamtbeitrag`/`Betrag 1`. Diese Spalten werden für die Migration **gelesen**, aber nicht übernommen. |
| X3 | **Mandat fehlt in `Daten16`** | Es gibt keine Spalten für Mandatsreferenz und Mandatsdatum, das Datenmodell verlangt beide bei Lastschrift. Woher nimmt der heutige Access-Export sie? Bildet er die Referenz aus der Mitgliedsnummer (Muster `TSV-<Jahr>-<Nr>`)? **Kritisch:** Ändert sich die Referenz, ist das rechtlich ein neues Mandat (FRST bzw. neue Unterschrift). Die Migration muss die heutige Referenz exakt reproduzieren. |
| X4 | **Doppelte Konfiguration FZ-Löschfrist** | `Qualifikationsart.loeschfrist_monate = 3` **und** `Aufbewahrungsfrist` Zeile 4 = 3 Monate. Dazu `_Konfig.fz_wiedervorlage_monate` **und** `Qualifikationsart.wiedervorlage_monate`. Welche Quelle gilt? Vorschlag: `Qualifikationsart` gewinnt, die anderen sind Fallback. Das wird im Code dokumentiert. **[E]** |
| X5 | **Klartext-IBAN im Protokoll** | `_Protokoll.alt_wert`: „Bei IBAN und Mandat immer mitschreiben“. Damit ist `_Protokoll` selbst ein Finanzdaten-Tab. Folge: Protokollansicht rollengefiltert, Einträge zu `Beitragskonto`/`Sollstellung`/`Qualifikation` nur für berechtigte Rollen. Bereinigung nach `Aufbewahrungsfrist` Zeile 5. Kein Widerspruch im engeren Sinn, aber eine sicherheitsrelevante Folge. |
| X6 | **Aufnahmeanträge vs. Auftrag** | Auftrag: Aufnahmeanträge sind nicht Teil dieses Auftrags. Datenmodell: Tab `Aufnahmeantrag`, `_Konfig.antrag_*` (Datei-ID, Drive-Ordner, stündlicher Abruf, E-Mail-Bestätigung). Abruf und Drive-Ordner brauchen **Drive- und Mail-Scopes**. Vorschlag: Setup legt den Tab an, Logik folgt später, und die Scopes kommen erst mit diesem Modul. |
| X7 | **Backup braucht Drive-Scope** | Lies-mich + C3: monatliche Kopie in einen Ordner. `makeCopy` in einen Ordner geht nicht mit dem Scope `spreadsheets` allein **[A]**. Vorschlag: Backup als **eigenes, nicht deploytes Skriptprojekt** des Funktionskontos mit Drive-Scope, nur per Trigger. Die WebApp bleibt bei minimalen Scopes. **[E]** |
| X8 | **BLSV-Altersklassen fest im Schema** | `Statistik_Jahr` hat feste Spalten `alter_bis_14 … alter_ab_27`. Das passt nicht zu „Konfiguration als Daten“. Ändert der BLSV die Klassen, braucht es neue Spalten. Vertretbar, weil eingefrorene Altjahre ihre Klassen behalten sollen. Nur zur Kenntnis. |
| X9 | **Anonymisierte Zeile behält `mitgliedsnummer`** | Beispiel Mitglied 14: Name weg, Nummer 1176 bleibt. Über alte Papierlisten bleibt die Person damit zuordenbar. Lies-mich: „Restmerkmale mit überschreiben“. Vorschlag: Nummer bleibt (Anker für Buchungen), wird aber für Rollen ohne Finanzrecht ausgeblendet. **[E]** |
| X10 | Sterbefall → `Mitgliedschaftszeitraum.austrittsdatum` gesetzt | Beispiel Steinberger: `austrittsdatum = Sterbedatum`, Grund „verstorben“. Laut Übergabe hat `sterbedatum` Vorrang beim Status. Beides konsistent zu halten ist eine Prüfregel. Ich setze das Austrittsdatum beim Erfassen des Sterbedatums automatisch, nur zur Bestätigung. |

---

## 4. Lücken und Annahmen

**Fachlich**
- L1 **Jugend-Definition** für die Jugendleiter-Sicht fehlt weiterhin. Vorschlag: `_Konfig.jugend_bis_alter = 17` (also minderjährig), passend zu `Beitragsart` „Jugendliche bis 18“ mit `alter_bis = 17`. **[E]**
- L5 **Vier-Augen-Prinzip beim SEPA-Lauf** (Mockup Frage 7). Phase 4, bis dahin offen.
- L6 **IBAN-Anzeige:** maskiert, Klartext per Klick, wird protokolliert (Vorschlag).
- L7 **Benutzer mit mehreren Rollen oder Abteilungen** (z. B. AL Turnen + Jugendleiter): Siehe V3.
- L8 **Externe Trainer ohne Mitgliedschaft:** Siehe V6.
- L9 **BLSV-Importformat** für verein360: Die Klassen in `Statistik_Jahr` übernehme ich. Die genaue Spaltenstruktur der Importdatei kenne ich nicht. **[?]** Bitte bis Phase 5 die aktuelle Vorlage (Kopfzeile genügt).
- L11/L12 SEPA: Für 2026 erledigt. Für Phase 4 gilt weiter: Hausbank zu Format und Adresspflicht fragen. **[A]** Die Schuldneradresse ist nur bei Zahlern außerhalb des EWR Pflicht.
- L14 Darf das XSD pain.008.001.08 ins Repo (für Tests mit `xmllint`)? **[E]**, eilt nicht.

**Apps Script (alles [?] bis gemessen)**: unverändert gegenüber Fassung 1:
- CacheService: 100 KB je Wert, 6 h maximal, Gesamtgrenze unbekannt, Einträge können vorzeitig verfallen.
- PropertiesService: ca. 9 KB je Wert, 500 KB gesamt.
- Laufzeit 6 min je Ausführung, Trigger-Kontingent bitte für Nonprofits prüfen.
- HtmlOutput-Maximalgröße und Zahl paralleler Ausführungen weiß ich nicht.
- Die Overhead-Werte aus dem Auftrag sind Annahmen. Phase 1 liefert Messwerte.

---

## 5. Verbesserungsvorschläge zum Datenmodell

Jeder Punkt ist **[E]**. Ohne Antwort setze ich die Empfehlung um.

| # | Vorschlag | Warum | Aufwand/Risiko |
|---|---|---|---|
| V1 | **`version` (Ganzzahl) + `geaendert_am` + `geaendert_von` an allen bearbeitbaren Tabs** (bisher nur `geaendert_*` an `Mitglied`) | Optimistische Sperre gegen veraltete Überschreibungen (Auftragspunkt 4). `geaendert_am` als Datum ist dafür unzuverlässig (Formatwandlung, gleiche Sekunde). | 3 Spalten je Tab, nur vom Skript beschrieben |
| V2 | `Ehrung` eindeutig je (`mitglied_id`, `ehrungsregel_id`, `funktion_id`) | löst X1 | keine neue Spalte |
| V3 | **`Benutzer`: eine Zeile je Rollenzuweisung** (dieselbe E-Mail darf mehrfach vorkommen, z. B. AL Fußball + AL Turnen oder AL + Jugendleiter). Rechte = Vereinigung aller aktiven Zeilen. | löst L7 ohne Komma-Listen in Zellen | `benutzer_id` bleibt PK. Eindeutig ist dann (email, rolle, abteilung_id). |
| V4 | **„halbjährlich“ aus `_Enums.intervall` streichen**, solange es beim Verein nicht vorkommt. Alternativ eine Spalte `periode` (1/2) in `Sollstellung` und in die Eindeutigkeit aufnehmen. | löst W10. Halbjährlich verdoppelt SEPA-Läufe und Mahnlogik. | Streichen kostet nichts, `periode` später nachrüstbar |
| V5 | **Rollenmatrix als Code, Rollenzuweisung als Daten.** Welche Rolle welche Felder und Aktionen hat, steht versioniert in `lib/rechte.js`. Wer welche Rolle hat, steht in `Benutzer`. | Rechteänderungen sind sicherheitskritisch und sollen über Git + Review laufen, nicht über eine Zelle (A8). Das ist eine bewusste Ausnahme von „nichts hardcoden“. | Alternative `_Rechte`-Tab: flexibler, aber ein Tippfehler öffnet Daten, und kein Review. |
| V6 | `Mitglied.nur_funktionstraeger` (ja/nein) | externe Trainer mit FZ-Pflicht ohne Mitgliedschaft (Mockup Frage 4). Ausgenommen von der Prüfregel „mind. ein Mitgliedschaftszeitraum“, zählt nicht für BLSV und Beitrag. | 1 Spalte |
| V7 | `_Feldkatalog` um Spalte **`sichtklasse`** ergänzen (`intern` / `kontakt` / `finanz` / `hochsensibel` / `technisch`) | Feldschnitt je Rolle datengetrieben aus einer Quelle. Heute steht die Sensibilität nur je Tab bzw. als Freitext („SENSIBEL.“) | Pflege einer Spalte |
| V8 | `Abteilungszugehoerigkeit` ohne Status für Abt. 2–4 aus der Migration: `status` bekommt Default „aktiv“, die Prüfliste meldet diese Fälle | `Daten16` kennt nur `Status Abteilung 1` | – |
| V9 | `_Messung` (technisch): `zeit`, `funktion`, `dauer_ms`, `sheets_aufrufe`, `cache`, `rolle`, `client_ms` | Messbarkeit (Auftragspunkt 8) | eigener Tab, Löschfrist z. B. 3 Monate in `Aufbewahrungsfrist` |
| V10 | Zugang folgt dem Amt: **keine** Automatik, aber eine Warnliste „aktiver Benutzer ohne laufende passende Funktion“ | Mockup Frage 12. Eine automatische Rechtevergabe aus einem Datenfeld hätte dieselbe Schwäche wie V5-Alternative. | reine Ansicht |

---

## 5b. Migration `Daten16` → Tabs

### Spalten (laut Screenshot) und Ziel

| `Daten16` | Ziel | Regel |
|---|---|---|
| `ID` | `Mitglied.mitglied_id` | übernehmen (Übergabe §6); `_Konfig.next_id_Mitglied` = max + 1 |
| `MitglNr` | `mitgliedsnummer` | **als Text**, führende Nullen erhalten (`0873`) |
| `Anrede`, `Titel`, `Vorname`, `Nachname` | gleichnamig | Anrede auf Enum normalisieren; Briefanrede aus Anrede + Nachname erzeugen **[E: oder leer lassen?]** |
| `Strasse` | `strasse` + `hausnummer` | **Aufteilung per Regel** (letztes Token mit Ziffer, inkl. „12a“, „12-14“, „12 1/2“). Was nicht passt, kommt auf die Prüfliste. |
| `Plz`, `Ort` | `plz` (Text, 5-stellig mit Nullen), `ort`; `land = DE` | ausländische PLZ → Prüfliste |
| `GebDat` | `geburtsdatum` | |
| `Geschlecht` | `geschlecht` (m/w/d) | Werte normalisieren; leer → Prüfliste (BLSV) |
| `Telefon`, `Handy`, `email` | gleichnamig | Text, keine Normalisierung außer trim |
| `EinDat`, `AusDat` | `Mitgliedschaftszeitraum` (eine Zeile) | `AusDat` gesetzt → Status ausgetreten. `AustritteAb2010` → weitere Zeitraum-Zeilen (Spalten unbekannt, M6). |
| `Abteilung 1–4`, `Status Abteilung 1` | `Abteilungszugehoerigkeit` | Abteilungsname → `abteilung_id` über eine Zuordnungstabelle; Status nur für Abt. 1 (V8) |
| `IBAN`, `BIC`, `Kontoinhaber`, `BANK` | `Beitragskonto` | über `Zahler`-Cluster zusammenfassen (siehe unten); `BANK` verwerfen **[A]** (aus BIC ableitbar) |
| `Zahler` | Cluster → `beitragskonto_id`, ggf. `beitragsgemeinschaft_id` | Heuristik Übergabe §6 |
| `Gesamtbeitrag`, `Betrag 1–4`, `Beitrag Abt 2–4` | **nur gelesen** | Grundlage für Beitragsart und Pauschalerkennung (X2), nicht übernommen |
| `Zahlung` | `Sollstellung` (laufendes Jahr) | `NG` → `ruecklastschrift`, sonstige Werte siehe M3 |
| `Bemerkung` | `bemerkung` | wörtlich |
| `Arbeitsdatum` | `geaendert_am` | `geaendert_von = "Migration"` |
| `ReZiff`, `BLZ`, `KONTO` | verwerfen | laut Übergabe |

### Zahler-Cluster (Kern der Prüfliste)
1. Cluster = Menge aller Mitglieder mit gleichem `Zahler`-Wert (bzw. Zahler = eigene ID).
2. Je Cluster ein `Beitragskonto` (Inhaber = Zahler). Unterscheiden sich IBANs innerhalb eines Clusters → **Prüfliste** (kein Raten).
3. Gemeinschaft, wenn: Der Zahler trägt einen Betrag aus der Liste „Pauschalbeträge“ (`_Konfig` bzw. Migrations-Parameter) und die Abhängigen haben `Gesamtbeitrag` 0/leer.
4. Nur gemeinsames Konto, wenn: Die Abhängigen haben einen eigenen Beitrag (Fall Felix).
5. **Mischfall** → Prüfliste: Pauschale **und** Abhängige mit eigenem Beitrag, aber nicht eindeutig zuordenbar; Zahler ausgetreten oder verstorben; Zahler-Verweis zeigt ins Leere; Beitrag passt zu keiner Beitragsart.
6. Beitragsart: `Gesamtbeitrag` des Einzelzahlers → Beitragsart mit gleichem Betrag; mehrdeutig/kein Treffer → Prüfliste.

### Rückfragen zu `Daten16` (für Phase 2, blockieren Phase 1 nicht)
- M1 **Format von `Zahler`:** ID, MitglNr oder Name? Leer bei Selbstzahlern?
- M2 **Mandatsreferenz/-datum** (X3): Woraus erzeugt Access sie heute?
- M3 **Werte von `Zahlung`** außer `NG`? Für welches Jahr gilt das Feld?
- M4 **`Abteilung n`:** Klartext oder Code? Gibt es eine Zuordnungstabelle?
- M5 **`Status Abteilung 1`:** Werte? Gilt er faktisch für die Person (W8)?
- M6 **`AustritteAb2010`:** Spaltenliste, Bezug über `ID` oder `MitglNr`?
- M7 **Was ist der Tab `Personalien`** im Access-Screenshot: Formular, Abfrage oder zweite Tabelle mit Daten (z. B. Sterbedatum, Ehrenmitglied, Versandart, Mandat)? Viele Felder des Datenmodells (`versandart`, `ehrenmitglied`, `sterbedatum`, `adresse_ungueltig`) fehlen in `Daten16`.
- M8 **Pauschalbeträge:** Welche Beträge waren Familien- bzw. Ehegattenpauschalen (für Regel 3)?

Migrationsweg (Empfehlung): **Node-CLI lokal** liest einen CSV-Export von `Daten16` und schreibt je Tab eine CSV plus `Pruefbericht.html`. Die Echtdaten bleiben auf deinem Rechner, die Logik steht in `lib/migration.js` und ist mit synthetischen Daten getestet. Alternative: dieselbe Lib in Apps Script gegen einen Import-Tab (bequemer, aber dann liegen die Rohdaten in Google). **[E]**

---

## 6. Performance-Architektur

### 6.1 Grundsatz
Bei ~1.200 Mitgliedern sind die Datenmengen klein (geschätzt **[A]**: 300–600 KB JSON für den vollen Snapshot). Der Engpass sind Round-Trips und Sheets-Aufrufe, nicht die Rechenzeit. Deshalb gilt: **wenige, gebündelte Aufrufe, Arbeit im Browser.** Den Vorschlag aus dem Auftrag halte ich im Kern für richtig. Unten bewerte ich jeden Punkt mit Alternativen.

### 6.2 Datenfluss (Empfehlung)

```
Sheets ──(1 batchGet über alle nicht sensiblen Tabs)──► Basis-Snapshot (voll, nur serverseitig)
                                                          │  in CacheService, gzip+Chunks
Anfrage ─► Rolle ermitteln ─► Rollen-Schnitt (Zeilen+Felder, rein, in Node testbar) ─► Client
                                  ▲
Schreiben ─► Lock ─► Versionsprüfung ─► Zeile schreiben ─► Basis-Snapshot patchen ─► Antwort mit Datensatz
```

**Kernentscheidung:** Gecacht wird **ein** voller Basis-Snapshot, nicht ein Snapshot je Rolle. Den Rollen-Schnitt rechnet der Server bei jeder Anfrage neu. Bei 1.200 Zeilen dauert das im Speicher wenige Millisekunden **[A]**. Vorteile: Ein Schreibvorgang muss nur einen Cache-Eintrag aktualisieren, und es gibt keine Gefahr, dass ein Abteilungs-Snapshot veraltet. Der Basis-Snapshot verlässt den Server nie. Sensible Tabs (`Beitragskonto`, `Sollstellung`, `Qualifikation`, `Benutzer`, `Betroffenenanfrage`, `_Protokoll`) sind **nicht** im Basis-Snapshot. Ebenso fehlen Zeilen mit `verarbeitung_eingeschraenkt = ja`, denn gesperrte Sätze erscheinen laut Datenmodell in keiner Liste. Die Sicherheitsregel gilt damit doppelt: Was nicht geladen wird, kann nicht durchrutschen.

Ausnahme: Kassier und Admin brauchen Konto-Übersichten. Dafür gibt es einen **eigenen** Finanz-Snapshot (Konten ohne IBAN-Klartext, Sollstellungen), den nur diese Rollen laden und der getrennt gecacht wird.

### 6.3 Bewertung der Auftragspunkte

| # | Vorschlag | Bewertung | Empfehlung |
|---|---|---|---|
| 1 | Einmal laden, lokal arbeiten; Einbettung in `doGet` | Spart einen Round-Trip (meist der teuerste, weil kalt). Risiko: `doGet` wird langsamer, bis das erste Byte kommt, und die Seite bleibt weiß. | **Ja, mit Einbettung.** Alternative: leere Hülle plus ein Aufruf `ladeStart()`. Zeigt schneller ein Gerüst, kostet aber +1 Round-Trip. Beide Varianten baue ich schaltbar (`_Konfig.snapshot_einbetten`), damit wir in Produktion messen statt raten. |
| 2 | Write-through in CacheService, Chunking, Rebuild per `batchGet` | Richtig. `batchGet` (Advanced Service Sheets) braucht **denselben** Scope `spreadsheets` wie `SpreadsheetApp`, weitet also nichts auf **[A, im Manifest prüfen]**. Gzip über `Utilities.gzip` + Base64 verkleinert den Snapshot geschätzt um Faktor 4–8 **[A]**, also auf 1–2 Chunks statt 6. | **Ja.** Schlüssel mit Generationszähler (`snap:v17:0..n`), damit Leser nie eine halb geschriebene Chunk-Mischung bekommen. Der Generationszähler liegt ebenfalls im Cache. Fehlt ein Chunk, wird neu gebaut. |
| 2b | Weitere Persistenzschicht? | Optionen: **(a)** keine, Rebuild aus Sheets (geschätzt 1–2 s **[?]**); **(b)** Tab `_Snapshot` mit JSON-Chunks in Zellen (max. 50.000 Zeichen je Zelle), ohne neuen Scope; **(c)** Drive-Datei, braucht den Drive-Scope, verworfen. | **(a)**. (b) nur, wenn Messungen zeigen, dass der kalte Rebuild über 4 s liegt. (b) ist eine zweite Kopie, die veralten kann, und das ist bei einem nicht technischen Nachfolger ein Risiko. |
| 3 | Schreibaufrufe liefern den Datensatz zurück | Klar richtig. | **Ja.** Antwortformat einheitlich: `{ok, daten, version, messung}`. |
| 4 | Optimistische Konsistenz über `geaendert_am` | `geaendert_am` hat Formatierungs- und Zeitzonentücken (Sheets wandelt Datumswerte). | **Spalte `version` (Ganzzahl)**, +1 je Schreibvorgang; `geaendert_am` bleibt als Info. Das Datenmodell hat sie noch nicht (V1). Bei Konflikt gibt der Server den aktuellen Stand zurück, und der Client zeigt „wurde inzwischen geändert“. **[E]** |
| 5 | Sensible Felder einzeln nachladen und protokollieren | Richtig, kostet aber pro Datensatz einen Round-Trip. | **Ja.** Für die Kassier-Massenansicht gibt es maskierte Werte im Finanz-Snapshot, den Klartext nur einzeln. |
| 6 | Virtualisieren/Paginieren | 1.200 Zeilen im DOM sind auf alten Handys spürbar **[A]**. | **Einfaches Paginieren/„mehr laden“ (50er-Blöcke)**. Echte Virtualisierung ist mehr Code für den Nachfolger und lohnt sich hier nicht. |
| 7 | Warmhalte-Trigger | Hält den **Cache** warm. Ob er auch die **Laufzeitumgebung** (Kaltstart) für Webapp-Aufrufe warm hält, **weiß ich nicht**. Trigger-Laufzeit zählt aufs Tageskontingent. | **Optional, aus per Default.** Trigger alle 5 h baut den Snapshot neu, ca. 5 Läufe × 2 s pro Tag, vernachlässigbar. Ob es den Kaltstart verbessert, messen wir in Produktion. |
| 8 | Messbarkeit | Pflicht, siehe 6.8 | **Ja.** |

### 6.4 Schreibpfad im Detail
1. Rolle prüfen, Eingaben validieren (reine Funktion).
2. `LockService.getScriptLock().waitLock(…)`. Bei Timeout kommt eine generische Meldung „Bitte erneut versuchen“.
3. Zeilenposition finden: **eine** Lesung der ID-Spalte des Ziel-Tabs (IDs nie über Zeilenposition, Übergabe Abschnitt 7).
4. Versionsprüfung gegen die Zeile, Zeile schreiben (ein `setValues`), Protokolleintrag (ein `appendRow`), ID-Zähler in `_Konfig`, falls neu.
5. Basis-Snapshot im Cache patchen (lesen → ändern → schreiben, **innerhalb** des Locks), Generationszähler +1.
6. Lock freigeben, rollenbeschnittenen Datensatz zurückgeben.

Erwartung **[A]**: 4–6 Sheets-Aufrufe, Ziel ≤ 1,5 s ist realistisch.

Alternative: das Append-only-Journal (wie Schichtplan). Für Stammdaten-Bearbeitung halte ich es für unpassend: Man müsste den Zustand immer aus dem Journal zurückrechnen, und der Klartext-Fallback „Sheet lesen“ ginge verloren. Für `_Protokoll` ist es ohnehin das Muster.

### 6.5 Abteilungsleiter-Suche
Das Mockup verlangt: Ein AL darf ein **vereinsweites** Mitglied nur mit **exakter** Angabe (Mitgliedsnummer **oder** Nachname + Geburtsdatum) finden, höchstens ein Treffer. Das läuft **serverseitig** gegen den Basis-Snapshot und wird protokolliert. Im AL-Snapshot sind fremde Mitglieder nicht enthalten.

### 6.6 Client
- Vanilla JS, eine `index.html` plus Include-Dateien (`<?!= include('…') ?>`), Systemschriften, keine CDNs.
- Lokaler Index (normalisierte Suchstrings, Umlaute gefaltet). Ziel < 100 ms ist bei 1.200 Zeilen problemlos **[A]**.
- Ein Wrapper `rufe(fn, …args)` um `google.script.run` misst die Zeit, sammelt sie und zeigt sie im Admin-Bereich.
- Fußzeile mit Impressum und Datenschutz (D1).

### 6.7 Schichtung im Server
```
Einstieg (doGet, öffentliche API-Funktionen)  ← nur hier google.script.run-Ziele
   └ Guard: rolle = pruefeZugriff(aktion)      ← jede API-Funktion, ohne Ausnahme
       └ Fachmodule (Mitglied, Beitrag, SEPA, Ehrung …)  ← reine Logik in lib/, testbar
           └ Datenzugriff (DAL): lesen/schreiben/batch, zählt Sheets-Aufrufe
               └ Sheets
```
Konvention: Nur Funktionen **ohne** abschließenden Unterstrich sind vom Client aufrufbar. Apps Script macht Funktionen mit `_` am Ende für `google.script.run` unsichtbar. Alles Interne endet auf `_`. Damit ist auch die Angriffsfläche aus der Browser-Konsole klar umrissen.

### 6.8 Messung
- Der Server misst je API-Aufruf: Dauer, Zahl der Sheets-Aufrufe (Zähler in der DAL), Cache-Treffer. Der Wert geht **mit der Antwort** zurück (kostet nichts) und kommt in einen Ringpuffer im Cache.
- Ein stündlicher Trigger, sofern freigegeben, schreibt den Ringpuffer gesammelt nach `_Messung`. So entsteht kein Schreibzugriff pro Nutzeraktion. Nachteil: Bei Cache-Verfall gehen Messwerte verloren, das ist akzeptabel.
- Der Admin-Bereich zeigt Median und P90 je Funktion, Client- und Serverzeit nebeneinander. Die Differenz entspricht dem Round-Trip-Overhead, und so ersetzen wir die Annahmen aus Abschnitt 4 durch Messwerte.

---
 Entscheidungen (Übergabe Abschnitt 9) – je ein Vorschlag

---

## 7. Offene Entscheidungen (Übergabe Abschnitt 9)

Die Werte stehen bereits als Konfiguration im Datenmodell. Ich übernehme die Defaults des Datenmodells und nenne meinen Vorschlag, wo er abweicht.

| # | Frage | Default Datenmodell | Mein Vorschlag |
|---|---|---|---|
| O1 | Ehrungsjahre | `ehrung_zaehlweise = letzter_eintritt` | Default übernehmen. Die Ehrungsliste zeigt bei Wiedereintritten **beide** Werte (Bauer: 40 / 51), damit der Vorstand im Einzelfall entscheiden kann. |
| O2 | Stichtag | `ehrung_stichtag = kalenderjahr` | übernehmen |
| O3 | Ehrungsstufen | Seeds 25/40/50/60 · 70–90 · 10/20/25, als BEISPIEL markiert | übernehmen. Ergänzung Geburtstag 95/100 und Mitgliedsjubiläum 70 als **inaktive** Seeds |
| O3b | Funktionsjubiläum | `funktionsjubilaeum_zaehlweise = je_funktion` | übernehmen, mit V2 |
| O4 | Rollenmatrix | Rollen-Enum: Vorstand, Mitgliederverwalter, Kassier, Abteilungsleiter, Jugendleiter | siehe Tabelle unten (V5: Matrix im Code) |
| O5 | Gesetzliche Vertreter | Felder am Mitglied (`vertreter_mitglied_id`, `vertreter_name`, `vertreter_kontakt`) | **Datenmodell übernehmen**, weil es einfach ist und keinen Tab mehr braucht. Grenze: nur **eine** Vertretung. Brauchen beide Eltern Kontakt, wäre ein eigener Tab `Vertretung` (n Zeilen je Mitglied) die Erweiterung. Mit dem 18. Geburtstag kommen die Felder auf die Bereinigungsliste. |

**Vorschlag Rollenmatrix (O4, W3–W5)**

| Rolle | Zeilen | Kontakt | Finanzen | FZ/Quali | Ändern |
|---|---|---|---|---|---|
| Vorstand | alle | ✔ | ✔ (lesen) | ✔ | Benutzer, `_Konfig`, Freigaben; sonst lesend **[E]** |
| Mitgliederverwalter (Admin) | alle | ✔ | ✔ | ✔ | alles inkl. IBAN/Mandat, Benutzer (Datenmodell/Mockup-Variante) |
| Kassier | alle | ✔ | ✔ | – | Sollstellung, Mahnung, SEPA-Lauf; **keine** IBAN-Änderung |
| Jugendleiter | Minderjährige (L1) + Funktionsträger mit FZ-Pflicht | ✔ | – | ✔ | Qualifikation |
| Abteilungsleiter | eigene Abteilung(en) | ✔ | – | Ampel + Ablaufdatum (AL-Mockup Variante c) | Zugehörigkeit, Funktion der eigenen Abteilung; FZ-Einsicht **erfassen** nur, wenn W5 = ja; **kein** Vereinsaustritt |

`_Protokoll` sehen nur Vorstand und MV vollständig. Kassier sieht die Einträge zu Konten und Sollstellungen, AL nur die Einträge zur eigenen Abteilung (X5).

---

## 8. Repo-Struktur und Teststrategie

```
/
├─ package.json            npm run check | test | push   (keine Laufzeit-Abhängigkeiten)
├─ .clasp.json.beispiel    Vorlage; echte .clasp.json nicht im Repo
├─ .claspignore
├─ docs/                   Ausgangsdokumente (inkl. xlsx), Konzept, Register C6, VVT D2, Betrieb, SEPA-Update-Prozedur
├─ src/
│  ├─ appsscript.json      Scopes [A]: spreadsheets, userinfo.email, script.scriptapp (Trigger); Advanced Service Sheets
│  ├─ Einstieg.js          doGet, include, öffentliche API-Funktionen (dünn)
│  ├─ Rechte.js            Rollenermittlung, Guard
│  ├─ Datenzugriff.js      DAL: lesen/schreiben/batch, Zähler, Lock, ID-Vergabe, version
│  ├─ Cache.js  Protokoll.js  Messung.js  Fehler.js  Setup.js
│  ├─ modul/               Mitglied.js Funktion.js Beitrag.js Sepa.js Ehrung.js Blsv.js Datenschutz.js
│  ├─ lib/                 REINE Funktionen: schema.js rechte.js rollenfilter.js beitrag.js sepa.js iban.js
│  │                       ehrung.js blsv.js loeschung.js migration.js adresse.js validierung.js
│  └─ client/              index.html, stil.html, app.html, client-logik.html
├─ tools/
│  ├─ check.js             Syntaxprüfung (s. u.)
│  ├─ migration-lokal.js   Daten16-CSV → Tab-CSVs + Prüfbericht
│  └─ feldkatalog.csv      Export von _Feldkatalog; Test prüft schema.js dagegen
└─ test/                   node:test, synthetische Daten in test/daten/
```

- **Reine Funktionen** in `lib/` sind normale Apps-Script-Dateien mit `if (typeof module !== 'undefined') module.exports = …` am Ende. Es gibt keinen Build-Schritt, der Code im Repo ist der Code im Editor.
- **`npm run check`:** (1) `vm.Script` je Datei; (2) alle Server-Dateien **gemeinsam** in einem Kontext (Apps Script hat einen globalen Namensraum, doppelte Top-Level-Namen fallen sonst erst in Google auf); (3) `<script>`-Blöcke aus `client/*.html` extrahieren und prüfen.
- **`npm run push`** = check + test + `clasp push`.
- **Tests** (`node --test`, keine Abhängigkeiten):
  - Beitragsberechnung, Pflichtfall Wagner = 280 €
  - Rollenfilter als Negativtests (AL sieht nie Fremdabteilung, Finanzfelder oder gesperrte Sätze)
  - Prüfregeln aus dem Lies-mich (alle zehn als Tests)
  - Ehrungsableitung (Nachholung, keine Doppelehrung, `je_funktion`)
  - FZ-Löschfrist ab der **letzten** nachweispflichtigen Funktion
  - Adress-Aufteilung
  - Zahler-Cluster inklusive aller Mischfälle
  - später SEPA (XSD, FRST/RCUR, `CtrlSum`)
- **Synthetische Testdaten:** ein Generator (fester Zufalls-Seed) erzeugt ein `Daten16`-CSV mit ~1.200 Zeilen und bewusst eingebauten Mischfällen. Er dient für Migrationstests und als Lastprobe für den Snapshot. Die Beispielzeilen aus dem xlsx (Wagner, Bauer …) kommen als feste Fälle dazu.
- **Apps-Script-Teile** (DAL, Cache, Lock) teste ich in Node mit kleinen Fakes. Echtes Verhalten prüfst du in Google (Abschnitt 10).

---

## 9. Meilensteinplan

| MS | Inhalt | Abnahme |
|---|---|---|
| 1 Fundament | `schema.js` aus `_Feldkatalog` (+ V1/V6/V9), Setup (Tabs, Kopfzeilen, Datenprüfung aus `_Enums`, Seeds der Stammdaten-Tabs), DAL, ID-Vergabe, `Benutzer`/Rechte, `_Protokoll`, Fehler, Messung, UI-Skelett mit Login-Prüfung und Admin-Messansicht | check + Tests grün; E: Scopes, Fehler generisch, Audit, Kopfkommentare |
| 2 Migration | `lib/migration.js`, CLI, Prüfbericht, Testdaten-Generator | Prüfbericht über synthetische Daten, alle Mischfälle erkannt |
| 3 Snapshot + Mitglieder | Cache, Rollenschnitt, Liste/Detail/Bearbeiten je Rolle, Funktionen, Zugehörigkeiten, Austritt mit Waisen-Guard, AL-Exaktsuche, Exporte mit Protokoll | Zielwerte im Test-Deployment gemessen, Mobiltest |
| 4 Beiträge | Konten, Gemeinschaften, Tarifwechsel, `Sollstellung`, Mahnstatus, SEPA pain.008.001.08 als eigenständige Funktion, Klärliste | Wagner-Fall, Probelauf gegen die 2026er Lösung abgeglichen |
| 5 Ehrungen / BLSV / DSGVO | Ehrungsableitung, BLSV-Export + `Statistik_Jahr` einfrieren, Qualifikation/FZ-Fristen, `Einwilligung`, `Betroffenenanfrage`, 3-Stufen-Löschung, Protokoll-Bereinigung | Go-Live-Checkliste vollständig |
| (separat) | Backup-Skript (X7), Aufnahmeanträge (X6) | eigene Projekte, nicht Teil dieses Auftrags |

Je Phase: Doku in `docs/` (Register C6, VVT D2) und eine Liste der manuellen Google-Prüfungen.

---

## 10. Was du schon jetzt in Google klären/prüfen solltest
- Funktionskonto als Eigentümer, Ablage in geteilter Ablage, Zugang mehrfach hinterlegt (C1).
- Ordnerfreigaben der künftigen DB-Datei: niemand außer dem Funktionskonto (A4).
- Quoten für Workspace for Nonprofits (Trigger-Laufzeit, gleichzeitige Ausführungen).

---

## 11. Was ich zur Freigabe brauche

**Für Phase 1 nötig:**
1. Architektur Abschnitt 6: ein Basis-Snapshot im Cache, Rollenschnitt pro Anfrage, Einbettung schaltbar, keine zweite Persistenzschicht bis zur Messung.
2. Verbesserungen V1–V10 (ganz oder einzeln).
3. Rollenmatrix (Abschnitt 7, W3–W5), Jugend-Definition (L1).
4. X4 (welche FZ-Frist gilt), X7 (Backup als eigenes Projekt).

**Für Phase 2, darf nachkommen:** M1–M8, Migrationsweg (lokal oder in Google).

Wo du nichts sagst, setze ich meinen Vorschlag um und markiere ihn im Code mit `// OFFEN: …`.
