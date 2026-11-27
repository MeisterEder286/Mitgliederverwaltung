# Mitgliederverwaltung TSV Ergoldsbach e. V. – Funktionsübersicht und Datenmodell

Stand: 29.10.2026. Zur Weitergabe an Dritte (Vorstand, Kassier, Abteilungen, Nachfolger, Prüfer).
Details: `README.md`, `docs/BEDIENUNG.md`, `docs/ENTWICKLUNG.md`, `docs/daten/*.csv`.

## 1. Kurzbeschreibung

- Webanwendung auf **Google Apps Script** mit **Google Sheets** als Datenspeicher. Keine weitere Infrastruktur, keine
  externen Dienste, Schriften oder Bibliotheken. Mobil bedienbar.
- Läuft unter dem Vereins-Funktionskonto („Ausführen als Ich“), Zugriff nur für die Domain. Wer nicht im Tab `Benutzer`
  steht, kommt nicht hinein.
- Rollen- und Feldrechte werden **serverseitig** erzwungen. Was eine Rolle nicht sehen darf, wird gar nicht erst
  ausgeliefert.
- ca. 1.200 Mitglieder, wenige Benutzer (Vorstand, Kasse, Mitgliederverwaltung, Abteilungs- und Jugendleitung).
- Ersetzt die Access-Datenbank (`Daten16` mit Formularen, Abfragen und VBA).

## 2. Rollen

| Rolle | Sieht | Darf |
|---|---|---|
| Vorstand | alle Mitglieder, alle Datenklassen | alles |
| Mitgliederverwalter | alle Mitglieder, alle Datenklassen | alles (Administrator) |
| Kassier | alle Mitglieder: Kontakt und Finanzen | Konten lesen, IBAN aufdecken (protokolliert), Sollstellungen, SEPA-Lauf, Rechnungen/Mahnungen, Mails, Notizen; **ändert keine Kontostammdaten/IBAN** |
| Abteilungsleiter | nur eigene Abteilung, Kontakt und Führungszeugnis-Ampel | Mitglied per Exaktsuche zuordnen, Funktionen der eigenen Abteilung, Führungszeugnis-Einsicht erfassen, Notizen; **kein** Vereinsaustritt |
| Jugendleiter | Minderjährige (bis 17) und Funktionsträger | Führungszeugnis erfassen, Notizen |

Hat jemand mehrere Rollen, gilt die Vereinigung. Die Rechtematrix steht bewusst im Code (`src/lib/rechte.js`), nicht in
einer Tabellenzelle: Änderungen laufen über Git mit Review. Sichtklassen der Felder: `intern`, `kontakt`, `finanz`,
`hochsensibel`, `verwaltung`.

## 3. Bereits umgesetzte Funktionen

### 3.1 Start
- Kennzahlen je Rolle, Schnellsuche (Umlaute egal), „Zu erledigen“, Geburtstage der Woche.
- Wiedervorlagen und offene Rückfragen; Kachel „Postausgang“.
- Summe offen/strittig entspricht dem Einzugsstand.

### 3.2 Mitglieder
- Liste mit Suche, Filter und Sortierung (lokal im Browser), Detailansicht mit Reitern.
- Bearbeiten mit **Versionsprüfung** (zwei Personen überschreiben sich nicht gegenseitig).
- Neuaufnahme mit Dublettenprüfung und automatischer Mitgliedsnummer (höchste + 1, **keine Lücken, keine Wiederverwendung**).
- Austritt mit Konto-Guard (verhindert Waisen, wenn der Austretende Zahler für andere ist), Wiedereintritt (gleiche
  Person, gleiche Nummer, neuer Zeitraum), Sterbefall.
- Listen als CSV/Druck: Kontakt, Jahrgang, Geburtstage, Passive. Jeder Export wird protokolliert.
- **Beitritt per XML-Import** (Nachfolger des Access-Moduls): Mehrfachauswahl, Vorschau je Antrag, Bankdaten von
  Person 1, Dublette → Wiedereintritt, ganz oder gar nicht je Antrag, Bericht.

