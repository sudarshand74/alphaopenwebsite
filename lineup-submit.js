import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=4";
import { formattedPlayerLabel, resolvedPlayerName, loadCanonicalPlayers, validatePlayerIds } from "./player-identity.js?v=5";
import { newWorkflowOperationId, submitTeamLineup } from "./lineup-workflow-client.js?v=4";

const byId = id => document.getElementById(id);
let state = null;
let validation = null;

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}
function setOptions(select, firstLabel, rows) {
  select.replaceChildren(option("", firstLabel));
  rows.forEach(row => select.appendChild(option(row.value, row.label)));
}
function status(text) { byId("lineupStateMessage").textContent = text; }
function submissionConfirmation(matchup, teamId, visible) {
  const message = byId("lineupSubmissionMessage");
  if (!message) return;
  message.hidden = !visible;
  if (!visible || !matchup) {
    message.textContent = "";
    return;
  }
  const opponentId = matchup.homeTeamId === teamId ? matchup.awayTeamId : matchup.homeTeamId;
  message.textContent = `${weekLabel(weekKey(matchup))} lineup against ${teamName(opponentId)} is submitted, awaiting approval.`;
}
function isManager(user) {
  const authorization = window.alphaOpenAuthorization || {};
  const memberRoles = Array.isArray(state?.member?.roles) ? state.member.roles : [];
  const globalRoles = Array.isArray(state?.userRecord?.globalRoles) ? state.userRecord.globalRoles : [];
  return authorization.role === "Super Admin" ||
    (Array.isArray(authorization.access) && authorization.access.includes("ec")) ||
    memberRoles.includes("ec") ||
    globalRoles.includes("superAdmin");
}
function isApprover(user) {
  return state.approver && state.approver.status === "active" && state.approver.approverUid === user.uid;
}
function isCaptain(teamId) {
  const member = state.member || {};
  return Array.isArray(member.roles) && member.roles.includes("captain") && state.captainTeamIds.includes(teamId);
}
function canManageTeam(user, teamId) { return isManager(user) || isApprover(user) || isCaptain(teamId); }
function teamName(teamId) {
  const team = state.teams.find(item => item.teamId === teamId);
  return team ? team.name : teamId;
}
function weekKey(matchup) {
  const stage = String(matchup.stage || "").toLowerCase();
  if (stage === "final") return "F";
  if (stage === "semifinal") return "SF";
  if (stage === "quarterfinal") return "QF";
  const number = String(matchup.weekId || "").match(/\d+/);
  return number ? "W" + number[0] : String(matchup.weekId || "");
}
function weekLabel(key) {
  return { QF: "Qualifiers", SF: "Semifinals", F: "Finals" }[key] || "Week" + key.replace("W", "");
}
function assignmentTime(item = {}) {
  const value = item.updatedAt || item.reconciledAt || item.createdAt || item.effectiveFrom;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}
function activeRoster(teamId) {
  const byRank = new Map();
  state.assignments
    .filter(item => item.teamId === teamId && item.status === "active")
    .forEach(item => {
      const rank = Number(item.rankNumber), current = byRank.get(rank);
      if (
        !current ||
        assignmentTime(item) > assignmentTime(current) ||
        (assignmentTime(item) === assignmentTime(current) &&
          String(item.assignmentId || "").localeCompare(String(current.assignmentId || "")) > 0)
      ) byRank.set(rank, item);
    });
  return [...byRank.values()].sort((a, b) => Number(a.rankNumber) - Number(b.rankNumber));
}
function rosterPlayerName(item = {}) {
  return resolvedPlayerName(
    item.playerId,
    state?.players?.get(item.playerId)?.displayName,
    item.playerNameSnapshot,
    item.nameSnapshot,
    item.name,
  );
}
function rosterPlayerLabel(item = {}) {
  return formattedPlayerLabel(
    item.playerId,
    item.rankNumber,
    state?.players?.get(item.playerId)?.displayName,
    item.playerNameSnapshot,
    item.nameSnapshot,
    item.name,
  );
}
function selectedMatchup() { return state.matchups.find(item => item.matchupId === byId("lineupMatchup").value); }
function lockedLineupStatus(value) {
  return ["submitted", "approved"].includes(String(value || "").toLowerCase());
}

