/**
 * build.js - Sync football data into markdown content files
 *
 * This script fetches competition, team, and player data and stores it
 * as markdown files with frontmatter metadata under content/.
 *
 * Requires FOOTBALL_DATA_API_KEY environment variable.
 */

const https = require("https");
const wikidata = require("./wikidata");
const {
  CONTENT_DIR,
  ensureDir,
  getCompetitionFilePath,
  getPlayerFilePath,
  getTeamFilePath,
  listCompetitionDocs,
  listPlayerDocs,
  listTeamDocs,
  mapPosition,
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
const ACTIVE_PLAYER_MAX_AGE = 45;
const ASSOCIATION_FOOTBALL_PLAYER_QID = "Q937857";
const ASSOCIATION_FOOTBALL_MANAGER_QID = "Q628099";
const SPORTS_COACH_QID = "Q2732438";

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

const WIKIDATA_POSITION_MAP = {
  Q193592: "Goalkeeper",
  Q336286: "Left Back",
  Q1399991: "Right Back",
  Q336287: "Centre-Back",
  Q201012: "Defensive Midfield",
  Q193893: "Central Midfield",
  Q1207750: "Attacking Midfield",
  Q280658: "Left Midfield",
  Q280657: "Right Midfield",
  Q280153: "Left Winger",
  Q280154: "Right Winger",
  Q1394522: "Centre-Forward",
};

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

function getActivePlayerBirthDateCutoff(maxAge) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - maxAge);
  return cutoff.toISOString().slice(0, 10);
}

async function fetchPlayersFromWikidata(teamName) {
  console.log("    ⚡ No players from API, trying Wikidata fallback...");

  const teamQID = await wikidata.findTeamQID(teamName);
  if (!teamQID) {
    console.warn(`    Could not find team "${teamName}" on Wikidata`);
    return [];
  }

  if (!/^Q\d+$/.test(teamQID)) {
    console.warn(`    Invalid Wikidata QID format: ${teamQID}`);
    return [];
  }

  console.log(`    Found Wikidata entity: ${teamQID}`);
  await wikidata.sleep(2000);
  const activePlayerBirthDateCutoff = getActivePlayerBirthDateCutoff(
    ACTIVE_PLAYER_MAX_AGE
  );

  const query = `
    SELECT ?player ?playerLabel ?firstName ?lastName ?dob
           ?nationalityLabel ?positionLabel ?position ?shirtNumber
    WHERE {
      ?player p:P54 ?teamStmt .
      ?teamStmt ps:P54 wd:${teamQID} .
      FILTER NOT EXISTS {
        ?teamStmt pq:P582 ?endDate .
        FILTER(?endDate < NOW())
      }
      ?player wdt:P106 wd:${ASSOCIATION_FOOTBALL_PLAYER_QID} .
      ?player wdt:P569 ?dob .
      FILTER(?dob >= "${activePlayerBirthDateCutoff}T00:00:00Z"^^xsd:dateTime)
      FILTER NOT EXISTS { ?player wdt:P106 wd:${ASSOCIATION_FOOTBALL_MANAGER_QID} . }
      FILTER NOT EXISTS { ?player wdt:P106 wd:${SPORTS_COACH_QID} . }
      OPTIONAL { ?player wdt:P735 ?givenNameEntity .
                 ?givenNameEntity rdfs:label ?firstName .
                 FILTER(LANG(?firstName) = "de" || LANG(?firstName) = "en") }
      OPTIONAL { ?player wdt:P734 ?familyNameEntity .
                 ?familyNameEntity rdfs:label ?lastName .
                 FILTER(LANG(?lastName) = "de" || LANG(?lastName) = "en") }
      OPTIONAL { ?player wdt:P27 ?nationality . }
      OPTIONAL { ?player wdt:P413 ?position . }
      OPTIONAL { ?player wdt:P1618 ?shirtNumber . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en" . }
    }
  `;

  let bindings;
  try {
    const result = await wikidata.sparqlQuery(query);
    bindings = (result.results && result.results.bindings) || [];
  } catch (error) {
    console.warn(`    Wikidata SPARQL query failed: ${error.message}`);
    return [];
  }

  if (bindings.length === 0) {
    console.log("    No current players found on Wikidata");
    return [];
  }

  const playerMap = new Map();
  for (const binding of bindings) {
    const qid = binding.player && binding.player.value;
    if (qid && !playerMap.has(qid)) {
      playerMap.set(qid, binding);
    }
  }

  const players = [];
  let idCounter = 1;

  for (const [qid, binding] of playerMap) {
    const name = (binding.playerLabel && binding.playerLabel.value) || "Unbekannt";
    const nationality =
      (binding.nationalityLabel && binding.nationalityLabel.value) || null;

    let positionOriginal = null;
    if (binding.position && binding.position.value) {
      const positionQID = binding.position.value.split("/").pop();
      positionOriginal = WIKIDATA_POSITION_MAP[positionQID] || null;
    }
    if (!positionOriginal && binding.positionLabel && binding.positionLabel.value) {
      const label = binding.positionLabel.value.toLowerCase();
      if (label.includes("goalkeeper") || label.includes("torwart")) {
        positionOriginal = "Goalkeeper";
      } else if (
        label.includes("defender") ||
        label.includes("back") ||
        label.includes("verteidiger")
      ) {
        positionOriginal = "Centre-Back";
      } else if (label.includes("midfield") || label.includes("mittelfeld")) {
        positionOriginal = "Central Midfield";
      } else if (
        label.includes("forward") ||
        label.includes("striker") ||
        label.includes("stürmer")
      ) {
        positionOriginal = "Centre-Forward";
      }
    }

    const position = mapPosition(positionOriginal);
    const shirtNumber = binding.shirtNumber
      ? parseShirtNumber(binding.shirtNumber.value)
      : null;

    players.push({
      id: `wd-${qid.split("/").pop()}-${idCounter++}`,
      name,
      firstName: (binding.firstName && binding.firstName.value) || null,
      lastName: (binding.lastName && binding.lastName.value) || null,
      dateOfBirth: binding.dob ? binding.dob.value.slice(0, 10) : null,
      nationality: translateNationality(nationality),
      position: position.label,
      positionOriginal,
      positionEmoji: position.emoji,
      positionSort: position.sort,
      shirtNumber,
      auto_update: true,
      visible: true,
    });
  }

  players.sort((a, b) => a.positionSort - b.positionSort);

  console.log(`    ✓ Found ${players.length} current players on Wikidata`);
  return players;
}