### 3.3 Abteilungen und Funktionen
- „Meine Abteilung“ für Abteilungsleiter.
- Zuordnen nur per **Exaktsuche mit zwei Merkmalen** (Nachname + Nummer oder Geburtsdatum) und Einmal-Token, ohne
  Trefferlisten.
- Ämterhistorie mit von/bis, **nie gelöscht**. Nachweispflicht ergibt sich aus der Funktionsart.

### 3.4 Familien
- Familienübersicht; wer fällt aus dem Familienbeitrag (Kinder bis 17, mit Ausbildungsnachweis bis 25).
- Ausbildungsverlängerung mit Nachweis und prognostiziertem Ende; Prognose der nächsten Jahre.
- Umstellung auf Einzelbeitrag als Sammelaktion zum Stichtag 01.01.

### 3.5 Finanzen
- Beitragskonten (Zahlweg getrennt von der Person), IBAN maskiert, Aufdecken wird protokolliert, IBAN-Prüfung.
- Beitragsgemeinschaften (Familie/Ehepaar, gedeckelt) und Tarife nach Altersgrenzen, Tarifwechsel zum Jahreswechsel.
- Sollstellungslauf (Probelauf → Anlegen), Nachlauf für Nachzügler („Laufender Einzug“), Halbjahresbeitrag bei Eintritt ab 01.07.
- **SEPA-Lastschrift pain.008.001.08**: XSD-geprüft, FRST/RCUR aus der Historie abgeleitet, Mandatsverfall, Probelauf mit
  Ausschlussgründen, optional Vier-Augen-Freigabe.
- Rücklastschriften mit Gebühr, Mahnstufen, Klärliste, Einzugsstand.
- Rechnungen für Überweiser, Jahresübersicht aller Beitragsjahre, **Bezahlhistorie** je Person und Konto.
- Buchhaltungs-Export (nur mit Finanzsicht).

### 3.6 Schreiben und E-Mail
- Vorlagen mit Platzhaltern (Aufnahme-/Austrittsbestätigung, Rechnung, Mahnung, SEPA-Vorabinformation, Umstellung
  Einzelbeitrag, Ausbildungsnachweis …).
- Einzel- und Serienbriefe, Druck nach DIN 5008, Word-Seriendruck-Export, **alle Schreiben je Person** mit Nachdruck.
- Links zu unterschriebenem Mitgliedsantrag und SEPA-Mandat (Drive, keine Dateien in der App).
- **E-Mail-Versand** direkt aus der App: HTML-Mail mit Briefkopf, PDF-Anhang bei Bestätigungen, Postausgang mit
  Vorschlägen. Sicherung: Hauptschalter (Standard aus), Testmodus, Kontingent je Lauf, Absender = Funktionskonto,
  Antwortadresse fachlich (Verwaltung bzw. Kasse).
- Rückfrage „von welchem Konto abbuchen?“ an den Zahler mit drei Antworten, Ergebnis landet als Notiz.

### 3.7 Interne Notizen und Wiedervorlagen
- Notizen, Rückfragen und Wiedervorlagen je Person oder Konto mit **festgelegtem Leserkreis** (Verwaltung, Finanzen,
  Abteilung, Jugendleitung). Teil von Auskunft, Anonymisierung und Löschfrist.

### 3.8 Auswertungen
- Altersgruppen (frei einstellbar), Mitgliederentwicklung, Gesamtzahlen, Abteilungs-Kreuztabelle, Beitragsstruktur,
  Altersübergänge 18/19/65, Mitgliedsdauer, Wohnorte, Funktionsträger/Schiedsrichter, Mitgliederlisten kurz/lang.
- Formularhilfen und XML-Import aus dem Access-Formular (Abgleich: `docs/VBA_ABGLEICH.md`).

### 3.9 Nachweise (Kinderschutz)
- Erweitertes Führungszeugnis nach § 72a SGB VIII: gespeichert werden **nur Datum und Vermerk**, kein Inhalt, keine Kopie.
- Lizenzen, Wiedervorlage-Ampel, Löschfrist ab Ende der letzten pflichtigen Funktion.

