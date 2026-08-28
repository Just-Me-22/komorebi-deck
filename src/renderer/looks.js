/* Appearance settings. Nearly everything here has a komorebic command, so it
   can be sent to the running komorebi instead of waiting for a restart. */

const kebab = (v) => String(v).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

// A negative number looks like a flag to komorebic's parser, so it has to sit
// after a `--` separator. Any real flags go before it, since `--` ends them.
const posArg = (v) => (String(v).startsWith("-") ? ["--", String(v)] : [String(v)]);

// Flat komorebi.json keys that komorebic can change on a running instance.
const LIVE = {
  border: (v) => ["border", v ? "enable" : "disable"],
  border_width: (v) => ["border-width", ...posArg(v)],
  border_offset: (v) => ["border-offset", ...posArg(v)],
  border_style: (v) => ["border-style", kebab(v)],
  border_implementation: (v) => ["border-implementation", kebab(v)],
  transparency: (v) => ["transparency", v ? "enable" : "disable"],
  transparency_alpha: (v) => ["transparency-alpha", ...posArg(v)],
  resize_delta: (v) => ["resize-delta", ...posArg(v)],
  mouse_follows_focus: (v) => ["mouse-follows-focus", v ? "enable" : "disable"],
};

function liveOn() {
  const el = document.querySelector("#live-apply");
  return !!el && el.checked;
}

async function liveSend(args, label) {
  if (!liveOn()) return;
  const r = await window.wm.komorebic(args);
  if (r.ok) msg(`${label} applied`, "ok");
  else msg(`${label}: ${r.output.split("\n")[0]}`, "err");
}

function liveApply(key, value) {
  const build = LIVE[key];
  if (build) liveSend(build(value), key);
}

// border-colour wants three 0-255 channels and a window kind, not a colour name.
function liveBorderColour(role, hex) {
  if (!hex) return;
  const rgb = [1, 3, 5].map((i) => String(parseInt(hex.slice(i, i + 2), 16)));
  liveSend(["border-colour", "-w", role.replace(/_/g, "-"), ...rgb], role);
}

/* ---------- border colours ---------- */

// Two ways to colour borders, and they are mutually exclusive: a named palette
// in `theme`, or free hex in `border_colours`, which komorebi ignores whenever
// `theme` is present. Switching stashes the block being left behind so nothing
// is lost by trying the other one.
let stashedTheme = null;
let stashedCustom = null;

const roleOf = (themeKey) => themeKey.replace(/_border$/, "");

function paletteMode() {
  return state.komorebi.theme ? "Catppuccin" : "Custom";
}

function colourFor(themeKey) {
  const c = state.komorebi;
  if (c.theme) return palette()[c.theme[themeKey]] || "#000000";
  return c.border_colours?.[roleOf(themeKey)] || "#000000";
}

function switchPalette(mode) {
  const c = state.komorebi;
  if (mode === "Custom") {
    stashedTheme = c.theme;
    c.border_colours = stashedCustom || Object.fromEntries(
      BORDER_KEYS.map(([k]) => [roleOf(k), colourFor(k)]));
    delete c.theme;
  } else {
    stashedCustom = c.border_colours;
    c.theme = stashedTheme || { palette: "Catppuccin", name: "Mocha" };
    delete c.border_colours;
  }
  markDirty("komorebi");
  renderBorderColours();
  renderStackbar();
}

function paletteControls() {
  const wrap = document.createElement("div");
  wrap.className = "palette-mode";

  const mode = document.createElement("select");
  fillSelect(mode, ["Catppuccin", "Custom"], paletteMode());
  mode.addEventListener("change", () => switchPalette(mode.value));
  wrap.appendChild(mode);

  if (paletteMode() === "Catppuccin") {
    const flavour = document.createElement("select");
    fillSelect(flavour, ["Mocha", "Macchiato", "Frappe", "Latte"],
      state.komorebi.theme.name || "Mocha");
    flavour.addEventListener("change", () => {
      state.komorebi.theme.name = flavour.value;
      markDirty("komorebi");
      // Every border keeps its colour name but the name now means a different
      // hex, so all six have to be redrawn and re-sent.
      renderBorderColours();
      renderPreviews();
      BORDER_KEYS.forEach(([key]) =>
        liveBorderColour(roleOf(key), palette()[state.komorebi.theme[key]]));
    });
    wrap.appendChild(flavour);
  }

  const hint = document.createElement("span");
  hint.className = "palette-hint";
  hint.textContent = paletteMode() === "Catppuccin"
    ? "Named colours from the Catppuccin palette."
    : "Any colour you like, written to border_colours.";
  wrap.appendChild(hint);
  return wrap;
}

