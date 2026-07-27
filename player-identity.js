import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "./firebase-client.js?v=4";

const VERSION_REF = doc(db, "publicConfig", "playerMaster");
const CACHE_KEY = "alphaopen:canonical-players:v3";
const VERSION_CHECK_KEY = "alphaopen:canonical-players:checked:v2";
const VERSION_VALUE_KEY = "alphaopen:canonical-players:version:v2";
const VERSION_CHECK_TTL_MS = 5 * 60 * 1000;
let memoryState = null;
let loadingState = null;

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function resolvedPlayerName(playerId, ...candidates) {
  const normalizedId = cleanName(playerId);
  return candidates
    .map(cleanName)
    .find(
      (value) =>
        value &&
        value !== normalizedId &&
        value.toLowerCase() !== "player name unavailable" &&
        value.toLowerCase() !== "name unavailable",
    ) || "";
}

export function formattedPlayerLabel(playerId, rankNumber, ...candidates) {
  const normalizedId = cleanName(playerId);
  const name = resolvedPlayerName(normalizedId, ...candidates);
  const identity = name && normalizedId
    ? `${name} (${normalizedId})`
    : name || normalizedId || "Player name unavailable";
  return rankNumber !== undefined && rankNumber !== null && rankNumber !== ""
    ? `R${Number(rankNumber)}-${identity}`
    : identity;
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
  const snapshot = await getDoc(VERSION_REF);
  let players = (snapshot.data()?.players || [])
    .map(player => ({
      playerId: cleanName(player.playerId),
      displayName: resolvedPlayerName(player.playerId, player.displayName),
      status: player.status || "active",
    }))
    .filter(player => player.playerId && player.displayName && player.status !== "inactive")
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (!players.length) {
    try {
      const canonicalSnapshot = await getDocs(collection(db, "players"));
      players = canonicalSnapshot.docs
        .map(item => {
          const record = item.data();
          return {
            playerId: item.id,
            displayName: resolvedPlayerName(
              item.id,
              record.fullName,
              record.displayName,
              `${record.firstName || ""} ${record.lastName || ""}`,
            ),
            status: record.status || "active",
          };
        })
        .filter(player => player.displayName && player.status !== "inactive")
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    } catch {
      // Guests intentionally rely on the public directory projection.
    }
  }
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
  const snapshot = await getDocs(collection(db, "players"));
  const players = snapshot.docs
    .map(item => {
      const record = item.data();
      return {
        playerId: item.id,
        displayName: resolvedPlayerName(
          item.id,
          record.fullName,
          record.displayName,
          `${record.firstName || ""} ${record.lastName || ""}`,
        ),
        status: record.status || "active",
      };
    })
    .filter(player => player.displayName && player.status !== "inactive")
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  await setDoc(VERSION_REF, {
    version: increment(1),
    players,
    playerCount: players.length,
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
