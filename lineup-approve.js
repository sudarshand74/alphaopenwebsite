import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {collection, doc, getDoc, getDocs, onSnapshot} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {auth, db} from "./firebase-client.js?v=4";
import {decideTeamLineup, newWorkflowOperationId} from "./lineup-workflow-client.js?v=2";
import {formattedPlayerLabel, loadCanonicalPlayers} from "./player-identity.js?v=5";

const byId = (id) => document.getElementById(id);
let state = null;
let queueUnsubscribe = null;
let watchedSeasonId = "";
let reloadPending = false;

function setMessage(value) {
  byId("approvalMessage").textContent = value;
}

function teamName(teamId, snapshot) {
  return state?.teams.find((team) => team.teamId === teamId)?.name || snapshot || teamId;
}

function playerLabel(line, number) {
  const playerId = String(line?.[`player${number}Id`] || "").trim();
  const snapshotName = String(
    line?.[`player${number}Name`] ||
    line?.[`player${number}NameSnapshot`] ||
    "",
  ).trim();
  return formattedPlayerLabel(
    playerId,
    line?.[`player${number}Rank`],
    state?.players?.get(playerId)?.displayName,
    state?.rosterNamesById?.get(playerId),
    snapshotName,
  );
}

function normalizeStatus(value) {
  const status = String(value || "");
  if (["submitted", "approved", "rejected", "pendingSubmission"].includes(status)) return status;
  return ["draft", "validationFailed", "systemValidated"].includes(status) ? "pendingSubmission" : "pendingSubmission";
}

function statusLabel(value) {
  return ({
    pendingSubmission: "Pending Submission",
    submitted: "Submitted",
    approved: "Approved",
    rejected: "Returned for Change",
  })[normalizeStatus(value)];
}

function statusBadge(value) {
  return ({
    pendingSubmission: "gray",
    submitted: "orange",
    approved: "lime",
    rejected: "red",
  })[normalizeStatus(value)];
}

function lineupSide(record, sideName) {
  const side = document.createElement("section");
  side.className = "approval-team-side";
  const isHome = sideName === "home";
  const teamId = isHome ? record.matchup.homeTeamId : record.matchup.awayTeamId;
  const teamLabel = teamName(teamId, isHome ? record.matchup.homeTeamNameSnapshot : record.matchup.awayTeamNameSnapshot);
  const teamStatus = isHome ? record.homeStatus : record.awayStatus;
  const lineup = isHome ? record.home : record.away;
  const heading = document.createElement("div");
  heading.className = "approval-team-heading";
  heading.innerHTML = `<div><span>${isHome ? "Home Team" : "Away Team"}</span><h3>${teamLabel}</h3></div><span class="badge ${statusBadge(teamStatus)}">${statusLabel(teamStatus)}</span>`;
  side.appendChild(heading);

  if (!lineup) {
    const sealed = document.createElement("div");
    sealed.className = "approval-lineup-missing";
    sealed.innerHTML = normalizeStatus(teamStatus) === "pendingSubmission"
      ? "<b>Lineup not submitted</b><span>The approval queue is awaiting this team.</span>"
      : "<b>Lineup unavailable</b><span>Reload the approval queue to retrieve the current revision.</span>";
    side.appendChild(sealed);
  } else {
    const meta = document.createElement("p");
    meta.className = "approval-lineup-meta";
    meta.textContent = `Revision ${lineup.revisionNumber || 1} · Submitted by ${lineup.submittedByNameSnapshot || lineup.submittedByUid || "Unknown"}${lineup.submittedAt?.toDate ? ` · ${lineup.submittedAt.toDate().toLocaleString()}` : ""}`;
    side.appendChild(meta);
    for (let number = 1; number <= 5; number += 1) {
      const line = (lineup.lines || []).find((item) => Number(item.lineNumber) === number);
      const row = document.createElement("div");
      row.className = "approval-line-row";
      row.innerHTML = `<b>L${number}</b><span>${line ? `${playerLabel(line, 1)} / ${playerLabel(line, 2)}` : "—"}</span><strong>${line ? `SOR ${line.sor}` : "—"}</strong>`;
      side.appendChild(row);
    }
  }

  const actions = document.createElement("div");
  actions.className = "approval-team-actions";
  const status = normalizeStatus(teamStatus);
  if (lineup && status === "submitted") {
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "secondary danger-button";
    reject.textContent = "Return for Change";
    reject.addEventListener("click", () => decide(record, sideName, "reject", actions));
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "primary";
    approve.textContent = `Approve ${isHome ? "Home" : "Away"}`;
    approve.addEventListener("click", () => decide(record, sideName, "approve", actions));
    actions.append(reject, approve);
  } else if (lineup && status === "approved" && !record.fullyApproved) {
    const reopen = document.createElement("button");
    reopen.type = "button";
    reopen.className = "secondary danger-button";
    reopen.textContent = "Return Approved Lineup";
    reopen.addEventListener("click", () => decide(record, sideName, "reject", actions));
    actions.append(reopen);
  }
  side.appendChild(actions);
  return side;
}

