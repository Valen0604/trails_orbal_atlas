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
| `icon` | Image filename for the marker. Leave blank to use a generated initials badge. |

> **Deliberately omitted:** `status` and `true_identity`. Both are spoilers and both change —
> they belong in `codex` with reveal gating, not as flat columns here.

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

> One character can have several rows (leaves, rejoins, splits off). That's the point of
> intervals — don't force one row per character. When intervals overlap, the **later row wins**.

---

## `codex`

The progressive "what is known" entries — and the spoiler gate.

| Column | Meaning |
|---|---|
| `char_id` | Who it's about. |
| `revealed_at_beat` | `beat_id` at/after which this entry may show. |
| `sequence` | The `sequence` of `revealed_at_beat` — the single gating value the app checks. |
| `entry_type` | `identity` / `status` / `faction` / `bio` / `relationship`. Lets the UI style reveals differently. |
| `text` | The entry itself. |

> **The one spoiler rule:** anything spoilery — true names, deaths, betrayals, faction flips —
> is a `codex` row with a `revealed_at_beat`, never a flat column elsewhere. The Codex tab
> hides any entry whose `sequence` is past the viewer's current position on the timeline.
