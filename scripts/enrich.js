/**
 * enrich.js - Enrich markdown player content with Wikidata/Wikimedia Commons
 */

const {
  sparqlQuery,
  sleep,
  findTeamQID,
  getGermanLabel,
  getTeamCrest,
  sanitizeSparqlString,
} = require("./wikidata");
const {
  listCompetitionDocs,
  listPlayerDocs,
  listTeamDocs,
  normalizeCompetition,
  normalizePlayer,
  normalizeTeam,
  parseShirtNumber,
  writeMarkdownFile,
} = require("./content");

async function queryTeamSquad(teamQID) {
  if (!/^Q\d+$/.test(teamQID)) {
    console.warn(`  Invalid Wikidata QID format: ${teamQID}`);
    return [];
  }

  const query = `
    SELECT ?player ?playerLabel ?dob ?image ?height ?weight ?footLabel ?birthPlaceLabel ?shirtNumber ?nationalTeamLabel ?nickname WHERE {
      ?player wdt:P54 wd:${teamQID} .
      ?player wdt:P106 wd:Q937857 .
      ?player wdt:P569 ?dob .
      OPTIONAL { ?player wdt:P18 ?image . }
      OPTIONAL { ?player wdt:P2048 ?height . }
      OPTIONAL { ?player wdt:P2067 ?weight . }
      OPTIONAL { ?player wdt:P552 ?foot . }
      OPTIONAL { ?player wdt:P19 ?birthPlace . }
      OPTIONAL { ?player wdt:P1618 ?shirtNumber . }
      OPTIONAL { ?player wdt:P1532 ?nationalTeam . }
      OPTIONAL { ?player wdt:P1449 ?nickname . FILTER(LANG(?nickname) = "de") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en" . }
    }
  `;

  try {
    const result = await sparqlQuery(query);
    return (result.results && result.results.bindings) || [];
  } catch (error) {
    console.warn(`  SPARQL query failed for team ${teamQID}: ${error.message}`);
    return [];
  }
}

async function queryPlayerByNameAndDOB(playerName, dateOfBirth) {
  if (!dateOfBirth) return null;

  const nameParts = playerName.split(" ");
  const lastName = nameParts[nameParts.length - 1];
  const safeName = sanitizeSparqlString(lastName.toLowerCase());

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const safeDate = sanitizeSparqlString(dateOfBirth);

  const query = `
    SELECT ?player ?playerLabel ?image ?height ?weight ?footLabel ?birthPlaceLabel ?shirtNumber ?nationalTeamLabel ?nickname WHERE {
      ?player wdt:P106 wd:Q937857 .
      ?player wdt:P569 "${safeDate}T00:00:00Z"^^xsd:dateTime .
      ?player rdfs:label ?label .
      FILTER(LANG(?label) = "en" && CONTAINS(LCASE(?label), "${safeName}"))
      OPTIONAL { ?player wdt:P18 ?image . }
      OPTIONAL { ?player wdt:P2048 ?height . }
      OPTIONAL { ?player wdt:P2067 ?weight . }
      OPTIONAL { ?player wdt:P552 ?foot . }
      OPTIONAL { ?player wdt:P19 ?birthPlace . }
      OPTIONAL { ?player wdt:P1618 ?shirtNumber . }
      OPTIONAL { ?player wdt:P1532 ?nationalTeam . }
      OPTIONAL { ?player wdt:P1449 ?nickname . FILTER(LANG(?nickname) = "de") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en" . }
    }
    LIMIT 1
  `;

  try {
    const result = await sparqlQuery(query);
    const bindings = (result.results && result.results.bindings) || [];
    return bindings.length > 0 ? bindings[0] : null;
  } catch (error) {
    console.warn(`  Individual query failed for "${playerName}": ${error.message}`);
    return null;
  }
}

