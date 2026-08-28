/* Finding a setting among a hundred of them.

   Two ways in, one index. Ctrl+K opens a palette that searches every tab plus
   the things the footer and the rail can do, and jumps to whatever you pick.
   The box in each header filters that tab in place, for when you already know
   roughly where you are and just want the noise gone.

   The index is read off the page rather than kept alongside it, so a setting
   added to the HTML is searchable without being registered anywhere. */

function labelText(lbl) {
  const own = [...lbl.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join("")
    .trim();
  return own || lbl.textContent.trim();
}

function indexRows() {
  const out = [];
  document.querySelectorAll("section.view").forEach((view) => {
    const name = view.id.replace("view-", "");
    const tab = document.querySelector(`.tab[data-view="${name}"]`);
    view.querySelectorAll(".row").forEach((row) => {
      const lbl = row.querySelector(".lbl");
      if (!lbl) return;
      out.push({
        kind: "setting",
        view: name,
        tab: tab ? tab.textContent : name,
        group: row.closest(".group")?.querySelector("h2")?.textContent || "",
        label: labelText(lbl),
        key: lbl.querySelector("em")?.textContent.trim() || "",
        row,
      });
    });
  });
  return out;
}

// Every term has to appear somewhere, and where the first one lands decides the
// order, so typing "gap" puts "Gap between windows" above a row that only
// mentions gaps in its config key.
function rank(entry, terms) {
  const label = entry.label.toLowerCase();
  const rest = `${entry.key} ${entry.group} ${entry.tab}`.toLowerCase();
  const hay = `${label} ${rest}`;
  if (!terms.every((t) => hay.includes(t))) return -1;
  const first = terms[0];
  if (label.startsWith(first)) return 0;
  if (label.includes(first)) return 1;
  if (entry.key.toLowerCase().includes(first)) return 2;
  return 3;
}

const terms = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);

function search(entries, q) {
  const t = terms(q);
  if (!t.length) return [];
  return entries
    .map((e) => ({ e, r: rank(e, t) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.e.label.length - b.e.label.length)
    .map((x) => x.e);
}

/* ---------- 6. the palette ---------- */

// Things worth reaching that are not settings: the tabs themselves, and what
// the footer and the rail do.
function commandEntries() {
  const tabs = [...document.querySelectorAll(".tab")].map((t) => ({
    kind: "tab",
    label: t.textContent,
    group: "Go to",
    tab: "",
    key: "",
    run: () => t.click(),
  }));

  const acts = [
    ["Save", "Write every change to disk", () => document.querySelector("#btn-save").click()],
    ["Save and apply", "Write, then restart what needs it", () => document.querySelector("#btn-apply").click()],
    ["Preview changes", "See the diff before saving", () => document.querySelector("#btn-diff").click()],
    ["Reload from disk", "Throw away unsaved changes", () => document.querySelector("#btn-reload").click()],
    ["Undo", "Step back one change", () => undo()],
    ["Redo", "Step forward again", () => redo()],
    ["Restart komorebi", "Re-tiles every window", () => document.querySelector('[data-restart="komorebi"]').click()],
    ["Restart whkd", "Reload your shortcuts", () => document.querySelector('[data-restart="whkd"]').click()],
    ["Reload the bar", "yasbc reload", () => document.querySelector('[data-restart="yasb"]').click()],
    ["Where things are installed", "The setup screen", () => checkSetup({ force: true })],
  ].map(([label, key, run]) => ({ kind: "action", label, key, group: "Do", tab: "", run }));

  return [...tabs, ...acts];
}

let paletteHits = [];
let paletteAt = 0;

function openPalette() {
  const modal = document.querySelector("#palette");
  modal.hidden = false;
  const input = document.querySelector("#palette-input");
  input.value = "";
  fillPalette();
  input.focus();
}

const closePalette = () => { document.querySelector("#palette").hidden = true; };

function fillPalette() {
  const q = document.querySelector("#palette-input").value;
  const box = document.querySelector("#palette-list");
  const all = [...commandEntries(), ...indexRows()];
  paletteHits = (q ? search(all, q) : all.filter((e) => e.kind !== "setting")).slice(0, 40);
  paletteAt = 0;

  box.innerHTML = "";
  if (!paletteHits.length) {
    box.innerHTML = '<p class="note">Nothing matches.</p>';
    return;
  }
  paletteHits.forEach((e, i) => {
    const row = document.createElement("button");
    row.className = "pal-row" + (i === 0 ? " on" : "");
    row.innerHTML = `<span class="pal-label">${e.label}</span>`
      + `<span class="pal-key">${e.key || ""}</span>`
      + `<span class="pal-where">${e.group || e.tab}</span>`;
    row.addEventListener("click", () => choosePalette(i));
    row.addEventListener("mousemove", () => movePalette(i));
    box.appendChild(row);
  });
}

function movePalette(to) {
  const rows = document.querySelectorAll("#palette-list .pal-row");
  if (!rows.length) return;
  paletteAt = (to + rows.length) % rows.length;
  rows.forEach((r, i) => r.classList.toggle("on", i === paletteAt));
  rows[paletteAt].scrollIntoView({ block: "nearest" });
}

function choosePalette(i) {
  const hit = paletteHits[i ?? paletteAt];
  if (!hit) return;
  closePalette();
  if (hit.run) hit.run();
  else jumpTo(hit);
}

// Switching tab and scrolling is not enough on its own: the row you asked for
// looks like every other row once you get there, so it is marked briefly.
function jumpTo(entry) {
  document.querySelector(`.tab[data-view="${entry.view}"]`)?.click();
  unfoldFor(entry.row);
  entry.row.scrollIntoView({ block: "center", behavior: "smooth" });
  entry.row.classList.remove("found");
  void entry.row.offsetWidth;
  entry.row.classList.add("found");
  setTimeout(() => entry.row.classList.remove("found"), 1600);
}

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openPalette();
    return;
  }
  if (document.querySelector("#palette").hidden) return;
  if (e.key === "Escape") closePalette();
  else if (e.key === "ArrowDown") { e.preventDefault(); movePalette(paletteAt + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); movePalette(paletteAt - 1); }
  else if (e.key === "Enter") { e.preventDefault(); choosePalette(); }
});

