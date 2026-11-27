# Code-Prüfung 10/2026 – Ist/Soll, Befunde, Datenmodell-Vorschlag

Stand: 29.10.2026, Branch `claude/elegant-thompson-chg4at`, Basis `33e1598`. Geprüft wurden Code und Tests,
ausdrücklich **nicht** produktive Sheets oder Echtdaten. Die beiden `.xlsx` unter `docs/` wurden nicht geöffnet.

**Sollbild:** Eine eigene Funktionsübersicht war dem Auftrag nicht beigefügt. Als Soll dienen deshalb:
- die Funktionstabelle in `README.md`,
- die Themenliste des Prüfauftrags,
- `docs/UEBERGABE_Mitgliederverwaltung_TSV.md` §3–§7.

**Prüfungen:**

| Stand | `npm run check` | `npm test` | `npm run test:ui` |
|---|---|---|---|
| vorher | ok | 293/293 | 51/51 |
| nach Abschnitt 5 | ok | 304/304 | 51/51 |
| nach Abschnitt 7 | ok | 312/312 | 51/51 |
| nach den übrigen 🔵-Punkten | ok | 323/323 | 51/51 |

## 1. Kurzurteil

Das Projekt ist **solide gebaut**.

**Was trägt:**
- **Rechte:** serverseitig erzwungen, jeder Einstieg läuft über `Api.ausfuehren` → `Zugriff.pruefe`, Feldrechte gelten auch beim Schreiben.
- **Sperren:** Schreibzugriffe laufen unter `LockService` mit Versionsprüfung.
- **Ableitung statt Speichern:** Status, „Mitglied seit“ und Beträge werden berechnet; das CSV-Schema wird erzeugt und deterministisch geprüft.
- **SEPA:** Die XML ist XSD-geprüft, ein doppelter Export ist geschützt.
- **Datenschutz:** IBAN nie im Snapshot/Cache; Formelschutz in CSV und Sheet.

**Schwachstellen:**
- **Fachliche Lücken in den Abläufen.** Regeln, die das Datenmodell nennt, sind nicht an jedem Schreibweg durchgesetzt. Abläufe können nach dem ersten Schreiben abbrechen.
- **Datenmodell ohne Zeitachse** bei Beitrag, Konto und Gemeinschaft, und nur eine Sollstellung je Konto und Jahr. Nachträge und Korrekturen sind damit nicht sauber abbildbar.

Die kleinen, eindeutigen Punkte sind behoben (Abschnitt 5). Alles mit Fach-, Rechts- oder Strukturwirkung steht als offene Entscheidung in Abschnitt 6.

## 2. Priorisierte Befunde

Legende: ✅ in dieser Prüfung behoben · 🟡 offen, Entscheidung nötig · 🔵 offen, kleine Korrektur möglich (nicht umgesetzt, weil sie Verhalten sichtbar ändert oder im Echtsystem zu verifizieren ist).

Zeilenangaben beziehen sich auf den Stand **nach** dieser Prüfung.

### Hoch

| # | Befund | Beleg | Stand |
|---|---|---|---|
| H1 | **Nachzügler auf einem Konto mit Sollstellung werden nie belastet.** `plane()` überspringt jedes Paar (Konto, Jahr), das schon existiert. Ein Mitglied, das später über ein bestehendes Konto dazukommt, erhöht den Betrag nicht. Die Klärliste meldet das nicht, `nachzuegler_ohne_sollstellung` zählt nur Konten ohne jede Sollstellung. | `src/lib/sollstellung.js:41`, `src/modul/Finanzen.js` (`sepaProbelauf`) | 🟡 Nachtrags-Sollstellung braucht eine Schemaänderung (Abschnitt 4) |
| H2 | **Sollstellung nicht korrigierbar.** Nach `storniert` plant `plane()` nichts mehr. Die Eindeutigkeit (Konto, Jahr) verhindert eine Neustellung, und `soll_betrag` ist über keine API änderbar. | `src/lib/sollstellung.js:41`, `docs/daten/tabellen.csv` (Sollstellung) | 🟡 |
| H3 | **Mehrfachrollen heben die Zeilengrenze auf.** Sichtklassen und Zeilensicht werden getrennt vereinigt. Beispiel Kassier + Abteilungsleiter: Er bekommt `hochsensibel` (vom AL) und Zeilen `alle` (vom Kassier) und sieht damit FZ- und Lizenzvermerke des ganzen Vereins. `pruefeAbteilung` lässt ihn außerdem in allen Abteilungen schreiben. | `src/lib/rechte.js:85,90`, `src/lib/snapshot.js` (`personenkreis`) | 🟡 Rechteänderung, Freigabe nötig. ✅ Warnung in der Benutzerverwaltung (`Rechte.mehrfachrollenWarnungen`) |
| H4 | **Beitritts-Import: Rücknahme bei Fehlern unvollständig.** Zurückgenommen werden nur eingefügte Zeilen. `aktualisiereViele` (Wiedereintritt: Status, Konto, Zugehörigkeit) und `Konfig.setze('mitgliedsnummer_naechste')` bleiben stehen, die Meldung lautet trotzdem „nichts gespeichert“. | `src/modul/Beitritt.js:211`, Rücknahme ab `:236` | ✅ Zähler, Änderungen und Einfügungen werden zurückgenommen, Cache verworfen |
| H5 | **Klartext-IBAN und Altwerte bleiben im `_Protokoll`.** Das gilt nach Anonymisierung und nach `kontoLeeren`. Die Bereinigung erfasst nur Zeilen der Tabelle Mitglied, Konto-Anlage und Konto-Änderung protokollieren die IBAN per `ausDiff`. Die Frist für IBANs beträgt 14 Monate, das Protokoll bleibt 36 Monate. | `src/lib/loeschung.js:259`, `src/modul/Finanzen.js` (`kontoSpeichern`), `src/modul/Datenschutz.js` (`kontoLeeren`) | 🟡 Löschkonzept betroffen, Freigabe nötig |
| ✅ | Bearbeiten-Formular umging „eine Gemeinschaft = ein Konto“ → Festbetrag doppelt | `src/modul/Mitglieder.js` (`speichern`, `gemeinschaftKontoFehler`) | ✅ |
| ✅ | Wiedereintritt brach nach dem Schreiben des Zeitraums ab (Abteilung ruht/unbekannt/zugeordnet) → beim zweiten Versuch zwei offene Zeiträume | `src/modul/Mitglieder.js` (`wiedereintritt`, `zugehoerigkeitPruefen`) | ✅ |
| ✅ | Beitritts-XML mit ungültigem Eintrittsdatum (`31.02.`) → Mitglied ohne Mitgliedschaftszeitraum | `src/modul/Beitritt.js` | ✅ |
| ✅ | SEPA-Datei mit `ReqdColltnDt` in der Vergangenheit möglich (gespeicherte Fälligkeit) | `src/lib/sepa.js` (`pruefeFuerDatei`), `src/modul/Finanzen.js` (`sepaXml`) | ✅ |

