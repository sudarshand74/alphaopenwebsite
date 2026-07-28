import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { formattedPlayerLabel, resolvedPlayerName, loadCanonicalPlayers } from "./player-identity.js?v=5";
import {
  loadPublicCompletedSeasonDashboard,
  loadPublicCompletedSeasons,
  loadPublicMatchLines,
  loadPublicSeasonDashboard,
  publishPublicSeasonDashboard,
} from "./public-season-dashboard.js?v=15";
import { refreshSeasonPublicRecords } from "./season-public-sync.js?v=1";
import {
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  getFirestore,
  writeBatch,
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  projectId: "alphaopen-development-2026",
  appId: "1:128657830722:web:07c8c84d0386b5b11c4edb",
  storageBucket: "alphaopen-development-2026.firebasestorage.app",
  apiKey: "AIzaSyCBxY1bOkhALp1W_1yXFmDo9jdFhRNQqIY",
  authDomain: "alphaopen-development-2026.firebaseapp.com",
  messagingSenderId: "128657830722"
};

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
let publishedHistorySeasons = [];
const readCache = new Map();
const PUBLIC_READ_TTL_MS = 5 * 60 * 1000;
const OPERATIONAL_READ_TTL_MS = 60 * 1000;
const CACHE_STAMP_PREFIX = "alphaopen:firestore-cache:";

function cacheTimestamp(key) {
  try { return Number(localStorage.getItem(CACHE_STAMP_PREFIX + key) || 0); }
  catch { return 0; }
}
function markCacheFresh(key) {
  try { localStorage.setItem(CACHE_STAMP_PREFIX + key, String(Date.now())); }
  catch { /* Storage can be unavailable in private browsing. */ }
}
function cachedRead(key, loader, ttl = PUBLIC_READ_TTL_MS) {
  const cached = readCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;
  const request = Promise.resolve().then(loader).catch((error) => {
    readCache.delete(key);
    throw error;
  });
  readCache.set(key, { request, expiresAt: Date.now() + ttl });
  return request;
}
async function cacheFirstRead(key, serverLoader, cacheLoader, ttl = PUBLIC_READ_TTL_MS) {
  return cachedRead(key, async () => {
    if (Date.now() - cacheTimestamp(key) < ttl) {
      try { return await cacheLoader(); }
      catch (error) { console.info(`Firestore cache miss for ${key}; refreshing from server.`, error); }
    }
    const value = await serverLoader();
    markCacheFresh(key);
    return value;
  }, ttl);
}

function seasonsOnce() {
  const reference = collection(db, "seasons"),
    mapSnapshot = (snapshot) => snapshot.docs.map((item) => ({ seasonId: item.id, ref: item.ref, ...item.data() }));
  return cacheFirstRead(
    "seasons",
    async () => mapSnapshot(await getDocs(reference)),
    async () => mapSnapshot(await getDocsFromCache(reference)),
  );
}

function seasonTree(seasonRef, cacheKey, includeStandings = false) {
  const ttl = cacheKey.startsWith("operational-")
    ? OPERATIONAL_READ_TTL_MS
    : PUBLIC_READ_TTL_MS;
  const loadTree = async (fromCache = false) => {
    const readDoc = fromCache ? getDocFromCache : getDoc,
      readDocs = fromCache ? getDocsFromCache : getDocs;
    const baseReads = [
      readDoc(seasonRef),
      readDocs(collection(seasonRef, "teams")),
      readDocs(collection(seasonRef, "matchups")),
      readDocs(collection(seasonRef, "rosterAssignments")),
      readDocs(collection(seasonRef, "weeks")),
      loadCanonicalPlayers(),
    ];
    if (includeStandings) baseReads.push(readDocs(collection(seasonRef, "standings")));
    const [seasonSnapshot, teamsSnapshot, matchupsSnapshot, rosterSnapshot, weeksSnapshot, canonicalPlayers, standingsSnapshot] =
      await Promise.all(baseReads);
    if (!seasonSnapshot.exists()) throw new Error(`Season ${seasonRef.id} was not found.`);
    const matchups = matchupsSnapshot.docs.map((snapshot) => ({ matchupId: snapshot.id, ...snapshot.data() }));
    const lineGroups = await Promise.all(matchups.map(async (matchup) => {
      const snapshot = await readDocs(collection(seasonRef, "matchups", matchup.matchupId, "lineMatches"));
      return snapshot.docs.map((line) => ({ lineMatchId: line.id, matchupId: matchup.matchupId, ...line.data() }));
    }));
    return {
      season: { seasonId: seasonSnapshot.id, ...seasonSnapshot.data() },
      teams: teamsSnapshot.docs.map((snapshot) => ({ teamId: snapshot.id, ...snapshot.data() })),
      matchups,
      lineMatches: lineGroups.flat(),
      weeks: weeksSnapshot.docs.map((snapshot) => ({ weekId: snapshot.id, ...snapshot.data() })),
      rosterAssignments: rosterSnapshot.docs.map((snapshot) => ({ ...snapshot.data(), assignmentId: snapshot.id })),
      standings: standingsSnapshot?.docs.map((snapshot) => ({ teamId: snapshot.id, ...snapshot.data() })) || [],
      canonicalPlayers,
    };
  };
  return cacheFirstRead(
    cacheKey,
    () => loadTree(false),
    () => loadTree(true),
    ttl,
  );
}

async function loadActiveSeason(user = auth.currentUser) {
  try {
    if (!user) {
      const snapshot = await getDoc(PUBLIC_ACTIVE_SEASON_REF);
      const active = applyPublicActiveSeasonSnapshot(snapshot);
      watchPublicActiveSeason();
      return active;
    }
    stopWatchingPublicActiveSeason();
    const control = await getDoc(SEASON_CONTROL_REF);
    const seasonId = control.data()?.activeSeasonId || "";
    if (!seasonId) throw new Error("No active season is configured.");
    const snapshot = await getDoc(doc(db, "seasons", seasonId));
    if (!snapshot.exists()) throw new Error(`Season ${seasonId} was not found.`);
    const active = { seasonId: snapshot.id, ref: snapshot.ref, ...snapshot.data() };
    if (
      user.emailVerified &&
      (
        user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL ||
        window.alphaOpenAuthorization?.roles?.includes("superAdmin")
      )
    ) {
      await setDoc(PUBLIC_ACTIVE_SEASON_REF, {
        seasonId: active.seasonId,
        name: active.name || active.seasonName || active.seasonId,
        status: "active",
        updatedAt: serverTimestamp(),
      });
    }
    window.alphaOpenDataUI?.applySeasons([active]);
    window.alphaOpenDataUI?.applyActiveSeason(active);
    return active;
  } catch (error) {
    console.error("Active season lookup failed", error);
    return null;
  }
}

async function loadActiveSeasonMatches() {
  const active = await loadActiveSeason(null);
  if (!active?.seasonId) throw new Error("No active season is configured.");
  const dashboard = await loadPublicSeasonDashboard(active.seasonId);
  if (!dashboard) throw new Error("Public active-season details have not been published yet.");
  const lineMatches = await loadPublicMatchLines(
    active.seasonId,
    dashboard.matchups || [],
  );
  window.alphaOpenDataUI?.applyLeagueData({...dashboard, lineMatches});
}