function loadSyncCompetitions() {
  const docs = listCompetitionDocs();
  if (docs.length === 0) {
    return DEFAULT_COMPETITIONS;
  }

  return docs
    .map((doc) => normalizeCompetition(doc.data))
    .filter((competition) => competition.auto_update);
}

/**
 * Merge generated API data into a markdown document.
 * - New documents start with defaults plus generated values.
 * - Curated documents with auto_update: false keep their existing metadata.
 * - Auto-updated documents refresh generated fields while preserving control flags.
 */
function mergeGeneratedData(existingDoc, generatedData, defaults = {}) {
  // New documents start from defaults and get the latest generated metadata.
  if (!existingDoc) {
    return {
      ...defaults,
      ...generatedData,
    };
  }

  // Curated documents keep their current metadata even when the API changes.
  if (existingDoc.data.auto_update === false) {
    return {
      ...generatedData,
      ...existingDoc.data,
      auto_update: false,
      visible: existingDoc.data.visible !== undefined ? existingDoc.data.visible : true,
    };
  }

  const persistedFlags = {
    auto_update:
      existingDoc.data.auto_update !== undefined ? existingDoc.data.auto_update : true,
    visible: existingDoc.data.visible !== undefined ? existingDoc.data.visible : true,
    sortOrder: existingDoc.data.sortOrder ?? generatedData.sortOrder,
  };

  // Auto-updated documents refresh generated fields but keep user control flags.
  return {
    ...existingDoc.data,
    ...defaults,
    ...generatedData,
    ...persistedFlags,
  };
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
      players = await fetchPlayersFromWikidata(team.name);
    }

    players.sort((a, b) => a.positionSort - b.positionSort);

    const teamFilePath = getTeamFilePath(competition.code, team.id);
    const existingTeamDoc = readMarkdownFile(teamFilePath);
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

    const existingPlayerDocs = listPlayerDocs(competition.code, team.id);
    const seenPlayerIds = new Set();

    for (const player of players) {
      seenPlayerIds.add(String(player.id));
      const playerFilePath = getPlayerFilePath(competition.code, team.id, player.id);
      const existingPlayerDoc = readMarkdownFile(playerFilePath);
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