### Mittel

| # | Befund | Beleg | Stand |
|---|---|---|---|
| M1 | **Neues Mitglied mit Eintritt in der Zukunft erhält den Status „ausgetreten“.** Folge: Zuordnung zu Abteilungen und Exaktsuche scheitern bis zum Stichtag. Das Enum kennt keinen Zustand für „künftig“. | `src/lib/mitgliedschaft.js:76` | 🟡 |
| M2 | **FRST/RCUR hängt nur am Status `bezahlt`.** Fall 1: FRST mit Rücklastschrift, danach per Überweisung bezahlt → im Folgejahr RCUR. Fall 2: exportierte FRST noch nicht gebucht → wieder FRST. | `src/lib/sepa.js:69` | 🟡 laut ENTSCHEIDUNGEN noch vorläufig |
| M3 | **Teilzahlung setzt den Status `bezahlt`.** Der Rest wird nirgends offen geführt. | `src/lib/sollstellung.js:89` | 🟡 |
| M4 | **Mandatsänderungen.** Ein IBAN-Wechsel erzeugt kein `AmdmntInd`. Ein Inhaberwechsel erzwingt keine neue Referenz und kein neues Mandatsdatum. | `src/modul/Finanzen.js` (`kontoSpeichern`) | 🟡 mit Hausbank klären |
| M5 | **Mandatsreferenz mit Leerzeichen** ist in der DB eindeutig, in der Datei aber nicht. `kennung()` entfernt die Leerzeichen, deshalb weicht die Referenz vom unterschriebenen Mandat ab. | `src/lib/sepa.js` (`kennung`), Regex in `Finanzen.js` (`kontoPruefen`) | 🟡 Migrationsdaten erst prüfen |
| M6 | **Zahlweg-Hinweis zu Dritten in `Mitglied.bemerkung`.** Das Feld hat die Sichtklasse `kontakt` und ist damit für Abteilungs- und Jugendleiter lesbar. | `src/modul/Mitglieder.js` (Austritt, Option `zahlweg_offen`) | ✅ jetzt `Notiz` mit Leserkreis Finanzen und Kontobezug |
| M7 | **Wiedereintritt in eine Abteilung überschreibt die Historie.** Die Eindeutigkeit (Mitglied, Abteilung) zwingt dazu, die alte Zeile wieder zu öffnen. | `src/modul/Mitglieder.js:473`, `docs/daten/tabellen.csv` | 🟡 Struktur (Abschnitt 4) |
| M8 | **Beitragsart, Konto und Gemeinschaft hängen ohne Gültigkeit am Mitglied.** Die Historie wird nur aus `_Protokoll` rekonstruiert, und dort leert die Wartung `alt_wert`/`neu_wert` nach Frist. | `docs/daten/feldkatalog.csv` (Mitglied), `src/modul/Familie.js` (Bezahlhistorie) | 🟡 Struktur |
| M9 | **Zählweise „gesamt“: der letzte Tag beendeter Zeiträume fehlt.** Der Zeitraum 2000-01-01 bis 2009-12-31 ergibt 9 statt 10 Jahre. Der Test schreibt dieses Verhalten fest. | `src/lib/mitgliedschaft.js:110`, `test/mitgliedschaft.test.js` | 🟡 ändert Ehrungsergebnisse (nur Modus „gesamt“) |
| M10 | **Aufnahmeanträge fehlen im Löschkonzept.** Sie werden weder in Auskunft und Anonymisierung erfasst, noch nach der Frist „abgelehnt + 6 Monate“ gelöscht. Die Auskunft enthält außerdem keine Anschreiben, Dokumente oder Protokolleinträge. | `src/modul/Datenschutz.js` (`BASIS_TABS`), `src/lib/loeschung.js` (`auskunft`), `src/lib/startbelegung.js` | ✅ Auskunft und Anonymisierung (archivierte Anträge der Person, nicht fremde Dubletten-Hinweise). 🟡 offen: Löschfrist für abgelehnte Anträge (E12) und die getrennte Datei offener Anträge |
| M11 | **Berichte zeigen gesperrte und anonymisierte Personen.** `bewegungen` filtert Art. 18 nicht, `geburtstage` und `jubilaeen` tun es. | `src/modul/Berichte.js` (`bewegungen`, BLSV-Prüfliste, Nachmeldung) | ✅ ohne Namen, Nummer und ID für Rollen ohne `verwaltung`; Zählung bleibt |
| M12 | **Nachweise ändern oder löschen ohne Sichtprüfung.** Ein Abteilungsleiter kann einen Vermerk ändern, den der Snapshot ihm nicht zeigt; geprüft wird nur, ob die Person sichtbar ist. | `src/modul/Nachweise.js` (`aendern`, `loeschen`) | ✅ `Snapshot.pruefeZeile` mit der Snapshot-Regel |
| M13 | **Cache nach dem Schreiben aus Sheets-API neu gebaut.** `flush()` kommt erst beim Freigeben der Sperre, der Neubau sieht die Änderung womöglich nicht. | `src/Datenzugriff.js` (`leseVomSheet`) | ✅ `flush()` vor jedem Lesen über die Sheets-API in der Sperre; die Wirkung im Echtsystem ist noch nicht geprüft (die Fakes bilden den Puffer der Sheets-API nicht ab) |
| M14 | **Mehrere Dubletten beim Beitritt.** Es zählt immer `dubletten[0]`. Ohne Geburtsdatum passt jeder gleichnamige Eintrag. | `src/modul/Beitritt.js:90` | 🟡 |
| ✅ | FZ-Vermerk erschien nach dem Eintragen einer Funktion bis zur Nachtwartung als löschbar | `src/lib/fristen.js` (`loeschdatum`), `src/modul/Nachweise.js` | ✅ |
| ✅ | Mandatsverfall gegen „heute“ statt gegen das Einzugsdatum geprüft | `src/lib/sepa.js` (`laufIntern`) | ✅ |
| ✅ | `land` als Freitext („Österreich“) → `<Ctry>ÖS</Ctry>`, XSD-ungültig | `src/lib/sepa.js` (`landCode`), Klärliste `src/lib/beitrag.js` | ✅ |
| ✅ | Beitritt: Wiedereintritt einer verstorbenen Person möglich | `src/modul/Beitritt.js` | ✅ |
| ✅ | Anonymisierung ließ `Anschreiben.email_an` stehen | `src/lib/loeschung.js`, Fristbereinigung `src/modul/Korrespondenz.js` | ✅ |

