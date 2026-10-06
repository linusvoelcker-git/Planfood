# 🥕 Planfood

Wochenplaner fürs Essen mit Rezeptkartei, automatischer Einkaufsliste, Nährwerten und Archiv.
Reine statische Website (HTML/CSS/JavaScript): kein Server und kein Build-Schritt nötig.

## Funktionen

- **Wochenkalender** (Mo–So × Frühstück, Mittagessen, Abendessen, Snack) mit Wochennavigation.
- **Rezeptkartei**: Karten mit Registerreitern, nach Kategorie sortiert. Fährt man mit der Maus darüber,
  wird die Karte aus dem Register nach oben gezogen. Per **Drag & Drop** kommt sie in den Kalender.
  Einträge lassen sich zwischen Tagen verschieben oder zurück in die Kartei ziehen (entfernt sie).
  Portionen pro Eintrag mit −/+ anpassbar. Auf dem Handy: Karte antippen → „Einplanen …“.
- **Rezept-Editor**: Mengen immer in **g** oder **Stück**. Nährwerte werden beim Tippen erkannt (✓ erkannt / ＋ Nährwerte).
- **Einkaufsliste läuft automatisch mit**: jedes Rezept im Kalender landet sofort mit seinen Zutaten in der Liste; gleiche Zutaten werden addiert (gleiche Zutat + Einheit wird addiert),
  skaliert nach Portionen. Einträge zum Abhaken, eigene Einträge möglich, Kopieren als Text.
- **Live-Sync mit dem Kalender**: Rezepte bekommen einen **grünen** Rahmen, wenn alle Zutaten abgehakt sind,
  sonst einen **roten** (inkl. „3/5“-Zähler und Tooltip mit den fehlenden Zutaten).
  Kommt später mehr von einer schon abgehakten Zutat dazu, erscheint die zusätzliche Menge als neuer, offener Eintrag.
- **Archiv**: Wochen, die vorbei sind, werden automatisch archiviert (schreibgeschützt, mit Kopie der Rezepte).
  Man kann eine Woche auch manuell abschließen, sie wieder öffnen oder als Vorlage für eine neue Woche nutzen.
- **Nährwerte**: pro Portion, pro Tag und pro Woche (Makros + Mikronährstoffe, sobald Daten vorhanden sind).

## Starten

Lokal: `index.html` im Browser öffnen, oder für einen kleinen Server z. B. `npx http-server .` ausführen.

**Online über GitHub Pages:** Repository → *Settings* → *Pages* → *Source: Deploy from a branch* →
Branch `main`, Ordner `/ (root)` → *Save*. Nach ca. 1 Minute läuft die Seite unter
`https://<dein-github-name>.github.io/Planfood/`.

## Woher kommen die Nährwerte?

| Quelle | Was | Vorteil | Nachteil |
|---|---|---|---|
| **Eingebaute Tabelle** (`js/foods.js`) | ~70 Grundzutaten, Makros + Gewicht pro Stück | sofort, offline, automatische Erkennung | nur Richtwerte, keine Mikros |
| **Open Food Facts** | Produktdatenbank, deutsch, ohne Anmeldung | Markenprodukte, Barcodes | Mikronährstoffe nur lückenhaft |
| **USDA FoodData Central** | Grundnahrungsmittel mit ~20 Mikronährstoffen | sehr vollständig | englische Suchbegriffe; eigener kostenloser API-Key empfohlen (⚙︎ Einstellungen) |

Gefundene Werte werden pro Zutat gespeichert. Alle Rezepte mit dieser Zutat nutzen sie danach automatisch.
Bei „Stück“-Angaben braucht die Zutat ein *Gewicht pro Stück*.

Mögliche Erweiterung: Der **Bundeslebensmittelschlüssel (BLS)** bietet sehr gute deutsche Daten.
Er ist aber lizenzpflichtig und müsste als eigene Tabelle eingebunden werden.

## Datenspeicherung

Aktuell liegt alles im `localStorage` des Browsers. Über ⚙︎ → Export/Import lässt sich ein JSON-Backup erstellen
oder auf ein anderes Gerät umziehen. Für automatischen Sync zwischen Geräten wäre der nächste Schritt eine
Datenbank, z. B. **Supabase** (Postgres + Login, kostenloser Plan) oder **Firebase Firestore**.
Die Datenschicht steckt komplett in `js/store.js` und lässt sich dort austauschen.

## Aufbau

```
index.html         Grundgerüst & Dialoge
css/styles.css     Design (hell/dunkel, responsiv, Karteikasten-Animation)
js/foods.js        eingebaute Nährwerttabelle
js/nutrition.js    Nährwert-Suche (Open Food Facts, USDA) & Berechnung
js/store.js        Daten: Rezepte, Wochen, Einkaufsliste, Archiv, Speicherung
js/app.js          Oberfläche & Drag and Drop
```