function renderCard(record) {
  const card = document.createElement("article");
  card.className = "dashboard-card approval-matchup-card";
  const head = document.createElement("header");
  head.className = "approval-matchup-head";
  const matchupStatus = record.matchup.lineupApprovalStatus ||
    (record.revealLineups ? "awaitingApproval" : "awaitingSubmission");
  head.innerHTML = `<div class="approval-matchup-title"><span>${record.matchup.weekId || record.matchup.stage || "Matchup"}</span><h2>${record.matchup.matchupId}</h2><p>${teamName(record.matchup.homeTeamId, record.matchup.homeTeamNameSnapshot)} vs ${teamName(record.matchup.awayTeamId, record.matchup.awayTeamNameSnapshot)}</p></div><span class="badge ${matchupStatus === "rejected" ? "red" : record.revealLineups ? "orange" : "gray"}">${matchupStatus === "rejected" ? "Returned for Change" : record.revealLineups ? "Awaiting Approval" : "Awaiting Submission"}</span>`;
  const comparison = document.createElement("div");
  comparison.className = "approval-lineup-comparison";
  comparison.append(lineupSide(record, "home"), lineupSide(record, "away"));
  card.append(head, comparison);
  return card;
}

async function decide(record, sideName, decision, actionPanel) {
  const isHome = sideName === "home";
  const lineup = isHome ? record.home : record.away;
  const teamId = isHome ? record.matchup.homeTeamId : record.matchup.awayTeamId;
  let reason = "";
  if (decision === "reject") {
    reason = window.prompt("Reason for returning this lineup for change:") ?? "";
    if (!reason.trim()) return setMessage("A reason is required to return a lineup.");
  } else {
    const selfApproval = lineup?.submittedByUid === auth.currentUser?.uid;
    const prompt = selfApproval
      ? "You submitted this lineup. Approve the same lineup?"
      : `Approve ${teamName(teamId)} lineup revision ${lineup?.revisionNumber || 1}?`;
    if (!window.confirm(prompt)) return;
  }
  actionPanel.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  setMessage(`${decision === "approve" ? "Approving" : "Returning"} ${teamName(teamId)} in a secure Firestore transaction...`);
  try {
    const result = await decideTeamLineup({
      seasonId: state.seasonId,
      matchupId: record.matchup.matchupId,
      teamId,
      decision,
      reason: reason.trim(),
      operationId: newWorkflowOperationId(decision),
    });
    setMessage(`${teamName(teamId)} is ${result.status === "approved" ? "approved" : "returned for change"}.`);
    await load(auth.currentUser, {preserveWatcher: true});
  } catch (error) {
    actionPanel.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    setMessage(`Decision failed: ${error.message}`);
  }
}

function watchApprovalQueue(seasonRef, user) {
  if (watchedSeasonId === seasonRef.id && queueUnsubscribe) return;
  queueUnsubscribe?.();
  watchedSeasonId = seasonRef.id;
  let first = true;
  queueUnsubscribe = onSnapshot(collection(seasonRef, "matchups"), () => {
    if (first) {
      first = false;
      return;
    }
    if (reloadPending) return;
    reloadPending = true;
    load(user, {preserveWatcher: true})
      .catch((error) => setMessage(`Approval queue refresh failed: ${error.message}`))
      .finally(() => { reloadPending = false; });
  }, (error) => setMessage(`Live approval updates unavailable: ${error.message}`));
}

