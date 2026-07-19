/**
 * enrich.js - Enrich football player data with Wikidata/Wikimedia Commons
 *
 * For each player fetched from football-data.org, this script queries Wikidata
 * via SPARQL to find additional information:
 * - Player photo (from Wikimedia Commons via Wikidata P18)
 * - Height (P2048)
 * - Preferred foot (P552)
 * - Place of birth (P19)
 * - Shirt number (P1618)
 *
 * Matching strategy:
 * 1. Find the team's Wikidata entity (QID)
 * 2. Query all squad members of that team with enrichment properties
 * 3. Match to football-data.org players by date of birth
 * 4. Fall back to individual name+DOB search for unmatched players
 */

const fs = require("fs");
const path = require("path");
const {
  httpGet,
  sparqlQuery,
  sleep,
  findTeamQID,
  getGermanLabel,
  sanitizeSparqlString,
} = require("./wikidata");

const DATA_DIR = path.join(__dirname, "..", "data");

/**
 * Query all squad members of a team from Wikidata with enrichment data
 */
async function queryTeamSquad(teamQID) {
  // Validate QID format to prevent SPARQL injection
  if (!/^Q\d+$/.test(teamQID)) {
    console.warn(`  Invalid Wikidata QID format: ${teamQID}`);
    return [];
  }

  const query = `
    SELECT ?player ?playerLabel ?dob ?image ?height ?footLabel ?birthPlaceLabel ?shirtNumber WHERE {
      ?player wdt:P54 wd:${teamQID} .
      ?player wdt:P106 wd:Q937857 .
      ?player wdt:P569 ?dob .
      OPTIONAL { ?player wdt:P18 ?image . }
      OPTIONAL { ?player wdt:P2048 ?height . }
      OPTIONAL { ?player wdt:P552 ?foot . }
      OPTIONAL { ?player wdt:P19 ?birthPlace . }
      OPTIONAL { ?player wdt:P1618 ?shirtNumber . }
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
    SELECT ?player ?playerLabel ?image ?height ?footLabel ?birthPlaceLabel ?shirtNumber WHERE {
      ?player wdt:P106 wd:Q937857 .
      ?player wdt:P569 "${safeDate}T00:00:00Z"^^xsd:dateTime .
      ?player rdfs:label ?label .
      FILTER(LANG(?label) = "en" && CONTAINS(LCASE(?label), "${safeName}"))
      OPTIONAL { ?player wdt:P18 ?image . }
      OPTIONAL { ?player wdt:P2048 ?height . }
      OPTIONAL { ?player wdt:P552 ?foot . }
      OPTIONAL { ?player wdt:P19 ?birthPlace . }
      OPTIONAL { ?player wdt:P1618 ?shirtNumber . }
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

  if (binding.shirtNumber && binding.shirtNumber.value) {
    const num = parseInt(binding.shirtNumber.value, 10);
    if (!isNaN(num)) {
      enrichment.shirtNumber = num;
    }
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

    // Translate team name to German via Wikidata
    const germanName = await getGermanLabel(teamQID);
    await sleep(2000);
    if (germanName) {
      console.log(`    🌐 German name: ${germanName}`);
      team.name = germanName;
      team.shortName = germanName;
    }

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
          if (
            (player.shirtNumber === null || player.shirtNumber === undefined) &&
            enrichment.shirtNumber !== undefined
          ) {
            player.shirtNumber = enrichment.shirtNumber;
          }
          delete enrichment.shirtNumber;
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
        if (
          (player.shirtNumber === null || player.shirtNumber === undefined) &&
          enrichment.shirtNumber !== undefined
        ) {
          player.shirtNumber = enrichment.shirtNumber;
        }
        delete enrichment.shirtNumber;
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
