import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const projectId = "alphaopen-operations-access";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.resolve(scriptDir, "../../firestore.rules"), "utf8");
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules, host: "127.0.0.1", port: 8080 },
});

const seasonId = "AO-OPS-2026";
const captainUid = "captain-uid";
const playerUid = "player-uid";

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, "systemConfig", "seasonControl"), { activeSeasonId: seasonId });
  await setDoc(doc(db, "users", captainUid), {
    uid: captainUid,
    email: "captain@example.com",
    status: "active",
    globalRoles: [],
  });
  await setDoc(doc(db, "users", playerUid), {
    uid: playerUid,
    email: "player@example.com",
    status: "active",
    globalRoles: [],
  });
  await setDoc(doc(db, "seasons", seasonId), { seasonId, status: "active" });
  await setDoc(doc(db, "seasons", seasonId, "members", captainUid), {
    uid: captainUid,
    status: "active",
    roles: ["captain"],
    teamIds: ["TEAM-A"],
  });
  await setDoc(doc(db, "seasons", seasonId, "members", playerUid), {
    uid: playerUid,
    status: "active",
    roles: ["player"],
    teamIds: [],
  });
  await setDoc(doc(db, "players", "P-PUBLIC"), {
    status: "active",
    publicProfileEnabled: true,
    displayName: "Public Player",
  });
  await setDoc(doc(db, "players", "P-PRIVATE"), {
    status: "active",
    publicProfileEnabled: false,
    displayName: "Private Player",
    emailNormalized: "private@example.com",
  });
  await setDoc(doc(db, "publicConfig", "activeSeasonDashboard"), {
    seasonId,
    status: "active",
    lineMatches: [{
      seasonId,
      matchupId: "M1",
      lineMatchId: "M1-L1",
      scheduleStatus: "scheduled",
      venueNameSnapshot: "Public Venue",
    }],
  });
  await setDoc(doc(db, "seasons", seasonId, "matchups", "M1"), {
    matchupId: "M1",
    homeTeamId: "TEAM-A",
    awayTeamId: "TEAM-B",
  });
  await setDoc(doc(db, "seasons", seasonId, "matchups", "M1", "lineMatches", "M1-L1"), {
    seasonId,
    matchupId: "M1",
    lineMatchId: "M1-L1",
    scheduleStatus: "scheduled",
    venueNameSnapshot: "Public Venue",
  });
  await setDoc(doc(db, "seasons", seasonId, "matchups", "M1", "lineMatches", "M1-DRAFT"), {
    seasonId,
    matchupId: "M1",
    lineMatchId: "M1-DRAFT",
    scheduleStatus: "draft",
  });
});

const guestDb = env.unauthenticatedContext().firestore();
const unknownDb = env.authenticatedContext("unknown-uid", {
  email: "unknown@example.com",
  email_verified: true,
}).firestore();
const playerDb = env.authenticatedContext(playerUid, {
  email: "player@example.com",
  email_verified: true,
}).firestore();
const captainDb = env.authenticatedContext(captainUid, {
  email: "captain@example.com",
  email_verified: true,
}).firestore();

await assertSucceeds(getDoc(doc(guestDb, "players", "P-PUBLIC")));
await assertSucceeds(getDoc(doc(guestDb, "publicConfig", "activeSeasonDashboard")));
await assertSucceeds(getDoc(doc(guestDb, "seasons", seasonId, "matchups", "M1", "lineMatches", "M1-L1")));
await assertFails(getDoc(doc(guestDb, "seasons", seasonId, "matchups", "M1", "lineMatches", "M1-DRAFT")));
await assertFails(getDoc(doc(unknownDb, "players", "P-PRIVATE")));
await assertFails(getDoc(doc(playerDb, "players", "P-PRIVATE")));
await assertSucceeds(getDoc(doc(captainDb, "players", "P-PRIVATE")));

await assertFails(setDoc(doc(unknownDb, "users", "unknown-uid"), {
  uid: "unknown-uid",
  email: "unknown@example.com",
  emailVerified: true,
  displayName: "Unknown",
  photoUrl: null,
  status: "pending",
  profileType: "player",
  playerId: "P-PUBLIC",
  globalRoles: [],
}));
await assertFails(setDoc(doc(unknownDb, "registrationRequests", "unknown-uid"), {
  uid: "unknown-uid",
  email: "unknown@example.com",
  status: "pending",
  assignedProfileType: "player",
  matchedPlayerId: "P-PUBLIC",
}));

console.log(JSON.stringify({
  guestPublicDirectoryAllowed: true,
  guestPublicDashboardAllowed: true,
  guestPublicOperationalMatchLineAllowed: true,
  guestDraftOperationalMatchLineDenied: true,
  unknownPrivatePlayerDenied: true,
  playerOnlyPrivatePlayerDenied: true,
  captainPrivatePlayerAllowed: true,
  publicSelfRegistrationDenied: true,
  publicRegistrationRequestDenied: true,
}, null, 2));

await env.cleanup();
