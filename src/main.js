const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const net = require("node:net");
const YAML = require("yaml");
const P = require("./paths");
const KOMOREBIC_COMMANDS = require("./komorebic-commands");

// Read through a getter rather than copied once, so pointing the app at a
// different komorebi.json from Settings takes effect without a restart.
const FILES = {
  komorebi: { get path() { return P.komorebiConfig; }, format: "json", empty: "{}" },
  whkd: { get path() { return P.whkdrc; }, format: "text", empty: "" },
  yasbConfig: { get path() { return P.yasbConfig; }, format: "yaml", empty: "" },
  yasbStyles: { get path() { return P.yasbStyles; }, format: "text", empty: "" },
  appRules: { get path() { return P.appRules; }, format: "json", empty: "{}" },
};

const STORE = path.join(require("node:os").homedir(), ".config", "komorebi-deck");
const SNAPSHOT_DIR = path.join(STORE, "snapshots");
const PROFILE_DIR = path.join(STORE, "profiles");
const BACKUP_DIR = path.join(STORE, "backups");
const ACTIVE_FILE = path.join(PROFILE_DIR, "active.json");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0e1117",
    title: "Komorebi Deck",
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    autoHideMenuBar: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("closed", () => { win = null; });
}

// Windows groups taskbar buttons by this and takes the icon from whatever it
// resolves to. Without it a dev run is just another electron.exe.
app.setAppUserModelId("dev.komorebideck.app");

app.whenReady().then(() => {
  createWindow();
  // Compiling the C# inside mover.ps1 takes about two seconds. Doing it now
  // means the first window someone drags moves straight away.
  moverProcess();
});

/* ---------- reading ---------- */

// Someone opening this the day they install komorebi has no config yet. That is
// a thing to tell them about on the setup screen, not a parse error in the
// message bar, so a missing file comes back empty and flagged.
ipcMain.handle("config:read", async (_e, kind) => {
  const entry = FILES[kind];
  if (!entry) throw new Error(`unknown config: ${kind}`);
  try {
    const text = await fs.readFile(entry.path, "utf8");
    return { text, path: entry.path, format: entry.format };
  } catch {
    return { text: entry.empty, path: entry.path, format: entry.format, missing: true };
  }
});

/* ---------- the tools this app drives ---------- */

/* Installing and updating go through winget, because it is the one package
   manager already on a current Windows and it knows all three. Versions are
   read from the tools themselves rather than from winget, so a scoop or manual
   install reports honestly instead of looking absent.

   Nothing is ever installed or updated without being asked for. The latest
   versions are not even looked up until the Tools screen is opened, so an app
   sitting in the background never reaches the network on its own. */
const TOOLS = {
  komorebi: {
    label: "komorebi",
    what: "The window manager itself. Nothing else here does anything without it.",
    exe: () => P.komorebicExe,
    site: "https://github.com/LGUG2Z/komorebi",
    channels: { stable: "LGUG2Z.komorebi", nightly: "LGUG2Z.komorebi.Nightly" },
  },
  whkd: {
    label: "whkd",
    what: "Runs your keyboard shortcuts. Only the Shortcuts tab needs it.",
    exe: () => P.whkdExe,
    tab: "shortcuts",
    site: "https://github.com/LGUG2Z/whkd",
    channels: { stable: "LGUG2Z.whkd" },
  },
  yasb: {
    label: "YASB",
    what: "The status bar. Only the Status bar tab needs it.",
    exe: () => P.yasbcExe,
    tab: "bar",
    site: "https://github.com/amnweb/yasb",
    channels: { stable: "AmN.yasb" },
  },
};

// Each of the three prints its version differently: "komorebic 0.1.42",
// "whkd 0.2.10", "YASB Reborn v2.0.6 x64 (stable)". The number is the only part
// worth keeping.
const versionIn = (text) => (String(text).match(/(\d+\.\d+(?:\.\d+)?)/) || [])[1] || null;

const compareVersions = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
};

