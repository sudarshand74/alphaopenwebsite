import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDocs, runTransaction, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=5";
const search = document.querySelector("#venueMasterSearch");
const list = document.querySelector("#venueMasterList");
const count = document.querySelector("#venueMasterCount");
const editDialog = document.querySelector("#editVenueDialog");
const editForm = document.querySelector("#editVenueForm");
const editMessage = document.querySelector("#editVenueMessage");
let venues = [];
let editingVenueId = null;

function canManageVenues() {
  const authorization = window.alphaOpenAuthorization || {};
  return authorization.role === "Super Admin"
    || (authorization.roles || []).includes("superAdmin")
    || (authorization.roles || []).includes("ec")
    || (authorization.access || []).includes("ec");
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function venueName(venue) { return venue.venueName || venue.name || venue.displayName || "Unnamed venue"; }
function venueAddress(venue) { return venue.fullAddress || venue.address || [venue.addressLine1, venue.addressLine2, venue.city, venue.state, venue.postalCode].filter(Boolean).join(", "); }

function closeEditVenue() {
  if (!editDialog.open) return;
  if (typeof editDialog.close === "function") editDialog.close();
  else editDialog.removeAttribute("open");
}

function showVenueDialog() {
  if (typeof editDialog.showModal === "function") editDialog.showModal();
  else editDialog.setAttribute("open", "");
}

function openAddVenue() {
  if (!canManageVenues()) return;
  editingVenueId = null;
  editForm.reset();
  document.querySelector("#editVenueId").readOnly = false;
  document.querySelector("#editVenueStatus").value = "active";
  document.querySelector("#editVenueTitle").textContent = "Add venue";
  document.querySelector("#editVenueCopy").textContent = "Create a Venue Master record. Venue ID becomes permanent after saving.";
  editMessage.textContent = "Enter a unique Venue ID using letters, numbers, hyphens, or underscores.";
  showVenueDialog();
  document.querySelector("#editVenueId").focus();
}

function openEditVenue(venueId) {
  const venue = venues.find(item => item.venueId === venueId);
  if (!venue) return;
  editingVenueId = venue.venueId;
  editForm.reset();
  document.querySelector("#editVenueId").readOnly = true;
  document.querySelector("#editVenueId").value = venue.venueId;
  document.querySelector("#editVenueName").value = venueName(venue) === "Unnamed venue" ? "" : venueName(venue);
  document.querySelector("#editVenueAddress1").value = venue.addressLine1 || venue.address || venue.fullAddress || "";
  document.querySelector("#editVenueAddress2").value = venue.addressLine2 || "";
  document.querySelector("#editVenueCity").value = venue.city || "";
  document.querySelector("#editVenueState").value = venue.state || "";
  document.querySelector("#editVenuePostalCode").value = venue.postalCode || "";
  document.querySelector("#editVenueCourtCount").value = venue.courtCount ?? venue.courts ?? "";
  document.querySelector("#editVenueStatus").value = venue.status === "inactive" || venue.active === false ? "inactive" : "active";
  document.querySelector("#editVenueTitle").textContent = "Edit venue";
  document.querySelector("#editVenueCopy").textContent = "Update the Venue Master record. Venue ID is permanent.";
  editMessage.textContent = "Changes are saved directly to AlphaOpen records.";
  showVenueDialog();
}

function renderVenues(filter = "") {
  const term = filter.trim().toLowerCase();
  const filtered = !term ? venues : venues.filter(venue => [venue.venueId, venueName(venue), venueAddress(venue), venue.city, venue.state, venue.status, venue.active === false ? "inactive" : "active"].some(value => String(value ?? "").toLowerCase().includes(term)));
  count.textContent = term ? `${filtered.length} of ${venues.length}` : `${venues.length} venue${venues.length === 1 ? "" : "s"}`;
  list.innerHTML = filtered.length ? filtered.map(venue => {
    const active = venue.status ? venue.status !== "inactive" : venue.active !== false;
    return `<div class="venue-master-row"><span>${escapeHtml(venue.venueId)}</span><b>${escapeHtml(venueName(venue))}</b><small>${escapeHtml(venueAddress(venue) || "No address")}</small><small>${escapeHtml(venue.courtCount ?? venue.courts ?? "—")}</small><span class="badge ${active ? "lime" : "gray"}">${active ? "active" : "inactive"}</span><div class="venue-actions"><button class="secondary compact-button" type="button" data-venue-action="edit" data-venue-id="${escapeHtml(venue.venueId)}">Edit</button><button class="danger-button compact-button" type="button" data-venue-action="delete" data-venue-id="${escapeHtml(venue.venueId)}">Delete</button></div></div>`;
  }).join("") : `<div class="empty-state compact"><b>${term ? "No matching venues" : "No Venue Master records"}</b><p>${term ? "Try a different Venue ID, name, address, city, or status." : "Venues will appear here after Venue Master data is loaded."}</p></div>`;
  list.querySelectorAll("[data-venue-action]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.venueAction === "edit") openEditVenue(button.dataset.venueId);
    if (button.dataset.venueAction === "delete") deleteVenue(button.dataset.venueId);
  }));
}

