# Regeln für Apps-Script-Webapps – TSV Ergoldsbach e.V.
 
Gilt für alle Systeme (Mitgliederverwaltung, ÜL-Stunden, Schichtplanung, Festival-Planung und alle künftigen Apps-Script-Webapps), unabhängig davon, in welchem Chat sie besprochen werden.
 
Aufbau Teil A Sicherheit · Teil B BereitstellungHomepage · Teil C Betrieb & Nachfolge · Teil D Recht & Datenschutz · Teil E Go-Live-Checkliste (konsolidiert)
 
---
 
# Teil A Sicherheit
 
## A1. Bereitstellung (Deployment)
- Ausführen als immer Ich (Eigentümer-Funktionskonto des Vereins) – nie der aufrufende Nutzer. Nur so funktioniert serverseitige Row-Column-Security, ohne Sheets direkt freizugeben.
- Zugriff domain-eingeschränkt (Jeder in [Workspace-Domain]) als Standard für alles, was ausschließlich Workspace-interne Personen betrifft. JederJeder mit dem Link nur, wenn explizit externe Nutzer ohne Google-Konto bedient werden müssen – dann zwingend mit eigener Token-Authentifizierung (siehe A6).
- Bei Updates die bestehende Deployment-ID weiterverwenden (neue Version der Bereitstellung, kein neues Deployment) → die exec-URL bleibt stabil.
## A2. Rollenprüfung serverseitig, nicht nur in der UI
- Jede serverseitige Funktion, die vom Frontend aufgerufen wird (`google.script.run`), prüft selbst RolleBerechtigung anhand `Session.getActiveUser().getEmail()` (bzw. Token bei externem Zugriff) – nicht nur einmal beim Laden der Seite.
- Kein Vertrauen auf client-seitige Beschränkungen Buttons ausblenden reicht nicht, da die Browser-Konsole jede serverseitige Funktion direkt aufrufen kann.
## A3. Keine dynamischen IDs vom Client
- Sheet-Datei-IDs nie als Client-Parameter entgegennehmen und ungeprüft öffnen.
- IDs fest im Code oder in einer Konfigurationstabelle hinterlegen. Der Client darf höchstens einen SlugSchlüssel schicken, der serverseitig gegen eine Whitelist gemappt wird (Muster Schichtplan-Register).
## A4. Datenisolation  geteilte Ablagen
- Die Haupt-Datenbank-Datei liegt in einem Ordner, auf den nur das Funktionskonto (ggf. + kleine Vorstands-Backup-Gruppe) direkten Drive-Zugriff hat.
- Vor jedem Go-Live prüfen Hat irgendjemand (Mitgliederverwalter, Kassier, Abteilungsleiter etc.) über Ordner-Freigaben direkten Zugriff auf das Sheet am WebApp vorbei Falls ja → Datei in restriktiveren Unterordner verschieben. Eine geteilte Ablage hebelt die WebApp-Sicherheitslogik aus, egal wie gut der Code ist.
- Öffentlich erreichbare Schreibziele (Aufnahmeanträge, Token-Formulare) sind immer in separaten, isolierten Dateien – nie die Haupt-Datenbank direkt exponieren.
## A5. Least-Privilege bei OAuth-Scopes
- Nur die Scopes anfordern, die der Code tatsächlich braucht (z. B. `SpreadsheetApp` statt volles `DriveApp`-Scope).
- `appsscript.json` bei jedem neuen Projekt auf unnötig breite Scopes prüfen.
## A6. Token-Authentifizierung (Zugriff ohne Google-Konto)
- Tokens unrateable gestalten (UUID oder signierter Hash, keine hochzählbaren IDs).
- AblaufdatumGültigkeit prüfen, wo sinnvoll; Möglichkeit zum WiderrufNeuausstellen einplanen.
- Token → Person-Mapping und Validierung ausschließlich serverseitig, nie im Client-Code nachvollziehbar.
## A7. Nebenläufigkeit
- Bei gleichzeitigen Schreibzugriffen mehrerer Nutzer `LockService` verwenden oder das Append-only-Journal-Pattern (wie bei Schichtplan-Bewerbungen). Nie direktes Überschreiben von Zeilen ohne Sperre.
## A8. Secrets & Konfiguration
- Keine Secrets, Token-Seeds oder API-Keys im Code hardcoden – `PropertiesService` (Script Properties) verwenden.
- Konfigurationsdaten (Rollen-Matrix, Schwellenwerte, Aufbewahrungsfristen) bleiben als Config-Tabs (bestehendes Prinzip Configuration over Code), aber nicht jeder Rolle Schreibzugriff auf `_Konfig`-Tabs geben, da Konfiguration selbst sicherheitsrelevant ist.
## A9. Fehlerbehandlung
- Fehlermeldungen an den Client generisch halten – keine Stack-Traces, keine internen Sheet-Tab-Namen, keine Rückschlüsse auf die Datenstruktur.
- Detaillierte Fehler nur serverseitig loggen, nie an den Client durchreichen.
## A10. Protokollierung  Audit
- Sicherheitsrelevante Aktionen (wer hat wann welche Daten geändert oder eingesehen) protokollieren – relevant auch für DSGVO-Betroffenenanfragen.
- Log-Umfang nach Datensparsamkeit nur was für Nachvollziehbarkeit nötig ist, nicht mehr; Löschfrist für Logs festlegen.
---
 
