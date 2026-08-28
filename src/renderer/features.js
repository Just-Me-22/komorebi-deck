/* Features layered on top of app.js. Everything here talks to the same
   window.wm bridge and the same `state` object. */

/* ---------- 3. visual layout picker ---------- */

// Rough cell maps so a layout name reads as a shape instead of a word.
const LAYOUT_SHAPES = {
  BSP: [[0, 0, 2, 2], [2, 0, 2, 1], [2, 1, 1, 1], [3, 1, 1, 1]],
  Columns: [[0, 0, 1, 2], [1, 0, 1, 2], [2, 0, 1, 2], [3, 0, 1, 2]],
  Rows: [[0, 0, 4, 1], [0, 1, 4, 1]],
  VerticalStack: [[0, 0, 2, 2], [2, 0, 2, 1], [2, 1, 2, 1]],
  HorizontalStack: [[0, 0, 4, 1], [0, 1, 2, 1], [2, 1, 2, 1]],
  UltrawideVerticalStack: [[0, 0, 1, 2], [1, 0, 2, 2], [3, 0, 1, 2]],
  Grid: [[0, 0, 2, 1], [2, 0, 2, 1], [0, 1, 2, 1], [2, 1, 2, 1]],
  RightMainVerticalStack: [[0, 0, 2, 1], [0, 1, 2, 1], [2, 0, 2, 2]],
};

function layoutThumb(name) {
  const cells = LAYOUT_SHAPES[name] || [];
  const svg = cells
    .map(([x, y, w, h]) =>
      `<rect x="${x * 11 + 1}" y="${y * 11 + 1}" width="${w * 11 - 2}" height="${h * 11 - 2}" rx="1.5"/>`)
    .join("");
  return `<svg viewBox="0 0 44 22" class="thumb" aria-hidden="true">${svg}</svg>`;
}

function layoutPicker(current, onPick) {
  const wrap = document.createElement("div");
  wrap.className = "layout-picker";
  Object.keys(LAYOUT_SHAPES).forEach((name) => {
    const b = document.createElement("button");
    b.className = "layout-opt" + (name === current ? " active" : "");
    b.innerHTML = layoutThumb(name) + `<span>${name}</span>`;
    b.title = name;
    b.addEventListener("click", () => {
      wrap.querySelectorAll(".layout-opt").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      onPick(name);
    });
    wrap.appendChild(b);
  });
  return wrap;
}

/* ---------- pick an application ---------- */

// Typing an executable name from memory is the most error-prone part of any
// rule, so every rule row can grab one from something already running, or from
// anything installed.
let pickTarget = null;
let pickSource = "open";

// A rule can name an application that is not running, but anything that acts on
// a live window cannot, so the caller says whether the Installed tab applies.
async function openPicker(onPick, { installed = true } = {}) {
  pickTarget = onPick;
  pickSource = "open";
  document.querySelector("#pick-modal").hidden = false;
  document.querySelector("#pick-filter").value = "";
  document.querySelector("#pick-tabs").hidden = !installed;
  paintPickTabs();
  await fillPicker();
  document.querySelector("#pick-filter").focus();
}

function paintPickTabs() {
  document.querySelectorAll("#pick-tabs .raw-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.source === pickSource);
  });
}

// Walking the Start Menu takes about four seconds, so it happens once and the
// answer is kept for as long as the app is open.
let installedApps = null;

async function allInstalledApps() {
  if (!installedApps) installedApps = markSharedExes(await window.wm.apps());
  return installedApps;
}

