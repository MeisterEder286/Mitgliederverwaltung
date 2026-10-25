# Projekt-Übergabe: Mitgliederverwaltung TSV Ergoldsbach — Stand vor Implementierung

> Dieses Dokument fasst eine mehrteilige Design-Session zusammen. Es ist als Startpunkt für einen **neuen Chat zur Implementierung** gedacht. Alle inhaltlichen Entscheidungen sind getroffen; offen sind nur die unter Abschnitt 10 gelisteten Punkte (überwiegend Satzungsfragen).

---

## 1. Ziel & Kontext

- **Verein:** TSV Ergoldsbach e.V. (Bayern, BLSV-Mitgliedsverein), ~1.200 Mitglieder.
- **Ausgangslage:** Gewachsene Access-Datenbank mit einer einzigen breiten Tabelle (`Daten16`) plus zahlreichen Abfragen/Formularen/Berichten/Makros. Wird seit ~3 Jahren von einem Nicht-Programmierer betrieben; läuft stabil, aber: nicht versionierbar, nicht im Google-Ökosystem, Einzeldatei, kein Mehrbenutzer.
- **Umgebung:** Google Workspace for Nonprofits vorhanden (AVV/DSGVO geregelt).
- **Nutzer:** nur wenige (Vorstand, Kassier, Mitgliederverwalter, künftig Jugendleiter/Abteilungsleiter) — **kein** Massenzugriff.
- **Anwender-Profil (wichtig für den Ton im neuen Chat):** technisch stark — Apps Script, PHP, Sheets (LET/LAMBDA), Self-Hosting. Baut Oberflächen selbst. Kommuniziert auf Deutsch.

**Kernerkenntnis der Analyse:** Das eigentliche Problem war nie „hoher Wartungsaufwand" oder „reguliertes System", sondern Versionierung / Google-Ökosystem / Einzeldatei / Nachfolge. SEPA-Formatänderungen sind selten (~1× pro Jahrzehnt). **Aber:** pain.008.001.02 → **.08 wird zum 15.11.2026 Pflicht** (plus strukturierte Adressen) — der SEPA-Export muss also ohnehin einmal angefasst werden.

---

## 2. Finale technische Entscheidung

**Google Apps Script Webapp (HtmlService) mit Google Sheets als Datenspeicher.**

### Warum diese Wahl (Abwägung dokumentiert)
- **Dedizierte Vereinssoftware** (z. B. SPG-Verein): verworfen — ~1.500 €/Jahr nicht gerechtfertigt bei so geringem echten Wartungsbedarf; Anwender kann das selbst.
- **AppSheet auf Sheets:** verworfen, sobald das **Rechtekonzept** dazukam — AppSheet Core kann Spalten nur *ausblenden*, nicht *absichern* (IBAN/Führungszeugnis landen trotzdem am Gerät). Rechtlich heikel.
- **Grist (self-hosted):** technisch die sauberste DB-Lösung mit nativen Row/Column-Access-Rules, **aber** bräuchte vereinseigene Infrastruktur (nicht der private Proxmox — 1.200 Personen inkl. Bankdaten) → Governance-/Bus-Faktor-Kosten.
- **Apps Script:** gewählt, weil es als **einzige** Option alle harten Anforderungen gleichzeitig erfüllt: **server-erzwungene** Zeilen- *und* Spalten-Sicherheit (der Nutzer bekommt nie direkten Sheet-Zugriff; das Skript filtert im Code und schickt nur Erlaubtes), **Google-nativ** (bleibt im Vereins-Tenant mit AVV), **kostenlos**, **kein Serverbetrieb/Übergabeproblem**, SEPA/BLSV ohnehin im eigenen Code.

### KRITISCHE Deployment-Regel (daran hängt die gesamte Sicherheit)
- Webapp deployen als **„Ausführen als: Ich (Eigentümer)"**.
- Das Sheet wird mit **niemandem** außer dem Eigentümer geteilt.
- Nutzeridentität für Rollen-Lookup/Protokoll über `Session.getActiveUser().getEmail()`.
- **Wird das Sheet zusätzlich direkt mit Nutzern geteilt, ist die Spaltensicherheit hinfällig.**

