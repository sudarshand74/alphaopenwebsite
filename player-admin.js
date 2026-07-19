import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDocs, getFirestore, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

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
const ADMIN_EMAIL = "sudarshandesai74@gmail.com";
const $ = selector => document.querySelector(selector);
const addDialog = $("#addPlayerDialog");
const addForm = $("#addPlayerForm");
const importDialog = $("#importPlayersDialog");
const importForm = $("#importPlayersForm");
const editDialog = $("#editPlayerDialog");
const editForm = $("#editPlayerForm");
const playerPanel = $("#playerMasterPanel");
const playerCount = $("#playerMasterCount");
const importSummary = $("#playerImportSummary");
const importPreview = $("#playerImportPreview");
const commitImport = $("#commitPlayerImport");
let playerCache = [];
let preparedImport = [];
let xlsxModule;

function isAdmin(user = auth.currentUser) {
  return Boolean(user?.emailVerified && user.email?.toLowerCase() === ADMIN_EMAIL);
}

function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function normalizeName(value) { return String(value || "").trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase(); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]); }
function openDialog(dialog) { typeof dialog.showModal === "function" ? dialog.showModal() : dialog.setAttribute("open", ""); }
function closeDialog(dialog) { if (!dialog.open) return; typeof dialog.close === "function" ? dialog.close() : dialog.removeAttribute("open"); }
function numericId(playerId) { const match = /^P(\d+)$/.exec(playerId || ""); return match ? Number(match[1]) : 0; }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

async function loadXlsx() {
  xlsxModule ||= import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  return xlsxModule;
}

function excelValue(value) {
  if (value == null) return "";
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date || ["string", "number", "boolean"].includes(typeof value)) return value;
  return JSON.stringify(value);
}