// Two sources, because neither is complete on its own. Walking the desktop
// misses windows komorebi has cloaked on another workspace; komorebi misses
// anything it was told to ignore.
async function allKnownWindows() {
  const [desktop, state] = await Promise.all([window.wm.windows(), window.wm.state()]);
  const byHwnd = new Map();
  desktop.forEach((w) => byHwnd.set(w.hwnd, w));

  if (state.ok) {
    (state.state.monitors?.elements || []).forEach((mon) => {
      (mon.workspaces?.elements || []).forEach((ws, wi) => {
        const where = ws.name || `workspace ${wi + 1}`;
        const list = [
          ...(ws.containers?.elements || []).flatMap((c) => c.windows?.elements || []),
          ...(ws.floating_windows?.elements || []),
        ];
        list.forEach((w) => {
          const have = byHwnd.get(w.hwnd);
          if (have) have.where = where;
          else byHwnd.set(w.hwnd, { ...w, where });
        });
      });
    });
  }
  return markSharedExes([...byHwnd.values()])
    .sort((a, b) => appName(a).localeCompare(appName(b)));
}

// Two installs of the same app ship the same executable, so a rule on the name
// would catch both. Where that happens the full path is the only thing that
// tells them apart, and the rule has to be built from it instead.
function markSharedExes(list) {
  const paths = new Map();
  list.forEach((w) => {
    if (!w.path) return;
    const key = (w.exe || "").toLowerCase();
    if (!paths.has(key)) paths.set(key, new Set());
    paths.get(key).add(w.path);
  });
  list.forEach((w) => {
    w.sharedExe = (paths.get((w.exe || "").toLowerCase())?.size ?? 0) > 1;
  });
  return list;
}

// What the app calls itself, taken from the executable. Zen Browser and its
// nightly build are both zen.exe, but one says Zen and the other says Twilight.
const appName = (w) => w.name || (w.exe || "").replace(/\.exe$/i, "") || "unknown";
const installFolder = (w) => (w.path || "").split("\\").slice(-2, -1)[0] || "";
// The row is already showing the executable, so the path drops it and keeps the
// folder, which is the part that separates one install from another.
const installPath = (w) => (w.path || "").replace(/\\[^\\]+$/, "");

async function fillPicker() {
  const box = document.querySelector("#pick-list");
  const installed = pickSource === "installed";
  box.innerHTML = `<p class="note">Reading ${installed ? "installed applications" : "open windows"}...</p>`;

  const list = installed ? await allInstalledApps() : await allKnownWindows();
  const q = document.querySelector("#pick-filter").value.toLowerCase();
  const shown = list.filter((w) => !q
    || `${appName(w)} ${w.exe} ${w.title || ""} ${w.class || ""} ${w.path || ""}`
      .toLowerCase().includes(q));

  box.innerHTML = "";
  if (!shown.length) {
    box.innerHTML = `<p class="note">Nothing matches${q ? ` "${q}"` : ""}.</p>`;
    return;
  }
  shown.forEach((w) => box.appendChild(pickRow(w, installed)));
}

function pickRow(w, installed) {
  const row = document.createElement("button");
  row.className = "pick-row";
  // The folder only earns its space when the executable name is not enough.
  const folder = w.sharedExe ? ` <em>${installFolder(w)}</em>` : "";
  const middle = installed ? installPath(w) : w.title || "";
  const where = installed ? "not open" : w.where || (w.hidden ? "another workspace" : "");

  row.innerHTML = `<span class="exe">${appName(w)}<small>${w.exe}${folder}</small></span>`
    + `<span class="title">${middle}</span>`
    + `<span class="where${installed ? " off" : ""}">${where}</span>`;
  row.title = [installed ? null : `class: ${w.class || "unknown"}`, w.path]
    .filter(Boolean).join("\n");
  row.addEventListener("click", () => {
    document.querySelector("#pick-modal").hidden = true;
    if (pickTarget) pickTarget(w);
    pickTarget = null;
  });
  return row;
}

function pickButton(onPick) {
  const b = document.createElement("button");
  b.className = "ghost small";
  b.textContent = "Pick";
  b.title = "Choose something open, or anything installed";
  b.addEventListener("click", () => openPicker(onPick));
  return b;
}

