import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=4";
import { publishPublicSeasonDashboard } from "./public-season-dashboard.js?v=15";

const OFFICIAL_SCORE_STATUSES = new Set(["published", "confirmed", "locked"]);

const numberValue = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function isRegularSeasonMatchup(matchup = {}) {
  const stage = String(matchup.stage || "").trim().toLowerCase();
  return stage === "regular" || /^w\d+$/i.test(String(matchup.weekId || "").trim());
}

function isOfficialCompletedLine(line = {}) {
  return String(line.scheduleStatus || "").toLowerCase() === "completed"
    && OFFICIAL_SCORE_STATUSES.has(String(line.scoreStatus || "").toLowerCase())
    && Boolean(line.winnerTeamId);
}

function matchupDerivedValues(matchup, lines, expectedLines) {
  const completedLines = lines.filter(isOfficialCompletedLine);
  const canceledLineCount = lines.filter(
    (line) => String(line.scheduleStatus || "").toLowerCase() === "canceled",
  ).length;
  const completedLineCount = completedLines.length;
  const complete = completedLineCount + canceledLineCount >= expectedLines;
  const homeLineWins = completedLines.filter(
    (line) => line.winnerTeamId === matchup.homeTeamId,
  ).length;
  const awayLineWins = completedLines.filter(
    (line) => line.winnerTeamId === matchup.awayTeamId,
  ).length;
  return {
    completedLines,
    completedLineCount,
    canceledLineCount,
    homeTeamPoints: completedLines.reduce(
      (total, line) => total + numberValue(line.homePoints),
      0,
    ),
    awayTeamPoints: completedLines.reduce(
      (total, line) => total + numberValue(line.awayPoints),
      0,
    ),
    status: complete
      ? "completed"
      : completedLineCount || canceledLineCount
        ? "inProgress"
        : matchup.status,
    winnerTeamId: complete
      ? homeLineWins > awayLineWins
        ? matchup.homeTeamId
        : awayLineWins > homeLineWins
          ? matchup.awayTeamId
          : null
      : null,
  };
}

function emptyStanding(teamId, existing = {}) {
  const bonusPoints = numberValue(existing.bonusPoints);
  const penaltyPoints = numberValue(existing.penaltyPoints);
  return {
    teamId,
    completedMatchups: 0,
    completedLines: 0,
    lineWins: 0,
    lineLosses: 0,
    matchPoints: 0,
    bonusPoints,
    penaltyPoints,
    adjustedTotal: bonusPoints - penaltyPoints,
    playoffPosition: null,
    qualified: false,
    sourceVersion: 1,
  };
}

function applyLineToStandings(standing, points, won) {
  standing.completedLines += 1;
  standing.matchPoints += numberValue(points);
  standing.lineWins += won ? 1 : 0;
  standing.lineLosses += won ? 0 : 1;
}

