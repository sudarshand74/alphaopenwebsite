import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {auth, db} from "./firebase-client.js?v=4";
import {loadCanonicalPlayers} from "./player-identity.js?v=5";

const PUBLIC_DASHBOARD_REF = doc(db, "publicConfig", "activeSeasonDashboard");
const PUBLIC_COMPLETED_DASHBOARDS = "publicSeasonDashboards";
const PUBLIC_COMPLETED_SEASONS = "publicCompletedSeasons";
const MAX_PROJECTION_BYTES = 850000;

const copy = (source, keys) => Object.fromEntries(
  keys
    .filter((key) => source?.[key] !== undefined)
    .map((key) => [key, source[key]]),
);

function resolvedPlayerName(playerId, ...candidates) {
  const normalizedId = String(playerId || "").trim();
  return candidates
    .map((value) => String(value || "").trim())
    .find(
      (value) =>
        value &&
        value !== normalizedId &&
        value.toLowerCase() !== "player name unavailable",
    ) || normalizedId || "Player name unavailable";
}

const seasonKeys = [
  "seasonId", "name", "term", "year", "status", "timezone",
  "startDate", "endDate", "teamCount", "rosterRanksPerTeam",
  "regularSeasonMatchupsPerTeam", "linesPerMatchup", "playersPerLine",
];
const teamKeys = [
  "teamId", "name", "shortName", "status", "seed", "color",
  "captainNameSnapshot", "captainPlayerIds",
];
const rosterKeys = [
  "assignmentId", "teamId", "rankNumber", "playerId", "playerNameSnapshot",
  "originalPlayerId", "originalPlayerNameSnapshot", "assignmentType", "status",
  "effectiveFrom", "effectiveTo", "regularSeasonEligible", "playoffEligible",
];
const weekKeys = [
  "weekId", "label", "sequence", "stage", "startsAt", "lineupDeadlineAt",
  "publishAt", "playByAt", "status",
];
const matchupKeys = [
  "matchupId", "weekId", "stage", "homeTeamId", "awayTeamId",
  "homeTeamNameSnapshot", "awayTeamNameSnapshot", "scheduledStartAt",
  "publishAt", "playByAt", "effectivePlayByAt", "venueId", "venueNameSnapshot",
  "status", "lineupsPublished", "lineupsPublishedAt", "completedLineCount",
  "homeTeamPoints", "awayTeamPoints",
];
const standingKeys = [
  "teamId", "completedMatchups", "completedLines", "lineWins", "lineLosses",
  "matchPoints", "bonusPoints", "penaltyPoints", "adjustedTotal",
  "playoffPosition", "qualified", "calculatedAt", "sourceVersion",
];

function safePlayer(player = {}, canonicalPlayers = new Map()) {
  const playerId = String(player.playerId || "").trim();
  const nameSnapshot = resolvedPlayerName(
    playerId,
    canonicalPlayers.get(playerId)?.displayName ||
      "",
    player.nameSnapshot,
    player.playerNameSnapshot,
    player.name,
  );
  return {
    ...copy(player, ["playerId", "assignmentId", "rankNumber", "rankSnapshot"]),
    playerId,
    nameSnapshot,
  };
}

function safeSet(set = {}, index) {
  return {
    setNumber: Number(set.setNumber || index + 1),
    ...copy(set, ["format", "home", "away", "homeScore", "awayScore"]),
  };
}

function safeLineMatch(line = {}, canonicalPlayers = new Map()) {
  return {
    ...copy(line, [
      "lineMatchId", "lineupId", "seasonId", "matchupId", "lineNumber",
      "homeTeamId", "awayTeamId", "homeSor", "awaySor", "lineupState",
      "scheduleStatus", "scheduledAt", "venueId", "venueNameSnapshot",
      "effectivePlayByAt", "thirdSetFormat", "resultType", "winnerTeamId",
      "homePoints", "awayPoints", "scoreStatus", "publishedAt", "updatedAt",
      "superAdminPlayerOverrideApproved",
    ]),
    homePlayers: (line.homePlayers || []).map((player) => safePlayer(player, canonicalPlayers)),
    awayPlayers: (line.awayPlayers || []).map((player) => safePlayer(player, canonicalPlayers)),
    sets: (line.sets || []).map(safeSet),
  };
}

function publicLineIsVisible(line, matchup) {
  const scheduleStatus = String(line.scheduleStatus || "").toLowerCase();
  return ["tobescheduled", "scheduled", "completed"].includes(scheduleStatus);
}

function canPublish() {
  const authorization = window.alphaOpenAuthorization;
  return Boolean(
    auth.currentUser &&
    (
      authorization?.roles?.includes("superAdmin") ||
      authorization?.role === "Super Admin" ||
      auth.currentUser.email?.toLowerCase() === "sudarshandesai74@gmail.com"
    )
  );
}

export async function loadPublicSeasonDashboard(expectedSeasonId = "") {
  const snapshot = await getDoc(PUBLIC_DASHBOARD_REF);
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (
    data.status !== "active" ||
    !data.seasonId ||
    (expectedSeasonId && data.seasonId !== expectedSeasonId)
  ) return null;
  return {
    season: data.season || null,
    teams: data.teams || [],
    rosterAssignments: data.rosterAssignments || [],
    weeks: data.weeks || [],
    matchups: data.matchups || [],
    lineMatches: data.lineMatches || [],
    standings: data.standings || [],
  };
}