// Local and quick: no network, so it can run whenever.
ipcMain.handle("tools:installed", async () => {
  const out = {};
  for (const [name, tool] of Object.entries(TOOLS)) {
    const exe = tool.exe();
    const r = exe ? await run(exe, ["--version"]) : null;
    out[name] = {
      label: tool.label,
      what: tool.what,
      tab: tool.tab || null,
      site: tool.site,
      channels: Object.keys(tool.channels),
      path: exe,
      installed: !!exe,
      version: r ? versionIn(r.stdout || r.stderr) : null,
    };
  }
  return out;
});

const wingetArgs = (verb, id) => [
  verb, "--id", id, "--exact", "--source", "winget", "--silent",
  "--accept-package-agreements", "--accept-source-agreements",
];

// Only when the Tools screen is open, never on its own.
ipcMain.handle("tools:latest", async () => {
  const winget = await run("winget", ["--version"]);
  if (!winget.ok) return { winget: false, versions: {} };

  const versions = {};
  for (const [name, tool] of Object.entries(TOOLS)) {
    versions[name] = {};
    for (const [channel, id] of Object.entries(tool.channels)) {
      const r = await run("winget", ["show", "--id", id, "--exact", "--source", "winget"]);
      const line = String(r.stdout).split(/\r?\n/).find((l) => /^Version:/i.test(l));
      versions[name][channel] = line ? versionIn(line) : null;
    }
  }
  return { winget: true, version: versionIn(winget.stdout), versions };
});

ipcMain.handle("tools:install", async (_e, name, channel, upgrade) => {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`unknown tool: ${name}`);
  const id = tool.channels[channel] || tool.channels.stable;

  // An msi cannot replace a file that is running, so komorebi and whkd are
  // stopped first and put back afterwards if they were up.
  const wasRunning = name === "yasb" ? false : await isRunning(`${name}.exe`);
  if (wasRunning) await run(P.komorebicExe, name === "komorebi" ? ["stop"] : []);
  if (wasRunning) await run("taskkill", ["/F", "/IM", `${name}.exe`]);

  const r = await run("winget", wingetArgs(upgrade ? "upgrade" : "install", id),
    { maxBuffer: 8 * 1024 * 1024 });
  P.rediscover();

  if (wasRunning && name === "komorebi") await restartKomorebi();
  else if (wasRunning) launch(TOOLS[name].exe());

  const exe = tool.exe();
  const after = exe ? versionIn((await run(exe, ["--version"])).stdout) : null;
  return { ok: !!exe, version: after, output: firstLine(r.stdout || r.stderr) };
});

ipcMain.handle("setup:check", () => P.report());