function colourCell(themeKey, label) {
  const cell = document.createElement("div");
  cell.className = "colour";
  cell.dataset.explain = themeKey;
  cell.innerHTML =
    `<div class="meta"><span>${label}</span><em>${themeKey}</em></div>`;

  const pick = document.createElement("div");
  pick.className = "pick";

  if (paletteMode() === "Catppuccin") {
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.style.background = colourFor(themeKey);
    const sel = document.createElement("select");
    fillSelect(sel, CATPPUCCIN_NAMES, state.komorebi.theme[themeKey]);
    sel.addEventListener("change", () => {
      state.komorebi.theme[themeKey] = sel.value;
      sw.style.background = palette()[sel.value];
      markDirty("komorebi");
      renderPreviews();
      liveBorderColour(roleOf(themeKey), palette()[sel.value]);
    });
    pick.append(sw, sel);
  } else {
    const role = roleOf(themeKey);
    const input = document.createElement("input");
    input.type = "color";
    input.value = colourFor(themeKey);
    const hex = document.createElement("span");
    hex.className = "hex";
    hex.textContent = input.value;
    input.addEventListener("input", () => { hex.textContent = input.value; });
    input.addEventListener("change", () => {
      state.komorebi.border_colours[role] = input.value;
      markDirty("komorebi");
      renderPreviews();
      liveBorderColour(role, input.value);
    });
    pick.append(input, hex);
  }

  cell.appendChild(pick);
  return cell;
}

function renderBorderColours() {
  const box = document.querySelector("#colours");
  if (!box || !state.komorebi) return;
  box.innerHTML = "";

  const theme = state.komorebi.theme;
  if (theme && theme.palette !== "Catppuccin") {
    box.innerHTML =
      `<p class="note">Your theme uses the ${theme.palette} palette, which this screen `
      + "does not edit. Change it under Raw files, or delete the theme block to pick colours freely.</p>";
    return;
  }

  const grid = document.createElement("div");
  grid.className = "colour-grid";
  BORDER_KEYS.forEach(([key, label]) => grid.appendChild(colourCell(key, label)));

  const note = document.createElement("p");
  note.className = "note";
  note.textContent = paletteMode() === "Catppuccin"
    ? "Switch to Custom for any colour. That replaces the theme block with border_colours, "
      + "which komorebi ignores while a theme is set."
    : "The theme block is gone while this is Custom, so the stackbar takes its colours from "
      + "its own settings. Switching back restores the palette you had.";

  box.append(paletteControls(), grid, note);
}

/* ---------- animation ---------- */

const ANIM_DEFAULTS = { enabled: false, duration: 250, style: "Linear" };

// Where the other 31 easings are a name, a custom one is a bare array of four
// numbers, in the same order and meaning CSS gives cubic-bezier. The schema
// describes it as { CubicBezier: [...] } instead, which komorebi will not read:
// AnimationStyle deserialises by hand from a string or a four-element array, and
// the object form is an artefact of how the schema is generated.
const BEZIER_DEFAULT = [0.4, 0, 0.2, 1];
const bezierOf = (style) => (Array.isArray(style) && style.length === 4 ? style : null);
const copyStyle = (v) => (bezierOf(v) ? [...v] : v);

// `enabled` is the one required field, so a block created here has to carry it.
const animBlock = () =>
  (state.komorebi.animation = state.komorebi.animation || { enabled: false });

// animation.enabled/duration/style are each either one value for everything,
// or an object keyed by animation kind. Both shapes are valid config.
function animSplit() {
  return typeof state.komorebi.animation?.enabled === "object";
}

function animGet(field, kind) {
  const v = state.komorebi.animation?.[field];
  const val = animSplit() ? v?.[kind] : v;
  return val === undefined ? ANIM_DEFAULTS[field] : val;
}

function animSet(field, kind, value) {
  const a = animBlock();
  if (animSplit()) {
    a[field] = typeof a[field] === "object" && a[field] !== null ? a[field] : {};
    a[field][kind] = value;
  } else {
    a[field] = value;
  }
  markDirty("komorebi");
}

