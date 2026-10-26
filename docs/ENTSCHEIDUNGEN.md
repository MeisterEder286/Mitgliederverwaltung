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
| 10/2026 | Erweiterung | Bezahlhistorie, Umstellung auf Einzelbeitrag beim Ausscheiden aus der Familie, Verlängerung bei Schule/Studium/Ausbildung mit prognostiziertem Ende, Links zu Antrag/Mandat, alle Anschreiben je Person, Auswertungen und Funktionen aus dem Access-VBA | Johann |
| 10/2026 | Datenmodell | neue Felder `Mitglied.ausbildung_art/ausbildung_bis/ausbildung_nachweis_am`; neue Tabs `Dokument`, `Vorlage`, `Anschreiben`; `_Konfig` familie_*, brief_*; CSV ist ab jetzt allein maßgeblich (xlsx-Export nur mit `--ueberschreiben`) | Umsetzung |
| 10/2026 | E-Mail-Versand | WebApp versendet E-Mails direkt (Briefkopf, Austritts-/Aufnahmebestätigung, Vorabinformation, Rückfrage Zahler …). **Neuer Scope `script.send_mail`** (engster Scope für Versand, kein Postfachzugriff; A5). Absender Funktionskonto, `replyTo` fachlich (C5), Hauptschalter `mail_aktiv` (Standard aus), Testmodus `mail_test_an`, Kontingentprüfung (C4) | Johann |
| 10/2026 | Mandatsänderung | Neue IBAN bei gleichem Inhaber und Mandat: Das Konto merkt sich die zuletzt eingezogene IBAN (`iban_vorher`, `iban_geaendert_am`, nie im Snapshot). Der nächste SEPA-Lauf meldet `AmdmntInd` – gleiche Bank (DE-BLZ): alte IBAN (`OrgnlDbtrAcct`), andere Bank: `SMNDA`. Erledigt nach dem nächsten bezahlten Einzug. Sequenz bleibt wie abgeleitet (FRST bei SMNDA seit Rulebook 2016 nicht mehr Pflicht – mit Hausbank beim Banktest bestätigen) | Johann |
| 10/2026 | Beitragsänderung | Geführter Ablauf in Finanzen: neue Beträge je Beitragsart und je Pauschale ab 01.01. eines künftigen Jahres, Vorschau alt/neu je Konto, Übernahme (`stammdaten_bearbeiten`), Vorabinformation über „Schreiben“. EINE Zeile je Tarif: neuer Betrag in `betrag`/`festbetrag`, alter in `betrag_vorher`/`festbetrag_vorher` bis `gueltig_ab`/`festbetrag_ab` – frühere Jahre rechnen weiter richtig. Nur für Jahre ohne Sollstellungen | Johann |
| 10/2026 | Jugendalter | einstellbar über `_Konfig.jugend_bis_alter` (Verwaltung → Einstellungen, 10–27), Standard 17 | Johann |
| 10/2026 | Anonymisierung (X9) | Die Mitgliedsnummer bleibt bei anonymisierten Datensätzen erhalten (Anker für Buchungen und Papierablage) und wird nie neu vergeben | Johann |
| 10/2026 | Online-Aufnahmeantrag | läuft auf der Vereins-Homepage (WordPress) und liefert XML + PDF mit Unterschrift. Statt per Mail: WordPress schickt beides an ein eigenes Eingangs-Skript (Variante a), das sie im Drive-Ordner ablegt und eine Zeile in die getrennte Eingangstabelle schreibt. Die WebApp liest sie mit dem vorhandenen Scope (`EINGANG_ID`), zerlegt die XML auf dem Server, verknüpft das PDF als Dokument. Kein öffentliches Formular und kein Drive-Scope in der WebApp (`docs/EINGANG.md`). Mandatsdatum = Unterschriftsdatum auf dem PDF (`unterschrift_am`) | Johann |
| 10/2026 | Interne Notizen | Notizen/Rückfragen/Wiedervorlagen je Person oder Konto mit Leserkreis (Verwaltung, Finanzen, Abteilung, Jugendleitung); Teil von Auskunft, Anonymisierung und Löschfrist | Johann |

## Gemeldete Widersprüche aus dem Access-VBA (nicht stillschweigend aufgelöst)

| # | Thema | Access/VBA | Regeln/Datenmodell | Umgang |
|---|---|---|---|---|
| VBA1 | IBAN aus Beitritts-XML | Modul `BeitrittsXmlImportieren` übernimmt IBAN/BIC/Kontoinhaber | Sicherheitsregel D3 (keine IBAN über Webformulare) | **Entschieden 10/2026 (Johann): Bankdaten werden übernommen.** Bewusste, dokumentierte Abweichung von D3. Absicherung: Import nur durch Vorstand/MV, IBAN-Prüfung, Vorschau vor dem Speichern, Protokoll ohne Klartext-IBAN, Datei wird nur im Browser gelesen und nicht gespeichert. Das SEPA-Mandat braucht weiterhin die Unterschrift (Mandatsdatum prüfen). |
| VBA2 | Mitgliedsnummer | `MitglNr_DblClick` vergab Lücken; Beitritts-Modul: `LUECKEN_FUELLEN = False` | `mitgliedsnummer_wiederverwendung = nein` | **Entschieden 10/2026: immer neue Nummer (höchste + 1), keine Lücken.** |
| VBA3 | Halbjahresbeitrag | `LaufenderEinzugHalb` | `beitrag_anteilig` | **Entschieden 10/2026: halber Beitrag bei Eintritt ab 01.07.** (`beitrag_anteilig = halbjahr`). |
| – | Familienbeitrag | – | – | **Bestätigt 10/2026:** Kinder bis 17, mit Ausbildungsnachweis bis 25; „Kind“ = gesetzliche Vertretung eingetragen oder > 15 Jahre jünger als das älteste Mitglied der Gemeinschaft. |

## Vorläufig gesetzt (noch zu bestätigen, im Code als `// OFFEN:` markiert)

| Thema | vorläufig | Wo |
|---|---|---|
| Rollenmatrix | Vorstand + Mitgliederverwalter: alles; Kassier: Kontakt + Finanzen, **keine** Konto-Änderung; Jugendleiter: Minderjährige + FZ; Abteilungsleiter: eigene Abteilung, Kontakt, FZ erfassen/sehen für Funktionsträger seiner Abteilung, kein Vereinsaustritt | `src/lib/rechte.js` |
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
| Anonymisierung | Zeiträume, Zugehörigkeiten, Einwilligungen, Qualifikationen werden entfernt; Mitgliedsnummer bleibt (X9 entschieden); Funktionen/Ehrungen je `_Konfig.chronik_bei_anonymisierung` | `src/lib/loeschung.js` |
