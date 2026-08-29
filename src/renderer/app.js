/* The palette in use follows theme.name, so switching flavour changes every
   swatch, preview and live-applied colour, not just the value in the file.
   Hex values come from catppuccin.js, generated from the upstream palette. */
const CATPPUCCIN_NAMES = Object.keys(CATPPUCCIN_FLAVOURS.Mocha);

function palette() {
  const name = state.komorebi?.theme?.name;
  return CATPPUCCIN_FLAVOURS[name] || CATPPUCCIN_FLAVOURS.Mocha;
}

const BORDER_KEYS = [
  ["floating_border", "Floating window"],
  ["single_border", "Single window"],
  ["stack_border", "Stacked windows"],
  ["monocle_border", "Monocle"],
  ["unfocused_border", "Unfocused"],
  ["unfocused_locked_border", "Unfocused, locked"],
];

// Values come from enums.js, generated straight out of komorebic's own schema.
// Earlier these were hand-written and several were wrong, including a
// monocle behaviour komorebi would have rejected.
const PLACEMENTS = KENUM.PLACEMENTS;
const ASPECT_RATIOS = KENUM.ASPECT_RATIOS;
const BORDER_STYLES = KENUM.BORDER_STYLES;
const HIDING = KENUM.HIDING;
const MONOCLE_FOCUS = KENUM.MONOCLE_FOCUS;
const LAYOUTS = KENUM.LAYOUTS;

const state = {
  komorebi: null, whkd: null, yasbConfig: null,
  rawKind: "komorebi", monitor: 0, dirty: new Set(), defaults: {},
};

// Everything workspace-shaped lives under one monitor, so the whole screen
// follows whichever one is selected.
const monitors = () => state.komorebi?.monitors || [];
const activeMonitor = () => monitors()[state.monitor];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

window.addEventListener("error", (e) => {
  const where = e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : "";
  msg(`Error: ${e.message}${where}`, "err");
});
window.addEventListener("unhandledrejection", (e) => msg(`Error: ${e.reason}`, "err"));

function msg(text, kind = "") {
  const el = $("#msg");
  el.textContent = text;
  el.className = "msg " + kind;
}

/* ---------- number fields ---------- */

// The browser's own arrows are tiny, grey and only there while the cursor is
// over the box, so they are drawn here instead. A field that knows both ends of
// its range also gets a slider, because dragging beats typing for anything
// measured in pixels. Fields in the tight grids ask for the arrows on their own.
function dressNumber(input, withSlider = true) {
  if (input.dataset.dressed) return input.closest(".num");
  input.dataset.dressed = "1";

  const wrap = document.createElement("span");
  wrap.className = "num";
  input.replaceWith(wrap);

  let slider = null;
  if (withSlider && input.min !== "" && input.max !== "") {
    slider = document.createElement("input");
    slider.type = "range";
    slider.min = input.min;
    slider.max = input.max;
    slider.step = input.step || 1;
    slider.tabIndex = -1;
    slider.addEventListener("input", () => setNumber(input, Number(slider.value)));
    wrap.appendChild(slider);
  }

  const box = document.createElement("span");
  box.className = "num-box";
  const arrows = document.createElement("span");
  arrows.className = "num-arrows";
  for (const [name, dir] of [["up", 1], ["down", -1]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `num-${name}`;
    b.tabIndex = -1;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      setNumber(input, clampNumber(input, startFrom(input) + dir * (Number(input.step) || 1)));
    });
    arrows.appendChild(b);
  }
  box.append(input, arrows);
  wrap.appendChild(box);

  // Loading a config sets these values in code, which fires no event, so the
  // slider has to be told separately or it sits wherever it started.
  // An inherited value lives in the placeholder rather than the value, so the
  // slider reads whichever one the box is actually showing.
  const follow = () => { if (slider) slider.value = startFrom(input); };
  input.addEventListener("input", follow);
  input.addEventListener("change", follow);
  input.syncSlider = follow;
  follow();
  return wrap;
}

const syncNumbers = () =>
  $$('input[type="number"]').forEach((el) => el.syncSlider && el.syncSlider());

// An empty box is showing its placeholder, which is the value it inherits, so
// that is what a nudge starts from.
const startFrom = (input) =>
  Number(input.value === "" ? input.placeholder || 0 : input.value);

function clampNumber(input, n) {
  if (input.min !== "") n = Math.max(Number(input.min), n);
  if (input.max !== "") n = Math.min(Number(input.max), n);
  return n;
}

// Some fields listen for input and some for change, so both are fired.
function setNumber(input, n) {
  if (Number(input.value) === n && input.value !== "") return;
  input.value = n;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillSelect(el, values, current) {
  el.innerHTML = "";
  const all = values.includes(current) || current == null ? values : [...values, current];
  for (const v of all) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    if (v === current) o.selected = true;
    el.appendChild(o);
  }
}

/* ---------- load ---------- */

async function loadAll() {
  const k = await window.wm.read("komorebi");
  state.komorebi = JSON.parse(k.text);
  const w = await window.wm.read("whkd");
  state.whkd = w.text;
  const y = await window.wm.read("yasbConfig");
  state.yasbConfig = y.text;

  await loadAppRules().catch(() => msg("applications.json could not be read", "warn"));
  renderAll();
  await loadRaw(state.rawKind);
  clearDirty();
  resetHistory();
  msg("Loaded from disk");
}

