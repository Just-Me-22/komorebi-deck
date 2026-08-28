/* Small drawings that answer "what does this actually do". Each one reads the
   live values out of state and redraws, so the picture always matches what is
   about to be written to komorebi.json. Everything is inline SVG: no images,
   no canvas, no animation loop. */

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(w, h) {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", `0 0 ${w} ${h}`);
  el.setAttribute("class", "pv");
  return el;
}

function rect(parent, x, y, w, h, cls) {
  const r = document.createElementNS(SVG_NS, "rect");
  r.setAttribute("x", x); r.setAttribute("y", y);
  r.setAttribute("width", Math.max(0, w)); r.setAttribute("height", Math.max(0, h));
  if (cls) r.setAttribute("class", cls);
  parent.appendChild(r);
  return r;
}

// SVG text does not wrap and does not clip, so a caption that outgrows the
// viewBox just runs off the side of the picture. Captions are HTML now.
function pvCaption(box, str) {
  const p = document.createElement("p");
  p.className = "pv-cap";
  p.textContent = str;
  box.appendChild(p);
  return p;
}

function text(parent, x, y, str, cls) {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", x); t.setAttribute("y", y);
  t.setAttribute("class", cls || "pv-t");
  t.textContent = str;
  parent.appendChild(t);
  return t;
}

/* ---------- where a new floating window lands ---------- */

function drawPlacement(box, placement, ratio) {
  box.innerHTML = "";
  const s = svg(200, 118);
  rect(s, 1, 1, 198, 116, "pv-screen");

  let says;
  if (placement === "None") {
    rect(s, 18, 14, 84, 56, "pv-win");
    says = "wherever the app opens it";
  } else if (placement === "Center") {
    rect(s, 58, 34, 84, 50, "pv-win");
    says = "centred, at whatever size the app asked for";
  } else {
    const shape = { Ultrawide: [140, 44], Widescreen: [124, 58], Standard: [98, 62] };
    const [w, h] = shape[ratio] || shape.Widescreen;
    rect(s, (200 - w) / 2, (118 - h) / 2, w, h, "pv-win");
    says = `centred and resized to ${ratio || "Widescreen"}`;
  }
  box.appendChild(s);
  pvCaption(box, says);
}

/* ---------- the border, drawn to scale ---------- */

function drawBorder(box) {
  const c = state.komorebi;
  box.innerHTML = "";
  const s = svg(200, 110);
  rect(s, 1, 1, 198, 108, "pv-screen");

  const win = { x: 46, y: 24, w: 108, h: 62 };
  rect(s, win.x, win.y, win.w, win.h, "pv-win");

  if (c.border !== false) {
    // offset moves the border outward; negative pulls it under the window
    const off = c.border_offset ?? -1;
    const bw = Math.max(1, c.border_width ?? 8);
    const b = rect(s, win.x - off, win.y - off, win.w + off * 2, win.h + off * 2, "pv-border");
    b.setAttribute("stroke-width", bw);
    b.setAttribute("stroke", colourFor("single_border"));
    if ((c.border_style || "System") === "Rounded") b.setAttribute("rx", 6);
  }

  const off = c.border_offset ?? -1;
  box.appendChild(s);
  pvCaption(box, c.border === false
    ? "borders are off" : `${c.border_width ?? 8}px thick, offset ${off}`);
}

/* ---------- how faded an unfocused window gets ---------- */

function drawTransparency(box) {
  const c = state.komorebi;
  box.innerHTML = "";
  const s = svg(200, 96);
  rect(s, 1, 1, 198, 94, "pv-screen");

  rect(s, 12, 16, 84, 52, "pv-win pv-focused");
  const alpha = c.transparency === false ? 255 : (c.transparency_alpha ?? 200);
  const faded = rect(s, 104, 16, 84, 52, "pv-win pv-focused");
  faded.setAttribute("opacity", (alpha / 255).toFixed(3));

  text(s, 12, 86, "focused");
  text(s, 104, 86, "other");
  box.appendChild(s);
  pvCaption(box, c.transparency === false
    ? "unfocused windows are not faded" : `unfocused windows sit at alpha ${alpha} of 255`);
}

/* ---------- the easing curve ---------- */

