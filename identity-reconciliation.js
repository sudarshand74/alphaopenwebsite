import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, getFirestore, runTransaction,
  serverTimestamp, setDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const config = {
  projectId: "alphaopen-development-2026",
  appId: "1:128657830722:web:07c8c84d0386b5b11c4edb",
  apiKey: "AIzaSyCBxY1bOkhALp1W_1yXFmDo9jdFhRNQqIY",
  authDomain: "alphaopen-development-2026.firebaseapp.com",
  messagingSenderId: "128657830722"
};
const app = getApps().length ? getApp() : initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const normalizeEmail = value => String(value || "").trim().toLowerCase();
const parseList = value => Array.isArray(value) ? value : [];
let auditState = null;
let auditRunning = false;
let auditReadOnly = false;

function isSuperAdmin() {
  const authorization = window.alphaOpenAuthorization;
  return Boolean(
    auth.currentUser &&
    authorization?.status === "active" &&
    (authorization?.roles?.includes("superAdmin") || authorization?.role === "Super Admin")
  );
}

function issue(type, severity, title, detail, context = {}, repair = null) {
  return { id: `${type}:${Object.values(context).join(":")}`, type, severity, title, detail, context, repair };
}

async function readCollection(path, ...segments) {
  const snapshot = await getDocs(collection(db, path, ...segments));
  return snapshot.docs.map(item => ({ id: item.id, ref: item.ref, ...item.data() }));
}

const normalizeName = value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

function correctLinePlayer(players, oldPlayerId, newPlayerId, expectedName) {
  let changed = false;
  const result = parseList(players).map(player => {
    const storedName = player.nameSnapshot || player.playerNameSnapshot || player.name;
    if (player.playerId !== oldPlayerId || normalizeName(storedName) !== normalizeName(expectedName))
      return player;
    changed = true;
    return { ...player, playerId: newPlayerId };
  });
  return { changed, players: result };
}

async function collectLineIdentityUpdates(oldPlayerId, newPlayerId, expectedName) {
  const seasons = await readCollection("seasons");
  const updates = [];
  for (const season of seasons) {
    for (const root of ["seasons", "publicSeasons"]) {
      const matchups = await readCollection(root, season.id, "matchups");
      for (const matchup of matchups) {
        const records = await readCollection(root, season.id, "matchups", matchup.id, "lineMatches");
        records.forEach(record => {
          const home = correctLinePlayer(record.homePlayers, oldPlayerId, newPlayerId, expectedName);
          const away = correctLinePlayer(record.awayPlayers, oldPlayerId, newPlayerId, expectedName);
          if (home.changed || away.changed)
            updates.push({
              ref: record.ref,
              data: { homePlayers: home.players, awayPlayers: away.players }
            });
        });
      }
    }
  }
  return updates;
}

async function reconcileHistoricalPlayerId(event) {
  event.preventDefault();
  if (!isSuperAdmin()) return;
  const oldPlayerId = $("#historicalOldPlayerId")?.value.trim().toUpperCase();
  const newPlayerId = $("#historicalNewPlayerId")?.value.trim().toUpperCase();
  const message = $("#historicalPlayerIdMessage");
  const button = event.submitter;
  if (!/^P\d+$/.test(oldPlayerId) || !/^P\d+$/.test(newPlayerId) || oldPlayerId === newPlayerId) {
    message.textContent = "Enter two different valid Player IDs.";
    return;
  }
  button.disabled = true;
  message.textContent = "Checking Player Master and season references…";
  try {
    const [oldMaster, newMaster] = await Promise.all([
      getDoc(doc(db, "playerPrivate", oldPlayerId)),
      getDoc(doc(db, "playerPrivate", newPlayerId))
    ]);
    if (!newMaster.exists()) throw new Error(`${newPlayerId} does not exist in Player Master.`);
    const canonicalName = newMaster.data()?.fullName ||
      [newMaster.data()?.firstName, newMaster.data()?.lastName].filter(Boolean).join(" ");
    if (!canonicalName) throw new Error(`${newPlayerId} has no full name in Player Master.`);
    const updates = await collectLineIdentityUpdates(oldPlayerId, newPlayerId, canonicalName);
    if (!updates.length) {
      message.textContent = `No season references to ${oldPlayerId} were found.`;
      return;
    }
    const oldName = oldMaster.data()?.fullName || oldPlayerId;
    const newName = canonicalName;
    if (!window.confirm(
      `Correct line-player entries where ${oldPlayerId} is paired with the name ${newName}?\n\n` +
      `Those entries will use ${newPlayerId}. ${oldPlayerId} remains assigned to ${oldName}. ` +
      `${updates.length} operational/public line records will be updated. Scores and points will not change.`
    )) {
      message.textContent = "Historical Player ID reconciliation canceled.";
      return;
    }
    for (let index = 0; index < updates.length; index += 400) {
      const batch = writeBatch(db);
      updates.slice(index, index + 400).forEach(update =>
        batch.set(update.ref, {
          ...update.data,
          updatedAt: serverTimestamp(),
          updatedByUid: auth.currentUser.uid
        }, { merge: true })
      );
      await batch.commit();
    }
    message.textContent = `${updates.length} season records reconciled from ${oldPlayerId} to ${newPlayerId}.`;
    window.alphaOpenAuthUI?.showMessage(message.textContent);
  } catch (error) {
    console.error("Historical Player ID reconciliation failed", error);
    message.textContent = error.message || "Historical Player ID reconciliation failed.";
  } finally {
    button.disabled = false;
  }
}

