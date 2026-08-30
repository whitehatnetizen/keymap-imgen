/* vilimg.js: the renderer. Turns a keymap plus a board's key positions into the layout
   pages, as self-contained HTML documents, one per sheet.

   One copy of the drawing code serves both the web page (index.html, through page.js) and
   the command line (keymap-imgen.py runs this file in Playwright, see vilimg/browser.py). It
   touches no DOM: everything in here is strings and numbers, so it runs the same in a
   browser tab, in a headless browser and under Node.

   Sections: keymap, geometry, tables, legends, layers, render, fonts, definitions, keycodes.
   The legend tables sit between the TABLES markers. US ANSI labels; a keycode the tables
   do not know prints as the raw code, which is the signal to add it. */
(function (root) {
"use strict";

var vilimg = {};

function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function get(o, k, dflt) { return has(o, k) ? o[k] : dflt; }
function chars(s) { return Array.from(s).length; }   // length in characters, not UTF-16 units
function isDigits(s) { return /^\d+$/.test(s); }

/* ---- keymap: a Vial .vil or a QMK keymap.json as plain data --------------------------------

   {name, stem, kind ("vil" | "qmk"), uid (decimal string or null), layers ([layer][row][col]
   -> keycode or -1), layer_names ({"1": "Nav"}), keyboard, layout_name, positional
   ([layer][i] keycodes in LAYOUT order, qmk only), extra, warnings}.

   The command line has its own reader (vilimg/vil.py); this one is for
   the page. They are the one intended duplicate: keep them in step. */

// "_______" and "XXXXXXX" are QMK's keymap.json spellings of KC_TRNS and KC_NO
var EMPTY_CODES = {"KC_NO": 1, "KC_TRNS": 1, "KC_TRANSPARENT": 1, "_______": 1, "XXXXXXX": 1};

function isEmptyCode(code) { return code === -1 || (typeof code === "string" && has(EMPTY_CODES, code)); }

function isKeymapJson(data) {
  return !!data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.layers) && ("keyboard" in data);
}

function stemOf(name) {
  var i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/* The keyboard id in a .vil is a 64-bit number, which JSON.parse rounds; read it from the
   text so it matches the board files digit for digit. */
function uidOf(text, data) {
  var m = /"uid"\s*:\s*(-?\d+)/.exec(text);
  if (m) return m[1];
  return data.uid == null ? null : String(data.uid);
}

function parseKeymap(text, name) {
  name = name || "keymap";
  var data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(name + ": not valid JSON (" + e.message + ")");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(name + ": expected a JSON object");
  var layout = data.layout;
  if (Array.isArray(layout) && layout.length && Array.isArray(layout[0])) {
    var first = layout[0];
    if (!first.length || !first.every(Array.isArray) || !first.some(function (r) { return r.length; })) {
      throw new Error(name + ": layer 0 has no keys; nothing to draw");
    }
    var extra = {};
    Object.keys(data).forEach(function (k) { if (k !== "layout") extra[k] = data[k]; });
    return {name: name, stem: stemOf(name), kind: "vil", uid: uidOf(text, data), layers: layout,
            layer_names: {}, keyboard: null, layout_name: null, positional: null, extra: extra, warnings: [],
            vial_protocol: typeof data.vial_protocol === "number" ? data.vial_protocol : null,
            tap_dance: Array.isArray(data.tap_dance) ? data.tap_dance : []};
  }
  if (isKeymapJson(data)) {
    var layers = data.layers;
    if (!layers.length) throw new Error(name + ": 'layers' is empty; nothing to draw");
    if (!layers.every(Array.isArray)) throw new Error(name + ": 'layers' must be lists of keycodes");
    var extra2 = {};
    Object.keys(data).forEach(function (k) { if (k !== "layers") extra2[k] = data[k]; });
    var names = {};
    (data.layer_names || []).forEach(function (nm, i) { if (nm) names[String(i)] = String(nm); });
    return {name: name, stem: stemOf(name), kind: "qmk", uid: null, layers: [], layer_names: names,
            keyboard: data.keyboard == null ? null : String(data.keyboard),
            layout_name: typeof data.layout === "string" ? data.layout : null,
            positional: layers, extra: extra2, warnings: [], vial_protocol: null, tap_dance: []};
  }
  throw new Error(name + ": neither a Vial .vil ('layout' list of layers) nor a QMK keymap.json ('keyboard' and 'layers')");
}

function keymapRows(km) { return km.layers.length ? km.layers[0].length : 0; }
function keymapCols(km) { return km.layers.length && km.layers[0].length ? km.layers[0][0].length : 0; }
function keymapShape(km) { return [keymapRows(km), keymapCols(km)]; }
function layerCount(km) { return km.layers.length ? km.layers.length : (km.positional || []).length; }

/* Keys assigned on each layer (codes other than KC_NO, KC_TRNS and -1), by layer index. */
function layerKeyCounts(km) {
  var src = km.layers.length ? km.layers : (km.positional || []).map(function (l) { return [l]; });
  return src.map(function (layer) {
    var n = 0;
    layer.forEach(function (row) { row.forEach(function (code) { if (!isEmptyCode(code)) n++; }); });
    return n;
  });
}

/* Matrix positions that hold a physical key, from layer 0, as [row, col] pairs. */
function positions(km) {
  var out = [];
  if (!km.layers.length) return out;
  km.layers[0].forEach(function (row, r) {
    row.forEach(function (code, c) { if (code !== -1) out.push([r, c]); });
  });
  return out;
}

function posKey(r, c) { return r + "," + c; }

function positionSet(km) {
  var s = {};
  positions(km).forEach(function (p) { s[posKey(p[0], p[1])] = 1; });
  return s;
}

function keycodeAt(km, layer, r, c) {
  var l = km.layers[layer];
  if (!l || !l[r] || c >= l[r].length) return -1;
  return l[r][c];
}

/* Layer indexes that assign at least one key. */
function nonemptyLayers(km) {
  var src = km.layers.length ? km.layers : (km.positional || []).map(function (l) { return [l]; });
  var out = [];
  src.forEach(function (layer, i) {
    var any = layer.some(function (row) { return row.some(function (code) { return !isEmptyCode(code); }); });
    if (any) out.push(i);
  });
  return out;
}

/* Build matrix arrays for a positional (qmk) keymap from a board's key order. */
function resolvePositional(km, board) {
  if (!km.positional) return;
  board = normBoard(board);
  var n = board.keys.length;
  var rows = 0, cols = 0;
  board.keys.forEach(function (k) { rows = Math.max(rows, k.matrix[0] + 1); cols = Math.max(cols, k.matrix[1] + 1); });
  if (board.matrix && board.matrix[0] && board.matrix[1]) {
    rows = Math.max(rows, board.matrix[0]);
    cols = Math.max(cols, board.matrix[1]);
  }
  km.layers = km.positional.map(function (layer) {
    var grid = [];
    for (var r = 0; r < rows; r++) { grid.push([]); for (var c = 0; c < cols; c++) grid[r].push(-1); }
    board.keys.forEach(function (key, i) { grid[key.matrix[0]][key.matrix[1]] = i < layer.length ? layer[i] : "KC_NO"; });
    return grid;
  });
  if (km.positional.some(function (layer) { return layer.length !== n; })) {
    var counts = {};
    km.positional.forEach(function (layer) { counts[layer.length] = 1; });
    var list = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
    km.warnings.push(km.name + ": layers have [" + list.join(", ") + "] keycodes but the layout " +
                     (board.layout || "") + " has " + n + " keys; extra codes ignored, missing ones blank");
  }
}

/* ---- geometry: keys and boards ---------------------------------------------------------------

   A key is {matrix: [row, col], x, y, w, h, r, rx, ry} in key units (1 = one key pitch); r is a
   rotation in degrees about (rx, ry), QMK's info.json convention. A board is {name, slug,
   matrix: [rows, cols], uids: [decimal strings], keys, note, layout, source}. Both
   arrive as plain data (Board.to_dict() in Python, boards-local.js, the QMK index); normBoard
   fills the defaults so the rest of the file can rely on every field. */

function normKey(raw) {
  var k = {matrix: [raw.matrix[0], raw.matrix[1]], x: +raw.x, y: +raw.y,
           w: raw.w == null ? 1 : +raw.w, h: raw.h == null ? 1 : +raw.h, r: raw.r == null ? 0 : +raw.r,
           rx: 0, ry: 0};
  if (k.r) {
    // no pivot given: the key centre (why: boards/README.md, "r")
    k.rx = raw.rx == null ? k.x + k.w / 2 : +raw.rx;
    k.ry = raw.ry == null ? k.y + k.h / 2 : +raw.ry;
  }
  return k;
}

function normBoard(b) {
  if (b && b._norm) return b;
  var out = {name: b.name || "", slug: b.slug || "", matrix: b.matrix ? [b.matrix[0] || 0, b.matrix[1] || 0] : [0, 0],
             uids: (b.uids || []).map(String), keys: (b.keys || []).map(normKey), note: b.note || "",
             layout: b.layout || "", source: b.source || "", _norm: true};
  return out;
}

/* The four corners after rotation, in key units. */
function corners(k) {
  var pts = [[k.x, k.y], [k.x + k.w, k.y], [k.x + k.w, k.y + k.h], [k.x, k.y + k.h]];
  if (!k.r) return pts;
  var a = k.r * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  return pts.map(function (p) {
    var dx = p[0] - k.rx, dy = p[1] - k.ry;
    return [k.rx + dx * ca - dy * sa, k.ry + dx * sa + dy * ca];
  });
}

/* [min x, min y, max x, max y] of the drawn keys; a unit square when empty. */
function boundsOf(keys) {
  if (!keys.length) return [0, 0, 1, 1];
  var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  keys.forEach(function (k) {
    corners(k).forEach(function (p) {
      if (p[0] < minx) minx = p[0];
      if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1];
      if (p[1] > maxy) maxy = p[1];
    });
  });
  return [minx, miny, maxx, maxy];
}

/* True when the [row, col] pairs are exactly the keymap's key positions. */
function samePositions(km, pairs) {
  var set = positionSet(km), n = 0, seen = {};
  for (var i = 0; i < pairs.length; i++) {
    var k = posKey(pairs[i][0], pairs[i][1]);
    if (!has(set, k)) return false;
    if (!has(seen, k)) { seen[k] = 1; n++; }
  }
  return n === positions(km).length;
}

/* [[qmk name, layout name], ...]: every layout in the QMK index (its `boards` table) whose
   matrix positions are exactly the keymap's. */
function matchIndex(km, boards) {
  var set = positionSet(km), n = positions(km).length, out = [];
  Object.keys(boards).forEach(function (name) {
    var layouts = boards[name].layouts;
    Object.keys(layouts).forEach(function (ln) {
      var rows = layouts[ln];
      if (rows.length !== n) return;
      var seen = {}, distinct = 0;
      for (var i = 0; i < rows.length; i++) {
        var k = posKey(rows[i][0], rows[i][1]);
        if (!has(set, k)) return;
        if (!has(seen, k)) { seen[k] = 1; distinct++; }
      }
      if (distinct === n) out.push([name, ln]);
    });
  });
  return out;
}

/* True when every [qmk name, layout name] pair in `matches` draws the same key geometry. */
function sameShape(boards, matches) {
  var sigs = {};
  matches.forEach(function (m) {
    sigs[boards[m[0]].layouts[m[1]].map(function (r) { return JSON.stringify(r); }).sort().join(";")] = 1;
  });
  return Object.keys(sigs).length === 1;
}

/* How the grid fallback should draw for candidate boards that share a matrix: "sure" when
   every one of them is split, "guess" when most are, "" otherwise. */
function gridMode(boards, matches) {
  var split = 0;
  matches.forEach(function (m) { if (isSplit(boardFromIndex(m[0], boards[m[0]], m[1]))) split++; });
  return split === matches.length ? "sure" : split * 2 >= matches.length ? "guess" : "";
}

/* The QMK index as fetched: layouts are stored once each in `shapes`, and a layout entry that
   is a number refers to shapes[n]. Returns the index with every entry filled in. */
function resolveIndex(index) {
  var shapes = index.shapes;
  if (shapes) {
    Object.keys(index.boards || {}).forEach(function (name) {
      var layouts = index.boards[name].layouts;
      Object.keys(layouts).forEach(function (ln) { if (typeof layouts[ln] === "number") layouts[ln] = shapes[layouts[ln]]; });
    });
  }
  return index;
}

function keyAt(board, r, c) {
  var keys = board.keys;
  for (var i = 0; i < keys.length; i++) if (keys[i].matrix[0] === r && keys[i].matrix[1] === c) return keys[i];
  return null;
}

/* The compact key rows of the QMK index, written by tools/build_qmk_index.py:
   [row, col, x, y, (w, h, (r, rx, ry))]. */
function keysFromCompact(rows) {
  return rows.map(function (row) {
    var raw = {matrix: [row[0], row[1]], x: row[2], y: row[3]};
    if (row.length > 4) raw.w = row[4];
    if (row.length > 5) raw.h = row[5];
    if (row.length > 6) raw.r = row[6];
    if (row.length > 7) raw.rx = row[7];
    if (row.length > 8) raw.ry = row[8];
    return normKey(raw);
  });
}

/* A board from one record of the QMK index ({name, rows, cols, layouts: {name: compact rows}}). */
function boardFromIndex(qmkName, rec, layout) {
  var layouts = rec.layouts, chosen = layout;
  if (!chosen) {
    Object.keys(layouts).forEach(function (ln) { if (!chosen || layouts[ln].length > layouts[chosen].length) chosen = ln; });
  }
  if (!has(layouts, chosen)) throw new Error(qmkName + " has no layout '" + chosen + "'; it has: " + Object.keys(layouts).join(", "));
  var keys = keysFromCompact(layouts[chosen]);
  var rows = rec.rows || keys.reduce(function (m, k) { return Math.max(m, k.matrix[0] + 1); }, 0);
  var cols = rec.cols || keys.reduce(function (m, k) { return Math.max(m, k.matrix[1] + 1); }, 0);
  return normBoard({name: rec.name || qmkName, slug: qmkName, matrix: [rows, cols], uids: [], keys: keys,
                    layout: chosen, source: "QMK keyboard data"});
}

/* A positional (qmk) keymap with no board: one grid about 2.5 times wider than tall. */
function positionalGrid(km) {
  var n = 0;
  (km.positional || []).forEach(function (l) { n = Math.max(n, l.length); });
  var cols = Math.max(1, Math.ceil(Math.sqrt(n * 2.5))), keys = [];
  for (var i = 0; i < n; i++) keys.push(normKey({matrix: [Math.floor(i / cols), i % cols], x: i % cols, y: Math.floor(i / cols)}));
  return normBoard({name: "Matrix grid (real shape unknown)", slug: "grid", matrix: [Math.ceil(n / cols), cols],
                    uids: [], keys: keys, source: "matrix grid"});
}

/* A plain grid from the keymap's matrix, when nothing else fits. With mode "sure" or
   "guess" the second half of the rows is drawn beside the first, mirrored, the way a split
   keyboard's matrix is usually wired: left half rows first, right half rows after, column 0
   at the outer edge of each half. "guess" says so in the board's name. */
function gridBoard(km, mode) {
  var rows = keymapRows(km), cols = keymapCols(km), half = rows / 2;
  var mirrored = !!mode && rows >= 2 && rows % 2 === 0;
  var keys = positions(km).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; })
    .map(function (p) {
      if (mirrored && p[0] >= half) return normKey({matrix: p, x: cols + GRID_HALF_GAP + (cols - 1 - p[1]), y: p[0] - half});
      return normKey({matrix: p, x: p[1], y: p[0]});
    });
  var name = !mirrored ? "Matrix grid (real shape unknown)"
           : mode === "sure" ? "Matrix grid in two halves (real shape unknown)"
           : "Matrix grid in two halves, guessed (real shape unknown)";
  return normBoard({name: name, slug: "grid", matrix: [rows, cols], uids: [], keys: keys, source: "matrix grid",
                    note: mirrored ? "synthesised from the keymap's matrix, the second half of the rows mirrored beside the first"
                                   : "synthesised from the keymap's matrix"});
}

