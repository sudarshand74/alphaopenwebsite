const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {execFileSync} = require("child_process");

const PROD_PROJECT = "alphaopen-production";
const BACKUP_PROJECT = "alphaopen-backups-2026";
const BACKUP_BUCKET = "alphaopen-prod-backups-2026";
const DATABASE = "(default)";
const LOCATION = "nam5";

function firebaseToolsLib() {
  if (process.env.FIREBASE_TOOLS_LIB) return process.env.FIREBASE_TOOLS_LIB;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const globalRoot = execFileSync(npm, ["root", "-g"], {encoding: "utf8"}).trim();
  return path.join(globalRoot, "firebase-tools", "lib");
}

const toolsLib = firebaseToolsLib();
const auth = require(path.join(toolsLib, "auth.js"));
const {requireAuth} = require(path.join(toolsLib, "requireAuth.js"));
const {Client} = require(path.join(toolsLib, "apiv2.js"));

function option(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : "";
}

function requireAccount() {
  const account = auth.getGlobalDefaultAccount();
  if (!account) throw new Error("Firebase CLI is not signed in. Run firebase login first.");
  return account;
}

async function authorize(projectId) {
  const account = requireAccount();
  await requireAuth({project: projectId, user: account.user, tokens: account.tokens});
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function timestamp(value) {
  if (!/^\d{8}T\d{6}Z$/.test(value)) {
    throw new Error("Timestamp must use YYYYMMDDTHHmmssZ UTC format.");
  }
  return value;
}

async function exportFirestore() {
  const stamp = timestamp(option("timestamp"));
  await authorize(PROD_PROJECT);
  const client = new Client({
    urlPrefix: "https://firestore.googleapis.com",
    apiVersion: "v1",
  });
  const outputUriPrefix = `gs://${BACKUP_BUCKET}/firestore/manual/PROD-${stamp}`;
  const response = await client.post(
    `/projects/${PROD_PROJECT}/databases/${DATABASE}:exportDocuments`,
    {outputUriPrefix},
  );
  const operationName = response.body.name;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(3000);
    const operation = (await client.get(`/${operationName}`)).body;
    if (!operation.done) continue;
    if (operation.error) throw new Error(JSON.stringify(operation.error));
    console.log(JSON.stringify({
      type: "firestore-export",
      projectId: PROD_PROJECT,
      database: DATABASE,
      operationName,
      outputUriPrefix,
      completed: true,
    }));
    return;
  }
  throw new Error(`Firestore export is still running. Operation: ${operationName}`);
}

async function uploadAuth() {
  const file = path.resolve(option("file"));
  const objectName = option("object");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error("Authentication export file does not exist.");
  }
  if (!/^auth\/PROD-auth-\d{8}T\d{6}Z\.json$/.test(objectName)) {
    throw new Error("Authentication backup object name is invalid.");
  }
  await authorize(BACKUP_PROJECT);
  const content = fs.readFileSync(file);
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  const uploadClient = new Client({urlPrefix: "https://storage.googleapis.com"});
  await uploadClient.request({
    method: "PUT",
    path: `/${BACKUP_BUCKET}/${objectName}`,
    headers: {
      "content-type": "application/json",
      "x-goog-meta-sha256": sha256,
    },
    body: fs.createReadStream(file),
    skipLog: {reqBody: true, resBody: true},
  });
  const storageClient = new Client({
    urlPrefix: "https://storage.googleapis.com",
    apiVersion: "storage/v1",
  });
  const uploaded = (
    await storageClient.get(`/b/${BACKUP_BUCKET}/o/${encodeURIComponent(objectName)}`)
  ).body;
  if (Number(uploaded.size) !== content.length || uploaded.metadata?.sha256 !== sha256) {
    throw new Error("Uploaded Authentication backup did not pass size and SHA-256 verification.");
  }
  console.log(JSON.stringify({
    type: "auth-export",
    projectId: PROD_PROJECT,
    bucket: BACKUP_BUCKET,
    objectName,
    bytes: content.length,
    sha256,
    verified: true,
  }));
}

