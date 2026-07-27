import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const projectId = "alphaopen-security-audit";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.resolve(scriptDir, "../../firestore.rules"), "utf8");
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules, host: "127.0.0.1", port: 8080 },
});

const uids = {
  player: "player-uid",
  captain: "captain-uid",
  ec: "ec-uid",
  neutral: "neutral-uid",
  superAdmin: "admin-uid",
};
const seasonId = "AO-TEST-2026";
const matchupId = "M1";

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  const users = [
    [uids.player, ["player"]],
    [uids.captain, ["captain"]],
    [uids.ec, ["ec"]],
    [uids.neutral, ["neutralApprover"]],
    [uids.superAdmin, []],
  ];
  for (const [uid] of users) {
    await setDoc(doc(db, "users", uid), {
      uid,
      email: `${uid}@example.com`,
      status: "active",
      globalRoles: uid === uids.superAdmin ? ["superAdmin"] : [],
    });
  }
  await setDoc(doc(db, "seasons", seasonId), { seasonId, status: "active" });
  for (const [uid, roles] of users.slice(0, 4)) {
    await setDoc(doc(db, "seasons", seasonId, "members", uid), {
      uid,
      status: "active",
      roles,
      teamIds: uid === uids.captain ? ["TEAM-A"] : [],
    });
  }
  await setDoc(doc(db, "seasons", seasonId, "approverAssignments", uids.neutral), {
    approverUid: uids.neutral,
    status: "active",
  });
  await setDoc(doc(db, "seasons", seasonId, "matchups", matchupId), {
    matchupId,
    homeTeamId: "TEAM-A",
    awayTeamId: "TEAM-B",
    approverUids: [uids.neutral],
    bothLineupsSubmitted: true,
    lineupsPublished: false,
    homeLineupStatus: "submitted",
    awayLineupStatus: "submitted",
    status: "readyForApproval",
  });
  await setDoc(doc(db, "seasons", seasonId, "matchups", matchupId, "lineups", "TEAM-A"), {
    teamId: "TEAM-A",
    status: "rejected",
    revisionNumber: 1,
  });
  await setDoc(doc(db, "seasons", seasonId, "matchups", matchupId, "lineups", "TEAM-B"), {
    teamId: "TEAM-B",
    status: "submitted",
    revisionNumber: 1,
  });
  await setDoc(doc(db, "seasons", seasonId, "matchups", matchupId, "lineMatches", "L1"), {
    lineMatchId: "L1",
    homeTeamId: "TEAM-A",
    awayTeamId: "TEAM-B",
    scheduleStatus: "toBeScheduled",
    scoreStatus: "notSubmitted",
  });
  await setDoc(doc(db, "aoContent", "history"), { status: "active", title: "History" });
});

const auth = {
  guest: env.unauthenticatedContext().firestore(),
  player: env.authenticatedContext(uids.player, { email: "player@example.com", email_verified: true }).firestore(),
  captain: env.authenticatedContext(uids.captain, { email: "captain@example.com", email_verified: true }).firestore(),
  ec: env.authenticatedContext(uids.ec, { email: "ec@example.com", email_verified: true }).firestore(),
  neutral: env.authenticatedContext(uids.neutral, { email: "neutral@example.com", email_verified: true }).firestore(),
  superAdmin: env.authenticatedContext(uids.superAdmin, { email: "admin@example.com", email_verified: true }).firestore(),
};

const results = [];
async function check(persona, action, expected, operation) {
  let actual = "DENY";
  let detail = "";
  try {
    await operation();
    actual = "ALLOW";
  } catch (error) {
    detail = String(error?.code || error?.message || error).slice(0, 120);
  }
  results.push({ persona, action, expected, actual, pass: expected === actual, detail });
}

await check("guest", "Read private operational season", "DENY", () =>
  getDoc(doc(auth.guest, "seasons", seasonId)));
for (const persona of ["player", "captain", "ec", "neutral", "superAdmin"]) {
  await check(persona, "Read private operational season", "ALLOW", () =>
    getDoc(doc(auth[persona], "seasons", seasonId)));
}

await check("captain", "Resubmit rejected own-team lineup", "ALLOW", () =>
  updateDoc(doc(auth.captain, "seasons", seasonId, "matchups", matchupId, "lineups", "TEAM-A"), {
    status: "draft",
  }));
await env.withSecurityRulesDisabled(async (context) => {
  await updateDoc(doc(context.firestore(), "seasons", seasonId, "matchups", matchupId, "lineups", "TEAM-A"), {
    status: "rejected",
  });
});
await check("neutral", "Submit/edit lineup", "DENY", () =>
  updateDoc(doc(auth.neutral, "seasons", seasonId, "matchups", matchupId, "lineups", "TEAM-A"), {
    status: "draft",
  }));