/* True when a keymap's matrix is shaped like a split keyboard's wiring: at least six rows, an
   even number of them, no more than seven columns, and keys in both halves in similar numbers.
   A guess for the grid fallback when no board in the index matches. */
function looksSplit(km) {
  var rows = keymapRows(km), cols = keymapCols(km);
  if (rows < 6 || rows % 2 || cols > 7) return false;
  var half = rows / 2, top = 0, bottom = 0;
  positions(km).forEach(function (p) { if (p[0] < half) top++; else bottom++; });
  return top > 0 && bottom > 0 && Math.min(top, bottom) * 2 >= Math.max(top, bottom);
}

/* ---- TABLES: legend words, layer verbs and layout constants ---- */

var SHIFTED = {
  "1":"!", "2":"@", "3":"#", "4":"$", "5":"%", "6":"^", "7":"&", "8":"*", "9":"(", "0":")",
  "GRAVE":"~", "GRV":"~", "BSLASH":"|", "BSLS":"|", "RBRACKET":"}", "RBRC":"}", "LBRACKET":"{",
  "LBRC":"{", "EQUAL":"+", "EQL":"+", "MINUS":"_", "MINS":"_", "SCOLON":":", "SCLN":":",
  "QUOTE":"\"", "QUOT":"\"", "COMMA":"<", "COMM":"<", "DOT":">", "SLASH":"?", "SLSH":"?"
};
var PUNCT = {
  "QUOTE":"'", "QUOT":"'", "SCOLON":";", "SCLN":";", "COMMA":",", "COMM":",", "DOT":".", "SLASH":"/",
  "SLSH":"/", "GRAVE":"`", "GRV":"`", "MINUS":"-", "MINS":"-", "EQUAL":"=", "EQL":"=",
  "LBRACKET":"[", "LBRC":"[", "RBRACKET":"]", "RBRC":"]", "BSLASH":"\\", "BSLS":"\\", "NUBS":"\\",
  "NONUS_BSLASH":"\\", "NUHS":"#", "NONUS_HASH":"#"
};
var WORDS = {
  "ESCAPE":"Esc", "ESC":"Esc", "TAB":"Tab", "LSHIFT":"Shift", "LSFT":"Shift", "RSHIFT":"Shift",
  "RSFT":"Shift", "LCTRL":"Ctrl", "LCTL":"Ctrl", "RCTRL":"Ctrl", "RCTL":"Ctrl", "LALT":"Alt",
  "RALT":"AltGr", "LGUI":"Win", "RGUI":"Win", "LCMD":"Cmd", "RCMD":"Cmd", "LWIN":"Win", "RWIN":"Win",
  "ENTER":"Enter", "ENT":"Enter", "SPACE":"Space", "SPC":"Space", "BSPACE":"Bksp", "BSPC":"Bksp",
  "DELETE":"Del", "DEL":"Del", "INSERT":"Ins", "INS":"Ins", "CAPSLOCK":"Caps", "CAPS":"Caps",
  "HOME":"Home", "END":"End", "PGUP":"PgUp", "PGDOWN":"PgDn", "PGDN":"PgDn", "PSCREEN":"PrtSc",
  "PSCR":"PrtSc", "SCROLLLOCK":"ScrLk", "SLCK":"ScrLk", "PAUSE":"Pause", "PAUS":"Pause",
  "APPLICATION":"Menu", "APP":"Menu", "NUMLOCK":"Num", "NLCK":"Num", "NUM":"Num", "MUTE":"Mute",
  "AUDIO_MUTE":"Mute", "VOLU":"Vol +", "AUDIO_VOL_UP":"Vol +", "VOLD":"Vol -",
  "AUDIO_VOL_DOWN":"Vol -", "MPLY":"Play", "MEDIA_PLAY_PAUSE":"Play", "MSTP":"Stop",
  "MEDIA_STOP":"Stop", "MNXT":"Next", "MEDIA_NEXT_TRACK":"Next", "MPRV":"Prev",
  "MEDIA_PREV_TRACK":"Prev", "MFFD":"Fwd", "MRWD":"Rew", "BRIU":"Bright +",
  "BRIGHTNESS_UP":"Bright +", "BRID":"Bright -", "BRIGHTNESS_DOWN":"Bright -", "CALC":"Calc",
  "CALCULATOR":"Calc", "MYCM":"My PC", "MY_COMPUTER":"My PC", "WHOM":"Web", "WWW_HOME":"Web",
  "MAIL":"Mail", "MSEL":"Media", "MEDIA_SELECT":"Media", "PWR":"Power", "POWER":"Power",
  "SLEP":"Sleep", "SYSTEM_SLEEP":"Sleep", "WAKE":"Wake", "SYSTEM_WAKE":"Wake", "EJCT":"Eject",
  "MEDIA_EJECT":"Eject", "MS_U":"Mouse \u2191", "MS_UP":"Mouse \u2191", "MS_D":"Mouse \u2193",
  "MS_DOWN":"Mouse \u2193", "MS_L":"Mouse \u2190", "MS_LEFT":"Mouse \u2190", "MS_R":"Mouse \u2192",
  "MS_RIGHT":"Mouse \u2192", "BTN1":"Click", "MS_BTN1":"Click", "BTN2":"R click",
  "MS_BTN2":"R click", "BTN3":"M click", "MS_BTN3":"M click", "WH_U":"Wheel \u2191",
  "MS_WH_UP":"Wheel \u2191", "WH_D":"Wheel \u2193", "MS_WH_DOWN":"Wheel \u2193",
  "WH_L":"Wheel \u2190", "WH_R":"Wheel \u2192", "ACL0":"Mouse slow", "ACL1":"Mouse mid",
  "ACL2":"Mouse fast",
  "PSTE":"Paste", "PASTE":"Paste", "COPY":"Copy", "CUT":"Cut", "UNDO":"Undo", "AGIN":"Redo", "AGAIN":"Redo",
  "FIND":"Find", "SLCT":"Select", "SELECT":"Select", "EXEC":"Exec", "EXECUTE":"Exec", "HELP":"Help",
  // JIS and Korean boards: the international and language keys (QMK's KC_INTn, KC_LANGn)
  "INT1":"Ro", "INT2":"Kana", "INT3":"Yen", "INT4":"Henkan", "INT5":"Muhenkan", "INT6":"JIS ,",
  "LANG1":"Hangul/Kana", "LANG2":"Hanja/Eisu"
};
var ARROWS = {
  "UP":"\u2191", "DOWN":"\u2193", "LEFT":"\u2190", "RIGHT":"\u2192", "RGHT":"\u2192"
};
var KEYPAD = {
  "KP_MINUS":"-", "PMNS":"-", "KP_PLUS":"+", "PPLS":"+", "KP_ASTERISK":"*", "PAST":"*",
  "KP_SLASH":"/", "PSLS":"/", "KP_COMMA":",", "PCMM":",", "KP_DOT":".", "PDOT":".", "KP_EQUAL":"=",
  "PEQL":"=", "KP_0":"0", "KP_1":"1", "KP_2":"2", "KP_3":"3", "KP_4":"4", "KP_5":"5", "KP_6":"6",
  "KP_7":"7", "KP_8":"8", "KP_9":"9", "P0":"0", "P1":"1", "P2":"2", "P3":"3", "P4":"4", "P5":"5",
  "P6":"6", "P7":"7", "P8":"8", "P9":"9"
};
var SHIFTED_ALIASES = {
  "EXLM":"!", "AT":"@", "HASH":"#", "DLR":"$", "PERC":"%", "CIRC":"^", "AMPR":"&", "ASTR":"*",
  "LPRN":"(", "RPRN":")", "UNDS":"_", "PLUS":"+", "LCBR":"{", "RCBR":"}", "PIPE":"|", "COLN":":",
  "DQUO":"\"", "DQT":"\"", "TILD":"~", "LT":"<", "GT":">", "LABK":"<", "RABK":">", "QUES":"?"
};
var LONG_NAMES = {
  "LEFT_SHIFT":"LSFT", "RIGHT_SHIFT":"RSFT", "LEFT_CTRL":"LCTL", "RIGHT_CTRL":"RCTL",
  "LEFT_ALT":"LALT", "RIGHT_ALT":"RALT", "LEFT_GUI":"LGUI", "RIGHT_GUI":"RGUI", "BACKSPACE":"BSPC",
  "SEMICOLON":"SCLN", "PAGE_UP":"PGUP", "PAGE_DOWN":"PGDN", "CAPS_LOCK":"CAPS", "SCROLL_LOCK":"SLCK",
  "NUM_LOCK":"NLCK", "PRINT_SCREEN":"PSCR", "LEFT_BRACKET":"LBRC", "RIGHT_BRACKET":"RBRC",
  "BACKSLASH":"BSLS", "NONUS_BACKSLASH":"NUBS", "LEFT_CURLY_BRACE":"LCBR",
  "RIGHT_CURLY_BRACE":"RCBR", "LEFT_PAREN":"LPRN", "RIGHT_PAREN":"RPRN", "LEFT_ANGLE_BRACKET":"LT",
  "RIGHT_ANGLE_BRACKET":"GT", "DOUBLE_QUOTE":"DQUO", "QUESTION":"QUES", "EXCLAIM":"EXLM",
  "DOLLAR":"DLR", "PERCENT":"PERC", "CIRCUMFLEX":"CIRC", "AMPERSAND":"AMPR", "ASTERISK":"ASTR",
  "UNDERSCORE":"UNDS", "COLON":"COLN", "TILDE":"TILD", "KB_VOLUME_UP":"VOLU",
  "KB_VOLUME_DOWN":"VOLD", "KB_MUTE":"MUTE", "KB_POWER":"PWR", "SYSTEM_POWER":"PWR",
  "MS_WH_LEFT":"WH_L", "MS_WH_RIGHT":"WH_R", "MS_ACCEL0":"ACL0", "MS_ACCEL1":"ACL1",
  "MS_ACCEL2":"ACL2", "INTERNATIONAL_1":"INT1", "INTERNATIONAL_2":"INT2", "INTERNATIONAL_3":"INT3",
  "INTERNATIONAL_4":"INT4", "INTERNATIONAL_5":"INT5", "INTERNATIONAL_6":"INT6",
  "LANGUAGE_1":"LANG1", "LANGUAGE_2":"LANG2", "LNG1":"LANG1", "LNG2":"LANG2"
};
var MOD_FUNCS = {
  "LCTL":"Ctrl", "C":"Ctrl", "RCTL":"Ctrl", "LSFT":"Shift", "S":"Shift", "RSFT":"Shift",
  "LALT":"Alt", "A":"Alt", "RALT":"AltGr", "ALGR":"AltGr", "LGUI":"Win", "G":"Win", "RGUI":"Win",
  "LCA":"Ctrl Alt", "LCS":"Ctrl Shift", "LSA":"Shift Alt", "LCAG":"Ctrl Alt Win", "LAG":"Alt Win",
  "LSG":"Shift Win", "SGUI":"Shift Win", "SCMD":"Shift Cmd", "RCS":"Ctrl Shift", "RSA":"Shift AltGr",
  "MEH":"Ctrl Shift Alt", "HYPR":"Ctrl Shift Alt Win"
};
var MOD_BITS = {
  "MOD_LCTL":"Ctrl", "MOD_RCTL":"Ctrl", "MOD_LSFT":"Shift", "MOD_RSFT":"Shift", "MOD_LALT":"Alt",
  "MOD_RALT":"AltGr", "MOD_LGUI":"Win", "MOD_RGUI":"Win", "MOD_HYPR":"Hyper", "MOD_MEH":"Meh"
};
var MOD_TAP = {
  "LCTL_T":"Ctrl", "CTL_T":"Ctrl", "RCTL_T":"Ctrl", "LSFT_T":"Shift", "SFT_T":"Shift",
  "RSFT_T":"Shift", "LALT_T":"Alt", "ALT_T":"Alt", "RALT_T":"AltGr", "ALGR_T":"AltGr",
  "LGUI_T":"Win", "GUI_T":"Win", "RGUI_T":"Win", "LCA_T":"Ctrl Alt", "LSA_T":"Shift Alt",
  "LCAG_T":"Ctrl Alt Win", "RCAG_T":"Ctrl Alt Win", "C_S_T":"Ctrl Shift", "MEH_T":"Meh",
  "HYPR_T":"Hyper", "ALL_T":"Hyper", "SGUI_T":"Shift Win", "LAG_T":"Alt Win"
};
var RGB = {
  "TOG":"RGB", "MOD":"RGB mode", "RMOD":"RGB mode -", "HUI":"Hue +", "HUD":"Hue -", "SAI":"Sat +",
  "SAD":"Sat -", "VAI":"RGB bright +", "VAD":"RGB bright -", "SPI":"RGB speed +",
  "SPD":"RGB speed -", "M_P":"RGB plain", "M_B":"RGB breathe", "M_R":"RGB rainbow",
  "M_SW":"RGB swirl", "M_SN":"RGB snake", "M_K":"RGB knight", "M_X":"RGB xmas", "M_G":"RGB gradient",
  "M_T":"RGB test"
};
var BACKLIGHT = {
  "TOGG":"Backlight", "INC":"Backlight +", "DEC":"Backlight -", "STEP":"Backlight step",
  "BRTG":"Backlight breathe", "ON":"Backlight on", "OFF":"Backlight off"
};
/* Vial's tri-layer pair, by either name: layer 1 or 2 held alone, layer 3 with both held. */
var TRI_LAYER = {"FN_MO13": 1, "QK_TRI_LAYER_LOWER": 1, "FN_MO23": 2, "QK_TRI_LAYER_UPPER": 2};
var TRI_ADJUST = 3;
var LAYER_FUNCS = {"MO":"hold", "TT":"tap/hold", "TG":"toggle", "TO":"go to", "OSL":"one shot", "DF":"default"};
var BOOT_WORDS = {
  "QK_BOOT":"Boot", "QK_BOOTLOADER":"Boot", "RESET":"Boot", "QK_REBOOT":"Reboot", "EE_CLR":"Clear EEPROM",
  "QK_CLEAR_EEPROM":"Clear EEPROM"
};
var MODS = {
  "LALT":1, "LCMD":1, "LCTL":1, "LCTRL":1, "LGUI":1, "LSFT":1, "LSHIFT":1, "LWIN":1, "RALT":1,
  "RCMD":1, "RCTL":1, "RCTRL":1, "RGUI":1, "RSFT":1, "RSHIFT":1, "RWIN":1
};
var HOLD_KINDS = {"MO":"Hold", "TT":"Hold"};   // LT is handled before these are read
var OTHER_KINDS = {
  "TG":"Toggle with", "TO":"Switch with", "OSL":"One shot from", "DF":"Default via"
};
/* QMK feature keys that would otherwise print as their raw names. */
var QUANTUM = {
  "AU_ON":"Audio on", "AU_OFF":"Audio off", "AU_TOG":"Audio", "AU_TOGG":"Audio",
  "CK_ON":"Clicky on", "CK_OFF":"Clicky off", "CK_TOGG":"Clicky", "CLICKY_TOGGLE":"Clicky", "CLICKY_ENABLE":"Clicky on",
  "CLICKY_DISABLE":"Clicky off", "CK_UP":"Clicky +", "CLICKY_UP":"Clicky +", "CK_DOWN":"Clicky -", "CLICKY_DOWN":"Clicky -",
  "CK_RST":"Clicky reset", "CLICKY_RESET":"Clicky reset",
  "MU_ON":"Music on", "MU_OFF":"Music off", "MU_TOG":"Music", "MU_TOGG":"Music", "MU_MOD":"Music mode", "MU_NEXT":"Music mode",
  "HPT_ON":"Haptic on", "HPT_OFF":"Haptic off", "HPT_TOG":"Haptic", "HPT_TOGG":"Haptic", "HPT_RST":"Haptic reset",
  "HPT_FBK":"Haptic feedback", "HPT_BUZ":"Haptic buzz", "HPT_MODI":"Haptic mode +", "HPT_MODD":"Haptic mode -",
  "HPT_CONT":"Haptic continuous", "HPT_CONI":"Haptic cont +", "HPT_COND":"Haptic cont -", "HPT_DWLI":"Haptic dwell +",
  "HPT_DWLD":"Haptic dwell -",
  "RM_TOGG":"RGB", "RM_ON":"RGB on", "RM_OFF":"RGB off", "RM_NEXT":"RGB mode +", "RM_PREV":"RGB mode -", "RM_HUEU":"Hue +",
  "RM_HUED":"Hue -", "RM_SATU":"Sat +", "RM_SATD":"Sat -", "RM_VALU":"RGB bright +", "RM_VALD":"RGB bright -",
  "RM_SPDU":"RGB speed +", "RM_SPDD":"RGB speed -",
  "CMB_ON":"Combos on", "CMB_OFF":"Combos off", "CMB_TOG":"Combos",
  "NK_ON":"NKRO on", "NK_OFF":"NKRO off", "NK_TOGG":"NKRO", "MAGIC_TOGGLE_NKRO":"NKRO", "MAGIC_HOST_NKRO":"NKRO on",
  "MAGIC_UNHOST_NKRO":"NKRO off",
  "DM_REC1":"Record macro 1", "DM_REC2":"Record macro 2", "DM_RSTP":"Stop recording", "DM_PLY1":"Play macro 1",
  "DM_PLY2":"Play macro 2",
  "CW_TOGG":"Caps word", "QK_CAPS_WORD_TOGGLE":"Caps word", "AC_TOGG":"Autocorrect", "KO_TOGG":"Key overrides",
  "GU_TOGG":"Win lock", "GUI_TOG":"Win lock", "MAGIC_TOGGLE_GUI":"Win lock"
};
var GRAVE_ESC = {"KC_GESC":1, "QK_GESC":1, "QK_GRAVE_ESCAPE":1};
var TAG_LEN = 18;
var WORD_FIT = 8;   // characters of a "word" legend that fit across a 1u key; longer ones drop to the tag size
var SUB_FIT = 10;   // characters of the small line under a legend that fit across a 1u key at full size
var SUB_MIN = 0.8;  // the smallest the small line shrinks to; a line that would need less drops its "hold: " instead
var GRID_HALF_GAP = 1.5;   // key units between the two halves of a mirrored grid
var SPLIT_GAP = 1.6;       // key units between neighbouring key centres that make a board split
var ROW_MERGE = 0.5;       // key units; matrix rows whose mean y differ by less are one physical row
var THUMB_RATIO = 0.6;     // a bottom row this fraction of the widest row, or shorter, is the thumb row
var THUMB_INSET = 1.0;     // key units the bottom row must be tucked in under the row above to count as thumbs
var LAYERS_PER_PAGE = 9;
var FIT = 0.98;            // fraction of its cell a board fills
var MAX_PITCH = 110;       // px at scale 1; keys stop growing here (a macropad alone on a page)
var KEY_GAP = 0.09;        // fraction of the pitch left between keys

