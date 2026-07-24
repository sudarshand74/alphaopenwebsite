import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, limit, query, runTransaction, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=3";
import { bumpPlayerMasterVersion } from "./player-identity.js?v=1";

const ADMIN_EMAIL = "sudarshandesai74@gmail.com";
const $ = selector => document.querySelector(selector);
const addDialog = $("#addPlayerDialog");
const addForm = $("#addPlayerForm");
const importDialog = $("#importPlayersDialog");
const importForm = $("#importPlayersForm");
const editDialog = $("#editPlayerDialog");
const editForm = $("#editPlayerForm");
const emailTransferDialog = $("#emailTransferDialog");
const emailTransferForm = $("#emailTransferForm");
const playerPanel = $("#playerMasterPanel");
const playerCount = $("#playerMasterCount");
const importSummary = $("#playerImportSummary");
const importPreview = $("#playerImportPreview");
const commitImport = $("#commitPlayerImport");
let playerCache = [];
let preparedImport = [];
let pendingEmailTransfer = null;
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
      ["T-Shirt Size", "tShirtSize"], ["AOR Suggested", "globalRank"],
      ["Status", "status"], ["Waiver Status", "waiverStatus"],
      ["Internal Notes", "internalNotes"], ["Created At", "createdAt"], ["Updated At", "updatedAt"],
      ["Created By UID", "createdByUid"], ["Updated By UID", "updatedByUid"]
    ];
    const knownKeys = new Set(preferredFields.map(([, key]) => key));
    const retiredKeys = new Set(["globalScore", "emergencyContact"]);
    const additionalKeys = [...new Set(playerCache.flatMap(player => Object.keys(player)))]
      .filter(key => !knownKeys.has(key) && !retiredKeys.has(key)).sort();
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
      globalRank: candidate.globalRank ? Number(candidate.globalRank) : null, waiverStatus: null,
      internalNotes: null, createdByUid: auth.currentUser.uid, updatedByUid: auth.currentUser.uid
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
    await bumpPlayerMasterVersion();
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

function openEmailTransfer(existing, candidate, linkedUser) {
  pendingEmailTransfer = {
    playerId: existing.playerId,
    oldEmail: normalizeEmail(existing.emailNormalized),
    newEmail: candidate.email,
    candidate,
    linkedUid: linkedUser.id,
    linkedEmail: normalizeEmail(linkedUser.data().email),
  };
  $("#emailTransferPlayer").textContent = `${existing.fullName} (${existing.playerId})`;
  $("#emailTransferOldEmail").textContent = linkedUser.data().email || existing.emailNormalized;
  $("#emailTransferNewEmail").textContent = candidate.email;
  $("#emailTransferConfirmation").value = "";
  $("#emailTransferAcknowledgement").checked = false;
  $("#emailTransferMessage").textContent = "No records change until you confirm the transfer.";
  closeDialog(editDialog);
  openDialog(emailTransferDialog);
}

