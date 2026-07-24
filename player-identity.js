import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "./firebase-client.js?v=3";

const VERSION_REF = doc(db, "publicConfig", "playerMaster");
const CACHE_KEY = "alphaopen:canonical-players:v1";
const VERSION_CHECK_KEY = "alphaopen:canonical-players:checked";
const VERSION_VALUE_KEY = "alphaopen:canonical-players:version";
const VERSION_CHECK_TTL_MS = 5 * 60 * 1000;
let memoryState = null;
let loadingState = null;

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function storedState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!parsed?.version || !Array.isArray(parsed.players)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storeState(state) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    localStorage.setItem(VERSION_CHECK_KEY, String(Date.now()));
    localStorage.setItem(VERSION_VALUE_KEY, String(state.version || "0"));
  } catch {
    // Firestore's persistent cache remains available when localStorage is blocked.
  }
}

function stateMap(state) {
  return new Map((state?.players || []).map(player => [player.playerId, player]));
}

async function currentVersion() {
  let lastChecked = 0;
  try { lastChecked = Number(localStorage.getItem(VERSION_CHECK_KEY) || 0); }
  catch { /* Continue with a server version check. */ }
  if (Date.now() - lastChecked < VERSION_CHECK_TTL_MS) {
    try { return localStorage.getItem(VERSION_VALUE_KEY) || "0"; }
    catch { /* Continue to the server version check. */ }
  }
  const snapshot = await getDoc(VERSION_REF);
  const version = snapshot.exists() ? String(snapshot.data().version || "0") : "0";
  try {
    localStorage.setItem(VERSION_CHECK_KEY, String(Date.now()));
    localStorage.setItem(VERSION_VALUE_KEY, version);
  } catch { /* Ignore storage restrictions. */ }
  return version;
}

async function loadState() {
  const version = await currentVersion();
  const local = storedState();
  if (local?.version === version) return local;
  const snapshot = await getDocs(collection(db, "players"));
  const players = snapshot.docs
    .map(item => ({
      playerId: item.id,
      displayName: cleanName(item.data().displayName || item.id),
      status: item.data().status || "active",
    }))
    .filter(player => player.status !== "inactive");
  const state = { version, players, cachedAt: Date.now() };
  storeState(state);
  return state;
}

export async function loadCanonicalPlayers({ force = false } = {}) {
  if (force) {
    memoryState = null;
    loadingState = null;
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(VERSION_CHECK_KEY);
      localStorage.removeItem(VERSION_VALUE_KEY);
    } catch { /* Ignore storage restrictions. */ }
  }
  if (memoryState) return stateMap(memoryState);
  if (!loadingState) loadingState = loadState();
  memoryState = await loadingState;
  return stateMap(memoryState);
}

export async function canonicalPlayer(playerId) {
  const players = await loadCanonicalPlayers();
  const player = players.get(String(playerId || "").trim());
  if (!player) throw new Error(`${playerId || "Player ID"} does not exist in the active public Player Master.`);
  return player;
}

export async function canonicalPlayerName(playerId) {
  return (await canonicalPlayer(playerId)).displayName;
}

export async function canonicalizePlayerReference(playerId, extra = {}) {
  const player = await canonicalPlayer(playerId);
  return { ...extra, playerId: player.playerId, nameSnapshot: player.displayName };
}

export async function validatePlayerIds(playerIds) {
  const players = await loadCanonicalPlayers();
  const unique = [...new Set((playerIds || []).filter(Boolean))];
  const missing = unique.filter(playerId => !players.has(playerId));
  if (missing.length) throw new Error(`Unknown Player ID${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
  return players;
}

export async function bumpPlayerMasterVersion() {
  await setDoc(VERSION_REF, {
    version: increment(1),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  memoryState = null;
  loadingState = null;
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(VERSION_CHECK_KEY);
    localStorage.removeItem(VERSION_VALUE_KEY);
  } catch { /* Ignore storage restrictions. */ }
}

export function clearCanonicalPlayerCache() {
  memoryState = null;
  loadingState = null;
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(VERSION_CHECK_KEY);
    localStorage.removeItem(VERSION_VALUE_KEY);
  } catch { /* Ignore storage restrictions. */ }
}