// Everything that draws from `state`, in one place, so undo has something to
// call after it puts an older version back.
function renderAll() {
  renderKomorebi();
  renderShortcuts();
  renderIslands();
  if (typeof renderLooks === "function") renderLooks();
  if (typeof renderMonitors === "function") renderMonitors();
  renderIgnoreRules();
  if (typeof renderLayoutDesigner === "function") renderLayoutDesigner();
  if (typeof renderLayoutRules === "function") renderLayoutRules();
  if (typeof renderWorkspaceRules === "function") renderWorkspaceRules();
  if (typeof renderWidgetOptions === "function") renderWidgetOptions();
  if (typeof renderCheatSheet === "function") renderCheatSheet();
  if (typeof renderPreviews === "function") renderPreviews();
  // Drawn now rather than when its tab is first opened, so its rows can be
  // found by the palette without having been there once already.
  if (typeof renderSettings === "function") renderSettings();
  applyValues();
  if (typeof setupGroups === "function") setupGroups();
}

/* ---------- 10. undo and redo ---------- */

/* A step is a copy of everything `state` holds that can be edited. That is
   heavy-handed compared with recording each change, but a change here can be a
   checkbox or a whole workspace being deleted, and there is no shape that
   covers both. Copies are a few kilobytes, so sixty of them cost less than
   getting the clever version subtly wrong. */

const HISTORY_LIMIT = 60;
const edits = { steps: [], at: -1, restoring: false, timer: null };

const snapshotState = () => JSON.stringify({
  komorebi: state.komorebi,
  whkd: state.whkd,
  bindings: state.bindings,
  yasbConfig: state.yasbConfig,
  appRules: state.appRules,
});

function resetHistory() {
  edits.steps = [snapshotState()];
  edits.at = 0;
  paintHistory();
}

// Typing in a text field fires per keystroke, and a step per letter makes undo
// useless, so edits that arrive together become one step.
function recordHistory() {
  if (edits.restoring) return;
  clearTimeout(edits.timer);
  edits.timer = setTimeout(() => {
    const now = snapshotState();
    if (now === edits.steps[edits.at]) return;
    edits.steps = edits.steps.slice(0, edits.at + 1);
    edits.steps.push(now);
    if (edits.steps.length > HISTORY_LIMIT) edits.steps.shift();
    edits.at = edits.steps.length - 1;
    paintHistory();
  }, 350);
}

function stepHistory(to) {
  clearTimeout(edits.timer);
  if (to < 0 || to >= edits.steps.length) return false;
  edits.at = to;
  const step = JSON.parse(edits.steps[to]);
  edits.restoring = true;
  Object.assign(state, step);
  renderAll();
  for (const kind of ["komorebi", "whkd", "yasbConfig", "appRules"]) markDirty(kind);
  edits.restoring = false;
  paintHistory();
  return true;
}

function undo() {
  if (!stepHistory(edits.at - 1)) return msg("Nothing left to undo");
  msg(`Undone. ${edits.at} step${edits.at === 1 ? "" : "s"} back to the loaded file.`, "ok");
}

function redo() {
  const room = edits.steps.length - 1 - edits.at;
  if (!stepHistory(edits.at + 1)) return msg("Nothing to redo");
  msg(`Redone. ${room - 1} more available.`, "ok");
}

function paintHistory() {
  const back = $("#btn-undo");
  const fwd = $("#btn-redo");
  if (!back || !fwd) return;
  back.disabled = edits.at <= 0;
  fwd.disabled = edits.at >= edits.steps.length - 1;
  back.title = back.disabled ? "Nothing to undo" : `Undo (${edits.at} available)`;
  fwd.title = fwd.disabled
    ? "Nothing to redo" : `Redo (${edits.steps.length - 1 - edits.at} available)`;
}

/* ---------- window manager ---------- */

function renderKomorebi() {
  const c = state.komorebi;
  if (!c) return;

  fillSelect($('[data-key="float_override_placement"]'), PLACEMENTS, c.float_override_placement);
  fillSelect($('[data-key="toggle_float_placement"]'), PLACEMENTS, c.toggle_float_placement);
  fillSelect($('[data-key="float_rule_placement"]'), PLACEMENTS, c.float_rule_placement);
  fillSelect($('[data-key="floating_window_aspect_ratio"]'), ASPECT_RATIOS, c.floating_window_aspect_ratio);
  fillSelect($('[data-key="border_style"]'), BORDER_STYLES, c.border_style);
  fillSelect($('[data-key="window_hiding_behaviour"]'), HIDING, c.window_hiding_behaviour);
  fillSelect($('[data-key="monocle_focus_behaviour"]'), MONOCLE_FOCUS, c.monocle_focus_behaviour);
  for (const el of $$("[data-nested]")) {
    const val = getNested(c, el.dataset.nested);
    if (val === undefined) continue;
    if (el.type === "checkbox") el.checked = !!val;
    else if (el.tagName !== "SELECT") el.value = val;
  }

  applyValues();
  renderWorkspaces();
}

/* A key that is not in the file is not unset: komorebi has its own value for
   it. Showing that rather than an empty box is the difference between the app
   telling you what is happening and telling you what has been written down.
   Nothing is written until it is changed, so the file only ever gains the
   decisions someone made.

   Run again at the end of a render, because a value cannot be put into a
   dropdown before something has filled its options, and several of those are
   filled by the tab that owns them rather than here. */
