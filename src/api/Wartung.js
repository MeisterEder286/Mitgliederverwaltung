/**
 * Wartung – Trigger-Funktionen für die nächtliche Pflege (Logik in src/modul/Wartung.js).
 *
 * Zweck:       wartungNachts (täglich ca. 02:00, eingerichtet über triggerEinrichten) und wartungFortsetzen
 *              (einmaliger Folge-Trigger, falls ein Lauf wegen der Laufzeitgrenze abbrechen musste).
 * Datenquelle: alle Tabs über DB.
 * Wer darf was: nur das Funktionskonto (Zugriff.nurFunktionskonto) – also Trigger oder Editor, nie ein Browser.
 *              Aus dem Browser aufgerufen, weist nurFunktionskonto ab; der Fehler wird nur geloggt.
 * Besonderheiten: Keine api…-Funktion, gibt nichts an einen Client.
 */

/** Zeit-Trigger (täglich): nächtliche Pflege. */
function wartungNachts() {
  try {
    var konto = Zugriff.nurFunktionskonto();
    return Wartung.ausfuehren({ email: konto.email });
  } catch (e) {
    console.error('wartungNachts fehlgeschlagen: ' + (e && e.message));
    return null;
  }
}

/** Einmaliger Folge-Trigger nach Laufzeit-Abbruch: offene Schritte erledigen. */
function wartungFortsetzen() {
  try {
    var konto = Zugriff.nurFunktionskonto();
    Wartung.folgeTriggerEntfernen();
    return Wartung.ausfuehren({ email: konto.email });
  } catch (e) {
    console.error('wartungFortsetzen fehlgeschlagen: ' + (e && e.message));
    return null;
  }
}
