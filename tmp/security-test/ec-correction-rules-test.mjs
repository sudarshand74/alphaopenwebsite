import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {initializeTestEnvironment} from "@firebase/rules-unit-testing";
import {doc, getDoc, serverTimestamp, setDoc, writeBatch} from "firebase/firestore";

const projectId = "alphaopen-ec-correction";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.resolve(scriptDir, "../../firestore.rules"), "utf8");
const env = await initializeTestEnvironment({
  projectId,
  firestore: {rules, host: "127.0.0.1", port: 8080},
});

const seasonId = "S1";
const matchupId = "M1";
const lineMatchId = "M1-L1";
const ecUid = "ec-user";
const captainUid = "captain-user";
const linePath = ["seasons", seasonId, "matchups", matchupId, "lineMatches", lineMatchId];

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, "users", ecUid), {status: "active", globalRoles: [], playerId: "P20"});
  await setDoc(doc(db, "users", captainUid), {status: "active", globalRoles: [], playerId: "P1"});
  await setDoc(doc(db, "seasons", seasonId), {name: "Test Season", status: "active", linesPerMatchup: 5});
  await setDoc(doc(db, "seasons", seasonId, "members", ecUid), {
    status: "active", roles: ["ec"], teamIds: [], playerId: "P20",
  });
  await setDoc(doc(db, "seasons", seasonId, "members", captainUid), {
    status: "active", roles: ["captain"], teamIds: ["HOME"], playerId: "P1",
  });
  await setDoc(doc(db, "seasons", seasonId, "matchups", matchupId), {
    matchupId,
    homeTeamId: "HOME",
    awayTeamId: "AWAY",
    status: "inProgress",
    homeTeamPoints: 14,
    awayTeamPoints: 7,
    completedLineCount: 1,
    canceledLineCount: 0,
  });
  await setDoc(doc(db, ...linePath), {
    lineMatchId,
    lineupState: "approved",
    scoreEntryAllowed: true,
    homePlayers: [{playerId: "P1"}, {playerId: "P2"}],
    awayPlayers: [{playerId: "P3"}, {playerId: "P4"}],
    homeSor: 3,
    awaySor: 7,
    sets: [{home: 6, away: 4}, {home: 6, away: 3}],
    scheduleStatus: "completed",
    scoreStatus: "published",
    homePoints: 14,
    awayPoints: 7,
    winnerTeamId: "HOME",
  });
});

const ecDb = env.authenticatedContext(ecUid, {
  email: "ec@example.com", email_verified: true,
}).firestore();
const captainDb = env.authenticatedContext(captainUid, {
  email: "captain@example.com", email_verified: true,
}).firestore();

const correctionId = "correction-1";
const ecBatch = writeBatch(ecDb);
ecBatch.update(doc(ecDb, ...linePath), {
  homePlayers: [{playerId: "P5"}, {playerId: "P2"}],
  homeSor: 7,
  sets: [{home: 4, away: 6}, {home: 3, away: 6}],
  homePoints: 7,
  awayPoints: 14,
  winnerTeamId: "AWAY",
  lastCorrectionId: correctionId,
  lastCorrectionAt: serverTimestamp(),
  lastCorrectionByUid: ecUid,
  lastCorrectionByNameSnapshot: "EC User",
  lastCorrectionReason: "Corrected player and reversed score",
  updatedAt: serverTimestamp(),
});
ecBatch.update(doc(ecDb, "seasons", seasonId, "matchups", matchupId), {
  homeTeamPoints: 7,
  awayTeamPoints: 14,
  completedLineCount: 1,
  canceledLineCount: 0,
  status: "inProgress",
  winnerTeamId: null,
  lastCorrectionId: correctionId,
  lastCorrectionAt: serverTimestamp(),
  lastCorrectionByUid: ecUid,
  updatedAt: serverTimestamp(),
});
ecBatch.set(doc(ecDb, ...linePath, "corrections", correctionId), {
  correctionId,
  seasonId,
  matchupId,
  lineMatchId,
  reason: "Corrected player and reversed score",
  correctedByUid: ecUid,
  correctedAt: serverTimestamp(),
});
await ecBatch.commit();