/* ---- end of TABLES ---- */

/* ---- legends: what is printed on a key -------------------------------------------------------

   {text, span ("lg" one big glyph | "word" | "combo" | "tag" long and small), cls ("" | mod |
   layerkey | held | dead | modtap), sub (small line under the legend), trns (falls through)}. */

var CALL = /^([A-Z_0-9]+)\((.+)\)$/;

function L(text, span, cls, sub, trns) {
  return {text: text || "", span: span || "lg", cls: cls || "", sub: sub || "", trns: !!trns};
}

/* Split "MOD_LCTL, KC_A" style argument lists at top-level commas. */
function splitArgs(s) {
  var out = [], depth = 0, cur = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/* ["LT", ["2", "KC_SPC"]] for a keycode written as a call, else null. */
function parseCall(code) {
  if (typeof code !== "string") return null;
  var m = CALL.exec(code);
  if (!m) return null;
  return [m[1], splitArgs(m[2])];
}

function layerLegend(n, sub) { return L("Layer " + n, "word", "layerkey", sub); }

/* ---- normalisation: one spelling for every keycode before anything reads it -----------------

   Vial's older keycode names write a layer-tap as LT2(KC_ESC) rather than LT(2,KC_ESC), and
   Vial writes a bare number for any keycode it has no name for. Both are rewritten here, the
   number through the same table the USB read uses, under the file's own protocol version. */

var OLD_LT = /^LT(\d{1,2})\((.+)\)$/;
var HEX_CODE = /^0x[0-9A-Fa-f]{1,4}$/;

/* A keycode Vial saved without a name: a bare number, or hex text in some builds. */
function isNumberCode(c) { return (typeof c === "number" && c !== -1) || (typeof c === "string" && HEX_CODE.test(c)); }

/* True when the keymap holds a keycode that needs the number-to-name table before it is drawn. */
function hasNumberCodes(km) {
  var found = false;
  (km.layers || []).forEach(function (layer) {
    layer.forEach(function (row) { row.forEach(function (c) { if (isNumberCode(c)) found = true; }); });
  });
  (km.tap_dance || []).forEach(function (e) {
    if (Array.isArray(e)) e.slice(0, 4).forEach(function (c) { if (isNumberCode(c)) found = true; });
  });
  return found;
}

function normaliseCode(code, protocol) {
  if (typeof code === "number") return code === -1 ? -1 : keycodeName(code, protocol);
  if (typeof code !== "string") return code;
  if (HEX_CODE.test(code)) return keycodeName(parseInt(code, 16), protocol);   // some Vial builds write hex text
  var m = OLD_LT.exec(code);
  if (m) return "LT(" + m[1] + "," + m[2] + ")";
  return code;
}

/* A copy of the keymap with every layer cell and tap-dance action normalised. */
function normaliseKeymap(km) {
  var protocol = km.vial_protocol == null ? 6 : km.vial_protocol;
  var out = {};
  Object.keys(km).forEach(function (k) { out[k] = km[k]; });
  out.layers = (km.layers || []).map(function (layer) {
    return layer.map(function (row) { return row.map(function (c) { return normaliseCode(c, protocol); }); });
  });
  out.tap_dance = (km.tap_dance || []).map(function (entry) {
    // [on tap, on hold, on double tap, on tap then hold, tapping term]: the term is a number and stays one
    if (!Array.isArray(entry)) return entry;
    return entry.map(function (c, i) { return i < 4 ? normaliseCode(c, protocol) : c; });
  });
  return out;
}

/* Legend for TD(n) from the file's tap-dance table: the tap action is the legend, the hold
   action (or the double tap when there is no hold) the small line. Without the table, "TD n". */
function tapDanceLegend(n, labels, td) {
  var entry = td && isDigits(n) ? td[parseInt(n, 10)] : null;
  if (!Array.isArray(entry) || entry.length < 3) return L("TD " + n, "word", "mod", "tap dance");
  var tap = entry[0], hold = entry[1], dbl = entry[2];
  var base = isEmptyCode(tap) ? null : legend(tap, labels);
  var text = base && base.text ? base.text : "TD " + n;
  var span = base && base.text ? base.span : "word";
  var cls = base && base.text ? base.cls : "mod";
  if (!isEmptyCode(hold)) {
    var t = layerTarget(hold);
    if (t && t[1] === "Hold") return L(text, span, "layerkey", "hold: layer " + t[0]);
    var h = legend(hold, labels);
    return L(text, span, "modtap", "hold: " + (h && h.text ? h.text : hold));
  }
  if (!isEmptyCode(dbl)) {
    var d = legend(dbl, labels);
    return L(text, span, cls, "2x: " + (d && d.text ? d.text : dbl));
  }
  return L(text, span, cls, "tap dance");
}

function combo(code) {
  var parts = [], inner = code;
  for (;;) {
    var m = CALL.exec(inner);
    if (!(m && has(MOD_FUNCS, m[1]))) break;
    parts.push(MOD_FUNCS[m[1]]);
    inner = m[2];
  }
  if (!parts.length) return null;
  if (inner === "KC_NO") {
    // modifiers wrapped round no key: the chord alone, HYPR(KC_NO) and MEH(KC_NO) by their names
    var set = parts.join(" ").split(" ").sort().join(" ");
    var alone = set === "Alt Ctrl Shift Win" ? "Hyper" : set === "Alt Ctrl Shift" ? "Meh" : parts.join(" ");
    return L(alone, "word", "mod");
  }
  var base = legend(inner);
  if (base === null || base.trns) return null;
  var tail = base.text || inner.replace("KC_", "");
  return L(parts.join(" ") + " " + tail, "combo");
}

function sized(text, span, cls, sub) {
  span = span || "word";
  if (chars(text) > TAG_LEN) span = "tag";
  return L(text, span, cls, sub);
}

function modWords(mod) {
  return mod.split("|").map(function (p) { p = p.trim(); return get(MOD_BITS, p, p); }).join(" ");
}

/* Legend for one keycode; null for -1 (no key). `labels` overrides whole keycode strings. */
function legend(code, labels, td) {
  if (code === -1 || code == null) return null;
  if (typeof code !== "string") return sized(String(code), "word", "mod");   // Vial writes a bare number for a keycode it has no name for
  if (labels && has(labels, code)) return sized(labels[code], chars(labels[code]) > 10 ? "tag" : "word");
  if (code === "KC_NO" || code === "XXXXXXX") return L("", "lg", "dead");
  if (code === "KC_TRNS" || code === "KC_TRANSPARENT" || code === "_______") return L("", "lg", "", "", true);
  if (has(BOOT_WORDS, code)) return L(BOOT_WORDS[code], "word", "mod", "bootloader");

  var m = CALL.exec(code);
  if (m) {
    var fn = m[1], arg = m[2];
    // LSFT(KC_1) is the usual way to put "!" on a key, so it is drawn as the one glyph.
    // S(...), RSFT(...) and other wrappers read as a chord ("Shift 1") through combo below.
    if (fn === "LSFT" && arg.indexOf("KC_") === 0 && has(SHIFTED, get(LONG_NAMES, arg.slice(3), arg.slice(3)))) {
      return L(SHIFTED[get(LONG_NAMES, arg.slice(3), arg.slice(3))]);
    }
    if (has(LAYER_FUNCS, fn) && isDigits(arg)) return layerLegend(arg, LAYER_FUNCS[fn]);
    var args = splitArgs(arg), base;
    // LT and MT take two arguments; anything else falls through to the raw code below
    if (fn === "LT" && args.length === 2) {
      base = legend(args[1], labels) || L();
      return L(base.text, base.span, "layerkey", "hold: layer " + args[0]);
    }
    if (fn === "MT" && args.length === 2) {
      base = legend(args[1], labels) || L();
      return L(base.text, base.span, "modtap", "hold: " + modWords(args[0]));
    }
    if (has(MOD_TAP, fn)) {
      base = legend(arg, labels) || L();
      return L(base.text, base.span, "modtap", "hold: " + MOD_TAP[fn]);
    }
    if (fn === "OSM") return L(modWords(arg), "word", "mod", "one shot");
    if (fn === "TD") return tapDanceLegend(arg, labels, td);
    var c = combo(code);
    if (c) return c;
    return L(code, "tag", "mod");
  }

  if (has(TRI_LAYER, code)) return layerLegend(TRI_LAYER[code], "hold");
  var mm = /^M(\d+)$/.exec(code) || /^MACRO0?(\d+)$/.exec(code) || /^QK_MACRO_(\d+)$/.exec(code);
  if (mm) return L("M" + mm[1], "word", "mod", "macro");
  if (code.indexOf("RGB_") === 0) return sized(get(RGB, code.slice(4), code), "word", "mod");
  if (code.indexOf("BL_") === 0) return sized(get(BACKLIGHT, code.slice(3), code), "word", "mod");
  if (code.indexOf("USER") === 0) return L(code, "word", "mod", "custom");
  if (has(QUANTUM, code)) return sized(QUANTUM[code], "word", "mod");
  if (has(GRAVE_ESC, code)) return L("Esc", "word", "", "grave esc");
  if (code.indexOf("KC_") !== 0) return sized(code, "word", "mod");

  var k = code.slice(3);
  k = get(LONG_NAMES, k, k);
  if (/^[A-Z]$/.test(k) || /^[0-9]$/.test(k) || /^F\d+$/.test(k)) return L(k);
  if (has(SHIFTED_ALIASES, k)) return L(SHIFTED_ALIASES[k]);
  if (has(ARROWS, k)) return L(ARROWS[k]);
  if (has(KEYPAD, k)) return L(KEYPAD[k], "lg", "", "kp");
  if (k === "KP_ENTER" || k === "PENT") return L("Enter", "word", "", "kp");
  if (has(PUNCT, k)) return L(PUNCT[k]);
  if (has(WORDS, k)) return sized(WORDS[k], "word", has(MODS, k) ? "mod" : "");
  return sized(k, "word", "mod");
}

/* ---- layers: which base-layer keys reach each layer, and where those keys sit -------------

   Access is read from layer 0 rather than hand-written, so it follows the file when a layer
   key moves. Descriptions ("left middle thumb", "right home row, outer column") come from
   the board geometry with a few heuristics; they are approximate and meant to be read next
   to the picture, not instead of it. */

/* [target layer, verb] for a layer-switch keycode, else null. */
function layerTarget(code, td) {
  if (has(TRI_LAYER, code)) return [TRI_LAYER[code], "Hold"];
  var call = parseCall(code);
  if (!call) return null;
  var fn = call[0], args = call[1];
  if (fn === "LT") return isDigits(args[0]) ? [parseInt(args[0], 10), "Hold"] : null;
  if (fn === "TD") {
    var entry = td && isDigits(args[0]) ? td[parseInt(args[0], 10)] : null;
    if (!Array.isArray(entry) || entry.length < 3) return null;
    var onHold = isEmptyCode(entry[1]) ? null : layerTarget(entry[1]);
    if (onHold) return onHold;
    var onTap = isEmptyCode(entry[0]) ? null : layerTarget(entry[0]);
    if (onTap) return onTap;
    var onDouble = isEmptyCode(entry[2]) ? null : layerTarget(entry[2]);
    return onDouble ? [onDouble[0], "Double-tap"] : null;
  }
  if (args.length !== 1 || !isDigits(args[0])) return null;
  if (has(HOLD_KINDS, fn)) return [parseInt(args[0], 10), HOLD_KINDS[fn]];
  if (has(OTHER_KINDS, fn)) return [parseInt(args[0], 10), OTHER_KINDS[fn]];
  return null;
}

/* {layer: [{layer, pos: [r, c], verb, held, pos2?}]}, read from layer 0. A tri-layer pair adds
   one entry for the adjust layer with both positions (pos and pos2). */
function accesses(km) {
  var out = {}, tri = {};
  if (!km.layers.length) return out;
  km.layers[0].forEach(function (row, r) {
    row.forEach(function (code, c) {
      var t = layerTarget(code, km.tap_dance);
      if (t) {
        if (!has(out, t[0])) out[t[0]] = [];
        out[t[0]].push({layer: t[0], pos: [r, c], verb: t[1], held: t[1] === "Hold"});
      }
      if (has(TRI_LAYER, code) && !has(tri, TRI_LAYER[code])) tri[TRI_LAYER[code]] = [r, c];
    });
  });
  if (has(tri, 1) && has(tri, 2)) {
    if (!has(out, TRI_ADJUST)) out[TRI_ADJUST] = [];
    out[TRI_ADJUST].push({layer: TRI_ADJUST, pos: tri[1], pos2: tri[2], verb: "Hold both", held: true});
  }
  return out;
}

/* Centre of the key as drawn (after rotation). */
function centre(k) {
  var pts = corners(k), x = 0, y = 0;
  pts.forEach(function (p) { x += p[0]; y += p[1]; });
  return [x / 4, y / 4];
}

function meanY(group) {
  var s = 0;
  group.forEach(function (k) { s += centre(k)[1]; });
  return s / group.length;
}

/* True when the keys fall in two groups with a clear gap between them. */
function isSplit(board) {
  board = normBoard(board);
  var xs = board.keys.map(function (k) { return centre(k)[0]; }).sort(function (a, b) { return a - b; });
  for (var i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > SPLIT_GAP) return true;
  return false;
}

/* [left keys, right keys], divided at the middle of the board's width. */
function halves(board) {
  board = normBoard(board);
  var b = boundsOf(board.keys), mid = (b[0] + b[2]) / 2;
  return [board.keys.filter(function (k) { return centre(k)[0] < mid; }),
          board.keys.filter(function (k) { return centre(k)[0] >= mid; })];
}

/* Rows of keys, top to bottom. Matrix rows are the starting point, since they follow the
   physical rows on most boards and keep a column-staggered row together; matrix rows drawn
   at the same height are then merged (duplex matrices). */
function physicalRows(keys) {
  var groups = new Map();
  keys.forEach(function (k) {
    if (!groups.has(k.matrix[0])) groups.set(k.matrix[0], []);
    groups.get(k.matrix[0]).push(k);
  });
  var ordered = Array.from(groups.values()).sort(function (a, b) { return meanY(a) - meanY(b); });
  var rows = [];
  ordered.forEach(function (g) {
    if (rows.length && Math.abs(meanY(g) - meanY(rows[rows.length - 1])) < ROW_MERGE) {
      Array.prototype.push.apply(rows[rows.length - 1], g);
    } else {
      rows.push(g.slice());
    }
  });
  return rows;
}

/* Index of the thumb row in `rows`, or null. Only a split board has one: the lowest row,
   when it is much shorter than the widest row or tucked inward under the row above it. */
function thumbRow(rows, split, left) {
  if (!split || rows.length < 2) return null;
  var last = rows[rows.length - 1], above = rows[rows.length - 2];
  var widest = 0;
  rows.forEach(function (r) { widest = Math.max(widest, r.length); });
  if (last.length <= widest * THUMB_RATIO) return rows.length - 1;
  var inset;
  if (left) inset = Math.min.apply(null, last.map(function (k) { return centre(k)[0]; })) -
                    Math.min.apply(null, above.map(function (k) { return centre(k)[0]; }));
  else inset = Math.max.apply(null, above.map(function (k) { return centre(k)[0]; })) -
               Math.max.apply(null, last.map(function (k) { return centre(k)[0]; }));
  return inset >= THUMB_INSET ? rows.length - 1 : null;
}

function sortedBy(list, keyFn) {
  return list.map(function (v, i) { return [keyFn(v), i, v]; })
    .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; })
    .map(function (t) { return t[2]; });
}

