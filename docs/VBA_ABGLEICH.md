# Abgleich: Access-Formular „Personalien“ (VBA) → neue Mitgliederverwaltung

Grundlage: der VBA-Code des Access-Formulars `Personalien` auf der Tabelle `Daten16` (von Johann, 10/2026).
Für jede Prozedur bzw. Schaltfläche steht hier, **was sie tat**, **welche Fehler** sie hatte und **wo das im neuen
System umgesetzt ist** – oder warum sie bewusst entfällt. Die in Access aufgerufenen Makros, Abfragen und Berichte
(`…M`, `…A`, `…B`, `…F`) lagen nicht als Code vor; ihr Zweck ist aus dem Namen erschlossen und als **[A]** markiert.

Legende Umsetzung: ✅ umgesetzt · ↗ umgesetzt durch einen anderen Baustein (Verweis) · ✖ entfällt (Begründung)

## 1. Eingabehilfen im Formular

| VBA | Tat in Access | Fehler/Schwächen im VBA | Neues System |
|---|---|---|---|
| `Anrede_AfterUpdate` | setzt Geschlecht: „Herr“ → m, **alles andere → w** | „Divers“, leere Anrede, „Firma“ … wurden fälschlich „w“; überschrieb auch ein bereits gesetztes Geschlecht | ✅ Formular „Neues Mitglied“/„Bearbeiten“: Herr → m, Frau → w, Divers → d, sonst nichts; nur wenn Geschlecht noch leer ist (`client/ansicht_auswertungen`, Erweiterung `mitglied.formular`; Regel auch in `Auswertung.geschlechtAusAnrede`) |
| `Plz_LostFocus` | Ort aus Tabelle `Postlz` nachschlagen | kein Treffer → Laufzeitfehler (nur 2115/94 abgefangen); bei mehreren Orten je PLZ nur der erste | ✅ Ort-Vorschlag aus den vorhandenen Anschriften (häufigster Ort je PLZ), nur wenn Ort leer, mit Hinweis „bitte prüfen“. Eine amtliche PLZ-Tabelle ist nicht im Projekt (Datensparsamkeit, Wartung). |
| `BLZ_LostFocus` | Bankname aus `Bankleitzahlen` | `SetFocus`-Ketten, Fehler bei leerer BLZ | ✖ Seit SEPA zählt die IBAN; der Bankname wird nicht mehr gespeichert (Datenmodell: `BANK` verworfen). |
| `BIC_Enter`, `BIC_Click` | BIC aus `BLZBIC` | doppelter Code; String-Verkettung im SQL; Fehler bei unbekannter BLZ | ✖ Für deutsche IBANs ist die BIC in SEPA-Dateien nicht nötig (`Iban.bicNoetig`); die SEPA-Datei setzt sonst „NOTPROVIDED“. Bundesbank-BLZ-Tabelle nicht im Projekt. |
| `StatAbt1..4_LostFocus` | Betrag aus `Beitragsarten` je Abteilungsstatus | keine Fehlerbehandlung bei unbekannter Beitragsart; Beitrag als `Integer` (Cent gehen verloren); vier Kopien desselben Codes | ↗ Beitrag hängt nicht mehr an der Abteilung: eine Beitragsart je Mitglied bzw. Gemeinschaft (`lib/beitrag.js`, Übergabe §4). Vorschlag der Beitragsart nach Alter im Formular „Neues Mitglied“. |
| `Betrag1..4_AfterUpdate` | summiert über ein unsichtbares Hilfsfeld in `Gesamtbeitrag` | `Integer` (Cent-Verlust); Summe über verstecktes Steuerelement; `Gesamtbeitrag` wurde gespeichert und konnte veralten | ↗ Gesamtbeitrag wird **berechnet, nie gespeichert** (`Beitrag.sollJeKonto`, Betrag je Konto inkl. Familien-Festbetrag); der Stand je Jahr steht als Schnappschuss in `Sollstellung`. |
| `Vorname_AfterUpdate` | Kontoinhaber = „Nachname Vorname“, wenn leer | Fehler wurde nur angezeigt; Kontoinhaber hing an der Person statt am Konto | ↗ Kontoinhaber gehört zum Beitragskonto (Bereich Finanzen); beim Anlegen eines Kontos ist der Name des Zahlers vorbelegt. |
| `MitglNr_DblClick` | zeigt „nächste freie Mitgliedsnummer“ (kleinste **Lücke**) | Schleife mit `FindFirst "MitglNr = MitglNr"` (Vergleich mit sich selbst), `Integer`-Zähler; Lückenvergabe widerspricht dem Datenmodell | ↗ Nummer wird beim Anlegen automatisch vergeben (`_Konfig.mitgliedsnummer_naechste`, keine Wiederverwendung laut Datenmodell). **Widerspruch VBA2** in `docs/ENTSCHEIDUNGEN.md`. |
| `Befehl1011` (XML-Import) | neues Mitglied aus XML-Datei (`/dataroot/Daten16`) mit freier Nummer anlegen | übernimmt **IBAN/BIC/Kontoinhaber aus einem Webformular** (Widerspruch Sicherheitsregel D3); ignoriert Titel, Handy, Abteilung 2–4 (nur deren Beträge), AusDat; setzt `ReZiff` und `Gesamtbeitrag`; Datum nur im ISO-Format; kein Dublettenabgleich | ↗ abgelöst durch **„Beitritte aus XML importieren“** (nächste Zeile): Datei wird **nur im Browser** gelesen (nichts hochgeladen), Bankdaten von Person 1 werden **übernommen** (Entscheidung VBA1, bewusste Abweichung von D3), Dublettenprüfung mit Wiedereintritt, neue Nummer höchste + 1. |
| `BeitrittsXmlImportieren` (Modul, Nachfolger von `Befehl1011`) | mehrere Beitritts-XML-Dateien; je Datei ein Antrag mit einer oder mehreren Personen; Person 1 zahlt selbst, die übrigen über Person 1; neue Nummern (`LUECKEN_FUELLEN = False`); Dublettenabfrage; Rückrollen bei Fehlern | Dublettenprüfung nur mit „trotzdem importieren/abbrechen“ (kein Wiedereintritt); Rückrollen fragt nach statt automatisch; SQL per String-Verkettung | ✅ **„Beitritte aus XML importieren“** (Mitglieder): Mehrfachauswahl, Vorschau je Antrag, ein Beitragskonto aus den Bankdaten von Person 1 (**übernommen – Entscheidung VBA1**), Familienbeitrag nach Migrationsregel, neue Nummern höchste + 1, je Person „trotzdem neu“ oder **Wiedereintritt** bei Dublette, jeder Antrag atomar, Bericht wie in Access, danach Aufnahmebestätigungen. `src/modul/Beitritt.js`, `src/client/ansicht_beitritt.html` |
| `AusDat_DblClick` | Austrittsmitteilung öffnen und drucken | `AusDat.Text <> Null` ist **nie wahr** (Vergleich mit Null); `If vbOK = 1` prüft eine Konstante → druckte immer; Rückgabewert der MsgBox wurde nie ausgewertet | ↗ Austritt im Mitglied-Detail („Austritt“ mit Kündigungseingang, wirksam zum, Grund, Konto-Guard); die Austrittsbestätigung als Anschreiben (Bereich Dokumente/Anschreiben, Vorlage „Austrittsbestätigung“). |
| `Zahlung_DblClick` | Rechnungsformular öffnen und drucken | druckte die **Auswahl des aktuellen Formulars**, nicht die Rechnung | ↗ Rechnung als Anschreiben (Vorlage „Rechnung“); Zahlstatus je Jahr in `Sollstellung` (Finanzen). |
| `Rechteck13195`, `Befehl13196`, `Befehl13199`, `Text13197`, `Befehl6543` | Ein-/Ausblenden eines Rechtecks; leere Prozedur | ohne fachliche Funktion | ✖ entfällt |

