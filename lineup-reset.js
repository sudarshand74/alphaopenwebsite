import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {collection, doc, getDoc, getDocs} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {auth, db} from "./firebase-client.js?v=4";
import {listLineupWorkflowSeasons, newWorkflowOperationId, resetApprovedLineups} from "./lineup-workflow-client.js?v=2";
import {loadCanonicalPlayers} from "./player-identity.js?v=5";

const byId = (id) => document.getElementById(id);
let state = null;

function option(value, label) {
  return Object.assign(document.createElement("option"), {value, textContent: label});
}

function setMessage(value) {
  byId("lineupResetMessage").textContent = value;
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
  const name = snapshotName || state?.players?.get(playerId)?.displayName || "";
  return name && playerId && name !== playerId ? `${name} (${playerId})` : name || playerId || "—";
}

function weekKey(matchup) {
  const stage = String(matchup.stage || "").toLowerCase();
  if (stage === "final") return "F";
  if (stage === "semifinal") return "SF";
  if (["quarterfinal", "qualifier"].includes(stage)) return "QF";
  const number = String(matchup.weekId || "").match(/\d+/);
  return number ? `W${number[0]}` : String(matchup.weekId || "");
}

function weekLabel(key) {
  return ({QF: "Qualifier", SF: "Semifinals", F: "Final"})[key] || `Week ${String(key).replace("W", "")}`;
}

function hasScoreActivity(line = {}) {
  const scheduleStatus = String(line.scheduleStatus || "").toLowerCase();
  const scoreStatus = String(line.scoreStatus || "").toLowerCase();
  const sets = Array.isArray(line.sets) ? line.sets : [];
  return ["inprogress", "completed"].includes(scheduleStatus) ||
    ["inprogress", "submitted", "awaitingconfirmation", "confirmed", "disputed", "ecreview", "published", "locked", "completed"].includes(scoreStatus) ||
    sets.some((set) => Number(set?.home ?? set?.homeGames ?? 0) || Number(set?.away ?? set?.awayGames ?? 0)) ||
    Number(line.homePoints || 0) !== 0 ||
    Number(line.awayPoints || 0) !== 0 ||
    Boolean(line.winnerTeamId) ||
    Boolean(line.completedAt);
}

function clearMatchup(message) {
  state.selected = null;
  byId("lineupResetMatchup").hidden = true;
  byId("resetApprovedLineups").disabled = true;
  byId("lineupResetReason").value = "";
  byId("lineupResetConfirmation").value = "";
  byId("lineupResetAcknowledgement").checked = false;
  if (message) setMessage(message);
}

function renderLineup(teamId, teamLabel, lineup, targetId) {
  const target = byId(targetId);
  target.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "approval-team-heading";
  heading.innerHTML = `<div><span>${targetId.includes("Home") ? "Home Team" : "Away Team"}</span><h3>${teamLabel}</h3></div><span class="badge lime">Approved</span>`;
  target.appendChild(heading);
  const meta = document.createElement("p");
  meta.className = "approval-lineup-meta";
  const submitted = lineup.submittedByNameSnapshot || lineup.submittedByUid || "Unknown";
  const approved = lineup.approvedByNameSnapshot || lineup.approvedByUid || "Unknown";
  meta.textContent = `Revision ${lineup.revisionNumber || 1} · Submitted by ${submitted} · Approved by ${approved}`;
  target.appendChild(meta);
  for (let number = 1; number <= 5; number += 1) {
    const line = (lineup.lines || []).find((item) => Number(item.lineNumber) === number);
    const row = document.createElement("div");
    row.className = "approval-line-row";
    row.innerHTML = `<b>L${number}</b><span>${line ? `${playerLabel(line, 1)} / ${playerLabel(line, 2)}` : "—"}</span><strong>${line ? `SOR ${line.sor}` : "—"}</strong>`;
    target.appendChild(row);
  }
}