### 3.10 Ehrungen
- Jahresliste (ab letztem Eintritt, umschaltbar auf „gesamt“), Nachholung offener Fälle, keine Doppelehrung.
- JHV-Liste und Urkunden-Export. Stufen sind Daten (`Ehrungsregel`), nicht im Code verdrahtet.

### 3.11 Berichte
- BLSV-Bestandserhebung und -Nachmeldung inkl. CSV; Jahresstatistik einfrieren (`Statistik_Jahr`, anonym) und Jahresvergleich.
- Geburtstage und Jubiläen (nur bei Einwilligung), Abteilungsübersicht, Ein-/Austritte.

### 3.12 Datenschutz
- Einwilligungen mit Verlauf (erteilt/widerrufen/neu erteilt).
- Betroffenenanfragen mit Fristüberwachung (1 Monat), Auskunft nach Art. 15.
- **Löschkonzept in drei Stufen:** sperren → anonymisieren → löschen, gesteuert über `Aufbewahrungsfrist`.
- Protokoll (nur anhängen) mit Rollenfilter und fristgesteuerter Bereinigung.

### 3.13 Verwaltung
- Benutzer und Rollen, Einstellungen (`_Konfig`), Stammdaten (Abteilungen, Beitragsarten, Funktionsarten,
  Qualifikationsarten, Ehrungsregeln, Vorlagen, Aufbewahrungsfristen).
- Datenqualität mit 24 Prüfregeln, System/Cache, Messwerte (Antwortzeiten).

### 3.14 Betrieb und Sicherheit
- Nächtliche Wartung: Status, Fristen, Löschdaten, Protokoll-Bereinigung, Anschreiben-Bereinigung nach Frist.
- **Backup** als eigenes Apps-Script-Projekt (eigener Drive-Scope, Aufbewahrung, Freigabeprüfung, Wiederherstellungstest).
- **Migration** aus Access (`Daten16`) per lokaler Kommandozeile mit Prüfbericht; synthetischer Altbestand zum Testen.
- Sicherheit: jede Server-Funktion läuft über eine zentrale Rollenprüfung, Sperre (`LockService`) bei Schreibvorgängen,
  generische Fehlermeldungen mit Fehlernummer, minimale OAuth-Scopes, Formelschutz in Tabellen, Sicherheitsprüfung mit
  Regressionstests (`docs/SICHERHEITSPRUEFUNG.md`).
- Tests: `npm run check`, `npm test` (Fachlogik und Server), `npm run test:ui` (Chromium gegen den echten Servercode).
- Im Repository liegen ausschließlich erfundene Testdaten.

## 4. Geplant bzw. noch offen

Die Fachfunktionen sind weitgehend umgesetzt. Offen sind vor allem Einrichtung, Abnahme und ein eigenes Zusatzmodul.

### 4.1 Eigenes Zusatzmodul (noch nicht gebaut)
| Punkt | Beschreibung |
|---|---|
| **Öffentlicher Aufnahmeantrag (Online)** | Eigenes Skriptprojekt mit eigener Eingangsdatei (`Aufnahmeantraege_TSV_Ergoldsbach`); es kennt die Mitgliederdatei nicht. Stündlicher Abruf, Dublettenprüfung, E-Mail-Bestätigungslink (Double-Opt-in), Erinnerung nach 14 Tagen, wenn das unterschriebene Formular fehlt, Ablage der PDFs im eingeschränkten Drive-Ordner. Datenmodell (`Aufnahmeantrag`, `_Konfig antrag_*`) ist angelegt, Logik fehlt. Bis dahin: XML-Import (3.2). Keine IBAN im öffentlichen Formular (Regel D3). |

