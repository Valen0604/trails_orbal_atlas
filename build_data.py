#!/usr/bin/env python3
"""
Convert TrailsTimeline.xlsx into data.js for the Trails Timeline web app.

Usage:
    python build_data.py                       # reads TrailsTimeline.xlsx -> data.js
    python build_data.py path/to/Timeline.xlsx
    python build_data.py Timeline.xlsx out/data.js

Requires: pandas, openpyxl   ->   pip install pandas openpyxl

Reads five sheets (characters, locations, beats, appearances, codex) following
Data_Dictionary_Trails.txt, normalizes blanks to null and numbers to numbers,
sorts beats by sequence, and writes `window.TRAILS = {...}`.
"""
import sys
import json

try:
    import pandas as pd
except ImportError:
    sys.exit("pandas is required:  pip install pandas openpyxl")


def clean(v):
    """Trim a cell; empty / NaN -> None."""
    if v is None:
        return None
    s = str(v).strip()
    return None if s == "" or s.lower() == "nan" else s


def to_int(v):
    v = clean(v)
    return int(float(v)) if v is not None else None


def to_float(v):
    v = clean(v)
    return float(v) if v is not None else None


def to_bool(v):
    """Truthy spreadsheet cell -> True; blank / false-ish / missing column -> False."""
    v = clean(v)
    return v is not None and v.lower() in ("1", "true", "yes", "y", "t", "x", "show")


def rows(df, spec):
    """Build a list of dicts from a dataframe. spec: {out_key: (col, caster)}."""
    out = []
    for _, r in df.iterrows():
        item = {}
        for key, (col, cast) in spec.items():
            item[key] = cast(r.get(col))
        out.append(item)
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "TrailsTimeline.xlsx"
    dst = sys.argv[2] if len(sys.argv) > 2 else "data.js"

    try:
        xl = pd.read_excel(src, sheet_name=None, dtype=str)
    except FileNotFoundError:
        sys.exit("Could not find spreadsheet: %s" % src)

    required = ["characters", "locations", "beats", "appearances", "codex"]
    missing = [s for s in required if s not in xl]
    if missing:
        sys.exit("Spreadsheet is missing sheet(s): %s\nFound: %s"
                 % (", ".join(missing), ", ".join(xl.keys())))

    data = {
        "characters": rows(xl["characters"], {
            "char_id": ("char_id", clean),
            "display_name": ("display_name", clean),
            "faction": ("faction", clean),
            "first_met_location": ("first_met_location", clean),
            "first_appearance_beat": ("first_appearance_beat", clean),
            "icon": ("icon", clean),
            "body": ("body", clean),          # base full-body portrait image (optional)
        }),
        "locations": rows(xl["locations"], {
            "loc_id": ("loc_id", clean),
            "name": ("name", clean),
            "parent_loc_id": ("parent_loc_id", clean),
            "type": ("type", clean),
            "map_x": ("map_x", to_float),
            "map_y": ("map_y", to_float),
            "show_name": ("show_name", to_bool),
        }),
        "beats": sorted(rows(xl["beats"], {
            "beat_id": ("beat_id", clean),
            "sequence": ("sequence", to_int),
            "chapter": ("chapter", clean),
            "title": ("title", clean),
            "default_location": ("default_location", clean),
            "approx_date": ("approx_date", clean),
        }), key=lambda b: (b["sequence"] is None, b["sequence"])),
        "appearances": rows(xl["appearances"], {
            "char_id": ("char_id", clean),
            "join_beat": ("join_beat", clean),
            "join_sequence": ("join_sequence", to_int),
            "location": ("location", clean),
            "leave_beat": ("leave_beat", clean),
            "leave_sequence": ("leave_sequence", to_int),
            "activity": ("activity", clean),
        }),
        "codex": rows(xl["codex"], {
            "char_id": ("char_id", clean),
            "revealed_at_beat": ("revealed_at_beat", clean),
            "sequence": ("sequence", to_int),
            "entry_type": ("entry_type", clean),
            "text": ("text", clean),
            "reveal_name": ("reveal_name", clean),  # if set, becomes the character's name from here on
            "icon": ("icon", clean),                # if set, swaps the icon from this sequence on
            "body": ("body", clean),                # if set, swaps the full-body portrait from here on
        }),
    }

    # --- light sanity warnings (don't block, just flag) ---------------------
    warn = []
    loc_ids = {l["loc_id"] for l in data["locations"]}
    coord_ids = {l["loc_id"] for l in data["locations"] if l["map_x"] is not None}
    for b in data["beats"]:
        dl = b["default_location"]
        if dl and dl not in loc_ids:
            warn.append("beat %s default_location '%s' is not in locations" % (b["beat_id"], dl))
        elif dl and dl not in coord_ids:
            warn.append("beat %s default_location '%s' has no map_x/map_y" % (b["beat_id"], dl))
    for a in data["appearances"]:
        if a["join_sequence"] is None:
            warn.append("appearance for '%s' has no join_sequence" % a["char_id"])
        if a["leave_sequence"] is not None and a["join_sequence"] is not None \
           and a["leave_sequence"] < a["join_sequence"]:
            warn.append("appearance for '%s' leaves (%s) before it joins (%s)"
                        % (a["char_id"], a["leave_sequence"], a["join_sequence"]))

    header = ("// Auto-generated from %s by build_data.py — do not edit by hand.\n"
              "// Shape matches Data_Dictionary_Trails.txt. Coordinates are percentages "
              "(top-left origin).\n" % src)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(header)
        f.write("window.TRAILS = " + json.dumps(data, indent=2, ensure_ascii=False) + ";\n")

    print("Wrote %s" % dst)
    print("  characters %d | locations %d | beats %d | appearances %d | codex %d"
          % (len(data["characters"]), len(data["locations"]), len(data["beats"]),
             len(data["appearances"]), len(data["codex"])))
    if data["beats"]:
        print("  beat sequence range: %s -> %s"
              % (data["beats"][0]["sequence"], data["beats"][-1]["sequence"]))
    if warn:
        print("\nWarnings (%d):" % len(warn))
        for w in warn:
            print("  - " + w)


if __name__ == "__main__":
    main()
