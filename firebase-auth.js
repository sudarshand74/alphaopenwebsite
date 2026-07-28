import {
  GoogleAuthProvider,
  browserSessionPersistence,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db, firebaseProjectId } from "./firebase-client.js?v=5";
export { auth, db };
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const ui = window.alphaOpenAuthUI;
const continueButton = document.querySelector("#continueGoogle");
const signInDialog = document.querySelector("#signInDialog");
const registrationBlockedDialog = document.querySelector("#registrationBlockedDialog");
const registrationBlockedMessage = document.querySelector("#registrationBlockedMessage");
const acknowledgeRegistrationBlocked = document.querySelector("#acknowledgeRegistrationBlocked");
const BOOTSTRAP_ADMIN_EMAIL = "sudarshandesai74@gmail.com";
const BOOTSTRAP_ADMIN_PLAYER_ID =
  firebaseProjectId === "alphaopen-production" ? "AO-1200" : "P1200";
const SEASON_CONTROL_REF = doc(db, "systemConfig", "seasonControl");
const OPERATIONS_ROLES = ["captain", "ec", "neutralApprover"];

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function operationsAccessRef(email) {
  return doc(db, "operationsAccess", normalizeEmail(email));
}

function profileTypeForRoles(roles) {
  return roles.includes("ec")
    ? "ec"
    : roles.includes("captain")
      ? "captain"
      : "neutralApprover";
}

function friendlyAuthError(error) {
  const messages = {
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/cancelled-popup-request": "Google sign-in was cancelled.",
    "auth/popup-blocked": "Your browser blocked the Google sign-in window. Please allow popups and try again.",
    "auth/network-request-failed": "Google sign-in needs an internet connection.",
    "auth/unauthorized-domain": "This website address is not yet authorized for Google sign-in.",
    "auth/web-storage-unsupported": "Safari is blocking the browser storage required for Google sign-in. Turn off Private Browsing and try again.",
    "auth/operation-not-supported-in-this-environment": "Google sign-in is not available in this browser window. Open AlphaOpen directly in Safari and try again."
  };
  return messages[error?.code] || "Google sign-in could not be completed. Please try again.";
}

async function ensureUserProfile(user) {
  if (!user.emailVerified) throw new Error("The Google email address is not verified.");

  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);
  const isBootstrapAdmin = user.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
  const commonFields = {
    photoUrl: user.photoURL || null,
    lastLoginAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (snapshot.exists()) {
    const linkedPlayerId = isBootstrapAdmin ? BOOTSTRAP_ADMIN_PLAYER_ID : snapshot.data().playerId;
    const common = {
      ...commonFields,
      displayName: await canonicalPlayerName(linkedPlayerId, snapshot.data().displayName || user.displayName || user.email)
    };
    if (isBootstrapAdmin) return ensureBootstrapAdminPlayerLink(user, userRef, common);
    return activateApprovedOperationsUser(user, userRef, common);
  }

  if (!isBootstrapAdmin) {
    return activateApprovedOperationsUser(user, userRef, {
      ...commonFields,
      displayName: user.displayName || user.email,
    });
  }
  const matchedPlayerId = BOOTSTRAP_ADMIN_PLAYER_ID;
  const common = {
    ...commonFields,
    displayName: await canonicalPlayerName(matchedPlayerId, user.displayName || user.email)
  };
  const batch = writeBatch(db);
  batch.set(userRef, {
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    ...common,
    status: "active",
    profileType: "superAdmin",
    playerId: matchedPlayerId,
    globalRoles: ["superAdmin"],
    createdAt: serverTimestamp()
  });
  await batch.commit();
  return ensureBootstrapAdminPlayerLink(user, userRef, common);
}