function addMapList(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function masterName(record) {
  return String(
    record?.fullName ||
    record?.displayName ||
    [record?.firstName, record?.lastName].filter(Boolean).join(" ") ||
    ""
  ).trim().replace(/\s+/g, " ");
}

function uniquePlayerIdForName(privatePlayers, name) {
  const normalized = normalizeName(name);
  if (!normalized) return "";
  const matches = privatePlayers.filter(record => normalizeName(masterName(record)) === normalized);
  return matches.length === 1 ? matches[0].id : "";
}

function rosterIdentityFields(record) {
  return {
    playerId: record?.playerId || "",
    playerNameSnapshot: String(record?.playerNameSnapshot || "").trim(),
    originalPlayerId: record?.originalPlayerId || "",
    originalPlayerNameSnapshot: String(record?.originalPlayerNameSnapshot || "").trim(),
    replacementPlayerId: record?.replacementPlayerId || "",
    replacementPlayerNameSnapshot: String(record?.replacementPlayerNameSnapshot || "").trim(),
    status: record?.status || "",
    assignmentType: record?.assignmentType || "",
    teamId: record?.teamId || "",
    rankNumber: Number(record?.rankNumber || 0)
  };
}

function rosterParityDiffers(operational, published) {
  if (!published) return true;
  return JSON.stringify(rosterIdentityFields(operational)) !== JSON.stringify(rosterIdentityFields(published));
}

function playerReferenceFinding(privateById, privatePlayers, playerId, storedName) {
  const master = privateById.get(playerId);
  const canonicalName = masterName(master);
  const nameMatchedPlayerId = uniquePlayerIdForName(privatePlayers, storedName);
  if (!master) {
    return {
      kind: "unknown",
      canonicalName: "",
      targetPlayerId: nameMatchedPlayerId,
      targetName: masterName(privateById.get(nameMatchedPlayerId))
    };
  }
  if (storedName && normalizeName(storedName) !== normalizeName(canonicalName)) {
    const pointsElsewhere = Boolean(nameMatchedPlayerId && nameMatchedPlayerId !== playerId);
    return {
      kind: pointsElsewhere ? "wrongId" : "staleName",
      canonicalName,
      targetPlayerId: pointsElsewhere ? nameMatchedPlayerId : playerId,
      targetName: pointsElsewhere ? masterName(privateById.get(nameMatchedPlayerId)) : canonicalName
    };
  }
  return { kind: "ok", canonicalName, targetPlayerId: playerId, targetName: canonicalName };
}

async function readMatchupIdentityTree(root, seasonId) {
  const matchups = await readCollection(root, seasonId, "matchups");
  const records = await Promise.all(matchups.map(async matchup => {
    const base = [root, seasonId, "matchups", matchup.id];
    const [lineups, lineMatches] = await Promise.all([
      root === "seasons" ? readCollection(...base, "lineups") : Promise.resolve([]),
      readCollection(...base, "lineMatches")
    ]);
    return { matchup, lineups, lineMatches };
  }));
  return records;
}

async function collectAudit() {
  const [players, privatePlayers, emailIndexes, users, links, registrations, seasons, publicSeasons] = await Promise.all([
    readCollection("players"),
    readCollection("playerPrivate"),
    readCollection("playerEmailIndex"),
    readCollection("users"),
    readCollection("playerAccountLinks"),
    readCollection("registrationRequests"),
    readCollection("seasons"),
    readCollection("publicSeasons")
  ]);
  const publicSeasonById = new Map(publicSeasons.map(record => [record.id, record]));
  const seasonTrees = await Promise.all(seasons.map(async season => {
    const [members, teams, publicTeams, rosterAssignments, publicRosterAssignments, weeks, publicWeeks, matchups, publicMatchups] = await Promise.all([
      readCollection("seasons", season.id, "members"),
      readCollection("seasons", season.id, "teams"),
      readCollection("publicSeasons", season.id, "teams"),
      readCollection("seasons", season.id, "rosterAssignments"),
      readCollection("publicSeasons", season.id, "rosterAssignments"),
      readCollection("seasons", season.id, "weeks"),
      readCollection("publicSeasons", season.id, "weeks"),
      readMatchupIdentityTree("seasons", season.id),
      readMatchupIdentityTree("publicSeasons", season.id)
    ]);
    return {
      season, publicSeason: publicSeasonById.get(season.id) || null,
      members, teams, publicTeams, rosterAssignments, publicRosterAssignments, weeks, publicWeeks,
      matchups, publicMatchups
    };
  }));
  const publicById = new Map(players.map(record => [record.id, record]));
  const privateById = new Map(privatePlayers.map(record => [record.id, record]));
  const indexByEmail = new Map(emailIndexes.map(record => [normalizeEmail(record.emailNormalized), record]));
  const userByUid = new Map(users.map(record => [record.id, record]));
  const linkByPlayer = new Map(links.map(record => [record.id, record]));
  const registrationByUid = new Map(registrations.map(record => [record.id, record]));
  const usersByPlayer = new Map(), usersByEmail = new Map(), linksByUid = new Map();
  users.forEach(record => {
    addMapList(usersByPlayer, record.playerId, record);
    addMapList(usersByEmail, normalizeEmail(record.email), record);
  });
  links.filter(record => record.status === "active").forEach(record => addMapList(linksByUid, record.uid, record));

  const issues = [];
  publicSeasons.forEach(publicSeason => {
    if (!seasons.some(season => season.id === publicSeason.id))
      issues.push(issue("PUBLIC_ONLY_SEASON", "error",
        `${publicSeason.id}: season exists only in publicSeasons`,
        "This season must be migrated or intentionally archived before the publicSeasons tree is removed.",
        { seasonId: publicSeason.id }));
  });
  const allPlayerIds = new Set([...publicById.keys(), ...privateById.keys()]);
  allPlayerIds.forEach(playerId => {
    const publicRecord = publicById.get(playerId);
    const privateRecord = privateById.get(playerId);
    if (!privateRecord) {
      issues.push(issue("PRIVATE_MISSING", "error", `${playerId}: private master missing`,
        "The public Player Master record has no playerPrivate source record.", { playerId }));
      return;
    }
    const obsoleteFields = ["globalScore", "emergencyContact", "accountUid", "accountStatus"]
      .filter(field => Object.prototype.hasOwnProperty.call(privateRecord, field));
    if (obsoleteFields.length)
      issues.push(issue("PLAYER_OBSOLETE_FIELDS", "info",
        `${playerId}: fields scheduled for migration`,
        `Player Master still contains ${obsoleteFields.join(", ")}. The audit is read-only; no fields were removed.`,
        { playerId, fields: obsoleteFields.join(",") }));
    if (!publicRecord) {
      issues.push(issue("PUBLIC_MISSING", "warning", `${playerId}: public profile missing`,
        "The private master exists, but the players mirror is missing.", { playerId }, "syncPublicPlayer"));
    } else {
      const differs = String(publicRecord.displayName || "").trim() !== String(privateRecord.fullName || "").trim() ||
        String(publicRecord.status || "") !== String(privateRecord.status || "") ||
        publicRecord.playerId !== playerId;
      if (differs)
        issues.push(issue("PUBLIC_MISMATCH", "warning", `${playerId}: public profile differs`,
          `Expected ${privateRecord.fullName || playerId} / ${privateRecord.status || "unknown"} from Player Master.`,
          { playerId }, "syncPublicPlayer"));
    }
    const email = normalizeEmail(privateRecord.emailNormalized);
    if (!email) {
      issues.push(issue("EMAIL_MISSING", "error", `${playerId}: email missing`,
        "Player Master has no normalized email. This requires manual correction.", { playerId }));
      return;
    }
    const indexRecord = indexByEmail.get(email);
    if (!indexRecord) {
      issues.push(issue("INDEX_MISSING", "warning", `${playerId}: email index missing`,
        `${email} is not present in playerEmailIndex.`, { playerId, email }, "syncEmailIndex"));
    } else if (indexRecord.playerId !== playerId || normalizeEmail(indexRecord.emailNormalized) !== email) {
      issues.push(issue("INDEX_CONFLICT", "error", `${playerId}: email index conflict`,
        `${email} currently points to ${indexRecord.playerId || "another record"}. Resolve manually.`,
        { playerId, email, conflictingPlayerId: indexRecord.playerId }));
    }
  });

  const duplicateEmails = new Map();
  privatePlayers.forEach(record => addMapList(duplicateEmails, normalizeEmail(record.emailNormalized), record.id));
  duplicateEmails.forEach((playerIds, email) => {
    if (email && playerIds.length > 1)
      issues.push(issue("DUPLICATE_EMAIL", "error", "Duplicate Player Master email",
        `${email} belongs to ${playerIds.join(", ")}.`, { email }));
  });
  usersByPlayer.forEach((records, playerId) => {
    if (playerId && records.length > 1)
      issues.push(issue("DUPLICATE_USERS", "error", `${playerId}: multiple user accounts`,
        records.map(record => `${record.displayName || record.email} (${record.id})`).join(" · "), { playerId }));
  });
  linksByUid.forEach((records, uid) => {
    if (uid && records.length > 1)
      issues.push(issue("DUPLICATE_LINKS", "error", "Firebase UID linked to multiple players",
        `${uid} is actively linked to ${records.map(record => record.playerId || record.id).join(", ")}.`, { uid }));
  });

  users.forEach(user => {
    const playerId = user.playerId, privateRecord = privateById.get(playerId);
    if (!privateRecord) {
      issues.push(issue("USER_UNKNOWN_PLAYER", "error", `${user.displayName || user.email}: invalid Player ID`,
        `users/${user.id} points to ${playerId || "no Player ID"}.`, { uid: user.id, playerId }));
      return;
    }
    const userEmail = normalizeEmail(user.email), playerEmail = normalizeEmail(privateRecord.emailNormalized);
    if (userEmail !== playerEmail)
      issues.push(issue("USER_EMAIL_MISMATCH", "error", `${playerId}: user email differs`,
        `Login ${userEmail} does not match Player Master ${playerEmail}. Use the email-transfer workflow or resolve manually.`,
        { uid: user.id, playerId }));
    const link = linkByPlayer.get(playerId);
    const uniqueEmailUser = (usersByEmail.get(playerEmail) || []).length === 1;
    if (!link || link.status !== "active" || link.uid !== user.id) {
      const canRepair = userEmail === playerEmail && uniqueEmailUser &&
        (!link || !link.uid || link.uid === user.id || link.status !== "active");
      issues.push(issue("ACCOUNT_LINK_MISMATCH", canRepair ? "warning" : "error",
        `${playerId}: account link mismatch`,
        link ? `Account link currently references ${link.uid || "no UID"} (${link.status || "unknown"}).`
          : "No playerAccountLinks record exists for this active user.",
        { uid: user.id, playerId }, canRepair ? "syncAccountTree" : null));
    }
    const registration = registrationByUid.get(user.id);
    if (!registration || registration.matchedPlayerId !== playerId)
      issues.push(issue("REGISTRATION_MISMATCH", "warning", `${playerId}: registration differs`,
        `registrationRequests/${user.id} does not identify ${playerId}.`,
        { uid: user.id, playerId }, userEmail === playerEmail && uniqueEmailUser ? "syncAccountTree" : null));
    if (privateRecord.accountUid !== user.id || privateRecord.accountStatus !== "active")
      issues.push(issue("PRIVATE_ACCOUNT_MISMATCH", "warning", `${playerId}: Player Master account link differs`,
        `playerPrivate/${playerId} stores ${privateRecord.accountUid || "no UID"} (${privateRecord.accountStatus || "no status"}).`,
        { uid: user.id, playerId }, userEmail === playerEmail && uniqueEmailUser ? "syncPrivateAccount" : null));
  });

  seasonTrees.forEach(tree => {
    const memberByUid = new Map(tree.members.map(record => [record.id, record]));
    const publicTeamById = new Map(tree.publicTeams.map(record => [record.id, record]));
    const publicWeekById = new Map(tree.publicWeeks.map(record => [record.id, record]));
    const publicRosterById = new Map(tree.publicRosterAssignments.map(record => [record.id, record]));
    const operationalTeamIds = new Set(tree.teams.map(record => record.id));
    const operationalWeekIds = new Set(tree.weeks.map(record => record.id));
    const operationalRosterIds = new Set(tree.rosterAssignments.map(record => record.id));
    const operationalMatchupIds = new Set(tree.matchups.map(record => record.matchup.id));
    tree.publicTeams.forEach(record => {
      if (!operationalTeamIds.has(record.id))
        issues.push(issue("PUBLIC_ONLY_TEAM", "error",
          `${tree.season.id} · ${record.id}: team exists only in publicSeasons`,
          "Preserve or reconcile this team before removing the public season tree.",
          { seasonId: tree.season.id, teamId: record.id }));
    });
    tree.publicWeeks.forEach(record => {
      if (!operationalWeekIds.has(record.id))
        issues.push(issue("PUBLIC_ONLY_WEEK", "error",
          `${tree.season.id} · ${record.id}: week exists only in publicSeasons`,
          "Preserve or reconcile this week before removing the public season tree.",
          { seasonId: tree.season.id, weekId: record.id }));
    });
    tree.publicRosterAssignments.forEach(record => {
      if (!operationalRosterIds.has(record.id))
        issues.push(issue("PUBLIC_ONLY_ROSTER", "error",
          `${tree.season.id} · ${record.id}: roster record exists only in publicSeasons`,
          "Preserve or reconcile this roster record before removing the public season tree.",
          { seasonId: tree.season.id, assignmentId: record.id }));
    });
    tree.publicMatchups.forEach(record => {
      if (!operationalMatchupIds.has(record.matchup.id))
        issues.push(issue("PUBLIC_ONLY_MATCHUP", "error",
          `${tree.season.id} · ${record.matchup.id}: matchup exists only in publicSeasons`,
          "Preserve or reconcile this matchup before removing the public season tree.",
          { seasonId: tree.season.id, matchupId: record.matchup.id }));
    });
    tree.members.forEach(member => {
      const user = userByUid.get(member.id);
      if (!user || member.playerId !== user.playerId) {
        const authoritativePlayer = user?.playerId ? privateById.get(user.playerId) : null;
        const canRepair = Boolean(user && authoritativePlayer);
        issues.push(issue("MEMBERSHIP_ID_MISMATCH", "error",
          `${tree.season.id}: membership identity mismatch`,
          `${member.id} stores ${member.playerId || "no Player ID"}; user stores ${user?.playerId || "no matching user"}.`,
          { seasonId: tree.season.id, uid: member.id, playerId: user?.playerId || member.playerId },
          canRepair ? "syncMembershipIdentity" : null));
      }
    });
    tree.teams.forEach(team => {
      const captainIds = team.captainPlayerId
        ? [team.captainPlayerId]
        : parseList(team.captainPlayerIds);
      if (captainIds.length > 1)
        issues.push(issue("TEAM_MULTIPLE_CAPTAINS", "warning",
          `${tree.season.id} · ${team.name || team.id}: multiple captain IDs`,
          `${captainIds.join(", ")} are stored; the simplified schema permits one captainPlayerId.`,
          { seasonId: tree.season.id, teamId: team.id }));
      const legacyCaptainFields = ["captainPlayerIds", "captainUids", "captainNameSnapshot", "captainEmailsNormalized"]
        .filter(field => Object.prototype.hasOwnProperty.call(team, field));
      if (legacyCaptainFields.length)
        issues.push(issue("TEAM_LEGACY_CAPTAIN_FIELDS", "info",
          `${tree.season.id} · ${team.name || team.id}: legacy captain fields`,
          `${legacyCaptainFields.join(", ")} will be replaced by captainPlayerId after reconciliation.`,
          { seasonId: tree.season.id, teamId: team.id, fields: legacyCaptainFields.join(",") }));
      captainIds.forEach(playerId => {
        const master = privateById.get(playerId);
        if (!master) {
          issues.push(issue("CAPTAIN_UNKNOWN_PLAYER", "error",
            `${tree.season.id} · ${team.name || team.id}: captain is missing from Player Master`,
            `${playerId} does not exist in playerPrivate.`,
            { seasonId: tree.season.id, teamId: team.id, playerId }));
          return;
        }
        const storedName = String(team.captainNameSnapshot || "").trim();
        const canonicalName = masterName(master);
        if (storedName && normalizeName(storedName) !== normalizeName(canonicalName))
          issues.push(issue("CAPTAIN_PLAYER_ID_NAME_CONFLICT", "error",
            `${tree.season.id} · ${team.name || team.id}: captain Player ID/name conflict`,
            `${playerId} belongs to ${canonicalName}; the team snapshot says ${storedName}.`,
            { seasonId: tree.season.id, teamId: team.id, playerId }));
        const link = linkByPlayer.get(playerId);
        if (!link || link.status !== "active" || !link.uid || !userByUid.has(link.uid)) {
          issues.push(issue("CAPTAIN_ACCOUNT_MISSING", "warning",
            `${tree.season.id} · ${team.name || team.id}: captain account not linked`,
            `${playerId} is assigned as captain, but no active Firebase UID can be resolved.`,
            { seasonId: tree.season.id, teamId: team.id, playerId }));
          return;
        }
        const member = memberByUid.get(link.uid), roles = parseList(member?.roles);
        const teamIds = parseList(member?.teamIds), teamUids = parseList(team.captainUids);
        if (!member || member.status !== "active" || member.playerId !== playerId ||
          !roles.includes("captain") || !roles.includes("player") || !teamIds.includes(team.id) ||
          !teamUids.includes(link.uid))
          issues.push(issue("CAPTAIN_MEMBERSHIP_MISMATCH", "warning",
            `${tree.season.id} · ${team.name || team.id}: captain access incomplete`,
            `${playerId} is linked to ${link.uid}, but the team/member authorization trees differ.`,
            { seasonId: tree.season.id, teamId: team.id, playerId, uid: link.uid }, "syncCaptainAccess"));
      });
      const publicTeam = publicTeamById.get(team.id);
      if (publicTeam) {
        const operationalCaptainIds = captainIds;
        const publishedCaptainIds = publicTeam.captainPlayerId
          ? [publicTeam.captainPlayerId]
          : parseList(publicTeam.captainPlayerIds);
        if (JSON.stringify(operationalCaptainIds) !== JSON.stringify(publishedCaptainIds) ||
          normalizeName(team.captainNameSnapshot) !== normalizeName(publicTeam.captainNameSnapshot))
          issues.push(issue("TEAM_PUBLIC_CAPTAIN_PARITY_MISMATCH", "warning",
            `${tree.season.id} · ${team.name || team.id}: public captain copy differs`,
            "The operational and public team captain identities are not the same.",
            { seasonId: tree.season.id, teamId: team.id }));
      }
    });

    const activeRankKeys = new Map();
    const activePlayerKeys = new Map();
    tree.rosterAssignments.forEach(assignment => {
      const assignmentId = assignment.id;
      const identity = playerReferenceFinding(
        privateById, privatePlayers, assignment.playerId, assignment.playerNameSnapshot
      );
      const context = {
        seasonId: tree.season.id,
        assignmentId,
        sourcePlayerId: assignment.playerId || "",
        storedName: assignment.playerNameSnapshot || "",
        targetPlayerId: identity.targetPlayerId || "",
        targetName: identity.targetName || ""
      };
      if (identity.kind === "unknown") {
        issues.push(issue("ROSTER_UNKNOWN_PLAYER", "error",
          `${tree.season.id} · roster ${assignmentId}: unknown Player ID`,
          `${assignment.playerId || "No Player ID"} is not in Player Master${identity.targetPlayerId ? `; the stored name uniquely belongs to ${identity.targetPlayerId}` : ""}.`,
          context, identity.targetPlayerId ? "syncRosterIdentity" : null));
      } else if (identity.kind === "wrongId") {
        issues.push(issue("ROSTER_PLAYER_ID_NAME_CONFLICT", "error",
          `${tree.season.id} · ${assignment.teamId || "unknown team"} R${Number(assignment.rankNumber || 0)}: Player ID/name conflict`,
          `${assignment.playerId} belongs to ${identity.canonicalName}; the stored roster name ${assignment.playerNameSnapshot} uniquely belongs to ${identity.targetPlayerId}.`,
          context, "syncRosterIdentity"));
      } else if (identity.kind === "staleName") {
        issues.push(issue("ROSTER_NAME_SNAPSHOT_MISMATCH", "warning",
          `${tree.season.id} · roster ${assignmentId}: name snapshot differs`,
          `${assignment.playerId} is ${identity.canonicalName} in Player Master, not ${assignment.playerNameSnapshot || "a blank name"}.`,
          context, "syncRosterIdentity"));
      }
      const published = publicRosterById.get(assignmentId);
      if (rosterParityDiffers(assignment, published))
        issues.push(issue("ROSTER_PUBLIC_PARITY_MISMATCH", "warning",
          `${tree.season.id} · roster ${assignmentId}: public copy differs`,
          published
            ? "The public roster identity/status fields differ from the operational roster assignment."
            : "The operational roster assignment has no public roster copy.",
          { seasonId: tree.season.id, assignmentId }, "syncPublicRosterAssignment"));

      if (assignment.status === "active") {
        const rankKey = `${assignment.teamId}|${Number(assignment.rankNumber || 0)}`;
        addMapList(activeRankKeys, rankKey, assignment);
        addMapList(activePlayerKeys, assignment.playerId, assignment);
      }
    });
    activeRankKeys.forEach((records, key) => {
      if (records.length > 1)
        issues.push(issue("ROSTER_DUPLICATE_ACTIVE_RANK", "error",
          `${tree.season.id} · duplicate active rank ${key}`,
          `${records.length} active roster assignments occupy the same team/rank: ${records.map(record => record.id).join(", ")}.`,
          { seasonId: tree.season.id, rankKey: key }));
    });
    activePlayerKeys.forEach((records, playerId) => {
      const distinctRanks = new Set(records.map(record => `${record.teamId}|${Number(record.rankNumber || 0)}`));
      if (playerId && distinctRanks.size > 1)
        issues.push(issue("ROSTER_DUPLICATE_ACTIVE_PLAYER", "error",
          `${tree.season.id} · ${playerId}: multiple active roster positions`,
          [...distinctRanks].join(", "), { seasonId: tree.season.id, playerId }));
    });

    tree.matchups.forEach(matchupTree => {
      matchupTree.lineups.forEach(lineup => {
        parseList(lineup.lines).forEach((line, lineIndex) => {
          for (const playerNumber of [1, 2]) {
            const idField = `player${playerNumber}Id`;
            const nameField = `player${playerNumber}Name`;
            const playerId = line?.[idField] || "";
            const storedName = line?.[nameField] || "";
            if (!playerId && !storedName) continue;
            const identity = playerReferenceFinding(privateById, privatePlayers, playerId, storedName);
            if (identity.kind === "ok") continue;
            const repair = identity.targetPlayerId ? "syncLineupPlayerIdentity" : null;
            issues.push(issue(
              identity.kind === "wrongId" || identity.kind === "unknown"
                ? "LINEUP_PLAYER_ID_NAME_CONFLICT" : "LINEUP_NAME_SNAPSHOT_MISMATCH",
              identity.kind === "staleName" ? "warning" : "error",
              `${tree.season.id} · ${matchupTree.matchup.id} · ${lineup.id} L${lineIndex + 1}: lineup identity mismatch`,
              identity.kind === "wrongId"
                ? `${playerId} belongs to ${identity.canonicalName}; ${storedName} uniquely belongs to ${identity.targetPlayerId}.`
                : identity.kind === "unknown"
                  ? `${playerId || "No Player ID"} is not in Player Master${identity.targetPlayerId ? `; ${storedName} belongs to ${identity.targetPlayerId}` : ""}.`
                  : `${playerId} is ${identity.canonicalName} in Player Master, not ${storedName || "a blank name"}.`,
              {
                seasonId: tree.season.id, matchupId: matchupTree.matchup.id,
                teamId: lineup.id, lineIndex, playerNumber, sourcePlayerId: playerId,
                storedName, targetPlayerId: identity.targetPlayerId, targetName: identity.targetName
              }, repair
            ));
          }
        });
      });
      matchupTree.lineMatches.forEach(lineMatch => {
        for (const side of ["home", "away"]) {
          parseList(lineMatch[`${side}Players`]).forEach((player, playerIndex) => {
            const playerId = player?.playerId || "";
            const storedName = player?.nameSnapshot || player?.playerNameSnapshot || player?.name || "";
            if (!playerId && !storedName) return;
            const identity = playerReferenceFinding(privateById, privatePlayers, playerId, storedName);
            if (identity.kind === "ok") return;
            issues.push(issue(
              identity.kind === "wrongId" || identity.kind === "unknown"
                ? "LINE_MATCH_PLAYER_ID_NAME_CONFLICT" : "LINE_MATCH_NAME_SNAPSHOT_MISMATCH",
              identity.kind === "staleName" ? "warning" : "error",
              `${tree.season.id} · ${lineMatch.id}: ${side} player identity mismatch`,
              identity.kind === "wrongId"
                ? `${playerId} belongs to ${identity.canonicalName}; ${storedName} uniquely belongs to ${identity.targetPlayerId}.`
                : identity.kind === "unknown"
                  ? `${playerId || "No Player ID"} is not in Player Master${identity.targetPlayerId ? `; ${storedName} belongs to ${identity.targetPlayerId}` : ""}.`
                  : `${playerId} is ${identity.canonicalName} in Player Master, not ${storedName || "a blank name"}.`,
              {
                seasonId: tree.season.id, matchupId: matchupTree.matchup.id,
                lineMatchId: lineMatch.id, side, playerIndex,
                sourcePlayerId: playerId, storedName,
                targetPlayerId: identity.targetPlayerId, targetName: identity.targetName
              }, identity.targetPlayerId ? "syncLineMatchPlayerIdentity" : null
            ));
          });
        }
      });
    });

    const publicMatchupById = new Map(tree.publicMatchups.map(record => [record.matchup.id, record]));
    tree.matchups.forEach(matchupTree => {
      const publicTree = publicMatchupById.get(matchupTree.matchup.id);
      const publicLineById = new Map((publicTree?.lineMatches || []).map(record => [record.id, record]));
      matchupTree.lineMatches.forEach(lineMatch => {
        const published = publicLineById.get(lineMatch.id);
        const operationalIdentity = {
          homePlayers: parseList(lineMatch.homePlayers),
          awayPlayers: parseList(lineMatch.awayPlayers)
        };
        const publicIdentity = published ? {
          homePlayers: parseList(published.homePlayers),
          awayPlayers: parseList(published.awayPlayers)
        } : null;
        if (!published || JSON.stringify(operationalIdentity) !== JSON.stringify(publicIdentity))
          issues.push(issue("LINE_MATCH_PUBLIC_PARITY_MISMATCH", "warning",
            `${tree.season.id} · ${lineMatch.id}: public line identity differs`,
            published
              ? "Published home/away player identities differ from the operational line match."
              : "The operational line match has no public copy.",
            {
              seasonId: tree.season.id,
              matchupId: matchupTree.matchup.id,
              lineMatchId: lineMatch.id
            }, "syncPublicLineMatchIdentity"));
      });
      (publicTree?.lineMatches || []).forEach(publicLine => {
        if (!matchupTree.lineMatches.some(line => line.id === publicLine.id))
          issues.push(issue("PUBLIC_ONLY_LINE_MATCH", "error",
            `${tree.season.id} · ${matchupTree.matchup.id} · ${publicLine.id}: line match exists only in publicSeasons`,
            "Preserve or reconcile this published line match before removing the public season tree.",
            {
              seasonId: tree.season.id,
              matchupId: matchupTree.matchup.id,
              lineMatchId: publicLine.id
            }));
      });
    });
  });
  return {
    scannedAt: new Date(),
    counts: {
      players: players.length, privatePlayers: privatePlayers.length, emailIndexes: emailIndexes.length,
      users: users.length, accountLinks: links.length, seasons: seasons.length,
      publicSeasons: publicSeasons.length,
      teams: seasonTrees.reduce((sum, tree) => sum + tree.teams.length, 0),
      publicTeams: seasonTrees.reduce((sum, tree) => sum + tree.publicTeams.length, 0),
      members: seasonTrees.reduce((sum, tree) => sum + tree.members.length, 0),
      rosterAssignments: seasonTrees.reduce((sum, tree) => sum + tree.rosterAssignments.length, 0),
      lineups: seasonTrees.reduce((sum, tree) => sum + tree.matchups.reduce((inner, matchup) => inner + matchup.lineups.length, 0), 0),
      lineMatches: seasonTrees.reduce((sum, tree) => sum + tree.matchups.reduce((inner, matchup) => inner + matchup.lineMatches.length, 0), 0)
    },
    issues,
    maps: { publicById, privateById, userByUid, linkByPlayer, registrationByUid },
    seasonTrees
  };
}

async function syncPublicPlayer(context) {
  const record = auditState.maps.privateById.get(context.playerId);
  if (!record) throw new Error("Private Player Master record no longer exists.");
  await runTransaction(db, async transaction => {
    const target = doc(db, "players", context.playerId);
    const snapshot = await transaction.get(target);
    transaction.set(target, {
      playerId: context.playerId,
      displayName: record.fullName || [record.firstName, record.lastName].filter(Boolean).join(" "),
      status: record.status || "active",
      publicProfileEnabled: snapshot.exists() ? snapshot.data().publicProfileEnabled === true : false,
      updatedAt: serverTimestamp()
    }, { merge: true });
  });
}

async function syncEmailIndex(context) {
  const record = auditState.maps.privateById.get(context.playerId);
  const email = normalizeEmail(record?.emailNormalized);
  if (!record || !email) throw new Error("Player Master email is missing.");
  const target = doc(db, "playerEmailIndex", encodeURIComponent(email));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(target);
    if (snapshot.exists() && snapshot.data().playerId !== context.playerId)
      throw new Error(`Email index belongs to ${snapshot.data().playerId}; automatic repair stopped.`);
    transaction.set(target, {
      playerId: context.playerId, emailNormalized: email, status: record.status || "active",
      updatedAt: serverTimestamp(), updatedByUid: auth.currentUser.uid
    }, { merge: true });
  });
}

