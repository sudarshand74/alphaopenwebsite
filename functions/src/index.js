import {initializeApp} from "firebase-admin/app";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {setGlobalOptions} from "firebase-functions/v2/options";
import {
  deriveLineupApprovalStatus,
  hasScoreActivity,
  normalizeTeamStatus,
  validateLineupShape,
} from "./workflow.js";

initializeApp();
setGlobalOptions({region: "us-east1", maxInstances: 10});

const db = getFirestore();
const SUPER_ADMIN_EMAIL = "sudarshandesai74@gmail.com";
const callableOptions = {
  cors: [
    "https://alphaopen-development-2026.web.app",
    "https://alphaopen-development-2026.firebaseapp.com",
    "https://alphaopen-test-system.web.app",
    "https://alphaopen-test-system.firebaseapp.com",
    "https://alphaopen-production.web.app",
    "https://alphaopen-production.firebaseapp.com",
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  ],
  enforceAppCheck: false,
};

function requiredId(value, label) {
  const result = String(value || "").trim();
  if (!result || result.length > 120 || result.includes("/")) {
    throw new HttpsError("invalid-argument", `${label} is invalid.`);
  }
  return result;
}

function requiredText(value, label, maxLength = 1000) {
  const result = String(value || "").trim();
  if (!result || result.length > maxLength) {
    throw new HttpsError("invalid-argument", `${label} is required and must be ${maxLength} characters or fewer.`);
  }
  return result;
}

function operationId(value) {
  const result = requiredId(value, "Operation ID");
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(result)) {
    throw new HttpsError("invalid-argument", "Operation ID contains unsupported characters.");
  }
  return result;
}

function assertAuthenticated(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in is required.");
}

async function actorFor(request, seasonId) {
  assertAuthenticated(request);
  const uid = request.auth.uid;
  const [userSnapshot, memberSnapshot, approverSnapshot, legacyApproverSnapshot] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`seasons/${seasonId}/members/${uid}`).get(),
    db.doc(`seasons/${seasonId}/approverAssignments/${uid}`).get(),
    db.doc(`seasons/${seasonId}/approverAssignments/season_${uid}`).get(),
  ]);
  const user = userSnapshot.data() || {};
  const member = memberSnapshot.data() || {};
  const approver = approverSnapshot.exists ? approverSnapshot.data() : legacyApproverSnapshot.data() || {};
  const email = String(request.auth.token.email || user.email || "").toLowerCase();
  const globalRoles = Array.isArray(user.globalRoles) ? user.globalRoles : [];
  const seasonRoles = Array.isArray(member.roles) ? member.roles : [];
  const superAdmin = request.auth.token.superAdmin === true ||
    globalRoles.includes("superAdmin") ||
    email === SUPER_ADMIN_EMAIL;
  const activeUser = user.status === "active" || superAdmin;
  if (!activeUser) throw new HttpsError("permission-denied", "Your AlphaOpen account is not active.");
  const activeMember = member.status === "active";
  const neutralApprover = approver.status === "active" && approver.approverUid === uid;
  const ec = activeMember && seasonRoles.includes("ec");
  const captain = activeMember && seasonRoles.includes("captain");
  const role = superAdmin ? "superAdmin" : neutralApprover ? "neutralApprover" : ec ? "ec" : captain ? "captain" : "player";
  return {
    uid,
    playerId: user.playerId || member.playerId || null,
    name: user.displayName || request.auth.token.name || request.auth.token.email || uid,
    role,
    superAdmin,
    neutralApprover,
    ec,
    captain,
    teamIds: Array.isArray(member.teamIds) ? member.teamIds : [],
  };
}

function actorSnapshot(actor, prefix) {
  return {
    [`${prefix}ByUid`]: actor.uid,
    [`${prefix}ByPlayerId`]: actor.playerId,
    [`${prefix}ByNameSnapshot`]: actor.name,
    [`${prefix}ByRole`]: actor.role,
  };
}

function assertCanSubmit(actor, teamId) {
  if (actor.superAdmin || actor.neutralApprover || actor.ec) return;
  if (actor.captain && actor.teamIds.includes(teamId)) return;
  throw new HttpsError("permission-denied", "You are not authorized to submit this team's lineup.");
}

function assertCanReview(actor) {
  if (actor.superAdmin || actor.neutralApprover) return;
  throw new HttpsError("permission-denied", "Only an active Neutral Approver or Super Admin can make lineup decisions.");
}

function matchupSide(matchup, teamId) {
  if (matchup.homeTeamId === teamId) return "home";
  if (matchup.awayTeamId === teamId) return "away";
  throw new HttpsError("invalid-argument", "The selected team is not part of this matchup.");
}

