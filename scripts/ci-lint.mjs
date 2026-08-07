import {readdir, readFile, stat} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const excludedDirectories = new Set([
  ".git", ".firebase", ".artifact_runtime", ".codex", ".codex-work",
  "coverage", "dist", "emulator-data", "node_modules", "output", "outputs", "tmp",
  "weekly-lineup-dashboard-mock",
]);
const sourceExtensions = new Set([".js", ".mjs", ".cjs"]);
// Retained for migration history but not referenced by the current page, loader, or service worker.
// Do not repair or reactivate it without a separately approved behavior change.
const legacySourceFiles = new Set(["lineup-management.js"]);

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(fullPath));
    else if (sourceExtensions.has(path.extname(entry.name)) && !legacySourceFiles.has(path.relative(root, fullPath).replaceAll("\\", "/"))) files.push(fullPath);
  }
  return files;
}

const sourceFiles = (await collect(root)).sort();
for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {encoding: "utf8"});
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

for (const relativePath of [
  "package.json", "firebase.json", "firestore.indexes.json",
  "manifest.webmanifest", "functions/package.json",
]) {
  JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

const markdownFiles = ["README.md", ...(await readdir(path.join(root, "docs")))
  .filter(name => name.endsWith(".md"))
  .map(name => `docs/${name}`)];
for (const relativePath of markdownFiles) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    await stat(path.resolve(root, path.dirname(relativePath), decodeURIComponent(target)));
  }
}

console.log(`Lint passed: ${sourceFiles.length} JavaScript files, 5 JSON files, and ${markdownFiles.length} documentation files validated.`);