// The standard Penner set, matching the names komorebi accepts.
const EASE = {
  Linear: (t) => t,
  EaseInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  EaseOutSine: (t) => Math.sin((t * Math.PI) / 2),
  EaseInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  EaseInQuad: (t) => t * t,
  EaseOutQuad: (t) => 1 - (1 - t) ** 2,
  EaseInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  EaseInCubic: (t) => t ** 3,
  EaseOutCubic: (t) => 1 - (1 - t) ** 3,
  EaseInOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  EaseInQuart: (t) => t ** 4,
  EaseOutQuart: (t) => 1 - (1 - t) ** 4,
  EaseInOutQuart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  EaseInQuint: (t) => t ** 5,
  EaseOutQuint: (t) => 1 - (1 - t) ** 5,
  EaseInOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  EaseInExpo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  EaseOutExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  EaseInOutExpo: (t) =>
    t === 0 ? 0 : t === 1 ? 1
      : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
  EaseInCirc: (t) => 1 - Math.sqrt(1 - t ** 2),
  EaseOutCirc: (t) => Math.sqrt(1 - (t - 1) ** 2),
  EaseInOutCirc: (t) =>
    t < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2
      : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2,
  EaseInBack: (t) => 2.70158 * t ** 3 - 1.70158 * t ** 2,
  EaseOutBack: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  EaseInOutBack: (t) => {
    const c = 2.5949095;
    return t < 0.5
      ? ((2 * t) ** 2 * ((c + 1) * 2 * t - c)) / 2
      : ((2 * t - 2) ** 2 * ((c + 1) * (t * 2 - 2) + c) + 2) / 2;
  },
  EaseInElastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1
      : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3)),
  EaseOutElastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1
      : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  EaseInOutElastic: (t) => {
    const c = (2 * Math.PI) / 4.5;
    return t === 0 ? 0 : t === 1 ? 1
      : t < 0.5 ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * c)) / 2
        : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * c)) / 2 + 1;
  },
  EaseOutBounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};
EASE.EaseInBounce = (t) => 1 - EASE.EaseOutBounce(1 - t);
EASE.EaseInOutBounce = (t) =>
  t < 0.5 ? (1 - EASE.EaseOutBounce(1 - 2 * t)) / 2 : (1 + EASE.EaseOutBounce(2 * t - 1)) / 2;