function reviewResult(snapshot) {
  return snapshot.exists && snapshot.data().result ? snapshot.data().result : null;
}

function validationPayload(ruleVersionId) {
  return {
    passed: true,
    errors: [],
    checkedAt: FieldValue.serverTimestamp(),
    checkedBy: "backend",
    ruleVersionId,
  };
}

export const listLineupWorkflowSeasons = onCall(callableOptions, async (request) => {
  assertAuthenticated(request);
  const uid = request.auth.uid;
  const [userSnapshot, seasonControlSnapshot, seasonsSnapshot] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc("systemConfig/seasonControl").get(),
    db.collection("seasons").get(),
  ]);
  const user = userSnapshot.data() || {};
  const email = String(request.auth.token.email || user.email || "").toLowerCase();
  const superAdmin = request.auth.token.superAdmin === true ||
    (Array.isArray(user.globalRoles) && user.globalRoles.includes("superAdmin")) ||
    email === SUPER_ADMIN_EMAIL;
  if (user.status !== "active" && !superAdmin) {
    throw new HttpsError("permission-denied", "Your AlphaOpen account is not active.");
  }
  const activeSeasonId = seasonControlSnapshot.data()?.activeSeasonId || null;
  const rows = [];
  for (const seasonSnapshot of seasonsSnapshot.docs) {
    let allowed = superAdmin;
    if (!allowed) {
      const [direct, legacy] = await Promise.all([
        seasonSnapshot.ref.collection("approverAssignments").doc(uid).get(),
        seasonSnapshot.ref.collection("approverAssignments").doc(`season_${uid}`).get(),
      ]);
      const assignment = direct.exists ? direct.data() : legacy.data() || {};
      allowed = assignment.status === "active" && assignment.approverUid === uid;
    }
    if (allowed) {
      const season = seasonSnapshot.data();
      rows.push({
        seasonId: seasonSnapshot.id,
        name: season.name || seasonSnapshot.id,
        status: season.status || null,
        isCurrent: seasonSnapshot.id === activeSeasonId,
      });
    }
  }
  rows.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.seasonId.localeCompare(a.seasonId));
  return {activeSeasonId, seasons: rows};
});

