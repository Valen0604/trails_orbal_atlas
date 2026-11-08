# Data Dictionary — the story format

All timeline data lives in **`story/`** as plain-text YAML and is compiled into `data.js` by
`build_data.py`. Edit the story files, never `data.js`.

```
story/
├── characters.yaml       who exists — stable, non-spoiler facts
├── locations.yaml        where things are — map coordinates
├── 01_fc_prologue.yaml   one file per chapter, beats in story order
├── 02_fc_chapter1.yaml
└── 03_fc_chapter2.yaml
```

## The idea

The story is linear, so the data is written like a **script**: each chapter file is a list of
beats in order, and everything that happens on a beat — who shows up, who leaves, what gets
revealed — is written *on that beat*. You never type sequence numbers, intervals or beat ids;
the build derives them from the order of the list. Insert a beat anywhere and everything
after it renumbers itself.

## Conventions

- **IDs are stable slugs** — `estelle`, `bose_city`, `fc_ch1`. Readable, obvious when typo'd,
  and the build tells you when one doesn't exist (with a "did you mean…?").
- **Never reuse or repurpose an ID** once other entries point at it.
- **Coordinates are percentages** of the map image, top-left origin: `xy: [31.3, 68.9]` means
  31.3 % from the left, 68.9 % from the top. Read them off `tools/map-coordinate-finder.html`.
- **YAML in 20 seconds:** two-space indentation, `key: value`, list items start with `- `.
  Plain text needs no quotes unless it contains `: ` (colon-space), starts with a special
  character (`-`, `#`, `[`, `{`, `*`, `&`, `!`, `|`, `>`, `'`, `"`, `%`, `@`), or ends with
  `:`. When in doubt, wrap it in double quotes. `#` starts a comment.
- **Duplicate keys are an error**, so a character or location defined twice is caught.

---

## `characters.yaml`

A mapping of `char_id` → record. Stable facts only.

| Field | Meaning |
|---|---|
| `name` | Display name at the *start* of the story (the publicly-safe one). |
| `faction` | Affiliation safe to show from the start (e.g. `Bracer Guild`). |
| `icon` | Marker + codex avatar. Just the **file name**; resolved in `assets/characters/<char_id>/`. Blank = initials badge. |
| `body` | Full-body codex portrait. Just the file name; blank = placeholder. |
| `color` | `"#rrggbb"` (quoted, because `#` starts a comment). Used for the route line and the initials badge. |
| `initials` | Badge text when there's no icon. Defaults to the first letters of the name. |

```yaml
josette:
  name: Josette Haar
  faction: Jenis Royal Academy
  icon: josetteCapua1.png
  body: josetteFullBody1.webp
  color: "#d98a2b"
  initials: Js
```

> **Deliberately omitted:** status, true identity, current faction. Those change and spoil —
> they are codex entries on the beat that reveals them (see below), never flat fields here.
> An image value containing a slash (a full path or URL) is used as written.

---

## `locations.yaml`

A mapping of `loc_id` → record. Every place a marker can stand.

| Field | Meaning |
|---|---|
| `name` | Display name. |
| `type` | `nation` / `region` / `city` / `district`. Containers (`nation`, `region`) need no `xy`. |
| `parent` | The containing place (`bose_city` → `bose` → `liberl`). Omit for the top level. |
| `xy` | `[x, y]` in map %. **Required for anything characters stand at** — without it the place is neither drawn nor routable, and the build warns. |
| `show_name` | `true` = the label is always visible on the map (default: on hover). |

```yaml
perzel:
  name: Perzel Farm
  type: district
  parent: rolent
  xy: [30.1, 69.2]
  show_name: true
```

---

## Chapter files — `NN_<name>.yaml`

Files are read **in file-name order**, so keep the numeric prefix (`01_`, `02_`, …). The
party carries over from one chapter to the next, so a new chapter starts with whoever was
still travelling at the end of the previous one.

### Top of the file

| Field | Meaning |
|---|---|
| `game` | *(optional)* e.g. `Trails in the Sky FC`. Stored with each beat for later grouping. |
| `id` | Chapter slug, e.g. `fc_ch1`. Beat ids are built from it (`fc_ch1_014`). |
| `chapter` | Display label shown under the timeline, e.g. `Chapter 1`. |
| `date` | In-world date for the first beats, e.g. `June 1202`. Display only. |
| `beats` | The list of beats. |

### A beat

Each list item is one step of the story. Only `title` is required (plus `at` on the first beat
of a chapter).

| Key | Meaning |
|---|---|
| `title` | What happens. Shown under the big date. |
| `at` | `loc_id` where the party is. **Sticky:** omit it and the party stays where it was. Required on a chapter's first beat. |
| `date` | In-world date from this beat on. **Sticky** until the next `date`. Display only; nothing depends on it. |
| `by` | How the party travelled *into* this beat: `foot` (default, follows roads), `rail` (follows the rail network), `air` (straight line). |
| `join` | Who starts travelling with the party on this beat (see presence entries). |
| `cameo` | Who is present on **this beat only** — NPCs who show up for one scene. |
| `leave` | Who is **last seen** with the party on this beat. `leave: [cassius]` means Cassius is still there on this beat and gone from the next. |
| `codex` | Facts revealed on this beat, per character (see codex entries). |

