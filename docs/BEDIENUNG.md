# Kurzanleitung für die Benutzer

Für alle, die mit der Mitgliederverwaltung arbeiten – ohne Technikkenntnisse. Aufruf über die Vereinshomepage
(`/verwaltung`) mit dem Google-Konto des Vereins. Was man sieht, hängt von der eigenen Rolle ab; alles, was nicht
angezeigt wird, liefert das System für diese Rolle auch gar nicht aus.

## Für alle
- **Start:** Kennzahlen und „Zu erledigen“. Ein Klick auf eine Kachel führt zur passenden Liste.
- **Suchen:** oben auf der Startseite oder in „Mitglieder“ – Name, Mitgliedsnummer, Ort. Umlaute egal (Müller = Mueller).
- **Listen drucken/exportieren:** jeweils über „Drucken“ (auch „Als PDF speichern“) oder „CSV“ (öffnet in Excel).
  Jeder Export wird mit Name, Zeit und Liste protokolliert. Kontaktlisten bitte nicht in Messenger-Gruppen weitergeben.
- **„Der Datensatz wurde inzwischen geändert“:** Jemand anderes hat gleichzeitig gespeichert. Die aktuelle Fassung wird
  geladen; Änderung bitte noch einmal eintragen.
- **Fehler-Nr.:** Bei unerwarteten Fehlern erscheint eine Nummer. Diese bitte an die Mitgliederverwaltung melden.

## Abteilungsleitung
- **Meine Abteilung:** alle Mitglieder Ihrer Abteilung mit Kontakt und Geburtsdatum. Filter nach aktiv/passiv, Alter, Funktion.
- **Mitglied zuordnen:** Ein bestehendes Vereinsmitglied kommt neu in Ihre Abteilung: Nachname **und** Mitgliedsnummer
  oder Geburtsdatum eingeben → bei genau einem Treffer „Zuordnen“. (Keine Trefferlisten – Datenschutz.)
- **Aus der Abteilung nehmen:** im Mitglied unter „Abteilungen“ → „beenden“. Der Vereinsaustritt bleibt bei der Mitgliederverwaltung.
- **Trainer & Funktionen:** Funktion eintragen/beenden (nur Ämter Ihrer Abteilung).
- **Nachweise:** Ampel je Trainer/Betreuer; Einsicht ins erweiterte Führungszeugnis erfassen: nur Datum, „ohne einschlägigen
  Eintrag“ – **niemals Inhalte**, kein Upload (§ 72a SGB VIII).

## Jugendleitung
- Sicht auf Jugendmitglieder und auf alle Funktionsträger mit Nachweispflicht; Nachweise erfassen wie oben.
  Bis zu welchem Alter jemand als Jugendmitglied gilt, stellt die Verwaltung unter Einstellungen ein (`jugend_bis_alter`, Standard 17).

## Kasse
- **Finanzen → Einzugsstand:** Soll, eingezogen, offen, Rücklastschriften; Mahnliste drucken oder „Mahnungen erstellen“.
- **Nachzügler:** Neue Mitglieder nach dem Jahreslauf → Sollstellungen „Nachzügler anlegen“ → SEPA-Lauf (nimmt nur, was noch nie eingezogen wurde).
- **Rechnungen** für Überweiser: Finanzen → Rechnungen → auswählen → Schreiben.
- **Beitragserhöhung** (nach JHV-Beschluss, vor dem Jahreslauf): Finanzen → Beitragsänderung → Jahr wählen, neue Beträge
  je Beitragsart und je Familien-Pauschale eintragen → „Vorschau berechnen“ (alt/neu je Konto) → „Übernehmen“ →
  „Vorabinformation erstellen“ (Vorlage „Beitragsänderung“ mit `{{beitrag_bisher}}`/`{{beitrag_neu}}`). Frühere Jahre
  rechnen weiter mit dem alten Betrag. Nur möglich, solange es für das Jahr noch keine Sollstellungen gibt.
- **Sollstellungen:** einmal im Jahr „Probelauf“ → „Anlegen“.
- **SEPA-Lauf:** Probelauf prüfen (Ausschlüsse mit Grund) → „XML erzeugen“ → Datei im Online-Banking hochladen.
  Danach „alle als bezahlt buchen“; Rücklastschriften einzeln mit Grund erfassen (Gebühr automatisch).
- IBANs werden nur maskiert angezeigt; „aufdecken“ wird protokolliert.

