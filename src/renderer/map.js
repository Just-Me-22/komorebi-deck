/* The live picture of what komorebi is doing, drawn from `komorebic state`.

   Two things about that data are easy to get wrong. Monitors and workspaces
   arrive as {elements, focused} wrappers rather than plain arrays, and a Rect
   is {left, top, right, bottom} where right and bottom are the WIDTH and the
   HEIGHT, not coordinates.

   Looking at a workspace is deliberately not the same as going to it. Clicking
   one only changes what is drawn, so another workspace can be worked on without
   the screen jumping. What can be reached from here is set by komorebi:
   workspace-layout, workspace-tiling and the paddings take a workspace index so
   they work anywhere, while everything window-shaped acts on the focused window
   and cannot. */

const MAP_NS = "http://www.w3.org/2000/svg";

let liveState = null;
let mapMonitor = 0;
let mapWorkspace = null;
let mapOverview = false;
let mapHistory = [];
let lastPlacement = null;
let selected = null;

const els = (w) => w?.elements || [];
const firstLine = (s) => String(s || "").split(/\r?\n/)[0];
const layoutName = (l) => (typeof l === "string" ? l : Object.values(l || {})[0]) || "unknown";
const sameRect = (a, b) => a && b
  && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(MAP_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function workspaceWindows(ws) {
  const out = [];
  // latest_layout is where komorebi told each tile to go. Comparing it with
  // where the window actually is catches apps that refuse to be resized.
  const wanted = ws.latest_layout || [];
  let slot = 0;
  els(ws.containers).forEach((c, ci) => {
    const stack = els(c.windows);
    const want = wanted[slot++];
    stack.forEach((w, wi) => out.push({
      ...w, kind: "tiled", container: ci, stackSize: stack.length, stackIndex: wi,
      wanted: want, ignored: !!(want && !sameRect(want, w.rect)),
      focused: ci === ws.containers.focused && wi === (c.windows.focused ?? 0),
    }));
  });
  els(ws.floating_windows).forEach((w) =>
    out.push({ ...w, kind: "floating", stackSize: 1, ignored: false }));
  if (ws.monocle_container) {
    els(ws.monocle_container.windows).forEach((w) =>
      out.push({ ...w, kind: "monocle", stackSize: 1, ignored: false }));
  }
  return out;
}

/* ---------- staying in sync ---------- */

let mapPending = null;
let mapLive = false;
let pointerDown = false;
let redrawWanted = false;

// A redraw replaces every button, and a click only fires when press and release
// land on the same element. komorebi fires events for the very change a click
// causes, so the redraw those trigger was landing between the two halves of the
// next click and swallowing it. Nothing is rebuilt while a pointer is down.
function holdRedraws(on) {
  pointerDown = on;
  if (!on && redrawWanted) {
    redrawWanted = false;
    refreshMap(true);
  }
}

function mapChanged() {
  if (!mapLive || !document.querySelector("#view-map").classList.contains("active")) return;
  clearTimeout(mapPending);
  mapPending = setTimeout(() => refreshMap(true), 120);
}

async function startMapEvents() {
  const dot = document.querySelector("#map-live");
  const r = await window.wm.startEvents();
  mapLive = r.ok;
  dot.className = "live-dot " + (r.ok ? "on" : "off");
  dot.textContent = r.ok ? "live" : "not live";
  dot.title = r.ok
    ? "komorebi is pushing changes to this window"
    : `could not subscribe: ${r.error || "unknown"}. Use Refresh instead.`;
}

window.wm.onEvent(mapChanged);

// Quiet redraws come from events, so they must not flash a loading line or drag
// the view back to whichever workspace happens to be focused.
// Every read spawns a komorebic process that opens its own socket to komorebi.
// Firing several at once is what makes komorebi time out, so only one is ever
// in flight and anything asked for meanwhile is folded into the next one.
let stateInFlight = false;
let askAgain = false;

async function refreshMap(quiet) {
  const box = document.querySelector("#map");
  if (!box) return;
  if (pointerDown) { redrawWanted = true; return; }
  if (stateInFlight) { askAgain = true; return; }
  if (!quiet && !liveState) box.innerHTML = '<p class="note">Asking komorebi...</p>';

  stateInFlight = true;
  let r = await window.wm.state();
  // A timeout under load is worth one quiet retry before it is worth reporting.
  if (!r.ok) {
    await new Promise((res) => setTimeout(res, 220));
    r = await window.wm.state();
  }
  stateInFlight = false;

  if (!r.ok) {
    // Whatever was drawn is still the best picture available, so it stays.
    mapNote(readableStateError(r.error), "bad");
    if (!liveState) box.innerHTML = '<p class="note bad">komorebi has not answered yet.</p>';
    return;
  }
  if (askAgain) { askAgain = false; setTimeout(() => refreshMap(true), 60); }
  clearMapError();

  recordMoves(r.state);
  liveState = r.state;
  mapMonitor = Math.max(0, Math.min(mapMonitor, els(liveState.monitors).length - 1));
  if (!quiet) mapWorkspace = null;

  // komorebi fires events for plenty that does not change the picture. Redrawing
  // anyway replaces the button under the cursor, which drops its hover and makes
  // it blink, so an unchanged signature means nothing is touched.
  const sig = drawSignature();
  if (quiet && sig === lastSignature) return;
  lastSignature = sig;
  drawMap();
}

let lastSignature = null;

function drawSignature() {
  const mon = els(liveState.monitors)[mapMonitor];
  if (!mon) return "none";
  const spaces = els(mon.workspaces).map((ws) => [
    ws.name, layoutName(ws.layout), ws.tile, ws.layout_flip,
    (ws.resize_dimensions || []).filter(Boolean).length,
    workspaceWindows(ws).map((w) =>
      [w.hwnd, w.kind, w.focused, w.stackSize, w.ignored,
        w.rect.left, w.rect.top, w.rect.right, w.rect.bottom].join(":")).join("|"),
  ].join(","));
  return JSON.stringify([
    mapMonitor, mapWorkspace, mapOverview, selected,
    mon.workspaces.focused, liveState.is_paused, spaces,
  ]);
}

// komorebic reports failures as a Rust panic with a Winsock number in it, which
// is not something anyone should have to read.
function readableStateError(raw) {
  const text = String(raw || "");
  if (/10060/.test(text)) {
    return "komorebi did not answer in time. It is usually busy rearranging; this clears itself.";
  }
  if (/10022/.test(text)) return "komorebi refused the connection. Restarting it from the rail fixes this.";
  if (/10061|No connection could be made/i.test(text)) return "komorebi is not running.";
  if (/panicked/.test(text)) return "komorebic could not talk to komorebi. " + firstLine(text.split("panicked at").pop());
  return firstLine(text) || "komorebi could not be read.";
}

function mapNote(text, kind) {
  const el = document.querySelector("#map-msg");
  if (el) { el.textContent = text; el.className = "note " + (kind || ""); }
  msg(text, kind === "bad" ? "err" : "ok");
}

// A failed read leaves a warning up, and nothing used to take it down again, so
// "komorebi is not running" sat there long after komorebi came back. Only
// complaints are cleared; what a command reported is left alone.
function clearMapError() {
  const el = document.querySelector("#map-msg");
  if (el && el.classList.contains("bad")) { el.textContent = ""; el.className = "note"; }
}

// komorebi opens its socket a moment after the process exists, so a read taken
// straight after a restart fails even though everything is fine. This waits for
// it to answer instead of reporting the gap.
async function refreshAfterRestart() {
  for (let i = 0; i < 10; i++) {
    await new Promise((res) => setTimeout(res, 600));
    if ((await window.wm.state()).ok) break;
  }
  refreshMap(true);
}

/* ---------- what moved ---------- */

// Derived by comparing one state to the next rather than by reading the event
// payload, so it does not depend on an event shape that is not documented.
function recordMoves(next) {
  const now = new Map();
  els(next.monitors).forEach((mon, mi) => {
    els(mon.workspaces).forEach((ws, wi) => {
      workspaceWindows(ws).forEach((w) =>
        now.set(w.hwnd, { exe: w.exe, ws: ws.name || `workspace ${wi + 1}`, mi, kind: w.kind }));
    });
  });

  if (lastPlacement) {
    const stamp = new Date().toLocaleTimeString();
    for (const [hwnd, at] of now) {
      const was = lastPlacement.get(hwnd);
      if (!was) mapHistory.unshift({ stamp, text: `${at.exe} opened on ${at.ws}` });
      else if (was.ws !== at.ws) {
        mapHistory.unshift({ stamp, text: `${at.exe} moved from ${was.ws} to ${at.ws}` });
      } else if (was.kind !== at.kind) {
        mapHistory.unshift({ stamp, text: `${at.exe} became ${at.kind}` });
      }
    }
    for (const [hwnd, was] of lastPlacement) {
      if (!now.has(hwnd)) mapHistory.unshift({ stamp, text: `${was.exe} closed on ${was.ws}` });
    }
    mapHistory = mapHistory.slice(0, 20);
  }
  lastPlacement = now;
}

/* ---------- drawing ---------- */

function drawMap() {
  const box = document.querySelector("#map");
  const mon = els(liveState.monitors)[mapMonitor];
  if (!mon) { box.innerHTML = '<p class="note">No monitors reported.</p>'; return; }

  const spaces = els(mon.workspaces);
  const wsIndex = mapWorkspace ?? mon.workspaces.focused ?? 0;
  box.innerHTML = "";

  const stopped = stoppedBanner(spaces[wsIndex]);
  if (stopped) box.appendChild(stopped);
  box.appendChild(monitorStrip(mon));
  box.appendChild(workspaceStrip(spaces, wsIndex, mon.workspaces.focused));

  if (mapOverview) {
    box.appendChild(overview(mon, spaces));
  } else {
    const ws = spaces[wsIndex];
    if (!ws) return;
    const wins = workspaceWindows(ws);
    box.appendChild(canvas(mon, ws, wins, wsIndex));
    box.appendChild(controls(wins, ws, wsIndex));
  }
  box.appendChild(historyPanel());
}

// When komorebi is paused or a workspace has tiling off, every command quietly
// does nothing and the map looks completely normal. Say so, loudly.
function stoppedBanner(ws) {
  const paused = liveState.is_paused;
  const untiled = ws && ws.tile === false;
  if (!paused && !untiled) return null;

  const bar = document.createElement("div");
  bar.className = "map-stopped";
  bar.innerHTML = `<strong>${paused ? "komorebi is paused" : "tiling is off here"}</strong>`
    + `<span>${paused
      ? "Nothing is being managed anywhere until you resume."
      : "This workspace will not arrange anything until tiling is back on."}</span>`;

  const b = document.createElement("button");
  b.className = "ghost small";
  b.textContent = paused ? "Resume" : "Turn tiling on";
  b.addEventListener("click", async () => {
    const r = await window.wm.komorebic([paused ? "toggle-pause" : "toggle-tiling"]);
    mapNote(r.ok ? "Back on" : readableStateError(r.output), r.ok ? "good" : "bad");
    settle();
  });
  bar.appendChild(b);
  return bar;
}

function monitorStrip(mon) {
  const wrap = document.createElement("div");
  wrap.className = "map-mons";
  els(liveState.monitors).forEach((m, i) => {
    const b = document.createElement("button");
    b.className = "mon" + (i === mapMonitor ? " active" : "");
    b.innerHTML = `<strong>${m.name || `Screen ${i + 1}`}</strong>`
      + `<em>${m.size.right}×${m.size.bottom}${m.device ? " · " + m.device : ""}</em>`;
    b.addEventListener("click", () => {
      mapMonitor = i; mapWorkspace = null; lastSignature = null; drawMap();
    });
    wrap.appendChild(b);
  });

  const view = document.createElement("button");
  view.className = "ghost small map-viewtoggle";
  view.textContent = mapOverview ? "Show one workspace" : "Show all workspaces";
  view.addEventListener("click", () => {
    mapOverview = !mapOverview; lastSignature = null; drawMap();
  });
  wrap.appendChild(view);
  return wrap;
}

function workspaceStrip(spaces, shown, focused) {
  const wrap = document.createElement("div");
  wrap.className = "map-ws";
  spaces.forEach((w, i) => {
    const count = workspaceWindows(w).length;
    const b = document.createElement("button");
    b.className = "map-wsb" + (i === shown && !mapOverview ? " active" : "")
      + (count ? "" : " empty");
    b.dataset.ws = i;
    b.innerHTML = `<span>${w.name || i + 1}</span><em>${count || ""}</em>`;
    if (i === focused) b.classList.add("focused");
    b.title = i === focused
      ? `${count} windows. You are on this one.`
      : `${count} windows, ${layoutName(w.layout)} layout. Click to look without going there.`;

    b.addEventListener("click", () => {
      mapWorkspace = i; mapOverview = false; lastSignature = null; drawMap();
    });
    wrap.appendChild(b);
  });
  return wrap;
}

/* ---------- every workspace at once ---------- */

function overview(mon, spaces) {
  const wrap = document.createElement("div");
  wrap.className = "map-grid";
  spaces.forEach((ws, i) => {
    const cell = document.createElement("button");
    cell.className = "map-cell" + (i === mon.workspaces.focused ? " focused" : "");
    cell.dataset.ws = i;
    const wins = workspaceWindows(ws);

    const s = svgEl("svg", {
      viewBox: `0 0 ${mon.size.right} ${mon.size.bottom}`, class: "map-svg",
    });
    s.appendChild(svgEl("rect", {
      width: mon.size.right, height: mon.size.bottom, class: "map-screen",
    }));

    wins.forEach((w) => {
      const r = svgEl("rect", {
        x: w.rect.left, y: w.rect.top, width: w.rect.right, height: w.rect.bottom,
        class: `map-mini ${w.kind}`,
      });
      const t = svgEl("title");
      t.textContent = `${w.exe} — drag onto another workspace to send it there`;
      r.appendChild(t);
      r.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        dragFrom = { win: w, x: e.clientX, y: e.clientY, wsIndex: i, moving: false };
        r.setPointerCapture(e.pointerId);
        holdRedraws(true);
      });
      r.addEventListener("pointerup", async (e) => {
        if (r.hasPointerCapture(e.pointerId)) r.releasePointerCapture(e.pointerId);
        if (!dragFrom || dragFrom.win.hwnd !== w.hwnd) return;
        const far = Math.hypot(e.clientX - dragFrom.x, e.clientY - dragFrom.y) >= DRAG_SLOP;
        dragFrom = null;
        holdRedraws(false);
        const onto = far ? whatIsUnder(e, w, wins) : { workspace: null };
        if (onto.workspace !== null && onto.workspace !== i) {
          await sendToWorkspace(w, onto.workspace, i);
        }
      });
      s.appendChild(r);
    });

    const cap = document.createElement("span");
    cap.className = "map-cap";
    cap.textContent = `${ws.name || i + 1} · ${wins.length || "empty"}`;
    cell.append(s, cap);
    cell.addEventListener("click", () => {
      mapWorkspace = i; mapOverview = false; lastSignature = null; drawMap();
    });
    wrap.appendChild(cell);
  });
  return wrap;
}