function extractEnrichment(binding) {
  const enrichment = {};

  if (binding.image && binding.image.value) {
    enrichment.image = binding.image.value;
  }

  if (binding.height && binding.height.value) {
    const height = parseFloat(binding.height.value);
    enrichment.heightCm = convertHeightToCentimeters(height);
  }

  if (binding.weight && binding.weight.value) {
    const weight = parseFloat(binding.weight.value);
    if (!Number.isNaN(weight)) {
      enrichment.weightKg = Math.round(weight);
    }
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

  if (binding.nationalTeamLabel && binding.nationalTeamLabel.value) {
    enrichment.nationalTeam = binding.nationalTeamLabel.value;
  }

  if (binding.nickname && binding.nickname.value) {
    enrichment.nickname = binding.nickname.value;
  }

  if (binding.shirtNumber && binding.shirtNumber.value) {
    const number = parseShirtNumber(binding.shirtNumber.value);
    if (number !== null) {
      enrichment.shirtNumber = number;
    }
  }

  return enrichment;
}

function convertHeightToCentimeters(height) {
  const HEIGHT_METRE_THRESHOLD = 3;
  return height < HEIGHT_METRE_THRESHOLD ? Math.round(height * 100) : Math.round(height);
}

function applyEnrichmentToPlayer(playerData, enrichment) {
  const originalShirtNumber = playerData.shirtNumber;
  const shouldUseEnrichedShirtNumber =
    (playerData.shirtNumber === null || playerData.shirtNumber === undefined) &&
    enrichment.shirtNumber !== undefined;

  Object.assign(playerData, enrichment);

  if (!shouldUseEnrichedShirtNumber) {
    playerData.shirtNumber = originalShirtNumber;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  return dateStr.slice(0, 10);
}

async function enrichTeam(competitionCode, teamDoc) {
  const team = normalizeTeam(teamDoc.data);
  const playerDocs = listPlayerDocs(competitionCode, team.id);
  const autoUpdatePlayers = playerDocs
    .filter((playerDoc) => normalizePlayer(playerDoc.data).auto_update)
    .map((playerDoc) => ({
      playerDoc,
      player: normalizePlayer(playerDoc.data),
      matched: false,
    }));

  console.log(`\n  Enriching team: ${team.name}`);

  if (autoUpdatePlayers.length === 0) {
    console.log("    No auto-updated players to enrich");
    return;
  }

  let enrichedCount = 0;
  const playersByDob = new Map();
  for (const playerEntry of autoUpdatePlayers) {
    const dob = formatDate(playerEntry.player.dateOfBirth);
    if (!dob) continue;
    if (!playersByDob.has(dob)) {
      playersByDob.set(dob, []);
    }
    playersByDob.get(dob).push(playerEntry);
  }

  const teamQID = await findTeamQID(team.name);
  await sleep(1500);

  if (teamQID) {
    console.log(`    Found Wikidata entity: ${teamQID}`);

    if (team.auto_update) {
      const teamUpdates = { ...teamDoc.data };

      const germanName = await getGermanLabel(teamQID);
      await sleep(2000);
      if (germanName) {
        console.log(`    🌐 German name: ${germanName}`);
        teamUpdates.name = germanName;
        teamUpdates.shortName = germanName;
      }

      // Only fill the crest from Wikidata when the team has none yet, so we
      // never replace a clean football-data.org crest with a spottier one.
      if (!teamDoc.data.crest) {
        const crest = await getTeamCrest(teamQID);
        await sleep(2000);
        if (crest) {
          console.log(`    🛡️  Crest: ${crest}`);
          teamUpdates.crest = crest;
        }
      }

      writeMarkdownFile(teamDoc.filePath, teamUpdates, teamDoc.content);
    }

    const squadData = await queryTeamSquad(teamQID);
    await sleep(2000);

    console.log(`    Got ${squadData.length} Wikidata squad entries`);

    for (const binding of squadData) {
      const wikidataDOB = formatDate(binding.dob ? binding.dob.value : null);
      if (!wikidataDOB) continue;

      const matchedPlayers = playersByDob.get(wikidataDOB) || [];
      for (const matched of matchedPlayers) {
        const playerLastName =
          matched.player.lastName || matched.player.name.split(" ").pop();
        const wikidataName = (binding.playerLabel && binding.playerLabel.value) || "";

        if (
          wikidataName.toLowerCase().includes(playerLastName.toLowerCase()) ||
          playerLastName.toLowerCase().includes(
            wikidataName.split(" ").pop().toLowerCase()
          )
        ) {
          const nextData = { ...matched.playerDoc.data };
          applyEnrichmentToPlayer(nextData, extractEnrichment(binding));
          writeMarkdownFile(matched.playerDoc.filePath, nextData, matched.playerDoc.content);
          matched.matched = true;
          enrichedCount++;
          console.log(`    ✓ Matched: ${matched.player.name}`);
          break;
        }
      }
    }
  } else {
    console.log("    Could not find team on Wikidata");
  }

  const unmatchedPlayers = autoUpdatePlayers.filter(
    (playerEntry) => !playerEntry.matched && playerEntry.player.dateOfBirth
  );

  if (unmatchedPlayers.length > 0) {
    console.log(
      `    ${unmatchedPlayers.length} players unmatched, trying individual queries...`
    );
  }

  for (const playerEntry of unmatchedPlayers) {
    const { playerDoc, player } = playerEntry;
    await sleep(2000);

    const binding = await queryPlayerByNameAndDOB(
      player.name,
      formatDate(player.dateOfBirth)
    );

    if (binding) {
      const enrichment = extractEnrichment(binding);
      if (Object.keys(enrichment).length > 0) {
        const nextData = { ...playerDoc.data };
        applyEnrichmentToPlayer(nextData, enrichment);
        writeMarkdownFile(playerDoc.filePath, nextData, playerDoc.content);
        enrichedCount++;
        console.log(`    ✓ Individual match: ${player.name}`);
      }
    }
  }

  console.log(`    Enriched ${enrichedCount}/${autoUpdatePlayers.length} players`);
}

async function main() {
  console.log("🔍 Bildli - Enriching markdown content with Wikidata...\n");

  const competitionFilter = process.env.COMPETITION_FILTER || "All";

  const allCompetitions = listCompetitionDocs()
    .map((doc) => normalizeCompetition(doc.data))
    .filter((competition) => competition.auto_update);

  if (allCompetitions.length === 0) {
    console.error("❌ No competition content found. Run 'npm run fetch' first.");
    process.exit(1);
  }

  const filtered =
    competitionFilter !== "All"
      ? allCompetitions.filter((c) => c.code === competitionFilter)
      : [];

  if (competitionFilter !== "All" && filtered.length === 0) {
    console.warn(`⚠️  No competition found with code "${competitionFilter}". Running with all competitions.`);
  }

  const competitions = filtered.length > 0 ? filtered : allCompetitions;

  for (const competition of competitions) {
    console.log(`\n📋 Processing: ${competition.name}`);
    const teamDocs = listTeamDocs(competition.code).filter((teamDoc) =>
      normalizeTeam(teamDoc.data).auto_update
    );

    for (const teamDoc of teamDocs) {
      await enrichTeam(competition.code, teamDoc);
      await sleep(3000);
    }
  }

  console.log("\n✅ Wikidata enrichment complete!");
}

main().catch((error) => {
  console.error("❌ Enrichment failed:", error.message);
  process.exit(1);
});