/* The row analysis describe() needs, worked out once per board (a sheet asks for a key
   description per layer and per access key). Keyed on the normalised board object, which
   is the same object throughout one render. */
var sidesCache = new WeakMap();
function boardSides(board) {
  var s = sidesCache.get(board);
  if (s) return s;
  var b = boundsOf(board.keys), mid = (b[0] + b[2]) / 2, split = isSplit(board);
  s = { mid: mid, split: split, sides: {} };
  (split ? [true, false] : [true]).forEach(function (left) {
    var keys = split ? board.keys.filter(function (k) { return (centre(k)[0] < mid) === left; }) : board.keys.slice();
    var rows = physicalRows(keys), ti = thumbRow(rows, split, left), fingerRows = [];
    rows.forEach(function (_, i) { if (i !== ti) fingerRows.push(i); });
    s.sides[left] = { rows: rows, ti: ti, fingerRows: fingerRows };
  });
  if (!split) s.sides[false] = s.sides[true];
  sidesCache.set(board, s);
  return s;
}

function describe(board, pos) {
  board = normBoard(board);
  var key = keyAt(board, pos[0], pos[1]);
  if (key === null) return "matrix " + pos[0] + "," + pos[1];
  var an = boardSides(board), mid = an.mid, split = an.split, side = "", left = true;
  if (split) {
    left = centre(key)[0] < mid;
    side = left ? "left " : "right ";
  }
  var part = an.sides[left], rows = part.rows, ti = part.ti, fingerRows = part.fingerRows;
  var rowI = rows.findIndex(function (g) { return g.indexOf(key) >= 0; });
  var row = rows[rowI], ordered, n, word;

  if (rowI === ti) {
    // Count from the centre outward: inner, middle, outer when there are three.
    ordered = sortedBy(row, function (k) { return Math.abs(centre(k)[0] - mid); });
    n = ordered.indexOf(key);
    if (ordered.length === 3) word = ["inner", "middle", "outer"][n];
    else if (ordered.length === 2) word = ["inner", "outer"][n];
    else if (ordered.length === 1) word = "";
    else word = "key " + (n + 1) + " from the centre";
    return (side + word + " thumb").replace(/  /g, " ").trim();
  }

  var fi = fingerRows.indexOf(rowI), nRows = fingerRows.length, rname;
  if (nRows === 3) rname = ["top row", "home row", "bottom row"][fi];
  else if (nRows === 1) rname = "row";
  else if (fi === 0) rname = "top row";
  else if (fi === nRows - 1) rname = "bottom row";
  else rname = "row " + (fi + 1) + " of " + nRows;
  ordered = side === "right " ? sortedBy(row, function (k) { return -centre(k)[0]; })
                              : sortedBy(row, function (k) { return centre(k)[0]; });
  n = ordered.indexOf(key);
  var cname;
  if (n === 0 && split) cname = "outer column";
  else if (n === ordered.length - 1 && split) cname = "inner column";
  else cname = "column " + (n + 1) + (split ? "" : " from the left");
  return side + rname + ", " + cname;
}

