import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = "C:/Users/desai/OneDrive/Desktop/AO_F_2026_RandomTeamRoster.xlsx";
const outDir = "outputs/roster_schedule";
await fs.mkdir(outDir, { recursive: true });

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 18000,
  tableMaxRows: 20,
  tableMaxCols: 20,
  tableMaxCellChars: 120,
});
console.log(summary.ndjson);

const sheets = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 5000 });
console.log(sheets.ndjson);

for (const name of ["Team Master", "Player Master", "Team Roster", "Team Schedule"]) {
  try {
    const region = await workbook.inspect({
      kind: "region,computedStyle",
      sheetId: name,
      range: "A1:Z150",
      maxChars: 16000,
      tableMaxRows: 150,
      tableMaxCols: 26,
    });
    await fs.writeFile(`${outDir}/${name.replaceAll(" ", "_")}_inspect.txt`, region.ndjson, "utf8");
    const preview = await workbook.render({ sheetName: name, autoCrop: "all", scale: 1, format: "png" });
    await fs.writeFile(`${outDir}/${name.replaceAll(" ", "_")}.png`, new Uint8Array(await preview.arrayBuffer()));
    console.log(`saved ${name}`);
  } catch (error) {
    console.log(`sheet ${name}: ${error.message}`);
  }
}