# Teil B Bereitstellung & Einbindung auf der Homepage
 
## B1. Grundprinzip keine eigene Subdomain
Frontends laufen nicht über eine separate Subdomain (z. B. `tools.tsv-ergoldsbach.de`), sondern als normale Unterseiten der bestehenden WordPress-Homepage. Eine Subdomain bräuchte eigenes DNSSSLHosting-Setup – zusätzliche Infrastruktur, die ein technisch weniger versierter Nachfolger warten müsste. Das widerspricht dem Grundsatz der Nachfolger-Wartbarkeit.
 
## B2. Einheitliches URL-Schema
Jedes System bekommt eine eigene, sprechende Slug-URL unter der Hauptdomain, z. B.
- `tsv-ergoldsbach.deschichtplan`
- `tsv-ergoldsbach.deuebungsleiter`
- `tsv-ergoldsbach.deverwaltung` (Mitgliederverwaltung, interner Zugang)
Zusätzlich eine zentrale Übersichtsseite (z. B. `verwaltung-tools`) mit LinksKacheln zu allen Systemen – dient gleichzeitig als Einstiegspunkt für Nutzer und als sichtbares Inventar für Nachfolger.
 
## B3. Standard-Umsetzung Redirect, kein Plugin nötig
Für Systeme mit genau einer festen Ziel-URL (Ein-Instanz-Fall – trifft auf ÜL, Mitgliederverwaltung, Festival-Planung zu)
- Normale WordPress-Seite mit gewünschtem Slug anlegen
- Custom-HTML-Block mit einfachem Redirect einfügen (Standard-Blockeditor, kein Plugin nötig)
```html
meta http-equiv=refresh content=0; url=DEPLOYMENT_EXEC_URL
pWeiterleitung... falls das nicht automatisch funktioniert, a href=DEPLOYMENT_EXEC_URLhier klickena.p
```
oder als unauffälligere JS-Variante
```html
scriptwindow.location.replace(DEPLOYMENT_EXEC_URL);script
```
Redirect ist der Standardfall, weil intensiv genutzte Formulare (ÜL-Erfassung, Mitgliederverwaltung) unter iFrame-Einschränkungen leiden würden (siehe B4).
 
## B4. Ausnahme iFrame
iFrame nur, wenn bewusst eine eingebettet in die Homepage-Optik gewünscht ist (z. B. reine Anzeige-Infoboards ohne intensive Formulareingabe), ebenfalls als simpler Custom-HTML-Block ohne Plugin
```html
iframe src=DEPLOYMENT_EXEC_URL width=100% height=800 style=bordernone;iframe
```
Nachteile, die im Regelfall gegen iFrame sprechen
- Mögliche `X-Frame-Options`CSP-Blockaden je nach Deployment-Einstellung
- Feste iFrame-Höhe passt selten auf allen Geräten (Scroll-in-Scroll, v. a. mobil)
- Google-Login-Popups funktionieren in iFrames teils unzuverlässig
## B5. Sonderfall Mehrinstanz-Systeme (z. B. Schichtplanung)
Wenn ein System mehrere parallele Instanzen mit eigener URL hat (Schichtplan ein Event = ein Slug, gemappt über die zentrale Registertabelle), reicht ein einfacher Redirect-iFrame-Block nicht. Hier wird ein WordPress-Shortcode gebraucht, der den Slug aus der Aufruf-URL ausliest und dynamisch als Parameter an die Apps-Script-URL übergibt. Das ist die Ausnahme, kein Vorbild für Ein-Instanz-Tools.
 
 Fall  Umsetzung 
------
 Ein Tool = eine feste URL  Redirect- oder iFrame-Block, kein Plugin 
 Ein Tool = mehrere Instanzen mit eigenem Slug  Shortcode mit Parameter-Weitergabe 
 
## B6. Stabile URLs sicherstellen
Beim Aktualisieren eines Apps-Script-Projekts immer die bestehende Deployment-ID über Neue Version aktualisieren, nie ein komplett neues Deployment anlegen (siehe auch A1). Nur so bleibt die im RedirectiFrameShortcode hinterlegte URL dauerhaft gültig.
 
