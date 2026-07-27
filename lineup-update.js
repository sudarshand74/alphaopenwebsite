import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=4";
import { calculateMatchScore } from "./score-rules.js?v=1";
import { loadCanonicalPlayers } from "./player-identity.js?v=5";
import { publishPublicSeasonDashboard } from "./public-season-dashboard.js?v=14";

const byId = (id) => document.getElementById(id);
let state = null;

function message(text) {
  if (byId("lineupUpdateMessage")) byId("lineupUpdateMessage").textContent = text;
}
function authorized(user) {
  return user?.email?.toLowerCase() === "sudarshandesai74@gmail.com" ||
    window.alphaOpenAuthorization?.role === "Super Admin" ||
    window.alphaOpenAuthorization?.roles?.includes("superAdmin");
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
  players.forEach((player) =>
    select.append(
      option(
        player.playerId,
        `R${player.rankNumber || "-"} · ${player.playerNameSnapshot || player.playerId} (${player.playerId})`,
        player.playerId === selectedId,
      ),
    ),
  );
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
function render(record) {
  const { line, matchup } = record;
  const article = document.createElement("article");
  article.className = "dashboard-card managed-line-card";
  const head = document.createElement("div");
  head.className = "managed-line-head";
  head.innerHTML = `<div><span>${matchup.weekId || ""} · ${matchup.matchupId} · ${line.lineMatchId}</span><h2>Line ${line.lineNumber}: ${matchup.homeTeamNameSnapshot || matchup.homeTeamId} vs ${matchup.awayTeamNameSnapshot || matchup.awayTeamId}</h2></div><span class="badge gray">${line.scheduleStatus === "scheduled" ? "Scheduled" : "To Be Scheduled"}</span>`;
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
  const statusLabel = document.createElement("label");
  statusLabel.append("Current status");
  const status = document.createElement("input");
  status.readOnly = true;
  status.value = line.scheduleStatus === "scheduled" ? "Scheduled" : "To Be Scheduled";
  statusLabel.append(status);
  const overrideReasonLabel = document.createElement("label");
  overrideReasonLabel.className = "player-override-reason";
  overrideReasonLabel.append("Last-minute player override reason");
  const overrideReason = document.createElement("input");
  overrideReason.type = "text";
  overrideReason.maxLength = 300;
  overrideReason.placeholder = "Required only when changing a player";
  overrideReason.dataset.playerOverrideReason = "";
  overrideReasonLabel.append(overrideReason);
  schedule.append(venueLabel, dateLabel, statusLabel, overrideReasonLabel);
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
  const points = document.createElement("strong");
  points.textContent = `${line.homePoints || 0} – ${line.awayPoints || 0} points`;
  score.append(points);
  const actions = document.createElement("div");
  actions.className = "approval-card-actions";
  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Update lineup details";
  save.addEventListener("click", () => saveRecord(article, record, save).catch((error) => message(error.message)));
  const overrideNote = document.createElement("span");
  overrideNote.textContent = "Super Admin player changes are recorded in an immutable override audit.";
  actions.append(overrideNote, save);
  article.append(head, playerGrid, schedule, score, actions);
  return article;
}
async function saveRecord(article, record, button) {
  if (!authorized(auth.currentUser)) throw new Error("Only Super Admin can change an approved lineup's Match Line Record.");
  const { line, matchup } = record;
  const homePlayers = [0, 1].map((index) => selectedPlayer(article, "home", index, matchup.homeTeamId, line.homePlayers));
  const awayPlayers = [0, 1].map((index) => selectedPlayer(article, "away", index, matchup.awayTeamId, line.awayPlayers));
  const ids = [...homePlayers, ...awayPlayers].map((player) => player.playerId);
  if (new Set(ids).size !== 4) throw new Error("All four lineup players must be unique.");
  const playerChanged =
    playerIds(homePlayers).join("|") !== playerIds(line.homePlayers).join("|") ||
    playerIds(awayPlayers).join("|") !== playerIds(line.awayPlayers).join("|");
  const overrideReason = article.querySelector("[data-player-override-reason]").value.trim();
  if (playerChanged && !overrideReason)
    throw new Error("Enter the reason for this last-minute player override.");
  if (playerChanged && hasScoreActivity(line))
    throw new Error("Players can only be overridden before score activity begins.");
  const venueId = article.querySelector("[data-update-venue]").value;
  const dateValue = article.querySelector("[data-update-played]").value;
  if (Boolean(venueId) !== Boolean(dateValue)) throw new Error("Enter both venue and date/time, or leave both blank.");
  const sets = enteredSets(article);
  const result = calculateMatchScore(sets);
  if (sets.length && !result) throw new Error("The score is invalid or incomplete. Nothing was saved.");
  const venue = state.venues.find((item) => item.venueId === venueId);
  const scheduleStatus = result ? "completed" : venueId && dateValue ? "scheduled" : "toBeScheduled";
  const payload = {
    homePlayers,
    awayPlayers,
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
    updatedAt: serverTimestamp(),
  };
  button.disabled = true;
  const batch = writeBatch(db);
  const privateRef = doc(db, "seasons", state.seasonId, "matchups", matchup.matchupId, "lineMatches", line.lineMatchId);
  if (playerChanged) {
    const auditRef = doc(collection(privateRef, "playerOverrides"));
    const actorName =
      window.alphaOpenAuthorization?.playerName ||
      auth.currentUser?.displayName ||
      auth.currentUser?.email ||
      "Super Admin";
    Object.assign(payload, {
      lineupState: "approved",
      scoreEntryAllowed: true,
      superAdminPlayerOverrideApproved: true,
      lastPlayerOverrideId: auditRef.id,
      lastPlayerOverrideAt: serverTimestamp(),
      lastPlayerOverrideByUid: auth.currentUser.uid,
      lastPlayerOverrideByNameSnapshot: actorName,
      lastPlayerOverrideReason: overrideReason,
    });
    batch.set(auditRef, {
      overrideId: auditRef.id,
      seasonId: state.seasonId,
      matchupId: matchup.matchupId,
      lineMatchId: line.lineMatchId,
      reason: overrideReason,
      previousHomePlayers: auditPlayers(line.homePlayers),
      previousAwayPlayers: auditPlayers(line.awayPlayers),
      replacementHomePlayers: auditPlayers(homePlayers),
      replacementAwayPlayers: auditPlayers(awayPlayers),
      overriddenByUid: auth.currentUser.uid,
      overriddenByNameSnapshot: actorName,
      overriddenAt: serverTimestamp(),
    });
  }
  batch.set(privateRef, payload, { merge: true });
  const siblingLines = state.records.filter((item) => item.matchup.matchupId === matchup.matchupId).map((item) => item.line.lineMatchId === line.lineMatchId ? { ...item.line, ...payload } : item.line);
  const completedLineCount = siblingLines.filter((item) => item.scheduleStatus === "completed").length;
  const canceledLineCount = siblingLines.filter((item) => item.scheduleStatus === "canceled").length;
  const expectedLines = Number(state.season.linesPerMatchup || 5);
  const parentPayload = {
    homeTeamPoints: siblingLines.reduce((sum, item) => sum + Number(item.homePoints || 0), 0),
    awayTeamPoints: siblingLines.reduce((sum, item) => sum + Number(item.awayPoints || 0), 0),
    completedLineCount,
    canceledLineCount,
    status: completedLineCount + canceledLineCount >= expectedLines ? "completed" : "inProgress",
    updatedAt: serverTimestamp(),
  };
  batch.set(doc(db, "seasons", state.seasonId, "matchups", matchup.matchupId), parentPayload, { merge: true });
  await batch.commit();
  await publishPublicSeasonDashboard(state.seasonId);
  window.dispatchEvent(new CustomEvent("alphaopen:match-line-updated", {
    detail: { seasonId: state.seasonId, matchupId: matchup.matchupId, lineMatchId: line.lineMatchId },
  }));
  message(playerChanged
    ? "Super Admin player override saved, audited, and published for guests."
    : scheduleStatus === "completed"
      ? "Lineup and score updated. Match completed."
      : scheduleStatus === "scheduled"
        ? "Lineup updated. Match scheduled."
        : "Lineup updated. Match remains To Be Scheduled.");
  await load(auth.currentUser);
}
async function load(user) {
  if (!authorized(user)) {
    message("Only Super Admin can change approved lineup Match Line Records.");
    byId("lineupUpdateList").innerHTML = "";
    return;
  }
  message("Loading active-season editable matches...");
  const control = await getDoc(doc(db, "systemConfig", "seasonControl"));
  const seasonId = control.data()?.activeSeasonId;
  if (!seasonId) throw new Error("No active season is configured.");
  const seasonRef = doc(db, "seasons", seasonId);
  const [seasonDoc, matchups, rosters, venues, canonicalPlayers] = await Promise.all([
    getDoc(seasonRef),
    getDocs(collection(seasonRef, "matchups")),
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
    venues: venues.docs.map((item) => ({ venueId: item.id, ...item.data() })),
    rostersByTeam,
    canonicalPlayers,
    records: [],
  };
  byId("lineupUpdateSeason").replaceChildren(option(seasonId, state.season.name || seasonId, true));
  for (const matchup of state.matchups) {
    const lines = await getDocs(collection(seasonRef, "matchups", matchup.matchupId, "lineMatches"));
    lines.docs.forEach((item) => state.records.push({ matchup, line: { lineMatchId: item.id, ...item.data() } }));
  }
  const editable = state.records.filter((record) => ["toBeScheduled", "scheduled"].includes(record.line.scheduleStatus || "toBeScheduled"));
  editable.sort((a, b) => {
    const left = a.line.scheduledAt?.toDate?.()?.valueOf() || Number.MAX_SAFE_INTEGER;
    const right = b.line.scheduledAt?.toDate?.()?.valueOf() || Number.MAX_SAFE_INTEGER;
    return left - right || String(a.matchup.matchupId).localeCompare(String(b.matchup.matchupId)) || Number(a.line.lineNumber) - Number(b.line.lineNumber);
  });
  const list = byId("lineupUpdateList");
  list.replaceChildren();
  if (!editable.length) list.innerHTML = '<div class="dashboard-card empty-state"><b>No editable matches</b><p>Only To Be Scheduled and Scheduled matches appear here.</p></div>';
  else editable.forEach((record) => list.append(render(record)));
  message(`${editable.length} To Be Scheduled or Scheduled line matches loaded.`);
}

onAuthStateChanged(auth, (user) => {
  if (!user) return message("Sign in as Super Admin to update lineups.");
  if (user.email?.toLowerCase() === "sudarshandesai74@gmail.com") load(user).catch((error) => message(`Lineup update failed: ${error.message}`));
});
window.addEventListener("alphaopen:profile-ready", () => {
  if (auth.currentUser) load(auth.currentUser).catch((error) => message(`Lineup update failed: ${error.message}`));
});