async function selectMatchup() {
  const matchupId = byId("lineupResetHomeTeam").value;
  if (!matchupId) return clearMatchup("Select an approved matchup by Home Team.");
  const matchup = state.matchups.find((item) => item.matchupId === matchupId);
  if (!matchup) return clearMatchup("The selected fully approved matchup is no longer available.");
  setMessage("Loading both approved lineups and Match Line statuses...");
  const base = ["seasons", state.seasonId, "matchups", matchup.matchupId];
  const [homeSnapshot, awaySnapshot, lineSnapshots] = await Promise.all([
    getDoc(doc(db, ...base, "lineups", matchup.homeTeamId)),
    getDoc(doc(db, ...base, "lineups", matchup.awayTeamId)),
    getDocs(collection(db, ...base, "lineMatches")),
  ]);
  if (!homeSnapshot.exists() || !awaySnapshot.exists()) return clearMatchup("Both approved lineup documents are required.");
  const lines = lineSnapshots.docs.map((item) => ({lineMatchId: item.id, ...item.data()}));
  const blocked = lines.find(hasScoreActivity);
  state.selected = {matchup, home: homeSnapshot.data(), away: awaySnapshot.data(), lines, blocked};
  byId("lineupResetMatchup").hidden = false;
  byId("lineupResetMatchupId").textContent = matchup.matchupId;
  byId("lineupResetAwayTeam").textContent = teamName(matchup.awayTeamId, matchup.awayTeamNameSnapshot);
  renderLineup(matchup.homeTeamId, teamName(matchup.homeTeamId, matchup.homeTeamNameSnapshot), state.selected.home, "lineupResetHomeLineup");
  renderLineup(matchup.awayTeamId, teamName(matchup.awayTeamId, matchup.awayTeamNameSnapshot), state.selected.away, "lineupResetAwayLineup");
  const eligibility = byId("lineupResetEligibility");
  eligibility.className = `info-box ${blocked ? "invalid" : "valid"}`;
  eligibility.textContent = blocked
    ? `Reset unavailable: ${blocked.lineMatchId} has score activity.`
    : "Eligible for reset: no Match Line has score activity.";
  updateResetButton();
  setMessage(blocked ? "This matchup cannot be reset from the approval workflow." : "Review both lineups and provide the exception reason.");
}

function populateHomeTeams() {
  const week = byId("lineupResetWeek").value;
  const eligible = state.matchups.filter((matchup) => !week || weekKey(matchup) === week);
  byId("lineupResetHomeTeam").replaceChildren(
    option("", "Select Home Team"),
    ...eligible.map((matchup) => option(
      matchup.matchupId,
      `${teamName(matchup.homeTeamId, matchup.homeTeamNameSnapshot)} · ${matchup.matchupId}`,
    )),
  );
  clearMatchup(eligible.length ? "Select a Home Team to review both approved lineups." : "No fully approved matchups are available for this week.");
}

function updateResetButton() {
  const selected = state?.selected;
  const valid = selected &&
    !selected.blocked &&
    byId("lineupResetReason").value.trim() &&
    byId("lineupResetAcknowledgement").checked &&
    byId("lineupResetConfirmation").value.trim() === selected.matchup.matchupId;
  byId("resetApprovedLineups").disabled = !valid;
}

async function performReset(event) {
  event.preventDefault();
  const selected = state?.selected;
  if (!selected || selected.blocked) return;
  if (!window.confirm("Reset both fully approved lineups? Both teams must submit and be approved again.")) return;
  const button = byId("resetApprovedLineups");
  button.disabled = true;
  setMessage("Rechecking scores and resetting both lineups in a secure Firestore transaction...");
  try {
    await resetApprovedLineups({
      seasonId: state.seasonId,
      matchupId: selected.matchup.matchupId,
      reason: byId("lineupResetReason").value.trim(),
      confirmation: byId("lineupResetConfirmation").value.trim(),
      operationId: newWorkflowOperationId("reset"),
    });
    setMessage(`${selected.matchup.matchupId} was reset. Both teams are now Pending Submission.`);
    await loadSeason(auth.currentUser, state.seasonId);
  } catch (error) {
    setMessage(`Reset failed: ${error.message}`);
    updateResetButton();
  }
}

