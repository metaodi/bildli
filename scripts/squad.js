/**
 * squad.js - Fetch a team's current squad.
 *
 * Two strategies:
 * - fetchTeamSquad (Wikidata `member of sports team`): used by build.js as a
 *   fallback when football-data.org returns no squad. Coverage is loose — a
 *   membership counts as current unless it has a past end date — so it drags in
 *   former players whose membership was never dated.
 * - fetchTeamSquadFromWikipedia: reads a club's current-squad `{{fs player}}`
 *   templates from Wikipedia (editor-maintained, so it's an accurate roster),
 *   resolves each linked article to a Wikidata QID, then looks up the player's
 *   data by QID. This gives a correct current squad *and* precise per-player
 *   data, sidestepping Wikidata's unreliable membership dating.
 *
 * Returns generated player objects (name, DOB, nationality, position, shirt
 * number, and — for the Wikipedia path — image/height/foot/birthplace). Network
 * steps (Wikidata SPARQL + MediaWiki API), never used by the offline site build.
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

const WIKIPEDIA_LANG = process.env.WIKIPEDIA_LANG || "en";
const MEDIAWIKI_MAX_TITLES = 50;
const HEIGHT_METRE_THRESHOLD = 3;

// {{fs player}} position codes → English position labels (mapPosition keys).
const FS_POSITION_MAP = {
  GK: "Goalkeeper",
  DF: "Defence",
  RB: "Right Back",
  LB: "Left Back",
  CB: "Centre-Back",
  MF: "Midfield",
  DM: "Defensive Midfield",
  CM: "Central Midfield",
  AM: "Attacking Midfield",
  RM: "Right Midfield",
  LM: "Left Midfield",
  RW: "Right Winger",
  LW: "Left Winger",
  FW: "Forward",
  CF: "Centre-Forward",
  ST: "Forward",
};

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

// ---------------------------------------------------------------------------
// Wikipedia squad source
// ---------------------------------------------------------------------------

function mediaWikiApi(lang, params) {
  const query = new URLSearchParams({ ...params, format: "json" }).toString();
  const url = `https://${lang}.wikipedia.org/w/api.php?${query}`;
  return wikidata.httpGet(url, { Accept: "application/json" });
}

function convertHeightToCentimeters(value) {
  const height = parseFloat(value);
  if (Number.isNaN(height)) return undefined;
  return height < HEIGHT_METRE_THRESHOLD
    ? Math.round(height * 100)
    : Math.round(height);
}

function mapPreferredFoot(footLabel) {
  if (!footLabel) return undefined;
  const foot = footLabel.toLowerCase();
  if (foot.includes("right") || foot.includes("recht")) return "Rechts";
  if (foot.includes("left") || foot.includes("link")) return "Links";
  if (foot.includes("both") || foot.includes("beid")) return "Beidfüssig";
  return footLabel;
}

/**
 * Split a template body on top-level `|` only, so pipes inside `[[wikilinks]]`
 * or nested `{{templates}}` (e.g. `name=[[Full Name|Display]]`) stay intact.
 */
