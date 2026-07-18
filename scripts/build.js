/**
 * build.js - Fetch football data from football-data.org API
 *
 * This script fetches competition, team, and player data and saves it
 * as JSON files for the static site generator to consume.
 *
 * Requires FOOTBALL_DATA_API_KEY environment variable.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const API_BASE = "https://api.football-data.org/v4";
const DATA_DIR = path.join(__dirname, "..", "data");

// Competitions to fetch (WM, Premier League, Bundesliga)
const COMPETITIONS = [
  { code: "WC", name: "FIFA Weltmeisterschaft", country: "Welt", flag: "🌍" },
  { code: "PL", name: "Premier League", country: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { code: "BL1", name: "Bundesliga", country: "Deutschland", flag: "🇩🇪" },
];

if (!API_KEY) {
  console.error(
    "Error: FOOTBALL_DATA_API_KEY environment variable is required."
  );
  console.error("Get a free API key at https://www.football-data.org/client/register");
  process.exit(1);
}

/**
 * Make an API request to football-data.org
 */
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
            } catch (e) {
              reject(new Error(`JSON parse error for ${url}: ${e.message}`));
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

/**
 * Wait ms milliseconds (for rate limiting)
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate age from date of birth string
 */
function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/**
 * Map position to a German-friendly label and emoji
 */
function mapPosition(position) {
  const posMap = {
    Goalkeeper: { label: "Torwart", emoji: "🧤", sort: 1 },
    "Left Back": { label: "Linker Verteidiger", emoji: "🛡️", sort: 2 },
    "Right Back": { label: "Rechter Verteidiger", emoji: "🛡️", sort: 2 },
    "Centre-Back": { label: "Innenverteidiger", emoji: "🛡️", sort: 2 },
    "Defensive Midfield": {
      label: "Defensives Mittelfeld",
      emoji: "⚙️",
      sort: 3,
    },
    "Central Midfield": { label: "Zentrales Mittelfeld", emoji: "⚙️", sort: 3 },
    "Attacking Midfield": {
      label: "Offensives Mittelfeld",
      emoji: "🎯",
      sort: 4,
    },
    "Left Midfield": { label: "Linkes Mittelfeld", emoji: "⚙️", sort: 3 },
    "Right Midfield": { label: "Rechtes Mittelfeld", emoji: "⚙️", sort: 3 },
    "Left Winger": { label: "Linksaussen", emoji: "💨", sort: 5 },
    "Right Winger": { label: "Rechtsaussen", emoji: "💨", sort: 5 },
    "Centre-Forward": { label: "Mittelstürmer", emoji: "⚽", sort: 6 },
  };
  return posMap[position] || { label: position || "Unbekannt", emoji: "⚽", sort: 7 };
}

/**
 * Fetch all data for one competition
 */
async function fetchCompetition(comp) {
  console.log(`\nFetching competition: ${comp.name} (${comp.code})`);

  let compData;
  try {
    compData = await apiRequest(`/competitions/${comp.code}/teams`);
  } catch (e) {
    console.warn(`  Skipping ${comp.name}: ${e.message}`);
    return null;
  }

  const teams = [];

  for (const team of compData.teams || []) {
    console.log(`  Processing team: ${team.name}`);

    // Rate limiting: wait 6.5 seconds between requests (free tier: 10/min)
    await sleep(6500);

    let teamData;
    try {
      teamData = await apiRequest(`/teams/${team.id}`);
    } catch (e) {
      console.warn(`  Skipping team ${team.name}: ${e.message}`);
      continue;
    }

    const players = (teamData.squad || []).map((player) => {
      const pos = mapPosition(player.position);
      return {
        id: player.id,
        name: player.name,
        firstName: player.firstName,
        lastName: player.lastName,
        dateOfBirth: player.dateOfBirth,
        age: calculateAge(player.dateOfBirth),
        nationality: player.nationality,
        position: pos.label,
        positionOriginal: player.position,
        positionEmoji: pos.emoji,
        positionSort: pos.sort,
        shirtNumber: player.shirtNumber,
      };
    });

    // Sort players by position (GK, DEF, MID, FWD)
    players.sort((a, b) => a.positionSort - b.positionSort);

    teams.push({
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
      players: players,
      playerCount: players.length,
    });
  }

  return {
    code: comp.code,
    name: comp.name,
    country: comp.country,
    flag: comp.flag,
    emblem: compData.competition ? compData.competition.emblem : null,
    season: compData.season
      ? {
          startDate: compData.season.startDate,
          endDate: compData.season.endDate,
        }
      : null,
    teams: teams,
    teamCount: teams.length,
  };
}

/**
 * Main build function
 */
async function main() {
  console.log("🏟️  Bildli - Fetching football data...\n");

  // Ensure data directory exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const allCompetitions = [];

  for (const comp of COMPETITIONS) {
    const data = await fetchCompetition(comp);
    if (data) {
      // Save individual competition file
      const filePath = path.join(DATA_DIR, `${comp.code}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`  Saved: ${filePath}`);

      allCompetitions.push({
        code: data.code,
        name: data.name,
        country: data.country,
        flag: data.flag,
        emblem: data.emblem,
        teamCount: data.teamCount,
      });
    }

    // Wait between competitions to respect rate limits
    await sleep(7000);
  }

  // Save index of all competitions
  const indexPath = path.join(DATA_DIR, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(allCompetitions, null, 2));
  console.log(`\n✅ Saved competition index: ${indexPath}`);
  console.log(`📊 Total competitions fetched: ${allCompetitions.length}`);
}

main().catch((err) => {
  console.error("❌ Build failed:", err.message);
  process.exit(1);
});