async function syncAccountTree(context) {
  const user = auditState.maps.userByUid.get(context.uid);
  const privateRecord = auditState.maps.privateById.get(context.playerId);
  if (!user || !privateRecord) throw new Error("User or Player Master record is missing.");
  if (normalizeEmail(user.email) !== normalizeEmail(privateRecord.emailNormalized))
    throw new Error("Login email does not match Player Master. Use the email-transfer workflow.");
  const seasons = auditState.seasonTrees.map(tree => tree.season.id);
  const userRef = doc(db, "users", context.uid), linkRef = doc(db, "playerAccountLinks", context.playerId);
  const privateRef = doc(db, "playerPrivate", context.playerId);
  const registrationRef = doc(db, "registrationRequests", context.uid);
  await runTransaction(db, async transaction => {
    const [userSnapshot, linkSnapshot, registrationSnapshot, ...memberSnapshots] = await Promise.all([
      transaction.get(userRef), transaction.get(linkRef), transaction.get(registrationRef),
      ...seasons.map(seasonId => transaction.get(doc(db, "seasons", seasonId, "members", context.uid)))
    ]);
    if (!userSnapshot.exists()) throw new Error("User record no longer exists.");
    if (linkSnapshot.exists() && linkSnapshot.data().status === "active" &&
      linkSnapshot.data().uid && linkSnapshot.data().uid !== context.uid)
      throw new Error("Player ID is actively linked to another UID; automatic repair stopped.");
    transaction.update(userRef, {
      playerId: context.playerId, playerEmailNormalized: normalizeEmail(privateRecord.emailNormalized),
      updatedAt: serverTimestamp()
    });
    transaction.set(linkRef, {
      playerId: context.playerId, uid: context.uid, emailAtApproval: user.email,
      status: "active", linkMethod: "identityReconciliation",
      approvedByUid: auth.currentUser.uid, approvedAt: serverTimestamp(),
      revokedByUid: null, revokedAt: null, reason: "Reconciled by Super Admin"
    }, { merge: true });
    transaction.set(privateRef, {
      accountUid: context.uid, accountStatus: "active",
      updatedByUid: auth.currentUser.uid, updatedAt: serverTimestamp()
    }, { merge: true });
    if (registrationSnapshot.exists())
      transaction.set(registrationRef, {
        matchedPlayerId: context.playerId, status: "approved",
        decidedByUid: auth.currentUser.uid, decidedAt: serverTimestamp()
      }, { merge: true });
    memberSnapshots.forEach(snapshot => {
      if (snapshot.exists())
        transaction.set(snapshot.ref, { playerId: context.playerId, updatedAt: serverTimestamp() }, { merge: true });
    });
  });
}