async function loadPendingApprovalCount(user, authorization = window.alphaOpenAuthorization) {
  if (user && !authorization) return;
  const canReview = authorization?.role === "Super Admin" || authorization?.access?.includes("approver");
  if (!user || !canReview) {
    window.alphaOpenDataUI?.applyPendingApprovalCount(null);
    return;
  }
  const control = await getDoc(SEASON_CONTROL_REF);
  const seasonId = authorization?.activeSeasonId || control.data()?.activeSeasonId;
  if (!seasonId) {
    window.alphaOpenDataUI?.applyPendingApprovalCount(0);
    return;
  }
  const snapshot = await getDocs(collection(db, "seasons", seasonId, "matchups"));
  const count = window.alphaOpenCountSubmittedLineups(
    snapshot.docs.map((item) => item.data()),
  );
  window.alphaOpenDataUI?.applyPendingApprovalCount(count);
}

window.addEventListener("alphaopen:match-line-updated", (event) => {
  const seasonId = event.detail?.seasonId;
  if (!seasonId) return;
  [`operational-tree:${seasonId}`, `operational-live:${seasonId}`, `league:${seasonId}`, `season-tree:${seasonId}`].forEach((key) => {
    readCache.delete(key);
    try { localStorage.removeItem(CACHE_STAMP_PREFIX + key); }
    catch { /* Storage can be unavailable in private browsing. */ }
  });
});
async function loadPublishedHistoryData() {
  try {
    const completedPublicDashboards = (await Promise.all(
      (await loadPublicCompletedSeasons()).map(async (season) => {
        const dashboard = await loadPublicCompletedSeasonDashboard(
          season.seasonId,
        );
        if (!dashboard) return null;
        return {
          ...dashboard,
          lineMatches: await loadPublicMatchLines(
            season.seasonId,
            dashboard.matchups || [],
          ),
        };
      }),
    )).filter(Boolean);
    publishedHistorySeasons = completedPublicDashboards;
    window.alphaOpenDataUI?.applyHistoryData(completedPublicDashboards);
  } catch (error) {
    console.error("All-season player history load failed", error);
    window.alphaOpenDataUI?.showHistoryError(error.message || "Player history could not be loaded.");
  }
}

async function loadGlobalActiveSeasonDashboard({ includeCompleted = false } = {}) {
  try {
    const current = await loadActiveSeason(null);
    const seasonId = current?.seasonId || "";
    if (!seasonId) throw new Error("No active season is configured.");
    let dashboard = await loadPublicSeasonDashboard(seasonId);
    const refreshed = await publishPublicSeasonDashboard(seasonId).catch((error) => {
      console.error("Active-season public dashboard refresh failed", error);
      return false;
    });
    if (refreshed) {
      readCache.delete(`public-active-dashboard:${seasonId}`);
      dashboard = await loadPublicSeasonDashboard(seasonId);
    }
    if (!dashboard) throw new Error(`The global dashboard for active season ${seasonId} has not been published yet.`);
    if (dashboard.season?.seasonId !== seasonId) {
      throw new Error(`The active-season dashboard does not match ${seasonId}.`);
    }
    dashboard = {
      ...dashboard,
      lineMatches: await loadPublicMatchLines(
        seasonId,
        dashboard.matchups || [],
      ),
    };
    const seasons = includeCompleted
      ? [
          ...publishedHistorySeasons.filter(
            (item) => item.season?.seasonId !== seasonId,
          ),
          dashboard,
        ]
      : [dashboard];
    window.alphaOpenDataUI?.applyHistoryData(seasons);
  } catch (error) {
    console.error("Global active-season dashboard load failed", error);
    window.alphaOpenDataUI?.showHistoryError(
      error.message || "The global active-season dashboard could not be loaded.",
    );
  }
}

async function loadGlobalPlayerDirectory() {
  const players = await loadCanonicalPlayers();
  window.alphaOpenDataUI?.applyPlayerDirectory([...players.values()]);
}

async function loadCompletedSeasonOptions() {
  try {
    const [completedSeasons, activeSnapshot] = await Promise.all([
      loadPublicCompletedSeasons(),
      getDoc(PUBLIC_ACTIVE_SEASON_REF),
    ]);
    const activeSeasonId = activeSnapshot.exists() &&
      String(activeSnapshot.data().status || "").toLowerCase() === "active"
      ? activeSnapshot.data().seasonId || ""
      : "";
    const seasons = completedSeasons.filter(
      (season) => season.seasonId !== activeSeasonId,
    );
    window.alphaOpenDataUI?.applyCompletedSeasonOptions(seasons);
  } catch (error) {
    console.error("Completed-season list load failed", error);
    window.alphaOpenDataUI?.applyCompletedSeasonOptions([]);
    window.alphaOpenDataUI?.showHistoryError(
      error.message || "Completed seasons could not be loaded.",
    );
  }
}

async function loadSelectedCompletedSeason(seasonId) {
  if (!seasonId) {
    window.alphaOpenDataUI?.applySelectedCompletedSeason(null);
    return;
  }
  try {
    const dashboard = await loadPublicCompletedSeasonDashboard(seasonId);
    const data = dashboard
      ? {
          ...dashboard,
          lineMatches: await loadPublicMatchLines(
            seasonId,
            dashboard.matchups || [],
          ),
        }
      : null;
    if (
      !data ||
      String(data.season?.status || "").toLowerCase() !== "completed"
    ) {
      throw new Error(`${seasonId} is not available as a completed season.`);
    }
    window.alphaOpenDataUI?.applySelectedCompletedSeason(data);
  } catch (error) {
    console.error("Completed-season dashboard load failed", error);
    window.alphaOpenDataUI?.applySelectedCompletedSeason(null, error.message);
  }
}

async function loadLeagueData() {
  try {
    const active = await loadActiveSeason(auth.currentUser);
    if (!active?.seasonId) throw new Error("No active season is configured.");
    if (!auth.currentUser) {
      const dashboard = await loadPublicSeasonDashboard(active.seasonId);
      if (!dashboard) throw new Error("Public active-season details have not been published yet.");
      window.alphaOpenDataUI?.applyLeagueData(dashboard);
      return;
    }
    window.alphaOpenDataUI?.applyLeagueData(
      await seasonTree(doc(db, "seasons", active.seasonId), `league:${active.seasonId}`, true),
    );
  } catch (error) {
    console.error("Firebase league data load failed",error);
    window.alphaOpenDataUI?.showError(error.message||"Please refresh and try again.");
  }
}

const BOOTSTRAP_ADMIN_EMAIL = "sudarshandesai74@gmail.com";
const SEASON_CONTROL_REF = doc(db, "systemConfig", "seasonControl");
const PUBLIC_ACTIVE_SEASON_REF = doc(db, "publicConfig", "activeSeason");
let publicActiveSeasonUnsubscribe = null;

function applyPublicActiveSeasonSnapshot(snapshot) {
  const active = snapshot.exists() && snapshot.data().status === "active"
    ? { ...snapshot.data(), ref: snapshot.ref }
    : null;
  window.alphaOpenDataUI?.applySeasons(active ? [active] : []);
  window.alphaOpenDataUI?.applyActiveSeason(active);
  return active;
}