/* ---------- one workspace, to scale ---------- */

function canvas(mon, ws, wins, wsIndex) {
  const wrap = document.createElement("div");
  wrap.className = "map-canvas";
  const W = mon.size.right, H = mon.size.bottom;
  const s = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "map-svg" });
  s.appendChild(svgEl("rect", { width: W, height: H, class: "map-screen" }));

  const wa = mon.work_area_size;
  if (wa) {
    s.appendChild(svgEl("rect", {
      x: wa.left, y: wa.top, width: wa.right, height: wa.bottom, class: "map-workarea",
    }));
  }

  if (!wins.length) {
    const t = svgEl("text", { x: W / 2, y: H / 2 - 18, class: "map-empty" });
    t.textContent = "nothing here";
    const t2 = svgEl("text", { x: W / 2, y: H / 2 + 26, class: "map-empty small" });
    t2.textContent = "click to send a window over";
    s.append(t, t2);
    s.addEventListener("click", () => sendSomethingHere(wsIndex));
  }

  wins.forEach((w) => s.appendChild(windowShape(w, wins, wsIndex, mon)));
  if (wa) gapHandles(s, mon, ws, wins, wsIndex);

  wrap.appendChild(s);
  return wrap;
}

function windowShape(w, all, wsIndex, mon) {
  // A stack is one rectangle holding several windows, so only the first draws
  // the container and the others are represented by its tabs.
  if (w.stackSize > 1 && w.stackIndex > 0) return svgEl("g");

  const g = svgEl("g", {
    class: `map-win ${w.kind}` + (w.focused ? " is-focused" : "")
      + (w.hwnd === selected ? " is-selected" : "") + (w.ignored ? " ignored" : ""),
    "data-hwnd": w.hwnd,
  });

  if (w.ignored) {
    g.appendChild(svgEl("rect", {
      x: w.wanted.left, y: w.wanted.top, width: w.wanted.right, height: w.wanted.bottom,
      class: "map-wanted",
    }));
  }
  const body = svgEl("rect", {
    x: w.rect.left, y: w.rect.top, width: w.rect.right, height: w.rect.bottom,
  });
  g.appendChild(body);

  if (w.stackSize > 1) {
    const tabW = w.rect.right / w.stackSize;
    for (let i = 0; i < w.stackSize; i++) {
      const tab = svgEl("rect", {
        x: w.rect.left + i * tabW, y: w.rect.top, width: Math.max(2, tabW - 2), height: 34,
        class: "map-tab" + (i === (w.stackIndex ?? 0) ? " on" : ""),
      });
      tab.addEventListener("click", (e) => {
        e.stopPropagation();
        focusStackWindow(w, i, wsIndex);
      });
      g.appendChild(tab);
    }
  }

  const top = w.rect.top + (w.stackSize > 1 ? 76 : 46);
  const label = svgEl("text", { x: w.rect.left + 18, y: top });
  label.textContent = w.exe;
  g.appendChild(label);

  const hits = typeof rulesFor === "function"
    ? rulesFor(w, { ...state.komorebi, __appRules: state.appRules }) : [];

  const sub = svgEl("text", { x: w.rect.left + 18, y: top + 36, class: "map-sub" });
  sub.textContent = w.stackSize > 1 ? `stack of ${w.stackSize}` : w.kind;
  g.appendChild(sub);

  if (hits.length) {
    const badge = svgEl("text", { x: w.rect.left + 18, y: top + 72, class: "map-rule" });
    badge.textContent = hits[0] + (hits.length > 1 ? ` +${hits.length - 1}` : "");
    g.appendChild(badge);
  }

  const t = svgEl("title");
  t.textContent = [
    w.exe, w.title,
    `${w.rect.right}×${w.rect.bottom} at ${w.rect.left},${w.rect.top}`,
    hits.length ? `rules: ${hits.join(", ")}` : "no rules match this window",
    w.ignored
      ? `komorebi wanted ${w.wanted.right}×${w.wanted.bottom} at ${w.wanted.left},${w.wanted.top}`
      : "",
    w.kind === "floating" ? "drag to move it anywhere" : "drag to swap, or onto another to stack",
  ].filter(Boolean).join("\n");
  g.appendChild(t);

  g.addEventListener("click", (e) => {
    if (!e.target.closest(".map-grip")) selectWindow(w);
  });
  makeDraggable(g, w, all, wsIndex, mon);
  if (w.kind === "floating") resizeGrips(g, body, w, mon);
  return g;
}