async function syncPrivateAccount(context) {
  const user = auditState.maps.userByUid.get(context.uid);
  const privateRecord = auditState.maps.privateById.get(context.playerId);
  const link = auditState.maps.linkByPlayer.get(context.playerId);
  if (!user || !privateRecord) throw new Error("User or Player Master record is missing.");
  if (normalizeEmail(user.email) !== normalizeEmail(privateRecord.emailNormalized))
    throw new Error("Login email does not match Player Master. Use the email-transfer workflow.");
  if (!link || link.status !== "active" || link.uid !== context.uid)
    throw new Error("The active player account link does not match this UID. Reconcile the account link first.");
  await runTransaction(db, async transaction => {
    const privateRef = doc(db, "playerPrivate", context.playerId);
    const snapshot = await transaction.get(privateRef);
    if (!snapshot.exists()) throw new Error("Player Master record no longer exists.");
    if (normalizeEmail(snapshot.data().emailNormalized) !== normalizeEmail(user.email))
      throw new Error("Player Master email changed; repair stopped.");
    transaction.set(privateRef, {
      accountUid: context.uid,
      accountStatus: "active",
      updatedByUid: auth.currentUser.uid,
      updatedAt: serverTimestamp()
    }, { merge: true });
  });
}

async function syncMembershipIdentity(context) {
  const memberRef = doc(db, "seasons", context.seasonId, "members", context.uid);
  const userRef = doc(db, "users", context.uid);
  const privateRef = doc(db, "playerPrivate", context.playerId);
  const linkRef = doc(db, "playerAccountLinks", context.playerId);
  await runTransaction(db, async transaction => {
    const [memberSnapshot, userSnapshot, privateSnapshot, linkSnapshot] = await Promise.all([
      transaction.get(memberRef), transaction.get(userRef),
      transaction.get(privateRef), transaction.get(linkRef)
    ]);
    if (!memberSnapshot.exists()) throw new Error("Season membership no longer exists.");
    if (!userSnapshot.exists() || !privateSnapshot.exists())
      throw new Error("User or Player Master record is missing.");
    const user = userSnapshot.data(), privateRecord = privateSnapshot.data();
    if (user.playerId !== context.playerId)
      throw new Error("The user’s Player ID changed; repair stopped.");
    if (normalizeEmail(user.email) !== normalizeEmail(privateRecord.emailNormalized))
      throw new Error("The user email does not match Player Master; repair stopped.");
    if (!linkSnapshot.exists() || linkSnapshot.data().status !== "active" ||
      linkSnapshot.data().uid !== context.uid)
      throw new Error("The active account link does not match this membership; repair stopped.");
    transaction.set(memberRef, {
      playerId: context.playerId,
      updatedByUid: auth.currentUser.uid,
      updatedAt: serverTimestamp()
    }, { merge: true });
  });
}

