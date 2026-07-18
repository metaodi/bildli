/**
 * enrich.js - Enrich football player data with Wikidata/Wikimedia Commons
 *
 * For each player fetched from football-data.org, this script queries Wikidata
 * via SPARQL to find additional information:
 * - Player photo (from Wikimedia Commons via Wikidata P18)
 * - Height (P2048)
 * - Preferred foot (P552)
 * - Place of birth (P19)
 *
 * Matching strategy:
 * 1. Find the team's Wikidata entity (QID)
 * 2. Query all squad members of that team with enrichment properties
 * 3. Match to football-data.org players by date of birth
 * 4. Fall back to individual name+DOB search for unmatched players
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "Bildli/1.0 (https://github.com/metaodi/bildli)";

/**
 * Make an HTTPS GET request and return the response body
 */
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/sparql-results+json",
        ...headers,
      },
    };

    https
      .get(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(
                new Error(`JSON parse error: ${e.message}\nBody: ${data.slice(0, 500)}`)
              );
            }
          } else if (res.statusCode === 429) {
            reject(new Error(`Rate limited (429). Please wait and retry.`));
          } else {
            reject(
              new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`)
            );
          }
        });
      })
      .on("error", reject);
  });
}

/**
 * Execute a SPARQL query against Wikidata
 */
async function sparqlQuery(query) {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  return httpGet(url);
}

/**
 * Wait ms milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find a team's Wikidata QID by searching for it
 */
async function findTeamQID(teamName) {
  // Use Wikidata search API to find the team
  const searchUrl =
    `https://www.wikidata.org/w/api.php?action=wbsearchentities` +
    `&search=${encodeURIComponent(teamName)}` +
    `&language=en&type=item&format=json&limit=5`;

  try {
    const result = await httpGet(searchUrl, {
      Accept: "application/json",
    });

    if (result.search && result.search.length > 0) {
      // Return the first match — usually the most relevant
      return result.search[0].id;
    }
  } catch (e) {
    console.warn(`  Could not search for team "${teamName}": ${e.message}`);
  }
  return null;
}

/**
 * Query all squad members of a team from Wikidata with enrichment data
 */
async function queryTeamSquad(teamQID) {
  const query = `
    SELECT ?player ?playerLabel ?dob ?image ?height ?footLabel ?birthPlaceLabel WHERE {
      ?player wdt:P54 wd:${teamQID} .
      ?player wdt:P106 wd:Q937857 .
      ?player wdt:P569 ?dob .
      OPTIONAL { ?player wdt:P18 ?image . }
      OPTIONAL { ?player wdt:P2048 ?height . }
      OPTIONAL { ?player wdt:P552 ?foot . }
      OPTIONAL { ?player wdt:P19 ?birthPlace . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en" . }
    }
  `;

  try {
    const result = await sparqlQuery(query);
    return (result.results && result.results.bindings) || [];
  } catch (e) {
    console.warn(`  SPARQL query failed for team ${teamQID}: ${e.message}`);
    return [];
  }
}

/**
 * Sanitize a string for safe inclusion in a SPARQL query.
 * Escapes characters that could break out of a SPARQL string literal.
 */
function sanitizeSparqlString(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/**
 * Query Wikidata for a single player by name and date of birth
 */
async function queryPlayerByNameAndDOB(playerName, dateOfBirth) {
  if (!dateOfBirth) return null;

  // Try matching by last name part + exact DOB
  const nameParts = playerName.split(" ");
  const lastName = nameParts[nameParts.length - 1];
  const safeName = sanitizeSparqlString(lastName.toLowerCase());

  // Validate dateOfBirth is a valid date string (YYYY-MM-DD only)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const safeDate = sanitizeSparqlString(dateOfBirth);

  const query = `
    SELECT ?player ?playerLabel ?image ?height ?footLabel ?birthPlaceLabel WHERE {
      ?player wdt:P106 wd:Q937857 .
      ?player wdt:P569 "${safeDate}T00:00:00Z"^^xsd:dateTime .
      ?player rdfs:label ?label .
      FILTER(LANG(?label) = "en" && CONTAINS(LCASE(?label), "${safeName}"))
      OPTIONAL { ?player wdt:P18 ?image . }
      OPTIONAL { ?player wdt:P2048 ?height . }
      OPTIONAL { ?player wdt:P552 ?foot . }
      OPTIONAL { ?player wdt:P19 ?birthPlace . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en" . }
    }
    LIMIT 1
  `;

  try {
    const result = await sparqlQuery(query);
    const bindings = (result.results && result.results.bindings) || [];
    return bindings.length > 0 ? bindings[0] : null;
  } catch (e) {
    console.warn(
      `  Individual query failed for "${playerName}": ${e.message}`
    );
    return null;
  }
}

/**
 * Extract enrichment data from a Wikidata SPARQL result binding
 */
function extractEnrichment(binding) {
  const enrichment = {};

  if (binding.image && binding.image.value) {
    enrichment.image = binding.image.value;
  }

  if (binding.height && binding.height.value) {
    const h = parseFloat(binding.height.value);
    // Wikidata stores height in metres (e.g. 1.85), but some entries
    // may already be in centimetres. Values below 3 are treated as metres.
    const HEIGHT_METRE_THRESHOLD = 3;
    enrichment.heightCm =
      h < HEIGHT_METRE_THRESHOLD ? Math.round(h * 100) : Math.round(h);
  }

  if (binding.footLabel && binding.footLabel.value) {
    const foot = binding.footLabel.value.toLowerCase();
    if (foot.includes("right") || foot.includes("recht")) {
      enrichment.preferredFoot = "Rechts";
    } else if (foot.includes("left") || foot.includes("link")) {
      enrichment.preferredFoot = "Links";
    } else if (foot.includes("both") || foot.includes("beid")) {
      enrichment.preferredFoot = "Beidfüssig";
    } else {
      enrichment.preferredFoot = binding.footLabel.value;
    }
  }

  if (binding.birthPlaceLabel && binding.birthPlaceLabel.value) {
    enrichment.birthPlace = binding.birthPlaceLabel.value;
  }

  return enrichment;
}

/**
 * Format a date string to YYYY-MM-DD for comparison
 */
function formatDate(dateStr) {
  if (!dateStr) return null;
  return dateStr.slice(0, 10);
}

/**
 * Enrich players of a single team
 */
async function enrichTeam(team) {
  console.log(`\n  Enriching team: ${team.name}`);

  let enrichedCount = 0;
  const playerMap = new Map();

  // Build a map of players by DOB for matching
  for (const player of team.players) {
    const dob = formatDate(player.dateOfBirth);
    if (dob) {
      if (!playerMap.has(dob)) {
        playerMap.set(dob, []);
      }
      playerMap.get(dob).push(player);
    }
  }

  // Phase 1: Try team-based batch query
  const teamQID = await findTeamQID(team.name);
  await sleep(1500);

  if (teamQID) {
    console.log(`    Found Wikidata entity: ${teamQID}`);
    const squadData = await queryTeamSquad(teamQID);
    await sleep(2000);

    console.log(`    Got ${squadData.length} Wikidata squad entries`);

    for (const binding of squadData) {
      const wikidataDOB = formatDate(
        binding.dob ? binding.dob.value : null
      );
      if (!wikidataDOB) continue;

      const matchedPlayers = playerMap.get(wikidataDOB) || [];

      for (const player of matchedPlayers) {
        if (player._enriched) continue;

        // Additional name check: verify the Wikidata name somewhat matches
        const wdName = (binding.playerLabel && binding.playerLabel.value) || "";
        const playerLastName =
          player.lastName || player.name.split(" ").pop();

        if (
          wdName.toLowerCase().includes(playerLastName.toLowerCase()) ||
          playerLastName.toLowerCase().includes(wdName.split(" ").pop().toLowerCase())
        ) {
          const enrichment = extractEnrichment(binding);
          Object.assign(player, enrichment);
          player._enriched = true;
          enrichedCount++;
          console.log(`    ✓ Matched: ${player.name}`);
          break;
        }
      }
    }
  } else {
    console.log(`    Could not find team on Wikidata`);
  }

  // Phase 2: Individual queries for unmatched players
  const unmatched = team.players.filter((p) => !p._enriched);
  if (unmatched.length > 0) {
    console.log(
      `    ${unmatched.length} players unmatched, trying individual queries...`
    );
  }

  for (const player of unmatched) {
    if (!player.dateOfBirth) continue;

    await sleep(2000); // Rate limiting for Wikidata

    const binding = await queryPlayerByNameAndDOB(
      player.name,
      formatDate(player.dateOfBirth)
    );

    if (binding) {
      const enrichment = extractEnrichment(binding);
      if (Object.keys(enrichment).length > 0) {
        Object.assign(player, enrichment);
        player._enriched = true;
        enrichedCount++;
        console.log(`    ✓ Individual match: ${player.name}`);
      }
    }
  }

  // Clean up internal flags
  for (const player of team.players) {
    delete player._enriched;
  }

  console.log(
    `    Enriched ${enrichedCount}/${team.players.length} players`
  );
}

/**
 * Main enrichment function
 */
async function main() {
  console.log("🔍 Bildli - Enriching player data with Wikidata...\n");

  const indexPath = path.join(DATA_DIR, "index.json");
  if (!fs.existsSync(indexPath)) {
    console.error("❌ No data found. Run 'npm run fetch' first.");
    process.exit(1);
  }

  const competitions = JSON.parse(fs.readFileSync(indexPath, "utf-8"));

  for (const comp of competitions) {
    const compPath = path.join(DATA_DIR, `${comp.code}.json`);
    if (!fs.existsSync(compPath)) continue;

    console.log(`\n📋 Processing: ${comp.name}`);
    const compData = JSON.parse(fs.readFileSync(compPath, "utf-8"));

    for (const team of compData.teams) {
      await enrichTeam(team);
      await sleep(3000); // Pause between teams
    }

    // Save enriched data back
    fs.writeFileSync(compPath, JSON.stringify(compData, null, 2));
    console.log(`\n  💾 Saved enriched data: ${compPath}`);
  }

  console.log("\n✅ Wikidata enrichment complete!");
}

main().catch((err) => {
  console.error("❌ Enrichment failed:", err.message);
  process.exit(1);
});