ipcMain.handle("setup:locate", async (_e, key) => {
  const r = await dialog.showOpenDialog(win, {
    title: `Where is ${key.replace(/Exe$/, "")}?`,
    properties: ["openFile"],
    filters: key.endsWith("Exe")
      ? [{ name: "Programs", extensions: ["exe"] }]
      : [{ name: "Config files", extensions: ["json", "yaml", "yml", "css", "*"] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return P.setOverride(key, r.filePaths[0]);
});

/* ---------- validation ---------- */

function validate(format, text) {
  if (format === "json") {
    try {
      JSON.parse(text);
    } catch (err) {
      return `Invalid JSON: ${err.message}`;
    }
  }
  if (format === "yaml") {
    try {
      YAML.parse(text);
    } catch (err) {
      return `Invalid YAML: ${err.message}`;
    }
  }
  return null;
}

ipcMain.handle("config:validate", async (_e, kind, text) => {
  const entry = FILES[kind];
  if (!entry) throw new Error(`unknown config: ${kind}`);
  const error = validate(entry.format, text);
  if (!error) return null;
  let baseline = null;
  try {
    baseline = validate(entry.format, await fs.readFile(entry.path, "utf8"));
  } catch {}
  // Do not report a fault the file already had before this edit.
  return baseline ? null : error;
});

/* ---------- writing ---------- */

// A bad write here takes down the window manager, so never write without a
// parseable file and a timestamped copy of what was there before.
// Some working config files do not satisfy a strict parser. YASB's own config,
// for instance, closes a flow sequence on the next line, which the yaml package
// rejects and PyYAML, the one YASB actually reads it with, accepts. Refusing
// that outright would make the file impossible to write and its snapshots
// impossible to restore, so a write is judged against the file it replaces and
// refused only when it is worse than what is already there.
const yamlFaults = (text) => YAML.parseDocument(text).errors.length;

async function blockingError(entry, text) {
  const error = validate(entry.format, text);
  if (!error) return null;

  let current;
  try {
    current = await fs.readFile(entry.path, "utf8");
  } catch {
    return error; // nothing to compare against, so hold the line
  }
  if (!validate(entry.format, current)) return error; // the file was fine, this breaks it
  if (entry.format === "yaml" && yamlFaults(text) > yamlFaults(current)) return error;
  return null;
}

const KEEP_BACKUPS = 10;

// Backups go in the app's own folder, next to snapshots and profiles, rather
// than beside the file they came from. A .bak per save used to pile up in the
// middle of a home directory with nothing ever clearing it out.
const OURS = /\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

const backupFor = (file, stamp) =>
  path.join(BACKUP_DIR, `${path.basename(file)}.bak-${stamp}`);

async function keepBackup(file, text) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const at = backupFor(file, stamp);
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  await fs.writeFile(at, text, "utf8");

  const prefix = `${path.basename(file)}.bak-`;
  const older = (await fs.readdir(BACKUP_DIR))
    .filter((n) => n.startsWith(prefix) && OURS.test(n))
    .sort() // the stamp sorts oldest first on its own
    .slice(0, -KEEP_BACKUPS);
  for (const n of older) await fs.rm(path.join(BACKUP_DIR, n), { force: true });

  return at;
}

ipcMain.handle("config:write", async (_e, kind, text) => {
  const entry = FILES[kind];
  if (!entry) throw new Error(`unknown config: ${kind}`);

  const error = await blockingError(entry, text);
  if (error) return { ok: false, error };

  let backup = null;
  try {
    const current = await fs.readFile(entry.path, "utf8");
    if (current !== text) backup = await keepBackup(entry.path, current);
  } catch {
    // no existing file to back up
  }

  await fs.writeFile(entry.path, text, "utf8");
  return { ok: true, backup };
});

/* ---------- process status and control ---------- */

const PROCESSES = {
  komorebi: { exe: () => P.komorebiExe, image: "komorebi.exe" },
  whkd: { exe: () => P.whkdExe, image: "whkd.exe" },
  yasb: { exe: () => P.yasbExe, image: "yasb.exe" },
};

// A packaged build keeps the app inside app.asar, which PowerShell cannot read
// from because it is an archive rather than a folder. The .ps1 files are
// unpacked beside it, so the path has to point at the unpacked copy. In
// development there is no archive and this changes nothing.
const scriptPath = (name) => path.join(__dirname, name)
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    // A tool that was never found has a null path, and execFile throws on that
    // rather than reporting it, which would take the whole handler down.
    if (!file) return resolve({ ok: false, stdout: "", stderr: "not installed, or not found" });
    execFile(file, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || "", stderr: stderr || String(err || "") });
    });
  });
}

async function isRunning(image) {
  const r = await run("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH"]);
  return r.stdout.toLowerCase().includes(image.toLowerCase());
}

ipcMain.handle("status:get", async () => {
  const out = {};
  for (const [name, meta] of Object.entries(PROCESSES)) out[name] = await isRunning(meta.image);
  return out;
});

// Started through Start-Process rather than spawned straight, because a console
// program given no console at all makes Windows open a fresh window for every
// console program it runs afterwards. whkd runs komorebic on each shortcut, so
// spawning it with windowsHide put a console on screen at every keypress. A
// hidden console is what komorebic start gives komorebi, and what komorebic
// start --whkd gives whkd, so this matches both.
//
// Not detached: with detached set, powershell exits 0 and Start-Process quietly
// starts nothing. Nothing is lost by dropping it, because Start-Process makes
// the program a child of powershell rather than of this app, so it already
// outlives the editor.
// Started from the home directory, not from wherever this app happens to live.
// Without that, whkd inherits the app's working directory and holds the app's
// own folder open for as long as it runs, so the previous version cannot be
// deleted after an update until whkd is stopped.
function launch(exe) {
  const home = require("node:os").homedir();
  const cmd = `Start-Process -FilePath '${exe.replace(/'/g, "''")}'`
    + ` -WorkingDirectory '${home.replace(/'/g, "''")}' -WindowStyle Hidden`;
  spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd],
    { stdio: "ignore", windowsHide: true });
}