## B7. Mobile-First als verbindliche Anforderung
Trainer erfassen Stunden am Handy, Helfer melden sich am Handy für Schichten an. Jedes Frontend wird für mobile Nutzung entworfen und auf einem echten Mobilgerät getestet, bevor es live geht – nicht als Nice-to-have, sondern als Abnahmekriterium.
 
## B8. Keine externen Ressourcen im Frontend
Google Fonts per CDN, jQuery von fremden CDNs o. ä. übertragen die IP-Adresse jedes Nutzers an Dritte – außerhalb des bestehenden Auftragsverarbeitungsvertrags mit Google und damit ein DSGVO-Problem. Regel Schriften und Bibliotheken lokal einbinden bzw. Systemschriften verwenden.
 
---
 
# Teil C Betrieb & Nachfolge
 
## C1. Eigentümerschaft der Script-Projekte
- Apps-Script-Projekte und zugehörige Dateien gehören einem Funktionskonto des Vereins (z. B. `edv@``verwaltung@`), nie einem persönlichen Konto einer Einzelperson.
- Ablage in einer geteilten Ablage (Shared Drive), damit die Organisation Eigentümer bleibt, auch wenn ein Konto deaktiviert wird.
- Grund Da alle Deployments als Eigentümerkonto ausführen, würde ein persönliches Eigentümerkonto beim Ausscheiden der Person sämtliche Systeme gleichzeitig lahmlegen. Das ist der größte einzelne Ausfallpunkt der Architektur.
- ZugangsdatenWiederherstellungsoptionen des Funktionskontos sind mindestens zwei Vorstandsmitgliedern bekannt bzw. hinterlegt.
## C2. Test- vs. Produktivumgebung
- Nie gegen Echtdaten entwickeln oder testen.
- Vorgehen Kopie des Sheets + separates Test-Deployment; Änderungen zuerst dort, dann in Produktion übernehmen.
- Besonders zwingend bei Mitgliederdaten und beim SEPA-Modul (fehlerhafte Lastschriftdateien haben reale finanzielle Folgen).
## C3. Backup
- Der Google-Versionsverlauf ist kein Backup gegen Logikfehler, die viele Zeilen technisch korrekt überschreiben.
- Regel zeitgesteuerter Apps-Script-Job legt regelmäßig eine Kopie der Datenbank in einen Backup-Ordner (Aufbewahrungsdauer und Rhythmus pro System festlegen).
- Backup-Ordner unterliegt denselben Zugriffsbeschränkungen wie das Original (siehe A4).
- Mindestens einmal testen, ob eine Wiederherstellung aus dem Backup tatsächlich funktioniert.
## C4. Apps-Script-Kontingente beachten
- Bekannte Grenzen dokumentieren und beim Entwurf berücksichtigen max. Laufzeit pro Ausführung, tägliches E-Mail-Kontingent, Anzahl paralleler Ausführungen, Trigger-Laufzeit pro Tag.
- Relevant, sobald Massenmails (Beitragsinformationen, Einladungen) oder große Schleifen über alle Mitglieder laufen.
- Bei absehbarem Kontingentproblem Batch-Verarbeitung mit Fortschrittsspeicherung statt einer langen Ausführung.
## C5. E-Mail-Versand aus Scripts
- Absenderidentität ist immer das Eigentümer-Funktionskonto – bei allen Systemen einheitlich und für Empfänger erkennbar (Absendername mit Vereinsbezug).
- `replyTo` auf das fachlich zuständige Postfach setzen (z. B. Kassier bei ÜL-Abrechnung), nicht auf das technische Funktionskonto.
- Fehlerbenachrichtigungen von Triggern gehen an ein Funktionskonto oder einen Verteiler, nicht an eine Einzelperson.
## C6. Zentrales Register aller Systeme
Ein zentrales BlattDokument führt für jedes System
- Systemname und Zweck
- Eigentümerkonto
- Datei-Sheet-ID, Script-Projekt-Link
- Deployment-ID und exec-URL
- WordPress-Slug und Einbindungsart (RedirectiFrameShortcode)
- Fachlich verantwortliche PersonFunktion
- Zugriffsberechtigung (Domain vs. Token)
Dient gleichzeitig als Nachfolge-Dokumentation und als Grundlage für das Verzeichnis von Verarbeitungstätigkeiten (D2).
 
## C7. Code-Dokumentationspflicht
- Kopfkommentar pro Code-Datei in verständlichem Deutsch Zweck, Datenquelle, wer darf was, bekannte Besonderheiten.
- Kommentare richten sich an einen technisch interessierten Nachfolger, nicht an einen Entwickler-Kollegen.
---
 
# Teil D Recht & Datenschutz
 