function accessText(board, accList) {
  if (!accList || !accList.length) return "No base-layer key reaches this layer";
  return accList.map(function (a) {
    return a.verb + " " + describe(board, a.pos) + (a.pos2 ? " and " + describe(board, a.pos2) : "");
  }).join(" or ");
}

/* ---- render: the pages ---------------------------------------------------------------------

   Every key is an absolutely positioned div laid out here, so the output needs no script
   and draws the same everywhere. Page layout is designed at 1920 x 1080; everything scales
   with --s for other sizes. */

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function f1(x) { return x.toFixed(1); }
function f2(x) { return x.toFixed(2); }
function f4(x) { return x.toFixed(4); }

function scaleOf(width, height) { return Math.min(width / 1920, height / 1080); }

/* [cell width, height left for the board under a cell's heading] for a cols x rows grid. */
function cells(cols, rows, width, height, s) {
  var padX = 44 * s, gapX = 56 * s;
  var padY = (34 + 30 + 22) * s, gapY = 8 * s, headH = 52 * s;   // top + bottom + footer; row gap; quad heading
  var cellW = (width - 2 * padX - (cols - 1) * gapX) / cols;
  var cellH = (height - padY - (rows - 1) * gapY) / rows;
  return [cellW, cellH - headH];
}

/* [cols, rows] for n layers, at most 3 x 3: the shape that draws a bw x bh board largest.
   A wide board (a whole split keyboard) does better stacked than side by side; a square
   macropad the other way round. Ties keep the fewer columns. */
