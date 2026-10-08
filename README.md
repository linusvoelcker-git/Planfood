# 🥕 Planfood

Wochenplaner fürs Essen mit Rezeptkartei, automatischer Einkaufsliste, Nährwerten und Archiv.
Reine statische Website (HTML/CSS/JavaScript): kein Server und kein Build-Schritt nötig.

## Funktionen

- **Wochenkalender** (Mo–So × Frühstück, Mittagessen, Abendessen, Snack) mit Wochennavigation.
- **Rezeptkartei**: Karten mit Registerreitern, nach Kategorie sortiert – oder per Umschalter (📇 / ☰) als einfache Namensliste. Fährt man mit der Maus darüber,
  wird die Karte aus dem Register nach oben gezogen. Per **Drag & Drop** kommt sie in den Kalender.
  Einträge lassen sich zwischen Tagen verschieben oder zurück in die Kartei ziehen (entfernt sie).
  Portionen pro Eintrag mit −/+ anpassbar. Auf dem Handy: Karte antippen → „Einplanen …“.
- **Tags & Filter**: farbige Tags wie *High Protein, Schnell, Vegan, Low Carb, Meal Prep, Günstig*.
  Im Rezept-Editor per Klick zuweisen oder neue anlegen; über der Kartei als Filter (mehrere = alle müssen passen).
  Farben/Namen unter ⚙︎ → *Tags verwalten*. Beim Excel-Import wird eine Spalte *Tags* (kommagetrennt) übernommen.
- **Rezept-Editor**: Mengen immer in **g** oder **Stück**. Nährwerte werden beim Tippen erkannt (✓ erkannt / ＋ Nährwerte).
- **Einkaufsliste läuft automatisch mit**: jedes Rezept im Kalender landet sofort mit seinen Zutaten in der Liste; gleiche Zutat + Einheit wird addiert,
  skaliert nach Portionen. Einträge zum Abhaken, eigene Einträge möglich, Kopieren als Text.
- **Live-Sync mit dem Kalender**: Rezepte bekommen einen **grünen** Rahmen, wenn alle Zutaten abgehakt sind,
  sonst einen **roten** (inkl. „3/5“-Zähler und Tooltip mit den fehlenden Zutaten).
  Kommt später mehr von einer schon abgehakten Zutat dazu, erscheint die zusätzliche Menge als neuer, offener Eintrag.
- **Archiv**: Wochen, die vorbei sind, werden automatisch archiviert (schreibgeschützt, mit Kopie der Rezepte).
  Man kann eine Woche auch manuell abschließen, sie wieder öffnen oder als Vorlage für eine neue Woche nutzen.
- **Excel-Import** (📥 neben der Suche): liest .xlsx/.xls/.ods/.csv mit einer Zeile pro Zutat
  (Spalten *Gericht, Zutat, Menge, Einheit*, optional *Zubereitung, Portionen, Kategorie, Tag, Mahlzeit*, Nährwert-Spalten)
  und formt daraus einzelne Rezepte. Ein Blatt mit *Zutat + Nährwerten pro 100 g* wird als Nährwertquelle übernommen,
  *Tag/Mahlzeit* auf Wunsch als Wochenplan. Vorlage zum Herunterladen im Import-Dialog.
- **Profil** (👤): Gewicht, Größe, Alter, Geschlecht, Aktivität → **BMI** mit Skala und Gewichtsverlauf.
  **Ziele** für Energie, Eiweiß, Kohlenhydrate, Fett, Ballaststoffe, Zucker – pro Tag oder pro Woche, als
  *mindestens*, *höchstens* oder *ungefähr*; optional als Vorschlag aus den Körperdaten berechnet.
  Die **Tagessumme** im Kalender wird grün (alle Ziele erreicht) oder rot, darunter zeigt **„Woche gesamt“**
  Balken mit Wochensumme gegenüber dem Wochenziel.
- **Rezepte löschen** in der Listenansicht: 🗑 je Rezept oder „Mehrere auswählen“ (auch ganze Kategorien) und gemeinsam löschen.
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
js/importer.js     Excel-/CSV-Import (nutzt SheetJS in js/vendor, Apache-2.0)
js/nutrition.js    Nährwert-Suche (Open Food Facts, USDA) & Berechnung
js/store.js        Daten: Rezepte, Wochen, Einkaufsliste, Archiv, Speicherung
js/app.js          Oberfläche & Drag and Drop
```
