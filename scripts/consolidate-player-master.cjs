const path = require("path");

const toolsLib = process.env.FIREBASE_TOOLS_LIB;
if (!toolsLib) throw new Error("FIREBASE_TOOLS_LIB is required.");
const auth = require(path.join(toolsLib, "auth.js"));
const { requireAuth } = require(path.join(toolsLib, "requireAuth.js"));
const { Client } = require(path.join(toolsLib, "apiv2.js"));

const projectId = "alphaopen-development-2026";
const databaseRoot = `/projects/${projectId}/databases/(default)/documents`;
const documentRootName = `projects/${projectId}/databases/(default)/documents`;
const retiredFields = new Set([
  "displayName", "photoUrl", "publicProfileEnabled", "globalScore",
  "emergencyContact", "accountStatus"
]);

function stringValue(fields, key) {
  return fields?.[key]?.stringValue || "";
}

async function listCollection(client, collectionId) {
  const records = [];
  let pageToken = "";
  do {
    const response = await client.get(`${databaseRoot}/${collectionId}`, {
      queryParams: { pageSize: 300, ...(pageToken ? { pageToken } : {}) }
    });
    records.push(...(response.body.documents || []));
    pageToken = response.body.nextPageToken || "";
  } while (pageToken);
  return records;
}

function documentId(document) {
  return document.name.split("/").pop();
}

function canonicalFields(playerId, privateDocument) {
  const fields = Object.fromEntries(
    Object.entries(privateDocument.fields || {}).filter(([key]) => !retiredFields.has(key))
  );
  fields.playerId = { stringValue: playerId };
  if (!stringValue(fields, "fullName")) {
    fields.fullName = {
      stringValue: [stringValue(fields, "firstName"), stringValue(fields, "lastName")]
        .filter(Boolean).join(" ")
    };
  }
  if (!stringValue(fields, "status")) fields.status = { stringValue: "active" };
  fields.migratedFromPlayerPrivateAt = { timestampValue: new Date().toISOString() };
  fields.migratedByUid = { stringValue: process.env.MIGRATED_BY_UID || "firebase-cli" };
  return fields;
}

async function main() {
  const account = auth.getGlobalDefaultAccount();
  if (!account) throw new Error("Firebase CLI is not signed in.");
  await requireAuth({
    project: projectId,
    user: account.user,
    tokens: account.tokens
  });
  const client = new Client({
    urlPrefix: "https://firestore.googleapis.com",
    apiVersion: "v1"
  });
  const [players, privatePlayers, emailIndexes] = await Promise.all([
    listCollection(client, "players"),
    listCollection(client, "playerPrivate"),
    listCollection(client, "playerEmailIndex")
  ]);
  if (process.argv.includes("--verify-cleanup")) {
    const canonicalErrors = players.filter(document => {
      const fields = document.fields || {};
      return !stringValue(fields, "playerId") ||
        !stringValue(fields, "fullName") ||
        !stringValue(fields, "emailNormalized") ||
        [...retiredFields].some(field => Object.prototype.hasOwnProperty.call(fields, field));
    });
    if (players.length !== 280 || privatePlayers.length !== 0 ||
        emailIndexes.length !== 280 || canonicalErrors.length) {
      throw new Error(
        `Cleanup verification failed: players=${players.length}, ` +
        `playerPrivate=${privatePlayers.length}, emailIndexes=${emailIndexes.length}, ` +
        `invalidCanonical=${canonicalErrors.length}`
      );
    }
    console.log(JSON.stringify({
      result: "cleanup-verified",
      canonicalPlayers: players.length,
      legacyPlayerPrivate: privatePlayers.length,
      emailIndexes: emailIndexes.length
    }));
    return;
  }
  const playersById = new Map(players.map(document => [documentId(document), document]));
  const privateById = new Map(privatePlayers.map(document => [documentId(document), document]));
  const indexByPlayerId = new Map(
    emailIndexes.map(document => [stringValue(document.fields, "playerId"), document])
  );
  const errors = [];
  if (players.length !== privatePlayers.length)
    errors.push(`players=${players.length}; playerPrivate=${privatePlayers.length}`);
  for (const [playerId, privateDocument] of privateById) {
    const email = stringValue(privateDocument.fields, "emailNormalized").trim().toLowerCase();
    const emailIndex = indexByPlayerId.get(playerId);
    if (!playersById.has(playerId)) errors.push(`${playerId} missing from players`);
    if (!email) errors.push(`${playerId} missing emailNormalized`);
    if (!emailIndex || stringValue(emailIndex.fields, "emailNormalized").trim().toLowerCase() !== email)
      errors.push(`${playerId} email index mismatch`);
  }
  for (const playerId of playersById.keys())
    if (!privateById.has(playerId)) errors.push(`${playerId} missing from playerPrivate`);
  const emails = privatePlayers.map(document =>
    stringValue(document.fields, "emailNormalized").trim().toLowerCase()
  );
  if (new Set(emails).size !== emails.length) errors.push("duplicate Player Master email");
  if (errors.length) throw new Error(`Preflight failed: ${errors.slice(0, 12).join("; ")}`);

  console.log(JSON.stringify({
    mode: process.argv.includes("--apply") ? "apply" : "dry-run",
    players: players.length,
    privatePlayers: privatePlayers.length,
    emailIndexes: emailIndexes.length,
    validation: "passed"
  }));
  if (!process.argv.includes("--apply")) return;

  const writes = privatePlayers.map(privateDocument => {
    const playerId = documentId(privateDocument);
    return {
      update: {
        name: `${documentRootName}/players/${playerId}`,
        fields: canonicalFields(playerId, privateDocument)
      },
      currentDocument: { exists: true }
    };
  });
  const writeResponse = await client.post(
    `/projects/${projectId}/databases/(default)/documents:batchWrite`,
    { writes }
  );
  if ((writeResponse.body.status || []).some(status => Number(status.code || 0) !== 0))
    throw new Error("Firestore batchWrite reported one or more failures.");

  const verifiedPlayers = await listCollection(client, "players");
  const verifiedById = new Map(verifiedPlayers.map(document => [documentId(document), document]));
  const verificationErrors = [];
  for (const [playerId, privateDocument] of privateById) {
    const target = verifiedById.get(playerId);
    if (!target) {
      verificationErrors.push(`${playerId} missing after write`);
      continue;
    }
    if (stringValue(target.fields, "emailNormalized") !== stringValue(privateDocument.fields, "emailNormalized"))
      verificationErrors.push(`${playerId} email differs`);
    if (stringValue(target.fields, "fullName") !== stringValue(canonicalFields(playerId, privateDocument), "fullName"))
      verificationErrors.push(`${playerId} fullName differs`);
    if ([...retiredFields].some(field => Object.prototype.hasOwnProperty.call(target.fields || {}, field)))
      verificationErrors.push(`${playerId} retained a retired field`);
  }
  if (verificationErrors.length)
    throw new Error(`Verification failed: ${verificationErrors.slice(0, 12).join("; ")}`);
  console.log(JSON.stringify({
    result: "verified",
    canonicalPlayers: verifiedPlayers.length,
    legacyPlayerPrivateUntouched: privatePlayers.length
  }));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
