/**
 * scaffold.js - Seed player skeletons for curated-team leagues.
 *
 * football-data.org's free tier does not serve every league (e.g. the Swiss
 * Super League, SSL), so those competitions carry their teams as hand-committed
 * Markdown instead. `npm run fetch` skips them because the API request fails
 * before the per-team Wikidata fallback is ever reached.
 *
 * This step fills the gap: for each opted-in competition it reads every team's
 * current squad and writes player skeletons (name, DOB, shirt number, position,
 * nationality — and, from Wikipedia, image/height/foot/birthplace). enrich.js
 * then tops up anything still missing.
 *
 * Opt in per competition with a `squadSource` in its frontmatter:
 * - `wikipedia`  — read the club's `{{fs player}}` squad from its Wikipedia
 *   article (needs a `wikipedia:` article title on each team). Accurate roster.
 * - `wikidata`   — the looser Wikidata `member of sports team` query.
 * Network step (Wikipedia/Wikidata), like fetch/enrich — never the offline build.
 *
 * Design notes:
 * - Squad members are matched to existing player docs by date-of-birth + last
 *   name (same rule as enrich.js) so re-runs update in place instead of
 *   duplicating, and hand-curated players (auto_update: false) keep their data
 *   via mergeGeneratedData.
 * - Pruning: after a *successful* (non-empty) fetch, scaffold-managed players
 *   (`wd-` ids, auto_update) no longer in the squad are hidden (visible: false,
 *   never deleted). Gated on a non-empty result so a failed fetch can't wipe a
 *   roster; curated players (non-`wd-` ids) are never touched.
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

const SQUAD_SOURCE_WIKIPEDIA = "wikipedia";
const SQUAD_SOURCE_WIKIDATA = "wikidata";
const SCAFFOLD_ID_PREFIX = "wd-";
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
 * Find the existing player doc that represents the same person as a squad
 * entry, matched on date-of-birth + last name. Returns null when the player is
 * new to this team. Docs already claimed in this run are skipped so two entries
 * can't collapse onto one file.
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

/**
 * Hide scaffold-managed players (auto_update, `wd-` id) that are no longer in
 * the squad. Curated players and already-claimed/hidden docs are left alone.
 */
function pruneMissingPlayers(existingDocs, seenIds, claimed) {
  let hidden = 0;

  for (const doc of existingDocs) {
    const id = String(doc.data.id || "");
    if (doc.data.auto_update === false) continue;
    if (!id.startsWith(SCAFFOLD_ID_PREFIX)) continue;
    if (seenIds.has(id) || claimed.has(doc.filePath)) continue;
    if (doc.data.visible === false) continue;

    writeMarkdownFile(doc.filePath, { ...doc.data, visible: false }, doc.content);
    hidden++;
    console.log(`    − ${doc.data.name || id} (left squad → hidden)`);
  }

  return hidden;
}

async function scaffoldTeam(competitionCode, teamDoc, fetchSquad) {
  const team = normalizeTeam(teamDoc.data);
  console.log(`\n  Scaffolding squad: ${team.name}`);

  const players = await fetchSquad(team);
  if (players.length === 0) {
    console.log("    No squad members to write (skipping prune)");
    return { created: 0, updated: 0, hidden: 0, total: 0 };
  }

  const existingDocs = listPlayerDocs(competitionCode, team.id);
  const claimed = new Set();
  const seenIds = new Set();
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
    seenIds.add(String(frontmatter.id));

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

  const hidden = pruneMissingPlayers(existingDocs, seenIds, claimed);

  console.log(
    `    ${created} created, ${updated} updated, ${hidden} hidden (${players.length} in squad)`
  );
  return { created, updated, hidden, total: players.length };
}

/** Build the per-competition squad fetcher for a given source. */
function makeFetcher(squadSource) {
  if (squadSource === SQUAD_SOURCE_WIKIPEDIA) {
    return (team) => squad.fetchTeamSquadFromWikipedia(team.wikipedia);
  }
  return (team) => squad.fetchTeamSquad(team.name, { strictCurrent: true });
}

async function run({ competitionFilter, fetchSquad } = {}) {
  const filter = competitionFilter || process.env.COMPETITION_FILTER || "All";

  const competitions = listCompetitionDocs()
    .map((doc) => normalizeCompetition(doc.data))
    .filter(
      (competition) =>
        competition.auto_update &&
        (competition.squadSource === SQUAD_SOURCE_WIKIPEDIA ||
          competition.squadSource === SQUAD_SOURCE_WIKIDATA) &&
        (filter === "All" || competition.code === filter)
    );

  if (competitions.length === 0) {
    console.log(
      "No competitions to scaffold (need auto_update + squadSource: wikipedia|wikidata)."
    );
    return;
  }

  const totals = { created: 0, updated: 0, hidden: 0 };

  for (const competition of competitions) {
    console.log(
      `\n📋 Scaffolding: ${competition.name} (${competition.code}) via ${competition.squadSource}`
    );
    const fetch = fetchSquad || makeFetcher(competition.squadSource);

    const teamDocs = listTeamDocs(competition.code).filter(
      (teamDoc) => normalizeTeam(teamDoc.data).auto_update
    );

    for (const teamDoc of teamDocs) {
      const result = await scaffoldTeam(competition.code, teamDoc, fetch);
      totals.created += result.created;
      totals.updated += result.updated;
      totals.hidden += result.hidden;
      await sleep(DELAY_BETWEEN_TEAMS_MS);
    }
  }

  console.log(
    `\n✅ Scaffold complete: ${totals.created} created, ${totals.updated} updated, ${totals.hidden} hidden.`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  console.log("🧩 Bildli - Scaffolding player skeletons...\n");
  run().catch((error) => {
    console.error("❌ Scaffold failed:", error.message);
    process.exit(1);
  });
}

module.exports = { run, scaffoldTeam, findMatchingDoc, pruneMissingPlayers };
