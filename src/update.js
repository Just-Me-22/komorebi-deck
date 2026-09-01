/* Updating a portable app that has no installer.

   The app cannot overwrite its own running exe, and it does not need to: it
   ships as a folder named after its version, so an update is a new folder
   beside the old one. That is exactly what updating by hand looks like, so this
   just does the same steps without the browser trip.

   Nothing reaches the network until asked. Checking is a button. */
const { app, net } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const RELEASES = "https://api.github.com/repos/Just-Me-22/komorebi-deck/releases/latest";

const newer = (a, b) => {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};

// Where this build lives, and where a new one would go beside it. Running from
// source there is no such folder, and updating makes no sense, so it says so.
function layout() {
  if (!app.isPackaged) return { portable: false };
  const dir = path.dirname(process.execPath);
  return { portable: true, dir, parent: path.dirname(dir) };
}

async function check() {
  const here = app.getVersion();
  const spot = layout();
  try {
    const res = await net.fetch(RELEASES, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "komorebi-deck" },
    });
    if (!res.ok) return { ok: false, here, error: `GitHub answered ${res.status}` };
    const body = await res.json();
    const tag = String(body.tag_name || "").replace(/^v/, "");
    const asset = (body.assets || []).find((a) => a.name.endsWith(".zip"));
    return {
      ok: true,
      here,
      latest: tag || null,
      behind: tag ? newer(tag, here) : false,
      url: asset ? asset.browser_download_url : null,
      size: asset ? asset.size : 0,
      notes: String(body.body || "").split("\n").slice(0, 6).join("\n"),
      page: body.html_url,
      portable: spot.portable,
    };
  } catch (err) {
    return { ok: false, here, error: String(err.message || err) };
  }
}

// Downloads beside the current folder and unpacks with the bsdtar that ships in
// System32, the same thing the build uses to make the zip.
async function download(url, version, onProgress) {
  const spot = layout();
  if (!spot.portable) return { ok: false, error: "running from source, nothing to update" };

  const zip = path.join(os.tmpdir(), `komorebi-deck-${version}.zip`);
  const res = await net.fetch(url);
  if (!res.ok) return { ok: false, error: `download failed: ${res.status}` };

  const total = Number(res.headers.get("content-length")) || 0;
  let got = 0;
  // A reader loop rather than for-await: web streams are only async-iterable on
  // some runtimes and this has to work on the one the app actually ships with.
  const out = fs.createWriteStream(zip);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) {
      await new Promise((r) => out.once("drain", r));
    }
    if (onProgress) onProgress(total ? got / total : 0);
  }
  await new Promise((r) => out.end(r));

  const before = new Set(await fsp.readdir(spot.parent));
  await new Promise((resolve, reject) => {
    execFile(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"),
      ["-x", "-f", zip, "-C", spot.parent],
      { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
  await fsp.rm(zip, { force: true });

  // The zip holds one folder named for its version; find whichever appeared.
  const after = await fsp.readdir(spot.parent);
  const fresh = after.find((n) => !before.has(n) && n.toLowerCase().includes("komorebi deck"));
  if (!fresh) return { ok: false, error: "unpacked, but the new folder could not be found" };

  const exe = path.join(spot.parent, fresh, "Komorebi Deck.exe");
  if (!fs.existsSync(exe)) return { ok: false, error: `no exe inside ${fresh}` };
  return { ok: true, folder: fresh, exe };
}

// Hands over: start the new one, quit this one. The old folder is left alone
// rather than deleted from under a process that is still running.
function handOver(exe) {
  execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command",
    `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -WorkingDirectory '${os.homedir()}'`],
    { windowsHide: true });
  setTimeout(() => app.quit(), 600);
  return { ok: true };
}

module.exports = { check, download, handOver, layout };