function watchPublicActiveSeason() {
  if (publicActiveSeasonUnsubscribe) return;
  publicActiveSeasonUnsubscribe = onSnapshot(
    PUBLIC_ACTIVE_SEASON_REF,
    (snapshot) => {
      if (!auth.currentUser) applyPublicActiveSeasonSnapshot(snapshot);
    },
    (error) => console.error("Live guest active-season lookup failed", error),
  );
}

function stopWatchingPublicActiveSeason() {
  publicActiveSeasonUnsubscribe?.();
  publicActiveSeasonUnsubscribe = null;
}
const dialog = document.querySelector("#createSeasonDialog");
const form = document.querySelector("#createSeasonForm");
const openButton = document.querySelector("#openCreateSeason");
const closeButton = document.querySelector("#closeCreateSeason");
const cancelButton = document.querySelector("#cancelCreateSeason");
const submitButton = document.querySelector("#createSeasonSubmit");
const message = document.querySelector("#seasonFormMessage");
const seasonList = document.querySelector("#seasonAdminList");
const termInput = document.querySelector("#seasonTerm");
const yearInput = document.querySelector("#seasonYear");
const idPreview = document.querySelector("#seasonIdPreview");
const nameInput = document.querySelector("#seasonName");
const statusInput = document.querySelector("#seasonStatus");
const seasonDialogTitle = document.querySelector("#seasonDialogTitle");
const seasonDialogDescription = document.querySelector("#seasonDialogDescription");
const registeredUsersPanel = document.querySelector("#registeredUsersPanel");
const refreshRegisteredUsers = document.querySelector("#refreshRegisteredUsers");
const manageUserDialog = document.querySelector("#manageUserDialog");
const manageUserForm = document.querySelector("#manageUserForm");
const manageUserMessage = document.querySelector("#manageUserMessage");
const managedUsers = new Map();
let registeredUserRecords = [];
let registeredUsersLoadId = 0;
let seasonRecords = [];
let editingSeasonId = null;

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => window.clearTimeout(timer));
}

function isBootstrapAdmin(user = auth.currentUser) {
  return Boolean(user?.emailVerified && user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL);
}

function seasonIdentity() {
  const year = Number(yearInput.value);
  const term = termInput.value;
  const code = term === "spring" ? "S" : "F";
  const label = term === "spring" ? "Spring" : "Fall";
  return { seasonId: `AO-${code}-${year}`, label, term, year };
}

function updateSeasonIdentity() {
  const identity = seasonIdentity();
  idPreview.value = identity.seasonId;
  nameInput.value = `AlphaOpen ${identity.label} ${identity.year}`;
}

