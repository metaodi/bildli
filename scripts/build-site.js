/**
 * build-site.js - Generate static HTML pages from fetched football data
 *
 * Reads JSON files from data/ directory and generates static HTML pages
 * in the dist/ directory for GitHub Pages deployment.
 */

const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");

const DATA_DIR = path.join(__dirname, "..", "data");
const DIST_DIR = path.join(__dirname, "..", "dist");
const TEMPLATE_DIR = path.join(__dirname, "..", "src", "templates");
const SRC_DIR = path.join(__dirname, "..", "src");

// Register Handlebars helpers
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("formatDate", (dateStr) => {
  if (!dateStr) return "Unbekannt";
  const d = new Date(dateStr);
  return d.toLocaleDateString("de-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
});
Handlebars.registerHelper("json", (context) => JSON.stringify(context));
Handlebars.registerHelper("lowercase", (str) => (str || "").toLowerCase());

/**
 * Read and compile a Handlebars template
 */
function loadTemplate(name) {
  const templatePath = path.join(TEMPLATE_DIR, `${name}.hbs`);
  const source = fs.readFileSync(templatePath, "utf-8");
  return Handlebars.compile(source);
}

/**
 * Register a partial template
 */
function registerPartial(name) {
  const partialPath = path.join(TEMPLATE_DIR, `_${name}.hbs`);
  const source = fs.readFileSync(partialPath, "utf-8");
  Handlebars.registerPartial(name, source);
}

/**
 * Copy static assets to dist
 */
function copyAssets() {
  const assetsDir = path.join(DIST_DIR, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  // Copy CSS
  const cssSource = path.join(SRC_DIR, "style.css");
  if (fs.existsSync(cssSource)) {
    fs.copyFileSync(cssSource, path.join(assetsDir, "style.css"));
  }

  // Copy JS
  const jsSource = path.join(SRC_DIR, "app.js");
  if (fs.existsSync(jsSource)) {
    fs.copyFileSync(jsSource, path.join(assetsDir, "app.js"));
  }
}

/**
 * Generate all static pages
 */
function buildSite() {
  console.log("🏗️  Building static site...\n");

  // Clean and create dist directory
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // Register partials
  registerPartial("head");
  registerPartial("header");
  registerPartial("footer");
  registerPartial("player-card");

  // Load templates
  const indexTemplate = loadTemplate("index");
  const competitionTemplate = loadTemplate("competition");
  const teamTemplate = loadTemplate("team");

  // Load data
  const indexPath = path.join(DATA_DIR, "index.json");
  if (!fs.existsSync(indexPath)) {
    console.error("❌ No data found. Run 'npm run build' first to fetch data.");
    process.exit(1);
  }

  const competitions = JSON.parse(fs.readFileSync(indexPath, "utf-8"));

  // Generate index page
  const indexHtml = indexTemplate({ competitions });
  fs.writeFileSync(path.join(DIST_DIR, "index.html"), indexHtml);
  console.log("  Generated: index.html");

  // Generate competition and team pages
  for (const comp of competitions) {
    const compDataPath = path.join(DATA_DIR, `${comp.code}.json`);
    if (!fs.existsSync(compDataPath)) continue;

    const compData = JSON.parse(fs.readFileSync(compDataPath, "utf-8"));

    // Competition page (team listing)
    const compDir = path.join(DIST_DIR, comp.code.toLowerCase());
    fs.mkdirSync(compDir, { recursive: true });

    const compHtml = competitionTemplate(compData);
    fs.writeFileSync(path.join(compDir, "index.html"), compHtml);
    console.log(`  Generated: ${comp.code.toLowerCase()}/index.html`);

    // Team pages (player listing)
    for (const team of compData.teams) {
      const teamDir = path.join(compDir, String(team.id));
      fs.mkdirSync(teamDir, { recursive: true });

      const teamHtml = teamTemplate({
        ...team,
        competition: {
          code: compData.code,
          name: compData.name,
          flag: compData.flag,
        },
      });
      fs.writeFileSync(path.join(teamDir, "index.html"), teamHtml);
      console.log(
        `  Generated: ${comp.code.toLowerCase()}/${team.id}/index.html`
      );
    }
  }

  // Copy JSON data for potential client-side use
  const dataDistDir = path.join(DIST_DIR, "data");
  fs.mkdirSync(dataDistDir, { recursive: true });
  for (const file of fs.readdirSync(DATA_DIR)) {
    if (file.endsWith(".json")) {
      fs.copyFileSync(
        path.join(DATA_DIR, file),
        path.join(dataDistDir, file)
      );
    }
  }

  // Copy static assets
  copyAssets();

  // Create .nojekyll for GitHub Pages
  fs.writeFileSync(path.join(DIST_DIR, ".nojekyll"), "");

  console.log("\n✅ Static site built successfully!");
}

buildSite();