### Niedrig

| Befund | Beleg | Stand |
|---|---|---|
| `neueId` übernimmt den Zähler ohne Abgleich mit dem Bestand. Bei von Hand eingefügten Zeilen entstehen doppelte IDs. | `src/Datenzugriff.js` (`neueId`, `hoechsteId`) | ✅ |
| Austritt rückwirkend vor dem Eintritt in eine Sparte bzw. vor Beginn einer Funktion ergibt `bis < von`. | `src/modul/Mitglieder.js` (`beendeLaufendes`) | ✅ Ende = Beginn |
| Prüfregeln fehlen für überlappende oder mehrere offene Zeiträume, Austritt vor Eintritt, `bis < von` und mehrere Fremdschlüssel. | `src/lib/pruefregeln.js` | ✅ `zeitraum_ueberlappung`, `datum_reihenfolge`, `funktion_doppelt`, Verweise in Zeitraum, Sollstellung, Konto, Benutzer und Notiz. Noch offen: Zugehörigkeit außerhalb eines Mitgliedschaftszeitraums |
| Fehler beim Schreiben in den Cache wird verschluckt, der alte Stand bleibt bis zu 6 h gültig. | `src/Cache.js` | ✅ alter Stand wird verworfen |
| `funktionEintragen` prüft keine Duplikate (Doppelklick ergibt doppelte Ehrung je `funktion_id`). | `src/modul/Mitglieder.js` | ✅ gleiche laufende Funktion (Art, Abteilung, Zusatz) wird abgelehnt |
| E-Mail-Eindeutigkeit im Tab Benutzer unterscheidet Groß- und Kleinschreibung. | `src/Datenzugriff.js` (`schluesselWert`), `src/lib/pruefregeln.js` | ✅ |
| Dublettenprüfung: NFD-Eingaben („Müller“ zerlegt) ergeben `muller` statt `mueller`. | `src/lib/migration.js`, `src/modul/Mitglieder.js` (`falte`); Prüfregel `dublette` nutzt jetzt dieselbe Faltung | ✅ |
| Migration liest `1985` als Seriennummer (→ 1905). | `src/lib/migration.js` (`datum`) | ✅ Fehler „nur Jahreszahl“ |
| CSV-Formelschutz ohne `\t`/`\r` am Zellanfang. | `src/client/kern.html` (`App.csv`), `src/lib/blsv.js` | ✅ |
| Konto-Notizen werden nie gelöscht. | `src/modul/Notizen.js`, `src/modul/Datenschutz.js` (`kontoLeeren`) | ✅ beim Konto-Leeren entfernt; erledigte zu geleerten oder fehlenden Konten in der Fristbereinigung |
| Rundung `runde(1.005) = 1` (Gleitkomma). Für ganze und halbe Euro unkritisch, die XML rechnet in Cent. | `src/lib/beitrag.js` | – |
| `tagImJahr('29.02.', 2026)` ergibt ein ungültiges Datum (nur bei falscher Konfiguration). | `src/lib/beitrag.js` | ✅ am Monatsende gekappt |
| Datumsfelder verschieben sich, wenn die Tabellen-Zeitzone von der Skript-Zeitzone abweicht. | `src/lib/werte.js`, `src/Setup.js` | ✅ Setup meldet die Abweichung (ändert die Datei nicht), `docs/BETRIEB.md` |
| ✅ Datenschutz-Felder ließen sich per Anlegen setzen | `src/modul/Mitglieder.js` (`anlegen`) | ✅ |
| ✅ Storno-Grund wurde bei langer Bemerkung abgeschnitten | `src/lib/sollstellung.js` | ✅ |
| ✅ Dokument-Link ohne `https`-Prüfung im Browser | `src/client/ansicht_korrespondenz.html` | ✅ |
| ✅ Ausbildungsangaben blieben bei der Anonymisierung stehen | `src/lib/loeschung.js` | ✅ |