export async function recalculateSeasonDerivedRecords(seasonId) {
  if (!seasonId || !auth.currentUser) {
    throw new Error("An authenticated EC or Admin is required to refresh season records.");
  }
  const seasonRef = doc(db, "seasons", seasonId);
  const [seasonSnapshot, teamSnapshot, matchupSnapshot, standingSnapshot] = await Promise.all([
    getDoc(seasonRef),
    getDocs(collection(seasonRef, "teams")),
    getDocs(collection(seasonRef, "matchups")),
    getDocs(collection(seasonRef, "standings")),
  ]);
  if (!seasonSnapshot.exists()) throw new Error(`Season ${seasonId} was not found.`);

  const season = seasonSnapshot.data();
  const teams = teamSnapshot.docs
    .map((item) => ({ teamId: item.id, ...item.data() }))
    .filter((team) => String(team.status || "active").toLowerCase() !== "inactive");
  const matchups = matchupSnapshot.docs.map(
    (item) => ({ matchupId: item.id, ...item.data() }),
  );
  const lineGroups = await Promise.all(matchups.map(async (matchup) => ({
    matchup,
    lines: (
      await getDocs(
        collection(seasonRef, "matchups", matchup.matchupId, "lineMatches"),
      )
    ).docs.map((item) => ({ lineMatchId: item.id, ...item.data() })),
  })));
  const existingStandings = new Map(
    standingSnapshot.docs.map((item) => [item.id, item.data()]),
  );
  const standings = new Map(
    teams.map((team) => [
      team.teamId,
      emptyStanding(team.teamId, existingStandings.get(team.teamId)),
    ]),
  );
  const expectedLines = Math.max(1, numberValue(season.linesPerMatchup) || 5);
  const derivedMatchups = lineGroups.map(({ matchup, lines }) => ({
    matchup,
    derived: matchupDerivedValues(matchup, lines, expectedLines),
  }));

  derivedMatchups
    .filter(({ matchup }) => isRegularSeasonMatchup(matchup))
    .forEach(({ matchup, derived }) => {
      if (derived.status === "completed") {
        const home = standings.get(matchup.homeTeamId);
        const away = standings.get(matchup.awayTeamId);
        if (home) home.completedMatchups += 1;
        if (away) away.completedMatchups += 1;
      }
      derived.completedLines.forEach((line) => {
        const home = standings.get(matchup.homeTeamId);
        const away = standings.get(matchup.awayTeamId);
        if (home) {
          applyLineToStandings(
            home,
            line.homePoints,
            line.winnerTeamId === matchup.homeTeamId,
          );
        }
        if (away) {
          applyLineToStandings(
            away,
            line.awayPoints,
            line.winnerTeamId === matchup.awayTeamId,
          );
        }
      });
    });

  const ranked = [...standings.values()]
    .map((standing) => ({
      ...standing,
      adjustedTotal:
        standing.matchPoints + standing.bonusPoints - standing.penaltyPoints,
    }))
    .sort(
      (a, b) =>
        b.adjustedTotal - a.adjustedTotal ||
        b.lineWins - a.lineWins ||
        b.completedLines - a.completedLines ||
        a.teamId.localeCompare(b.teamId),
    );
  const qualifyingTeams = Math.min(
    teams.length,
    Math.max(0, numberValue(season.playoffTeamCount) || 6),
  );
  ranked.forEach((standing, index) => {
    standing.playoffPosition = index + 1;
    standing.qualified = index < qualifyingTeams;
  });

  const batch = writeBatch(db);
  derivedMatchups.forEach(({ matchup, derived }) => {
    batch.set(
      doc(seasonRef, "matchups", matchup.matchupId),
      {
        homeTeamPoints: derived.homeTeamPoints,
        awayTeamPoints: derived.awayTeamPoints,
        completedLineCount: derived.completedLineCount,
        canceledLineCount: derived.canceledLineCount,
        status: derived.status,
        winnerTeamId: derived.winnerTeamId,
        standingsApplied: derived.status === "completed",
        derivedRecordsUpdatedAt: serverTimestamp(),
        derivedRecordsUpdatedByUid: auth.currentUser.uid,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
  ranked.forEach((standing) => {
    batch.set(
      doc(seasonRef, "standings", standing.teamId),
      {
        ...standing,
        calculatedAt: serverTimestamp(),
        calculatedByUid: auth.currentUser.uid,
      },
      { merge: true },
    );
  });
  await batch.commit();
  return {
    matchupCount: derivedMatchups.length,
    standingCount: ranked.length,
  };
}

export async function refreshSeasonPublicRecords(seasonId) {
  const result = await recalculateSeasonDerivedRecords(seasonId);
  const published = await publishPublicSeasonDashboard(seasonId);
  if (!published) {
    throw new Error("The season records were recalculated, but public publishing was not authorized.");
  }
  window.dispatchEvent(new CustomEvent("alphaopen:match-line-updated", {
    detail: { seasonId, fullRefresh: true },
  }));
  return result;
}
