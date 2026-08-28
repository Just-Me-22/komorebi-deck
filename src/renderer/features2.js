/* Second half of the feature set: shortcuts tooling, widget options,
   diff preview and the cheat sheet. */

/* ---------- 6. komorebic command autocomplete and validation ---------- */

let KCMDS = [];
window.wm.commands().then((list) => {
  KCMDS = list;
  const dl = document.createElement("datalist");
  dl.id = "kcmds";
  list.forEach((c) => {
    const o = document.createElement("option");
    o.value = `komorebic ${c}`;
    dl.appendChild(o);
  });
  document.body.appendChild(dl);
  if (typeof renderShortcuts === "function") renderShortcuts();
});

// Only judge commands we can actually check: a komorebic call with a verb we
// do not know about. Anything else (scripts, taskkill, shell) is left alone.
function unknownKomorebicVerb(cmd) {
  const m = cmd.trim().match(/^komorebic\s+([a-z0-9-]+)/i);
  if (!m || !KCMDS.length) return null;
  return KCMDS.includes(m[1].toLowerCase()) ? null : m[1];
}

/* ---------- 5. keybinding recorder ---------- */

// whkd spells several keys differently from the browser.
const KEY_MAP = {
  " ": "space", Escape: "escape", Enter: "return", Tab: "tab", Backspace: "back",
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
  ";": "oem_1", "=": "oem_plus", ",": "oem_comma", "-": "oem_minus", ".": "oem_period",
  "/": "oem_2", "`": "oem_3", "[": "oem_4", "\\": "oem_5", "]": "oem_6", "'": "oem_7",
};

function recordChord(input, onDone) {
  input.classList.add("recording");
  const prev = input.value;
  input.value = "press keys...";

  function finish(value) {
    input.classList.remove("recording");
    document.removeEventListener("keydown", handler, true);
    input.value = value;
    if (value !== prev) onDone(value);
  }

  function handler(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return finish(prev);

    const mods = [];
    if (e.ctrlKey) mods.push("ctrl");
    if (e.altKey) mods.push("alt");
    if (e.shiftKey) mods.push("shift");
    if (e.metaKey) mods.push("win");

    let key = e.key;
    if (["Control", "Alt", "Shift", "Meta"].includes(key)) return;
    key = KEY_MAP[key] || key.toLowerCase();
    finish([...mods, key].join(" + "));
  }

  document.addEventListener("keydown", handler, true);
}

/* ---------- 10. cheat sheet ---------- */

function groupBindings(bindings) {
  const groups = new Map();
  bindings.forEach((b) => {
    const m = b.cmd.trim().match(/^komorebic\s+([a-z0-9-]+)/i);
    let group = "Other";
    if (m) {
      const verb = m[1].toLowerCase();
      if (/focus|cycle-focus/.test(verb)) group = "Focus";
      else if (/^move|^send/.test(verb)) group = "Move windows";
      else if (/stack/.test(verb)) group = "Stacks";
      else if (/layout|flip|ratio/.test(verb)) group = "Layout";
      else if (/workspace/.test(verb)) group = "Workspaces";
      else if (/resize|padding/.test(verb)) group = "Size";
      else if (/float|monocle|maximize|lock|tiling/.test(verb)) group = "Window state";
      else group = "komorebi";
    }
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(b);
  });
  return groups;
}

function renderCheatSheet() {
  const box = document.querySelector("#cheat");
  if (!box || !state.bindings) return;
  const groups = groupBindings(state.bindings || []);
  box.innerHTML = "";
  [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([name, list]) => {
      const sec = document.createElement("div");
      sec.className = "cheat-group";
      sec.innerHTML = `<h3>${name} <em>${list.length}</em></h3>`;
      list.forEach((b) => {
        const row = document.createElement("div");
        row.className = "cheat-row";
        row.innerHTML =
          `<kbd>${b.keys}</kbd><span>${b.cmd.replace(/^komorebic\s+/, "")}</span>`;
        sec.appendChild(row);
      });
      box.appendChild(sec);
    });
}