async function restartService(name) {
  const meta = PROCESSES[name];
  if (!meta) throw new Error(`unknown service: ${name}`);
  const exe = meta.exe();
  if (!exe) return { ok: false, detail: `is not installed, or I could not find it` };

  if (name === "yasb") {
    // yasbc reloads in place without dropping the komorebi subscription
    const r = await run(P.yasbcExe, ["reload"]);
    return { ok: r.ok, detail: r.ok ? "reloaded" : r.stderr };
  }

  if (name === "komorebi") return restartKomorebi();

  await run("taskkill", ["/F", "/IM", meta.image]);
  await new Promise((r) => setTimeout(r, 2500));
  launch(exe);
  await new Promise((r) => setTimeout(r, 3500));

  const running = await isRunning(meta.image);
  return { ok: running, detail: running ? "restarted" : "did not come back" };
}

const firstLine = (text) =>
  String(text || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";

// komorebi has its own stop and start, and both do more than handling the
// process would. Stop puts back every window komorebi had hidden on other
// workspaces, which killing it does not: those stay cloaked and look lost.
// Start hides the console window that komorebi.exe is otherwise given, since it
// is a console program, and waits until it is actually up before returning.
async function restartKomorebi() {
  await run(P.komorebicExe, ["stop"]);

  // Putting every hidden window back takes komorebi a moment, so it is waited
  // for rather than cut off. A fixed delay short enough to feel responsive was
  // also short enough to kill it halfway through restoring them.
  for (let i = 0; i < 10 && (await isRunning("komorebi.exe")); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }

  // Stop asks komorebi over its socket, so one that has stopped listening never
  // hears it and has to be handled the blunt way.
  if (await isRunning("komorebi.exe")) {
    await run("taskkill", ["/F", "/IM", "komorebi.exe"]);
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Named explicitly, so komorebi reads the same file this app is editing even
  // when that has been pointed somewhere else.
  const r = await run(P.komorebicExe, ["start", "-c", P.komorebiConfig]);
  const running = await isRunning("komorebi.exe");
  if (running) await resubscribe();
  return {
    ok: running,
    detail: running
      ? "restarted"
      : firstLine(r.stderr || r.stdout) || "did not come back",
  };
}

// komorebi holds its subscribers in memory, so restarting it drops every one of
// them. Nobody is told; the events simply stop, which is why the bar and the
// live map look frozen afterwards. Both are signed up again here.
async function resubscribe() {
  if (pipeServer) await run(P.komorebicExe, ["subscribe-pipe", PIPE_NAME]);
  await run(P.yasbcExe, ["reload"]);
}

ipcMain.handle("service:restart", (_e, name) => restartService(name));

ipcMain.handle("komorebic:run", async (_e, args) => {
  const r = await run(P.komorebicExe, args);
  const failed = /os error|Error:/i.test(r.stderr) || /os error|Error:/i.test(r.stdout);
  return { ok: r.ok && !failed, output: (r.stdout + r.stderr).trim() };
});

// If a config change stops komorebi booting, the only thing that helps is
// getting the previous file back quickly.
ipcMain.handle("config:restore", async (_e, kind, backupPath) => {
  const entry = FILES[kind];
  if (!entry) throw new Error(`unknown config: ${kind}`);
  const text = await fs.readFile(backupPath, "utf8");
  await fs.writeFile(entry.path, text, "utf8");
  return { ok: true };
});

/* ---------- snapshots ---------- */

ipcMain.handle("snapshot:list", () => listBundles(SNAPSHOT_DIR));

// Snapshots and profiles keep the same thing on disk, a copy of every config
// file, and differ only in what you do with it: a snapshot is a point to go
// back to, a profile is a setup you switch between and apply.
async function saveBundle(root, name, fallback) {
  const safe = name.replace(/[^\w. -]/g, "_").trim() || fallback;
  const dir = path.join(root, safe);
  await fs.mkdir(dir, { recursive: true });
  const saved = [];
  for (const [kind, entry] of Object.entries(FILES)) {
    try {
      const text = await fs.readFile(entry.path, "utf8");
      await fs.writeFile(path.join(dir, `${kind}.snapshot`), text, "utf8");
      saved.push(kind);
    } catch {
      // file may not exist; skip it rather than fail the whole bundle
    }
  }
  return { ok: true, name: safe, saved };
}

async function restoreBundle(root, name) {
  const dir = path.join(root, name);
  const restored = [];
  for (const [kind, entry] of Object.entries(FILES)) {
    const src = path.join(dir, `${kind}.snapshot`);
    let text;
    try {
      text = await fs.readFile(src, "utf8");
    } catch {
      continue; // bundle did not include this file
    }
    // Judged the same way a normal save is. Without this the app captures a
    // file a strict parser dislikes and then refuses to give it back, which
    // makes a snapshot of a working setup impossible to restore.
    const err = await blockingError(entry, text);
    if (err) return { ok: false, error: `${kind}: ${err}` };
    try {
      const cur = await fs.readFile(entry.path, "utf8");
      // Only when it differs, same as a save. Restoring a setup you are already
      // on used to leave a backup identical to the file it backed up.
      if (cur !== text) await keepBackup(entry.path, cur);
    } catch {}
    await fs.writeFile(entry.path, text, "utf8");
    restored.push(kind);
  }
  return { ok: true, restored };
}

async function listBundles(root) {
  try {
    const names = await fs.readdir(root);
    const out = [];
    for (const n of names) {
      const st = await fs.stat(path.join(root, n));
      if (st.isDirectory()) out.push({ name: n, saved: st.mtime.toISOString() });
    }
    return out.sort((a, b) => b.saved.localeCompare(a.saved));
  } catch {
    return [];
  }
}

ipcMain.handle("snapshot:save", (_e, name) => saveBundle(SNAPSHOT_DIR, name, "snapshot"));

ipcMain.handle("snapshot:restore", (_e, name) => restoreBundle(SNAPSHOT_DIR, name));

ipcMain.handle("snapshot:delete", async (_e, name) => {
  await fs.rm(path.join(SNAPSHOT_DIR, name), { recursive: true, force: true });
  return { ok: true };
});

/* ---------- profiles ---------- */

// A profile is a whole setup you switch between on purpose, so applying one
// means putting the files back AND restarting what reads them.
async function activeProfile() {
  try {
    return JSON.parse(await fs.readFile(ACTIVE_FILE, "utf8")).name;
  } catch {
    return null;
  }
}

ipcMain.handle("profile:list", async () => ({
  profiles: await listBundles(PROFILE_DIR),
  active: await activeProfile(),
}));

ipcMain.handle("profile:save", async (_e, name) => {
  const r = await saveBundle(PROFILE_DIR, name, "profile");
  await fs.writeFile(ACTIVE_FILE, JSON.stringify({ name: r.name }), "utf8");
  return r;
});

ipcMain.handle("profile:delete", async (_e, name) => {
  await fs.rm(path.join(PROFILE_DIR, name), { recursive: true, force: true });
  if ((await activeProfile()) === name) {
    await fs.rm(ACTIVE_FILE, { force: true });
  }
  return { ok: true };
});

ipcMain.handle("profile:apply", async (_e, name) => {
  const r = await restoreBundle(PROFILE_DIR, name);
  if (!r.ok) return r;
  await fs.writeFile(ACTIVE_FILE, JSON.stringify({ name }), "utf8");

  const services = [];
  for (const svc of ["komorebi", "whkd", "yasb"]) {
    const s = await restartService(svc);
    services.push({ name: svc, ...s });
  }
  return { ok: true, restored: r.restored, services };
});

/* ---------- health ---------- */

ipcMain.handle("health:check", async () => {
  const checks = [];
  const os = require("node:os");

  for (const [name, meta] of Object.entries(PROCESSES)) {
    const r = await run("tasklist", ["/FI", `IMAGENAME eq ${meta.image}`, "/NH"]);
    const up = r.stdout.toLowerCase().includes(meta.image.toLowerCase());
    checks.push({ id: name, label: `${name} running`, ok: up, detail: up ? "" : "not running" });
  }

  // Sending a command and reading state back use different paths and fail
  // independently, so testing only one gives a misleading answer.
  const kc = await run(P.komorebicExe, ["state"]);
  const readOk = !/os error|panicked/i.test(kc.stdout + kc.stderr);
  checks.push({
    id: "ipc-read",
    label: "komorebic can read state",
    ok: readOk,
    detail: readOk ? "" : "live apply and state queries unavailable",
  });

  // Re-sending the width it already has is a harmless way to prove the
  // command path without changing anything.
  let width = null;
  try {
    width = JSON.parse(await fs.readFile(P.komorebiConfig, "utf8")).border_width;
  } catch {}
  if (width != null) {
    const kw = await run(P.komorebicExe, ["border-width", String(width)]);
    const writeOk = !/os error|panicked|Error:/i.test(kw.stdout + kw.stderr);
    checks.push({
      id: "ipc-write",
      label: "komorebic can send commands",
      ok: writeOk,
      detail: writeOk ? "" : "keybindings will not work",
    });
  }

  const sockDir = path.join(os.homedir(), "AppData", "Local", "komorebi");
  try {
    const files = await fs.readdir(sockDir);
    const strays = files.filter((f) => f.endsWith(".sock") && f.startsWith("probe-"));
    checks.push({
      id: "sockets",
      label: "no orphaned probe sockets",
      ok: strays.length === 0,
      detail: strays.length ? `${strays.length} left behind` : "",
    });
  } catch {
    checks.push({ id: "sockets", label: "socket directory readable", ok: false, detail: "cannot read" });
  }

  try {
    const yl = path.join(os.homedir(), ".config", "yasb", "yasb.log");
    const text = await fs.readFile(yl, "utf8");
    const tail = text.slice(-20000);
    const quota = /maximum calls per month/i.test(tail);
    checks.push({ id: "weather", label: "weather API within quota", ok: !quota, detail: quota ? "monthly limit reached" : "" });

    // A failure only matters if nothing succeeded after it, otherwise a
    // reconnect during a komorebi restart reads as a permanent fault.
    const lastFail = tail.lastIndexOf("failed to subscribe named pipe");
    const lastOk = tail.lastIndexOf("connected to named pipe");
    const pipeBroken = lastFail !== -1 && lastFail > lastOk;
    checks.push({
      id: "pipe",
      label: "bar subscribed to komorebi",
      ok: !pipeBroken,
      detail: pipeBroken ? "subscription failing, workspace widget will not update" : "",
    });
  } catch {
    checks.push({ id: "yasblog", label: "yasb log readable", ok: false, detail: "not found" });
  }

  return checks;
});

/* ---------- introspection for the editors ---------- */

/* ---------- live events ---------- */

// komorebi pushes a JSON line down a named pipe every time something changes,
// which is how the bar stays in sync. Anything arriving is treated as "state
// moved", so this does not depend on the event payload shape.
const PIPE_NAME = "komorebi-deck-events";
let pipeServer = null;

function startEvents() {
  if (pipeServer) return { ok: true, already: true };
  pipeServer = net.createServer((socket) => {
    // komorebi keeps sending after the window goes away, and a closed
    // BrowserWindow is still an object, so `win?.` is not enough on its own.
    socket.on("data", () => {
      if (win && !win.isDestroyed()) win.webContents.send("komorebi:event");
    });
    socket.on("error", () => {});
  });
  pipeServer.on("error", () => { pipeServer = null; });
  return new Promise((resolve) => {
    pipeServer.listen(path.join("\\\\.\\pipe", PIPE_NAME), async () => {
      const r = await run(P.komorebicExe, ["subscribe-pipe", PIPE_NAME]);
      const err = (r.stderr || r.stdout || "").split(/\r?\n/)[0];
      resolve({ ok: r.ok, error: r.ok ? null : err });
    });
  });
}

ipcMain.handle("events:start", () => startEvents());

async function stopEvents() {
  if (!pipeServer) return;
  const server = pipeServer;
  pipeServer = null;
  server.close();
  await run(P.komorebicExe, ["unsubscribe-pipe", PIPE_NAME]);
}

// Stop the subscription as the window goes, not at quit, so komorebi is not
// still writing to a pipe nobody is reading.
app.on("window-all-closed", async () => {
  await stopEvents();
  app.quit();
});
app.on("before-quit", async () => {
  if (mover) mover.kill();
  await stopEvents();
});

// komorebic prints UTF-8, but a console redirect can hand back UTF-16, so the
// BOM decides rather than assuming.
// Floating windows are moved directly, because komorebi has no command that
// puts a window at a position.
// Retiling or monocling something else raises that window over this one. Being
// always on top is a property of this window, so komorebi cannot take it away.
ipcMain.handle("window:onTop", (_e, on) => {
  if (!win || win.isDestroyed()) return false;
  win.setAlwaysOnTop(!!on, "floating");
  return win.isAlwaysOnTop();
});

// A drag sends a move every frame, and starting powershell takes long enough
// that one process per move would make it stutter. One stays open instead and
// answers a line per command, so the replies can be handed back in order.
let mover = null;
const moverWaiting = [];

function moverProcess() {
  if (mover) return mover;
  mover = spawn("powershell", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", scriptPath("mover.ps1"),
  ], { windowsHide: true });

  let buffer = "";
  mover.stdout.on("data", (chunk) => {
    buffer += chunk;
    let cut;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      const done = moverWaiting.shift();
      if (done) done({ ok: line === "ok", output: line });
    }
  });

  const stopped = () => {
    mover = null;
    while (moverWaiting.length) moverWaiting.shift()({ ok: false, output: "the mover stopped" });
  };
  mover.on("exit", stopped);
  mover.on("error", stopped);
  return mover;
}

