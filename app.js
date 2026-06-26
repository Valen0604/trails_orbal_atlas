/* ============================================================
   Trails Timeline — app logic
   Reads window.TRAILS (data.js) and window.ROUTES (routes.js).
   ============================================================ */
(function () {
  "use strict";
  var D = window.TRAILS, ROUTES = window.ROUTES || {};

  // --- presentation config (edit freely; not part of the data) -------------
  // If a character has an `icon` filename in data.js it is used; otherwise this
  // colored initials badge is drawn.
  var STYLE = {
    estelle: { color: "#e8623d", initials: "Es" },
    joshua:  { color: "#3f5d8a", initials: "Jo" },
    schera:  { color: "#c0436a", initials: "Sc" },
    cassius: { color: "#5f6b78", initials: "Ca" },
    josette: { color: "#d98a2b", initials: "Js" },
    alba:    { color: "#7a5ea8", initials: "Al" }
  };
  function styleFor(id) { return STYLE[id] || { color: "#888", initials: (id || "?").slice(0, 2) }; }
  var ANIM_MS = 850;

  // --- indexes -------------------------------------------------------------
  var locById = {}; D.locations.forEach(function (l) { locById[l.loc_id] = l; });
  var charById = {}; D.characters.forEach(function (c) { charById[c.char_id] = c; });
  var beats = D.beats.slice().sort(function (a, b) { return a.sequence - b.sequence; });
  var appsByChar = {};
  D.appearances.forEach(function (a) { (appsByChar[a.char_id] = appsByChar[a.char_id] || []).push(a); });

  // --- DOM -----------------------------------------------------------------
  var el = {
    date: document.getElementById("date"),
    beatTitle: document.getElementById("beatTitle"),
    chaptag: document.getElementById("chaptag"),
    counter: document.getElementById("counter"),
    scrub: document.getElementById("scrub"),
    prev: document.getElementById("prev"),
    next: document.getElementById("next"),
    play: document.getElementById("play"),
    start: document.getElementById("start"),
    routes: document.getElementById("routes"),
    markers: document.getElementById("markers"),
    pips: document.getElementById("pips"),
    cast: document.getElementById("cast"),
    trails: document.getElementById("trailsToggle"),
    codex: document.getElementById("codexGrid"),
    tabMap: document.getElementById("tabMap"),
    tabCodex: document.getElementById("tabCodex"),
    viewMap: document.getElementById("viewMap"),
    viewCodex: document.getElementById("viewCodex")
  };

  // --- state ---------------------------------------------------------------
  var index = 0;            // position in `beats`
  var playing = false, playTimer = null;
  var showTrails = false;
  var markerEls = {};       // char_id -> element
  var currentPos = {};      // char_id -> {x,y} on-screen % (incl. group offset)
  var animId = null;

  // --- geometry helpers ----------------------------------------------------
  function locPoint(id) {
    var l = locById[id];
    if (!l || l.map_x == null || l.map_y == null) return null;
    return { x: l.map_x, y: l.map_y };
  }
  // Resolve which loc a character is at for a given beat (null = not present).
  function charLocAt(charId, beat) {
    var list = appsByChar[charId] || [], match = null;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var lo = a.join_sequence, hi = (a.leave_sequence == null ? Infinity : a.leave_sequence);
      if (lo <= beat.sequence && beat.sequence <= hi) match = a; // later rows win
    }
    if (!match) return null;
    return match.location || beat.default_location;
  }
  function activityAt(charId, beat) {
    var list = appsByChar[charId] || [], match = null;
    for (var i = 0; i < list.length; i++) {
      var a = list[i], hi = (a.leave_sequence == null ? Infinity : a.leave_sequence);
      if (a.join_sequence <= beat.sequence && beat.sequence <= hi) match = a;
    }
    return match ? match.activity : null;
  }
  // Route polyline (array of {x,y}) between two loc ids.
  function routeBetween(fromId, toId) {
    var fwd = ROUTES[fromId + ">" + toId], rev = ROUTES[toId + ">" + fromId], pts;
    if (fwd) pts = fwd.map(function (p) { return { x: p[0], y: p[1] }; });
    else if (rev) pts = rev.map(function (p) { return { x: p[0], y: p[1] }; }).reverse();
    else {
      var a = locPoint(fromId), b = locPoint(toId);
      pts = (a && b) ? [a, b] : (a ? [a] : (b ? [b] : []));
    }
    return pts;
  }
  // Point at parameter t (0..1) along a polyline, by cumulative length.
  function alongPath(pts, t) {
    if (pts.length === 1) return pts[0];
    var segs = [], total = 0;
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      var len = Math.hypot(dx, dy); segs.push(len); total += len;
    }
    if (total === 0) return pts[0];
    var d = t * total, acc = 0;
    for (var j = 0; j < segs.length; j++) {
      if (acc + segs[j] >= d) {
        var lt = (d - acc) / (segs[j] || 1);
        return { x: pts[j].x + (pts[j + 1].x - pts[j].x) * lt, y: pts[j].y + (pts[j + 1].y - pts[j].y) * lt };
      }
      acc += segs[j];
    }
    return pts[pts.length - 1];
  }
  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  // Spread characters sharing a location so badges don't overlap.
  function groupOffsets(beat) {
    var byLoc = {}, out = {};
    D.characters.forEach(function (c) {
      var loc = charLocAt(c.char_id, beat);
      if (loc) (byLoc[loc] = byLoc[loc] || []).push(c.char_id);
    });
    Object.keys(byLoc).forEach(function (loc) {
      var ids = byLoc[loc], n = ids.length;
      ids.forEach(function (id, i) {
        if (n === 1) { out[id] = { dx: 0, dy: -1.0 }; return; }
        var ang = (i / n) * Math.PI * 2 - Math.PI / 2, r = 1.6;
        out[id] = { dx: Math.cos(ang) * r, dy: Math.sin(ang) * r };
      });
    });
    return out;
  }

  // --- marker elements -----------------------------------------------------
  function makeMarker(c) {
    var s = styleFor(c.char_id);
    var m = document.createElement("div");
    m.className = "marker hidden";
    var badge = '<div class="badge" style="background:' + s.color + '">' +
      (c.icon ? '<img src="' + c.icon + '" alt="">' : s.initials) + '</div>';
    m.innerHTML = badge + '<div class="nametag">' + c.display_name + '</div>';
    el.markers.appendChild(m);
    return m;
  }
  function placeMarker(id, x, y) {
    var m = markerEls[id];
    m.style.left = x + "%"; m.style.top = y + "%";
  }

  // --- route line drawing --------------------------------------------------
  function drawRouteLine(id, pts) {
    var s = styleFor(id);
    var ns = "http://www.w3.org/2000/svg";
    var pl = document.createElementNS(ns, "polyline");
    pl.setAttribute("points", pts.map(function (p) { return p.x + "," + p.y; }).join(" "));
    pl.setAttribute("fill", "none");
    pl.setAttribute("stroke", s.color);
    pl.setAttribute("stroke-width", "0.5");
    pl.setAttribute("stroke-linejoin", "round");
    pl.setAttribute("stroke-linecap", "round");
    pl.setAttribute("opacity", "0.9");
    pl.setAttribute("stroke-dasharray", "1.4 1.2");
    pl.setAttribute("vector-effect", "non-scaling-stroke");
    pl.style.strokeWidth = "2px";
    el.routes.appendChild(pl);
    return pl;
  }
  function fadeAndRemove(node) {
    if (!node) return;
    if (showTrails) { node.setAttribute("opacity", "0.25"); node.removeAttribute("stroke-dasharray"); return; }
    var op = 0.9, iv = setInterval(function () {
      op -= 0.08; node.setAttribute("opacity", String(Math.max(0, op)));
      if (op <= 0) { clearInterval(iv); node.remove(); }
    }, 40);
  }
  function clearRoutes() { while (el.routes.firstChild) el.routes.removeChild(el.routes.firstChild); }

  // --- the main render -----------------------------------------------------
  function render(animate) {
    var beat = beats[index];
    // header
    el.date.textContent = beat.approx_date || "";
    el.beatTitle.textContent = beat.title || "";
    el.chaptag.textContent = beat.chapter + "  ·  seq " + beat.sequence;
    el.counter.innerHTML = "<b>" + (index + 1) + "</b> / " + beats.length;
    el.scrub.value = index;
    el.scrub.style.setProperty("--fill", (index / (beats.length - 1) * 100) + "%");
    el.prev.disabled = index === 0;
    el.next.disabled = index === beats.length - 1;

    var offsets = groupOffsets(beat);
    var targets = {}, active = {};
    D.characters.forEach(function (c) {
      var loc = charLocAt(c.char_id, beat);
      if (!loc) return;
      var p = locPoint(loc);
      if (!p) { console.warn("No coordinates for location:", loc); return; }
      var o = offsets[c.char_id] || { dx: 0, dy: -1 };
      targets[c.char_id] = { x: p.x + o.dx, y: p.y + o.dy, loc: loc };
      active[c.char_id] = true;
    });

    if (animId) { cancelAnimationFrame(animId); animId = null; }

    // figure out who moves
    var movers = [];
    D.characters.forEach(function (c) {
      var id = c.char_id;
      if (!markerEls[id]) markerEls[id] = makeMarker(c);
      var m = markerEls[id];
      if (!active[id]) {                       // leaving / absent
        m.classList.add("hidden");
        delete currentPos[id];
        return;
      }
      m.classList.remove("hidden");
      var tgt = targets[id], from = currentPos[id];
      if (animate && from && (Math.abs(from.x - tgt.x) > 0.05 || Math.abs(from.y - tgt.y) > 0.05)) {
        // route between previous loc center and new loc center
        var prevLoc = m.dataset.loc, route = routeBetween(prevLoc || tgt.loc, tgt.loc);
        var rs = route[0], re = route[route.length - 1];
        movers.push({
          id: id, tgt: tgt, route: route,
          prevOff: { x: from.x - rs.x, y: from.y - rs.y },
          tgtOff:  { x: tgt.x - re.x, y: tgt.y - re.y }
        });
      } else {
        placeMarker(id, tgt.x, tgt.y);        // snap
        currentPos[id] = { x: tgt.x, y: tgt.y };
      }
      m.dataset.loc = tgt.loc;
    });

    if (movers.length) {
      var lines = movers.map(function (mv) { return mv.route.length > 1 ? drawRouteLine(mv.id, mv.route) : null; });
      var t0 = performance.now();
      (function step(now) {
        var t = Math.min(1, (now - t0) / ANIM_MS), e = easeInOut(t);
        movers.forEach(function (mv) {
          var c = alongPath(mv.route, e);
          var px = c.x + mv.prevOff.x + (mv.tgtOff.x - mv.prevOff.x) * e;
          var py = c.y + mv.prevOff.y + (mv.tgtOff.y - mv.prevOff.y) * e;
          placeMarker(mv.id, px, py);
          currentPos[mv.id] = { x: px, y: py };
        });
        if (t < 1) { animId = requestAnimationFrame(step); }
        else {
          movers.forEach(function (mv) { placeMarker(mv.id, mv.tgt.x, mv.tgt.y); currentPos[mv.id] = { x: mv.tgt.x, y: mv.tgt.y }; });
          lines.forEach(fadeAndRemove);
          animId = null;
        }
      })(t0);
    }

    renderCast(beat);
    if (el.viewCodex.classList.contains("active")) renderCodex();
  }

  // --- cast panel ----------------------------------------------------------
  function renderCast(beat) {
    var rows = [];
    D.characters.forEach(function (c) {
      var loc = charLocAt(c.char_id, beat); if (!loc) return;
      var s = styleFor(c.char_id), act = activityAt(c.char_id, beat);
      var place = (locById[loc] && locById[loc].name) || loc;
      rows.push('<div class="cast-row"><div class="cdot" style="background:' + s.color + '"></div>' +
        '<div><div class="cast-name">' + c.display_name + '</div>' +
        '<div class="cast-act">' + (act ? act + " · " : "") + place + '</div></div></div>');
    });
    el.cast.innerHTML = rows.length ? rows.join("") : '<div class="cast-empty">No one on the map yet.</div>';
  }

  // --- codex (spoiler gated by current sequence) ---------------------------
  function renderCodex() {
    var seq = beats[index].sequence;
    var shown = D.codex.filter(function (e) { return e.sequence != null && e.sequence <= seq; })
      .sort(function (a, b) { return a.sequence - b.sequence; });
    if (!shown.length) {
      el.codex.innerHTML = '<div class="codex-empty">No codex entries revealed yet.<br>Advance the timeline to uncover them.</div>';
      return;
    }
    el.codex.innerHTML = shown.map(function (e) {
      var c = charById[e.char_id], name = c ? c.display_name : e.char_id;
      return '<div class="codex-card"><div class="codex-head">' +
        '<span class="codex-name">' + name + '</span>' +
        '<span class="codex-type">' + (e.entry_type || "") + '</span></div>' +
        '<div class="codex-text">' + e.text + '</div>' +
        '<div class="codex-meta">revealed @ seq ' + e.sequence + '</div></div>';
    }).join("");
  }

  // --- location pips (static orientation dots) -----------------------------
  function renderPips() {
    D.locations.forEach(function (l) {
      if (l.map_x == null || l.map_y == null) return;
      var d = document.createElement("div");
      d.className = "loc-pip"; d.dataset.name = l.name;
      d.style.left = l.map_x + "%"; d.style.top = l.map_y + "%";
      el.pips.appendChild(d);
    });
  }

  // --- navigation ----------------------------------------------------------
  function go(i, animate) {
    i = Math.max(0, Math.min(beats.length - 1, i));
    if (i === index && animate) return;
    index = i; render(animate);
  }
  function setPlaying(on) {
    playing = on;
    el.play.textContent = on ? "❚❚" : "▶";
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    if (on) {
      playTimer = setInterval(function () {
        if (index >= beats.length - 1) { setPlaying(false); return; }
        go(index + 1, true);
      }, ANIM_MS + 650);
    }
  }

  // --- wire up -------------------------------------------------------------
  el.prev.addEventListener("click", function () { setPlaying(false); go(index - 1, true); });
  el.next.addEventListener("click", function () { setPlaying(false); go(index + 1, true); });
  el.start.addEventListener("click", function () { setPlaying(false); go(0, false); });
  el.play.addEventListener("click", function () { setPlaying(!playing); });
  el.scrub.addEventListener("input", function () { setPlaying(false); go(parseInt(this.value, 10), false); });
  el.trails.addEventListener("change", function () { showTrails = this.checked; if (!showTrails) clearRoutes(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") { setPlaying(false); go(index + 1, true); }
    else if (e.key === "ArrowLeft") { setPlaying(false); go(index - 1, true); }
    else if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
  });

  function showTab(which) {
    var map = which === "map";
    el.tabMap.classList.toggle("active", map);
    el.tabCodex.classList.toggle("active", !map);
    el.viewMap.classList.toggle("active", map);
    el.viewCodex.classList.toggle("active", !map);
    if (!map) renderCodex();
  }
  el.tabMap.addEventListener("click", function () { showTab("map"); });
  el.tabCodex.addEventListener("click", function () { showTab("codex"); });

  // --- init ----------------------------------------------------------------
  el.scrub.max = beats.length - 1;
  renderPips();
  render(false);
})();