/* ---------- dragging ---------- */

let dragFrom = null;
const DRAG_SLOP = 6;

// The drawing is the monitor shrunk to fit, so a distance in app pixels has to
// be multiplied by this to become a distance on the actual screen.
const screenScale = (el, mon) =>
  mon.size.right / el.ownerSVGElement.getBoundingClientRect().width;

// Only one move can be in flight at a time or a fast drag builds a queue and
// the window keeps going after the mouse stops. Anything that arrives while one
// is out replaces whatever was waiting, so the newest position always wins.
let moveInFlight = false;
let movePending = null;

function pushMove(hwnd, rect) {
  movePending = { hwnd, rect };
  if (moveInFlight) return;
  moveInFlight = true;
  (async () => {
    while (movePending) {
      const next = movePending;
      movePending = null;
      await window.wm.moveWindow(next.hwnd, next.rect);
    }
    moveInFlight = false;
  })();
}

// The pointer has to be captured on press. Without it a drag that leaves the
// shape, which every drag does, delivers its pointermove and pointerup to
// whatever is now underneath, and the handlers here never run at all. Capture
// also means the drop target has to be worked out by hand, since the things
// being dropped onto stop receiving events.
function makeDraggable(g, win, all, wsIndex, mon) {
  g.classList.add("draggable");

  g.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".map-tab, .map-grip")) return;
    dragFrom = { win, x: e.clientX, y: e.clientY, wsIndex, moving: false };
    g.setPointerCapture(e.pointerId);
    holdRedraws(true);
  });

  g.addEventListener("pointermove", (e) => {
    if (!dragFrom || dragFrom.win.hwnd !== win.hwnd) return;
    const dx = e.clientX - dragFrom.x, dy = e.clientY - dragFrom.y;
    if (!dragFrom.moving && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!dragFrom.moving) {
      dragFrom.moving = true;
      g.classList.add("dragging");
    }

    const scale = screenScale(g, mon);
    g.setAttribute("transform", `translate(${dx * scale} ${dy * scale})`);
    if (win.kind !== "floating") return;
    pushMove(win.hwnd, {
      x: Math.round(win.rect.left + dx * scale), y: Math.round(win.rect.top + dy * scale),
      w: win.rect.right, h: win.rect.bottom,
    });
  });

  g.addEventListener("pointerup", async (e) => {
    if (g.hasPointerCapture(e.pointerId)) g.releasePointerCapture(e.pointerId);
    g.classList.remove("dragging");
    if (!dragFrom || dragFrom.win.hwnd !== win.hwnd) return;
    const moved = dragFrom.moving;
    const dx = e.clientX - dragFrom.x, dy = e.clientY - dragFrom.y;
    dragFrom = null;
    holdRedraws(false);
    if (!moved) return; // a click, not a drag

    const onto = whatIsUnder(e, win, all);
    // The ghost stays where it was dropped for a floating window, because that
    // window really is there now. Anything else has not moved yet, so it snaps
    // back until the next reading of the state says otherwise.
    if (win.kind !== "floating" || onto.workspace !== null) g.removeAttribute("transform");

    if (onto.workspace !== null) {
      await sendToWorkspace(win, onto.workspace, wsIndex);
    } else if (win.kind === "floating") {
      const scale = screenScale(g, mon);
      mapNote(`Moved ${win.exe} to ${Math.round(win.rect.left + dx * scale)}, `
        + `${Math.round(win.rect.top + dy * scale)}`, "good");
      settle();
    } else {
      const dir = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      await dragTiled(win, dir, onto.window, wsIndex);
    }
  });

  g.addEventListener("pointercancel", () => {
    dragFrom = null;
    g.classList.remove("dragging");
    holdRedraws(false);
  });
}