function closeDialog() {
  if (!dialog.open) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function openDialog(season = null) {
  editingSeasonId = season?.seasonId || null;
  seasonDialogTitle.textContent = season ? `Edit ${season.name}` : "Create a season";
  seasonDialogDescription.textContent = season
    ? "Update this season record. Season ID, term, and year are permanent."
    : "This creates the Firestore season record and its first rules version. New seasons begin in Draft status.";
  if (season) {
    termInput.value = season.term;
    yearInput.value = season.year;
    idPreview.value = season.seasonId;
    nameInput.value = season.name;
    statusInput.value = season.status || "draft";
    document.querySelector("#seasonTimezone").value = season.timezone || "America/New_York";
    document.querySelector("#seasonStartDate").value = season.startDate;
    document.querySelector("#seasonEndDate").value = season.endDate;
    document.querySelector("#seasonTeamCount").value = season.teamCount;
    document.querySelector("#seasonRosterRanks").value = season.rosterRanksPerTeam;
    document.querySelector("#seasonMatchups").value = season.regularSeasonMatchupsPerTeam;
    document.querySelector("#seasonLines").value = season.linesPerMatchup;
  } else {
    form.reset();
    updateSeasonIdentity();
    statusInput.value = "draft";
  }
  termInput.disabled = Boolean(season);
  yearInput.disabled = Boolean(season);
  message.textContent = "The season ID is permanent after creation.";
  submitButton.textContent = season ? "Save season" : "Create draft season";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function valueAsNumber(selector) {
  return Number(document.querySelector(selector).value);
}

function seasonPayload(user) {
  const identity = seasonIdentity();
  const startDate = document.querySelector("#seasonStartDate").value;
  const endDate = document.querySelector("#seasonEndDate").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("Enter valid start and end dates.");
  }
  if (startDate > endDate) throw new Error("The end date must be on or after the start date.");

  return {
    identity,
    season: {
      seasonId: identity.seasonId,
      name: nameInput.value.trim(),
      term: identity.term,
      year: identity.year,
      status: statusInput.value,
      timezone: document.querySelector("#seasonTimezone").value,
      startDate,
      endDate,
      activeRuleVersionId: "v1",
      teamCount: valueAsNumber("#seasonTeamCount"),
      rosterRanksPerTeam: valueAsNumber("#seasonRosterRanks"),
      regularSeasonMatchupsPerTeam: valueAsNumber("#seasonMatchups"),
      linesPerMatchup: valueAsNumber("#seasonLines"),
      playersPerLine: 2,
      updatedByUid: user.uid,
      updatedAt: serverTimestamp()
    }
  };
}

function rulePayload(user, season) {
  return {
    version: 1,
    status: "active",
    effectiveAt: serverTimestamp(),
    roster: {
      ranksPerTeam: season.rosterRanksPerTeam,
      minimumAppearances: 4,
      maximumAppearances: 6
    },
    lineup: {
      linesPerMatchup: season.linesPerMatchup,
      playersPerLine: 2,
      uniquePlayersRequired: season.linesPerMatchup * 2,
      rankRestrictions: {
        L1: { minimumRank: 1, maximumRank: 4 },
        L4: { minimumRank: 7, maximumRank: 13 },
        L5: { minimumRank: 11, maximumRank: 14 }
      }
    },
    sor: { calculation: "rankSum", nondecreasingByLine: true },
    replacement: { regularSeasonByEcApproval: true, playoffsByEcApproval: true },
    deadlines: { timezone: season.timezone },
    latePass: { maximumPerTeam: 2, extensionDays: 7, allowedRegularWeeks: ["W1", "W2", "W3", "W4", "W5", "W6"] },
    scoring: {
      winnerPoints: 14,
      threeSetLoserPoints: 10,
      twoSetLoserMinimum: 2,
      twoSetLoserMaximum: 8,
      regularThirdSet: { format: "tiebreakTo12", target: 12, winBy: 2 }
    },
    playoffs: { qualifyingTeams: 6, semifinalByes: 2, linesRequiredToWin: 3 },
    standings: { tiebreakers: ["totalPoints", "headToHeadPoints", "headToHeadLines"] },
    createdByUid: user.uid,
    createdAt: serverTimestamp()
  };
}

async function saveSeason(event) {
  event.preventDefault();
  const user = auth.currentUser;
  if (!isBootstrapAdmin(user)) {
    message.textContent = "Only the verified Super Admin can save a season.";
    return;
  }

  submitButton.disabled = true;
  message.textContent = editingSeasonId ? "Saving the season record…" : "Creating the Firestore season and rules version…";
  try {
    const { identity, season } = seasonPayload(user);
    const seasonId = editingSeasonId || identity.seasonId;
    const seasonRef = doc(db, "seasons", seasonId);
    const ruleRef = doc(seasonRef, "ruleVersions", "v1");
    const activeSnapshot = await getDocs(query(collection(db, "seasons"), where("status", "==", "active")));
    const otherActiveRefs = activeSnapshot.docs.filter(item => item.id !== seasonId).map(item => item.ref);

    await runTransaction(db, async transaction => {
      const [existing, controlSnapshot, ...otherActiveSnapshots] = await Promise.all([
        transaction.get(seasonRef), transaction.get(SEASON_CONTROL_REF), ...otherActiveRefs.map(reference => transaction.get(reference))
      ]);
      if (!editingSeasonId && existing.exists()) throw new Error(`${identity.seasonId} already exists.`);
      if (editingSeasonId && !existing.exists()) throw new Error(`${seasonId} no longer exists.`);

      if (editingSeasonId) {
        transaction.update(seasonRef, { ...season, seasonId, term: existing.data().term, year: existing.data().year });
      } else {
        const createdSeason = { ...season, seasonId, createdByUid: user.uid, createdAt: serverTimestamp() };
        transaction.set(seasonRef, createdSeason);
        transaction.set(ruleRef, rulePayload(user, createdSeason));
      }

      if (season.status === "active") {
        otherActiveSnapshots.forEach((snapshot, index) => {
          if (snapshot.exists()) transaction.update(otherActiveRefs[index], {
            status: "completed", updatedByUid: user.uid, updatedAt: serverTimestamp()
          });
        });
        transaction.set(SEASON_CONTROL_REF, {
          activeSeasonId: seasonId, updatedByUid: user.uid, updatedAt: serverTimestamp()
        }, { merge: true });
        transaction.set(PUBLIC_ACTIVE_SEASON_REF, {
          seasonId,
          name: season.name || seasonId,
          status: "active",
          updatedAt: serverTimestamp(),
        });
      } else if (controlSnapshot.exists() && controlSnapshot.data().activeSeasonId === seasonId) {
        transaction.set(SEASON_CONTROL_REF, {
          activeSeasonId: null, updatedByUid: user.uid, updatedAt: serverTimestamp()
        }, { merge: true });
        transaction.set(PUBLIC_ACTIVE_SEASON_REF, {
          seasonId: null,
          name: null,
          status: "inactive",
          updatedAt: serverTimestamp(),
        });
      }
    });
    closeDialog();
    window.alphaOpenAuthUI.showMessage(editingSeasonId ? `${seasonId} updated` : `${seasonId} created`);
    editingSeasonId = null;
    await loadSeasons();
    const publishSeasonIds = new Set(
      ["active", "completed", "archived"].includes(season.status)
        ? [seasonId]
        : [],
    );
    if (season.status === "active") {
      otherActiveRefs.forEach((reference) => publishSeasonIds.add(reference.id));
    }
    await Promise.all(
      [...publishSeasonIds].map((publishSeasonId) =>
        publishPublicSeasonDashboard(publishSeasonId).catch((error) =>
          console.error("Guest season dashboard publish failed", publishSeasonId, error),
        ),
      ),
    );
  } catch (error) {
    console.error("Season save failed", error);
    message.textContent = error.message || "The season could not be saved.";
  } finally {
    submitButton.disabled = false;
  }
}

async function loadSeasons() {
  if (!isBootstrapAdmin()) return;
  seasonList.innerHTML = '<p class="muted">Loading seasons…</p>';
  try {
    const snapshot = await getDocs(query(collection(db, "seasons"), orderBy("year", "desc")));
    if (snapshot.empty) {
      seasonList.innerHTML = '<div class="empty-state compact"><b>No Firestore seasons yet</b><p>Create a season to begin the live league setup.</p></div>';
      return;
    }
    seasonRecords = snapshot.docs.map(item => ({ ...item.data(), seasonId: item.id }));
    seasonList.innerHTML = seasonRecords.map(season => {
      const status = String(season.status || "").toLowerCase();
      const active = status === "active";
      const refreshable = ["active", "completed"].includes(status);
      const refreshLabel = active
        ? "Refresh Active Dashboard"
        : status === "completed"
          ? "Refresh Completed Snapshot"
          : "Public Refresh Unavailable";
      const refreshTitle = refreshable
        ? `Refresh public records for ${season.name || season.seasonId}`
        : "Only Active and Completed seasons can be published for guests.";
      return `<div class="season-admin-row"><div><b>${escapeHtml(season.name)}</b><small>${escapeHtml(season.seasonId)} · ${escapeHtml(season.startDate)} to ${escapeHtml(season.endDate)}</small><small class="season-public-refresh-status" data-public-season-message="${escapeHtml(season.seasonId)}"></small></div><span class="badge ${active ? "lime" : "navy"}">${escapeHtml(season.status)}</span><strong>${season.teamCount} teams</strong><div class="card-actions"><button class="secondary compact-button" type="button" data-refresh-public-season="${escapeHtml(season.seasonId)}" title="${escapeHtml(refreshTitle)}" ${refreshable ? "" : "disabled"}>${refreshLabel}</button><button class="secondary compact-button" type="button" data-edit-season="${escapeHtml(season.seasonId)}">Edit</button><button class="secondary compact-button danger-button" type="button" data-reset-season="${escapeHtml(season.seasonId)}" data-reset-season-name="${escapeHtml(season.name)}">Reset data</button></div></div>`;
    }).join("");
    seasonList.querySelectorAll("[data-refresh-public-season]").forEach(button => {
      button.addEventListener("click", () => refreshSelectedSeasonPublicData(button));
    });
    seasonList.querySelectorAll("[data-edit-season]").forEach(button => button.addEventListener("click", () => {
      const season = seasonRecords.find(item => item.seasonId === button.dataset.editSeason);
      if (season) openDialog(season);
    }));
  } catch (error) {
    console.error("Season list failed", error);
    seasonList.innerHTML = '<p class="muted">Seasons could not be loaded. Refresh after confirming your Super Admin account.</p>';
  }
}

async function refreshSelectedSeasonPublicData(button) {
  const seasonId = String(button?.dataset.refreshPublicSeason || "").trim();
  const season = seasonRecords.find(item => item.seasonId === seasonId);
  if (!season || !isBootstrapAdmin()) return;
  const status = String(season.status || "").toLowerCase();
  if (!["active", "completed"].includes(status)) return;
  const targetLabel = status === "active"
    ? "active public dashboard"
    : "completed public snapshot";
  if (!window.confirm(
    `Refresh the ${targetLabel} for ${season.name || seasonId} (${seasonId})?\n\n` +
    "This recalculates matchup totals and standings from official completed lines, " +
    "then rebuilds the guest-readable season records.",
  )) return;
  const statusElement = seasonList.querySelector(
    `[data-public-season-message="${CSS.escape(seasonId)}"]`,
  );
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Refreshing…";
  if (statusElement) statusElement.textContent = `Refreshing ${targetLabel}…`;
  try {
    const result = await refreshSeasonPublicRecords(seasonId);
    const refreshedAt = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date());
    const success =
      `${targetLabel} refreshed ${refreshedAt}: ` +
      `${result.matchupCount} matchups and ${result.standingCount} standings rows.`;
    if (statusElement) statusElement.textContent = success;
    window.alphaOpenAuthUI?.showMessage(
      `${season.name || seasonId} public records refreshed`,
    );
  } catch (error) {
    console.error("Selected season public refresh failed", seasonId, error);
    if (statusElement) {
      statusElement.textContent =
        `Refresh failed: ${error.message || "Unknown error"}`;
    }
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function primaryProfile(roles, playerId) {
  return roles.includes("superAdmin") ? "superAdmin"
    : roles.includes("ec") ? "ec"
    : roles.includes("captain") ? "captain"
    : roles.includes("neutralApprover") ? "neutralApprover"
    : roles.includes("player") && playerId ? "player"
    : "guest";
}

function profileLabel(profile) {
  return ({ superAdmin: "Super Admin", ec: "EC", captain: "Captain", neutralApprover: "Neutral Approver", player: "Player", guest: "Guest", pending: "Pending approval" })[profile] || profile;
}

function isProtectedSuperAdmin(record) {
  return record.user.email?.trim().toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
}

function activeSeasonRecord() {
  return seasonRecords.find(season => season.status === "active") || null;
}

async function loadRegisteredUsers() {
  if (!isBootstrapAdmin()) return;
  const loadId = ++registeredUsersLoadId;
  registeredUsersPanel.innerHTML = '<p class="muted">Loading registered users…</p>';
  try {
    const [usersSnapshot, seasonsSnapshot, playersSnapshot] = await withTimeout(
      Promise.all([
        getDocs(collection(db, "users")),
        getDocs(query(collection(db, "seasons"), orderBy("year", "desc"))),
        getDocs(collection(db, "players"))
      ]),
      12000,
      "Firestore did not respond in time. Check your connection and retry."
    );
    const playerNames = new Map(
      playersSnapshot.docs.map(item => [
        item.id,
        resolvedPlayerName(
          item.id,
          item.data().fullName,
          [item.data().firstName, item.data().lastName].filter(Boolean).join(" "),
          item.data().displayName,
        )
      ])
    );
    seasonRecords = seasonsSnapshot.docs.map(item => ({ ...item.data(), seasonId: item.id }));
    if (loadId !== registeredUsersLoadId) return;
    if (usersSnapshot.empty) {
      registeredUserRecords = [];
      registeredUsersPanel.innerHTML = '<div class="empty-state compact"><b>No registered users</b><p>A registration appears after the first verified Google sign-in.</p></div>';
      return;
    }
    const records = usersSnapshot.docs.map(userDocument => {
      const user = userDocument.data();
      const baseRoles = [...(user.globalRoles || [])];
      if (user.profileType === "player" && user.playerId) baseRoles.push("player");
      const record = {
        uid: userDocument.id,
        user,
        playerName: user.playerId ? playerNames.get(user.playerId) || "" : "",
        roles: [...new Set(baseRoles)],
        memberships: new Map(),
        registration: null
      };
      managedUsers.set(userDocument.id, record);
      return record;
    });
    registeredUserRecords = records;
    renderRegisteredUsers(records, document.querySelector("#userManagementSearch").value);

    await Promise.allSettled(records.map(async record => {
      const [membershipSnapshots, registration] = await withTimeout(Promise.all([
        Promise.all(seasonRecords.map(season => getDoc(doc(db, "seasons", season.seasonId, "members", record.uid)))),
        getDoc(doc(db, "registrationRequests", record.uid))
      ]), 8000, "User access details timed out.");
      seasonRecords.forEach((season, index) => {
        if (membershipSnapshots[index].exists()) record.memberships.set(season.seasonId, membershipSnapshots[index].data());
      });
      const activeSeason = activeSeasonRecord();
      const activeMembership = activeSeason ? record.memberships.get(activeSeason.seasonId) : null;
      const profileRoles = record.user.profileType === "player" && record.user.playerId ? ["player"] : [];
      record.roles = [...new Set([...(record.user.globalRoles || []), ...profileRoles, ...(activeMembership?.roles || [])])];
      record.registration = registration.exists() ? registration.data() : null;
      managedUsers.set(record.uid, record);
    }));
    if (loadId === registeredUsersLoadId) renderRegisteredUsers(records, document.querySelector("#userManagementSearch").value);
  } catch (error) {
    console.error("Registered-user list failed", error);
    registeredUsersPanel.innerHTML = `<div class="empty-state compact"><b>Registered users could not be loaded</b><p>${escapeHtml(error.message || "Refresh and try again.")}</p><button class="secondary" type="button" data-retry-users>Retry</button></div>`;
    registeredUsersPanel.querySelector("[data-retry-users]")?.addEventListener("click", loadRegisteredUsers);
  }
}

function renderRegisteredUsers(records, filter = "") {
    const term = filter.trim().toLowerCase();
    const filtered = records.filter(record => {
      const status = record.user.status || "pending";
      const profile = status === "active" ? primaryProfile(record.roles, record.user.playerId) : "pending";
      return !term || [record.playerName, record.user.displayName, record.user.email, record.user.playerId, status, profileLabel(profile), ...record.roles].some(value => String(value ?? "").toLowerCase().includes(term));
    }).sort((a, b) => (a.playerName || a.user.displayName || a.user.email).localeCompare(b.playerName || b.user.displayName || b.user.email));
    if (!filtered.length) {
      registeredUsersPanel.innerHTML = `<div class="empty-state compact"><b>${term ? "No matching users" : "No registered users"}</b><p>${term ? "Try a different name, email, Player ID, status, or profile." : "A registration appears after the first verified Google sign-in."}</p></div>`;
      return;
    }
    registeredUsersPanel.innerHTML = filtered.map(record => {
      const status = record.user.status || "pending";
      const profile = status === "active" ? primaryProfile(record.roles, record.user.playerId) : "pending";
      const protectedAccount = isProtectedSuperAdmin(record);
      const deleteAction = protectedAccount ? "" : `<button class="danger-button" data-user-action="delete" data-uid="${record.uid}">Delete profile</button>`;
      const actions = protectedAccount ? '<span class="badge navy">Protected account</span>' : status === "pending"
        ? `<button class="primary" data-user-action="approve" data-uid="${record.uid}">Approve</button><button class="secondary" data-user-action="reject" data-uid="${record.uid}">Reject</button>${deleteAction}`
        : `<button class="secondary" data-user-action="manage" data-uid="${record.uid}">Manage access</button>${deleteAction}`;
      const playerId = record.user.playerId || "";
      const playerIdentity = playerId
        ? formattedPlayerLabel(playerId, null, record.playerName)
        : "No Player Master link";
      return `<div class="registered-user-row"><div><b>${escapeHtml(record.user.email || "Email unavailable")}</b><small>Player: ${escapeHtml(playerIdentity)}</small></div><div><span class="badge ${status === "active" ? "lime" : status === "rejected" ? "orange" : "gray"}">${escapeHtml(status)}</span><small>${escapeHtml(profileLabel(profile))}</small></div><div class="registered-user-actions">${actions}</div></div>`;
    }).join("");
    registeredUsersPanel.querySelectorAll("[data-user-action]").forEach(button => button.addEventListener("click", () => handleUserAction(button.dataset.userAction, button.dataset.uid)));
}

async function handleUserAction(action, uid) {
  const record = managedUsers.get(uid);
  if (!record) return;
  if (isProtectedSuperAdmin(record)) {
    window.alphaOpenAuthUI.showMessage("Sudarshan Desai is the protected account owner and cannot be modified or deleted."); return;
  }
  if (action === "approve") await approveRegistration(record);
  if (action === "reject") await rejectRegistration(record);
  if (action === "manage") openManageUser(record);
  if (action === "delete") await deleteUserProfile(record);
}

async function deleteUserProfile(record) {
  const currentUser = auth.currentUser;
  if (!isBootstrapAdmin(currentUser)) return;
  if (isProtectedSuperAdmin(record) || record.uid === currentUser.uid) {
    window.alphaOpenAuthUI.showMessage("The protected Super Admin profile cannot be deleted."); return;
  }
  const confirmation = window.prompt(`Delete the AlphaOpen profile for ${record.user.email}?\n\nPlayer Master and match history will remain. The user can register again later.\n\nType DELETE to confirm.`);
  if (confirmation !== "DELETE") return;
  try {
    const [seasonsSnapshot, notificationsSnapshot] = await Promise.all([
      getDocs(collection(db, "seasons")),
      getDocs(collection(db, "users", record.uid, "notifications"))
    ]);
    const refs = [doc(db, "users", record.uid), doc(db, "registrationRequests", record.uid)];
    notificationsSnapshot.docs.forEach(notification => refs.push(notification.ref));
    const accountLinkRef = record.user.playerId
      ? doc(db, "playerAccountLinks", record.user.playerId)
      : null;
    seasonsSnapshot.docs.forEach(season => {
      refs.push(doc(db, "seasons", season.id, "members", record.uid));
      refs.push(doc(db, "seasons", season.id, "approverAssignments", `season_${record.uid}`));
    });
    await runTransaction(db, async transaction => {
      const snapshots = await Promise.all([
        ...refs.map(reference => transaction.get(reference)),
        ...(accountLinkRef ? [transaction.get(accountLinkRef)] : [])
      ]);
      snapshots.slice(0, refs.length).forEach((snapshot, index) => {
        if (snapshot.exists()) transaction.delete(refs[index]);
      });
      const accountLinkSnapshot = accountLinkRef ? snapshots[refs.length] : null;
      if (
        accountLinkSnapshot?.exists() &&
        accountLinkSnapshot.data().uid === record.uid &&
        accountLinkSnapshot.data().status === "active"
      ) {
        transaction.delete(accountLinkRef);
      }
    });
    managedUsers.delete(record.uid);
    window.alphaOpenAuthUI.showMessage(`${record.user.displayName || record.user.email} profile deleted`);
    await loadRegisteredUsers();
  } catch (error) {
    console.error("User profile deletion failed", error);
    window.alphaOpenAuthUI.showMessage(error.message || "The user profile could not be deleted.");
  }
}

async function captainSeasonAccessForPlayer(playerId) {
  if (!playerId) return [];
  const activeSeasons = await getDocs(
    query(collection(db, "seasons"), where("status", "==", "active")),
  );
  const access = [];
  for (const season of activeSeasons.docs) {
    const teamSnapshot = await getDocs(
      query(
        collection(season.ref, "teams"),
        where("captainPlayerIds", "array-contains", playerId),
      ),
    );
    if (!teamSnapshot.empty) {
      access.push({
        seasonId: season.id,
        roles: ["player", "captain"],
        teamIds: teamSnapshot.docs.map((team) => team.id),
      });
    }
  }
  return access;
}

async function approveRegistration(record) {
  const currentUser = auth.currentUser;
  if (!isBootstrapAdmin(currentUser)) {
    window.alphaOpenAuthUI.showMessage("Only the verified Super Admin can approve registrations.");
    return;
  }
  try {
    const normalizedEmail = record.user.email.trim().toLowerCase();
    const playerMatches = await getDocs(query(collection(db, "players"), where("emailNormalized", "==", normalizedEmail), limit(2)));
    if (playerMatches.size > 1) throw new Error("Multiple Player Master records match this email. Resolve the duplicates before approval.");
    if (playerMatches.empty) throw new Error("Cannot approve this registration: the Google email is not in Player Master. Add the player first, then retry approval.");
    const playerId = playerMatches.docs[0].id;
    const captainSeasonAccess = await captainSeasonAccessForPlayer(playerId);
    const assignedProfileType = captainSeasonAccess.length ? "captain" : "player";
    const userRef = doc(db, "users", record.uid);
    const requestRef = doc(db, "registrationRequests", record.uid);
    const accountLinkRef = doc(db, "playerAccountLinks", playerId);
    let completedEmailTransfer = false;
    await runTransaction(db, async transaction => {
      const [userSnapshot, requestSnapshot, accountLinkSnapshot] = await Promise.all([
        transaction.get(userRef), transaction.get(requestRef), transaction.get(accountLinkRef)
      ]);
      if (!userSnapshot.exists()) throw new Error("The registered user no longer exists.");
      const previousLink = accountLinkSnapshot.exists() ? accountLinkSnapshot.data() : {};
      const isEmailTransfer =
        previousLink.transferStatus === "awaitingRegistration" &&
        normalizeEmail(previousLink.pendingNewEmail) === normalizedEmail;
      completedEmailTransfer = isEmailTransfer;
      const restoredGlobalRoles = isEmailTransfer
        ? (previousLink.pendingGlobalRoles || []).filter(role => role !== "superAdmin")
        : (userSnapshot.data().globalRoles || []);
      const seasonAccess = isEmailTransfer
        ? previousLink.pendingSeasonAccess || []
        : captainSeasonAccess;
      transaction.update(userRef, {
        status: "active",
        profileType: assignedProfileType,
        playerId,
        globalRoles: restoredGlobalRoles,
        playerEmailNormalized: normalizedEmail,
        updatedAt: serverTimestamp()
      });
      transaction.set(doc(db, "players", playerId), {
        accountUid: record.uid,
        emailNormalized: normalizedEmail,
        updatedByUid: currentUser.uid,
        updatedAt: serverTimestamp()
      }, { merge: true });
      transaction.set(requestRef, {
        ...(requestSnapshot.exists() ? {} : { uid: record.uid, email: record.user.email, displayName: record.user.displayName || record.user.email, photoUrl: record.user.photoUrl || null, requestedAt: serverTimestamp() }),
        status: "approved",
        decidedByUid: currentUser.uid,
        decidedAt: serverTimestamp(),
        decisionNote: null,
        matchedPlayerId: playerId,
        assignedProfileType
      }, { merge: true });
      if (playerId) {
        transaction.set(accountLinkRef, {
          playerId, uid: record.uid, emailAtApproval: record.user.email, status: "active", linkMethod: "exactEmail",
          approvedByUid: currentUser.uid, approvedAt: serverTimestamp(), revokedByUid: null, revokedAt: null, reason: null,
          transferStatus: isEmailTransfer ? "completed" : null,
          pendingNewEmail: null,
          pendingGlobalRoles: [],
          pendingSeasonAccess: [],
          pendingApproverAccess: [],
          transferCompletedAt: isEmailTransfer ? serverTimestamp() : null,
          transferCompletedByUid: isEmailTransfer ? currentUser.uid : null
        }, { merge: true });
      }
      seasonAccess.forEach(access => {
        if (!access.seasonId) return;
        transaction.set(doc(db, "seasons", access.seasonId, "members", record.uid), {
          uid: record.uid,
          playerId,
          roles: access.roles || ["player"],
          teamIds: access.teamIds || [],
          status: "active",
          effectiveFrom: serverTimestamp(),
          effectiveTo: null,
          assignedByUid: currentUser.uid,
          assignedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
      });
      if (isEmailTransfer) {
        (previousLink.pendingApproverAccess || []).forEach(access => {
          if (!access.seasonId) return;
          transaction.set(doc(db, "seasons", access.seasonId, "approverAssignments", record.uid), {
            approverUid: record.uid,
            backupApproverUid: null,
            scopeType: access.scopeType || "season",
            weekId: access.weekId || null,
            matchupId: access.matchupId || null,
            priority: Number(access.priority) || 1,
            status: "active",
            effectiveFrom: serverTimestamp(),
            effectiveTo: null,
            assignedByUid: currentUser.uid,
            assignedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          }, { merge: true });
        });
      }
    });
    window.alphaOpenAuthUI.showMessage(
      `${record.user.displayName || record.user.email} linked to ${playerId} and approved.` +
      (completedEmailTransfer
        ? " Preserved season access was restored."
        : captainSeasonAccess.length
          ? " Captain team access was assigned from the Team record."
          : " Use Manage access for active-season roles."),
    );
    await loadRegisteredUsers();
  } catch (error) {
    console.error("Registration approval failed", error);
    window.alphaOpenAuthUI.showMessage(error.message || "The registration could not be approved.");
  }
}

async function rejectRegistration(record) {
  if (!isBootstrapAdmin()) return;
  if (!window.confirm(`Reject the registration for ${record.user.email}?`)) return;
  const currentUser = auth.currentUser;
  const batchData = {
    status: "rejected", decidedByUid: currentUser.uid, decidedAt: serverTimestamp(), decisionNote: "Rejected by Super Admin",
    matchedPlayerId: null, assignedProfileType: null
  };
  await runTransaction(db, async transaction => {
    transaction.update(doc(db, "users", record.uid), { status: "rejected", profileType: "pending", updatedAt: serverTimestamp() });
    transaction.set(doc(db, "registrationRequests", record.uid), batchData, { merge: true });
  });
  window.alphaOpenAuthUI.showMessage("Registration rejected");
  await loadRegisteredUsers();
}

function openManageUser(record) {
  if (isProtectedSuperAdmin(record)) {
    window.alphaOpenAuthUI.showMessage("Sudarshan Desai is the protected account owner and cannot be modified."); return;
  }
  document.querySelector("#manageUserUid").value = record.uid;
  document.querySelector("#manageUserTitle").textContent = `Manage ${record.user.displayName || "user"}`;
  document.querySelector("#manageUserEmail").textContent = record.user.email;
  const activeSeason = activeSeasonRecord();
  const activeRoles = activeSeason ? record.memberships.get(activeSeason.seasonId)?.roles || [] : [];
  const effectiveActiveRoles = [...new Set([...(record.user.globalRoles || []), ...(record.user.playerId ? ["player"] : []), ...activeRoles])];
  document.querySelector("#manageActiveSeasonLabel").textContent = activeSeason
    ? `${activeSeason.name} (${activeSeason.seasonId}) · Active season profiles`
    : "No active season · Profiles are view only";
  document.querySelectorAll('[name="managedRole"]').forEach(input => {
    input.checked = effectiveActiveRoles.includes(input.value);
    input.disabled = !activeSeason || (input.value === "player" && !record.user.playerId);
  });
  document.querySelector("#managedPastSeasons").innerHTML = seasonRecords
    .filter(season => season.seasonId !== activeSeason?.seasonId)
    .map(season => {
      const roles = record.memberships.get(season.seasonId)?.roles || [];
      const labels = roles.length ? roles.map(profileLabel).join(", ") : "No season-specific access";
      return `<div class="past-season-row" aria-disabled="true"><div><b>${escapeHtml(season.name)}</b><small>${escapeHtml(season.seasonId)} · ${escapeHtml(season.status)}</small></div><span>${escapeHtml(labels)}</span><span class="badge gray">View only</span></div>`;
    }).join("") || '<p class="muted">No other season records.</p>';
  manageUserMessage.textContent = !activeSeason
    ? "Create or mark one season Active before changing season profiles."
    : record.user.playerId
    ? `Linked Player ID: ${record.user.playerId}`
    : "No Player Master match is linked. Player profile cannot be assigned yet.";
  if (typeof manageUserDialog.showModal === "function") manageUserDialog.showModal();
  else manageUserDialog.setAttribute("open", "");
}

function closeManageUser() {
  if (!manageUserDialog.open) return;
  if (typeof manageUserDialog.close === "function") manageUserDialog.close();
  else manageUserDialog.removeAttribute("open");
}

async function saveManagedUser(event) {
  event.preventDefault();
  const uid = document.querySelector("#manageUserUid").value;
  const record = managedUsers.get(uid);
  if (!record || !isBootstrapAdmin()) return;
  if (isProtectedSuperAdmin(record)) {
    manageUserMessage.textContent = "The protected account owner cannot be modified."; return;
  }
  const selected = [...document.querySelectorAll('[name="managedRole"]:checked')].map(input => input.value);
  const activeSeason = activeSeasonRecord();
  if (!activeSeason) {
    manageUserMessage.textContent = "No active season exists. Activate a season in Season Management first.";
    return;
  }
  if (!record.user.playerId) {
    manageUserMessage.textContent = "This account cannot receive access until it is linked to Player Master.";
    return;
  }
  if (!selected.includes("player")) selected.push("player");
  if (selected.includes("superAdmin") && !window.confirm(`Grant Super Admin access to ${record.user.email}?`)) return;

  const currentUser = auth.currentUser;
  const userRef = doc(db, "users", uid);
  const seasonRef = doc(db, "seasons", activeSeason.seasonId);
  const memberRef = doc(seasonRef, "members", uid);
  const approverRef = doc(seasonRef, "approverAssignments", `season_${uid}`);
  const seasonRoles = selected.filter(role => role !== "superAdmin");
  try {
    await runTransaction(db, async transaction => {
      const [userSnapshot, seasonSnapshot, memberSnapshot, approverSnapshot] = await Promise.all([
        transaction.get(userRef), transaction.get(seasonRef), transaction.get(memberRef), transaction.get(approverRef)
      ]);
      if (!userSnapshot.exists() || !seasonSnapshot.exists()) throw new Error("The user or season no longer exists.");
      transaction.update(userRef, {
        globalRoles: selected.includes("superAdmin") ? ["superAdmin"] : [],
        profileType: primaryProfile(selected, record.user.playerId),
        status: "active",
        updatedAt: serverTimestamp()
      });
      transaction.set(memberRef, {
        uid, playerId: record.user.playerId || null, roles: seasonRoles,
        teamIds: memberSnapshot.exists() ? memberSnapshot.data().teamIds || [] : [],
        status: seasonRoles.length ? "active" : "inactive",
        effectiveFrom: memberSnapshot.exists() ? memberSnapshot.data().effectiveFrom : serverTimestamp(),
        effectiveTo: seasonRoles.length ? null : serverTimestamp(),
        assignedByUid: currentUser.uid, assignedAt: serverTimestamp()
      }, { merge: true });
      transaction.set(approverRef, {
        approverUid: uid, backupApproverUid: null, scopeType: "season", weekId: null, matchupId: null, priority: 1,
        status: selected.includes("neutralApprover") ? "active" : "inactive",
        effectiveFrom: approverSnapshot.exists() ? approverSnapshot.data().effectiveFrom : serverTimestamp(),
        effectiveTo: selected.includes("neutralApprover") ? null : serverTimestamp(),
        assignedByUid: currentUser.uid, assignedAt: serverTimestamp()
      }, { merge: true });
    });
    closeManageUser();
    window.alphaOpenAuthUI.showMessage("User access updated");
    await loadRegisteredUsers();
  } catch (error) {
    console.error("Role update failed", error);
    manageUserMessage.textContent = error.message || "The role update could not be saved.";
  }
}

openButton.addEventListener("click", () => openDialog());
closeButton.addEventListener("click", closeDialog);
cancelButton.addEventListener("click", closeDialog);
termInput.addEventListener("change", updateSeasonIdentity);
yearInput.addEventListener("input", updateSeasonIdentity);
form.addEventListener("submit", saveSeason);
document.querySelector("#closeManageUser").addEventListener("click", closeManageUser);
document.querySelector("#cancelManageUser").addEventListener("click", closeManageUser);
manageUserForm.addEventListener("submit", saveManagedUser);
refreshRegisteredUsers.addEventListener("click", loadRegisteredUsers);
document.querySelector("#userManagementSearch").addEventListener("input", event => renderRegisteredUsers(registeredUserRecords, event.target.value));

function startAdminLoads(user) {
  if (!isBootstrapAdmin(user) || currentRoute() !== "admin") return;
  const panel = document.querySelector("[data-admin-panel].active")?.dataset.adminPanel;
  if (panel === "seasons") loadSeasons();
  if (panel !== "users") return;
  if (window.alphaOpenProfileReady?.uid === user.uid && window.alphaOpenProfileReady.status === "ready") {
    loadRegisteredUsers();
  } else if (window.alphaOpenProfileReady?.uid === user.uid && window.alphaOpenProfileReady.status === "error") {
    registeredUsersPanel.innerHTML = '<div class="empty-state compact"><b>Admin profile could not be verified</b><p>Sign out, sign back in, and then press Refresh.</p></div>';
  } else {
    registeredUsersPanel.innerHTML = '<p class="muted">Finishing secure profile setup…</p>';
  }
}

window.addEventListener("alphaopen:profile-ready", () => {
  startAdminLoads(auth.currentUser);
  loadPendingApprovalCount(auth.currentUser).catch((error) => {
    console.error("Pending lineup approval count failed", error);
    window.alphaOpenDataUI?.applyPendingApprovalCount(null);
  });
});

window.addEventListener("alphaopen:update-spring-line",async event=>{
  const reply=(ok,message="")=>window.dispatchEvent(new CustomEvent("alphaopen:spring-line-updated",{detail:{ok,message}}));
  try {
    const user=auth.currentUser;if(!user)throw new Error("Super Admin sign-in is required.");
    const item=event.detail||{},seasonId="AO-S-2026";
    if(!item.matchupId||!item.lineMatchId)throw new Error("The Spring line record is missing its ID.");
    const operationalMatch=doc(db,"seasons",seasonId,"matchups",item.matchupId);
    const operationalLine=doc(operationalMatch,"lineMatches",item.lineMatchId);
    await runTransaction(db,async transaction=>{
      const [oldOperational,operationalParent]=await Promise.all([transaction.get(operationalLine),transaction.get(operationalMatch)]);
      if(!oldOperational.exists())throw new Error("The line record was not found.");
      const playedAt=item.scheduledAt?new Date(item.scheduledAt):null,payload={homePlayers:item.homePlayers,awayPlayers:item.awayPlayers,scheduledAt:playedAt,venueNameSnapshot:item.venueNameSnapshot,sets:item.sets,homePoints:item.homePoints,awayPoints:item.awayPoints,winnerTeamId:item.winnerTeamId,scoreStatus:"published",scheduleStatus:"completed",updatedAt:serverTimestamp()};
      transaction.update(operationalLine,payload);
      if(operationalParent.exists()){const parent=operationalParent.data(),old=oldOperational.data();transaction.update(operationalMatch,{homeTeamPoints:Number(parent.homeTeamPoints||0)-Number(old.homePoints||0)+Number(item.homePoints||0),awayTeamPoints:Number(parent.awayTeamPoints||0)-Number(old.awayPoints||0)+Number(item.awayPoints||0),updatedAt:serverTimestamp()});}
    });
    reply(true);
  } catch(error) { console.error("Spring line update failed",error);reply(false,error.message||"The lineup and score could not be saved."); }
});

function currentRoute() {
  const route = location.hash.slice(1) || "home";
  return route === "fall2026" ? "current-season" : route;
}

async function loadForRoute(route, user = auth.currentUser) {
  if (route === "home") {
    await loadActiveSeason(user);
    await loadPendingApprovalCount(user);
    return;
  }
  if (route === "current-season" || route === "season-dashboard") {
    await loadGlobalActiveSeasonDashboard();
    return;
  }
  if (route === "matches") {
    await loadActiveSeasonMatches(user);
    return;
  }
  if (route === "schedule") {
    await loadCompletedSeasonOptions();
    return;
  }
  if (route === "history") {
    await loadGlobalPlayerDirectory();
    await loadPublishedHistoryData();
    await loadGlobalActiveSeasonDashboard({ includeCompleted: true });
    return;
  }
  if (route === "admin") {
    startAdminLoads(user);
  }
}

window.addEventListener("alphaopen:completed-season-selected", (event) => {
  loadSelectedCompletedSeason(event.detail?.seasonId || "");
});

onAuthStateChanged(auth, user => {
  loadForRoute(currentRoute(), user).catch((error) =>
    console.error("Route data load failed", error),
  );
});

window.addEventListener("alphaopen:route-changed", (event) => {
  loadForRoute(event.detail?.route || currentRoute()).catch((error) =>
    console.error("Route data load failed", error),
  );
});

window.addEventListener("alphaopen:authorization-changed", (event) => {
  loadPendingApprovalCount(event.detail?.user, event.detail?.authorization).catch((error) => {
    console.error("Pending lineup approval count failed", error);
    window.alphaOpenDataUI?.applyPendingApprovalCount(null);
  });
  if (currentRoute() === "schedule") {
    loadCompletedSeasonOptions();
  }
});

window.addEventListener("alphaopen:refresh-matches", async () => {
  try {
    for (const key of [...readCache.keys()])
      if (key.startsWith("operational-"))
        readCache.delete(key);
    await loadActiveSeasonMatches(auth.currentUser);
    window.dispatchEvent(new CustomEvent("alphaopen:matches-refreshed", { detail: { ok: true } }));
  } catch (error) {
    console.error("Matches refresh failed", error);
    window.dispatchEvent(new CustomEvent("alphaopen:matches-refreshed", {
      detail: { ok: false, message: error.message || "Please try again." }
    }));
  }
});

window.addEventListener("alphaopen:admin-panel-changed", () => {
  startAdminLoads(auth.currentUser);
});
