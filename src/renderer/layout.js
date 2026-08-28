/* Shaping a layout.

   komorebi's `custom_layout` is marked END OF LIFE in the schema, so this edits
   `layout_options` instead, which is the supported way to change where a layout
   puts its splits. Both ratio lists are exactly five entries, each a number
   between 0.1 and 0.9 or null, and a null means "share what is left equally".

   Which of the five actually do anything depends on the layout, which the
   schema spells out and nothing in the interface would otherwise tell you, so
   each slot is labelled with the job it has in the layout you picked. */

const RATIO_MIN = 0.1;
const RATIO_MAX = 0.9;
const RATIO_SLOTS = 5;

const NUMBERED = (what) =>
  ["First", "Second", "Third", "Fourth", "Fifth"].map((n) => `${n} ${what}`);

/* Straight out of the column_ratios and row_ratios descriptions in the schema.
   `columns` and `rows` name the sliders; `across` and `down` say how many boxes
   the layout actually makes, which is not the same number. BSP has one ratio
   and two boxes. `order` maps a box to the ratio that drives it, for the two
   layouts where those are not in the same order: HorizontalStack keeps a height
   in column_ratios, and UltrawideVerticalStack lists the centre before the
   left-hand column. */
const RATIO_ROLES = {
  BSP: {
    columns: ["Split between the first window and the rest"],
    across: { from: "column_ratios", boxes: 2 },
  },
  Columns: {
    columns: NUMBERED("column"),
    across: { from: "column_ratios", boxes: 5 },
  },
  Rows: {
    rows: NUMBERED("row"),
    down: { from: "row_ratios", boxes: 5 },
  },
  VerticalStack: {
    columns: ["Split between the main window and the stack"],
    across: { from: "column_ratios", boxes: 2 },
  },
  RightMainVerticalStack: {
    columns: ["Split between the stack and the main window"],
    across: { from: "column_ratios", boxes: 2 },
  },
  HorizontalStack: {
    columns: ["Height of the top area"],
    down: { from: "column_ratios", boxes: 2 },
  },
  UltrawideVerticalStack: {
    columns: ["Width of the centre", "Width of the left column"],
    across: { from: "column_ratios", boxes: 3, order: [1, 0, null] },
  },
  Grid: {
    columns: NUMBERED("column"),
    rows: NUMBERED("row"),
    across: { from: "column_ratios", boxes: 3 },
    down: { from: "row_ratios", boxes: 2 },
  },
};

const layoutRoles = (layout) => RATIO_ROLES[layoutName(layout)] || {};

// A list is only worth writing when something in it is set. Five nulls is the
// same as no list at all, and komorebi would rather have the key absent.
function tidyRatios(list) {
  return list.some((v) => typeof v === "number") ? list : null;
}

function readRatios(ws, which) {
  const list = ws.layout_options?.[which];
  const out = new Array(RATIO_SLOTS).fill(null);
  (Array.isArray(list) ? list : []).forEach((v, i) => {
    if (i < RATIO_SLOTS && typeof v === "number") out[i] = v;
  });
  return out;
}

function writeRatios(ws, which, list) {
  const options = ws.layout_options || {};
  const tidy = tidyRatios(list);
  if (tidy) options[which] = tidy;
  else delete options[which];

  if (Object.keys(options).length) ws.layout_options = options;
  else delete ws.layout_options;
  markDirty("komorebi");
}

/* ---------- the drawing ---------- */

// Drawn from the ratios rather than from komorebi, because this is about a
// workspace you may not be looking at, and possibly one with nothing on it yet.

// Anything left on Share takes an equal cut of what the set ones leave over,
// which is what komorebi does with a null.
function boxSizes(ws, spec) {
  if (!spec) return [1];
  const ratios = readRatios(ws, spec.from);
  const picked = Array.from({ length: spec.boxes }, (_, i) => {
    const at = spec.order ? spec.order[i] : i;
    return at === null || at === undefined ? null : ratios[at];
  });
  const known = picked.reduce((sum, v) => sum + (v || 0), 0);
  const blanks = picked.filter((v) => v === null).length;
  const each = blanks ? Math.max(0.04, (1 - known) / blanks) : 0;
  return picked.map((v) => (v === null ? each : v));
}

function layoutSketch(ws, roles) {
  const W = 320;
  const H = 180;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "lay-svg" });
  svg.appendChild(svgEl("rect", { width: W, height: H, class: "lay-screen" }));

  const cols = boxSizes(ws, roles.across);
  const rows = boxSizes(ws, roles.down);

  let y = 0;
  rows.forEach((rh) => {
    let x = 0;
    cols.forEach((cw) => {
      svg.appendChild(svgEl("rect", {
        x: x * W + 3, y: y * H + 3,
        width: Math.max(0, cw * W - 6), height: Math.max(0, rh * H - 6),
        class: "lay-cell",
      }));
      x += cw;
    });
    y += rh;
  });
  return svg;
}

