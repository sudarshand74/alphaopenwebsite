import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, getFirestore, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { calculateMatchScore } from "./score-rules.js?v=1";

const config = {
  projectId: "alphaopen-development-2026",
  appId: "1:128657830722:web:07c8c84d0386b5b11c4edb",
  apiKey: "AIzaSyCBxY1bOkhALp1W_1yXFmDo9jdFhRNQqIY",
  authDomain: "alphaopen-development-2026.firebaseapp.com",
  messagingSenderId: "128657830722"
};
let app;
if (getApps().length) app = getApp();
else app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);
let state;

function byId(id) { return document.getElementById(id); }
function message(value) { byId("matchManagementMessage").textContent = value; }
function isManager(user) {
  if (user.email && user.email.toLowerCase() === "sudarshandesai74@gmail.com") return true;
  const authorization = window.alphaOpenAuthorization;
  return Boolean(authorization && authorization.access && authorization.access.includes("ec"));
}
function playerPair(players) {
  return (players || []).map(function (player) { return player.nameSnapshot || player.playerId; }).join(" / ");
}
function localValue(value) {
  if (!value) return "";
  let date;
  if (value.toDate) date = value.toDate();
  else date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function option(value, label, selected) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  node.selected = Boolean(selected);
  return node;
}
function captainLabel(team) {
  return team.captainNameSnapshot || team.captainName || String(team.name || team.teamId).replace(/^Team\s+/i, "");
}
function renderRecords() {
  const list = byId("matchManagementList");
  if (!list || !state) return;
  const selectedStatus = byId("matchManagementStatus").value || "all";
  const selectedTeam = byId("matchManagementCaptain").value || "all";
  const records = (state.records || []).filter(function (record) {
    const status = record.line.scheduleStatus || "toBeScheduled";
    return ["toBeScheduled", "scheduled"].includes(status) &&
      (selectedStatus === "all" || status === selectedStatus) &&
      (selectedTeam === "all" || record.matchup.homeTeamId === selectedTeam || record.matchup.awayTeamId === selectedTeam);
  });
  list.replaceChildren();
  if (!records.length) {
    list.innerHTML = '<div class="dashboard-card empty-state"><b>No matching line matches</b><p>Try another status or captain. Completed matches are hidden.</p></div>';
  } else records.forEach(function (record) { list.appendChild(renderCard(record)); });
  const statusText = selectedStatus === "all" ? "To Be Scheduled or Scheduled" : selectedStatus === "scheduled" ? "Scheduled" : "To Be Scheduled";
  const team = state.teams.find(function (item) { return item.teamId === selectedTeam; });
  message(records.length + " " + statusText + " line matches" + (team ? " for Captain " + captainLabel(team) : "") + " loaded in date order. Completed matches are hidden.");
}
function readEnteredSets(article) {
  const sets = [];
  for (let index = 0; index < 3; index += 1) {
    const home = article.querySelector('[data-home-set="' + index + '"]').value;
    const away = article.querySelector('[data-away-set="' + index + '"]').value;
    if ((home === "") !== (away === "")) throw new Error("Enter both scores for Set " + (index + 1) + ". Match was not saved.");
    if (home === "" && away === "") continue;
    if (index === 2 && Number(home) === 0 && Number(away) === 0) continue;
    sets.push({ home: Number(home), away: Number(away) });
  }
  return sets;
}
function setVisualStatus(article, status) {
  const select = article.querySelector("[data-status]");
  if (select) select.value = status;
  const badge = article.querySelector(".managed-line-head .badge");
  const labels = { toBeScheduled: "To Be Scheduled", scheduled: "Scheduled", completed: "Completed", canceled: "Canceled" };
  if (badge) badge.textContent = labels[status] || status;
}
function updatePreview(article) {
  const points = article.querySelector("[data-points]");
  try {
    const sets = readEnteredSets(article);
    const result = calculateMatchScore(sets);
    if (!sets.length) {
      points.textContent = "0 – 0 points";
      if (article.querySelector("[data-venue]").value && article.querySelector("[data-played]").value) setVisualStatus(article, "scheduled");
      else setVisualStatus(article, "toBeScheduled");
      return;
    }
    if (!result) {
      points.textContent = "Invalid or incomplete score";
      setVisualStatus(article, "toBeScheduled");
      return;
    }
    points.textContent = result.homePoints + " – " + result.awayPoints + " points";
    setVisualStatus(article, "completed");
  } catch (error) {
    points.textContent = error.message;
    setVisualStatus(article, "toBeScheduled");
  }
}
function renderCard(record) {
  const line = record.line;
  const article = document.createElement("article");
  article.className = "dashboard-card managed-line-card";

  const heading = document.createElement("div");
  heading.className = "managed-line-head";
  const headingCopy = document.createElement("div");
  const context = document.createElement("span");
  context.textContent = (record.matchup.weekId || "") + " · " + record.matchup.matchupId;
  const title = document.createElement("h2");
  title.textContent = "Line " + line.lineNumber + ": " + playerPair(line.homePlayers) + " vs " + playerPair(line.awayPlayers);
  headingCopy.append(context, title);
  const badge = document.createElement("span");
  badge.className = "badge gray";
  badge.textContent = line.scheduleStatus || "toBeScheduled";
  heading.append(headingCopy, badge);

  const form = document.createElement("div");
  form.className = "managed-line-form";
  const venueLabel = document.createElement("label");
  venueLabel.append("Venue");
  const venueSelect = document.createElement("select");
  venueSelect.dataset.venue = "";
  venueSelect.appendChild(option("", "Select venue", !line.venueId));
  state.venues.forEach(function (venue) {
    const venueName = venue.venueName || venue.name || venue.venueId;
    venueSelect.appendChild(option(venue.venueId, venueName, venue.venueId === line.venueId));
  });
  venueLabel.appendChild(venueSelect);

  const dateLabel = document.createElement("label");
  dateLabel.append("Date & time");
  const dateInput = document.createElement("input");
  dateInput.dataset.played = "";
  dateInput.type = "datetime-local";
  dateInput.value = localValue(line.scheduledAt);
  dateLabel.appendChild(dateInput);

  const statusLabel = document.createElement("label");
  statusLabel.append("Match status");
  const statusSelect = document.createElement("select");
  statusSelect.dataset.status = "";
  const currentStatus = line.scheduleStatus || "toBeScheduled";
  [["toBeScheduled", "To Be Scheduled"], ["scheduled", "Scheduled"], ["completed", "Completed"], ["canceled", "Canceled"]].forEach(function (entry) {
    statusSelect.appendChild(option(entry[0], entry[1], entry[0] === currentStatus));
  });
  statusLabel.appendChild(statusSelect);
  form.append(venueLabel, dateLabel, statusLabel);

  const score = document.createElement("div");
  score.className = "managed-score";
  const scoreTitle = document.createElement("b");
  scoreTitle.textContent = "Score";
  score.appendChild(scoreTitle);
  [0, 1, 2].forEach(function (index) {
    const setLabel = document.createElement("label");
    setLabel.append("Set " + (index + 1));
    const homeInput = document.createElement("input");
    homeInput.dataset.homeSet = String(index);
    homeInput.type = "number";
    homeInput.min = "0";
    homeInput.max = index === 2 ? "30" : "7";
    const awayInput = homeInput.cloneNode();
    delete awayInput.dataset.homeSet;
    awayInput.dataset.awaySet = String(index);
    if (line.sets && line.sets[index] && !(Number(line.sets[index].home) === 0 && Number(line.sets[index].away) === 0)) {
      homeInput.value = line.sets[index].home;
      awayInput.value = line.sets[index].away;
    }
    const separator = document.createElement("span");
    separator.textContent = "–";
    setLabel.append(homeInput, separator, awayInput);
    score.appendChild(setLabel);
  });
  const points = document.createElement("div");
  points.dataset.points = "";
  points.textContent = (line.homePoints || 0) + " – " + (line.awayPoints || 0) + " points";
  score.appendChild(points);

  const actions = document.createElement("div");
  actions.className = "approval-card-actions";
  const saveButton = document.createElement("button");
  saveButton.className = "primary";
  saveButton.textContent = "Save schedule & score";
  saveButton.addEventListener("click", function () {
    save(article, record).catch(function (error) { message(error.message); });
  });
  actions.append(saveButton);
  article.append(heading, form, score, actions);
  article.querySelectorAll("[data-home-set], [data-away-set], [data-venue], [data-played]").forEach(function (control) {
    control.addEventListener("input", function () { updatePreview(article); });
    control.addEventListener("change", function () { updatePreview(article); });
  });
  updatePreview(article);
  return article;
}
async function save(article, record) {
  const requestedStatus = article.querySelector("[data-status]").value;
  const venueId = article.querySelector("[data-venue]").value;
  const venue = state.venues.find(function (item) { return item.venueId === venueId; });
  const dateValue = article.querySelector("[data-played]").value;
  let sets;
  try { sets = readEnteredSets(article); }
  catch (error) { setVisualStatus(article, "toBeScheduled"); throw error; }
  const result = calculateMatchScore(sets);
  let finalStatus = "toBeScheduled";
  if (requestedStatus === "canceled") finalStatus = "canceled";
  else {
    if (!dateValue || !venueId) {
      setVisualStatus(article, "toBeScheduled");
      throw new Error("Venue and date/time are required. Match was not saved.");
    }
    if (sets.length && !result) {
      setVisualStatus(article, "toBeScheduled");
      throw new Error("The score is invalid or incomplete. Match was not saved.");
    }
    if (result) finalStatus = "completed";
    else finalStatus = "scheduled";
  }
  let winnerTeamId = null;
  if (result && finalStatus === "completed") {
    if (result.winnerSide === "home") winnerTeamId = record.matchup.homeTeamId;
    else winnerTeamId = record.matchup.awayTeamId;
  }
  let venueName = null;
  if (venue) venueName = venue.venueName || venue.name || venue.venueId;
  let scheduledAt = null;
  if (dateValue) scheduledAt = new Date(dateValue);
  let scoreStatus = "scheduled";
  if (finalStatus === "canceled") scoreStatus = "canceled";
  else if (result) scoreStatus = "published";
  await updateDoc(record.ref, {
    venueId: venueId || null,
    venueNameSnapshot: venueName,
    scheduledAt: scheduledAt,
    sets: sets,
    scheduleStatus: finalStatus,
    scoreStatus: scoreStatus,
    homePoints: finalStatus === "completed" ? result.homePoints : 0,
    awayPoints: finalStatus === "completed" ? result.awayPoints : 0,
    winnerTeamId: winnerTeamId,
    updatedAt: serverTimestamp()
  });
  await load(auth.currentUser);
  if (finalStatus === "completed") message("Match completed.");
  else if (finalStatus === "scheduled") message("Match scheduled.");
  else if (finalStatus === "canceled") message("Match canceled.");
}
async function load(user) {
  message("Loading active-season line matches...");
  const control = await getDoc(doc(db, "systemConfig", "seasonControl"));
  const seasonId = control.data() && control.data().activeSeasonId;
  if (!seasonId) throw new Error("No active season configured.");
  const seasonRef = doc(db, "seasons", seasonId);
  const results = await Promise.all([
    getDoc(seasonRef),
    getDoc(doc(seasonRef, "members", user.uid)),
    getDocs(collection(seasonRef, "teams")),
    getDocs(collection(seasonRef, "matchups")),
    getDocs(collection(db, "venues"))
  ]);
  state = {
    seasonId: seasonId,
    season: results[0].data(),
    member: results[1].data() || {},
    teams: results[2].docs.map(function (item) { return Object.assign({ teamId: item.id }, item.data()); }),
    matchups: results[3].docs.map(function (item) { return Object.assign({ matchupId: item.id }, item.data()); }),
    venues: results[4].docs.map(function (item) { return Object.assign({ venueId: item.id }, item.data()); })
  };
  byId("matchManagementSeason").replaceChildren(option(seasonId, state.season.name || seasonId, true));
  byId("matchManagementRole").textContent = isManager(user) ? "EC / Super Admin" : "Captain";
  let permitted = null;
  if (!isManager(user)) permitted = new Set(state.member.teamIds || []);
  const records = [];
  for (const matchup of state.matchups) {
    if (permitted && !permitted.has(matchup.homeTeamId) && !permitted.has(matchup.awayTeamId)) continue;
    const snapshot = await getDocs(collection(seasonRef, "matchups", matchup.matchupId, "lineMatches"));
    snapshot.docs.forEach(function (item) {
      records.push({ matchup: matchup, line: Object.assign({ lineMatchId: item.id }, item.data()), ref: item.ref });
    });
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  records.sort(function (left, right) {
    let leftDate = null;
    let rightDate = null;
    if (left.line.scheduledAt) leftDate = left.line.scheduledAt.toDate();
    if (right.line.scheduledAt) rightDate = right.line.scheduledAt.toDate();
    function group(date) {
      if (date && date >= today) return 0;
      if (date) return 2;
      return 1;
    }
    const leftGroup = group(leftDate);
    const rightGroup = group(rightDate);
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    if (!leftDate || !rightDate) return 0;
    if (leftGroup === 2) return rightDate - leftDate;
    return leftDate - rightDate;
  });
  state.records = records;
  const captainFilter = byId("matchManagementCaptain"),
    visibleTeams = state.teams.filter(function (team) { return !permitted || permitted.has(team.teamId); }),
    defaultCaptain = permitted && visibleTeams.length ? visibleTeams[0].teamId : "all",
    priorCaptain = captainFilter.dataset.initialized === "true" ? captainFilter.value || defaultCaptain : defaultCaptain;
  captainFilter.replaceChildren(option("all", "All captains", priorCaptain === "all"));
  visibleTeams.sort(function (a, b) { return captainLabel(a).localeCompare(captainLabel(b)); }).forEach(function (team) {
    captainFilter.appendChild(option(team.teamId, captainLabel(team) + " — " + (team.name || team.teamId), team.teamId === priorCaptain));
  });
  if (![...captainFilter.options].some(function (item) { return item.value === priorCaptain; })) captainFilter.value = "all";
  captainFilter.dataset.initialized = "true";
  renderRecords();
}

byId("matchManagementStatus")?.addEventListener("change", renderRecords);
byId("matchManagementCaptain")?.addEventListener("change", renderRecords);

onAuthStateChanged(auth, function (user) {
  if (!user) {
    byId("matchManagementRole").textContent = "Sign in required";
    message("Sign in to manage matches.");
    return;
  }
  load(user).catch(function (error) {
    byId("matchManagementRole").textContent = "Load failed";
    message("Match management failed: " + error.message);
  });
});
