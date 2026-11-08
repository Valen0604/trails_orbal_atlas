#!/usr/bin/env python3
"""
Compile the story files into data.js for the Trails Timeline web app.

    python build_data.py              # story/  ->  data.js
    python build_data.py -v           # ...and print the full beat-by-beat itinerary
    python build_data.py --check      # validate only, write nothing
    python build_data.py --watch      # rebuild automatically whenever a story file changes
    python build_data.py --story DIR --out FILE

Requires: pyyaml   ->   pip install -r requirements.txt

The story lives in story/ as plain-text YAML:

    story/characters.yaml     who exists (stable, non-spoiler facts)
    story/locations.yaml      where things are (map coordinates)
    story/NN_<chapter>.yaml   one file per chapter, beats in story order

Sequence numbers, appearance intervals and beat ids are all DERIVED here from the
order of the beats, so you never type them. See DATA_DICTIONARY.md for the format.

Errors (unknown names, malformed entries) stop the build and nothing is written.
Warnings (missing coordinates, missing image files) are printed but don't block.
"""
import argparse
import difflib
import glob
import json
import os
import re
import sys
import time

try:
    import yaml
except ImportError:
    sys.exit("pyyaml is required:  pip install -r requirements.txt")

# Windows consoles default to a legacy code page; titles may contain non-ASCII.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BEAT_KEYS = {"date", "at", "by", "title", "join", "cameo", "leave", "codex"}
PRESENCE_KEYS = {"who", "doing", "at", "by"}
CODEX_EXTRA_KEYS = {"name", "icon", "body"}
TRAVEL_MODES = {"foot", "rail", "air"}
LOCATION_TYPES = {"nation", "region", "city", "district"}
CONTAINER_TYPES = {"nation", "region"}
CHARACTER_KEYS = {"name", "faction", "icon", "body", "color", "initials"}
LOCATION_KEYS = {"name", "type", "parent", "xy", "show_name"}


# ----------------------------------------------------------------------------- yaml
class StrictLoader(yaml.SafeLoader):
    """SafeLoader that refuses duplicate keys instead of silently keeping the last one."""

    def construct_mapping(self, node, deep=False):
        seen = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in seen:
                raise yaml.constructor.ConstructorError(
                    None, None, "duplicate key %r" % (key,), key_node.start_mark)
            seen.add(key)
        return super().construct_mapping(node, deep)


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return yaml.load(f, Loader=StrictLoader)


# ----------------------------------------------------------------------------- problems
class Problems:
    def __init__(self):
        self.errors, self.warnings = [], []

    def error(self, where, msg):
        self.errors.append((where, msg))

    def warn(self, where, msg):
        self.warnings.append((where, msg))

    def report(self):
        for label, heading, items in (("ERROR", "Errors", self.errors), ("warning", "Warnings", self.warnings)):
            if not items:
                continue
            print("\n%s (%d):" % (heading, len(items)))
            for where, msg in items:
                print("  %-8s %s\n           %s" % (label, where, msg) if where else "  %-8s %s" % (label, msg))


def suggest(name, options):
    m = difflib.get_close_matches(str(name), [str(o) for o in options], n=1, cutoff=0.6)
    return " (did you mean '%s'?)" % m[0] if m else ""


def as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


