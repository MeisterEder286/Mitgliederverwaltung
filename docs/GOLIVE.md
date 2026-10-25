# Go-Live-Checkliste (Teil E) – Stand je Phase

Legende: ✅ im Code/Repo erledigt und geprüft · 🔧 manuell in Google zu prüfen · ⏳ spätere Phase · — nicht zutreffend

## Sicherheit
| Punkt | Stand | Nachweis |
|---|---|---|
| Ausführen als Ich | ✅/🔧 | `appsscript.json` `executeAs: USER_DEPLOYING`, `check.js` erzwingt es; Deployment-Dialog prüfen |
| Zugriff eingeschränkt | ✅/🔧 | `access: DOMAIN`; Deployment-Dialog prüfen |
| Rollenprüfung in jeder Server-Funktion | ✅ | jede öffentliche Funktion läuft über `Api.ausfuehren` → `Zugriff.pruefe`; Zeilenschutz `Snapshot.pruefeMitglied`; Sicherheitsprüfung `docs/SICHERHEITSPRUEFUNG.md` mit Regressionstests `test/sicherheit.test.js` |
| Keine dynamischen IDs vom Client | ✅ | `DB_ID` nur aus Script Properties |
| OAuth-Scopes minimal | ✅ | 3 Scopes, `check.js` lehnt andere ab |
| Datei-/Ordnerfreigaben | 🔧 | Ordner nur Funktionskonto |
| Öffentliche Schreibziele isoliert | — | Aufnahmeanträge sind eigenes Projekt (später) |
| LockService | ✅ | `DB.mitSperre` |
| Tokens | — | kein Token-Zugang |
| Secrets in PropertiesService | ✅ | `DB_ID` |
| Fehlermeldungen generisch | ✅ | `Api.ausfuehren`, Test `test/api.test.js` |
| Audit-Log, Löschfrist | ✅ | `_Protokoll` inkl. Abweisungen, Einsicht sensibler Daten und Exporte; Bereinigung monatlich in `wartungNachts` |

## Bereitstellung
| Punkt | Stand |
|---|---|
| Slug `/verwaltung`, Redirect | 🔧 |
| Übersichtsseite verlinkt | 🔧 |
| Deployment-ID dokumentiert | 🔧 `docs/REGISTER.md` |
| Echtes Mobilgerät | 🔧 |
| Keine externen CDNs/Fonts | ✅ `check.js` |

## Betrieb & Nachfolge
| Punkt | Stand |
|---|---|
| Eigentum Funktionskonto, geteilte Ablage | 🔧 |
| Testumgebung, keine Echtdaten | ✅/🔧 nur synthetische Daten im Repo; Test-Deployment anlegen |
| Backup + Wiederherstellungstest | ✅/🔧 eigenes Projekt `backup/` (Wiederherstellungstest-Funktion), einrichten und einmal testen |
| Kontingente geprüft | 🔧 `docs/BETRIEB.md` §5 |
| E-Mail-Absender | — WebApp versendet keine Mails; Backup-Fehlermails an das Funktionskonto |
| Register-Eintrag | ✅ Entwurf `docs/REGISTER.md`, IDs eintragen 🔧 |
| Kopfkommentare | ✅ `check.js` erzwingt sie |

## Recht & Datenschutz
| Punkt | Stand |
|---|---|
| Impressum/Datenschutz verlinkt | ✅ Fußzeile; URLs in `_Konfig` prüfen 🔧 |
| Verarbeitungsverzeichnis | ✅ Entwurf `docs/VERARBEITUNGSVERZEICHNIS.md` |
| Nur erforderliche Felder, keine IBAN im öffentlichen Formular | ✅ (kein öffentliches Formular) |
| Löschfristen technisch umgesetzt | ✅/🔧 `Aufbewahrungsfrist` → `loeschbar_ab` (nächtlich), Löschliste mit 3 Stufen; Fristen vom Vorstand bestätigen lassen |
| Keine externen Dienste | ✅ |

## Fachliche Abnahme (vor Go-Live mit Echtdaten)
| Punkt | Stand |
|---|---|
| Migration im Testsheet, Prüfbericht abgearbeitet | 🔧 `docs/MIGRATION.md` |
| Zahlen gegen Access abgeglichen (Mitglieder je Status/Abteilung, Soll-Summe) | 🔧 |
| SEPA-Testdatei bei der Hausbank eingereicht (pain.008.001.08) | 🔧 |
| Gläubiger-ID, Vereinskonto, Vereinsanschrift in `_Konfig` | 🔧 |
| Beiträge, Ehrungsstufen, Funktionsarten, Aufbewahrungsfristen vom Vorstand bestätigt | 🔧 |
| Benutzer je Rolle angelegt, Rundgang je Rolle auf dem Handy | 🔧 |
