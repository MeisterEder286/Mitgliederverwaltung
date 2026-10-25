# Entscheidungslog

Nachvollziehbar festgehalten, **was** wann entschieden wurde und **warum**. Für einen Nachfolger.

| Datum | Thema | Entscheidung | Quelle |
|---|---|---|---|
| 10/2026 | Plattform | Apps-Script-WebApp + Google Sheets, „Ausführen als Ich“, Domain-Zugriff | Übergabe §2 |
| 10/2026 | Datenmodell | xlsx `Mitgliederverwaltung_TSV_Ergoldsbach.xlsx` als Ausgangspunkt; ab Phase 1 sind `docs/daten/*.csv` maßgeblich | Johann, Phase 0 |
| 10/2026 | V1–V10 | alle freigegeben (version-Spalten, Ehrung-Eindeutigkeit inkl. Funktion, Benutzer je Rollenzuweisung, „halbjährlich“ gestrichen, Rollenmatrix im Code, `nur_funktionstraeger`, Sichtklassen, Migrationsregel Abt. 2–4, `_Messung`, keine Rechte-Automatik aus Ämtern) | Johann, Phase 0 |
| 10/2026 | Architektur | ein Basis-Snapshot im Cache, Rollenschnitt pro Anfrage, Einbettung schaltbar, keine zweite Persistenzschicht bis zur Messung | Johann, Phase 0 |
| 10/2026 | SEPA | 2026 extern gelöst; Generator pain.008.001.08 nur für künftige Läufe, Phase 4 | Johann |
| 10/2026 | Ehrungen | Mitgliedsjubiläum ab **letztem Eintritt**; ein Austritt setzt zurück. Umschaltung auf „gesamt“ bleibt als `_Konfig.ehrung_zaehlweise` erhalten | Johann |
| 10/2026 | Führungszeugnis | Abteilungsleiter **dürfen FZ-Einsicht erfassen** (`qualifikation_erfassen`) | Johann |
| 10/2026 | `Daten16` | `Zahlung` enthält nur `NG` (= beim Einzug nicht gezahlt) → `Sollstellung.status = ruecklastschrift`; `Personalien` ist nur ein Access-Formular; Funktionen gibt es im Altbestand nicht | Johann |
| 10/2026 | `Daten16.Zahler` | enthält die **MitglNr** des Zahlers → Grundlage der Konto-Cluster in der Migration | Johann |
| 10/2026 | Reihenfolge | erst das komplette System (Phasen 3–5), **Migration ganz am Schluss** | Johann |

## Vorläufig gesetzt (noch zu bestätigen, im Code als `// OFFEN:` markiert)

| Thema | vorläufig | Wo |
|---|---|---|
| Rollenmatrix | Vorstand + Mitgliederverwalter: alles; Kassier: Kontakt + Finanzen, **keine** Konto-Änderung; Jugendleiter: Minderjährige + FZ; Abteilungsleiter: eigene Abteilung, Kontakt, FZ erfassen/sehen für Funktionsträger seiner Abteilung, kein Vereinsaustritt | `src/lib/rechte.js` |
| Jugend-Definition | bis einschließlich 17 Jahre | `_Konfig.jugend_bis_alter` |
| FZ-Fristen | `Qualifikationsart` gewinnt vor `_Konfig.fz_wiedervorlage_monate` und `Aufbewahrungsfrist` | Phase 5 |
| Backup | eigenes, nicht deploytes Skriptprojekt mit Drive-Scope | `backup/` |
| Exaktsuche Abteilungsleiter | **immer zwei Merkmale** (Nachname + Mitgliedsnummer oder Geburtsdatum) statt „Nummer oder Name+Geburtsdatum“ wie im Mockup – Sicherheitsprüfung H1/M3 (Durchzählen der Nummern). Zuordnen nur mit Einmal-Token aus der Suche. | `src/modul/Mitglieder.js` |
| Kassier und Konten | Kassier ändert keine Konto-Stammdaten/IBAN (`konto_bearbeiten` nur Vorstand/MV) | `src/lib/rechte.js` |
| Vereinsweite Berichte | BLSV, Jahresvergleich, Einfrieren nur mit Zeilensicht „alle“ | `src/modul/Berichte.js` |
| Beitrag bei unterjährigem Eintritt | voller Jahresbeitrag (`beitrag_anteilig = nein`), anteilig als Option vorbereitet | `src/lib/beitrag.js` |
| SEPA-Sequenz | FRST, solange unter dem Mandat noch kein Einzug „bezahlt“ war; Option „immer RCUR“ | `src/lib/sepa.js` |
| Adressen in der SEPA-Datei | unvollständige Zahleradressen werden weggelassen (Warnung) – mit Hausbank klären | `src/lib/sepa.js` |
| Vier-Augen-Prinzip SEPA | schaltbar `_Konfig.sepa_vier_augen` (Standard aus) | `src/modul/Finanzen.js` |
| Snapshot | Start nur Kern; Finanzen/Historie werden je Sitzung einmal nachgeladen | `src/lib/snapshot.js` |
| Anonymisierung | Zeiträume, Zugehörigkeiten, Einwilligungen, Qualifikationen werden entfernt; Mitgliedsnummer bleibt (X9 offen); Funktionen/Ehrungen je `_Konfig.chronik_bei_anonymisierung` | `src/lib/loeschung.js` |
