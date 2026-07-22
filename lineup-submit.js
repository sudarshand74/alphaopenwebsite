import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, getFirestore, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  projectId: "alphaopen-development-2026",
  appId: "1:128657830722:web:07c8c84d0386b5b11c4edb",
  storageBucket: "alphaopen-development-2026.firebasestorage.app",
  apiKey: "AIzaSyCBxY1bOkhALp1W_1yXFmDo9jdFhRNQqIY",
  authDomain: "alphaopen-development-2026.firebaseapp.com",
  messagingSenderId: "128657830722"
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
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
function isManager(user) {
  return user.email && user.email.toLowerCase() === "sudarshandesai74@gmail.com" ||
    Boolean(window.alphaOpenAuthorization && window.alphaOpenAuthorization.access && window.alphaOpenAuthorization.access.includes("ec"));
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
function weekLabel(key) { return ["QF", "SF", "F"].includes(key) ? key : "Week" + key.replace("W", ""); }
function activeRoster(teamId) {
  return state.assignments.filter(item => item.teamId === teamId && item.status === "active").sort((a, b) => Number(a.rankNumber) - Number(b.rankNumber));
}
function selectedMatchup() { return state.matchups.find(item => item.matchupId === byId("lineupMatchup").value); }

async function load(user) {
  status("Reading the active season from Firebase...");
  const control = await getDoc(doc(db, "systemConfig", "seasonControl"));
  const seasonId = control.data() && control.data().activeSeasonId;
  if (!seasonId) throw new Error("No active season is configured.");
  const seasonRef = doc(db, "seasons", seasonId);
  const results = await Promise.all([
    getDoc(seasonRef),
    getDoc(doc(seasonRef, "members", user.uid)),
    getDocs(collection(seasonRef, "teams")),
    getDocs(collection(seasonRef, "rosterAssignments")),
    getDocs(collection(seasonRef, "matchups"))
  ]);
  if (!results[0].exists()) throw new Error("The configured active season does not exist.");
  let approver = null;
  const approverAccess = window.alphaOpenAuthorization && window.alphaOpenAuthorization.access && window.alphaOpenAuthorization.access.includes("approver");
  if (approverAccess && !isManager(user)) {
    const approverSnapshot = await getDoc(doc(seasonRef, "approverAssignments", user.uid));
    approver = approverSnapshot.exists() ? approverSnapshot.data() : null;
  }
  state = {
    seasonId,
    season: results[0].data(),
    member: results[1].exists() ? results[1].data() : null,
    approver,
    teams: results[2].docs.map(item => ({ teamId: item.id, ...item.data() })),
    assignments: results[3].docs.map(item => ({ assignmentId: item.id, ...item.data() })),
    matchups: results[4].docs.map(item => ({ matchupId: item.id, ...item.data() }))
  };
  const authorization = window.alphaOpenAuthorization || {};
  const playerId = String(authorization.playerId || state.member && state.member.playerId || "").trim();
  const captainTeamsFromTeamRecords = state.teams.filter(team =>
    (Array.isArray(team.captainUids) && team.captainUids.includes(user.uid)) ||
    (playerId && Array.isArray(team.captainPlayerIds) && team.captainPlayerIds.includes(playerId))
  ).map(team => team.teamId);
  const captainTeamsFromMember = Array.isArray(state.member && state.member.teamIds) ? state.member.teamIds : [];
  state.captainTeamIds = [...new Set(captainTeamsFromTeamRecords.length ? captainTeamsFromTeamRecords : captainTeamsFromMember)];
  byId("lineupSeason").replaceChildren(option(seasonId, state.season.name || seasonId));
  const eligible = state.matchups.filter(item => !["completed", "cancelled"].includes(String(item.status).toLowerCase()));
  const teamIds = isManager(user) || isApprover(user)
    ? [...new Set(eligible.flatMap(item => [item.homeTeamId, item.awayTeamId]))]
    : state.captainTeamIds;
  const weeks = [...new Set(eligible.filter(item => [item.homeTeamId, item.awayTeamId].some(id => teamIds.includes(id))).map(weekKey))]
    .sort((a, b) => ({ QF: 80, SF: 90, F: 100 }[a] || Number(a.replace("W", ""))) - ({ QF: 80, SF: 90, F: 100 }[b] || Number(b.replace("W", ""))));
  setOptions(byId("lineupWeek"), "Select week", weeks.map(key => ({ value: key, label: weekLabel(key) })));
  setOptions(byId("lineupTeam"), "Select team", teamIds.map(id => ({ value: id, label: teamName(id) })));
  if (!isManager(user) && !isApprover(user) && teamIds.length === 1) byId("lineupTeam").value = teamIds[0];
  byId("lineupRoleBadge").textContent = isManager(user) ? "EC / Super Admin" : isApprover(user) ? "Season Approver" : "Captain";
  status("Loaded " + (state.season.name || seasonId) + ": " + state.teams.length + " teams · " + state.matchups.length + " matchups · " + state.assignments.length + " roster assignments. Select a week and team.");
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
  renderLines(lineup.exists() ? lineup.data().lines || [] : []);
  status("Status: " + (lineup.exists() ? lineup.data().status : "New draft") + ".");
}
function renderLines(existing) {
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
      setOptions(select, "Select player", roster.map(item => ({ value: item.playerId, label: "R" + item.rankNumber + " · " + (item.playerNameSnapshot || item.playerId) })));
      const saved = existing[index] && existing[index][playerIndex === 0 ? "player1Id" : "player2Id"];
      if (saved) select.value = saved;
      select.addEventListener("change", () => { validation = null; byId("submitLineup").disabled = true; updateSor(); });
    });
    const sor = document.createElement("span"); sor.className = "badge gray"; sor.dataset.sor = ""; sor.textContent = "—";
    row.append(label, first, second, sor); panel.appendChild(row);
  }
  byId("validateLineup").disabled = false;
  byId("saveDraft").disabled = false;
  byId("submitLineup").disabled = true;
  updateSor();
}
function lines() {
  const roster = new Map(activeRoster(byId("lineupTeam").value).map(item => [item.playerId, item]));
  return [...byId("lineupRows").querySelectorAll(".lineup-row")].map((row, index) => {
    const values = [...row.querySelectorAll("select")].map(item => item.value);
    const first = roster.get(values[0]); const second = roster.get(values[1]);
    return { lineNumber: index + 1, player1Id: values[0], player2Id: values[1], player1Name: first ? first.playerNameSnapshot : "", player2Name: second ? second.playerNameSnapshot : "", player1Rank: Number(first ? first.rankNumber : 0), player2Rank: Number(second ? second.rankNumber : 0), sor: Number(first ? first.rankNumber : 0) + Number(second ? second.rankNumber : 0) };
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
  const lineupRef = doc(db, "seasons", state.seasonId, "matchups", matchup.matchupId, "lineups", teamId);
  const matchupRef = doc(db, "seasons", state.seasonId, "matchups", matchup.matchupId);
  await runTransaction(db, async transaction => {
    const current = await transaction.get(lineupRef);
    transaction.set(lineupRef, { seasonId: state.seasonId, matchupId: matchup.matchupId, teamId, status: nextStatus, revisionNumber: Number(current.data() && current.data().revisionNumber || 0) + 1, ruleVersionId: state.season.activeRuleVersionId || "v1", lines: lines(), validation: nextStatus === "draft" ? null : validation, submittedByUid: nextStatus === "submitted" ? user.uid : current.data() && current.data().submittedByUid || null, submittedAt: nextStatus === "submitted" ? serverTimestamp() : current.data() && current.data().submittedAt || null, updatedByUid: user.uid, updatedAt: serverTimestamp() }, { merge: true });
    const lineupStatusField = matchup.homeTeamId === teamId ? "homeLineupStatus" : "awayLineupStatus";
    transaction.update(matchupRef, { [lineupStatusField]: nextStatus === "submitted" ? "submitted" : "draft", updatedAt: serverTimestamp() });
  });
  status(nextStatus === "submitted" ? "Lineup submitted and pending approval." : "Draft lineup saved.");
}

byId("lineupWeek").addEventListener("change", () => resolveContext().catch(error => status(error.message)));
byId("lineupTeam").addEventListener("change", () => resolveContext().catch(error => status(error.message)));
byId("validateLineup").addEventListener("click", validate);
byId("saveDraft").addEventListener("click", () => save("draft").catch(error => status(error.message)));
byId("submitLineup").addEventListener("click", () => save("submitted").catch(error => status(error.message)));
onAuthStateChanged(auth, user => {
  if (!user) { byId("lineupRoleBadge").textContent = "Sign in required"; byId("lineupSeason").replaceChildren(option("", "Sign in required")); status("Sign in to load active-season lineup data."); return; }
  load(user).catch(error => { byId("lineupRoleBadge").textContent = "Load failed"; byId("lineupSeason").replaceChildren(option("", "Firebase load failed")); status("Unable to load lineup data: " + error.message); });
});
