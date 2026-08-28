/* Folding a section away.

   The Window manager tab is nine sections long and most of the time you want
   one of them, so every heading is a toggle. What is folded is remembered per
   section, keyed on the tab it lives in and its heading, because the sections
   in the markup have no ids and the ones Settings builds are made fresh on
   every change.

   Two things have to reach past a folded section: searching, which would
   otherwise hide its own matches, and the palette, which lands on a row inside
   one. Both open it rather than fighting it. */

const FOLDED = "wm-folded";

function loadFolded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FOLDED) || "[]"));
  } catch {
    return new Set();
  }
}

function saveFolded(set) {
  try { localStorage.setItem(FOLDED, JSON.stringify([...set])); } catch {}
}

const heading = (group) => group.querySelector(":scope > h2");

function groupKey(group) {
  const view = group.closest("section.view")?.id || "";
  const h2 = heading(group);
  return `${view}/${h2 ? h2.textContent.trim() : ""}`;
}

function foldGroup(group, open) {
  slide(group, () => group.classList.toggle("folded", !open));
  heading(group)?.setAttribute("aria-expanded", String(open));
  const folded = loadFolded();
  const key = groupKey(group);
  if (open) folded.delete(key);
  else folded.add(key);
  saveFolded(folded);
}

/* Folded content is display:none, which cannot be animated between, so the
   section's own height is measured before and after and moved between the two.
   That needs no wrapper element, which matters here: a good deal of the
   stylesheet selects the direct children of a section, and burying them one
   level deeper to have something to animate would have broken all of it.

   Overflow is only hidden while it runs. Leaving it hidden would clip the
   things that legitimately hang outside a section, the workspace menu on the
   live map being the one that would have bitten. */
const SLIDE = 220;

function slide(group, change) {
  if (document.documentElement.dataset.motion === "off"
      || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    change();
    return;
  }

  const from = group.offsetHeight;
  change();
  const to = group.offsetHeight;
  if (from === to) return;

  group.classList.add("sliding");
  group.style.height = `${from}px`;
  void group.offsetHeight;
  group.style.height = `${to}px`;

  clearTimeout(group.slideTimer);
  group.slideTimer = setTimeout(() => {
    group.classList.remove("sliding");
    group.style.height = "";
  }, SLIDE);
}

// Called again after every render, because Settings and the map rebuild their
// sections and the new headings need binding.
function setupGroups() {
  const folded = loadFolded();
  document.querySelectorAll("section.view .group").forEach((group) => {
    const h2 = heading(group);
    if (!h2) return;
    group.classList.toggle("folded", folded.has(groupKey(group)));
    if (h2.dataset.fold) return;

    h2.dataset.fold = "1";
    h2.tabIndex = 0;
    h2.setAttribute("role", "button");
    h2.setAttribute("aria-expanded", String(!group.classList.contains("folded")));
    const toggle = () => foldGroup(group, group.classList.contains("folded"));
    h2.addEventListener("click", toggle);
    h2.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });
}

function unfoldFor(el) {
  const group = el.closest(".group");
  if (group?.classList.contains("folded")) foldGroup(group, true);
}

// A filter opens what it matched without touching what you chose to fold, so
// clearing the box puts your own arrangement back rather than a flattened one.
function showWhileFiltering(group, on) {
  group.classList.toggle("unfolded-by-search", on);
}
