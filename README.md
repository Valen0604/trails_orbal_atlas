# Trails Timeline

An interactive map of Zemuria that plays back the *Trails / Kiseki* story beat by beat:
character markers travel between locations along the timeline, routes trace their path
across the map, and a spoiler-gated codex reveals facts only once the story reaches them.

> **Live site:** [valen0604.github.io/trails_orbal_atlas](https://valen0604.github.io/trails_orbal_atlas/)


## What it does

- **Timeline scrubber** with a big in-world date, chapter/beat title, and ◀ ▶ / play controls (arrow keys and space also work).
- **Animated markers** — characters move from beat to beat based on the spreadsheet, fanning out when several share a location.
- **Traced routes** — journeys follow hand-drawn paths along the map's roads instead of straight lines.
- **Codex tab** — character reveals appear only once the timeline reaches the beat that unlocks them, so scrubbing back re-hides later spoilers.

## Project structure

```
trails-timeline/
├── index.html              # page skeleton — open this to run the site
├── styles.css              # all styling
├── app.js                  # timeline, movement animation, codex gating
├── data.js                 # GENERATED from the Excel — do not hand-edit
├── routes.js               # hand-drawn travel paths (you maintain this)
├── build_data.py           # regenerates data.js from the spreadsheet
├── TrailsTimeline.xlsx     # source of truth for all timeline data
├── DATA_DICTIONARY.md      # what every column means
├── CODE_GUIDE.md           # how the code works, for editing it yourself
├── assets/                 # all images live here
│   ├── zemuria.png         # the map image
│   └── characters/         # one folder per character (its icon + full-body image)
└── tools/
    ├── map-coordinate-finder.html   # click the map to read x/y % for coordinates & routes
    └── road-network-editor.html     # visual editor for routes.js (draw/drag roads & junctions)
```

New to the codebase? Read **[CODE_GUIDE.md](CODE_GUIDE.md)** — it walks through how every part
works (the timeline model, the camera/zoom math, the road graph, the render loop) and has a
"how do I…?" cookbook for common edits.

All the site files reference each other by relative path, so they must stay siblings in the
same folder. (`map-coordinate-finder.html` is standalone and can live in `tools/`.)

## Running it locally

Just open `index.html` in a browser — no server needed. The data loads as plain scripts
(`data.js`, `routes.js`), so it works straight from the file system.

## Editing the timeline

The spreadsheet is the source of truth; `data.js` is compiled from it.

1. Edit **`TrailsTimeline.xlsx`** (see [`DATA_DICTIONARY.md`](DATA_DICTIONARY.md) for the columns).
2. Regenerate the data:
   ```bash
   python build_data.py
   ```
   First time only, install the two libraries it needs:
   ```bash
   pip install pandas openpyxl
   ```
3. Refresh the browser.

`build_data.py` also prints sanity warnings (a beat pointing at a missing location, an
appearance that leaves before it joins, etc.) — worth a glance after each run.

## Drawing routes

So a character follows the roads instead of cutting straight across the map:

1. Open `tools/map-coordinate-finder.html`, load `assets/zemuria.png`, and zoom in.
2. Click along the road from the start location to the end, copying the **x / y %** at each click.
3. Add an entry to `routes.js` keyed `"fromLocId>toLocId"`, with the points as `[x, y]` pairs.

The app looks up `from>to`, then the reverse of `to>from`, then falls back to a straight line —
so you only draw each pair once, and undrawn journeys still work (just as straight lines).

## Adding character icons & portraits

Each character gets **its own folder** under `assets/characters/<char_id>/`, holding that
character's icon and full-body image:

```
assets/
├── zemuria.png                          # the map
└── characters/
    ├── estelle/
    │   ├── icon.png                     # marker / codex avatar
    │   └── full_body.png                # codex portrait
    ├── joshua/
    │   └── ...
    └── ...
```

Then in the spreadsheet you only write the **file name** — the app fills in
`assets/characters/<char_id>/` automatically:

- `characters` sheet → `icon` column = just `icon.png` (or `icon.webp`). Replaces the generated
  initials badge on the map, the cast strip, **and** the codex.
- `characters` sheet → `body` column = just `full_body.png`. The portrait shown when you open the
  character in the codex (a placeholder shows until you add one).

The file names inside each folder are up to you — just match them in the spreadsheet, including the
`.png` / `.webp` extension. (If you ever want an image from somewhere else, write a value that
contains a slash — a full path like `assets/shared/x.png` or a URL — and it's used as-is.)

Regenerate `data.js` afterwards. You can also make the icon or portrait **change partway through
the story** — see the codex columns in [DATA_DICTIONARY.md](DATA_DICTIONARY.md) and the codex
section of [CODE_GUIDE.md](CODE_GUIDE.md).

## Publishing with GitHub Pages

1. Push the repo to GitHub (it must be **public** on a free plan; private Pages needs a paid plan).
2. Repo **Settings → Pages → Build and deployment → Source → Deploy from a branch**.
3. Pick the **main** branch, **/ (root)** folder, **Save**.
4. Wait a minute, refresh, and the live URL appears at the top of the Pages settings.

The published site is public even if the repo is private, so don't commit anything secret.
After setup, every push auto-updates the live site.

## Credits

Map: **"Map of Zemuria 2024 Edition" by NegativeNac** — a fanmade map. This project is not
affiliated with Nihon Falcom or any company involved in the *Trails / Kiseki* series, and is
for personal, non-commercial use.