document.querySelector("#palette-input").addEventListener("input", fillPalette);
document.querySelector("#palette").addEventListener("click", (e) => {
  if (e.target.id === "palette") closePalette();
});

/* ---------- 7. filtering a tab in place ---------- */

// Only the tabs that are mostly rows. Everywhere else is lists and drawings,
// where hiding half the rows would leave something misleading behind.
const FILTERABLE = ["komorebi", "looks", "settings"];

function addSearchBoxes() {
  FILTERABLE.forEach((name) => {
    const header = document.querySelector(`#view-${name} header`);
    if (!header) return;
    const box = document.createElement("input");
    box.type = "search";
    box.className = "view-filter";
    box.placeholder = "Filter these settings";
    box.addEventListener("input", () => filterView(name, box.value));
    header.appendChild(box);
  });
}

function filterView(name, q) {
  const view = document.querySelector(`#view-${name}`);
  const t = terms(q);

  view.querySelectorAll(".row").forEach((row) => {
    const lbl = row.querySelector(".lbl");
    if (!lbl) return;
    const hay = `${lbl.textContent} ${row.closest(".group")?.querySelector("h2")?.textContent || ""}`
      .toLowerCase();
    row.classList.toggle("filtered-out", t.length > 0 && !t.every((x) => hay.includes(x)));
  });

  // A group is only hidden when it is entirely rows and every one of them went.
  // Groups holding a list or a preview keep whatever else they hold.
  view.querySelectorAll(".group").forEach((group) => {
    const rows = group.querySelectorAll(".row");
    const hidden = group.querySelectorAll(".row.filtered-out");
    const gone = rows.length > 0 && rows.length === hidden.length;
    group.classList.toggle("filtered-out", gone);
    // Folded sections would hide their own matches, so a search opens them for
    // as long as it runs.
    showWhileFiltering(group, t.length > 0 && !gone);
  });
}

addSearchBoxes();
