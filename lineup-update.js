import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=4";
import { calculateMatchScore } from "./score-rules.js?v=1";
import { formattedPlayerLabel, loadCanonicalPlayers } from "./player-identity.js?v=5";
import { refreshSeasonPublicRecords } from "./season-public-sync.js?v=1";

const byId = (id) => document.getElementById(id);
let state = null;

function message(text) {
  if (byId("lineupUpdateMessage")) byId("lineupUpdateMessage").textContent = text;
}
function isSuperAdmin(user = auth.currentUser) {
  return user?.email?.toLowerCase() === "sudarshandesai74@gmail.com" ||
    window.alphaOpenAuthorization?.role === "Super Admin" ||
    window.alphaOpenAuthorization?.roles?.includes("superAdmin");
}
function authorized(user) {
  return isSuperAdmin(user) ||
    window.alphaOpenAuthorization?.access?.includes("ec") ||
    window.alphaOpenAuthorization?.roles?.includes("ec");
}
function option(value, label, selected = false) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  node.selected = selected;
  return node;
}
function localValue(value) {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
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
function teamName(teamId, snapshot = "") {
  const team = state?.teams?.find((item) => item.teamId === teamId);
  const name = team?.name || snapshot || teamId || "Team";
  return /^Team\b/i.test(name) ? name : `Team ${name}`;
}
function winnerName(record, result) {
  if (!result) return "";
  return result.winnerSide === "home"
    ? teamName(record.matchup.homeTeamId, record.matchup.homeTeamNameSnapshot)
    : teamName(record.matchup.awayTeamId, record.matchup.awayTeamNameSnapshot);
}
function showPointResult(container, homePoints, awayPoints, winner = "") {
  container.replaceChildren();
  const pointLine = document.createElement("span");
  pointLine.textContent = `${homePoints} – ${awayPoints} points`;
  container.append(pointLine);
  if (winner) {
    const winnerLine = document.createElement("strong");
    winnerLine.textContent = `${winner} Won`;
    container.append(winnerLine);
  }
}
function captainPlayerId(team = {}) {
  return String((team.captainPlayerIds || [])[0] || team.captainPlayerId || "").trim();
}
function captainLabel(team = {}) {
  const playerId = captainPlayerId(team);
  return formattedPlayerLabel(
    playerId,
    null,
    state?.canonicalPlayers?.get(playerId)?.displayName,
    team.captainNameSnapshot,
  );
}
function rosterPlayers(teamId, current = []) {
  const players = new Map();
  (state.rostersByTeam.get(teamId) || []).forEach((player) => players.set(player.playerId, player));
  current.forEach((player) => {
    if (!players.has(player.playerId))
      players.set(player.playerId, {
        playerId: player.playerId,
        playerNameSnapshot: player.nameSnapshot || player.playerId,
        rankNumber: player.rankNumber || player.rankSnapshot || null,
      });
  });
  return [...players.values()].sort(
    (a, b) => Number(a.rankNumber || 99) - Number(b.rankNumber || 99),
  );
}
function playerSelect(side, index, players, selectedId) {
  const select = document.createElement("select");
  select.dataset[`${side}Player`] = String(index);
  select.append(option("", "Select player", !selectedId));
  players.forEach((player) => {
    select.append(option(
      player.playerId,
      formattedPlayerLabel(
        player.playerId,
        player.rankNumber,
        state?.canonicalPlayers?.get(player.playerId)?.displayName,
        player.playerNameSnapshot,
        player.nameSnapshot,
      ),
      player.playerId === selectedId,
    ));
  });
  return select;
}
function enteredSets(article) {
  const sets = [];
  for (let index = 0; index < 3; index += 1) {
    const home = article.querySelector(`[data-update-home-set="${index}"]`).value;
    const away = article.querySelector(`[data-update-away-set="${index}"]`).value;
    if ((home === "") !== (away === "")) throw new Error(`Enter both scores for Set ${index + 1}.`);
    if (home === "" && away === "") continue;
    if (index === 2 && Number(home) === 0 && Number(away) === 0) continue;
    sets.push({ home: Number(home), away: Number(away) });
  }
  return sets;
}
function selectedPlayer(article, side, index, teamId, current) {
  const playerId = article.querySelector(`[data-${side}-player="${index}"]`).value;
  const player = rosterPlayers(teamId, current).find((item) => item.playerId === playerId);
  const canonical = state.canonicalPlayers?.get(playerId);
  if (!player || !canonical) throw new Error("Select four valid Player Master players.");
  return {
    playerId: player.playerId,
    nameSnapshot: canonical.displayName,
    rankNumber: Number(player.rankNumber || player.rankSnapshot || 0),
  };
}
function playerIds(players = []) {
  return players.map((player) => String(player?.playerId || ""));
}
function auditPlayers(players = []) {
  return players.map((player) => ({
    playerId: player?.playerId || "",
    nameSnapshot: player?.nameSnapshot || player?.playerNameSnapshot || player?.playerId || "",
    rankNumber: Number(player?.rankNumber || player?.rankSnapshot || 0),
  }));
}
function hasScoreActivity(line = {}) {
  return Boolean(
    (line.sets || []).length ||
    Number(line.homePoints || 0) ||
    Number(line.awayPoints || 0) ||
    line.winnerTeamId ||
    ["submitted", "awaitingconfirmation", "confirmed", "published", "locked", "completed"]
      .includes(String(line.scoreStatus || "").toLowerCase()),
  );
}
function normalizedScheduleStatus(line = {}) {
  const status = String(line.scheduleStatus || "toBeScheduled").toLowerCase();
  if (status === "completed") return "completed";
  if (status === "scheduled") return "scheduled";
  if (status === "canceled") return "canceled";
  return "toBeScheduled";
}
function statusLabel(status) {
  return {
    completed: "Completed",
    scheduled: "Scheduled",
    toBeScheduled: "To Be Scheduled",
    canceled: "Canceled",
  }[status] || status;
}
function updateScorePreview(article, record) {
  const points = article.querySelector("[data-update-points]");
  try {
    const sets = enteredSets(article);
    if (!sets.length) {
      showPointResult(points, 0, 0);
      return;
    }
    const result = calculateMatchScore(sets);
    if (!result) {
      points.textContent = "Invalid or incomplete score";
      return;
    }
    showPointResult(points, result.homePoints, result.awayPoints, winnerName(record, result));
  } catch (error) {
    points.textContent = error.message;
  }
}
function renderRecords() {
  if (!state) return;
  const statusFilter = byId("lineupUpdateStatus")?.value || "open";
  const captainFilter = byId("lineupUpdateCaptain")?.value || "all";
  const weekFilter = byId("lineupUpdateWeek")?.value || "all";
  const records = state.records
    .filter((record) => {
      const status = normalizedScheduleStatus(record.line);
      const statusMatches = statusFilter === "open"
        ? ["toBeScheduled", "scheduled"].includes(status)
        : status === statusFilter;
      const captainMatches = captainFilter === "all" ||
        record.matchup.homeTeamId === captainFilter ||
        record.matchup.awayTeamId === captainFilter;
      const weekMatches = weekFilter === "all" ||
        record.matchup.weekId === weekFilter;
      return statusMatches && captainMatches && weekMatches;
    })
    .sort((a, b) => {
      const left = a.line.scheduledAt?.toDate?.()?.valueOf() || Number.MAX_SAFE_INTEGER;
      const right = b.line.scheduledAt?.toDate?.()?.valueOf() || Number.MAX_SAFE_INTEGER;
      return left - right ||
        String(a.matchup.matchupId).localeCompare(String(b.matchup.matchupId)) ||
        Number(a.line.lineNumber) - Number(b.line.lineNumber);
    });
  const list = byId("lineupUpdateList");
  list.replaceChildren();
  if (!records.length) {
    list.innerHTML = '<div class="dashboard-card empty-state"><b>No matching line matches</b><p>Try another week, match status, or captain.</p></div>';
  } else {
    records.forEach((record) => list.append(render(record)));
  }
  const captain = state.teams.find((team) => team.teamId === captainFilter);
  const selectedStatus = byId("lineupUpdateStatus")?.selectedOptions?.[0]?.textContent || "Scheduled + To Be Scheduled";
  const selectedWeek = weekFilter === "all"
    ? ""
    : byId("lineupUpdateWeek")?.selectedOptions?.[0]?.textContent || weekFilter;
  message(
    `${records.length} ${selectedStatus} line matches` +
    `${selectedWeek ? ` in ${selectedWeek}` : ""}` +
    `${captain ? ` for ${captainLabel(captain)}` : ""} loaded.`,
  );
}
function render(record) {
  const { line, matchup } = record;
  const article = document.createElement("article");
  article.className = "dashboard-card managed-line-card";
  const head = document.createElement("div");
  head.className = "managed-line-head";
  const currentStatus = normalizedScheduleStatus(line);
  head.innerHTML = `<div><span>${matchup.weekId || ""} · ${matchup.matchupId} · ${line.lineMatchId}</span><h2>Line ${line.lineNumber}: ${teamName(matchup.homeTeamId, matchup.homeTeamNameSnapshot)} vs ${teamName(matchup.awayTeamId, matchup.awayTeamNameSnapshot)}</h2></div><span class="badge ${currentStatus === "completed" ? "lime" : "gray"}">${statusLabel(currentStatus)}</span>`;
  const playerGrid = document.createElement("div");
  playerGrid.className = "managed-player-grid";
  const homeRoster = rosterPlayers(matchup.homeTeamId, line.homePlayers);
  const awayRoster = rosterPlayers(matchup.awayTeamId, line.awayPlayers);
  [0, 1].forEach((index) => {
    const homeLabel = document.createElement("label");
    homeLabel.append(`Home player ${index + 1}`, playerSelect("home", index, homeRoster, line.homePlayers?.[index]?.playerId));
    const awayLabel = document.createElement("label");
    awayLabel.append(`Away player ${index + 1}`, playerSelect("away", index, awayRoster, line.awayPlayers?.[index]?.playerId));
    playerGrid.append(homeLabel, awayLabel);
  });
  const schedule = document.createElement("div");
  schedule.className = "managed-line-form";
  const venueLabel = document.createElement("label");
  venueLabel.append("Venue");
  const venueSelect = document.createElement("select");
  venueSelect.dataset.updateVenue = "";
  venueSelect.append(option("", "Select venue", !line.venueId));
  state.venues.forEach((venue) => venueSelect.append(option(venue.venueId, venue.venueName || venue.name || venue.venueId, venue.venueId === line.venueId)));
  venueLabel.append(venueSelect);
  const dateLabel = document.createElement("label");
  dateLabel.append("Date & time");
  const dateInput = document.createElement("input");
  dateInput.type = "datetime-local";
  dateInput.dataset.updatePlayed = "";
  dateInput.value = localValue(line.scheduledAt);
  dateLabel.append(dateInput);
  const statusFieldLabel = document.createElement("label");
  statusFieldLabel.append("Current status");
  const status = document.createElement("input");
  status.readOnly = true;
  status.value = statusLabel(currentStatus);
  statusFieldLabel.append(status);
  const overrideReasonLabel = document.createElement("label");
  overrideReasonLabel.className = "player-override-reason";
  overrideReasonLabel.append(currentStatus === "completed" ? "Completed match correction reason" : "Player or score correction reason");
  const overrideReason = document.createElement("input");
  overrideReason.type = "text";
  overrideReason.maxLength = 300;
  overrideReason.placeholder = currentStatus === "completed"
    ? "Required before correcting a completed match"
    : "Required when changing a player";
  overrideReason.dataset.playerOverrideReason = "";
  overrideReasonLabel.append(overrideReason);
  schedule.append(venueLabel, dateLabel, statusFieldLabel, overrideReasonLabel);
  const score = document.createElement("div");
  score.className = "managed-score";
  score.append(Object.assign(document.createElement("b"), { textContent: "Score" }));
  [0, 1, 2].forEach((index) => {
    const label = document.createElement("label");
    label.append(`Set ${index + 1}`);
    const home = document.createElement("input");
    home.type = "number";
    home.min = "0";
    home.max = index === 2 ? "30" : "7";
    home.dataset.updateHomeSet = String(index);
    const away = home.cloneNode();
    delete away.dataset.updateHomeSet;
    away.dataset.updateAwaySet = String(index);
    if (line.sets?.[index]) {
      home.value = line.sets[index].home ?? line.sets[index].homeScore ?? "";
      away.value = line.sets[index].away ?? line.sets[index].awayScore ?? "";
    }
    label.append(home, document.createTextNode(" – "), away);
    score.append(label);
  });
  const points = document.createElement("div");
  points.dataset.updatePoints = "";
  const savedWinner = line.winnerTeamId === matchup.homeTeamId
    ? teamName(matchup.homeTeamId, matchup.homeTeamNameSnapshot)
    : line.winnerTeamId === matchup.awayTeamId
      ? teamName(matchup.awayTeamId, matchup.awayTeamNameSnapshot)
      : "";
  showPointResult(points, line.homePoints || 0, line.awayPoints || 0, savedWinner);
  score.append(points);
  const actions = document.createElement("div");
  actions.className = "approval-card-actions";
  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = currentStatus === "completed" ? "Correct completed match" : "Update lineup & score";
  save.addEventListener("click", () => saveRecord(article, record, save).catch((error) => message(error.message)));
  const overrideNote = document.createElement("span");
  overrideNote.textContent = "EC/Admin player and score changes are recorded in an immutable correction audit.";
  actions.append(overrideNote, save);
  article.append(head, playerGrid, schedule, score, actions);
  article.querySelectorAll("[data-update-home-set], [data-update-away-set]").forEach((control) => {
    control.addEventListener("input", () => updateScorePreview(article, record));
    control.addEventListener("change", () => updateScorePreview(article, record));
  });
  updateScorePreview(article, record);
  return article;
}
async function saveRecord(article, record, button) {
  if (!authorized(auth.currentUser)) throw new Error("Only EC or Super Admin can change an approved lineup's Match Line Record.");
  const { line, matchup } = record;
  const homePlayers = [0, 1].map((index) => selectedPlayer(article, "home", index, matchup.homeTeamId, line.homePlayers));
  const awayPlayers = [0, 1].map((index) => selectedPlayer(article, "away", index, matchup.awayTeamId, line.awayPlayers));
  const ids = [...homePlayers, ...awayPlayers].map((player) => player.playerId);
  if (new Set(ids).size !== 4) throw new Error("All four lineup players must be unique.");
  const playerChanged =
    playerIds(homePlayers).join("|") !== playerIds(line.homePlayers).join("|") ||
    playerIds(awayPlayers).join("|") !== playerIds(line.awayPlayers).join("|");
  const correctionReason = article.querySelector("[data-player-override-reason]").value.trim();
  const correctingCompletedLine = normalizedScheduleStatus(line) === "completed" || hasScoreActivity(line);
  if ((playerChanged || correctingCompletedLine) && !correctionReason)
    throw new Error("Enter the reason for this player or completed-score correction.");
  const venueId = article.querySelector("[data-update-venue]").value;
  const dateValue = article.querySelector("[data-update-played]").value;
  if (Boolean(venueId) !== Boolean(dateValue)) throw new Error("Enter both venue and date/time, or leave both blank.");
  const sets = enteredSets(article);
  const result = calculateMatchScore(sets);
  if (sets.length && !result) throw new Error("The score is invalid or incomplete. Nothing was saved.");
  const venue = state.venues.find((item) => item.venueId === venueId);
  const scheduleStatus = result ? "completed" : venueId && dateValue ? "scheduled" : "toBeScheduled";
  const previousWinner = line.winnerTeamId === matchup.homeTeamId
    ? teamName(matchup.homeTeamId, matchup.homeTeamNameSnapshot)
    : line.winnerTeamId === matchup.awayTeamId
      ? teamName(matchup.awayTeamId, matchup.awayTeamNameSnapshot)
      : "No winner";
  const correctedWinner = result ? winnerName(record, result) : "No winner";
  const oldScore = (line.sets || []).map((set) => `${set.home ?? set.homeScore}-${set.away ?? set.awayScore}`).join(", ") || "No score";
  const newScore = sets.map((set) => `${set.home}-${set.away}`).join(", ") || "No score";
  const confirmation = correctingCompletedLine
    ? `Confirm completed match correction?\n\nPrevious score: ${oldScore}\nPrevious points: ${Number(line.homePoints || 0)}-${Number(line.awayPoints || 0)}\nPrevious winner: ${previousWinner}\n\nCorrected score: ${newScore}\nCorrected points: ${result?.homePoints || 0}-${result?.awayPoints || 0}\nCorrected winner: ${correctedWinner}\n\nReason: ${correctionReason}`
    : `Confirm lineup and score update?\n\nScore: ${newScore}\nPoints: ${result?.homePoints || 0}-${result?.awayPoints || 0}\nWinner: ${correctedWinner}${correctionReason ? `\n\nReason: ${correctionReason}` : ""}`;
  if (!window.confirm(confirmation)) throw new Error("Update canceled. No changes were saved.");
  const actorName =
    window.alphaOpenAuthorization?.playerName ||
    auth.currentUser?.displayName ||
    auth.currentUser?.email ||
    "EC/Admin";
  const correctionRef = doc(collection(
    db,
    "seasons",
    state.seasonId,
    "matchups",
    matchup.matchupId,
    "lineMatches",
    line.lineMatchId,
    "corrections",
  ));
  const payload = {
    homePlayers,
    awayPlayers,
    homeSor: homePlayers.reduce((sum, player) => sum + Number(player.rankNumber || 0), 0),
    awaySor: awayPlayers.reduce((sum, player) => sum + Number(player.rankNumber || 0), 0),
    venueId: venueId || null,
    venueNameSnapshot: venue ? venue.venueName || venue.name || venue.venueId : null,
    venueAddressSnapshot: venueFullAddress(venue),
    scheduledAt: dateValue ? new Date(dateValue) : null,
    sets,
    scheduleStatus,
    scoreStatus: result ? "published" : scheduleStatus === "scheduled" ? "scheduled" : "pending",
    homePoints: result?.homePoints || 0,
    awayPoints: result?.awayPoints || 0,
    winnerTeamId: result ? (result.winnerSide === "home" ? matchup.homeTeamId : matchup.awayTeamId) : null,
    lineupState: "approved",
    scoreEntryAllowed: true,
    lastCorrectionId: correctionRef.id,
    lastCorrectionAt: serverTimestamp(),
    lastCorrectionByUid: auth.currentUser.uid,
    lastCorrectionByNameSnapshot: actorName,
    lastCorrectionReason: correctionReason || "Operational lineup or schedule update",
    updatedAt: serverTimestamp(),
  };
  button.disabled = true;
  const batch = writeBatch(db);
  const privateRef = doc(db, "seasons", state.seasonId, "matchups", matchup.matchupId, "lineMatches", line.lineMatchId);
  batch.set(correctionRef, {
    correctionId: correctionRef.id,
    seasonId: state.seasonId,
    matchupId: matchup.matchupId,
    lineMatchId: line.lineMatchId,
    reason: correctionReason || "Operational lineup or schedule update",
    previousStatus: normalizedScheduleStatus(line),
    correctedStatus: scheduleStatus,
    previousHomePlayers: auditPlayers(line.homePlayers),
    previousAwayPlayers: auditPlayers(line.awayPlayers),
    correctedHomePlayers: auditPlayers(homePlayers),
    correctedAwayPlayers: auditPlayers(awayPlayers),
    previousSets: line.sets || [],
    correctedSets: sets,
    previousHomePoints: Number(line.homePoints || 0),
    previousAwayPoints: Number(line.awayPoints || 0),
    correctedHomePoints: result?.homePoints || 0,
    correctedAwayPoints: result?.awayPoints || 0,
    previousWinnerTeamId: line.winnerTeamId || null,
    correctedWinnerTeamId: payload.winnerTeamId,
    correctedByUid: auth.currentUser.uid,
    correctedByNameSnapshot: actorName,
    correctedAt: serverTimestamp(),
  });
  batch.set(privateRef, payload, { merge: true });
  const siblingLines = state.records.filter((item) => item.matchup.matchupId === matchup.matchupId).map((item) => item.line.lineMatchId === line.lineMatchId ? { ...item.line, ...payload } : item.line);
  const completedLineCount = siblingLines.filter((item) => item.scheduleStatus === "completed").length;
  const canceledLineCount = siblingLines.filter((item) => item.scheduleStatus === "canceled").length;
  const expectedLines = Number(state.season.linesPerMatchup || 5);
  const homeLineWins = siblingLines.filter((item) => item.winnerTeamId === matchup.homeTeamId).length;
  const awayLineWins = siblingLines.filter((item) => item.winnerTeamId === matchup.awayTeamId).length;
  const matchupCompleted = completedLineCount + canceledLineCount >= expectedLines;
  const parentPayload = {
    homeTeamPoints: siblingLines.reduce((sum, item) => sum + Number(item.homePoints || 0), 0),
    awayTeamPoints: siblingLines.reduce((sum, item) => sum + Number(item.awayPoints || 0), 0),
    completedLineCount,
    canceledLineCount,
    status: matchupCompleted ? "completed" : "inProgress",
    winnerTeamId: matchupCompleted
      ? homeLineWins > awayLineWins
        ? matchup.homeTeamId
        : awayLineWins > homeLineWins
          ? matchup.awayTeamId
          : null
      : null,
    lastCorrectionId: correctionRef.id,
    lastCorrectionAt: serverTimestamp(),
    lastCorrectionByUid: auth.currentUser.uid,
    updatedAt: serverTimestamp(),
  };
  batch.set(doc(db, "seasons", state.seasonId, "matchups", matchup.matchupId), parentPayload, { merge: true });
  await batch.commit();
  try {
    await refreshSeasonPublicRecords(state.seasonId);
  } catch (error) {
    throw new Error(
      `The private correction was saved, but the public dashboard refresh failed. ` +
      `Use Admin > Setup Season > Refresh Active Public Dashboard. ${error.message || ""}`.trim(),
    );
  }
  message(playerChanged
    ? "EC/Admin player correction saved, audited, and published for guests."
    : scheduleStatus === "completed"
      ? "Lineup and score updated. Match completed."
      : scheduleStatus === "scheduled"
        ? "Lineup updated. Match scheduled."
        : "Lineup updated. Match remains To Be Scheduled.");
  await load(auth.currentUser);
}
async function load(user) {
  if (!authorized(user)) {
    message("Only EC or Super Admin can change approved lineup Match Line Records.");
    byId("lineupUpdateList").innerHTML = "";
    return;
  }
  message("Loading active-season editable matches...");
  const control = await getDoc(doc(db, "systemConfig", "seasonControl"));
  const seasonId = control.data()?.activeSeasonId;
  if (!seasonId) throw new Error("No active season is configured.");
  const seasonRef = doc(db, "seasons", seasonId);
  const [seasonDoc, matchups, weeks, teams, rosters, venues, canonicalPlayers] = await Promise.all([
    getDoc(seasonRef),
    getDocs(collection(seasonRef, "matchups")),
    getDocs(collection(seasonRef, "weeks")),
    getDocs(collection(seasonRef, "teams")),
    getDocs(collection(seasonRef, "rosterAssignments")),
    getDocs(collection(db, "venues")),
    loadCanonicalPlayers(),
  ]);
  const rostersByTeam = new Map();
  rosters.docs.forEach((item) => {
    const player = { ...item.data(), assignmentId: item.id };
    if (player.status && player.status !== "active") return;
    if (!rostersByTeam.has(player.teamId)) rostersByTeam.set(player.teamId, []);
    rostersByTeam.get(player.teamId).push(player);
  });
  state = {
    seasonId,
    season: seasonDoc.data() || {},
    matchups: matchups.docs.map((item) => ({ matchupId: item.id, ...item.data() })),
    weeks: weeks.docs
      .map((item) => ({ weekId: item.id, ...item.data() }))
      .sort((a, b) =>
        Number(a.sequence || Number.MAX_SAFE_INTEGER) -
          Number(b.sequence || Number.MAX_SAFE_INTEGER) ||
        String(a.label || a.weekId).localeCompare(String(b.label || b.weekId))),
    teams: teams.docs
      .map((item) => ({ teamId: item.id, ...item.data() }))
      .sort((a, b) => String(a.name || a.teamId).localeCompare(String(b.name || b.teamId))),
    venues: venues.docs.map((item) => ({ venueId: item.id, ...item.data() })),
    rostersByTeam,
    canonicalPlayers,
    records: [],
  };
  byId("lineupUpdateSeason").replaceChildren(option(seasonId, state.season.name || seasonId, true));
  const weekFilter = byId("lineupUpdateWeek");
  weekFilter.replaceChildren(option("all", "All Weeks", true));
  const weekOptions = new Map(
    state.weeks.map((week) => [
      week.weekId,
      week.label || week.name || week.weekId,
    ]),
  );
  state.matchups.forEach((matchup) => {
    if (matchup.weekId && !weekOptions.has(matchup.weekId)) {
      weekOptions.set(matchup.weekId, matchup.weekId);
    }
  });
  weekOptions.forEach((label, weekId) => {
    weekFilter.append(option(weekId, label));
  });
  const captainFilter = byId("lineupUpdateCaptain");
  captainFilter.replaceChildren(option("all", "All Captains", true));
  state.teams.forEach((team) => {
    captainFilter.append(option(team.teamId, `${captainLabel(team)} · ${team.name || team.teamId}`));
  });
  for (const matchup of state.matchups) {
    const lines = await getDocs(collection(seasonRef, "matchups", matchup.matchupId, "lineMatches"));
    lines.docs.forEach((item) => state.records.push({ matchup, line: { lineMatchId: item.id, ...item.data() } }));
  }
  renderRecords();
}

onAuthStateChanged(auth, (user) => {
  if (!user) return message("Sign in as EC or Super Admin to update lineups and scores.");
  load(user).catch((error) => message(`Lineup update failed: ${error.message}`));
});
window.addEventListener("alphaopen:profile-ready", () => {
  if (auth.currentUser) load(auth.currentUser).catch((error) => message(`Lineup update failed: ${error.message}`));
});
byId("lineupUpdateStatus")?.addEventListener("change", renderRecords);
byId("lineupUpdateCaptain")?.addEventListener("change", renderRecords);
byId("lineupUpdateWeek")?.addEventListener("change", renderRecords);