**Ohne Befund geprüft:**
- **Einstieg und Rechte:** Einstiegspunkte, Mass Assignment, Abteilungsgrenze für einfache AL-Rollen.
- **IBAN:** Maskierung und Aufdeck-Protokoll.
- **Escaping:** Mail/HTML und Client (`textContent`).
- **Sollstellung und Export:** Idempotenz des Sollstellungslaufs, Schutz vor doppeltem Export (Modus `neu`), Kontrollsummen.
- **Prüfziffern:** IBAN und Gläubiger-ID.
- **Datum:** Datumsprüfung (31.02., Schaltjahr), `plusMonate` am Monatsende, Stichtagslogik `laeuft`.
- **Sperren:** Nummernvergabe unter Sperre.

## 3. Ist-/Soll-Matrix

Legende:
- **U** = umgesetzt und getestet
- **T** = teilweise
- **F** = fehlt
- **X** = Fehler (offen)
- **N** = nicht verifiziert (nur im Echtsystem prüfbar)

| Bereich | Soll | Ist | Beleg |
|---|---|---|---|
| **Person / Mitgliedschaft** | Eine Person, getrennte Zeiträume, Wiedereintritt mit gleicher Nummer | **U** | `src/lib/mitgliedschaft.js`, `test/mitgliedschaft.test.js`, `test/mitglieder.test.js` |
| | Status abgeleitet, Cache nachgezogen | **U** (Wartung) / **X** bei Eintritt in der Zukunft (M1) | `mitgliedschaft.js:76`, `src/modul/Wartung.js` |
| | Wiedereintritt atomar | **U** (seit dieser Prüfung) | `test/regression.test.js` |
| | Austritt mit Konto-Guard (Waisen) | **U** | `test/mitglieder.test.js` |
| **Abteilungen / Funktionen** | Zugehörigkeit mit Historie | **T**: Wiedereintritt in eine Sparte überschreibt (M7) | `Mitglieder.js:473` |
| | Funktionshistorie von/bis, nie gelöscht | **U** / Duplikate ungeprüft | `test/mitglieder.test.js` |
| | AL nur eigene Abteilung | **U** / **X** bei Mehrfachrollen (H3) | `rechte.js:85,90` |
| **Beitragskonto / Zahler / Gemeinschaft** | Konto ≠ Person, Gemeinschaft mit Festbetrag, ein Konto je Gemeinschaft | **U** (seit dieser Prüfung an allen Schreibwegen) | `beitrag.js`, `test/beitrag.test.js`, `test/regression.test.js` |
| | Zeitliche Zuordnung (wer zahlte wann über welches Konto) | **F**, nur über das Protokoll (M8) | `Familie.js` |
| **Tarife / Sollstellung** | Nachvollziehbarer Snapshot je Konto und Jahr | **T**: nur Betrag und Freitext, kein Tarif- oder Anteilbezug | `sollstellung.js` |
| | Idempotenter Lauf | **U** | `test/sollstellung.test.js` |
| | Nachträge, Korrekturen, mehrere Einzugstermine | **F** (H1, H2). Mehrere Termine je Jahr sind bewusst gestrichen (V4) | `ENTSCHEIDUNGEN.md` |
| | Halbjahresbeitrag | **U**: Doku-Abweichung, `ENTSCHEIDUNGEN.md` VBA3 nennt nur den Eintritt ab 01.07. | `beitrag.js:137-143`, `docs/daten/startbelegung/_Konfig.csv` |
| **SEPA** | pain.008.001.08, XSD-valide | **U** | `test/sepa.test.js` |
| | FRST/RCUR | **T** (M2) | `sepa.js:69` |
| | Mandatsverfall | **U** (seit dieser Prüfung zum Einzugsdatum) | `test/regression.test.js` |
| | Doppelter Export | **U** (Modus `neu`) | `Finanzen.js` (`sepaUmfang`) |
| | Einzugsdatum, Vorlauf, Bankarbeitstag | **T**: Vergangenheit gesperrt; Vorlauftage und TARGET-Kalender fehlen | `sepa.js` |
| | Rückmeldungen pain.002/camt | **F**, nur Buchung je Sollstellung von Hand | – |
| | Mandatsänderung (Amendment) | **F** (M4) | – |
| **Rücklastschrift / Zahlung / Mahnung** | Statusautomat mit Gebühren | **U** | `test/sollstellung.test.js` |
| | Teilzahlung | **X** (M3) | `sollstellung.js:89` |
| | Mahnregeln (Fristen, Höchststufe) | **F**, bewusst schlicht | – |
| | Storno statt Löschen | **U** | – |
| **Rollen / Feldrechte** | Matrix im Code, Feldrechte beim Lesen und Schreiben | **U** | `test/rechte.test.js`, `test/sicherheit.test.js` |
| | Mehrfachrollen | **X** (H3) | `rechte.js` |
| **IBAN** | Maskiert, Aufdecken protokolliert, nie im Cache | **U** | `test/finanzen.test.js` |
| | Klartext im Protokoll | **X** (H5) | `loeschung.js:259` |
| **Protokoll / Aufbewahrung** | Append-only, Bereinigung nach Frist | **U** | `test/wartung.test.js` |
| | Anonymisierung vollständig | **T**: Protokoll, Aufnahmeantrag und Konto-Notizen fehlen | `loeschung.js` |
| **Aufnahmeantrag** | Archivtab, Antragsbezug am Zeitraum | **T**: Löschfrist für abgelehnte Anträge nicht umgesetzt (M10) | `startbelegung.js` |
| **Beitritts-XML** | Vorschau, Dublette, Wiedereintritt, atomar | **T**: Rücknahme nach Updates unvollständig (H4), Dubletten (M14) | `test/beitritt.test.js`, `test/regression.test.js` |
| **Access-Migration** | Regeln, Prüfbericht, Zahler-Cluster | **U** / kleinere Parserlücken (N) | `test/migration.test.js` |
| **Dublettenprüfung** | Nachname + Geburtsdatum (Mitglieder), Name + Vorname (Beitritt) | **T**: NFD-Eingaben, kein Kriterium für Namensänderung | `migration.js` (`falte`) |
| **BLSV** | Bestand und Nachmeldung, CSV | **U** / Altersklassen [A] nicht gegen BLSV-Vorgabe verifiziert (**N**) | `test/blsv.test.js` |
| **Ehrungen** | Jahresliste, Nachholung, keine Doppelehrung | **U** / Modus „gesamt“ (M9) | `test/ehrung.test.js` |
| **Nachweise** | FZ nur Datum/Vermerk, Wiedervorlage, Löschfrist | **U** (seit dieser Prüfung frisch gerechnet) / Sichtprüfung beim Ändern (M12) | `test/fristen.test.js`, `test/regression.test.js` |
| **Betrieb** | Lock, Version, Cache, Messung, Backup | **U** / Cache-Neubau nach Schreiben **N** (M13) | `test/datenzugriff.test.js`, `test/cache.test.js` |

