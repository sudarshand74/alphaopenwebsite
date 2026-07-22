import {
  getApp,
  getApps,
  initializeApp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
const config = {
    projectId: "alphaopen-development-2026",
    appId: "1:128657830722:web:07c8c84d0386b5b11c4edb",
    storageBucket: "alphaopen-development-2026.firebasestorage.app",
    apiKey: "AIzaSyCBxY1bOkhALp1W_1yXFmDo9jdFhRNQqIY",
    authDomain: "alphaopen-development-2026.firebaseapp.com",
    messagingSenderId: "128657830722",
  },
  app = getApps().length ? getApp() : initializeApp(config),
  auth = getAuth(app),
  db = getFirestore(app),
  ADMIN = "sudarshandesai74@gmail.com",
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
  const XLSX = await loadXlsx(),
    book = XLSX.utils.book_new(),
    add = (name, data) =>
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data), name);
  add("Instructions", [
    {
      Step: 1,
      Instruction: "Complete every required sheet; do not rename headers.",
    },
    {
      Step: 2,
      Instruction: "Player IDs and emails must match Firebase Player Master.",
    },
    {
      Step: 3,
      Instruction: "Validate in Admin before confirming replacement.",
    },
  ]);
  add("Season", [
    {
      "Season ID": "AO-F-2027",
      "Season Name": "AlphaOpen Fall 2027",
      Term: "fall",
      Year: 2027,
      Timezone: "America/New_York",
      "Start Date": "2027-08-02",
      "End Date": "2027-11-14",
      Status: "draft",
      Teams: 8,
      "Roster Ranks Per Team": 14,
      "Regular Weeks": 7,
      "Lines Per Matchup": 5,
      "Players Per Line": 2,
    },
  ]);
  add("Captains", [
    {
      "Team ID": "AO-F-2027-T1",
      "Team Name": "Team CaptainName",
      "Captain Player ID": "P1001",
      "Captain Email": "captain@example.com",
    },
  ]);
  add("Team Roster", [
    {
      "Team ID": "AO-F-2027-T1",
      Rank: 1,
      "Player ID": "P1001",
      "Player Email": "captain@example.com",
    },
  ]);
  add("Weekly Schedule", [
    {
      "Week ID": "W1",
      "Week Name": "Week 1",
      "Matchup ID": "AO-F-2027-W1-M1",
      "Home Team ID": "AO-F-2027-T1",
      "Away Team ID": "AO-F-2027-T2",
      "Week Start Date": "2027-08-02",
      "Play By Date": "2027-08-16",
      "Lineup Submission Date": "2027-08-06",
      Status: "pendingSubmission",
    },
  ]);
  XLSX.writeFileXLSX(book, "AlphaOpen_Season_Bulk_Upload_Template.xlsx", {
    cellDates: true,
  });
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
  const [playerSnap, linkSnap] = await Promise.all([
      getDocs(collection(db, "playerPrivate")),
      getDocs(collection(db, "playerAccountLinks")),
    ]),
    players = new Map(
      playerSnap.docs.map((d) => [d.id, { playerId: d.id, ...d.data() }]),
    ),
    links = new Map(linkSnap.docs.map((d) => [d.id, d.data().uid || null]));
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
  for (const root of ["seasons", "publicSeasons"]) {
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
      ref: doc(db, "publicSeasons", season.seasonId),
      data: seasonData,
    });
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
        captainEmailsNormalized: [captain.playerEmail],
        captainNameSnapshot: captain.captainName,
        captainUids: captain.uid ? [captain.uid] : [],
        status: "active",
        updatedAt: now,
      };
      push("seasons", ["teams", captain.teamId], team);
      push("publicSeasons", ["teams", captain.teamId], team);
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
      push("publicSeasons", ["rosterAssignments", assignmentId], assignment);
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
      push("publicSeasons", ["weeks", week.weekId], week);
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
      push("publicSeasons", ["matchups", row.matchupId], matchup);
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
    summary.textContent = `Writing ${operations.length} validated Firebase records…`;
    await commitBatchOperations(operations);
    summary.textContent = `${season.seasonId} processed successfully: ${captains.length} teams, ${roster.length} players, ${schedule.length} matchups.`;
    preview.innerHTML +=
      '<div class="import-row valid"><b>Season ready</b><small>Lineup workflow will use the generated Matchup IDs.</small></div>';
    window.alphaOpenAuthUI?.showMessage(
      `${season.seasonId} bulk upload completed`,
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
