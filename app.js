/* ============================================================
   Trails Timeline — app logic  (map-as-the-page edition)
   Reads window.TRAILS (data.js), window.ROAD_NETWORK / RAIL_NETWORK / ROUTES (routes.js).

   Layout model: #mapframe is the viewport (any size). Inside it, #world is an element
   sized to the map image's aspect ratio that holds the image AND every overlay (routes,
   place labels, character markers) positioned in map % — so overlays never drift from
   the image. The camera is one CSS transform on #world; labels and markers counter-scale
   by 1/--s so they keep a constant screen size while the world zooms.
   ============================================================ */
(function () {
  "use strict";
  var D = window.TRAILS;
  var NET = window.ROAD_NETWORK || { nodes: {}, edges: [] };
  var RAIL = window.RAIL_NETWORK || { nodes: {}, edges: [] };
  var OVERRIDE = window.ROUTES || {};

  // --- presentation config (edit freely; not part of the data) -------------
  var ANIM_MS = 900;          // marker glide + camera glide
  var VIEW_PAD = 0.55;        // padding around the framed points (fraction of their extent)
  var MIN_VW = 6, MAX_VW = 100;   // visible map-% width: tightest / widest zoom
  var HUD_TOP = 150, HUD_BOTTOM = 120;   // px the overlays cover; framing centres on the band between them
  var FAR = 40, NEAR = 22, DEEP = 12;   // label tiers by visible width: far > 40 > mid > 22 > near > 12 > deep

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
  function charAsset(charId, val) {
    if (!val) return null;
    return val.indexOf("/") === -1 ? "assets/characters/" + charId + "/" + val : val;
  }
  function initialsFor(name) {
    var w = String(name || "?").trim().split(/\s+/);
    return w.length > 1 ? (w[0][0] + w[1][0]) : w[0].slice(0, 2);
  }
  function styleFor(id) {
    var c = charById[id] || {};
    return { color: c.color || "#888", initials: c.initials || initialsFor(c.display_name || id) };
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // --- DOM -----------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    frame: $("mapframe"), world: $("world"), img: $("mapimg"), routes: $("routes"), places: $("places"), markers: $("markers"),
    date: $("date"), beatTitle: $("beatTitle"), chaptag: $("chaptag"), counter: $("counter"),
    scrub: $("scrub"), prev: $("prev"), next: $("next"), play: $("play"), start: $("start"), home: $("home"),
    cast: $("cast"),
    drawer: $("drawer"), drawerBody: $("drawerBody"), drawerTitle: $("drawerTitle"), drawerBack: $("drawerBack"),
    drawerClose: $("drawerClose"), drawerTools: $("drawerTools"), openCodex: $("openCodex"),
    codexSearch: $("codexSearch"), filterUpdated: $("filterUpdated")
  };

  // --- state ---------------------------------------------------------------
  var index = 0, playing = false, playTimer = null;
  var mode = "theater";                 // theater | free | char
  var followId = null;                  // char_id the camera is locked onto (mode === "char")
  var vp = { x: 0, y: 0, w: 100 };      // camera: top-left (map %) + visible width (map % of width)
  var aspect = 9 / 16;                  // image height / width, read from the image on load
  var Fw = 1, Fh = 1, S = 1;            // frame size (px) and world scale (screen px per world px)
  var ZBASE = 1;                        // scale at the default framing; icons are full-size there
  var markerEls = {}, currentPos = {};  // char_id -> element / live {x,y} in map %
  var animId = null;
  var fannedLoc = null;                 // loc_id whose pile is fanned out
  var lastPointerType = "mouse";
  var zoomTier = "";

  // =========================================================================
  //  TRAVEL GRAPHS  (foot = road network, rail = rail network; air = direct line)
  // =========================================================================
  var graphs = { foot: null, rail: null };
  function buildGraphFor(net) {
    var nodeCoord = {}, adj = {};
    D.locations.forEach(function (l) {
      if (l.map_x != null && l.map_y != null) nodeCoord[l.loc_id] = { x: l.map_x, y: l.map_y };
    });
    Object.keys(net.nodes || {}).forEach(function (id) { nodeCoord[id] = { x: net.nodes[id][0], y: net.nodes[id][1] }; });
    Object.keys(nodeCoord).forEach(function (id) { adj[id] = []; });
    (net.edges || []).forEach(function (e) {
      var A = nodeCoord[e.a], B = nodeCoord[e.b];
      if (!A || !B) { console.warn("Edge references unknown node:", e.a, e.b); return; }
      var via = (e.via || []).map(function (p) { return { x: p[0], y: p[1] }; });
      var poly = [A].concat(via, [B]);
      var len = polyLen(poly);
      adj[e.a].push({ to: e.b, w: len, poly: poly });
      adj[e.b].push({ to: e.a, w: len, poly: poly.slice().reverse() });
    });
    return { nodeCoord: nodeCoord, adj: adj };
  }
  function buildGraph() { graphs.foot = buildGraphFor(NET); graphs.rail = buildGraphFor(RAIL); }
  function polyLen(p) {
    var s = 0;
    for (var i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, (p[i].y - p[i - 1].y) * aspect);
    return s;
  }
  function shortestNodes(g, from, to) {        // Dijkstra over one graph
    var adj = g.adj, nodeCoord = g.nodeCoord;
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
  function edgePoly(g, a, b) {
    var list = g.adj[a] || [];
    for (var i = 0; i < list.length; i++) if (list[i].to === b) return list[i].poly;
    return null;
  }
  function graphRoute(g, fromLoc, toLoc) {
    var nodes = shortestNodes(g, fromLoc, toLoc);
    if (!nodes || nodes.length < 2) return null;
    var pts = [];
    for (var i = 1; i < nodes.length; i++) {
      var seg = edgePoly(g, nodes[i - 1], nodes[i]);
      if (!seg) continue;
      if (pts.length) seg = seg.slice(1);
      pts = pts.concat(seg);
    }
    return pts.length > 1 ? pts : null;
  }
  // air -> straight; rail -> rail graph (straight while empty); foot -> override, road graph, straight
  function routeBetween(fromLoc, toLoc, travelMode) {
    var a = locPoint(fromLoc), b = locPoint(toLoc);
    var straight = (a && b) ? [a, b] : (a ? [a] : (b ? [b] : []));
    if (travelMode === "air") return straight;
    if (travelMode === "rail") return graphRoute(graphs.rail, fromLoc, toLoc) || straight;
    var ov = OVERRIDE[fromLoc + ">" + toLoc], rv = OVERRIDE[toLoc + ">" + fromLoc];
    if (ov) return ov.map(function (p) { return { x: p[0], y: p[1] }; });
    if (rv) return rv.map(function (p) { return { x: p[0], y: p[1] }; }).reverse();
    return graphRoute(graphs.foot, fromLoc, toLoc) || straight;
  }

  // =========================================================================
  //  TIMELINE MODEL  (where is everyone at beat N; what is known)
  // =========================================================================
  function locPoint(id) {
    var l = locById[id];
    return (l && l.map_x != null) ? { x: l.map_x, y: l.map_y } : null;
  }
  function appearanceAt(charId, beat) {         // latest matching interval wins
    var list = appsByChar[charId] || [], match = null;
    for (var i = 0; i < list.length; i++) {
      var a = list[i], hi = (a.leave_sequence == null ? Infinity : a.leave_sequence);
      if (a.join_sequence <= beat.sequence && beat.sequence <= hi) match = a;
    }
    return match;
  }
  function charLocAt(charId, beat) { var a = appearanceAt(charId, beat); return a ? (a.location || beat.default_location) : null; }
  function activityAt(charId, beat) { var a = appearanceAt(charId, beat); return a ? a.activity : null; }
  function travelModeAt(charId, beat) {
    var a = appearanceAt(charId, beat);
    var m = String((a && a.travel_mode) || beat.travel_mode || "").toLowerCase();
    return (m === "rail" || m === "air") ? m : "foot";
  }
  function revealedCodex(charId, seq) {
    return (codexByChar[charId] || [])
      .filter(function (e) { return e.sequence != null && e.sequence <= seq; })
      .sort(function (a, b) { return a.sequence - b.sequence; });
  }
  function lastUpdateSeq(charId, seq) { var r = revealedCodex(charId, seq); return r.length ? r[r.length - 1].sequence : -1; }
  function dateAtSequence(seq) {
    var date = null;
    for (var i = 0; i < beats.length; i++) { if (beats[i].sequence <= seq) date = beats[i].approx_date; else break; }
    return date;
  }
  // A character's state at a point in the timeline (name/alias/icon/body/faction/facts evolve
  // as codex reveals fire). identity -> rename; faction -> header line; icon/body -> art swap.
  function effectiveChar(charId, seq) {
    var c = charById[charId] || { display_name: charId };
    var st = { id: charId, name: c.display_name, alias: null, icon: charAsset(charId, c.icon), body: charAsset(charId, c.body),
               faction: c.faction || null, facts: [] };
    revealedCodex(charId, seq).forEach(function (e) {
      var rn = e.reveal_name || (e.entry_type === "identity" ? e.text : null);
      if (rn) st.name = rn;
      if (e.entry_type === "faction" && e.text) st.faction = e.text;
      if (e.icon) st.icon = charAsset(charId, e.icon);
      if (e.body) st.body = charAsset(charId, e.body);
      var consumed = (e.entry_type === "identity" && !e.reveal_name) || e.entry_type === "faction";
      if (e.text && !consumed) st.facts.push({ type: e.entry_type, text: e.text, date: dateAtSequence(e.sequence) });
    });
    if (st.name !== c.display_name) st.alias = c.display_name;
    return st;
  }
  function isKnown(charId, seq) {
    var apps = appsByChar[charId] || [];
    for (var i = 0; i < apps.length; i++) if (apps[i].join_sequence != null && apps[i].join_sequence <= seq) return true;
    return revealedCodex(charId, seq).length > 0;
  }
  function firstJoinSeq(charId) {
    var s = Infinity; (appsByChar[charId] || []).forEach(function (a) { if (a.join_sequence != null && a.join_sequence < s) s = a.join_sequence; });
    return s;
  }
  function beatAtSeq(seq) { for (var i = 0; i < beats.length; i++) if (beats[i].sequence === seq) return beats[i]; return null; }
  // Nation of first meeting: walk the location's parent chain up to a `nation`.
  var nationCache = {};
  function nationOf(charId) {
    if (charId in nationCache) return nationCache[charId];
    var s = firstJoinSeq(charId), name = "Elsewhere";
    if (s !== Infinity) {
      var b = beatAtSeq(s), loc = b ? charLocAt(charId, b) : null, guard = 0;
      while (loc && locById[loc] && guard++ < 12) {
        if (locById[loc].type === "nation") { name = locById[loc].name; break; }
        loc = locById[loc].parent_loc_id;
      }
    }
    return (nationCache[charId] = name);
  }

  function alongPath(pts, t) {
    if (pts.length === 1) return pts[0];
    var segs = [], total = 0, i;
    for (i = 1; i < pts.length; i++) { var L = Math.hypot(pts[i].x - pts[i - 1].x, (pts[i].y - pts[i - 1].y) * aspect); segs.push(L); total += L; }
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

  // =========================================================================
  //  CAMERA  (vp -> one transform on #world)
  // =========================================================================
  function measure() {
    Fw = el.frame.clientWidth || 1; Fh = el.frame.clientHeight || 1;
    el.world.style.width = Fw + "px";
    el.world.style.height = (Fw * aspect) + "px";
  }
  function visH(w) { return w * (Fh / Fw) / aspect; }        // visible height, in % of image height
  function clampVP(v) {
    v.w = clamp(v.w, MIN_VW, MAX_VW);
    var h = visH(v.w);
    v.x = v.w >= 100 ? (100 - v.w) / 2 : clamp(v.x, 0, 100 - v.w);
    v.y = h >= 100 ? (100 - h) / 2 : clamp(v.y, 0, 100 - h);
    return v;
  }
  function frameToMap(sx, sy) { return { x: vp.x + sx / (Fw * S) * 100, y: vp.y + sy / (Fw * aspect * S) * 100 }; }
  function applyTransform() {
    S = 100 / vp.w;
    var tx = -vp.x / 100 * Fw * S, ty = -vp.y / 100 * (Fw * aspect) * S;
    el.world.style.transform = "translate(" + tx + "px, " + ty + "px) scale(" + S + ")";
    el.world.style.setProperty("--s", S);
    // icons grow a little as you zoom in and shrink a little as you zoom out, clamped
    el.world.style.setProperty("--icon-scale", clamp(Math.pow(S / ZBASE, 0.45), 0.7, 1.6));
    var tier = vp.w > FAR ? "far" : vp.w > NEAR ? "mid" : vp.w > DEEP ? "near" : "deep";
    if (tier !== zoomTier) { zoomTier = tier; el.world.dataset.zoom = tier; layoutPiles(); }
  }
  function project() {
    applyTransform();
    D.characters.forEach(function (c) {
      var mk = markerEls[c.char_id]; if (!mk) return;
      var p = currentPos[c.char_id];
      if (!p) { mk.classList.add("hidden"); return; }
      mk.classList.remove("hidden");
      mk.style.left = p.x + "%"; mk.style.top = p.y + "%";
    });
  }
  // A square-ish viewport snugly containing the points, on any screen shape.
  function fitBox(pts, pad) {
    if (!pts.length) return { x: 0, y: 0, w: 100 };
    pad = pad == null ? VIEW_PAD : pad;
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    pts.forEach(function (p) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); });
    var dx = maxx - minx, dy = maxy - miny;
    var innerH = Math.max(200, Fh - HUD_TOP - HUD_BOTTOM);
    var w = Math.max(dx * (1 + pad), dy * (1 + pad) * aspect * Fw / innerH, 2);
    w = clamp(w, MIN_VW, 100);
    return clampVP({ x: (minx + maxx) / 2 - w / 2, y: (miny + maxy) / 2 - visH(w) * bandCentre(), w: w });
  }
  var theaterBox, storyPts = [];
  function computeStoryBox() {
    var ids = {};
    beats.forEach(function (b) { if (b.default_location) ids[b.default_location] = 1; });
    D.appearances.forEach(function (a) { if (a.location) ids[a.location] = 1; });
    storyPts = Object.keys(ids).map(locPoint).filter(Boolean);
    theaterBox = fitBox(storyPts);
    ZBASE = 100 / theaterBox.w;
  }
  // fraction of the frame height where the centre of the usable band (between the HUD bars) sits
  function bandCentre() { var innerH = Math.max(200, Fh - HUD_TOP - HUD_BOTTOM); return (HUD_TOP + innerH / 2) / Fh; }
  function charBox(p) {
    var w = Math.max(MIN_VW, theaterBox.w * 0.3);
    return clampVP({ x: p.x - w / 2, y: p.y - visH(w) * bandCentre(), w: w });
  }
  function targetViewport() {
    if (mode === "free") return { x: vp.x, y: vp.y, w: vp.w };
    if (mode === "char" && followId && currentTargets[followId]) return charBox(currentTargets[followId]);
    return theaterBox;
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

  // =========================================================================
  //  PLACES  (pips + tiered labels, drawn once in world coordinates)
  // =========================================================================
  function renderPlaces() {
    var h = "";
    D.locations.forEach(function (l) {
      if (l.map_x == null || l.map_y == null) return;
      var t = (l.type || "district").toLowerCase();
      var cls = "place " + t + (l.show_name ? " always" : "");
      var pip = (t === "nation" || t === "region") ? "" : '<i class="pip"></i>';
      h += '<div class="' + cls + '" style="left:' + l.map_x + '%;top:' + l.map_y + '%">' + pip + '<span class="name">' + esc(l.name) + '</span></div>';
    });
    el.places.innerHTML = h;
  }

  // =========================================================================
  //  MARKERS  (portrait cards; co-located characters form a pile that fans out)
  // =========================================================================
  function makeMarker(c) {
    var s = styleFor(c.char_id), m = document.createElement("div");
    m.className = "marker hidden"; m.dataset.char = c.char_id;
    m.innerHTML = '<div class="card"><div class="cardinner" style="--c:' + s.color + '">' +
      '<div class="cardimg"></div><span class="count"></span><span class="cname"></span></div></div>';
    el.markers.appendChild(m);
    return m;
  }
  var currentTargets = {};     // char_id -> {x,y,loc} for this beat
  var pilesByLoc = {};         // loc_id -> [char_id...] (characters on the map this beat)
  // Position every card within its pile: a tight offset stack, or a fanned arc when hovered/tapped.
  function layoutPiles() {
    Object.keys(pilesByLoc).forEach(function (loc) {
      var ids = pilesByLoc[loc], n = ids.length, fanned = fannedLoc === loc;
      ids.forEach(function (id, i) {
        var mk = markerEls[id]; if (!mk) return;
        var inner = mk.querySelector(".cardinner"), dx, dy, rot, k;
        if (fanned && n > 1) {
          if (n <= 6) {                                   // a row of cards above the place; names alternate above/below
            dx = (i - (n - 1) / 2) * 54; dy = -66; rot = (i - (n - 1) / 2) * 3; k = 1.25;
          } else {
            var col = i % 4, row = Math.floor(i / 4);
            dx = (col - 1.5) * 46; dy = -62 - row * 52; rot = 0; k = 1.25;
          }
        } else {
          var j = Math.min(i, 3);
          dx = j * 3; dy = -j * 3; rot = n > 1 ? (j - 1) * 4 : 0; k = 1;
        }
        inner.style.setProperty("--dx", dx + "px"); inner.style.setProperty("--dy", dy + "px");
        inner.style.setProperty("--rot", rot + "deg"); inner.style.setProperty("--k", k);
        mk.style.zIndex = (fanned ? 200 : 20) + i;
        mk.classList.toggle("fanned", fanned && n > 1);
        mk.classList.toggle("top", i === n - 1 && n > 1 && !fanned);
        mk.querySelector(".count").textContent = n;
        mk.classList.toggle("show-name", (fanned && n > 1) || (n === 1 && (zoomTier === "near" || zoomTier === "deep")));
        mk.classList.toggle("name-up", fanned && n > 1 && n <= 6 && i % 2 === 0);
        mk.classList.toggle("focus", id === followId);
      });
    });
  }
  function fanPile(loc) { if (fannedLoc === loc) return; fannedLoc = loc; layoutPiles(); }
  function collapsePiles() { if (fannedLoc == null) return; fannedLoc = null; layoutPiles(); }
  var collapseTimer = null;
  el.markers.addEventListener("mouseover", function (e) {
    var mk = e.target.closest(".marker"); if (!mk || lastPointerType === "touch") return;
    clearTimeout(collapseTimer); fanPile(mk.dataset.loc);
  });
  el.markers.addEventListener("mouseout", function (e) {
    var mk = e.target.closest(".marker"); if (!mk) return;
    var to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".marker");
    if (to && to.dataset.loc === mk.dataset.loc) return;
    clearTimeout(collapseTimer); collapseTimer = setTimeout(collapsePiles, 140);
  });
  el.markers.addEventListener("click", function (e) {
    var mk = e.target.closest(".marker"); if (!mk) return;
    e.stopPropagation();
    var loc = mk.dataset.loc, n = (pilesByLoc[loc] || []).length;
    if (n > 1 && fannedLoc !== loc) { fanPile(loc); return; }   // touch: first tap fans the pile
    openDossier(mk.dataset.char);
  });

  function drawRouteLine(id, ptsMap) {
    var ns = "http://www.w3.org/2000/svg", pl = document.createElementNS(ns, "polyline");
    pl.setAttribute("points", ptsMap.map(function (p) { return p.x + "," + p.y; }).join(" "));
    pl.setAttribute("stroke", styleFor(id).color);
    pl.setAttribute("vector-effect", "non-scaling-stroke");
    el.routes.appendChild(pl);
    return pl;
  }
  function clearRoutes() { while (el.routes.firstChild) el.routes.removeChild(el.routes.firstChild); }

  // =========================================================================
  //  RENDER  (called every time the beat changes)
  // =========================================================================
  function render(animate) {
    var beat = beats[index];
    el.date.textContent = beat.approx_date || "";
    el.beatTitle.textContent = beat.title || "";
    el.chaptag.textContent = (beat.game ? beat.game + " · " : "") + (beat.chapter || "");
    el.counter.innerHTML = "<b>" + (index + 1) + "</b> / " + beats.length;
    el.scrub.value = index;
    el.scrub.style.setProperty("--fill", (index / Math.max(1, beats.length - 1) * 100) + "%");
    el.prev.disabled = index === 0; el.next.disabled = index === beats.length - 1;

    // where should everyone be?
    currentTargets = {}; pilesByLoc = {};
    D.characters.forEach(function (c) {
      var loc = charLocAt(c.char_id, beat); if (!loc) return;
      var p = locPoint(loc); if (!p) { console.warn("No coordinates for location:", loc); return; }
      currentTargets[c.char_id] = { x: p.x, y: p.y, loc: loc };
      (pilesByLoc[loc] = pilesByLoc[loc] || []).push(c.char_id);
    });
    if (fannedLoc && !pilesByLoc[fannedLoc]) fannedLoc = null;

    if (animId) { cancelAnimationFrame(animId); animId = null; }

    var movers = [];
    D.characters.forEach(function (c) {
      var id = c.char_id;
      if (!markerEls[id]) markerEls[id] = makeMarker(c);
      var tgt = currentTargets[id], from = currentPos[id], mk = markerEls[id];
      var st = effectiveChar(id, beat.sequence);                  // name + icon follow reveals
      mk.querySelector(".cname").textContent = st.name;
      var ci = mk.querySelector(".cardimg");
      if (mk.dataset.icon !== (st.icon || "")) {
        mk.dataset.icon = st.icon || "";
        ci.classList.toggle("initials", !st.icon);
        ci.innerHTML = st.icon ? '<img src="' + esc(st.icon) + '" alt="">' : esc(styleFor(id).initials);
      }
      if (!tgt) { delete currentPos[id]; return; }
      if (animate && from && (Math.abs(from.x - tgt.x) > 0.04 || Math.abs(from.y - tgt.y) > 0.04)) {
        var route = routeBetween(mk.dataset.loc || tgt.loc, tgt.loc, travelModeAt(id, beat));
        movers.push({ id: id, route: route, tgt: tgt });
      } else {
        currentPos[id] = { x: tgt.x, y: tgt.y };
      }
      mk.dataset.loc = tgt.loc;
    });
    layoutPiles();

    var startVP = { x: vp.x, y: vp.y, w: vp.w }, endVP = targetViewport();

    if (!animate) {
      clearRoutes();
      vp = endVP; project(); renderCast(beat); renderDrawer();
      return;
    }
    clearRoutes();
    movers.forEach(function (mv) { if (mv.route.length > 1) drawRouteLine(mv.id, mv.route); });
    var t0 = performance.now();
    (function step(now) {
      var t = Math.min(1, (now - t0) / ANIM_MS), e = easeInOut(t);
      vp = { x: lerp(startVP.x, endVP.x, e), y: lerp(startVP.y, endVP.y, e), w: lerp(startVP.w, endVP.w, e) };
      movers.forEach(function (mv) { currentPos[mv.id] = alongPath(mv.route, e); });
      project();
      if (t < 1) animId = requestAnimationFrame(step);
      else { movers.forEach(function (mv) { currentPos[mv.id] = { x: mv.tgt.x, y: mv.tgt.y }; }); vp = endVP; project(); animId = null; }
    })(t0);
    renderCast(beat); renderDrawer();
  }

  // --- cast strip ----------------------------------------------------------
  function renderCast(beat) {
    var rows = [];
    D.characters.forEach(function (c) {
      var loc = charLocAt(c.char_id, beat); if (!loc) return;
      var s = styleFor(c.char_id), st = effectiveChar(c.char_id, beat.sequence);
      var place = (locById[loc] && locById[loc].name) || loc;
      var act = activityAt(c.char_id, beat);
      var tip = (act ? act + ". " : "") + "Click to follow " + st.name + " on the map";
      rows.push('<button class="cast-chip' + (c.char_id === followId ? " is-following" : "") + '" data-char="' + c.char_id + '" title="' + esc(tip) + '" style="--c:' + s.color + '">' +
        '<span class="cast-ava">' + (st.icon ? '<img src="' + esc(st.icon) + '" alt="">' : esc(s.initials)) + '</span>' +
        '<span class="cast-chip-txt"><span class="cast-name">' + esc(st.name) + '</span><span class="cast-act">' + esc(place) + '</span></span></button>');
    });
    el.cast.innerHTML = rows.length ? rows.join("") : '<div class="cast-empty">No one on the map yet.</div>';
  }
  el.cast.addEventListener("click", function (e) {
    var chip = e.target.closest(".cast-chip"); if (!chip) return;
    if (followId === chip.dataset.char) { followId = null; mode = "theater"; animateVP(theaterBox); renderCast(beats[index]); layoutPiles(); }
    else focusCharacter(chip.dataset.char);
  });
  function focusCharacter(id) {
    if (!currentPos[id]) return;
    setPlaying(false);
    followId = id; mode = "char";
    animateVP(charBox(currentPos[id]));
    renderCast(beats[index]); layoutPiles();
  }

  // =========================================================================
  //  CODEX DRAWER  (index: nation -> faction -> tiles; dossier per character)
  // =========================================================================
  var drawerOpen = false, drawerView = "index", dossierId = null, filterUpdated = false;
  var SILHOUETTE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6Z"/></svg>';

  function avatar(charId, st, cls) {
    var s = styleFor(charId);
    return '<span class="' + cls + '" style="--c:' + s.color + '">' + (st.icon ? '<img src="' + esc(st.icon) + '" alt="">' : esc(s.initials)) + '</span>';
  }
  function renderIndex() {
    var seq = beats[index].sequence;
    var q = (el.codexSearch.value || "").trim().toLowerCase();
    var rows = D.characters.filter(function (c) { return isKnown(c.char_id, seq); }).map(function (c) {
      return { c: c, st: effectiveChar(c.char_id, seq), u: lastUpdateSeq(c.char_id, seq), first: firstJoinSeq(c.char_id), nation: nationOf(c.char_id) };
    });
    if (q) rows = rows.filter(function (r) {
      return (r.st.name && r.st.name.toLowerCase().indexOf(q) !== -1) || (r.st.alias && r.st.alias.toLowerCase().indexOf(q) !== -1)
          || r.c.char_id.indexOf(q) !== -1 || (r.st.faction && r.st.faction.toLowerCase().indexOf(q) !== -1);
    });
    if (filterUpdated) rows = rows.filter(function (r) { return r.u === seq; });
    if (!rows.length) {
      el.drawerBody.innerHTML = '<div class="cx-empty">' + (q || filterUpdated ? "No characters match." : "No characters known yet.<br>Advance the timeline to meet the cast.") + '</div>';
      return;
    }
    // stable order: nation (first met), faction, then order met
    var nations = [], byNation = {};
    rows.forEach(function (r) {
      if (!byNation[r.nation]) { byNation[r.nation] = { order: r.first, factions: {}, fOrder: [] }; nations.push(r.nation); }
      var N = byNation[r.nation], f = r.st.faction || "Unaffiliated";
      if (!N.factions[f]) { N.factions[f] = []; N.fOrder.push(f); }
      N.factions[f].push(r);
      N.order = Math.min(N.order, r.first);
    });
    nations.sort(function (a, b) { return byNation[a].order - byNation[b].order; });
    var h = "";
    nations.forEach(function (nname) {
      var N = byNation[nname];
      if (nations.length > 1) h += '<h3 class="cx-nation">' + esc(nname) + '</h3>';
      N.fOrder.forEach(function (f) {
        var list = N.factions[f].slice().sort(function (a, b) { return a.first - b.first; });
        h += '<div class="cx-faction">' + esc(f) + '</div><div class="cx-grid">';
        list.forEach(function (r) {
          h += '<button class="cx-tile" data-char="' + r.c.char_id + '" title="' + esc(r.st.name) + '">' +
               (r.u === seq ? '<span class="upd" title="Updated on this beat"></span>' : '') +
               avatar(r.c.char_id, r.st, "ava") + '<span class="nm">' + esc(r.st.name) + '</span></button>';
        });
        h += '</div>';
      });
    });
    el.drawerBody.innerHTML = h;
  }
  function renderDossier() {
    var seq = beats[index].sequence, st = effectiveChar(dossierId, seq), beat = beats[index];
    if (!isKnown(dossierId, seq)) { drawerView = "index"; renderDrawer(); return; }   // scrubbed back before they were met
    var loc = charLocAt(dossierId, beat), place = loc ? ((locById[loc] && locById[loc].name) || loc) : null;
    var portrait = st.body ? '<img src="' + esc(st.body) + '" alt="">' : '<div class="dossier-ph">' + SILHOUETTE + '<span>Full portrait coming soon</span></div>';
    var facts;
    if (st.facts.length) {
      var order = [], byType = {};
      st.facts.forEach(function (f) { var t = f.type || "note"; if (!byType[t]) { byType[t] = []; order.push(t); } byType[t].push(f); });
      facts = '<div class="codex-facts">' + order.map(function (t) {
        return '<div class="codex-section"><span class="codex-fact-type">' + esc(String(t).replace(/[_-]+/g, " ")) + '</span>' +
          byType[t].map(function (f) {
            var d = (String(t).toLowerCase() === "bio" && f.date) ? '<span class="codex-fact-date">' + esc(f.date) + '</span>' : '';
            return '<p>' + d + esc(f.text) + '</p>';
          }).join("") + '</div>';
      }).join("") + '</div>';
    } else facts = '<p class="codex-nofacts">No notes recorded yet.</p>';
    el.drawerBody.innerHTML =
      '<div class="dossier"><div class="dossier-top">' +
        '<div class="dossier-portrait">' + portrait + '</div>' +
        '<div class="dossier-info">' +
          '<h3 class="dossier-name">' + esc(st.name) + '</h3>' +
          (st.faction ? '<p class="dossier-faction">' + esc(st.faction) + '</p>' : '') +
          (st.alias ? '<p class="dossier-alias">Formerly known as ' + esc(st.alias) + '</p>' : '') +
          (place ? '<p class="dossier-where">Currently at <b>' + esc(place) + '</b>' + (activityAt(dossierId, beat) ? ' · ' + esc(activityAt(dossierId, beat)) : '') + '</p>'
                 : '<p class="dossier-where">Not on the map right now</p>') +
          (place ? '<div class="dossier-actions"><button class="hbtn" id="followBtn">' + (followId === dossierId ? "Stop following" : "Follow on map") + '</button></div>' : '') +
        '</div></div>' + facts + '</div>';
    var fb = $("followBtn");
    if (fb) fb.addEventListener("click", function () {
      if (followId === dossierId) { followId = null; mode = "theater"; animateVP(theaterBox); renderCast(beats[index]); layoutPiles(); }
      else focusCharacter(dossierId);
      renderDossier();
    });
  }
  function renderDrawer() {
    if (!drawerOpen) return;
    var dossier = drawerView === "dossier" && dossierId;
    el.drawerBack.hidden = !dossier;
    el.drawerTools.style.display = dossier ? "none" : "";
    el.drawerTitle.textContent = dossier ? "" : "Codex";
    if (dossier) renderDossier(); else renderIndex();
  }
  function openDrawer() { drawerOpen = true; el.drawer.classList.add("open"); el.drawer.setAttribute("aria-hidden", "false"); renderDrawer(); }
  function closeDrawer() { drawerOpen = false; el.drawer.classList.remove("open"); el.drawer.setAttribute("aria-hidden", "true"); }
  function openDossier(id) { dossierId = id; drawerView = "dossier"; openDrawer(); }
  el.openCodex.addEventListener("click", function () { if (drawerOpen && drawerView === "index") closeDrawer(); else { drawerView = "index"; openDrawer(); } });
  el.drawerClose.addEventListener("click", closeDrawer);
  el.drawerBack.addEventListener("click", function () { drawerView = "index"; renderDrawer(); });
  el.drawerBody.addEventListener("click", function (e) {
    var tile = e.target.closest(".cx-tile"); if (!tile) return;
    dossierId = tile.dataset.char; drawerView = "dossier"; renderDrawer();
  });
  el.codexSearch.addEventListener("input", renderDrawer);
  el.filterUpdated.addEventListener("click", function () { filterUpdated = !filterUpdated; this.classList.toggle("on", filterUpdated); renderDrawer(); });

  // =========================================================================
  //  NAVIGATION + INPUT
  // =========================================================================
  function go(i, animate) { i = clamp(i, 0, beats.length - 1); if (i === index && animate) return; index = i; render(animate); }
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
  el.home.addEventListener("click", function () { mode = "theater"; followId = null; animateVP(theaterBox); renderCast(beats[index]); layoutPiles(); });

  function enterFreeMode() {
    mode = "free"; setPlaying(false);
    if (followId) { followId = null; renderCast(beats[index]); layoutPiles(); }
  }
  // wheel: zoom toward the cursor
  el.frame.addEventListener("wheel", function (e) {
    e.preventDefault();
    enterFreeMode();
    var r = el.frame.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    var m = frameToMap(sx, sy);
    var factor = Math.exp(-e.deltaY * 0.0015);
    vp.w = clamp(vp.w / factor, MIN_VW, MAX_VW);
    var S2 = 100 / vp.w;
    vp.x = m.x - sx / (Fw * S2) * 100; vp.y = m.y - sy / (Fw * aspect * S2) * 100;
    clampVP(vp); project();
  }, { passive: false });
  // drag to pan, pinch to zoom (pointer events)
  var pointers = {}, dragStart = null, pinchStart = null;
  el.frame.addEventListener("pointerdown", function (e) {
    lastPointerType = e.pointerType || "mouse";
    if (e.target.closest(".card")) return;             // cards handle their own clicks
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    el.frame.setPointerCapture(e.pointerId);
    var ids = Object.keys(pointers);
    if (ids.length === 1) { dragStart = { x: e.clientX, y: e.clientY, vpx: vp.x, vpy: vp.y, moved: false }; pinchStart = null; }
    else if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), w: vp.w, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vpx: vp.x, vpy: vp.y };
      dragStart = null;
    }
  });
  el.frame.addEventListener("pointermove", function (e) {
    if (!pointers[e.pointerId]) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pointers);
    if (pinchStart && ids.length >= 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      enterFreeMode();
      var r = el.frame.getBoundingClientRect(), cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      var anchor = { x: pinchStart.vpx + (pinchStart.cx - r.left) / (Fw * (100 / pinchStart.w)) * 100,
                     y: pinchStart.vpy + (pinchStart.cy - r.top) / (Fw * aspect * (100 / pinchStart.w)) * 100 };
      vp.w = clamp(pinchStart.w * pinchStart.d / d, MIN_VW, MAX_VW);
      var S2 = 100 / vp.w;
      vp.x = anchor.x - cx / (Fw * S2) * 100; vp.y = anchor.y - cy / (Fw * aspect * S2) * 100;
      clampVP(vp); project();
    } else if (dragStart) {
      var dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (!dragStart.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!dragStart.moved) { dragStart.moved = true; el.frame.classList.add("dragging"); enterFreeMode(); }
      vp.x = dragStart.vpx - dx / (Fw * S) * 100; vp.y = dragStart.vpy - dy / (Fw * aspect * S) * 100;
      clampVP(vp); project();
    }
  });
  function endPointer(e) {
    if (pointers[e.pointerId]) delete pointers[e.pointerId];
    if (dragStart && !dragStart.moved && !e.target.closest(".card")) collapsePiles();   // tap on empty map
    if (!Object.keys(pointers).length) { dragStart = null; pinchStart = null; el.frame.classList.remove("dragging"); }
  }
  el.frame.addEventListener("pointerup", endPointer);
  el.frame.addEventListener("pointercancel", endPointer);

  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" && e.target.type !== "range") return;
    if (e.key === "ArrowRight") { setPlaying(false); go(index + 1, true); }
    else if (e.key === "ArrowLeft") { setPlaying(false); go(index - 1, true); }
    else if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === "Escape") { if (drawerOpen) closeDrawer(); else collapsePiles(); }
    else if (e.key === "c" || e.key === "C") { el.openCodex.click(); }
    else if (e.key === "h" || e.key === "H") { el.home.click(); }
  });
  window.addEventListener("resize", function () { measure(); computeStoryBox(); if (mode === "theater") vp = theaterBox; clampVP(vp); project(); });

  // --- init ----------------------------------------------------------------
  function init() {
    aspect = (el.img.naturalHeight || 9) / (el.img.naturalWidth || 16);
    measure();
    buildGraph();
    renderPlaces();
    computeStoryBox();
    el.scrub.max = beats.length - 1;
    vp = theaterBox;
    render(false);
  }
  if (el.img.complete && el.img.naturalWidth) init(); else el.img.addEventListener("load", init);
})();