function splitTemplateParams(body) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < body.length; i++) {
    const pair = body.slice(i, i + 2);
    if (pair === "[[" || pair === "{{") {
      depth++;
      current += pair;
      i++;
    } else if (pair === "]]" || pair === "}}") {
      depth = Math.max(0, depth - 1);
      current += pair;
      i++;
    } else if (body[i] === "|" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += body[i];
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Parse `{{fs player}}` / `{{Football squad player}}` templates out of an
 * article's wikitext. Returns { shirtNumber, articleTitle, name, posCode } for
 * each — articleTitle is the linked target used to resolve a Wikidata QID.
 */
function parseFsPlayers(wikitext) {
  const players = [];
  // Body is any run of non-brace chars, tolerating one level of nested
  // templates (e.g. other={{small|Captain}}) so those rows still match.
  const templateRe =
    /\{\{\s*(?:fs player|football squad player)\b((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/gi;
  let match;

  while ((match = templateRe.exec(wikitext)) !== null) {
    const params = {};
    for (const part of splitTemplateParams(match[1])) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim().toLowerCase();
      if (key) params[key] = part.slice(eq + 1).trim();
    }

    const rawName = params.name || "";
    const link = rawName.match(/\[\[\s*([^\]|]+?)\s*(?:\|\s*([^\]]+?)\s*)?\]\]/);
    const articleTitle = link ? link[1].trim() : null;
    const name = link
      ? (link[2] || link[1]).trim()
      : rawName.replace(/\[\[|\]\]/g, "").trim();
    if (!name) continue;

    players.push({
      shirtNumber: params.no ? parseShirtNumber(params.no) : null,
      articleTitle,
      name,
      posCode: (params.pos || "").toUpperCase(),
    });
  }

  return players;
}

/** Resolve Wikipedia article titles to Wikidata QIDs (batched). */
async function resolveTitlesToQids(lang, titles) {
  const titleToQid = {};

  for (let i = 0; i < titles.length; i += MEDIAWIKI_MAX_TITLES) {
    const chunk = titles.slice(i, i + MEDIAWIKI_MAX_TITLES);
    let data;
    try {
      data = await mediaWikiApi(lang, {
        action: "query",
        prop: "pageprops",
        ppprop: "wikibase_item",
        redirects: "1",
        titles: chunk.join("|"),
      });
    } catch (error) {
      console.warn(`    MediaWiki title lookup failed: ${error.message}`);
      continue;
    }

    const result = data.query || {};
    const rename = {};
    for (const entry of result.normalized || []) rename[entry.from] = entry.to;
    for (const entry of result.redirects || []) rename[entry.from] = entry.to;

    const finalTitleToQid = {};
    for (const page of Object.values(result.pages || {})) {
      const qid = page.pageprops && page.pageprops.wikibase_item;
      if (page.title && qid) finalTitleToQid[page.title] = qid;
    }

    for (const title of chunk) {
      // A title may be normalized and/or redirected before reaching its page.
      let resolved = title;
      for (let hop = 0; hop < 3 && rename[resolved]; hop++) resolved = rename[resolved];
      if (finalTitleToQid[resolved]) titleToQid[title] = finalTitleToQid[resolved];
    }

    await wikidata.sleep(500);
  }

  return titleToQid;
}

/** Look up per-player data from Wikidata for a set of QIDs (batched). */
async function fetchPlayerDataByQids(qids) {
  const byQid = {};
  const fields = [
    "dob",
    "image",
    "height",
    "footLabel",
    "birthPlaceLabel",
    "nationalityLabel",
    "shirtNumber",
    "playerLabel",
  ];

  for (let i = 0; i < qids.length; i += MEDIAWIKI_MAX_TITLES) {
    const chunk = qids.slice(i, i + MEDIAWIKI_MAX_TITLES);
    const values = chunk.map((qid) => `wd:${qid}`).join(" ");
    const query = `
      SELECT ?player ?playerLabel ?dob ?image ?height ?footLabel
             ?birthPlaceLabel ?nationalityLabel ?shirtNumber WHERE {
        VALUES ?player { ${values} }
        OPTIONAL { ?player wdt:P569 ?dob . }
        OPTIONAL { ?player wdt:P18 ?image . }
        OPTIONAL { ?player wdt:P2048 ?height . }
        OPTIONAL { ?player wdt:P552 ?foot . }
        OPTIONAL { ?player wdt:P19 ?birthPlace . }
        OPTIONAL { ?player wdt:P27 ?nationality . }
        OPTIONAL { ?player wdt:P1618 ?shirtNumber . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en" . }
      }`;

    let bindings;
    try {
      const result = await wikidata.sparqlQuery(query);
      bindings = (result.results && result.results.bindings) || [];
    } catch (error) {
      console.warn(`    Wikidata batch lookup failed: ${error.message}`);
      continue;
    }

    // OPTIONALs and multi-valued properties yield several rows per player;
    // keep the first non-empty value seen for each field.
    for (const binding of bindings) {
      const qid = binding.player.value.split("/").pop();
      const record = byQid[qid] || (byQid[qid] = {});
      for (const field of fields) {
        if (!record[field] && binding[field] && binding[field].value) {
          record[field] = binding[field].value;
        }
      }
    }

    await wikidata.sleep(1500);
  }

  return byQid;
}

/**
 * Fetch a club's current squad from its Wikipedia article.
 * Wikipedia supplies the roster + shirt/position; Wikidata supplies each
 * player's DOB, nationality, image, height, foot and birthplace by QID.
 * Players without a linked (blue-link) article are skipped — there is no stable
 * id to key them on — and logged so they can be added by hand.
 */
async function fetchTeamSquadFromWikipedia(articleTitle, options = {}) {
  const lang = options.lang || WIKIPEDIA_LANG;
  if (!articleTitle) {
    console.warn("    No Wikipedia article configured for team (set `wikipedia`)");
    return [];
  }

  console.log(`    ⚡ Fetching squad from Wikipedia: ${lang}:${articleTitle}`);

  let wikitext;
  try {
    const data = await mediaWikiApi(lang, {
      action: "parse",
      page: articleTitle,
      prop: "wikitext",
      formatversion: "2",
      redirects: "1",
    });
    wikitext = data.parse && data.parse.wikitext;
  } catch (error) {
    console.warn(`    Could not fetch Wikipedia article: ${error.message}`);
    return [];
  }
  if (!wikitext) {
    console.warn("    No wikitext returned for article");
    return [];
  }

  const parsed = parseFsPlayers(wikitext);
  const linked = parsed.filter((entry) => entry.articleTitle);
  const skipped = parsed.filter((entry) => !entry.articleTitle);
  if (skipped.length > 0) {
    console.log(
      `    ⚠️  ${skipped.length} squad entries without a linked article (skipped): ` +
        skipped.map((entry) => entry.name).join(", ")
    );
  }
  if (linked.length === 0) {
    console.log("    No linked squad players found");
    return [];
  }

  await wikidata.sleep(500);
  const titleToQid = await resolveTitlesToQids(
    lang,
    [...new Set(linked.map((entry) => entry.articleTitle))]
  );
  const qids = [...new Set(Object.values(titleToQid))];
  await wikidata.sleep(500);
  const dataByQid = await fetchPlayerDataByQids(qids);

  const players = [];
  const seenQids = new Set();
  for (const entry of linked) {
    const qid = titleToQid[entry.articleTitle];
    if (!qid || seenQids.has(qid)) continue;
    seenQids.add(qid);

    const record = dataByQid[qid] || {};
    const positionOriginal = FS_POSITION_MAP[entry.posCode] || null;
    const position = mapPosition(positionOriginal);
    const shirtNumber =
      entry.shirtNumber !== null && entry.shirtNumber !== undefined
        ? entry.shirtNumber
        : record.shirtNumber
        ? parseShirtNumber(record.shirtNumber)
        : null;

    players.push({
      id: `wd-${qid}`,
      name: record.playerLabel || entry.name,
      dateOfBirth: record.dob ? record.dob.slice(0, 10) : null,
      nationality: record.nationalityLabel
        ? translateNationality(record.nationalityLabel)
        : undefined,
      position: position.label,
      positionOriginal,
      positionEmoji: position.emoji,
      positionSort: position.sort,
      shirtNumber,
      image: record.image || undefined,
      heightCm: convertHeightToCentimeters(record.height),
      preferredFoot: mapPreferredFoot(record.footLabel),
      birthPlace: record.birthPlaceLabel || undefined,
      auto_update: true,
      visible: true,
    });
  }

  players.sort((a, b) => a.positionSort - b.positionSort);
  console.log(`    ✓ Found ${players.length} current players via Wikipedia`);
  return players;
}

module.exports = {
  fetchTeamSquad,
  fetchTeamSquadFromWikipedia,
  parseFsPlayers,
  getActivePlayerBirthDateCutoff,
  WIKIDATA_POSITION_MAP,
  FS_POSITION_MAP,
  ACTIVE_PLAYER_MAX_AGE,
};