### 4.2 Einrichtung und Abnahme (manuell in Google)
- Deployment-Einstellungen prüfen (Ausführen als Ich, Zugriff Domain), Slug `/verwaltung` und Weiterleitung, Deployment-ID in `docs/REGISTER.md`.
- Funktionskonto als Eigentümer, Ablage in geteilter Ablage, Ordnerfreigaben nur Funktionskonto, Kontingente prüfen.
- Testumgebung ohne Echtdaten; Backup einrichten und Wiederherstellung einmal testen.
- In `_Konfig` echte Werte eintragen: Gläubiger-ID, Vereins-IBAN, Anschrift, Antwortadressen, Impressum-/Datenschutz-URL.
- **SEPA-Testdatei pain.008.001.08 bei der Hausbank einreichen** (Format ist ab **15.11.2026** Pflicht; Hausbank zur
  Adresspflicht fragen).
- Vorstand bestätigt Beiträge, Ehrungsstufen, Funktionsarten, Aufbewahrungsfristen und Rückbuchungsgebühr.
- E-Mail-Versand: erst im Testmodus prüfen, dann `mail_aktiv = ja`.
- Benutzer je Rolle anlegen, Rundgang je Rolle auf dem Handy.

### 4.3 Migration (bewusst ganz am Schluss)
- Daten aus Access (`Daten16`, optional Austritte ab 2010) mit lokaler Kommandozeile in die Tabs überführen,
  Prüfbericht abarbeiten, Zahlen gegen Access abgleichen (Mitglieder je Status und Abteilung, Soll-Summe).
- Wichtig: Mandatsreferenzen müssen exakt reproduziert werden (neue Referenz = rechtlich neues Mandat).
- Offene Rückfragen siehe `docs/MIGRATION.md`.

### 4.4 Noch zu bestätigende Festlegungen (im Code als `// OFFEN:` markiert)
- Rollenmatrix endgültig (insbesondere Kassier ohne Kontoänderung, Sichtbereich Abteilungsleiter).
- Jugenddefinition (derzeit bis einschließlich 17 Jahre).
- Aufbewahrungsfrist-Werte und Gültigkeit der Fristen für Führungszeugnisse (Reihenfolge: Qualifikationsart vor `_Konfig`).
- Zählweise Funktionsjubiläum (derzeit je Funktion).
- Verhalten bei Anonymisierung: Mitgliedsnummer bleibt (Ausblendung für Rollen ohne Finanzrecht), Funktionen und
  Ehrungen je Einstellung `chronik_bei_anonymisierung`.
- Anteiliger Beitrag bei unterjährigem Eintritt (derzeit: halber Beitrag ab 01.07.).
- Vier-Augen-Prinzip beim SEPA-Lauf (derzeit schaltbar, Standard aus).
- Adressen in der SEPA-Datei: unvollständige Zahleradressen werden weggelassen (Warnung); mit Hausbank klären.
- BLSV-Importformat (aktuelle Vorlage der Bestandserhebung liegt zum Abgleich nicht vor).

### 4.5 Mögliche spätere Erweiterungen (nicht beauftragt)
- Spartenbeitrag je Abteilung (vorbereitet: eine zusätzliche Spalte an `Abteilungszugehoerigkeit`).
- Zweite Persistenzschicht für Geschwindigkeit nur falls die Messung (`_Messung`) es erforderlich macht.

## 5. Datenmodell

### 5.1 Prinzipien
- **Eine Zeile pro Person**, egal wie oft sie ein- und austritt (Mitgliedsnummer bleibt). Ein- und Austritte stehen
  in `Mitgliedschaftszeitraum`; „Mitglied seit“ und Status werden daraus **abgeleitet**.
- **Person und Zahlweg sind getrennt.** Ein Beitragskonto kann mehrere Mitglieder tragen (Familie, Ehepaar, Eltern
  zahlen für Kinder). Alle Mitglieder einer Beitragsgemeinschaft müssen dasselbe Konto haben.
- **Historien statt Überschreiben:** Funktionen, Zeiträume, Einwilligungen, Sollstellungen, Anschreiben. Funktionen werden nie gelöscht.
- **Konfiguration als Daten:** Tarife, Ehrungsstufen, Funktionsarten, Aufbewahrungsfristen, Vorlagen und Einstellungen
  stehen in Tabellen, nicht im Code. (Ausnahme: Rechtematrix, siehe 2.)