await check("neutral", "Reject submitted lineup", "ALLOW", () =>
  updateDoc(doc(auth.neutral, "seasons", seasonId, "matchups", matchupId, "lineups", "TEAM-B"), {
    status: "rejected",
    rejectionReason: "Security test",
    rejectedByUid: uids.neutral,
    rejectedAt: new Date(),
  }));
await env.withSecurityRulesDisabled(async (context) => {
  await updateDoc(doc(context.firestore(), "seasons", seasonId, "matchups", matchupId, "lineups", "TEAM-B"), {
    status: "submitted",
  });
});
await check("ec", "Reject lineup without Neutral Approver assignment", "DENY", () =>
  updateDoc(doc(auth.ec, "seasons", seasonId, "matchups", matchupId, "lineups", "TEAM-B"), {
    status: "rejected",
    rejectionReason: "EC-only security test",
    rejectedByUid: uids.ec,
    rejectedAt: new Date(),
  }));
await check("superAdmin", "Reject lineup as Super Admin", "ALLOW", () =>
  updateDoc(doc(auth.superAdmin, "seasons", seasonId, "matchups", matchupId, "lineups", "TEAM-B"), {
    status: "rejected",
    rejectionReason: "Admin security test",
    rejectedByUid: uids.superAdmin,
    rejectedAt: new Date(),
  }));

for (const persona of ["player", "captain", "neutral"]) {
  await check(persona, "Manage team roster", "DENY", () =>
    setDoc(doc(auth[persona], "seasons", seasonId, "rosterSlots", `${persona}-slot`), {
      teamId: "TEAM-A",
      rank: 1,
    }));
}
for (const persona of ["ec", "superAdmin"]) {
  await check(persona, "Manage team roster", "ALLOW", () =>
    setDoc(doc(auth[persona], "seasons", seasonId, "rosterSlots", `${persona}-slot`), {
      teamId: "TEAM-A",
      rank: 1,
    }));
}

for (const persona of ["captain", "ec", "superAdmin"]) {
  await check(persona, "Update match schedule/score", "ALLOW", () =>
    updateDoc(doc(auth[persona], "seasons", seasonId, "matchups", matchupId, "lineMatches", "L1"), {
      scoreStatus: "submitted",
    }));
}
for (const persona of ["player", "neutral"]) {
  await check(persona, "Update match schedule/score", "DENY", () =>
    updateDoc(doc(auth[persona], "seasons", seasonId, "matchups", matchupId, "lineMatches", "L1"), {
      scoreStatus: "submitted",
    }));
}

for (const persona of ["guest", "player", "captain", "ec", "neutral"]) {
  await check(persona, "Create last-minute player override audit", "DENY", () =>
    setDoc(doc(auth[persona], "seasons", seasonId, "matchups", matchupId, "lineMatches", "L1", "playerOverrides", `override-${persona}`), {
      overrideId: `override-${persona}`,
      seasonId,
      matchupId,
      lineMatchId: "L1",
      reason: "Security test",
    }));
}
await check("superAdmin", "Create last-minute player override audit", "ALLOW", () =>
  setDoc(doc(auth.superAdmin, "seasons", seasonId, "matchups", matchupId, "lineMatches", "L1", "playerOverrides", "override-admin"), {
    overrideId: "override-admin",
    seasonId,
    matchupId,
    lineMatchId: "L1",
    reason: "Last-minute eligible substitute",
  }));
await check("superAdmin", "Modify immutable player override audit", "DENY", () =>
  updateDoc(doc(auth.superAdmin, "seasons", seasonId, "matchups", matchupId, "lineMatches", "L1", "playerOverrides", "override-admin"), {
    reason: "Changed after creation",
  }));

for (const persona of ["guest", "player", "captain", "ec", "neutral"]) {
  await check(persona, "Manage AO content", "DENY", () =>
    updateDoc(doc(auth[persona], "aoContent", "history"), { title: `${persona} changed` }));
}
await check("superAdmin", "Manage AO content", "ALLOW", () =>
  updateDoc(doc(auth.superAdmin, "aoContent", "history"), { title: "Admin changed" }));

for (const persona of ["player", "captain", "ec", "neutral"]) {
  await check(persona, "Grant user profile", "DENY", () =>
    updateDoc(doc(auth[persona], "users", uids.player), { globalRoles: ["superAdmin"] }));
}
await check("superAdmin", "Grant user profile", "ALLOW", () =>
  updateDoc(doc(auth.superAdmin, "users", uids.player), { globalRoles: [] }));

console.log(JSON.stringify({
  total: results.length,
  passed: results.filter((x) => x.pass).length,
  failed: results.filter((x) => !x.pass),
  results,
}, null, 2));

await env.cleanup();