async function syncCaptainAccess(context) {
  const tree = auditState.seasonTrees.find(item => item.season.id === context.seasonId);
  const team = tree?.teams.find(item => item.id === context.teamId);
  const link = auditState.maps.linkByPlayer.get(context.playerId);
  const user = link?.uid ? auditState.maps.userByUid.get(link.uid) : null;
  if (!team || !link || link.status !== "active" || !user)
    throw new Error("Captain needs one active account link before access can be synchronized.");
  const memberRef = doc(db, "seasons", context.seasonId, "members", link.uid);
  const teamRef = doc(db, "seasons", context.seasonId, "teams", context.teamId);
  const batch = writeBatch(db);
  const memberSnapshot = await getDoc(memberRef), member = memberSnapshot.data() || {};
  const roles = [...new Set([...parseList(member.roles), "player", "captain"])];
  const teamIds = [...new Set([...parseList(member.teamIds), context.teamId])];
  batch.set(memberRef, {
    uid: link.uid, playerId: context.playerId, roles, teamIds, status: "active",
    assignedByUid: auth.currentUser.uid, assignedAt: serverTimestamp(), updatedAt: serverTimestamp()
  }, { merge: true });
  batch.set(teamRef, {
    captainPlayerIds: [context.playerId], captainUids: [link.uid],
    captainNameSnapshot: user.displayName || team.captainNameSnapshot || context.playerId,
    updatedByUid: auth.currentUser.uid, updatedAt: serverTimestamp()
  }, { merge: true });
  await batch.commit();
}