/* ---------- 8. YASB widget property editor ---------- */

function widgetBlockRange(text, name) {
  const start = text.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  if (start === -1) return null;
  const after = text.slice(start);
  const nextIdx = after.slice(1).search(/^  [a-zA-Z_][\w]*:\s*$/m);
  const end = nextIdx === -1 ? text.length : start + 1 + nextIdx;
  return { start, end };
}

function renderWidgetOptions() {
  const box = document.querySelector("#widget-opts");
  const sel = document.querySelector("#widget-pick");
  if (!box || !sel || state.yasbConfig == null) return;

  const defined = (typeof allDefinedWidgets === "function" ? allDefinedWidgets(state.yasbConfig) : []);
  if (!sel.dataset.filled) {
    fillSelect(sel, defined, defined[0]);
    sel.dataset.filled = "1";
    sel.addEventListener("change", renderWidgetOptions);
  }

  const name = sel.value;
  const range = widgetBlockRange(state.yasbConfig, name);
  if (!range) {
    box.innerHTML = '<p class="note">Could not locate that widget block.</p>';
    return;
  }

  box.innerHTML = "";
  const ta = document.createElement("textarea");
  ta.className = "widget-block";
  ta.spellcheck = false;
  ta.value = state.yasbConfig.slice(range.start, range.end).replace(/\s+$/, "");

  const status = document.createElement("p");
  status.className = "note";
  status.textContent = "Edits replace this widget's block in config.yaml.";
  box.append(ta, status);

  // The offsets shift on every keystroke, so the block has to be located again
  // each time. Reusing a captured range silently eats the surrounding config.
  ta.addEventListener("input", async () => {
    const fresh = widgetBlockRange(state.yasbConfig, name);
    if (!fresh) {
      status.textContent = "Lost track of this block. Reload from disk.";
      status.className = "note bad";
      return;
    }
    state.yasbConfig =
      state.yasbConfig.slice(0, fresh.start) + ta.value + "\n" + state.yasbConfig.slice(fresh.end);
    markDirty("yasbConfig");

    const err = await window.wm.validate("yasbConfig", state.yasbConfig);
    if (err) {
      status.textContent = err.split("\n")[0];
      status.className = "note bad";
      ta.classList.add("bad-yaml");
    } else {
      status.textContent = "Valid YAML.";
      status.className = "note good";
      ta.classList.remove("bad-yaml");
    }
  });
}

/* ---------- 9. diff before apply ---------- */

async function showDiff() {
  const box = document.querySelector("#diff-box");
  if (!box) return;
  const parts = [];

  async function add(kind, next) {
    const lines = await window.wm.diff(kind, next);
    if (lines.length) parts.push({ kind, lines });
  }

  if (state.dirty.has("komorebi") && state.komorebi) {
    await add("komorebi", JSON.stringify(state.komorebi, null, 2) + "\n");
  }
  if (state.dirty.has("whkd")) {
    await add("whkd", serialiseWhkd(state.whkd, state.bindings));
  }
  if (state.dirty.has("yasbConfig")) await add("yasbConfig", state.yasbConfig);
  if (state.dirty.has("appRules") && state.appRules) {
    await add("appRules", JSON.stringify(state.appRules, null, 2) + "\n");
  }
  if (state.dirty.has("raw")) {
    await add(state.rawKind, document.querySelector("#raw-text").value);
  }

  box.innerHTML = "";
  if (!parts.length) {
    box.innerHTML = '<p class="note">Nothing changed.</p>';
    return;
  }
  parts.forEach((p) => {
    const sec = document.createElement("div");
    sec.className = "diff-group";
    sec.innerHTML = `<h3>${p.kind} <em>${p.lines.length} lines</em></h3>`;
    p.lines.slice(0, 300).forEach((l) => {
      const row = document.createElement("div");
      row.className = "diff-line " + (l.sign === "+" ? "add" : "del");
      row.textContent = `${l.sign} ${l.line}`;
      sec.appendChild(row);
    });
    box.appendChild(sec);
  });
}
