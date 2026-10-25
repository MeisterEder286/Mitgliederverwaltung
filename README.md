# Mitgliederverwaltung TSV Ergoldsbach e. V.

Google-Apps-Script-WebApp mit Google Sheets als Datenspeicher. Keine weitere Infrastruktur, keine externen Dienste,
keine externen Schriften oder Bibliotheken. Mobil bedienbar, Rollen- und Feldrechte serverseitig erzwungen.

## Was das System kann

| Bereich | Funktionen |
|---|---|
| **Start** | Kennzahlen je Rolle, Schnellsuche, „Zu erledigen“, Geburtstage der Woche |
| **Mitglieder** | Liste mit Suche/Filter/Sortierung (lokal im Browser), Detail mit Reitern, Bearbeiten mit Versionsprüfung, Neuaufnahme mit Dublettenprüfung und automatischer Nummer, Austritt mit Konto-Guard (Waisen), Wiedereintritt, Sterbefall, Listen (Kontakt, Jahrgang, Geburtstage, Passive) als CSV/Druck |
| **Abteilungsleitung** | „Meine Abteilung“, Zuordnen per Exaktsuche (zwei Merkmale, Einmal-Token), Funktionen der eigenen Abteilung, FZ-Ampel und Einsicht erfassen |
| **Funktionen** | Ämterhistorie mit von/bis, nie gelöscht; Nachweispflicht aus der Funktionsart |
| **Finanzen** | Beitragskonten (IBAN maskiert, Aufdecken protokolliert), Gemeinschaften (Familie/Ehepaar), Beitragsberechnung je Konto, Sollstellungslauf, Rücklastschriften/Mahnstufen, SEPA pain.008.001.08 (XSD-geprüft, FRST/RCUR, Mandatsverfall, optional Vier-Augen), Klärliste, Tarifwechsel, Buchhaltungs-Export |
| **Nachweise** | Führungszeugnis nach § 72a (nur Datum/Vermerk), Lizenzen, Wiedervorlage, Löschfrist ab Ende der letzten pflichtigen Funktion |
| **Ehrungen** | Jahresliste (ab letztem Eintritt, umschaltbar), Nachholung, keine Doppelehrung, JHV-Liste, Urkunden-Export |
| **Berichte** | BLSV-Bestandserhebung + CSV, Jahresstatistik einfrieren, Jahresvergleich, Geburtstage/Jubiläen (nur mit Einwilligung), Abteilungsübersicht, Ein-/Austritte |
| **Datenschutz** | Einwilligungen mit Verlauf, Betroffenenanfragen mit Frist, Auskunft Art. 15, Löschkonzept in 3 Stufen (sperren, anonymisieren, löschen), Protokoll mit Rollenfilter und Bereinigung |
| **Verwaltung** | Benutzer und Rollen, Einstellungen, Stammdaten, Datenqualität (24 Prüfregeln), System/Cache, Messwerte |
| **Betrieb** | nächtliche Wartung (Status, Fristen, Löschdaten, Protokoll-Bereinigung), Messung je Aufruf, Backup als eigenes Projekt, Migration aus Access (`Daten16`) mit Prüfbericht |

## Dokumentation

| Wofür | Wo |
|---|---|
| Kurzanleitung für Benutzer | `docs/BEDIENUNG.md` |
| Einrichtung, Deployment, Trigger, Updates | `docs/BETRIEB.md` |
| Migration aus Access | `docs/MIGRATION.md` |
| Backup | `backup/LIESMICH.md` |
| Code-Aufbau, Schnittstellen, Konventionen | `docs/ENTWICKLUNG.md` |
| Konzept, Entscheidungen | `docs/PHASE0_Konzept.md`, `docs/ENTSCHEIDUNGEN.md` |
| Datenmodell (maßgeblich) | `docs/daten/*.csv` (Ausgangspunkt `docs/Mitgliederverwaltung_TSV_Ergoldsbach.xlsx`) |
| Sicherheit | `docs/Sicherheitsregeln.md`, `docs/SICHERHEITSPRUEFUNG.md`, `docs/GOLIVE.md` |
| Register (C6), Verarbeitungsverzeichnis (D2) | `docs/REGISTER.md`, `docs/VERARBEITUNGSVERZEICHNIS.md` |

## Entwicklung

```
npm run check     # Syntax, gemeinsamer Namensraum, Kopfkommentare, Scopes, externe Ressourcen
npm test          # Server- und Fachlogik-Tests (Node ≥ 20, keine Abhängigkeiten)
npm run test:ui   # Oberflächentests in Chromium gegen den echten Servercode (Playwright)
npm run vorschau  # Oberfläche lokal ansehen (--gross: 1.200 synthetische Mitglieder)
npm run push      # check + test + test:ui + clasp push
npm run schema    # Datenmodell-CSV → src/lib/schema.js
```

Im Repo liegen ausschließlich erfundene Testdaten. Echtdaten nie einchecken (`migration/` ist ausgeschlossen).