async function syncRosterIdentity(context) {
  if (!context.targetPlayerId || !context.targetName)
    throw new Error("The correct Player Master identity could not be resolved.");
  const operationalRef = doc(db, "seasons", context.seasonId, "rosterAssignments", context.assignmentId);
  await runTransaction(db, async transaction => {
    const operationalSnapshot = await transaction.get(operationalRef);
    if (!operationalSnapshot.exists()) throw new Error("The roster assignment no longer exists.");
    const current = operationalSnapshot.data();
    if ((current.playerId || "") !== (context.sourcePlayerId || "") ||
      normalizeName(current.playerNameSnapshot) !== normalizeName(context.storedName))
      throw new Error("The roster assignment changed after the audit. Run the audit again.");
    const correction = {
      playerId: context.targetPlayerId,
      playerNameSnapshot: context.targetName,
      updatedByUid: auth.currentUser.uid,
      updatedAt: serverTimestamp()
    };
    if ((current.originalPlayerId || "") === (context.sourcePlayerId || "") &&
      normalizeName(current.originalPlayerNameSnapshot) === normalizeName(context.storedName)) {
      correction.originalPlayerId = context.targetPlayerId;
      correction.originalPlayerNameSnapshot = context.targetName;
    }
    if ((current.replacementPlayerId || "") === (context.sourcePlayerId || "") &&
      normalizeName(current.replacementPlayerNameSnapshot) === normalizeName(context.storedName)) {
      correction.replacementPlayerId = context.targetPlayerId;
      correction.replacementPlayerNameSnapshot = context.targetName;
    }
    transaction.set(operationalRef, correction, { merge: true });
  });
}

