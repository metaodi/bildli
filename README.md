# ⚽ Bildli

Fussball Steckbriefe und Sammelbilder für Kinder.

## Überblick

Bildli ist eine statische WebApp, die Fussball-Spieler als Sammelbilder im Panini-Stil darstellt. Kinder können eine Liga wählen, dann eine Mannschaft, und anschliessend die Spieler-Steckbriefe als interaktive Karten entdecken.

### Features

- 🏆 **Ligen**: FIFA Weltmeisterschaft, Premier League, Bundesliga
- ⚽ **Spieler-Steckbriefe**: Name, Position, Alter, Nationalität, Trikotnummer
- 📸 **Spielerbilder**: Automatisch von Wikimedia Commons via Wikidata
- 📏 **Zusätzliche Infos**: Grösse, bevorzugter Fuss, Geburtsort (via Wikidata)
- 🎴 **Sammelbilder-Design**: Interaktive Karten zum Umdrehen
- 📱 **Responsive**: Optimiert für Tablet und Handy

## Datenquellen

- **[football-data.org](https://www.football-data.org)**: Mannschaften, Spieler, Positionen, Trikotnummern
- **[Wikidata](https://www.wikidata.org)**: Spielerbilder, Grösse, bevorzugter Fuss, Geburtsort (via SPARQL)

## Setup

### Voraussetzungen

- Node.js >= 18
- Ein kostenloser API-Key von [football-data.org](https://www.football-data.org/client/register)

### Lokale Entwicklung

```bash
# Abhängigkeiten installieren
npm install

# Daten abrufen (benötigt API-Key)
FOOTBALL_DATA_API_KEY=dein-key npm run fetch

# Mit Wikidata anreichern
npm run enrich

# Statische Seite generieren
npm run build:site

# Oder alles auf einmal
FOOTBALL_DATA_API_KEY=dein-key npm run build
```

Die generierte Seite liegt im `dist/` Verzeichnis.

### GitHub Actions

Die App wird automatisch via GitHub Actions generiert und auf GitHub Pages deployed:

1. **API-Key als Secret hinterlegen**: Repository Settings → Secrets → `FOOTBALL_DATA_API_KEY`
2. **GitHub Pages aktivieren**: Repository Settings → Pages → Source: "GitHub Actions"
3. **Workflow starten**: Actions → "Build and Deploy" → "Run workflow"

Der Workflow läuft auch automatisch jeden Montag um 06:00 UTC.

## Projektstruktur

```
bildli/
├── .github/workflows/    # GitHub Actions Workflow
├── data/                  # Generierte JSON-Daten (nicht im Repo)
├── dist/                  # Generierte statische Seite (nicht im Repo)
├── scripts/
│   ├── build.js           # Daten von football-data.org abrufen
│   ├── enrich.js          # Daten mit Wikidata anreichern
│   └── build-site.js      # Statische HTML-Seiten generieren
├── src/
│   ├── templates/         # Handlebars Templates
│   ├── style.css          # CSS (Panini-Stil, kindgerecht)
│   └── app.js             # Client-side JavaScript
├── package.json
└── README.md
```

## Lizenz

Daten: [football-data.org](https://www.football-data.org) (Free Tier), [Wikidata](https://www.wikidata.org) (CC0), Bilder: [Wikimedia Commons](https://commons.wikimedia.org) (verschiedene freie Lizenzen)