function applyValues() {
  const c = state.komorebi;
  if (!c) return;

  for (const el of $$("[data-key]")) {
    const key = el.dataset.key;
    const mine = key in c;
    const value = mine ? c[key] : state.defaults[key];
    markInherited(el, !mine && value !== undefined);
    if (value === undefined) {
      if (el.tagName === "SELECT") offerUnset(el);
      continue;
    }

    if (el.type === "checkbox") el.checked = !!value;
    else if (el.tagName === "SELECT") el.value = value;
    // A slider has nowhere to show a value it does not hold, so it takes the
    // inherited one directly. A number keeps its box empty and shows it greyed
    // behind, which is how the app shows an inherited gap everywhere else.
    else if (mine || el.type === "range") el.value = value;
    else { el.value = ""; el.placeholder = value; }
  }

  syncNumbers();
  const alpha = $('[data-key="transparency_alpha"]');
  const out = $("#alpha-out");
  if (alpha && out) out.textContent = alpha.value;
}

function renderWorkspaces() {
  const c = state.komorebi;
  if (!c) return;
  const ws = $("#workspaces");
  ws.innerHTML = "";
  const list = activeMonitor()?.workspaces || [];

  const head = document.createElement("div");
  head.className = "ws-head";
  head.innerHTML =
    "<span></span><span>name</span><span>layout</span><span>floating</span>" +
    "<span>gap</span><span>edge</span><span></span>";
  ws.appendChild(head);

  list.forEach((w, i) => {
    const row = document.createElement("div");
    row.className = "ws";

    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = i + 1;

    const name = document.createElement("input");
    name.type = "text";
    name.value = w.name ?? "";
    name.addEventListener("input", () => { w.name = name.value; markDirty("komorebi"); });

    const layout = document.createElement("select");
    fillSelect(layout, LAYOUTS, w.layout);
    layout.addEventListener("change", () => {
      w.layout = layout.value;
      markDirty("komorebi");
      if (typeof renderLayoutRules === "function") renderLayoutRules();
    });

    // Absent means "inherit the global float_override", which is different
    // from an explicit false, so the tri-state has to be preserved.
    const flo = document.createElement("select");
    const cur = w.float_override === undefined ? "inherit" : String(w.float_override);
    fillSelect(flo, ["inherit", "true", "false"], cur);
    flo.addEventListener("change", () => {
      if (flo.value === "inherit") delete w.float_override;
      else w.float_override = flo.value === "true";
      markDirty("komorebi");
    });

    const gap = document.createElement("input");
    gap.type = "number";
    gap.min = 0; gap.max = 60;
    gap.placeholder = String(c.default_container_padding ?? "");
    if (w.container_padding !== undefined) gap.value = w.container_padding;
    gap.addEventListener("input", () => {
      if (gap.value === "") delete w.container_padding;
      else w.container_padding = Number(gap.value);
      markDirty("komorebi");
    });

    const edge = document.createElement("input");
    edge.type = "number";
    edge.min = 0; edge.max = 60;
    edge.placeholder = String(c.default_workspace_padding ?? "");
    if (w.workspace_padding !== undefined) edge.value = w.workspace_padding;
    edge.addEventListener("input", () => {
      if (edge.value === "") delete w.workspace_padding;
      else w.workspace_padding = Number(edge.value);
      markDirty("komorebi");
    });

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "×";
    del.title = "Remove workspace";
    del.addEventListener("click", () => {
      list.splice(i, 1);
      markDirty("komorebi");
      // Everything reading the workspace list has to catch up, not just this
      // table: the screen's count, the layout shapes and the rule dropdowns.
      selectMonitor(state.monitor);
    });

    row.append(idx, name, layout, flo, dressNumber(gap, false), dressNumber(edge, false), del);
    ws.appendChild(row);
  });
}

$("#ws-add").addEventListener("click", () => {
  const list = activeMonitor().workspaces;
  list.push({ name: `Workspace ${list.length + 1}`, layout: "BSP" });
  markDirty("komorebi");
  selectMonitor(state.monitor);
});