## 4. Empfohlenes Datenmodell (weiterhin Google Sheets)

Grundsätze:
- **Erhalten bleibt:** ein Tab je Entität, skriptvergebene IDs, `version`/`geaendert_*`, Eindeutigkeiten im Code.
- **Neu dazu:** Zeitachsen, wo heute flache Felder historisch gebraucht werden, und eine Trennung von Forderung, Einzug und Zahlung.

Alle Änderungen sind **Vorschläge**, sie verlangen eine Migration und eine Freigabe. Beiträge und Regeln werden nicht festgelegt.

```
Mitglied (Person) 1 ──< Mitgliedschaftszeitraum            (unverändert)
Mitglied 1 ──< Abteilungszugehoerigkeit                     NEU: eine Zeile je Zeitraum (Eindeutigkeit fällt,
                                                                 stattdessen „keine Überlappung je Mitglied+Abteilung“)
Mitglied 1 ──< Funktion                                     (unverändert; + Regel: keine gleiche Art/Abt/Zusatz überlappend)
Mitglied 1 ──< Beitragszuordnung  NEU                       mitglied_id, gueltig_ab, gueltig_bis, beitragsart_id,
                                                            beitragskonto_id, beitragsgemeinschaft_id
                                                            (ersetzt die drei flachen Felder am Mitglied; diese bleiben
                                                             übergangsweise als Cache der laufenden Zuordnung)
Beitragskonto (Zahlungskonto) 1 ──< Mandat  NEU             beitragskonto_id, mandatsreferenz (eindeutig, nie wieder),
                                                            mandatsdatum, iban, bic, kontoinhaber_name, gueltig_ab,
                                                            widerrufen_am, ersetzt_durch_mandat_id, amendment_*
                                                            (heute: Mandatsfelder direkt am Konto)
Beitragskonto 1 ──< Sollstellung                            NEU: Eindeutigkeit beitragskonto_id+jahr+laufnummer;
                                                            + art (jahr|nachtrag|korrektur|gutschrift),
                                                            + bezug_sollstellung_id (Korrektur/Storno-Kette)
Sollstellung 1 ──< Sollposition  NEU (optional)             mitglied_id | beitragsgemeinschaft_id, beitragsart_id,
                                                            anteil, betrag – macht den Schnappschuss nachvollziehbar
Einzugslauf  NEU                                            lauf_id, msg_id (eindeutig), erstellt_am, einzugsdatum,
                                                            anzahl, summe, status (erzeugt|eingereicht|abgelehnt|gebucht),
                                                            freigabe_von (Vier-Augen je Lauf statt je Jahr)
Einzugslauf 1 ──< Lastschrift  NEU                          lauf_id, sollstellung_id, mandat_id, sequenz, end_to_end_id,
                                                            betrag, status (eingereicht|eingezogen|zurueck)
Sollstellung 1 ──< Zahlung  NEU                             sollstellung_id, art (lastschrift|ueberweisung|bar|
                                                            ruecklastschrift|gebuehr|gutschrift), betrag (+/−), datum,
                                                            lastschrift_id?, grund
                                                            → ist_betrag/status der Sollstellung werden ABGELEITET
```