export const submitTeamLineup = onCall(callableOptions, async (request) => {
  const seasonId = requiredId(request.data?.seasonId, "Season ID");
  const matchupId = requiredId(request.data?.matchupId, "Matchup ID");
  const teamId = requiredId(request.data?.teamId, "Team ID");
  const opId = operationId(request.data?.operationId);
  const actor = await actorFor(request, seasonId);
  assertCanSubmit(actor, teamId);

  const matchupRef = db.doc(`seasons/${seasonId}/matchups/${matchupId}`);
  const lineupRef = matchupRef.collection("lineups").doc(teamId);
  const reviewRef = matchupRef.collection("lineupReviews").doc(opId);
  const rosterQuery = db.collection(`seasons/${seasonId}/rosterAssignments`).where("teamId", "==", teamId);

  return db.runTransaction(async (transaction) => {
    const [priorReview, matchupSnapshot, lineupSnapshot, rosterSnapshot] = await Promise.all([
      transaction.get(reviewRef),
      transaction.get(matchupRef),
      transaction.get(lineupRef),
      transaction.get(rosterQuery),
    ]);
    const priorResult = reviewResult(priorReview);
    if (priorResult) return priorResult;
    if (!matchupSnapshot.exists) throw new HttpsError("not-found", "Matchup was not found.");
    const matchup = matchupSnapshot.data();
    const side = matchupSide(matchup, teamId);
    const current = lineupSnapshot.data() || {};
    const currentStatus = String(current.status || "draft");
    if (["submitted", "approved", "published", "locked"].includes(currentStatus)) {
      throw new HttpsError("failed-precondition", "This lineup is sealed and cannot be replaced.");
    }
    const canonicalLines = validateLineupShape(
      request.data?.lines,
      rosterSnapshot.docs.map((docSnapshot) => docSnapshot.data()),
    );
    const lastRevision = Math.max(
      Number(current.revisionNumber || 0),
      Number(matchup[`${side}LineupRevisionNumber`] || 0),
    );
    const revisionNumber = lastRevision + 1;
    const revisionRef = lineupRef.collection("revisions").doc(String(revisionNumber));
    const now = FieldValue.serverTimestamp();
    const ruleVersionId = matchup.ruleVersionId || request.data?.ruleVersionId || "v1";
    const submitter = actorSnapshot(actor, "submitted");
    const lineupPayload = {
      seasonId,
      matchupId,
      teamId,
      status: "submitted",
      revisionNumber,
      ruleVersionId,
      lines: canonicalLines,
      validation: validationPayload(ruleVersionId),
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
    transaction.set(lineupRef, lineupPayload);
    transaction.create(revisionRef, {...lineupPayload, immutable: true});
    transaction.update(matchupRef, {
      [`${side}LineupStatus`]: "submitted",
      [`${side}LineupRevisionNumber`]: revisionNumber,
      [`${side}LineupTracking`]: tracking,
      bothLineupsSubmitted: approvalStatus === "awaitingApproval",
      lineupApprovalStatus: approvalStatus,
      lineupsPublished: false,
      updatedAt: now,
    });
    transaction.create(reviewRef, {
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
});

export const decideTeamLineup = onCall(callableOptions, async (request) => {
  const seasonId = requiredId(request.data?.seasonId, "Season ID");
  const matchupId = requiredId(request.data?.matchupId, "Matchup ID");
  const teamId = requiredId(request.data?.teamId, "Team ID");
  const decision = String(request.data?.decision || "");
  if (!["approve", "reject"].includes(decision)) {
    throw new HttpsError("invalid-argument", "Decision must be approve or reject.");
  }
  const reason = decision === "reject" ? requiredText(request.data?.reason, "Rejection reason") : String(request.data?.reason || "").trim();
  const opId = operationId(request.data?.operationId);
  const actor = await actorFor(request, seasonId);
  assertCanReview(actor);

  const matchupRef = db.doc(`seasons/${seasonId}/matchups/${matchupId}`);
  const reviewRef = matchupRef.collection("lineupReviews").doc(opId);
  return db.runTransaction(async (transaction) => {
    const [priorReview, matchupSnapshot] = await Promise.all([
      transaction.get(reviewRef),
      transaction.get(matchupRef),
    ]);
    const priorResult = reviewResult(priorReview);
    if (priorResult) return priorResult;
    if (!matchupSnapshot.exists) throw new HttpsError("not-found", "Matchup was not found.");
    const matchup = matchupSnapshot.data();
    const side = matchupSide(matchup, teamId);
    const homeRef = matchupRef.collection("lineups").doc(matchup.homeTeamId);
    const awayRef = matchupRef.collection("lineups").doc(matchup.awayTeamId);
    const [homeSnapshot, awaySnapshot] = await Promise.all([
      transaction.get(homeRef),
      transaction.get(awayRef),
    ]);
    if (!homeSnapshot.exists || !awaySnapshot.exists) {
      throw new HttpsError("failed-precondition", "Both teams must submit before an approval decision.");
    }
    const home = homeSnapshot.data();
    const away = awaySnapshot.data();
    const targetSnapshot = side === "home" ? homeSnapshot : awaySnapshot;
    const target = targetSnapshot.data();
    if (matchup.lineupApprovalStatus === "fullyApproved") {
      throw new HttpsError("failed-precondition", "Use Reset Approved Lineup after both teams are fully approved.");
    }
    if (decision === "approve" && target.status !== "submitted") {
      throw new HttpsError("failed-precondition", "Only the current submitted revision can be approved.");
    }
    if (decision === "reject" && !["submitted", "approved"].includes(target.status)) {
      throw new HttpsError("failed-precondition", "This lineup is not available to return for change.");
    }
    const now = FieldValue.serverTimestamp();
    const previousStatus = normalizeTeamStatus(target.status);
    const nextTeamStatus = decision === "approve" ? "approved" : "rejected";
    const otherSide = side === "home" ? "away" : "home";
    const otherLineup = side === "home" ? away : home;
    const otherStatus = normalizeTeamStatus(otherLineup.status);
    const homeStatus = side === "home" ? nextTeamStatus : otherStatus;
    const awayStatus = side === "away" ? nextTeamStatus : otherStatus;
    const lineupApprovalStatus = deriveLineupApprovalStatus(homeStatus, awayStatus);
    const lineTargets = [];
    if (lineupApprovalStatus === "fullyApproved") {
      for (let index = 0; index < 5; index += 1) {
        const lineMatchId = `${matchupId}-L${index + 1}`;
        const lineRef = matchupRef.collection("lineMatches").doc(lineMatchId);
        lineTargets.push({
          lineMatchId,
          lineRef,
          existing: await transaction.get(lineRef),
        });
      }
    }
    const decisionActor = actorSnapshot(actor, decision === "approve" ? "approved" : "rejected");
    const targetUpdate = decision === "approve" ? {
      status: "approved",
      ...decisionActor,
      approvedAt: now,
      rejectionReason: null,
      rejectedByUid: null,
      rejectedByPlayerId: null,
      rejectedByNameSnapshot: null,
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
      [`${side}LineupStatus`]: nextTeamStatus,
      lineupApprovalStatus,
      bothLineupsSubmitted: ["awaitingApproval", "fullyApproved"].includes(lineupApprovalStatus),
      lineupsPublished: lineupApprovalStatus === "fullyApproved",
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
    if (lineupApprovalStatus === "fullyApproved") {
      Object.assign(matchupUpdate, {
        fullyApprovedAt: now,
        lineupsPublishedAt: now,
      });
    } else {
      Object.assign(matchupUpdate, {
        fullyApprovedAt: null,
        lineupsPublishedAt: null,
      });
    }
    transaction.update(targetSnapshot.ref, targetUpdate);
    transaction.update(matchupRef, matchupUpdate);

    if (lineupApprovalStatus === "fullyApproved") {
      for (let index = 0; index < lineTargets.length; index += 1) {
        const homeLine = home.lines[index];
        const awayLine = away.lines[index];
        const lineNumber = index + 1;
        const {lineMatchId, lineRef, existing} = lineTargets[index];
        const payload = {
          lineMatchId,
          lineupId: lineMatchId,
          seasonId,
          matchupId,
          lineNumber,
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
        if (!existing.exists) {
          Object.assign(payload, {
            scheduleStatus: "toBeScheduled",
            scoreStatus: "pending",
            homePoints: 0,
            awayPoints: 0,
            sets: [],
            createdAt: now,
          });
        }
        transaction.set(lineRef, payload, {merge: true});
      }
    }

    const selfApproved = decision === "approve" && target.submittedByUid === actor.uid;
    const result = {
      seasonId,
      matchupId,
      teamId,
      side,
      status: nextTeamStatus,
      lineupApprovalStatus,
      selfApproved,
    };
    transaction.create(reviewRef, {
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
      newStatus: nextTeamStatus,
      selfApproved,
      operationId: opId,
      result,
    });
    return result;
  });
});

export const resetApprovedLineups = onCall(callableOptions, async (request) => {
  const seasonId = requiredId(request.data?.seasonId, "Season ID");
  const matchupId = requiredId(request.data?.matchupId, "Matchup ID");
  const reason = requiredText(request.data?.reason, "Reset reason");
  const confirmation = requiredText(request.data?.confirmation, "Matchup confirmation", 120);
  if (confirmation !== matchupId) throw new HttpsError("invalid-argument", "Type the exact Matchup ID to confirm the reset.");
  const opId = operationId(request.data?.operationId);
  const actor = await actorFor(request, seasonId);
  assertCanReview(actor);

  const matchupRef = db.doc(`seasons/${seasonId}/matchups/${matchupId}`);
  const reviewRef = matchupRef.collection("lineupReviews").doc(opId);
  return db.runTransaction(async (transaction) => {
    const [priorReview, matchupSnapshot] = await Promise.all([
      transaction.get(reviewRef),
      transaction.get(matchupRef),
    ]);
    const priorResult = reviewResult(priorReview);
    if (priorResult) return priorResult;
    if (!matchupSnapshot.exists) throw new HttpsError("not-found", "Matchup was not found.");
    const matchup = matchupSnapshot.data();
    if (matchup.lineupApprovalStatus !== "fullyApproved" &&
        !(normalizeTeamStatus(matchup.homeLineupStatus) === "approved" &&
          normalizeTeamStatus(matchup.awayLineupStatus) === "approved")) {
      throw new HttpsError("failed-precondition", "Only a fully approved matchup can be reset.");
    }
    const homeRef = matchupRef.collection("lineups").doc(matchup.homeTeamId);
    const awayRef = matchupRef.collection("lineups").doc(matchup.awayTeamId);
    const lineRefs = Array.from({length: 5}, (_, index) =>
      matchupRef.collection("lineMatches").doc(`${matchupId}-L${index + 1}`));
    const [homeSnapshot, awaySnapshot, ...lineSnapshots] = await Promise.all([
      transaction.get(homeRef),
      transaction.get(awayRef),
      ...lineRefs.map((ref) => transaction.get(ref)),
    ]);
    if (!homeSnapshot.exists || !awaySnapshot.exists) {
      throw new HttpsError("failed-precondition", "Both approved lineup records are required.");
    }
    const blockedLine = lineSnapshots.find((snapshot) => snapshot.exists && hasScoreActivity(snapshot.data()));
    if (blockedLine) {
      throw new HttpsError("failed-precondition", `${blockedLine.id} has score activity and prevents an approved-lineup reset.`);
    }
    const now = FieldValue.serverTimestamp();
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
      updatedAt: now,
    });
    lineRefs.forEach((lineRef, index) => {
      if (!lineSnapshots[index].exists) return;
      transaction.update(lineRef, {
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
    transaction.create(reviewRef, {
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
});