# ----------------------------------------------------------------------------- compile
def compile_story(story_dir, assets_dir, P):
    """Returns (data, chapters_summary) — data is the dict that becomes window.TRAILS."""
    rel = lambda p: os.path.relpath(p, os.path.dirname(os.path.abspath(story_dir)) or ".")

    # ---- characters ------------------------------------------------------------
    char_path = os.path.join(story_dir, "characters.yaml")
    chars_src = load_yaml(char_path) if os.path.exists(char_path) else None
    if not isinstance(chars_src, dict):
        P.error(rel(char_path), "must be a mapping of char_id -> {name, faction, icon, body, color, initials}")
        chars_src = {}
    characters = []
    for cid, rec in chars_src.items():
        where = "%s  %s" % (rel(char_path), cid)
        if not isinstance(rec, dict):
            P.error(where, "entry must be a mapping (name:, faction:, ...)")
            continue
        for k in rec:
            if k not in CHARACTER_KEYS:
                P.error(where, "unknown field '%s'%s" % (k, suggest(k, CHARACTER_KEYS)))
        if not rec.get("name"):
            P.error(where, "needs a name")
        for art in ("icon", "body"):
            v = rec.get(art)
            if v and "/" not in str(v) and assets_dir:
                p = os.path.join(assets_dir, "characters", str(cid), str(v))
                if not os.path.exists(p):
                    P.warn(where, "%s file not found: %s" % (art, os.path.relpath(p)))
        color = rec.get("color")
        if color is not None and not re.fullmatch(r"#[0-9a-fA-F]{6}", str(color)):
            P.warn(where, "color should look like \"#rrggbb\" (got %r)" % (color,))
        characters.append({
            "char_id": str(cid),
            "display_name": str(rec.get("name") or cid),
            "faction": rec.get("faction"),
            "icon": rec.get("icon"),
            "body": rec.get("body"),
            "color": color,
            "initials": rec.get("initials"),
        })
    char_ids = {c["char_id"] for c in characters}

    # ---- locations -------------------------------------------------------------
    loc_path = os.path.join(story_dir, "locations.yaml")
    locs_src = load_yaml(loc_path) if os.path.exists(loc_path) else None
    if not isinstance(locs_src, dict):
        P.error(rel(loc_path), "must be a mapping of loc_id -> {name, type, parent, xy, show_name}")
        locs_src = {}
    locations = []
    for lid, rec in locs_src.items():
        where = "%s  %s" % (rel(loc_path), lid)
        if not isinstance(rec, dict):
            P.error(where, "entry must be a mapping (name:, type:, xy:, ...)")
            continue
        for k in rec:
            if k not in LOCATION_KEYS:
                P.error(where, "unknown field '%s'%s" % (k, suggest(k, LOCATION_KEYS)))
        ltype = rec.get("type")
        if ltype not in LOCATION_TYPES:
            P.warn(where, "type should be one of %s (got %r)" % (sorted(LOCATION_TYPES), ltype))
        xy = rec.get("xy")
        x = y = None
        if xy is not None:
            if (isinstance(xy, list) and len(xy) == 2
                    and all(isinstance(v, (int, float)) for v in xy)):
                x, y = float(xy[0]), float(xy[1])
                if not (0 <= x <= 100 and 0 <= y <= 100):
                    P.warn(where, "xy %s is outside 0-100%%" % (xy,))
            else:
                P.error(where, "xy must be [x, y] with two numbers (got %r)" % (xy,))
        elif ltype not in CONTAINER_TYPES:
            P.warn(where, "has no xy, so it cannot be drawn or routed to")
        locations.append({
            "loc_id": str(lid),
            "name": str(rec.get("name") or lid),
            "parent_loc_id": rec.get("parent"),
            "type": ltype,
            "map_x": x,
            "map_y": y,
            "show_name": bool(rec.get("show_name")),
        })
    loc_ids = {l["loc_id"] for l in locations}
    loc_with_xy = {l["loc_id"] for l in locations if l["map_x"] is not None}
    for l in locations:
        if l["parent_loc_id"] and l["parent_loc_id"] not in loc_ids:
            P.error("%s  %s" % (rel(loc_path), l["loc_id"]),
                    "parent '%s' is not a location%s" % (l["parent_loc_id"], suggest(l["parent_loc_id"], loc_ids)))

    # ---- chapters --------------------------------------------------------------
    chapter_files = sorted(
        p for p in glob.glob(os.path.join(story_dir, "*.yaml"))
        if os.path.basename(p) not in ("characters.yaml", "locations.yaml"))
    if not chapter_files:
        P.error(rel(story_dir), "no chapter files found (expected e.g. 01_fc_prologue.yaml)")

    beats, appearances, codex = [], [], []
    party = {}        # char_id -> open appearance dict (still being extended)
    seq = 0           # global, 1-based, derived from order
    summaries = []    # per chapter, for the report
    itinerary = []    # per beat, for -v

    def check_art(where, cid, key, val):
        if val and "/" not in str(val) and assets_dir:
            p = os.path.join(assets_dir, "characters", str(cid), str(val))
            if not os.path.exists(p):
                P.warn(where, "%s file not found: %s" % (key, os.path.relpath(p)))

    def parse_presence(where, key, raw):
        """-> list of (char_id, doing, at, by). Accepts  id | {id: doing} | {who:, doing:, at:, by:}."""
        out = []
        for item in as_list(raw):
            if isinstance(item, str):
                cid, doing, at, by = item, None, None, None
            elif isinstance(item, dict) and "who" in item:
                bad = [k for k in item if k not in PRESENCE_KEYS]
                if bad:
                    P.error(where, "%s: unknown field(s) %s in long-form entry (allowed: who, doing, at, by)" % (key, bad))
                cid, doing, at, by = item.get("who"), item.get("doing"), item.get("at"), item.get("by")
            elif isinstance(item, dict) and len(item) == 1:
                (cid, doing), = item.items()
                at = by = None
                if doing is not None and not isinstance(doing, str):
                    P.error(where, "%s: '%s' should be followed by a short text (got %r)" % (key, cid, doing))
                    doing = None
            else:
                P.error(where, "%s: each entry must be  - id   or  - id: what they're doing   or  - who: id ... (got %r)" % (key, item))
                continue
            cid = str(cid)
            if cid not in char_ids:
                P.error(where, "%s: unknown character '%s'%s" % (key, cid, suggest(cid, char_ids)))
                continue
            if at is not None and str(at) not in loc_ids:
                P.error(where, "%s: '%s' is at unknown location '%s'%s" % (key, cid, at, suggest(at, loc_ids)))
                at = None
            if by is not None:
                by = str(by).lower()
                if by not in TRAVEL_MODES:
                    P.error(where, "%s: '%s' travels by '%s'; use foot, rail or air" % (key, cid, by))
                    by = None
            out.append((cid, doing, None if at is None else str(at), by))
        return out

    for path in chapter_files:
        ch = load_yaml(path)
        fwhere = rel(path)
        if not isinstance(ch, dict):
            P.error(fwhere, "chapter file must have  id:, chapter:, beats:")
            continue
        for k in ch:
            if k not in {"game", "id", "chapter", "date", "beats"}:
                P.error(fwhere, "unknown top-level field '%s' (allowed: game, id, chapter, date, beats)" % k)
        ch_id = str(ch.get("id") or os.path.splitext(os.path.basename(path))[0])
        if not ch.get("id"):
            P.error(fwhere, "needs an id: (short slug like fc_ch1)")
        ch_name = str(ch.get("chapter") or ch_id)
        if not ch.get("chapter"):
            P.error(fwhere, "needs a chapter: (display name like \"Chapter 1\")")
        game = ch.get("game")
        if not isinstance(ch.get("beats"), list) or not ch["beats"]:
            P.error(fwhere, "needs a non-empty beats: list")
            continue

        date = ch.get("date")
        at = None
        moves, places, first_seq = 0, [], seq + 1
        for n, b in enumerate(ch["beats"], 1):
            seq += 1
            if not isinstance(b, dict):
                P.error("%s  beat %d" % (fwhere, n), "each beat must be a mapping with at least a title: (got %r)" % (b,))
                continue
            title = b.get("title")
            where = "%s  beat %d%s" % (fwhere, n, (' "%s"' % str(title)[:48]) if title else "")
            for k in b:
                if k not in BEAT_KEYS:
                    P.error(where, "unknown field '%s'%s" % (k, suggest(k, BEAT_KEYS)))
            if not title:
                P.error(where, "needs a title:")
                title = "(untitled)"

            if b.get("date") is not None:
                date = str(b["date"])
            if date is None and n == 1:
                P.warn(where, "no date yet; set date: on the chapter or its first beat")

            if b.get("at") is not None:
                new_at = str(b["at"])
                if new_at not in loc_ids:
                    P.error(where, "unknown location '%s'%s" % (new_at, suggest(new_at, loc_ids)))
                elif new_at not in loc_with_xy:
                    P.warn(where, "location '%s' has no xy, so the party will not be drawn here" % new_at)
                if at is not None and new_at != at:
                    moves += 1
                at = new_at
            elif n == 1:
                P.error(where, "the first beat of a chapter must say where the party is (at: <loc_id>)")
            if at is not None and (not places or places[-1] != at):
                places.append(at)

            by = b.get("by")
            if by is not None:
                by = str(by).lower()
                if by not in TRAVEL_MODES:
                    P.error(where, "by: '%s' is not a travel mode; use foot, rail or air" % by)
                    by = None

            beat_id = "%s_%03d" % (ch_id, n)
            beats.append({
                "beat_id": beat_id,
                "sequence": seq,
                "game": game,
                "chapter": ch_name,
                "title": str(title),
                "default_location": at,
                "approx_date": date,
                "travel_mode": by,
            })

            ev = []
            # join: start (or restart) travelling with the party
            for cid, doing, c_at, c_by in parse_presence(where, "join", b.get("join")):
                if cid in party:
                    prev = party[cid]
                    if prev["join_sequence"] == seq:
                        P.warn(where, "'%s' joins twice on the same beat; keeping the later entry" % cid)
                        appearances.remove(prev)
                    else:
                        prev["leave_sequence"] = seq - 1
                    ev.append("~" + cid)
                else:
                    ev.append("+" + cid)
                a = {"char_id": cid, "join_sequence": seq, "leave_sequence": None,
                     "location": c_at, "activity": doing, "travel_mode": c_by}
                appearances.append(a)
                party[cid] = a
            # cameo: present for this beat only
            for cid, doing, c_at, c_by in parse_presence(where, "cameo", b.get("cameo")):
                if cid in party:
                    P.warn(where, "'%s' is already with the party, so the cameo is redundant" % cid)
                    continue
                appearances.append({"char_id": cid, "join_sequence": seq, "leave_sequence": seq,
                                    "location": c_at, "activity": doing, "travel_mode": c_by})
                ev.append("(%s)" % cid)
            # leave: last beat they are seen with the party
            for cid in as_list(b.get("leave")):
                cid = str(cid)
                if cid not in char_ids:
                    P.error(where, "leave: unknown character '%s'%s" % (cid, suggest(cid, char_ids)))
                elif cid not in party:
                    P.error(where, "leave: '%s' is not with the party here (currently: %s)"
                            % (cid, ", ".join(party) or "nobody"))
                else:
                    party.pop(cid)["leave_sequence"] = seq
                    ev.append("-" + cid)
            # codex: facts revealed on this beat
            cx = b.get("codex")
            if cx is not None and not isinstance(cx, dict):
                P.error(where, "codex: must be a mapping of char_id -> list of entries")
                cx = {}
            ncx = 0
            for cid, entries in (cx or {}).items():
                cid = str(cid)
                if cid not in char_ids:
                    P.error(where, "codex: unknown character '%s'%s" % (cid, suggest(cid, char_ids)))
                    continue
                if not isinstance(entries, list):
                    P.error(where, "codex: '%s' must be followed by a list (- bio: ...)" % cid)
                    continue
                for e in entries:
                    if not isinstance(e, dict):
                        P.error(where, "codex: each entry for '%s' must look like  - bio: text  (got %r)" % (cid, e))
                        continue
                    type_keys = [k for k in e if k not in CODEX_EXTRA_KEYS]
                    if len(type_keys) != 1:
                        P.error(where, "codex: entry for '%s' needs exactly one type key (bio, status, faction, identity, ...) "
                                       "plus optional name/icon/body; got keys %s" % (cid, list(e)))
                        continue
                    et = str(type_keys[0]).lower()
                    text = e[type_keys[0]]
                    if text is not None and not isinstance(text, str):
                        P.error(where, "codex: '%s' %s text should be plain text (got %r)" % (cid, et, text))
                        continue
                    check_art(where, cid, "icon", e.get("icon"))
                    check_art(where, cid, "body", e.get("body"))
                    codex.append({
                        "char_id": cid, "sequence": seq, "entry_type": et, "text": text,
                        "reveal_name": e.get("name"), "icon": e.get("icon"), "body": e.get("body"),
                    })
                    ncx += 1
            if ncx:
                ev.append("codex x%d" % ncx)

            itinerary.append((seq, ch_name, at or "?", str(title), " ".join(ev)))

        summaries.append({"chapter": ch_name, "file": os.path.basename(path), "beats": seq - first_seq + 1,
                          "moves": moves, "places": len(set(places)), "route": places})

    data = {"characters": characters, "locations": locations, "beats": beats,
            "appearances": appearances, "codex": codex}
    return data, summaries, itinerary, list(party)