function animSetSplit(on) {
  const a = animBlock();
  for (const field of ["enabled", "duration", "style"]) {
    const cur = a[field];
    if (on) {
      const v = cur === undefined ? ANIM_DEFAULTS[field] : cur;
      a[field] = { movement: copyStyle(v), transparency: copyStyle(v) };
    } else if (cur && typeof cur === "object" && !bezierOf(cur)) {
      // A custom curve is an array, so it is already one value for everything
      // and there is no per-kind map here to pull `movement` back out of.
      a[field] = cur.movement ?? ANIM_DEFAULTS[field];
    }
  }
  markDirty("komorebi");
  renderAnimation();
}

function animLive(field, kind, value) {
  const scope = kind ? ["-a", kind] : [];
  const label = kind ? `${field} (${kind})` : field;
  if (field === "enabled") liveSend(["animation", value ? "enable" : "disable", ...scope], label);
  if (field === "duration") liveSend(["animation-duration", ...scope, ...posArg(value)], label);
  // komorebic takes an easing by name and has no way to pass four numbers, so a
  // custom curve is the one animation setting that only lands on a restart.
  if (field === "style" && !bezierOf(value)) {
    liveSend(["animation-style", "-s", kebab(value), ...scope], label);
  }
}

function animRow(field, kind, label, hint) {
  const row = document.createElement("label");
  row.className = "row";
  row.innerHTML = `<span class="lbl">${label}<em>${hint}</em></span>`;

  let input;
  if (field === "enabled") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!animGet(field, kind);
  } else if (field === "duration") {
    input = document.createElement("input");
    input.type = "number";
    input.min = 0;
    input.max = 2000;
    input.value = animGet(field, kind);
  } else {
    input = document.createElement("select");
    const cur = animGet(field, kind);
    fillSelect(input, [...KENUM.EASING, "CubicBezier"], bezierOf(cur) ? "CubicBezier" : cur);
    input.querySelector('[value="CubicBezier"]').textContent = "Custom curve";
  }

  input.addEventListener("change", () => {
    const v = field === "enabled" ? input.checked
      : field === "duration" ? Number(input.value)
      : input.value !== "CubicBezier" ? input.value
      : [...(bezierOf(animGet("style", kind)) || BEZIER_DEFAULT)];
    animSet(field, kind, v);
    animLive(field, kind, v);
    renderPreviews();
    document.querySelector("#pv-easing")?.scrollIntoView({ block: "nearest" });
  });

  row.appendChild(input.type === "number" ? dressNumber(input) : input);
  return row;
}

function renderAnimation() {
  const box = document.querySelector("#anim");
  if (!box || !state.komorebi) return;
  const a = state.komorebi.animation || {};
  const split = animSplit();
  box.innerHTML = "";

  const toggle = document.createElement("label");
  toggle.className = "row";
  toggle.innerHTML =
    '<span class="lbl">Set movement and fade separately<em>animation kinds</em></span>';
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = split;
  cb.addEventListener("change", () => animSetSplit(cb.checked));
  toggle.appendChild(cb);
  box.appendChild(toggle);

  if (split) {
    for (const [kind, title] of [["movement", "Movement"], ["transparency", "Fade"]]) {
      const card = document.createElement("div");
      card.className = "lr-card";
      card.innerHTML = `<div class="lr-head"><strong>${title}</strong></div>`;
      card.append(
        animRow("enabled", kind, "Animate", `animation.enabled.${kind}`),
        animRow("duration", kind, "Duration in milliseconds", `animation.duration.${kind}`),
        animRow("style", kind, "Easing curve", `animation.style.${kind}`),
      );
      box.appendChild(card);
    }
  } else {
    box.append(
      animRow("enabled", null, "Animate", "animation.enabled"),
      animRow("duration", null, "Duration in milliseconds", "animation.duration"),
      animRow("style", null, "Easing curve", "animation.style"),
    );
  }

  const fps = document.createElement("label");
  fps.className = "row";
  fps.innerHTML = '<span class="lbl">Frames per second<em>animation.fps</em></span>';
  const fpsIn = document.createElement("input");
  fpsIn.type = "number";
  fpsIn.min = 1;
  fpsIn.max = 240;
  fpsIn.value = a.fps ?? 60;
  fpsIn.addEventListener("change", () => {
    animBlock().fps = Number(fpsIn.value);
    markDirty("komorebi");
    liveSend(["animation-fps", ...posArg(fpsIn.value)], "fps");
  });
  fps.appendChild(dressNumber(fpsIn));

  const ghost = document.createElement("label");
  ghost.className = "row";
  ghost.innerHTML =
    '<span class="lbl">Animate on the GPU<em>animation.ghost_movement, needs a restart</em></span>';
  const ghostIn = document.createElement("input");
  ghostIn.type = "checkbox";
  ghostIn.checked = !!a.ghost_movement;
  ghostIn.addEventListener("change", () => {
    animBlock().ghost_movement = ghostIn.checked;
    markDirty("komorebi");
  });
  ghost.appendChild(ghostIn);

  const note = document.createElement("p");
  note.className = "note";
  note.textContent =
    "Movement is windows sliding into place. Fade is the transparency change on focus, "
    + "so it only does anything with transparency turned on.";

  box.append(fps, ghost, note);
}

