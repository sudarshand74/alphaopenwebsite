import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=4";
import { canonicalPlayerName, validatePlayerIds } from "./player-identity.js?v=1";

const ADMIN = "sudarshandesai74@gmail.com";
const $ = (value) => document.querySelector(value),
  seasonSelect = $("#rosterAdminSeason"),
  panel = $("#rosterAdminTeams"),
  statusBox = $("#rosterAdminMessage"),
  dialog = $("#rosterReplacementDialog"),
  form = $("#rosterReplacementForm"),
  playerSelect = $("#replacementPlayerId"),
  recordReplacement = $("#recordRosterReplacement");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );
const isAdmin = () =>
  Boolean(
    auth.currentUser?.emailVerified &&
    (auth.currentUser.email?.toLowerCase() === ADMIN ||
      window.alphaOpenAuthorization?.access?.includes("ec")),
  );
const nameOf = (player) =>
  player?.displayName ||
  player?.fullName ||
  `${player?.firstName || ""} ${player?.lastName || ""}`.trim() ||
  player?.playerNameSnapshot ||
  player?.playerId ||
  "Name unavailable";
const canonicalId = (seasonId, teamId, rank) =>
  `${seasonId}-${teamId.replace(`${seasonId}-`, "")}-R${rank}`;
const priority = (item) =>
  (item.sourceOfTruth === "Spring 2026 match line snapshots" ? 4 : 0) +
  (item.reconciledAt ? 2 : 0) +
  (item.updatedAt ? 1 : 0);
let players = [],
  playerById = new Map(),
  teamsById = new Map(),
  assignmentsById = new Map(),
  xlsxModule;

function excelValue(value) {
  if (value == null) return "";
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date || ["string", "number", "boolean"].includes(typeof value)) return value;
  return JSON.stringify(value);
}
function prefixed(record, prefix) {
  return Object.fromEntries(Object.entries(record || {}).map(([key, value]) => [`${prefix} ${key}`, excelValue(value)]));
}
function appendSheet(XLSX, workbook, name, rows) {
  const safeRows = rows.length ? rows : [{ Status: "No records" }],
    worksheet = XLSX.utils.json_to_sheet(safeRows, { cellDates: true });
  worksheet["!autofilter"] = { ref: worksheet["!ref"] };
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  worksheet["!cols"] = Object.keys(safeRows[0]).map((heading) => ({
    wch: Math.min(45, Math.max(12, heading.length + 2)),
  }));
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
}

