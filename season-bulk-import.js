import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db, firebaseProjectId } from "./firebase-client.js?v=5";
import "./season-reset.js?v=2";
import { publishPublicSeasonDashboard } from "./public-season-dashboard.js?v=15";
import { refreshSeasonPublicRecords } from "./season-public-sync.js?v=1";
const ADMIN = "sudarshandesai74@gmail.com",
  $ = (s) => document.querySelector(s),
  dialog = $("#seasonImportDialog"),
  form = $("#seasonImportForm"),
  summary = $("#seasonImportSummary"),
  preview = $("#seasonImportPreview"),
  confirmId = $("#seasonImportConfirmId"),
  ack = $("#seasonImportAcknowledgement"),
  commit = $("#commitSeasonImport");
let prepared = null,
  xlsxPromise;
const isAdmin = () =>
    auth.currentUser?.emailVerified &&
    auth.currentUser.email?.toLowerCase() === ADMIN,
  clean = (v) => String(v ?? "").trim(),
  email = (v) => clean(v).toLowerCase(),
  key = (v) =>
    clean(v)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""),
  esc = (v) =>
    clean(v).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  loadXlsx = () =>
    (xlsxPromise ||=
      import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"));
const value = (row, name) => {
  const target = key(name),
    entry = Object.entries(row).find(([header]) => key(header) === target);
  return entry?.[1] ?? "";
};
function isoDate(raw, XLSX) {
  if (raw instanceof Date && !Number.isNaN(raw.valueOf()))
    return raw.toISOString().slice(0, 10);
  if (typeof raw === "number") {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d)
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf())
    ? ""
    : parsed.toISOString().slice(0, 10);
}
const toDate = (date, end = false) =>
    new Date(`${date}T${end ? "23:59:59" : "00:00:00"}-04:00`),
  unique = (list) => new Set(list).size === list.length;
