/* Where everything lives on this machine.

   None of it can be assumed. komorebi ships as an msi that lands in Program
   Files and as a scoop package that lands under the user's profile, whkd and
   YASB the same, and all three read a config path out of the environment before
   falling back to a default. So each one is looked for rather than declared,
   and anything still not found can be pointed at by hand from Settings, which
   is what the overrides file holds. */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const home = os.homedir();
const STORE = path.join(home, ".config", "komorebi-deck");

// The app was called WM Control until it was renamed. Anything already saved
// under the old name is moved rather than abandoned, once, on first start.
const OLD_STORE = path.join(home, ".config", "wm-control");
try {
  if (fs.existsSync(OLD_STORE) && !fs.existsSync(STORE)) fs.renameSync(OLD_STORE, STORE);
} catch {}
const OVERRIDES = path.join(STORE, "paths.json");

const PF = process.env.ProgramFiles || "C:\\Program Files";
const LOCAL = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
const SCOOP = process.env.SCOOP || path.join(home, "scoop");

const exists = (p) => {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
};

const firstThatExists = (list) => list.find(exists) || null;

// A scoop install puts its shims on PATH, and so does the msi, so this finds
// most setups before any of the guesses below are needed.
function onPath(exe) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return firstThatExists(dirs.map((d) => path.join(d, exe)));
}

function findExe(exe, dirs) {
  return onPath(exe) || firstThatExists(dirs.map((d) => path.join(d, exe)));
}

const KOMOREBI_DIRS = [
  path.join(SCOOP, "apps", "komorebi", "current"),
  path.join(SCOOP, "shims"),
  path.join(PF, "komorebi", "bin"),
  path.join(LOCAL, "Microsoft", "WinGet", "Links"),
];

const WHKD_DIRS = [
  path.join(SCOOP, "apps", "whkd", "current"),
  path.join(SCOOP, "shims"),
  path.join(PF, "whkd", "bin"),
];

const YASB_DIRS = [
  path.join(PF, "YASB"),
  path.join(LOCAL, "Yasb"),
  path.join(SCOOP, "apps", "yasb", "current"),
  path.join(SCOOP, "shims"),
];

// Each tool reads its own variable before falling back, so the same one is
// honoured here rather than sending the app to a file the tool never opens.
const configHome = (variable, fallback) => {
  const set = process.env[variable];
  return set ? path.join(set, fallback) : null;
};

function discover() {
  return {
    komorebiConfig: configHome("KOMOREBI_CONFIG_HOME", "komorebi.json")
      || path.join(home, "komorebi.json"),
    whkdrc: configHome("WHKD_CONFIG_HOME", "whkdrc")
      || path.join(home, ".config", "whkdrc"),
    yasbConfig: configHome("YASB_CONFIG_HOME", "config.yaml")
      || path.join(home, ".config", "yasb", "config.yaml"),
    yasbStyles: configHome("YASB_CONFIG_HOME", "styles.css")
      || path.join(home, ".config", "yasb", "styles.css"),
    appRules: configHome("KOMOREBI_CONFIG_HOME", "applications.json")
      || path.join(home, "applications.json"),

    komorebiExe: findExe("komorebi.exe", KOMOREBI_DIRS),
    komorebicExe: findExe("komorebic.exe", KOMOREBI_DIRS),
    whkdExe: findExe("whkd.exe", WHKD_DIRS),
    yasbExe: findExe("yasb.exe", YASB_DIRS),
    yasbcExe: findExe("yasbc.exe", YASB_DIRS),
  };
}

function loadOverrides() {
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES, "utf8"));
  } catch {
    return {};
  }
}

const found = discover();
const paths = { ...found, ...loadOverrides() };

// What was worked out and what was chosen by hand, so the setup screen can say
// which is which instead of just listing paths.
paths.report = () =>
  Object.keys(found).map((key) => ({
    key,
    path: paths[key],
    exists: exists(paths[key]),
    overridden: paths[key] !== found[key],
    isExe: key.endsWith("Exe"),
  }));

paths.setOverride = (key, value) => {
  if (!(key in found)) throw new Error(`unknown path: ${key}`);
  const saved = loadOverrides();
  if (value) saved[key] = value;
  else delete saved[key];
  fs.mkdirSync(STORE, { recursive: true });
  fs.writeFileSync(OVERRIDES, JSON.stringify(saved, null, 2), "utf8");
  paths[key] = value || found[key];
  return paths[key];
};

module.exports = paths;