- Jede Tabelle hat einen technischen Schlüssel (`<tabelle>_id`, Zähler in `_Konfig`) und, wo sinnvoll, eine
  Eindeutigkeitsregel auf fachlichen Spalten.
- **Optimistische Sperre:** Spalte `version` (+1 je Schreibvorgang), dazu `geaendert_am` und `geaendert_von`.
- **Sichtklassen** je Spalte: `intern`, `kontakt`, `finanz`, `hochsensibel`, `verwaltung`. Sensible Tabellen werden
  für nicht berechtigte Rollen gar nicht geladen.
- Maßgebliche Quelle: `docs/daten/tabellen.csv`, `feldkatalog.csv`, `auswahllisten.csv`; daraus entsteht `src/lib/schema.js` (`npm run schema`).

### 5.2 Tabellen

**Personen und Mitgliedschaft**

| Tabelle | Inhalt | Eindeutig | Wichtige Spalten |
|---|---|---|---|
| `Mitglied` | die Person | `mitgliedsnummer` | Name, Anrede/Briefanrede, Adresse, Geburtsdatum, Geschlecht, Telefon/Handy/E-Mail, Versandart, `adresse_ungueltig`, Ehrenmitglied, `nur_funktionstraeger`, Sterbedatum, `status` (abgeleitet), Verweise auf `beitragsart_id`, `beitragskonto_id`, `beitragsgemeinschaft_id`; Ausbildung (`ausbildung_art`, `_bis`, `_nachweis_am`); gesetzlicher Vertreter (`vertreter_mitglied_id` oder Name/Kontakt); DSGVO-Felder (`verarbeitung_eingeschraenkt`, `sperre_grund`, `loeschbar_ab`, `anonymisiert`, `anonymisiert_am`) |
| `Mitgliedschaftszeitraum` | ein Beitritt-Austritt-Zyklus | – | `mitglied_id`, Antrag/Beschluss, `eintrittsdatum`, `austrittsdatum`, Kündigung eingegangen, `austritt_wirksam`, `austrittsgrund` |
| `Aufnahmeantrag` | Archiv abgeschlossener Anträge (offene Anträge liegen in getrennter Datei) | – | Antragsdaten, Einwilligungen (Fotos, Newsletter, Ehrungen), Satzung/Datenschutz bestätigt, `dublette_mitglied_id`, Beschluss, Ablehnungsgrund, Übernahme, `mitglied_id` |

**Abteilungen und Funktionen**

| Tabelle | Inhalt | Eindeutig | Wichtige Spalten |
|---|---|---|---|
| `Abteilung` | Sparten (Stammdaten) | – | Bezeichnung, `blsv_sportart`, `meldepflichtig`, `aktiv` |
| `Abteilungszugehoerigkeit` | wer ist in welcher Sparte | `mitglied_id`+`abteilung_id` | Passnummer, Status, Eintritt/Austritt. **Kein Funktionsfeld.** |
| `Funktionsart` | Katalog der Ämter | – | Ebene (Verein/Abteilung), `fz_pflichtig`, Bestellung, `ehrungsfaehig` |
| `Funktion` | Historie der Ämter und Tätigkeiten | – | `mitglied_id`, `funktionsart_id`, `abteilung_id`, Zusatz, `von`, `bis`, `bestellt_am`, Beendigungsgrund. Spieler und Teilnehmer bekommen **keinen** Eintrag. |

**Beiträge und Zahlungen** (sensibel)