function rows(XLSX, workbook, name) {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Missing required sheet: ${name}`);
  return XLSX.utils
    .sheet_to_json(sheet, { defval: "", raw: true })
    .filter((row) => Object.values(row).some((v) => clean(v)));
}
async function downloadTemplate() {
  const link = document.createElement("a");
  link.href = "/assets/AlphaOpen_Season_Reload_Template.xlsx";
  link.download = "AlphaOpen_Season_Reload_Template.xlsx";
  document.body.append(link);
  link.click();
  link.remove();
}
async function prepare(file) {
  if (!isAdmin())
    throw new Error(
      "Only the protected Super Admin can bulk replace a season.",
    );
  prepared = null;
  commit.disabled = true;
  confirmId.disabled = true;
  ack.disabled = true;
  summary.textContent = "Reading and validating workbook…";
  const XLSX = await loadXlsx(),
    book = XLSX.read(await file.arrayBuffer(), { cellDates: true }),
    seasonRows = rows(XLSX, book, "Season"),
    captainRows = rows(XLSX, book, "Captains"),
    rosterRows = rows(XLSX, book, "Team Roster"),
    scheduleRows = rows(XLSX, book, "Weekly Schedule"),
    errors = [];
  if (seasonRows.length !== 1)
    errors.push("Season sheet must contain exactly one data row.");
  const s = seasonRows[0] || {},
    season = {
      seasonId: clean(value(s, "Season ID")),
      name: clean(value(s, "Season Name")),
      term: clean(value(s, "Term")).toLowerCase(),
      year: Number(value(s, "Year")),
      timezone: clean(value(s, "Timezone")) || "America/New_York",
      startDate: isoDate(value(s, "Start Date"), XLSX),
      endDate: isoDate(value(s, "End Date"), XLSX),
      status: clean(value(s, "Status")) || "draft",
      teamCount: Number(value(s, "Teams")),
      rosterRanksPerTeam: Number(value(s, "Roster Ranks Per Team")),
      regularWeeks: Number(value(s, "Regular Weeks")),
      linesPerMatchup: Number(value(s, "Lines Per Matchup")),
      playersPerLine: Number(value(s, "Players Per Line")),
    };
  if (!/^AO-[FS]-\d{4}$/.test(season.seasonId))
    errors.push("Season ID must follow AO-F-YYYY or AO-S-YYYY.");
  if (!season.name || !season.startDate || !season.endDate)
    errors.push("Season name, start date, and end date are required.");
  if (season.status !== "draft")
    errors.push("Bulk-uploaded seasons must begin in draft status.");
  const captains = captainRows.map((r) => ({
      teamId: clean(value(r, "Team ID")),
      teamName: clean(value(r, "Team Name")),
      playerId: clean(value(r, "Captain Player ID")),
      playerEmail: email(value(r, "Captain Email")),
    })),
    roster = rosterRows.map((r) => ({
      teamId: clean(value(r, "Team ID")),
      rank: Number(value(r, "Rank")),
      playerId: clean(value(r, "Player ID")),
      playerEmail: email(value(r, "Player Email")),
    })),
    schedule = scheduleRows.map((r) => ({
      weekId: clean(value(r, "Week ID")),
      weekName: clean(value(r, "Week Name")),
      matchupId: clean(value(r, "Matchup ID")),
      homeTeamId: clean(value(r, "Home Team ID")),
      awayTeamId: clean(value(r, "Away Team ID")),
      weekStartDate: isoDate(value(r, "Week Start Date"), XLSX),
      playByDate: isoDate(value(r, "Play By Date"), XLSX),
      lineupSubmissionDate: isoDate(value(r, "Lineup Submission Date"), XLSX),
      status: clean(value(r, "Status")) || "pendingSubmission",
    }));
  const teamIds = captains.map((x) => x.teamId),
    playerIds = roster.map((x) => x.playerId),
    matchupIds = schedule.map((x) => x.matchupId);
  if (captains.length !== season.teamCount)
    errors.push(
      `Expected ${season.teamCount} captains/teams; found ${captains.length}.`,
    );
  if (!unique(teamIds))
    errors.push("Captain sheet contains duplicate Team IDs.");
  if (!unique(captains.map((x) => x.playerId)))
    errors.push("Captain Player IDs must be unique.");
  if (roster.length !== season.teamCount * season.rosterRanksPerTeam)
    errors.push(
      `Expected ${season.teamCount * season.rosterRanksPerTeam} roster rows; found ${roster.length}.`,
    );
  if (!unique(playerIds))
    errors.push("A Player ID appears more than once in Team Roster.");
  for (const teamId of teamIds) {
    const teamRoster = roster.filter((x) => x.teamId === teamId),
      ranks = teamRoster.map((x) => x.rank);
    if (
      teamRoster.length !== season.rosterRanksPerTeam ||
      !unique(ranks) ||
      Math.min(...ranks) !== 1 ||
      Math.max(...ranks) !== season.rosterRanksPerTeam
    )
      errors.push(
        `${teamId} must contain each rank 1-${season.rosterRanksPerTeam} exactly once.`,
      );
  }
  for (const captain of captains)
    if (
      !roster.some(
        (x) => x.teamId === captain.teamId && x.playerId === captain.playerId,
      )
    )
      errors.push(
        `${captain.playerId} must appear on ${captain.teamId}'s roster.`,
      );
  if (!unique(matchupIds)) errors.push("Matchup IDs must be unique.");
  for (const m of schedule) {
    if (
      !teamIds.includes(m.homeTeamId) ||
      !teamIds.includes(m.awayTeamId) ||
      m.homeTeamId === m.awayTeamId
    )
      errors.push(`${m.matchupId} has invalid team references.`);
    if (!m.weekStartDate || !m.playByDate || !m.lineupSubmissionDate)
      errors.push(`${m.matchupId} has an invalid date.`);
  }
  const [playerSnap, linkSnap, accessSnap] = await Promise.all([
      getDocs(collection(db, "players")),
      getDocs(collection(db, "playerAccountLinks")),
      getDocs(collection(db, "operationsAccess")),
    ]),
    players = new Map(
      playerSnap.docs.map((d) => [d.id, { playerId: d.id, ...d.data() }]),
    ),
    links = new Map(linkSnap.docs.map((d) => [d.id, d.data().uid || null])),
    accessByEmail = new Map(
      accessSnap.docs.map((d) => [email(d.data().emailNormalized || d.id), d.data()]),
    );
  for (const row of roster) {
    const p = players.get(row.playerId);
    if (!p) errors.push(`${row.playerId} is missing from Player Master.`);
    else if (email(p.emailNormalized) !== row.playerEmail)
      errors.push(`${row.playerId} email does not match Player Master.`);
    row.playerName = p?.fullName || p?.displayName || row.playerId;
  }
  for (const row of captains) {
    const p = players.get(row.playerId);
    if (!p || email(p.emailNormalized) !== row.playerEmail)
      errors.push(
        `Captain ${row.playerId} does not match Player Master ID/email.`,
      );
    row.captainName = p?.fullName || p?.displayName || row.playerId;
    row.uid = links.get(row.playerId) || null;
    row.existingAccess = accessByEmail.get(row.playerEmail) || null;
  }
  prepared = {
    season,
    captains,
    roster,
    schedule,
    errors: [...new Set(errors)],
  };
  summary.textContent = prepared.errors.length
    ? `${prepared.errors.length} validation issue(s). Nothing can be uploaded.`
    : `Validated ${captains.length} teams · ${roster.length} roster players · ${new Set(schedule.map((x) => x.weekId)).size} weeks · ${schedule.length} matchups.`;
  preview.innerHTML = prepared.errors.length
    ? prepared.errors.map(
        (error) =>
          `<div class="import-row invalid"><b>Validation error</b><small>${esc(error)}</small></div>`,
      )
    : `<div class="season-import-counts"><span><b>${captains.length}</b> Teams</span><span><b>${roster.length}</b> Players</span><span><b>${new Set(schedule.map((x) => x.weekId)).size}</b> Weeks</span><span><b>${schedule.length}</b> Matchups</span></div><p><b>${esc(season.seasonId)}</b> · ${esc(season.name)} · Status: ${esc(season.status)}</p>`;
  if (!prepared.errors.length) {
    confirmId.disabled = false;
    confirmId.placeholder = season.seasonId;
    ack.disabled = false;
    updateCommit();
  }
}
function updateCommit() {
  commit.disabled =
    !prepared ||
    prepared.errors.length > 0 ||
    confirmId.value.trim() !== prepared.season.seasonId ||
    !ack.checked;
}
async function commitBatchOperations(operations) {
  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = writeBatch(db);
    for (const op of operations.slice(offset, offset + 400))
      op.type === "delete"
        ? batch.delete(op.ref)
        : batch.set(op.ref, op.data, op.options || {});
    await batch.commit();
  }
}
async function collectExisting(seasonId) {
  const deletions = [];
  for (const root of ["seasons"]) {
    for (const name of [
      "teams",
      "rosterSlots",
      "rosterAssignments",
      "weeks",
      "matchups",
    ]) {
      const snap = await getDocs(collection(db, root, seasonId, name));
      for (const item of snap.docs)
        deletions.push({ type: "delete", ref: item.ref });
    }
  }
  const matchupSnap = await getDocs(
    collection(db, "seasons", seasonId, "matchups"),
  );
  for (const matchup of matchupSnap.docs) {
    for (const nested of ["lineups", "lineupReviews", "lineMatches"]) {
      const snap = await getDocs(collection(matchup.ref, nested));
      if (!snap.empty)
        throw new Error(
          `Cannot replace ${seasonId}: ${matchup.id} already has ${nested} workflow records.`,
        );
    }
  }
  return deletions;
}
async function processImport(event) {
  event.preventDefault();
  if (!isAdmin() || commit.disabled || !prepared) return;
  commit.disabled = true;
  summary.textContent =
    "Checking that the season has no lineup or score workflow records…";
  try {
    const { season, captains, roster, schedule } = prepared,
      now = new Date(),
      importId = `IMPORT-${Date.now()}`,
      seasonRef = doc(db, "seasons", season.seasonId);
    const deletions = await collectExisting(season.seasonId);
    await commitBatchOperations([
      {
        type: "set",
        ref: seasonRef,
        data: {
          ...season,
          status: "processingImport",
          importId,
          importStartedAt: serverTimestamp(),
          importStartedByUid: auth.currentUser.uid,
        },
        options: { merge: true },
      },
    ]);
    summary.textContent = `Replacing ${deletions.length} existing generated records…`;
    await commitBatchOperations(deletions);
    const teamById = new Map(captains.map((x) => [x.teamId, x])),
      operations = [],
      push = (root, path, data) =>
        operations.push({
          type: "set",
          ref: doc(db, root, season.seasonId, ...path),
          data,
        });
    const seasonData = {
      ...season,
      activeRuleVersionId: "v1",
      regularSeasonMatchupsPerTeam: season.regularWeeks,
      source: "seasonBulkUpload",
      lastImportId: importId,
      updatedAt: now,
      updatedByUid: auth.currentUser.uid,
    };
    operations.push({ type: "set", ref: seasonRef, data: seasonData });
    operations.push({
      type: "set",
      ref: doc(seasonRef, "ruleVersions", "v1"),
      data: {
        version: 1,
        status: "active",
        roster: { ranksPerTeam: season.rosterRanksPerTeam },
        lineup: {
          linesPerMatchup: season.linesPerMatchup,
          playersPerLine: season.playersPerLine,
          uniquePlayersRequired: season.linesPerMatchup * season.playersPerLine,
        },
        createdAt: now,
      },
    });
    for (const captain of captains) {
      const team = {
        teamId: captain.teamId,
        seasonId: season.seasonId,
        name: captain.teamName,
        captainPlayerIds: [captain.playerId],
        captainNameSnapshot: captain.captainName,
        status: "active",
        updatedAt: now,
      };
      push("seasons", ["teams", captain.teamId], team);
      const existingAccess = captain.existingAccess || {};
      const accessRoles = [
        ...new Set([
          ...(existingAccess.roles || []).filter((role) =>
            ["captain", "ec", "neutralApprover"].includes(role)
          ),
          "captain",
        ]),
      ];
      operations.push({
        type: "set",
        ref: doc(db, "operationsAccess", captain.playerEmail),
        data: {
          emailNormalized: captain.playerEmail,
          playerId: captain.playerId,
          displayNameSnapshot: captain.captainName,
          roles: accessRoles,
          membershipRoles: ["player", ...accessRoles],
          seasonId: season.seasonId,
          teamIds: existingAccess.seasonId === season.seasonId
            ? [...new Set([...(existingAccess.teamIds || []), captain.teamId])]
            : [captain.teamId],
          status: "approved",
          createdAt: existingAccess.createdAt || now,
          createdByUid: existingAccess.createdByUid || auth.currentUser.uid,
          updatedAt: now,
          updatedByUid: auth.currentUser.uid,
        },
        options: { merge: true },
      });
      if (captain.uid) {
        const memberRef = doc(
            db,
            "seasons",
            season.seasonId,
            "members",
            captain.uid,
          ),
          existingMember = (await getDoc(memberRef)).data() || {};
        operations.push({
          type: "set",
          ref: memberRef,
          data: {
            ...existingMember,
            uid: captain.uid,
            playerId: captain.playerId,
            status: "active",
            roles: [...new Set([...(existingMember.roles || []), "captain"])],
            teamIds: [
              ...new Set([...(existingMember.teamIds || []), captain.teamId]),
            ],
            updatedAt: now,
          },
        });
      }
    }
    for (const player of roster) {
      const rank = String(player.rank).padStart(2, "0"),
        assignmentId = `${season.seasonId}-${player.teamId.split("-").at(-1)}-R${rank}`,
        assignment = {
          assignmentId,
          seasonId: season.seasonId,
          teamId: player.teamId,
          rankNumber: player.rank,
          playerId: player.playerId,
          playerNameSnapshot: player.playerName,
          assignmentType: "original",
          status: "active",
          sourceOfTruth: "Season bulk upload",
          createdAt: now,
          updatedAt: now,
        },
        slot = {
          slotId: `${player.teamId}_${rank}`,
          teamId: player.teamId,
          rankNumber: player.rank,
          minimumAppearances: 0,
          maximumAppearances: season.regularWeeks,
          officialAppearances: 0,
          remainingBeforeMaximum: season.regularWeeks,
          updatedAt: now,
        };
      push("seasons", ["rosterAssignments", assignmentId], assignment);
      push("seasons", ["rosterSlots", slot.slotId], slot);
    }
    const weeks = new Map();
    for (const row of schedule)
      if (!weeks.has(row.weekId))
        weeks.set(row.weekId, {
          weekId: row.weekId,
          label: row.weekName,
          sequence: Number(row.weekId.replace(/\D/g, "")) || weeks.size + 1,
          stage: "regular",
          startsAt: toDate(row.weekStartDate),
          lineupDeadlineAt: toDate(row.lineupSubmissionDate, true),
          playByAt: toDate(row.playByDate, true),
          status: "draft",
          updatedAt: now,
        });
    for (const week of weeks.values()) {
      push("seasons", ["weeks", week.weekId], week);
    }
    for (const row of schedule) {
      const home = teamById.get(row.homeTeamId),
        away = teamById.get(row.awayTeamId),
        matchup = {
          matchupId: row.matchupId,
          seasonId: season.seasonId,
          weekId: row.weekId,
          stage: "regular",
          homeTeamId: row.homeTeamId,
          awayTeamId: row.awayTeamId,
          homeTeamNameSnapshot: home.teamName,
          awayTeamNameSnapshot: away.teamName,
          lineupDeadlineAt: toDate(row.lineupSubmissionDate, true),
          scheduledStartAt: toDate(row.weekStartDate),
          playByAt: toDate(row.playByDate, true),
          status: row.status,
          homeLineupStatus: "pendingSubmission",
          awayLineupStatus: "pendingSubmission",
          bothLineupsSubmitted: false,
          lineupsPublished: false,
          completedLineCount: 0,
          linesPerMatchup: season.linesPerMatchup,
          playersPerLine: season.playersPerLine,
          uniquePlayersRequired: season.linesPerMatchup * season.playersPerLine,
          homeTeamPoints: 0,
          awayTeamPoints: 0,
          updatedAt: now,
        };
      push("seasons", ["matchups", row.matchupId], matchup);
    }
    operations.push({
      type: "set",
      ref: doc(seasonRef, "importAudits", importId),
      data: {
        importId,
        seasonId: season.seasonId,
        status: "completed",
        counts: {
          teams: captains.length,
          rosterAssignments: roster.length,
          weeks: weeks.size,
          matchups: schedule.length,
        },
        sourceFile: $("#seasonImportFile").files[0]?.name || "workbook.xlsx",
        completedAt: now,
        completedByUid: auth.currentUser.uid,
      },
    });
    summary.textContent = `Writing ${operations.length} validated season records…`;
    await commitBatchOperations(operations);
    if (season.status === "active") {
      await publishPublicSeasonDashboard(season.seasonId);
    }
    summary.textContent = `${season.seasonId} processed successfully: ${captains.length} teams, ${roster.length} players, ${schedule.length} matchups.`;
    preview.innerHTML +=
      '<div class="import-row valid"><b>Season ready</b><small>Lineup workflow will use the generated Matchup IDs.</small></div>';
    window.alphaOpenAuthUI?.showMessage(
      `${season.seasonId} bulk upload completed`,
    );
    window.dispatchEvent(
      new CustomEvent("alphaopen:season-data-changed", {
        detail: { seasonId: season.seasonId },
      }),
    );
    prepared = null;
    confirmId.disabled = true;
    ack.disabled = true;
  } catch (error) {
    console.error("Season bulk import failed", error);
    summary.textContent = error.message || "Season import failed.";
  } finally {
    commit.disabled = true;
  }
}
function open() {
  if (!isAdmin()) return;
  dialog.showModal();
}
function close() {
  dialog.close();
}
function excelValue(value) {
  if (value == null) return "";
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value?.path === "string") return value.path;
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value, (_key, nested) => {
      if (typeof nested?.toDate === "function") return nested.toDate().toISOString();
      if (typeof nested?.path === "string") return nested.path;
      return nested;
    });
  }
  return value;
}
const EXCEL_CELL_TEXT_LIMIT = 30000;
function splitExcelText(value) {
  const chunks = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + EXCEL_CELL_TEXT_LIMIT, value.length);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end -= 1;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}
