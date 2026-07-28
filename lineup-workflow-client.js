import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {auth, db} from "./firebase-client.js?v=5";

const SUPER_ADMIN_EMAIL = "sudarshandesai74@gmail.com";
const TEAM_STATUSES = new Set(["pendingSubmission", "submitted", "approved", "rejected"]);

export function newWorkflowOperationId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

function requiredId(value, label) {
  const result = String(value || "").trim();
  if (!result || result.length > 120 || result.includes("/")) throw new Error(`${label} is invalid.`);
  return result;
}

function requiredText(value, label, maxLength = 1000) {
  const result = String(value || "").trim();
  if (!result || result.length > maxLength) {
    throw new Error(`${label} is required and must be ${maxLength} characters or fewer.`);
  }
  return result;
}

function operationId(value) {
  const result = requiredId(value, "Operation ID");
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(result)) throw new Error("Operation ID contains unsupported characters.");
  return result;
}

function normalizeTeamStatus(value) {
  const status = String(value || "");
  if (TEAM_STATUSES.has(status)) return status;
  if (["waitingForOpponent", "readyForApproval", "resubmitted"].includes(status)) return "submitted";
  if (["published", "locked"].includes(status)) return "approved";
  return "pendingSubmission";
}

function deriveLineupApprovalStatus(homeStatus, awayStatus) {
  const home = normalizeTeamStatus(homeStatus);
  const away = normalizeTeamStatus(awayStatus);
  if (home === "rejected" || away === "rejected") return "rejected";
  if (home === "approved" && away === "approved") return "fullyApproved";
  if (["submitted", "approved"].includes(home) && ["submitted", "approved"].includes(away)) {
    return "awaitingApproval";
  }
  return "awaitingSubmission";
}

function matchupSide(matchup, teamId) {
  if (matchup.homeTeamId === teamId) return "home";
  if (matchup.awayTeamId === teamId) return "away";
  throw new Error("The selected team is not part of this matchup.");
}

function actorSnapshot(actor, prefix) {
  return {
    [`${prefix}ByUid`]: actor.uid,
    [`${prefix}ByPlayerId`]: actor.playerId,
    [`${prefix}ByNameSnapshot`]: actor.name,
    [`${prefix}ByRole`]: actor.role,
  };
}

async function actorFor(seasonId) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in is required.");
  const seasonRef = doc(db, "seasons", seasonId);
  const [userSnapshot, memberSnapshot, directApproverSnapshot, legacyApproverSnapshot] = await Promise.all([
    getDoc(doc(db, "users", user.uid)),
    getDoc(doc(seasonRef, "members", user.uid)),
    getDoc(doc(seasonRef, "approverAssignments", user.uid)),
    getDoc(doc(seasonRef, "approverAssignments", `season_${user.uid}`)),
  ]);
  const userRecord = userSnapshot.data() || {};
  const member = memberSnapshot.data() || {};
  const directApprover = directApproverSnapshot.data() || {};
  const legacyApprover = legacyApproverSnapshot.data() || {};
  const assignment = directApproverSnapshot.exists() ? directApprover : legacyApprover;
  const globalRoles = Array.isArray(userRecord.globalRoles) ? userRecord.globalRoles : [];
  const seasonRoles = Array.isArray(member.roles) ? member.roles : [];
  const email = String(user.email || userRecord.email || "").toLowerCase();
  const superAdmin = globalRoles.includes("superAdmin") || email === SUPER_ADMIN_EMAIL;
  if (userRecord.status !== "active" && !superAdmin) throw new Error("Your AlphaOpen account is not active.");
  const activeMember = member.status === "active";
  const neutralApprover = (assignment.status === "active" && assignment.approverUid === user.uid) ||
    (activeMember && seasonRoles.includes("neutralApprover"));
  const ec = activeMember && seasonRoles.includes("ec");
  const captain = activeMember && seasonRoles.includes("captain");
  const role = superAdmin ? "superAdmin" : neutralApprover ? "neutralApprover" : ec ? "ec" : captain ? "captain" : "player";
  return {
    uid: user.uid,
    playerId: userRecord.playerId || member.playerId || null,
    name: userRecord.displayName || user.displayName || user.email || user.uid,
    role,
    superAdmin,
    neutralApprover,
    ec,
    captain,
    teamIds: Array.isArray(member.teamIds) ? member.teamIds : [],
  };
}