let captainPlayerCorrectionDenied = false;
try {
  await setDoc(doc(captainDb, ...linePath), {
    homePlayers: [{playerId: "P9"}, {playerId: "P2"}],
    lastCorrectionId: "captain-correction",
    lastCorrectionAt: serverTimestamp(),
    lastCorrectionByUid: captainUid,
    lastCorrectionByNameSnapshot: "Captain",
    lastCorrectionReason: "Unauthorized player change",
    updatedAt: serverTimestamp(),
  }, {merge: true});
} catch {
  captainPlayerCorrectionDenied = true;
}
if (!captainPlayerCorrectionDenied) throw new Error("Captain was incorrectly allowed to correct completed players.");

let captainScoreCorrectionDenied = false;
try {
  await setDoc(doc(captainDb, ...linePath), {
    sets: [{home: 6, away: 0}, {home: 6, away: 0}],
    homePoints: 14,
    awayPoints: 2,
    winnerTeamId: "HOME",
    updatedAt: serverTimestamp(),
  }, {merge: true});
} catch {
  captainScoreCorrectionDenied = true;
}
if (!captainScoreCorrectionDenied) throw new Error("Captain was incorrectly allowed to correct a completed score.");

await setDoc(doc(ecDb, "publicConfig", "activeSeasonDashboard"), {
  seasonId,
  status: "active",
  updatedAt: serverTimestamp(),
});
await setDoc(doc(ecDb, "seasons", seasonId, "matchups", matchupId), {
  homeTeamPoints: 7,
  awayTeamPoints: 14,
  completedLineCount: 1,
  canceledLineCount: 0,
  status: "inProgress",
  winnerTeamId: null,
  standingsApplied: false,
  derivedRecordsUpdatedAt: serverTimestamp(),
  derivedRecordsUpdatedByUid: ecUid,
  updatedAt: serverTimestamp(),
}, {merge: true});
await setDoc(doc(ecDb, "seasons", seasonId, "standings", "HOME"), {
  teamId: "HOME",
  completedMatchups: 0,
  completedLines: 1,
  lineWins: 0,
  lineLosses: 1,
  matchPoints: 7,
  bonusPoints: 0,
  penaltyPoints: 0,
  adjustedTotal: 7,
  playoffPosition: 2,
  qualified: true,
  calculatedAt: serverTimestamp(),
  calculatedByUid: ecUid,
  sourceVersion: 1,
});

let captainStandingsWriteDenied = false;
try {
  await setDoc(doc(captainDb, "seasons", seasonId, "standings", "HOME"), {
    adjustedTotal: 999,
    calculatedByUid: captainUid,
  }, {merge: true});
} catch {
  captainStandingsWriteDenied = true;
}
if (!captainStandingsWriteDenied) throw new Error("Captain was incorrectly allowed to write standings.");

let arbitraryEcStandingsFieldDenied = false;
try {
  await setDoc(doc(ecDb, "seasons", seasonId, "standings", "HOME"), {
    unauthorizedField: true,
    calculatedByUid: ecUid,
  }, {merge: true});
} catch {
  arbitraryEcStandingsFieldDenied = true;
}
if (!arbitraryEcStandingsFieldDenied) throw new Error("EC was incorrectly allowed to write an arbitrary standings field.");

const correctedLine = await getDoc(doc(ecDb, ...linePath));
const correctionAudit = await getDoc(doc(ecDb, ...linePath, "corrections", correctionId));
if (correctedLine.data().winnerTeamId !== "AWAY") throw new Error("EC winner correction did not persist.");
if (!correctionAudit.exists()) throw new Error("EC correction audit was not created.");

let correctionAuditUpdateDenied = false;
try {
  await setDoc(doc(ecDb, ...linePath, "corrections", correctionId), {
    reason: "Attempted audit rewrite",
  }, {merge: true});
} catch {
  correctionAuditUpdateDenied = true;
}
if (!correctionAuditUpdateDenied) throw new Error("A correction audit was incorrectly mutable.");

console.log(JSON.stringify({
  ecCorrectionAllowed: true,
  captainPlayerCorrectionDenied,
  captainScoreCorrectionDenied,
  correctedWinnerTeamId: correctedLine.data().winnerTeamId,
  auditCreated: correctionAudit.exists(),
  correctionAuditUpdateDenied,
  publicProjectionWriteAllowed: true,
  derivedMatchupWriteAllowed: true,
  standingsWriteAllowed: true,
  captainStandingsWriteDenied,
  arbitraryEcStandingsFieldDenied,
}, null, 2));

await env.cleanup();
