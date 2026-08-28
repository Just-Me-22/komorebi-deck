/* Works out which of your rules a given window matches, using the same
   identifiers and strategies komorebi does. A rule is either one condition or
   an array of conditions that must all hold. */

const MATCHERS = {
  Legacy: (v, id) => v === id || v.startsWith(id),
  Equals: (v, id) => v === id,
  StartsWith: (v, id) => v.startsWith(id),
  EndsWith: (v, id) => v.endsWith(id),
  Contains: (v, id) => v.includes(id),
  Regex: (v, id) => { try { return new RegExp(id).test(v); } catch { return false; } },
  DoesNotEqual: (v, id) => v !== id,
  DoesNotStartWith: (v, id) => !v.startsWith(id),
  DoesNotEndWith: (v, id) => !v.endsWith(id),
  DoesNotContain: (v, id) => !v.includes(id),
};

function windowField(win, kind) {
  if (kind === "Exe") return win.exe || "";
  if (kind === "Class") return win.class || "";
  if (kind === "Title") return win.title || "";
  return win.path || win.exe || "";
}

function conditionMatches(win, cond) {
  if (!cond || !cond.id) return false;
  const fn = MATCHERS[cond.matching_strategy || "Legacy"];
  return fn ? fn(windowField(win, cond.kind), cond.id) : false;
}

function ruleMatches(win, rule) {
  if (Array.isArray(rule)) return rule.length > 0 && rule.every((c) => conditionMatches(win, c));
  return conditionMatches(win, rule);
}

// Every list komorebi keeps that can change what happens to a window, with the
// wording the app uses for it elsewhere.
function rulesFor(win, config) {
  if (!config) return [];
  const hits = [];
  const check = (list, label) => {
    (list || []).forEach((rule) => { if (ruleMatches(win, rule)) hits.push(label); });
  };

  check(config.ignore_rules, "kept on screen everywhere");
  check(config.manage_rules, "forced to be managed");
  check(config.floating_applications, "always floating");
  check(config.transparency_ignore_rules, "never faded");

  (config.monitors || []).forEach((mon, mi) => {
    (mon.workspaces || []).forEach((ws, wi) => {
      const name = ws.name || `workspace ${wi + 1}`;
      const where = (config.monitors || []).length > 1 ? ` on screen ${mi + 1}` : "";
      check(ws.workspace_rules, `sent to ${name}${where} every time`);
      check(ws.initial_workspace_rules, `sent to ${name}${where} on first launch`);
    });
  });

  const app = config.__appRules?.[(win.exe || "").replace(/\.exe$/i, "")];
  if (app) {
    Object.keys(app)
      .filter((k) => k !== "$schema" && Array.isArray(app[k]))
      .forEach((k) => hits.push(`${k} rule in applications.json`));
  }
  return [...new Set(hits)];
}