| Tabelle | Inhalt | Eindeutig | Wichtige Spalten |
|---|---|---|---|
| `Beitragsart` | Tarife, *was* jemand zahlt | – | Betrag, `alter_von`/`alter_bis`, Intervall, `gueltig_ab` |
| `Beitragsgemeinschaft` | gedeckelter Familien-/Ehegattenverbund | – | `festbetrag` |
| `Beitragskonto` | der Zahlweg, nicht die Person | `mandatsreferenz` | Kontoinhaber (Name oder Mitglied), `zahlweg` (Lastschrift/Überweisung), IBAN/BIC, Mandatsreferenz und -datum, abweichende Anschrift. Die SEPA-Sequenz FRST/RCUR wird **nicht** gespeichert, sondern aus der Historie abgeleitet. |
| `Sollstellung` | Zahlungshistorie je Konto und Jahr | `beitragskonto_id`+`jahr` | `soll_betrag`, `ist_betrag`, `gebuehr`, `status` (offen/bezahlt/gemahnt/ruecklastschrift/widerspruch/storniert), Einzugsdatum, Buchungsdatum, `mahnstufe`, Rücklastschriftgrund |

**Nachweise und Ehrungen**

| Tabelle | Inhalt | Eindeutig | Wichtige Spalten |
|---|---|---|---|
| `Qualifikationsart` | Katalog der Nachweisarten mit Fristenlogik | – | Kategorie, `wiedervorlage_monate`, `max_alter_zeugnis_monate`, `loeschfrist_monate` |
| `Qualifikation` | **hochsensibel**: nur DASS und bis wann eingesehen wurde (§ 72a) | – | `mitglied_id`, `qualifikationsart_id`, `funktion_id`, `eingesehen_am`, `eingesehen_durch`, `ergebnis`, `gueltig_bis`, `wiedervorlage_am`, `zu_loeschen_ab`, `geloescht_am`. Kein Inhalt, keine Kopie, kein Upload. |
| `Ehrungsregel` | Ehrungsstufen (Konfiguration) | – | Typ (Mitgliedschaft/Funktion), `schwelle` in Jahren, Bezeichnung, Verband |
| `Ehrung` | Verleihungs-Log | `mitglied_id`+`ehrungsregel_id`+`funktion_id` | `faellig_jahr`, `status` (fällig/verschoben/verliehen …), `verliehen_am`, Veranstaltung. Offene Fälle bleiben offen: keine Doppelehrung, kein Vergessen. |

**Schreiben, Dokumente, Notizen**

| Tabelle | Inhalt | Wichtige Spalten |
|---|---|---|
| `Dokument` | Links auf unterschriebene Dokumente im eingeschränkten Drive-Ordner | `mitglied_id`/`beitragskonto_id`, Art (Antrag, SEPA-Mandat …), Titel, `link`, Datum |
| `Vorlage` | Briefvorlagen mit Platzhaltern (Stammdaten) | Anlass, Betreff, Text |
| `Anschreiben` | alle erstellten Schreiben je Person | `vorlage_id`, Anlass, Datum, Betreff, Inhalt, Empfänger, Versandart, Serie, `dokument_link`; Mail: `email_an`, `gesendet_am`, `mail_status` |
| `Notiz` | interne Notizen, Rückfragen, Wiedervorlagen | `mitglied_id`/`beitragskonto_id`, Art, Text, `sichtbar_fuer` (Leserkreis), `abteilung_id`, `wiedervorlage_am`, `erledigt_am`, `ergebnis`, `anschreiben_id`, `erstellt_von` |

**Datenschutz und Rechte**

| Tabelle | Inhalt | Wichtige Spalten |
|---|---|---|
| `Benutzer` | wer darf rein, mit welcher Rolle (eine Zeile je Rollenzuweisung) | `email`, `rolle`, `abteilung_id`, `mitglied_id`, `aktiv` |
| `Einwilligung` | eine Zeile je Einwilligung mit Verlauf | `mitglied_id`, Art, Umfang, `erteilt_am`, Form, `widerrufen_am`, Nachweisort |
| `Aufbewahrungsfrist` | Löschkonzept als Tabelle (Stammdaten) | Datenkategorie, betroffener Tab, `dauer_monate`, Bezugspunkt, Rechtsgrundlage. Daraus rechnet das System `loeschbar_ab`. |
| `Betroffenenanfrage` | Anfragen nach Kapitel III DSGVO | Art, `eingang_am`, Kanal, Status, Entscheidung, `umgesetzte_stufe`, `rueckmeldung_am` |