function getNested(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setNested(obj, dotted, value) {
  const parts = dotted.split(".");
  const last = parts.pop();
  let cur = obj;
  for (const k of parts) {
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[last] = value;
}

// What was on disk when this was last loaded or saved. Everything "unsaved" is
// worked out by comparing against it, so typing a value and typing it back
// leaves you with nothing to save, which is what actually happened.
const pristine = {};

function snapshotPristine() {
  pristine.komorebi = state.komorebi ? JSON.stringify(state.komorebi) : null;
  pristine.whkd = state.bindings ? serialiseWhkd(state.whkd, state.bindings) : null;
  pristine.yasbConfig = state.yasbConfig;
  pristine.appRules = state.appRules ? JSON.stringify(state.appRules) : null;
}

function currentOf(kind) {
  if (kind === "komorebi") return state.komorebi ? JSON.stringify(state.komorebi) : null;
  if (kind === "whkd") return state.bindings ? serialiseWhkd(state.whkd, state.bindings) : null;
  if (kind === "yasbConfig") return state.yasbConfig;
  if (kind === "appRules") return state.appRules ? JSON.stringify(state.appRules) : null;
  return null;
}

function markDirty(kind) {
  if (kind === "raw") state.dirty.add("raw");
  else if (currentOf(kind) === pristine[kind]) state.dirty.delete(kind);
  else state.dirty.add(kind);
  paintDirty();
  recordHistory();
}

function paintDirty() {
  const changed = [...state.dirty];
  document.body.classList.toggle("has-changes", changed.length > 0);
  $("#btn-save").classList.toggle("dirty", changed.length > 0);
  $("#btn-apply").classList.toggle("dirty", changed.length > 0);
  if (changed.length) msg(`Unsaved changes in ${changed.join(", ")}`, "warn");
  else if ($("#msg").classList.contains("warn")) msg("No changes");
}

function clearDirty() {
  state.dirty.clear();
  snapshotPristine();
  paintDirty();
}

// A dropdown with nothing selected shows its first option, which reads as a
// decision somebody made. These three genuinely have no value until you pick
// one, so they say that, and picking it again takes the key back out.
function offerUnset(el) {
  let blank = el.querySelector('option[value=""]');
  if (!blank) {
    blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "komorebi decides";
    el.prepend(blank);
  }
  el.value = "";
}

// The badge hangs off the config-key line, so it needs no markup of its own and
// disappears the moment the row stops being inherited.
function markInherited(el, on) {
  el.closest(".row")?.classList.toggle("inherited", !!on);
  if (el.tagName === "SELECT") el.classList.toggle("is-inherited", !!on);
}

function readControl(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number" || el.type === "range") return Number(el.value);
  return el.value;
}

document.addEventListener("input", (e) => {
  if (!state.komorebi) return;
  if (e.target.closest("[data-key],[data-nested]")) applyControl(e);
});

document.addEventListener("change", (e) => {
  if (!state.komorebi) return;
  applyControl(e);
});

function applyControl(e) {
  const flat = e.target.closest("[data-key]");
  if (flat) {
    const value = readControl(flat);
    // Choosing "komorebi decides" is how a key comes back out of the file.
    if (value === "") delete state.komorebi[flat.dataset.key];
    else state.komorebi[flat.dataset.key] = value;
    markInherited(flat, false);
    markDirty("komorebi");
    // Only on change, so dragging a slider does not fire a komorebic call a frame.
    if (e.type === "change") liveApply(flat.dataset.key, value);
    if (typeof renderPreviews === "function") renderPreviews();
    return;
  }
  const nested = e.target.closest("[data-nested]");
  if (nested) {
    setNested(state.komorebi, nested.dataset.nested, readControl(nested));
    markDirty("komorebi");
  }
}

/* ---------- application matching rules ---------- */

// komorebi has five separate lists of these and they all share one row shape:
// what to match on, the value, and how strictly to compare.
function ruleRow(rule, onRemove, extra) {
  const row = document.createElement("div");
  row.className = "wsr-row";

  const id = document.createElement("input");
  id.type = "text";
  id.placeholder = "Discord.exe";
  id.value = rule.id || "";
  id.addEventListener("input", () => { rule.id = id.value; markDirty("komorebi"); });

  const kind = document.createElement("select");
  fillSelect(kind, KENUM.IDENTIFIERS, rule.kind || "Exe");
  kind.addEventListener("change", () => { rule.kind = kind.value; markDirty("komorebi"); });

  const strat = document.createElement("select");
  fillSelect(strat, KENUM.MATCH_STRATEGIES, rule.matching_strategy || "Equals");
  strat.addEventListener("change", () => {
    rule.matching_strategy = strat.value;
    markDirty("komorebi");
  });

  // Picking normally matches the executable name. When two installs share that
  // name, matching it would hit both, so the path is used instead.
  const pick = pickButton((w) => {
    const byPath = w.sharedExe && w.path;
    rule.kind = kind.value = byPath ? "Path" : "Exe";
    rule.id = id.value = byPath ? w.path : w.exe;
    markDirty("komorebi");
    if (byPath) msg(`${w.exe} is used by more than one install, so this matches `
      + `the one in ${w.path}.`, "ok");
  });

  const rm = document.createElement("button");
  rm.className = "del";
  rm.textContent = "×";
  rm.addEventListener("click", onRemove);

  row.append(id, kind, strat, ...(extra ? [extra] : []), pick, rm);
  return row;
}

// Renders a whole list into `box` and hands back the array so callers can
// delete the key entirely once it is empty.
function ruleList(box, rules, redraw, emptyText, extraFor) {
  box.innerHTML = "";
  if (!rules.length) {
    box.innerHTML = `<p class="note">${emptyText}</p>`;
    return;
  }
  rules.forEach((rule, i) => {
    box.appendChild(ruleRow(rule, () => {
      rules.splice(i, 1);
      markDirty("komorebi");
      redraw();
    }, extraFor && extraFor(rule, i)));
  });
}

function renderIgnoreRules() {
  const box = $("#ignore-rules");
  if (!box || !state.komorebi) return;
  const rules = state.komorebi.ignore_rules || [];
  ruleList(box, rules, renderIgnoreRules,
    "Nothing listed. Everything opens under komorebi's control.");
  if (!rules.length) delete state.komorebi.ignore_rules;
}

$("#ignore-add").addEventListener("click", () => {
  const rules = (state.komorebi.ignore_rules = state.komorebi.ignore_rules || []);
  rules.push({ kind: "Exe", id: "", matching_strategy: "Equals" });
  markDirty("komorebi");
  renderIgnoreRules();
});

/* ---------- shortcuts ---------- */

function parseWhkd(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, n) => {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith(".")) return;
    const i = t.indexOf(":");
    if (i === -1) return;
    out.push({ keys: t.slice(0, i).trim(), cmd: t.slice(i + 1).trim(), line: n });
  });
  return out;
}

function serialiseWhkd(original, bindings) {
  // Keep the header directives (.shell etc) and comments exactly as they were.
  const header = original.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return t.startsWith(".") || (t.startsWith("#") && !t.includes(":"));
  });
  const body = bindings.filter((b) => b.keys && b.cmd).map((b) => `${b.keys} : ${b.cmd}`);
  return [...header, "", ...body, ""].join("\n");
}

function normaliseChord(keys) {
  return keys.toLowerCase().split("+").map((k) => k.trim()).sort().join("+");
}

