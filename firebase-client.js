import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { connectAuthEmulator, getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const params = new URLSearchParams(location.search);
export const usingFirebaseEmulator =
  LOCAL_HOSTS.has(location.hostname) &&
  params.get("firebase") === "emulator";

const localDevelopmentConfig = {
  projectId: "alphaopen-development-2026",
  appId: "1:128657830722:web:07c8c84d0386b5b11c4edb",
  storageBucket: "alphaopen-development-2026.firebasestorage.app",
  apiKey: "AIzaSyCBxY1bOkhALp1W_1yXFmDo9jdFhRNQqIY",
  authDomain: "alphaopen-development-2026.firebaseapp.com",
  messagingSenderId: "128657830722",
};

const allowedProjectIds = new Set([
  "alphaopen-development-2026",
  "alphaopen-production",
]);
const expectedProjectByHost = new Map([
  ["alphaopen-development-2026.web.app", "alphaopen-development-2026"],
  ["alphaopen-development-2026.firebaseapp.com", "alphaopen-development-2026"],
  ["alphaopen-production.web.app", "alphaopen-production"],
  ["alphaopen-production.firebaseapp.com", "alphaopen-production"],
]);

async function loadFirebaseConfig() {
  if (usingFirebaseEmulator) return localDevelopmentConfig;
  const response = await fetch("/__/firebase/init.json", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Firebase Hosting configuration failed with HTTP ${response.status}.`,
    );
  }
  const config = await response.json();
  if (!config?.projectId || !config?.appId || !config?.apiKey) {
    throw new Error("Firebase Hosting returned an incomplete configuration.");
  }
  if (!allowedProjectIds.has(config.projectId)) {
    throw new Error(`Unapproved Firebase project: ${config.projectId}.`);
  }
  const expectedProjectId = expectedProjectByHost.get(location.hostname);
  if (expectedProjectId && config.projectId !== expectedProjectId) {
    throw new Error(
      `Firebase environment mismatch: ${location.hostname} cannot use ${config.projectId}.`,
    );
  }
  return config;
}

const firebaseConfig = await loadFirebaseConfig();
export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseProjectId = firebaseConfig.projectId;
export const db = initializeFirestore(firebaseApp, {
  localCache: memoryLocalCache(),
});
export const auth = getAuth(firebaseApp);
window.alphaOpenFirebaseProjectId = firebaseProjectId;

if (usingFirebaseEmulator) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  window.alphaOpenFirebaseEmulator = true;
}