async function exportTeamRoster() {
  if (!isAdmin() || !seasonSelect.value) return;
  const button = $("#exportTeamRoster"), seasonId = seasonSelect.value;
  button.disabled = true;
  statusBox.textContent = "Preparing complete team roster workbook...";
  try {
    const [teamSnapshot, assignmentSnapshot, slotSnapshot, playerSnapshot, XLSX] = await Promise.all([
      getDocs(collection(db, "seasons", seasonId, "teams")),
      getDocs(collection(db, "seasons", seasonId, "rosterAssignments")),
      getDocs(collection(db, "seasons", seasonId, "rosterSlots")),
      getDocs(collection(db, "players")),
      (xlsxModule ||= import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs")),
    ]);
    const teams = teamSnapshot.docs.map((item) => ({ teamId: item.id, ...item.data() })),
      assignments = assignmentSnapshot.docs.map((item) => ({ assignmentId: item.id, ...item.data() })),
      slots = slotSnapshot.docs.map((item) => ({ rosterSlotId: item.id, ...item.data() })),
      allPlayers = playerSnapshot.docs.map((item) => ({ playerId: item.id, ...item.data() })),
      teamMap = new Map(teams.map((item) => [item.teamId, item])),
      playerMap = new Map(allPlayers.map((item) => [item.playerId, item])),
      slotMap = new Map(slots.map((item) => [`${item.teamId}|${Number(item.rankNumber)}`, item])),
      relevantPlayerIds = new Set(assignments.map((item) => item.playerId).filter(Boolean));
    teams.forEach((team) => (team.captainPlayerIds || []).forEach((id) => relevantPlayerIds.add(id)));
    const rosterRows = assignments
      .sort((a, b) => String(a.teamId).localeCompare(String(b.teamId)) || Number(a.rankNumber) - Number(b.rankNumber) || String(a.assignmentId).localeCompare(String(b.assignmentId)))
      .map((assignment) => {
        const team = teamMap.get(assignment.teamId) || {}, player = playerMap.get(assignment.playerId) || {},
          slot = slotMap.get(`${assignment.teamId}|${Number(assignment.rankNumber)}`) || {};
        return {
          "Season ID": seasonId,
          "Team ID": assignment.teamId || "",
          "Team Name": team.name || "",
          "Team Short Name": team.shortName || "",
          "Roster Rank": assignment.rankNumber ?? "",
          "Is Captain": (team.captainPlayerIds || []).includes(assignment.playerId) ? "Yes" : "No",
          "Captain Names": team.captainNameSnapshot || (team.captainPlayerIds || []).map((id) => nameOf(playerMap.get(id))).join(", "),
          ...prefixed(assignment, "Assignment"),
          ...prefixed(slot, "Slot"),
          ...prefixed(player, "Player"),
        };
      });
    const captainRows = teams.flatMap((team) => {
      const playerIds = team.captainPlayerIds || [], uids = team.captainUids || [], count = Math.max(playerIds.length, uids.length, team.captainNameSnapshot ? 1 : 0);
      return Array.from({ length: count }, (_, index) => {
        const playerId = playerIds[index] || "", player = playerMap.get(playerId) || {};
        return { "Season ID": seasonId, "Team ID": team.teamId, "Team Name": team.name || "", "Captain Player ID": playerId, "Captain UID": uids[index] || "", "Captain Name": playerId ? nameOf(player) : team.captainNameSnapshot || "", ...prefixed(player, "Player") };
      });
    });
    const workbook = XLSX.utils.book_new();
    appendSheet(XLSX, workbook, "Team Roster", rosterRows);
    appendSheet(XLSX, workbook, "Teams", teams.map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, excelValue(value)]))));
    appendSheet(XLSX, workbook, "Captains", captainRows);
    appendSheet(XLSX, workbook, "Player Details", allPlayers.filter((item) => relevantPlayerIds.has(item.playerId)).map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, excelValue(value)]))));
    appendSheet(XLSX, workbook, "Roster Assignments", assignments.map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, excelValue(value)]))));
    appendSheet(XLSX, workbook, "Roster Slots", slots.map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, excelValue(value)]))));
    const exportDate = new Date().toISOString().slice(0, 10);
    XLSX.writeFileXLSX(workbook, `AlphaOpen-Team-Roster-${seasonId}-${exportDate}.xlsx`, { cellDates: true });
    statusBox.textContent = `${rosterRows.length} roster records exported with teams, captains, player details, assignments, and roster slots.`;
  } catch (error) {
    console.error("Team roster export failed", error);
    statusBox.textContent = `Team roster export failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

function closeDialog() {
  if (dialog.open)
    typeof dialog.close === "function"
      ? dialog.close()
      : dialog.removeAttribute("open");
}
function openDialog() {
  typeof dialog.showModal === "function"
    ? dialog.showModal()
    : dialog.setAttribute("open", "");
}
async function loadPlayers() {
  if (players.length) return;
  const snapshot = await getDocs(collection(db, "players"));
  players = snapshot.docs
    .map((item) => ({ playerId: item.id, ...item.data() }))
    .filter((item) => item.status !== "inactive")
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  playerById = new Map(players.map((item) => [item.playerId, item]));
  playerSelect.innerHTML =
    '<option value="">Select a Firebase player</option>' +
    players
      .map(
        (item) =>
          `<option value="${esc(item.playerId)}">${esc(item.playerId)} · ${esc(nameOf(item))}</option>`,
      )
      .join("");
}

function historyHtml(history) {
  return `<div class="roster-replaced-players">${history.length ? history.map((item) => `<div class="roster-replaced-player">${esc(item.playerId || "Unknown ID")} · ${esc(nameOf(playerById.get(item.playerId)) || item.playerNameSnapshot)}</div>`).join("") : '<span class="roster-no-history">None</span>'}</div>`;
}
async function loadRoster() {
  if (!isAdmin() || !seasonSelect.value) return;
  panel.innerHTML = '<p class="muted">Loading Firebase team rosters...</p>';
  try {
    await loadPlayers();
    const seasonId = seasonSelect.value,
      [teamSnapshot, assignmentSnapshot] = await Promise.all([
        getDocs(collection(db, "seasons", seasonId, "teams")),
        getDocs(collection(db, "seasons", seasonId, "rosterAssignments")),
      ]);
    teamsById = new Map(
      teamSnapshot.docs.map((item) => [
        item.id,
        { teamId: item.id, ...item.data() },
      ]),
    );
    const all = assignmentSnapshot.docs.map((item) => ({
        assignmentId: item.id,
        ...item.data(),
      })),
      active = all.filter((item) => item.status === "active"),
      history = all.filter((item) => item.status === "replaced"),
      activeByRank = new Map(),
      historyByRank = new Map();
    active.forEach((item) => {
      const key = `${item.teamId}|${Number(item.rankNumber)}`,
        current = activeByRank.get(key);
      if (!current || priority(item) > priority(current))
        activeByRank.set(key, item);
    });
    history.forEach((item) => {
      const key = `${item.teamId}|${Number(item.rankNumber)}`,
        list = historyByRank.get(key) || [];
      list.push(item);
      historyByRank.set(key, list);
    });
    assignmentsById = new Map();
    panel.innerHTML = [...teamsById.values()]
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((team, index) => {
        const rows = Array.from({ length: 14 }, (_, offset) => offset + 1)
          .map((rank) => {
            const key = `${team.teamId}|${rank}`,
              current = activeByRank.get(key),
              id =
                current?.assignmentId ||
                canonicalId(seasonId, team.teamId, rank),
              item = current || {
                assignmentId: id,
                seasonId,
                teamId: team.teamId,
                rankNumber: rank,
                status: "unassigned",
              };
            assignmentsById.set(id, item);
            return `<div class="roster-admin-row"><span>R${rank}</span><div class="roster-current-player">${current ? `<b>${esc(current.playerId)} · ${esc(nameOf(playerById.get(current.playerId)) || current.playerNameSnapshot)}</b><small>Active player</small>` : `<b class="roster-empty-rank">No player assigned</b><small>Rank ${rank} is available</small>`}</div>${historyHtml((historyByRank.get(key) || []).sort((a, b) => String(a.replacedAt || a.assignmentId).localeCompare(String(b.replacedAt || b.assignmentId))))}<button type="button" class="secondary compact-button" data-manage-assignment="${esc(id)}">Manage rank</button></div>`;
          })
          .join("");
        return `<details class="roster-admin-team" ${index === 0 ? "open" : ""}><summary><div><b>${esc(team.name || team.teamId)}</b><small>Captain · ${esc(team.captainNameSnapshot || "Not recorded")}</small></div><span class="badge navy">14 ranks</span></summary><div><div class="roster-admin-row roster-admin-head"><span>Rank</span><span>Active Player ID &amp; Name</span><span>Replaced Player IDs &amp; Names</span><span>Action</span></div>${rows}</div></details>`;
      })
      .join("");
    panel
      .querySelectorAll("[data-manage-assignment]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          startAssignment(button.dataset.manageAssignment),
        ),
      );
    statusBox.textContent = `${teamsById.size} teams · ${activeByRank.size} ranked assignments · ${history.length} replacement history rows.`;
  } catch (error) {
    panel.innerHTML = `<div class="empty-state compact"><b>Roster could not be loaded</b><p>${esc(error.message)}</p></div>`;
    statusBox.textContent = "Firebase roster access failed.";
  }
}
function startAssignment(id) {
  const assignment = assignmentsById.get(id),
    team = teamsById.get(assignment?.teamId);
  if (!assignment) return;
  $("#replacementAssignmentId").value = id;
  $("#rosterReplacementContext").textContent =
    `${team?.name || assignment.teamId} · Rank ${assignment.rankNumber}`;
  playerSelect.value = assignment.playerId || "";
  recordReplacement.checked = assignment.status === "active";
  recordReplacement.disabled = assignment.status !== "active";
  $("#rosterReplacementMessage").textContent =
    "For a true replacement, keep history selected. For a data correction, turn it off.";
  $("#saveRosterReplacement").textContent = "Save rank";
  openDialog();
}
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin()) return;
  const assignment = assignmentsById.get($("#replacementAssignmentId").value),
    next = playerById.get(playerSelect.value),
    seasonId = seasonSelect.value;
  if (!assignment || !next) return;
  await validatePlayerIds([next.playerId]);
  const preserve = assignment.status === "active" && recordReplacement.checked,
    nextName = await canonicalPlayerName(next.playerId),
    batch = writeBatch(db),
    id = canonicalId(seasonId, assignment.teamId, assignment.rankNumber),
    data = {
      assignmentId: id,
      seasonId,
      teamId: assignment.teamId,
      rankNumber: Number(assignment.rankNumber),
      playerId: next.playerId,
      playerNameSnapshot: nextName,
      assignmentType: preserve
        ? "replacement"
        : assignment.assignmentType || "original",
      status: "active",
      originalPlayerId: preserve
        ? assignment.originalPlayerId || assignment.playerId
        : next.playerId,
      originalPlayerNameSnapshot: preserve
        ? assignment.originalPlayerNameSnapshot || assignment.playerNameSnapshot
        : nextName,
      updatedAt: serverTimestamp(),
      updatedByUid: auth.currentUser.uid,
    };
  if (preserve && assignment.playerId !== next.playerId) {
    const historyId = `${id}-H-${Date.now()}`,
      history = {
        seasonId,
        teamId: assignment.teamId,
        rankNumber: Number(assignment.rankNumber),
        playerId: assignment.playerId,
        playerNameSnapshot:
          assignment.playerNameSnapshot ||
          nameOf(playerById.get(assignment.playerId)),
        status: "replaced",
        replacementPlayerId: next.playerId,
        replacementPlayerNameSnapshot: nextName,
        replacedAt: serverTimestamp(),
        replacedByUid: auth.currentUser.uid,
      };
    batch.set(
      doc(db, "seasons", seasonId, "rosterAssignments", historyId),
      history,
    );
  }
  batch.set(doc(db, "seasons", seasonId, "rosterAssignments", id), data, {
    merge: true,
  });
  $("#saveRosterReplacement").disabled = true;
  try {
    await batch.commit();
    closeDialog();
    await loadRoster();
  } catch (error) {
    $("#rosterReplacementMessage").textContent =
      error.message || "Roster save failed.";
  } finally {
    $("#saveRosterReplacement").disabled = false;
  }
});
async function loadSeasons() {
  if (!isAdmin()) return;
  const snapshot = await getDocs(collection(db, "seasons")),
    seasons = snapshot.docs
      .map((item) => ({ seasonId: item.id, ...item.data() }))
      .sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
  seasonSelect.innerHTML = seasons
    .map(
      (item) =>
        `<option value="${esc(item.seasonId)}">${esc(item.name || item.seasonId)}</option>`,
    )
    .join("");
  if (seasons.some((item) => item.seasonId === "AO-S-2026"))
    seasonSelect.value = "AO-S-2026";
  await loadRoster();
}
seasonSelect?.addEventListener("change", loadRoster);
$("#exportTeamRoster")?.addEventListener("click", exportTeamRoster);
$("#refreshRosterAdmin")?.addEventListener("click", loadRoster);
$("#closeRosterReplacement")?.addEventListener("click", closeDialog);
$("#cancelRosterReplacement")?.addEventListener("click", closeDialog);
onAuthStateChanged(auth, (user) => {
  if (user?.emailVerified && user.email?.toLowerCase() === ADMIN) loadSeasons();
});
window.addEventListener("alphaopen:profile-ready", loadSeasons);