function findConflicts(bindings) {
  const seen = new Map();
  const dupes = new Map();
  bindings.forEach((b) => {
    if (!b.keys.trim()) return;
    const key = normaliseChord(b.keys);
    if (seen.has(key)) {
      if (!dupes.has(key)) dupes.set(key, [seen.get(key)]);
      dupes.get(key).push(b);
    } else {
      seen.set(key, b);
    }
  });
  return dupes;
}

function renderConflicts(dupes) {
  const box = $("#sc-conflicts");
  box.innerHTML = "";
  if (!dupes.size) return;
  const lines = [...dupes.entries()].map(([chord, list]) =>
    `<code>${list[0].keys}</code> is bound ${list.length} times; whkd will only use the last one.`
  );
  box.innerHTML = `<strong>${dupes.size} duplicate ${dupes.size === 1 ? "binding" : "bindings"}</strong><br>` + lines.join("<br>");
}

function renderShortcuts() {
  if (state.whkd == null) return;
  const list = $("#sc-list");
  const bindings = parseWhkd(state.whkd);
  state.bindings = bindings;
  list.innerHTML = "";
  const dupes = findConflicts(bindings);
  renderConflicts(dupes);
  const dupChords = new Set([...dupes.values()].flat().map((b) => b));
  if (typeof renderCheatSheet === "function") renderCheatSheet();
  if (typeof renderPreviews === "function") renderPreviews();
  const filter = $("#sc-filter").value.toLowerCase();

  bindings.forEach((b) => {
    if (filter && !(`${b.keys} ${b.cmd}`.toLowerCase().includes(filter))) return;
    const row = document.createElement("div");
    row.className = "sc" + (dupChords.has(b) ? " dup" : "");
    const keys = document.createElement("input");
    keys.type = "text";
    keys.value = b.keys;
    keys.addEventListener("input", () => {
      b.keys = keys.value;
      markDirty("whkd");
      renderConflicts(findConflicts(state.bindings));
    });
    const cmd = document.createElement("input");
    cmd.type = "text";
    cmd.value = b.cmd;
    cmd.setAttribute("list", "kcmds");
    const flagCmd = () => {
      const bad = typeof unknownKomorebicVerb === "function" ? unknownKomorebicVerb(cmd.value) : null;
      cmd.classList.toggle("bad-cmd", !!bad);
      cmd.title = bad ? `komorebic has no command called "${bad}"` : "";
    };
    flagCmd();
    cmd.addEventListener("input", () => { b.cmd = cmd.value; flagCmd(); markDirty("whkd"); });
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "×";
    del.title = "Remove";
    del.addEventListener("click", () => {
      state.bindings = state.bindings.filter((x) => x !== b);
      renderShortcuts();
      markDirty("whkd");
    });
    const rec = document.createElement("button");
    rec.className = "rec";
    rec.textContent = "⏺";
    rec.title = "Record a key combination";
    rec.addEventListener("click", () => {
      if (typeof recordChord === "function") {
        recordChord(keys, (v) => {
          b.keys = v;
          markDirty("whkd");
          renderConflicts(findConflicts(state.bindings));
        });
      }
    });
    row.append(keys, rec, cmd, del);
    list.appendChild(row);
  });
}

$("#sc-filter").addEventListener("input", renderShortcuts);
$("#sc-add").addEventListener("click", () => {
  state.bindings.push({ keys: "", cmd: "" });
  state.whkd = serialiseWhkd(state.whkd, state.bindings);
  renderShortcuts();
  markDirty("whkd");
});

/* ---------- bar islands ---------- */

function allDefinedWidgets(text) {
  // Widget definitions live one level under the top-level `widgets:` key.
  const wi = text.search(/^widgets:/m);
  if (wi === -1) return [];
  const block = text.slice(wi);
  return [...block.matchAll(/^  ([a-zA-Z_][\w]*):\s*$/gm)]
    .map((m) => m[1])
    .filter((n) => !n.startsWith("island_"));
}

function islandWidgets(text, name) {
  const at = text.indexOf(`  ${name}:`);
  if (at === -1) return null;
  const m = text.slice(at).match(/widgets:\s*\[([^\]]*)\]/);
  if (!m) return null;
  const list = m[1].split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean);
  return { match: m[0], list };
}

function writeIsland(name, list) {
  const found = islandWidgets(state.yasbConfig, name);
  if (!found) return;
  const replacement = `widgets: [${list.map((w) => `"${w}"`).join(", ")}]`;
  const at = state.yasbConfig.indexOf(`  ${name}:`);
  state.yasbConfig =
    state.yasbConfig.slice(0, at) +
    state.yasbConfig.slice(at).replace(found.match, replacement);
  markDirty("yasbConfig");
  renderIslands();
}