document.querySelector("#pick-close").addEventListener("click", () => {
  document.querySelector("#pick-modal").hidden = true;
  pickTarget = null;
});
document.querySelector("#pick-filter").addEventListener("input", fillPicker);
document.querySelector("#pick-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".raw-tab");
  if (!tab || tab.dataset.source === pickSource) return;
  pickSource = tab.dataset.source;
  paintPickTabs();
  fillPicker();
});
document.querySelector("#map-refresh").addEventListener("click", () => refreshMap());

// Pause map rebuilds for as long as a press is in progress anywhere on it.
const mapPane = document.querySelector("#view-map");
const hold = (on) => { if (typeof holdRedraws === "function") holdRedraws(on); };
mapPane.addEventListener("pointerdown", () => hold(true));
document.addEventListener("pointerup", () => hold(false));
document.addEventListener("pointercancel", () => hold(false));

/* ---------- screens ---------- */

// Selecting a screen re-renders everything that hangs off a monitor block.
function selectMonitor(i) {
  state.monitor = i;
  renderWorkspaces();
  renderMonitors();
  renderLayoutDesigner();
  renderLayoutRules();
  renderWorkspaceRules();
}

function renderMonitors() {
  const box = document.querySelector("#monitors");
  if (!box || !state.komorebi) return;
  const list = monitors();
  box.innerHTML = "";

  list.forEach((m, i) => {
    const b = document.createElement("button");
    b.className = "mon" + (i === state.monitor ? " active" : "");
    b.innerHTML =
      `<strong>Screen ${i + 1}</strong><em>${(m.workspaces || []).length} workspaces</em>`;
    b.addEventListener("click", () => selectMonitor(i));
    box.appendChild(b);
  });

  const add = document.createElement("button");
  add.className = "mon add";
  add.innerHTML = "<strong>+</strong><em>add a screen</em>";
  add.addEventListener("click", () => {
    list.push({ workspaces: [{ name: "I", layout: "BSP" }] });
    markDirty("komorebi");
    selectMonitor(list.length - 1);
  });
  box.appendChild(add);

  if (list.length > 1) {
    const rm = document.createElement("button");
    rm.className = "ghost small";
    rm.textContent = `Remove screen ${state.monitor + 1}`;
    rm.addEventListener("click", () => {
      list.splice(state.monitor, 1);
      markDirty("komorebi");
      selectMonitor(Math.min(state.monitor, list.length - 1));
    });
    box.appendChild(rm);
  }
}

/* ---------- 1. layout rules by window count ---------- */

function renderLayoutRules() {
  const box = document.querySelector("#layout-rules");
  if (!box || !state.komorebi) return;
  const list = activeMonitor()?.workspaces || [];
  box.innerHTML = "";

  list.forEach((w, wi) => {
    const rules = w.layout_rules || {};
    const card = document.createElement("div");
    card.className = "lr-card";

    const head = document.createElement("div");
    head.className = "lr-head";
    head.innerHTML = `<strong>${w.name || `Workspace ${wi + 1}`}</strong>`;

    const add = document.createElement("button");
    add.className = "ghost small";
    add.textContent = "Add rule";
    add.addEventListener("click", () => {
      w.layout_rules = w.layout_rules || {};
      let n = 1;
      while (w.layout_rules[n] !== undefined) n++;
      w.layout_rules[n] = w.layout || "BSP";
      markDirty("komorebi");
      renderLayoutRules();
    });
    head.appendChild(add);
    card.appendChild(head);

    const entries = Object.entries(rules).sort((a, b) => Number(a[0]) - Number(b[0]));
    if (!entries.length) {
      const p = document.createElement("p");
      p.className = "note";
      p.textContent = `Always uses ${w.layout}. Add a rule to switch layout as windows open.`;
      card.appendChild(p);
    }

    entries.forEach(([count, layout]) => {
      const row = document.createElement("div");
      row.className = "lr-row";

      const n = document.createElement("input");
      n.type = "number";
      n.min = 1;
      n.value = count;
      n.title = "From this many windows";
      n.addEventListener("change", () => {
        const next = String(Math.max(1, Number(n.value)));
        if (next !== count) {
          delete w.layout_rules[count];
          w.layout_rules[next] = layout;
          markDirty("komorebi");
          renderLayoutRules();
        }
      });

      const label = document.createElement("span");
      label.className = "lr-label";
      label.textContent = "windows or more use";

      const sel = document.createElement("select");
      fillSelect(sel, Object.keys(LAYOUT_SHAPES), layout);
      sel.addEventListener("change", () => {
        w.layout_rules[count] = sel.value;
        markDirty("komorebi");
      });

      const rm = document.createElement("button");
      rm.className = "del";
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        delete w.layout_rules[count];
        if (!Object.keys(w.layout_rules).length) delete w.layout_rules;
        markDirty("komorebi");
        renderLayoutRules();
      });

      row.append(dressNumber(n, false), label, sel, rm);
      card.appendChild(row);
    });

    box.appendChild(card);
  });
}

