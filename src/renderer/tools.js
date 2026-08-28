/* komorebi, whkd and YASB: what you have, and getting what you do not.

   Somebody who downloads this because they saw a screenshot may not know it
   drives three separate programs. Rather than a tab that silently does nothing,
   a tab whose program is missing is dimmed and says why, and offers to fetch it.

   Nothing installs or updates without being asked, and the latest versions are
   not even looked up until this screen is opened, so the app never reaches the
   network while it is just sitting there. */

let toolState = {};
let latest = null;

async function loadTools() {
  toolState = await window.wm.toolsInstalled();
  paintTabs();
  return toolState;
}

// A tab for a program that is not there stays reachable, because the reason it
// is empty is the useful part. It just does not pretend to be ready.
function paintTabs() {
  for (const [name, tool] of Object.entries(toolState)) {
    if (!tool.tab) continue;
    const tab = document.querySelector(`.tab[data-view="${tool.tab}"]`);
    if (!tab) continue;
    tab.classList.toggle("missing", !tool.installed);
    tab.title = tool.installed ? "" : `${tool.label} is not installed. ${tool.what}`;
  }
}

document.querySelector("nav").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab.missing");
  if (!tab) return;
  const name = Object.keys(toolState).find((k) => toolState[k].tab === tab.dataset.view);
  if (name) showTools(name);
}, true);

/* ---------- the screen ---------- */

async function showTools(focus) {
  const modal = document.querySelector("#tools-modal");
  modal.hidden = false;
  await loadTools();
  renderTools(focus);

  // Only now, and only because you asked to see it.
  const box = document.querySelector("#tools-list");
  const note = document.querySelector("#tools-note");
  note.textContent = "Checking what the latest versions are...";
  latest = await window.wm.toolsLatest();
  note.textContent = latest.winget
    ? `Versions come from winget ${latest.version}. Nothing is installed or updated unless you ask.`
    : "winget was not found, so this can only report what you already have. "
      + "Each project's own page has downloads.";
  renderTools(focus);
}

function renderTools(focus) {
  const box = document.querySelector("#tools-list");
  box.innerHTML = "";

  for (const [name, tool] of Object.entries(toolState)) {
    const row = document.createElement("div");
    row.className = "tool" + (tool.installed ? "" : " gone") + (name === focus ? " focus" : "");

    const have = tool.version;
    const channels = latest?.versions?.[name] || {};
    const newest = channels.stable;
    const behind = have && newest && olderThan(have, newest);

    row.innerHTML = `<i></i>`
      + `<span class="tool-name">${tool.label}<em>${tool.what}</em></span>`
      + `<span class="tool-ver">${versionLine(tool, have, channels, behind)}</span>`;

    const acts = document.createElement("div");
    acts.className = "tool-acts";

    if (!tool.installed) {
      // channels arrives as a list of names, so Object.keys gave "0" and the
      // button read "Install 0".
      tool.channels.forEach((channel) => {
        if (!latest?.winget) return;
        acts.appendChild(toolButton(
          channel === "stable" ? "Install" : `Install ${channel}`,
          channel === "stable" ? "accent" : "ghost",
          () => runInstall(name, channel, false)));
      });
    } else if (behind && latest?.winget) {
      acts.appendChild(toolButton(`Update to ${newest}`, "accent",
        () => runInstall(name, "stable", true)));
    }

    // A nightly is a choice, not an upgrade, so it is offered rather than pushed.
    if (tool.installed && latest?.winget && channels.nightly) {
      acts.appendChild(toolButton("Switch to nightly", "ghost",
        () => runInstall(name, "nightly", true)));
    }

    const site = document.createElement("button");
    site.className = "ghost small";
    site.textContent = "Project page";
    site.addEventListener("click", () => window.wm.open(tool.site));
    acts.appendChild(site);

    row.appendChild(acts);
    box.appendChild(row);
  }
}

const olderThan = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  return false;
};

function versionLine(tool, have, channels, behind) {
  if (!tool.installed) {
    const s = channels.stable ? `latest ${channels.stable}` : "not installed";
    return `<b>not installed</b>${channels.stable ? `<em>${s}</em>` : ""}`;
  }
  if (!latest) return `<b>${have || "installed"}</b>`;
  if (behind) return `<b>${have}</b><em>${channels.stable} is out</em>`;
  return `<b>${have}</b><em>up to date</em>`;
}

function toolButton(label, kind, run) {
  const b = document.createElement("button");
  b.className = kind === "accent" ? "accent" : "ghost";
  b.textContent = label;
  b.addEventListener("click", async () => {
    const was = b.textContent;
    b.disabled = true;
    b.textContent = "Working...";
    await run();
    b.textContent = was;
    b.disabled = false;
  });
  return b;
}

async function runInstall(name, channel, upgrade) {
  const tool = toolState[name];
  const what = channel === "stable" ? tool.label : `${tool.label} ${channel}`;
  const go = await window.wm.confirm(
    `${upgrade ? "Update" : "Install"} ${what}?`,
    "winget does the work and Windows will ask you to allow it. "
      + (name === "yasb" ? "" : `${tool.label} is stopped first, since an installer cannot `
        + "replace a file that is running, and started again afterwards."));
  if (!go) return;

  const note = document.querySelector("#tools-note");
  note.textContent = `${upgrade ? "Updating" : "Installing"} ${what}. This can take a minute.`;
  const r = await window.wm.toolsInstall(name, channel, upgrade);
  note.textContent = r.ok
    ? `${what} is now ${r.version || "installed"}.`
    : `That did not work: ${r.output || "winget said nothing useful"}`;

  await loadTools();
  latest = await window.wm.toolsLatest();
  renderTools();
  if (typeof checkSetup === "function") checkSetup();
}

document.querySelector("#tools-close").addEventListener("click", () => {
  document.querySelector("#tools-modal").hidden = true;
});
