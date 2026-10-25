# Verzeichnis von Verarbeitungstätigkeiten – Eintrag (Sicherheitsregel D2, Art. 30 DSGVO)

Entwurf, wird mit jeder Phase fortgeschrieben. Fristen sind Vorschläge aus `Aufbewahrungsfrist`
(keine Rechtsberatung), vom Vorstand zu bestätigen.

| Punkt | Inhalt |
|---|---|
| Verantwortlicher | TSV Ergoldsbach e. V., vertreten durch den Vorstand |
| Bezeichnung | Mitgliederverwaltung (Apps-Script-WebApp, Google Workspace for Nonprofits) |
| Zwecke | Durchführung der Mitgliedschaft (Art. 6 Abs. 1 b), Beitragseinzug, Bestandsmeldung an den BLSV, Ehrungen, Nachweis Führungszeugnisse nach § 72a SGB VIII, Erfüllung von Betroffenenrechten, steuerliche Aufbewahrung |
| Betroffene | Mitglieder, ehemalige Mitglieder, gesetzliche Vertreter Minderjähriger, Kontoinhaber (auch Nicht-Mitglieder), Funktionsträger ohne Mitgliedschaft, Benutzer des Systems |
| Datenkategorien | Stammdaten, Kontakt, Geburtsdatum, Geschlecht; Mitgliedschafts-, Abteilungs- und Funktionshistorie; Bankverbindung und SEPA-Mandat; Beitragsbuchungen; Vermerk FZ-Einsicht (nur Datum/„ohne einschlägigen Eintrag“, nie Inhalt); Lizenzen; Einwilligungen; Ehrungen; Änderungsprotokoll; Zugriffsmessungen (ohne Personenbezug) |
| Empfänger | intern nach Rolle (Vorstand, Mitgliederverwaltung, Kassier, Abteilungs-/Jugendleitung); BLSV (anonyme Summen); Hausbank (SEPA-Datei); Google als Auftragsverarbeiter (AVV) |
| Drittland | keine Übermittlung durch den Verein; Google-Infrastruktur gemäß AVV |
| Löschfristen | siehe Tab `Aufbewahrungsfrist`: Buchungen 10 J. ab Ende Geschäftsjahr; IBAN/Mandat 14 Monate nach letztem Einzug; Stammdaten 36 Monate nach Austritt (dann anonymisieren); FZ-Vermerk 3 Monate nach Ende der letzten pflichtigen Funktion; Protokoll 36 Monate (dann Werte leeren); Messwerte 3 Monate _[Vorschlag]_ |
| TOM | Ausführung als Funktionskonto, Datei nicht geteilt (A4); serverseitige Rollen- und Feldfilterung, sensible Tabs werden unberechtigten Rollen nicht geladen; Domain-Anmeldung; minimale OAuth-Scopes; Sperren bei Schreibzugriffen; Änderungsprotokoll; generische Fehlermeldungen; keine externen Ressourcen im Frontend; Backup in gleich geschütztem Ordner; Test nur mit synthetischen Daten |
