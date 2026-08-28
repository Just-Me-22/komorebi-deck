# WM Control

A desktop editor for [komorebi](https://github.com/LGUG2Z/komorebi),
[whkd](https://github.com/LGUG2Z/whkd) and [YASB](https://github.com/amnweb/yasb),
so you can change how your window manager behaves without hand-editing JSON and
finding out at the next restart whether you got it right.

It also draws what komorebi is doing right now, to scale, and lets you drag
windows between workspaces in that drawing.

## Getting it

Download the zip from [Releases](../../releases), unzip it anywhere, run
`WM Control.exe`. There is no installer and nothing is written outside your
config files and `~/.config/wm-control`.

The download is about 110MB and unzips to about 270MB. That is Electron, not this app.

To run it from source instead:

```bash
npm install && npm start
```

## What you need

komorebi. That is the only hard requirement; the app looks for `komorebic` on
your PATH, then in scoop, then in winget's links, then in Program Files. whkd
and YASB are each optional and only disable their own tab.

If something is not where the app expects, it says so on first launch and lets
you point at it. That choice is remembered in
`~/.config/wm-control/paths.json`.

## What it edits

| Tab | File | Applying |
|---|---|---|
| Window manager | `komorebi.json` | restart komorebi |
| Live map | nothing, it drives komorebi directly | immediate |
| Looks | `komorebi.json` | most of it applies live |
| Shortcuts | `whkdrc` | restart whkd |
| Status bar | `config.yaml` | `yasbc reload` |
| App rules | `applications.json` | restart komorebi |
| Raw files | any of the above, plus the bar's `styles.css` | as above |

Config paths follow `KOMOREBI_CONFIG_HOME`, `WHKD_CONFIG_HOME` and
`YASB_CONFIG_HOME` when you have them set, and fall back to the usual defaults
when you do not.

**Save** writes to disk. **Save and apply** also restarts whatever needs
restarting, asking first before it touches komorebi, since that re-tiles every
window.

## The live map

Reads `komorebic state` and subscribes to komorebi's event pipe, so it follows
along as you work.

- Clicking a workspace shows it without switching you to it, so you can
  rearrange a workspace from wherever you are.
- Drag a floating window and it moves on your actual screen while you hold it.
  Drag a corner to resize it.
- Drag any window onto a workspace button to send it there.
- Drag a tiled window at another one to stack them.

## Safety

Editing these files by hand is how you end up without a window manager, so:

- JSON and YAML are parsed before anything is written. A file that does not
  parse is refused rather than saved.
- Every write leaves the previous version beside it as `<name>.bak-<timestamp>`.
- Restarts report whether the process actually came back, and offer to put the
  previous config back if it did not.
- **Setups** keeps named copies of every config file so you can switch between
  whole arrangements.

## Versions

The dropdowns are built from `komorebic static-config-schema`, read from the
komorebi you actually have, so they offer what your version accepts rather than
what mine did. The lists in `src/renderer/enums.js` are the fallback for when
komorebi cannot be reached, and were generated from 0.1.42.

Border colours are Catppuccin palette names rather than hex, which is what the
`theme` block expects when `palette` is `Catppuccin`.

## Building a release

```bash
npm run build
```

Puts a zip in `dist/`. Pushing a `v*` tag does the same on GitHub and attaches
it to the release.

## Finding things

**Ctrl+K** opens a palette over every setting in every tab, plus the tabs
themselves and what the footer and the rail do. Arrows to move, enter to pick,
and it jumps to the setting and marks it so you can see where you landed.

The box in the corner of the Window manager, Looks and Settings headers filters
that tab in place instead.

**Ctrl+Z** and **Ctrl+Y** undo and redo, sixty steps deep, covering everything
you can change including whole workspaces and rules.

## Not done yet

- Reordering widgets within a YASB island (you can only remove them)
- The `CubicBezier` animation style komorebi supports
- An application icon

## Licence

MIT.