async function load(user, options = {}) {
  setMessage("Reading active-season approvals from Firebase...");
  const control = await getDoc(doc(db, "systemConfig", "seasonControl"));
  const seasonId = control.data()?.activeSeasonId;
  if (!seasonId) throw new Error("No active season is configured.");
  const seasonRef = doc(db, "seasons", seasonId);
  const [seasonSnapshot, assignmentSnapshot, userSnapshot, teamsSnapshot, matchupsSnapshot, rosterSnapshot, players] = await Promise.all([
    getDoc(seasonRef),
    getDoc(doc(seasonRef, "approverAssignments", user.uid)),
    getDoc(doc(db, "users", user.uid)),
    getDocs(collection(seasonRef, "teams")),
    getDocs(collection(seasonRef, "matchups")),
    getDocs(collection(seasonRef, "rosterAssignments")),
    loadCanonicalPlayers(),
  ]);
  let effectiveAssignmentSnapshot = assignmentSnapshot;
  if (!effectiveAssignmentSnapshot.exists()) {
    effectiveAssignmentSnapshot = await getDoc(doc(seasonRef, "approverAssignments", `season_${user.uid}`));
  }
  const userRecord = userSnapshot.data() || {};
  const isSuperAdmin = userRecord.globalRoles?.includes("superAdmin") ||
    user.email?.toLowerCase() === "sudarshandesai74@gmail.com";
  const activeApprover = effectiveAssignmentSnapshot.exists() &&
    effectiveAssignmentSnapshot.data().status === "active" &&
    effectiveAssignmentSnapshot.data().approverUid === user.uid;
  if (!isSuperAdmin && !activeApprover) throw new Error("You are not an active lineup approver for this season.");
  state = {
    seasonId,
    season: seasonSnapshot.data() || {},
    teams: teamsSnapshot.docs.map((item) => ({teamId: item.id, ...item.data()})),
    matchups: matchupsSnapshot.docs.map((item) => ({matchupId: item.id, ...item.data()})),
    rosterNamesById: new Map(rosterSnapshot.docs.map((item) => [
      item.data().playerId,
      item.data().playerNameSnapshot,
    ])),
    players,
  };
  byId("approvalSeason").replaceChildren(Object.assign(document.createElement("option"), {
    value: seasonId,
    textContent: state.season.name || seasonId,
  }));
  byId("approvalRoleBadge").textContent = isSuperAdmin ? "Super Admin" : "Neutral Approver";

  const queueRecords = [];
  for (const matchup of state.matchups) {
    const homeStatus = normalizeStatus(matchup.homeLineupStatus);
    const awayStatus = normalizeStatus(matchup.awayLineupStatus);
    const fullyApproved = homeStatus === "approved" && awayStatus === "approved";
    const revealLineups = ["submitted", "approved"].includes(homeStatus) ||
      ["submitted", "approved"].includes(awayStatus);
    if (fullyApproved || !revealLineups) continue;
    const [homeSnapshot, awaySnapshot] = await Promise.all([
      ["submitted", "approved"].includes(homeStatus)
        ? getDoc(doc(seasonRef, "matchups", matchup.matchupId, "lineups", matchup.homeTeamId))
        : Promise.resolve(null),
      ["submitted", "approved"].includes(awayStatus)
        ? getDoc(doc(seasonRef, "matchups", matchup.matchupId, "lineups", matchup.awayTeamId))
        : Promise.resolve(null),
    ]);
    queueRecords.push({
      matchup,
      homeStatus,
      awayStatus,
      fullyApproved,
      revealLineups,
      home: homeSnapshot?.exists() ? homeSnapshot.data() : null,
      away: awaySnapshot?.exists() ? awaySnapshot.data() : null,
    });
  }
  queueRecords.sort((a, b) =>
    String(a.matchup.weekId || "").localeCompare(String(b.matchup.weekId || ""), undefined, {numeric: true}) ||
    a.matchup.matchupId.localeCompare(b.matchup.matchupId));
  const queue = byId("approvalQueue");
  queue.replaceChildren();
  if (!queueRecords.length) {
    const empty = document.createElement("div");
    empty.className = "dashboard-card empty-state";
    empty.innerHTML = "<b>No lineups awaiting approval</b><p>Fully approved matchups are available from Reset Approved Lineup.</p>";
    queue.appendChild(empty);
  } else {
    queueRecords.forEach((record) => queue.appendChild(renderCard(record)));
  }
  const submittedCount = queueRecords.reduce((count, record) =>
    count + (record.homeStatus === "submitted" ? 1 : 0) + (record.awayStatus === "submitted" ? 1 : 0), 0);
  setMessage(`${submittedCount} submitted lineup${submittedCount === 1 ? "" : "s"} across ${queueRecords.length} matchup${queueRecords.length === 1 ? "" : "s"}.`);
  if (!options.preserveWatcher) watchApprovalQueue(seasonRef, user);
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    queueUnsubscribe?.();
    queueUnsubscribe = null;
    watchedSeasonId = "";
    byId("approvalRoleBadge").textContent = "Sign in required";
    setMessage("Sign in as an active Neutral Approver or Super Admin.");
    return;
  }
  load(user).catch((error) => {
    byId("approvalRoleBadge").textContent = "Access unavailable";
    setMessage(error.message);
    byId("approvalQueue").innerHTML = `<div class="dashboard-card empty-state"><b>Approval queue unavailable</b><p>${error.message}</p></div>`;
  });
});