ipcMain.handle("window:move", (_e, hwnd, rect) => {
  const ps = moverProcess();
  return new Promise((resolve) => {
    moverWaiting.push(resolve);
    ps.stdin.write(`${hwnd} ${rect.x} ${rect.y} ${rect.w} ${rect.h}\n`);
  });
});

// komorebic prints UTF-8, but a console redirect can hand back UTF-16, so the
// byte order mark decides rather than assuming one of them.
function decode(stdout) {
  const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout));
  if (!buf.length) return "";
  const utf16 = buf[0] === 0xff && buf[1] === 0xfe;
  return utf16 ? buf.toString("utf16le").slice(1) : buf.toString("utf8").replace(/^﻿/, "");
}

ipcMain.handle("komorebi:state", async () => {
  const r = await run(P.komorebicExe, ["state"], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
  const text = decode(r.stdout);
  if (!text) return { ok: false, error: String(r.stderr || "no output from komorebic") };
  try {
    return { ok: true, state: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: `could not read komorebic state: ${e.message}` };
  }
});

ipcMain.handle("komorebic:commands", () => KOMOREBIC_COMMANDS);

// enums.js is generated from one version of komorebi and shipped with the app,
// which is wrong for anybody running a different one: they get options komorebi
// rejects, or miss options it has gained. The installed komorebi describes
// itself, so it is asked, and the shipped lists are only the fallback.
const SCHEMA_ENUMS = {
  LAYOUTS: "DefaultLayout",
  PLACEMENTS: "Placement",
  ASPECT_RATIOS: "PredefinedAspectRatio",
  BORDER_STYLES: "BorderStyle",
  BORDER_IMPLEMENTATIONS: "BorderImplementation",
  STACKBAR_MODES: "StackbarMode",
  STACKBAR_LABELS: "StackbarLabel",
  HIDING: "HidingBehaviour",
  MONOCLE_FOCUS: "MonocleFocusBehaviour",
  AXES: "Axis",
  EASING: "AnimationStyle",
  IDENTIFIERS: "ApplicationIdentifier",
  MATCH_STRATEGIES: "MatchingStrategy",
};

let schemaCache = null;

ipcMain.handle("komorebic:schema", async () => {
  if (schemaCache) return schemaCache;
  const r = await run(P.komorebicExe, ["static-config-schema"],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  const text = decode(r.stdout);
  if (!text) return null;

  try {
    const schema = JSON.parse(text);
    const defs = schema.definitions || schema.$defs || {};
    const out = { version: (schema.description || "").match(/v[\d.]+/)?.[0] || null };

    // Every key in komorebi.json is optional, and an absent one means komorebi
    // uses its own value. It states most of those, so the app can show what is
    // really in effect instead of an empty box.
    out.defaults = {};
    for (const [key, prop] of Object.entries(schema.properties || {})) {
      if (prop && "default" in prop && prop.default !== null) out.defaults[key] = prop.default;
    }
    // Filtered rather than rejected wholesale: AnimationStyle lists 31 named
    // easings and then CubicBezier, which takes four numbers instead of being a
    // name, and demanding every entry be a string threw the other 31 away.
    for (const [name, definition] of Object.entries(SCHEMA_ENUMS)) {
      const d = defs[definition];
      const values = (d?.enum || (Array.isArray(d?.oneOf) ? d.oneOf.map((o) => o.const) : []))
        .filter((v) => typeof v === "string");
      if (values.length) out[name] = values;
    }
    schemaCache = out;
    return out;
  } catch {
    return null;
  }
});

// Visible top-level windows, so app rules can be built from something real
// instead of guessing executable names.
ipcMain.handle("windows:list", async () => {
  const r = await run("powershell", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", scriptPath("list-windows.ps1"),
  ]);
  try {
    const parsed = JSON.parse(r.stdout.trim() || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
});

// Rules are often written for something that is not running, so the Start Menu
// is walked for what is installed. It takes a few seconds, so the renderer asks
// once and keeps the answer.
ipcMain.handle("apps:list", async () => {
  const r = await run("powershell", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", scriptPath("list-apps.ps1"),
  ], { maxBuffer: 4 * 1024 * 1024 });
  try {
    const parsed = JSON.parse(r.stdout.trim() || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
});

// A plain line diff is enough to see what a save is about to do.
ipcMain.handle("config:diff", async (_e, kind, next) => {
  const entry = FILES[kind];
  if (!entry) throw new Error(`unknown config: ${kind}`);
  let current = "";
  try {
    current = await fs.readFile(entry.path, "utf8");
  } catch {}
  const a = current.split("\n");
  const b = next.split("\n");
  const out = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push({ sign: "-", line: a[i], n: i + 1 });
    if (b[i] !== undefined) out.push({ sign: "+", line: b[i], n: i + 1 });
  }
  return out;
});

// Only the project pages these tools live at, never an arbitrary string from
// the page.
const TOOL_SITES = new Set(Object.values(TOOLS).map((t) => t.site));
ipcMain.handle("link:open", (_e, url) => {
  if (TOOL_SITES.has(url)) shell.openExternal(url);
});

ipcMain.handle("file:reveal", (_e, kind) => {
  const entry = FILES[kind];
  if (entry) shell.showItemInFolder(entry.path);
});

// The Desktop key holds Windows' re-encoded copy, which gets overwritten. The
// wallpaper history holds the file you actually picked.
ipcMain.handle("wallpaper:current", async () => {
  const r = await run("powershell", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", scriptPath("current-wallpaper.ps1"),
  ]);
  return r.stdout.trim() || null;
});

ipcMain.handle("dialog:pickImage", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Choose a wallpaper",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "bmp", "webp"] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

// Synchronous so the preload can expose it as a value rather than a promise:
// it is fixed for the life of the process and Settings wants it while rendering.
ipcMain.on("app:version", (e) => { e.returnValue = app.getVersion(); });

ipcMain.handle("dialog:confirm", async (_e, message, detail) => {
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Cancel", "Continue"],
    defaultId: 0,
    cancelId: 0,
    message,
    detail,
  });
  return response === 1;
});