async function exportAllPlayers() {
  if (!isAdmin()) return;
  if (!playerCache.length) {
    window.alphaOpenAuthUI.showMessage("There are no Player Master records to export");
    return;
  }
  const button = $("#exportPlayers");
  button.disabled = true;
  try {
    const XLSX = await loadXlsx();
    const preferredFields = [
      ["Player ID", "playerId"], ["First Name", "firstName"], ["Last Name", "lastName"],
      ["Full Name", "fullName"], ["Email Address", "emailNormalized"], ["Mobile Number", "phone"],
      ["T-Shirt Size", "tShirtSize"], ["AOR Suggested", "globalRank"], ["Global Score", "globalScore"],
      ["Status", "status"], ["Waiver Status", "waiverStatus"], ["Emergency Contact", "emergencyContact"],
      ["Internal Notes", "internalNotes"], ["Created At", "createdAt"], ["Updated At", "updatedAt"],
      ["Created By UID", "createdByUid"], ["Updated By UID", "updatedByUid"]
    ];
    const knownKeys = new Set(preferredFields.map(([, key]) => key));
    const additionalKeys = [...new Set(playerCache.flatMap(player => Object.keys(player)))]
      .filter(key => !knownKeys.has(key)).sort();
    const rows = playerCache.map(player => Object.fromEntries([
      ...preferredFields.map(([heading, key]) => [heading, excelValue(player[key])]),
      ...additionalKeys.map(key => [key, excelValue(player[key])])
    ]));
    const worksheet = XLSX.utils.json_to_sheet(rows, { cellDates: true });
    worksheet["!autofilter"] = { ref: worksheet["!ref"] };
    worksheet["!cols"] = Object.keys(rows[0]).map(heading => ({ wch: Math.min(45, Math.max(12, heading.length + 2)) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "All Players");
    const exportDate = new Date().toISOString().slice(0, 10);
    XLSX.writeFileXLSX(workbook, `AlphaOpen-All-Player-Data-${exportDate}.xlsx`, { cellDates: true });
    window.alphaOpenAuthUI.showMessage(`${playerCache.length} players exported to Excel`);
  } catch (error) {
    console.error("Player export failed", error);
    window.alphaOpenAuthUI.showMessage(`Player export failed: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

function renderPlayers(filter = "") {
  const term = filter.trim().toLowerCase();
  const filtered = !term ? playerCache : playerCache.filter(player => [
    player.playerId, player.firstName, player.lastName, player.fullName, player.emailNormalized,
    player.phone, player.tShirtSize, player.globalRank
  ].some(value => String(value ?? "").toLowerCase().includes(term)));
  playerCount.textContent = term ? `${filtered.length} of ${playerCache.length}` : `${playerCache.length} player${playerCache.length === 1 ? "" : "s"}`;
  playerPanel.innerHTML = filtered.length ? filtered.map(player => `<div class="player-master-row"><span>${escapeHtml(player.playerId)}</span><b>${escapeHtml(player.fullName)}</b><small>${escapeHtml(player.emailNormalized)}</small><small>${escapeHtml(player.phone || "—")}</small><small>${escapeHtml(player.tShirtSize || "—")}</small><small>${player.globalRank || "—"}</small><button class="secondary compact-button" type="button" data-edit-player="${escapeHtml(player.playerId)}">Edit</button></div>`).join("") : `<div class="empty-state compact"><b>${term ? "No matching players" : "No players yet"}</b><p>${term ? "Try a different search." : "Add one player or import the Excel template."}</p></div>`;
}

async function loadPlayers() {
  if (!isAdmin()) return;
  playerPanel.innerHTML = '<p class="muted">Loading Player Master…</p>';
  try {
    const snapshot = await getDocs(collection(db, "playerPrivate"));
    playerCache = snapshot.docs.map(item => ({ playerId: item.id, ...item.data() }))
      .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
    renderPlayers($("#playerMasterSearch").value);
  } catch (error) {
    console.error("Player Master load failed", error);
    playerPanel.innerHTML = `<div class="empty-state compact"><b>Player Master could not be loaded</b><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function duplicateReason(candidate, additional = []) {
  const all = [...playerCache, ...additional];
  if (all.some(player => normalizeEmail(player.emailNormalized || player.email) === candidate.emailNormalized)) return "Duplicate email";
  if (all.some(player => normalizeName(player.fullName) === normalizeName(candidate.fullName))) return "Possible duplicate name";
  return null;
}

async function createPlayer(candidate, allowMatchingName = false) {
  if (!isAdmin()) throw new Error("Only the Super Admin can create players.");
  const email = normalizeEmail(candidate.emailNormalized || candidate.email);
  const firstName = String(candidate.firstName || "").trim();
  const lastName = String(candidate.lastName || "").trim();
  const fullName = String(candidate.fullName || `${firstName} ${lastName}`).trim();
  if (!firstName || !lastName || !fullName || !validEmail(email)) throw new Error("First Name, Last Name, Full Name, and a valid Email Address are required.");
  const exactEmail = playerCache.find(player => normalizeEmail(player.emailNormalized) === email);
  if (exactEmail) throw new Error(`Email already belongs to ${exactEmail.playerId} (${exactEmail.fullName}).`);
  const matchingName = playerCache.find(player => normalizeName(player.fullName) === normalizeName(fullName));
  if (matchingName && !allowMatchingName) throw new Error(`Possible duplicate name: ${matchingName.playerId} (${matchingName.fullName}).`);

  const counterRef = doc(db, "systemCounters", "players");
  const emailIndexRef = doc(db, "playerEmailIndex", encodeURIComponent(email));
  const highestExisting = playerCache.reduce((maximum, player) => Math.max(maximum, numericId(player.playerId)), 1000);
  return runTransaction(db, async transaction => {
    const [counterSnapshot, emailSnapshot] = await Promise.all([transaction.get(counterRef), transaction.get(emailIndexRef)]);
    if (emailSnapshot.exists()) throw new Error(`Email is already assigned to ${emailSnapshot.data().playerId}.`);
    let nextNumber = Math.max(counterSnapshot.exists() ? Number(counterSnapshot.data().nextNumber) || 1001 : highestExisting + 1, 1001);
    let playerId = `P${nextNumber}`;
    let privateRef = doc(db, "playerPrivate", playerId);
    let publicRef = doc(db, "players", playerId);
    while ((await transaction.get(privateRef)).exists()) {
      nextNumber += 1;
      playerId = `P${nextNumber}`;
      privateRef = doc(db, "playerPrivate", playerId);
      publicRef = doc(db, "players", playerId);
    }
    const shared = { playerId, status: "active", createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    transaction.set(publicRef, { ...shared, displayName: fullName, publicProfileEnabled: false, photoUrl: null });
    transaction.set(privateRef, {
      ...shared, firstName, lastName, fullName, emailNormalized: email, phone: String(candidate.phone || "").trim() || null,
      tShirtSize: String(candidate.tShirtSize || "").trim().toUpperCase() || null,
      globalRank: candidate.globalRank ? Number(candidate.globalRank) : null, globalScore: null, waiverStatus: null,
      emergencyContact: null, internalNotes: null, createdByUid: auth.currentUser.uid, updatedByUid: auth.currentUser.uid
    });
    transaction.set(emailIndexRef, { emailNormalized: email, playerId, status: "active", createdAt: serverTimestamp(), createdByUid: auth.currentUser.uid });
    transaction.set(counterRef, { nextNumber: nextNumber + 1, updatedAt: serverTimestamp(), updatedByUid: auth.currentUser.uid }, { merge: true });
    return playerId;
  });
}

async function submitAddPlayer(event) {
  event.preventDefault();
  const message = $("#addPlayerMessage");
  const candidate = { firstName: $("#playerFirstName").value, lastName: $("#playerLastName").value, fullName: $("#playerFullName").value, email: $("#playerEmail").value, phone: $("#playerPhone").value, tShirtSize: $("#playerTShirt").value, globalRank: $("#playerGlobalRank").value };
  let allowMatchingName = false;
  const matchingName = playerCache.find(player => normalizeName(player.fullName) === normalizeName(candidate.fullName));
  if (matchingName) allowMatchingName = window.confirm(`${matchingName.playerId} already has the same name. Are these definitely different people?`);
  if (matchingName && !allowMatchingName) return;
  try {
    $("#savePlayer").disabled = true;
    const playerId = await createPlayer(candidate, allowMatchingName);
    closeDialog(addDialog); addForm.reset(); await loadPlayers();
    window.alphaOpenAuthUI.showMessage(`${playerId} created for ${candidate.fullName}`);
  } catch (error) { message.textContent = error.message; }
  finally { $("#savePlayer").disabled = false; }
}

function openEditPlayer(playerId) {
  if (!isAdmin()) return;
  const player = playerCache.find(item => item.playerId === playerId);
  if (!player) return;
  $("#editPlayerId").value = player.playerId;
  $("#editPlayerEmail").value = player.emailNormalized || "";
  $("#editPlayerFirstName").value = player.firstName || "";
  $("#editPlayerLastName").value = player.lastName || "";
  $("#editPlayerFullName").value = player.fullName || "";
  $("#editPlayerPhone").value = player.phone || "";
  $("#editPlayerTShirt").value = player.tShirtSize || "";
  $("#editPlayerGlobalRank").value = player.globalRank || "";
  $("#editPlayerMessage").textContent = "Player ID is permanent. A changed Email Address must remain unique.";
  openDialog(editDialog);
}

async function submitEditPlayer(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  const playerId = $("#editPlayerId").value;
  const existing = playerCache.find(player => player.playerId === playerId);
  if (!existing) return;
  const candidate = {
    email: normalizeEmail($("#editPlayerEmail").value), firstName: $("#editPlayerFirstName").value.trim(),
    lastName: $("#editPlayerLastName").value.trim(), fullName: $("#editPlayerFullName").value.trim(),
    phone: $("#editPlayerPhone").value.trim(), tShirtSize: $("#editPlayerTShirt").value,
    globalRank: $("#editPlayerGlobalRank").value
  };
  const message = $("#editPlayerMessage");
  if (!candidate.firstName || !candidate.lastName || !candidate.fullName || !validEmail(candidate.email)) {
    message.textContent = "First Name, Last Name, Full Name, and a valid Email Address are required."; return;
  }
  const duplicateEmail = playerCache.find(player => player.playerId !== playerId && normalizeEmail(player.emailNormalized) === candidate.email);
  if (duplicateEmail) { message.textContent = `Email already belongs to ${duplicateEmail.playerId} (${duplicateEmail.fullName}).`; return; }
  const duplicateName = playerCache.find(player => player.playerId !== playerId && normalizeName(player.fullName) === normalizeName(candidate.fullName));
  if (duplicateName && !window.confirm(`${duplicateName.playerId} has the same Full Name. Save only if these are different people. Continue?`)) return;

  const oldEmail = normalizeEmail(existing.emailNormalized);
  const privateRef = doc(db, "playerPrivate", playerId);
  const publicRef = doc(db, "players", playerId);
  const oldIndexRef = doc(db, "playerEmailIndex", encodeURIComponent(oldEmail));
  const newIndexRef = doc(db, "playerEmailIndex", encodeURIComponent(candidate.email));
  try {
    $("#saveEditedPlayer").disabled = true;
    await runTransaction(db, async transaction => {
      const [privateSnapshot, oldIndexSnapshot, newIndexSnapshot] = await Promise.all([
        transaction.get(privateRef), transaction.get(oldIndexRef), transaction.get(newIndexRef)
      ]);
      if (!privateSnapshot.exists()) throw new Error("Player Master record no longer exists.");
      if (newIndexSnapshot.exists() && newIndexSnapshot.data().playerId !== playerId) throw new Error(`Email is already assigned to ${newIndexSnapshot.data().playerId}.`);
      transaction.update(privateRef, {
        firstName: candidate.firstName, lastName: candidate.lastName, fullName: candidate.fullName,
        emailNormalized: candidate.email, phone: candidate.phone || null,
        tShirtSize: candidate.tShirtSize || null, globalRank: candidate.globalRank ? Number(candidate.globalRank) : null,
        updatedByUid: auth.currentUser.uid, updatedAt: serverTimestamp()
      });
      transaction.set(publicRef, { playerId, displayName: candidate.fullName, updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(newIndexRef, { emailNormalized: candidate.email, playerId, status: "active", updatedAt: serverTimestamp(), updatedByUid: auth.currentUser.uid }, { merge: true });
      if (oldEmail !== candidate.email && oldIndexSnapshot.exists()) transaction.delete(oldIndexRef);
    });
    closeDialog(editDialog); await loadPlayers();
    window.alphaOpenAuthUI.showMessage(`${playerId} updated successfully`);
  } catch (error) { message.textContent = error.message; }
  finally { $("#saveEditedPlayer").disabled = false; }
}

function rowValue(row, aliases) {
  const entries = Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), value]);
  return entries.find(([key]) => aliases.includes(key))?.[1] ?? "";
}

async function prepareExcel(file) {
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(await file.arrayBuffer());
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
  const accepted = [];
  const reviewed = rows.map((row, index) => {
    const candidate = {
      firstName: String(rowValue(row, ["firstname", "first"])).trim(),
      lastName: String(rowValue(row, ["lastname", "last", "surname"])).trim(),
      fullName: String(rowValue(row, ["fullname", "playername", "name"])).trim(),
      email: normalizeEmail(rowValue(row, ["email", "emailaddress", "googleemail"])),
      phone: String(rowValue(row, ["mobilenumber", "phone", "phonenumber", "mobile"])).trim(),
      tShirtSize: String(rowValue(row, ["tshirtsize", "tshirt", "shirtsize"])).trim(),
      globalRank: rowValue(row, ["aorsuggested", "globalrank", "rank"]) || null
    };
    candidate.fullName ||= `${candidate.firstName} ${candidate.lastName}`.trim();
    let reason = !candidate.firstName ? "Missing First Name" : !candidate.lastName ? "Missing Last Name" : !validEmail(candidate.email) ? "Missing or invalid Email Address" : duplicateReason(candidate, accepted);
    if (!reason) accepted.push({ ...candidate, emailNormalized: candidate.email });
    return { row: index + 2, candidate, reason, valid: !reason };
  });
  preparedImport = reviewed.filter(item => item.valid).map(item => item.candidate);
  const duplicates = reviewed.filter(item => item.reason?.toLowerCase().includes("duplicate")).length;
  const invalid = reviewed.length - preparedImport.length - duplicates;
  importSummary.textContent = `${preparedImport.length} ready · ${duplicates} duplicates skipped · ${invalid} invalid rows skipped`;
  importPreview.innerHTML = reviewed.slice(0, 100).map(item => `<div class="import-row ${item.valid ? "valid" : "invalid"}"><span>Row ${item.row}</span><b>${escapeHtml(item.candidate.fullName || "Unnamed")}</b><small>${escapeHtml(item.candidate.email || "No email")}</small><em>${item.valid ? "Ready" : escapeHtml(item.reason)}</em></div>`).join("");
  commitImport.disabled = preparedImport.length === 0;
}

async function commitExcel(event) {
  event.preventDefault();
  commitImport.disabled = true;
  let created = 0;
  const skipped = [];
  for (const candidate of preparedImport) {
    importSummary.textContent = `Importing ${created + 1} of ${preparedImport.length}…`;
    try {
      const playerId = await createPlayer(candidate);
      playerCache.push({ ...candidate, emailNormalized: candidate.email, playerId, status: "active" });
      created += 1;
    } catch (error) { skipped.push(`${candidate.fullName}: ${error.message}`); }
  }
  preparedImport = [];
  importSummary.textContent = `${created} players created${skipped.length ? ` · ${skipped.length} skipped due to concurrent duplicates` : ""}.`;
  await loadPlayers();
  window.alphaOpenAuthUI.showMessage(`${created} Player Master records created`);
}

$("#addPlayer").addEventListener("click", () => { $("#addPlayerMessage").textContent = "Exact email duplicates are blocked. Matching names require confirmation."; openDialog(addDialog); });
function updateFullName() {
  $("#playerFullName").value = `${$("#playerFirstName").value.trim()} ${$("#playerLastName").value.trim()}`.trim();
}
$("#playerFirstName").addEventListener("input", updateFullName);
$("#playerLastName").addEventListener("input", updateFullName);
function updateEditedFullName() {
  $("#editPlayerFullName").value = `${$("#editPlayerFirstName").value.trim()} ${$("#editPlayerLastName").value.trim()}`.trim();
}
$("#editPlayerFirstName").addEventListener("input", updateEditedFullName);
$("#editPlayerLastName").addEventListener("input", updateEditedFullName);
$("#importPlayers").addEventListener("click", () => openDialog(importDialog));
$("#exportPlayers").addEventListener("click", exportAllPlayers);
$("#refreshPlayers").addEventListener("click", loadPlayers);
$("#playerMasterSearch").addEventListener("input", event => renderPlayers(event.target.value));
playerPanel.addEventListener("click", event => {
  const button = event.target.closest("[data-edit-player]");
  if (button) openEditPlayer(button.dataset.editPlayer);
});
$("#closeAddPlayer").addEventListener("click", () => closeDialog(addDialog));
$("#cancelAddPlayer").addEventListener("click", () => closeDialog(addDialog));
$("#closeImportPlayers").addEventListener("click", () => closeDialog(importDialog));
$("#cancelImportPlayers").addEventListener("click", () => closeDialog(importDialog));
$("#closeEditPlayer").addEventListener("click", () => closeDialog(editDialog));
$("#cancelEditPlayer").addEventListener("click", () => closeDialog(editDialog));
addForm.addEventListener("submit", submitAddPlayer);
importForm.addEventListener("submit", commitExcel);
editForm.addEventListener("submit", submitEditPlayer);
$("#playerImportFile").addEventListener("change", event => event.target.files[0] && prepareExcel(event.target.files[0]).catch(error => { importSummary.textContent = error.message; commitImport.disabled = true; }));
$("#downloadPlayerTemplate").addEventListener("click", async () => {
  const XLSX = await loadXlsx();
  const worksheet = XLSX.utils.json_to_sheet([{ "Email Address": "player@example.com", "First Name": "Example", "Last Name": "Player", "Full Name": "Example Player", "Mobile Number": "", "T-Shirt Size": "L", "AOR Suggested": "" }]);
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, "Player Master"); XLSX.writeFileXLSX(workbook, "AlphaOpen-Player-Master-Template.xlsx");
});

onAuthStateChanged(auth, user => { if (isAdmin(user)) loadPlayers(); });