/* ---------- resizing by a corner ---------- */

// Which way each corner pulls: whether it moves the left edge, the top edge,
// and which way it grows the width and the height.
const CORNERS = {
  nw: { movesX: 1, movesY: 1, w: -1, h: -1 },
  ne: { movesX: 0, movesY: 1, w: 1, h: -1 },
  sw: { movesX: 1, movesY: 0, w: -1, h: 1 },
  se: { movesX: 0, movesY: 0, w: 1, h: 1 },
};
const MIN_SIZE = { w: 240, h: 160 };

function cornerRect(rect, corner, dx, dy) {
  const c = CORNERS[corner];
  const w = Math.max(MIN_SIZE.w, rect.right + c.w * dx);
  const h = Math.max(MIN_SIZE.h, rect.bottom + c.h * dy);
  return {
    x: Math.round(rect.left + c.movesX * (rect.right - w)),
    y: Math.round(rect.top + c.movesY * (rect.bottom - h)),
    w: Math.round(w), h: Math.round(h),
  };
}

// Corners only go on floating windows. A tiled one is sized by the layout, so
// dragging its corner would be undone the moment komorebi retiled.
function resizeGrips(g, body, win, mon) {
  const size = Math.max(28, win.rect.right * 0.06);
  Object.keys(CORNERS).forEach((corner) => {
    const c = CORNERS[corner];
    const grip = svgEl("rect", {
      x: win.rect.left + (c.movesX ? 0 : win.rect.right - size),
      y: win.rect.top + (c.movesY ? 0 : win.rect.bottom - size),
      width: size, height: size, class: `map-grip ${corner}`,
    });
    const t = svgEl("title");
    t.textContent = `Drag to resize ${win.exe}`;
    grip.appendChild(t);

    let from = null;
    grip.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      from = { x: e.clientX, y: e.clientY, last: null };
      grip.setPointerCapture(e.pointerId);
      holdRedraws(true);
    });
    grip.addEventListener("pointermove", (e) => {
      if (!from) return;
      const scale = screenScale(grip, mon);
      const next = cornerRect(win.rect, corner, (e.clientX - from.x) * scale,
        (e.clientY - from.y) * scale);
      from.last = next;
      body.setAttribute("x", next.x);
      body.setAttribute("y", next.y);
      body.setAttribute("width", next.w);
      body.setAttribute("height", next.h);
      pushMove(win.hwnd, next);
    });
    grip.addEventListener("pointerup", (e) => {
      if (!from) return;
      const last = from.last;
      from = null;
      grip.releasePointerCapture(e.pointerId);
      holdRedraws(false);
      if (last) mapNote(`${win.exe} is now ${last.w} by ${last.h}`, "good");
      settle();
    });
    grip.addEventListener("pointercancel", () => { from = null; holdRedraws(false); });
    g.appendChild(grip);
  });
}

