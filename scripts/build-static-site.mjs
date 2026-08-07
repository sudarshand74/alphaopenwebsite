import {createHash} from "node:crypto";
import {cp, mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const output = path.join(root, "dist");
const topLevelExtensions = new Set([".html", ".js", ".css", ".webmanifest"]);

await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});

const files = [];
for (const entry of await readdir(root, {withFileTypes: true})) {
  if (entry.isFile() && topLevelExtensions.has(path.extname(entry.name))) files.push(entry.name);
}

async function collectAssets(directory, prefix = "assets") {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const source = path.join(directory, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) await collectAssets(source, relative);
    else files.push(relative);
  }
}
await collectAssets(path.join(root, "assets"));

for (const relative of files.sort()) {
  const source = path.join(root, ...relative.split("/"));
  const destination = path.join(output, ...relative.split("/"));
  await mkdir(path.dirname(destination), {recursive: true});
  await cp(source, destination);
}

const requiredFiles = ["index.html", "manifest.webmanifest", "service-worker.js", "firebase-client.js"];
for (const required of requiredFiles) await stat(path.join(output, required));

const html = await readFile(path.join(output, "index.html"), "utf8");
const serviceWorker = await readFile(path.join(output, "service-worker.js"), "utf8");
const appShellSource = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1];
if (!appShellSource) throw new Error("service-worker.js does not contain a readable APP_SHELL array.");
const localReferences = [
  ...html.matchAll(/(?:src|href)="([^"]+)"/g),
].map(match => match[1]);
const cachedPaths = [...appShellSource.matchAll(/"(\/[^"]+)"/g)].map(match => match[1]);

for (const reference of [...localReferences, ...cachedPaths]) {
  if (/^(?:https?:|mailto:|data:|#)/.test(reference) || reference === "/") continue;
  const normalized = reference.replace(/^\.\//, "").replace(/^\//, "").split(/[?#]/)[0];
  if (!normalized) continue;
  await stat(path.join(output, ...normalized.split("/")));
}

const manifest = [];
for (const relative of files.sort()) {
  const contents = await readFile(path.join(output, ...relative.split("/")));
  manifest.push({
    path: relative,
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
}
await writeFile(path.join(output, "build-manifest.json"), `${JSON.stringify({createdAt: new Date().toISOString(), files: manifest}, null, 2)}\n`);
console.log(`Build passed: ${manifest.length} deployable files copied to dist/.`);
