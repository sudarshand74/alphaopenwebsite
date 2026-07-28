import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=5";
import { formattedPlayerLabel, resolvedPlayerName } from "./player-identity.js?v=5";

const ADMIN_EMAIL = "sudarshandesai74@gmail.com";
const ALLOWED_ROLES = ["captain", "ec", "neutralApprover"];
const ROLE_LABELS = {
  captain: "Captain",
  ec: "EC",
  neutralApprover: "Neutral Approver",
};
const $ = (selector) => document.querySelector(selector);
const panel = $("#operationsAccessPanel");
const count = $("#operationsAccessCount");
const search = $("#operationsAccessSearch");
const dialog = $("#operationsAccessDialog");
const form = $("#operationsAccessForm");
const importDialog = $("#operationsAccessImportDialog");
const importForm = $("#operationsAccessImportForm");
const importSummary = $("#operationsAccessImportSummary");
const importPreview = $("#operationsAccessImportPreview");
const commitImport = $("#commitOperationsAccessImport");
let players = [];
let grants = [];
let usersByEmail = new Map();
let activeSeason = null;
let activeTeams = [];
let preparedImport = [];
let xlsxModule;

function isAdmin(user = auth.currentUser) {
  return Boolean(user?.emailVerified && user.email?.toLowerCase() === ADMIN_EMAIL);
}
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}
function openDialog(element) {
  typeof element.showModal === "function" ? element.showModal() : element.setAttribute("open", "");
}
function closeDialog(element) {
  if (!element.open) return;
  typeof element.close === "function" ? element.close() : element.removeAttribute("open");
}
function playerName(player) {
  return resolvedPlayerName(
    player?.playerId,
    player?.fullName,
    player?.displayName,
    [player?.firstName, player?.lastName].filter(Boolean).join(" "),
  ) || "";
}
function accessDocumentId(email) {
  return normalizeEmail(email);
}
function normalizedRoles(values) {
  const requested = new Set(values);
  return ALLOWED_ROLES.filter((role) => requested.has(role));
}
function profileType(roles) {
  return roles.includes("ec")
    ? "ec"
    : roles.includes("captain")
      ? "captain"
      : "neutralApprover";
}
function teamIdsFor(playerId, roles) {
  if (!roles.includes("captain") || !activeSeason) return [];
  return activeTeams
    .filter((team) => (team.captainPlayerIds || []).includes(playerId))
    .map((team) => team.teamId)
    .sort();
}
function roleLabels(roles) {
  return roles.map((role) => ROLE_LABELS[role] || role);
}
function rowValue(row, aliases) {
  const entries = Object.entries(row).map(([key, value]) => [
    key.toLowerCase().replace(/[^a-z0-9]/g, ""),
    value,
  ]);
  return entries.find(([key]) => aliases.includes(key))?.[1] ?? "";
}
function parseRoles(value) {
  const tokens = String(value || "")
    .split(/[,;|]/)
    .map((token) => token.trim().toLowerCase().replace(/[^a-z]/g, ""))
    .filter(Boolean);
  const mapped = tokens.map((token) => ({
    captain: "captain",
    ec: "ec",
    executivecommittee: "ec",
    neutralapprover: "neutralApprover",
    approver: "neutralApprover",
  })[token]).filter(Boolean);
  return normalizedRoles(mapped);
}
async function loadXlsx() {
  xlsxModule ||= import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  return xlsxModule;
}