async function loadSeason(user, seasonId) {
  setMessage("Loading fully approved matchups for the selected season...");
  const seasonRef = doc(db, "seasons", seasonId);
  const [seasonSnapshot, assignmentSnapshot, userSnapshot, teamsSnapshot, matchupSnapshot, players] = await Promise.all([
    getDoc(seasonRef),
    getDoc(doc(seasonRef, "approverAssignments", user.uid)),
    getDoc(doc(db, "users", user.uid)),
    getDocs(collection(seasonRef, "teams")),
    getDocs(collection(seasonRef, "matchups")),
    loadCanonicalPlayers(),
  ]);
  let effectiveAssignmentSnapshot = assignmentSnapshot;
  if (!effectiveAssignmentSnapshot.exists()) {
    effectiveAssignmentSnapshot = await getDoc(doc(seasonRef, "approverAssignments", `season_${user.uid}`));
  }
  const userRecord = userSnapshot.data() || {};
  const superAdmin = userRecord.globalRoles?.includes("superAdmin") ||
    user.email?.toLowerCase() === "sudarshandesai74@gmail.com";
  const approver = effectiveAssignmentSnapshot.exists() &&
    effectiveAssignmentSnapshot.data().status === "active" &&
    effectiveAssignmentSnapshot.data().approverUid === user.uid;
  if (!superAdmin && !approver) throw new Error("Only an active Neutral Approver or Super Admin can reset approved lineups.");
  state = {
    ...state,
    seasonId,
    season: seasonSnapshot.data() || {},
    teams: teamsSnapshot.docs.map((item) => ({teamId: item.id, ...item.data()})),
    players,
    matchups: matchupSnapshot.docs
      .map((item) => ({matchupId: item.id, ...item.data()}))
      .filter((matchup) => matchup.lineupApprovalStatus === "fullyApproved" ||
        (matchup.homeLineupStatus === "approved" && matchup.awayLineupStatus === "approved")),
    selected: null,
  };
  const weeks = [...new Set(state.matchups.map(weekKey))].sort((a, b) =>
    ({QF: 80, SF: 90, F: 100}[a] || Number(a.replace("W", ""))) -
    ({QF: 80, SF: 90, F: 100}[b] || Number(b.replace("W", ""))));
  byId("lineupResetWeek").replaceChildren(option("", "All Weeks"), ...weeks.map((key) => option(key, weekLabel(key))));
  populateHomeTeams();
}

async function load(user) {
  setMessage("Loading seasons available to this approver...");
  const workflowSeasons = await listLineupWorkflowSeasons();
  const seasons = Array.isArray(workflowSeasons.seasons) ? workflowSeasons.seasons : [];
  if (!seasons.length) throw new Error("No season is available for approved-lineup reset.");
  state = {availableSeasons: seasons, selected: null};
  const seasonSelect = byId("lineupResetSeason");
  seasonSelect.replaceChildren(...seasons.map((season) =>
    option(season.seasonId, `${season.name}${season.isCurrent ? " · Current" : ""}`)));
  seasonSelect.disabled = false;
  seasonSelect.value = seasons.find((season) => season.seasonId === workflowSeasons.activeSeasonId)?.seasonId ||
    seasons[0].seasonId;
  await loadSeason(user, seasonSelect.value);
}

byId("lineupResetSeason").addEventListener("change", () =>
  loadSeason(auth.currentUser, byId("lineupResetSeason").value).catch((error) => setMessage(error.message)));
byId("lineupResetWeek").addEventListener("change", populateHomeTeams);
byId("lineupResetHomeTeam").addEventListener("change", () => selectMatchup().catch((error) => setMessage(error.message)));
byId("lineupResetReason").addEventListener("input", updateResetButton);
byId("lineupResetConfirmation").addEventListener("input", updateResetButton);
byId("lineupResetAcknowledgement").addEventListener("change", updateResetButton);
byId("lineupResetForm").addEventListener("submit", performReset);

onAuthStateChanged(auth, (user) => {
  if (!user) return setMessage("Sign in as a Neutral Approver or Super Admin.");
  load(user).catch((error) => setMessage(error.message));
});