## Mitgliederverwaltung / Vorstand
- **Neues Mitglied:** Mitglieder → „Neues Mitglied“. Nummer wird automatisch vergeben; bei Namensgleichheit mit gleichem
  Geburtsdatum erscheint ein Hinweis (oft ein Wiedereintritt → „Wiedereintritt“ statt neu anlegen).
- **Beitritte aus XML importieren:** Mitglieder → „Beitritte aus XML importieren“ (braucht auch das Recht, Konten zu
  bearbeiten). Eine oder mehrere Antrags-Dateien (XML wie bisher aus Access) auswählen – sie werden nur im Browser gelesen.
  Die Vorschau zeigt je Antrag die Personen mit vorläufiger Nummer, das Konto (IBAN nur maskiert), ggf. den
  Familienbeitrag und Warnungen. Wie in Access zahlt Person 1 selbst, alle weiteren über Person 1; die Bankdaten von
  Person 1 werden übernommen, die Mitgliedsnummern immer **neu** vergeben (höchste + 1). Ungültige IBAN → Konto wird
  „Überweisung“ mit Hinweis. Gibt es Name + Vorname (+ Geburtsdatum) schon, bitte je Person wählen: „Trotzdem neu
  anlegen“ oder „Wiedereintritt“ (nur bei Ausgetretenen; die alte Nummer bleibt). Einzelne Anträge lassen sich abwählen.
  Jeder Antrag wird ganz oder gar nicht gespeichert; der Bericht nennt je Datei die vergebenen Nummern und was nicht
  importiert wurde. Danach „Aufnahmebestätigungen erstellen“. Mandatsdatum = Eintrittsdatum – mit dem unterschriebenen
  Mandat abgleichen.
- **Austritt:** im Mitglied → „Austritt“. Ist die Person Zahler für andere, fragt das System, wie es mit dem Konto weitergeht.
- **Konto/Bankverbindung:** Finanzen → Konten. Neuer Kontoinhaber = neues SEPA-Mandat (Unterschrift!). Neue IBAN bei
  gleichem Inhaber: Das Mandat gilt weiter, der nächste SEPA-Lauf meldet der Bank die Mandatsänderung automatisch
  (Probelauf und Kontrollliste zeigen „Änderung“).
- **Familien:** einmal im Herbst „Fallen heraus“ für das nächste Jahr prüfen. Wer Schule/Studium/Ausbildung nachweist,
  bekommt das voraussichtliche Ende eingetragen und bleibt bis dahin im Familienbeitrag. Die anderen auswählen →
  „Auf Einzelbeitrag umstellen“ → „Anschreiben erstellen“.
- **Zahlungen einer Person:** im Mitglied unter „Zahlungen“ – alle Jahre, auch über frühere Konten.
- **Schreiben:** Vorlage wählen, Empfänger wählen (oder aus Finanzen/Familien übergeben) → Vorschau → „Erstellen & drucken“.
  Jedes Schreiben bleibt im Mitglied unter „Dokumente & Schreiben“ und kann nachgedruckt werden. Unterschriebene
  Anträge und SEPA-Mandate liegen im Drive-Ordner; hier wird nur der Link hinterlegt.
- **Ehrungen:** Jahresliste prüfen → „übernehmen“ → nach der Versammlung „verliehen“ eintragen.
- **Berichte → BLSV:** im Januar Bestand prüfen, CSV für verein360 herunterladen, „Jahresstatistik einfrieren“.
- **Datenschutz:** Einwilligungen, Anfragen von Betroffenen (Frist 1 Monat!), Löschliste. Anonymisieren ist endgültig.
- **Verwaltung:** Benutzer und Rollen, Einstellungen, Stammdaten (Beiträge, Abteilungen, Funktionsarten …), Datenqualität.

## E-Mails
- **Einschalten** (Verwaltung → Einstellungen): `mail_aktiv = ja`. Zum Ausprobieren erst `mail_test_an` mit einer eigenen
  Adresse füllen – dann gehen ALLE Mails nur dorthin, der Betreff beginnt mit „[TEST]“ (Status „testmodus“).
  Briefkopf (`mail_briefkopf`, Zeilen mit | trennen), Fußzeile mit Impressum/Datenschutz (`mail_fusszeile`), optional
  Logo (`mail_logo_url`, nur https), Absendername und Antwortadressen (`mail_antwort_an`, für Rechnung/Mahnung/
  Vorabinformation/Rückfrage/Rücklastschrift/Bankverbindung `mail_antwort_an_finanzen`).
