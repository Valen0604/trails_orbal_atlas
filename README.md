# Trails Timeline

An interactive map of Zemuria that plays back the *Trails / Kiseki* story beat by beat:
character markers travel between locations along the timeline, routes trace their path
across the map, and a spoiler-gated codex reveals facts only once the story reaches them.

> **Live site:** [valen0604.github.io/trails_orbal_atlas](https://valen0604.github.io/trails_orbal_atlas/)


## What it does

- **Timeline scrubber** with a big in-world date, chapter/beat title, and ◀ ▶ / play controls (arrow keys and space also work).
- **Animated markers** — characters move from beat to beat, fanning out when several share a location.
- **Traced routes** — journeys follow hand-drawn paths along the map's roads instead of straight lines.
- **Codex tab** — character reveals appear only once the timeline reaches the beat that unlocks them, so scrubbing back re-hides later spoilers.

## Project structure

```
trails_orbal_atlas/
├── index.html              # page skeleton — open this to run the site
├── styles.css              # all styling
├── app.js                  # timeline, movement animation, codex gating
├── data.js                 # GENERATED from story/ — do not hand-edit
├── routes.js               # hand-drawn travel paths (you maintain this)
├── build_data.py           # compiles story/ into data.js (and validates it)
├── requirements.txt        # the one Python library the build needs (pyyaml)
├── story/                  # THE SOURCE OF TRUTH — plain-text story files
│   ├── characters.yaml     #   who exists
│   ├── locations.yaml      #   where things are (map coordinates)
│   ├── 01_fc_prologue.yaml #   one file per chapter, beats in order
│   ├── 02_fc_chapter1.yaml
│   └── 03_fc_chapter2.yaml
├── DATA_DICTIONARY.md      # the story format, field by field
├── CODE_GUIDE.md           # how the code works, for editing it yourself
├── assets/                 # all images live here
│   ├── zemuria.png         # the map image
│   └── characters/         # one folder per character (its icon + full-body image)
├── tools/
│   ├── map-coordinate-finder.html   # click the map to read x/y % for coordinates & routes
│   └── road-network-editor.html     # visual editor for routes.js (draw/drag roads & junctions)
└── archive/
    └── TrailsTimeline.xlsx # the old spreadsheet, kept for reference; no longer used
```

New to the codebase? Read **[CODE_GUIDE.md](CODE_GUIDE.md)** — it walks through how every part
works (the timeline model, the camera/zoom math, the road graph, the render loop) and has a
"how do I…?" cookbook for common edits.

All the site files reference each other by relative path, so they must stay siblings in the
same folder. (`map-coordinate-finder.html` is standalone and can live in `tools/`.)

## Running it locally

Just open `index.html` in a browser — no server needed. The data loads as plain scripts
(`data.js`, `routes.js`), so it works straight from the file system.

## Editing the story

The story is written as plain-text **YAML script files** in `story/`, one per chapter. Each
chapter is a list of beats in order, and everything that happens on a beat — who joins, who
leaves, what the codex learns — is written on that beat. You never type sequence numbers or
intervals; the build derives them from the order of the list.

A chapter file looks like this:

```yaml
id: fc_pro
chapter: Prologue
date: March 1202

beats:

  - at: bright_house
    title: Get sent to Rolent to pick up a newspaper for Cassius
    join:
      - estelle: Party leader
      - joshua: Party leader
    cameo:
      - cassius: Sent the kids to buy a newspaper
    codex:
      cassius:
        - bio: Widowed since the Hundred Days War

  - at: rolent_city
    title: Going to Rolent
    join:
      - schera: Dealing with Bracer duties

  - title: Doing the Junior Bracer test          # no `at:` -> still in Rolent City

  - title: Interrupted by Aina on the way home
    leave: [schera]                              # last beat she's seen with the party
```

**The loop:**

1. Edit a file in `story/` (see [DATA_DICTIONARY.md](DATA_DICTIONARY.md) for every field).
2. Compile:
   ```bash
   python build_data.py
   ```
   First time only, install the one library it needs:
   ```bash
   pip install -r requirements.txt
   ```
3. Refresh the browser.

The build **validates everything** before writing: unknown character or location names (with a
"did you mean…?"), someone leaving who was never there, a misspelt key, a duplicate entry, a
missing image file. Errors stop the build and nothing is written; warnings are printed but
don't block.

Handy variants:

```bash
python build_data.py -v        # print the beat-by-beat itinerary (numbers match the app's counter)
python build_data.py --check   # validate only, write nothing
python build_data.py --watch   # rebuild automatically every time you save a story file
```

Leave `--watch` running in a terminal while you write: save the YAML, refresh the browser.

### Adding a beat

Append a list item to the current chapter file. `at:` is where the party is (omit it to stay
put), `title:` is what happens. Add `join:` / `cameo:` / `leave:` for who's around and
`codex:` for what's learned. Inserting a beat in the *middle* works the same way — everything
after it renumbers itself.

### Starting a new chapter

Create `story/04_fc_chapter3.yaml` (the numeric prefix sets the order) with `id:`,
`chapter:`, `date:` and a `beats:` list. The party carries over from the previous file, so
its first beat only needs `at:` and a title.

## Drawing routes

So a character follows the roads instead of cutting straight across the map:

1. Open `tools/map-coordinate-finder.html` (it loads the map and shows the existing locations as teal dots) and zoom in.
2. Click along the road from the start location to the end, copying the **x / y %** at each click.
3. Add an entry to `routes.js` keyed `"fromLocId>toLocId"`, with the points as `[x, y]` pairs.

The app looks up `from>to`, then the reverse of `to>from`, then falls back to a straight line —
so you only draw each pair once, and undrawn journeys still work (just as straight lines).

Most of the time you'll use **`tools/road-network-editor.html`** instead: it loads the real
map, locations, roads and rail lines, lets you draw/drag segments and junctions, and **saves
straight back to `routes.js`** — click *Save to routes.js…* once per session and pick the file,
then every change is written automatically (Chrome/Edge; other browsers get a copy button).
Switch between the **Roads** and **Rail** layers in its toolbar; Ctrl+Z undoes.

### Travel modes (foot / rail / air)

How a move is drawn is set with `by:` — on the **beat** for the whole party, or on one
character's `join` / `cameo` entry (long form) to override it for them alone:

- **blank / `foot`** — follow the roads (the network above).
- **`rail`** — follow the **`RAIL_NETWORK`** in `routes.js` (draw it on the editor's **Rail** layer;
  while it's empty, trains travel in a straight line).
- **`air`** — a straight line between the two stops.

```yaml
  - at: nebel
    by: air                      # the whole party flew in
    title: Found themselves in Nebel Valley after boarding the ship
```

## Adding character icons & portraits

Each character gets **its own folder** under `assets/characters/<char_id>/`, holding that
character's icon and full-body image:

```
assets/
├── zemuria.png                          # the map
└── characters/
    ├── estelle/
    │   ├── estelle1.png                 # marker / codex avatar
    │   └── estelleFullBody1.webp        # codex portrait
    ├── joshua/
    │   └── ...
    └── ...
```

Then in `story/characters.yaml` you only write the **file name** — the app fills in
`assets/characters/<char_id>/` automatically:

```yaml
estelle:
  name: Estelle Bright
  faction: Bracer Guild
  icon: estelle1.png            # replaces the initials badge on the map, cast strip and codex
  body: estelleFullBody1.webp   # the portrait shown when you open her in the codex
  color: "#e8623d"              # route line + initials badge color
```

The file names are up to you — just match them, including the `.png` / `.webp` extension. The
build warns if a referenced file doesn't exist. (For an image from somewhere else, write a value
that contains a slash — a full path or a URL — and it's used as-is.)

You can also make the icon or portrait **change partway through the story**: add `icon:` /
`body:` to a codex entry on the beat where it changes — see the codex section of
[DATA_DICTIONARY.md](DATA_DICTIONARY.md).

## Publishing with GitHub Pages

1. Push the repo to GitHub (it must be **public** on a free plan; private Pages needs a paid plan).
2. Repo **Settings → Pages → Build and deployment → Source → Deploy from a branch**.
3. Pick the **main** branch, **/ (root)** folder, **Save**.
4. Wait a minute, refresh, and the live URL appears at the top of the Pages settings.

The published site is public even if the repo is private, so don't commit anything secret.
After setup, every push auto-updates the live site. Remember to run `python build_data.py`
**before** committing so the pushed `data.js` matches the story files.

## Credits

Map: **"Map of Zemuria 2024 Edition" by NegativeNac** — a fanmade map. This project is not
affiliated with Nihon Falcom or any company involved in the *Trails / Kiseki* series, and is
for personal, non-commercial use.