// Resolved by hand because pointer capture stops the drop targets hearing
// anything themselves.
function whatIsUnder(e, win, all) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const ws = el && el.closest("[data-ws]");
  if (ws) return { workspace: Number(ws.dataset.ws), window: null };

  const shape = el && el.closest(".map-win");
  if (shape) {
    const hwnd = Number(shape.dataset.hwnd);
    const hit = all.find((w) => w.hwnd === hwnd);
    if (hit && hit.hwnd !== win.hwnd) return { workspace: null, window: hit };
  }
  return { workspace: null, window: null };
}

async function dragTiled(win, dir, onto, wsIndex) {
  if (!(await focusFirst(win, wsIndex))) return;
  const r = await window.wm.komorebic(onto ? ["stack", dir] : ["move", dir]);
  mapNote(r.ok
    ? (onto ? `Stacked ${win.exe} with ${onto.exe}` : `Moved ${win.exe} ${dir}`)
    : readableStateError(r.output), r.ok ? "good" : "bad");
  settle();
}

// A safety net for a press whose release never reaches the shape it started on,
// so nothing is left half dragged with redraws switched off.
document.addEventListener("pointerup", () => setTimeout(() => {
  if (!dragFrom) return;
  dragFrom = null;
  holdRedraws(false);
}, 0));