async function load(user) {
  status("Reading the active season...");
  const control = await getDoc(doc(db, "systemConfig", "seasonControl"));
  const seasonId = control.data() && control.data().activeSeasonId;
  if (!seasonId) throw new Error("No active season is configured.");
  const seasonRef = doc(db, "seasons", seasonId);
  const results = await Promise.all([
    getDoc(seasonRef),
    getDoc(doc(seasonRef, "members", user.uid)),
    getDoc(doc(db, "users", user.uid)),
    getDocs(collection(seasonRef, "teams")),
    getDocs(collection(seasonRef, "rosterAssignments")),
    getDocs(collection(seasonRef, "matchups")),
    loadCanonicalPlayers(),
  ]);
  if (!results[0].exists()) throw new Error("The configured active season does not exist.");
  let approver = null;
  const approverAccess = window.alphaOpenAuthorization && window.alphaOpenAuthorization.access && window.alphaOpenAuthorization.access.includes("approver");
  if (approverAccess && !isManager(user)) {
    let approverSnapshot = await getDoc(doc(seasonRef, "approverAssignments", user.uid));
    if (!approverSnapshot.exists()) approverSnapshot = await getDoc(doc(seasonRef, "approverAssignments", `season_${user.uid}`));
    approver = approverSnapshot.exists() ? approverSnapshot.data() : null;
  }
  state = {
    seasonId,
    season: results[0].data(),
    member: results[1].exists() ? results[1].data() : null,
    userRecord: results[2].exists() ? results[2].data() : null,
    approver,
    teams: results[3].docs.map(item => ({ teamId: item.id, ...item.data() })),
    assignments: results[4].docs.map(item => ({ ...item.data(), assignmentId: item.id })),
    matchups: results[5].docs.map(item => ({ matchupId: item.id, ...item.data() })),
    players: results[6],
  };
  const authorization = window.alphaOpenAuthorization || {};
  const playerId = String(authorization.playerId || state.member && state.member.playerId || "").trim();
  const captainTeamsFromTeamRecords = state.teams.filter(team =>
    (playerId && Array.isArray(team.captainPlayerIds) && team.captainPlayerIds.includes(playerId))
  ).map(team => team.teamId);
  const captainTeamsFromMember = Array.isArray(state.member && state.member.teamIds) ? state.member.teamIds : [];
  const captainTeamsFromAuthorization = Array.isArray(authorization.teamIds) ? authorization.teamIds : [];
  state.captainTeamIds = [...new Set([...captainTeamsFromTeamRecords, ...captainTeamsFromMember, ...captainTeamsFromAuthorization])];
  byId("lineupSeason").replaceChildren(option(seasonId, state.season.name || seasonId));
  const teamIds = isManager(user) || isApprover(user)
    ? [...new Set(state.matchups.flatMap(item => [item.homeTeamId, item.awayTeamId]))]
    : state.captainTeamIds;
  const weeks = [...new Set([
    ...state.matchups.filter(item => [item.homeTeamId, item.awayTeamId].some(id => teamIds.includes(id))).map(weekKey),
    "QF", "SF", "F"
  ])]
    .sort((a, b) => ({ QF: 80, SF: 90, F: 100 }[a] || Number(a.replace("W", ""))) - ({ QF: 80, SF: 90, F: 100 }[b] || Number(b.replace("W", ""))));
  setOptions(byId("lineupWeek"), "Select week", weeks.map(key => ({ value: key, label: weekLabel(key) })));
  setOptions(byId("lineupTeam"), "Select team", teamIds.map(id => ({ value: id, label: teamName(id) })));
  const captainOnly = !isManager(user) && !isApprover(user);
  byId("lineupTeam").disabled = captainOnly;
  if (captainOnly && teamIds.length === 1) byId("lineupTeam").value = teamIds[0];
  byId("lineupRoleBadge").textContent = isManager(user) ? "EC / Super Admin" : isApprover(user) ? "Season Approver" : "Captain";
  if (captainOnly && teamIds.length !== 1) {
    clearBuilder(teamIds.length ? "Your Captain account is linked to multiple teams. Ask the Super Admin to correct the season assignment." : "Your Captain account is not linked to an active-season team. Ask the Super Admin to assign your Player ID as the team's captain.");
    return;
  }
  status("Loaded " + (state.season.name || seasonId) + ": " + state.teams.length + " teams · " + state.matchups.length + " matchups · " + state.assignments.length + " roster assignments. Select a week.");
  const jumpRaw = sessionStorage.getItem("alphaopenLineupJump");
  if (jumpRaw) {
    sessionStorage.removeItem("alphaopenLineupJump");
    const jump = JSON.parse(jumpRaw);
    const teamAllowed = [...byId("lineupTeam").options].some(item => item.value === jump.teamId);
    const weekAllowed = [...byId("lineupWeek").options].some(item => item.value === jump.week);
    if (teamAllowed && weekAllowed && state.matchups.some(item => item.matchupId === jump.matchupId)) {
      byId("lineupTeam").value = jump.teamId;
      byId("lineupWeek").value = jump.week;
      await resolveContext();
    } else status("You are not authorized to submit a lineup for that matchup team.");
  }
}