/* ---------- stackbar ---------- */

function stackRow(label, hint, input) {
  const row = document.createElement("label");
  row.className = "row";
  row.innerHTML = `<span class="lbl">${label}<em>${hint}</em></span>`;
  row.appendChild(input);
  return row;
}

function stackInput(kind, value, onChange) {
  const el = document.createElement("input");
  el.type = kind;
  el.value = value;
  el.addEventListener("change", () =>
    onChange(kind === "number" ? Number(el.value) : el.value));
  return el;
}

function renderStackbar() {
  const box = document.querySelector("#stackbar");
  if (!box || !state.komorebi) return;
  const sb = state.komorebi.stackbar || {};
  const tabs = sb.tabs || {};
  box.innerHTML = "";

  // Written lazily so a config without a stackbar block does not grow one just
  // by opening the tab.
  const bar = () => (state.komorebi.stackbar = state.komorebi.stackbar || {});
  const setBar = (key) => (v) => { bar()[key] = v; markDirty("komorebi"); renderPreviews(); };
  const setTab = (key) => (v) => {
    const b = bar();
    (b.tabs = b.tabs || {})[key] = v;
    markDirty("komorebi");
    renderPreviews();
  };

  const mode = document.createElement("select");
  fillSelect(mode, KENUM.STACKBAR_MODES, sb.mode || "Never");
  mode.addEventListener("change", () => {
    bar().mode = mode.value;
    markDirty("komorebi");
    liveSend(["stackbar-mode", kebab(mode.value)], "stackbar mode");
    renderStackbar();
  });

  const label = document.createElement("select");
  fillSelect(label, KENUM.STACKBAR_LABELS, sb.label || "Process");
  label.addEventListener("change", () => { bar().label = label.value; markDirty("komorebi"); });

  box.append(
    stackRow("When to show it", "stackbar.mode", mode),
    stackRow("Bar height", "stackbar.height", stackInput("number", sb.height ?? 20, setBar("height"))),
    stackRow("Tab text", "stackbar.label", label),
    stackRow("Tab width", "tabs.width", stackInput("number", tabs.width ?? 200, setTab("width"))),
    stackRow("Font", "tabs.font_family", stackInput("text", tabs.font_family ?? "Segoe UI", setTab("font_family"))),
    stackRow("Font size", "tabs.font_size", stackInput("number", tabs.font_size ?? 12, setTab("font_size"))),
    stackRow("Tab background", "tabs.background", stackInput("color", tabs.background ?? "#1e1e2e", setTab("background"))),
    stackRow("Focused tab text", "tabs.focused_text", stackInput("color", tabs.focused_text ?? "#ffffff", setTab("focused_text"))),
    stackRow("Unfocused tab text", "tabs.unfocused_text", stackInput("color", tabs.unfocused_text ?? "#cdd6f4", setTab("unfocused_text"))),
  );

  const themed = Object.keys(state.komorebi.theme || {}).some((k) => k.startsWith("stackbar_"));
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = (sb.mode || "Never") === "Never"
    ? "Never means the stackbar cannot appear, whatever else is set here. Use OnStack to show it when a container holds more than one window."
    : "Only the mode applies live, the rest needs a restart."
      + (themed ? " Your theme block sets stackbar colours too; if these are ignored, clear the stackbar_ entries there." : "");
  box.appendChild(note);
}

/* ---------- applications that should never fade ---------- */

function renderTransparencyIgnore() {
  const box = document.querySelector("#tr-ignore");
  if (!box || !state.komorebi) return;
  const rules = state.komorebi.transparency_ignore_rules || [];
  ruleList(box, rules, renderTransparencyIgnore,
    "Nothing listed. Video players are the usual reason to add one.");
  if (!rules.length) delete state.komorebi.transparency_ignore_rules;
}

