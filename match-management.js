import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=3";
import { calculateMatchScore } from "./score-rules.js?v=1";
import { loadCanonicalPlayers } from "./player-identity.js?v=1";

let state;
const feedbackByLineId = new Map();

function byId(id) { return document.getElementById(id); }
function message(value) { byId("matchManagementMessage").textContent = value; }
function isManager(user) {
  if (user.email && user.email.toLowerCase() === "sudarshandesai74@gmail.com") return true;
  const authorization = window.alphaOpenAuthorization;
  const authorizationRoles = authorization && Array.isArray(authorization.roles) ? authorization.roles : [];
  const membershipRoles = state && state.member && Array.isArray(state.member.roles) ? state.member.roles : [];
  return Boolean(
    authorization && authorization.access && authorization.access.includes("ec") ||
    authorizationRoles.includes("ec") ||
    authorizationRoles.includes("superAdmin") ||
    membershipRoles.includes("ec") ||
    membershipRoles.includes("superAdmin")
  );
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
function setCardFeedback(article, text, tone = "error") {
  const feedback = article.querySelector("[data-save-feedback]");
  if (!feedback) return;
  feedback.textContent = text;
  feedback.className = "managed-save-message " + tone;
}
function captainLabel(team) {
  return team.captainNameSnapshot || team.captainName || String(team.name || team.teamId).replace(/^Team\s+/i, "");
}
function venueFullAddress(venue) {
  if (!venue) return null;
  return venue.fullAddress || [
    venue.address || venue.addressLine1 || venue.address1,
    venue.addressLine2 || venue.address2,
    venue.city,
    venue.state,
    venue.postalCode
  ].filter(Boolean).join(", ") || null;
}
function rosterPlayers(teamId, currentPlayers) {
  const players = new Map();
  (state.rostersByTeam.get(teamId) || []).forEach(function (player) { players.set(player.playerId, player); });
  (currentPlayers || []).forEach(function (player) {
    if (!players.has(player.playerId)) players.set(player.playerId, {
      playerId: player.playerId,
      playerNameSnapshot: player.nameSnapshot || player.playerNameSnapshot || player.playerId,
      rankNumber: player.rankNumber || player.rankSnapshot || null
    });
  });
  return [...players.values()].sort(function (a, b) {
    return Number(a.rankNumber || 99) - Number(b.rankNumber || 99);
  });
}
function playerSelect(side, index, players, selectedId) {
  const select = document.createElement("select");
  select.dataset[side + "Player"] = String(index);
  select.appendChild(option("", "Select player", !selectedId));
  players.forEach(function (player) {
    const name = player.playerNameSnapshot || player.nameSnapshot || player.playerId;
    select.appendChild(option(player.playerId, "R" + (player.rankNumber || "-") + " · " + name + " (" + player.playerId + ")", player.playerId === selectedId));
  });
  return select;
}
function selectedPlayer(article, side, index, teamId, currentPlayers) {
  const select = article.querySelector('[data-' + side + '-player="' + index + '"]');
  const playerId = select && select.value;
  const player = rosterPlayers(teamId, currentPlayers).find(function (item) { return item.playerId === playerId; });
  if (!player) throw new Error("Select all four players. Match was not saved.");
  const canonical = state.canonicalPlayers.get(player.playerId);
  if (!canonical) throw new Error(`${player.playerId} does not exist in Player Master. Match was not saved.`);
  return {
    playerId: player.playerId,
    nameSnapshot: canonical.displayName,
    rankNumber: Number(player.rankNumber || player.rankSnapshot || 0)
  };
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
  const labels = { all: "To Be Scheduled or Scheduled", toBeScheduled: "To Be Scheduled", scheduled: "Scheduled" };
  const team = state.teams.find(function (item) { return item.teamId === selectedTeam; });
  message(records.length + " " + (labels[selectedStatus] || selectedStatus) + " line matches" + (team ? " for Captain " + captainLabel(team) : "") + " loaded in date order. Completed matches are hidden.");
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

  let playerGrid = null;
  if (isManager(auth.currentUser)) {
    title.textContent = "Line " + line.lineNumber + ": " + (record.matchup.homeTeamNameSnapshot || record.matchup.homeTeamId) + " vs " + (record.matchup.awayTeamNameSnapshot || record.matchup.awayTeamId);
    playerGrid = document.createElement("div");
    playerGrid.className = "managed-player-grid";
    const homeRoster = rosterPlayers(record.matchup.homeTeamId, line.homePlayers);
    const awayRoster = rosterPlayers(record.matchup.awayTeamId, line.awayPlayers);
    [0, 1].forEach(function (index) {
      const homeLabel = document.createElement("label");
      homeLabel.append("Home player " + (index + 1), playerSelect("home", index, homeRoster, line.homePlayers && line.homePlayers[index] && line.homePlayers[index].playerId));
      const awayLabel = document.createElement("label");
      awayLabel.append("Away player " + (index + 1), playerSelect("away", index, awayRoster, line.awayPlayers && line.awayPlayers[index] && line.awayPlayers[index].playerId));
      playerGrid.append(homeLabel, awayLabel);
    });
  }

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
  const saveFeedback = document.createElement("span");
  saveFeedback.dataset.saveFeedback = "";
  saveFeedback.className = "managed-save-message";
  const previousFeedback = feedbackByLineId.get(line.lineMatchId);
  if (previousFeedback) {
    saveFeedback.textContent = previousFeedback.text;
    saveFeedback.classList.add(previousFeedback.tone);
  }
  const posterButton = document.createElement("button");
  posterButton.type = "button";
  posterButton.className = "secondary";
  posterButton.textContent = "Preview poster";
  posterButton.disabled = !["scheduled", "completed"].includes(currentStatus);
  posterButton.addEventListener("click", function () {
    const venue = state.venues.find(function (item) { return item.venueId === line.venueId; }) || {};
    const venueAddress = venueFullAddress(venue);
    window.dispatchEvent(new CustomEvent("alphaopen:generate-poster", { detail: {
      seasonName: state.season.name || state.seasonId,
      matchupId: record.matchup.matchupId,
      lineupId: line.lineMatchId || record.matchup.matchupId + "-L" + line.lineNumber,
      weekLabel: record.matchup.weekId || "",
      lineNumber: line.lineNumber,
      homeTeam: (state.teams.find(function (item) { return item.teamId === record.matchup.homeTeamId; }) || {}).name || record.matchup.homeTeamNameSnapshot || record.matchup.homeTeamId,
      awayTeam: (state.teams.find(function (item) { return item.teamId === record.matchup.awayTeamId; }) || {}).name || record.matchup.awayTeamNameSnapshot || record.matchup.awayTeamId,
      homePlayers: (line.homePlayers || []).map(function (player) { return player.nameSnapshot || player.playerId; }),
      awayPlayers: (line.awayPlayers || []).map(function (player) { return player.nameSnapshot || player.playerId; }),
      scheduledAt: line.scheduledAt && line.scheduledAt.toDate ? line.scheduledAt.toDate().toISOString() : line.scheduledAt || null,
      venueName: line.venueNameSnapshot || venue.venueName || venue.name || "Venue TBD",
      venueAddress: venueAddress,
      status: currentStatus,
      score: (line.sets || []).filter(function (set) { return set && !(Number(set.home) === 0 && Number(set.away) === 0); }).map(function (set) { return set.home + "-" + set.away; }).join(" "),
      homePoints: Number(line.homePoints || 0),
      awayPoints: Number(line.awayPoints || 0)
    }}));
  });
  const saveButton = document.createElement("button");
  saveButton.className = "primary";
  saveButton.dataset.saveMatch = "";
  saveButton.textContent = "Save schedule & score";
  saveButton.addEventListener("click", async function () {
    saveButton.disabled = true;
    setCardFeedback(article, "Saving...", "pending");
    try {
      await save(article, record);
    } catch (error) {
      saveButton.disabled = false;
      setCardFeedback(article, error.message || "Match was not saved.", "error");
    }
  });
  actions.append(saveFeedback, posterButton, saveButton);
  article.append(heading);
  if (playerGrid) article.append(playerGrid);
  article.append(form, score, actions);
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
  if (finalStatus === "completed") {
    const homeName = record.matchup.homeTeamNameSnapshot || record.matchup.homeTeamId;
    const awayName = record.matchup.awayTeamNameSnapshot || record.matchup.awayTeamId;
    const scoreText = sets.map(function (set) { return set.home + "-" + set.away; }).join(" ");
    const confirmed = window.confirm(
      "Confirm final score?\n\n" +
      homeName + " vs " + awayName + "\n" +
      "Score: " + scoreText + "\n" +
      "Points: " + result.homePoints + "-" + result.awayPoints +
      "\n\nOnce saved, the score update button will be disabled."
    );
    if (!confirmed) throw new Error("Score update canceled. No changes were saved.");
  }
  const payload = {
    venueId: venueId || null,
    venueNameSnapshot: venueName,
    venueAddressSnapshot: venueFullAddress(venue),
    scheduledAt: scheduledAt,
    sets: sets,
    scheduleStatus: finalStatus,
    scoreStatus: scoreStatus,
    homePoints: finalStatus === "completed" ? result.homePoints : 0,
    awayPoints: finalStatus === "completed" ? result.awayPoints : 0,
    winnerTeamId: winnerTeamId,
    updatedAt: serverTimestamp()
  };
  if (isManager(auth.currentUser)) {
    const homePlayers = [0, 1].map(function (index) {
      return selectedPlayer(article, "home", index, record.matchup.homeTeamId, record.line.homePlayers);
    });
    const awayPlayers = [0, 1].map(function (index) {
      return selectedPlayer(article, "away", index, record.matchup.awayTeamId, record.line.awayPlayers);
    });
    const playerIds = homePlayers.concat(awayPlayers).map(function (player) { return player.playerId; });
    if (new Set(playerIds).size !== 4) throw new Error("All four players must be unique. Match was not saved.");
    payload.homePlayers = homePlayers;
    payload.awayPlayers = awayPlayers;
  }
  const batch = writeBatch(db);
  batch.update(record.ref, payload);
  await batch.commit();
  window.dispatchEvent(new CustomEvent("alphaopen:match-line-updated", {
    detail: { seasonId: state.seasonId, matchupId: record.matchup.matchupId, lineMatchId: record.line.lineMatchId }
  }));
  const successText = finalStatus === "completed"
    ? "Scores were updated."
    : finalStatus === "scheduled"
      ? "Match schedule saved."
      : "Match canceled.";
  feedbackByLineId.set(record.line.lineMatchId, { text: successText, tone: "success" });
  if (finalStatus === "completed") {
    Object.assign(record.line, payload);
    setCardFeedback(article, successText, "success");
    const saveButton = article.querySelector("[data-save-match]");
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Score updated";
    }
    setVisualStatus(article, "completed");
    return;
  }
  await load(auth.currentUser);
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
    getDocs(collection(db, "venues")),
    getDocs(collection(seasonRef, "rosterAssignments")),
    loadCanonicalPlayers()
  ]);
  const rostersByTeam = new Map();
  results[5].docs.forEach(function (item) {
    const player = Object.assign({ assignmentId: item.id }, item.data());
    if (player.status && player.status !== "active") return;
    if (!rostersByTeam.has(player.teamId)) rostersByTeam.set(player.teamId, []);
    rostersByTeam.get(player.teamId).push(player);
  });
  state = {
    seasonId: seasonId,
    season: results[0].data(),
    member: results[1].data() || {},
    teams: results[2].docs.map(function (item) { return Object.assign({ teamId: item.id }, item.data()); }),
    matchups: results[3].docs.map(function (item) { return Object.assign({ matchupId: item.id }, item.data()); }),
    venues: results[4].docs.map(function (item) { return Object.assign({ venueId: item.id }, item.data()); }),
    rostersByTeam: rostersByTeam,
    canonicalPlayers: results[6]
  };
  const membershipRoles = Array.isArray(state.member.roles) ? state.member.roles : [];
  if (!isManager(user) && !membershipRoles.includes("captain")) throw new Error("Only Captains, ECs, and Super Admins can update schedules and scores.");
  byId("matchManagementSeason").replaceChildren(option(seasonId, state.season.name || seasonId, true));
  byId("matchManagementRole").textContent = isManager(user) ? "EC / Super Admin" : "Captain";
  let permitted = null;
  if (!isManager(user)) permitted = new Set(state.member.teamIds || []);
  const records = [];
  for (const matchup of state.matchups) {
    if (permitted && !permitted.has(matchup.homeTeamId) && !permitted.has(matchup.awayTeamId)) continue;
    if (
      matchup.lineupsPublished !== true &&
      matchup.homeLineupStatus !== "approved" &&
      matchup.awayLineupStatus !== "approved"
    ) continue;
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
