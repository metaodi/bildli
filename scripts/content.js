const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const ROOT_DIR = path.join(__dirname, "..");
const CONTENT_DIR = path.join(ROOT_DIR, "content");
const COMPETITIONS_DIR = path.join(CONTENT_DIR, "competitions");
const TEAMS_DIR = path.join(CONTENT_DIR, "teams");
const PLAYERS_DIR = path.join(CONTENT_DIR, "players");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DEFAULT_SORT_ORDER = Number.MAX_SAFE_INTEGER;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, sanitizeValue(entryValue)])
    );
  }

  return value;
}

function slugify(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = sortKeys(value[key]);
      return result;
    }, {});
}

function readMarkdownFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const parsed = matter(fs.readFileSync(filePath, "utf-8"));
  return {
    filePath,
    data: parsed.data || {},
    content: parsed.content || "",
  };
}

function writeMarkdownFile(filePath, data, content = "") {
  ensureDir(path.dirname(filePath));
  const normalizedContent = content.trim();
  const body = normalizedContent ? `${normalizedContent}\n` : "";
  const next = matter.stringify(body, sortKeys(sanitizeValue(data)));
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;

  if (current === next) {
    return false;
  }

  fs.writeFileSync(filePath, next);
  return true;
}

function listMarkdownFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return listMarkdownFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
  });
}

function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && now.getDate() < birth.getDate())
  ) {
    age--;
  }
  return age;
}

function parseShirtNumber(value) {
  const shirtNumber = parseInt(value, 10);
  return Number.isNaN(shirtNumber) ? null : shirtNumber;
}

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
    "Central Midfield": {
      label: "Zentrales Mittelfeld",
      emoji: "⚙️",
      sort: 3,
    },
    "Attacking Midfield": {
      label: "Offensives Mittelfeld",
      emoji: "🎯",
      sort: 4,
    },
    "Left Midfield": { label: "Linkes Mittelfeld", emoji: "⚙️", sort: 3 },
    "Right Midfield": {
      label: "Rechtes Mittelfeld",
      emoji: "⚙️",
      sort: 3,
    },
    "Left Winger": { label: "Linksaussen", emoji: "💨", sort: 5 },
    "Right Winger": { label: "Rechtsaussen", emoji: "💨", sort: 5 },
    Offence: { label: "Angriff", emoji: "⚽", sort: 6 },
    Forward: { label: "Stürmer", emoji: "⚽", sort: 6 },
    "Centre-Forward": { label: "Mittelstürmer", emoji: "⚽", sort: 6 },
    Coach: { label: "Trainer", emoji: "📋", sort: 8 },
  };

  return posMap[position] || {
    label: position || "Unbekannt",
    emoji: "⚽",
    sort: 7,
  };
}

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
 * Merge generated (API/Wikidata) data into a markdown document's frontmatter.
 * - New documents start with defaults plus generated values.
 * - Curated documents with auto_update: false keep their existing metadata.
 * - Auto-updated documents refresh generated fields while preserving the control
 *   flags (auto_update, visible, sortOrder).
 */