# ----------------------------------------------------------------------------- output
def write_data_js(data, dst, story_dir):
    header = ("// Auto-generated from %s/ by build_data.py — do not edit by hand.\n"
              "// Coordinates are percentages of the map image (top-left origin).\n"
              % story_dir.replace("\\", "/").rstrip("/"))
    with open(dst, "w", encoding="utf-8") as f:
        f.write(header)
        f.write("window.TRAILS = " + json.dumps(data, indent=2, ensure_ascii=False) + ";\n")


def build(story_dir, dst, assets_dir, verbose=False, check_only=False):
    P = Problems()
    try:
        data, summaries, itinerary, party = compile_story(story_dir, assets_dir, P)
    except yaml.YAMLError as e:
        print("YAML syntax error:\n  %s" % str(e).replace("\n", "\n  "))
        return 1

    if verbose and itinerary:
        print("Itinerary  (#  location  title  |  +join  ~update  -leave  (cameo))")
        cur = None
        for seq, ch, at, title, ev in itinerary:
            if ch != cur:
                cur = ch
                print("\n%s" % ch)
            print("  %3d  %-15s %-58s %s" % (seq, at, title[:56] + (".." if len(title) > 58 else ""), ev))
        print()

    print("Compiled %s/" % story_dir.replace(os.sep, "/").rstrip("/"))
    for s in summaries:
        route = " > ".join(s["route"][:6]) + (" > ..." if len(s["route"]) > 6 else "")
        print("  %-14s %3d beats  %2d moves  %2d places   %s" % (s["chapter"], s["beats"], s["moves"], s["places"], route))
    print("  %d chapters | %d beats | %d characters | %d locations | %d appearances | %d codex entries"
          % (len(summaries), len(data["beats"]), len(data["characters"]), len(data["locations"]),
             len(data["appearances"]), len(data["codex"])))
    if party:
        print("  party at the end: %s" % ", ".join(party))

    P.report()

    if P.errors:
        print("\nNot written: fix the %d error(s) above." % len(P.errors))
        return 1
    if check_only:
        print("\nOK (check only, nothing written)")
        return 0
    write_data_js(data, dst, story_dir)
    print("\nWrote %s" % dst)
    return 0


