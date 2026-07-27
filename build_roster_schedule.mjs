import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = "C:/Users/desai/OneDrive/Desktop/AO_F_2026_RandomTeamRoster.xlsx";
const outputDir = "outputs/roster_schedule";
const outputPath = `${outputDir}/AO_F_2026_TeamRoster_WeeklySchedule.xlsx`;
await fs.mkdir(outputDir, { recursive: true });

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const teamSheet = workbook.worksheets.getItem("Team Name");
const playerSheet = workbook.worksheets.getItem("Players");
const rosterSheet = workbook.worksheets.getItem("Team Roster");
const scheduleSheet = workbook.worksheets.getItem("Team Schedule");

const teamRows = teamSheet.getRange("A2:D9").values;
const playerRows = playerSheet.getRange("A2:C113").values;
const rosterRows = rosterSheet.getRange("A2:B113").values;

const playersById = new Map(
  playerRows.map(([id, email, fullName]) => [String(id), { id: String(id), email, fullName }]),
);
const captainsByNumber = new Map();
for (const [masterTeamId, teamName, captainId] of teamRows) {
  const match = String(masterTeamId).match(/T(\d+)$/);
  if (!match) throw new Error(`Cannot identify team number from ${masterTeamId}`);
  const player = playersById.get(String(captainId));
  if (!player) throw new Error(`Captain ${captainId} for ${teamName} is missing from Players`);
  captainsByNumber.set(Number(match[1]), player);
}

const captainIds = new Set([...captainsByNumber.values()].map((p) => p.id));
const nonCaptains = playerRows
  .map(([id, email, fullName]) => ({ id: String(id), email, fullName }))
  .filter((player) => !captainIds.has(player.id));
if (nonCaptains.length !== 104) throw new Error(`Expected 104 non-captains, found ${nonCaptains.length}`);

const random = mulberry32(20260724);
const randomized = shuffle(nonCaptains, random);
const rosterOutput = [];
const teamIds = [];
for (let teamIndex = 0; teamIndex < 8; teamIndex++) {
  const teamNumber = teamIndex + 1;
  const teamId = `AO-F-2026-T${teamNumber}`;
  teamIds.push(teamId);
  const captain = captainsByNumber.get(teamNumber);
  const teammates = randomized.slice(teamIndex * 13, teamIndex * 13 + 13);
  const assigned = [captain, ...teammates];
  for (let rankIndex = 0; rankIndex < 14; rankIndex++) {
    const templateRow = rosterRows[teamIndex * 14 + rankIndex];
    if (templateRow[0] !== teamId || Number(templateRow[1]) !== rankIndex + 1) {
      throw new Error(`Unexpected roster template row for ${teamId}, rank ${rankIndex + 1}`);
    }
    const player = assigned[rankIndex];
    rosterOutput.push([player.id, player.email, player.fullName]);
  }
}
rosterSheet.getRange("C2:E113").values = rosterOutput;
rosterSheet.getRange("C:C").format.columnWidth = 15;
rosterSheet.getRange("D:D").format.columnWidth = 31;
rosterSheet.getRange("E:E").format.columnWidth = 25;

// Circle-method round robin: 8 teams, 4 matches per week, 7 weeks.
let rotation = [...teamIds];
const matchups = [];
const homeCounts = new Map(teamIds.map((team) => [team, 0]));
const awayCounts = new Map(teamIds.map((team) => [team, 0]));
for (let week = 0; week < 7; week++) {
  for (let i = 0; i < 4; i++) {
    const first = rotation[i];
    const second = rotation[7 - i];
    const firstIndex = teamIds.indexOf(first);
    const secondIndex = teamIds.indexOf(second);
    const low = Math.min(firstIndex, secondIndex);
    const high = Math.max(firstIndex, secondIndex);
    const difference = high - low;
    // Balanced orientation of K8: every team finishes with either 3 or 4 home games.
    const lowIsHome = difference <= 3 || (difference === 4 && low % 2 === 0);
    const home = lowIsHome ? teamIds[low] : teamIds[high];
    const away = lowIsHome ? teamIds[high] : teamIds[low];
    matchups.push([home, away]);
    homeCounts.set(home, homeCounts.get(home) + 1);
    awayCounts.set(away, awayCounts.get(away) + 1);
  }
  rotation = [rotation[0], rotation[7], ...rotation.slice(1, 7)];
}
scheduleSheet.getRange("D2:E29").values = matchups;
scheduleSheet.getRange("C:C").format.columnWidth = 24;
scheduleSheet.getRange("D:E").format.columnWidth = 19;

// Visually identify captains without disturbing the supplied table style.
for (let teamIndex = 0; teamIndex < 8; teamIndex++) {
  const row = 2 + teamIndex * 14;
  rosterSheet.getRange(`C${row}:E${row}`).format = {
    fill: "#DDEBF7",
    font: { bold: true, color: "#0B1F3A" },
  };
}
rosterSheet.freezePanes.freezeRows(1);
scheduleSheet.freezePanes.freezeRows(1);

// Data integrity checks.
const assignedIds = rosterOutput.map((row) => row[0]);
if (assignedIds.length !== 112 || new Set(assignedIds).size !== 112) {
  throw new Error("Roster does not contain 112 unique players");
}
for (let teamIndex = 0; teamIndex < 8; teamIndex++) {
  const captain = captainsByNumber.get(teamIndex + 1);
  if (rosterOutput[teamIndex * 14][0] !== captain.id) {
    throw new Error(`Captain assignment failed for team ${teamIndex + 1}`);
  }
}
const pairKeys = matchups.map(([home, away]) => [home, away].sort().join("|"));
if (new Set(pairKeys).size !== 28) throw new Error("Schedule contains a repeated matchup");
for (const team of teamIds) {
  const games = matchups.filter(([home, away]) => home === team || away === team).length;
  if (games !== 7) throw new Error(`${team} has ${games} games instead of 7`);
  if (Math.abs(homeCounts.get(team) - awayCounts.get(team)) > 1) {
    throw new Error(`${team} has an unbalanced home/away split`);
  }
}

for (const name of ["Team Name", "Players", "Team Roster", "Team Schedule"]) {
  const preview = await workbook.render({ sheetName: name, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(
    `${outputDir}/final_${name.replaceAll(" ", "_")}.png`,
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const rosterCheck = await workbook.inspect({
  kind: "table",
  range: "Team Roster!A1:E113",
  include: "values,formulas",
  tableMaxRows: 18,
  tableMaxCols: 5,
  maxChars: 9000,
});
console.log(rosterCheck.ndjson);
const scheduleCheck = await workbook.inspect({
  kind: "table",
  range: "Team Schedule!A1:H29",
  include: "values,formulas",
  tableMaxRows: 29,
  tableMaxCols: 8,
  maxChars: 14000,
});
console.log(scheduleCheck.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, homeCounts: Object.fromEntries(homeCounts), awayCounts: Object.fromEntries(awayCounts) }));
