/* What this machine has, and what to do when it does not have it.

   komorebi installs to Program Files from the msi and under the user's profile
   from scoop, and each tool reads its config path out of the environment, so
   none of it is in a fixed place. paths.js works it out; this reports what it
   found and lets anything it missed be pointed at by hand. */

const SETUP_LABELS = {
  komorebicExe: ["komorebic", "The command line tool. Nothing here works without it."],
  komorebiExe: ["komorebi", "The window manager itself, needed to start and restart it."],
  whkdExe: ["whkd", "Runs your shortcuts. Only the Shortcuts tab needs it."],
  yasbExe: ["yasb", "The status bar. Only the Status bar tab needs it."],
  yasbcExe: ["yasbc", "Reloads the bar after a change."],
  komorebiConfig: ["komorebi.json", "Your window manager settings."],
  whkdrc: ["whkdrc", "Your shortcuts."],
  yasbConfig: ["config.yaml", "Your status bar layout."],
  yasbStyles: ["styles.css", "How the status bar looks."],
  appRules: ["applications.json", "Community fixes for awkward applications."],
};

// komorebic is the only one the app genuinely cannot work without. Everything
// else disables a tab or two, which is worth saying but not worth blocking on.
const ESSENTIAL = ["komorebicExe"];

let setupReport = [];

async function checkSetup({ force = false } = {}) {
  setupReport = await window.wm.setupCheck();
  const missing = setupReport.filter((r) => !r.exists);
  const blocked = missing.some((r) => ESSENTIAL.includes(r.key));
  if (force || blocked || missing.some((r) => r.isExe)) showSetup();
  return { missing, blocked };
}

function showSetup() {
  const box = document.querySelector("#setup-list");
  const intro = document.querySelector("#setup-intro");
  if (!box) return;

  const missing = setupReport.filter((r) => !r.exists);
  intro.textContent = missing.length
    ? `I looked on your PATH, in scoop, in winget's links and in Program Files. `
      + `${missing.length} of ${setupReport.length} did not turn up. `
      + `Point me at anything you do have and I will remember it.`
    : "Everything is where I expected it. Nothing to do here.";

  box.innerHTML = "";
  setupReport.forEach((r) => {
    const [name, why] = SETUP_LABELS[r.key] || [r.key, ""];
    const row = document.createElement("div");
    row.className = "setup-row" + (r.exists ? " ok" : " gone");
    row.innerHTML = `<span class="setup-name">${name}<em>${why}</em></span>`
      + `<span class="setup-path">${r.path || "not found"}</span>`;

    const locate = document.createElement("button");
    locate.className = "ghost small";
    locate.textContent = r.exists ? "Change" : "Locate";
    locate.addEventListener("click", async () => {
      const chosen = await window.wm.setupLocate(r.key);
      if (!chosen) return;
      await checkSetup({ force: true });
      msg(`${name} is now ${chosen}`, "ok");
    });
    row.appendChild(locate);
    box.appendChild(row);
  });

  document.querySelector("#setup-modal").hidden = false;
}

document.querySelector("#setup-close").addEventListener("click", () => {
  document.querySelector("#setup-modal").hidden = true;
});

// Pointing at something you do not have is no use, so the way to get it sits
// next to the way to find it.
document.querySelector("#setup-get").addEventListener("click", () => {
  document.querySelector("#setup-modal").hidden = true;
  showTools();
});

/* ---------- what this komorebi actually accepts ---------- */

// The lists in enums.js came from one version of komorebi. Anybody on a
// different one gets choices it rejects, or misses choices it has gained, so
// the installed komorebi is asked to describe itself and the shipped lists are
// only used when it cannot be reached.
async function applySchema() {
  const live = await window.wm.schema();
  if (!live) return null;

  const changed = [];
  for (const [key, values] of Object.entries(live)) {
    if (key === "version" || !Array.isArray(values)) continue;
    const before = window.KENUM[key];
    if (before && before.join() !== values.join()) changed.push(key);
    window.KENUM[key] = values;
  }

  // What komorebi does when a key is absent, which is most keys on a config
  // nobody has edited yet.
  state.defaults = live.defaults || {};
  return { version: live.version, changed, defaults: Object.keys(state.defaults).length };
}
