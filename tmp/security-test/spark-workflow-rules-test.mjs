import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {initializeTestEnvironment} from "@firebase/rules-unit-testing";
import {doc, getDoc, serverTimestamp, setDoc, writeBatch} from "firebase/firestore";

const projectId = "alphaopen-spark-workflow";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.resolve(scriptDir, "../../firestore.rules"), "utf8");
const env = await initializeTestEnvironment({
  projectId,
  firestore: {rules, host: "127.0.0.1", port: 8080},
});

const seasonId = "S1";
const matchupId = "M1";
const captainUid = "captain";
const awayCaptainUid = "away-captain";
const approverUid = "approver";
const lines = Array.from({length: 5}, (_, index) => ({
  lineNumber: index + 1,
  player1Id: `P${index * 2 + 1}`,
  player2Id: `P${index * 2 + 2}`,
  player1Name: `Player ${index * 2 + 1}`,
  player2Name: `Player ${index * 2 + 2}`,
  player1Rank: index * 2 + 1,
  player2Rank: index * 2 + 2,
  sor: index * 4 + 3,
}));

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, "users", captainUid), {status: "active", globalRoles: [], displayName: "Captain", playerId: "P1"});
  await setDoc(doc(db, "users", awayCaptainUid), {status: "active", globalRoles: [], displayName: "Away Captain", playerId: "P11"});
  await setDoc(doc(db, "users", approverUid), {status: "active", globalRoles: [], displayName: "Approver", playerId: "P20"});
  await setDoc(doc(db, "seasons", seasonId), {name: "Test Season", status: "active"});
  await setDoc(doc(db, "seasons", seasonId, "members", captainUid), {
    status: "active", roles: ["captain"], teamIds: ["HOME"], playerId: "P1",
  });
  await setDoc(doc(db, "seasons", seasonId, "members", awayCaptainUid), {
    status: "active", roles: ["captain"], teamIds: ["AWAY"], playerId: "P11",
  });
  await setDoc(doc(db, "seasons", seasonId, "members", approverUid), {
    status: "active", roles: ["neutralApprover"], teamIds: [], playerId: "P20",
  });
  await setDoc(doc(db, "seasons", seasonId, "approverAssignments", approverUid), {
    approverUid, status: "active",
  });
  await setDoc(doc(db, "seasons", seasonId, "matchups", matchupId), {
    matchupId,
    homeTeamId: "HOME",
    awayTeamId: "AWAY",
    approverUids: [approverUid],
    homeLineupStatus: "pendingSubmission",
    awayLineupStatus: "pendingSubmission",
    lineupApprovalStatus: "awaitingSubmission",
    bothLineupsSubmitted: false,
    lineupsPublished: false,
    approvalCycleNumber: 1,
  });
});

const captainDb = env.authenticatedContext(captainUid, {
  email: "captain@example.com", email_verified: true,
}).firestore();
const awayCaptainDb = env.authenticatedContext(awayCaptainUid, {
  email: "away-captain@example.com", email_verified: true,
}).firestore();
const approverDb = env.authenticatedContext(approverUid, {
  email: "approver@example.com", email_verified: true,
}).firestore();
const base = ["seasons", seasonId, "matchups", matchupId];
const lineupData = (teamId, uid, revisionNumber = 1) => ({
  seasonId,
  matchupId,
  teamId,
  status: "submitted",
  revisionNumber,
  ruleVersionId: "v1",
  lines,
  validation: {passed: true},
  submittedByUid: uid,
  submittedByPlayerId: uid === captainUid ? "P1" : "P20",
  submittedByNameSnapshot: uid === captainUid ? "Captain" : "Approver",
  submittedByRole: uid === captainUid ? "captain" : "neutralApprover",
  submittedAt: serverTimestamp(),
  approvedByUid: null,
  approvedAt: null,
  rejectionReason: null,
  rejectedByUid: null,
  rejectedAt: null,
  updatedByUid: uid,
  updatedAt: serverTimestamp(),
});

async function submit(db, teamId, side, uid, operationId) {
  const batch = writeBatch(db);
  const lineupRef = doc(db, ...base, "lineups", teamId);
  const data = lineupData(teamId, uid);
  batch.set(lineupRef, data);
  batch.set(doc(lineupRef, "revisions", "1"), {...data, immutable: true});
  batch.update(doc(db, ...base), {
    [`${side}LineupStatus`]: "submitted",
    [`${side}LineupRevisionNumber`]: 1,
    [`${side}LineupTracking`]: {revisionNumber: 1, submittedByUid: uid},
    lineupApprovalStatus: side === "away" ? "awaitingApproval" : "awaitingSubmission",
    bothLineupsSubmitted: side === "away",
    lineupsPublished: false,
    lineupsPublishedAt: null,
    fullyApprovedAt: null,
    lineupWorkflowActorUid: uid,
    lineupWorkflowOperationId: operationId,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, ...base, "lineupReviews", operationId), {
    action: "submitted",
    operationId,
    teamId,
    actedByUid: uid,
    actedAt: serverTimestamp(),
  });
  await batch.commit();
}

await submit(captainDb, "HOME", "home", captainUid, "submit_home_1");

let captainApprovalDenied = false;
try {
  const batch = writeBatch(captainDb);
  batch.update(doc(captainDb, ...base, "lineups", "HOME"), {
    status: "approved", approvedByUid: captainUid, updatedByUid: captainUid,
  });
  await batch.commit();
} catch {
  captainApprovalDenied = true;
}
if (!captainApprovalDenied) throw new Error("Captain was incorrectly allowed to approve a lineup.");

