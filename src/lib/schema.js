/**
 * Datenmodell: alle Tabs mit Spalten, Typen, Pflichtangaben, Auswahllisten und
 * Sichtklassen (intern / kontakt / finanz / hochsensibel / verwaltung). Grundlage für Setup,
 * Datenzugriff und Rollenfilter.
 *
 * ERZEUGTE DATEI – nicht von Hand ändern. Quelle: docs/daten/*.csv, Erzeugung: npm run schema
 * (tools/schema-erzeugen.js). Läuft unverändert in Apps Script und in Node (Tests).
 */
var Schema = (function () {
  var TABELLEN = {
    "Aufnahmeantrag": {
      gruppe: "transaktional", idSpalte: "antrag_id", eindeutig: [],
      spalten: [
        {"name":"antrag_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"verwaltung"},
        {"name":"eingang_ref","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"eingang_am","typ":"Zeitpunkt","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"quelle","typ":"Auswahl","pflicht":"ja","liste":"antrag_quelle","sicht":"verwaltung"},
        {"name":"status","typ":"Auswahl","pflicht":"ja","liste":"antrag_status","sicht":"verwaltung"},
        {"name":"anrede","typ":"Auswahl","pflicht":"nein","liste":"anrede","sicht":"verwaltung"},
        {"name":"titel","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"vorname","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"nachname","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"geburtsdatum","typ":"Datum","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"geschlecht","typ":"Auswahl","pflicht":"nein","liste":"geschlecht","sicht":"verwaltung"},
        {"name":"strasse","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"hausnummer","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"plz","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"ort","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"land","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"telefon","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"email","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"vertreter_name","typ":"Text","pflicht":"bedingt","liste":null,"sicht":"verwaltung"},
        {"name":"vertreter_kontakt","typ":"Text","pflicht":"bedingt","liste":null,"sicht":"verwaltung"},
        {"name":"abteilung_wunsch","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"eintritt_wunsch","typ":"Datum","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"familienverbund_hinweis","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"zahlweg_wunsch","typ":"Auswahl","pflicht":"nein","liste":"zahlweg","sicht":"finanz"},
        {"name":"kontoinhaber_name","typ":"Text","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"ew_fotos","typ":"ja/nein","pflicht":"nein","liste":"ja_nein","sicht":"verwaltung"},
        {"name":"ew_newsletter","typ":"ja/nein","pflicht":"nein","liste":"ja_nein","sicht":"verwaltung"},
        {"name":"ew_ehrungen","typ":"ja/nein","pflicht":"nein","liste":"ja_nein","sicht":"verwaltung"},
        {"name":"satzung_akzeptiert","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"verwaltung"},
        {"name":"datenschutz_gelesen","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"verwaltung"},
        {"name":"email_bestaetigt_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"formular_versendet_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"formular_eingang_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"formular_link","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"dublette_mitglied_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"geprueft_von","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"beschluss_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"ablehnungsgrund","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"uebernommen_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"mitglied_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"verwaltung"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"verwaltung"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"verwaltung"}
      ]
    },
    "Mitglied": {
      gruppe: "transaktional", idSpalte: "mitglied_id", eindeutig: [["mitgliedsnummer"]],
      spalten: [
        {"name":"mitglied_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"mitgliedsnummer","typ":"Text","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"anrede","typ":"Auswahl","pflicht":"nein","liste":"anrede","sicht":"intern"},
        {"name":"briefanrede","typ":"Text","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"titel","typ":"Text","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"vorname","typ":"Text","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"nachname","typ":"Text","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"strasse","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"hausnummer","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"plz","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"ort","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"land","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"geburtsdatum","typ":"Datum","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"geschlecht","typ":"Auswahl","pflicht":"nein","liste":"geschlecht","sicht":"kontakt"},
        {"name":"telefon","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"handy","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"email","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"versandart","typ":"Auswahl","pflicht":"nein","liste":"versandart","sicht":"kontakt"},
        {"name":"adresse_ungueltig","typ":"ja/nein","pflicht":"nein","liste":"ja_nein","sicht":"kontakt"},
        {"name":"adresse_ungueltig_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"ehrenmitglied","typ":"ja/nein","pflicht":"nein","liste":"ja_nein","sicht":"intern"},
        {"name":"ehrenmitglied_seit","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"nur_funktionstraeger","typ":"ja/nein","pflicht":"nein","liste":"ja_nein","sicht":"intern"},
        {"name":"sterbedatum","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"status","typ":"Auswahl","pflicht":"auto","liste":"mitglied_status","sicht":"intern"},
        {"name":"beitragsart_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"beitragskonto_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"beitragsgemeinschaft_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"ausbildung_art","typ":"Auswahl","pflicht":"nein","liste":"ausbildung_art","sicht":"finanz"},
        {"name":"ausbildung_bis","typ":"Datum","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"ausbildung_nachweis_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"vertreter_mitglied_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"vertreter_name","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"vertreter_kontakt","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"verarbeitung_eingeschraenkt","typ":"ja/nein","pflicht":"nein","liste":"ja_nein","sicht":"verwaltung"},
        {"name":"sperre_grund","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"loeschbar_ab","typ":"Datum","pflicht":"auto","liste":null,"sicht":"verwaltung"},
        {"name":"anonymisiert","typ":"ja/nein","pflicht":"nein","liste":"ja_nein","sicht":"verwaltung"},
        {"name":"anonymisiert_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"intern"}
      ]
    },
    "Mitgliedschaftszeitraum": {
      gruppe: "transaktional", idSpalte: "zeitraum_id", eindeutig: [],
      spalten: [
        {"name":"zeitraum_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"mitglied_id","typ":"FK","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"antrag_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"aufnahme_beschluss_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"aufnahmeantrag_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"eintrittsdatum","typ":"Datum","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"austrittsdatum","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"kuendigung_eingang","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"austritt_wirksam","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"austrittsgrund","typ":"Auswahl","pflicht":"nein","liste":"austrittsgrund","sicht":"intern"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"}
      ]
    },
    "Abteilung": {
      gruppe: "Stammdaten", idSpalte: "abteilung_id", eindeutig: [],
      spalten: [
        {"name":"abteilung_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"bezeichnung","typ":"Text","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"blsv_sportart","typ":"Text","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"meldepflichtig","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"intern"},
        {"name":"aktiv","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"intern"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"}
      ]
    },
    "Abteilungszugehoerigkeit": {
      gruppe: "transaktional", idSpalte: "zugehoerigkeit_id", eindeutig: [["mitglied_id","abteilung_id"]],
      spalten: [
        {"name":"zugehoerigkeit_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"mitglied_id","typ":"FK","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"abteilung_id","typ":"FK","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"passnummer","typ":"Text","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"status","typ":"Auswahl","pflicht":"ja","liste":"zugehoerigkeit","sicht":"intern"},
        {"name":"eintrittsdatum","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"austrittsdatum","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"}
      ]
    },
    "Funktionsart": {
      gruppe: "Stammdaten", idSpalte: "funktionsart_id", eindeutig: [],
      spalten: [
        {"name":"funktionsart_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"bezeichnung","typ":"Text","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"ebene","typ":"Auswahl","pflicht":"ja","liste":"ebene","sicht":"intern"},
        {"name":"fz_pflichtig","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"intern"},
        {"name":"bestellung","typ":"Auswahl","pflicht":"nein","liste":"bestellung","sicht":"intern"},
        {"name":"ehrungsfaehig","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"intern"},
        {"name":"aktiv","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"intern"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"}
      ]
    },
    "Funktion": {
      gruppe: "transaktional", idSpalte: "funktion_id", eindeutig: [],
      spalten: [
        {"name":"funktion_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"mitglied_id","typ":"FK","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"funktionsart_id","typ":"FK","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"abteilung_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"zusatz","typ":"Text","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"von","typ":"Datum","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"bis","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"bestellt_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"beendigungsgrund","typ":"Text","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"}
      ]
    },
    "Beitragsart": {
      gruppe: "Stammdaten", idSpalte: "beitragsart_id", eindeutig: [],
      spalten: [
        {"name":"beitragsart_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"bezeichnung","typ":"Text","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"betrag","typ":"Dezimal","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"alter_von","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"alter_bis","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"intervall","typ":"Auswahl","pflicht":"ja","liste":"intervall","sicht":"intern"},
        {"name":"aktiv","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"intern"},
        {"name":"gueltig_ab","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"}
      ]
    },
    "Beitragsgemeinschaft": {
      gruppe: "Stammdaten", idSpalte: "beitragsgemeinschaft_id", eindeutig: [],
      spalten: [
        {"name":"beitragsgemeinschaft_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"finanz"},
        {"name":"bezeichnung","typ":"Text","pflicht":"ja","liste":null,"sicht":"finanz"},
        {"name":"festbetrag","typ":"Dezimal","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"aktiv","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"finanz"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"finanz"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"finanz"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"finanz"}
      ]
    },
    "Beitragskonto": {
      gruppe: "transaktional / SENSIBEL", idSpalte: "beitragskonto_id", eindeutig: [["mandatsreferenz"]],
      spalten: [
        {"name":"beitragskonto_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"finanz"},
        {"name":"kontoinhaber_name","typ":"Text","pflicht":"ja","liste":null,"sicht":"finanz"},
        {"name":"kontoinhaber_mitglied_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"zahlweg","typ":"Auswahl","pflicht":"ja","liste":"zahlweg","sicht":"finanz"},
        {"name":"iban","typ":"Text","pflicht":"bedingt","liste":null,"sicht":"finanz"},
        {"name":"bic","typ":"Text","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"mandatsreferenz","typ":"Text","pflicht":"bedingt","liste":null,"sicht":"finanz"},
        {"name":"mandatsdatum","typ":"Datum","pflicht":"bedingt","liste":null,"sicht":"finanz"},
        {"name":"abw_strasse","typ":"Text","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"abw_hausnummer","typ":"Text","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"abw_plz","typ":"Text","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"abw_ort","typ":"Text","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"abw_land","typ":"Text","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"aktiv","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"finanz"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"finanz"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"finanz"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"finanz"}
      ]
    },
    "Sollstellung": {
      gruppe: "transaktional / SENSIBEL", idSpalte: "sollstellung_id", eindeutig: [["beitragskonto_id","jahr"]],
      spalten: [
        {"name":"sollstellung_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"finanz"},
        {"name":"beitragskonto_id","typ":"FK","pflicht":"ja","liste":null,"sicht":"finanz"},
        {"name":"jahr","typ":"Ganzzahl","pflicht":"ja","liste":null,"sicht":"finanz"},
        {"name":"soll_betrag","typ":"Dezimal","pflicht":"ja","liste":null,"sicht":"finanz"},
        {"name":"ist_betrag","typ":"Dezimal","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"gebuehr","typ":"Dezimal","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"status","typ":"Auswahl","pflicht":"ja","liste":"sollstellung_status","sicht":"finanz"},
        {"name":"sepa_sequenz","typ":"Auswahl","pflicht":"nein","liste":"sepa_sequenz","sicht":"finanz"},
        {"name":"einzugsdatum","typ":"Datum","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"buchungsdatum","typ":"Datum","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"mahnstufe","typ":"Ganzzahl","pflicht":"ja","liste":null,"sicht":"finanz"},
        {"name":"ruecklastschrift_grund","typ":"Text","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"finanz"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"finanz"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"finanz"}
      ]
    },
    "Qualifikationsart": {
      gruppe: "Stammdaten", idSpalte: "qualifikationsart_id", eindeutig: [],
      spalten: [
        {"name":"qualifikationsart_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"bezeichnung","typ":"Text","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"kategorie","typ":"Auswahl","pflicht":"ja","liste":"qual_kategorie","sicht":"intern"},
        {"name":"wiedervorlage_monate","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"max_alter_zeugnis_monate","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"loeschfrist_monate","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"aktiv","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"intern"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"}
      ]
    },
    "Qualifikation": {
      gruppe: "transaktional / HOCHSENSIBEL", idSpalte: "qualifikation_id", eindeutig: [],
      spalten: [
        {"name":"qualifikation_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"hochsensibel"},
        {"name":"mitglied_id","typ":"FK","pflicht":"ja","liste":null,"sicht":"hochsensibel"},
        {"name":"qualifikationsart_id","typ":"FK","pflicht":"ja","liste":null,"sicht":"hochsensibel"},
        {"name":"funktion_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"hochsensibel"},
        {"name":"ausgestellt_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"hochsensibel"},
        {"name":"eingesehen_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"hochsensibel"},
        {"name":"eingesehen_durch","typ":"Text","pflicht":"nein","liste":null,"sicht":"hochsensibel"},
        {"name":"ergebnis","typ":"Auswahl","pflicht":"nein","liste":"ergebnis","sicht":"hochsensibel"},
        {"name":"gueltig_bis","typ":"Datum","pflicht":"nein","liste":null,"sicht":"hochsensibel"},
        {"name":"wiedervorlage_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"hochsensibel"},
        {"name":"zu_loeschen_ab","typ":"Datum","pflicht":"nein","liste":null,"sicht":"hochsensibel"},
        {"name":"geloescht_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"hochsensibel"},
        {"name":"bemerkung","typ":"Text","pflicht":"nein","liste":null,"sicht":"hochsensibel"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"hochsensibel"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"hochsensibel"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"hochsensibel"}
      ]
    },
    "Ehrungsregel": {
      gruppe: "Stammdaten", idSpalte: "ehrungsregel_id", eindeutig: [],
      spalten: [
        {"name":"ehrungsregel_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"typ","typ":"Auswahl","pflicht":"ja","liste":"ehrungstyp","sicht":"intern"},
        {"name":"schwelle","typ":"Ganzzahl","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"bezeichnung","typ":"Text","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"verband","typ":"Text","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"aktiv","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"intern"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"}
      ]
    },
    "Ehrung": {
      gruppe: "transaktional", idSpalte: "ehrung_id", eindeutig: [["mitglied_id","ehrungsregel_id","funktion_id"]],
      spalten: [
        {"name":"ehrung_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"mitglied_id","typ":"FK","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"ehrungsregel_id","typ":"FK","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"funktion_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"faellig_jahr","typ":"Ganzzahl","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"status","typ":"Auswahl","pflicht":"ja","liste":"ehrung_status","sicht":"intern"},
        {"name":"verliehen_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"veranstaltung","typ":"Text","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"}
      ]
    },
    "Benutzer": {
      gruppe: "Stammdaten / SENSIBEL", idSpalte: "benutzer_id", eindeutig: [["email","rolle","abteilung_id"]],
      spalten: [
        {"name":"benutzer_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"verwaltung"},
        {"name":"email","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"name","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"rolle","typ":"Auswahl","pflicht":"ja","liste":"rolle","sicht":"verwaltung"},
        {"name":"abteilung_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"mitglied_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"aktiv","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"verwaltung"},
        {"name":"angelegt_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"verwaltung"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"verwaltung"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"verwaltung"}
      ]
    },
    "Einwilligung": {
      gruppe: "transaktional", idSpalte: "einwilligung_id", eindeutig: [],
      spalten: [
        {"name":"einwilligung_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"kontakt"},
        {"name":"mitglied_id","typ":"FK","pflicht":"ja","liste":null,"sicht":"kontakt"},
        {"name":"art","typ":"Auswahl","pflicht":"ja","liste":"einwilligung_art","sicht":"kontakt"},
        {"name":"umfang","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"erteilt_am","typ":"Datum","pflicht":"ja","liste":null,"sicht":"kontakt"},
        {"name":"erteilt_form","typ":"Auswahl","pflicht":"nein","liste":"einwilligung_form","sicht":"kontakt"},
        {"name":"erteilt_durch","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"widerrufen_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"nachweis_ort","typ":"Text","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"kontakt"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"kontakt"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"kontakt"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"kontakt"}
      ]
    },
    "Aufbewahrungsfrist": {
      gruppe: "Stammdaten", idSpalte: "aufbewahrungsfrist_id", eindeutig: [],
      spalten: [
        {"name":"aufbewahrungsfrist_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"verwaltung"},
        {"name":"datenkategorie","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"betrifft_tab","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"dauer_monate","typ":"Ganzzahl","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"bezugspunkt","typ":"Auswahl","pflicht":"ja","liste":"bezugspunkt","sicht":"verwaltung"},
        {"name":"rechtsgrundlage","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"aktiv","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"verwaltung"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"verwaltung"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"verwaltung"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"verwaltung"}
      ]
    },
    "Betroffenenanfrage": {
      gruppe: "transaktional", idSpalte: "anfrage_id", eindeutig: [],
      spalten: [
        {"name":"anfrage_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"verwaltung"},
        {"name":"mitglied_id","typ":"FK","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"art","typ":"Auswahl","pflicht":"ja","liste":"anfrage_art","sicht":"verwaltung"},
        {"name":"name_bei_eingang","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"eingang_am","typ":"Datum","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"eingang_kanal","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"umfang","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"status","typ":"Auswahl","pflicht":"ja","liste":"anfrage_status","sicht":"verwaltung"},
        {"name":"geprueft_von","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"entscheidung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"umgesetzte_stufe","typ":"Auswahl","pflicht":"nein","liste":"loesch_stufe","sicht":"verwaltung"},
        {"name":"umgesetzt_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"rueckmeldung_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"restdaten_bis","typ":"Datum","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"verwaltung"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"verwaltung"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"verwaltung"}
      ]
    },
    "Dokument": {
      gruppe: "transaktional / SENSIBEL", idSpalte: "dokument_id", eindeutig: [],
      spalten: [
        {"name":"dokument_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"finanz"},
        {"name":"mitglied_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"beitragskonto_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"art","typ":"Auswahl","pflicht":"ja","liste":"dokument_art","sicht":"finanz"},
        {"name":"titel","typ":"Text","pflicht":"ja","liste":null,"sicht":"finanz"},
        {"name":"link","typ":"Text","pflicht":"ja","liste":null,"sicht":"finanz"},
        {"name":"datum","typ":"Datum","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"finanz"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"finanz"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"finanz"}
      ]
    },
    "Vorlage": {
      gruppe: "Stammdaten", idSpalte: "vorlage_id", eindeutig: [],
      spalten: [
        {"name":"vorlage_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"bezeichnung","typ":"Text","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"anlass","typ":"Auswahl","pflicht":"ja","liste":"vorlage_anlass","sicht":"intern"},
        {"name":"betreff","typ":"Text","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"text","typ":"Langtext","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"aktiv","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"intern"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"}
      ]
    },
    "Anschreiben": {
      gruppe: "transaktional / SENSIBEL", idSpalte: "anschreiben_id", eindeutig: [],
      spalten: [
        {"name":"anschreiben_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"finanz"},
        {"name":"mitglied_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"beitragskonto_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"vorlage_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"anlass","typ":"Auswahl","pflicht":"ja","liste":"vorlage_anlass","sicht":"finanz"},
        {"name":"datum","typ":"Datum","pflicht":"ja","liste":null,"sicht":"finanz"},
        {"name":"betreff","typ":"Text","pflicht":"ja","liste":null,"sicht":"finanz"},
        {"name":"inhalt","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"empfaenger","typ":"Text","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"versandart","typ":"Auswahl","pflicht":"nein","liste":"versandart","sicht":"finanz"},
        {"name":"serie","typ":"Text","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"dokument_link","typ":"Text","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"email_an","typ":"Text","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"gesendet_am","typ":"Zeitpunkt","pflicht":"nein","liste":null,"sicht":"finanz"},
        {"name":"mail_status","typ":"Auswahl","pflicht":"nein","liste":"mail_status","sicht":"finanz"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"finanz"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"finanz"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"finanz"}
      ]
    },
    "Notiz": {
      gruppe: "transaktional", idSpalte: "notiz_id", eindeutig: [],
      spalten: [
        {"name":"notiz_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"mitglied_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"beitragskonto_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"art","typ":"Auswahl","pflicht":"ja","liste":"notiz_art","sicht":"intern"},
        {"name":"text","typ":"Langtext","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"sichtbar_fuer","typ":"Auswahl","pflicht":"ja","liste":"notiz_sichtbarkeit","sicht":"intern"},
        {"name":"abteilung_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"wiedervorlage_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"erledigt_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"ergebnis","typ":"Text","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"anschreiben_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"erstellt_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"version","typ":"Ganzzahl","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_am","typ":"Zeitpunkt","pflicht":"auto","liste":null,"sicht":"intern"},
        {"name":"geaendert_von","typ":"Text","pflicht":"auto","liste":null,"sicht":"intern"}
      ]
    },
    "Statistik_Jahr": {
      gruppe: "technisch / anonym", idSpalte: "statistik_id", eindeutig: [],
      spalten: [
        {"name":"statistik_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"intern"},
        {"name":"jahr","typ":"Ganzzahl","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"stichtag","typ":"Datum","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"ebene","typ":"Auswahl","pflicht":"ja","liste":"ebene","sicht":"intern"},
        {"name":"abteilung_id","typ":"FK","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"abteilung_bezeichnung","typ":"Text","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"mitglieder_gesamt","typ":"Ganzzahl","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"davon_passiv","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"maennlich","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"weiblich","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"divers","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"alter_bis_14","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"alter_15_18","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"alter_19_26","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"alter_ab_27","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"eintritte","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"austritte","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"funktionstraeger","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"beitragsgemeinschaften","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"beitragssoll","typ":"Dezimal","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"beitragsist","typ":"Dezimal","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"eingefroren_am","typ":"Datum","pflicht":"ja","liste":null,"sicht":"intern"},
        {"name":"blsv_gemeldet_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"intern"},
        {"name":"bemerkung","typ":"Langtext","pflicht":"nein","liste":null,"sicht":"intern"}
      ]
    },
    "_Konfig": {
      gruppe: "technisch", idSpalte: null, eindeutig: [["schluessel"]],
      spalten: [
        {"name":"schluessel","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"wert","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"beschreibung","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"}
      ]
    },
    "_Protokoll": {
      gruppe: "technisch", idSpalte: "protokoll_id", eindeutig: [],
      spalten: [
        {"name":"protokoll_id","typ":"Ganzzahl","pflicht":"PK","liste":null,"sicht":"verwaltung"},
        {"name":"zeitpunkt","typ":"Zeitpunkt","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"benutzer_email","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"aktion","typ":"Auswahl","pflicht":"ja","liste":"protokoll_aktion","sicht":"verwaltung"},
        {"name":"tabelle","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"datensatz_id","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"feld","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"alt_wert","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"neu_wert","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"kommentar","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"bereinigt_am","typ":"Datum","pflicht":"nein","liste":null,"sicht":"verwaltung"}
      ]
    },
    "_Messung": {
      gruppe: "technisch", idSpalte: null, eindeutig: [],
      spalten: [
        {"name":"zeitpunkt","typ":"Zeitpunkt","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"funktion","typ":"Text","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"rolle","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"dauer_ms","typ":"Ganzzahl","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"sheets_aufrufe","typ":"Ganzzahl","pflicht":"ja","liste":null,"sicht":"verwaltung"},
        {"name":"cache","typ":"Text","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"client_ms","typ":"Ganzzahl","pflicht":"nein","liste":null,"sicht":"verwaltung"},
        {"name":"ok","typ":"ja/nein","pflicht":"ja","liste":"ja_nein","sicht":"verwaltung"}
      ]
    }
  };
  var LISTEN = {
    "anrede": ["Herr","Frau","Divers"],
    "geschlecht": ["m","w","d"],
    "versandart": ["Post","E-Mail"],
    "mitglied_status": ["aktiv","ausgetreten","verstorben"],
    "ja_nein": ["ja","nein"],
    "zugehoerigkeit": ["aktiv","passiv"],
    "zahlweg": ["Lastschrift","Überweisung","bar"],
    "sollstellung_status": ["offen","bezahlt","gemahnt","ruecklastschrift","widerspruch","storniert"],
    "ebene": ["Verein","Abteilung"],
    "bestellung": ["Wahl JHV","Wahl Abteilung","Berufung","Bestellung Vorstand"],
    "ehrungstyp": ["Mitgliedsjubiläum","Geburtstag","Funktionsjubiläum"],
    "ehrung_status": ["fällig","verliehen","verschoben","abgelehnt"],
    "intervall": ["jährlich"],
    "rolle": ["Vorstand","Mitgliederverwalter","Kassier","Abteilungsleiter","Jugendleiter"],
    "qual_kategorie": ["Führungszeugnis","Lizenz","Kurs"],
    "ergebnis": ["ohne einschlägigen Eintrag"],
    "austrittsgrund": ["Umzug","Unzufriedenheit","verstorben","Beitrag","Vereinswechsel","ohne Angabe"],
    "sepa_sequenz": ["FRST","RCUR","OOFF","FNAL"],
    "protokoll_aktion": ["angelegt","geändert","gelöscht","beendet","exportiert","gesperrt","anonymisiert","eingesehen","abgewiesen"],
    "loesch_stufe": ["gesperrt","anonymisiert","gelöscht"],
    "anfrage_status": ["eingegangen","in Prüfung","teilweise umgesetzt","vollständig umgesetzt","abgelehnt"],
    "bezugspunkt": ["Austritt","Ende Geschäftsjahr","Ende der Funktion","letzter Einzug","Eintrag im Protokoll","Eingang des Antrags"],
    "antrag_status": ["eingegangen","E-Mail bestätigt","wartet auf Unterschrift","vollständig","angenommen","abgelehnt","zurückgezogen","übernommen"],
    "antrag_quelle": ["Homepage-Formular","Papierantrag","E-Mail","Veranstaltung"],
    "anfrage_art": ["Auskunft (Art. 15)","Berichtigung (Art. 16)","Löschung (Art. 17)","Einschränkung (Art. 18)","Datenübertragbarkeit (Art. 20)","Widerspruch (Art. 21)","Widerruf einer Einwilligung (Art. 7)"],
    "einwilligung_art": ["Fotos und Videos","Newsletter per E-Mail","Ehrungen und Geburtstage in Vereinsmedien","Messenger-Gruppe","Weitergabe an den Verband"],
    "einwilligung_form": ["Aufnahmeantrag","gesondert schriftlich","digital","mündlich"],
    "ausbildung_art": ["Schule","Studium","Ausbildung","Freiwilligendienst","Sonstiges"],
    "dokument_art": ["Aufnahmeantrag","SEPA-Mandat","Kündigung","Einwilligung","Ausbildungsnachweis","Schriftverkehr","Sonstiges"],
    "vorlage_anlass": ["Aufnahmebestätigung","Austrittsbestätigung","Rechnung","Mahnung","SEPA-Vorabinformation","Beitragsänderung","Umstellung Einzelbeitrag","Ausbildungsnachweis anfordern","Ehrung","Geburtstag","Allgemein","Rückfrage Zahler","Kündigungseingang","Bankverbindung geändert","Rücklastschrift","Willkommen"],
    "mail_status": ["entwurf","gesendet","fehlgeschlagen","testmodus"],
    "notiz_art": ["Notiz","Telefonat","Rückfrage","Wiedervorlage"],
    "notiz_sichtbarkeit": ["Verwaltung","Finanzen","Abteilung","Jugendleitung"]
  };
  return { TABELLEN: TABELLEN, LISTEN: LISTEN };
})();