// Shows the movement rather than plotting it. Runs once when you land here or
// change a setting, and on Replay, never on its own.
function drawEasing(box, style, duration) {
  box.innerHTML = "";
  const fn = EASE[style] || EASE.Linear;
  const W = 220, H = 84;
  const s = svg(W, H);
  rect(s, 1, 1, W - 2, H - 2, "pv-screen");

  const from = 10, to = W - 78, y = 18, w = 68, h = 40;
  rect(s, from, y, w, h, "pv-ghost");
  rect(s, to, y, w, h, "pv-ghost");
  const mover = rect(s, from, y, w, h, "pv-win pv-focused");

  box.appendChild(s);
  const caption = pvCaption(box, `${style}, ${duration}ms`);

  const replay = document.createElement("button");
  replay.className = "ghost small";
  replay.textContent = "Replay";
  box.appendChild(replay);

  const reduced = document.documentElement.dataset.motion === "off"
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let raf = null;

  function play() {
    cancelAnimationFrame(raf);
    if (reduced) { mover.setAttribute("x", to); return; }
    const started = performance.now();
    const ms = Math.max(1, Number(duration) || 250);
    const step = (now) => {
      const t = Math.min(1, (now - started) / ms);
      mover.setAttribute("x", from + (to - from) * fn(t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  replay.addEventListener("click", play);
  caption.textContent = reduced
    ? `${style}, ${duration}ms (motion reduced)` : `${style}, ${duration}ms`;
  play();
}

// The band komorebi will not tile into, which is where the bar lives.
function drawWorkArea(box) {
  const c = state.komorebi;
  const o = c.global_work_area_offset || {};
  box.innerHTML = "";
  const s = svg(200, 112);
  rect(s, 1, 1, 198, 110, "pv-screen");

  const scale = 190 / 1920;
  const left = 5 + (o.left || 0) * scale;
  const top = 5 + (o.top || 0) * scale;
  const w = ((o.right || 1920) * scale) || 190;
  const h = ((o.bottom || 1080) * (102 / 1080)) || 102;
  rect(s, left, top, Math.min(w, 190), Math.min(h, 102), "pv-area");

  const any = (o.left || o.top || o.right || o.bottom);
  box.appendChild(s);
  pvCaption(box, any
    ? `left ${o.left || 0}, top ${o.top || 0}, width ${o.right || 0}, height ${o.bottom || 0}`
    : "nothing reserved here, so Windows decides the work area on its own");
}

/* ---------- the gaps ---------- */

function drawSpacing(box, which) {
  const c = state.komorebi;
  box.innerHTML = "";
  const s = svg(200, 110);
  rect(s, 1, 1, 198, 108, "pv-screen");

  // Draw both gaps at once so the difference between them is the point.
  const edge = Math.min(28, (c.default_workspace_padding ?? 10));
  const gap = Math.min(24, (c.default_container_padding ?? 10));
  const inner = { x: 6 + edge, y: 6 + edge, w: 188 - edge * 2, h: 84 - edge * 2 };

  if (which === "edge") rect(s, 6, 6, 188, 84, "pv-gapfill");
  rect(s, inner.x, inner.y, inner.w, inner.h, "pv-area");

  const half = (inner.w - gap) / 2;
  rect(s, inner.x, inner.y, half, inner.h, "pv-win");
  rect(s, inner.x + half + gap, inner.y, half, inner.h, "pv-win");
  if (which === "gap") rect(s, inner.x + half, inner.y, gap, inner.h, "pv-gapfill");

  box.appendChild(s);
  pvCaption(box, which === "edge"
    ? `${c.default_workspace_padding ?? 0}px around the edge of the screen`
    : `${c.default_container_padding ?? 0}px between one window and the next`);
}

/* ---------- how windows get hidden ---------- */

function drawHiding(box, mode) {
  box.innerHTML = "";
  const s = svg(200, 96);
  rect(s, 1, 1, 198, 94, "pv-screen");
  rect(s, 14, 14, 78, 50, "pv-win pv-focused");

  const gone = rect(s, 106, 14, 78, 50, "pv-win");
  let says;
  if (mode === "Minimize") {
    gone.setAttribute("height", 12);
    gone.setAttribute("y", 52);
    says = "the one you left sits in the taskbar";
  } else if (mode === "Hide") {
    gone.setAttribute("opacity", 0.12);
    says = "the one you left is gone as far as Windows is concerned";
  } else {
    gone.setAttribute("opacity", 0.3);
    gone.setAttribute("stroke-dasharray", "4 3");
    says = "the one you left is hidden and the app never notices";
  }
  text(s, 14, 84, "here");
  text(s, 106, 84, "gone");
  box.appendChild(s);
  pvCaption(box, says);
}

/* ---------- the stackbar ---------- */

// Drawn at the real ratio of bar height to tab width, because those two numbers
// are the ones people get wrong.
function drawStackbar(box) {
  const sb = state.komorebi.stackbar || {};
  const tabs = sb.tabs || {};
  const mode = sb.mode || "Never";
  box.innerHTML = "";
  const s = svg(220, 108);
  rect(s, 1, 1, 218, 106, "pv-screen");

  const win = { x: 14, y: 14, w: 192, h: 74 };
  rect(s, win.x, win.y, win.w, win.h, "pv-win");

  if (mode === "Never") {
    text(s, win.x + 8, win.y + 40, "no tabs");
    box.appendChild(s);
    pvCaption(box, "The mode is Never, so tabs can never appear. Set it to OnStack.");
    return;
  }

  const barH = Math.max(4, Math.min(30, (sb.height ?? 20) * 0.55));
  const tabW = Math.max(3, Math.min(96, (tabs.width ?? 200) * 0.3));
  const font = Math.max(2, Math.min(barH - 2, (tabs.font_size ?? 12) * 0.55));

  for (let i = 0; i < 3; i++) {
    const x = win.x + i * (tabW + 1);
    if (x + tabW > win.x + win.w) break;
    const t = rect(s, x, win.y, tabW, barH);
    t.setAttribute("fill", tabs.background || "#1e1e2e");
    const label = text(s, x + 3, win.y + barH - (barH - font) / 2 - 1, "app");
    label.setAttribute("fill", i === 0 ? (tabs.focused_text || "#ffffff") : (tabs.unfocused_text || "#cdd6f4"));
    label.setAttribute("font-size", font);
  }

  const clipped = (tabs.font_size ?? 12) > (sb.height ?? 20) - 4;
  box.appendChild(s);
  pvCaption(box,
    `${sb.height ?? 20}px bar, ${tabs.width ?? 200}px tabs, ${tabs.font_size ?? 12}px text`
    + (clipped ? ". The text is too tall for the bar and will be clipped." : ""));
}

/* ---------- wiring ---------- */

function renderPreviews() {
  if (!state.komorebi) return;
  const c = state.komorebi;
  const at = (id) => document.querySelector(id);

  if (at("#pv-placement")) {
    drawPlacement(at("#pv-placement"), c.float_override_placement, c.floating_window_aspect_ratio);
  }
  if (at("#pv-edge")) drawSpacing(at("#pv-edge"), "edge");
  if (at("#pv-gap")) drawSpacing(at("#pv-gap"), "gap");
  if (at("#pv-hiding")) drawHiding(at("#pv-hiding"), c.window_hiding_behaviour);
  if (at("#pv-workarea")) drawWorkArea(at("#pv-workarea"));
  if (at("#pv-border")) drawBorder(at("#pv-border"));
  if (at("#pv-transparency")) drawTransparency(at("#pv-transparency"));
  if (at("#pv-stackbar")) drawStackbar(at("#pv-stackbar"));
  if (at("#pv-easing")) {
    drawEasing(at("#pv-easing"), animGet("style", "movement"), animGet("duration", "movement"));
  }
}
