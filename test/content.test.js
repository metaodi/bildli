/**
 * Unit tests for the shared content helpers in scripts/content.js.
 *
 * These cover only the pure, offline helpers — the same functions the build
 * relies on — so the suite never touches the network or the filesystem.
 * Run with `npm test` (Node's built-in test runner, no extra dependencies).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const content = require("../scripts/content.js");

test("slugify transliterates German umlauts and ß", () => {
  assert.equal(content.slugify("Zürich"), "zuerich");
  assert.equal(content.slugify("München"), "muenchen");
  assert.equal(content.slugify("Gößweinstein"), "goessweinstein");
  assert.equal(content.slugify("Ärger Über Öl"), "aerger-ueber-oel");
});

test("slugify lowercases, strips accents and collapses separators", () => {
  assert.equal(content.slugify("René  Adler"), "rene-adler");
  assert.equal(content.slugify("FC Bayern München!"), "fc-bayern-muenchen");
  assert.equal(content.slugify("  Hello   World  "), "hello-world");
  assert.equal(content.slugify("a--b__c"), "a-b-c");
});

test("slugify returns empty string for falsy input", () => {
  assert.equal(content.slugify(""), "");
  assert.equal(content.slugify(null), "");
  assert.equal(content.slugify(undefined), "");
});

test("calculateAge computes whole years and handles birthdays", () => {
  const now = new Date();
  const y = now.getFullYear();

  // Born 20 years ago yesterday -> already had this year's birthday.
  const hadBirthday = new Date(now);
  hadBirthday.setFullYear(y - 20);
  hadBirthday.setDate(hadBirthday.getDate() - 1);
  assert.equal(content.calculateAge(hadBirthday.toISOString().slice(0, 10)), 20);

  // Born 20 years ago tomorrow -> birthday hasn't happened yet this year.
  const notYet = new Date(now);
  notYet.setFullYear(y - 20);
  notYet.setDate(notYet.getDate() + 1);
  assert.equal(content.calculateAge(notYet.toISOString().slice(0, 10)), 19);
});

test("calculateAge returns null for missing or invalid dates", () => {
  assert.equal(content.calculateAge(null), null);
  assert.equal(content.calculateAge(undefined), null);
  assert.equal(content.calculateAge(""), null);
  assert.equal(content.calculateAge("not-a-date"), null);
});

test("parseShirtNumber parses ints and rejects non-numbers", () => {
  assert.equal(content.parseShirtNumber("10"), 10);
  assert.equal(content.parseShirtNumber(7), 7);
  assert.equal(content.parseShirtNumber("23 (loan)"), 23);
  assert.equal(content.parseShirtNumber("abc"), null);
  assert.equal(content.parseShirtNumber(""), null);
  assert.equal(content.parseShirtNumber(null), null);
});

test("mapPosition maps known positions to German labels with emoji and sort rank", () => {
  assert.deepEqual(content.mapPosition("Goalkeeper"), {
    label: "Torwart",
    emoji: "🧤",
    sort: 1,
  });
  assert.equal(content.mapPosition("Centre-Back").label, "Innenverteidiger");
  assert.equal(content.mapPosition("Centre-Forward").sort, 6);
  assert.equal(content.mapPosition("Coach").label, "Trainer");
});

test("mapPosition falls back for unknown or missing positions", () => {
  assert.deepEqual(content.mapPosition("Sweeper"), {
    label: "Sweeper",
    emoji: "⚽",
    sort: 7,
  });
  assert.equal(content.mapPosition(undefined).label, "Unbekannt");
  assert.equal(content.mapPosition(null).sort, 7);
});

test("translateNationality maps known countries and passes through the rest", () => {
  assert.equal(content.translateNationality("Switzerland"), "Schweiz");
  assert.equal(content.translateNationality("Germany"), "Deutschland");
  assert.equal(content.translateNationality("Ivory Coast"), "Elfenbeinküste");
  // Unknown values pass through unchanged.
  assert.equal(content.translateNationality("Narnia"), "Narnia");
  // Falsy values pass through unchanged.
  assert.equal(content.translateNationality(null), null);
  assert.equal(content.translateNationality(""), "");
});

test("normalizeCompetition defaults auto_update/visible to true and sortOrder to the max", () => {
  const c = content.normalizeCompetition({ code: "BL1", name: "Bundesliga" });
  assert.equal(c.auto_update, true);
  assert.equal(c.visible, true);
  assert.equal(c.sortOrder, content.DEFAULT_SORT_ORDER);

  assert.equal(content.normalizeCompetition({ visible: false }).visible, false);
  assert.equal(content.normalizeCompetition({ auto_update: false }).auto_update, false);
  assert.equal(content.normalizeCompetition({ sortOrder: 3 }).sortOrder, 3);
});

test("normalizeTeam mirrors competition visibility defaults", () => {
  const t = content.normalizeTeam({ id: 5, name: "FC Zürich" });
  assert.equal(t.auto_update, true);
  assert.equal(t.visible, true);
  assert.equal(t.sortOrder, content.DEFAULT_SORT_ORDER);
  assert.equal(content.normalizeTeam({ visible: false }).visible, false);
});

test("normalizePlayer hides players unless visible is explicitly true", () => {
  assert.equal(content.normalizePlayer({ name: "A" }).visible, false);
  assert.equal(content.normalizePlayer({ name: "A", visible: false }).visible, false);
  assert.equal(content.normalizePlayer({ name: "A", visible: "true" }).visible, false);
  assert.equal(content.normalizePlayer({ name: "A", visible: true }).visible, true);
});

test("normalizePlayer derives position label, emoji, sort and age", () => {
  const p = content.normalizePlayer({
    name: "Keeper",
    positionOriginal: "Goalkeeper",
    dateOfBirth: "2000-01-01",
    visible: true,
  });
  assert.equal(p.position, "Torwart");
  assert.equal(p.positionEmoji, "🧤");
  assert.equal(p.positionSort, 1);
  assert.equal(p.positionOriginal, "Goalkeeper");
  assert.equal(typeof p.age, "number");
});

test("normalizePlayer keeps explicit position fields when provided", () => {
  const p = content.normalizePlayer({
    name: "Custom",
    position: "Libero",
    positionEmoji: "🦅",
    positionSort: 9,
    visible: true,
  });
  assert.equal(p.position, "Libero");
  assert.equal(p.positionEmoji, "🦅");
  assert.equal(p.positionSort, 9);
});

test("mergeGeneratedData seeds a brand new document from defaults + generated data", () => {
  const merged = content.mergeGeneratedData(
    null,
    { name: "New", crest: "x.png" },
    { auto_update: true, visible: true }
  );
  assert.deepEqual(merged, {
    auto_update: true,
    visible: true,
    name: "New",
    crest: "x.png",
  });
});

test("mergeGeneratedData never overwrites curated (auto_update:false) frontmatter", () => {
  const existing = {
    data: { auto_update: false, name: "Hand Curated", visible: true, sortOrder: 2 },
  };
  const merged = content.mergeGeneratedData(existing, { name: "From API", crest: "new.png" });
  assert.equal(merged.name, "Hand Curated");
  assert.equal(merged.auto_update, false);
  assert.equal(merged.visible, true);
  // Generated fields not present in the curated doc are still added.
  assert.equal(merged.crest, "new.png");
});

test("mergeGeneratedData defaults curated visibility to true when unset", () => {
  const existing = { data: { auto_update: false, name: "Curated" } };
  const merged = content.mergeGeneratedData(existing, { name: "From API" });
  assert.equal(merged.visible, true);
});

test("mergeGeneratedData refreshes generated fields but preserves control flags", () => {
  const existing = {
    data: {
      auto_update: true,
      visible: false,
      sortOrder: 4,
      name: "Old Name",
      crest: "old.png",
    },
  };
  const merged = content.mergeGeneratedData(existing, {
    name: "New Name",
    crest: "new.png",
    sortOrder: 99,
  });
  // Generated fields refresh...
  assert.equal(merged.name, "New Name");
  assert.equal(merged.crest, "new.png");
  // ...but user control flags win.
  assert.equal(merged.auto_update, true);
  assert.equal(merged.visible, false);
  assert.equal(merged.sortOrder, 4);
});

test("getTeamFilePath appends a slug only when a name is given", () => {
  const withName = content.getTeamFilePath("BL1", 5, "FC Bayern München");
  assert.equal(path.basename(withName), "5-fc-bayern-muenchen.md");

  const withoutName = content.getTeamFilePath("BL1", 5);
  assert.equal(path.basename(withoutName), "5.md");
});

test("getPlayerFilePath nests under competition/team and slugs the name", () => {
  const p = content.getPlayerFilePath("SSL", "fcz", "fcz7", "René Adler");
  assert.equal(path.basename(p), "fcz7-rene-adler.md");
  assert.ok(p.includes(path.join("SSL", "fcz")));

  const noName = content.getPlayerFilePath("SSL", "fcz", "fcz7");
  assert.equal(path.basename(noName), "fcz7.md");
});

test("getCompetitionFilePath uses the code as the filename stem", () => {
  assert.equal(path.basename(content.getCompetitionFilePath("BL1")), "BL1.md");
});