async function approveHome() {
  const batch = writeBatch(approverDb);
  batch.update(doc(approverDb, ...base, "lineups", "HOME"), {
    status: "approved",
    approvedByUid: approverUid,
    approvedByPlayerId: "P20",
    approvedByNameSnapshot: "Approver",
    approvedByRole: "neutralApprover",
    approvedAt: serverTimestamp(),
    updatedByUid: approverUid,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(approverDb, ...base), {
    homeLineupStatus: "approved",
    lineupApprovalStatus: "awaitingSubmission",
    bothLineupsSubmitted: false,
    lineupsPublished: false,
    lineupsPublishedAt: null,
    fullyApprovedAt: null,
    "homeLineupTracking.approvedByUid": approverUid,
    "homeLineupTracking.approvedByPlayerId": "P20",
    "homeLineupTracking.approvedByNameSnapshot": "Approver",
    "homeLineupTracking.approvedByRole": "neutralApprover",
    "homeLineupTracking.approvedAt": serverTimestamp(),
    lineupWorkflowActorUid: approverUid,
    lineupWorkflowOperationId: "approve_home_1",
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(approverDb, ...base, "lineupReviews", "approve_home_1"), {
    action: "approved", operationId: "approve_home_1", teamId: "HOME",
    actedByUid: approverUid, actedAt: serverTimestamp(),
  });
  await batch.commit();
}
await approveHome();
let approverSubmissionDenied = false;
try {
  await submit(approverDb, "AWAY", "away", approverUid, "submit_away_denied");
} catch {
  approverSubmissionDenied = true;
}
if (!approverSubmissionDenied) throw new Error("Neutral Approver was incorrectly allowed to submit a lineup.");
await submit(awayCaptainDb, "AWAY", "away", awayCaptainUid, "submit_away_1");

async function fullyApproveAway() {
  const batch = writeBatch(approverDb);
  batch.update(doc(approverDb, ...base, "lineups", "AWAY"), {
    status: "approved",
    approvedByUid: approverUid,
    approvedByPlayerId: "P20",
    approvedByNameSnapshot: "Approver",
    approvedByRole: "neutralApprover",
    approvedAt: serverTimestamp(),
    updatedByUid: approverUid,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(approverDb, ...base), {
    awayLineupStatus: "approved",
    lineupApprovalStatus: "fullyApproved",
    bothLineupsSubmitted: true,
    lineupsPublished: true,
    lineupsPublishedAt: serverTimestamp(),
    fullyApprovedAt: serverTimestamp(),
    "awayLineupTracking.approvedByUid": approverUid,
    "awayLineupTracking.approvedByPlayerId": "P20",
    "awayLineupTracking.approvedByNameSnapshot": "Approver",
    "awayLineupTracking.approvedByRole": "neutralApprover",
    "awayLineupTracking.approvedAt": serverTimestamp(),
    lineupWorkflowActorUid: approverUid,
    lineupWorkflowOperationId: "approve_away_1",
    updatedAt: serverTimestamp(),
  });
  for (let index = 0; index < 5; index += 1) {
    const lineMatchId = `${matchupId}-L${index + 1}`;
    batch.set(doc(approverDb, ...base, "lineMatches", lineMatchId), {
      lineMatchId,
      lineupState: "approved",
      scoreEntryAllowed: true,
      scheduleStatus: "toBeScheduled",
      scoreStatus: "pending",
    });
  }
  batch.set(doc(approverDb, ...base, "lineupReviews", "approve_away_1"), {
    action: "approved", operationId: "approve_away_1", teamId: "AWAY",
    actedByUid: approverUid, actedAt: serverTimestamp(),
  });
  await batch.commit();
}
await fullyApproveAway();

const matchup = await getDoc(doc(approverDb, ...base));
if (matchup.data().lineupApprovalStatus !== "fullyApproved") throw new Error("Matchup was not fully approved.");

const resetBatch = writeBatch(approverDb);
resetBatch.delete(doc(approverDb, ...base, "lineups", "HOME"));
resetBatch.delete(doc(approverDb, ...base, "lineups", "AWAY"));
resetBatch.update(doc(approverDb, ...base), {
  homeLineupStatus: "pendingSubmission",
  awayLineupStatus: "pendingSubmission",
  lineupApprovalStatus: "awaitingSubmission",
  bothLineupsSubmitted: false,
  lineupsPublished: false,
  lineupsPublishedAt: null,
  fullyApprovedAt: null,
  approvalCycleNumber: 2,
  lastLineupReset: {reason: "Availability changed", resetByUid: approverUid},
  lineupWorkflowActorUid: approverUid,
  lineupWorkflowOperationId: "reset_both_1",
  updatedAt: serverTimestamp(),
});
for (let index = 0; index < 5; index += 1) {
  resetBatch.update(doc(approverDb, ...base, "lineMatches", `${matchupId}-L${index + 1}`), {
    lineupState: "awaitingReapproval",
    scoreEntryAllowed: false,
    updatedAt: serverTimestamp(),
  });
}
resetBatch.set(doc(approverDb, ...base, "lineupReviews", "reset_both_1"), {
  action: "resetBothApprovedLineups",
  operationId: "reset_both_1",
  actedByUid: approverUid,
  actedAt: serverTimestamp(),
});
await resetBatch.commit();
const resetMatchup = await getDoc(doc(approverDb, ...base));

console.log(JSON.stringify({
  captainApprovalDenied,
  approverSubmissionDenied,
  homeStatus: matchup.data().homeLineupStatus,
  awayStatus: matchup.data().awayLineupStatus,
  matchupStatus: matchup.data().lineupApprovalStatus,
  resetStatus: resetMatchup.data().lineupApprovalStatus,
}, null, 2));
await env.cleanup();
