export const TEAM_STATUSES = new Set(["pendingSubmission", "submitted", "approved", "rejected"]);

export function normalizeTeamStatus(value) {
  const status = String(value || "");
  if (TEAM_STATUSES.has(status)) return status;
  if (["draft", "validationFailed", "systemValidated", "changesRequested"].includes(status)) {
    return "pendingSubmission";
  }
  if (["waitingForOpponent", "readyForApproval", "resubmitted"].includes(status)) {
    return "submitted";
  }
  if (["published", "locked"].includes(status)) return "approved";
  return "pendingSubmission";
}

export function deriveLineupApprovalStatus(homeStatus, awayStatus) {
  const home = normalizeTeamStatus(homeStatus);
  const away = normalizeTeamStatus(awayStatus);
  if (home === "rejected" || away === "rejected") return "rejected";
  if (home === "approved" && away === "approved") return "fullyApproved";
  if (["submitted", "approved"].includes(home) && ["submitted", "approved"].includes(away)) {
    return "awaitingApproval";
  }
  return "awaitingSubmission";
}

export function validateLineupShape(lines, rosterRows) {
  if (!Array.isArray(lines) || lines.length !== 5) {
    throw new Error("Exactly five lineup lines are required.");
  }
  const roster = new Map(
    rosterRows
      .filter((row) => String(row.status || "").toLowerCase() === "active")
      .map((row) => [String(row.playerId || ""), row]),
  );
  const canonical = lines
    .map((line, index) => {
      const lineNumber = Number(line?.lineNumber);
      if (lineNumber !== index + 1) throw new Error(`Line ${index + 1} is out of sequence.`);
      const player1Id = String(line?.player1Id || "").trim();
      const player2Id = String(line?.player2Id || "").trim();
      const player1 = roster.get(player1Id);
      const player2 = roster.get(player2Id);
      if (!player1 || !player2) throw new Error(`Line ${lineNumber} contains a player who is not active on this team.`);
      const player1Rank = Number(player1.rankNumber);
      const player2Rank = Number(player2.rankNumber);
      return {
        lineNumber,
        player1Id,
        player2Id,
        player1Name: player1.playerNameSnapshot || player1.playerName || player1Id,
        player2Name: player2.playerNameSnapshot || player2.playerName || player2Id,
        player1Rank,
        player2Rank,
        sor: player1Rank + player2Rank,
      };
    });

  const playerIds = canonical.flatMap((line) => [line.player1Id, line.player2Id]);
  if (new Set(playerIds).size !== 10) throw new Error("All ten lineup players must be unique.");

  const rankLimits = new Map([[1, [1, 4]], [4, [7, 13]], [5, [11, 14]]]);
  canonical.forEach((line) => {
    const limits = rankLimits.get(line.lineNumber);
    if (limits && [line.player1Rank, line.player2Rank].some((rank) => rank < limits[0] || rank > limits[1])) {
      throw new Error(`Line ${line.lineNumber} requires roster ranks ${limits[0]}-${limits[1]}.`);
    }
  });
  for (let index = 1; index < canonical.length; index += 1) {
    if (canonical[index].sor < canonical[index - 1].sor) {
      throw new Error(`Line ${index + 1} SOR cannot be lower than Line ${index} SOR.`);
    }
  }
  return canonical;
}

export function hasScoreActivity(lineMatch = {}) {
  const scheduleStatus = String(lineMatch.scheduleStatus || "").toLowerCase();
  const scoreStatus = String(lineMatch.scoreStatus || "").toLowerCase();
  const blockedScheduleStatuses = new Set(["inprogress", "completed"]);
  const blockedScoreStatuses = new Set([
    "inprogress", "submitted", "awaitingconfirmation", "confirmed",
    "disputed", "ecreview", "published", "locked", "completed",
  ]);
  const sets = Array.isArray(lineMatch.sets) ? lineMatch.sets : [];
  const hasSetScore = sets.some((set) =>
    Number(set?.home ?? set?.homeGames ?? 0) !== 0 ||
    Number(set?.away ?? set?.awayGames ?? 0) !== 0
  );
  return blockedScheduleStatuses.has(scheduleStatus) ||
    blockedScoreStatuses.has(scoreStatus) ||
    hasSetScore ||
    Number(lineMatch.homePoints || 0) !== 0 ||
    Number(lineMatch.awayPoints || 0) !== 0 ||
    Boolean(lineMatch.winnerTeamId) ||
    Boolean(lineMatch.completedAt);
}