async function saveEditedVenue(event) {
  event.preventDefault();
  if (!canManageVenues()) return;
  const isNew = !editingVenueId;
  const venueId = document.querySelector("#editVenueId").value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(venueId)) {
    editMessage.textContent = "Venue ID must use only letters, numbers, hyphens, or underscores.";
    return;
  }
  const venue = isNew ? null : venues.find(item => item.venueId === editingVenueId);
  if (!isNew && !venue) { editMessage.textContent = "This venue no longer exists. Refresh Venue Master."; return; }
  const name = document.querySelector("#editVenueName").value.trim();
  const addressLine1 = document.querySelector("#editVenueAddress1").value.trim();
  const addressLine2 = document.querySelector("#editVenueAddress2").value.trim();
  const city = document.querySelector("#editVenueCity").value.trim();
  const state = document.querySelector("#editVenueState").value.trim();
  const postalCode = document.querySelector("#editVenuePostalCode").value.trim();
  const status = document.querySelector("#editVenueStatus").value;
  const courtValue = document.querySelector("#editVenueCourtCount").value;
  const address = [addressLine1, addressLine2].filter(Boolean).join(", ");
  const fullAddress = [address, city, state, postalCode].filter(Boolean).join(", ");
  if (!name) { editMessage.textContent = "Venue name is required."; return; }
  document.querySelector("#saveEditedVenue").disabled = true;
  editMessage.textContent = isNew ? "Adding venue…" : "Saving venue…";
  try {
    const payload = {
      venueId, name, venueName: name, address, addressLine1, addressLine2, city, state, postalCode, fullAddress,
      courtCount: courtValue === "" ? null : Number(courtValue), status, active: status === "active",
      updatedByUid: auth.currentUser.uid, updatedAt: serverTimestamp()
    };
    if (isNew) {
      const venueRef = doc(db, "venues", venueId);
      await runTransaction(db, async transaction => {
        if ((await transaction.get(venueRef)).exists()) throw new Error(`${venueId} already exists in Venue Master.`);
        transaction.set(venueRef, {
          ...payload,
          createdByUid: auth.currentUser.uid,
          createdAt: serverTimestamp()
        });
      });
    } else {
      await updateDoc(doc(db, "venues", editingVenueId), payload);
    }
    closeEditVenue();
    window.alphaOpenAuthUI.showMessage(`${venueId} ${isNew ? "added to" : "updated in"} Venue Master`);
    await loadVenues();
  } catch (error) {
    console.error("Venue save failed", error);
    editMessage.textContent = error.message || "The venue could not be saved.";
  } finally {
    document.querySelector("#saveEditedVenue").disabled = false;
  }
}

async function deleteVenue(venueId) {
  if (!canManageVenues()) return;
  const venue = venues.find(item => item.venueId === venueId);
  if (!venue || !window.confirm(`Delete ${venueName(venue)} (${venueId}) from Venue Master?\n\nExisting match records keep their saved venue snapshots.`)) return;
  try {
    const publicRef = doc(db, "venues", venueId);
    const privateRef = doc(db, "venuePrivate", venueId);
    await runTransaction(db, async transaction => {
      const [publicSnapshot, privateSnapshot] = await Promise.all([transaction.get(publicRef), transaction.get(privateRef)]);
      if (!publicSnapshot.exists()) throw new Error(`${venueId} no longer exists.`);
      transaction.delete(publicRef);
      if (privateSnapshot.exists()) transaction.delete(privateRef);
    });
    window.alphaOpenAuthUI.showMessage(`${venueId} deleted from Venue Master`);
    await loadVenues();
  } catch (error) {
    console.error("Venue deletion failed", error);
    window.alphaOpenAuthUI.showMessage(error.message || "The venue could not be deleted.");
  }
}

async function loadVenues() {
  if (!canManageVenues()) return;
  list.innerHTML = '<p class="muted">Loading Venue Master…</p>';
  try {
    const snapshot = await getDocs(collection(db, "venues"));
    venues = snapshot.docs.map(item => ({ venueId: item.id, ...item.data() })).sort((a, b) => venueName(a).localeCompare(venueName(b)));
    renderVenues(search.value);
  } catch (error) {
    console.error("Venue Master load failed", error);
    list.innerHTML = `<div class="empty-state compact"><b>Venue Master could not be loaded</b><p>${escapeHtml(error.message)}</p></div>`;
  }
}

search.addEventListener("input", event => renderVenues(event.target.value));
document.querySelector("#addVenue").addEventListener("click", openAddVenue);
document.querySelector("#refreshVenues").addEventListener("click", loadVenues);
document.querySelector("#closeEditVenue").addEventListener("click", closeEditVenue);
document.querySelector("#cancelEditVenue").addEventListener("click", closeEditVenue);
editForm.addEventListener("submit", saveEditedVenue);
onAuthStateChanged(auth, () => { if (canManageVenues()) loadVenues(); });
window.addEventListener("alphaopen:admin-panel-changed", (event) => {
  if (event.detail?.panel === "venues" && canManageVenues()) loadVenues();
});