**Integritätsregeln** (im Code, Prüfregeln in `pruefregeln.js`):
1. **Zeiträume:**
   - Je Mitglied höchstens ein offener Zeitraum.
   - Zeiträume überlappen nicht.
   - `austritt ≥ eintritt`.
2. **Zuordnungen:** Abteilungszugehörigkeit und Funktion liegen innerhalb eines Mitgliedschaftszeitraums. Ausnahme: `nur_funktionstraeger`.
3. **Beitragszuordnung:**
   - Je Mitglied und Tag genau eine gültige Zeile.
   - Alle Mitglieder einer Gemeinschaft haben am Stichtag dasselbe Konto.
4. **Mandat:**
   - Höchstens ein gültiges Mandat je Konto.
   - Die Referenz ist kanonisch gespeichert, so wie sie in der Datei steht: ohne Leerzeichen, Groß-/Kleinschreibung gleich behandelt.
   - Ein Inhaberwechsel bedeutet ein neues Mandat.
5. **Sequenz:** Sie ergibt sich aus `Lastschrift.status = eingezogen` unter dem Mandat, nicht aus dem Status der Sollstellung (löst M2).
6. **Sollstellung:**
   - Der Betrag wird nie überschrieben.
   - Korrekturen laufen über eine neue Zeile mit `bezug_sollstellung_id`.
   - Der Saldo ergibt sich aus Σ Zahlung (löst H1, H2, M3).
7. **Fremdschlüssel:** Jeder FK wird beim Schreiben auf Existenz geprüft.
8. **Datenschutz:**
   - Freitext zu Dritten nur in `Notiz` mit Leserkreis.
   - Protokollzeilen zu Konto und Person werden mit der Anonymisierung bereinigt.

**Parallele Schreibzugriffe:** Das bestehende Muster reicht: `LockService` plus `version` plus Lesen unter der Sperre. Ergänzen:
- `SpreadsheetApp.flush()` vor jedem Lesen über die Sheets-API innerhalb der Sperre (M13).
- IDs mit dem Bestand abgleichen (wie `reserviereIds`).
- Abläufe aus mehreren Schritten zuerst vollständig prüfen, dann schreiben. Das ist das Muster aus `wiedereintritt`.

## 5. Umgesetzt in dieser Prüfung

Alle Punkte setzen eine **bereits dokumentierte Regel** durch. Fachregeln, Rechtegrenzen und Tabellenstruktur bleiben unverändert, Daten werden nicht migriert.

