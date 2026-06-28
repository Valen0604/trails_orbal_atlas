# Data Dictionary

The timeline data lives in **`TrailsTimeline.xlsx`** (one sheet per table below) and is
compiled into `data.js` by `build_data.py`. Edit the spreadsheet, never `data.js` directly.

## Conventions

- **IDs are stable text slugs, not numbers** — `estelle`, `bose_city`, `fc_ch1`. They're
  readable when typing by hand, they don't break if you reorder rows, and a typo is obvious.
- **Never reuse or repurpose an ID** once other rows point at it.
- **Coordinates are percentages** with a top-left origin (`map_x` = % from the left edge,
  `map_y` = % from the top). Pick one unit and stay consistent — the app and the
  coordinate finder both assume percentages.

---

## `characters`

One row per character. Stable facts only.

| Column | Meaning |
|---|---|
| `char_id` | Unique slug, permanent. The thing everything else references. |
| `display_name` | Name shown on the marker (the publicly-safe one). |
| `faction` | Affiliation safe to show from the start (e.g. Bracer Guild). Reveals go in `codex`. |
| `first_met_location` | `loc_id` where the party first meets them. |
| `first_appearance_beat` | `beat_id` of that first meeting. |
| `icon` | Marker + codex avatar. Just the **file name** (e.g. `icon.png`); blank = generated initials badge. |
| `body` | Full-body codex portrait. Just the **file name** (e.g. `full_body.png`); blank = placeholder. |

> **Deliberately omitted:** `status` and `true_identity`. Both are spoilers and both change —
> they belong in `codex` with reveal gating, not as flat columns here.
>
> Each character has its own folder, **`assets/characters/<char_id>/`**. In `icon` / `body` you
> write only the file name and the app prepends that folder automatically. (A value containing a
> slash — a full path or URL — is used as-is instead.)

---

## `locations`

Every place a marker can sit.

| Column | Meaning |
|---|---|
| `loc_id` | Unique slug, permanent. |
| `name` | Display name. |
| `parent_loc_id` | The containing place (`bose_city` → `bose` → `liberl`); blank for top level. |
| `type` | `nation` / `region` / `city` / `district`. Controls zoom level and placement. |
| `map_x` | X coordinate on the map image, as a percentage from the left. |
| `map_y` | Y coordinate on the map image, as a percentage from the top. |

> Container places (`nation`, `region`) can leave `map_x` / `map_y` blank — only the leaf
> places characters actually stand at need coordinates.

---

## `beats`

The spine — the canonical timeline.

| Column | Meaning |
|---|---|
| `beat_id` | Unique slug. |
| `sequence` | Integer, strictly increasing. **This is the real timeline** — sort and gate by it, never by date. |
| `chapter` | Chapter label, for grouping/display. |
| `title` | Short human label ("Arrive in Bose"). |
| `default_location` | `loc_id` where the party mostly is this beat; appearances inherit it. |
| `approx_date` | Interpolated in-world date. **Display only** — revise freely, nothing depends on it. |
| `travel_mode` | Party-wide default for *how everyone moved into this beat*: blank/`foot` = roads, `rail` = rail network, `air` = straight line. A character's appearance can override it. |

> `sequence` values don't have to be contiguous. Gaps (e.g. `38` → `50`) are fine; the app
> orders by sequence and steps through whatever beats exist.

---

## `appearances`

The heart. One row per character per continuous span with the party.

| Column | Meaning |
|---|---|
| `char_id` | Who. |
| `join_beat` | `beat_id` they become active. |
| `join_sequence` | The `sequence` of `join_beat` (lets the app gate without a lookup). |
| `location` | `loc_id`; blank = inherit the beat's `default_location`, filled = override. |
| `leave_beat` | `beat_id` they leave. Blank = stays through the end. |
| `leave_sequence` | The `sequence` of `leave_beat`; blank = open-ended. |
| `activity` | What they're doing — short phrase, shown in the cast panel. |
| `travel_mode` | *(optional override)* This character's mode for this move, when it differs from the beat's. Same values: `foot` / `rail` / `air`. |

> One character can have several rows (leaves, rejoins, splits off). That's the point of
> intervals — don't force one row per character. When intervals overlap, the **later row wins**.
>
> **Travel mode resolves like location does:** the beat's `travel_mode` is the party-wide default,
> and an appearance's `travel_mode` overrides it for that one character. So set it on the **beat**
> for "the whole party takes the train," and only fill the appearance column when someone splits off
> (e.g. one member flies while the rest walk). `foot`/blank routes along `ROAD_NETWORK` (with
> `ROUTES` overrides), `rail` along `RAIL_NETWORK` (a straight line until you draw rail lines), and
> `air` is always a straight line.

---

## `codex`

The progressive "what is known" entries — and the spoiler gate.

The Codex tab is an **index of known characters**. Each known character is one row you can click
to open a dossier; the dossier is built from that character's revealed codex entries. Entries are
**grouped by `entry_type`** into sections (Bio, Status, …) and **accumulate** — every revealed line
of a type stacks under that section, nothing is overwritten. It never shows a "revealed @ sequence"
line.

| Column | Meaning |
|---|---|
| `char_id` | Who it's about. |
| `revealed_at_beat` | `beat_id` at/after which this entry may show. |
| `sequence` | The `sequence` of `revealed_at_beat` — the single gating value the app checks. |
| `entry_type` | `identity` / `status` / `faction` / `bio` / `relationship`. Labels the fact; `identity` and `faction` are special (see below). |
| `text` | The entry itself. |
| `reveal_name` | *(optional)* From this entry's sequence on, the character's **name changes** to this; the old name becomes their alias. |
| `icon` | *(optional)* From this sequence on, swap the icon (map badge **and** codex avatar). Just the file name, resolved in the character's folder. |
| `body` | *(optional)* From this sequence on, swap the full-body codex portrait. Just the file name, resolved in the character's folder. |

**Identity reveals.** An `entry_type: identity` row renames the character — its `text` is the new
name (e.g. `Josette Haar` → reveal row with text `Josette Capua`). From that sequence on, the map,
cast, and codex all show the new name, and the dossier adds a "formerly known as …" alias line.
(Setting `reveal_name` explicitly does the same thing for any entry type, and then the row's `text`
also shows as a normal fact.)

**Faction reveals.** An `entry_type: faction` row updates the **current faction shown under the name**
to its `text` (e.g. Josette's `Jenis Royal Academy` cover → `Capua Sky Bandits`). Like identity, the
text is shown in that header line, not repeated as a fact section. The latest revealed faction wins.

To instead record an **old faction they used to belong to** — without changing their current one —
use a different `entry_type`, e.g. `former_faction` (or `past_faction`). Only `faction` touches the
header; every other type just shows as its own note section in the dossier (underscores in the type
become spaces, so `former_faction` reads as "Former faction"). Add a `faction` row *and* a
`former_faction` row if a character changes allegiance and you want to keep the old one on record.

**Dated Bio.** `entry_type: bio` lines show the in-world date they happened (the `approx_date` of the
beat at their `sequence`), so a character's Bio reads as a timeline. Other types show no date.

> **The one spoiler rule:** anything spoilery — true names, deaths, betrayals, faction flips —
> is a `codex` row with a `revealed_at_beat`, never a flat column elsewhere. Entries (and name /
> icon / portrait changes) stay hidden until the timeline reaches their `sequence`, so scrubbing
> back re-hides them.