/* ---------- acting on windows ---------- */

// eager-focus only reaches a managed window on the workspace komorebi is
// showing, so anything elsewhere needs that workspace brought up first. That
// moves you, which is why the buttons say so before you press them.
async function focusFirst(win, wsIndex) {
  let r = await window.wm.komorebic(["eager-focus", win.exe]);
  if (!r.ok && wsIndex !== undefined) {
    await window.wm.komorebic(["focus-workspace", String(wsIndex)]);
    r = await window.wm.komorebic(["eager-focus", win.exe]);
  }
  if (!r.ok) mapNote(`komorebi would not focus ${win.exe}: ${readableStateError(r.output)}`, "bad");
  return r.ok;
}

// Selecting is local and never moves you. Focusing is a separate, explicit act.
function selectWindow(w) {
  selected = w.hwnd;
  lastSignature = null;
  drawMap();
}

async function focusStackWindow(w, index, wsIndex) {
  if (!(await focusFirst(w, wsIndex))) return;
  const r = await window.wm.komorebic(["focus-stack-window", String(index)]);
  mapNote(r.ok ? `Showing ${index + 1} of ${w.stackSize}` : readableStateError(r.output),
    r.ok ? "good" : "bad");
  settle();
}

async function sendToWorkspace(win, index, fromIndex) {
  dragFrom = null;
  if (!(await focusFirst(win, fromIndex))) return;
  const r = await window.wm.komorebic(["move-to-workspace", String(index)]);
  mapNote(r.ok ? `Sent ${win.exe} to workspace ${index + 1}` : readableStateError(r.output),
    r.ok ? "good" : "bad");
  settle();
}

// A native select paints its open list with the Windows highlight blue, which
// takes no notice of the accent, so the menu is drawn here instead.
function sendToMenu(win, wsIndex) {
  const wrap = document.createElement("div");
  wrap.className = "menu";

  const button = document.createElement("button");
  button.className = "ghost menu-open";
  button.innerHTML = "Send to<i></i>";
  button.title = "Move this window to another workspace";

  const list = document.createElement("div");
  list.className = "menu-list";
  list.hidden = true;

  els(els(liveState.monitors)[mapMonitor].workspaces).forEach((w, i) => {
    const item = document.createElement("button");
    const here = i === wsIndex;
    item.className = "menu-item";
    item.textContent = (w.name || String(i + 1)) + (here ? "  already here" : "");
    item.disabled = here;
    item.addEventListener("click", () => sendToWorkspace(win, i, wsIndex));
    list.appendChild(item);
  });

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = list.hidden;
    closeMenus();
    list.hidden = !open;
  });

  wrap.append(button, list);
  return wrap;
}

// One pair of listeners for the life of the app. The map rebuilds its buttons
// on every change, so a menu that registered its own would pile them up.
const closeMenus = () =>
  document.querySelectorAll(".menu-list:not([hidden])").forEach((m) => { m.hidden = true; });

document.addEventListener("click", closeMenus);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });

// There is no komorebic command to start an application, so an empty workspace
// offers to bring something already running over instead.
function sendSomethingHere(wsIndex) {
  openPicker(async (w) => {
    if (!(await focusFirst({ exe: w.exe }))) return;
    const r = await window.wm.komorebic(["move-to-workspace", String(wsIndex)]);
    mapNote(r.ok ? `Sent ${w.exe} here` : readableStateError(r.output), r.ok ? "good" : "bad");
    settle();
  }, { installed: false });
}

/* ---------- dragging the gaps ---------- */

function gapHandles(s, mon, ws, wins, wsIndex) {
  const tiled = wins.filter((w) => w.kind === "tiled");
  if (tiled.length < 2) return;

  const a = tiled[0].rect, b = tiled[1].rect;
  const horizontal = Math.abs(a.left - b.left) > Math.abs(a.top - b.top);
  const gap = horizontal
    ? { x: a.left + a.right, y: a.top, w: Math.max(8, b.left - (a.left + a.right)), h: a.bottom }
    : { x: a.left, y: a.top + a.bottom, w: a.right, h: Math.max(8, b.top - (a.top + a.bottom)) };

  const current = ws.container_padding ?? state.komorebi?.default_container_padding ?? 0;
  const handle = svgEl("rect", {
    x: gap.x, y: gap.y, width: gap.w, height: gap.h,
    class: "map-gap " + (horizontal ? "col" : "row"),
  });
  const t = svgEl("title");
  t.textContent = `Gap between windows: ${current}px. Drag to change it.`;
  handle.appendChild(t);

  let start = null;
  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    start = { at: horizontal ? e.clientX : e.clientY, value: current };
  });
  handle.addEventListener("pointerup", async (e) => {
    if (!start) return;
    const moved = (horizontal ? e.clientX : e.clientY) - start.at;
    const scale = mon.size.right / s.getBoundingClientRect().width;
    const next = Math.max(0, Math.round(start.value + moved * scale));
    start = null;
    if (next === current) return;
    await sendWs(["container-padding", String(mapMonitor), String(wsIndex), String(next)],
      `Gap between windows: ${next}px`);
  });
  s.appendChild(handle);
}

