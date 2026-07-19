import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDocs, getFirestore, runTransaction, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

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
const search = document.querySelector("#venueMasterSearch");
const list = document.querySelector("#venueMasterList");
const count = document.querySelector("#venueMasterCount");
const editDialog = document.querySelector("#editVenueDialog");
const editForm = document.querySelector("#editVenueForm");
const editMessage = document.querySelector("#editVenueMessage");
let venues = [];

function isAdmin(user = auth.currentUser) { return Boolean(user?.emailVerified && user.email?.toLowerCase() === ADMIN_EMAIL); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function venueName(venue) { return venue.venueName || venue.name || venue.displayName || "Unnamed venue"; }
function venueAddress(venue) { return venue.fullAddress || venue.address || [venue.addressLine1, venue.addressLine2, venue.city, venue.state, venue.postalCode].filter(Boolean).join(", "); }

function closeEditVenue() {
  if (!editDialog.open) return;
  if (typeof editDialog.close === "function") editDialog.close();
  else editDialog.removeAttribute("open");
}

function openEditVenue(venueId) {
  const venue = venues.find(item => item.venueId === venueId);
  if (!venue) return;
  document.querySelector("#editVenueId").value = venue.venueId;
  document.querySelector("#editVenueName").value = venueName(venue) === "Unnamed venue" ? "" : venueName(venue);
  document.querySelector("#editVenueAddress1").value = venue.addressLine1 || venue.address || venue.fullAddress || "";
  document.querySelector("#editVenueAddress2").value = venue.addressLine2 || "";
  document.querySelector("#editVenueCity").value = venue.city || "";
  document.querySelector("#editVenueState").value = venue.state || "";
  document.querySelector("#editVenuePostalCode").value = venue.postalCode || "";
  document.querySelector("#editVenueCourtCount").value = venue.courtCount ?? venue.courts ?? "";
  document.querySelector("#editVenueStatus").value = venue.status === "inactive" || venue.active === false ? "inactive" : "active";
  editMessage.textContent = "Changes are saved directly to Firebase.";
  if (typeof editDialog.showModal === "function") editDialog.showModal();
  else editDialog.setAttribute("open", "");
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
  if (!isAdmin()) return;
  const venueId = document.querySelector("#editVenueId").value;
  const venue = venues.find(item => item.venueId === venueId);
  if (!venue) { editMessage.textContent = "This venue no longer exists. Refresh Venue Master."; return; }
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
  editMessage.textContent = "Saving venue to Firebase…";
  try {
    await updateDoc(doc(db, "venues", venueId), {
      venueId, name, venueName: name, address, addressLine1, addressLine2, city, state, postalCode, fullAddress,
      courtCount: courtValue === "" ? null : Number(courtValue), status, active: status === "active",
      updatedByUid: auth.currentUser.uid, updatedAt: serverTimestamp()
    });
    closeEditVenue();
    window.alphaOpenAuthUI.showMessage(`${venueId} updated in Venue Master`);
    await loadVenues();
  } catch (error) {
    console.error("Venue update failed", error);
    editMessage.textContent = error.message || "The venue could not be updated.";
  } finally {
    document.querySelector("#saveEditedVenue").disabled = false;
  }
}

async function deleteVenue(venueId) {
  if (!isAdmin()) return;
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
  if (!isAdmin()) return;
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
document.querySelector("#refreshVenues").addEventListener("click", loadVenues);
document.querySelector("#closeEditVenue").addEventListener("click", closeEditVenue);
document.querySelector("#cancelEditVenue").addEventListener("click", closeEditVenue);
editForm.addEventListener("submit", saveEditedVenue);
onAuthStateChanged(auth, user => { if (isAdmin(user)) loadVenues(); });
