/* Hover a setting, get a note about what it does. Written for someone changing
   the setting, not someone reading the schema: what you will see on screen,
   and the value that is usually right. */

const EXPLAIN = {
  /* ---- floating ---- */
  float_override: ["Every new window floats",
    "New windows open loose on top instead of joining the tiled layout. Turn it off and everything gets tiled unless a rule says otherwise."],
  float_override_placement: ["Where a floated window lands",
    "Applies to the windows floated by the setting above. Center drops it in the middle at whatever size the app asked for. The resize options pick the size too.", "placement"],
  toggle_float_placement: ["Where a window goes when you float it yourself",
    "This is the one you get when you hit the float shortcut on a window that is already open.", "placement"],
  float_rule_placement: ["Where an app with a float rule lands",
    "Only for the apps you have listed as always floating.", "placement"],
  floating_window_aspect_ratio: ["The shape a floated window gets resized to",
    "Ignored unless the placement says resize. Ultrawide is the widest, Standard is closest to square."],

  /* ---- spacing ---- */
  default_workspace_padding: ["Gap between the windows and the edge of the screen",
    "The margin around the whole tiled area. Turn it up if you want to see more of your wallpaper.", "spacing:edge"],
  default_container_padding: ["Gap between one window and the next",
    "How much space tiled windows leave between each other. Set it to 0 and they touch.", "spacing:gap"],
  global_work_area_offset: ["Space kept clear around the whole screen",
    "Shrinks the area komorebi tiles into, on top of what Windows already keeps back for the taskbar. Watch the names: komorebi reads right and bottom as a width and a height, not as distances from those edges."],

  /* ---- behaviour ---- */
  mouse_follows_focus: ["The pointer jumps to whatever you focus",
    "Move focus with the keyboard and the mouse pointer goes with it, so a click lands where you are already looking. Off, the pointer stays where you left it."],
  window_hiding_behaviour: ["How windows vanish when you switch workspace",
    "Cloak is the quiet one and the usual choice. Minimize leaves them sitting in the taskbar. Hide is the blunt option and some apps do not come back from it cleanly.", "hiding"],
  monocle_focus_behaviour: ["Focusing past the last window in monocle",
    "Cycle wraps back round to the first one. NoOp just stops there."],
  resize_delta: ["How far one press moves a window edge",
    "Your resize shortcuts move by this many pixels. Moving a window swaps it with its neighbour rather than nudging it, so this does nothing there."],

  /* ---- borders ---- */
  border: ["Draw borders at all",
    "Off, komorebi leaves window edges alone and you lose the colour that tells you which window is focused.", "border"],
  border_width: ["How thick the border is, in pixels",
    "1 or 2 is enough to read at a glance. Past about 6 it starts eating into the window.", "border"],
  border_offset: ["How far the border sits from the window edge",
    "Negative pulls it in under the window, positive pushes it out into the gap. This is the closest thing to a shape control, because komorebi has no corner radius.", "border"],
  border_style: ["The corner shape",
    "Rounded is the Windows 11 corner, Square is the Windows 10 one, System follows whatever Windows is doing.", "border"],
  border_implementation: ["Which border actually gets drawn",
    "Komorebi draws its own, so the width, offset and colours all apply. Windows uses the thin system accent border and ignores most of them.", "border"],

  /* ---- transparency ---- */
  transparency: ["Fade the windows you are not using",
    "The focused window stays solid and everything else dims, which keeps your eye in the right place.", "transparency"],
  transparency_alpha: ["How solid an unfocused window stays",
    "255 leaves it untouched, 0 makes it invisible. Around 200 is a dim you stop noticing after a day.", "transparency"],

  /* ---- border colours ---- */
  single_border: ["A container holding one window",
    "The everyday colour. This is what you see on most focused windows."],
  stack_border: ["A container holding several windows",
    "Tells you there are more windows behind this one before you go looking for them."],
  monocle_border: ["A window blown up to fill the workspace",
    "Worth making this one obvious, because monocle hides everything else and it is easy to forget you are in it."],
  floating_border: ["A window that is not tiled",
    "With float override on, most of your windows are this one."],
  unfocused_border: ["Everything you are not using",
    "Keep it quiet. If it competes with the focused colour you lose the whole point of having borders."],
  unfocused_locked_border: ["Unfocused, and locked in place",
    "A locked container will not be displaced by new windows. This colour is how you tell."],

  /* ---- other ---- */
  "live-apply": ["Apply as you change things",
    "Each setting is sent straight to the running komorebi as you touch it, so you can see it without a restart. It is still written to the config file when you save. A few settings have no live command and say so on the row."],
  wallpaper: ["A picture per workspace",
    "komorebi swaps the desktop background as you move between workspaces. Theme from image builds a whole colour palette out of the picture, which then overrides your border colours."],

  /* ---- animation ---- */
  "animation kinds": ["Movement and fade, separately",
    "On, you get one set of controls for windows sliding into place and another for the focus fade, each with its own timing. Off, both share one setting."],
  "animation.enabled": ["Animate instead of snapping",
    "Off, windows jump straight to where they are going. On, they travel there."],
  "animation.duration": ["How long it takes, in milliseconds",
    "150 to 250 feels quick. Past 400 you start waiting for the window to catch up.", "easing"],
  "animation.style": ["The shape of the movement",
    "The curve is position over time. Flat ones move steadily. The ones that shoot past the line overshoot and spring back.", "easing"],
  "animation.fps": ["Frames per second while animating",
    "60 matches most screens. Higher costs more work for something on screen for a fifth of a second."],
  "animation.ghost_movement": ["Animate on the GPU",
    "Draws the moving window on a composited surface instead of shoving the real one around frame by frame. Smoother, and komorebi recommends it. Needs a restart."],

  /* ---- stackbar ---- */
  "stackbar.mode": ["When the tab bar shows up",
    "OnStack is the useful one: tabs appear only when a container is holding more than one window. Never hides it whatever else you set here, which is easy to miss."],
  "stackbar.height": ["How tall the tab bar is, in pixels",
    "It has to fit the font below it. Somewhere around 24 to 30 is comfortable."],
  "stackbar.label": ["What each tab says",
    "Process shows the exe name and stays put. Title shows the window title, which moves around as you work."],
  "tabs.width": ["How wide one tab is, in pixels",
    "Fixed per tab, not shared out across the bar. Too narrow and the names get cut off."],
  "tabs.font_family": ["The font on the tabs",
    "Any font installed on this machine. Get the name wrong and it quietly falls back to something else."],
  "tabs.font_size": ["Text size on the tabs",
    "Keep it well under the bar height or the letters get clipped."],
  "tabs.background": ["Colour behind the tabs",
    "While a theme is set, the theme's stackbar colours win and this is ignored."],
  "tabs.focused_text": ["Colour of the tab you are on",
    "Needs to stand off the background clearly, since this is the only thing marking which window is in front."],
  "tabs.unfocused_text": ["Colour of the other tabs",
    "Dimmer than the focused one, or the bar is hard to read at a glance."],
};