## 2. Listen, Berichte, Auswertungen

| VBA (Makro/Abfrage/Bericht) | Zweck [A] | Neues System |
|---|---|---|
| `Geburtstage_Click` → `GeburtstageB` | Geburtstagsliste | ✅ Berichte → Geburtstage (Zeitraum, runde Geburtstage, nur mit Einwilligung fürs Gemeindeblatt); Startseite „Geburtstage der nächsten 7 Tage“; Mitglieder → Listen „Geburtstage im Monat“ |
| `Altersgruppen_Click` → `AltersgruppenA` | Mitglieder je Altersgruppe | ✅ Auswertungen → Altersgruppen: Grenzen frei wählbar (Vorgaben BLSV, fein, Jugend), je Abteilung oder Geschlecht, davon passiv, ohne Geburtsdatum. Die alten Access-Grenzen sind nicht bekannt **[A]**. |
| `Text269_DblClick` → `Gesamtmitglieder` | Gesamtzahlen | ✅ Auswertungen → Überblick: aktiv, davon gekündigt, ausgetreten, verstorben, Funktionsträger ohne Mitgliedschaft; je Abteilung aktiv/passiv; Geschlecht; Anzahl Abteilungen je Person |
| `Statistik_Click` → `Statistik` | Vereinsstatistik | ✅ Auswertungen (Entwicklung, Mitgliedsdauer, Wohnorte, Kreuztabelle) und Berichte → Jahresvergleich (eingefrorene `Statistik_Jahr`) |
| `Beitritte_Click` → `BeitritteB`, `Austritte_Click` → `AustritteB` | Ein-/Austritte | ✅ Berichte → Ein- & Austritte (Zeitraum); Auswertungen → Entwicklung (je Jahr, inkl. Wiedereintritte) und Austrittsgründe |
| `BLSVJahresmeldung_Click` → `BLSVJahrMakro` | BLSV-Jahresmeldung | ✅ Berichte → BLSV „Bestandserhebung“ + CSV + Jahresstatistik einfrieren |
| `Befehl6662` → `BLSVJahrNachmeldungMakro`, `BLSVneuSchalt_Click` → `BLSVneuM` | Nachmeldung der Neuzugänge an den BLSV | ✅ Berichte → BLSV „Nachmeldung (neu seit Stichtag)“: Neumitglieder und neue Sportart-Zugehörigkeiten je Sportart, Personenliste, CSV (`Blsv.nachmeldung`) |
| `Ctl19aktualisieren_Click` → `Jug19A` | Jugendliche, die 19 werden (Tarifwechsel) | ✅ Auswertungen → Altersübergänge (werden 18/19/65 im nächsten Jahr, aktuelle und künftige Beitragsart); Übernahme über Finanzen → Tarifwechsel |
| `Ctl65neu_Click` → `65neuA` | Mitglieder, die 65 werden | ✅ wie oben (Altersübergänge) |
| `Schiri_Click` → `SchiriA` | Schiedsrichterliste | ✅ Auswertungen → Funktionen → Schiedsrichter (laufende Funktion „Schiedsrichter“), CSV/Druck |
| `Ehrungen_Click` → `EhrungenB` | Ehrungsliste | ✅ Ehrungen (Jahresliste, JHV-Liste, Urkunden-Export) |
| `Mitgliederliste_Click` → `MitgliederlisteB`, `SchaltMGkurz_Click` → `Mitgliederliste-kurz` | Mitgliederliste lang/kurz | ✅ Auswertungen → Mitgliederlisten „kurz“ (Nr., Name, Jahrgang, Abteilungen) und „lang“ (mit Anschrift/Kontakt), CSV/Druck; Mitglieder → Listen & Export |
| `Familien_Click` → `FamilienF` | Familienübersicht | ↗ Familien (Familienübersicht, Ausscheiden aus dem Familienbeitrag, Umstellung auf Einzelbeitrag) – Baustein „Familie/Beitrag“ |
| `Befehl1456` → `OffeneBeiträgeB` | offene Beiträge | ✅ Finanzen → Einzugsstand „Offen und streitig“, Mahnliste |
| `Mahnung_Einzug_Click` → `Mahnung_EinzugF` | Mahnung | ↗ Sollstellung „gemahnt“ (Mahnstufe) in Finanzen; Mahnschreiben als Anschreiben (Vorlage „Mahnung“) |
| `Rechnungen_Click` → `RechnungenF`, `Bezeichnungsfeld289_Click` → `RechnungssummeF` | Rechnungen an Überweiser, Rechnungssumme | ↗ Rechnungen als Anschreiben (Vorlage „Rechnung“, Serienbrief); Summen im Einzugsstand |
| `Bezeichnungsfeld289_DblClick` → `SummederJahresBeitragseinzügeF` | Summe der Jahreseinzüge | ✅ Finanzen → Einzugsstand je Beitragsjahr; Auswertungen → Beiträge (Soll des Jahres, Struktur je Beitragsart/Gemeinschaft) |
| `Beitragseinzug_Click` → `JahresBeitragsEinzugA` | Jahreseinzug | ✅ Finanzen → Sollstellungen + SEPA-Lauf (pain.008.001.08) |
| `LaufenderEinzug_Click` → `LaufenderEinzugExcelM` | unterjähriger Einzug (Nachzügler, Excel) | ↗ Baustein „Familie/Beitrag/Finanzen“: Nachlauf für noch nicht eingezogene Sollstellungen |
| `LaufenderEinzugHalb_Click` → `LaufenderEinzugHalbExcelM` | halber Beitrag (vermutlich Eintritt im 2. Halbjahr) | ↗ Option `beitrag_anteilig = halbjahr` (Baustein „Familie/Beitrag“); **Widerspruch VBA3** |
| `Word_Click` → `WordStartenM` | Word-Serienbrief | ↗ Anschreiben/Serienbriefe mit Vorlagen und Export für den Word-Seriendruck (Baustein „Dokumente/Anschreiben“) |
| `AustritteLöschen_Click` → `AustritteLöschenM` | Ausgetretene löschen | ✖ Ersetzt durch das Löschkonzept (Datenschutz → Löschliste): sperren, anonymisieren, löschen erst nach Ablauf der Aufbewahrungsfristen (§ 147 AO); pauschales Löschen hätte gesperrte Buchungen verwaist |
| `updateBICs`, `updateIBANs` | einmalige Umstellung auf IBAN/BIC (Tabelle `Daten14`) | ✖ Altlast: arbeiten auf der veralteten Tabelle `Daten14`, SQL per String-Verkettung, Fehler nur im Direktfenster. Für die Migration ersetzt durch `Iban.ausBlzKonto` (Vorschlag mit Warnung im Prüfbericht) |