/* ---------- 2. pin apps to workspaces ---------- */

// The schema puts workspace_rules INSIDE each workspace, not at the top level,
// so the rule is stored against the workspace it sends the app to.
function renderWorkspaceRules() {
  const box = document.querySelector("#ws-rules");
  if (!box || !state.komorebi) return;
  const spaces = activeMonitor()?.workspaces || [];
  box.innerHTML = "";

  const pick = document.querySelector("#wsr-ws");
  if (pick) {
    const keep = pick.value;
    pick.innerHTML = "";
    spaces.forEach((w, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = w.name || `Workspace ${i + 1}`;
      pick.appendChild(o);
    });
    if (keep) pick.value = keep;
  }

  let total = 0;
  spaces.forEach((w, wi) => {
    const groups = [
      ["workspace_rules", "Every time"],
      ["initial_workspace_rules", "First launch only"],
    ];
    if (!groups.some(([k]) => (w[k] || []).length)) return;

    const card = document.createElement("div");
    card.className = "lr-card";
    card.innerHTML = `<div class="lr-head"><strong>${w.name || `Workspace ${wi + 1}`}</strong></div>`;

    groups.forEach(([key]) => {
      const rules = w[key] || [];
      total += rules.length;
      rules.forEach((rule, ri) => {
        card.appendChild(ruleRow(rule, () => {
          rules.splice(ri, 1);
          if (!rules.length) delete w[key];
          markDirty("komorebi");
          renderWorkspaceRules();
        }, whenSelect(w, key, rule, ri)));
      });
    });

    box.appendChild(card);
  });

  if (!total) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = "No rules yet. Add one to always open an app on a chosen workspace.";
    box.appendChild(p);
  }
}

// The two lists differ only in when komorebi applies them, so moving a rule
// between them is the clearest way to express the choice.
function whenSelect(workspace, key, rule, index) {
  const sel = document.createElement("select");
  fillSelect(sel, ["Every time", "First launch only"],
    key === "workspace_rules" ? "Every time" : "First launch only");
  sel.title = "Every time re-sends the window on focus; first launch only places it once";
  sel.addEventListener("change", () => {
    const to = sel.value === "Every time" ? "workspace_rules" : "initial_workspace_rules";
    if (to === key) return;
    workspace[key].splice(index, 1);
    if (!workspace[key].length) delete workspace[key];
    workspace[to] = workspace[to] || [];
    workspace[to].push(rule);
    markDirty("komorebi");
    renderWorkspaceRules();
  });
  return sel;
}

function addWorkspaceRule(workspaceIndex) {
  const w = activeMonitor().workspaces[workspaceIndex];
  w.workspace_rules = w.workspace_rules || [];
  w.workspace_rules.push({ kind: "Exe", id: "", matching_strategy: "Equals" });
  markDirty("komorebi");
  renderWorkspaceRules();
}