def watch(story_dir, dst, assets_dir, verbose):
    def snapshot():
        return {p: os.path.getmtime(p) for p in glob.glob(os.path.join(story_dir, "*.yaml"))}
    print("Watching %s/ for changes (Ctrl+C to stop)\n" % story_dir)
    last = None
    try:
        while True:
            cur = snapshot()
            if cur != last:
                if last is not None:
                    print("\n" + "-" * 70 + "\n" + time.strftime("%H:%M:%S") + "  change detected\n")
                build(story_dir, dst, assets_dir, verbose)
                last = cur
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nstopped")


def main():
    ap = argparse.ArgumentParser(description="Compile story/*.yaml into data.js")
    ap.add_argument("--story", default="story", help="folder with the YAML files (default: story)")
    ap.add_argument("--out", default="data.js", help="output file (default: data.js)")
    ap.add_argument("--assets", default="assets", help="assets folder, for checking image files exist (default: assets)")
    ap.add_argument("-v", "--verbose", action="store_true", help="print the full beat-by-beat itinerary")
    ap.add_argument("--check", action="store_true", help="validate only; do not write")
    ap.add_argument("--watch", action="store_true", help="rebuild whenever a story file changes")
    args = ap.parse_args()

    if not os.path.isdir(args.story):
        sys.exit("Story folder not found: %s" % args.story)
    assets = args.assets if os.path.isdir(args.assets) else None

    if args.watch:
        watch(args.story, args.out, assets, args.verbose)
        return 0
    return build(args.story, args.out, assets, args.verbose, args.check)


if __name__ == "__main__":
    sys.exit(main())
