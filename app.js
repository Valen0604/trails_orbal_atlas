/* ============================================================
   Trails Timeline — app logic
   Reads window.TRAILS (data.js), window.ROAD_NETWORK + window.ROUTES (routes.js).
   ============================================================ */
(function () {
  "use strict";
  var D = window.TRAILS;
  var NET = window.ROAD_NETWORK || { nodes: {}, edges: [] };
  var OVERRIDE = window.ROUTES || {};

  // --- presentation config (edit freely; not part of the data) -------------
  var STYLE = {
    estelle: { color: "#e8623d", initials: "Es" },
    joshua:  { color: "#3f5d8a", initials: "Jo" },
    schera:  { color: "#c0436a", initials: "Sc" },
    cassius: { color: "#5f6b78", initials: "Ca" },
    josette: { color: "#d98a2b", initials: "Js" },
    alba:    { color: "#7a5ea8", initials: "Al" }
  };
  function styleFor(id) { return STYLE[id] || { color: "#888", initials: (id || "?").slice(0, 2) }; }
  var ANIM_MS = 900, VIEW_PAD = 1.5, MIN_VW = 6;

  // --- indexes -------------------------------------------------------------
  var locById = {}; D.locations.forEach(function (l) { locById[l.loc_id] = l; });
  var charById = {}; D.characters.forEach(function (c) { charById[c.char_id] = c; });
  var beats = D.beats.slice().sort(function (a, b) { return a.sequence - b.sequence; });
  var appsByChar = {};
  D.appearances.forEach(function (a) { (appsByChar[a.char_id] = appsByChar[a.char_id] || []).push(a); });
  var codexByChar = {};
  D.codex.forEach(function (e) { (codexByChar[e.char_id] = codexByChar[e.char_id] || []).push(e); });
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }
  // Resolve an image cell. A bare filename ("icon.png") is taken from the character's own
  // folder; anything containing a slash (a full path or a URL) is used exactly as written.
  function charAsset(charId, val) {
    if (!val) return null;
    return val.indexOf("/") === -1 ? "assets/characters/" + charId + "/" + val : val;
  }

  // --- DOM -----------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    date: $("date"), beatTitle: $("beatTitle"), chaptag: $("chaptag"), counter: $("counter"),
    scrub: $("scrub"), prev: $("prev"), next: $("next"), play: $("play"), start: $("start"),
    mapframe: $("mapframe"), mapcontent: $("mapcontent"), routes: $("routes"), markers: $("markers"), pips: $("pips"),
    cast: $("cast"),
    codex: $("codexGrid"), tabMap: $("tabMap"), tabCodex: $("tabCodex"),
    viewMap: $("viewMap"), viewCodex: $("viewCodex")
  };

  // --- state ---------------------------------------------------------------
  var index = 0, playing = false, playTimer = null, expandedCodexId = null;
  var mode = "theater";                 // theater | follow | whole | free | char
  var followId = null;                  // char_id the map is locked onto (mode === "char")
  var ZBASE = 1;                        // zoom factor of the default framing; icons are full-size here
  var markerEls = {}, currentPos = {};  // char_id -> {x,y} in MAP %
  var vp = { x: 0, y: 0, w: 100 };      // viewport in MAP %
  var animId = null, pipEls = [];

  // =========================================================================
  //  ROAD GRAPH  (nodes = locations + junctions; edges = road segments)
  // =========================================================================
  var nodeCoord = {}, adj = {};
  function buildGraph() {
    D.locations.forEach(function (l) {
      if (l.map_x != null && l.map_y != null) nodeCoord[l.loc_id] = { x: l.map_x, y: l.map_y };
    });
    Object.keys(NET.nodes || {}).forEach(function (id) {
      nodeCoord[id] = { x: NET.nodes[id][0], y: NET.nodes[id][1] };
    });
    Object.keys(nodeCoord).forEach(function (id) { adj[id] = []; });
    (NET.edges || []).forEach(function (e) {
      var A = nodeCoord[e.a], B = nodeCoord[e.b];
      if (!A || !B) { console.warn("Edge references unknown node:", e.a, e.b); return; }
      var via = (e.via || []).map(function (p) { return { x: p[0], y: p[1] }; });
      var poly = [A].concat(via, [B]);
      var len = polyLen(poly);
      adj[e.a].push({ to: e.b, w: len, poly: poly });
      adj[e.b].push({ to: e.a, w: len, poly: poly.slice().reverse() });
    });
  }
  function polyLen(p) {
    var s = 0;
    for (var i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    return s;
  }
  // Dijkstra over the node graph; returns ordered node id list or null.
  function shortestNodes(from, to) {
    if (!adj[from] || !adj[to]) return null;
    var dist = {}, prev = {}, seen = {}, pq = [from];
    Object.keys(nodeCoord).forEach(function (id) { dist[id] = Infinity; });
    dist[from] = 0;
    while (pq.length) {
      pq.sort(function (a, b) { return dist[a] - dist[b]; });
      var u = pq.shift();
      if (u === to) break;
      if (seen[u]) continue; seen[u] = true;
      adj[u].forEach(function (e) {
        var nd = dist[u] + e.w;
        if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; if (!seen[e.to]) pq.push(e.to); }
      });
    }
    if (dist[to] === Infinity) return null;
    var path = [to];
    while (path[0] !== from) { var p = prev[path[0]]; if (p == null) return null; path.unshift(p); }
    return path;
  }
  // Full polyline (map %) for a journey between two locations.
  function routeBetween(fromLoc, toLoc) {
    var ov = OVERRIDE[fromLoc + ">" + toLoc], rv = OVERRIDE[toLoc + ">" + fromLoc];
    if (ov) return ov.map(function (p) { return { x: p[0], y: p[1] }; });
    if (rv) return rv.map(function (p) { return { x: p[0], y: p[1] }; }).reverse();
    var nodes = shortestNodes(fromLoc, toLoc);
    if (nodes && nodes.length > 1) {
      var pts = [];
      for (var i = 1; i < nodes.length; i++) {
        var seg = edgePoly(nodes[i - 1], nodes[i]);
        if (!seg) continue;
        if (pts.length) seg = seg.slice(1);          // drop shared junction point
        pts = pts.concat(seg);
      }
      if (pts.length > 1) return pts;
    }
    var a = locPoint(fromLoc), b = locPoint(toLoc);
    return (a && b) ? [a, b] : (a ? [a] : (b ? [b] : []));
  }
  function edgePoly(a, b) {
    var list = adj[a] || [];
    for (var i = 0; i < list.length; i++) if (list[i].to === b) return list[i].poly;
    return null;
  }

  // --- geometry helpers ----------------------------------------------------
  function locPoint(id) {
    var l = locById[id];
    return (l && l.map_x != null) ? { x: l.map_x, y: l.map_y } : null;
  }
  function charLocAt(charId, beat) {
    var list = appsByChar[charId] || [], match = null;
    for (var i = 0; i < list.length; i++) {
      var a = list[i], hi = (a.leave_sequence == null ? Infinity : a.leave_sequence);
      if (a.join_sequence <= beat.sequence && beat.sequence <= hi) match = a;
    }
    return match ? (match.location || beat.default_location) : null;
  }
  function activityAt(charId, beat) {
    var list = appsByChar[charId] || [], match = null;
    for (var i = 0; i < list.length; i++) {
      var a = list[i], hi = (a.leave_sequence == null ? Infinity : a.leave_sequence);
      if (a.join_sequence <= beat.sequence && beat.sequence <= hi) match = a;
    }
    return match ? match.activity : null;
  }
  // Codex entries this character has unlocked by `seq`, oldest first.
  function revealedCodex(charId, seq) {
    return (codexByChar[charId] || [])
      .filter(function (e) { return e.sequence != null && e.sequence <= seq; })
      .sort(function (a, b) { return a.sequence - b.sequence; });
  }
  // A character's state AT a point in the timeline: name/alias/icon/body evolve as the
  // codex reveals fire. An `entry_type: "identity"` row (or an explicit `reveal_name`)
  // renames them; the previous name becomes their alias. icon/body rows swap the art.
  function effectiveChar(charId, seq) {
    var c = charById[charId] || { display_name: charId };
    var st = { id: charId, name: c.display_name, alias: null,
               icon: charAsset(charId, c.icon), body: charAsset(charId, c.body),
               faction: c.faction || null, facts: [] };
    revealedCodex(charId, seq).forEach(function (e) {
      var rn = e.reveal_name || (e.entry_type === "identity" ? e.text : null);
      if (rn) st.name = rn;
      if (e.icon) st.icon = charAsset(charId, e.icon);
      if (e.body) st.body = charAsset(charId, e.body);
      var isPureIdentity = e.entry_type === "identity" && !e.reveal_name;  // text IS the name
      if (e.text && !isPureIdentity) st.facts.push({ type: e.entry_type, text: e.text });
    });
    if (st.name !== c.display_name) st.alias = c.display_name;   // original name -> alias
    return st;
  }
  function displayNameAt(charId, seq) { return effectiveChar(charId, seq).name; }
  // "Known" = met on the timeline, or surfaced by a revealed codex entry.
  function isKnown(charId, seq) {
    var apps = appsByChar[charId] || [];
    for (var i = 0; i < apps.length; i++) {
      if (apps[i].join_sequence != null && apps[i].join_sequence <= seq) return true;
    }
    return revealedCodex(charId, seq).length > 0;
  }

  function alongPath(pts, t) {
    if (pts.length === 1) return pts[0];
    var segs = [], total = 0, i;
    for (i = 1; i < pts.length; i++) { var L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push(L); total += L; }
    if (total === 0) return pts[0];
    var d = t * total, acc = 0;
    for (i = 0; i < segs.length; i++) {
      if (acc + segs[i] >= d) { var lt = (d - acc) / (segs[i] || 1); return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * lt, y: pts[i].y + (pts[i + 1].y - pts[i].y) * lt }; }
      acc += segs[i];
    }
    return pts[pts.length - 1];
  }
  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function groupOffsets(beat) {
    var byLoc = {}, out = {};
    D.characters.forEach(function (c) { var loc = charLocAt(c.char_id, beat); if (loc) (byLoc[loc] = byLoc[loc] || []).push(c.char_id); });
    Object.keys(byLoc).forEach(function (loc) {
      var ids = byLoc[loc], n = ids.length;
      ids.forEach(function (id, i) {
        if (n === 1) { out[id] = { dx: 0, dy: 0 }; return; }
        // tight ring so the badges just touch instead of floating apart; raise r for more spread
        var ang = (i / n) * Math.PI * 2 - Math.PI / 2, r = 0.5;
        out[id] = { dx: Math.cos(ang) * r, dy: Math.sin(ang) * r };
      });
    });
    return out;
  }

  // =========================================================================
  //  VIEWPORT  (map % -> frame %, plus the CSS zoom transform on the image)
  // =========================================================================
  function mapToFrame(px, py) { return { fx: (px - vp.x) / vp.w * 100, fy: (py - vp.y) / vp.w * 100 }; }
  function fitBox(pts) {
    if (!pts.length) return { x: 0, y: 0, w: 100 };
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    pts.forEach(function (p) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); });
    var ext = Math.max(maxx - minx, maxy - miny);
    var w = Math.max(MIN_VW, ext * (1 + VIEW_PAD));
    w = Math.min(100, w);
    var cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    var x = Math.max(0, Math.min(100 - w, cx - w / 2));
    var y = Math.max(0, Math.min(100 - w, cy - w / 2));
    return { x: x, y: y, w: w };
  }
  var theaterBox;
  function targetViewport(activeTargets, moverPts) {
    if (mode === "free") return { x: vp.x, y: vp.y, w: vp.w };  // user-driven — hold the manual view
    if (mode === "whole") return { x: 0, y: 0, w: 100 };
    if (mode === "follow") {
      var pts = activeTargets.concat(moverPts);
      return pts.length ? fitBox(pts) : theaterBox;
    }
    return theaterBox;             // "theater" — stable view of all locations
  }
  function applyTransform() {
    var Z = 100 / vp.w;
    el.mapcontent.style.transform = "scale(" + Z + ") translate(" + (-vp.x) + "%, " + (-vp.y) + "%)";
    // shrink/grow marker + pip icons with the zoom so the gaps between them track the map.
    // 1 at the default framing; clamped so icons stay legible when fully zoomed in/out.
    var s = Math.max(0.5, Math.min(2.4, Z / ZBASE));
    el.mapframe.style.setProperty("--icon-scale", s);
  }
  function project() {
    applyTransform();
    pipEls.forEach(function (d) { var m = mapToFrame(+d.dataset.px, +d.dataset.py); d.style.left = m.fx + "%"; d.style.top = m.fy + "%"; });
    D.characters.forEach(function (c) {
      var mk = markerEls[c.char_id]; if (!mk) return;
      var p = currentPos[c.char_id];
      if (!p) { mk.classList.add("hidden"); return; }
      mk.classList.remove("hidden");
      var f = mapToFrame(p.x, p.y); mk.style.left = f.fx + "%"; mk.style.top = f.fy + "%";
    });
    reprojectRoutes();
  }

  // --- markers + route lines ----------------------------------------------
  function makeMarker(c) {
    var s = styleFor(c.char_id), m = document.createElement("div");
    var icon = charAsset(c.char_id, c.icon);                 // render() keeps this current per beat
    m.className = "marker hidden";
    m.innerHTML = '<div class="badge" style="background:' + (icon ? "#fff" : s.color) + '">' +
      (icon ? '<img src="' + esc(icon) + '" alt="">' : esc(s.initials)) + '</div>' +
      '<div class="nametag">' + esc(c.display_name) + '</div>';
    el.markers.appendChild(m);
    return m;
  }
  function drawRouteLine(id, ptsMap) {
    var ns = "http://www.w3.org/2000/svg", pl = document.createElementNS(ns, "polyline");
    pl._pts = ptsMap;
    pl.setAttribute("fill", "none");
    pl.setAttribute("stroke", styleFor(id).color);
    pl.setAttribute("stroke-width", "0.5");
    pl.setAttribute("stroke-linejoin", "round"); pl.setAttribute("stroke-linecap", "round");
    pl.setAttribute("opacity", "0.9"); pl.setAttribute("stroke-dasharray", "1.2 1");
    el.routes.appendChild(pl);
    return pl;
  }
  function reprojectRoutes() {
    Array.prototype.forEach.call(el.routes.children, function (pl) {
      if (!pl._pts) return;
      pl.setAttribute("points", pl._pts.map(function (p) { var m = mapToFrame(p.x, p.y); return m.fx + "," + m.fy; }).join(" "));
    });
  }
  function clearRoutes() { while (el.routes.firstChild) el.routes.removeChild(el.routes.firstChild); }

  // =========================================================================
  //  RENDER
  // =========================================================================
  function render(animate) {
    var beat = beats[index];
    el.date.textContent = beat.approx_date || "";
    el.beatTitle.textContent = beat.title || "";
    el.chaptag.textContent = beat.chapter;
    el.counter.innerHTML = "<b>" + (index + 1) + "</b> / " + beats.length;
    el.scrub.value = index;
    el.scrub.style.setProperty("--fill", (index / (beats.length - 1) * 100) + "%");
    el.prev.disabled = index === 0; el.next.disabled = index === beats.length - 1;

    var offsets = groupOffsets(beat), targets = {}, activeTargetPts = [];
    D.characters.forEach(function (c) {
      var loc = charLocAt(c.char_id, beat); if (!loc) return;
      var p = locPoint(loc); if (!p) { console.warn("No coordinates for location:", loc); return; }
      var o = offsets[c.char_id] || { dx: 0, dy: -0.7 };
      targets[c.char_id] = { x: p.x + o.dx, y: p.y + o.dy, loc: loc };
      activeTargetPts.push({ x: p.x, y: p.y });
    });

    if (animId) { cancelAnimationFrame(animId); animId = null; }

    var movers = [], moverPts = [];
    D.characters.forEach(function (c) {
      var id = c.char_id;
      if (!markerEls[id]) markerEls[id] = makeMarker(c);
      var tgt = targets[id], from = currentPos[id], mk = markerEls[id];
      var st = effectiveChar(id, beat.sequence);                   // name + icon both follow reveals
      var nt = mk.querySelector(".nametag"); if (nt) nt.textContent = st.name;
      var badge = mk.querySelector(".badge");                      // swap the badge art only when it changes
      if (badge && mk.dataset.icon !== (st.icon || "")) {
        mk.dataset.icon = st.icon || "";
        badge.style.background = st.icon ? "#fff" : styleFor(id).color;   // white circle behind an icon; color only for initials
        badge.innerHTML = st.icon ? '<img src="' + esc(st.icon) + '" alt="">' : esc(styleFor(id).initials);
      }
      if (!tgt) { delete currentPos[id]; return; }
      if (animate && from && (Math.abs(from.x - tgt.x) > 0.04 || Math.abs(from.y - tgt.y) > 0.04)) {
        var route = routeBetween(mk.dataset.loc || tgt.loc, tgt.loc);
        var rs = route[0], re = route[route.length - 1];
        movers.push({ id: id, route: route, tgt: tgt,
          prevOff: { x: from.x - rs.x, y: from.y - rs.y }, tgtOff: { x: tgt.x - re.x, y: tgt.y - re.y } });
        moverPts.push({ x: from.x, y: from.y }, { x: re.x, y: re.y });
      } else {
        currentPos[id] = { x: tgt.x, y: tgt.y };
      }
      mk.dataset.loc = tgt.loc;
    });

    var startVP = { x: vp.x, y: vp.y, w: vp.w };
    var endVP = (mode === "char" && followId && targets[followId])
      ? charBox(targets[followId])              // follow the locked-on character to their new spot
      : targetViewport(activeTargetPts, moverPts);

    if (!animate) {
      clearRoutes();                 // jumping (scrub/start) shows no path
      vp = endVP; project(); renderCast(beat);
      if (el.viewCodex.classList.contains("active")) renderCodex();
      return;
    }

    clearRoutes();                   // a new move starts -> drop the previous travelled path
    var lines = movers.map(function (mv) { return mv.route.length > 1 ? drawRouteLine(mv.id, mv.route) : null; });
    var t0 = performance.now();
    (function step(now) {
      var t = Math.min(1, (now - t0) / ANIM_MS), e = easeInOut(t);
      vp = { x: lerp(startVP.x, endVP.x, e), y: lerp(startVP.y, endVP.y, e), w: lerp(startVP.w, endVP.w, e) };
      movers.forEach(function (mv) {
        var c = alongPath(mv.route, e);
        currentPos[mv.id] = { x: c.x + mv.prevOff.x + (mv.tgtOff.x - mv.prevOff.x) * e,
                              y: c.y + mv.prevOff.y + (mv.tgtOff.y - mv.prevOff.y) * e };
      });
      project();
      if (t < 1) animId = requestAnimationFrame(step);
      else {
        movers.forEach(function (mv) { currentPos[mv.id] = { x: mv.tgt.x, y: mv.tgt.y }; });
        vp = endVP; project(); animId = null;   // keep the path drawn until the next move
      }
    })(t0);

    renderCast(beat);
    if (el.viewCodex.classList.contains("active")) renderCodex();
  }

  // --- cast panel ----------------------------------------------------------
  function renderCast(beat) {
    var rows = [];
    D.characters.forEach(function (c) {
      var loc = charLocAt(c.char_id, beat); if (!loc) return;
      var s = styleFor(c.char_id);
      var st = effectiveChar(c.char_id, beat.sequence);   // icon + name follow reveals here too
      var place = (locById[loc] && locById[loc].name) || loc;
      var following = c.char_id === followId ? " is-following" : "";
      var ava = st.icon
        ? '<span class="cast-ava"><img src="' + esc(st.icon) + '" alt=""></span>'
        : '<span class="cast-ava cast-ava-fallback" style="background:' + s.color + '">' + esc(s.initials) + '</span>';
      rows.push('<button class="cast-chip' + following + '" data-char="' + c.char_id + '" title="Follow ' + esc(st.name) + ' on the map">' +
        ava +
        '<span class="cast-chip-txt"><span class="cast-name">' + esc(st.name) + '</span>' +
        '<span class="cast-act">' + esc(place) + '</span></span></button>');
    });
    el.cast.innerHTML = rows.length ? rows.join("") : '<div class="cast-empty">No one on the map yet.</div>';
  }

  // --- codex (a character index that expands into a dossier) ---------------
  var SILHOUETTE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6Z"/></svg>';

  function avatarHTML(charId, st) {
    if (st.icon) return '<span class="codex-ava"><img src="' + esc(st.icon) + '" alt=""></span>';
    var s = styleFor(charId);
    return '<span class="codex-ava codex-ava-fallback" style="background:' + s.color + '">' + esc(s.initials) + '</span>';
  }
  function portraitHTML(st) {
    if (st.body) return '<img class="codex-body-img" src="' + esc(st.body) + '" alt="">';
    return '<div class="codex-body-ph">' + SILHOUETTE + '<span>Full portrait coming soon</span></div>';
  }
  function detailHTML(st) {
    var alias = st.alias ? '<p class="codex-alias">Alias &mdash; formerly known as <b>' + esc(st.alias) + '</b></p>' : '';
    var facts;
    if (st.facts.length) {
      // group by entry_type so each section (Bio, Status, …) accumulates every revealed line
      var order = [], byType = {};
      st.facts.forEach(function (f) {
        var t = f.type || "note";
        if (!byType[t]) { byType[t] = []; order.push(t); }
        byType[t].push(f.text);
      });
      facts = '<div class="codex-facts">' + order.map(function (t) {
        return '<div class="codex-section">' +
          '<span class="codex-fact-type">' + esc(t) + '</span>' +
          byType[t].map(function (tx) { return '<p>' + esc(tx) + '</p>'; }).join("") +
        '</div>';
      }).join("") + '</div>';
    } else {
      facts = '<p class="codex-nofacts">No notes recorded yet.</p>';
    }
    return '<div class="codex-detail">' +
      '<div class="codex-portrait">' + portraitHTML(st) + '</div>' +
      '<div class="codex-info">' + alias + facts + '</div>' +
    '</div>';
  }

  function renderCodex() {
    var seq = beats[index].sequence;
    var known = D.characters.filter(function (c) { return isKnown(c.char_id, seq); });
    if (!known.length) {
      el.codex.innerHTML = '<div class="codex-empty">No characters known yet.<br>Advance the timeline to meet the cast.</div>';
      return;
    }
    el.codex.innerHTML = known.map(function (c) {
      var st = effectiveChar(c.char_id, seq);
      var open = c.char_id === expandedCodexId;
      return '<div class="codex-entry' + (open ? " open" : "") + '" data-char="' + c.char_id + '">' +
        '<button class="codex-row" type="button">' +
          avatarHTML(c.char_id, st) +
          '<span class="codex-row-text">' +
            '<span class="codex-row-name">' + esc(st.name) + '</span>' +
            (st.faction ? '<span class="codex-row-meta">' + esc(st.faction) + '</span>' : '') +
          '</span>' +
          '<span class="codex-chevron" aria-hidden="true">' + (open ? "▾" : "▸") + '</span>' +
        '</button>' +
        (open ? detailHTML(st) : "") +
      '</div>';
    }).join("");
  }

  // --- pips ----------------------------------------------------------------
  function renderPips() {
    D.locations.forEach(function (l) {
      if (l.map_x == null || l.map_y == null) return;
      var d = document.createElement("div");
      d.className = "loc-pip" + (l.show_name ? " show-name" : ""); d.dataset.name = l.name;
      d.dataset.px = l.map_x; d.dataset.py = l.map_y;
      el.pips.appendChild(d); pipEls.push(d);
    });
  }

  // --- navigation ----------------------------------------------------------
  function go(i, animate) { i = Math.max(0, Math.min(beats.length - 1, i)); if (i === index && animate) return; index = i; render(animate); }
  function setPlaying(on) {
    playing = on; el.play.textContent = on ? "❚❚" : "▶";
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    if (on) playTimer = setInterval(function () { if (index >= beats.length - 1) { setPlaying(false); return; } go(index + 1, true); }, ANIM_MS + 700);
  }

  el.prev.addEventListener("click", function () { setPlaying(false); go(index - 1, true); });
  el.next.addEventListener("click", function () { setPlaying(false); go(index + 1, true); });
  el.start.addEventListener("click", function () { setPlaying(false); go(0, false); });
  el.play.addEventListener("click", function () { setPlaying(!playing); });
  el.scrub.addEventListener("input", function () { setPlaying(false); go(parseInt(this.value, 10), false); });

  // click a character chip -> fly the map to them
  el.cast.addEventListener("click", function (e) {
    var chip = e.target.closest(".cast-chip"); if (!chip) return;
    focusCharacter(chip.dataset.char);
  });

  // click a codex row -> expand/collapse that character's dossier (clicks inside the open
  // dossier don't collapse it — only the row toggles)
  el.codex.addEventListener("click", function (e) {
    var row = e.target.closest(".codex-row"); if (!row) return;
    var id = row.parentNode.dataset.char;
    expandedCodexId = (expandedCodexId === id) ? null : id;
    renderCodex();
  });

  // --- manual pan / zoom (Google-Maps style) -------------------------------
  var MAX_VW = 80;                       // most zoomed-out; MIN_VW (=6) is most zoomed-in
  function clampVP(v) {
    v.w = Math.max(MIN_VW, Math.min(MAX_VW, v.w));
    v.x = Math.max(0, Math.min(100 - v.w, v.x));
    v.y = Math.max(0, Math.min(100 - v.w, v.y));
    return v;
  }
  function enterFreeMode() {
    mode = "free";          // hold the manual view; beat changes no longer reframe
    setPlaying(false);
    if (followId) { followId = null; renderCast(beats[index]); }   // manual pan/zoom breaks the lock
  }
  function animateVP(end) {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    var start = { x: vp.x, y: vp.y, w: vp.w }, t0 = performance.now();
    (function step(now) {
      var t = Math.min(1, (now - t0) / ANIM_MS), e = easeInOut(t);
      vp = { x: lerp(start.x, end.x, e), y: lerp(start.y, end.y, e), w: lerp(start.w, end.w, e) };
      project();
      if (t < 1) animId = requestAnimationFrame(step); else { vp = end; project(); animId = null; }
    })(t0);
  }
  function charBox(p) {
    var w = Math.max(MIN_VW, theaterBox.w * 0.25);   // focus zoom (lower = closer); kept tight so it reads as "following"
    return clampVP({ x: p.x - w / 2, y: p.y - w / 2, w: w });
  }
  function focusCharacter(id) {
    if (!currentPos[id]) return;
    setPlaying(false);
    followId = id; mode = "char";                    // lock on -> render() keeps re-centering each beat
    animateVP(charBox(currentPos[id]));
    renderCast(beats[index]);                         // refresh chip highlight
  }
  el.mapframe.addEventListener("wheel", function (e) {
    e.preventDefault();
    enterFreeMode();
    var r = this.getBoundingClientRect();
    var fx = (e.clientX - r.left) / r.width  * 100;   // cursor in frame %
    var fy = (e.clientY - r.top)  / r.height * 100;
    var mapX = vp.x + fx / 100 * vp.w;                 // map point under cursor
    var mapY = vp.y + fy / 100 * vp.w;
    var factor = Math.exp(-e.deltaY * 0.0015);         // wheel up -> zoom in
    vp.w = Math.max(MIN_VW, Math.min(MAX_VW, vp.w / factor));  // clamp FIRST...
    vp.x = mapX - fx / 100 * vp.w;                      // ...then anchor so the
    vp.y = mapY - fy / 100 * vp.w;                      // cursor point stays put (no drift at the limit)
    clampVP(vp);
    project();
  }, { passive: false });

  var dragging = false, dragStart = null;
  el.mapframe.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    dragging = true; dragStart = { x: e.clientX, y: e.clientY, vpx: vp.x, vpy: vp.y };
    this.setPointerCapture(e.pointerId); this.classList.add("dragging");
  });
  el.mapframe.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var r = this.getBoundingClientRect();
    enterFreeMode();
    vp.x = dragStart.vpx - (e.clientX - dragStart.x) / r.width  * vp.w;
    vp.y = dragStart.vpy - (e.clientY - dragStart.y) / r.height * vp.w;
    clampVP(vp);
    project();
  });
  function endDrag() { dragging = false; el.mapframe.classList.remove("dragging"); }
  el.mapframe.addEventListener("pointerup", endDrag);
  el.mapframe.addEventListener("pointercancel", endDrag);
  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") { setPlaying(false); go(index + 1, true); }
    else if (e.key === "ArrowLeft") { setPlaying(false); go(index - 1, true); }
    else if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
  });

  function showTab(which) {
    var map = which === "map";
    el.tabMap.classList.toggle("active", map); el.tabCodex.classList.toggle("active", !map);
    el.viewMap.classList.toggle("active", map); el.viewCodex.classList.toggle("active", !map);
    if (!map) renderCodex();
  }
  el.tabMap.addEventListener("click", function () { showTab("map"); });
  el.tabCodex.addEventListener("click", function () { showTab("codex"); });

  // --- init ----------------------------------------------------------------
  buildGraph();
  theaterBox = fitBox(D.locations.filter(function (l) { return l.map_x != null; }).map(function (l) { return { x: l.map_x, y: l.map_y }; }));
  ZBASE = 100 / theaterBox.w;          // icons are full-size at the default "all locations" zoom
  el.scrub.max = beats.length - 1;
  renderPips();
  render(false);
})();
