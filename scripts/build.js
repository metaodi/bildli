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
const wikidata = require("./wikidata");

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const API_BASE = "https://api.football-data.org/v4";
const DATA_DIR = path.join(__dirname, "..", "data");

// Rate limiting: free tier allows 10 requests/minute (= 6000ms interval).
// Adding safety buffer to avoid hitting the limit.
const DELAY_BETWEEN_TEAM_REQUESTS_MS = 6500;
const DELAY_BETWEEN_COMPETITIONS_MS = 7000;
const ACTIVE_PLAYER_MAX_AGE = 45;
const ASSOCIATION_FOOTBALL_PLAYER_QID = "Q937857";
const ASSOCIATION_FOOTBALL_MANAGER_QID = "Q628099";
const SPORTS_COACH_QID = "Q2732438";

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
 * Format the latest acceptable birth date for active players.
 */
function getActivePlayerBirthDateCutoff(maxAge) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - maxAge);
  return cutoff.toISOString().slice(0, 10);
}

/**
 * Map position to a German-friendly label and emoji
 */
function mapPosition(position) {
  const posMap = {
    Goalkeeper: { label: "Torwart", emoji: "🧤", sort: 1 },
    Defence: { label: "Abwehr", emoji: "🛡️", sort: 2 },
    "Left Back": { label: "Linker Verteidiger", emoji: "🛡️", sort: 2 },
    "Right Back": { label: "Rechter Verteidiger", emoji: "🛡️", sort: 2 },
    "Centre-Back": { label: "Innenverteidiger", emoji: "🛡️", sort: 2 },
    Midfield: { label: "Mittelfeld", emoji: "⚙️", sort: 3 },
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
    Offence: { label: "Angriff", emoji: "⚽", sort: 6 },
    Forward: { label: "Stürmer", emoji: "⚽", sort: 6 },
    "Centre-Forward": { label: "Mittelstürmer", emoji: "⚽", sort: 6 },
    Coach: { label: "Trainer", emoji: "📋", sort: 8 },
  };
  return posMap[position] || { label: position || "Unbekannt", emoji: "⚽", sort: 7 };
}

/**
 * Translate nationality from English to German
 */
function translateNationality(nationality) {
  if (!nationality) return nationality;
  const natMap = {
    Albania: "Albanien",
    Algeria: "Algerien",
    Angola: "Angola",
    Argentina: "Argentinien",
    Armenia: "Armenien",
    Australia: "Australien",
    Austria: "Österreich",
    Belgium: "Belgien",
    "Bosnia and Herzegovina": "Bosnien und Herzegowina",
    "Bosnia-Herzegovina": "Bosnien und Herzegowina",
    Brazil: "Brasilien",
    Bulgaria: "Bulgarien",
    "Burkina Faso": "Burkina Faso",
    Cameroon: "Kamerun",
    Canada: "Kanada",
    "Cape Verde Islands": "Kap Verde",
    "Cape Verde": "Kap Verde",
    Chile: "Chile",
    Colombia: "Kolumbien",
    "Congo DR": "Demokratische Republik Kongo",
    "DR Congo": "Demokratische Republik Kongo",
    Croatia: "Kroatien",
    "Czech Republic": "Tschechien",
    Czechia: "Tschechien",
    Denmark: "Dänemark",
    Ecuador: "Ecuador",
    Egypt: "Ägypten",
    England: "England",
    Finland: "Finnland",
    France: "Frankreich",
    Gambia: "Gambia",
    Georgia: "Georgien",
    Germany: "Deutschland",
    Ghana: "Ghana",
    Greece: "Griechenland",
    Guinea: "Guinea",
    "Guinea-Bissau": "Guinea-Bissau",
    Haiti: "Haiti",
    Hungary: "Ungarn",
    Iceland: "Island",
    Indonesia: "Indonesien",
    Iran: "Iran",
    Iraq: "Irak",
    Ireland: "Irland",
    Israel: "Israel",
    Italy: "Italien",
    "Ivory Coast": "Elfenbeinküste",
    Jamaica: "Jamaika",
    Japan: "Japan",
    Jordan: "Jordanien",
    Latvia: "Lettland",
    Lithuania: "Litauen",
    Luxembourg: "Luxemburg",
    Mali: "Mali",
    Mexico: "Mexiko",
    Morocco: "Marokko",
    Mozambique: "Mosambik",
    Netherlands: "Niederlande",
    "New Zealand": "Neuseeland",
    "North Macedonia": "Nordmazedonien",
    "Northern Ireland": "Nordirland",
    Nigeria: "Nigeria",
    Norway: "Norwegen",
    Panama: "Panama",
    Paraguay: "Paraguay",
    Peru: "Peru",
    Poland: "Polen",
    Portugal: "Portugal",
    Qatar: "Katar",
    Romania: "Rumänien",
    Russia: "Russland",
    "Saudi Arabia": "Saudi-Arabien",
    Scotland: "Schottland",
    Senegal: "Senegal",
    Serbia: "Serbien",
    Seychelles: "Seychellen",
    "Sierra Leone": "Sierra Leone",
    Slovakia: "Slowakei",
    Slovenia: "Slowenien",
    "South Africa": "Südafrika",
    "South Korea": "Südkorea",
    Spain: "Spanien",
    Suriname: "Suriname",
    Sweden: "Schweden",
    Switzerland: "Schweiz",
    Tanzania: "Tansania",
    Thailand: "Thailand",
    Togo: "Togo",
    "Trinidad & Tobago": "Trinidad und Tobago",
    "Trinidad and Tobago": "Trinidad und Tobago",
    Tunisia: "Tunesien",
    Turkey: "Türkei",
    Ukraine: "Ukraine",
    "United Kingdom": "Vereinigtes Königreich",
    "United States": "Vereinigte Staaten",
    Uruguay: "Uruguay",
    Uzbekistan: "Usbekistan",
    Venezuela: "Venezuela",
    Wales: "Wales",
  };
  return natMap[nationality] || nationality;
}

