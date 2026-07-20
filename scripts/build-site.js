/**
 * build-site.js - Generate static HTML pages from markdown content
 */

const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const { DATA_DIR, ensureDir, loadContentData } = require("./content");

const DIST_DIR = path.join(__dirname, "..", "dist");
const TEMPLATE_DIR = path.join(__dirname, "..", "src", "templates");
const SRC_DIR = path.join(__dirname, "..", "src");

Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("formatDate", (dateStr) => {
  if (!dateStr) return "Unbekannt";
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
});
Handlebars.registerHelper("json", (context) => JSON.stringify(context));
Handlebars.registerHelper("lowercase", (str) => (str || "").toLowerCase());

function loadTemplate(name) {
  const templatePath = path.join(TEMPLATE_DIR, `${name}.hbs`);
  const source = fs.readFileSync(templatePath, "utf-8");
  return Handlebars.compile(source);
}

function registerPartial(name) {
  const partialPath = path.join(TEMPLATE_DIR, `_${name}.hbs`);
  const source = fs.readFileSync(partialPath, "utf-8");
  Handlebars.registerPartial(name, source);
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyAssets() {
  const assetsDir = path.join(DIST_DIR, "assets");
  ensureDir(assetsDir);

  const cssSource = path.join(SRC_DIR, "style.css");
  if (fs.existsSync(cssSource)) {
    fs.copyFileSync(cssSource, path.join(assetsDir, "style.css"));
  }

  const jsSource = path.join(SRC_DIR, "app.js");
  if (fs.existsSync(jsSource)) {
    fs.copyFileSync(jsSource, path.join(assetsDir, "app.js"));
  }

  const imagesSource = path.join(__dirname, "..", "images");
  if (fs.existsSync(imagesSource)) {
    copyDir(imagesSource, path.join(DIST_DIR, "images"));
  }
}

function buildSite() {
  console.log("🏗️  Building static site from markdown content...\n");

  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
  ensureDir(DATA_DIR);

  registerPartial("head");
  registerPartial("header");
  registerPartial("footer");
  registerPartial("player-card");

  const indexTemplate = loadTemplate("index");
  const competitionTemplate = loadTemplate("competition");
  const teamTemplate = loadTemplate("team");

  const competitionData = loadContentData();
  const competitionIndex = competitionData.map((competition) => ({
    code: competition.code,
    name: competition.name,
    country: competition.country,
    flag: competition.flag,
    emblem: competition.emblem,
    teamCount: competition.teamCount,
  }));

  fs.writeFileSync(
    path.join(DATA_DIR, "index.json"),
    JSON.stringify(competitionIndex, null, 2)
  );

  const indexHtml = indexTemplate({ competitions: competitionIndex });
  fs.writeFileSync(path.join(DIST_DIR, "index.html"), indexHtml);
  console.log("  Generated: index.html");

  for (const competition of competitionData) {
    const competitionJson = {
      ...competition,
      teams: competition.teams,
    };
    fs.writeFileSync(
      path.join(DATA_DIR, `${competition.code}.json`),
      JSON.stringify(competitionJson, null, 2)
    );

    const competitionDir = path.join(DIST_DIR, competition.code.toLowerCase());
    ensureDir(competitionDir);

    const competitionHtml = competitionTemplate(competitionJson);
    fs.writeFileSync(path.join(competitionDir, "index.html"), competitionHtml);
    console.log(`  Generated: ${competition.code.toLowerCase()}/index.html`);

    for (const team of competition.teams) {
      const teamDir = path.join(competitionDir, String(team.id));
      ensureDir(teamDir);

      const teamHtml = teamTemplate({
        ...team,
        competition: {
          code: competition.code,
          name: competition.name,
          flag: competition.flag,
        },
      });
      fs.writeFileSync(path.join(teamDir, "index.html"), teamHtml);
      console.log(`  Generated: ${competition.code.toLowerCase()}/${team.id}/index.html`);
    }
  }

  const dataDistDir = path.join(DIST_DIR, "data");
  ensureDir(dataDistDir);
  for (const file of fs.readdirSync(DATA_DIR)) {
    if (file.endsWith(".json")) {
      fs.copyFileSync(path.join(DATA_DIR, file), path.join(dataDistDir, file));
    }
  }

  copyAssets();
  fs.writeFileSync(path.join(DIST_DIR, ".nojekyll"), "");

  console.log("\n✅ Static site built successfully!");
}

buildSite();
