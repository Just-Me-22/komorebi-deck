/* Packs the built app into a zip with one folder inside it.
   electron-builder's own zip target archives the contents of win-unpacked, so
   unzipping it emptied eighteen files and folders into whatever directory you
   were in. This wraps them in "Komorebi Deck <version>" instead. */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { version } = require("../package.json");
const dist = path.join(__dirname, "..", "dist");
const built = path.join(dist, "win-unpacked");
const folder = `Komorebi Deck ${version}`;
const staged = path.join(dist, folder);
const zip = path.join(dist, `Komorebi-Deck-${version}-windows-x64.zip`);

if (!fs.existsSync(built)) throw new Error(`nothing to pack: ${built} is not there`);

fs.rmSync(staged, { recursive: true, force: true });
fs.rmSync(zip, { force: true });

// Renamed rather than copied, and put back afterwards, so this stays instant on
// 270MB and dist/win-unpacked is still where it was for anyone running it.
fs.renameSync(built, staged);
try {
  // bsdtar ships with Windows and writes zip. The tar on PATH under Git Bash is
  // GNU tar, which does not, so this goes to the system one by full path.
  execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"),
    ["-a", "-c", "-f", zip, "-C", dist, folder], { stdio: "inherit" });
} finally {
  fs.renameSync(staged, built);
}

console.log(`packed ${folder} into ${path.basename(zip)}`
  + ` (${(fs.statSync(zip).size / 1e6).toFixed(1)}MB)`);