function mergeGeneratedData(existingDoc, generatedData, defaults = {}) {
  // New documents start from defaults and get the latest generated metadata.
  if (!existingDoc) {
    return {
      ...defaults,
      ...generatedData,
    };
  }

  // Curated documents keep their current metadata even when the source changes.
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

function normalizeCompetition(data) {
  return {
    ...data,
    auto_update: data.auto_update !== false,
    visible: data.visible !== false,
    sortOrder: data.sortOrder ?? DEFAULT_SORT_ORDER,
  };
}

function normalizeTeam(data) {
  return {
    ...data,
    auto_update: data.auto_update !== false,
    visible: data.visible !== false,
    sortOrder: data.sortOrder ?? DEFAULT_SORT_ORDER,
  };
}

function normalizePlayer(data) {
  const positionOriginal = data.positionOriginal || data.position || null;
  const position = mapPosition(positionOriginal);

  return {
    ...data,
    auto_update: data.auto_update !== false,
    visible: data.visible === true,
    positionOriginal,
    position: data.position || position.label,
    positionEmoji: data.positionEmoji || position.emoji,
    positionSort: data.positionSort || position.sort,
    age: calculateAge(data.dateOfBirth),
  };
}

function getCompetitionFilePath(code) {
  return path.join(COMPETITIONS_DIR, `${code}.md`);
}

function getTeamFilePath(competitionCode, teamId, teamName) {
  const filename = teamName
    ? `${teamId}-${slugify(teamName)}.md`
    : `${teamId}.md`;
  return path.join(TEAMS_DIR, competitionCode, filename);
}

function getPlayerFilePath(competitionCode, teamId, playerId, playerName) {
  const filename = playerName
    ? `${playerId}-${slugify(playerName)}.md`
    : `${playerId}.md`;
  return path.join(PLAYERS_DIR, competitionCode, String(teamId), filename);
}

function findDocByIdInDir(dirPath, entityId) {
  const idStr = String(entityId);
  if (!fs.existsSync(dirPath)) return null;

  const entries = fs.readdirSync(dirPath);
  const match = entries.find((e) => {
    if (!e.endsWith(".md")) return false;
    const stem = e.slice(0, -3);
    return stem === idStr || stem.startsWith(`${idStr}-`);
  });

  return match ? readMarkdownFile(path.join(dirPath, match)) : null;
}

function findExistingTeamDoc(competitionCode, teamId) {
  return findDocByIdInDir(path.join(TEAMS_DIR, competitionCode), teamId);
}

function findExistingPlayerDoc(competitionCode, teamId, playerId) {
  return findDocByIdInDir(
    path.join(PLAYERS_DIR, competitionCode, String(teamId)),
    playerId
  );
}

function listCompetitionDocs() {
  return listMarkdownFiles(COMPETITIONS_DIR).map(readMarkdownFile).filter(Boolean);
}

function listTeamDocs(competitionCode) {
  const dirPath = competitionCode ? path.join(TEAMS_DIR, competitionCode) : TEAMS_DIR;
  return listMarkdownFiles(dirPath).map(readMarkdownFile).filter(Boolean);
}

function listPlayerDocs(competitionCode, teamId) {
  let basePath = PLAYERS_DIR;
  if (competitionCode) {
    basePath = path.join(basePath, competitionCode);
  }
  if (teamId !== undefined) {
    basePath = path.join(basePath, String(teamId));
  }

  return listMarkdownFiles(basePath).map(readMarkdownFile).filter(Boolean);
}

function loadContentData() {
  const competitions = listCompetitionDocs()
    .map((doc) => ({
      ...normalizeCompetition(doc.data),
      description: doc.content.trim(),
    }))
    .filter((competition) => competition.visible)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "de"));

  return competitions.map((competition) => {
    const teams = listTeamDocs(competition.code)
      .map((doc) => ({
        ...normalizeTeam(doc.data),
        description: doc.content.trim(),
      }))
      .filter((team) => team.visible)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "de"))
      .map((team) => {
        const players = listPlayerDocs(competition.code, team.id)
          .map((doc) => ({
            ...normalizePlayer(doc.data),
            description: doc.content.trim(),
          }))
          .filter((player) => player.visible)
          .sort((a, b) => a.positionSort - b.positionSort || a.name.localeCompare(b.name, "de"));

        return {
          ...team,
          players,
          playerCount: players.length,
        };
      });

    return {
      ...competition,
      teams,
      teamCount: teams.length,
    };
  });
}

module.exports = {
  CONTENT_DIR,
  COMPETITIONS_DIR,
  TEAMS_DIR,
  PLAYERS_DIR,
  DATA_DIR,
  DEFAULT_SORT_ORDER,
  calculateAge,
  ensureDir,
  findExistingPlayerDoc,
  findExistingTeamDoc,
  getCompetitionFilePath,
  getPlayerFilePath,
  getTeamFilePath,
  listCompetitionDocs,
  listPlayerDocs,
  listTeamDocs,
  loadContentData,
  mapPosition,
  mergeGeneratedData,
  normalizeCompetition,
  normalizePlayer,
  normalizeTeam,
  parseShirtNumber,
  readMarkdownFile,
  slugify,
  translateNationality,
  writeMarkdownFile,
};