function excelFields(field, value) {
  const serialized = excelValue(value);
  if (typeof serialized !== "string" || serialized.length <= EXCEL_CELL_TEXT_LIMIT) {
    return { [field]: serialized };
  }
  const chunks = splitExcelText(serialized);
  return {
    [`${field}__chunkEncoding`]:
      typeof value === "string" ? "text-chunks-v1" : "json-chunks-v1",
    [`${field}__chunkCount`]: chunks.length,
    ...Object.fromEntries(
      chunks.map((chunk, index) => [
        `${field}__part_${String(index + 1).padStart(3, "0")}`,
        chunk,
      ]),
    ),
  };
}
function appendSnapshotRows(target, snapshot, context = {}) {
  snapshot.docs.forEach((item) => {
    const values = Object.entries(item.data()).reduce(
      (result, [field, value]) => Object.assign(result, excelFields(field, value)),
      {},
    );
    target.push({
      "Document Path": item.ref.path,
      "Document ID": item.id,
      ...context,
      ...values,
    });
  });
}
async function exportEntireDatabase() {
  if (!isAdmin()) {
    window.alphaOpenAuthUI?.showMessage("Only Super Admin can export the AlphaOpen database.");
    return;
  }
  const button = $("#exportDatabase");
  button.disabled = true;
  button.textContent = "Reading AlphaOpen records…";
  try {
    const XLSX = await loadXlsx();
    const sheets = new Map();
    const bucket = (name) => {
      if (!sheets.has(name)) sheets.set(name, []);
      return sheets.get(name);
    };
    const globalCollections = [
      ["Users", "users"],
      ["Player Master", "players"],
      ["Player Private (Legacy)", "playerPrivate"],
      ["Email Index", "playerEmailIndex"],
      ["Account Links", "playerAccountLinks"],
      ["Player Link Requests", "playerLinkRequests"],
      ["Registrations", "registrationRequests"],
      ["Operations Access", "operationsAccess"],
      ["Venue Master", "venues"],
      ["Venue Private (Optional)", "venuePrivate"],
      ["System Config", "systemConfig"],
      ["System Counters", "systemCounters"],
      ["Public Config", "publicConfig"],
      ["Public Season Dashboards", "publicSeasonDashboards"],
      ["Public Completed Seasons", "publicCompletedSeasons"],
      ["AO Content", "aoContent"],
      ["AO FAQ Categories", "aoFaqCategories"],
      ["AO FAQs", "aoFaqs"],
    ];
    const globalSnapshots = await Promise.all(
      globalCollections.map(([, collectionName]) => getDocs(collection(db, collectionName))),
    );
    globalSnapshots.forEach((snapshot, index) =>
      appendSnapshotRows(bucket(globalCollections[index][0]), snapshot),
    );
    const userSnapshot = globalSnapshots[0];
    for (const user of userSnapshot.docs) {
      appendSnapshotRows(
        bucket("Notifications"),
        await getDocs(collection(user.ref, "notifications")),
        { "User UID": user.id },
      );
    }

    const seasonSnapshot = await getDocs(collection(db, "seasons"));
    appendSnapshotRows(bucket("Seasons"), seasonSnapshot);
    const seasonCollections = [
      ["Season Teams", "teams"],
      ["Season Members", "members"],
      ["Roster Slots", "rosterSlots"],
      ["Roster Assignments", "rosterAssignments"],
      ["Weeks", "weeks"],
      ["Matchups", "matchups"],
      ["Approvers", "approverAssignments"],
      ["Rule Versions", "ruleVersions"],
      ["Standings", "standings"],
      ["Standings Snapshots", "standingsSnapshots"],
      ["Availability", "availability"],
      ["Replacement Requests", "replacementRequests"],
      ["Late Pass Requests", "latePassRequests"],
      ["Adjustments", "adjustments"],
      ["Import Audits", "importAudits"],
      ["Playoff Brackets", "playoffBrackets"],
      ["Announcements", "announcements"],
      ["Audit Events", "auditEvents"],
    ];
    const matchupCollections = [
      ["Lineups", "lineups"],
      ["Line Matches", "lineMatches"],
      ["Lineup Reviews", "lineupReviews"],
    ];
    const lineWorkflowCollections = [
      ["Schedule Proposals", "scheduleProposals"],
      ["Score Submissions", "scoreSubmissions"],
      ["Score Decisions", "scoreDecisions"],
      ["Player Overrides", "playerOverrides"],
      ["Corrections", "corrections"],
    ];
    for (const season of seasonSnapshot.docs) {
      const snapshots = await Promise.all(
        seasonCollections.map(([, collectionName]) =>
          getDocs(collection(season.ref, collectionName)),
        ),
      );
      snapshots.forEach((snapshot, index) =>
        appendSnapshotRows(bucket(seasonCollections[index][0]), snapshot, {
          "Season ID": season.id,
        }),
      );
      const matchups = snapshots[5];
      for (const matchup of matchups.docs) {
        const nested = await Promise.all(
          matchupCollections.map(([, collectionName]) =>
            getDocs(collection(matchup.ref, collectionName)),
          ),
        );
        nested.forEach((snapshot, index) =>
          appendSnapshotRows(bucket(matchupCollections[index][0]), snapshot, {
            "Season ID": season.id,
            "Matchup ID": matchup.id,
          }),
        );
        for (const lineup of nested[0].docs) {
          appendSnapshotRows(
            bucket("Lineup Revisions"),
            await getDocs(collection(lineup.ref, "revisions")),
            {
              "Season ID": season.id,
              "Matchup ID": matchup.id,
              "Team ID": lineup.id,
            },
          );
        }
        for (const lineMatch of nested[1].docs) {
          const workflowSnapshots = await Promise.all(
            lineWorkflowCollections.map(([, collectionName]) =>
              getDocs(collection(lineMatch.ref, collectionName)),
            ),
          );
          workflowSnapshots.forEach((snapshot, index) =>
            appendSnapshotRows(bucket(lineWorkflowCollections[index][0]), snapshot, {
              "Season ID": season.id,
              "Matchup ID": matchup.id,
              "Line Match ID": lineMatch.id,
            }),
          );
        }
      }
    }

    const workbook = XLSX.utils.book_new();
    const summaryRows = [
      ["AlphaOpen Firebase Database Export"],
      ["Exported At", new Date()],
      ["Firebase Project", firebaseProjectId],
      ["Exported By", auth.currentUser.email || auth.currentUser.uid],
      ["Oversized Field Encoding", "Lossless 30,000-character text-chunks-v1 / json-chunks-v1 columns"],
      [],
      ["Worksheet", "Records", "Purpose"],
      ...[...sheets.entries()].map(([name, records]) => [
        name,
        records.length,
        "Firestore documents with Document Path and Document ID preserved",
      ]),
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows, { cellDates: true });
    summarySheet["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 62 }];
    summarySheet["!freeze"] = { xSplit: 0, ySplit: 6 };
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Export Summary");
    for (const [name, records] of sheets) {
      const rows = records.length
        ? records
        : [{ "Document Path": "", "Document ID": "", Note: "No records found" }];
      const worksheet = XLSX.utils.json_to_sheet(rows, { cellDates: true });
      worksheet["!autofilter"] = { ref: worksheet["!ref"] };
      worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
      const headings = Object.keys(rows[0]);
      worksheet["!cols"] = headings.map((heading) => ({
        wch: Math.min(
          55,
          Math.max(
            12,
            heading.length + 2,
            ...rows.slice(0, 100).map((row) => String(row[heading] ?? "").length + 2),
          ),
        ),
      }));
      XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31));
    }
    const exportDate = new Date().toISOString().replace(/[:.]/g, "-");
    XLSX.writeFileXLSX(
      workbook,
      `AlphaOpen-Firebase-Full-Export-${exportDate}.xlsx`,
      { cellDates: true, compression: true },
    );
    const totalDocuments = [...sheets.values()].reduce((total, rows) => total + rows.length, 0);
    window.alphaOpenAuthUI?.showMessage(
      `${totalDocuments} records exported across ${sheets.size} worksheets.`,
    );
  } catch (error) {
    console.error("Firebase database export failed", error);
    window.alphaOpenAuthUI?.showMessage(`Database export failed: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "Export database to Excel";
  }
}
async function refreshActivePublicDashboard() {
  const button = $("#refreshActivePublicDashboard");
  const message = $("#publicDashboardRefreshMessage");
  if (!button || !message || !isAdmin()) return;
  const controlSnapshot = await getDoc(doc(db, "systemConfig", "seasonControl"));
  const seasonId =
    window.alphaOpenAuthorization?.activeSeasonId ||
    controlSnapshot.data()?.activeSeasonId ||
    "";
  if (!seasonId) {
    message.textContent = "No active season is configured. Nothing was refreshed.";
    return;
  }
  if (!window.confirm(
    `Refresh public records for ${seasonId}?\n\n` +
    "This recalculates matchup totals and standings from official completed lines, " +
    "then rebuilds the public dashboard.",
  )) return;
  button.disabled = true;
  button.textContent = "Refreshing…";
  message.textContent = `Recalculating ${seasonId} matchup totals and standings…`;
  try {
    const result = await refreshSeasonPublicRecords(seasonId);
    message.textContent =
      `${seasonId} public dashboard refreshed successfully: ` +
      `${result.matchupCount} matchups and ${result.standingCount} standings rows.`;
    window.alphaOpenAuthUI?.showMessage(`${seasonId} public dashboard refreshed`);
  } catch (error) {
    console.error("Active public dashboard refresh failed", error);
    message.textContent = `Refresh failed: ${error.message || "Unknown error"}`;
  } finally {
    button.disabled = false;
    button.textContent = "Refresh Active Public Dashboard";
  }
}
$("#exportDatabase")?.addEventListener("click", exportEntireDatabase);
$("#refreshActivePublicDashboard")?.addEventListener("click", refreshActivePublicDashboard);
$("#downloadSeasonTemplate")?.addEventListener("click", downloadTemplate);
$("#downloadSeasonTemplateDialog")?.addEventListener("click", downloadTemplate);
$("#openSeasonImport")?.addEventListener("click", open);
$("#closeSeasonImport")?.addEventListener("click", close);
$("#cancelSeasonImport")?.addEventListener("click", close);
$("#seasonImportFile")?.addEventListener(
  "change",
  (event) =>
    event.target.files[0] &&
    prepare(event.target.files[0]).catch((error) => {
      summary.textContent = error.message;
      commit.disabled = true;
    }),
);
confirmId?.addEventListener("input", updateCommit);
ack?.addEventListener("change", updateCommit);
form?.addEventListener("submit", processImport);