async function loadOperationsAccess() {
  if (!isAdmin()) return;
  panel.innerHTML = '<p class="muted">Loading approved Operations access…</p>';
  try {
    const [playersSnapshot, grantsSnapshot, usersSnapshot, controlSnapshot] = await Promise.all([
      getDocs(collection(db, "players")),
      getDocs(collection(db, "operationsAccess")),
      getDocs(collection(db, "users")),
      getDoc(doc(db, "systemConfig", "seasonControl")),
    ]);
    players = playersSnapshot.docs
      .map((item) => ({ playerId: item.id, ...item.data() }))
      .filter((player) => player.status !== "inactive")
      .sort((a, b) => (playerName(a) || a.playerId).localeCompare(playerName(b) || b.playerId));
    grants = grantsSnapshot.docs
      .map((item) => ({ accessId: item.id, ...item.data() }))
      .sort((a, b) => String(a.displayNameSnapshot || a.emailNormalized).localeCompare(String(b.displayNameSnapshot || b.emailNormalized)));
    usersByEmail = new Map(
      usersSnapshot.docs.map((item) => [
        normalizeEmail(item.data().email),
        { uid: item.id, ...item.data() },
      ]),
    );
    const activeSeasonId = controlSnapshot.exists() ? controlSnapshot.data().activeSeasonId || "" : "";
    activeSeason = null;
    activeTeams = [];
    if (activeSeasonId) {
      const [seasonSnapshot, teamsSnapshot] = await Promise.all([
        getDoc(doc(db, "seasons", activeSeasonId)),
        getDocs(collection(db, "seasons", activeSeasonId, "teams")),
      ]);
      activeSeason = seasonSnapshot.exists()
        ? { seasonId: seasonSnapshot.id, ...seasonSnapshot.data() }
        : { seasonId: activeSeasonId, name: activeSeasonId };
      activeTeams = teamsSnapshot.docs.map((item) => ({ teamId: item.id, ...item.data() }));
    }
    populatePlayerOptions();
    renderOperationsAccess(search.value);
  } catch (error) {
    console.error("Operations access load failed", error);
    panel.innerHTML = `<div class="empty-state compact"><b>Approved access could not be loaded</b><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function populatePlayerOptions() {
  const select = $("#operationsAccessPlayerId");
  select.innerHTML = '<option value="">Select Player Name (Player ID)</option>' +
    players.map((player) =>
      `<option value="${escapeHtml(player.playerId)}">${escapeHtml(formattedPlayerLabel(player.playerId, null, playerName(player)))}</option>`
    ).join("");
}

function renderOperationsAccess(filter = "") {
  const term = filter.trim().toLowerCase();
  const filtered = grants.filter((grant) => {
    const player = players.find((item) => item.playerId === grant.playerId);
    const activated = usersByEmail.get(normalizeEmail(grant.emailNormalized));
    return !term || [
      grant.playerId,
      grant.emailNormalized,
      grant.status,
      grant.displayNameSnapshot,
      playerName(player),
      ...roleLabels(grant.roles || []),
      ...(grant.teamIds || []),
      activated ? "activated" : "awaiting first sign-in",
    ].some((value) => String(value || "").toLowerCase().includes(term));
  });
  const approvedCount = grants.filter((grant) => grant.status === "approved").length;
  count.textContent = `${approvedCount} approved`;
  panel.innerHTML = filtered.length
    ? filtered.map((grant) => {
      const player = players.find((item) => item.playerId === grant.playerId);
      const activated = usersByEmail.get(normalizeEmail(grant.emailNormalized));
      const teams = (grant.teamIds || []).length ? grant.teamIds.join(", ") : "No team-specific access";
      return `<div class="operations-access-row">
        <div><b>${escapeHtml(formattedPlayerLabel(grant.playerId, null, playerName(player), grant.displayNameSnapshot))}</b><small>${escapeHtml(grant.emailNormalized)}</small></div>
        <div class="operations-access-role-list">${(grant.roles || []).map((role) => `<span class="badge navy">${escapeHtml(ROLE_LABELS[role] || role)}</span>`).join("")}<small class="operations-access-team-note">${escapeHtml(teams)}</small></div>
        <div><span class="badge ${grant.status === "approved" ? "lime" : "gray"}">${escapeHtml(grant.status || "approved")}</span><small>${activated?.status === "active" ? "Google account activated" : activated ? `Account ${activated.status || "pending"}` : "Awaiting first sign-in"}</small></div>
        <div class="operations-access-actions"><button class="secondary compact-button" type="button" data-edit-operations-access="${escapeHtml(grant.emailNormalized)}">Edit</button>${grant.status === "approved" ? `<button class="danger-button compact-button" type="button" data-revoke-operations-access="${escapeHtml(grant.emailNormalized)}">Revoke</button>` : ""}</div>
      </div>`;
    }).join("")
    : `<div class="empty-state compact"><b>${term ? "No matching approved access" : "No Operations access approved yet"}</b><p>${term ? "Try a different search." : "Approve a Captain, EC member, or Neutral Approver before their first Google sign-in."}</p></div>`;
  panel.querySelectorAll("[data-edit-operations-access]").forEach((button) =>
    button.addEventListener("click", () => openAccessEditor(button.dataset.editOperationsAccess))
  );
  panel.querySelectorAll("[data-revoke-operations-access]").forEach((button) =>
    button.addEventListener("click", () => revokeAccess(button.dataset.revokeOperationsAccess))
  );
}

function updateTeamSummary() {
  const playerId = $("#operationsAccessPlayerId").value;
  const roles = normalizedRoles(
    [...document.querySelectorAll('[name="operationsAccessRole"]:checked')].map((input) => input.value),
  );
  const teamIds = teamIdsFor(playerId, roles);
  $("#operationsAccessTeamSummary").textContent = !roles.includes("captain")
    ? `${activeSeason?.name || "No active season"} · No Captain team access requested.`
    : teamIds.length
      ? `${activeSeason?.name || activeSeason?.seasonId} · Captain access: ${teamIds.join(", ")}.`
      : `${activeSeason?.name || "No active season"} · This player is not assigned as a Team Captain yet. Save is allowed; team access will be added when the team is assigned.`;
}

function openAccessEditor(email = "") {
  if (!isAdmin()) return;
  form.reset();
  const grant = grants.find((item) => normalizeEmail(item.emailNormalized) === normalizeEmail(email));
  $("#operationsAccessDialogTitle").textContent = grant ? "Edit approved Operations access" : "Approve Operations access";
  $("#operationsAccessOriginalEmail").value = grant?.emailNormalized || "";
  $("#operationsAccessPlayerId").value = grant?.playerId || "";
  const player = players.find((item) => item.playerId === grant?.playerId);
  $("#operationsAccessEmail").value = grant?.emailNormalized || normalizeEmail(player?.emailNormalized);
  $("#operationsAccessStatus").value = grant?.status === "revoked" ? "revoked" : "approved";
  document.querySelectorAll('[name="operationsAccessRole"]').forEach((input) => {
    input.checked = Boolean(grant?.roles?.includes(input.value));
  });
  $("#operationsAccessMessage").textContent = "The person can sign in only with the exact verified Google email stored in Player Master.";
  updateTeamSummary();
  openDialog(dialog);
}

function selectedAccessRecord() {
  const playerId = $("#operationsAccessPlayerId").value;
  const player = players.find((item) => item.playerId === playerId);
  const emailNormalized = normalizeEmail(player?.emailNormalized);
  const roles = normalizedRoles(
    [...document.querySelectorAll('[name="operationsAccessRole"]:checked')].map((input) => input.value),
  );
  if (!player) throw new Error("Select a Player Master record.");
  if (!validEmail(emailNormalized)) throw new Error(`${playerId} needs a valid Player Master email before access can be approved.`);
  if (!roles.length) throw new Error("Select at least one Operations role.");
  if (emailNormalized === ADMIN_EMAIL) throw new Error("The protected Super Admin account is bootstrapped separately.");
  return {
    player,
    playerId,
    emailNormalized,
    roles,
    membershipRoles: ["player", ...roles],
    teamIds: teamIdsFor(playerId, roles),
    seasonId: activeSeason?.seasonId || null,
    status: $("#operationsAccessStatus").value,
  };
}

async function saveGrant(record, originalEmail = "", options = {}) {
  const existingGrant = grants.find((item) =>
    normalizeEmail(item.emailNormalized) === record.emailNormalized
  );
  const user = usersByEmail.get(record.emailNormalized);
  const now = serverTimestamp();
  const grantRef = doc(db, "operationsAccess", accessDocumentId(record.emailNormalized));
  const batch = writeBatch(db);
  batch.set(grantRef, {
    emailNormalized: record.emailNormalized,
    playerId: record.playerId,
    displayNameSnapshot: playerName(record.player) || record.playerId,
    roles: record.roles,
    membershipRoles: record.membershipRoles,
    seasonId: record.seasonId,
    teamIds: record.teamIds,
    status: record.status,
    createdAt: existingGrant?.createdAt || now,
    createdByUid: existingGrant?.createdByUid || auth.currentUser.uid,
    updatedAt: now,
    updatedByUid: auth.currentUser.uid,
  }, { merge: true });
  if (originalEmail && normalizeEmail(originalEmail) !== record.emailNormalized) {
    batch.set(doc(db, "operationsAccess", accessDocumentId(originalEmail)), {
      status: "revoked",
      replacedByEmail: record.emailNormalized,
      updatedAt: now,
      updatedByUid: auth.currentUser.uid,
    }, { merge: true });
  }
  if (user) {
    batch.set(doc(db, "users", user.uid), record.status === "approved" ? {
      status: "active",
      profileType: profileType(record.roles),
      playerId: record.playerId,
      globalRoles: record.roles,
      playerEmailNormalized: record.emailNormalized,
      updatedAt: now,
    } : {
      status: "suspended",
      profileType: "pending",
      globalRoles: [],
      updatedAt: now,
    }, { merge: true });
    batch.set(doc(db, "playerAccountLinks", record.playerId), record.status === "approved" ? {
      playerId: record.playerId,
      uid: user.uid,
      emailAtApproval: record.emailNormalized,
      status: "active",
      linkMethod: "preApprovedEmail",
      approvedByUid: auth.currentUser.uid,
      approvedAt: now,
      revokedByUid: null,
      revokedAt: null,
      reason: null,
    } : {
      status: "revoked",
      revokedByUid: auth.currentUser.uid,
      revokedAt: now,
      reason: "Operations access revoked by Super Admin",
    }, { merge: true });
    if (record.seasonId) {
      batch.set(doc(db, "seasons", record.seasonId, "members", user.uid), record.status === "approved" ? {
        uid: user.uid,
        playerId: record.playerId,
        roles: record.membershipRoles,
        teamIds: record.teamIds,
        status: "active",
        effectiveFrom: now,
        effectiveTo: null,
        assignedByUid: auth.currentUser.uid,
        assignedAt: now,
        updatedAt: now,
      } : {
        status: "inactive",
        effectiveTo: now,
        updatedAt: now,
      }, { merge: true });
    }
  }
  await batch.commit();
  if (!options.silent) {
    window.alphaOpenAuthUI?.showMessage(
      record.status === "approved"
        ? `${formattedPlayerLabel(record.playerId, null, playerName(record.player))} can sign in with ${record.emailNormalized}`
        : `${record.emailNormalized} Operations access revoked`,
    );
  }
}

async function submitAccess(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  const message = $("#operationsAccessMessage");
  const button = $("#saveOperationsAccess");
  try {
    button.disabled = true;
    const record = selectedAccessRecord();
    await saveGrant(record, $("#operationsAccessOriginalEmail").value);
    closeDialog(dialog);
    await loadOperationsAccess();
  } catch (error) {
    console.error("Operations access save failed", error);
    message.textContent = error.message || "Approved access could not be saved.";
  } finally {
    button.disabled = false;
  }
}

async function revokeAccess(email) {
  const grant = grants.find((item) => normalizeEmail(item.emailNormalized) === normalizeEmail(email));
  if (!grant || !window.confirm(`Revoke private Operations access for ${grant.emailNormalized}? Public guest access remains available.`)) return;
  const player = players.find((item) => item.playerId === grant.playerId);
  await saveGrant({
    player,
    playerId: grant.playerId,
    emailNormalized: normalizeEmail(grant.emailNormalized),
    roles: normalizedRoles(grant.roles || []),
    membershipRoles: grant.membershipRoles || ["player", ...normalizedRoles(grant.roles || [])],
    teamIds: grant.teamIds || [],
    seasonId: grant.seasonId || activeSeason?.seasonId || null,
    status: "revoked",
  });
  await loadOperationsAccess();
}

async function prepareImport(file) {
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
  const seenEmails = new Set();
  preparedImport = rows.map((row, index) => {
    const playerId = String(rowValue(row, ["playerid", "id"])).trim();
    const suppliedEmail = normalizeEmail(rowValue(row, ["emailaddress", "email", "googleemail"]));
    const roles = parseRoles(rowValue(row, ["roles", "role", "access"]));
    const statusValue = String(rowValue(row, ["status"])).trim().toLowerCase();
    const status = statusValue === "revoked" ? "revoked" : "approved";
    const player = players.find((item) => item.playerId === playerId);
    const masterEmail = normalizeEmail(player?.emailNormalized);
    const errors = [];
    if (!player) errors.push("Player ID is not in Player Master");
    if (!validEmail(suppliedEmail)) errors.push("valid Email Address required");
    if (player && suppliedEmail !== masterEmail) errors.push("email does not match Player Master");
    if (!roles.length) errors.push("Captain, EC, or Neutral Approver role required");
    if (seenEmails.has(suppliedEmail)) errors.push("duplicate email in file");
    if (suppliedEmail === ADMIN_EMAIL) errors.push("Super Admin is bootstrapped separately");
    seenEmails.add(suppliedEmail);
    return {
      row: index + 2,
      player,
      playerId,
      emailNormalized: suppliedEmail,
      roles,
      membershipRoles: ["player", ...roles],
      teamIds: teamIdsFor(playerId, roles),
      seasonId: activeSeason?.seasonId || null,
      status,
      errors,
    };
  });
  const valid = preparedImport.filter((record) => !record.errors.length);
  const invalid = preparedImport.filter((record) => record.errors.length);
  importSummary.textContent = `${valid.length} valid · ${invalid.length} invalid. Nothing has been written.`;
  importPreview.innerHTML = preparedImport.map((record) =>
    `<div class="import-row ${record.errors.length ? "invalid" : "valid"}"><b>Row ${record.row}</b><span>${escapeHtml(record.playerId)}</span><small>${escapeHtml(record.emailNormalized)} · ${escapeHtml(roleLabels(record.roles).join(", "))}</small><em>${escapeHtml(record.errors.join("; ") || "Ready")}</em></div>`
  ).join("") || '<div class="empty-state compact"><b>No rows found</b></div>';
  commitImport.disabled = !valid.length || Boolean(invalid.length);
}

async function commitAccessImport(event) {
  event.preventDefault();
  if (!isAdmin() || commitImport.disabled) return;
  commitImport.disabled = true;
  try {
    for (const record of preparedImport) await saveGrant(record, "", { silent: true });
    window.alphaOpenAuthUI?.showMessage(`${preparedImport.length} Operations access records approved`);
    preparedImport = [];
    closeDialog(importDialog);
    importForm.reset();
    await loadOperationsAccess();
  } catch (error) {
    console.error("Operations access import failed", error);
    importSummary.textContent = error.message || "Approved access import failed.";
  } finally {
    commitImport.disabled = true;
  }
}

async function downloadTemplate() {
  const XLSX = await loadXlsx();
  const worksheet = XLSX.utils.json_to_sheet([
    {
      "Player ID": "",
      "Email Address": "",
      "Roles": "Captain",
      "Status": "Approved",
    },
  ]);
  worksheet["!cols"] = [{ wch: 16 }, { wch: 34 }, { wch: 32 }, { wch: 14 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Approved Access");
  XLSX.writeFileXLSX(workbook, "AlphaOpen-Operations-Access-Template.xlsx");
}

$("#addOperationsAccess")?.addEventListener("click", () => openAccessEditor());
$("#refreshOperationsAccess")?.addEventListener("click", loadOperationsAccess);
search?.addEventListener("input", (event) => renderOperationsAccess(event.target.value));
$("#operationsAccessPlayerId")?.addEventListener("change", () => {
  const player = players.find((item) => item.playerId === $("#operationsAccessPlayerId").value);
  $("#operationsAccessEmail").value = normalizeEmail(player?.emailNormalized);
  updateTeamSummary();
});
document.querySelectorAll('[name="operationsAccessRole"]').forEach((input) =>
  input.addEventListener("change", updateTeamSummary)
);
$("#closeOperationsAccessDialog")?.addEventListener("click", () => closeDialog(dialog));
$("#cancelOperationsAccessDialog")?.addEventListener("click", () => closeDialog(dialog));
form?.addEventListener("submit", submitAccess);
$("#importOperationsAccess")?.addEventListener("click", () => {
  importForm.reset();
  preparedImport = [];
  importSummary.textContent = "Choose a file to validate before import.";
  importPreview.innerHTML = "";
  commitImport.disabled = true;
  openDialog(importDialog);
});
$("#closeOperationsAccessImportDialog")?.addEventListener("click", () => closeDialog(importDialog));
$("#cancelOperationsAccessImportDialog")?.addEventListener("click", () => closeDialog(importDialog));
$("#operationsAccessImportFile")?.addEventListener("change", (event) => {
  if (event.target.files[0]) prepareImport(event.target.files[0]).catch((error) => {
    importSummary.textContent = error.message;
    commitImport.disabled = true;
  });
});
importForm?.addEventListener("submit", commitAccessImport);
$("#downloadOperationsAccessTemplate")?.addEventListener("click", downloadTemplate);
$("#downloadOperationsAccessTemplateDialog")?.addEventListener("click", downloadTemplate);

onAuthStateChanged(auth, (user) => {
  if (isAdmin(user)) loadOperationsAccess();
});
window.addEventListener("alphaopen:profile-ready", () => {
  if (isAdmin()) loadOperationsAccess();
});