/* ---------- the key that does the same thing ---------- */

function shortcutFor(args) {
  if (!state.bindings) return null;
  const want = args.join(" ").trim().toLowerCase();
  const hit = state.bindings.find((b) =>
    b.cmd.trim().replace(/^komorebic(\.exe)?\s+/i, "").toLowerCase() === want);
  return hit ? hit.keys : null;
}

function withShortcut(button, args) {
  const keys = shortcutFor(args);
  if (!keys) return button;
  const kbd = document.createElement("kbd");
  kbd.textContent = keys;
  button.appendChild(kbd);
  button.classList.add("has-key");
  return button;
}

/* ---------- controls under the drawing ---------- */

function controls(wins, ws, wsIndex) {
  const wrap = document.createElement("div");
  wrap.className = "map-actions";
  const here = wsIndex === els(liveState.monitors)[mapMonitor].workspaces.focused;

  const summary = document.createElement("p");
  summary.className = "note";
  summary.textContent = `${ws.name || "workspace"}: ${layoutName(ws.layout)} layout, `
    + `${wins.filter((w) => w.kind === "tiled").length} tiled, `
    + `${wins.filter((w) => w.kind === "floating").length} floating. `
    + (here ? "You are on this one." : "You are looking at it from another workspace.");
  wrap.appendChild(summary);

  if (!here) {
    const go = document.createElement("div");
    go.className = "sc-toolbar";
    const b = document.createElement("button");
    b.className = "ghost";
    b.textContent = "Go to this workspace";
    b.addEventListener("click", async () => {
      const r = await window.wm.komorebic(["focus-workspace", String(wsIndex)]);
      mapNote(r.ok ? `Switched to ${ws.name || wsIndex + 1}` : readableStateError(r.output),
        r.ok ? "good" : "bad");
      settle();
    });
    go.appendChild(withShortcut(b, ["focus-workspace", String(wsIndex)]));
    wrap.appendChild(go);
  }

  wrap.appendChild(workspaceControls(ws, wsIndex));
  wrap.appendChild(selectedActions(wins, wsIndex, here));
  wrap.appendChild(layoutTryout(ws, wsIndex));

  const hint = document.createElement("p");
  hint.className = "note";
  hint.textContent = here
    ? "Drag a floating window anywhere to move it. Drag a tiled one to swap it with a "
      + "neighbour, or drop it on another to stack them. Drop any window on a workspace "
      + "button to send it there."
    : "Everything under This workspace can be changed from here. Anything that acts on a "
      + "single window needs komorebi to focus it, and komorebi can only focus a window on "
      + "the workspace it is showing, so those will take you there.";
  wrap.appendChild(hint);
  return wrap;
}

// These take a monitor and workspace index, so they reach a workspace you are
// not on. Everything window-shaped does not, which is why it is a separate box.
function workspaceControls(ws, wsIndex) {
  const wrap = document.createElement("div");
  wrap.innerHTML = "<h3>This workspace</h3>";

  const grid = document.createElement("div");
  grid.className = "ws-fields";

  const layout = document.createElement("select");
  fillSelect(layout, Object.keys(LAYOUT_SHAPES), layoutName(ws.layout));
  layout.addEventListener("change", () => sendWs(
    ["workspace-layout", String(mapMonitor), String(wsIndex), kebab(layout.value)],
    `${ws.name || wsIndex + 1} is now ${layout.value}`));

  const gap = numberField(ws.container_padding ?? state.komorebi?.default_container_padding ?? 0,
    (v) => sendWs(["container-padding", String(mapMonitor), String(wsIndex), String(v)],
      `Gap between windows: ${v}px`));
  const edge = numberField(ws.workspace_padding ?? state.komorebi?.default_workspace_padding ?? 0,
    (v) => sendWs(["workspace-padding", String(mapMonitor), String(wsIndex), String(v)],
      `Gap around the edge: ${v}px`));

  grid.append(
    field("Layout", layout),
    field("Between windows", gap),
    field("Around the edge", edge),
  );
  wrap.appendChild(grid);

  const bar = document.createElement("div");
  bar.className = "sc-toolbar";

  const tiling = document.createElement("button");
  tiling.className = "ghost";
  tiling.textContent = ws.tile === false ? "Turn tiling on" : "Turn tiling off";
  tiling.addEventListener("click", () => sendWs(
    ["workspace-tiling", String(mapMonitor), String(wsIndex),
      ws.tile === false ? "enable" : "disable"],
    ws.tile === false ? "Tiling is on" : "Tiling is off"));
  bar.appendChild(tiling);

  [["Flip across", ["flip-layout", "horizontal"]], ["Flip down", ["flip-layout", "vertical"]]]
    .forEach(([label, args]) => {
      const b = document.createElement("button");
      b.className = "ghost";
      b.textContent = label;
      b.addEventListener("click", () => sendWs(args, `${label} done`));
      bar.appendChild(withShortcut(b, args));
    });
  wrap.appendChild(bar);

  const resized = (ws.resize_dimensions || []).filter(Boolean).length;
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = `Flip is ${ws.layout_flip ? String(ws.layout_flip).toLowerCase() : "off"}. `
    + (resized
      ? `${resized} container${resized > 1 ? "s have" : " has"} been resized by hand, which is `
        + "why the sizes may not match the layout."
      : "Nothing here has been resized by hand.")
    + " Layout, tiling and the two gaps reach any workspace; flip only reaches the one komorebi "
    + "is showing.";
  wrap.appendChild(note);
  return wrap;
}