let explainRow = null;

const IDLE = ["Hover a setting", "Point at anything above and this line says what it does."];

// Rows built in JS carry their key in the small label rather than a data
// attribute, and the animation ones are suffixed with the kind.
function normaliseKey(t) {
  return t.split(",")[0].trim().replace(/\.(movement|transparency)$/, "");
}

function explainKeyFor(row) {
  if (row.dataset.explain) return row.dataset.explain;
  const el = row.querySelector("[data-key],[data-nested]");
  // the four screen-edge boxes are one setting, so they share one note
  if (el) return (el.dataset.key || el.dataset.nested).split(".")[0];
  const em = row.querySelector(".lbl em");
  return em ? normaliseKey(em.textContent) : null;
}

function paint(title, body, key) {
  const pop = document.querySelector("#explain");
  pop.className = "explain" + (key ? "" : " idle");
  pop.innerHTML = `<h4>${title}</h4><p>${body}</p>` + (key ? `<code>${key}</code>` : "");
}

function showExplain(row) {
  const key = explainKeyFor(row);
  const entry = EXPLAIN[key];
  if (!entry) { hideExplain(); return; }
  paint(entry[0], entry[1], key);
  explainRow = row;
}

function hideExplain() {
  paint(IDLE[0], IDLE[1], null);
  explainRow = null;
}

// One delegated listener rather than one per row, and the only layout read
// happens when the pointer actually reaches a new row.
const explainHost = document.querySelector("main");
explainHost.addEventListener("mouseover", (e) => {
  const row = e.target.closest("[data-explain], .row");
  if (row === explainRow) return;
  if (!row) { hideExplain(); return; }
  showExplain(row);
});
explainHost.addEventListener("mouseleave", hideExplain);

hideExplain();
