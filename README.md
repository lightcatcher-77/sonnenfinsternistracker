# SoFi-Tracker 2026

Web-App zur Sonnenfinsternis am **12. August 2026**. Sie rechnet für einen frei
wählbaren Standort aus, wann welche Phase eintritt, wie viel Prozent der Sonne
bedeckt sind und wo am Himmel die Sonne dann steht.

Alles läuft **offline im Browser** – keine API, kein Server, keine Tracker.

## Was drin ist

- **Örtliche Umstände**: 1.–4. Kontakt, Maximum, Bedeckungsgrad, Magnitude, Dauer
- **Zeitregler**: Uhrzeit frei verschieben und den Verlauf der Bedeckung sehen,
  inklusive Abspielfunktion für den gesamten Ablauf
- **Maßstabsgetreue Simulation** der Sonnenscheibe – der Mond läuft im korrekten
  Positionswinkel relativ zum Horizont über die Sonne
- **Horizontansicht**: Sonnenbahn mit Himmelsrichtung und Höhe – zeigt, wohin man
  schauen muss und ob Häuser oder Berge im Weg sind
- **Sonnenuntergangs-Warnung**, wenn die Sonne untergeht, während die Finsternis
  noch läuft (in Deutschland fast überall der Fall)
- **Standortwahl** per GPS, Städtesuche (offline) oder Koordinateneingabe
- **Countdown**, Kalender-Export (.ics) und Teilen-Funktion
- **PWA**: lässt sich auf dem Handy zum Homescreen hinzufügen und funktioniert
  ohne Netz – wichtig, wenn am Finsternistag alle gleichzeitig online sind

## Genauigkeit

Die Berechnung nutzt die **Besselschen Elemente** der NASA/GSFC (Five Millennium
Canon of Solar Eclipses, Espenak/Meeus) und das Standardverfahren für örtliche
Umstände nach Meeus bzw. dem Explanatory Supplement to the Astronomical Almanac.
Verwendet wird ΔT = 75,4 s. Die Höhe des Beobachtungsortes geht mit ein.

Gegenproben gegen veröffentlichte Werte:

| Ort | Tracker | Veröffentlicht |
|---|---|---|
| Köln, Bedeckung | 88,1 % | 88,3 % (DLR) |
| Köln, Maximum | 20:12:39 MESZ | „gegen 20:13" |
| Freiburg, Bedeckung | 90,1 % | 90 % |
| Berlin, Bedeckung | 84,7 % | 85 % |
| Burgos, Totalität | 101 s, Max 20:29:08 | ~104 s, „20:29" |
| Größte Finsternis | 17:45:58 UT, 137 s | 17:46:01 UT, 2m18s (NASA) |

Kontaktzeiten stimmen damit typischerweise auf wenige Sekunden, Bedeckungsgrade
auf etwa 0,3 Prozentpunkte.

**Grenze des Verfahrens:** Direkt am Rand der Totalitätszone (Bilbao, Reykjavík)
entscheiden wenige Kilometer, und das Bergprofil des Mondrandes verschiebt die
Grenze zusätzlich. Dort weichen auch professionelle Quellen voneinander ab – die
App weist bei solchen Orten ausdrücklich darauf hin.

## Veröffentlichen über GitHub Pages

1. Im Repository auf **Settings → Pages**
2. Unter *Build and deployment* → *Source*: **Deploy from a branch**
3. Branch auswählen, Ordner `/ (root)`, **Save**

Nach ein bis zwei Minuten ist die Seite unter
`https://<nutzername>.github.io/sonnenfinsternistracker/` erreichbar.

## Aufbau

```
index.html                  Seitenstruktur
assets/css/style.css        Dark-Space-Theme
assets/js/eclipse-core.js   Astronomie: Besselsche Elemente → örtliche Umstände
assets/js/cities.js         Offline-Ortsdatenbank
assets/js/app.js            Oberfläche, Canvas-Grafik, Zeitregler
sw.js                       Service Worker für Offline-Betrieb
manifest.webmanifest        PWA-Manifest
```

`eclipse-core.js` ist bewusst frei von DOM-Code und lässt sich auch in Node
verwenden – etwa um eigene Tabellen zu erzeugen.

## Sicherheitshinweis

In Mitteleuropa wird die Sonne **nie vollständig** bedeckt. Der Blick in die
Sonne erfordert durchgehend eine zertifizierte Sonnenfinsternis-Brille nach
**EN ISO 12312-2**. Niemals durch Fernglas, Kamera oder Teleskop ohne
geeigneten Objektivfilter schauen.
