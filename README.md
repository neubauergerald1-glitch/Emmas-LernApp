# Emmas Turnhalle

Lern-App im Turn-Stil für Emma: Aufwärmen mit Karteikarten, Übungen am Schwebebalken mit Kampfrichter-Wertung und Medaillen, Schreibübungen und eine 2-Minuten-Wettkampf-Runde.

- **Lernapp:** `index.html` (zum Homescreen hinzufügen → „Turnhalle“)
- **Eltern-App:** `eltern.html` (zum Homescreen hinzufügen → „Emma Eltern“)
- **Fest eingebaute Fächer:** `content.js` (aktuell: Englisch – Vokabeltest 26.11.2026, 2. Schularbeit 27.11.2026 mit Unit 4–7)
- **Probeschularbeiten:** `Probeschularbeit-Englisch-1.pdf` und `-2.pdf` (auch verlinkt in der Eltern-App)
- **Archiv:** 3 Tage nach einem Test oder einer Schularbeit wandern die zugehörigen Übungen automatisch in den Archiv-Ordner (`archive.js`). Dort bleiben sie spielbar, in der Eltern-App stehen sie unter „Archiv“.
- Weitere Fächer lassen sich in der App über „+ Fach hinzufügen“ anlegen.
- Fortschritt und eigene Fächer werden im Browser von Emmas Gerät gespeichert.

## Eltern-Benachrichtigung

Die Lernapp schickt nach jeder Übung eine Meldung an den Gratis-Dienst ntfy.sh. Der Kanal ist ein selbst gewählter Eltern-Code.
Der Code steht nicht im Code dieses Repos, sondern nur auf den Geräten.

1. `eltern.html` öffnen und einen Eltern-Code ausdenken (8–64 Zeichen).
2. In der Eltern-App unter „Einstellungen“ den „Link für Emmas Gerät“ kopieren und auf Emmas Gerät öffnen.
3. Optional: In der App „ntfy“ den Kanal mit dem Eltern-Code abonnieren, dann kommen Push-Meldungen.

Die App läuft über GitHub Pages (Branch `main`, Ordner `/`).