| Änderung | Datei | Regressionstest (`test/regression.test.js`) |
|---|---|---|
| „Eine Gemeinschaft = ein Konto“ auch beim Bearbeiten (vorher nur beim Anlegen) | `src/modul/Mitglieder.js` | Bearbeiten: Gemeinschaft … anderes Konto |
| Datenschutz-Felder beim Anlegen entfernt (wie beim Bearbeiten, Befund N2) | `src/modul/Mitglieder.js` | Anlegen: Datenschutz-Felder |
| Wiedereintritt prüft alle Abteilungen vor dem ersten Schreiben | `src/modul/Mitglieder.js` | Wiedereintritt: unbekannte Abteilung |
| Beitritt: ungültiges Eintrittsdatum → Antrag abgelehnt | `src/modul/Beitritt.js` | Beitritt: ungültiges Eintrittsdatum |
| Beitritt: kein Wiedereintritt für Verstorbene (wie `Mitglieder.wiedereintritt`) | `src/modul/Beitritt.js` | Beitritt: verstorbene Person |
| FZ-Löschdatum frisch gerechnet, gespeicherter Wert als Untergrenze (nie früher löschbar als bisher) | `src/lib/fristen.js`, `src/modul/Nachweise.js` | FZ-Löschdatum |
| SEPA: Einzugsdatum in der Vergangenheit sperrt die Datei; Warnung im Probelauf. Ein ausdrücklich eingegebenes Datum wurde schon geprüft (`sepaXml`), jetzt gilt das auch für das gespeicherte. | `src/lib/sepa.js`, `src/modul/Finanzen.js` | SEPA: Vergangenheit |
| SEPA: Mandatsverfall zum Einzugsdatum | `src/lib/sepa.js` | SEPA: Mandatsverfall |
| SEPA: nur ISO-Ländercode in `<Ctry>`, sonst Adresse weglassen (bestehende Regel für unvollständige Adressen); Klärliste meldet es | `src/lib/sepa.js`, `src/lib/beitrag.js`, `src/modul/Finanzen.js` | SEPA: Land als Freitext |
| Storno-Grund bleibt bei langer Bemerkung erhalten | `src/lib/sollstellung.js` | Storno |
| Anonymisierung leert `Anschreiben.email_an` und die Ausbildungsfelder; die Fristbereinigung leert `email_an` | `src/lib/loeschung.js`, `src/modul/Korrespondenz.js` | Anonymisierung |
| Dokument-Link im Browser nur bei `https://` (`App.sichereUrl`) | `src/client/ansicht_korrespondenz.html` | UI-Tests unverändert grün |

Gegenprobe: Alle 11 Regressionstests schlagen auf dem Stand vor der Änderung fehl.

### Nachtrag: Abschnitt 7, Schritt 1 (ohne Freigabe)

| Änderung | Datei | Regressionstest (`test/regression.test.js`) |
|---|---|---|
| Warnung bei Mehrfachrollen, z. B. Kassier + Abteilungsleiter oder Kassier + Jugendleiter. Die Rechte bleiben unverändert. | `src/lib/rechte.js`, `src/modul/Verwaltung.js` | Mehrfachrollen (2 Tests) |
| Art. 18: Gesperrte und anonymisierte Personen erscheinen in Ein-/Austritten, BLSV-Prüfliste und Nachmeldung ohne Namen für Rollen ohne `verwaltung` | `src/modul/Berichte.js`, `src/client/ansicht_berichte.html` | Berichte |
| Nachweise ändern oder löschen nur, wenn der Vermerk sichtbar ist (Regel aus dem Snapshot) | `src/lib/snapshot.js`, `src/Snapshot.js`, `src/modul/Nachweise.js` | Nachweise |
| „Zahlweg offen“ als Finanz-Notiz statt in `Mitglied.bemerkung` | `src/modul/Mitglieder.js` | `test/mitglieder.test.js`, `test/ui/mitglieder.ui.test.js` (angepasst) |
| Beitritts-Import: Bei einem Fehler werden Änderungen, Zähler und Einfügungen zurückgenommen und der Cache verworfen | `src/modul/Beitritt.js` | Beitritt: Fehler nach dem Schreiben |
| Neue Prüfregeln für Zeitachsen und Fremdschlüssel | `src/lib/pruefregeln.js`, `src/modul/Verwaltung.js` | Prüfregeln |
| `neueId` vergibt nie eine ID unter der höchsten im Bestand + 1 | `src/Datenzugriff.js` | neueId |
| `flush()` vor dem Lesen über die Sheets-API innerhalb der Sperre (Budget im Leistungstest 16 → 17 Zugriffe) | `src/Datenzugriff.js`, `test/datenzugriff.test.js` | Lesen über die Sheets-API |
| Testdaten-Generator: Spartenbeitritt liegt nie nach dem Austritt. Der Fehler fiel durch die neue Regel `datum_reihenfolge` auf. | `test/daten/generator.js` | `test/pruefregeln.test.js` |

Gegenprobe: Die 8 neuen Regressionstests schlagen auf dem Stand vorher fehl.

### Nachtrag: übrige 🔵-Punkte aus Abschnitt 2

Je ein Regressionstest in `test/regression.test.js` (11 Tests). Alle schlagen auf dem Stand vorher fehl.