async function syncLineupPlayerIdentity(context) {
  if (!context.targetPlayerId || !context.targetName)
    throw new Error("The correct Player Master identity could not be resolved.");
  const lineupRef = doc(db, "seasons", context.seasonId, "matchups", context.matchupId, "lineups", context.teamId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(lineupRef);
    if (!snapshot.exists()) throw new Error("The lineup no longer exists.");
    const lines = parseList(snapshot.data().lines).map(line => ({ ...line }));
    const line = lines[Number(context.lineIndex)];
    const idField = `player${Number(context.playerNumber)}Id`;
    const nameField = `player${Number(context.playerNumber)}Name`;
    if (!line || (line[idField] || "") !== (context.sourcePlayerId || "") ||
      normalizeName(line[nameField]) !== normalizeName(context.storedName))
      throw new Error("The lineup changed after the audit. Run the audit again.");
    line[idField] = context.targetPlayerId;
    line[nameField] = context.targetName;
    transaction.set(lineupRef, {
      lines,
      identityCorrectedByUid: auth.currentUser.uid,
      identityCorrectedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  });
}

async function syncLineMatchPlayerIdentity(context) {
  if (!context.targetPlayerId || !context.targetName)
    throw new Error("The correct Player Master identity could not be resolved.");
  const operationalRef = doc(db, "seasons", context.seasonId, "matchups", context.matchupId, "lineMatches", context.lineMatchId);
  await runTransaction(db, async transaction => {
    const operationalSnapshot = await transaction.get(operationalRef);
    if (!operationalSnapshot.exists()) throw new Error("The operational line match no longer exists.");
    const field = `${context.side}Players`;
    const players = parseList(operationalSnapshot.data()[field]).map(player => ({ ...player }));
    const player = players[Number(context.playerIndex)];
    const storedName = player?.nameSnapshot || player?.playerNameSnapshot || player?.name || "";
    if (!player || (player.playerId || "") !== (context.sourcePlayerId || "") ||
      normalizeName(storedName) !== normalizeName(context.storedName))
      throw new Error("The line match changed after the audit. Run the audit again.");
    player.playerId = context.targetPlayerId;
    player.nameSnapshot = context.targetName;
    if ("playerNameSnapshot" in player) player.playerNameSnapshot = context.targetName;
    if ("name" in player) player.name = context.targetName;
    const correction = {
      [field]: players,
      identityCorrectedByUid: auth.currentUser.uid,
      identityCorrectedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    transaction.set(operationalRef, correction, { merge: true });
  });
}

const repairs = {
  syncPublicPlayer, syncEmailIndex, syncAccountTree, syncPrivateAccount,
  syncMembershipIdentity, syncCaptainAccess, syncRosterIdentity,
  syncLineupPlayerIdentity, syncLineMatchPlayerIdentity
};

function renderAudit() {
  const panel = $("#identityAuditResults"), summary = $("#identityAuditSummary");
  if (!panel || !summary || !auditState) return;
  const errors = auditState.issues.filter(item => item.severity === "error").length;
  const warnings = auditState.issues.filter(item => item.severity === "warning").length;
  summary.innerHTML = `<b>${auditState.issues.length ? `${errors} conflicts · ${warnings} warnings` : "All checked identity trees are synchronized"}</b>
    <span>${auditState.counts.players} public players · ${auditState.counts.privatePlayers} private masters · ${auditState.counts.emailIndexes} email indexes · ${auditState.counts.users} users · ${auditState.counts.seasons} operational seasons · ${auditState.counts.publicSeasons} public seasons · ${auditState.counts.teams} operational teams · ${auditState.counts.publicTeams} public teams · ${auditState.counts.rosterAssignments} roster rows · ${auditState.counts.lineups} lineups · ${auditState.counts.lineMatches} line matches</span>
    <small>Scanned ${esc(auditState.scannedAt.toLocaleString())}. No data was changed by the audit.${auditReadOnly ? " Migration-readiness mode disables every repair action." : ""}</small>`;
  panel.innerHTML = auditState.issues.length ? auditState.issues.map(item => `
    <article class="identity-audit-row ${item.severity}">
      <div><span class="badge ${item.severity === "error" ? "red" : "orange"}">${esc(item.severity)}</span>
        <b>${esc(item.title)}</b><p>${esc(item.detail)}</p></div>
      ${item.repair && !auditReadOnly ? `<button type="button" class="secondary compact-button" data-identity-repair="${esc(item.id)}">Repair</button>` : `<span class="identity-manual-review">${auditReadOnly ? "Read-only finding" : "Manual review"}</span>`}
    </article>`).join("") :
    '<div class="empty-state compact"><b>Identity trees are synchronized</b><p>No Player Master, email-index, account-link, registration, membership, captain, roster, lineup, line-match, or public-parity conflicts were found.</p></div>';
}

async function runAudit(options = {}) {
  if (auditRunning || !isSuperAdmin()) return;
  auditRunning = true;
  auditReadOnly = options.readOnly === true;
  const buttons = [$("#runIdentityAudit"), $("#runMigrationReadinessAudit")].filter(Boolean);
  const panel = $("#identityAuditResults");
  buttons.forEach(button => { button.disabled = true; });
  panel.innerHTML = '<div class="empty-state compact"><b>Scanning live Firebase identity trees…</b><p>This is one controlled read of each required collection.</p></div>';
  try {
    auditState = await collectAudit();
    renderAudit();
  } catch (error) {
    panel.innerHTML = `<div class="empty-state compact"><b>Identity audit failed</b><p>${esc(error.message || "Refresh and try again.")}</p></div>`;
  } finally {
    auditRunning = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}

async function repairIssue(issueId) {
  const record = auditState?.issues.find(item => item.id === issueId);
  if (!record?.repair || !repairs[record.repair] || !isSuperAdmin()) return;
  if (!window.confirm(`Repair this identity mismatch?\n\n${record.title}\n${record.detail}\n\nOnly the records named by this issue will be updated.`)) return;
  const button = document.querySelector(`[data-identity-repair="${CSS.escape(issueId)}"]`);
  if (button) button.disabled = true;
  try {
    await repairs[record.repair](record.context);
    window.alphaOpenAuthUI?.showMessage("Identity records repaired. Running the audit again…");
    await runAudit();
  } catch (error) {
    window.alphaOpenAuthUI?.showMessage(error.message || "Identity repair failed.");
    if (button) button.disabled = false;
  }
}

$("#runIdentityAudit")?.addEventListener("click", () => runAudit());
$("#runMigrationReadinessAudit")?.addEventListener("click", () => runAudit({ readOnly: true }));
$("#historicalPlayerIdForm")?.addEventListener("submit", reconcileHistoricalPlayerId);
$("#identityAuditResults")?.addEventListener("click", event => {
  const button = event.target.closest("[data-identity-repair]");
  if (button) repairIssue(button.dataset.identityRepair);
});
window.addEventListener("alphaopen:admin-panel-changed", event => {
  if (event.detail?.panel === "identity-audit" && !auditState) runAudit();
});
if (document.querySelector("[data-admin-panel='identity-audit'].active")) runAudit();