function newest(items, field) {
  return [...items].sort((left, right) =>
    String(right[field] || "").localeCompare(String(left[field] || "")))[0] || null;
}

async function listObjects(client, prefix) {
  const response = await client.get(`/b/${BACKUP_BUCKET}/o`, {
    queryParams: {prefix, maxResults: 1000},
  });
  return response.body.items || [];
}

async function status() {
  const maxAgeHours = Number(option("max-age-hours") || 36);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours < 24) {
    throw new Error("Maximum backup age must be at least 24 hours.");
  }
  await authorize(PROD_PROJECT);
  const firestore = new Client({
    urlPrefix: "https://firestore.googleapis.com",
    apiVersion: "v1",
  });
  const databasePath = `/projects/${PROD_PROJECT}/databases/${DATABASE}`;
  const [databaseResponse, scheduleResponse, backupResponse] = await Promise.all([
    firestore.get(databasePath),
    firestore.get(`${databasePath}/backupSchedules`),
    firestore.get(`/projects/${PROD_PROJECT}/locations/${LOCATION}/backups`),
  ]);

  await authorize(BACKUP_PROJECT);
  const storage = new Client({
    urlPrefix: "https://storage.googleapis.com",
    apiVersion: "storage/v1",
  });
  const [manualObjects, authObjects] = await Promise.all([
    listObjects(storage, "firestore/manual/"),
    listObjects(storage, "auth/"),
  ]);

  const database = databaseResponse.body;
  const schedules = scheduleResponse.body.backupSchedules || [];
  const backups = backupResponse.body.backups || [];
  const readyBackups = backups.filter((backup) => backup.state === "READY");
  const latestReady = newest(readyBackups, "snapshotTime");
  const ageHours = latestReady
    ? (Date.now() - Date.parse(latestReady.snapshotTime)) / 3600000
    : null;
  const latestManual = newest(manualObjects, "updated");
  const latestAuth = newest(authObjects, "updated");
  const healthy = Boolean(
    schedules.some((schedule) => schedule.dailyRecurrence) &&
    latestReady &&
    ageHours <= maxAgeHours &&
    database.pointInTimeRecoveryEnablement === "POINT_IN_TIME_RECOVERY_ENABLED" &&
    database.deleteProtectionState === "DELETE_PROTECTION_ENABLED" &&
    latestManual &&
    latestAuth
  );

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    healthy,
    projectId: PROD_PROJECT,
    database: DATABASE,
    location: LOCATION,
    dailyScheduleCount: schedules.filter((schedule) => schedule.dailyRecurrence).length,
    scheduleRetentionSeconds: schedules[0]?.retention || null,
    readyBackupCount: readyBackups.length,
    latestReadyBackup: latestReady ? {
      name: latestReady.name,
      snapshotTime: latestReady.snapshotTime,
      expireTime: latestReady.expireTime,
      ageHours: Number(ageHours.toFixed(2)),
    } : null,
    pitr: database.pointInTimeRecoveryEnablement,
    versionRetentionPeriod: database.versionRetentionPeriod,
    deleteProtection: database.deleteProtectionState,
    backupBucket: BACKUP_BUCKET,
    latestManualExportObject: latestManual ? {
      name: latestManual.name,
      updated: latestManual.updated,
      bytes: Number(latestManual.size || 0),
    } : null,
    latestAuthExport: latestAuth ? {
      name: latestAuth.name,
      updated: latestAuth.updated,
      bytes: Number(latestAuth.size || 0),
      sha256: latestAuth.metadata?.sha256 || null,
    } : null,
  }, null, 2));
  if (!healthy) process.exitCode = 2;
}

async function main() {
  const command = process.argv[2];
  if (command === "export-firestore") return exportFirestore();
  if (command === "upload-auth") return uploadAuth();
  if (command === "status") return status();
  throw new Error("Use export-firestore, upload-auth, or status.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