function assertCanSubmit(actor, teamId) {
  if (actor.superAdmin || actor.neutralApprover || actor.ec) return;
  if (actor.captain && actor.teamIds.includes(teamId)) return;
  throw new Error("You are not authorized to submit this team's lineup.");
}

function assertCanReview(actor) {
  if (actor.superAdmin || actor.neutralApprover) return;
  throw new Error("Only an active Neutral Approver or Super Admin can make lineup decisions.");
}

function rosterAssignmentTime(item = {}) {
  const values = [item.updatedAt, item.reconciledAt, item.createdAt, item.effectiveFrom]
    .map((value) => {
      if (typeof value?.toMillis === "function") return value.toMillis();
      if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000;
      const parsed = Date.parse(value || "");
      return Number.isFinite(parsed) ? parsed : 0;
    });
  return Math.max(...values, 0);
}
function validateLineupShape(lines, rosterRows) {
  if (!Array.isArray(lines) || lines.length !== 5) throw new Error("Exactly five lineup lines are required.");
  const activeByRank = new Map();
  rosterRows
    .filter((row) => String(row.status || "").toLowerCase() === "active")
    .forEach((row) => {
      const rank = Number(row.rankNumber), current = activeByRank.get(rank);
      if (
        !current ||
        rosterAssignmentTime(row) > rosterAssignmentTime(current) ||
        (rosterAssignmentTime(row) === rosterAssignmentTime(current) &&
          String(row.assignmentId || "").localeCompare(String(current.assignmentId || "")) > 0)
      ) activeByRank.set(rank, row);
    });
  const roster = new Map(
    [...activeByRank.values()]
      .map((row) => [String(row.playerId || ""), row]),
  );
  const canonical = lines.map((line, index) => {
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

function hasScoreActivity(lineMatch = {}) {
  const scheduleStatus = String(lineMatch.scheduleStatus || "").toLowerCase();
  const scoreStatus = String(lineMatch.scoreStatus || "").toLowerCase();
  const sets = Array.isArray(lineMatch.sets) ? lineMatch.sets : [];
  return ["inprogress", "completed"].includes(scheduleStatus) ||
    ["inprogress", "submitted", "awaitingconfirmation", "confirmed", "disputed", "ecreview", "published", "locked", "completed"].includes(scoreStatus) ||
    sets.some((set) =>
      Number(set?.home ?? set?.homeGames ?? 0) !== 0 ||
      Number(set?.away ?? set?.awayGames ?? 0) !== 0) ||
    Number(lineMatch.homePoints || 0) !== 0 ||
    Number(lineMatch.awayPoints || 0) !== 0 ||
    Boolean(lineMatch.winnerTeamId) ||
    Boolean(lineMatch.completedAt);
}

export async function submitTeamLineup(payload) {
  const seasonId = requiredId(payload?.seasonId, "Season ID");
  const matchupId = requiredId(payload?.matchupId, "Matchup ID");
  const teamId = requiredId(payload?.teamId, "Team ID");
  const opId = operationId(payload?.operationId);
  const actor = await actorFor(seasonId);
  assertCanSubmit(actor, teamId);
  const rosterSnapshot = await getDocs(query(
    collection(db, "seasons", seasonId, "rosterAssignments"),
    where("teamId", "==", teamId),
  ));
  const canonicalLines = validateLineupShape(
    payload?.lines,
    rosterSnapshot.docs.map((item) => ({ ...item.data(), assignmentId: item.id })),
  );
  const matchupRef = doc(db, "seasons", seasonId, "matchups", matchupId);
  const lineupRef = doc(matchupRef, "lineups", teamId);
  const actionRef = doc(matchupRef, "lineupReviews", opId);

  return runTransaction(db, async (transaction) => {
    const [priorAction, matchupSnapshot, lineupSnapshot] = await Promise.all([
      transaction.get(actionRef),
      transaction.get(matchupRef),
      transaction.get(lineupRef),
    ]);
    if (priorAction.exists() && priorAction.data().result) return priorAction.data().result;
    if (!matchupSnapshot.exists()) throw new Error("Matchup was not found.");
    const matchup = matchupSnapshot.data();
    const side = matchupSide(matchup, teamId);
    const current = lineupSnapshot.data() || {};
    if (["submitted", "approved", "published", "locked"].includes(String(current.status || ""))) {
      throw new Error("This lineup is sealed and cannot be replaced.");
    }
    const revisionNumber = Math.max(
      Number(current.revisionNumber || 0),
      Number(matchup[`${side}LineupRevisionNumber`] || 0),
    ) + 1;
    const revisionRef = doc(lineupRef, "revisions", String(revisionNumber));
    const revisionSnapshot = await transaction.get(revisionRef);
    if (revisionSnapshot.exists()) throw new Error("This lineup revision already exists. Reload and try again.");
    const now = serverTimestamp();
    const ruleVersionId = matchup.ruleVersionId || payload?.ruleVersionId || "v1";
    const submitter = actorSnapshot(actor, "submitted");
    const lineupData = {
      seasonId,
      matchupId,
      teamId,
      status: "submitted",
      revisionNumber,
      ruleVersionId,
      lines: canonicalLines,
      validation: {passed: true, errors: [], checkedAt: now, checkedBy: "sparkClient", ruleVersionId},
      ...submitter,
      submittedAt: now,
      approvedByUid: null,
      approvedByPlayerId: null,
      approvedByNameSnapshot: null,
      approvedByRole: null,
      approvedAt: null,
      rejectionReason: null,
      rejectedByUid: null,
      rejectedByPlayerId: null,
      rejectedByNameSnapshot: null,
      rejectedByRole: null,
      rejectedAt: null,
      updatedByUid: actor.uid,
      updatedAt: now,
    };
    const otherSide = side === "home" ? "away" : "home";
    const otherStatus = normalizeTeamStatus(matchup[`${otherSide}LineupStatus`]);
    const approvalStatus = deriveLineupApprovalStatus(
      side === "home" ? "submitted" : otherStatus,
      side === "away" ? "submitted" : otherStatus,
    );
    const result = {seasonId, matchupId, teamId, side, status: "submitted", revisionNumber, lineupApprovalStatus: approvalStatus};
    const tracking = {
      revisionNumber,
      ...submitter,
      submittedAt: now,
      approvedByUid: null,
      approvedByPlayerId: null,
      approvedByNameSnapshot: null,
      approvedByRole: null,
      approvedAt: null,
    };
    transaction.set(lineupRef, lineupData);
    transaction.set(revisionRef, {...lineupData, immutable: true});
    transaction.update(matchupRef, {
      [`${side}LineupStatus`]: "submitted",
      [`${side}LineupRevisionNumber`]: revisionNumber,
      [`${side}LineupTracking`]: tracking,
      bothLineupsSubmitted: approvalStatus === "awaitingApproval",
      lineupApprovalStatus: approvalStatus,
      lineupsPublished: false,
      lineupsPublishedAt: null,
      fullyApprovedAt: null,
      lineupWorkflowActorUid: actor.uid,
      lineupWorkflowOperationId: opId,
      updatedAt: now,
    });
    transaction.set(actionRef, {
      action: "submitted",
      seasonId,
      matchupId,
      teamId,
      side,
      lineupRevisionNumber: revisionNumber,
      ...actorSnapshot(actor, "acted"),
      actedAt: now,
      previousStatus: normalizeTeamStatus(matchup[`${side}LineupStatus`]),
      newStatus: "submitted",
      operationId: opId,
      result,
    });
    return result;
  });
}

export async function decideTeamLineup(payload) {
  const seasonId = requiredId(payload?.seasonId, "Season ID");
  const matchupId = requiredId(payload?.matchupId, "Matchup ID");
  const teamId = requiredId(payload?.teamId, "Team ID");
  const decision = String(payload?.decision || "");
  if (!["approve", "reject"].includes(decision)) throw new Error("Decision must be approve or reject.");
  const reason = decision === "reject"
    ? requiredText(payload?.reason, "Rejection reason")
    : String(payload?.reason || "").trim();
  const opId = operationId(payload?.operationId);
  const actor = await actorFor(seasonId);
  assertCanReview(actor);
  const matchupRef = doc(db, "seasons", seasonId, "matchups", matchupId);
  const actionRef = doc(matchupRef, "lineupReviews", opId);

  return runTransaction(db, async (transaction) => {
    const [priorAction, matchupSnapshot] = await Promise.all([
      transaction.get(actionRef),
      transaction.get(matchupRef),
    ]);
    if (priorAction.exists() && priorAction.data().result) return priorAction.data().result;
    if (!matchupSnapshot.exists()) throw new Error("Matchup was not found.");
    const matchup = matchupSnapshot.data();
    const side = matchupSide(matchup, teamId);
    const homeRef = doc(matchupRef, "lineups", matchup.homeTeamId);
    const awayRef = doc(matchupRef, "lineups", matchup.awayTeamId);
    const [homeSnapshot, awaySnapshot] = await Promise.all([
      transaction.get(homeRef),
      transaction.get(awayRef),
    ]);
    const targetSnapshot = side === "home" ? homeSnapshot : awaySnapshot;
    if (!targetSnapshot.exists()) throw new Error("The selected team has not submitted a lineup.");
    const home = homeSnapshot.data() || {};
    const away = awaySnapshot.data() || {};
    const target = targetSnapshot.data();
    if (matchup.lineupApprovalStatus === "fullyApproved") {
      throw new Error("Use Reset Approved Lineup after both teams are fully approved.");
    }
    if (decision === "approve" && target.status !== "submitted") {
      throw new Error("Only the current submitted revision can be approved.");
    }
    if (decision === "reject" && !["submitted", "approved"].includes(target.status)) {
      throw new Error("This lineup is not available to return for change.");
    }
    const previousStatus = normalizeTeamStatus(target.status);
    const nextStatus = decision === "approve" ? "approved" : "rejected";
    const other = side === "home" ? away : home;
    const otherStatus = normalizeTeamStatus(other.status);
    const homeStatus = side === "home" ? nextStatus : otherStatus;
    const awayStatus = side === "away" ? nextStatus : otherStatus;
    const approvalStatus = deriveLineupApprovalStatus(homeStatus, awayStatus);
    const lineTargets = [];
    if (approvalStatus === "fullyApproved") {
      for (let index = 0; index < 5; index += 1) {
        const lineMatchId = `${matchupId}-L${index + 1}`;
        const lineRef = doc(matchupRef, "lineMatches", lineMatchId);
        lineTargets.push({lineMatchId, lineRef, existing: await transaction.get(lineRef)});
      }
    }
    const now = serverTimestamp();
    const decisionActor = actorSnapshot(actor, decision === "approve" ? "approved" : "rejected");
    const targetUpdate = decision === "approve" ? {
      status: "approved",
      ...decisionActor,
      approvedAt: now,
      rejectionReason: null,
      rejectedByUid: null,
      rejectedByPlayerId: null,
      rejectedByNameSnapshot: null,
      rejectedByRole: null,
      rejectedAt: null,
      updatedByUid: actor.uid,
      updatedAt: now,
    } : {
      status: "rejected",
      rejectionReason: reason,
      ...decisionActor,
      rejectedAt: now,
      approvedByUid: null,
      approvedByPlayerId: null,
      approvedByNameSnapshot: null,
      approvedByRole: null,
      approvedAt: null,
      updatedByUid: actor.uid,
      updatedAt: now,
    };
    const matchupUpdate = {
      [`${side}LineupStatus`]: nextStatus,
      lineupApprovalStatus: approvalStatus,
      bothLineupsSubmitted: ["awaitingApproval", "fullyApproved"].includes(approvalStatus),
      lineupsPublished: approvalStatus === "fullyApproved",
      lineupsPublishedAt: approvalStatus === "fullyApproved" ? now : null,
      fullyApprovedAt: approvalStatus === "fullyApproved" ? now : null,
      lineupWorkflowActorUid: actor.uid,
      lineupWorkflowOperationId: opId,
      updatedAt: now,
    };
    if (decision === "approve") {
      Object.assign(matchupUpdate, {
        [`${side}LineupTracking.approvedByUid`]: actor.uid,
        [`${side}LineupTracking.approvedByPlayerId`]: actor.playerId,
        [`${side}LineupTracking.approvedByNameSnapshot`]: actor.name,
        [`${side}LineupTracking.approvedByRole`]: actor.role,
        [`${side}LineupTracking.approvedAt`]: now,
      });
    } else {
      Object.assign(matchupUpdate, {
        [`${side}LineupTracking.approvedByUid`]: null,
        [`${side}LineupTracking.approvedByPlayerId`]: null,
        [`${side}LineupTracking.approvedByNameSnapshot`]: null,
        [`${side}LineupTracking.approvedByRole`]: null,
        [`${side}LineupTracking.approvedAt`]: null,
      });
    }
    transaction.update(targetSnapshot.ref, targetUpdate);
    transaction.update(matchupRef, matchupUpdate);

    if (approvalStatus === "fullyApproved") {
      for (let index = 0; index < lineTargets.length; index += 1) {
        const homeLine = home.lines[index];
        const awayLine = away.lines[index];
        const {lineMatchId, lineRef, existing} = lineTargets[index];
        const lineData = {
          lineMatchId,
          lineupId: lineMatchId,
          seasonId,
          matchupId,
          lineNumber: index + 1,
          homeTeamId: matchup.homeTeamId,
          awayTeamId: matchup.awayTeamId,
          homePlayers: [
            {playerId: homeLine.player1Id, nameSnapshot: homeLine.player1Name, rankNumber: homeLine.player1Rank},
            {playerId: homeLine.player2Id, nameSnapshot: homeLine.player2Name, rankNumber: homeLine.player2Rank},
          ],
          awayPlayers: [
            {playerId: awayLine.player1Id, nameSnapshot: awayLine.player1Name, rankNumber: awayLine.player1Rank},
            {playerId: awayLine.player2Id, nameSnapshot: awayLine.player2Name, rankNumber: awayLine.player2Rank},
          ],
          homeSor: homeLine.sor,
          awaySor: awayLine.sor,
          homeLineupRevisionNumber: home.revisionNumber,
          awayLineupRevisionNumber: away.revisionNumber,
          lineupState: "approved",
          scoreEntryAllowed: true,
          updatedAt: now,
        };
        if (!existing.exists()) {
          Object.assign(lineData, {
            scheduleStatus: "toBeScheduled",
            scoreStatus: "pending",
            homePoints: 0,
            awayPoints: 0,
            sets: [],
            createdAt: now,
          });
        }
        transaction.set(lineRef, lineData, {merge: true});
      }
    }
    const selfApproved = decision === "approve" && target.submittedByUid === actor.uid;
    const result = {seasonId, matchupId, teamId, side, status: nextStatus, lineupApprovalStatus: approvalStatus, selfApproved};
    transaction.set(actionRef, {
      action: decision === "approve" ? "approved" : previousStatus === "approved" ? "approvalReopened" : "rejected",
      seasonId,
      matchupId,
      teamId,
      side,
      lineupRevisionNumber: target.revisionNumber,
      reason: reason || null,
      ...actorSnapshot(actor, "acted"),
      actedAt: now,
      previousStatus,
      newStatus: nextStatus,
      selfApproved,
      operationId: opId,
      result,
    });
    return result;
  });
}

export async function resetApprovedLineups(payload) {
  const seasonId = requiredId(payload?.seasonId, "Season ID");
  const matchupId = requiredId(payload?.matchupId, "Matchup ID");
  const reason = requiredText(payload?.reason, "Reset reason");
  const confirmation = requiredText(payload?.confirmation, "Matchup confirmation", 120);
  if (confirmation !== matchupId) throw new Error("Type the exact Matchup ID to confirm the reset.");
  const opId = operationId(payload?.operationId);
  const actor = await actorFor(seasonId);
  assertCanReview(actor);
  const matchupRef = doc(db, "seasons", seasonId, "matchups", matchupId);
  const actionRef = doc(matchupRef, "lineupReviews", opId);
  const discoveredLines = await getDocs(collection(matchupRef, "lineMatches"));
  const lineIds = [...new Set([
    ...Array.from({length: 5}, (_, index) => `${matchupId}-L${index + 1}`),
    ...discoveredLines.docs.map((item) => item.id),
  ])];

  return runTransaction(db, async (transaction) => {
    const [priorAction, matchupSnapshot] = await Promise.all([
      transaction.get(actionRef),
      transaction.get(matchupRef),
    ]);
    if (priorAction.exists() && priorAction.data().result) return priorAction.data().result;
    if (!matchupSnapshot.exists()) throw new Error("Matchup was not found.");
    const matchup = matchupSnapshot.data();
    if (matchup.lineupApprovalStatus !== "fullyApproved" &&
        !(normalizeTeamStatus(matchup.homeLineupStatus) === "approved" &&
          normalizeTeamStatus(matchup.awayLineupStatus) === "approved")) {
      throw new Error("Only a fully approved matchup can be reset.");
    }
    const homeRef = doc(matchupRef, "lineups", matchup.homeTeamId);
    const awayRef = doc(matchupRef, "lineups", matchup.awayTeamId);
    const lineRefs = lineIds.map((lineId) => doc(matchupRef, "lineMatches", lineId));
    const [homeSnapshot, awaySnapshot, ...lineSnapshots] = await Promise.all([
      transaction.get(homeRef),
      transaction.get(awayRef),
      ...lineRefs.map((lineRef) => transaction.get(lineRef)),
    ]);
    if (!homeSnapshot.exists() || !awaySnapshot.exists()) throw new Error("Both approved lineup records are required.");
    const blocked = lineSnapshots.find((item) => item.exists() && hasScoreActivity(item.data()));
    if (blocked) throw new Error(`${blocked.id} has score activity, so this matchup cannot be reset.`);
    const now = serverTimestamp();
    const previousCycle = Number(matchup.approvalCycleNumber || 1);
    const nextCycle = previousCycle + 1;
    transaction.delete(homeRef);
    transaction.delete(awayRef);
    transaction.update(matchupRef, {
      homeLineupStatus: "pendingSubmission",
      awayLineupStatus: "pendingSubmission",
      lineupApprovalStatus: "awaitingSubmission",
      bothLineupsSubmitted: false,
      lineupsPublished: false,
      lineupsPublishedAt: null,
      fullyApprovedAt: null,
      approvalCycleNumber: nextCycle,
      lastLineupReset: {
        target: "both",
        reason,
        resetByUid: actor.uid,
        resetByPlayerId: actor.playerId,
        resetByNameSnapshot: actor.name,
        resetByRole: actor.role,
        resetAt: now,
      },
      lineupWorkflowActorUid: actor.uid,
      lineupWorkflowOperationId: opId,
      updatedAt: now,
    });
    lineSnapshots.forEach((lineSnapshot, index) => {
      if (!lineSnapshot.exists()) return;
      transaction.update(lineRefs[index], {
        lineupState: "awaitingReapproval",
        scoreEntryAllowed: false,
        updatedAt: now,
      });
    });
    const result = {
      seasonId,
      matchupId,
      homeTeamId: matchup.homeTeamId,
      awayTeamId: matchup.awayTeamId,
      homeLineupStatus: "pendingSubmission",
      awayLineupStatus: "pendingSubmission",
      lineupApprovalStatus: "awaitingSubmission",
      approvalCycleNumber: nextCycle,
    };
    transaction.set(actionRef, {
      action: "resetBothApprovedLineups",
      seasonId,
      weekId: matchup.weekId || null,
      matchupId,
      homeTeamId: matchup.homeTeamId,
      awayTeamId: matchup.awayTeamId,
      homeRevisionNumber: homeSnapshot.data().revisionNumber,
      awayRevisionNumber: awaySnapshot.data().revisionNumber,
      reason,
      ...actorSnapshot(actor, "acted"),
      actedAt: now,
      previousStatus: "fullyApproved",
      newStatus: "awaitingSubmission",
      previousApprovalCycleNumber: previousCycle,
      approvalCycleNumber: nextCycle,
      operationId: opId,
      result,
    });
    return result;
  });
}

export async function listLineupWorkflowSeasons() {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in is required.");
  const [userSnapshot, controlSnapshot] = await Promise.all([
    getDoc(doc(db, "users", user.uid)),
    getDoc(doc(db, "systemConfig", "seasonControl")),
  ]);
  const userRecord = userSnapshot.data() || {};
  const superAdmin = userRecord.globalRoles?.includes("superAdmin") ||
    user.email?.toLowerCase() === SUPER_ADMIN_EMAIL;
  if (userRecord.status !== "active" && !superAdmin) throw new Error("Your AlphaOpen account is not active.");
  const activeSeasonId = controlSnapshot.data()?.activeSeasonId || null;
  const seasonRefs = new Map();
  if (superAdmin) {
    const seasonsSnapshot = await getDocs(collection(db, "seasons"));
    seasonsSnapshot.docs.forEach((item) => seasonRefs.set(item.id, item.ref));
  } else {
    const assignments = await getDocs(query(
      collectionGroup(db, "approverAssignments"),
      where("approverUid", "==", user.uid),
    ));
    assignments.docs
      .filter((item) => item.data().status === "active")
      .forEach((item) => {
        const seasonRef = item.ref.parent.parent;
        if (seasonRef) seasonRefs.set(seasonRef.id, seasonRef);
      });
    if (activeSeasonId) seasonRefs.set(activeSeasonId, doc(db, "seasons", activeSeasonId));
  }
  const snapshots = await Promise.all([...seasonRefs.values()].map((seasonRef) => getDoc(seasonRef)));
  const seasons = snapshots
    .filter((item) => item.exists())
    .map((item) => ({
      seasonId: item.id,
      name: item.data().name || item.id,
      status: item.data().status || null,
      isCurrent: item.id === activeSeasonId,
    }))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.seasonId.localeCompare(a.seasonId));
  return {activeSeasonId, seasons};
}