**Technisch**

| Tabelle | Inhalt |
|---|---|
| `Statistik_Jahr` | eingefrorene Jahreszahlen **ohne Personenbezug** (Gesamt, Geschlecht, Altersklassen des BLSV, Ein-/Austritte, Soll/Ist), je Verein und Abteilung. Löschungen verfälschen dadurch die Vereinsstatistik nicht. |
| `_Konfig` | Schlüssel/Wert: Beitragsjahr, Vereinsdaten, SEPA-Einstellungen, Fristen, Mail-Schalter, Familienregeln, ID-Zähler |
| `_Protokoll` | nur anhängen, nie ändern: Zeitpunkt, Benutzer, Aktion, Tabelle, Datensatz, Feld, alter/neuer Wert. Rollengefiltert (enthält Finanzdaten), fristgesteuert bereinigt. |
| `_Messung` | Zeitmessung je Server-Aufruf, ohne Personendaten |

### 5.3 Beziehungen (vereinfacht)

```
Mitglied 1──n Mitgliedschaftszeitraum
Mitglied 1──n Abteilungszugehoerigkeit n──1 Abteilung
Mitglied 1──n Funktion n──1 Funktionsart ; Funktion n──0..1 Abteilung
Mitglied n──1 Beitragsart
Mitglied n──0..1 Beitragsgemeinschaft
Mitglied n──1 Beitragskonto 1──n Sollstellung   (je Konto und Jahr)
Mitglied 1──n Qualifikation n──1 Qualifikationsart
Mitglied 1──n Ehrung n──1 Ehrungsregel ; Ehrung n──0..1 Funktion
Mitglied 1──n Einwilligung / Betroffenenanfrage / Dokument / Anschreiben / Notiz
Beitragskonto 1──n Dokument / Notiz / Anschreiben
Mitglied 0..1──n Mitglied   (gesetzlicher Vertreter)
Aufnahmeantrag 0..1──1 Mitglied
```

### 5.4 Wichtige abgeleitete Regeln
- **Status** (aktiv/passiv/ausgetreten/verstorben …) und „Mitglied seit“ ergeben sich aus `Mitgliedschaftszeitraum`
  und Sterbedatum, nicht aus einem frei gepflegten Feld.
- **Beitrag:** Tarif aus Altersgrenzen (Wechsel zum 01.01.), Familiendeckel über die Gemeinschaft; als Kind im
  Familienbeitrag gilt, wer bis 17 ist (mit Ausbildungsnachweis bis 25) und gesetzlich vertreten wird oder mehr als
  15 Jahre jünger als das älteste Mitglied der Gemeinschaft ist.
- **SEPA-Sequenz:** FRST, solange unter dem Mandat noch kein Einzug „bezahlt“ war; sonst RCUR. Mandat verfällt nach 36 Monaten ohne Nutzung.
- **Ehrungen:** Jubiläum ab letztem Eintritt (ein Austritt setzt zurück); Jahresliste = neu fällige + offene Vorjahre − verliehene.
- **Löschfristen:** aus `Aufbewahrungsfrist` wird `loeschbar_ab` berechnet; Löschen in drei Stufen (sperren,
  anonymisieren, löschen). Führungszeugnis-Vermerke werden ab Ende der letzten pflichtigen Funktion + Frist gelöscht.

### 5.5 Altsystem
`Daten16` (eine breite Access-Tabelle) wird nach den obigen Tabellen aufgeteilt. Regeln: `Zahler` enthält die Mitgliedsnummer
des Zahlers (Basis für die Konten); `Zahlung = NG` bedeutet „beim Einzug nicht gezahlt“ und wird zur Sollstellung mit
Status Rücklastschrift; die Spalten `Gesamtbeitrag`/`Betrag` werden gelesen, aber nicht übernommen. Siehe `docs/MIGRATION.md`.
