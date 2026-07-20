/**
 * squad.js - Fetch a team's current squad from Wikidata.
 *
 * Shared by build.js (fallback when football-data.org returns no squad) and
 * scaffold.js (leagues whose teams are curated by hand because the API doesn't
 * serve them, e.g. SSL). Returns lightweight player objects — name, date of
 * birth, nationality, position, shirt number — the "skeleton" that enrich.js
 * later completes with image, height, preferred foot and birthplace.
 *
 * Network step (Wikidata SPARQL), never used by the offline site build.
 */

const wikidata = require("./wikidata");
const { mapPosition, parseShirtNumber, translateNationality } = require("./content");

const ACTIVE_PLAYER_MAX_AGE = 45;
// Default tenure window for the strict "current squad" filter: a membership
// counts as current only if it started within this many years and has no end
// date. Wikidata rarely dates the *end* of a former player's club membership,
// so "no end date" alone lets retired players through — the recent start date
// is what actually distinguishes a current squad. Overridable per run.
const CURRENT_SQUAD_MAX_TENURE_YEARS =
  Number(process.env.SQUAD_MAX_TENURE_YEARS) || 6;
const ASSOCIATION_FOOTBALL_PLAYER_QID = "Q937857";
const ASSOCIATION_FOOTBALL_MANAGER_QID = "Q628099";
const SPORTS_COACH_QID = "Q2732438";

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

function getYearsAgoCutoff(years) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return cutoff.toISOString().slice(0, 10);
}

// Backwards-compatible alias — the birth-date cutoff is just "N years ago".
const getActivePlayerBirthDateCutoff = getYearsAgoCutoff;

/**
 * SPARQL constraining a `member of sports team` statement (`?teamStmt`) to a
 * current membership.
 * - loose (default, used by build.js's fallback): keep it unless it has an
 *   end date already in the past.
 * - strict (used by scaffold.js): require no end date at all AND a start date
 *   within the tenure window, which is what actually filters out former
 *   players whose Wikidata membership was simply never given an end date.
 */
function currentMembershipConstraint(strictCurrent, tenureYears) {
  if (!strictCurrent) {
    return `
      FILTER NOT EXISTS {
        ?teamStmt pq:P582 ?endDate .
        FILTER(?endDate < NOW())
      }`;
  }

  const startCutoff = getYearsAgoCutoff(tenureYears);
  return `
      FILTER NOT EXISTS { ?teamStmt pq:P582 ?endDate . }
      ?teamStmt pq:P580 ?startDate .
      FILTER(?startDate >= "${startCutoff}T00:00:00Z"^^xsd:dateTime)`;
}

/**
 * Fetch the current squad of a team (by name) from Wikidata.
 * Returns an array of generated player objects, sorted by position.
 *
 * options.strictCurrent — require a recent, open-ended membership (see
 *   currentMembershipConstraint). Off by default so build.js's fallback keeps
 *   its original, more permissive behavior.
 * options.tenureYears — tenure window for the strict filter.
 */
async function fetchTeamSquad(teamName, options = {}) {
  const {
    strictCurrent = false,
    tenureYears = CURRENT_SQUAD_MAX_TENURE_YEARS,
  } = options;
  console.log(
    `    ⚡ Fetching squad from Wikidata${strictCurrent ? " (current only)" : ""}...`
  );

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
      ?teamStmt ps:P54 wd:${teamQID} .${currentMembershipConstraint(strictCurrent, tenureYears)}
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

module.exports = {
  fetchTeamSquad,
  getActivePlayerBirthDateCutoff,
  WIKIDATA_POSITION_MAP,
  ACTIVE_PLAYER_MAX_AGE,
};
