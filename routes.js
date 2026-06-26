// ROUTE PATHS — hand-drawn polylines so characters follow roads/terrain instead of
// teleporting in a straight line.
//
// HOW TO ADD A ROUTE
// 1. Open map-coordinate-finder.html, load zemuria.png.
// 2. Click each point ALONG the road from the start location to the end location.
//    Work in order, start -> end. Copy the x / y % after each click.
// 3. Add an entry below keyed "fromLocId>toLocId", value = array of [x, y] pairs.
//    Include the start and end points so the line is self-contained.
//
// Lookup order in the app: "from>to", then the reverse of "to>from", then a straight
// line between the two location coordinates. So you only need to draw each pair once;
// the reverse direction is auto-handled.
//
// loc ids come from data.js (locations sheet): rolent_city, bose_city, esmelas,
// bright_house, perzel, malga, mistwald, ...

window.ROUTES = {
  // The Chapter-1 journey — the long one, worth tracing. The actual transition in
  // the data is bright_house (beat 38) -> bose_city (beat 50), so the route is keyed
  // that way. It goes home -> Rolent, then follows the yellow road along the north
  // shore of the lake west to Bose.
  "bright_house>bose_city": [
    [31.3, 69.9], [31.3, 68.9], [30.5, 67.6], [29.0, 66.3], [27.6, 66.2], [26.3, 66.6]
  ],

  // Short demo routes with a single bend, to show the pattern.
  "rolent_city>esmelas": [
    [31.3, 68.9], [30.85, 68.1], [30.5, 67.7]
  ],
  "rolent_city>malga": [
    [31.3, 68.9], [31.25, 67.3], [31.1, 65.8]
  ],
  "rolent_city>mistwald": [
    [31.3, 68.9], [31.25, 69.8], [31.2, 70.6]
  ]

  // Everything not listed here falls back to a straight line automatically.
  // Add more as you trace them, e.g.:
  // "bright_house>perzel": [[31.3,69.9],[30.7,69.4],[30.1,69.2]],
};
