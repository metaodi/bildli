/**
 * build.js - Sync football data into markdown content files
 *
 * This script fetches competition, team, and player data and stores it
 * as markdown files with frontmatter metadata under content/.
 *
 * Requires FOOTBALL_DATA_API_KEY environment variable.
 */

const https = require("https");
const fs = require("fs");
const { fetchTeamSquad } = require("./squad");
const {
  CONTENT_DIR,
  ensureDir,
  findExistingPlayerDoc,
  findExistingTeamDoc,
  getCompetitionFilePath,
  getPlayerFilePath,
  getTeamFilePath,
  listCompetitionDocs,
  listPlayerDocs,
  listTeamDocs,
  mapPosition,
  mergeGeneratedData,
  normalizeCompetition,
  parseShirtNumber,
  readMarkdownFile,
  translateNationality,
  writeMarkdownFile,
} = require("./content");

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const API_BASE = "https://api.football-data.org/v4";

// Rate limiting: free tier allows 10 requests/minute (= 6000ms interval).
// Adding safety buffer to avoid hitting the limit.
const DELAY_BETWEEN_TEAM_REQUESTS_MS = 6500;
const DELAY_BETWEEN_COMPETITIONS_MS = 7000;

const DEFAULT_COMPETITIONS = [
  {
    code: "WC",
    name: "FIFA Weltmeisterschaft",
    country: "Welt",
    flag: "🌍",
    sortOrder: 1,
    auto_update: true,
    visible: true,
  },
  {
    code: "PL",
    name: "Premier League",
    country: "England",
    flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    sortOrder: 2,
    auto_update: true,
    visible: true,
  },
  {
    code: "BL1",
    name: "Bundesliga",
    country: "Deutschland",
    flag: "🇩🇪",
    sortOrder: 3,
    auto_update: true,
    visible: true,
  },
];

if (!API_KEY) {
  console.error(
    "Error: FOOTBALL_DATA_API_KEY environment variable is required."
  );
  console.error("Get a free API key at https://www.football-data.org/client/register");
  process.exit(1);
}

function apiRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}${endpoint}`;
    console.log(`  Fetching: ${url}`);

    const options = {
      headers: {
        "X-Auth-Token": API_KEY,
      },
    };

    https
      .get(url, options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(new Error(`JSON parse error for ${url}: ${error.message}`));
            }
          } else if (res.statusCode === 429) {
            reject(new Error(`Rate limited on ${url}. Please wait and retry.`));
          } else {
            reject(new Error(`HTTP ${res.statusCode} for ${url}: ${data}`));
          }
        });
      })
      .on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadSyncCompetitions() {
  const competitionFilter = process.env.COMPETITION_FILTER || "All";

  const docs = listCompetitionDocs();
  const allCompetitions = docs.length === 0
    ? DEFAULT_COMPETITIONS
    : docs.map((doc) => normalizeCompetition(doc.data)).filter((competition) => competition.auto_update);

  if (competitionFilter === "All") {
    return allCompetitions;
  }

  const filtered = allCompetitions.filter((c) => c.code === competitionFilter);
  if (filtered.length === 0) {
    console.warn(`⚠️  No competition found with code "${competitionFilter}". Running with all competitions.`);
    return allCompetitions;
  }
  return filtered;
}

/**
 * Hide auto-updated documents that were previously present but are no longer
 * returned by the latest API response so they drop out of the built site.
 */
function markMissingDocsInvisible(docs, seenIds, idSelector) {
  for (const doc of docs) {
    const entityId = String(idSelector(doc.data));
    if (doc.data.auto_update === false || seenIds.has(entityId)) {
      continue;
    }

    writeMarkdownFile(
      doc.filePath,
      {
        ...doc.data,
        visible: false,
      },
      doc.content
    );
  }
}

async function fetchCompetition(competition) {
  console.log(`\nFetching competition: ${competition.name} (${competition.code})`);

  let competitionData;
  try {
    competitionData = await apiRequest(`/competitions/${competition.code}/teams`);
  } catch (error) {
    console.warn(`  Skipping ${competition.name}: ${error.message}`);
    return null;
  }

  const competitionFilePath = getCompetitionFilePath(competition.code);
  const existingCompetitionDoc = readMarkdownFile(competitionFilePath);
  const competitionFrontmatter = mergeGeneratedData(
    existingCompetitionDoc,
    {
      code: competition.code,
      name: competition.name,
      country: competition.country,
      flag: competition.flag,
      emblem: competitionData.competition ? competitionData.competition.emblem : null,
      season: competitionData.season
        ? {
            startDate: competitionData.season.startDate,
            endDate: competitionData.season.endDate,
          }
        : null,
      visible: true,
      auto_update: true,
      sortOrder: competition.sortOrder,
    },
    {
      auto_update: true,
      visible: true,
      sortOrder: competition.sortOrder,
    }
  );
  writeMarkdownFile(
    competitionFilePath,
    competitionFrontmatter,
    existingCompetitionDoc ? existingCompetitionDoc.content : ""
  );

  const existingTeamDocs = listTeamDocs(competition.code);
  const seenTeamIds = new Set();

  for (const team of competitionData.teams || []) {
    console.log(`  Processing team: ${team.name}`);
    seenTeamIds.add(String(team.id));

    await sleep(DELAY_BETWEEN_TEAM_REQUESTS_MS);

    let teamData;
    try {
      teamData = await apiRequest(`/teams/${team.id}`);
    } catch (error) {
      console.warn(`  Skipping team ${team.name}: ${error.message}`);
      continue;
    }

    let players = (teamData.squad || []).map((player) => {
      const position = mapPosition(player.position);
      return {
        id: player.id,
        name: player.name,
        firstName: player.firstName,
        lastName: player.lastName,
        dateOfBirth: player.dateOfBirth,
        nationality: translateNationality(player.nationality),
        position: position.label,
        positionOriginal: player.position,
        positionEmoji: position.emoji,
        positionSort: position.sort,
        shirtNumber: parseShirtNumber(player.shirtNumber),
        auto_update: true,
        visible: true,
      };
    });

    if (players.length === 0) {
      players = await fetchTeamSquad(team.name);
    }

    players.sort((a, b) => a.positionSort - b.positionSort);

    const existingTeamDoc = findExistingTeamDoc(competition.code, team.id);
    const teamFilePath = getTeamFilePath(competition.code, team.id, team.name);
    const teamFrontmatter = mergeGeneratedData(
      existingTeamDoc,
      {
        competitionCode: competition.code,
        id: team.id,
        name: team.name,
        shortName: team.shortName,
        tla: team.tla,
        crest: team.crest,
        clubColors: team.clubColors,
        founded: team.founded,
        venue: team.venue,
        website: team.website,
        coach: teamData.coach
          ? {
              name: teamData.coach.name,
              nationality: teamData.coach.nationality,
              dateOfBirth: teamData.coach.dateOfBirth,
            }
          : null,
        auto_update: true,
        visible: true,
      },
      {
        auto_update: true,
        visible: true,
      }
    );
    writeMarkdownFile(
      teamFilePath,
      teamFrontmatter,
      existingTeamDoc ? existingTeamDoc.content : ""
    );
    if (existingTeamDoc && existingTeamDoc.filePath !== teamFilePath) {
      fs.unlinkSync(existingTeamDoc.filePath);
    }

    const existingPlayerDocs = listPlayerDocs(competition.code, team.id);
    const seenPlayerIds = new Set();

    for (const player of players) {
      seenPlayerIds.add(String(player.id));
      const existingPlayerDoc = findExistingPlayerDoc(competition.code, team.id, player.id);
      const playerFilePath = getPlayerFilePath(competition.code, team.id, player.id, player.name);
      const playerFrontmatter = mergeGeneratedData(
        existingPlayerDoc,
        {
          competitionCode: competition.code,
          teamId: team.id,
          ...player,
        },
        {
          auto_update: true,
          visible: true,
        }
      );
      writeMarkdownFile(
        playerFilePath,
        playerFrontmatter,
        existingPlayerDoc ? existingPlayerDoc.content : ""
      );
      if (existingPlayerDoc && existingPlayerDoc.filePath !== playerFilePath) {
        fs.unlinkSync(existingPlayerDoc.filePath);
      }
    }

    markMissingDocsInvisible(existingPlayerDocs, seenPlayerIds, (data) => data.id);
  }

  markMissingDocsInvisible(existingTeamDocs, seenTeamIds, (data) => data.id);
  return competition.code;
}

async function main() {
  console.log("🏟️  Bildli - Syncing football markdown content...\n");
  ensureDir(CONTENT_DIR);

  const competitions = loadSyncCompetitions();
  let syncedCompetitions = 0;

  for (const competition of competitions) {
    const result = await fetchCompetition(competition);
    if (result) {
      syncedCompetitions++;
    }
    await sleep(DELAY_BETWEEN_COMPETITIONS_MS);
  }

  console.log(`\n✅ Synced markdown content for ${syncedCompetitions} competitions.`);
}

main().catch((error) => {
  console.error("❌ Sync failed:", error.message);
  process.exit(1);
});