A beat that moves the party starts with `- at:`; a beat that doesn't starts with `- title:`,
so the shape of the file shows the journey:

```yaml
  - at: esmelas
    title: Attempting to rescue children from Esmelas Tower

  - title: Ambushed by monsters, Cassius comes to the rescue
    join:
      - cassius: On a work trip with the guild

  - at: bright_house
    title: Heading back home

  - title: Learned Cassius is leaving for work
    leave: [cassius]
```

### Presence entries (`join` / `cameo`)

Each list item names a character, optionally with what they're doing:

```yaml
join:
  - schera                                   # just the id
  - olivier: Leaves to sightsee Bose         # id + activity (shows in the cast chip tooltip)
```

When someone is **somewhere other than the party**, or **travels differently**, use the long
form:

```yaml
cameo:
  - who: josette
    doing: Raided Bose while the party sat in the Haken Gate cells
    at: bose_city          # location override, instead of the party's `at`
join:
  - who: schera
    doing: Flying back to Rolent with Olivier
    at: rolent_city
    by: air                # how this character moved, instead of the beat's `by`
```

`at` and `by` on a `join` entry stick for that whole span with the party; on a `cameo` they
apply to that one beat.

**How the party works:**

- `join` adds someone. They inherit the party's location every beat until they `leave`.
- `join`ing someone who is *already* with the party is an **update**: from this beat their
  activity (and any `at` / `by`) changes. That's how you re-describe a companion mid-journey
  without a leave/join pair.
- `cameo` is sugar for "join and leave on the same beat". Cameo-ing someone already in the
  party is redundant and warns.
- `leave` on someone not currently with the party is an **error** — it catches typos and
  forgotten joins.
- The party state is global: it carries across chapter files. Each migrated chapter file opens
  with a comment saying who carried over, as a reminder.

### Codex entries

```yaml
codex:
  cassius:
    - bio: Widowed since the 100 day war
    - bio: Father of Estelle, adoptive father of Joshua
  josette:
    - bio: Attempted to steal the Esmelas Crystal meant for the Queen
      name: Josette Capua          # from here on she is called this; the old name becomes her alias
      icon: josetteCapua2.png      # swap the map badge + avatar from here on
      body: josetteFullBody2.png   # swap the full-body portrait from here on
    - faction: Capua Sky Bandits
    - former_faction: Jenis Royal Academy (cover identity)
```

Each entry is `- <type>: <text>` plus optional `name`, `icon`, `body`. The type is free text
and becomes a section heading in the dossier (`former_faction` reads "Former faction"). Every
revealed line of a type stacks under that section; nothing is overwritten. Three types are
special:

| Type | Effect |
|---|---|
| `identity` | The text **is the new name**: the map, cast and codex switch to it and the dossier shows "formerly known as …". (`name:` on any other entry does the same, and that entry's text still shows as a fact.) |
| `faction` | The text replaces the **faction line under the name**. Not repeated as a fact. Latest wins. |
| `bio` | Shown with the in-world date of the beat it was revealed on, so the Bio reads as a timeline. |

A codex entry on a character the party hasn't met yet still makes them appear in the Codex
index (that's how Morgan is "known" before he is seen).

> **The one spoiler rule:** anything spoilery — true names, deaths, betrayals, faction flips —
> is a codex entry on the beat that reveals it, never a flat field in `characters.yaml`.
> Entries (and name / icon / portrait changes) stay hidden until the timeline reaches that
> beat, so scrubbing back re-hides them.

---

## What the build derives

So you know what `data.js` ends up holding (the app reads this shape; see CODE_GUIDE.md):

| Derived | From |
|---|---|
| `sequence` | Position of the beat across all chapter files, 1-based and contiguous. |
| `beat_id` | `<chapter id>_<nnn>`, e.g. `fc_pro_014`. Not shown anywhere; handy for debugging. |
| `default_location`, `approx_date` | The sticky `at` / `date`, filled in for every beat. |
| `appearances` | One `[join_sequence, leave_sequence]` interval per `join`…`leave` span, re-join (update) or cameo, with its `location` / `activity` / `travel_mode` overrides. |
| `codex[].sequence` | The sequence of the beat the entry sits on. |

## What the build checks

**Errors** stop the build and nothing is written:
unknown character / location / field name (with a suggestion), a beat without a title, a
chapter's first beat without `at`, `leave` for someone not in the party, a malformed presence or
codex entry, an invalid travel mode, duplicate keys, YAML syntax errors.

**Warnings** are printed but don't block:
a visited location with no `xy`, an `icon` / `body` file that doesn't exist on disk, a cameo for
someone already in the party, a chapter with no date, a color that isn't `#rrggbb`.

Run `python build_data.py -v` to see the beat-by-beat itinerary — number, location, title and
`+join ~update -leave (cameo)` events — the beat numbers match the counter in the app.
