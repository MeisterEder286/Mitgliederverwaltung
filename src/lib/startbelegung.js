/**
 * Startbelegung der Stammdaten-Tabs und von _Konfig (Beträge und Stufen sind BEISPIELE,
 * vor dem Echtbetrieb prüfen). Wird nur vom Setup verwendet und nur in leere Tabs geschrieben.
 * Datumswerte stehen als JJJJ-MM-TT.
 *
 * ERZEUGTE DATEI – nicht von Hand ändern. Quelle: docs/daten/*.csv, Erzeugung: npm run schema
 * (tools/schema-erzeugen.js). Läuft unverändert in Apps Script und in Node (Tests).
 */
var Startbelegung = {
  "Abteilung": {
    kopf: ["abteilung_id","bezeichnung","blsv_sportart","meldepflichtig","aktiv","bemerkung"],
    zeilen: [
      ["1","Fußball","Fußball","ja","ja",""],
      ["2","Turnen","Turnen","ja","ja",""],
      ["3","Tennis","Tennis","ja","ja",""],
      ["4","Stockschützen","Eisstocksport","ja","ja","BLSV-Bezeichnung weicht ab"],
      ["5","Skiabteilung","Skisport","nein","nein","Ruht seit 2019 — nicht löschen, sonst reißt die Historie"]
    ]
  },
  "Aufbewahrungsfrist": {
    kopf: ["aufbewahrungsfrist_id","datenkategorie","betrifft_tab","dauer_monate","bezugspunkt","rechtsgrundlage","aktiv","bemerkung"],
    zeilen: [
      ["1","Beitragsbuchungen und Sollstellungen","Sollstellung, Beitragskonto","120","Ende Geschäftsjahr","§ 147 AO, § 257 HGB — VORSCHLAG","ja","Zehn Jahre. Der Hauptgrund, warum bei Austritt nicht sofort alles weg kann."],
      ["2","SEPA-Mandat und IBAN","Beitragskonto","14","letzter Einzug","Erstattungsfrist unautorisierter Lastschriften — VORSCHLAG","ja","Danach IBAN und Mandat leeren, Konto bleibt als Hülle für die Buchungshistorie."],
      ["3","Mitgliedsstammdaten","Mitglied","36","Austritt","§ 195 BGB Verjährung — VORSCHLAG","ja","Danach anonymisieren, nicht zeilenweise löschen (siehe Anker-Prinzip)."],
      ["4","Vermerk erweitertes Führungszeugnis","Qualifikation","3","Ende der Funktion","§ 72a Abs. 5 SGB VIII","ja","Kurz und zwingend. Läuft bereits automatisch über zu_loeschen_ab."],
      ["5","Änderungsprotokoll","_Protokoll","36","Eintrag im Protokoll","Berechtigtes Interesse, Nachvollziehbarkeit — VORSCHLAG","ja","Danach alt_wert und neu_wert leeren, Zeitstempel behalten."],
      ["6","Funktions- und Ehrungshistorie","Funktion, Ehrung","","Ende der Funktion","Berechtigtes Interesse Vereinschronik — OFFENER PUNKT","ja","Unbefristet nur, wenn der Verein das begründet. Sonst bei Anonymisierung mit entfernen."],
      ["8","Unterschriebener Aufnahmeantrag mit SEPA-Mandat","Drive-Ordner, Aufnahmeantrag.formular_link","120","Ende Geschäftsjahr","§ 147 AO und Nachweis des Mandats — VORSCHLAG","ja","Das Papier ist zugleich Mandatsnachweis. Ohne es steht der Verein bei einem Widerspruch mit leeren Händen."],
      ["9","Abgelehnte und zurückgezogene Anträge","Aufnahmeantrag","6","Eingang des Antrags","Kein Vertrag zustande gekommen — VORSCHLAG","ja","Kurz aufbewahren für Rückfragen, dann restlos löschen — Zeile im Archiv UND Datei im Drive-Ordner."],
      ["7","Eingefrorene Jahresstatistik","Statistik_Jahr","","Ende Geschäftsjahr","Kein Personenbezug — keine Frist nötig","ja","Anonyme Summen. Genau deshalb dürfen Einzeldaten darunter verschwinden."],
      ["10","Anschreiben (Geschäftsbriefe)","Anschreiben","72","Ende Geschäftsjahr","§ 257 HGB (6 Jahre) — VORSCHLAG","ja","Danach Inhalt leeren, Datum/Anlass behalten."],
      ["11","Dokument-Links (Antrag, Mandat)","Dokument","120","Austritt","wie Aufnahmeantrag/Mandat — VORSCHLAG","ja","Link löschen, wenn die Datei im Drive-Ordner gelöscht wird."],
      ["12","Interne Notizen","Notiz","36","Austritt","Berechtigtes Interesse, Nachvollziehbarkeit — VORSCHLAG","ja","Bei Anonymisierung entfernt; erledigte Rückfragen können früher gelöscht werden."]
    ]
  },
  "Beitragsart": {
    kopf: ["beitragsart_id","bezeichnung","betrag","alter_von","alter_bis","intervall","aktiv","gueltig_ab","bemerkung"],
    zeilen: [
      ["1","Erwachsene","100","18","","jährlich","ja","2024-01-01","BEISPIELBETRAG — echten Satz eintragen"],
      ["2","Jugendliche bis 18","45","0","17","jährlich","ja","2024-01-01","BEISPIELBETRAG"],
      ["3","Fördermitglied","50","","","jährlich","ja","2024-01-01","BEISPIELBETRAG"]
    ]
  },
  "Ehrungsregel": {
    kopf: ["ehrungsregel_id","typ","schwelle","bezeichnung","verband","aktiv","bemerkung"],
    zeilen: [
      ["1","Mitgliedsjubiläum","25","Ehrennadel Silber","Verein","ja","BEISPIELSTUFE — gegen die Satzung prüfen"],
      ["2","Mitgliedsjubiläum","40","Ehrennadel Gold","Verein","ja","BEISPIELSTUFE"],
      ["3","Mitgliedsjubiläum","50","Ehrennadel Gold mit Kranz","Verein","ja","BEISPIELSTUFE"],
      ["4","Mitgliedsjubiläum","60","Ehrenurkunde","Verein","ja","BEISPIELSTUFE"],
      ["5","Geburtstag","70","Geburtstagsgruß","Verein","ja","BEISPIELSTUFE"],
      ["6","Geburtstag","75","Geburtstagsgruß","Verein","ja","BEISPIELSTUFE"],
      ["7","Geburtstag","80","Geburtstagsgruß","Verein","ja","BEISPIELSTUFE"],
      ["8","Geburtstag","85","Geburtstagsgruß","Verein","ja","BEISPIELSTUFE"],
      ["9","Geburtstag","90","Geburtstagsgruß","Verein","ja","BEISPIELSTUFE"],
      ["10","Funktionsjubiläum","10","Dank für 10 Jahre Ehrenamt","Verein","ja","BEISPIELSTUFE — Zählweise offen, siehe _Konfig"],
      ["11","Funktionsjubiläum","20","Dank für 20 Jahre Ehrenamt","Verein","ja","BEISPIELSTUFE"],
      ["12","Funktionsjubiläum","25","Ehrenurkunde Ehrenamt","BLSV","ja","BEISPIELSTUFE"]
    ]
  },
  "Funktionsart": {
    kopf: ["funktionsart_id","bezeichnung","ebene","fz_pflichtig","bestellung","ehrungsfaehig","aktiv","bemerkung"],
    zeilen: [
      ["1","1. Vorsitzender","Verein","nein","Wahl JHV","ja","ja",""],
      ["2","2. Vorsitzender","Verein","nein","Wahl JHV","ja","ja",""],
      ["3","Kassier","Verein","nein","Wahl JHV","ja","ja",""],
      ["4","Schriftführer","Verein","nein","Wahl JHV","ja","ja",""],
      ["5","Beisitzer","Verein","nein","Wahl JHV","ja","ja",""],
      ["6","Jugendleiter","Verein","ja","Wahl JHV","ja","ja","Regelmäßiger Kontakt zu Minderjährigen"],
      ["7","Abteilungsleiter","Abteilung","ja","Wahl Abteilung","ja","ja",""],
      ["8","Trainer / Übungsleiter","Abteilung","ja","Berufung","ja","ja",""],
      ["9","Betreuer","Abteilung","ja","Berufung","ja","ja",""],
      ["10","Schiedsrichter","Abteilung","nein","Berufung","ja","ja",""],
      ["11","Platzwart / Zeugwart","Verein","nein","Berufung","ja","ja",""],
      ["12","Ehrenamtsbeauftragte(r)","Verein","nein","Berufung","ja","ja",""],
      ["13","Kassenprüfer","Verein","nein","Wahl JHV","ja","ja","PRÜFEN: Liste gegen die Satzung abgleichen"]
    ]
  },
  "Qualifikationsart": {
    kopf: ["qualifikationsart_id","bezeichnung","kategorie","wiedervorlage_monate","max_alter_zeugnis_monate","loeschfrist_monate","aktiv","bemerkung"],
    zeilen: [
      ["1","Erweitertes Führungszeugnis","Führungszeugnis","60","3","3","ja","PRÜFEN: 60 Monate = 5 Jahre. Vereinbarung mit dem Jugendamt maßgeblich."],
      ["2","Trainer-C-Lizenz","Lizenz","","","","ja","Gültigkeit steht am Dokument"],
      ["3","Übungsleiter-B-Lizenz","Lizenz","","","","ja",""],
      ["4","JuLeiCa","Lizenz","","","","ja",""],
      ["5","Erste-Hilfe-Kurs","Kurs","","","","ja","Üblich 24 Monate gültig"]
    ]
  },
  "Vorlage": {
    kopf: ["vorlage_id","bezeichnung","anlass","betreff","text","aktiv","bemerkung"],
    zeilen: [
      ["1","Aufnahmebestätigung","Aufnahmebestätigung","Willkommen im TSV Ergoldsbach – Ihre Mitgliedschaft","{{briefanrede}},\n\nherzlich willkommen im TSV Ergoldsbach e. V.! Wir freuen uns, dass Sie dabei sind.\n\nIhre Mitgliedschaft beginnt am {{eintrittsdatum}}. Ihre Mitgliedsnummer lautet {{mitgliedsnummer}}.{{#wenn abteilungen}} Sie sind folgenden Abteilungen zugeordnet: {{abteilungen}}.{{/wenn}}\n\n{{#wenn beitrag}}Ihr Jahresbeitrag beträgt {{beitrag}} ({{beitragsart}}).{{/wenn}}{{#wenn mandatsreferenz}} Der Beitrag wird per SEPA-Lastschrift unter der Mandatsreferenz {{mandatsreferenz}} eingezogen (Gläubiger-ID {{glaeubiger_id}}).{{/wenn}}\n\nBitte teilen Sie uns Änderungen Ihrer Anschrift oder Bankverbindung rechtzeitig mit.\n\nMit sportlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["2","Austrittsbestätigung","Austrittsbestätigung","Bestätigung Ihres Austritts","{{briefanrede}},\n\nwir bestätigen den Eingang Ihrer Kündigung{{#wenn kuendigung_eingang}} vom {{kuendigung_eingang}}{{/wenn}}. Ihre Mitgliedschaft im TSV Ergoldsbach e. V. endet zum {{austritt_wirksam}}.\n\nBis zu diesem Tag bleiben Ihre Rechte und Pflichten als Mitglied bestehen. Ein bereits erteiltes SEPA-Mandat verwenden wir nach dem Austritt nicht mehr.\n\nWir bedanken uns für Ihre Treue und würden uns freuen, Sie wieder einmal bei uns begrüßen zu dürfen.\n\nMit freundlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["3","Rechnung Mitgliedsbeitrag","Rechnung","Mitgliedsbeitrag {{jahr}} – Rechnung","{{briefanrede}},\n\nfür das Beitragsjahr {{jahr}} stellen wir Ihnen den Mitgliedsbeitrag in Höhe von {{betrag}} in Rechnung.\n\nBitte überweisen Sie den Betrag bis zum {{faellig_am}} auf das Vereinskonto (siehe Briefkopf) unter Angabe Ihrer Mitgliedsnummer {{mitgliedsnummer}}.\n\nBequemer geht es per Lastschrift: Ein SEPA-Mandat erhalten Sie gerne bei der Mitgliederverwaltung.\n\nMit freundlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["4","Mahnung Mitgliedsbeitrag","Mahnung","{{mahnstufe}}. Mahnung – Mitgliedsbeitrag {{jahr}}","{{briefanrede}},\n\nsicher ist es Ihrer Aufmerksamkeit entgangen: Der Mitgliedsbeitrag für {{jahr}} ist noch offen.{{#wenn gebuehr}} Bei der Lastschrift ist eine Rücklastschrift entstanden; die Bankgebühr von {{gebuehr}} ist im offenen Betrag enthalten.{{/wenn}}\n\nOffener Betrag: {{offen}}\n\nBitte überweisen Sie den Betrag bis zum {{faellig_am}} auf das Vereinskonto unter Angabe Ihrer Mitgliedsnummer {{mitgliedsnummer}}. Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.\n\nMit freundlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["5","SEPA-Vorabinformation","SEPA-Vorabinformation","Vorabinformation zum Lastschrifteinzug {{jahr}}","{{briefanrede}},\n\nwir ziehen den Mitgliedsbeitrag für {{jahr}} in Höhe von {{betrag}} am {{einzugsdatum}} von Ihrem Konto {{iban_maskiert}} (Kontoinhaber: {{kontoinhaber}}) ein.\n\nMandatsreferenz: {{mandatsreferenz}}\nGläubiger-Identifikationsnummer: {{glaeubiger_id}}\n\nBitte sorgen Sie für ausreichende Deckung. Fällt der Einzugstag auf ein Wochenende oder einen Feiertag, erfolgt die Belastung am nächsten Bankarbeitstag.\n\nMit freundlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["6","Beitragsänderung","Beitragsänderung","Änderung Ihres Mitgliedsbeitrags ab {{jahr}}","{{briefanrede}},\n\nab dem Beitragsjahr {{jahr}} gilt für Sie die Beitragsart „{{beitragsart}}“ mit einem Jahresbeitrag von {{beitrag}}.\n\n{{#wenn mandatsreferenz}}Der Beitrag wird wie gewohnt per Lastschrift (Mandatsreferenz {{mandatsreferenz}}) eingezogen.{{/wenn}}\n\nBei Fragen wenden Sie sich gerne an die Mitgliederverwaltung.\n\nMit freundlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["7","Umstellung auf Einzelbeitrag","Umstellung Einzelbeitrag","Ihr Mitgliedsbeitrag ab {{jahr}}","{{briefanrede}},\n\nbisher waren Sie über den Familienbeitrag beim TSV Ergoldsbach e. V. versichert. Da die Voraussetzungen dafür ab {{jahr}} nicht mehr vorliegen, führen wir Sie ab dann mit einem eigenen Beitrag: „{{beitragsart}}“, {{beitrag}} im Jahr.\n\n{{#wenn mandatsreferenz}}Der Beitrag wird weiterhin vom bisherigen Konto (Kontoinhaber {{kontoinhaber}}) eingezogen. Wenn Sie den Beitrag künftig selbst zahlen möchten, senden Sie uns bitte ein eigenes SEPA-Mandat.{{/wenn}}\n\nBefinden Sie sich noch in Schule, Studium oder Ausbildung, senden Sie uns bitte einen Nachweis – dann prüfen wir eine Verlängerung des Familienbeitrags.\n\nMit freundlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["8","Ausbildungsnachweis anfordern","Ausbildungsnachweis anfordern","Nachweis über Schule, Studium oder Ausbildung","{{briefanrede}},\n\nSie sind bis zum {{ausbildung_bis}} über den Familienbeitrag beim TSV Ergoldsbach e. V. geführt, weil Sie sich in Schule, Studium oder Ausbildung befinden.\n\nDamit das auch danach so bleiben kann, benötigen wir einen aktuellen Nachweis (z. B. Immatrikulations- oder Schulbescheinigung, Ausbildungsvertrag). Ohne Nachweis stellen wir ab dem folgenden Beitragsjahr auf einen eigenen Beitrag um.\n\nMit freundlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["9","Ehrung – Einladung","Ehrung","Einladung zur Ehrung – {{ehrung}}","{{briefanrede}},\n\nim Namen der Vorstandschaft dürfen wir Ihnen herzlich gratulieren: Sie werden für „{{ehrung}}“ geehrt.\n\nWir laden Sie herzlich zur Ehrung ein und freuen uns auf Ihr Kommen. Den Termin teilen wir Ihnen gesondert mit.\n\nMit sportlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["10","Glückwunsch zum Geburtstag","Geburtstag","Herzlichen Glückwunsch zum {{alter}}. Geburtstag","{{briefanrede}},\n\nzu Ihrem {{alter}}. Geburtstag gratulieren wir Ihnen im Namen des ganzen Vereins sehr herzlich und wünschen Ihnen Gesundheit, Glück und Freude.\n\nVielen Dank für Ihre langjährige Treue zum TSV Ergoldsbach e. V.\n\nMit sportlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["11","Rückfrage Zahler (Umstellung Einzelbeitrag)","Rückfrage Zahler","Rückfrage: Von welchem Konto soll künftig abgebucht werden?","{{briefanrede}},\n\nfür {{name}} gilt{{#wenn wirksam}} ab {{wirksam}}{{/wenn}} der Einzelbeitrag{{#wenn neuer_beitrag}} von {{neuer_beitrag}} im Jahr{{/wenn}}{{#wenn beitragsart}} ({{beitragsart}}){{/wenn}}. Der Familienbeitrag entfällt damit.\n\nBisher wird der Beitrag vom Konto von {{kontoinhaber}}{{#wenn mandatsreferenz}} (Mandatsreferenz {{mandatsreferenz}}){{/wenn}} abgebucht. Bitte teilen Sie uns mit, wie es weitergehen soll:\n\n1. Der Beitrag wird weiterhin von diesem Konto abgebucht.\n2. Der Beitrag soll künftig von einem eigenen Konto abgebucht werden – dafür senden wir Ihnen ein neues SEPA-Lastschriftmandat zum Unterschreiben.\n3. Der Beitrag wird künftig selbst überwiesen.\n\nBitte antworten Sie bis zum {{antwort_bis}} – am einfachsten per Antwort auf diese Nachricht. Ohne Rückmeldung buchen wir wie bisher vom genannten Konto ab.\n\nMit freundlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["12","Bestätigung Kündigungseingang","Kündigungseingang","Ihre Kündigung ist bei uns eingegangen","{{briefanrede}},\n\nIhre Kündigung{{#wenn kuendigung_eingang}} vom {{kuendigung_eingang}}{{/wenn}} ist bei uns eingegangen. Ihre Mitgliedschaft im {{verein_name}} endet{{#wenn austritt_wirksam}} zum {{austritt_wirksam}}{{/wenn}} gemäß der Kündigungsfrist der Satzung.\n\nBis dahin bleiben Ihre Rechte und Pflichten als Mitglied bestehen. Sollte es sich um ein Versehen handeln, melden Sie sich bitte kurz bei uns.\n\nMit freundlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["13","Bankverbindung geändert","Bankverbindung geändert","Ihre neue Bankverbindung für den Mitgliedsbeitrag","{{briefanrede}},\n\nwir haben Ihre neue Bankverbindung für den Mitgliedsbeitrag gespeichert: IBAN {{iban_maskiert}}{{#wenn kontoinhaber}}, Kontoinhaber {{kontoinhaber}}{{/wenn}}.\n\n{{#wenn mandatsreferenz}}Der Beitrag wird weiterhin unter der Mandatsreferenz {{mandatsreferenz}} eingezogen. {{/wenn}}{{#wenn glaeubiger_id}}Unsere Gläubiger-ID: {{glaeubiger_id}}. {{/wenn}}Die Änderung gilt ab dem nächsten Einzug.\n\nFalls Sie diese Änderung nicht veranlasst haben, melden Sie sich bitte umgehend bei uns.\n\nMit freundlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["14","Rücklastschrift – bitte Beitrag überweisen","Rücklastschrift","Rücklastschrift – Mitgliedsbeitrag {{jahr}}","{{briefanrede}},\n\nleider konnte der Mitgliedsbeitrag {{jahr}} nicht von Ihrem Konto{{#wenn iban_maskiert}} ({{iban_maskiert}}){{/wenn}} abgebucht werden – die Lastschrift wurde von der Bank zurückgegeben.{{#wenn gebuehr}} Dabei ist eine Bankgebühr von {{gebuehr}} entstanden.{{/wenn}}\n\nOffener Betrag (inkl. Gebühr): {{offen}}\n\nBitte überweisen Sie den Betrag bis zum {{faellig_am}} auf das Vereinskonto unter Angabe Ihrer Mitgliedsnummer {{mitgliedsnummer}}. Hat sich Ihre Bankverbindung geändert, teilen Sie uns bitte die neue mit.\n\nMit freundlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"],
      ["15","Willkommen","Willkommen","Herzlich willkommen im {{verein_name}}","{{briefanrede}},\n\nschön, dass Sie da sind! Ab dem {{eintrittsdatum}} sind Sie Mitglied im {{verein_name}}, Ihre Mitgliedsnummer ist {{mitgliedsnummer}}.\n\n{{#wenn abteilungen}}Sie sind in folgenden Abteilungen: {{abteilungen}}.{{/wenn}}{{#wenn abteilung_ansprechpartner}} Ihr Ansprechpartner in der Abteilung ist {{abteilung_ansprechpartner}}.{{/wenn}}\n\nBitte teilen Sie uns Änderungen Ihrer Anschrift, E-Mail-Adresse oder Bankverbindung mit. Ihre Daten verwenden wir nur für die Mitgliederverwaltung; die Datenschutzhinweise finden Sie auf unserer Internetseite.\n\nWir wünschen Ihnen viel Freude beim Sport!\n\nMit sportlichen Grüßen","ja","BEISPIEL – Text vor Gebrauch prüfen und an die Satzung/Beitragsordnung anpassen"]
    ]
  },
  "_Konfig": {
    kopf: ["schluessel","wert","beschreibung"],
    zeilen: [
      ["beitragsjahr","2026","Laufendes Beitragsjahr für Sollstellung und SEPA"],
      ["verein_name","TSV Ergoldsbach e. V.","Für Serienbriefe und SEPA-Datei"],
      ["verein_glaeubiger_id","DE00ZZZ00000000000","SEPA-Gläubiger-Identifikationsnummer — ECHTEN WERT EINTRAGEN"],
      ["sepa_format","pain.008.001.02","Ab 15.11.2026 zwingend pain.008.001.08 inkl. strukturierter Adressen"],
      ["sepa_faelligkeit","15.02.","Tag und Monat der jährlichen Fälligkeit"],
      ["mandat_verfall_monate","36","Ungenutztes Mandat verfällt nach dieser Frist"],
      ["fz_wiedervorlage_monate","60","Standard, falls in Qualifikationsart nichts hinterlegt — PRÜFEN"],
      ["ehrung_zaehlweise","letzter_eintritt","Beschlossen 10/2026: ab letztem Eintritt, ein Austritt setzt die Zählung zurück. Alternative: gesamt (alle Zeiträume), falls die Satzung geändert wird."],
      ["ehrung_stichtag","kalenderjahr","Alternative: exakter_tag"],
      ["funktionsjubilaeum_zaehlweise","je_funktion","Alternativen: laengste_funktion, summe_aller. OFFENER PUNKT"],
      ["beitrag_anteilig","halbjahr","Beschlossen 10/2026: halber Beitrag bei Eintritt ab 01.07. bzw. Austritt bis 30.06. (wie früher „Laufender Einzug Halb“). Alternativen: nein (voll), monat (monatsgenau)."],
      ["next_id_Mitglied","15","ID-Zähler — nur vom Skript erhöhen"],
      ["next_id_Mitgliedschaftszeitraum","15","ID-Zähler"],
      ["next_id_Abteilung","6","ID-Zähler"],
      ["next_id_Abteilungszugehoerigkeit","16","ID-Zähler"],
      ["next_id_Funktionsart","14","ID-Zähler"],
      ["next_id_Funktion","16","ID-Zähler"],
      ["next_id_Beitragsart","4","ID-Zähler"],
      ["next_id_Beitragsgemeinschaft","2","ID-Zähler"],
      ["next_id_Beitragskonto","12","ID-Zähler"],
      ["next_id_Sollstellung","13","ID-Zähler"],
      ["next_id_Qualifikationsart","6","ID-Zähler"],
      ["next_id_Qualifikation","10","ID-Zähler"],
      ["next_id_Ehrungsregel","13","ID-Zähler"],
      ["next_id_Ehrung","8","ID-Zähler"],
      ["next_id_Benutzer","6","ID-Zähler"],
      ["antrag_eingangsdatei","DATEI-ID EINTRAGEN","Getrennte Tabelle Aufnahmeantraege_TSV_Ergoldsbach — einziges Ziel des öffentlichen Endpunkts"],
      ["antrag_abholung","stündlich","Zeitgesteuerter Abruf: offene Anträge lesen, Dublettenprüfung, danach hier archivieren"],
      ["antrag_drive_ordner","ORDNER-ID EINTRAGEN","Drive-Ordner für unterschriebene Aufnahmeanträge. Freigabe: eingeschränkt, NICHT „jeder mit dem Link“."],
      ["antrag_dateiname","JJJJ-MM-TT_Nachname_Vorname_Aufnahmeantrag.pdf","Namensschema, damit der Ordner auch nach Jahren durchsuchbar bleibt"],
      ["antrag_dublettenpruefung","nachname+geburtsdatum","Womit das Skript nach einem bestehenden Mitglied sucht"],
      ["antrag_erinnerung_tage","14","Erinnerung, wenn das unterschriebene Formular ausbleibt"],
      ["antrag_doppelte_bestaetigung","ja","Bestätigungslink per E-Mail, bevor der Antrag bearbeitet wird"],
      ["antrag_endpunkt_regel","eigenes Skript, eigene Datei","Der öffentliche Endpunkt ist ein separates Skriptprojekt, das nur die Eingangsdatei kennt — die Mitglieder-Datei-ID steht dort nirgends"],
      ["mitgliedsnummer_naechste","1503","Nächste freie Mitgliedsnummer — getrennt vom technischen Zähler next_id_Mitglied"],
      ["mitgliedsnummer_wiederverwendung","nein","Nummern ausgetretener Mitglieder werden nicht neu vergeben"],
      ["tarifwechsel_automatisch","ja","Beitragsart wechselt beim Erreichen der Altersgrenze aus Beitragsart.alter_bis"],
      ["tarifwechsel_stichtag","01.01.","Zum Jahreswechsel, nicht am Geburtstag"],
      ["ruecklastschrift_gebuehr","5,00","BEISPIELWERT — Satzung bzw. Beschluss prüfen"],
      ["sheet_eigentuemer","verwaltung@tsv-ergoldsbach.de","MUSS ein Vereinskonto sein, kein privates. Sonst hängt der Zugang an einer Person."],
      ["backup_intervall","monatlich","Kopie des Sheets in einen Ordner mit Zugriff für zwei Personen"],
      ["loeschlauf_intervall","jährlich","Wann die Löschliste erzeugt wird — Vorschlag: nach dem Jahresabschluss"],
      ["loeschantwort_frist_tage","30","Rückmeldung an die betroffene Person, Art. 12 Abs. 3 DSGVO"],
      ["chronik_bei_anonymisierung","namen_entfernen","Alternative: vereinsaemter_behalten. OFFENER PUNKT — betrifft Funktion und Ehrung"],
      ["statistik_einfrieren_am","31.01.","Zeitgleich mit der BLSV-Bestandserhebung"],
      ["anonym_platzhalter","(anonymisiert)","Text, der in Namensfelder geschrieben wird"],
      ["next_id_Aufbewahrungsfrist","8","ID-Zähler"],
      ["next_id_Betroffenenanfrage","2","ID-Zähler"],
      ["next_id_Statistik_Jahr","8","ID-Zähler"],
      ["next_id_Protokoll","4","ID-Zähler"],
      ["jugend_bis_alter","17","Bis zu diesem Alter (einschließlich) gilt jemand als Jugendmitglied (Sicht Jugendleiter). OFFEN: bestätigen"],
      ["snapshot_einbetten","ja","ja = Startdaten direkt in die Seite einbetten (spart einen Aufruf), nein = nachladen. Für Messvergleich."],
      ["cache_warmhalten","nein","Zeit-Trigger, der den Snapshot-Cache vor Ablauf neu baut. Standard aus."],
      ["messung_puffer_max","500","Wie viele Messwerte maximal im Cache gepuffert werden, bevor sie nach _Messung geschrieben werden."],
      ["sperre_wartezeit_ms","10000","Wie lange ein Schreibvorgang höchstens auf die Sperre wartet."],
      ["impressum_url","https://www.tsv-ergoldsbach.de/impressum","Link in der Fußzeile (D1). PRÜFEN"],
      ["datenschutz_url","https://www.tsv-ergoldsbach.de/datenschutz","Link in der Fußzeile (D1). PRÜFEN"],
      ["snapshot_sollstellung_jahre","3","So viele Beitragsjahre an Sollstellungen lädt der Browser (ältere bei Bedarf)."],
      ["verein_iban","","IBAN des Vereinskontos (Gläubigerkonto) für die SEPA-Datei – ECHTEN WERT EINTRAGEN"],
      ["verein_bic","","BIC des Vereinskontos (optional, bei DE-IBAN entbehrlich)"],
      ["verein_strasse","","Vereinsanschrift für die SEPA-Datei (strukturierte Adresse): Straße"],
      ["verein_hausnummer","","Vereinsanschrift: Hausnummer"],
      ["verein_plz","84061","Vereinsanschrift: PLZ"],
      ["verein_ort","Ergoldsbach","Vereinsanschrift: Ort"],
      ["verein_land","DE","Vereinsanschrift: Land (ISO-Code)"],
      ["sepa_vier_augen","nein","ja = SEPA-Datei erst nach Freigabe des Probelaufs durch eine ZWEITE Person (Vier-Augen-Prinzip)"],
      ["familie_kinder_bis_alter","17","Kinder sind bis zu diesem Alter (einschließlich, Stichtag siehe familie_umstellung_stichtag) im Familienbeitrag. (bestätigt 10/2026)"],
      ["familie_ausbildung_bis_alter","25","Mit Nachweis von Schule/Studium/Ausbildung höchstens bis zu diesem Alter (einschließlich) im Familienbeitrag. (bestätigt 10/2026)"],
      ["familie_umstellung_stichtag","01.01.","Zu welchem Tag die Umstellung auf den Einzelbeitrag wirkt (Jahreswechsel, wie Tarifwechsel)"],
      ["ausbildungsnachweis_vorlauf_monate","2","So viele Monate vor ausbildung_bis wird ein neuer Nachweis angefordert"],
      ["brief_absender","TSV Ergoldsbach e. V. · Mitgliederverwaltung","Absenderzeile über der Anschrift in Anschreiben"],
      ["brief_unterschrift","Mitgliederverwaltung TSV Ergoldsbach e. V.","Grußzeile/Unterschrift unter Anschreiben"],
      ["brief_ort","Ergoldsbach","Ort vor dem Datum in Anschreiben"],
      ["mail_aktiv","nein","Hauptschalter E-Mail-Versand: ja = Mails werden wirklich gesendet. Erst nach Test einschalten."],
      ["mail_test_an","","Testmodus: Ist hier eine Adresse eingetragen, gehen ALLE Mails nur an diese Adresse (Betreff mit [TEST]). Für die Testumgebung (C2)."],
      ["mail_absendername","TSV Ergoldsbach e. V. – Mitgliederverwaltung","Angezeigter Absendername (Absender ist immer das Funktionskonto, C5)."],
      ["mail_antwort_an","","Antwortadresse (replyTo) für allgemeine Schreiben, z. B. verwaltung@… – PRÜFEN"],
      ["mail_antwort_an_finanzen","","Antwortadresse für Rechnung, Mahnung, Vorabinformation, Rückfrage Zahler, z. B. kassier@… – PRÜFEN"],
      ["mail_briefkopf","TSV Ergoldsbach e. V.|Mitgliederverwaltung","Briefkopf der E-Mails: Zeilen durch | getrennt (reiner Text, kein HTML)."],
      ["mail_logo_url","","Optional: https-Adresse eines Vereinslogos für den Briefkopf (wird vom Mailprogramm des Empfängers geladen)."],
      ["mail_fusszeile","TSV Ergoldsbach e. V. · Impressum und Datenschutz: www.tsv-ergoldsbach.de","Fußzeile der E-Mails (reiner Text, Zeilen durch | getrennt)."],
      ["mail_pdf_anhang","ja","ja = Bestätigungen (Austritt, Aufnahme) zusätzlich als PDF anhängen."],
      ["mail_max_je_lauf","100","Höchstens so viele Mails je Sammelversand (Kontingent C4)."],
      ["rueckfrage_wiedervorlage_tage","21","Nach so vielen Tagen erscheint eine unbeantwortete Rückfrage unter „Zu erledigen“."]
    ]
  }
};
