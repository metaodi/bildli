/**
 * wikidata.js - Shared Wikidata/SPARQL utilities
 *
 * Provides helper functions for querying Wikidata, used by both
 * build.js (player fallback) and enrich.js (player enrichment).
 */

const https = require("https");

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "Bildli/1.0 (https://github.com/metaodi/bildli)";

/**
 * Make an HTTPS GET request and return the parsed JSON response body
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
  const searchUrl =
    `https://www.wikidata.org/w/api.php?action=wbsearchentities` +
    `&search=${encodeURIComponent(teamName)}` +
    `&language=en&type=item&format=json&limit=5`;

  try {
    const result = await httpGet(searchUrl, {
      Accept: "application/json",
    });

    if (result.search && result.search.length > 0) {
      return result.search[0].id;
    }
  } catch (e) {
    console.warn(`  Could not search for team "${teamName}": ${e.message}`);
  }
  return null;
}

/**
 * Fetch the German label for a Wikidata entity
 */
async function getGermanLabel(qid) {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities` +
    `&ids=${encodeURIComponent(qid)}&props=labels` +
    `&languages=de&format=json`;

  try {
    const result = await httpGet(url, {
      Accept: "application/json",
    });

    if (
      result.entities &&
      result.entities[qid] &&
      result.entities[qid].labels &&
      result.entities[qid].labels.de
    ) {
      return result.entities[qid].labels.de.value;
    }
  } catch (e) {
    console.warn(`  Could not fetch German label for ${qid}: ${e.message}`);
  }
  return null;
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

module.exports = {
  httpGet,
  sparqlQuery,
  sleep,
  findTeamQID,
  getGermanLabel,
  sanitizeSparqlString,
  SPARQL_ENDPOINT,
  USER_AGENT,
};