function renderIslands() {
  if (state.yasbConfig == null) return;
  const box = $("#islands");
  box.innerHTML = "";
  const text = state.yasbConfig;
  const defined = allDefinedWidgets(text);
  const islands = [...text.matchAll(/^  (island_\w+):/gm)].map((m) => m[1]);

  islands.forEach((name) => {
    const found = islandWidgets(text, name);
    if (!found) return;
    const list = found.list;

    const card = document.createElement("div");
    card.className = "island-card";
    const h = document.createElement("h3");
    h.textContent = name;
    card.appendChild(h);

    list.forEach((w, i) => {
      const row = document.createElement("div");
      row.className = "wrow";

      const nm = document.createElement("span");
      nm.className = "name";
      nm.textContent = w;

      const up = document.createElement("button");
      up.textContent = "↑";
      up.title = "Move left";
      up.disabled = i === 0;
      up.addEventListener("click", () => {
        const next = [...list];
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
        writeIsland(name, next);
      });

      const down = document.createElement("button");
      down.textContent = "↓";
      down.title = "Move right";
      down.disabled = i === list.length - 1;
      down.addEventListener("click", () => {
        const next = [...list];
        [next[i + 1], next[i]] = [next[i], next[i + 1]];
        writeIsland(name, next);
      });

      const rm = document.createElement("button");
      rm.className = "rm";
      rm.textContent = "×";
      rm.title = "Remove from island";
      rm.addEventListener("click", () => writeIsland(name, list.filter((_, j) => j !== i)));

      row.append(nm, up, down, rm);
      card.appendChild(row);
    });

    const add = document.createElement("div");
    add.className = "add-row";
    const sel = document.createElement("select");

    // Two groups: widgets this config already defines, and every widget YASB
    // ships. Choosing from the second group writes a definition block too.
    const groups = typeof widgetCatalogue === "function"
      ? widgetCatalogue()
      : [{ label: "Defined", items: defined.map((n) => ({ value: n, name: n })) }];

    groups.forEach((group) => {
      const items = group.items.filter((i) => !list.includes(i.value));
      if (!items.length) return;
      const og = document.createElement("optgroup");
      og.label = group.label;
      items.forEach((i) => {
        const o = document.createElement("option");
        o.value = i.value;
        o.textContent = i.name;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });

    const btn = document.createElement("button");
    btn.textContent = "Add";
    btn.disabled = !sel.options.length;
    btn.addEventListener("click", () => addWidgetToIsland(name, list, sel.value));
    add.append(sel, btn);
    card.appendChild(add);

    box.appendChild(card);
  });
}

/* ---------- raw ---------- */

async function loadRaw(kind) {
  const r = await window.wm.read(kind);
  $("#raw-path").textContent = r.path;
  $("#raw-text").value = r.text;
  state.rawKind = kind;
}

$$(".raw-tab").forEach((b) => b.addEventListener("click", async () => {
  if (state.dirty.has("raw")) {
    const go = await window.wm.confirm(
      "Discard unsaved changes?",
      `You have unsaved edits to ${state.rawKind}. Switching files will lose them.`
    );
    if (!go) return;
    state.dirty.delete("raw");
  }
  $$(".raw-tab").forEach((x) => x.classList.toggle("active", x === b));
  await loadRaw(b.dataset.file);
}));

$("#raw-text").addEventListener("input", () => markDirty("raw"));

/* ---------- navigation ---------- */

$$(".tab").forEach((b) => b.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.toggle("active", x === b));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${b.dataset.view}`));
}));

/* ---------- saving ---------- */

async function save() {
  const results = [];

  if (state.dirty.has("raw")) {
    const r = await window.wm.write(state.rawKind, $("#raw-text").value);
    if (!r.ok) { msg(r.error, "err"); return false; }
    if (r.backup && state.rawKind === "komorebi") state.lastKomorebiBackup = r.backup;
    results.push(state.rawKind);
  }
  if (state.dirty.has("komorebi")) {
    const text = JSON.stringify(state.komorebi, null, 2) + "\n";
    const r = await window.wm.write("komorebi", text);
    if (!r.ok) { msg(r.error, "err"); return false; }
    if (r.backup) state.lastKomorebiBackup = r.backup;
    results.push("komorebi.json");
  }
  if (state.dirty.has("whkd")) {
    const text = serialiseWhkd(state.whkd, state.bindings);
    const r = await window.wm.write("whkd", text);
    if (!r.ok) { msg(r.error, "err"); return false; }
    state.whkd = text;
    results.push("whkdrc");
  }
  if (state.dirty.has("appRules")) {
    const r = await window.wm.write("appRules", JSON.stringify(state.appRules, null, 2) + "\n");
    if (!r.ok) { msg(r.error, "err"); return false; }
    results.push("applications.json");
  }
  if (state.dirty.has("yasbConfig")) {
    const r = await window.wm.write("yasbConfig", state.yasbConfig);
    if (!r.ok) { msg(r.error, "err"); return false; }
    results.push("yasb config.yaml");
  }

  if (!results.length) { msg("Nothing to save"); return true; }
  clearDirty();
  msg(`Saved ${results.join(", ")} (previous version kept as .bak)`, "ok");
  return true;
}

$("#btn-save").addEventListener("click", save);
$("#btn-reload").addEventListener("click", loadAll);
$("#btn-undo").addEventListener("click", undo);
$("#btn-redo").addEventListener("click", redo);

$("#btn-apply").addEventListener("click", async () => {
  const changed = new Set(state.dirty);
  if (!(await save())) return;

  const needsKomorebi = changed.has("komorebi") || (changed.has("raw") && state.rawKind === "komorebi");
  const needsWhkd = changed.has("whkd") || (changed.has("raw") && state.rawKind === "whkd");
  const needsYasb = changed.has("yasbConfig") || (changed.has("raw") && state.rawKind.startsWith("yasb"));

  if (needsKomorebi) {
    const go = await window.wm.confirm(
      "Restart komorebi?",
      "Your windows will be re-tiled. If it does not come back, a .bak of the previous config is next to komorebi.json."
    );
    if (go) {
      msg("Restarting komorebi...");
      const r = await window.wm.restart("komorebi");
      if (r.ok) {
        msg("komorebi restarted", "ok");
        refreshAfterRestart();
      } else if (state.lastKomorebiBackup) {
        const undo = await window.wm.confirm(
          "komorebi did not come back",
          "The change probably contains a value komorebi rejects. Put the previous config back and start it again?"
        );
        if (undo) {
          await window.wm.restore("komorebi", state.lastKomorebiBackup);
          const again = await window.wm.restart("komorebi");
          msg(again.ok ? "Rolled back, komorebi is running again" : "Rolled back, but komorebi still will not start", again.ok ? "ok" : "err");
          if (again.ok) await loadAll();
        } else {
          msg("komorebi is not running, config left as saved", "err");
        }
      } else {
        msg(`komorebi ${r.detail}`, "err");
      }
    }
  }
  if (needsWhkd) {
    const r = await window.wm.restart("whkd");
    msg(r.ok ? "whkd restarted" : `whkd ${r.detail}`, r.ok ? "ok" : "err");
  }
  if (needsYasb) {
    const r = await window.wm.restart("yasb");
    msg(r.ok ? "bar reloaded" : `bar ${r.detail}`, r.ok ? "ok" : "err");
  }
  refreshStatus();
});

/* ---------- service status ---------- */

async function refreshStatus() {
  const s = await window.wm.status();
  for (const [name, up] of Object.entries(s)) {
    const el = $(`.svc[data-svc="${name}"]`);
    if (el) el.className = "svc " + (up ? "up" : "down");
  }
}

$$("[data-restart]").forEach((b) => b.addEventListener("click", async () => {
  const name = b.dataset.restart;
  b.disabled = true;
  msg(`Restarting ${name}...`);
  const r = await window.wm.restart(name);
  msg(r.ok ? `${name} ${r.detail}` : `${name} ${r.detail}`, r.ok ? "ok" : "err");
  b.disabled = false;
  refreshStatus();
  // A fresh komorebi has re-tiled everything, so the drawing is out of date.
  if (name === "komorebi" && r.ok) refreshAfterRestart();
}));


/* ---------- app rules (applications.json) ---------- */

const RULE_KINDS = ["float", "ignore", "manage"];

async function loadAppRules() {
  const r = await window.wm.read("appRules");
  state.appRules = JSON.parse(r.text);
  renderAppRules();
}

function renderAppRules() {
  const box = $("#app-list");
  const data = state.appRules || {};
  const filter = $("#app-filter").value.toLowerCase();
  const names = Object.keys(data).filter((n) => !n.startsWith("$")).sort((a, b) => a.localeCompare(b));
  const shown = names.filter((n) => !filter || n.toLowerCase().includes(filter));

  $("#app-count").textContent = `${shown.length} of ${names.length}`;
  box.innerHTML = "";

  const head = document.createElement("div");
  head.className = "app-head";
  head.innerHTML = "<span>application</span><span>float</span><span>ignore</span><span>manage</span>";
  box.appendChild(head);

  shown.slice(0, 400).forEach((name) => {
    const rules = data[name] || {};
    const row = document.createElement("div");
    row.className = "app";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = name;
    row.appendChild(nm);

    RULE_KINDS.forEach((kind) => {
      const lab = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Array.isArray(rules[kind]) ? rules[kind].length > 0 : !!rules[kind];
      cb.addEventListener("change", () => {
        if (cb.checked) {
          // komorebi matches on the executable name for these rules
          data[name] = data[name] || {};
          data[name][kind] = [{ kind: "Exe", id: name, matching_strategy: "Equals" }];
        } else if (data[name]) {
          delete data[name][kind];
        }
        markDirty("appRules");
      });
      lab.append(cb);
      row.appendChild(lab);
    });

    box.appendChild(row);
  });

  if (shown.length > 400) {
    const more = document.createElement("div");
    more.className = "note";
    more.textContent = `${shown.length - 400} more hidden. Narrow the filter to see them.`;
    box.appendChild(more);
  }
}

$("#app-filter").addEventListener("input", renderAppRules);

/* ---------- snapshots ---------- */

async function renderSnapshots() {
  const list = await window.wm.snapshots();
  const box = $("#snap-list");
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = '<p class="note">No snapshots yet. Take one while everything works.</p>';
    return;
  }
  list.forEach((snap) => {
    const row = document.createElement("div");
    row.className = "snap";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = snap.name;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = new Date(snap.saved).toLocaleString();

    const restore = document.createElement("button");
    restore.className = "restore";
    restore.textContent = "Restore";
    restore.addEventListener("click", async () => {
      const go = await window.wm.confirm(
        `Restore "${snap.name}"?`,
        "Every config file in the snapshot is written back. The current versions are kept as .bak files."
      );
      if (!go) return;
      const r = await window.wm.snapshotRestore(snap.name);
      if (!r.ok) { msg(r.error, "err"); return; }
      msg(`Restored ${r.restored.join(", ")}. Restart the services to apply.`, "ok");
      await loadAll();
    });

    const rm = document.createElement("button");
    rm.className = "rm";
    rm.textContent = "Delete";
    rm.addEventListener("click", async () => {
      await window.wm.snapshotDelete(snap.name);
      renderSnapshots();
    });

    row.append(nm, when, restore, rm);
    box.appendChild(row);
  });
}

$("#snap-save").addEventListener("click", async () => {
  const name = $("#snap-name").value.trim() || `snapshot ${new Date().toLocaleString()}`;
  const r = await window.wm.snapshotSave(name);
  $("#snap-name").value = "";
  msg(`Saved snapshot "${r.name}" with ${r.saved.length} files`, "ok");
  renderSnapshots();
});

/* ---------- profiles ---------- */

async function renderProfiles() {
  const { profiles, active } = await window.wm.profiles();
  const box = $("#prof-list");
  box.innerHTML = "";
  if (!profiles.length) {
    box.innerHTML =
      '<p class="note">No profiles yet. Set things up how you want them, then save this as one.</p>';
    return;
  }
  profiles.forEach((prof) => {
    const row = document.createElement("div");
    row.className = "snap" + (prof.name === active ? " active" : "");

    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = prof.name;

    const when = document.createElement("span");
    when.className = "when";
    when.textContent = prof.name === active ? "in use" : new Date(prof.saved).toLocaleDateString();

    const use = document.createElement("button");
    use.className = "restore";
    use.textContent = "Switch to";
    use.addEventListener("click", async () => {
      const go = await window.wm.confirm(
        `Switch to "${prof.name}"?`,
        "All four config files are replaced and komorebi, whkd and YASB restart. "
        + "The files being replaced are kept as .bak copies."
      );
      if (!go) return;
      use.disabled = true;
      msg(`Switching to ${prof.name}...`, "warn");
      const r = await window.wm.profileApply(prof.name);
      use.disabled = false;
      if (!r.ok) { msg(r.error, "err"); return; }
      const failed = r.services.filter((s) => !s.ok).map((s) => s.name);
      msg(failed.length
        ? `Switched, but ${failed.join(" and ")} did not come back`
        : `Switched to ${prof.name}`, failed.length ? "warn" : "ok");
      await loadAll();
      renderProfiles();
    });

    const rm = document.createElement("button");
    rm.className = "rm";
    rm.textContent = "Delete";
    rm.addEventListener("click", async () => {
      await window.wm.profileDelete(prof.name);
      renderProfiles();
    });

    row.append(nm, when, use, rm);
    box.appendChild(row);
  });
}

$("#prof-save").addEventListener("click", async () => {
  const name = $("#prof-name").value.trim();
  if (!name) { msg("Give the profile a name first", "warn"); return; }
  const r = await window.wm.profileSave(name);
  $("#prof-name").value = "";
  msg(`Saved "${r.name}" with ${r.saved.length} files`, "ok");
  renderProfiles();
});

/* ---------- health ---------- */

async function runHealth() {
  const box = $("#health-list");
  box.innerHTML = '<p class="note">Checking...</p>';
  const checks = await window.wm.health();
  box.innerHTML = "";
  checks.forEach((c) => {
    const row = document.createElement("div");
    row.className = "hc " + (c.ok ? "ok" : "bad");
    row.innerHTML =
      `<i></i><span class="label">${c.label}</span><span class="detail">${c.detail || ""}</span>`;
    box.appendChild(row);
  });
  const bad = checks.filter((c) => !c.ok).length;
  msg(bad ? `${bad} check${bad === 1 ? "" : "s"} failing` : "All checks passing", bad ? "warn" : "ok");
}

$("#health-run").addEventListener("click", runHealth);

/* ---------- wiring for the added features ---------- */

const wsrAdd = $("#wsr-add");
if (wsrAdd) wsrAdd.addEventListener("click", () => {
  const idx = Number($("#wsr-ws").value);
  if (Number.isInteger(idx)) addWorkspaceRule(idx);
});

// features.js and features2.js load after this file, so anything defined there
// has to be looked up when the handler fires, not when it is attached.
const winRefresh = $("#win-refresh");
if (winRefresh) winRefresh.addEventListener("click", () => renderWindowInspector());
const winFilter = $("#win-filter");
if (winFilter) winFilter.addEventListener("input", () => renderWindowInspector());

const btnDiff = $("#btn-diff");
if (btnDiff) btnDiff.addEventListener("click", async () => {
  $("#diff-modal").hidden = false;
  await showDiff();
});
const diffClose = $("#diff-close");
if (diffClose) diffClose.addEventListener("click", () => { $("#diff-modal").hidden = true; });

// load open windows the first time the App rules tab is opened
$$(".tab").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.view === "apps" && typeof renderWindowInspector === "function") {
    renderWindowInspector();
  }
  if (b.dataset.view === "snapshots") { renderSnapshots(); renderProfiles(); }
  if (b.dataset.view === "map") { refreshMap(); startMapEvents(); }
  // Settings is also drawn at start-up so the palette can find what is in it.
  // Looking up versions is left to this, so opening the app never goes near the
  // network on its own.
  if (b.dataset.view === "settings") {
    renderSettings();
    if (typeof lookUpVersions === "function") lookUpVersions();
  }
}));

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === "s") { e.preventDefault(); save(); }
  else if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (key === "y" || (key === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
});

// Switching workspace hides everything komorebi manages on the one you left,
// including this window. Ignored windows are never hidden, so this asks to be
// left alone. It lasts until komorebi restarts; Settings can make it stick.
async function stayVisible() {
  const r = await window.wm.komorebic(["ignore-rule", "title", "Komorebi Deck"]);
  return r.ok;
}

stayVisible();
$$('input[type="number"]').forEach((el) => dressNumber(el));

// The dropdowns are built from KENUM, so what this komorebi accepts has to be
// known before anything is drawn, and what is missing has to be known before
// the first read fails.
// app.js is loaded before setup.js and search.js, so the start-up work waits
// for the whole page rather than running the moment this file is parsed.
window.addEventListener("DOMContentLoaded", async () => {
  const [live] = await Promise.all([applySchema(), checkSetup(), loadTools()]);
  if (live?.changed.length) {
    msg(`Read the options from your komorebi${live.version ? ` ${live.version}` : ""}, `
      + `${live.changed.length} differ from the ones shipped with this app.`, "ok");
  }
  await loadAll().catch((e) => msg(String(e), "err"));
});
renderSnapshots();
refreshStatus();
setInterval(refreshStatus, 5000);
