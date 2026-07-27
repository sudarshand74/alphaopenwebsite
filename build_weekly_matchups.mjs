import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "outputs/weekly_matchups";
const outputPath = `${outputDir}/AO_F_2026_Weekly_Matchups.xlsx`;
await fs.mkdir(outputDir, { recursive: true });

const shortRows = [
  ["Wk1", "T1", "T6"], ["Wk1", "T2", "T5"], ["Wk1", "T4", "T7"], ["Wk1", "T8", "T3"],
  ["Wk2", "T1", "T2"], ["Wk2", "T4", "T5"], ["Wk2", "T6", "T8"], ["Wk2", "T7", "T3"],
  ["Wk3", "T1", "T4"], ["Wk3", "T2", "T3"], ["Wk3", "T6", "T5"], ["Wk3", "T8", "T7"],
  ["Wk4", "T1", "T8"], ["Wk4", "T2", "T4"], ["Wk4", "T3", "T5"], ["Wk4", "T7", "T6"],
  ["Wk5", "T1", "T3"], ["Wk5", "T2", "T8"], ["Wk5", "T4", "T6"], ["Wk5", "T7", "T5"],
  ["Wk6", "T1", "T5"], ["Wk6", "T2", "T7"], ["Wk6", "T3", "T6"], ["Wk6", "T8", "T4"],
  ["Wk7", "T1", "T7"], ["Wk7", "T3", "T4"], ["Wk7", "T6", "T2"], ["Wk7", "T8", "T5"],
];
const fullTeamId = (shortId) => `AO-F-2026-${shortId}`;
const rows = shortRows.map(([week, home, away]) => [week, fullTeamId(home), fullTeamId(away)]);

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Weekly Matchups");
sheet.showGridLines = false;
sheet.getRange("A1:C29").values = [["Week", "Home Team", "Away Team"], ...rows];
sheet.getRange("A1:C1").format = {
  fill: "#0B1F3A",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
sheet.getRange("A2:A29").format = {
  fill: "#D9EAD3",
  font: { bold: true, color: "#1F4E2C" },
  horizontalAlignment: "center",
};
sheet.getRange("A1:C29").format.borders = {
  insideHorizontal: { style: "thin", color: "#D9E2F3" },
  bottom: { style: "thin", color: "#A6A6A6" },
};
sheet.getRange("A:A").format.columnWidth = 12;
sheet.getRange("B:C").format.columnWidth = 24;
sheet.getRange("A1:C1").format.rowHeight = 26;
sheet.freezePanes.freezeRows(1);
const table = sheet.tables.add("A1:C29", true, "WeeklyMatchupsTable");
table.style = "TableStyleMedium2";
table.showBandedColumns = false;

const counts = new Map();
for (const [, home, away] of rows) {
  counts.set(home, (counts.get(home) ?? 0) + 1);
  counts.set(away, (counts.get(away) ?? 0) + 1);
}
for (let team = 1; team <= 8; team++) {
  const id = `AO-F-2026-T${team}`;
  if (counts.get(id) !== 7) throw new Error(`${id} does not have exactly 7 games`);
}

const check = await workbook.inspect({
  kind: "table",
  range: "Weekly Matchups!A1:C29",
  include: "values,formulas",
  tableMaxRows: 29,
  tableMaxCols: 3,
  maxChars: 9000,
});
console.log(check.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);
const preview = await workbook.render({
  sheetName: "Weekly Matchups",
  autoCrop: "all",
  scale: 1.5,
  format: "png",
});
await fs.writeFile(`${outputDir}/weekly_matchups_preview.png`, new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