/* ---------- 7. live window inspector ---------- */

async function renderWindowInspector() {
  const box = document.querySelector("#win-list");
  if (!box) return;
  box.innerHTML = '<p class="note">Reading open windows...</p>';
  const wins = await window.wm.windows();
  const filter = (document.querySelector("#win-filter")?.value || "").toLowerCase();
  box.innerHTML = "";

  const shown = wins.filter((w) => !filter
    || `${appName(w)} ${w.exe} ${w.title}`.toLowerCase().includes(filter));

  if (!shown.length) {
    box.innerHTML = '<p class="note">No matching windows.</p>';
    return;
  }

  shown.forEach((w) => {
    const rules = state.appRules?.[w.exe.replace(/\.exe$/i, "")] || state.appRules?.[w.exe] || null;
    const row = document.createElement("div");
    row.className = "win";

    const meta = document.createElement("div");
    meta.className = "win-meta";
    meta.innerHTML = `<span class="exe">${appName(w)} <b>${w.exe}</b></span>`
      + `<span class="title">${w.title}</span>`;

    const tag = document.createElement("span");
    tag.className = "win-tag " + (rules ? "has" : "none");
    tag.textContent = rules ? Object.keys(rules).filter((k) => k !== "$schema").join(", ") : "no rule";

    const add = document.createElement("button");
    add.className = "ghost small";
    add.textContent = "Float it";
    add.addEventListener("click", () => {
      state.appRules = state.appRules || {};
      const key = w.exe.replace(/\.exe$/i, "");
      state.appRules[key] = state.appRules[key] || {};
      state.appRules[key].float = [{ kind: "Exe", id: w.exe, matching_strategy: "Equals" }];
      markDirty("appRules");
      renderWindowInspector();
      if (typeof renderAppRules === "function") renderAppRules();
    });

    row.append(meta, tag, add);
    box.appendChild(row);
  });
}


/* ---------- adding widgets that are not defined yet ---------- */

// A widget can only go in an island if it also has a definition block. For a
// type YASB supports but this config has never used, the block is created too.
function uniqueWidgetName(base) {
  const defined = allDefinedWidgets(state.yasbConfig);
  if (!defined.includes(base)) return base;
  let n = 2;
  while (defined.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function defineWidget(name, type) {
  const at = state.yasbConfig.search(/^widgets:/m);
  if (at === -1) return false;
  const NL = String.fromCharCode(10);
  const insertAt = state.yasbConfig.indexOf(NL, at) + 1;
  const block = "  " + name + ":" + NL + '    type: "' + type + '"' + NL;
  state.yasbConfig =
    state.yasbConfig.slice(0, insertAt) + block + state.yasbConfig.slice(insertAt);
  return true;
}

function widgetCatalogue() {
  const defined = new Set(allDefinedWidgets(state.yasbConfig));
  const groups = [
    { label: "Already in your config", items: [...defined].sort().map((n) => ({ value: n, name: n })) },
    { label: "Available in YASB", items: (window.YASB_WIDGETS || []).map((w) => ({
        value: "new:" + w.type, name: `${w.label}  (${w.ns})`,
      })) },
  ];
  return groups;
}

function addWidgetToIsland(islandName, currentList, choice) {
  if (!choice.startsWith("new:")) {
    writeIsland(islandName, [...currentList, choice]);
    return;
  }
  const type = choice.slice(4);
  const base = type.split(".")[1];
  const name = uniqueWidgetName(base);
  if (!defineWidget(name, type)) {
    msg("Could not find the widgets: section to add a definition", "err");
    return;
  }
  writeIsland(islandName, [...currentList, name]);
  msg(`Added ${name} (${type}). Set its options in Widget options.`, "ok");
  if (typeof renderWidgetOptions === "function") {
    const sel = document.querySelector("#widget-pick");
    if (sel) delete sel.dataset.filled;
    renderWidgetOptions();
  }
}
