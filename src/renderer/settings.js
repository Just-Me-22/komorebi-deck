/* How the app itself looks. Everything here is a CSS variable on the root
   element and a line in localStorage, so nothing about your komorebi config is
   involved. */

const UI_DEFAULTS = {
  theme: "dark", accent: "#6d8cff", density: "normal", motion: "on", onTop: "yes",
};

const ACCENTS = [
  ["#6d8cff", "Aurora"],
  ["#5ad1c4", "Lagoon"],
  ["#c4a7e7", "Iris"],
  ["#f2789b", "Rose"],
  ["#e8a33d", "Amber"],
  ["#8fd694", "Fern"],
  ["#ff8f5e", "Ember"],
  ["#cdd3e0", "Bone"],
];

function loadUI() {
  try {
    return { ...UI_DEFAULTS, ...JSON.parse(localStorage.getItem("wm-ui") || "{}") };
  } catch {
    return { ...UI_DEFAULTS };
  }
}

function saveUI(ui) {
  try { localStorage.setItem("wm-ui", JSON.stringify(ui)); } catch {}
}

/* ---------- contrast ---------- */

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => srgb(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function mix(hex, towards, amount) {
  const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const other = [1, 3, 5].map((i) => parseInt(towards.slice(i, i + 2), 16));
  return "#" + parts
    .map((v, i) => Math.round(v + (other[i] - v) * amount).toString(16).padStart(2, "0"))
    .join("");
}

// An accent has to be walked AWAY from the ground it sits on: darker on light,
// lighter on dark. Walking it the wrong way makes an unreadable colour worse.
function fitAccent(hex, ground) {
  const away = luminance(ground) > 0.4 ? "#000000" : "#ffffff";
  let out = hex;
  for (let i = 0; i < 24 && contrast(out, ground) < 4.5; i++) out = mix(out, away, 0.07);
  return out;
}

/* ---------- applying ---------- */

const GROUNDS = { dark: "#0e1117", light: "#eef0f4" };

function applyUI(ui) {
  const root = document.documentElement;
  root.dataset.theme = ui.theme;
  root.dataset.density = ui.density;
  root.dataset.motion = ui.motion;
  window.wm.onTop(ui.onTop !== "no");

  const ground = GROUNDS[ui.theme];
  const accent = fitAccent(ui.accent, ground);
  root.style.setProperty("--glow", accent);
  root.style.setProperty("--glow-dim", mix(accent, ground, 0.42));
}

/* ---------- the tab ---------- */

function group(title, ...children) {
  const box = document.createElement("div");
  box.className = "group";
  box.innerHTML = `<h2>${title}</h2>`;
  box.append(...children);
  return box;
}

function renderSettings() {
  const box = document.querySelector("#settings");
  if (!box) return;
  const ui = loadUI();
  box.innerHTML = "";

  const set = (key) => (value) => {
    const next = { ...loadUI(), [key]: value };
    saveUI(next);
    applyUI(next);
    renderSettings();
    if (typeof renderPreviews === "function") renderPreviews();
  };

  box.appendChild(group("Colour",
    choiceRow("Theme", "light or dark",
      [["dark", "Dark"], ["light", "Light"]], ui.theme, set("theme")),
    accentPicker(ui, set)));

  box.appendChild(group("Layout",
    choiceRow("Row spacing", "how much air between settings",
      [["normal", "Normal"], ["compact", "Compact"]], ui.density, set("density")),
    choiceRow("Motion", "the animation preview and nothing else",
      [["on", "On"], ["off", "Off"]], ui.motion, set("motion"))));

  const behaviour = group("This window",
    choiceRow("Always on top", "stays above other windows whatever komorebi does",
      [["yes", "Yes"], ["no", "No"]], ui.onTop, set("onTop")));
  box.appendChild(behaviour);

  const stay = document.createElement("div");
  stay.className = "row";
  stay.innerHTML = '<span class="lbl">Never hide this window'
    + '<em>komorebi ignore rule on the title</em></span>';
  const stayBtn = document.createElement("button");
  const already = (state.komorebi?.ignore_rules || [])
    .some((r) => r && r.kind === "Title" && r.id === "Komorebi Deck");
  stayBtn.className = "ghost";
  stayBtn.textContent = already ? "Already permanent" : "Make it permanent";
  stayBtn.disabled = already;
  stayBtn.addEventListener("click", () => {
    const rules = (state.komorebi.ignore_rules = state.komorebi.ignore_rules || []);
    rules.push({ kind: "Title", id: "Komorebi Deck", matching_strategy: "Equals" });
    markDirty("komorebi");
    if (typeof renderIgnoreRules === "function") renderIgnoreRules();
    msg("Added to your ignore rules. Save to keep it.", "ok");
    renderSettings();
  });
  stay.appendChild(stayBtn);
  behaviour.appendChild(stay);

  const stayNote = document.createElement("p");
  stayNote.className = "note";
  stayNote.textContent = already
    ? "This window is in your ignore rules, so komorebi leaves it alone on every workspace."
    : "The app already asks komorebi to leave it alone each time it starts, so it will not "
      + "vanish when you switch workspace. Making it permanent writes the same rule into "
      + "your config so it survives a komorebi restart.";
  behaviour.appendChild(stayNote);

  // Filled after it is in the document: renderTools finds its container by id,
  // which does not work while the container is still a loose element.
  box.appendChild(toolsSection());
  if (typeof renderTools === "function") renderTools();

  const reset = document.createElement("button");
  reset.className = "ghost";
  reset.textContent = "Back to the defaults";
  reset.addEventListener("click", () => {
    saveUI(UI_DEFAULTS);
    applyUI(UI_DEFAULTS);
    renderSettings();
  });
  const bar = document.createElement("div");
  bar.className = "sc-toolbar reset";
  bar.appendChild(reset);
  box.appendChild(bar);

  // There is no installer and no auto-update, so this is the only place someone
  // can find out which build they unzipped.
  const version = document.createElement("p");
  version.className = "note";
  version.textContent = `Komorebi Deck ${window.wm.version}`;
  box.appendChild(version);

  if (typeof setupGroups === "function") setupGroups();
}

// The three programs this app drives. Rendered here rather than behind a
// keyboard shortcut, because someone who does not have one of them has no
// reason to know the shortcut exists.
function toolsSection() {
  const list = document.createElement("div");
  list.className = "tool-list";
  list.id = "tools-list";

  const note = document.createElement("p");
  note.className = "note";
  note.id = "tools-note";

  const bar = document.createElement("div");
  bar.className = "sc-toolbar";
  const again = document.createElement("button");
  again.className = "ghost";
  again.textContent = "Check for updates";
  again.addEventListener("click", async () => {
    again.disabled = true;
    await lookUpVersions(true);
    again.disabled = false;
  });
  bar.appendChild(again);

  const group = document.createElement("div");
  group.className = "group";
  group.innerHTML = "<h2>komorebi, whkd and YASB</h2>";
  group.append(list, note, bar);

  return group;
}

/* ---------- accent ---------- */

// A tick sits on the chosen colour, so it takes whichever of black or white
// reads better on it. A luminance threshold was not good enough: Rose, Amber and
// Ember all sit near the middle and were getting a white tick at 2.2 to 1.
function tint(el, colour) {
  el.style.setProperty("--sw", colour);
  const dark = contrast("#000000", colour) >= contrast("#ffffff", colour);
  el.style.setProperty("--tick", dark ? "#000000" : "#ffffff");
}

const TICK = '<i><svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M5 12.5l4.5 4.5L19 7.5"/></svg></i>';

// The colour is the control. A named chip with a small square beside it made
// eight near-identical buttons, and the one thing that separates them was the
// smallest part of each.
function accentPicker(ui, set) {
  const wrap = document.createElement("div");
  wrap.className = "accent-block";
  wrap.innerHTML = '<span class="lbl">Accent<em>focus, selection and anything good</em></span>';

  const grid = document.createElement("div");
  grid.className = "swatches";
  ACCENTS.forEach(([hex, name]) => {
    const b = document.createElement("button");
    b.className = "swatch" + (hex.toLowerCase() === ui.accent.toLowerCase() ? " on" : "");
    // The tile shows what this colour becomes on the theme you are on, not the
    // hex it started as, because on a light ground several of them darken.
    tint(b, fitAccent(hex, GROUNDS[ui.theme]));
    b.innerHTML = TICK + `<span>${name}</span>`;
    b.title = hex;
    b.addEventListener("click", () => set("accent")(hex));
    grid.appendChild(b);
  });

  const own = ACCENTS.every(([hex]) => hex.toLowerCase() !== ui.accent.toLowerCase());
  const pick = document.createElement("label");
  pick.className = "swatch custom" + (own ? " on" : "");
  tint(pick, fitAccent(ui.accent, GROUNDS[ui.theme]));
  pick.innerHTML = TICK + "<span>Your own</span>";
  const custom = document.createElement("input");
  custom.type = "color";
  custom.value = ui.accent;
  custom.addEventListener("change", () => set("accent")(custom.value));
  pick.appendChild(custom);
  grid.appendChild(pick);
  wrap.appendChild(grid);

  const shown = fitAccent(ui.accent, GROUNDS[ui.theme]);
  const ratio = contrast(shown, GROUNDS[ui.theme]).toFixed(1);
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = shown.toLowerCase() === ui.accent.toLowerCase()
    ? `Contrast against the background: ${ratio} to 1.`
    : `Lightened to ${shown} so it still reads on this background, now ${ratio} to 1.`;
  wrap.appendChild(note);
  return wrap;
}

function choiceRow(label, hint, options, current, onPick) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<span class="lbl">${label}<em>${hint}</em></span>`;
  const seg = document.createElement("div");
  seg.className = "seg";
  options.forEach(([value, text]) => {
    const b = document.createElement("button");
    b.className = "seg-opt" + (value === current ? " active" : "");
    b.textContent = text;
    b.addEventListener("click", () => onPick(value));
    seg.appendChild(b);
  });
  row.appendChild(seg);
  return row;
}

applyUI(loadUI());
