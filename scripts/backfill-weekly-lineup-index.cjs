const path = require("path");

const toolsLib = process.env.FIREBASE_TOOLS_LIB;
if (!toolsLib) throw new Error("FIREBASE_TOOLS_LIB is required.");
const auth = require(path.join(toolsLib, "auth.js"));
const {requireAuth} = require(path.join(toolsLib, "requireAuth.js"));
const {Client} = require(path.join(toolsLib, "apiv2.js"));

const projectArgument = process.argv.find((argument) => argument.startsWith("--project="));
const projectId = projectArgument
  ? projectArgument.slice("--project=".length)
  : "alphaopen-development-2026";
const apply = process.argv.includes("--apply");

const approvedProjectIds = new Set([
  "alphaopen-development-2026",
  "alphaopen-test-system",
  "alphaopen-production",
]);
if (!approvedProjectIds.has(projectId)) {
  throw new Error("This backfill is restricted to the approved AlphaOpen environments.");
}

function decode(value = {}) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("nullValue" in value) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decode);
  if (value.mapValue) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, nested]) => [key, decode(nested)]),
    );
  }
  return null;
}

function encode(value) {
  if (value === null || value === undefined) return {nullValue: null};
  if (typeof value === "string") return {stringValue: value};
  if (typeof value === "boolean") return {booleanValue: value};
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? {integerValue: String(value)}
      : {doubleValue: value};
  }
  if (Array.isArray(value)) return {arrayValue: {values: value.map(encode)}};
  return {
    mapValue: {
      fields: Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, encode(nested)]),
      ),
    },
  };
}

function buildIndex(dashboard) {
  const teamsById = new Map((dashboard.teams || []).map((team) => [team.teamId, team]));
  const rosterNamesByPlayerId = new Map(
    (dashboard.rosterAssignments || [])
      .filter((assignment) => assignment.playerId && assignment.playerNameSnapshot)
      .map((assignment) => [assignment.playerId, assignment.playerNameSnapshot]),
  );
  const captainNameForTeam = (team = {}) =>
    (team.captainPlayerIds || [])
      .map((playerId) => rosterNamesByPlayerId.get(playerId))
      .find(Boolean) ||
    team.captainNameSnapshot ||
    team.name ||
    team.shortName ||
    team.teamId ||
    "Captain TBD";
  return {
    linesPerMatchup: Number(dashboard.season?.linesPerMatchup || 5),
    weeks: (dashboard.weeks || []).map((week) => ({
      weekId: week.weekId,
      label: week.label || week.weekId,
      sequence: Number(week.sequence || 0),
      stage: week.stage || "regular",
    })),
    weeklyMatchups: (dashboard.matchups || []).map((matchup) => {
      const home = teamsById.get(matchup.homeTeamId) || {};
      const away = teamsById.get(matchup.awayTeamId) || {};
      return {
        matchupId: matchup.matchupId,
        weekId: matchup.weekId,
        homeTeamId: matchup.homeTeamId,
        awayTeamId: matchup.awayTeamId,
        homeTeamNameSnapshot:
          matchup.homeTeamNameSnapshot || home.name || home.shortName || matchup.homeTeamId,
        awayTeamNameSnapshot:
          matchup.awayTeamNameSnapshot || away.name || away.shortName || matchup.awayTeamId,
        homeCaptainName: captainNameForTeam(home),
        awayCaptainName: captainNameForTeam(away),
        homeCaptainPlayerIds: home.captainPlayerIds || [],
        awayCaptainPlayerIds: away.captainPlayerIds || [],
      };
    }),
  };
}

async function main() {
  const account = auth.getGlobalDefaultAccount();
  if (!account) throw new Error("Firebase CLI is not signed in.");
  await requireAuth({project: projectId, user: account.user, tokens: account.tokens});
  const client = new Client({urlPrefix: "https://firestore.googleapis.com", apiVersion: "v1"});
  const root = `projects/${projectId}/databases/(default)/documents`;
  const dashboardResponse = await client.get(`/${root}/publicConfig/activeSeasonDashboard`);
  const dashboard = Object.fromEntries(
    Object.entries(dashboardResponse.body.fields || {}).map(([key, value]) => [key, decode(value)]),
  );
  const index = buildIndex(dashboard);
  console.log(JSON.stringify({
    mode: apply ? "apply" : "preview",
    projectId,
    seasonId: dashboard.seasonId,
    weeks: index.weeks.length,
    weeklyMatchups: index.weeklyMatchups.length,
    captainLabels: index.weeklyMatchups.slice(0, 2).flatMap((matchup) => [
      `${matchup.homeTeamNameSnapshot} - ${matchup.homeCaptainName}`,
      `${matchup.awayTeamNameSnapshot} - ${matchup.awayCaptainName}`,
    ]),
  }, null, 2));
  if (!apply) return;

  const fields = Object.fromEntries(
    Object.entries(index).map(([key, value]) => [key, encode(value)]),
  );
  const response = await client.post(
    `/projects/${projectId}/databases/(default)/documents:batchWrite`,
    {
      writes: [{
        update: {
          name: `${root}/publicConfig/activeSeason`,
          fields,
        },
        updateMask: {fieldPaths: Object.keys(fields)},
      }],
    },
  );
  const failure = (response.body.status || []).find((status) => Number(status.code || 0) !== 0);
  if (failure) throw new Error(`Firestore backfill failed: ${JSON.stringify(failure)}`);
  const activeResponse = await client.get(`/${root}/publicConfig/activeSeason`);
  const active = Object.fromEntries(
    Object.entries(activeResponse.body.fields || {}).map(([key, value]) => [key, decode(value)]),
  );
  if (
    (active.weeks || []).length !== index.weeks.length ||
    (active.weeklyMatchups || []).length !== index.weeklyMatchups.length
  ) throw new Error("Weekly lineup index verification failed.");
  console.log(`${projectId} weekly lineup index backfilled and verified.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
