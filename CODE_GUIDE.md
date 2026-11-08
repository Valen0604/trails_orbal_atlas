# Code Guide — how the site works (and how to change it)

This is the "study companion" to the code. The [README](README.md) tells you how to *use* the
project (write the story, draw routes, publish). This file explains how the **code** works
so you can edit the site yourself.

Everything here points at real functions in [app.js](app.js), [styles.css](styles.css),
[index.html](index.html), etc. Open them side by side. In VS Code you can press <kbd>Ctrl</kbd>
and click a function name, or use <kbd>Ctrl</kbd>+<kbd>P</kbd> then type `@` to jump to a function.

---

## Contents

1. [The big picture](#1-the-big-picture)
2. [The files, one by one](#2-the-files-one-by-one)
3. [Data flow: story files → screen](#3-data-flow-story-files--screen)
4. [The timeline model (beats, appearances, "where is everyone?")](#4-the-timeline-model)
5. [Coordinate systems — the one thing to really understand](#5-coordinate-systems)
6. [The render pipeline](#6-the-render-pipeline)
7. [Movement animation](#7-movement-animation)
8. [The travel network (roads, rail, air)](#8-the-travel-network-roads-rail-air)
9. [Camera: modes, framing, pan / zoom / pinch](#9-camera)
10. [Places, cards, the cast strip, the codex drawer](#10-places-cards-cast-drawer)
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
                        routes.js   (window.ROAD_NETWORK + RAIL_NETWORK + ROUTES — hand-made)
                        app.js      (all the logic; runs inside one big function)
```

The **map is the page**: `#mapframe` fills the viewport, and inside it one element, `#world`,
holds the map image *and* every overlay (route lines, place labels, character cards) positioned
in map percentages. The camera is a single CSS transform on `#world`. Everything else — the date,
the transport bar, the cast strip, the codex drawer — floats over the map as fixed HUD elements.

`app.js` reads the two global objects, builds the world, and re-draws the character positions
whenever the **current beat** changes. That's the whole architecture.

The only "build step" is on the data side: a Python script compiles the story files in
`story/` into `data.js`. That's separate from running the site.

---

## 2. The files, one by one

| File | What it is | Do you hand-edit it? |
|---|---|---|
| [index.html](index.html) | Page skeleton: the map frame + world, the two HUD bars, the drawer. | Yes, rarely (structure only). |
| [styles.css](styles.css) | All visual styling: HUD, labels, cards, drawer. | Yes — colors, sizes, layout. |
| [app.js](app.js) | All behavior: timeline, camera, animation, piles, drawer. | Yes — this is the brain. |
| [data.js](data.js) | `window.TRAILS` — characters, locations, beats, appearances, codex. | **No.** Generated from `story/`. |
| [routes.js](routes.js) | `window.ROAD_NETWORK` / `RAIL_NETWORK` (the graphs) + `window.ROUTES` (overrides). | Via the editor tool, or by hand. |
| [build_data.py](build_data.py) | Reads `story/*.yaml`, validates, writes `data.js`. | Yes, when you add a new field. |
| [story/](story/) | The source of truth: `characters.yaml`, `locations.yaml`, one file per chapter. | Yes — this is where the story lives. |
| assets/ | `zemuria_clean.png` (the map shown), `zemuria.png` (the original), and one folder per character under `characters/<char_id>/`. | Add images here. |
| tools/ | Helper pages and scripts (see §12). | They're dev tools, not the site. |
| archive/ | The original spreadsheet and the cleanup "marks" image. | No — reference only. |

**Important:** the site files reference each other by relative path, so they must stay siblings
in the same folder. The tools in `tools/` reach back up with `../` (e.g. `../assets/zemuria_clean.png`).

---

## 3. Data flow: story files → screen

```
story/characters.yaml ─┐
story/locations.yaml  ─┤   python build_data.py   (validates, derives sequences & intervals)
story/01_*.yaml …     ─┘
      │
      ▼
   data.js  ──►  window.TRAILS = { characters, locations, beats, appearances, codex }
      │
      ▼
   app.js reads window.TRAILS  ──►  draws the map for the current beat
```

The story files are written like a **script** (beats in order, events on the beat they happen
at) — see [DATA_DICTIONARY.md](DATA_DICTIONARY.md). The app wants a flatter shape: numbered
beats and `[join, leave]` intervals per character. `build_data.py` is the translator:

- `load_yaml()` with `StrictLoader` — plain YAML loading that **refuses duplicate keys**.
- `Problems` — collects errors (block the write) and warnings (don't), then prints them.
- `compile_story()` — walks every chapter file's `beats` in order with a running `seq` counter
  and a `party` dict (`char_id` → the appearance currently open for them). `join` opens an
  interval (or closes the previous one at `seq-1` and opens a new one, for an update), `leave`
  closes it at `seq`, `cameo` emits a one-beat interval. Codex entries are stamped with `seq`.
  Every name is checked against the known ids, with a `difflib` suggestion when it doesn't match.
- `build()` — prints the per-chapter summary (full itinerary with `-v`) and writes
  `window.TRAILS = …` only if there were no errors. `watch()` re-runs it on file changes.

---

## 4. The timeline model

The whole site is "what does the world look like at beat *N*?" Here's how that's answered.

**Beats** are the steps of the story. Each has a `sequence` number (derived by the build);
`app.js` sorts them and keeps the current position in `index`. `go(i, animate)` moves it (the
◀ ▶ buttons, the scrubber, arrow keys, and Play all call it).

**Appearances** say where each character is, and for how long: `join_sequence` to
`leave_sequence`, both inclusive. `appearanceAt(charId, beat)` scans that character's
appearances for the one whose range contains the beat (latest match wins), and
`charLocAt` / `activityAt` / `travelModeAt` read the location (override, else the beat's
`default_location`), the activity text, and the travel mode off it. Nothing is stored per-beat;
scrubbing is instant because it's all derived on demand.

**Codex state.** `effectiveChar(charId, seq)` starts from the base record and replays every
codex entry revealed by `seq` to compute the *current* name, alias, faction, icon, portrait
and facts. `isKnown(charId, seq)` decides who appears in the codex index. `nationOf(charId)`
walks the parent chain of the place they were first met up to a `nation` — that's the outer
grouping in the drawer.

> If a character looks wrong on the map, run `python build_data.py -v`: the itinerary shows
> `+join ~update -leave (cameo)` per beat, numbered like the app's counter.

---

## 5. Coordinate systems

**This is the most important section.** Three spaces exist, and the camera is the conversion.

### a) Map % — how data is stored
Every location's `map_x`/`map_y` (from `xy:` in `locations.yaml`), every road point, every
junction is a **percentage of the map image**: `x` across the width, `y` down the height,
top-left origin. Resolution-independent, so swapping in a 2× upscaled image changes nothing.

### b) World px — the element the image lives in
`measure()` sizes `#world` to the frame's width and the image's aspect ratio:

```js
el.world.style.width  = Fw + "px";             // app.js, measure()
el.world.style.height = (Fw * aspect) + "px";  // aspect = naturalHeight / naturalWidth
```

Because `#world` has the image's exact aspect, **`left: x%; top: y%` inside it is map %**. The
image, the route SVG (`viewBox 0 0 100 100`, `preserveAspectRatio="none"`), the place labels
and the character markers are all children of `#world`, positioned this way — so they can
never drift from the image, on any screen shape.

### c) The viewport `vp` — the camera
```js
var vp = { x: 0, y: 0, w: 100 };   // top-left of the visible area in map %, and visible WIDTH in map %
```
Smaller `w` = more zoomed in (`MIN_VW` = tightest, `MAX_VW` = whole map). The visible *height*
depends on the frame's shape: `visH(w) = w × (Fh/Fw) / aspect`. That one line is what lets the
same camera work in a 16:9 window and a portrait tablet.

`applyTransform()` turns `vp` into the one transform:

```js
S  = 100 / vp.w;                                   // screen px per world px
tx = -vp.x / 100 * Fw * S;  ty = -vp.y / 100 * (Fw * aspect) * S;
el.world.style.transform = "translate(" + tx + "px, " + ty + "px) scale(" + S + ")";
el.world.style.setProperty("--s", S);
```

### d) Counter-scaling — why labels don't grow when you zoom
Overlays are *inside* the scaled world, so they'd scale with it. Each label / pip / card
therefore applies `scale(calc(1 / var(--s)))` to itself, cancelling the zoom and keeping a
constant screen size. Offsets written *after* that scale (e.g. `translate(8px, -50%)` on a
label, or a card's `--dx/--dy`) are effectively in **screen pixels** — handy for fanning piles.
Route lines use `vector-effect="non-scaling-stroke"` for the same reason.

`frameToMap(sx, sy)` converts a screen point back to map % (used by wheel zoom and pinch).

> If you only remember one thing: **`vp` is the camera; change `vp` and call `project()`.**

---

## 6. The render pipeline

`render(animate)` is called every time the beat changes. It:

1. Updates the HUD text (date, beat title, chapter tag, counter, scrubber).
2. Computes **`currentTargets`** (where each character should be) and **`pilesByLoc`** (who shares
   a place), and refreshes each marker's name / art via `effectiveChar`.
3. Lays the piles out (`layoutPiles()`), picks the end camera (`targetViewport()`), then either
   snaps (`animate === false`: scrub/jump) or runs a `requestAnimationFrame` loop that eases the
   camera and slides the movers along their routes over `ANIM_MS`.
4. Refreshes the cast strip and, if open, the codex drawer.

`project()` is the per-frame paint: `applyTransform()` plus `left/top` for each marker from
`currentPos`. Places and routes are static in world coordinates, so they need no per-frame work.

---

## 7. Movement animation

When a character changes location between beats, they don't teleport — they walk the road.

- For each character that moved, `render()` asks `routeBetween()` (§8) for the polyline and
  draws it with `drawRouteLine()` (an SVG polyline in map %, stroked in the character's colour).
- The rAF loop advances `t` from 0→1, eased by `easeInOut(t)`; `alongPath(route, t)` returns the
  point that far along the polyline, so the card slides along the real road while the camera glides.
- Co-travellers share the same route and timing, so a pile moves as one; someone splitting off
  peels away as a single card.

**Route lifecycle:** the latest travelled path stays drawn until the next move starts
(`clearRoutes()` at the top of each render).

---

## 8. The travel network (roads, rail, air)

Defined in [routes.js](routes.js); consumed by the "TRAVEL GRAPHS" section of app.js.

Two graphs of the same shape — `ROAD_NETWORK` (roads) and `RAIL_NETWORK` (train lines) — each
with `nodes` (junctions; locations are added automatically) and `edges` (two-way segments,
optionally bending through `via` points).

- `buildGraphFor(net)` builds one graph: `nodeCoord` and an adjacency list with each edge's
  length (y distances are multiplied by `aspect` so lengths are true, not squashed).
- `shortestNodes(g, from, to)` is **Dijkstra's algorithm**; `graphRoute()` stitches the result into
  a polyline.
- `routeBetween(fromLoc, toLoc, travelMode)` picks by travel mode: `air` → straight line;
  `rail` → rail graph (straight while empty); `foot` → `ROUTES` override, else the road graph,
  else a straight line. A straight foot journey is your "did I forget a road?" signal.

Both networks are edited with **`tools/road-network-editor.html`** (§12) on its Roads / Rail
layers; it writes `routes.js` itself.

---

## 9. Camera

`mode` decides how the camera behaves after each beat:

| `mode` | Behavior |
|---|---|
| `theater` | Frame the **story box** — every location the story visits — at a stable zoom. The default; `⌂` / H returns here. |
| `free` | Hold whatever the user panned / zoomed to. Entered by any manual gesture. |
| `char` | Lock onto one character (`followId`) and re-centre on them every beat (`charBox`). Clicking a cast chip or "Follow on map" in a dossier enters it; a manual gesture or clicking the chip again leaves it. |

`fitBox(pts, pad)` computes the viewport snugly containing a set of points. Two details matter:
it respects the frame's shape through `visH`, and it frames into the **band between the two HUD
bars** (`HUD_TOP`, `HUD_BOTTOM`, `bandCentre()`), so the story doesn't sit under the date or the
transport controls. `computeStoryBox()` runs it once over the story's locations (and again on
resize) and sets `ZBASE`, the scale at which cards are full-size.

**Gestures** (all in the "NAVIGATION + INPUT" section): scroll-wheel zooms toward the cursor;
drag pans; two pointers pinch-zoom around their midpoint; a tap on empty map collapses any fanned
pile. All of them call `enterFreeMode()`, then `clampVP()` + `project()`.

---

## 10. Places, cards, cast, drawer

**Places** — `renderPlaces()` creates one `div.place.<type>` per location with coordinates: a pip
(cities and districts) plus the name, in the map's black-serif-with-white-halo style. Visibility
is **tiered by zoom**: `applyTransform()` sets `data-zoom` on `#world` (`far` > 40 % visible >
`mid` > 22 > `near` > 12 > `deep`), and CSS shows nation names when far, city names from mid,
district names from near (`show_name: true` = always). Nothing is re-rendered on zoom.

**Cards** — `makeMarker()` builds one `.marker > .card > .cardinner` per character: a square
portrait (or initials on the character's colour) with the colour as its bottom edge, a count
badge, and a hidden name. `layoutPiles()` positions every card within its pile via CSS variables
on `.cardinner`: a tight offset stack with slight rotation when collapsed, a row above the place
(names alternating above / below) when fanned, a grid when more than six share a place.
`fannedLoc` is the pile currently open: hover fans on desktop (`mouseover` / `mouseout` on
`#markers`), the first tap fans on touch, and a click on a card opens its dossier.

**The cast strip** — `renderCast(beat)` lists who is on the map as chips (portrait, name,
place; the activity text in the tooltip). Click to follow, click again to stop.

**The codex drawer** — `#drawer` slides in from the right (`openDrawer` / `closeDrawer`,
button C or Esc). Two views, both re-rendered on every beat while open:
- `renderIndex()` — known characters grouped **nation → faction**, as portrait tiles in order of
  first meeting. The nation heading only appears once more than one nation is represented. The
  search box filters by name / alias / faction; the *Updated* chip keeps only characters with a
  reveal on the current beat (an "updated" dot marks them anyway). Groups are stable; a character
  only moves when a faction reveal changes their faction.
- `renderDossier()` — portrait, name, faction, alias, where they are right now, a "Follow on map"
  button, and the facts grouped by `entry_type` (Bio lines dated via `dateAtSequence`). Scrubbing
  back before the character was met drops you back to the index.

---

## 11. styles.css tour

Ordered roughly like the page:

- `:root { --… }` — palette and fonts. `--sea` is the map's own sea colour so letterboxing is
  invisible; `--hud` is the translucent panel colour.
- `#mapframe`, `#world` — the viewport and the transformed world (§5).
- `.place`, `.pip`, `.name` + the `#world[data-zoom=…]` rules — labels and their tiers.
- `.marker`, `.card`, `.cardinner`, `.cardimg`, `.count`, `.cname` — the character cards. The
  `--dx/--dy/--rot/--k` variables are set by `layoutPiles()`; the transition on `.cardinner` is
  what animates the fan.
- `.hud-top`, `.hud-bottom`, `.timeline`, `.caststrip` — the overlays.
- `.drawer`, `.cx-*` (index), `.dossier-*` / `.codex-*` (dossier) — the codex.
- The `@media (max-width: 720px)` block — phone / portrait adjustments.

Character colours are the `color` field in `story/characters.yaml`, read by `styleFor()` and
passed into the HTML as the `--c` custom property.

---

## 12. The tools/ folder

- **`map-coordinate-finder.html`** — loads the clean map and the existing locations as reference
  dots (names appear once zoomed in); click any point to read its `x / y %`. This is how you get
  coordinates for new places and label anchors.
- **`road-network-editor.html`** — visual editor for `routes.js` with **Roads / Rail** layers,
  undo/redo, and direct saving through the File System Access API (pick the file once per session,
  then every change is written; the copy button is the fallback). Model: `nets = { foot, rail }`,
  each `{ nodes, edges }`, with `locs` shared; nation/region label anchors are skipped since roads
  never reach them.
- **`clean_map_labels.py`** — strips the baked-in names, title, legend and disclaimer off the
  original map: dark glyph-sized blobs with a white halo are text; each masked blob is refilled
  with the dominant colour around it. Writes `assets/zemuria_clean.png` and the magenta-tinted
  `archive/zemuria_clean_marks.png` for the hand touch-up.
- **`upscale_map.py`** — one-time 2× Lanczos upscale after the touch-up (keeps the native file
  in `archive/`).

---

## 13. Cookbook

Common edits and where to make them. Story edits always end with `python build_data.py`.

**Add a beat / someone joins / cameo / elsewhere.** In the chapter file — see the README and
DATA_DICTIONARY. Rebuild.

**Add a location.** Entry in `story/locations.yaml` with `name`, `type`, `parent` and `xy`
(from the coordinate finder). `type` is also its label tier.

**Add or move a country / region label.** Give the `nation` (or `region`) entry an `xy`.

**Make a name show at every zoom.** `show_name: true` on that location.

**Change the zoom tiers.** `FAR`, `NEAR`, `DEEP` at the top of app.js; the CSS rules under
`#world[data-zoom=…]` decide what each tier shows.

**Recolor a character / change initials.** `color:` / `initials:` in `characters.yaml`.

**Give a character an image / portrait.** Files in `assets/characters/<char_id>/`, names in
`characters.yaml` (`icon`, `body`). Square crops look best on the cards.

**Identity reveal / art change mid-story.** A codex entry on the right beat (`identity:`, or
`name:` / `icon:` / `body:` on any entry).

**Change how piles fan out.** `layoutPiles()`: the row spacing (54 px), card scale (`k`), the
six-card threshold for the grid.

**Change card size.** `.cardimg` width/height in styles.css; `--icon-scale` in `applyTransform()`
controls how much they grow / shrink with zoom.

**Change the default framing.** `VIEW_PAD` (padding around the story box), `HUD_TOP` /
`HUD_BOTTOM` (the band it frames into), `MIN_VW` (tightest zoom), `charBox()`'s `0.3` (follow zoom).

**Change animation speed.** `ANIM_MS`; auto-play interval is `ANIM_MS + 700`.

**Add or reshape a road / rail line.** `tools/road-network-editor.html` on the matching layer.

**Force one journey to follow an exact line.** `window.ROUTES` in `routes.js`, keyed `"from>to"`.

**Travel by train or by air.** `by: rail` / `by: air` on the beat, or on one character's entry.

**Swap the map image.** Replace `assets/zemuria_clean.png`. Coordinates are percentages, so the
same framing keeps everything aligned; the site reads the image size at load.

**Add a new data field.** Allowed-keys set + `compile_story()` in `build_data.py`, then use it
in app.js.

---

## 14. Gotchas

- **Never hand-edit `data.js`.** Edit `story/` and rebuild. Rebuild before you commit, too:
  `data.js` is what GitHub Pages serves.
- **Overlays live inside `#world` and counter-scale.** A new overlay that forgets
  `scale(calc(1 / var(--s)))` will grow with the zoom.
- **`vp.w` is in % of width; the visible height comes from `visH()`.** Don't assume the frame
  is 16:9 anywhere — the tablet in portrait isn't.
- **`at:` is sticky and the first beat of a chapter must set it.** `leave` is inclusive.
- **A location needs `xy` to exist on the map.** Without it it's neither drawn nor routable.
- **A straight-line route means a missing road.**
- **The drawer's search box swallows keys.** Shortcuts (arrows, space, C, H) are ignored while
  typing in it, on purpose.
- **Quote text that contains `: ` or starts with `#`** in the YAML (colours always need quotes).

---

## 15. Glossary

- **Beat** — one step of the story timeline (has a `sequence`, chapter, title, date).
- **Sequence** — the integer ordering of beats, derived by the build.
- **Party** — the set of characters currently travelling together; `join` / `leave` manage it.
- **Cameo** — a one-beat appearance.
- **Appearance** — a compiled `[join_sequence, leave_sequence]` interval.
- **Pile** — the stack of cards for characters sharing a place; **fanned** = opened out.
- **Place** — a location's pip + label element.
- **Tier** — which labels show at the current zoom (`far` / `mid` / `near` / `deep`).
- **World** — the `#world` element: the image plus every overlay, in map %.
- **vp (viewport)** — the camera: `{x, y, w}` in map %.
- **S** — the world's scale (screen px per world px), exposed to CSS as `--s`.
- **Node / edge / junction / via** — the road-graph vocabulary (see `routes.js`).
- **Mode** — how the camera behaves (theater / free / char).

---

*If you change the code in a way that makes part of this guide wrong, update this file too — it's
meant to stay true to the code.*