- **Senden:** Schreiben → Vorlage und Empfänger wählen → „Vorschau“. In der Tabelle „Kanal je Empfänger“ steht je
  Person Brief oder E-Mail (Vorschlag aus der Versandart und einer vorhandenen Adresse, änderbar). Darunter die
  Mail-Vorschau. „Erstellen & drucken (n)“ druckt nur die Briefe, „E-Mails senden (n)“ sendet nach einer Rückfrage die
  E-Mails und zeigt je Empfänger, ob es geklappt hat. Austritts-/Aufnahmebestätigungen bekommen das Schreiben
  zusätzlich als PDF (`mail_pdf_anhang`).
- **Wohin geht die Mail?** Minderjährige: an die E-Mail der gesetzlichen Vertretung (Feld „Kontakt Vertretung“ bzw. die
  E-Mail des Vertretungs-Mitglieds). Rechnung, Mahnung, Vorabinformation, Rückfrage, Rücklastschrift, Bankverbindung:
  an den Kontoinhaber; ist das kein Mitglied, wird ein Brief gedruckt.
- **Fehlgeschlagen?** Unter „Erstellte Schreiben“ steht der Status (gesendet / testmodus / fehlgeschlagen);
  „Fehlgeschlagene E-Mails erneut senden“ schickt den gespeicherten Text noch einmal.
- **Postausgang** (erster Reiter in „Schreiben“, die Zahl zeigt offene): fehlende Austrittsbestätigungen, neue
  Mitglieder ohne Aufnahmebestätigung, Rückfrage an den Zahler nach Umstellung auf Einzelbeitrag (wenn der Beitrag
  noch über das Konto z. B. der Eltern läuft), SEPA-Vorabinformation zum nächsten Einzug, Rücklastschriften, geänderte
  Bankverbindungen, fällige Ausbildungsnachweise. „Vorbereiten“ öffnet das passende Schreiben – gesendet wird erst nach
  Vorschau und Bestätigung, nie automatisch.
- **Rückfrage Zahler:** Nach dem Senden legt das Programm eine Wiedervorlage (Notizen → Zu erledigen) an.
- **Grenzen:** Google erlaubt nur eine begrenzte Zahl Mails am Tag; reicht das Kontingent nicht, wird gar nichts
  gesendet (Meldung). Je Versand höchstens `mail_max_je_lauf` Mails.

## Notizen und Wiedervorlagen
- **Wo:** im Mitglied über den Reiter „Notizen“ (oder den Knopf „Notizen (n)“ – n = offene), im Konto unter „Notizen zum
  Konto“ und gesammelt im Menü „Notizen“. Die Startseite zeigt unter „Wiedervorlagen“ bis zu fünf fällige Einträge.
- **Art:** Notiz, Telefonat, Rückfrage oder Wiedervorlage. Mit „Wiedervorlage am“ erscheint der Eintrag ab diesem Tag
  unter „Notizen → Zu erledigen“ und auf der Startseite.
- **Sichtbar für:** Verwaltung (Vorstand, Mitgliederverwaltung), Finanzen (Kasse + Verwaltung), Abteilung (Leitung
  dieser Abteilung + Verwaltung) oder Jugendleitung (+ Verwaltung). Man kann nur Kreise wählen, zu denen man selbst
  gehört; Abteilungsleitungen sehen nur Notizen ihrer Abteilung und nur zu Personen, die sie ohnehin sehen.
- **Bitte nur sachliche Vermerke** – keine Gesundheitsdaten oder andere besonders schützenswerte Angaben (Art. 9
  DSGVO). Betroffene haben ein Auskunftsrecht: Notizen stehen in der Datenschutz-Auskunft.
- **Erledigen/Bearbeiten:** wer die Notiz geschrieben hat, oder die Verwaltung. **Löschen:** nur die Verwaltung und nur
  ohne offene Rückfrage/Wiedervorlage (diese bitte „erledigen“).
- **Rückfrage „Von welchem Konto soll abgebucht werden?“** (z. B. nach einer Beitragsumstellung, Kasse): unter „Zu
  erledigen“ → „Antwort erfassen“ → „Bisheriges Konto“, „Eigenes Konto“ oder „Überweisung“. Die Antwort ändert kein
  Konto – für ein neues Konto braucht es ein unterschriebenes SEPA-Mandat. Das Programm öffnet dafür das Konto bzw.
  Finanzen und legt der Kasse eine Wiedervorlage an.
- **Aufbewahrung:** erledigte Notizen werden 36 Monate nach dem Austritt automatisch entfernt, beim Anonymisieren sofort.