// A control with its name above it, so a bare number box is never left to be
// guessed at from its position in a row.
function field(label, control) {
  const wrap = document.createElement("label");
  wrap.className = "ws-field";
  const span = document.createElement("span");
  span.textContent = label;
  wrap.append(span, control);
  return wrap;
}

function numberField(value, onChange) {
  const el = document.createElement("input");
  el.type = "number";
  el.min = 0;
  el.max = 60;
  el.value = value;
  el.addEventListener("change", () => onChange(Math.max(0, Number(el.value))));
  return dressNumber(el, false);
}

// A command makes komorebi fire its own events, and those already schedule a
// redraw. Reading the state again straight away just doubles the socket traffic
// that made it time out, so this only reads if no event has arrived.
async function sendWs(args, okText) {
  const r = await window.wm.komorebic(args);
  mapNote(r.ok ? okText : readableStateError(r.output), r.ok ? "good" : "bad");
  settle();
}

let settleTimer = null;
function settle() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => refreshMap(true), 260);
}

function selectedActions(wins, wsIndex, here) {
  const wrap = document.createElement("div");
  const win = wins.find((w) => w.hwnd === selected);
  wrap.innerHTML = "<h3>Selected window</h3>";

  if (!win) {
    wrap.innerHTML += '<p class="note">Click a window in the map to pick one.</p>';
    return wrap;
  }

  const who = document.createElement("p");
  who.className = "note";
  who.textContent = `${win.exe} — ${win.title}`;
  wrap.appendChild(who);

  const bar = document.createElement("div");
  bar.className = "sc-toolbar win-acts";
  [
    ["Focus", ["eager-focus", win.exe]],
    ["Float or tile", ["toggle-float"]],
    ["Monocle", ["toggle-monocle"]],
    ["Lock", ["toggle-lock"]],
    ["Retile", ["retile"]],
  ].forEach(([label, args]) => {
    const b = document.createElement("button");
    b.className = "ghost";
    b.textContent = label;
    if (!here) b.title = "This takes you to that workspace first";
    b.addEventListener("click", async () => {
      if (args[0] !== "eager-focus" && !(await focusFirst(win, wsIndex))) return;
      const r = await window.wm.komorebic(args);
      mapNote(r.ok ? `${label} sent for ${win.exe}` : readableStateError(r.output), r.ok ? "good" : "bad");
      settle();
    });
    bar.appendChild(withShortcut(b, args));
  });

  bar.appendChild(sendToMenu(win, wsIndex));
  wrap.appendChild(bar);

  if (!here) {
    const warn = document.createElement("p");
    warn.className = "note";
    warn.textContent = "These act on the focused window, and komorebi can only focus one on the "
      + "workspace it is showing, so pressing any of them switches you to this workspace first.";
    wrap.appendChild(warn);
  }
  return wrap;
}

// Rather than guess at komorebi's layout maths, this applies the layout for
// real and lets the live map show the answer.
function layoutTryout(ws, wsIndex) {
  const wrap = document.createElement("div");
  wrap.innerHTML = "<h3>Try a layout</h3>";
  const picker = document.createElement("div");
  picker.className = "layout-picker";
  const before = layoutName(ws.layout);

  Object.keys(LAYOUT_SHAPES).forEach((name) => {
    const b = document.createElement("button");
    b.className = "layout-opt" + (name === before ? " active" : "");
    b.innerHTML = layoutThumb(name) + `<span>${name}</span>`;
    b.addEventListener("click", () => sendWs(
      ["workspace-layout", String(mapMonitor), String(wsIndex), kebab(name)],
      `${name} applied to ${ws.name || wsIndex + 1}`));
    picker.appendChild(b);
  });
  wrap.appendChild(picker);

  const note = document.createElement("p");
  note.className = "note";
  note.textContent = `This workspace is set to ${before} in your config. Changing it here moves `
    + "the running window manager only, and works on a workspace you are not on. Nothing is "
    + "written until you set it on the Window manager tab and save.";
  wrap.appendChild(note);
  return wrap;
}

function historyPanel() {
  const wrap = document.createElement("div");
  wrap.className = "map-history";
  wrap.innerHTML = "<h3>What just happened</h3>";
  if (!mapHistory.length) {
    wrap.innerHTML += '<p class="note">Nothing yet. Move a window and it will show up here.</p>';
    return wrap;
  }
  mapHistory.forEach((h) => {
    const row = document.createElement("div");
    row.className = "hist-row";
    row.innerHTML = `<span class="when">${h.stamp}</span><span>${h.text}</span>`;
    wrap.appendChild(row);
  });
  return wrap;
}