function gridShape(n, bw, bh, width, height) {
  bw = bw || 1; bh = bh || 1; width = width || 1920; height = height || 1080;
  var s = scaleOf(width, height), best = null;
  [1, 2, 3].forEach(function (cols) {
    var rows = Math.ceil(Math.max(n, 1) / cols);
    if (rows > 3) return;
    var c = cells(cols, rows, width, height, s);
    var u = Math.min(c[0] / bw, c[1] / bh);
    if (best === null || u > best[0] * 1.001) best = [u, cols, rows];
  });
  return [best[1], best[2]];
}

/* The small line under a legend, kept to one row: [text, size factor]. A line longer than the
   key shrinks, down to SUB_MIN; one that would need to go smaller than that drops its "hold: "
   prefix instead ("hold: Shift" -> "Shift", "hold: layer 2" -> "layer 2"), then shrinks if it
   still must. */
function subFit(sub, w) {
  var room = SUB_FIT * (w || 1), n = chars(sub);
  if (n <= room) return [sub, 1];
  if (room / n < SUB_MIN && sub.indexOf("hold: ") === 0) { sub = sub.slice(6); n = chars(sub); }
  return [sub, n <= room ? 1 : Math.max(SUB_MIN, room / n)];
}

function keyHtml(k, lg, u, gap, ox, oy, extraCls) {
  var cls = ["key", lg.cls, extraCls].filter(Boolean).join(" ");
  var w = k.w * u - gap, h = k.h * u - gap;
  var left = ox + k.x * u + gap / 2, top = oy + k.y * u + gap / 2;
  var style = "left:" + f1(left) + "px;top:" + f1(top) + "px;width:" + f1(w) + "px;height:" + f1(h) + "px";
  if (k.r) {
    // rotate about (rx, ry), expressed relative to this div's own top-left corner
    var orx = (k.rx - k.x) * u - gap / 2, ory = (k.ry - k.y) * u - gap / 2;
    style += ";transform-origin:" + f1(orx) + "px " + f1(ory) + "px;transform:rotate(" + k.r + "deg)";
  }
  var span = lg.span;
  if (span === "word" && chars(lg.text) > WORD_FIT * k.w) span = "tag";
  var inner = '<span class="' + span + '">' + esc(lg.text) + "</span>";
  if (lg.sub) {
    var fit = subFit(lg.sub, k.w);
    inner += '<span class="sub"' + (fit[1] < 1 ? ' style="--subfit:' + fit[1].toFixed(2) + '"' : "") + ">" + esc(fit[0]) + "</span>";
  }
  return '<div class="' + cls + '" style="' + style + '">' + inner + "</div>";
}

/* [width, height] in key units of the largest of several key groups, so halves drawn side
   by side get the same key pitch. */
function fitSize(keyLists) {
  var bw = 0, bh = 0;
  keyLists.forEach(function (keys) {
    var b = boundsOf(keys);
    bw = Math.max(bw, b[2] - b[0]);
    bh = Math.max(bh, b[3] - b[1]);
  });
  return [bw, bh];
}

/* One screen's worth of layers as a `.page` div: a grid of quads plus footer and title block.
   p.keys are the keys to draw (all of them, or one half); p.fit the [w, h] in key units the
   pitch is chosen for, when it should match another panel; p.cells the grid size when it
   should match another panel's layer count; p.side "left" or "right" on a two-screen page. */
function panel(p) {
  var km = p.km, board = p.board, keys = p.keys, shown = p.shown, width = p.width, height = p.height;
  var s = scaleOf(width, height);
  var b = boundsOf(keys), minx = b[0], miny = b[1], maxx = b[2], maxy = b[3];
  var bw = p.fit ? p.fit[0] : maxx - minx, bh = p.fit ? p.fit[1] : maxy - miny;
  var shape = gridShape(p.cells || shown.length, bw, bh, width, height), cols = shape[0], rows = shape[1];
  var padTop = 34 * s, padX = 44 * s, padBottom = 30 * s;
  var gapX = 56 * s, gapY = 8 * s, footerH = 22 * s;
  var c = cells(cols, rows, width, height, s);
  var u = Math.min(c[0] / bw, c[1] / bh) * FIT;
  u = Math.min(u, MAX_PITCH * s);
  var gap = u * KEY_GAP;
  var boardW = (maxx - minx) * u, boardH = (maxy - miny) * u;
  var ox = -minx * u, oy = -miny * u;

  var quads = shown.map(function (li) {
    var name = p.names[String(li)] || "";
    var titleHtml = name ? '<span class="no">Layer ' + li + '</span><span class="dot"> · </span>' + esc(name)
                         : '<span class="no">Layer ' + li + "</span>";
    var accList = get(p.acc, li, []);
    var access = li === 0 ? "Active by default" : accessText(board, accList);
    var held = {};
    accList.forEach(function (a) {
      if (!a.held) return;
      held[posKey(a.pos[0], a.pos[1])] = 1;
      if (a.pos2) held[posKey(a.pos2[0], a.pos2[1])] = 1;
    });
    var keysHtml = [];
    keys.forEach(function (k) {
      var r = k.matrix[0], cc = k.matrix[1];
      var code = keycodeAt(km, li, r, cc);
      if (code === -1) return;
      var lg = legend(code, p.labels, km.tap_dance), extra = "";
      if (lg === null) return;
      if (lg.trns) {
        // a fall-through key is drawn blank, like KC_NO; the class keeps the outline style
        lg = L("", "lg", "dead");
        extra = "trns";
      }
      if (has(held, posKey(r, cc))) {
        lg = L("Layer " + li, "word", "held", "held");
        extra = "";
      }
      keysHtml.push(keyHtml(k, lg, u, gap, ox, oy, extra));
    });
    return '<div class="quad" data-layer="' + li + '">' +
      '<div class="qhead"><div class="qtitle">' + titleHtml + "</div>" +
      '<div class="qaccess">' + esc(access) + '</div><div class="drule"></div></div>' +
      '<div class="boardwrap"><div class="board" style="--u:' + f2(u) + "px;width:" + f1(boardW) + "px;" +
      "height:" + f1(boardH) + 'px">' + keysHtml.join("") + "</div></div></div>";
  });

  var sep = ' <span class="sep">·</span> ';
  var bits = [esc(board.name)];
  if (board.layout) bits.push(esc(board.layout));
  bits.push(esc(km.name));
  if (p.date) bits.push(esc(p.date));
  if (p.note) bits.push(esc(p.note));
  if (p.fit) bits.push(p.side + " half");
  if (p.sheetCount > 1) bits.push("sheet " + p.sheetNo + " of " + p.sheetCount);
  var footer = bits.join(sep);
  var tb = '<div class="tb"><span>Board<b>' + esc(board.name) + "</b></span>" +
    "<span>Source<b>" + esc(km.name) + "</b></span>" +
    (p.date ? "<span>Date<b>" + esc(p.date) + "</b></span>" : "") +
    "<span>Sheet<b>" + p.sheetNo + " / " + p.sheetCount + "</b></span></div>";

  var gridStyle = "grid-template-columns:repeat(" + cols + ",1fr);grid-template-rows:repeat(" + rows + ",1fr);" +
    "padding:" + f1(padTop) + "px " + f1(padX) + "px " + f1(padBottom + footerH) + "px " + f1(padX) + "px;" +
    "column-gap:" + f1(gapX) + "px;row-gap:" + f1(gapY) + "px";
  var cls = ("page " + (p.side || "")).trim();
  var pos = p.side ? "left:" + (p.side === "right" ? width : 0) + "px;width:" + width + "px;height:" + height + "px" : "";
  return '<div class="' + cls + '"' + (pos ? ' style="' + pos + '"' : "") + ">\n" +
    '<div class="frame"></div>\n' +
    '<div class="grid" style="' + gridStyle + '">\n' + quads.join("\n") + "\n</div>\n" +
    '<div class="mapping">' + esc(p.title) + "</div>\n" +
    '<div class="footer">' + footer + "</div>\n" + tb + "\n</div>";
}