### Ehrliche Restkosten (bewusst akzeptiert)
- Oberfläche + CRUD-Schicht komplett handgebaut.
- Integrität (Fremdschlüssel, Guards, Eindeutigkeit) liegt im Code, nicht in der DB.
- Bus-Faktor bleibt Restrisiko → Gegenmittel: Modultrennung, Doku, Sheet als Klartext-Fallback, SEPA-Template-Update als dokumentierte Prozedur.

---

## 3. Datenmodell — Tab-Struktur (eine Entität = ein Tab)

Drei Gruppen, ~14 Tabs. Sensible Daten liegen bewusst in **eigenen** Tabs — das macht die serverseitige Rechteprüfung trivial (unerlaubte Tabs werden für die Rolle gar nicht erst geladen).

### Transaktionale Tabs

**`Mitglied`** — die *Person* (Identität/Kontakt). Bleibt über alle Ein-/Austrittszyklen **eine** Zeile mit **einer** Nummer. Enthält **keine** Bankdaten und **keine** Ein-/Austrittsdaten mehr (→ eigene Tabs).

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `mitglied_id` | Ganzzahl | ✔ PK | Skript-vergeben |
| `mitgliedsnummer` | Text | ✔ | eindeutig |
| `anrede` | Auswahl | – | Herr/Frau/Divers |
| `briefanrede` | Text | – | „Sehr geehrter Herr Bauer" / „Liebe Anna" (Serienbrief) |
| `titel` | Text | – | |
| `vorname` | Text | ✔ | |
| `nachname` | Text | ✔ | |
| `strasse`,`plz`,`ort` | Text | – | Wohnadresse |
| `geburtsdatum` | Datum | – | Alter/Geburtstags-Ehrungen |
| `geschlecht` | Auswahl | – | m/w/d (BLSV) |
| `telefon`,`handy`,`email` | Text | – | |
| `versandart` | Auswahl | – | Post / E-Mail |
| `adresse_ungueltig` | Bool | – | „Post kam zurück" (= alte Query `AdrUnbekanntA`) |
| `adresse_ungueltig_am` | Datum | – | |
| `ehrenmitglied` | Bool | – | **entkoppelt vom Beitrag** (aktuell keine Befreiung) |
| `ehrenmitglied_seit` | Datum | – | |
| `foto_ok` | Bool | – | Foto-/Veröffentlichungs-Einwilligung (DSGVO) |
| `foto_am` | Datum | – | |
| `foto_widerruf` | Datum | – | |
| `sterbedatum` | Datum | – | hat Vorrang → Status „verstorben" |
| `status` | Auswahl | (abgeleitet) | aktiv/ausgetreten/verstorben — vom Skript als Cache geschrieben; Quelle = Zeiträume + Sterbedatum |
| `bemerkung` | Langtext | – | |
| `geaendert_am` | Datum/Zeit | auto | ersetzt `Arbeitsdatum` |

**`Mitgliedschaftszeitraum`** — **NEU, wichtig.** Eine Zeile je Beitritt→Austritt-Zyklus. Löst Wiedereintritt (beliebig oft). „Mitglied seit" und `status` werden hieraus abgeleitet.

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `zeitraum_id` | Ganzzahl | ✔ PK | |
| `mitglied_id` | Ganzzahl FK | ✔ | |
| `eintrittsdatum` | Datum | ✔ | |
| `austrittsdatum` | Datum | – | leer = laufend |
| `kuendigung_eingang` | Datum | – | Eingang der Kündigung |
| `austritt_wirksam` | Datum | – | z. B. 31.12. (Kündigungsfrist) |
| `austrittsgrund` | Auswahl/Text | – | Umzug/Unzufriedenheit/verstorben/… |

**`Abteilung`** — Stammdaten. `abteilung_id` PK, `bezeichnung`, `blsv_sportart` (**neu**), `meldepflichtig` (Bool, **neu**), `aktiv`.