/**
 * Wikidata position QIDs mapped to the same format as mapPosition()
 */
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

/**
 * Fetch current players for a team from Wikidata via SPARQL.
 * Only returns players whose "member of sports team" (P54) statement
 * has no end date (pq:P582) or an end date in the future, and filters
 * out implausibly old or now-coaching former players when Wikidata lacks
 * a proper end date.
 */
async function fetchPlayersFromWikidata(teamName) {
  console.log(`    ⚡ No players from API, trying Wikidata fallback...`);

  const teamQID = await wikidata.findTeamQID(teamName);
  if (!teamQID) {
    console.warn(`    Could not find team "${teamName}" on Wikidata`);
    return [];
  }

  // Validate QID format to prevent SPARQL injection
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
  } catch (e) {
    console.warn(`    Wikidata SPARQL query failed: ${e.message}`);
    return [];
  }

  if (bindings.length === 0) {
    console.log(`    No current players found on Wikidata`);
    return [];
  }

  // Deduplicate by player QID (multiple bindings for same player due to OPTIONAL)
  const playerMap = new Map();
  for (const b of bindings) {
    const qid = b.player && b.player.value;
    if (!qid) continue;
    // Keep the first (most complete) binding per player
    if (!playerMap.has(qid)) {
      playerMap.set(qid, b);
    }
  }

  const players = [];
  let idCounter = 1;

  for (const [qid, b] of playerMap) {
    const name = (b.playerLabel && b.playerLabel.value) || "Unbekannt";
    const dob = b.dob ? b.dob.value.slice(0, 10) : null;
    const nationality = (b.nationalityLabel && b.nationalityLabel.value) || null;

    // Map Wikidata position QID to football-data.org position string
    let posOriginal = null;
    if (b.position && b.position.value) {
      const posQID = b.position.value.split("/").pop();
      posOriginal = WIKIDATA_POSITION_MAP[posQID] || null;
    }
    if (!posOriginal && b.positionLabel && b.positionLabel.value) {
      // Try to use the label as a rough fallback
      const label = b.positionLabel.value.toLowerCase();
      if (label.includes("goalkeeper") || label.includes("torwart")) {
        posOriginal = "Goalkeeper";
      } else if (label.includes("defender") || label.includes("back") || label.includes("verteidiger")) {
        posOriginal = "Centre-Back";
      } else if (label.includes("midfield") || label.includes("mittelfeld")) {
        posOriginal = "Central Midfield";
      } else if (label.includes("forward") || label.includes("striker") || label.includes("stürmer")) {
        posOriginal = "Centre-Forward";
      }
    }

    const pos = mapPosition(posOriginal);

    const firstName = (b.firstName && b.firstName.value) || null;
    const lastName = (b.lastName && b.lastName.value) || null;
    const shirtNumber = b.shirtNumber ? parseInt(b.shirtNumber.value, 10) : null;

    players.push({
      id: `wd-${qid.split("/").pop()}-${idCounter++}`,
      name: name,
      firstName: firstName,
      lastName: lastName,
      dateOfBirth: dob,
      age: calculateAge(dob),
      nationality: translateNationality(nationality),
      position: pos.label,
      positionOriginal: posOriginal,
      positionEmoji: pos.emoji,
      positionSort: pos.sort,
      shirtNumber: isNaN(shirtNumber) ? null : shirtNumber,
    });
  }

  // Sort players by position
  players.sort((a, b) => a.positionSort - b.positionSort);

  console.log(`    ✓ Found ${players.length} current players on Wikidata`);
  return players;
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

    // Rate limiting: wait between requests (free tier: 10 req/min)
    await sleep(DELAY_BETWEEN_TEAM_REQUESTS_MS);

    let teamData;
    try {
      teamData = await apiRequest(`/teams/${team.id}`);
    } catch (e) {
      console.warn(`  Skipping team ${team.name}: ${e.message}`);
      continue;
    }

    let players = (teamData.squad || []).map((player) => {
      const pos = mapPosition(player.position);
      return {
        id: player.id,
        name: player.name,
        firstName: player.firstName,
        lastName: player.lastName,
        dateOfBirth: player.dateOfBirth,
        age: calculateAge(player.dateOfBirth),
        nationality: translateNationality(player.nationality),
        position: pos.label,
        positionOriginal: player.position,
        positionEmoji: pos.emoji,
        positionSort: pos.sort,
        shirtNumber: player.shirtNumber,
      };
    });

    // Fallback: if the API returned no players, try Wikidata
    if (players.length === 0) {
      players = await fetchPlayersFromWikidata(team.name);
    }

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
    await sleep(DELAY_BETWEEN_COMPETITIONS_MS);
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
