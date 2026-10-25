# Mitgliederverwaltung TSV Ergoldsbach e. V.

Google-Apps-Script-WebApp mit Google Sheets als Datenspeicher. Keine weitere Infrastruktur, keine externen Dienste.

| Wofür | Wo |
|---|---|
| Konzept, Architektur, offene Punkte | `docs/PHASE0_Konzept.md`, `docs/ENTSCHEIDUNGEN.md` |
| Einrichtung, Deployment, Updates | `docs/BETRIEB.md` |
| Code-Aufbau und Schnittstellen | `docs/ENTWICKLUNG.md` |
| Datenmodell (maßgeblich) | `docs/daten/*.csv` (Ausgangspunkt: `docs/Mitgliederverwaltung_TSV_Ergoldsbach.xlsx`) |
| Sicherheitsregeln, Go-Live-Stand | `docs/Sicherheitsregeln.md`, `docs/GOLIVE.md` |
| Register (C6), Verarbeitungsverzeichnis (D2) | `docs/REGISTER.md`, `docs/VERARBEITUNGSVERZEICHNIS.md` |

```
npm run check   # Syntax, Namensraum, Kopfkommentare, Scopes
npm test        # Tests (Node ≥ 20, keine Abhängigkeiten)
npm run push    # check + test + clasp push
```

Im Repo liegen ausschließlich erfundene Testdaten. Echtdaten nie einchecken.