/* ---------- the editor ---------- */

let layoutWorkspace = 0;

function renderLayoutDesigner() {
  const box = document.querySelector("#layout-designer");
  if (!box || !state.komorebi) return;
  box.innerHTML = "";

  const spaces = activeMonitor()?.workspaces || [];
  if (!spaces.length) {
    box.innerHTML = '<p class="note">This screen has no workspaces yet.</p>';
    return;
  }

  const picker = document.createElement("div");
  picker.className = "map-ws";
  spaces.forEach((ws, i) => {
    const b = document.createElement("button");
    b.className = "map-wsb" + (i === layoutWorkspace ? " focused" : "");
    b.innerHTML = `<span>${ws.name || i + 1}</span><em>${layoutName(ws.layout)}</em>`;
    b.addEventListener("click", () => { layoutWorkspace = i; renderLayoutDesigner(); });
    picker.appendChild(b);
  });
  box.appendChild(picker);

  const ws = spaces[Math.min(layoutWorkspace, spaces.length - 1)];
  const roles = layoutRoles(ws.layout);

  const sketch = document.createElement("div");
  sketch.className = "lay-sketch";
  sketch.appendChild(layoutSketch(ws, roles));
  box.appendChild(sketch);

  if (!roles.columns && !roles.rows) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = `${layoutName(ws.layout)} works out its own proportions and has nothing `
      + `here to set. BSP, Columns, Rows, Grid, the stacks and UltrawideVerticalStack do.`;
    box.appendChild(p);
    box.appendChild(flipRow(ws));
    return;
  }

  if (roles.columns) box.appendChild(ratioBlock(ws, "column_ratios", roles.columns, "Across"));
  if (roles.rows) box.appendChild(ratioBlock(ws, "row_ratios", roles.rows, "Down"));
  if (layoutName(ws.layout) === "Grid") box.appendChild(gridRows(ws));
  box.appendChild(flipRow(ws));

  const note = document.createElement("p");
  note.className = "note";
  note.textContent = "A slider left at Share takes an equal cut of whatever the others "
    + "leave over. Values are written as fractions of the screen, which is what komorebi "
    + "expects, and take effect when it restarts.";
  box.appendChild(note);
}

function ratioBlock(ws, which, roles, title) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<h3>${title}</h3>`;
  const list = readRatios(ws, which);

  roles.forEach((role, i) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span class="lbl">${role}<em>${which}[${i}]</em></span>`;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = RATIO_MIN;
    slider.max = RATIO_MAX;
    slider.step = 0.01;
    slider.value = list[i] ?? 0.5;
    slider.disabled = list[i] === null;

    const out = document.createElement("output");
    const paint = () => {
      out.textContent = list[i] === null ? "Share" : `${Math.round(list[i] * 100)}%`;
    };

    const share = document.createElement("button");
    share.className = "ghost small";
    const paintShare = () => { share.textContent = list[i] === null ? "Set" : "Share"; };

    slider.addEventListener("input", () => {
      list[i] = Number(slider.value);
      paint();
      writeRatios(ws, which, list);
      redrawSketch(ws);
    });
    share.addEventListener("click", () => {
      list[i] = list[i] === null ? Number(slider.value) : null;
      slider.disabled = list[i] === null;
      paint();
      paintShare();
      writeRatios(ws, which, list);
      redrawSketch(ws);
    });

    paint();
    paintShare();
    row.append(slider, out, share);
    wrap.appendChild(row);
  });
  return wrap;
}

// Only the sketch changes while a slider moves, because rebuilding the whole
// panel would take the slider out from under the cursor mid-drag.
function redrawSketch(ws) {
  const holder = document.querySelector(".lay-sketch");
  if (!holder) return;
  holder.innerHTML = "";
  holder.appendChild(layoutSketch(ws, layoutRoles(ws.layout)));
}

function gridRows(ws) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = '<span class="lbl">Most rows in a column'
    + '<em>layout_options.grid.rows</em></span>';
  const input = document.createElement("input");
  input.type = "number";
  input.min = 0;
  input.max = 8;
  input.value = ws.layout_options?.grid?.rows ?? 0;
  input.addEventListener("input", () => {
    const options = ws.layout_options || {};
    const n = Number(input.value);
    if (n > 0) options.grid = { rows: n };
    else delete options.grid;
    if (Object.keys(options).length) ws.layout_options = options;
    else delete ws.layout_options;
    markDirty("komorebi");
  });
  row.appendChild(dressNumber(input, false));
  return row;
}

function flipRow(ws) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = '<span class="lbl">Mirror the layout<em>layout_flip</em></span>';
  const sel = document.createElement("select");
  fillSelect(sel, ["none", ...KENUM.AXES], ws.layout_flip || "none");
  sel.addEventListener("change", () => {
    if (sel.value === "none") delete ws.layout_flip;
    else ws.layout_flip = sel.value;
    markDirty("komorebi");
  });
  row.appendChild(sel);
  return row;
}
