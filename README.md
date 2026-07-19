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

### Neue Liga / neuen Wettbewerb hinzufügen

Für einen neuen Wettbewerb braucht es immer mindestens eine Datei unter `content/competitions/`:

```text
content/competitions/<CODE>.md
```

Beispiel:

```md
---
code: SA
name: Serie A
country: Italien
flag: 🇮🇹
sortOrder: 4
auto_update: true
visible: true
---
```

Wichtig:

- `code` muss ein Wettbewerbs-Code sein, den `football-data.org` unter `/competitions/<CODE>/teams` kennt, wenn die Liga automatisch aktualisiert werden soll.
- `sortOrder` steuert die Reihenfolge auf der Startseite.
- Der Markdown-Text unter dem Frontmatter ist optional und wird als Beschreibung geladen.

Je nach Pflege-Modell gibt es zwei Varianten:

1. **Automatisch gepflegte Liga (`auto_update: true`)**
   - Nur die Datei `content/competitions/<CODE>.md` muss ins Repository.
   - Danach erzeugt `npm run sync:content` automatisch weitere Markdown-Dateien:
     - `content/teams/<CODE>/<teamId>.md`
     - `content/players/<CODE>/<teamId>/<playerId>.md`
   - Diese Dateien werden auch vom Workflow **Update Content** erstellt bzw. aktualisiert.

2. **Kuratiert gepflegte Liga (`auto_update: false`)**
   - Zusätzlich zur Wettbewerbs-Datei müssen Teams und Spieler selbst als Markdown angelegt werden:
     - `content/teams/<CODE>/<teamId>.md`
     - `content/players/<CODE>/<teamId>/<playerId>.md`
   - Solche Dateien werden von den Sync-Skripten nicht überschrieben.

### Wie das Update funktioniert

`npm run sync:content` besteht aus zwei Schritten:

1. `npm run fetch`
   - Liest alle Wettbewerbe aus `content/competitions/*.md`
   - Verarbeitet nur Wettbewerbe mit `auto_update: true`
   - Holt Teams und Kader von `football-data.org`
   - Schreibt bzw. aktualisiert die Markdown-Dateien unter `content/teams/` und `content/players/`
   - Markiert automatisch gepflegte Teams oder Spieler, die nicht mehr von der API geliefert werden, mit `visible: false`

2. `npm run enrich`
   - Ergänzt automatisch gepflegte Teams und Spieler mit Wikidata-/Wikimedia-Daten
   - Fügt z. B. deutsche Teamnamen, Bilder, Grösse, bevorzugten Fuss oder Geburtsort hinzu

Wichtig für bestehende Inhalte:

- `auto_update: false` schützt kuratierte Frontmatter-Daten vor Überschreiben.
- `visible: false` blendet Inhalte aus, ohne die Datei zu löschen.
- `npm run build` baut die Website **nur** aus den eingecheckten Markdown-Dateien; es lädt keine API-Daten nach.

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
