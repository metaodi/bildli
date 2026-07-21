/**
 * Integration smoke tests for loadContentData().
 *
 * loadContentData() is the build's entry point: it reads the committed
 * Markdown under content/ (no network) and returns the normalized, filtered,
 * sorted competition -> team -> player tree. These tests assert the invariants
 * the static build relies on, using whatever content is committed.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { loadContentData } = require("../scripts/content.js");

const data = loadContentData();

test("loadContentData returns an array of competitions", () => {
  assert.ok(Array.isArray(data));
  assert.ok(data.length > 0, "expected at least one visible competition committed");
});

test("every returned entity is visible", () => {
  for (const competition of data) {
    assert.equal(competition.visible, true);
    for (const team of competition.teams) {
      assert.equal(team.visible, true);
      for (const player of team.players) {
        assert.equal(player.visible, true);
      }
    }
  }
});

test("competitions are sorted by sortOrder then German name", () => {
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const cur = data[i];
    const ordered =
      prev.sortOrder < cur.sortOrder ||
      (prev.sortOrder === cur.sortOrder &&
        prev.name.localeCompare(cur.name, "de") <= 0);
    assert.ok(
      ordered,
      `competitions out of order: ${prev.name} before ${cur.name}`
    );
  }
});

test("players within a team are sorted by positionSort then name", () => {
  for (const competition of data) {
    for (const team of competition.teams) {
      for (let i = 1; i < team.players.length; i++) {
        const prev = team.players[i - 1];
        const cur = team.players[i];
        const ordered =
          prev.positionSort < cur.positionSort ||
          (prev.positionSort === cur.positionSort &&
            prev.name.localeCompare(cur.name, "de") <= 0);
        assert.ok(
          ordered,
          `players out of order in ${team.name}: ${prev.name} before ${cur.name}`
        );
      }
    }
  }
});

test("counts match the nested arrays", () => {
  for (const competition of data) {
    assert.equal(competition.teamCount, competition.teams.length);
    for (const team of competition.teams) {
      assert.equal(team.playerCount, team.players.length);
    }
  }
});

test("each competition exposes a code and name used by the build", () => {
  for (const competition of data) {
    assert.equal(typeof competition.code, "string");
    assert.ok(competition.code.length > 0);
    assert.equal(typeof competition.name, "string");
    assert.ok(competition.name.length > 0);
  }
});