| Änderung | Datei |
|---|---|
| Austritt: Ende einer Sparte oder Funktion nie vor ihrem Beginn | `src/modul/Mitglieder.js` |
| Cache: fehlgeschlagenes Speichern verwirft den alten Stand | `src/Cache.js` |
| Funktion: gleiche laufende Funktion nicht doppelt | `src/modul/Mitglieder.js` |
| E-Mail-Eindeutigkeit ohne Groß-/Kleinschreibung (DB und Prüfregel) | `src/Datenzugriff.js`, `src/lib/pruefregeln.js` |
| Faltung mit NFC und ohne Akzente; Prüfregel `dublette` mit derselben Faltung | `src/lib/migration.js`, `src/modul/Mitglieder.js`, `src/lib/pruefregeln.js` |
| Migration: vierstellige Jahreszahl ist kein Datum | `src/lib/migration.js` |
| CSV-Formelschutz für Tab und CR | `src/client/kern.html`, `src/lib/blsv.js` |
| Notizen nur am Konto: Löschung beim Konto-Leeren und in der Fristbereinigung | `src/modul/Datenschutz.js`, `src/modul/Notizen.js` |
| Setup: Hinweis bei abweichender Zeitzone | `src/Setup.js`, `docs/BETRIEB.md`, Fake `getSpreadsheetTimeZone` in `test/hilfe/gas-fakes.js` |
| `tagImJahr` kappt am Monatsende | `src/lib/beitrag.js` |
| Aufnahmeanträge (Archiv) in Auskunft und Anonymisierung (M10, Teil ohne neue Fachfunktion) | `src/lib/loeschung.js`, `src/modul/Datenschutz.js` |

Nicht geändert, weil es Sheet-Daten verändern würde: Der Formelschutz beim Schreiben ins Sheet (`Werte.zelleSchreiben`, `Protokoll`) bleibt bei `= + - @`. Google Sheets wertet Tab und CR am Anfang nicht als Formel.

## 6. Offene Entscheidungen

| # | Frage | Optionen | betrifft |
|---|---|---|---|
| E1 | Nachzügler und Korrekturen bei Sollstellungen | (a) Nachtrags-/Korrektur-Sollstellung mit Laufnummer (Schema), (b) Betrag ändern mit Protokoll, (c) nur Hinweis in der Klärliste | H1, H2 |
| E2 | Teilzahlung | eigener Status oder Rest offen lassen | M3 |
| E3 | FRST/RCUR-Regel | „erfolgreich eingezogen“ als Ereignis statt Status `bezahlt`; oder „immer RCUR“ (EPC 2016) | M2 |
| E4 | Mandatsänderung und Inhaberwechsel | `AmdmntInd` erzeugen? Neues Mandat beim Inhaberwechsel Pflicht? (Hausbank, DK-Spezifikation) | M4 |
| E5 | Leerzeichen in Mandatsreferenzen | verbieten (Bestand vorher prüfen) oder kanonisch speichern | M5 |
| E6 | Vorlauftage und Bankarbeitstage für das Einzugsdatum | mit der Hausbank klären | SEPA |
| E7 | Mehrfachrollen (z. B. Kassier + Abteilungsleiter) | Sichtklasse und Zeilen je Rolle paaren; bis dahin Warnung in der Benutzerverwaltung | H3 |
| E8 | Protokoll-Bereinigung bei Anonymisierung und `kontoLeeren` | auch Konto- und Sollstellungszeilen; `kommentar` mitleeren? | H5 |
| E9 | Status für einen Eintritt in der Zukunft | neuer Status „künftig“ oder als aktiv behandeln | M1 |
| E10 | Zählweise „gesamt“: Austrittstag mitzählen | korrigieren (ändert Ehrungsergebnisse) | M9 |
| E11 | Halbjahresbeitrag bei Austritt bis 30.06. | `_Konfig.csv` nennt ihn „beschlossen“, `ENTSCHEIDUNGEN.md` VBA3 nur den Eintritt ab 01.07. Bestätigen und Entscheidungslog angleichen; außerdem klären, ob `austrittsdatum` der letzte Mitgliedstag ist | Beitrag |
| E12 | Aufnahmeanträge: Löschung abgelehnter Anträge (Frist 9) und Umgang mit der getrennten Datei offener Anträge (Auskunft und Anonymisierung des Archivs erledigt) | neue Wartungsfunktion | M10 |
| E13 | Beitritt: Dublettenwahl bei mehreren Treffern, Kriterium bei fehlendem Geburtsdatum, neue Stammdaten beim Wiedereintritt übernehmen? | – | M14 |
| E14 | Zeitachse für Beitrag, Konto und Gemeinschaft (`Beitragszuordnung`) und Historie der Abteilungen | Strukturänderung, Migration | M7, M8 |

## 7. Nächste Schritte (Vorschlag)

1. ~~**Ohne Freigabe möglich, kleine Korrekturen**~~ – **erledigt** (siehe Nachtrag in Abschnitt 5). Noch zu tun:
   - im Testsystem prüfen, ob nach einem Einfügen der Cache-Neubau den neuen Stand sieht (`flush()`)
   - ~~weitere 🔵-Punkte aus Abschnitt 2~~ – erledigt (siehe Nachtrag in Abschnitt 5). Damit sind alle 🔵-Punkte erledigt. Die Löschung abgelehnter Anträge ist eine neue Fachfunktion (E12) und wartet auf deine Entscheidung
2. **Mit Verein und Hausbank klären:** E1–E6, E9–E11.
3. **Datenmodell in Stufen umbauen** (je eine Migration mit Prüfbericht, zuerst gegen synthetische Daten):
   - (a) `Zahlung` und abgeleiteter Saldo
   - (b) `Einzugslauf`/`Lastschrift`
   - (c) `Mandat`
   - (d) `Beitragszuordnung`