/* ---------- wallpaper ---------- */

// Per workspace, on whichever screen is selected on the Window manager tab.
function renderWallpaper() {
  const box = document.querySelector("#wallpaper");
  if (!box || !state.komorebi) return;
  const spaces = activeMonitor()?.workspaces || [];
  box.innerHTML = "";

  spaces.forEach((w, i) => {
    const row = document.createElement("div");
    row.className = "wall-row";
    row.dataset.explain = "wallpaper";

    const name = document.createElement("span");
    name.className = "wall-name";
    name.textContent = w.name || `Workspace ${i + 1}`;

    const path = document.createElement("span");
    path.className = "wall-path";
    path.textContent = w.wallpaper?.path || "none";
    path.title = w.wallpaper?.path || "";

    const theme = document.createElement("label");
    theme.className = "wall-theme";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = w.wallpaper?.generate_theme !== false;
    cb.disabled = !w.wallpaper;
    cb.addEventListener("change", () => {
      w.wallpaper.generate_theme = cb.checked;
      markDirty("komorebi");
    });
    theme.append(cb, document.createTextNode("theme from image"));

    const browse = document.createElement("button");
    browse.className = "ghost small";
    browse.textContent = w.wallpaper ? "Change" : "Choose";
    browse.addEventListener("click", async () => {
      const file = await window.wm.pickImage();
      if (!file) return;
      w.wallpaper = { path: file, generate_theme: w.wallpaper?.generate_theme ?? false };
      markDirty("komorebi");
      renderWallpaper();
    });

    const rm = document.createElement("button");
    rm.className = "del";
    rm.textContent = "×";
    rm.title = "Remove this wallpaper";
    rm.disabled = !w.wallpaper;
    rm.addEventListener("click", () => {
      delete w.wallpaper;
      markDirty("komorebi");
      renderWallpaper();
    });

    row.append(name, path, theme, browse, rm);
    box.appendChild(row);
  });

  const gaps = spaces.filter((w) => !w.wallpaper).length;
  if (gaps && spaces.some((w) => w.wallpaper)) {
    const fix = document.createElement("div");
    fix.className = "sc-toolbar";
    const b = document.createElement("button");
    b.className = "ghost";
    b.textContent = `Fill the other ${gaps} with my current wallpaper`;
    b.addEventListener("click", async () => {
      const file = await window.wm.currentWallpaper();
      if (!file) { msg("Could not work out your current wallpaper", "err"); return; }
      spaces.forEach((w) => {
        if (!w.wallpaper) w.wallpaper = { path: file, generate_theme: false };
      });
      markDirty("komorebi");
      renderWallpaper();
    });
    fix.appendChild(b);
    box.appendChild(fix);
  }

  const note = document.createElement("p");
  note.className = "note";
  note.textContent = gaps && spaces.some((w) => w.wallpaper)
    ? "komorebi sets the wallpaper when you enter a workspace that has one, and does nothing "
      + "when you enter one that does not, so the last picture stays up. Give every workspace "
      + "a wallpaper and that stops happening."
    : "These are the workspaces on the screen selected under Window manager. Theme from image "
      + "asks komorebi to build a Base16 palette out of the picture, which then overrides the "
      + "border colours above.";
  box.appendChild(note);
}

function renderLooks() {
  const c = state.komorebi;
  if (!c) return;
  // Only the options. What is selected, here and for border, border_offset and
  // transparency_alpha, is applyValues' job: these used to carry their own
  // hardcoded fallbacks, which was a second set of komorebi's defaults kept by
  // hand and free to drift from the ones komorebi reports.
  fillSelect(document.querySelector('[data-key="border_implementation"]'),
    KENUM.BORDER_IMPLEMENTATIONS, c.border_implementation ?? state.defaults.border_implementation);

  renderBorderColours();
  renderWallpaper();
  renderAnimation();
  renderStackbar();
  renderTransparencyIgnore();
}

document.querySelector("#tr-add").addEventListener("click", () => {
  const rules = (state.komorebi.transparency_ignore_rules =
    state.komorebi.transparency_ignore_rules || []);
  rules.push({ kind: "Exe", id: "", matching_strategy: "Equals" });
  markDirty("komorebi");
  renderTransparencyIgnore();
});

document.querySelector('[data-key="transparency_alpha"]').addEventListener("input", (e) => {
  document.querySelector("#alpha-out").textContent = e.target.value;
});