async function activateApprovedOperationsUser(user, userRef, common) {
  const emailNormalized = normalizeEmail(user.email);
  const grantRef = operationsAccessRef(emailNormalized);
  const [grantSnapshot, seasonControl] = await Promise.all([
    getDoc(grantRef),
    getDoc(SEASON_CONTROL_REF),
  ]);
  if (!grantSnapshot.exists() || grantSnapshot.data().status !== "approved") {
    const error = new Error("This Google email has not been pre-approved for private AlphaOpen Operations access.");
    error.code = "operations/not-authorized";
    throw error;
  }
  const grant = grantSnapshot.data();
  const roles = OPERATIONS_ROLES.filter((role) => (grant.roles || []).includes(role));
  const membershipRoles = ["player", ...roles];
  if (!roles.length || !grant.playerId || normalizeEmail(grant.emailNormalized) !== emailNormalized) {
    throw new Error("The approved Operations access record is incomplete. Contact AlphaOpen Administration.");
  }
  const playerRef = doc(db, "players", grant.playerId);
  const linkRef = doc(db, "playerAccountLinks", grant.playerId);
  const activeSeasonId = seasonControl.exists() ? seasonControl.data().activeSeasonId || "" : "";
  const memberRef = activeSeasonId && grant.seasonId === activeSeasonId
    ? doc(db, "seasons", activeSeasonId, "members", user.uid)
    : null;
  const displayName = await canonicalPlayerName(grant.playerId, grant.displayNameSnapshot || common.displayName);
  await runTransaction(db, async (transaction) => {
    const references = [grantRef, userRef, playerRef, linkRef, ...(memberRef ? [memberRef] : [])];
    const [verifiedGrant, userSnapshot, playerSnapshot, linkSnapshot] =
      await Promise.all(references.map((reference) => transaction.get(reference)));
    const currentGrant = verifiedGrant.data() || {};
    if (!verifiedGrant.exists() || currentGrant.status !== "approved") {
      throw new Error("Operations access was revoked before sign-in completed.");
    }
    if (!playerSnapshot.exists()) throw new Error(`${grant.playerId} is missing from Player Master.`);
    if (normalizeEmail(playerSnapshot.data().emailNormalized) !== emailNormalized) {
      throw new Error("The approved Google email no longer matches Player Master.");
    }
    if (linkSnapshot.exists() && linkSnapshot.data().status === "active" && linkSnapshot.data().uid !== user.uid) {
      throw new Error(`${grant.playerId} is already linked to a different Google account.`);
    }
    const userData = {
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      displayName,
      photoUrl: user.photoURL || null,
      status: "active",
      profileType: profileTypeForRoles(roles),
      playerId: grant.playerId,
      globalRoles: roles,
      playerEmailNormalized: emailNormalized,
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(userSnapshot.exists() ? {} : { createdAt: serverTimestamp() }),
    };
    transaction.set(userRef, userData, { merge: true });
    transaction.set(linkRef, {
      playerId: grant.playerId,
      uid: user.uid,
      emailAtApproval: emailNormalized,
      status: "active",
      linkMethod: "preApprovedEmail",
      approvedByUid: currentGrant.updatedByUid,
      approvedAt: currentGrant.updatedAt || serverTimestamp(),
      revokedByUid: null,
      revokedAt: null,
      reason: null,
    }, { merge: true });
    if (memberRef) {
      transaction.set(memberRef, {
        uid: user.uid,
        playerId: grant.playerId,
        roles: membershipRoles,
        teamIds: grant.teamIds || [],
        status: "active",
        effectiveFrom: serverTimestamp(),
        effectiveTo: null,
        assignedByUid: currentGrant.updatedByUid,
        assignedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  });
  return (await getDoc(userRef)).data();
}

async function canonicalPlayerName(playerId, fallback) {
  if (!playerId) return fallback;
  const playerSnapshot = await getDoc(doc(db, "players", playerId));
  if (!playerSnapshot.exists()) return fallback;
  const player = playerSnapshot.data();
  return player.displayName || player.fullName || [player.firstName, player.lastName].filter(Boolean).join(" ") || fallback;
}

function showRegistrationBlocked(message) {
  registrationBlockedMessage.textContent = message;
  return new Promise(resolve => {
    const acknowledge = () => {
      acknowledgeRegistrationBlocked.removeEventListener("click", acknowledge);
      if (registrationBlockedDialog.open) registrationBlockedDialog.close();
      resolve();
    };
    acknowledgeRegistrationBlocked.addEventListener("click", acknowledge);
    try {
      if (signInDialog.open) signInDialog.close();
      if (typeof registrationBlockedDialog.showModal === "function") registrationBlockedDialog.showModal();
      else registrationBlockedDialog.setAttribute("open", "");
      acknowledgeRegistrationBlocked.focus();
    } catch (dialogError) {
      acknowledgeRegistrationBlocked.removeEventListener("click", acknowledge);
      window.alert(message);
      resolve();
    }
  });
}

registrationBlockedDialog.addEventListener("cancel", event => event.preventDefault());

async function ensureBootstrapAdminPlayerLink(user, userRef, common) {
  const playerRef = doc(db, "players", BOOTSTRAP_ADMIN_PLAYER_ID);
  const linkRef = doc(db, "playerAccountLinks", BOOTSTRAP_ADMIN_PLAYER_ID);
  await runTransaction(db, async transaction => {
    const [userSnapshot, playerSnapshot, linkSnapshot] = await Promise.all([
      transaction.get(userRef), transaction.get(playerRef), transaction.get(linkRef)
    ]);
    if (!userSnapshot.exists()) throw new Error("The protected Super Admin profile is missing.");
    if (!playerSnapshot.exists()) throw new Error(`${BOOTSTRAP_ADMIN_PLAYER_ID} is missing from Firebase Player Master.`);
    if (playerSnapshot.data().emailNormalized?.toLowerCase() !== BOOTSTRAP_ADMIN_EMAIL) throw new Error(`${BOOTSTRAP_ADMIN_PLAYER_ID} does not match the protected Super Admin email.`);
    if (linkSnapshot.exists() && linkSnapshot.data().uid !== user.uid) throw new Error(`${BOOTSTRAP_ADMIN_PLAYER_ID} is already linked to another Google account.`);
    transaction.update(userRef, {
      ...common, status: "active", profileType: "superAdmin",
      playerId: BOOTSTRAP_ADMIN_PLAYER_ID, globalRoles: ["superAdmin"]
    });
    transaction.set(linkRef, {
      playerId: BOOTSTRAP_ADMIN_PLAYER_ID, uid: user.uid, emailAtApproval: BOOTSTRAP_ADMIN_EMAIL,
      status: "active", linkMethod: "superAdminOverride", approvedByUid: linkSnapshot.exists() ? linkSnapshot.data().approvedByUid : user.uid,
      approvedAt: linkSnapshot.exists() ? linkSnapshot.data().approvedAt : serverTimestamp(), revokedByUid: null, revokedAt: null,
      reason: "Protected account owner linked to verified Firebase Player Master record"
    }, { merge: true });
  });
  return (await getDoc(userRef)).data();
}

async function authorizationFor(user, userData) {
  if (user.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) {
    return { role: "Super Admin", access: ["player", "captain", "approver", "ec"], playerId: userData.playerId || null, playerName: userData.displayName || null, status: "active" };
  }

  if (userData.status !== "active") {
    const error = new Error("Your AO Operations access is not active. Contact AlphaOpen Administration if you believe this is an error.");
    error.code = "operations/inactive";
    throw error;
  }

  const seasonControl = await getDoc(SEASON_CONTROL_REF);
  const activeSeasonId = seasonControl.exists() ? seasonControl.data().activeSeasonId : null;
  const membership = activeSeasonId ? await getDoc(doc(db, "seasons", activeSeasonId, "members", user.uid)) : null;
  const roles = new Set([...(userData.globalRoles || []), ...(membership?.exists() ? membership.data().roles || [] : [])]);
  if (userData.profileType === "player") roles.add("player");

  const access = [];
  if (roles.has("player")) access.push("player");
  if (roles.has("captain")) access.push("captain");
  if (roles.has("neutralApprover")) access.push("approver");
  if (roles.has("ec") || roles.has("superAdmin")) access.push("ec");
  if (roles.has("superAdmin")) access.push("captain", "approver", "player");

  const uniqueAccess = [...new Set(access)];
  const hasOperationsRole = roles.has("superAdmin") ||
    roles.has("ec") ||
    roles.has("captain") ||
    roles.has("neutralApprover");
  if (!hasOperationsRole) {
    const error = new Error("This operations portal is restricted to approved AlphaOpen Captains, EC members, Neutral Approvers, and Administrators.");
    error.code = "operations/not-authorized";
    throw error;
  }
  const role = roles.has("superAdmin") ? "Super Admin"
    : roles.has("ec") ? "EC"
    : roles.has("captain") ? "Captain"
    : roles.has("neutralApprover") ? "Neutral Approver"
    : roles.has("player") ? "Player"
    : "Guest";
  return { role, access: uniqueAccess, playerId: userData.playerId || null, playerName: userData.displayName || null, status: "active", roles: [...roles], activeSeasonId, teamIds: membership?.exists() ? membership.data().teamIds || [] : [] };
}

async function startGoogleSignIn() {
  if (window.location.hash.slice(1) !== "operations") {
    ui.showMessage("AO Operations sign-in is available only from the private operations address.");
    return;
  }
  continueButton.disabled = true;
  if (signInDialog.open) signInDialog.close();
  ui.setStatus("Opening Google sign-in…");
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    ui.setStatus("Guest access");
    ui.showMessage(friendlyAuthError(error));
  } finally {
    continueButton.disabled = false;
  }
}

window.addEventListener("alphaopen:request-signin", startGoogleSignIn);
window.addEventListener("alphaopen:request-signout", async () => {
  try {
    await signOut(auth);
    ui.showMessage("Signed out securely");
  } catch (error) {
    ui.showMessage("Sign-out could not be completed. Please try again.");
  }
});

async function configurePersistence() {
  for (const persistence of [browserSessionPersistence, inMemoryPersistence]) {
    try {
      await setPersistence(auth, persistence);
      return;
    } catch (error) {
      console.warn("Firebase persistence mode unavailable", error?.code || error);
    }
  }
}

await configurePersistence();

let authStateObserved = false;
let previousAuthUid = null;
onAuthStateChanged(auth, async user => {
  const nextAuthUid = user?.uid || null;
  const accountChanged = authStateObserved && previousAuthUid !== nextAuthUid;
  authStateObserved = true;
  previousAuthUid = nextAuthUid;
  if (!user) {
    window.alphaOpenProfileReady = null;
    ui.applyGuest();
    if (accountChanged && window.location.hash.slice(1) !== "operations") window.location.hash = "home";
    return;
  }

  ui.setStatus("Securing your AlphaOpen profile…");
  try {
    await user.getIdTokenResult(true);
    const userData = await ensureUserProfile(user);
    const authorization = await authorizationFor(user, userData);
    window.alphaOpenProfileReady = { uid: user.uid, status: "ready" };
    ui.applyUser(user, authorization, true);
    if (accountChanged || window.location.hash.slice(1) === "operations") window.location.hash = "home";
    window.dispatchEvent(new CustomEvent("alphaopen:profile-ready", { detail: window.alphaOpenProfileReady }));
  } catch (error) {
    console.error("AlphaOpen profile initialization failed", error);
    const isProtectedAdmin = user.emailVerified && user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
    if (isProtectedAdmin) {
      window.alphaOpenProfileReady = { uid: user.uid, status: "ready", protectedAdminFallback: true };
      ui.applyUser(user, { role: "Super Admin", access: ["player", "captain", "approver", "ec"], playerId: BOOTSTRAP_ADMIN_PLAYER_ID, status: "active" }, true);
      if (accountChanged || window.location.hash.slice(1) === "operations") window.location.hash = "home";
      ui.showMessage("Signed in as the protected AlphaOpen Super Admin.");
      window.dispatchEvent(new CustomEvent("alphaopen:profile-ready", { detail: window.alphaOpenProfileReady }));
      return;
    }
    window.alphaOpenProfileReady = { uid: user.uid, status: "error" };
    const attemptedOperations = window.location.hash.slice(1) === "operations";
    if (attemptedOperations) {
      await showRegistrationBlocked(error.message);
    }
    await signOut(auth);
    ui.applyGuest();
    window.location.hash = "home";
  }
});
