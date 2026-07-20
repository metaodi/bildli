/**
 * scaffold.js - Seed player skeletons for curated-team leagues from Wikidata.
 *
 * football-data.org's free tier does not serve every league (e.g. the Swiss
 * Super League, SSL), so those competitions carry their teams as hand-committed
 * Markdown instead. `npm run fetch` skips them because the API request fails
 * before the per-team Wikidata fallback is ever reached.
 *
 * This step fills the gap: for each opted-in competition it reads every team's
 * current squad from Wikidata and writes a player *skeleton* (name, date of
 * birth, shirt number, position, nationality). The weekly `enrich` step then
 * completes each skeleton with image, height, preferred foot and birthplace —
 * exactly the "basic info scraped, details enriched later" split.
 *
 * Opt in per competition by adding `squadSource: wikidata` to its frontmatter.
 * This is a network step (Wikidata), like fetch/enrich — never the offline build.
 *
 * Design notes:
 * - Wikidata squads are matched to existing player docs by date-of-birth +
 *   last name (same rule as enrich.js) so re-runs update in place instead of
 *   creating duplicates, and hand-curated players (auto_update: false) keep
 *   their data via mergeGeneratedData.
 * - Unlike the football-data sync, players missing from a Wikidata result are
 *   *not* hidden. Wikidata squads are less authoritative/complete, so hiding on
 *   absence would risk dropping real players; pruning stays a manual choice.
 */

const fs = require("fs");
const squad = require("./squad");
const {
  findExistingPlayerDoc,
  getPlayerFilePath,
  listCompetitionDocs,
  listPlayerDocs,
  listTeamDocs,
  mergeGeneratedData,
  normalizeCompetition,
  normalizeTeam,
  writeMarkdownFile,
} = require("./content");

const SQUAD_SOURCE_WIKIDATA = "wikidata";
const DELAY_BETWEEN_TEAMS_MS = 3000;

function lastNameOf(nameOrDoc) {
  const name =
    typeof nameOrDoc === "string"
      ? nameOrDoc
      : nameOrDoc.lastName || nameOrDoc.name || "";
  return String(name).split(" ").pop().toLowerCase();
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : null;
}

/**
 * Find the existing player doc that represents the same person as a Wikidata
 * squad entry, matched on date-of-birth + last name. Returns null when the
 * player is new to this team. Docs already claimed in this run are skipped so
 * two Wikidata entries can't collapse onto one file.
 */
function findMatchingDoc(player, existingDocs, claimed) {
  const dob = formatDate(player.dateOfBirth);
  if (!dob) return null;

  const wikiLast = lastNameOf(player);

  for (const doc of existingDocs) {
    if (claimed.has(doc.filePath)) continue;
    if (formatDate(doc.data.dateOfBirth) !== dob) continue;

    const docLast = lastNameOf(doc.data);
    if (wikiLast.includes(docLast) || docLast.includes(wikiLast)) {
      return doc;
    }
  }

  return null;
}

async function scaffoldTeam(competitionCode, teamDoc, fetchSquad) {
  const team = normalizeTeam(teamDoc.data);
  console.log(`\n  Scaffolding squad: ${team.name}`);

  const players = await fetchSquad(team.name, { strictCurrent: true });
  if (players.length === 0) {
    console.log("    No squad members to write");
    return { created: 0, updated: 0, total: 0 };
  }

  const existingDocs = listPlayerDocs(competitionCode, team.id);
  const claimed = new Set();
  let created = 0;
  let updated = 0;

  for (const player of players) {
    const match = findMatchingDoc(player, existingDocs, claimed);
    const existingDoc =
      match || findExistingPlayerDoc(competitionCode, team.id, player.id);

    const targetId = existingDoc ? existingDoc.data.id : player.id;
    const generated = {
      ...player,
      competitionCode,
      teamId: team.id,
      id: targetId,
    };

    const frontmatter = mergeGeneratedData(existingDoc, generated, {
      auto_update: true,
      visible: true,
    });

    const filePath = getPlayerFilePath(
      competitionCode,
      team.id,
      frontmatter.id,
      frontmatter.name
    );
    writeMarkdownFile(filePath, frontmatter, existingDoc ? existingDoc.content : "");

    if (existingDoc) {
      claimed.add(existingDoc.filePath);
      if (existingDoc.filePath !== filePath) {
        fs.unlinkSync(existingDoc.filePath);
      }
      updated++;
      console.log(`    ↻ ${frontmatter.name}`);
    } else {
      created++;
      console.log(`    + ${frontmatter.name}`);
    }
  }

  console.log(`    ${created} created, ${updated} updated (${players.length} total)`);
  return { created, updated, total: players.length };
}

async function run({ competitionFilter, fetchSquad } = {}) {
  const filter = competitionFilter || process.env.COMPETITION_FILTER || "All";
  const fetch = fetchSquad || squad.fetchTeamSquad;

  const competitions = listCompetitionDocs()
    .map((doc) => normalizeCompetition(doc.data))
    .filter(
      (competition) =>
        competition.auto_update &&
        competition.squadSource === SQUAD_SOURCE_WIKIDATA &&
        (filter === "All" || competition.code === filter)
    );

  if (competitions.length === 0) {
    console.log(
      `No competitions to scaffold (need auto_update + squadSource: ${SQUAD_SOURCE_WIKIDATA}).`
    );
    return;
  }

  const totals = { created: 0, updated: 0 };

  for (const competition of competitions) {
    console.log(`\n📋 Scaffolding: ${competition.name} (${competition.code})`);

    const teamDocs = listTeamDocs(competition.code).filter(
      (teamDoc) => normalizeTeam(teamDoc.data).auto_update
    );

    for (const teamDoc of teamDocs) {
      const result = await scaffoldTeam(competition.code, teamDoc, fetch);
      totals.created += result.created;
      totals.updated += result.updated;
      await sleep(DELAY_BETWEEN_TEAMS_MS);
    }
  }

  console.log(
    `\n✅ Scaffold complete: ${totals.created} player skeletons created, ${totals.updated} updated.`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  console.log("🧩 Bildli - Scaffolding player skeletons from Wikidata...\n");
  run().catch((error) => {
    console.error("❌ Scaffold failed:", error.message);
    process.exit(1);
  });
}

module.exports = { run, scaffoldTeam, findMatchingDoc };