## 3. Querschnittliche Fehler im VBA (für die Nachvollziehbarkeit)

1. **SQL per String-Verkettung** (`"... WHERE Bankleitzahl ='" & doblz & "'"`) – anfällig für Fehler bei Sonderzeichen; im neuen System gibt es kein SQL, Zugriffe laufen über Spaltennamen (`DB`).
2. **Fehlerbehandlung verschluckt Fehler** (`Err.Number = 2115 Or 94 → Resume Next`), Fehler bei fehlendem Datensatz führten zu leeren Feldern ohne Hinweis. Neu: generische Meldung + Fehler-Nr., Details im Ausführungsprotokoll (A9).
3. **Zahlen als `Integer`** (Beiträge) – Cent-Beträge gingen verloren. Neu: Dezimal mit 2 Nachkommastellen.
4. **Gespeicherte Ableitungen** (`Gesamtbeitrag`, Bankname, BIC) – konnten veralten. Neu: abgeleitet, nicht gespeichert (Datenmodell „Was bewusst nicht gespeichert wird“).
5. **Nummernvergabe über Lücken** – frühere Nummern ausgetretener Mitglieder konnten neu vergeben werden (Verwechslung in alten Listen). Neu: fortlaufend, keine Wiederverwendung (schaltbar, VBA2).
6. **Bankdaten über Webformular** (XML-Import) – Widerspruch zu Sicherheitsregel D3 (VBA1); **entschieden 10/2026: werden übernommen** (dokumentierte Ausnahme, siehe `docs/ENTSCHEIDUNGEN.md`).
7. **Druck aus dem Formular** (`DoCmd.PrintOut acSelection`) druckte die Bildschirmauswahl statt eines Dokuments. Neu: Anschreiben mit Vorlage, protokolliert und je Person abgelegt.
