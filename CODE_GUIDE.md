# Code Guide — how the site works (and how to change it)

This is the "study companion" to the code. The [README](README.md) tells you how to *use* the
project (edit the spreadsheet, draw routes, publish). This file explains how the **code** works
so you can edit the site yourself.

Everything here points at real functions in [app.js](app.js), [styles.css](styles.css),
[index.html](index.html), etc. Open them side by side. In VS Code you can press <kbd>Ctrl</kbd>
and click a function name, or use <kbd>Ctrl</kbd>+<kbd>P</kbd> then type `@` to jump to a function.

---

## Contents

1. [The big picture](#1-the-big-picture)
2. [The files, one by one](#2-the-files-one-by-one)
3. [Data flow: spreadsheet → screen](#3-data-flow-spreadsheet--screen)
4. [The timeline model (beats, appearances, "where is everyone?")](#4-the-timeline-model)
5. [Coordinate systems — the one thing to really understand](#5-coordinate-systems)
6. [The render pipeline](#6-the-render-pipeline)
7. [Movement animation](#7-movement-animation)
8. [The travel network (roads, rail, air)](#8-the-travel-network-roads-rail-air)
9. [Camera / view modes (zoom, pan, follow)](#9-camera--view-modes)
10. [Markers, pips, the cast strip, the codex](#10-markers-pips-cast-codex)
11. [styles.css tour](#11-stylescss-tour)
12. [The tools/ folder](#12-the-tools-folder)
13. [Cookbook — "how do I…?"](#13-cookbook)
14. [Gotchas](#14-gotchas)
15. [Glossary](#15-glossary)

---

## 1. The big picture

It's a **plain static website** — no framework, no build step for the site itself, no server.
Three `<script>` tags load data and logic, and the browser does the rest:

```
index.html  ──loads──►  data.js     (window.TRAILS      — all timeline data, GENERATED)
                        routes.js   (window.ROAD_NETWORK + window.ROUTES — roads, hand-made)
                        app.js      (all the logic; runs inside one big function)
```

`app.js` reads those two global objects, builds the map, and re-draws everything whenever the
**current beat** changes. That's the whole architecture.

The only "build step" is on the data side: a Python script turns your Excel file into `data.js`.
That's separate from running the site.

---

## 2. The files, one by one

| File | What it is | Do you hand-edit it? |
|---|---|---|
| [index.html](index.html) | Page skeleton: the topbar, the map frame, the cast strip, the tabs. | Yes, rarely (structure only). |
| [styles.css](styles.css) | All visual styling. | Yes — colors, sizes, layout. |
| [app.js](app.js) | All behavior: timeline, animation, camera, codex. | Yes — this is the brain. |
| [data.js](data.js) | `window.TRAILS` — characters, locations, beats, appearances, codex. | **No.** Generated from Excel. |
| [routes.js](routes.js) | `window.ROAD_NETWORK` (the road graph) + `window.ROUTES` (manual overrides). | Yes — by hand or via the editor tool. |
| [build_data.py](build_data.py) | Reads `TrailsTimeline.xlsx`, writes `data.js`. | Yes, when you add a new column. |
| [TrailsTimeline.xlsx](TrailsTimeline.xlsx) | The source of truth for all timeline data. | Yes — this is where data lives. |
| assets/ | All images: the map (`assets/zemuria.png`) and one folder per character under `characters/<char_id>/`. | Add images here. |
| tools/ | Two standalone helper pages (see §12). | They're dev tools, not the site. |

**Important:** the site files reference each other by relative path, so they must stay siblings
in the same folder. The tools in `tools/` reach back up with `../` (e.g. `../assets/zemuria.png`).

---

## 3. Data flow: spreadsheet → screen

```
TrailsTimeline.xlsx
      │   python build_data.py        (reads 5 sheets, cleans them, writes JSON)
      ▼
   data.js  ──►  window.TRAILS = { characters, locations, beats, appearances, codex }
      │
      ▼
   app.js reads window.TRAILS  ──►  draws the map for the current beat
```

[build_data.py](build_data.py) is small and worth reading top to bottom. The key parts:

- `clean()`, `to_int()`, `to_float()`, `to_bool()` — turn spreadsheet cells into clean values
  (blank → `null`/`false`, numbers → numbers).
- `rows(df, spec)` — the heart of it. `spec` maps each **output key** to a `(column_name, caster)`
  pair. So adding a new field is just one line in a `spec`.
- `main()` — reads the five required sheets, builds the `data` dict, prints **sanity warnings**
  (a beat pointing at a missing location, etc.), and writes `window.TRAILS = …`.

Example: the `show_name` flag for locations was added with a single spec line —
`"show_name": ("show_name", to_bool)` — plus the `to_bool` helper. That's the pattern for any
new column.

See [DATA_DICTIONARY.md](DATA_DICTIONARY.md) for what every column means.

---

## 4. The timeline model

The whole site is "what does the world look like at beat *N*?" Here's how that's answered.

**Beats** are the steps of the story. Each has a `sequence` number; `app.js` sorts them and
keeps the current position in a single variable:

```js
var beats = D.beats.slice().sort((a,b) => a.sequence - b.sequence);  // app.js ~line 26
var index = 0;                                                       // which beat we're on
```

`index` moves via `go(i, animate)` (the ◀ ▶ buttons, the scrubber, arrow keys, and Play all call it).

**Appearances** say where each character is, and for how long. Each appearance row has a
`join_sequence` and (optionally) a `leave_sequence`. To find where a character is at a given
beat, the code scans that character's appearances for the one whose `[join, leave]` range
contains the beat's sequence:

```js
function charLocAt(charId, beat) {   // app.js ~line 128
  // ...returns the location id the character is at during this beat, or null
}
```

`activityAt()` works the same way but returns the appearance's `activity` text ("investigating",
etc.). These two functions are why scrubbing the timeline instantly shows the correct world
state — nothing is stored per-beat; it's all derived on demand from the appearance ranges.

`appsByChar` (built once near the top) is just an index: `char_id → [appearances]`, so these
lookups don't rescan the whole list every time.

---

## 5. Coordinate systems

**This is the most important section.** Three coordinate spaces exist, and most of the map code
is converting between them.

### a) Map % — how data is stored
Every location's `map_x`/`map_y`, every road point, every junction is a **percentage of the map
image** (0–100). `x` is % across the width, `y` is % down the height. Origin is the top-left.
These are resolution-independent — they stay correct at any zoom or screen size. This is what the
coordinate-finder tool gives you.

### b) The viewport `vp` — the "camera"
A single object describes what part of the map is on screen:

```js
var vp = { x: 0, y: 0, w: 100 };   // app.js ~line 47  — all in MAP %
```

- `vp.x`, `vp.y` = the map-% coordinate of the **top-left** of what's visible.
- `vp.w` = how many map-% wide the visible window is. **Smaller `w` = more zoomed in.**
  `w: 100` shows the whole continent; `w: 6` is the tightest zoom (`MIN_VW`).

Think of `vp` as a rectangle sliding and resizing over the map. *Everything* about the camera —
every zoom level, every pan, every "fly to a character" — is just a change to these three numbers.

### c) Frame % — where things land on screen
`mapToFrame()` converts a map-% point into a percentage of the **visible frame**, given the
current `vp`:

```js
function mapToFrame(px, py) {                       // app.js ~line 177
  return { fx: (px - vp.x) / vp.w * 100,
           fy: (py - vp.y) / vp.w * 100 };
}
```

Read it as: "how far is this point from the camera's top-left, measured in camera-widths,
times 100." A marker at `fx: 50, fy: 50` sits dead-center of the frame.

### How the image itself moves
The map *image* isn't redrawn — it's transformed with CSS. `applyTransform()` turns `vp` into a
`scale()` + `translate()` on the `#mapcontent` element:

```js
function applyTransform() {                          // app.js ~line 197
  var Z = 100 / vp.w;                                // zoom factor
  el.mapcontent.style.transform =
    "scale(" + Z + ") translate(" + (-vp.x) + "%, " + (-vp.y) + "%)";
}
```

So the **image** is moved by CSS, and the **overlays** (markers, pips, route lines) are positioned
with `mapToFrame()`. Because both use the same `vp`, they stay locked together. Markers and pips
live in `#markers`/`#pips`, which sit *on top of* the image and are not themselves scaled — only
their `left`/`top` percentages change, plus an optional size scale (see §9).

> If you only remember one thing: **`vp` is the camera; change `vp` and call `project()` and the
> whole map updates.**

---

## 6. The render pipeline

`render(animate)` (app.js ~line 256) is called every time the beat changes. It:

1. Updates the text UI (date, beat title, chapter, counter, scrubber position).
2. Computes **targets** — for every character on the map this beat, where should their marker be?
   (location point + a small fan-out offset from `groupOffsets()` so co-located characters don't
   stack — see §10.)
3. Decides the **end camera** (`endVP`) from the current view mode (see §9).
4. If `animate` is false (a scrub/jump): snap `vp` to `endVP`, place everything once, done.
5. If `animate` is true (◀ ▶ / play): start a `requestAnimationFrame` loop that eases `vp` and the
   marker positions from their start to their end over `ANIM_MS` (900 ms).

The actual drawing each frame happens in `project()`:

```js
function project() {                  // app.js ~line 201
  applyTransform();                   // move the image to match vp
  // place every pip, every visible character marker, via mapToFrame()
  reprojectRoutes();                  // redraw the road lines into the SVG
}
```

`project()` is the single "paint" function. The animation loop calls it ~60×/sec; a static jump
calls it once. Anything that changes the camera or marker positions ends with a `project()` call.

---

## 7. Movement animation

When a character changes location between beats, they don't teleport — they walk the road.

Inside `render()` (the `movers` section, ~line 277):

- For each character that moved, it asks the road graph for the path (`routeBetween`, §8) and
  records where they start and end.
- It draws the road line(s) with `drawRouteLine()`.
- The rAF loop advances a parameter `t` from 0→1, eased by `easeInOut(t)`. For each mover,
  `alongPath(route, t)` returns the point that far along the polyline, so the marker slides along
  the real road. `vp` is eased in parallel, so the camera glides too.
- At `t === 1`, positions snap to exact targets and the path is left drawn.

`alongPath()` (~line 144) measures the total length of the polyline, then walks segments until it
finds where `t` of the total length lands — standard "point at fraction along a path" math.

**Route lifecycle:** the latest travelled path stays drawn until the next move starts.
`clearRoutes()` is called at the top of each new move (and on jumps), then fresh lines are drawn.
(`reprojectRoutes()` keeps already-drawn lines correct when you pan/zoom.)

---

## 8. The travel network (roads, rail, air)

Defined in [routes.js](routes.js); consumed by the "TRAVEL GRAPHS" section of app.js. The full
how-to-draw explanation is in the comments at the top of `routes.js` — here's how the *code* uses it.

There are two graphs of the same shape — `window.ROAD_NETWORK` (roads) and `window.RAIL_NETWORK`
(train lines) — each with `nodes` (every location with coordinates, plus any extra `junctions`) and
`edges` (two-way segments, each optionally bending through `via` points).

- `buildGraphFor(net)` builds one graph: `nodeCoord` (id → {x,y}) and `adj` (an adjacency list —
  for each node, the edges leaving it, each with its pixel **length** as weight and its full point
  list `poly`). `buildGraph()` builds both into `graphs.foot` and `graphs.rail`.
- `shortestNodes(g, from, to)` is **Dijkstra's algorithm** over one graph — the shortest chain of
  nodes between two locations; `graphRoute(g, …)` stitches that into a polyline.
- `routeBetween(fromLoc, toLoc, travelMode)` is what `render` calls, picking by the move's
  **travel mode** (`travelModeAt(charId, beat)` = the appearance's `travel_mode` if set, else the
  beat's `travel_mode`, else foot — same default/override pattern as location):
  - **`air`** → a straight line between the two stops.
  - **`rail`** → the rail graph; **straight-line fallback** while `RAIL_NETWORK` is empty.
  - **`foot`** (blank/default) → a `window.ROUTES` override if present, else the road graph, else a
    straight line.

That straight-line fallback (for foot) is your "did I forget a road?" signal — if a foot journey
cuts straight across the map, there's no graph path connecting those two places yet.

You normally edit the **road** network with **`tools/road-network-editor.html`** (§12), not by hand;
it now also passes the `RAIL_NETWORK` block through untouched, so pasting its output won't wipe your
rail lines. Rail lines are added by hand for now (same syntax as roads).

---

## 9. Camera / view modes

`mode` (app.js ~line 43) decides how `endVP` is chosen each render. `targetViewport()` (~line 191)
implements it:

| `mode` | Behavior |
|---|---|
| `theater` | Frame **all** locations at a stable zoom (`theaterBox`). The default. |
| `follow` | Frame just the characters active this beat (and any movers). |
| `whole` | The entire continent (`vp = {0,0,100}`). |
| `free` | Hold whatever the user panned/zoomed to — don't auto-reframe. |
| `char` | Lock onto one character (`followId`) and re-center on them every beat. |

`fitBox(pts)` (~line 178) is the helper that computes a square viewport snugly containing a set of
points, with padding (`VIEW_PAD`) and a minimum zoom (`MIN_VW`). `theaterBox` is computed once at
startup from all location coordinates.

### The interactive camera (added on top of the modes)
All in the "manual pan / zoom" section (~line 385):

- **Scroll-wheel zoom** toward the cursor: converts the cursor to a map point, changes `vp.w`,
  then repositions `vp.x/vp.y` so that point stays under the cursor. `clampVP()` keeps `vp` in
  bounds. The first manual interaction calls `enterFreeMode()` (switches `mode` to `free`).
- **Drag to pan:** pointer events translate cursor movement into `vp.x/vp.y` changes.
- **Click a cast chip → follow:** `focusCharacter(id)` sets `mode = "char"`, `followId = id`, and
  `animateVP()` flies the camera to them; from then on `render()` re-centers on them each beat
  (`charBox()` computes the framing). Manually panning/zooming clears the lock.

### Icon size vs. zoom
`applyTransform()` also sets a `--icon-scale` CSS variable from the zoom level (normalized so it's
`1` at the default framing, clamped at the extremes). `.marker` and `.loc-pip` multiply their
transform by `scale(var(--icon-scale))`, so icons shrink when you zoom out (gaps reappear) and grow
when you zoom in. `ZBASE` is the reference zoom that makes icons full-size at the theater view.

---

## 10. Markers, pips, cast, codex

**Markers** (the character badges) — `makeMarker()` (~line 214) builds one `div.marker` per
character (a colored badge with initials or an icon, plus a name tag). They're created lazily and
cached in `markerEls`. `project()` positions them; `currentPos` holds each one's live map-% spot.

**Pips** (the small location dots) — `renderPips()` (~line 359) creates one `div.loc-pip` per
location that has coordinates. The location's name is in `data-name` and shows on hover via CSS.
Locations flagged `show_name` in the spreadsheet get the `show-name` class, which keeps the label
always visible.

**The cast strip** — `renderCast(beat)` (~line 327) lists the characters on the map this beat as
clickable chips under the map. Clicking one calls `focusCharacter()`. The strip wraps to new rows
and grows downward without shifting the map.

**Group fan-out** — when several characters share a location, `groupOffsets(beat)` (~line 159)
nudges each onto a tiny ring (radius `r`) so the badges sit together but don't perfectly overlap.
A lone character gets no offset.

**The codex** — an **index of known characters** that expand into dossiers. Key pieces:

- `effectiveChar(charId, seq)` is the brain: it starts from the character's base record, then
  replays every codex entry revealed by `seq` to compute their *current* `name`, `alias`, `icon`,
  `body`, and the list of `facts`. An `entry_type:"identity"` entry (or an explicit `reveal_name`)
  renames them and turns the old name into the `alias`; an `entry_type:"faction"` entry updates the
  faction shown under the name; `icon`/`body` columns swap their art at that sequence. This same
  function feeds the map name tags, the map badge art, and the cast chips, so an identity reveal
  updates the name (and icon) everywhere at once. (`identity` and `faction` text is shown in the
  header, not repeated as a fact.) The dossier's facts are **grouped
  by `entry_type`** and accumulate — every revealed Bio line stacks under one Bio section, nothing
  is overwritten. **Bio** lines are stamped with the in-world date they happened — the `approx_date`
  of the beat at that entry's `sequence` (via `dateAtSequence`); other sections show no date.
- `isKnown(charId, seq)` decides who appears in the index (met on the timeline, or surfaced by a
  revealed codex entry).
- `renderCodex()` builds the list; clicking a row sets `expandedCodexId` and re-renders, expanding
  that one into a dossier (full-body portrait — a placeholder until a `body` image exists — plus the
  alias line and the facts). It is spoiler-gated by `seq` and shows **no** "revealed @ sequence"
  text. The Map/Codex tabs are switched by `showTab()`.
- The list is sorted by `lastUpdateSeq` (most-recently-revealed character first, stable otherwise),
  so whoever just got new info **floats to the top**; a reveal landing on the exact current beat gets
  an "updated" tag. A name search box (`#codexSearch`) filters by effective name / alias / `char_id`;
  it lives outside `#codexGrid`, so typing doesn't lose focus when the list re-renders.

---

## 11. styles.css tour

The file is ordered top-to-bottom roughly like the page. Key landmarks:

- `:root { --… }` — the **color palette and fonts** as CSS variables. Change a brand color here
  once and it updates everywhere (e.g. `--gold`, `--ink`, `--panel`, `--muted`).
- `.topbar`, `.date`, `.beat-title` — the header. `.beat-title` has a fixed two-line height so the
  layout doesn't jump when the title length changes.
- `.mapframe` — the map viewport: `aspect-ratio: 16/9`, `overflow: hidden`, `cursor: grab`. The
  image lives in `.mapcontent` (the element that gets the zoom transform).
- `#routes`, `#markers`, `#pips` — the overlay layers stacked on the image.
- `.marker`, `.badge`, `.nametag`, `.loc-pip` — the map icons. Note the `scale(var(--icon-scale))`
  in their transforms (§9).
- `.caststrip`, `.cast-chip`, `.is-following` — the cast strip under the map.
- `.codex-*` — the codex cards.

Character colors are **not** in CSS — they're the `STYLE` object at the top of `app.js` (~line 12),
because the badge color is also drawn into the marker HTML. To recolor a character, edit `STYLE`.

---

## 12. The tools/ folder

These are **standalone dev pages** — not part of the site. Open them directly in a browser.

- **`map-coordinate-finder.html`** — load the map, click any point, read its `x / y %`. This is how
  you get coordinates for new locations (the `map_x`/`map_y` columns) and for hand-drawn routes.

- **`road-network-editor.html`** — a visual editor for `routes.js`. It auto-loads the real map,
  the locations from `data.js`, and the current roads from `routes.js`, lets you draw/drag/delete
  roads and junctions, and regenerates the `routes.js` text for you to copy back. It opens framed
  on the road area (the locations sit in a small corner of the full map). Teal dots are locations
  (fixed), orange squares are junctions (movable), white diamonds are road bend points.

Both are self-contained single HTML files (HTML + CSS + vanilla JS in one file), so they're a good,
small place to read code if `app.js` feels big.

---

## 13. Cookbook

Common edits and where to make them.

**Add a location.**
Add a row to the `locations` sheet in the Excel with a unique `loc_id`, `name`, and — crucially —
`map_x`/`map_y` (get them from the coordinate-finder). Run `python build_data.py`. Without
coordinates it won't draw or be connectable.

**Make a location's name always show.**
Put `TRUE` (or `1`/`yes`/`x`) in the `show_name` column for that location, regenerate. (Code: the
`show-name` class in `renderPips`, styled in `styles.css`.)

**Recolor a character.**
Edit the `STYLE` object at the top of [app.js](app.js) (~line 12). Each entry is
`{ color, initials }`.

**Give a character an image instead of initials.**
Put the image in that character's folder, `assets/characters/<char_id>/`, and set the `icon` column
of the `characters` sheet to just the **file name** (e.g. `icon.png`), regenerate. The map badge,
the cast strip, and the codex avatar all use it. (`charAsset()` prepends the folder; a value with a
slash is treated as a full path/URL.)

**Add a character's full-body codex portrait.**
Put the image in `assets/characters/<char_id>/`, set the `body` column to its file name
(e.g. `full_body.png`). Until then a placeholder shows in the dossier.

**Make an identity reveal (rename a character mid-story).**
Add a `codex` row with `entry_type: identity` and `text` = the new name, gated at the reveal's
`sequence`. From there the map, cast, and codex switch to the new name and the dossier shows
"formerly known as <old name>". (Code: `effectiveChar` in app.js.)

**Change a character's icon or portrait partway through the story.**
Put the new image in that character's `assets/characters/<char_id>/` folder, then add a `codex` row
at the right `sequence` with the `icon` and/or `body` column set to the new file name. `effectiveChar` applies the latest one
revealed, and the map badge swaps to match (`render`'s marker loop only rebuilds the badge when the
effective icon actually changes).

**Add or reshape a road.**
Use `tools/road-network-editor.html`, then paste the output over `routes.js`. Or hand-edit the
`edges` array in `routes.js` (see its top comment).

**Force one journey to follow an exact line.**
Add an entry to `window.ROUTES` in `routes.js` keyed `"fromLocId>toLocId"` with `[x,y]` points.
It overrides the graph search for that specific trip.

**Make the party (or one character) travel by train or by air.**
Set the `travel_mode` column on the **beat** for the whole party (`air` = straight line, `rail` =
rail network, blank/`foot` = roads). To make just one character differ, set `travel_mode` on their
`appearance` row instead — it overrides the beat. (`rail` follows `RAIL_NETWORK` in routes.js — draw
train lines there like roads; empty = straight line for now.)

**Change animation speed.**
`ANIM_MS` at the top of app.js (~line 21). It controls both the marker glide and the camera glide,
and the auto-play interval is `ANIM_MS + 700`.

**Change how far apart grouped characters fan out.**
The `r = 0.5` in `groupOffsets()` (~line 167). Bigger = more spread.

**Change the default zoom / how tightly it frames.**
`MIN_VW` (tightest allowed zoom) and `VIEW_PAD` (padding around framed points) at the top.
`theaterBox` uses these for the default view. For the click-to-follow zoom, see `charBox()`
(the `theaterBox.w * 0.25` factor).

**Change the map image.**
Replace `assets/zemuria.png` (keep the name, or update the `<img src>` in index.html and `IMG_SRC`
in the tools). All coordinates are percentages, so they still line up if the new map has the same
framing; otherwise you'll re-pick coordinates.

**Add a new data column.**
Add the column in Excel, then one line in the matching `spec` in `build_data.py` (with the right
caster: `clean`, `to_int`, `to_float`, or `to_bool`). Then use `l.your_field` (etc.) in app.js.

---

## 14. Gotchas

- **Never hand-edit `data.js`.** It's overwritten every time you run `build_data.py`. Edit the
  Excel instead. (`routes.js` *is* hand-/tool-edited and is safe.)
- **A location needs `map_x`/`map_y` to exist on the map.** Without them it's skipped by both the
  pip renderer and the road graph — invisible and un-connectable.
- **`map_x` is % of width, `map_y` is % of height** (independent axes). The in-app camera math
  divides both by `vp.w`, so on a non-square map a road can look very slightly different in the app
  than in the editor — positions are right, only fine proportions differ.
- **Files must stay siblings.** The site loads `data.js`/`routes.js`/`assets/zemuria.png` by relative
  path; the tools reach up with `../`.
- **A straight-line route means a missing road.** `routeBetween` falls back to a straight line when
  the graph has no path between two locations.
- **Edges are two-way.** You define a road once; the app walks it in either direction.
- **Codex entries need a `sequence`** to appear (that's the spoiler gate).

---

## 15. Glossary

- **Beat** — one step of the story timeline (has a `sequence`, chapter, title, date).
- **Sequence** — the integer ordering of beats; everything "is this revealed/active yet?" compares
  against the current beat's sequence.
- **Appearance** — a row saying a character is at a location from `join_sequence` to
  `leave_sequence`.
- **Pip** — a small dot marking a location.
- **Marker** — a character's badge on the map.
- **vp (viewport)** — the camera rectangle over the map, in map %: `{x, y, w}`.
- **Map %** — coordinates as a percentage of the map image (the storage format).
- **Frame %** — coordinates as a percentage of the visible map frame (what `mapToFrame` outputs).
- **Node / edge** — a point / a road segment in the road graph.
- **Junction** — a graph node that isn't a real location (a fork or bend shared by roads).
- **via** — extra bend points that make a road segment curve along the real road.
- **Mode** — how the camera frames the map (theater / follow / whole / free / char).

---

*If you change the code in a way that makes part of this guide wrong, update this file too — it's
meant to stay true to the code.*