export async function loadPublicMatchLines(seasonId, matchups = []) {
  if (!seasonId) return [];
  const lineGroups = await Promise.all(matchups.map(async (matchup) => {
    const matchupId = String(matchup.matchupId || "").trim();
    if (!matchupId) return [];
    const snapshot = await getDocs(query(
      collection(db, "seasons", seasonId, "matchups", matchupId, "lineMatches"),
      where("scheduleStatus", "in", ["toBeScheduled", "scheduled", "completed"]),
    ));
    return snapshot.docs.map((lineSnapshot) => ({
      lineMatchId: lineSnapshot.id,
      matchupId,
      ...lineSnapshot.data(),
    }));
  }));
  return lineGroups.flat();
}

function dashboardData(data = {}) {
  return {
    season: data.season || null,
    teams: data.teams || [],
    rosterAssignments: data.rosterAssignments || [],
    weeks: data.weeks || [],
    matchups: data.matchups || [],
    lineMatches: data.lineMatches || [],
    standings: data.standings || [],
  };
}

export async function loadPublicCompletedSeasons() {
  const snapshot = await getDocs(query(
    collection(db, PUBLIC_COMPLETED_SEASONS),
    where("status", "==", "completed"),
  ));
  return snapshot.docs
    .map((item) => ({seasonId: item.id, ...item.data()}));
}

export async function loadPublicCompletedSeasonDashboard(seasonId) {
  if (!seasonId) return null;
  const snapshot = await getDoc(doc(db, PUBLIC_COMPLETED_DASHBOARDS, seasonId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (String(data.status || "").toLowerCase() !== "completed") return null;
  return dashboardData(data);
}

export async function publishPublicSeasonDashboard(seasonId) {
  if (!canPublish() || !seasonId) return false;
  const seasonRef = doc(db, "seasons", seasonId);
  const seasonSnapshot = await getDoc(seasonRef);
  if (!seasonSnapshot.exists()) throw new Error(`Season ${seasonId} was not found.`);
  const seasonStatus = String(seasonSnapshot.data().status || "").toLowerCase();
  const completedSeasonRef = doc(db, PUBLIC_COMPLETED_SEASONS, seasonId);
  const completedDashboardRef = doc(db, PUBLIC_COMPLETED_DASHBOARDS, seasonId);
  if (seasonStatus === "active" || !["completed", "archived"].includes(seasonStatus)) {
    await Promise.all([
      deleteDoc(completedSeasonRef),
      deleteDoc(completedDashboardRef),
    ]);
  }
  if (!["active", "completed", "archived"].includes(seasonStatus)) return false;

  const [teamsSnapshot, rosterSnapshot, weeksSnapshot, matchupSnapshot, standingsSnapshot, canonicalPlayers] =
    await Promise.all([
      getDocs(collection(seasonRef, "teams")),
      getDocs(collection(seasonRef, "rosterAssignments")),
      getDocs(collection(seasonRef, "weeks")),
      getDocs(collection(seasonRef, "matchups")),
      getDocs(collection(seasonRef, "standings")),
      loadCanonicalPlayers(),
    ]);

  const matchups = matchupSnapshot.docs.map((item) => ({matchupId: item.id, ...item.data()}));
  const lineGroups = await Promise.all(matchups.map(async (matchup) => {
    const snapshot = await getDocs(collection(seasonRef, "matchups", matchup.matchupId, "lineMatches"));
    return snapshot.docs
      .map((item) => ({lineMatchId: item.id, matchupId: matchup.matchupId, ...item.data()}))
      .filter((line) => publicLineIsVisible(line, matchup))
      .map((line) => safeLineMatch(line, canonicalPlayers));
  }));
  const rosterAssignments = rosterSnapshot.docs.map((item) => {
    const record = {...item.data(), assignmentId: item.id};
    const playerId = record.playerId || "";
    return {
      ...copy(record, rosterKeys),
      playerNameSnapshot: resolvedPlayerName(
        playerId,
        canonicalPlayers.get(playerId)?.displayName ||
          "",
        record.playerNameSnapshot,
      ),
    };
  });
  const projection = {
    schemaVersion: 1,
    status: seasonStatus,
    seasonId,
    season: copy({seasonId: seasonSnapshot.id, ...seasonSnapshot.data()}, seasonKeys),
    teams: teamsSnapshot.docs.map((item) => copy({teamId: item.id, ...item.data()}, teamKeys)),
    rosterAssignments,
    weeks: weeksSnapshot.docs.map((item) => copy({weekId: item.id, ...item.data()}, weekKeys)),
    matchups: matchups.map((item) => copy(item, matchupKeys)),
    lineMatches: lineGroups.flat(),
    standings: standingsSnapshot.docs.map((item) => copy({teamId: item.id, ...item.data()}, standingKeys)),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(projection)).length;
  if (bytes > MAX_PROJECTION_BYTES) {
    throw new Error(`Guest dashboard projection is ${bytes} bytes; split storage is required before publishing.`);
  }
  const targetRef = seasonStatus === "active"
    ? PUBLIC_DASHBOARD_REF
    : doc(db, PUBLIC_COMPLETED_DASHBOARDS, seasonId);
  await setDoc(targetRef, {
    ...projection,
    updatedAt: serverTimestamp(),
  });
  if (seasonStatus !== "active") {
    await setDoc(completedSeasonRef, {
      seasonId,
      name: projection.season.name || seasonId,
      term: projection.season.term || "",
      year: projection.season.year || null,
      status: seasonStatus,
      updatedAt: serverTimestamp(),
    });
  }
  return true;
}