**`Abteilungszugehörigkeit`** — m:n-Verknüpfung. **Keine Beitragsfelder** (aktuell nur ein Vereinsbeitrag; Spartenbeitrag = späterer Erweiterungspunkt = eine zusätzliche Spalte).

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `id` | Ganzzahl | ✔ PK | |
| `mitglied_id` | Ganzzahl FK | ✔ | |
| `abteilung_id` | Ganzzahl FK | ✔ | |
| `funktion` | Auswahl | – | Spieler/Trainer/Abteilungsleiter/… |
| `status` | Auswahl | ✔ | aktiv/passiv (Default aktiv) |
| `eintrittsdatum`,`austrittsdatum` | Datum | – | pro Sparte |

> Eindeutig je (`mitglied_id`,`abteilung_id`).

**`Beitragskonto`** — **reiner Zahlweg (Finanzdaten isoliert).** Ein Konto kann mehrere Personen tragen. Mandat gehört hierher, nicht ans Mitglied.

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `beitragskonto_id` | Ganzzahl | ✔ PK | |
| `kontoinhaber_name` | Text | ✔ | auch bei externem Zahler |
| `kontoinhaber_mitglied_id` | Ganzzahl FK | – | falls Zahler selbst Mitglied |
| `zahlweg` | Auswahl | ✔ | Lastschrift/Überweisung/bar |
| `iban` | Text | bedingt | Pflicht bei Lastschrift |
| `bic` | Text | – | |
| `mandatsreferenz` | Text | bedingt | eindeutig |
| `mandatsdatum` | Datum | bedingt | |
| `rechnungsadresse` | Text | – | falls abweichend |
| `bemerkung` | Langtext | – | |

> **Mandats-Sequenz (FRST/RCUR)** nicht speichern → beim SEPA-Lauf aus Sollstellungs-Historie ableiten. **Mandatsverfall 36 Monate** beim Lauf prüfen.

**`Beitragsgemeinschaft`** — der gedeckelte **Familien-/Ehegattenverbund** (Pauschale). Bewusst getrennt vom Konto, damit ein Konto zusätzlich Einzelzahler tragen kann.

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `beitragsgemeinschaft_id` | Ganzzahl | ✔ PK | |
| `bezeichnung` | Text | ✔ | z. B. „Familie Wagner" |
| `festbetrag` | Dezimal(8,2) | – | Pauschale; leer = Mitglieder zahlen Einzeltarife |
| `bemerkung` | Langtext | – | |

**`Beitragsart`** — individueller Tarif. `beitragsart_id` PK, `bezeichnung`, `betrag`, `intervall` (jährlich/halbjährlich), `aktiv`. (Existiert in Access schon als Tabelle.)

**`Sollstellung`** — Zahlungshistorie **je Konto je Jahr** (ersetzt flaches Feld `Zahlung=NG`, behält Historie).

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `sollstellung_id` | Ganzzahl | ✔ PK | |
| `beitragskonto_id` | Ganzzahl FK | ✔ | |
| `jahr` | Ganzzahl | ✔ | |
| `soll_betrag` | Dezimal(8,2) | ✔ | errechneter Einzug (Snapshot) |
| `status` | Auswahl | ✔ | offen/bezahlt/gemahnt/ruecklastschrift/widerspruch/storniert |
| `einzugsdatum`,`buchungsdatum` | Datum | – | |
| `mahnstufe` | Ganzzahl | ✔ | Default 0 |
| `ruecklastschrift_grund` | Text | – | |
| `bemerkung` | Langtext | – | |

> Eindeutig je (`beitragskonto_id`,`jahr`). Migration: `Zahlung=NG` → status `ruecklastschrift`.

**`Ehrungsregel`** — Konfig der Stufen (datengetrieben, nicht in Formeln verdrahtet). `ehrungsregel_id` PK, `typ` (Mitgliedsjubiläum/Geburtstag/Funktionsjubiläum), `schwelle` (Jahre/Alter), `bezeichnung` (Stufe), `verband` (Verein/BLSV), `aktiv`.

