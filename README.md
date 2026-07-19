# ⚽ Bildli

Fussball Steckbriefe und Sammelbilder für Kinder.

## Überblick

Bildli ist eine statische WebApp, die Fussball-Spieler als Sammelbilder im Panini-Stil darstellt. Kinder können eine Liga wählen, dann eine Mannschaft, und anschliessend die Spieler-Steckbriefe als interaktive Karten entdecken.

### Features

- 🏆 **Ligen**: Markdown-basierte Inhalte für Wettbewerbe, Teams und Spieler
- ⚽ **Spieler-Steckbriefe**: Name, Position, Alter, Nationalität, Trikotnummer
- 📸 **Spielerbilder**: Automatisch von Wikimedia Commons via Wikidata
- 📏 **Zusätzliche Infos**: Grösse, bevorzugter Fuss, Geburtsort (via Wikidata)
- 🎴 **Sammelbilder-Design**: Interaktive Karten zum Umdrehen
- 📱 **Responsive**: Optimiert für Tablet und Handy

## Datenquellen

- **Markdown im Repository**: Quelle für sichtbare Wettbewerbe, Teams und Spieler
- **[football-data.org](https://www.football-data.org)**: Automatisches Aktualisieren von Teams und Spielern mit `auto_update: true`
- **[Wikidata](https://www.wikidata.org)**: Spielerbilder, Grösse, bevorzugter Fuss, Geburtsort (via SPARQL)

## Setup

### Voraussetzungen

- Node.js >= 18
- Ein kostenloser API-Key von [football-data.org](https://www.football-data.org/client/register) nur für automatische Inhalts-Updates

### Lokale Entwicklung

```bash
# Abhängigkeiten installieren
npm install

# Statische Seite aus den eingecheckten Markdown-Dateien generieren
npm run build

# Markdown-Inhalte automatisch aktualisieren (benötigt API-Key)
FOOTBALL_DATA_API_KEY=dein-key npm run sync:content
```

Die generierte Seite liegt im `dist/` Verzeichnis. Während des Builds werden zusätzlich JSON-Dateien in `data/` erzeugt.

## Markdown-Inhalte pflegen

Die Inhalte liegen unter `content/`:

```text
content/
├── competitions/         # Ligen/Wettbewerbe
├── teams/<code>/         # Teams pro Wettbewerb
└── players/<code>/<id>/  # Spieler pro Team
```

Alle Dateien verwenden Frontmatter-Metadaten. Beispiel für einen Spieler:

```md
---
id: 123
competitionCode: BL1
teamId: 4
name: Beispiel Spieler
position: Goalkeeper
auto_update: false
visible: true
---
```

Wichtige Felder:

- `auto_update: true`: Der GitHub-Action-Job darf die Metadaten automatisch aus den APIs aktualisieren.
- `auto_update: false`: Die Datei bleibt kuratiert und wird nicht überschrieben.
- `visible: true`: Nur solche Spieler werden in der WebApp angezeigt.

## GitHub Actions

Es gibt zwei Workflows:

1. **Update Content**
   - Läuft manuell oder montags um 06:00 UTC
   - Führt `npm run sync:content` aus
   - Committet aktualisierte Markdown-Dateien zurück ins Repository
2. **Build and Deploy**
   - Läuft bei Pushes auf `main` oder manuell
   - Baut die WebApp ausschliesslich aus den eingecheckten Markdown-Dateien
   - Deployt die statische Seite auf GitHub Pages

Für automatische Updates muss das Repository-Secret `FOOTBALL_DATA_API_KEY` gesetzt sein.

## Projektstruktur

```text
bildli/
├── .github/workflows/    # GitHub Actions Workflows
├── content/              # Markdown-Quelldaten
├── data/                 # Generierte JSON-Daten (nicht im Repo)
├── dist/                 # Generierte statische Seite (nicht im Repo)
├── scripts/
│   ├── build.js          # Synchronisiert Markdown-Inhalte mit football-data.org
│   ├── enrich.js         # Ergänzt Markdown-Inhalte mit Wikidata-Daten
│   ├── content.js        # Frontmatter- und Inhalts-Helfer
│   └── build-site.js     # Baut die statische Seite aus Markdown-Inhalten
├── src/
│   ├── templates/        # Handlebars Templates
│   ├── style.css         # CSS (Panini-Stil, kindgerecht)
│   └── app.js            # Client-side JavaScript
├── package.json
└── README.md
```

## Lizenz

Daten: [football-data.org](https://www.football-data.org) (Free Tier), [Wikidata](https://www.wikidata.org) (CC0), Bilder: [Wikimedia Commons](https://commons.wikimedia.org) (verschiedene freie Lizenzen)