function documentHtml(styleCss, title, styleName, width, height, panels, dual) {
  var s = scaleOf(width, height), padX = 44 * s, bodyW = width * (dual ? 2 : 1);
  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
    "<title>" + esc(title) + " (" + esc(styleName) + ")</title>\n" +
    "<style>\n" + styleCss + "\n</style>\n</head>\n" +
    '<body class="' + (dual ? "dual" : "") + '" style="--s:' + f4(s) + ";--pad-x:" + f1(padX) + "px;" +
    "width:" + bodyW + "px;height:" + height + 'px" data-style="' + esc(styleName) + '">\n' +
    panels.join("\n") + "\n</body>\n</html>\n";
}

/* The HTML documents for a keymap on a board in a style, one string per sheet.

   opts: width, height (1920 x 1080), layers (indexes to draw; default the non-empty ones),
   names ({"1": "Nav"}), title (default the file's stem), labels ({keycode: words}), date,
   styleName, note, dual, halves.

   A sheet is one screen holding up to nine layers. With `dual` it is two screens wide: two
   panels side by side, the layers shared between them, so a wallpaper can span two monitors
   (or one file per monitor, cut at the seam). With `halves` (which implies `dual`) every
   layer is on both panels, the left half of a split keyboard on the left panel and the right
   half on the right, so each half is drawn about twice the size. `halves` needs a split
   board; the caller checks with isSplit first. */
function renderPages(km, board, styleCss, opts) {
  opts = opts || {};
  board = normBoard(board);
  km = normaliseKeymap(km);
  var width = opts.width || 1920, height = opts.height || 1080;
  var names = opts.names || {}, labels = opts.labels || {};
  var wanted = opts.layers != null ? opts.layers : nonemptyLayers(km);
  var shown = wanted.filter(function (i) { return i >= 0 && i < km.layers.length; });
  if (!shown.length) shown = [0];
  var title = opts.title != null ? opts.title : (km.stem != null ? km.stem : stemOf(km.name));
  var acc = accesses(km);
  var halvesMode = !!opts.halves, dual = !!opts.dual || halvesMode;

  var perSheet = LAYERS_PER_PAGE * (dual && !halvesMode ? 2 : 1);
  var sheets = [];
  for (var i = 0; i < shown.length; i += perSheet) sheets.push(shown.slice(i, i + perSheet));
  var docs = [];
  sheets.forEach(function (sheet, si) {
    function common(extra) {
      var p = {km: km, board: board, acc: acc, names: names, labels: labels, title: title, width: width,
               height: height, date: opts.date || "", note: opts.note || "", sheetCount: sheets.length,
               sheetNo: si + 1, fit: null, cells: null, side: ""};
      Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
      return p;
    }
    var panels;
    if (halvesMode) {
      var lr = halves(board), fit = fitSize(lr);
      panels = [panel(common({keys: lr[0], shown: sheet, fit: fit, side: "left"})),
                panel(common({keys: lr[1], shown: sheet, fit: fit, side: "right"}))];
    } else if (dual) {
      var nLeft = Math.ceil(sheet.length / 2);
      var cellCount = Math.max(nLeft, sheet.length - nLeft);   // the same grid on both screens keeps the keys one size
      panels = [panel(common({keys: board.keys, shown: sheet.slice(0, nLeft), cells: cellCount, side: "left"})),
                panel(common({keys: board.keys, shown: sheet.slice(nLeft), cells: cellCount, side: "right"}))];
    } else {
      panels = [panel(common({keys: board.keys, shown: sheet}))];
    }
    docs.push(documentHtml(styleCss, title, opts.styleName || "", width, height, panels, dual));
  });
  return docs;
}

/* ---- fonts: embed the font files a style sheet names -------------------------------------

   A style refers to a font as url('fonts/<file>'); the page and the command line hand the file bytes
   in as base64 and the sheet comes back self-contained. */