**`Ehrung`** — Verleihungs-Log. `ehrung_id` PK, `mitglied_id` FK, `ehrungsregel_id` FK, `faellig_jahr`, `status` (fällig/verliehen/verschoben/abgelehnt), `verliehen_am`, `veranstaltung`, `bemerkung`. Eindeutig je (`mitglied_id`,`ehrungsregel_id`).

**`Qualifikation`** — **NEU.** Trainerlizenzen + Führungszeugnis-**Status** (hochsensibel, isoliert).

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `qualifikation_id` | Ganzzahl | ✔ PK | |
| `mitglied_id` | Ganzzahl FK | ✔ | |
| `art` | Auswahl | ✔ | C-Trainer/ÜL-B/JuLeiCa/Erste-Hilfe/**Erw. Führungszeugnis** |
| `ausgestellt_am` / `eingesehen_am` | Datum | – | bei FZ: nur „eingesehen am" |
| `gueltig_bis` | Datum | – | das Wertvolle (Ablauf-Filter) |
| `ergebnis` | Auswahl | – | bei FZ nur „ok" (nie Inhalt) |
| `bemerkung` | Text | – | |

> **§72a SGB VIII:** Beim Führungszeugnis nur festhalten, *dass* eingesehen wurde und *bis wann gültig* — **nicht** den Inhalt; Dokument **nie** in der App.

### Konfig-/Stamm-Tabs (klein, cachebar)
`Beitragsart`, `Beitragsgemeinschaft`, `Abteilung`, `Ehrungsregel` (siehe oben) plus:

**`Benutzer`** — Herz des Rechtekonzepts. `benutzer_id` PK, `email` (Google-Login), `rolle` (siehe Abschnitt 5), `abteilung_id` (nur bei Abteilungsleiter = Scope), `mitglied_id` (optional), `aktiv`.

### Technische Tabs (Apps-Script-spezifisch)
- **`_Konfig`** — Enums, laufendes Beitragsjahr, **ID-Zähler** je Tab.
- **`_Protokoll`** — append-only Änderungslog (wer/was/wann). Billig, größter Governance-/Bus-Faktor-Gewinn (Sheets-Versionshistorie ist zu grob).

---

## 4. Zentrale Modell-Regeln (die „Warum"-Logik)

- **Orthogonalität:** Ein Mitglied trägt drei *unabhängige* Bezüge: `beitragsart_id` (*was* zahle ich) · `beitragskonto_id` (*wer* zahlt) · `beitragsgemeinschaft_id` (optional: bin ich in gedeckeltem Verbund). Diese Trennung löst alle Konstellationen.
- **Ehegatte = Fall B (bei TSV geklärt):** ein **Pauschalbetrag** fürs Paar → `Beitragsgemeinschaft` mit `festbetrag`. Zwei Mitgliederzeilen, ein Konto, eine Gemeinschaft. **Nicht** als 0-€-Beitragsart, **nicht** als ermäßigter Einzelsatz.
- **Familienbeitrag:** `festbetrag` der Gemeinschaft, **einmal** gezogen.
- **SEPA-Berechnung je Beitragskonto** (über Konten iterieren, nicht über Mitglieder): `Σ(festbetrag jeder distinkten Gemeinschaft auf dem Konto, je einmal) + Σ(Beitragsart-Betrag jedes Mitglieds auf dem Konto OHNE festbetrag-Gemeinschaft)`. Beispiel Wagner: Familie 180 € + erwachsener Sohn Felix 100 € (eigener Beitrag, selbes Konto) = **280 €**.
- **Guard statt Cascade:** Tritt ein Kontoinhaber aus, werden die Abhängigen **nicht** automatisch mit-ausgetreten. Sie werden zu Waisen (Mandat deckt sie nicht mehr) → **blockieren/warnen + neu zuordnen** (neuer Zahler+Mandat / Selbstzahler / ebenfalls Austritt).
- **Gemeinschafts-Konsistenz:** alle Mitglieder einer Gemeinschaft müssen dasselbe `beitragskonto_id` haben.
- **Ehrungs-Ableitung:** Jahresliste = neu fällige (Jahre == schwelle im Jahr Y, als `fällig` materialisiert) + offene Vorjahre (`status ∈ {fällig, verschoben}`) − bereits `verliehen`. Kein jährliches Zurücksetzen; Nachholung automatisch; keine Doppelehrung. Geburtstage = gleicher Mechanismus (`typ=Geburtstag`).
- **Abgeleitet, NICHT speichern:** SEPA-Betrag/Gesamtbeitrag (Snapshot lebt in `Sollstellung`), Mitgliedsjahre, Alter, Ehrungsanspruch, „Mitglied seit", `status` (Cache-Ausnahme fürs Filtern).

---

## 5. Rollen- & Rechtekonzept

Zwei Dimensionen: **Zeilen** (wen sieht jemand) + **Felder** (welche Daten). Server erzwingt beides.

| Rolle | Zeilen-Sicht | Sensible Felder | Darf ändern |
|---|---|---|---|
| Vorstand / Admin | alle | alle | alles, inkl. Rechtevergabe |
| Kassier | alle | Finanzdaten (IBAN, Mandat, Sollstellung) | Konten, SEPA-Lauf, Mahnung |
| Mitgliederverwalter | alle | Stammdaten/Kontakt (keine Finanzen) | Mitglieder, Abteilungen, Ehrungen |
| Jugendleiter | Jugendmitglieder | Führungszeugnis-Status | FZ/Qualifikation der Jugend |
| Abteilungsleiter | nur eigene Abteilung | Kontakt — keine Finanzen, kein FZ | Zugehörigkeit/Funktion seiner Abteilung |

Feld-Sensibilitätsklassen: öffentlich-intern / Kontakt / **Finanzen** / **hochsensibel (FZ)**. Umsetzung: Skript lädt sensible Tabs (`Beitragskonto`, `Qualifikation`) für unberechtigte Rollen gar nicht erst.

---

## 6. Migration `Daten16` → neues Modell

- **`Daten16` ist die einzige Quelle**; die Access-Tabelle `Mitglied` ist leer.
- **Nur ein Vereinsbeitrag** aktuell → Abteilungs-Betragsspalten (`Betrag 1–4`, `Beitrag Abt n`) sind tote Altlast.
- **Mapping (Auszug):** ID→`mitglied_id`; MitglNr→`mitgliedsnummer`; Stammdaten→`Mitglied.*`; EinDat/AusDat→`Mitgliedschaftszeitraum`; BANK/IBAN/BIC/Kontoinhaber→`Beitragskonto`; `Zahlung=NG`→`Sollstellung(ruecklastschrift)`; `Arbeitsdatum`→`geaendert_am`.
- **Verwerfen:** BLZ, KONTO, ReZiff (überall 0), Gesamtbeitrag, Betrag/Beitrag-Abt-Spalten. **Hilfstabellen** (Bankleitzahlen, BLZBIC, ibans, Postlz, BeitragseinzugT, Importfehler) verwerfen/archivieren. `AustritteAb2010` → historische Zeitraum-Zeilen.
- **Kniffliger Einmalschritt:** `Zahler`-Feld → `Beitragskonto`-Cluster. Heuristik:
  - Zahler trägt **Pauschalbetrag** + Abhängige(r) hat **keinen eigenen Beitrag** → **Beitragsgemeinschaft**.
  - Abhängige(r) hat **eigenen Beitrag** → nur gemeinsames **Konto**, keine Gemeinschaft (Fall „erwachsener Sohn").
  - Unklare Mischfälle → **Prüfliste ausgeben**, nicht raten.

---

## 7. Apps-Script-Bauhinweise

- **IDs nie über Zeilenposition** (Zeilen verschieben sich beim Sortieren/Löschen). Jeder Tab hat eine skript-vergebene ID-Spalte (Zähler in `_Konfig`). FKs = diese ID-Werte.
- **Performance:** jeden Tab **einmal** per `getValues()` laden, Joins über **In-Memory-Maps** (kein zellweiser Lookup). Schreibzugriffe mit `LockService` serialisieren, Konfig per `CacheService`. 1.200 Zeilen sind unkritisch; 6-Minuten-Limit beachten.
- **Integrität im Code:** Fremdschlüssel, Guards (Abschnitt 4), Eindeutigkeiten selbst erzwingen.
- **Struktur:** eine Datenzugriffs-Schicht + ein Modul je Entität; `_Protokoll` bei jedem Schreibzugriff.
- **Sicherheit:** siehe Deployment-Regel (Abschnitt 2) — „Ausführen als Eigentümer", Sheet privat, `Session.getActiveUser().getEmail()`.
- **Keine verfrühte Denormalisierung.** Erst messen; falls eine Ansicht träge wird, per Trigger materialisierten View-Tab erzeugen.
- **SEPA:** Ziel-Format **pain.008.001.08** (Pflicht ab 15.11.2026) inkl. **strukturierter Adressen**. Update-Prozedur dokumentieren (Bus-Faktor).
- **BLSV:** Bestandserhebung läuft über **verein360** (Frist 31.01.), Excel-Import; Person in mehreren Abteilungen zählt **je Sportart**, aber **einmal** als Mitglied.

---

## 8. Bereits erzeugte Artefakte (aus der Design-Session)

1. **Spaltenspezifikation v1** (`Datenmodell_Mitgliederverwaltung_TSV.md`) — Vorläufer dieses Dokuments (9 Tabs). Durch die hier enthaltene Fassung ersetzt/erweitert.
2. **ER-Diagramme** — Kernmodell mit `Beitragskonto`/`Beitragsgemeinschaft`-Trennung.
3. **Klickbares HTML-Mockup** (`mockup_mitgliederverwaltung.html`) — für den Walkthrough mit dem Mitgliederverwalter; zeigt Mitglieder, Detail, Beitragskonten (inkl. Wagner-Fall 280 €), SEPA, Offene Beiträge, Ehrungen, BLSV. Nur Klick-Mockup, keine echte Logik.

---

## 9. OFFENE ENTSCHEIDUNGEN (vor/während der Implementierung klären)

1. **Ehrungsjahre (Satzung):** ab *letztem* Eintritt oder *Gesamt*-Mitgliedschaft über Unterbrechungen? (Über `Mitgliedschaftszeitraum` ist jetzt **beides** rechenbar.)
2. **Stichtag:** Jubiläum im *Kalenderjahr* erreicht (empfohlen) oder auf den *exakten* Tag?
3. **Ehrungsstufen-Set:** welche Jahre/Alter genau (z. B. 25/40/50/60 für Jubiläen; 70/75/80/… für Geburtstage) → Seed-Zeilen für `Ehrungsregel`.
4. **Rollen:** die 5-Rollen-Matrix (Abschnitt 5) so übernehmen oder anpassen (z. B. kein eigener Jugendleiter-Zugang)?
5. **Jugendmitglieder / gesetzliche Vertreter:** Verein führt Jugend → Modellierung der Erziehungsberechtigten als Felder am Mitglied oder als Verweis auf ein anderes Mitglied? (noch offen)
6. **Bestätigt:** Ehrenmitglied = Merkmal ohne Beitragsbefreiung; Trainerlizenz/FZ leben in diesem System, aber rollenbeschränkt sichtbar.

---

## 10. Empfohlener erster Implementierungsschritt

1. Offene Punkte 1–5 klären.
2. Google Sheet mit den ~14 Tabs + Spaltenköpfen anlegen (aus Abschnitt 3).
3. Datenzugriffs-Schicht + `_Konfig`-ID-Vergabe bauen.
4. **Migrationsskript** `Daten16` → Tabs schreiben, mit Prüfliste für die `Zahler`-Cluster-Mischfälle — liefert echte Daten statt Beispieldaten.
5. Erst danach UI (HtmlService) + Rollenfilter; SEPA-/BLSV-/Ehrungs-Module zuletzt.
