import {
  collection,
  getDocs,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=5";

const OPERATIONAL_COLLECTIONS = [
  "teams", "members", "rosterSlots", "rosterAssignments", "weeks",
  "matchups", "approverAssignments", "ruleVersions", "standings",
  "standingsSnapshots", "availability", "replacementRequests",
  "latePassRequests", "adjustments", "importAudits", "playoffBrackets",
  "announcements", "auditEvents",
];
const MATCHUP_COLLECTIONS = ["lineups", "lineupReviews", "lineMatches"];
const LINE_WORKFLOW_COLLECTIONS = [
  "scheduleProposals", "scoreSubmissions", "scoreDecisions",
];

const dialog = document.querySelector("#resetSeasonDialog");
const form = document.querySelector("#resetSeasonForm");
const scope = document.querySelector("#resetSeasonScope");
const confirmation = document.querySelector("#resetSeasonConfirmation");
const acknowledgement = document.querySelector("#resetSeasonAcknowledgement");
const message = document.querySelector("#resetSeasonMessage");
const submit = document.querySelector("#confirmResetSeason");
let target = null;

function isSuperAdmin() {
  const access = window.alphaOpenAuthorization;
  return auth.currentUser?.emailVerified === true && (
    access?.role === "Super Admin" ||
    access?.roles?.includes("superAdmin") ||
    auth.currentUser.email?.toLowerCase() === "sudarshandesai74@gmail.com"
  );
}

function expectedPhrase() {
  return target ? `DELETE ${target.seasonId}` : "";
}

function updateSubmitState() {
  submit.disabled = !target ||
    confirmation.value.trim() !== expectedPhrase() ||
    !acknowledgement.checked;
}

function openReset(button) {
  if (!isSuperAdmin()) {
    window.alphaOpenAuthUI?.showMessage("Only Super Admin can reset season data.");
    return;
  }
  target = {
    seasonId: button.dataset.resetSeason,
    name: button.dataset.resetSeasonName || button.dataset.resetSeason,
  };
  confirmation.value = "";
  confirmation.placeholder = expectedPhrase();
  acknowledgement.checked = false;
  scope.innerHTML = `<b>${target.name} (${target.seasonId})</b><br>Type <b>${expectedPhrase()}</b> to confirm. The Season Master, Player Master, Venue Master and global User records will be retained.`;
  message.textContent = "No data has been changed.";
  updateSubmitState();
  dialog.showModal();
}

function closeReset() {
  if (dialog.open) dialog.close();
  target = null;
}

async function collectDocuments(seasonId) {
  const references = new Map();
  const counts = new Map();
  const remember = (reference, category) => {
    references.set(reference.path, reference);
    counts.set(category, (counts.get(category) || 0) + 1);
  };
  const readCollection = async (category, ...segments) => {
    const snapshot = await getDocs(collection(db, ...segments));
    snapshot.docs.forEach(item => remember(item.ref, category));
    return snapshot.docs;
  };

  const operationalMatchups = await readCollection(
    "Operational matchups", "seasons", seasonId, "matchups",
  );
  for (const matchup of operationalMatchups) {
    const lineups = await readCollection(
      "Lineups", "seasons", seasonId, "matchups", matchup.id, "lineups",
    );
    for (const lineup of lineups) {
      await readCollection(
        "Lineup revisions", "seasons", seasonId, "matchups", matchup.id,
        "lineups", lineup.id, "revisions",
      );
    }
    await readCollection(
      "Lineup reviews", "seasons", seasonId, "matchups", matchup.id, "lineupReviews",
    );
    const lineMatches = await readCollection(
      "Line matches", "seasons", seasonId, "matchups", matchup.id, "lineMatches",
    );
    for (const lineMatch of lineMatches) {
      for (const child of LINE_WORKFLOW_COLLECTIONS) {
        await readCollection(
          "Line workflow", "seasons", seasonId, "matchups", matchup.id,
          "lineMatches", lineMatch.id, child,
        );
      }
    }
  }

  for (const collectionName of OPERATIONAL_COLLECTIONS) {
    if (collectionName === "matchups") continue;
    await readCollection(
      `Operational ${collectionName}`, "seasons", seasonId, collectionName,
    );
  }

  return { references: [...references.values()], counts };
}

async function deleteInBatches(references) {
  for (let start = 0; start < references.length; start += 400) {
    const batch = writeBatch(db);
    references.slice(start, start + 400).forEach(reference => batch.delete(reference));
    await batch.commit();
  }
}

async function resetSeason(event) {
  event.preventDefault();
  if (!isSuperAdmin() || submit.disabled || !target) return;
  const deleting = { ...target };
  submit.disabled = true;
  confirmation.disabled = true;
  acknowledgement.disabled = true;
  message.textContent = `Scanning ${deleting.seasonId} canonical season records…`;
  try {
    const deletedCounts = new Map();
    let deletedTotal = 0;
    for (let pass = 1; pass <= 5; pass += 1) {
      const { references, counts } = await collectDocuments(deleting.seasonId);
      if (!references.length) break;
      message.textContent = `Deleting ${references.length} ${deleting.seasonId} records (verification pass ${pass})…`;
      await deleteInBatches(references);
      deletedTotal += references.length;
      counts.forEach((count, category) => {
        deletedCounts.set(category, (deletedCounts.get(category) || 0) + count);
      });
    }
    const verification = await collectDocuments(deleting.seasonId);
    if (verification.references.length) {
      const remaining = [...verification.counts.entries()]
        .filter(([, count]) => count)
        .map(([name, count]) => `${name}: ${count}`)
        .join(" · ");
      throw new Error(
        `${verification.references.length} season records remain after verification.${remaining ? ` ${remaining}` : ""}`,
      );
    }
    const breakdown = [...deletedCounts.entries()]
      .filter(([, count]) => count)
      .map(([name, count]) => `${name}: ${count}`)
      .join(" · ");
    message.textContent = `${deleting.seasonId} reset completed and verified empty. ${deletedTotal} delete operations completed.${breakdown ? ` ${breakdown}` : ""} Season Master and global users/players were retained.`;
    window.alphaOpenAuthUI?.showMessage(`${deleting.seasonId} is ready for a clean bulk upload.`);
  } catch (error) {
    console.error("Season reset failed", error);
    message.textContent = `Season reset stopped: ${error.message}`;
  } finally {
    confirmation.disabled = false;
    acknowledgement.disabled = false;
  }
}

document.querySelector("#seasonAdminList")?.addEventListener("click", event => {
  const button = event.target.closest("[data-reset-season]");
  if (button) openReset(button);
});
document.querySelector("#closeResetSeason")?.addEventListener("click", closeReset);
document.querySelector("#cancelResetSeason")?.addEventListener("click", closeReset);
confirmation?.addEventListener("input", updateSubmitState);
acknowledgement?.addEventListener("change", updateSubmitState);
form?.addEventListener("submit", resetSeason);