var FONT_URL = /url\(\s*['"]?fonts\/([^'")]+)['"]?\s*\)/g;
var FONT_PATH_LEFT = /url\(\s*['"]?([^'")]*fonts\/[^'")]+)['"]?\s*\)/g;

/* The font file names a style sheet refers to, in order of first use. */
function fontRefs(css) {
  var out = [], m;
  FONT_URL.lastIndex = 0;
  while ((m = FONT_URL.exec(css)) !== null) if (out.indexOf(m[1]) < 0) out.push(m[1]);
  return out;
}

function fontMime(name) {
  return /\.woff2$/i.test(name) ? "font/woff2" : /\.woff$/i.test(name) ? "font/woff" : "font/ttf";
}

/* {css, notes}: the sheet with url('fonts/x') replaced by data URIs from `files`
   ({name: base64}); a font not in `files` is left as it was and noted. */
function inlineFonts(css, files) {
  files = files || {};
  var missing = [];
  var out = css.replace(FONT_URL, function (whole, name) {
    if (!has(files, name)) { if (missing.indexOf(name) < 0) missing.push(name); return whole; }
    return "url(data:" + fontMime(name) + ";base64," + files[name] + ")";
  });
  var notes = missing.map(function (f) { return "font file not found: fonts/" + f + " (the browser will substitute)"; });
  // url(./fonts/x) or url(../fonts/x) is not matched above and would not resolve from output/
  var m;
  FONT_PATH_LEFT.lastIndex = 0;
  while ((m = FONT_PATH_LEFT.exec(out)) !== null) {
    notes.push("font left as a path, not embedded: url(" + m[1] + "); write it as url('fonts/<file>')");
  }
  return {css: out, notes: notes};
}

/* ---- Vial definitions: the keyboard's own drawing, read over USB -----------------------------

   Vial firmware carries a VIA-style JSON definition with a KLE drawing of the board
   (layouts.keymap). kleKeys turns that drawing into keys; boardFromDefinition wraps them
   as a board. Used by the page (WebHID) and by the command line (through the browser harness). */

var MATRIX_LABEL = /^\s*(\d+)\s*,\s*(\d+)\s*$/;

function round4(x) { return Math.round(x * 10000) / 10000; }

/* Keys from a KLE layout. Follows kle-serial: x/y offsets and w/h apply to the next key
   then reset; r, rx, ry persist; setting rx or ry moves the cursor to the rotation origin;
   each new row moves down one unit and back to rx. Labels carry "row,col" in the first
   line and an optional "option,choice" in the fourth; keys of a layout option other than
   choice 0 are left out so the default layout comes back. Decals and encoders (an "e" in
   the tenth label line) are skipped. */
function kleKeys(rows) {
  var cur = {x: 0, y: 0, w: 1, h: 1, r: 0, rx: 0, ry: 0}, cluster = [0, 0], decal = false, keys = [];
  rows.forEach(function (row) {
    if (!Array.isArray(row)) return;                 // metadata block
    row.forEach(function (item) {
      if (item && typeof item === "object") {
        if ("r" in item) cur.r = +item.r;
        if ("rx" in item) { cur.rx = cluster[0] = +item.rx; cur.x = cluster[0]; cur.y = cluster[1]; }
        if ("ry" in item) { cur.ry = cluster[1] = +item.ry; cur.x = cluster[0]; cur.y = cluster[1]; }
        if ("x" in item) cur.x += +item.x;
        if ("y" in item) cur.y += +item.y;
        if ("w" in item) cur.w = +item.w;
        if ("h" in item) cur.h = +item.h;
        if ("d" in item) decal = !!item.d;
        return;
      }
      var parts = String(item).split("\n");
      var m = MATRIX_LABEL.exec(parts[0]);
      var option = parts.length > 3 ? parts[3].trim() : "";
      var encoder = parts.length > 9 && parts[9].trim().indexOf("e") === 0;
      var keep = m && !decal && !encoder && (!option || /,0$/.test(option));
      if (keep) {
        var k = {matrix: [parseInt(m[1], 10), parseInt(m[2], 10)], x: round4(cur.x), y: round4(cur.y)};
        if (cur.w !== 1) k.w = cur.w;
        if (cur.h !== 1) k.h = cur.h;
        if (cur.r) { k.r = cur.r; k.rx = cur.rx; k.ry = cur.ry; }
        keys.push(k);
      }
      cur.x += cur.w;
      cur.w = cur.h = 1;
      decal = false;
    });
    cur.y += 1;
    cur.x = cur.rx;
  });
  if (keys.length) {
    // normalise so the drawing starts near the origin
    var minx = Infinity, miny = Infinity;
    keys.forEach(function (k) { minx = Math.min(minx, k.x); miny = Math.min(miny, k.y); });
    keys.forEach(function (k) {
      k.x = round4(k.x - minx); k.y = round4(k.y - miny);
      if ("r" in k) { k.rx = round4(k.rx - minx); k.ry = round4(k.ry - miny); }
    });
  }
  return keys;
}

/* A board (plain data, the shape of a boards/<slug>.json file) from a Vial definition. uid is
   the keyboard id as a decimal string. */
function boardFromDefinition(defn, uid, slug, note) {
  var rows = defn && defn.layouts ? defn.layouts.keymap : null;
  if (!rows || !rows.length) throw new Error("the definition has no layouts.keymap drawing");
  var keys = kleKeys(rows);
  if (!keys.length) throw new Error("no keys with row,col labels found in the definition's drawing");
  var m = defn.matrix || {};
  var mrows = parseInt(m.rows, 10) || keys.reduce(function (a, k) { return Math.max(a, k.matrix[0] + 1); }, 0);
  var mcols = parseInt(m.cols, 10) || keys.reduce(function (a, k) { return Math.max(a, k.matrix[1] + 1); }, 0);
  return {name: defn.name || slug, slug: slug, matrix: [mrows, mcols], uids: [String(uid)],
          note: note || "Read from the keyboard's own Vial definition over USB.", keys: keys};
}

/* ---- keycodes: numbers to names ------------------------------------------------------------

   A keyboard reports its keymap over USB as 16-bit numbers. Vial protocol 6 uses QMK's
   current numbering, bundled as docs/keycodes.js (handed in with setKeycodes; the command line loads
   the same file into its browser); older protocols use the layout QMK had before 2022,
   covered by a short hand list. A number nothing recognises prints as hex, as the Vial app
   does. */

var KEYCODES = null;   // {names: {"0x0004": "KC_A", ...}, ranges: {QK_MOD_TAP: [start, end], ...}}
var MOD_ORDER = ["LCTL", "LSFT", "LALT", "LGUI"];
var OLD_NAMES = {0x5C00: "RESET", 0x5C01: "DEBUG", 0x5F10: "FN_MO13", 0x5F11: "FN_MO23"};
/* Current numbering: QMK names these QK_TRI_LAYER_LOWER / _UPPER; Vial shows them as FN_MO13 /
   FN_MO23 (hold one for layer 1 or 2, both for layer 3), and the legend rules use those names. */
var NEW_ALIASES = {0x7C77: "FN_MO13", 0x7C78: "FN_MO23"};
(function () {
  for (var i = 0; i < 16; i++) {
    OLD_NAMES[0x5F12 + i] = "MACRO" + (i < 10 ? "0" : "") + i;
    OLD_NAMES[0x5F80 + i] = "USER" + (i < 10 ? "0" : "") + i;
  }
})();

function setKeycodes(table) { KEYCODES = table; }
function hex4(c) { return "0x" + ("000" + c.toString(16).toUpperCase()).slice(-4); }
function basicName(c) {
  var n = KEYCODES && KEYCODES.names ? KEYCODES.names[hex4(c)] : null;
  return n || hex4(c);
}
/* "MOD_LCTL|MOD_LSFT" for a 5-bit modifier mask (bit 4 = right hand). */
function modsText(bits) {
  var out = [];
  MOD_ORDER.forEach(function (n, i) { if (bits & (1 << i)) out.push((bits & 0x10 ? "MOD_R" : "MOD_L") + n.slice(1)); });
  return out.join("|");
}
/* LCTL(LSFT(inner)) for a 5-bit modifier mask, outermost first. */
function wrapMods(bits, inner) {
  for (var i = 3; i >= 0; i--) if (bits & (1 << i)) inner = (bits & 0x10 ? "R" : "L") + MOD_ORDER[i].slice(1) + "(" + inner + ")";
  return inner;
}
/* LSFT_T(kc) or MT(MOD_A|MOD_B,kc) for a mod-tap code; hex when the mask is empty. */
function modTap(code) {
  var bits = (code >> 8) & 0x1F, kc = basicName(code & 0xFF);
  if (!(bits & 0xF)) return hex4(code);
  for (var i = 0; i < 4; i++) if ((bits & 0xF) === (1 << i)) return (bits & 0x10 ? "R" : "L") + MOD_ORDER[i].slice(1) + "_T(" + kc + ")";
  return "MT(" + modsText(bits) + "," + kc + ")";
}
function inRange(define, c) {
  var r = KEYCODES && KEYCODES.ranges ? KEYCODES.ranges[define] : null;
  return !!r && r[0] <= c && c <= r[1];
}
function rangeStart(define) { return KEYCODES.ranges[define][0]; }

/* The keycode string for a 16-bit number under a Vial protocol version. */
function keycodeName(code, protocol) {
  code &= 0xFFFF;
  if (protocol == null) protocol = 6;
  if (code <= 0xFF) return basicName(code);
  if (code >= 0x0100 && code <= 0x1FFF) return wrapMods((code >> 8) & 0x1F, basicName(code & 0xFF));   // QK_MODS, both numberings
  if (protocol < 6) return oldName(code);
  if (has(NEW_ALIASES, code)) return NEW_ALIASES[code];
  var named = KEYCODES && KEYCODES.names ? KEYCODES.names[hex4(code)] : null;
  if (named) return named;
  if (inRange("QK_MOD_TAP", code)) return modTap(code);
  if (inRange("QK_LAYER_TAP", code)) return "LT(" + ((code >> 8) & 0xF) + "," + basicName(code & 0xFF) + ")";
  if (inRange("QK_LAYER_MOD", code)) return code & 0xF ? "LM(" + ((code >> 5) & 0xF) + "," + modsText(code & 0x1F) + ")" : hex4(code);
  var layerFns = [["QK_TO", "TO"], ["QK_MOMENTARY", "MO"], ["QK_DEF_LAYER", "DF"], ["QK_TOGGLE_LAYER", "TG"],
                  ["QK_ONE_SHOT_LAYER", "OSL"], ["QK_LAYER_TAP_TOGGLE", "TT"], ["QK_PERSISTENT_DEF_LAYER", "PDF"]];
  for (var i = 0; i < layerFns.length; i++) {
    if (inRange(layerFns[i][0], code)) return layerFns[i][1] + "(" + (code - rangeStart(layerFns[i][0])) + ")";
  }
  if (inRange("QK_ONE_SHOT_MOD", code)) return code & 0xF ? "OSM(" + modsText(code & 0x1F) + ")" : hex4(code);
  if (inRange("QK_SWAP_HANDS", code)) return "SH_T(" + basicName(code & 0xFF) + ")";
  if (inRange("QK_TAP_DANCE", code)) return "TD(" + (code - rangeStart("QK_TAP_DANCE")) + ")";
  if (inRange("QK_MACRO", code)) return "M" + (code - rangeStart("QK_MACRO"));
  if (inRange("QK_KB", code)) return "QK_KB_" + (code - rangeStart("QK_KB"));
  if (inRange("QK_USER", code)) return "QK_USER_" + (code - rangeStart("QK_USER"));
  return hex4(code);
}

function oldName(code) {
  if (has(OLD_NAMES, code)) return OLD_NAMES[code];
  if (code >= 0x3000 && code <= 0x3FFF) return "M" + (code & 0xFF);
  if (code >= 0x4000 && code <= 0x4FFF) return "LT(" + ((code >> 8) & 0xF) + "," + basicName(code & 0xFF) + ")";
  if (code >= 0x5000 && code <= 0x50FF) return "TO(" + (code & 0xF) + ")";
  var bases = [[0x5100, "MO"], [0x5200, "DF"], [0x5300, "TG"], [0x5400, "OSL"], [0x5700, "TD"], [0x5800, "TT"]];
  for (var i = 0; i < bases.length; i++) {
    if (code >= bases[i][0] && code <= bases[i][0] + 0xFF) return bases[i][1] + "(" + (code - bases[i][0]) + ")";
  }
  if (code >= 0x5500 && code <= 0x55FF) return code & 0xF ? "OSM(" + modsText(code & 0x1F) + ")" : hex4(code);
  if (code >= 0x5600 && code <= 0x56FF) return "SH_T(" + basicName(code & 0xFF) + ")";
  if (code >= 0x5900 && code <= 0x59FF) return code & 0xF ? "LM(" + ((code >> 4) & 0xF) + "," + modsText(code & 0xF) + ")" : hex4(code);
  if (code >= 0x6000 && code <= 0x7FFF) return modTap(code);
  return hex4(code);
}

/* [layer][row][col] keycode numbers from the keymap buffer a keyboard sends (big-endian u16). */
function decodeBuffer(bytes, layers, rows, cols) {
  var out = [];
  for (var l = 0; l < layers; l++) {
    var grid = [];
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < cols; c++) {
        var i = (l * rows * cols + r * cols + c) * 2;
        row.push(i + 1 < bytes.length ? (bytes[i] << 8) | bytes[i + 1] : 0);
      }
      grid.push(row);
    }
    out.push(grid);
  }
  return out;
}

/* Keycode strings for decoded layers; matrix positions with no physical key ([r, c] pairs
   in `positions`) become -1, as a .vil file has them. */
function namedLayers(codes, positions, protocol) {
  var set = {};
  positions.forEach(function (p) { set[posKey(p[0], p[1])] = 1; });
  return codes.map(function (grid) {
    return grid.map(function (row, r) {
      return row.map(function (code, c) { return has(set, posKey(r, c)) ? keycodeName(code, protocol) : -1; });
    });
  });
}

/* ---- exports ------------------------------------------------------------------------------- */

vilimg.version = "1.1.1";
vilimg.parseKeymap = parseKeymap;
vilimg.isKeymapJson = isKeymapJson;
vilimg.positions = positions;
vilimg.samePositions = samePositions;
vilimg.keycodeAt = keycodeAt;
vilimg.nonemptyLayers = nonemptyLayers;
vilimg.layerKeyCounts = layerKeyCounts;
vilimg.keymapShape = keymapShape;
vilimg.layerCount = layerCount;
vilimg.hasNumberCodes = hasNumberCodes;
vilimg.resolvePositional = resolvePositional;
vilimg.normKey = normKey;
vilimg.normBoard = normBoard;
vilimg.corners = corners;
vilimg.boundsOf = boundsOf;
vilimg.keyAt = keyAt;
vilimg.keysFromCompact = keysFromCompact;
vilimg.boardFromIndex = boardFromIndex;
vilimg.matchIndex = matchIndex;
vilimg.sameShape = sameShape;
vilimg.gridMode = gridMode;
vilimg.resolveIndex = resolveIndex;
vilimg.positionalGrid = positionalGrid;
vilimg.gridBoard = gridBoard;
vilimg.looksSplit = looksSplit;
vilimg.subFit = subFit;
vilimg.legend = legend;
vilimg.parseCall = parseCall;
vilimg.layerTarget = layerTarget;
vilimg.accesses = accesses;
vilimg.centre = centre;
vilimg.isSplit = isSplit;
vilimg.halves = halves;
vilimg.physicalRows = physicalRows;
vilimg.thumbRow = thumbRow;
vilimg.describe = describe;
vilimg.accessText = accessText;
vilimg.gridShape = gridShape;
vilimg.renderPages = renderPages;
vilimg.esc = esc;
vilimg.fontRefs = fontRefs;
vilimg.inlineFonts = inlineFonts;
vilimg.kleKeys = kleKeys;
vilimg.boardFromDefinition = boardFromDefinition;
vilimg.setKeycodes = setKeycodes;
vilimg.keycodeName = keycodeName;
vilimg.normaliseCode = normaliseCode;
vilimg.normaliseKeymap = normaliseKeymap;
vilimg.decodeBuffer = decodeBuffer;
vilimg.namedLayers = namedLayers;
vilimg.LAYERS_PER_PAGE = LAYERS_PER_PAGE;

root.vilimg = vilimg;
if (typeof module !== "undefined" && module.exports) module.exports = vilimg;
})(typeof window !== "undefined" ? window : this);