async function transferPlayerEmail(event) {
  event.preventDefault();
  if (!isAdmin() || !pendingEmailTransfer) return;
  const transfer = pendingEmailTransfer;
  const message = $("#emailTransferMessage");
  const confirmation = normalizeEmail($("#emailTransferConfirmation").value);
  if (confirmation !== transfer.newEmail) {
    message.textContent = `Type ${transfer.newEmail} exactly to confirm.`;
    return;
  }
  if (!$("#emailTransferAcknowledgement").checked) {
    message.textContent = "Confirm that the old Google account will lose AlphaOpen access.";
    return;
  }
  const button = $("#confirmEmailTransfer");
  button.disabled = true;
  message.textContent = "Validating identity and preserving season access…";
  try {
    const linkedUsersSnapshot = await getDocs(
      query(collection(db, "users"), where("playerId", "==", transfer.playerId), limit(3)),
    );
    if (linkedUsersSnapshot.size !== 1 || linkedUsersSnapshot.docs[0].id !== transfer.linkedUid) {
      throw new Error(
        `${transfer.playerId} no longer has exactly one linked user. Refresh Player Management and resolve duplicate accounts first.`,
      );
    }
    const linkedUser = linkedUsersSnapshot.docs[0];
    const seasonsSnapshot = await getDocs(collection(db, "seasons"));
    const seasonAccess = [];
    const approverAccess = [];
    const memberRefs = [];
    const approverRefs = [];
    for (const season of seasonsSnapshot.docs) {
      const memberRef = doc(season.ref, "members", transfer.linkedUid);
      const approverRef = doc(season.ref, "approverAssignments", transfer.linkedUid);
      const [memberSnapshot, approverSnapshot] = await Promise.all([
        getDoc(memberRef),
        getDoc(approverRef),
      ]);
      if (memberSnapshot.exists() && memberSnapshot.data().status === "active") {
        seasonAccess.push({
          seasonId: season.id,
          roles: memberSnapshot.data().roles || [],
          teamIds: memberSnapshot.data().teamIds || [],
        });
        memberRefs.push(memberRef);
      }
      if (approverSnapshot.exists() && approverSnapshot.data().status === "active") {
        approverAccess.push({
          seasonId: season.id,
          scopeType: approverSnapshot.data().scopeType || "season",
          weekId: approverSnapshot.data().weekId || null,
          matchupId: approverSnapshot.data().matchupId || null,
          priority: Number(approverSnapshot.data().priority) || 1,
        });
        approverRefs.push(approverRef);
      }
    }
    const privateRef = doc(db, "playerPrivate", transfer.playerId);
    const publicRef = doc(db, "players", transfer.playerId);
    const oldIndexRef = doc(db, "playerEmailIndex", encodeURIComponent(transfer.oldEmail));
    const newIndexRef = doc(db, "playerEmailIndex", encodeURIComponent(transfer.newEmail));
    const userRef = linkedUser.ref;
    const registrationRef = doc(db, "registrationRequests", transfer.linkedUid);
    const accountLinkRef = doc(db, "playerAccountLinks", transfer.playerId);
    await runTransaction(db, async (transaction) => {
      const references = [
        privateRef,
        oldIndexRef,
        newIndexRef,
        userRef,
        registrationRef,
        accountLinkRef,
        ...memberRefs,
        ...approverRefs,
      ];
      const snapshots = await Promise.all(references.map((reference) => transaction.get(reference)));
      const [
        privateSnapshot,
        oldIndexSnapshot,
        newIndexSnapshot,
        userSnapshot,
        registrationSnapshot,
        accountLinkSnapshot,
      ] = snapshots;
      if (!privateSnapshot.exists()) throw new Error("Player Master record no longer exists.");
      if (!userSnapshot.exists() || userSnapshot.data().playerId !== transfer.playerId) {
        throw new Error("The old user account is no longer linked to this Player ID.");
      }
      if (newIndexSnapshot.exists() && newIndexSnapshot.data().playerId !== transfer.playerId) {
        throw new Error(`The new email is already assigned to ${newIndexSnapshot.data().playerId}.`);
      }
      if (accountLinkSnapshot.exists() && accountLinkSnapshot.data().uid !== transfer.linkedUid) {
        throw new Error("The approved account link belongs to a different Firebase UID.");
      }
      const candidate = transfer.candidate;
      transaction.update(privateRef, {
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        fullName: candidate.fullName,
        emailNormalized: transfer.newEmail,
        phone: candidate.phone || null,
        tShirtSize: candidate.tShirtSize || null,
        globalRank: candidate.globalRank ? Number(candidate.globalRank) : null,
        accountUid: null,
        accountStatus: "awaitingRegistration",
        updatedByUid: auth.currentUser.uid,
        updatedAt: serverTimestamp(),
      });
      transaction.set(publicRef, {
        playerId: transfer.playerId,
        displayName: candidate.fullName,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      transaction.set(newIndexRef, {
        emailNormalized: transfer.newEmail,
        playerId: transfer.playerId,
        status: "active",
        updatedAt: serverTimestamp(),
        updatedByUid: auth.currentUser.uid,
      }, { merge: true });
      if (transfer.oldEmail !== transfer.newEmail && oldIndexSnapshot.exists()) {
        transaction.delete(oldIndexRef);
      }
      transaction.update(userRef, {
        status: "suspended",
        profileType: "pending",
        playerId: null,
        globalRoles: [],
        playerEmailNormalized: transfer.oldEmail,
        suspensionReason: `Login email transferred to ${transfer.newEmail}`,
        updatedAt: serverTimestamp(),
      });
      transaction.set(registrationRef, {
        ...(registrationSnapshot.exists() ? {} : {
          uid: transfer.linkedUid,
          email: transfer.linkedEmail,
          requestedAt: serverTimestamp(),
        }),
        status: "rejected",
        matchedPlayerId: null,
        assignedProfileType: null,
        decidedByUid: auth.currentUser.uid,
        decidedAt: serverTimestamp(),
        decisionNote: `Login email transferred to ${transfer.newEmail}`,
      }, { merge: true });
      transaction.set(accountLinkRef, {
        playerId: transfer.playerId,
        uid: transfer.linkedUid,
        emailAtApproval: transfer.linkedEmail,
        status: "revoked",
        revokedByUid: auth.currentUser.uid,
        revokedAt: serverTimestamp(),
        reason: `Login email transferred to ${transfer.newEmail}`,
        transferStatus: "awaitingRegistration",
        previousUid: transfer.linkedUid,
        previousEmail: transfer.linkedEmail,
        pendingNewEmail: transfer.newEmail,
        pendingGlobalRoles: linkedUser.data().globalRoles || [],
        pendingSeasonAccess: seasonAccess,
        pendingApproverAccess: approverAccess,
        transferredByUid: auth.currentUser.uid,
        transferredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      let snapshotIndex = 6;
      memberRefs.forEach((reference) => {
        const snapshot = snapshots[snapshotIndex++];
        if (snapshot.exists()) {
          transaction.update(reference, {
            status: "inactive",
            effectiveTo: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });
      approverRefs.forEach((reference) => {
        const snapshot = snapshots[snapshotIndex++];
        if (snapshot.exists()) {
          transaction.update(reference, {
            status: "inactive",
            effectiveTo: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });
    });
    pendingEmailTransfer = null;
    closeDialog(emailTransferDialog);
    await loadPlayers();
    window.alphaOpenAuthUI?.showMessage(
      `${transfer.playerId} now uses ${transfer.newEmail}. The player must register with that Google email and await approval.`,
    );
  } catch (error) {
    console.error("Player email transfer failed", error);
    message.textContent = error.message || "The email transfer could not be completed.";
  } finally {
    button.disabled = false;
  }
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
    const [linkedUsersSnapshot, registrationSnapshot] = await Promise.all([
      getDocs(query(collection(db, "users"), where("playerId", "==", playerId), limit(2))),
      getDocs(query(collection(db, "registrationRequests"), where("matchedPlayerId", "==", playerId)))
    ]);
    if (linkedUsersSnapshot.size > 1) {
      const accounts = linkedUsersSnapshot.docs
        .map((item) => `${item.data().email || "email unavailable"} (${item.data().status || "unknown"})`)
        .join(" and ");
      throw new Error(
        `Identity conflict: ${playerId} is linked to multiple user accounts: ${accounts}. ` +
        `Open User Management, search ${playerId}, and delete the incorrect profile before changing the email.`,
      );
    }
    const linkedUser = linkedUsersSnapshot.docs[0] || null;
    if (linkedUser && normalizeEmail(linkedUser.data().email) !== candidate.email) {
      openEmailTransfer(existing, candidate, linkedUser);
      return;
    }
    const accountLinkRef = doc(db, "playerAccountLinks", playerId);
    await runTransaction(db, async transaction => {
      const [privateSnapshot, oldIndexSnapshot, newIndexSnapshot, accountLinkSnapshot] = await Promise.all([
        transaction.get(privateRef), transaction.get(oldIndexRef), transaction.get(newIndexRef), transaction.get(accountLinkRef)
      ]);
      if (!privateSnapshot.exists()) throw new Error("Player Master record no longer exists.");
      if (newIndexSnapshot.exists() && newIndexSnapshot.data().playerId !== playerId) throw new Error(`Email is already assigned to ${newIndexSnapshot.data().playerId}.`);
      transaction.update(privateRef, {
        firstName: candidate.firstName, lastName: candidate.lastName, fullName: candidate.fullName,
        emailNormalized: candidate.email, phone: candidate.phone || null,
        tShirtSize: candidate.tShirtSize || null, globalRank: candidate.globalRank ? Number(candidate.globalRank) : null,
        accountUid: accountLinkSnapshot.exists() ? accountLinkSnapshot.data().uid : linkedUser?.id || null,
        accountStatus: linkedUser?.data().status || accountLinkSnapshot.data()?.status || "unlinked",
        updatedByUid: auth.currentUser.uid, updatedAt: serverTimestamp()
      });
      transaction.set(publicRef, { playerId, displayName: candidate.fullName, updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(newIndexRef, { emailNormalized: candidate.email, playerId, status: "active", updatedAt: serverTimestamp(), updatedByUid: auth.currentUser.uid }, { merge: true });
      if (oldEmail !== candidate.email && oldIndexSnapshot.exists()) transaction.delete(oldIndexRef);
      if (linkedUser) transaction.set(linkedUser.ref, { playerId, playerEmailNormalized: candidate.email, updatedAt: serverTimestamp() }, { merge: true });
      registrationSnapshot.docs.forEach(request => transaction.set(request.ref, { matchedPlayerId: playerId, playerEmailNormalized: candidate.email, updatedAt: serverTimestamp() }, { merge: true }));
      if (accountLinkSnapshot.exists()) transaction.set(accountLinkRef, { playerId, emailAtApproval: candidate.email, updatedAt: serverTimestamp() }, { merge: true });
    });
    const [verifiedPrivate, verifiedPublic, verifiedIndex, verifiedOldIndex, verifiedLink] = await Promise.all([
      getDoc(privateRef), getDoc(publicRef), getDoc(newIndexRef), oldEmail === candidate.email ? Promise.resolve(null) : getDoc(oldIndexRef), getDoc(accountLinkRef)
    ]);
    const verificationErrors = [];
    if (normalizeEmail(verifiedPrivate.data()?.emailNormalized) !== candidate.email) verificationErrors.push("Player Master email");
    if (verifiedPublic.data()?.displayName !== candidate.fullName) verificationErrors.push("public display name");
    if (verifiedIndex.data()?.playerId !== playerId || normalizeEmail(verifiedIndex.data()?.emailNormalized) !== candidate.email) verificationErrors.push("email index");
    if (verifiedOldIndex?.exists()) verificationErrors.push("old email index removal");
    if (linkedUser && normalizeEmail((await getDoc(linkedUser.ref)).data()?.playerEmailNormalized) !== candidate.email) verificationErrors.push("linked user");
    for (const request of registrationSnapshot.docs) {
      const verifiedRequest = await getDoc(request.ref);
      if (normalizeEmail(verifiedRequest.data()?.playerEmailNormalized) !== candidate.email) verificationErrors.push(`registration ${request.id}`);
    }
    if (verifiedLink.exists() && normalizeEmail(verifiedLink.data()?.emailAtApproval) !== candidate.email) verificationErrors.push("account link");
    if (verificationErrors.length) throw new Error(`Player saved, but identity verification failed for: ${verificationErrors.join(", ")}.`);
    await bumpPlayerMasterVersion();
    closeDialog(editDialog); await loadPlayers();
    window.alphaOpenAuthUI.showMessage(`${playerId} updated and all linked identity records verified`);
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
  if (created) await bumpPlayerMasterVersion();
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
$("#closeEmailTransfer").addEventListener("click", () => {
  pendingEmailTransfer = null;
  closeDialog(emailTransferDialog);
});
$("#cancelEmailTransfer").addEventListener("click", () => {
  pendingEmailTransfer = null;
  closeDialog(emailTransferDialog);
});
addForm.addEventListener("submit", submitAddPlayer);
importForm.addEventListener("submit", commitExcel);
editForm.addEventListener("submit", submitEditPlayer);
emailTransferForm.addEventListener("submit", transferPlayerEmail);
$("#playerImportFile").addEventListener("change", event => event.target.files[0] && prepareExcel(event.target.files[0]).catch(error => { importSummary.textContent = error.message; commitImport.disabled = true; }));
$("#downloadPlayerTemplate").addEventListener("click", async () => {
  const XLSX = await loadXlsx();
  const worksheet = XLSX.utils.json_to_sheet([{ "Email Address": "player@example.com", "First Name": "Example", "Last Name": "Player", "Full Name": "Example Player", "Mobile Number": "", "T-Shirt Size": "L", "AOR Suggested": "" }]);
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, "Player Master"); XLSX.writeFileXLSX(workbook, "AlphaOpen-Player-Master-Template.xlsx");
});

onAuthStateChanged(auth, user => { if (isAdmin(user)) loadPlayers(); });
