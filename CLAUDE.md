# Hinweise für Claude

## Immer direkt auf `main` pushen

Dieses Projekt hat keinen Deploy-Workflow über Pull Requests. GitHub Pages
baut ausschließlich aus `main` (siehe README, Abschnitt „Veröffentlichen
über GitHub Pages"). Ein Feature-Branch allein bewirkt nichts auf der
Live-Seite.

Deshalb gilt abweichend von der sonst üblichen Vorsicht bei Pushes auf
geteilte Branches: Änderungen an diesem Repo sollen **direkt auf `main`**
committet und gepusht werden, ohne vorher auf einem separaten Branch zu
landen und ohne jedes Mal nachzufragen. Das ist hiermit im Voraus
autorisiert.

Falls eine Session mit einer anderslautenden Vorgabe gestartet wurde (z.B.
„entwickle auf Branch X"), zunächst dort committen wie vorgegeben und dann
direkt im Anschluss nach `main` mergen/pushen – ohne separate Rückfrage.

## Cache-Version nicht vergessen

Bei jeder Änderung an einer Datei aus der Offline-Liste in `sw.js`
(HTML, CSS, JavaScript, Manifest, Icons) muss im selben Zug die
Cache-Version in `sw.js` hochgezählt werden:

```js
var CACHE = 'sofi2026-v8';   // bei jeder Asset-Änderung +1
```

Ohne diesen Schritt liefert der Service Worker installierten Nutzern
weiterhin die alten Dateien aus dem Cache.