## D1. Impressum & Datenschutzerklärung im WebApp
Nach dem Redirect befindet sich der Nutzer technisch auf `script.google.com`, der Verein bleibt aber Diensteanbieter und Verantwortlicher. Jedes Frontend enthält daher eine Fußzeile mit Link auf Impressum und Datenschutzerklärung der Vereinshomepage.
 
## D2. Verzeichnis von Verarbeitungstätigkeiten
Pro System ein Eintrag mit Zweck der Verarbeitung, Datenkategorien, betroffene Personengruppen, Empfänger, Löschfristen, technisch-organisatorische Maßnahmen. Wird beim Bau des Systems mitgeschrieben, nicht nachträglich rekonstruiert.
 
## D3. Datensparsamkeit im Frontend
Nur Felder erheben, die für den jeweiligen Zweck erforderlich sind. Insbesondere IBAN nie über öffentlich erreichbare Webformulare erheben (bestehendes Prinzip).
 
## D4. Löschfristen technisch umsetzen
Aufbewahrungsfristen liegen als Konfigurationsdaten vor (bestehendes Prinzip) und werden auch tatsächlich angewendet – nicht nur dokumentiert. Pro System festlegen, wer die Löschung auslöst bzw. ob sie automatisiert läuft.
 
## D5. Plattformbindung
Alle Systeme bleiben innerhalb des Google Workspace for Nonprofits Tenants des Vereins, für den ein Auftragsverarbeitungsvertrag besteht. Zusätzliche externe Dienste (Drittanbieter-APIs, externe Hoster, fremde CDNs) werden nicht ohne vorherige datenschutzrechtliche Prüfung eingebunden.
 
---
 
# Teil E Go-Live-Checkliste
 
Vor jedem Livegang eines Systems vollständig durchgehen.
 
## Sicherheit
- [ ] Ausführen als Ich (Funktionskonto)
- [ ] Zugriff korrekt eingeschränkt (Domain vs. Jeder + Token)
- [ ] Rollenprüfung in jeder serverseitigen Funktion, nicht nur in der UI
- [ ] Keine dynamischen Datei-Sheet-IDs vom Client
- [ ] OAuth-Scopes minimal (`appsscript.json` geprüft)
- [ ] Datei- und Ordnerfreigaben geprüft – kein Zugriff am WebApp vorbei möglich
- [ ] Öffentliche Schreibziele in separater Datei isoliert
- [ ] Bei Mehrnutzer-Schreibzugriff LockService oder Append-only-Journal vorhanden
- [ ] Tokens unrateable, GültigkeitWiderruf geregelt
- [ ] Secrets in PropertiesService, nicht im Code
- [ ] Fehlermeldungen an Client generisch, Details nur serverseitig
- [ ] Audit-Log für sicherheitsrelevante Aktionen vorhanden, Log-Löschfrist definiert
## Bereitstellung
- [ ] URL-Schema konsistent (Slug unter Hauptdomain, keine Subdomain)
- [ ] Ein-Instanz- oder Mehrinstanz-Fall korrekt erkannt
- [ ] Redirect oder iFrame bewusst gewählt (nicht standardmäßig iFrame)
- [ ] Bei Mehrinstanz-Bedarf Shortcode mit Slug→ID-Mapping vorhanden
- [ ] Zentrale Übersichtsseite verlinkt das neue System
- [ ] Deployment-ID für künftige Updates dokumentiert (neue Version statt neues Deployment)
- [ ] Auf echtem Mobilgerät getestet
- [ ] Keine externen CDNsFonts eingebunden
## Betrieb & Nachfolge
- [ ] Projekt und Dateien gehören dem Funktionskonto, nicht einer Person
- [ ] Ablage in geteilter Ablage, Zugang zum Funktionskonto mehrfach hinterlegt
- [ ] Testumgebung existiert, Echtdaten wurden nicht zum Testen benutzt
- [ ] Automatisches Backup eingerichtet und Wiederherstellung einmal getestet
- [ ] Kontingentgrenzen geprüft (E-Mail-Volumen, Laufzeit, Trigger)
- [ ] E-Mail-Absender einheitlich, `replyTo` fachlich korrekt, Fehlermails an Verteiler
- [ ] Eintrag im zentralen Register vollständig
- [ ] Kopfkommentare in allen Code-Dateien auf Deutsch vorhanden
## Recht & Datenschutz
- [ ] Impressum und Datenschutzerklärung im Frontend verlinkt
- [ ] Eintrag im Verzeichnis von Verarbeitungstätigkeiten erstellt
- [ ] Nur erforderliche Felder erhoben, keine IBAN über öffentliches Formular
- [ ] Löschfristen konfiguriert und technisch umgesetzt, Zuständigkeit geklärt
- [ ] Keine externen Dienste außerhalb des Workspace-Tenants ohne Prüfung eingebunden