function clearBuilder(message) {
  submissionConfirmation(null, "", false);
  byId("lineupMatchup").replaceChildren(option("", "Select matchup"));
  byId("lineupMatchupSummary").hidden = true;
  byId("lineupRows").innerHTML = '<div class="empty-state compact"><b>Select a week and team</b></div>';
  byId("validateLineup").disabled = true;
  byId("saveDraft").disabled = true;
  byId("submitLineup").disabled = true;
  status(message);
}
async function resolveContext() {
  validation = null;
  const week = byId("lineupWeek").value;
  const teamId = byId("lineupTeam").value;
  if (!week || !teamId) return clearBuilder("Select a week and team to begin.");
  if (!canManageTeam(auth.currentUser, teamId)) return clearBuilder("You are not authorized to submit a lineup for " + teamName(teamId) + " because you are not that team's captain.");
  const matchup = state.matchups.find(item => weekKey(item) === week && [item.homeTeamId, item.awayTeamId].includes(teamId));
  if (!matchup) return clearBuilder("No matchup exists for that team and week.");
  byId("lineupMatchup").replaceChildren(option(matchup.matchupId, matchup.matchupId));
  const opponentId = matchup.homeTeamId === teamId ? matchup.awayTeamId : matchup.homeTeamId;
  byId("lineupMatchupId").textContent = matchup.matchupId;
  byId("lineupOpponent").textContent = teamName(opponentId);
  byId("lineupMatchupSummary").hidden = false;
  const lineup = await getDoc(doc(db, "seasons", state.seasonId, "matchups", matchup.matchupId, "lineups", teamId));
  const lineupData = lineup.exists() ? lineup.data() : null;
  renderLines(lineupData?.lines || [], lockedLineupStatus(lineupData?.status));
  submissionConfirmation(matchup, teamId, String(lineupData?.status || "").toLowerCase() === "submitted");
  const currentStatus = String(lineupData?.status || "").toLowerCase();
  status(currentStatus === "approved"
    ? "Lineup approved. It is shown read-only and cannot be changed."
    : currentStatus === "submitted"
      ? "Lineup submitted and sealed while it awaits approval."
      : currentStatus === "rejected"
      ? "Lineup rejected: " + (lineupData.rejectionReason || "Changes are required before resubmission.") + " Update, validate, and resubmit it."
      : "Status: " + (lineupData ? lineupData.status : "New draft") + ".");
}
function renderLines(existing, readOnly = false) {
  const teamId = byId("lineupTeam").value;
  const roster = activeRoster(teamId);
  const panel = byId("lineupRows");
  panel.replaceChildren();
  for (let index = 0; index < 5; index += 1) {
    const row = document.createElement("div");
    row.className = "lineup-row";
    row.dataset.line = String(index + 1);
    const label = document.createElement("strong"); label.textContent = "Line " + (index + 1);
    const first = document.createElement("select"); first.dataset.player = "1";
    const second = document.createElement("select"); second.dataset.player = "2";
    [first, second].forEach((select, playerIndex) => {
      setOptions(select, "Select player", roster.map(item => ({ value: item.playerId, label: rosterPlayerLabel(item) })));
      const saved = existing[index] && existing[index][playerIndex === 0 ? "player1Id" : "player2Id"];
      const savedName = existing[index] && existing[index][playerIndex === 0 ? "player1Name" : "player2Name"];
      if (saved && ![...select.options].some(item => item.value === saved)) {
        const savedRank = existing[index]?.[playerIndex === 0 ? "player1Rank" : "player2Rank"];
        select.appendChild(option(
          saved,
          formattedPlayerLabel(saved, savedRank, state?.players?.get(saved)?.displayName, savedName),
        ));
      }
      if (saved) select.value = saved;
      select.disabled = readOnly;
      select.addEventListener("change", () => { validation = null; submissionConfirmation(null, "", false); byId("submitLineup").disabled = true; updateSor(); });
    });
    const sor = document.createElement("span"); sor.className = "badge gray"; sor.dataset.sor = ""; sor.textContent = "—";
    row.append(label, first, second, sor); panel.appendChild(row);
  }
  panel.classList.toggle("lineup-readonly", readOnly);
  byId("validateLineup").disabled = readOnly;
  byId("saveDraft").disabled = readOnly;
  byId("submitLineup").disabled = true;
  updateSor();
}
function lines() {
  const roster = new Map(activeRoster(byId("lineupTeam").value).map(item => [item.playerId, item]));
  return [...byId("lineupRows").querySelectorAll(".lineup-row")].map((row, index) => {
    const values = [...row.querySelectorAll("select")].map(item => item.value);
    const first = roster.get(values[0]); const second = roster.get(values[1]);
    return { lineNumber: index + 1, player1Id: values[0], player2Id: values[1], player1Name: first ? rosterPlayerName(first) : "", player2Name: second ? rosterPlayerName(second) : "", player1Rank: Number(first ? first.rankNumber : 0), player2Rank: Number(second ? second.rankNumber : 0), sor: Number(first ? first.rankNumber : 0) + Number(second ? second.rankNumber : 0) };
  });
}
function updateSor() { lines().forEach((line, index) => { byId("lineupRows").querySelectorAll("[data-sor]")[index].textContent = line.sor || "—"; }); }
function validate() {
  const selected = lines(); const errors = []; const ids = selected.flatMap(line => [line.player1Id, line.player2Id]);
  if (selected.length !== 5) errors.push("Exactly five lines are required.");
  if (ids.some(id => !id)) errors.push("Every line requires two players.");
  if (new Set(ids.filter(Boolean)).size !== 10) errors.push("All ten players must be unique.");
  const limits = { 1: [1, 4], 4: [7, 13], 5: [11, 14] };
  selected.forEach(line => { const limit = limits[line.lineNumber]; if (limit && [line.player1Rank, line.player2Rank].some(rank => rank < limit[0] || rank > limit[1])) errors.push("Line " + line.lineNumber + " requires ranks " + limit[0] + "–" + limit[1] + "."); });
  for (let index = 1; index < selected.length; index += 1) if (selected[index].sor < selected[index - 1].sor) errors.push("Line " + (index + 1) + " SOR cannot be lower than Line " + index + " SOR.");
  validation = { passed: errors.length === 0, errors, checkedAt: new Date(), ruleVersionId: state.season.activeRuleVersionId || "v1" };
  const box = byId("validationBox"); box.classList.toggle("valid", validation.passed); box.classList.toggle("invalid", !validation.passed);
  box.querySelector("b").textContent = validation.passed ? "Validation passed" : "Validation failed";
  box.querySelector("small").textContent = validation.passed ? "All SOR checks passed. Ready to submit." : errors.join(" ");
  byId("submitLineup").disabled = !validation.passed;
}
async function save(nextStatus) {
  if (nextStatus === "submitted" && (!validation || !validation.passed)) throw new Error("Validate the lineup before submission.");
  const matchup = selectedMatchup(); const teamId = byId("lineupTeam").value; const user = auth.currentUser;
  if (!matchup || !teamId) throw new Error("Select a valid week and team matchup.");
  if (!canManageTeam(user, teamId)) throw new Error("You are not authorized to submit a lineup for " + teamName(teamId) + " because you are not that team's captain.");
  const selectedLines = lines();
  const selectedIds = selectedLines.flatMap(line => [line.player1Id, line.player2Id]);
  const canonicalPlayers = await validatePlayerIds(selectedIds);
  selectedLines.forEach(line => {
    const rosterById = new Map(activeRoster(teamId).map((item) => [item.playerId, item]));
    line.player1Name = resolvedPlayerName(
      line.player1Id,
      canonicalPlayers.get(line.player1Id)?.displayName,
      rosterById.get(line.player1Id)?.playerNameSnapshot,
      line.player1Name,
    );
    line.player2Name = resolvedPlayerName(
      line.player2Id,
      canonicalPlayers.get(line.player2Id)?.displayName,
      rosterById.get(line.player2Id)?.playerNameSnapshot,
      line.player2Name,
    );
  });
  if (nextStatus === "submitted") {
    status("Submitting and validating the lineup in a secure Firestore transaction...");
    const result = await submitTeamLineup({
      seasonId: state.seasonId,
      matchupId: matchup.matchupId,
      teamId,
      ruleVersionId: state.season.activeRuleVersionId || "v1",
      lines: selectedLines,
      operationId: newWorkflowOperationId("submit"),
    });
    const side = matchup.homeTeamId === teamId ? "home" : "away";
    matchup[`${side}LineupStatus`] = "submitted";
    matchup[`${side}LineupRevisionNumber`] = result.revisionNumber;
    matchup.lineupApprovalStatus = result.lineupApprovalStatus;
    byId("submitLineup").disabled = true;
    submissionConfirmation(matchup, teamId, true);
    status(`Lineup revision ${result.revisionNumber} submitted and pending approval.`);
    await resolveContext();
    return;
  }
  const lineupRef = doc(db, "seasons", state.seasonId, "matchups", matchup.matchupId, "lineups", teamId);
  const matchupRef = doc(db, "seasons", state.seasonId, "matchups", matchup.matchupId);
  await runTransaction(db, async transaction => {
    const current = await transaction.get(lineupRef);
    if (current.exists() && lockedLineupStatus(current.data().status)) throw new Error("This lineup has been approved and cannot be changed.");
    transaction.set(lineupRef, { seasonId: state.seasonId, matchupId: matchup.matchupId, teamId, status: "draft", revisionNumber: Number(current.data() && current.data().revisionNumber || 0), ruleVersionId: state.season.activeRuleVersionId || "v1", lines: selectedLines, validation: null, submittedByUid: current.data() && current.data().submittedByUid || null, submittedAt: current.data() && current.data().submittedAt || null, rejectionReason: null, rejectedByUid: null, rejectedAt: null, updatedByUid: user.uid, updatedAt: serverTimestamp() }, { merge: true });
    const lineupStatusField = matchup.homeTeamId === teamId ? "homeLineupStatus" : "awayLineupStatus";
    transaction.update(matchupRef, { [lineupStatusField]: "pendingSubmission", updatedAt: serverTimestamp() });
  });
  submissionConfirmation(null, "", false);
  status("Draft lineup saved.");
}

byId("lineupWeek").addEventListener("change", () => resolveContext().catch(error => status(error.message)));
byId("lineupTeam").addEventListener("change", () => resolveContext().catch(error => status(error.message)));
byId("validateLineup").addEventListener("click", validate);
byId("saveDraft").addEventListener("click", () => save("draft").catch(error => status(error.message)));
byId("submitLineup").addEventListener("click", () => save("submitted").catch(error => status(error.message)));
onAuthStateChanged(auth, user => {
  if (!user) { byId("lineupRoleBadge").textContent = "Sign in required"; byId("lineupSeason").replaceChildren(option("", "Sign in required")); status("Sign in to load active-season lineup data."); return; }
  load(user).catch(error => { byId("lineupRoleBadge").textContent = "Load failed"; byId("lineupSeason").replaceChildren(option("", "Season load failed")); status("Unable to load lineup data: " + error.message); });
});
