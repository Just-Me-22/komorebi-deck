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

  box.appendChild(choiceRow("Theme", "light or dark",
    [["dark", "Dark"], ["light", "Light"]], ui.theme, set("theme")));

  const swatches = document.createElement("div");
  swatches.className = "accent-grid";
  ACCENTS.forEach(([hex, name]) => {
    const b = document.createElement("button");
    b.className = "accent" + (hex === ui.accent ? " active" : "");
    b.style.setProperty("--sw", hex);
    b.innerHTML = `<i></i><span>${name}</span>`;
    b.addEventListener("click", () => set("accent")(hex));
    swatches.appendChild(b);
  });

  const custom = document.createElement("input");
  custom.type = "color";
  custom.value = ui.accent;
  custom.title = "Any colour you like";
  custom.addEventListener("change", () => set("accent")(custom.value));

  const accentRow = document.createElement("div");
  accentRow.className = "row";
  accentRow.innerHTML = '<span class="lbl">Accent<em>focus, selection and anything good</em></span>';
  accentRow.appendChild(custom);
  box.append(accentRow, swatches);

  const shown = fitAccent(ui.accent, GROUNDS[ui.theme]);
  const ratio = contrast(shown, GROUNDS[ui.theme]).toFixed(1);
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = shown.toLowerCase() === ui.accent.toLowerCase()
    ? `Contrast against the background: ${ratio} to 1.`
    : `Adjusted to ${shown} so it stays readable on this background, now ${ratio} to 1.`;
  box.appendChild(note);

  box.appendChild(choiceRow("Row spacing", "how much air between settings",
    [["normal", "Normal"], ["compact", "Compact"]], ui.density, set("density")));
  box.appendChild(choiceRow("Motion", "the animation preview and nothing else",
    [["on", "On"], ["off", "Off"]], ui.motion, set("motion")));
  box.appendChild(choiceRow("Always on top", "stays above other windows whatever komorebi does",
    [["yes", "Yes"], ["no", "No"]], ui.onTop, set("onTop")));

  const stay = document.createElement("div");
  stay.className = "row";
  stay.innerHTML = '<span class="lbl">Never hide this window'
    + '<em>komorebi ignore rule on the title</em></span>';
  const stayBtn = document.createElement("button");
  const already = (state.komorebi?.ignore_rules || [])
    .some((r) => r && r.kind === "Title" && r.id === "WM Control");
  stayBtn.className = "ghost";
  stayBtn.textContent = already ? "Already permanent" : "Make it permanent";
  stayBtn.disabled = already;
  stayBtn.addEventListener("click", () => {
    const rules = (state.komorebi.ignore_rules = state.komorebi.ignore_rules || []);
    rules.push({ kind: "Title", id: "WM Control", matching_strategy: "Equals" });
    markDirty("komorebi");
    if (typeof renderIgnoreRules === "function") renderIgnoreRules();
    msg("Added to your ignore rules. Save to keep it.", "ok");
    renderSettings();
  });
  stay.appendChild(stayBtn);
  box.appendChild(stay);

  const stayNote = document.createElement("p");
  stayNote.className = "note";
  stayNote.textContent = already
    ? "This window is in your ignore rules, so komorebi leaves it alone on every workspace."
    : "The app already asks komorebi to leave it alone each time it starts, so it will not "
      + "vanish when you switch workspace. Making it permanent writes the same rule into "
      + "your config so it survives a komorebi restart.";
  box.appendChild(stayNote);

  const reset = document.createElement("button");
  reset.className = "ghost";
  reset.textContent = "Back to the defaults";
  reset.addEventListener("click", () => {
    saveUI(UI_DEFAULTS);
    applyUI(UI_DEFAULTS);
    renderSettings();
  });
  const bar = document.createElement("div");
  bar.className = "sc-toolbar";
  bar.appendChild(reset);
  box.appendChild(bar);
}

function choiceRow(label, hint, options, current, onPick) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<span class="lbl">${label}<em>${hint}</em></span>`;
  const group = document.createElement("div");
  group.className = "seg";
  options.forEach(([value, text]) => {
    const b = document.createElement("button");
    b.className = "seg-opt" + (value === current ? " active" : "");
    b.textContent = text;
    b.addEventListener("click", () => onPick(value));
    group.appendChild(b);
  });
  row.appendChild(group);
  return row;
}

applyUI(loadUI());
