/* page.js: the behaviour of index.html.

   The page has two modes, told apart by how it was opened:
   - live (http:// or https://, the hosted site or a local server): the keymap is drawn on the
     page with docs/vilimg.js, styles and fonts are fetched as needed, the QMK index
     (boards/qmk-index.json.gz) is fetched and decompressed in the browser, and the picture
     can be downloaded;
   - local (file://, the page double-clicked in the downloaded folder): browsers block fetch
     from a folder, so the page is the command builder for keymap-imgen.py and shows the sample
     pictures in docs/gallery/ instead of a live drawing.
   Everything the command builder does works in both modes. Loaded after vilimg.js and
   boards-local.js; docs/boards.js (QMK's boards by name) is loaded the first time a name is
   searched for. Classic script, no modules, because file:// blocks those. */
(function () {
  var vilimg = window.vilimg;
  // The page in other languages (docs/i18n.js): t(id, English, vars) and tn(id, n, one, other).
  // A note that must survive a language switch is kept as a message M(id, English, vars) and
  // rendered with say() by rerender(), which i18n.js calls after every switch.
  var I18N = window.vilimgI18n, t = I18N.t, tn = I18N.tn;
  function M(id, en, vars) { return { id: id, en: en, vars: vars || {} }; }
  function say(m) {
    if (!m) return "";
    if (typeof m === "string") return m;
    var vars = {};
    Object.keys(m.vars).forEach(function (k) { var v = m.vars[k]; vars[k] = (v && typeof v === "object" && v.id) ? say(v) : v; });
    return t(m.id, m.en, vars);
  }
  var LIVE = location.protocol !== "file:";
  var HOSTED_URL = "https://whitehatnetizen.github.io/keymap-imgen/";      // the published copy of this page
  // The shipped lists (docs/boards-local.js) plus this copy's additions (docs/boards-user.js); an
  // addition with a shipped name replaces it (a shipped board file that was edited).
  function merged(shipped, added, key) {
    var names = {};
    (added || []).forEach(function (a) { names[a[key]] = true; });
    return (shipped || []).filter(function (s) { return !names[s[key]]; }).concat(added || []);
  }
  var HAND = merged(window.HANDBOARDS, window.USERBOARDS, "k"), STYLES = merged(window.STYLES, window.USERSTYLES, "name");
  var esc = vilimg.esc;
  function isWindows() {
    var plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    return /win/i.test(plat);
  }
  // km is the keymap as vilimg.parseKeymap returns it; layers is [{i, keys}] derived from it once.
  var state = { file: null, km: null, layers: [], board: null, layout: null, boardNote: "", gridMode: null,
                style: STYLES.some(function (s) { return s.name === "plain"; }) ? "plain" : ((STYLES[0] || {}).name || "plain"),
                customStyle: "", os: isWindows() ? "win" : "nix", names: {}, chosen: {}, pickerOpen: true,
                geom: null, sheets: [], sheetStyle: "", shownHtml: "", usbBoard: null, fileErr: null, usbSum: null };
  var $ = function (id) { return document.getElementById(id); };
  // Choices that are not about one keymap (style, computer, picture options) are remembered in
  // the browser between visits, as the language and theme are; the keymap itself never is.
  function remember(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
  function recall(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  document.documentElement.setAttribute("data-mode", LIVE ? "live" : "local");
  // Light or dark: the system setting unless the toggle has been used (remembered in this browser).
  // ---- theme: Light, Dark, or "I feel lucky" ---------------------------------------------
  // Light and Dark are the page's own blueprint palette (remembered). "I feel lucky" paints the
  // page in the palette of one of the image styles, a different one on every click, and is not
  // remembered: the next load follows the browser again. The style list carries each sheet's
  // page-facing colours as "pal" (written by --refresh-page from the sheet's :root block).
  var root = document.documentElement, lucky = null;
  var PAGE_TOKENS = ["--ground", "--ground-deep", "--paper", "--line", "--ink", "--dim", "--grid", "--grid-major", "--wash", "--sig", "--sig-text", "color-scheme"];
  function rgbOf(c) {   // any CSS colour the browser understands, as [r, g, b]; null for none or transparent
    if (!c) return null;
    var el = document.createElement("span"); el.style.color = c; document.body.appendChild(el);
    var m = getComputedStyle(el).color.match(/[\d.]+/g); el.parentNode.removeChild(el);
    if (!m || m.length < 3 || (m.length > 3 && Number(m[3]) === 0)) return null;
    return m.slice(0, 3).map(Number);
  }
  function lum(rgb) {
    var a = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(a, b, k) { return a.map(function (v, i) { return Math.round(v + (b[i] - v) * k); }); }
  function rgb(c, alpha) { return alpha == null ? "rgb(" + c.join(", ") + ")" : "rgba(" + c.join(", ") + ", " + alpha + ")"; }
  // The page's tokens from a style's palette. Every pair is checked for contrast against the
  // ground and falls back to something readable, so a loud palette stays a legible page.
  function paintPage(pal) {
    var bg = rgbOf(pal.bg), ink = rgbOf(pal.ink);
    if (!bg || !ink) return null;
    var dark = lum(bg) < 0.18;
    if (contrast(ink, bg) < 4.5) ink = dark ? [235, 235, 235] : [20, 20, 20];
    var line = rgbOf(pal.line) || ink; if (contrast(line, bg) < 2.5) line = ink;
    var dim = rgbOf(pal.sec) || mix(ink, bg, 0.35);
    if (contrast(dim, bg) < 4.5) { dim = mix(ink, bg, 0.25); if (contrast(dim, bg) < 4.5) dim = ink; }
    var acc = rgbOf(pal.acc) || line; if (contrast(acc, bg) < 3) acc = line;
    var paper = rgbOf(pal.card) || bg; if (contrast(paper, ink) < 4.5 || contrast(paper, line) < 2) paper = bg;
    var s = root.style;
    s.setProperty("--ground", rgb(bg)); s.setProperty("--ground-deep", rgb(mix(bg, ink, 0.06)));
    s.setProperty("--paper", rgb(paper)); s.setProperty("--line", rgb(line)); s.setProperty("--ink", rgb(ink)); s.setProperty("--dim", rgb(dim));
    s.setProperty("--grid", rgb(line, 0.10)); s.setProperty("--grid-major", rgb(line, 0.16)); s.setProperty("--wash", rgb(line, 0.06));
    s.setProperty("--sig", rgb(acc)); s.setProperty("--sig-text", rgb(contrast(acc, bg) >= 4.5 ? acc : ink));
    s.setProperty("color-scheme", dark ? "dark" : "light");
    return dark ? "dark" : "light";
  }
  function setThemeButtons() {
    var th = root.getAttribute("data-theme");
    Array.prototype.forEach.call(document.querySelectorAll("#themes button[data-theme]"), function (b) {
      var on = !lucky && b.getAttribute("data-theme") === th;
      b.className = on ? "on" : ""; b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("lucky").className = lucky ? "on" : ""; $("lucky").setAttribute("aria-pressed", lucky ? "true" : "false");
    $("luckyname").textContent = lucky || "";
  }
  function clearLucky() {
    if (!lucky) return;
    PAGE_TOKENS.forEach(function (p) { root.style.removeProperty(p); });
    root.removeAttribute("data-lucky"); lucky = null;
  }
  function applyTheme(th) {
    clearLucky(); root.setAttribute("data-theme", th); setThemeButtons();
  }
  function applyLucky(name) {   // name: a particular style (tests); otherwise a random one, never the current pick
    var pool = STYLES.filter(function (s) { return s.pal && s.pal.bg && s.pal.ink && s.name !== lucky; });
    var s = name ? pool.filter(function (x) { return x.name === name; })[0] : pool[Math.floor(Math.random() * pool.length)];
    if (!s) return;
    var side = paintPage(s.pal);
    if (!side) return;
    lucky = s.name; root.setAttribute("data-theme", side); root.setAttribute("data-lucky", s.name);
    setThemeButtons();
  }
  window.__lucky = applyLucky;   // for the tests: a named pick
  var savedTheme = null;
  try { savedTheme = localStorage.getItem("theme"); } catch (e) {}
  applyTheme(savedTheme || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  Array.prototype.forEach.call(document.querySelectorAll("#themes button[data-theme]"), function (b) {
    b.onclick = function () {
      var th = b.getAttribute("data-theme");
      applyTheme(th); try { localStorage.setItem("theme", th); } catch (e) {}
    };
  });
  $("lucky").onclick = function () { applyLucky(); };
  // The sections after Keymap open once a keymap is read, and the sheet widens to give the picture room.
  function setLocked(on) {
    Array.prototype.forEach.call(document.querySelectorAll(".stepsec"), function (s) { s.classList.toggle("locked", on); });
    document.querySelector(".sheet").classList.toggle("wide", !on);
    if (!on) sizeStyleList();   // the style list has a height only once the Image style section is visible
  }
  // U22: once a keymap has been read, bring its status line into view when it sits below the fold,
  // so the reader sees what was read without hunting for it. An instant scroll of the least
  // distance: a smooth one kept moving under the reader's next click.
  function revealStatus() {
    var box = $("filesum"), r = box.getBoundingClientRect();
    if (r.bottom <= window.innerHeight && r.top >= 0) return;
    box.scrollIntoView({ block: "nearest" });
  }
  // Enter or Space on a focusable div or li acts like a click, so the keyboard can reach it.
  // The role is "button" unless the element is an option in a list.
  function keyActivate(el, fn, role) {
    el.tabIndex = 0; el.setAttribute("role", role || "button");
    el.addEventListener("keydown", function (e) {
      if (e.target !== el) return;   // a button inside the element handles its own keys
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(e); }
    });
  }
  // The QMK index date and size (boards-local.js carries them), in the tinkerers' fold and the
  // strip at the foot; refilled after a language switch.
  function fillBuilt() {
    var built = window.INDEX_BUILT, count = window.INDEX_COUNT || 0;
    Array.prototype.forEach.call(document.querySelectorAll(".builtcount"), function (el) { el.textContent = count.toLocaleString(); });
    Array.prototype.forEach.call(document.querySelectorAll(".built2"), function (el) { el.textContent = built || "?"; });
    $("built").textContent = built || t("js.built.missing", "(no data file: docs/boards-local.js missing)");
    $("tbbuilt").textContent = built || t("js.built.none", "none");
  }
  fillBuilt();
  // docs/boards.js, QMK's boards by name (450 KB), is loaded the first time it is needed: a
  // search, or a keymap.json that names its board. A .vil is matched without it.
  var boardsPromise = null;
  function loadBoards() {
    if (!boardsPromise) {
      // ZMK boards ride along in docs/zmk-boards.js (records flagged z: 1); the file is
      // optional, so a copy without the ZMK index still searches QMK's list
      boardsPromise = loadScript("docs/boards.js").then(function () {
        return loadScript("docs/zmk-boards.js").catch(function () {}).then(function () {
          return (window.BOARDS || []).concat(window.ZMKBOARDS || []);
        });
      });
      boardsPromise.catch(function () { boardsPromise = null; });
    }
    return boardsPromise;
  }

  // ---- mode banner ----------------------------------------------------------------------
  function renderMode() {
    var box = $("mode");
    if (LIVE) {
      // one line with a breathing lamp (the CSS animates it): the page is running, not a printed notice.
      // Drawing in the browser needs only http; the USB read also needs a secure address (usbBlocked, below).
      box.className = "mode live";
      box.innerHTML = "<span class=\"lamp\" aria-hidden=\"true\"></span>" + (usbBlocked() ?
        t("js.mode.live.nousb", "Live: your keymap is drawn in this browser and nothing is uploaded. Reading the keyboard over USB is not possible at this address; open the https address in Chrome, Edge or another Chromium browser, or choose a keymap file.") :
        t("js.mode.live", "Live: this page can read your keyboard directly (if you choose), and draws your keymap in this browser. Nothing is uploaded."));
    } else {
      box.className = "mode local";
      box.innerHTML = t("js.mode.local", "This page is static (opened as a file from a folder), so the images are made by a Python script: follow the prompts below. To draw your keymap in the browser instead, {hosted}run <code>python -m http.server</code> in this folder and open <a href=\"http://localhost:8000/\">http://localhost:8000/</a>.",
        { hosted: HOSTED_URL ? t("js.mode.hosted", "open <a href=\"{url}\">{url}</a>, or ", { url: esc(HOSTED_URL) }) : "" });
    }
  }
  renderMode();
  $("cmdfold").open = !LIVE;

  // ---- file -----------------------------------------------------------------------------
  function resetFile() {
    state.file = null; state.km = null; state.layers = []; state.names = {}; state.chosen = {};
    state.board = null; state.layout = null; state.boardNote = ""; state.geom = null; state.sheets = []; state.shownHtml = "";
    state.gridMode = null; state.fileErr = null; state.usbSum = null; geomCache = {};
  }
  // The renderer's reader does the parsing; its messages are mapped to the page's sentences.
  function parseFile(name, text) {
    var how = M("js.file.how", "Export one from Vial (File → Save current layout) or from QMK Configurator (Export keymap), or take the .keymap file from a ZMK config, and try again.");
    var km;
    try { km = vilimg.parseKeymap(text, name); }
    catch (e) {
      var msg = e.message || "";
      if (msg.indexOf("not valid JSON") >= 0) return M("js.file.notkeymap", "Could not read {name}: it is not a keymap file. {how}", { name: name, how: how });
      if (msg.indexOf("neither a Vial") >= 0) return M("js.file.notvil", "Could not read {name}: it is not a Vial .vil, a QMK keymap.json or a ZMK .keymap. {how}", { name: name, how: how });
      return M("js.file.bad", "Could not read {msg}. {how}", { msg: msg, how: how });
    }
    resetFile();
    state.file = name; state.km = km;
    state.layers = vilimg.layerKeyCounts(km).map(function (n, i) { return { i: i, keys: n }; });
    Object.keys(km.layer_names).forEach(function (i) { state.names[i] = km.layer_names[i]; });
    state.layers.forEach(function (l) { if (l.keys) state.chosen[l.i] = true; });
    return null;
  }

  // The status block under the drop zone: what was read, which board, and that the command is ready.
  function renderStatus() {
    var box = $("filesum");
    if (state.fileErr) { box.className = "summary err"; box.textContent = say(state.fileErr); return; }
    if (!state.file) { box.className = "summary"; box.innerHTML = ""; return; }
    var km = state.km, shape = vilimg.keymapShape(km);
    var nonempty = state.layers.filter(function (l) { return l.keys; }).length;
    var layersText = tn("js.layers", nonempty, "{n} layer", "{n} layers");
    var keys = km.kind === "vil" ? vilimg.positions(km).length
             : km.positional && km.positional[0] ? km.positional[0].length : 0;
    var keysText = tn("js.keys", keys, "{n} key", "{n} keys");
    // Two lines, each starting with the noun it describes: the keymap (what was read) and the
    // layout (which drawing of the keyboard the picture uses, chosen under Keyboard). The block is
    // prose; the file name (.f) and the matrix and uid (.d) are identifiers and stay mono.
    var html, fname = "<span class=\"f\">" + esc(state.file) + "</span>";
    if (state.usbBoard) {
      html = t("js.status.usb", "Keymap: {name}, read over USB: {keys}, {layers} <span class=\"d\">({rows} x {cols} matrix, uid {uid})</span>.",
        { name: esc(state.usbBoard.label), keys: keysText, layers: layersText, rows: shape[0], cols: shape[1], uid: esc(km.uid) });
    } else if (km.kind === "vil") {
      html = t("js.status.vil", "Keymap: {name}: a Vial keymap with {keys} and {layers} <span class=\"d\">({rows} x {cols} matrix{uid})</span>.",
        { name: fname, keys: keysText, layers: layersText, rows: shape[0], cols: shape[1],
          uid: km.uid ? t("js.status.uid", ", uid {uid}", { uid: esc(km.uid) }) : "" });
    } else if (km.kind === "zmk") {
      html = t("js.status.zmk", "Keymap: {name}: a ZMK keymap with {keys} and {layers}.",
        { name: fname, keys: keysText, layers: layersText });
    } else {
      html = t("js.status.qmk", "Keymap: {name}: a QMK keymap for {board}{layout}, {layers}.",
        { name: fname, board: esc(km.keyboard), layers: layersText,
          layout: km.layout_name ? t("js.status.layout", ", layout {layout}", { layout: esc(km.layout_name) }) : "" });
    }
    // the board's name only: how it was found, or what to do, is said once, under Keyboard
    html += t("js.status.board", "<br>Layout: {note}", { note: esc(state.board ? boardLabel() + "." : t("js.status.notchosen", "not chosen yet (the Keyboard section below).")) });
    if (LIVE) html += t("js.status.live", "<br>The picture is drawn under Image style and downloaded under Picture. Keyboard and Layers are optional.");
    else html += t("js.status.local", "<br>The command is ready: <a href=\"#cmdsec\">jump to it</a>. The sections between are optional.");
    box.className = "summary"; box.innerHTML = html;
  }
  function boardLabel() { return state.board ? state.board.n + " (" + state.board.k + ")" : ""; }
  // The search box and list are shown only while a board is still to be chosen; "Change" brings them back.
  function renderPicker() { $("boardpick").className = state.pickerOpen ? "" : "hidden"; }
  function setBoardNote(msg) {
    state.boardNote = msg;
    var box = $("boardsum"); box.textContent = say(msg);
    if (msg && !state.pickerOpen) {
      var b = document.createElement("button"); b.type = "button"; b.id = "boardchange"; b.className = "linkbtn"; b.textContent = t("js.change", "Change");
      b.onclick = function () { state.pickerOpen = true; renderPicker(); setBoardNote(state.boardNote); $("search").focus(); };
      box.appendChild(b);
    }
    renderPicker(); renderStatus();
  }

  // ---- the QMK index --------------------------------------------------------------------
  // boards/qmk-index.json.gz (about 600 KB) holds every QMK layout's key positions. It is fetched
  // once, the first time a shape has to be matched or a QMK board drawn, and decompressed here:
  // static hosts serve the .gz bytes as they are (checked on GitHub Pages), so the page inflates
  // them with DecompressionStream; a server that inflates on the way is handled by the magic check.
  var indexPromise = null;
  function loadIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = fetch("boards/qmk-index.json.gz").then(function (r) {
      if (!r.ok) throw new Error(t("js.index.http", "the server answered {status}", { status: r.status }));
      return r.arrayBuffer();
    }).then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        if (typeof DecompressionStream === "undefined") throw new Error(t("js.index.nodecompress", "this browser cannot decompress the board list"));
        var ds = new DecompressionStream("gzip");
        return new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
      }
      return new TextDecoder().decode(bytes);
    }).then(function (text) { return vilimg.resolveIndex(JSON.parse(text)); });
    indexPromise.catch(function () { indexPromise = null; });   // try again next time
    return indexPromise;
  }
  // The ZMK index, the same way (boards/zmk-index.json.gz, built by tools/build_zmk_index.py).
  var zmkIndexPromise = null;
  function loadZmkIndex() {
    if (zmkIndexPromise) return zmkIndexPromise;
    zmkIndexPromise = fetch("boards/zmk-index.json.gz").then(function (r) {
      if (!r.ok) throw new Error(t("js.index.http", "the server answered {status}", { status: r.status }));
      return r.arrayBuffer();
    }).then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        if (typeof DecompressionStream === "undefined") throw new Error(t("js.index.nodecompress", "this browser cannot decompress the board list"));
        var ds = new DecompressionStream("gzip");
        return new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
      }
      return new TextDecoder().decode(bytes);
    }).then(function (text) { return vilimg.resolveIndex(JSON.parse(text)); });
    zmkIndexPromise.catch(function () { zmkIndexPromise = null; });
    return zmkIndexPromise;
  }
  // The {k, n, l} record docs/boards.js has for a board, built from the index itself, so a
  // shape match needs no boards.js.
  function indexRecord(idx, name) {
    var rec = idx.boards[name], l = {};
    Object.keys(rec.layouts).forEach(function (ln) { l[ln] = rec.layouts[ln].length; });
    return { k: name, n: rec.name || name, l: l };
  }
  // The grid choice for the current file: from the candidates when the index has been searched,
  // otherwise a guess from the matrix shape.
  function gridMode() {
    if (state.gridMode !== null && state.gridMode !== undefined) return state.gridMode;
    return state.km && vilimg.looksSplit(state.km) ? "guess" : "";
  }
  function indexFailed(file) {
    return function (e) {
      if (state.file !== file) return;
      state.pickerOpen = true;
      setBoardNote(M("js.board.indexfail", "Could not load the QMK board list ({msg}). Search for your keyboard by name, or choose the plain grid.", { msg: e.message })); update(true);
    };
  }

  function autoBoard() {
    var km = state.km, file = state.file, note = "";
    if (state.usbBoard && state.usbBoard.uid === km.uid) {
      selectUsb(state.usbBoard.rec);
      note = M("js.board.usb", "{board}: from the keyboard's own definition.", { board: boardLabel() });
    } else if (km.kind === "qmk") {
      // the board is named in the file: look it up once boards.js is in
      setBoardNote(M("js.board.loading", "Loading the board list..."));
      loadBoards().then(function (boards) {
        if (state.file !== file) return;   // another file was loaded meanwhile
        var b = boards.filter(function (x) { return x.k === km.keyboard; })[0], note2;
        if (b) { selectBoard(b, km.layout_name && b.l[km.layout_name] ? km.layout_name : null); note2 = M("js.board.named", "{board}: named in the file.", { board: boardLabel() }); }
        else { note2 = M("js.board.notlisted", "The file names {name}, which is not in the list; pick it below or choose the plain grid.", { name: km.keyboard }); }
        state.pickerOpen = !state.board;
        setBoardNote(note2); update(true);
      }, indexFailed(file));
      return;
    } else if (km.kind === "zmk") {
      // a ZMK keymap names no keyboard; when exactly one ZMK layout in the list has its key
      // count, that one is chosen (with a note), else the user picks
      setBoardNote(M("js.board.loading", "Loading the board list..."));
      loadBoards().then(function (boards) {
        if (state.file !== file) return;
        var n = km.positional && km.positional[0] ? km.positional[0].length : 0, note2;
        var hits = boards.filter(function (x) {
          return x.z && Object.keys(x.l).some(function (ln) { return x.l[ln] === n; });
        });
        if (hits.length === 1) {
          selectBoard(hits[0], null);
          note2 = M("js.board.zmkcount", "{board}: the only ZMK layout in the list with {n} keys. Search below if it is not yours.", { board: boardLabel(), n: n });
        } else {
          note2 = M("js.board.zmknone", "A ZMK keymap names no keyboard. Search for yours, use its ZMK layouts .dtsi file (the button below), or choose the plain grid.");
        }
        state.pickerOpen = !state.board;
        setBoardNote(note2); update(true);
      }, indexFailed(file));
      return;
    } else {
      var hit = null, i;
      if (km.uid) for (i = 0; i < HAND.length; i++) if (HAND[i].u.indexOf(km.uid) >= 0) { hit = HAND[i]; break; }
      if (!hit) for (i = 0; i < HAND.length; i++) if (vilimg.samePositions(km, HAND[i].keys.map(function (k) { return k.matrix; }))) { hit = HAND[i]; break; }
      if (hit) { selectHand(hit); note = km.uid && hit.u.indexOf(km.uid) >= 0 ? M("js.board.byid", "{board}: found from the file's keyboard id.", { board: boardLabel() })
                                                                               : M("js.board.byshape", "{board}: found by matching the key layout.", { board: boardLabel() }); }
      else if (!LIVE) {
        note = M("js.board.nolocal", "No user-added board file matches. Search for yours (a clone usually looks right on the original board's shape) or choose the plain grid; the command itself also compares the key arrangement with every QMK board.");
      } else {
        // no board file matches: compare against every QMK layout, once the index is in
        setBoardNote(M("js.board.looking", "Looking through QMK's boards for this key arrangement..."));
        loadIndex().then(function (idx) {
          if (state.file !== file) return;
          var matches = vilimg.matchIndex(km, idx.boards), note2;
          if (matches.length === 1) { selectBoard(indexRecord(idx, matches[0][0]), matches[0][1]); note2 = M("js.board.only", "{board}: found by matching the key layout (only one QMK board has it).", { board: boardLabel() }); }
          else if (matches.length > 1 && vilimg.sameShape(idx.boards, matches)) {
            // revisions of one board, or clones: the picture is the same whichever is named
            selectBoard(indexRecord(idx, matches[0][0]), matches[0][1]);
            note2 = M("js.board.same", "{n} boards share this key arrangement and the same shape; drawn as {board}. Search and pick yours if the name matters.", { n: matches.length, board: boardLabel() });
          }
          else if (matches.length > 1) {
            state.gridMode = vilimg.gridMode(idx.boards, matches);
            note2 = M("js.board.many", "{n} boards share this key arrangement; search and pick yours, or choose the plain grid{halves}",
              { n: matches.length, halves: state.gridMode === "sure" ? M("js.board.halves.sure", " (drawn in two halves: every one of them is split).")
                                         : state.gridMode === "guess" ? M("js.board.halves.guess", " (drawn in two halves: most of them are split).") : "." });
          }
          else {
            state.gridMode = vilimg.looksSplit(km) ? "guess" : "";
            note2 = M("js.board.none", "No board in the list has this key arrangement. Search for yours (a clone usually looks right on the original board's shape) or choose the plain grid{halves}",
              { halves: state.gridMode ? M("js.board.halves.matrix", " (drawn in two halves, since the matrix is shaped like a split keyboard's).") : "." });
          }
          state.pickerOpen = !state.board;
          setBoardNote(note2); update(true);
        }, indexFailed(file));
        return;
      }
    }
    state.pickerOpen = !state.board;   // found one: hide the search until the user asks to change it
    setBoardNote(note);
  }

  // ---- board search --------------------------------------------------------------------
  // How well a board matches the typed term: 0 exact, 1 name or key starts with it, 2 key contains it, 3 name contains it.
  function matchRank(key, name, term) {
    var k = key.toLowerCase(), n = name.toLowerCase();
    if (k === term || n === term) return 0;
    if (k.indexOf(term) === 0 || n.indexOf(term) === 0 || k.split("/").some(function (part) { return part.indexOf(term) === 0; })) return 1;
    if (k.indexOf(term) >= 0) return 2;
    if (n.indexOf(term) >= 0) return 3;
    return -1;
  }
  function renderResults(term) {
    var ul = $("results"); ul.innerHTML = "";
    term = (term || "").toLowerCase().trim();
    var hits = [], boards = window.BOARDS || null;
    HAND.forEach(function (h) { var r = term ? matchRank(h.k, h.n, term) : 0; if (r >= 0) hits.push({ hand: h, rank: r }); });
    if (term && boards) boards.concat(window.ZMKBOARDS || []).forEach(function (b) { var r = matchRank(b.k, b.n, term); if (r >= 0) hits.push({ qmk: b, rank: r }); });
    if (term && !boards) {
      // the QMK list is still to come: show the user-added boards now, the rest when it lands
      loadBoards().then(function () { if (($("search").value || "").toLowerCase().trim() === term) renderResults(term); }, function () {});
    }
    hits.sort(function (a, b) {
      if (!!a.hand !== !!b.hand) return a.hand ? -1 : 1;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return (a.hand || a.qmk).k < (b.hand || b.qmk).k ? -1 : 1;
    });
    function addInfo(text) { var li = document.createElement("li"); li.className = "info"; li.textContent = text; ul.appendChild(li); }
    var shown = hits.slice(0, 60);
    shown.forEach(function (h) {
      var li = document.createElement("li"), pick;
      if (h.hand) { li.innerHTML = "<b>" + esc(h.hand.k) + "</b> <span class=d>" + t("js.results.userboard", "{name}, {keys} (user-added board file)", { name: esc(h.hand.n), keys: tn("js.keys", h.hand.keys.length, "{n} key", "{n} keys") }) + "</span>";
        pick = function () { selectHand(h.hand); state.pickerOpen = false; setBoardNote(M("js.board.choice", "{board}: your choice.", { board: boardLabel() })); }; }
      else { var lay = Object.keys(h.qmk.l).map(function (ln) { return ln + " (" + h.qmk.l[ln] + ")"; }).join(", ");
        li.innerHTML = "<b>" + esc(h.qmk.k) + "</b> <span class=d>" + (h.qmk.n.toLowerCase() === h.qmk.k ? "" : esc(h.qmk.n) + ": ") + esc(lay) + "</span>";
        pick = function () { selectBoard(h.qmk, null); state.pickerOpen = false; setBoardNote(M("js.board.choice", "{board}: your choice.", { board: boardLabel() })); }; }
      var chosen = !!(state.board && ((h.hand && state.board.k === h.hand.k) || (h.qmk && state.board.k === h.qmk.k)));
      if (chosen) li.className = "sel";
      li.setAttribute("aria-selected", chosen ? "true" : "false");   // an option in the results listbox
      li.onclick = pick; keyActivate(li, pick, "option");
      ul.appendChild(li);
    });
    if (term && !hits.length) addInfo(boards ? t("js.results.nomatch", "No keyboard matches \"{term}\". Try a shorter word, or draw a plain grid.", { term: term })
                                             : t("js.board.loading", "Loading the board list..."));
    if (hits.length > 60) addInfo(t("js.results.more", "{n} more not shown; type more of the name.", { n: hits.length - 60 }));
    var gridChosen = !!(state.board && state.board.k === "grid");
    $("gridbtn").className = gridChosen ? "on" : "";
    $("gridbtn").setAttribute("aria-pressed", gridChosen ? "true" : "false");
  }
  $("gridbtn").onclick = function () {
    state.board = { k: "grid", n: t("js.grid.name", "Matrix grid") }; state.layout = null; $("layoutrow").className = "row hidden";
    state.pickerOpen = false;   // a choice made by hand folds the picker like a found board does
    setBoardNote(gridMode() === "sure" ? M("js.grid.sure", "Plain grid in two halves: the second half of the matrix rows beside the first, mirrored, since every board with this matrix is split.")
      : gridMode() === "guess" ? M("js.grid.guess", "Plain grid in two halves: the second half of the matrix rows beside the first, mirrored (a guess from the matrix shape).")
      : M("js.grid.plain", "Plain grid: every key in its matrix row and column."));
    renderResults($("search").value); update(true);
  };

  function selectUsb(rec) {
    state.board = { k: "usb", n: rec.name, usb: true, rec: rec }; state.layout = null; $("layoutrow").className = "row hidden";
    renderResults($("search").value); update(true);
  }
  function selectHand(h) { state.board = { k: h.k, n: h.n, hand: true, rec: h }; state.layout = null; $("layoutrow").className = "row hidden"; renderResults($("search").value); update(true); }
  function selectDtsi(fileName, board) {
    state.board = { k: fileName, n: board.name, dtsi: true, rec: board }; state.layout = null;
    $("layoutrow").className = "row hidden"; renderResults($("search").value); update(true);
  }
  $("dtsifile").addEventListener("change", function () {
    var f = this.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var layouts = vilimg.zmkLayouts(String(reader.result), f.name);
        var count = state.km && state.km.positional && state.km.positional[0] ? state.km.positional[0].length : 0;
        var chosen = null;
        layouts.forEach(function (l) { if (!chosen && count && l.keys.length === count) chosen = l; });
        chosen = chosen || layouts[0];
        var board = vilimg.boardFromZmkLayout(chosen, f.name.replace(/\.(dtsi|overlay|dts)$/i, ""),
                                              "ZMK physical layout (" + f.name + ")");
        selectDtsi(f.name, board);
        state.pickerOpen = false;
        setBoardNote(M("js.board.dtsi", "{board}: from the ZMK layouts file{which}.",
          { board: boardLabel(), which: layouts.length > 1 ? M("js.board.dtsiwhich", " ({name} of its {n} layouts, matched by key count)", { name: chosen.name, n: layouts.length }) : "" }));
        update(true);
      } catch (e) {
        setBoardNote(M("js.board.dtsibad", "Could not read {name}: {msg}", { name: f.name, msg: e.message }));
      }
    };
    reader.readAsText(f);
  });

  function selectBoard(b, layout) {
    var names = Object.keys(b.l);
    if (!layout) {
      // prefer the layout whose key count matches the file, else the largest
      var want = state.km && state.km.kind === "vil" ? vilimg.positions(state.km).length
               : state.km && state.km.positional && state.km.positional[0] ? state.km.positional[0].length : null;
      layout = names[0];
      names.forEach(function (ln) { if (b.l[ln] > b.l[layout]) layout = ln; });
      if (want) names.forEach(function (ln) { if (b.l[ln] === want) layout = ln; });
    }
    state.board = { k: b.k, n: b.n, l: b.l, z: b.z }; state.layout = layout;
    var row = $("layoutrow"), span = $("layouts"); span.innerHTML = "";
    if (names.length > 1) {
      names.forEach(function (ln) {
        var lab = document.createElement("label"); lab.style.display = "inline-block"; lab.style.marginRight = "12px";
        var r = document.createElement("input"); r.type = "radio"; r.name = "layout"; r.checked = ln === layout;
        r.onchange = function () { state.layout = ln; update(true); };
        lab.appendChild(r); lab.appendChild(document.createTextNode(" " + ln + " (" + tn("js.keys", b.l[ln], "{n} key", "{n} keys") + ")"));
        span.appendChild(lab);
      });
      row.className = "row";
    } else row.className = "row hidden";
    renderResults($("search").value); update(true);
  }

  // ---- layers ---------------------------------------------------------------------------
  function renderLayers() {
    var box = $("layers"); box.innerHTML = "";
    if (!state.layers.length) { box.innerHTML = '<span class="note">' + esc(t("js.nokeymap", "Choose a keymap first.")) + '</span>'; return; }
    state.layers.forEach(function (l) {
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!state.chosen[l.i]; cb.disabled = !l.keys;
      cb.onchange = function () { state.chosen[l.i] = cb.checked; update(true); };
      var lab = document.createElement("label"); if (!l.keys) lab.className = "empty";
      lab.appendChild(cb); lab.appendChild(document.createTextNode(t("js.layer", "Layer {i}", { i: l.i }) + (l.keys ? " (" + tn("js.keys", l.keys, "{n} key", "{n} keys") + ")" : t("js.layer.empty", " (empty)"))));
      box.appendChild(lab);
      if (!l.keys) return;   // an empty layer gets the dimmed line only, no name box
      var nm = document.createElement("input"); nm.type = "text"; nm.placeholder = t("js.layer.placeholder", "e.g. Base, Function and numbers, Symbols, Navigation"); nm.value = state.names[l.i] || "";
      nm.setAttribute("aria-label", t("js.layer.aria", "Name for layer {i}", { i: l.i }));
      nm.oninput = function () { if (nm.value.trim()) state.names[l.i] = nm.value.trim(); else delete state.names[l.i]; update(); };
      box.appendChild(nm);
    });
  }

  // ---- styles ---------------------------------------------------------------------------
  // Styles are grouped into families: "outrun" and "outrun_light" share one row (Dark / Light
  // buttons), and the colour variants of the printer card share the "plain" row (Black / Blue / Cream).
  var VARIANT_SUFFIXES = ["light", "dark", "ink", "cream"];
  var FAMILIES = [];
  (function () {
    var byName = {}; STYLES.forEach(function (s) { byName[s.name] = s; });
    var used = {};
    STYLES.forEach(function (s) {
      if (used[s.name]) return;
      var m = s.name.match(/^(.*)_([a-z]+)$/);
      var base = m && VARIANT_SUFFIXES.indexOf(m[2]) >= 0 && byName[m[1]] ? m[1] : s.name;
      if (used[base]) return;
      var variants = [byName[base]];
      VARIANT_SUFFIXES.forEach(function (v) { if (byName[base + "_" + v]) variants.push(byName[base + "_" + v]); });
      variants.forEach(function (v) { used[v.name] = true; });
      FAMILIES.push({ base: base, desc: byName[base].desc, variants: variants });
    });
    FAMILIES.sort(function (a, b) { return (a.base === "plain" ? 0 : 1) - (b.base === "plain" ? 0 : 1); });
  })();
  function isColourFamily(f) { return f.variants.some(function (x) { return /_(ink|cream)$/.test(x.name); }); }
  function variantLabel(f, v) {
    if (isColourFamily(f)) return /_ink$/.test(v.name) ? "Blue" : /_cream$/.test(v.name) ? "Cream" : "Black";
    if (/_light$/.test(v.name)) return "Light";
    if (/_dark$/.test(v.name)) return "Dark";
    // the base style: its sibling tells which side it is on
    return f.variants.some(function (x) { return /_dark$/.test(x.name); }) ? "Light" : "Dark";
  }
  var VARIANT_ORDER = { Dark: 0, Light: 1, Black: 0, Blue: 1, Cream: 2 };
  function variantText(f, v) {
    var label = variantLabel(f, v);
    if (label === "Dark") return t("js.theme.dark", "Dark");
    if (label === "Light") return t("js.theme.light", "Light");
    if (label === "Blue") return t("js.variant.blue", "Blue");
    if (label === "Cream") return t("js.variant.cream", "Cream");
    return t("js.variant.black", "Black");
  }
  function previewVariant() {
    return $("halves").checked ? ".halves" : $("dual").checked ? ".dual" : "";
  }
  function previewCaption(name) {
    var v = previewVariant();
    return name + (name === state.style && !state.customStyle ? t("js.preview.chosen", " (chosen)") : "")
      + (v === ".halves" ? t("js.preview.halves", ", split halves") : v === ".dual" ? t("js.preview.dual", ", dual monitor") : "");
  }
  // The picture under Image style: the gallery sample in local mode, the drawn sheet in live mode (where
  // a hover waits HOVER_DELAY so a sweep across the list draws once, at the row it stops on).
  var HOVER_DELAY = 40;
  function showPreview(name, delay) {
    if (LIVE) { if (state.km) previewLive(name, delay); return; }
    var v = previewVariant();
    $("previewimg").src = "docs/gallery/" + name + v + ".webp";
    $("previewimg").alt = name;
    $("previewname").textContent = previewCaption(name);
  }
  function showChosen() { showPreview(state.customStyle || state.style); }
  function choose(name) {
    state.style = name; state.customStyle = ""; $("stylefile").value = "";
    remember("style", name); remember("stylefile", "");
    renderStyles(); update(true); if (!LIVE) showPreview(name);
  }
  var STYLE_ROWS_SHOWN = 10;   // the list is this many rows tall; the rest scroll inside it
  function renderStyles() {
    var box = $("styles"), keepScroll = box.scrollTop; box.innerHTML = "";
    var term = ($("stylefilter").value || "").toLowerCase();
    $("stylefilter").className = "stylefilter" + (STYLES.length > 10 ? "" : " hidden");
    FAMILIES.forEach(function (f) {
      if (term && f.variants.every(function (v) { return v.name.indexOf(term) < 0; })) return;
      var chosenHere = f.variants.filter(function (v) { return v.name === state.style && !state.customStyle; })[0];
      var shown = chosenHere || f.variants[0];
      var row = document.createElement("div"); row.className = "srow" + (chosenHere ? " sel" : "");
      // The family name is a real button and the Dark/Light choices are real buttons beside it, so
      // no button sits inside another control; the row itself is only a wider click target.
      var name = document.createElement("button"); name.type = "button"; name.className = "sname";
      name.innerHTML = esc(f.base) + (f.base === "plain" ? ' <span class="sdefault">' + esc(t("js.style.default", "(default)")) + '</span>' : "");
      name.setAttribute("aria-pressed", chosenHere ? "true" : "false");
      name.onclick = function (e) { e.stopPropagation(); choose(shown.name); };
      name.onfocus = function () { showPreview(shown.name, HOVER_DELAY); };
      row.appendChild(name);
      if (f.variants.length > 1) {
        var vs = document.createElement("div"); vs.className = "variants";
        // Dark on the left, Light on the right, whichever of the two is the base style; Black, Blue, Cream for plain
        var ordered = f.variants.slice().sort(function (x, y) { return VARIANT_ORDER[variantLabel(f, x)] - VARIANT_ORDER[variantLabel(f, y)]; });
        ordered.forEach(function (v) {
          // Buttons say Dark or Light (or a colour); the real style name (outrun_light) goes into the command.
          var b = document.createElement("button"); b.type = "button"; b.textContent = variantText(f, v); b.title = v.name;
          b.setAttribute("aria-label", v.name); b.className = chosenHere && v.name === chosenHere.name ? "on" : "";
          b.setAttribute("aria-pressed", chosenHere && v.name === chosenHere.name ? "true" : "false");
          b.onclick = function (e) { e.stopPropagation(); choose(v.name); };
          b.onmouseenter = function (e) { e.stopPropagation(); showPreview(v.name, HOVER_DELAY); };
          b.onfocus = function () { showPreview(v.name, HOVER_DELAY); };
          vs.appendChild(b);
        });
        row.appendChild(vs);
      }
      row.onclick = function (e) { if (e && e.target && e.target.closest("button")) return; choose(shown.name); };
      row.onmouseenter = function () { showPreview(shown.name, HOVER_DELAY); };
      box.appendChild(row);
    });
    box.onmouseleave = function () { showPreview(state.customStyle || state.style, HOVER_DELAY); };
    box.scrollTop = keepScroll;
    sizeStyleList();
  }
  // Ten rows tall, measured from the rows themselves (all the same height); a shorter list is its own
  // height. The section is hidden until a keymap is read, so setLocked calls this again when it opens.
  function sizeStyleList() {
    var box = $("styles"), rows = box.children;
    if (!rows.length || !rows[0].offsetHeight) return;   // not laid out yet (the step is locked)
    box.style.height = "";
    if (rows.length > STYLE_ROWS_SHOWN) {   // border-box: the frame is added on top of the ten rows
      box.style.height = (rows[STYLE_ROWS_SHOWN].offsetTop - rows[0].offsetTop + box.offsetHeight - box.clientHeight) + "px";
    }
    var sel = box.querySelector(".srow.sel");
    if (sel) {   // the chosen style is brought into the window when it sits outside it (a remembered choice, a fresh load)
      var top = sel.offsetTop - rows[0].offsetTop;
      if (top < box.scrollTop || top + sel.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top - (box.clientHeight - sel.offsetHeight) / 2;
    }
  }
  // Full size: the sample picture (from a folder), or the drawn sheet itself scaled to the window (live).
  function openLightbox() {
    if (LIVE && state.km) {
      if (!state.sheets.length) return;
      var frame = $("lightframe");
      frame.width = /<body class="dual"/.test(state.sheets[0]) ? 3840 : 1920; frame.height = 1080;
      frame.srcdoc = state.sheets[0];
      $("lightcap").textContent = previewCaption(state.sheetStyle || state.style);
      $("lightbox").className = "on live"; fitLightbox();
      return;
    }
    $("lightimg").src = $("previewimg").src; $("lightcap").textContent = $("previewname").textContent; $("lightbox").className = "on";
  }
  function fitLightbox() {
    var frame = $("lightframe"), wrap = $("lightwrap");
    if (!frame.width || $("lightbox").className.indexOf("live") < 0) return;
    var s = Math.min((window.innerWidth - 48) / frame.width, (window.innerHeight - 72) / frame.height);
    frame.style.transform = "scale(" + s + ")";
    wrap.style.width = Math.round(frame.width * s) + "px"; wrap.style.height = Math.round(frame.height * s) + "px";
  }
  function closeLightbox() {
    if (!$("lightbox").className) return;
    $("lightbox").className = ""; $("lightframe").removeAttribute("srcdoc");
  }
  window.addEventListener("resize", fitLightbox);
  $("previewimg").onclick = openLightbox; $("previewzoom").onclick = openLightbox;
  $("lightbox").onclick = closeLightbox;
  $("stylefilter").addEventListener("input", renderStyles);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLightbox(); });

  // ---- live drawing ---------------------------------------------------------------------
  // Styles are fetched once each (sheet plus fonts, embedded as data URIs) and kept for the session.
  var styleCache = {};
  function base64Of(buf) {
    var bytes = new Uint8Array(buf), s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // Scripts and style sheets carry the version on the address, as the page's own script tags do,
  // so a browser that cached an earlier release fetches the new files (the message keeps the bare url).
  function versioned(url) { return url + (url.indexOf("?") < 0 ? "?v=" + vilimg.version : ""); }
  function fetchText(url) {
    return fetch(versioned(url)).then(function (r) {
      if (!r.ok) { var e = new Error(url + ": HTTP " + r.status); e.status = r.status; throw e; }
      return r.text();
    });
  }
  function loadStyle(name) {
    if (!styleCache[name]) {
      var base = fetchText("styles/_base.css").catch(function (e) { throw new Error(t("js.style.base", "the style files could not be fetched ({msg})", { msg: e.message })); });
      // "not found" only when the server said so; a dropped connection is reported as what it is
      var own = fetchText("styles/" + name + ".css").catch(function (e) {
        throw new Error(e.status === 404 ?
          t("js.style.missing", "there is no style called {name} (styles/{name}.css was not found)", { name: name }) :
          t("js.style.fetch", "styles/{name}.css could not be fetched ({msg}); check the connection to this page and try again", { name: name, msg: e.message }));
      });
      styleCache[name] = Promise.all([base, own]).then(function (parts) {
        var css = parts[0] + "\n" + parts[1];
        var refs = vilimg.fontRefs(css);
        return Promise.all(refs.map(function (f) {
          return fetch("fonts/" + f).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).then(function (buf) { return [f, buf]; });
        })).then(function (pairs) {
          var files = {};
          pairs.forEach(function (p) { if (p[1]) files[p[0]] = base64Of(p[1]); });
          return vilimg.inlineFonts(css, files).css;
        });
      });
      styleCache[name].catch(function () { delete styleCache[name]; });
    }
    return styleCache[name];
  }
  // Key positions for the chosen board, as vilimg.js wants them; built once per board and
  // layout for the current file (a hover across the styles redraws without rebuilding it).
  var geomCache = {};
  function loadGeometry() {
    var km = state.km, b = state.board, layout = state.layout;
    if (!km || !b) return Promise.reject(new Error(t("js.live.noboard", "Choose your keyboard in the Keyboard section and the picture is drawn here.")));
    var key = b.k + "|" + (layout || "") + "|" + (b.k === "grid" ? gridMode() : "");
    if (geomCache[key]) return Promise.resolve(geomCache[key]);
    var p;
    if (b.k === "grid") p = Promise.resolve(km.layers.length ? vilimg.gridBoard(km, gridMode()) : vilimg.positionalGrid(km));
    else if (b.usb || b.dtsi) p = Promise.resolve(vilimg.normBoard(b.rec));
    else if (b.hand) {
      var h = b.rec;
      p = Promise.resolve(vilimg.normBoard({ name: h.n, slug: h.k, matrix: [h.r, h.c], uids: h.u, keys: h.keys || [],
        source: "boards/" + h.k + ".json" }));
    } else {
      p = (b.z ? loadZmkIndex() : loadIndex()).then(function (idx) {
        var rec = idx.boards[b.k];
        if (!rec) throw new Error(t("js.index.notlisted", "{board} is not in the board list", { board: b.k }));
        var geom = vilimg.boardFromIndex(b.k, rec, layout);
        if (b.z) geom.zmk_order = true;   // a ZMK layout's keys are already in the keymap's order
        return geom;
      });
    }
    return p.then(function (geom) { geomCache[key] = geom; return geom; });
  }
  function liveOptions(styleName) {
    var all = state.layers.filter(function (l) { return l.keys; }).map(function (l) { return l.i; });
    var sel = all.filter(function (i) { return state.chosen[i]; });
    var names = {}; Object.keys(state.names).forEach(function (k) { names[String(k)] = state.names[k]; });
    var notes = [];
    if (state.board && state.board.k === "grid") notes.push("matrix grid: real shape unknown");
    var halves = $("halves").checked && state.geom && vilimg.isSplit(state.geom);
    return { layers: sel.length ? sel : all, names: names, title: state.file.replace(/\.(vil|json|keymap)$/i, ""),
             date: new Date().toISOString().slice(0, 10), styleName: styleName, note: notes.join("; "),
             dual: $("dual").checked, halves: halves, labels: {}, combos: $("combos").value };
  }
  var liveSeq = 0;
  function livePreview(styleName) {
    if (!LIVE || !state.km) return;
    if (!state.board) {
      // no board yet: nothing is drawn, and the note says whether the page is still looking or waiting for a choice
      clearSheet();
      var looking = state.boardNote && (state.boardNote.id === "js.board.loading" || state.boardNote.id === "js.board.looking");
      $("livenote").textContent = looking ? t("js.live.waiting", "Finding your keyboard...")
                                          : t("js.live.noboard", "Choose your keyboard in the Keyboard section and the picture is drawn here.");
      return;
    }
    var seq = ++liveSeq;
    $("previewname").textContent = previewCaption(styleName);
    $("livenote").textContent = "";
    var geomP = loadGeometry();
    // a .vil with bare-number keycodes needs the number-to-name table before it is drawn
    var tableP = vilimg.hasNumberCodes(state.km) ? loadScript("docs/keycodes.js") : Promise.resolve();
    Promise.all([geomP, loadStyle(styleName), tableP]).then(function (r) {
      if (seq !== liveSeq) return;   // a newer request has taken over
      var geom = r[0], css = r[1];
      state.geom = geom;
      var km = state.km;
      if (km.positional) vilimg.resolvePositional(km, geom);
      $("halves").title = (state.geom && !vilimg.isSplit(state.geom) && $("dual").checked) ? t("js.live.notsplit", "This keyboard is not split: whole layers go on both screens.") : "";
      var opts = liveOptions(styleName);
      var sheets = vilimg.renderPages(km, geom, css, opts);
      if (styleName === (state.customStyle || state.style)) { state.sheets = sheets; state.sheetStyle = styleName; }
      showSheet(sheets[0], opts.dual);
      var n = sheets.length;
      $("livenote").textContent = (n > 1 ? t("js.live.sheets", "Sheet 1 of {n} shown; the download has all {n}. ", { n: n }) : "") +
        (km.warnings.length ? km.warnings.join(" ") : "");
      $("livewrap").removeAttribute("data-stale");
      setDownloads(true);
    }, function (e) {
      if (seq !== liveSeq) return;
      // the drawing on screen is the previous one: dimmed, and captioned with its own style
      $("livewrap").setAttribute("data-stale", "1");
      $("previewname").textContent = state.sheetStyle ? previewCaption(state.sheetStyle) : "";
      $("livenote").textContent = t("js.live.fail", "Could not draw the picture: {msg}", { msg: e.message });
    });
  }
  function showSheet(html, dual) {
    var frame = $("live"), wrap = $("livewrap");
    if (html === state.shownHtml) return;   // the sheet on screen already (a hover back onto the chosen style)
    state.shownHtml = html;
    var w = dual ? 3840 : 1920;
    frame.width = w; frame.height = 1080;
    frame.srcdoc = html;
    // data-style on the frame is read by the maintainer's browser tests, nothing on the page
    frame.setAttribute("data-style", state.sheetStyle && html === (state.sheets[0] || null) ? state.sheetStyle : (html.match(/data-style="([^"]*)"/) || [0, ""])[1]);
    wrap.setAttribute("data-dual", dual ? "1" : "0");
    fitFrame();
  }
  function fitFrame() {
    var frame = $("live"), wrap = $("livewrap");
    if (!frame.width) return;
    var w = wrap.clientWidth || 1, s = w / frame.width;
    frame.style.transform = "scale(" + s + ")";
    wrap.style.height = Math.round(frame.height * s) + "px";
  }
  window.addEventListener("resize", fitFrame);
  // One timer for every redraw, so the several calls one click makes become one drawing and a
  // later request replaces an earlier one: clicks and hovers draw at once (delay 0 or HOVER_DELAY),
  // typing in a name box waits 120 ms for the next keystroke.
  var liveTimer = null;
  function previewLive(styleName, delay) {
    if (!LIVE || !state.km) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { livePreview(styleName); }, delay || 0);
  }
  function liveRefresh(delay) { previewLive(state.customStyle || state.style, delay); }
  // The download buttons and "View large" work only while a drawn sheet is on screen (live mode;
  // from a folder "View large" opens the sample picture and stays on).
  function setDownloads(on) {
    ["dlsvg", "dlpng", "dlleft", "dlright"].forEach(function (id) { $(id).disabled = !on; });
    if (LIVE) $("previewzoom").disabled = !on;
  }
  // Nothing to show: the previous file's drawing goes, so it is never taken for the new file's.
  function clearSheet() {
    var frame = $("live");
    frame.removeAttribute("srcdoc"); frame.removeAttribute("data-style");
    state.shownHtml = ""; state.sheets = []; state.sheetStyle = "";
    $("livewrap").removeAttribute("data-stale"); $("previewname").textContent = "";
  }
  function download(name, blob) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function outputStem() { return state.file.replace(/\.(vil|json|keymap)$/i, "") + "." + (state.customStyle || state.style); }
  function sheetSize() {
    var dual = /<body class="dual"/.test(state.sheets[0]);
    return { width: dual ? 3840 : 1920, height: 1080 };
  }

  // ---- SVG and PNG in the browser -------------------------------------------------------
  // The drawn sheet goes into an SVG foreignObject; that SVG is the file "Download SVG" saves,
  // and for the PNG it goes into an Image and the Image onto a canvas. The fonts are data URIs
  // inside the sheet's own style, so nothing is fetched and the SVG stands on its own. An SVG
  // image has no body element, so the style's body and html rules are re-pointed at the div
  // that wraps the sheet. Safari taints the canvas for this and cannot export the PNG; the SVG
  // is plain text and saves everywhere.
  var IS_SAFARI = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
  (function () {
    $("safarinote").style.display = IS_SAFARI ? "" : "none";
    $("dlpng").style.display = IS_SAFARI ? "none" : "";
  })();
  function rewriteBody(css) {
    // data URIs stay as they are: "body" could occur inside base64
    var parts = css.split(/(url\(data:[^)]*\))/);
    for (var i = 0; i < parts.length; i += 2) parts[i] = parts[i].replace(/\bhtml\b|\bbody\b/g, ".vbody");
    return parts.join("");
  }
  function xmlText(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function svgOf(html, width, height) {
    var sm = /<style>([\s\S]*?)<\/style>/.exec(html);
    var bm = /<body class="([^"]*)" style="([^"]*)" data-style="([^"]*)">([\s\S]*)<\/body>/.exec(html);
    if (!sm || !bm) throw new Error(t("js.png.markup", "the drawn sheet is not in the form the picture step expects"));
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
      '<foreignObject width="100%" height="100%">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" class="vbody ' + bm[1] + '" style="' + bm[2] + ';margin:0;overflow:hidden" data-style="' + bm[3] + '">' +
      "<style>" + xmlText(rewriteBody(sm[1])) + "</style>" + bm[4] + "</div></foreignObject></svg>";
  }
  $("dlsvg").onclick = function () {
    if (!state.sheets.length) return;
    var note = $("pngnote"), size = sheetSize(), stem = outputStem();
    try {
      state.sheets.forEach(function (html, i) {
        var suffix = state.sheets.length > 1 ? "." + (i + 1) : "";
        download(stem + suffix + ".svg", new Blob([svgOf(html, size.width, size.height)], { type: "image/svg+xml" }));
      });
      note.textContent = "";
    } catch (e) {
      note.textContent = t("js.svg.fail", "Could not make the SVG: {msg}", { msg: e && e.message ? e.message : String(e) });
    }
  };
  function loadSvg(svg) {
    return new Promise(function (ok, fail) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = function () { fail(new Error(t("js.png.nodraw", "the browser could not draw the sheet as an image"))); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }
  async function toCanvas(html, width, height, scale) {
    var img = await loadSvg(svgOf(html, width, height));
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(t("js.png.toolarge", "this picture is too large for the browser; try 1x"));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // fonts inside the image can finish decoding after the first paint: draw once more a moment later
    await new Promise(function (r) { setTimeout(r, 250); });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  function canvasBlob(canvas, x, w) {
    return new Promise(function (ok, fail) {
      var c = canvas;
      if (x != null) {
        c = document.createElement("canvas"); c.width = w; c.height = canvas.height;
        c.getContext("2d").drawImage(canvas, x, 0, w, canvas.height, 0, 0, w, canvas.height);
      }
      try { c.toBlob(function (b) { if (b) ok(b); else fail(new Error(t("js.png.noencode", "the browser could not encode the PNG"))); }, "image/png"); }
      catch (e) { fail(e); }
    });
  }
  async function downloadPng(which) {
    if (!state.sheets.length) return;
    var note = $("pngnote"), buttons = ["dlpng", "dlleft", "dlright"].map($);
    note.textContent = t("js.png.drawing", "Drawing...");
    buttons.forEach(function (b) { b.disabled = true; });
    try {
      var scale = $("scale2").checked ? 2 : 1;
      var size = sheetSize(), width = size.width, height = size.height, stem = outputStem();
      for (var i = 0; i < state.sheets.length; i++) {
        var suffix = state.sheets.length > 1 ? "." + (i + 1) : "";
        var canvas = await toCanvas(state.sheets[i], width, height, scale);
        if (which === "left") download(stem + suffix + ".left.png", await canvasBlob(canvas, 0, canvas.width / 2));
        else if (which === "right") download(stem + suffix + ".right.png", await canvasBlob(canvas, canvas.width / 2, canvas.width / 2));
        else download(stem + suffix + ".png", await canvasBlob(canvas));
      }
      note.textContent = "";
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      if (/security|tainted/i.test(msg)) msg = t("js.png.taint", "this browser does not allow it; download the SVG instead");
      note.textContent = t("js.png.fail", "Could not make the PNG: {msg}", { msg: msg });
    } finally {
      buttons.forEach(function (b) { b.disabled = false; });
    }
  }
  $("dlpng").onclick = function () { downloadPng("all"); };
  $("dlleft").onclick = function () { downloadPng("left"); };
  $("dlright").onclick = function () { downloadPng("right"); };
  $("scale1").addEventListener("change", function () { remember("scale", "1"); update(true); });
  $("scale2").addEventListener("change", function () { remember("scale", "2"); update(true); });

  // ---- the command ----------------------------------------------------------------------
  // Quoting for the shell the command is meant for: cmd.exe and PowerShell take double quotes
  // (an inner one escaped); bash and zsh take single quotes, which stop $ and ! from expanding.
  function q(s) {
    if (!/[\s"'$`!&|<>()]/.test(s)) return s;
    if (state.os === "win") return '"' + s.replace(/"/g, '\\"') + '"';
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }
  function command() {
    var py = state.os === "win" ? "python" : "python3";
    var parts = [py, "keymap-imgen.py", state.customStyle || state.style];
    var usb = !!(state.board && state.board.usb);
    if (usb) parts.push("--from-usb");                 // the command reads the same keyboard itself
    else if (state.file) parts.push(q("keymaps/" + state.file));
    if (!usb && state.board && state.board.k === "grid") parts.push("--board", "grid");   // the command draws the same grid
    else if (!usb && state.board) {
      var km = state.km, auto = km.kind === "qmk" && state.board.k === km.keyboard;
      if (!auto || state.board.hand) parts.push("--board", q(state.board.k));
      if (state.layout && !(auto && state.layout === km.layout_name)) parts.push("--layout", state.layout);
    }
    var all = state.layers.filter(function (l) { return l.keys; }).map(function (l) { return l.i; });
    var sel = all.filter(function (i) { return state.chosen[i]; });
    if (sel.length && sel.length !== all.length) parts.push("--layers", sel.join(","));
    var order = sel.length ? sel : all;
    var named = order.some(function (i) { return state.names[i]; });
    // a comma inside a name would split it on the command line, and a character outside ASCII does not
    // survive every shell and .bat file; the settings file carries such names intact
    state.commaName = named && order.some(function (i) { return /[,\u0080-\uffff]/.test(state.names[i] || ""); });
    if (named && !state.commaName) parts.push("--names", q(order.map(function (i) { return state.names[i] || ("Layer " + i); }).join(",")));
    if (!$("png").checked) parts.push("--no-png");
    if ($("halves").checked) parts.push("--split-halves");
    else if ($("dual").checked) parts.push("--dual-monitor");
    if ($("combos").value !== "badges") parts.push("--combos", $("combos").value);
    return parts.join(" ");
  }
  function settings() {
    var s = {};
    if (state.file) s.title = state.file.replace(/\.(vil|json|keymap)$/i, "");
    if (state.board && !state.board.usb) s.board = state.board.k;   // "grid" included: the command accepts it
    if (state.layout) s.layout = state.layout;
    var sel = state.layers.filter(function (l) { return l.keys && state.chosen[l.i]; }).map(function (l) { return l.i; });
    if (sel.length) s.layers = sel;
    var names = {}; Object.keys(state.names).forEach(function (k) { names[k] = state.names[k]; });
    if (Object.keys(names).length) s.names = names;
    if ($("combos").value !== "badges") s.combos = $("combos").value;
    s.labels = {};
    return s;
  }
  // Everything that follows the controls: the command, the notes, and (live) a redraw. `now`
  // means the change was a click, so the redraw does not wait for more typing.
  function update(now) {
    var dual = $("dual").checked;
    $("halves").disabled = !dual;
    if (!dual) $("halves").checked = false;
    $("halves").parentNode.className = "indent" + (dual ? "" : " off");
    $("pngsize").textContent = dual ? t("js.size.png.dual", "7680 x 2160, two 4K screens side by side") : t("js.size.png", "4K, 3840 x 2160");
    $("size1").textContent = dual ? t("js.size1.dual", "3840 x 1080, two screens") : t("js.size1", "1920 x 1080");
    $("size2").textContent = dual ? t("js.size2.dual", "7680 x 2160, two 4K screens") : t("js.size2", "3840 x 2160, 4K");
    $("dlleft").style.display = dual && !IS_SAFARI ? "" : "none";
    $("dlright").style.display = dual && !IS_SAFARI ? "" : "none";
    var noCmb = !!state.km && !vilimg.comboEntries(state.km).length;
    $("combos").disabled = noCmb;
    $("combosnote").className = "note" + (noCmb ? "" : " hidden");
    $("cmd").textContent = command();
    $("namesnote").className = "note" + (state.commaName ? "" : " hidden");
    $("usbcmdnote").className = "note" + (state.board && state.board.usb ? "" : " hidden");
    $("usbcmd").textContent = usbCommand();
    liveRefresh(now === true ? 0 : 120);
  }

  // ---- wiring ---------------------------------------------------------------------------
  // A settings file's layers and names over the defaults parseFile set (the page's sample has one).
  function applySettings(side) {
    if (Array.isArray(side.layers)) state.layers.forEach(function (l) { state.chosen[l.i] = l.keys > 0 && side.layers.indexOf(l.i) >= 0; });
    if (side.names && typeof side.names === "object") Object.keys(side.names).forEach(function (i) { if (side.names[i]) state.names[i] = String(side.names[i]); });
    if (["badges", "lines", "panel", "text", "off"].indexOf(side.combos) >= 0) $("combos").value = side.combos;
  }
  function handleText(name, text, usbBoard, side) {
    var err = parseFile(name, text);
    if (!err && side) applySettings(side);
    state.usbBoard = err ? null : (usbBoard || null);
    // the chosen file's name, under the button (the native control is not drawn); a USB read has no file
    $("filename").textContent = err || usbBoard ? "" : name;
    $("filename").className = err || usbBoard ? "hidden" : "";
    // the previous file's downloads go until the new one is drawn (livePreview enables them again)
    setDownloads(false);
    if (err) {
      // a bad file leaves nothing of the previous one behind
      resetFile(); state.fileErr = err; if (LIVE) { clearSheet(); $("livenote").textContent = ""; } $("boardsum").textContent = ""; $("layoutrow").className = "row hidden";
      state.pickerOpen = true; renderPicker(); setLocked(true);
      renderLayers(); renderResults($("search").value); update();
      renderStatus();
      return;
    }
    setLocked(false);
    renderLayers(); autoBoard(); renderStatus(); update(true);
    revealStatus();
  }

  // ---- reading the keyboard over USB (WebHID) --------------------------------------------
  // Chromium browsers only (WebHID). The same read-only requests the Vial app makes: the keyboard id, its
  // compressed definition (decoded with the vendored xzwasm), the VIA protocol, the layer count
  // and the keymap buffer. Nothing is written to the keyboard.
  // Why the read cannot happen here, or "" when it can. Shown under the button, and again in
  // the status line when the button is pressed anyway, so a press is never silent.
  function usbBlocked() {
    // the address first: on a plain http page Chrome hides navigator.hid altogether
    if (!window.isSecureContext) {
      return t("js.usb.insecure", "Not available at this address: browsers allow USB access only on https pages, on localhost, or on a page opened from a folder. Open the page from the downloaded folder (Chrome, Edge or another Chromium browser) to read the keyboard, then save the keymap file it offers.");
    }
    if (!(navigator.hid && navigator.hid.requestDevice)) {
      return t("js.usb.nohid", "Not available in this browser: reading a keyboard needs WebHID, which Chrome, Edge and other Chromium browsers have and Firefox and Safari do not.");
    }
    return "";
  }
  function renderUsbNote() {
    var blocked = usbBlocked();
    $("usbnote").textContent = blocked;
    $("usbnote").className = "note usbwhy" + (blocked ? "" : " hidden");
  }
  renderUsbNote();
  var scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise(function (ok, fail) {
        var s = document.createElement("script"); s.src = versioned(src);
        s.onload = function () { ok(); };
        s.onerror = function () { delete scriptCache[src]; fail(new Error(t("js.script.fail", "could not load {src}", { src: src }))); };
        document.head.appendChild(s);
      });
    }
    return scriptCache[src];
  }
  // One request, one 32-byte reply: the next input report after the send.
  function hidSend(device, payload) {
    return new Promise(function (ok, fail) {
      var data = new Uint8Array(32); data.set(payload);
      var timer = setTimeout(function () { device.removeEventListener("inputreport", onReport); fail(new Error(t("js.usb.noanswer", "the keyboard did not answer; unplug and replug it, then try again"))); }, 3000);
      function onReport(e) {
        clearTimeout(timer); device.removeEventListener("inputreport", onReport);
        ok(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
      }
      device.addEventListener("inputreport", onReport);
      device.sendReport(0, data).catch(function (e) { clearTimeout(timer); device.removeEventListener("inputreport", onReport); fail(e); });
    });
  }
  async function readKeyboard() {
    var btn = $("readusb"), sum = $("usbsum"), device = null;
    btn.disabled = true; sum.className = "summary"; sum.textContent = t("js.usb.choose", "Choose your keyboard in the browser's dialog..."); state.usbSum = null;
    $("usbsave").className = "row hidden";
    try {
      var devices = await navigator.hid.requestDevice({ filters: [{ usagePage: 0xFF60, usage: 0x61 }] });
      if (!devices.length) { sum.textContent = t("js.usb.none", "No keyboard chosen."); return; }
      device = devices[0];
      sum.textContent = t("js.usb.reading", "Reading {name}...", { name: device.productName || t("js.usb.thekeyboard", "the keyboard") });
      try { if (!device.opened) await device.open(); }
      catch (e) { throw new Error(t("js.usb.open", "could not open the keyboard ({msg}). On Windows, close the Vial app first: only one program can talk to the keyboard at a time.", { msg: e.message })); }
      var r = await hidSend(device, [0xFE, 0x00]);
      var dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
      var protocol = dv.getUint32(0, true), uid = dv.getBigUint64(4, true).toString();
      r = await hidSend(device, [0xFE, 0x01]);
      var size = new DataView(r.buffer, r.byteOffset, r.byteLength).getUint32(0, true);
      if (!size || size > 1000000) throw new Error(t("js.usb.size", "unexpected definition size {n}; is this a Vial keyboard?", { n: size }));
      var blob = new Uint8Array(size), got = 0, block = 0;
      while (got < size) {
        var req = new Uint8Array(6); req[0] = 0xFE; req[1] = 0x02; new DataView(req.buffer).setUint32(2, block, true);
        r = await hidSend(device, req);
        var n = Math.min(32, size - got); blob.set(r.subarray(0, n), got); got += n; block++;
      }
      r = await hidSend(device, [0x01]); var via = (r[1] << 8) | r[2];
      r = await hidSend(device, [0x11]); var layerCount = r[1];
      await loadScript("docs/xzwasm.min.js");
      var text = await new Response(new window.xzwasm.XzReadableStream(new Blob([blob]).stream())).text();
      var defn = JSON.parse(text);
      var rows = +((defn.matrix || {}).rows) || 0, cols = +((defn.matrix || {}).cols) || 0;
      if (!(layerCount > 0 && layerCount <= 32 && rows > 0 && rows <= 64 && cols > 0 && cols <= 64)) {
        throw new Error(t("js.usb.shape", "unexpected keymap shape: {layers} layers, matrix {rows}x{cols}", { layers: layerCount, rows: rows, cols: cols }));
      }
      var total = layerCount * rows * cols * 2, buf = new Uint8Array(total), off = 0;
      while (off < total) {
        var n2 = Math.min(28, total - off);
        r = await hidSend(device, [0x12, off >> 8, off & 0xFF, n2]);
        buf.set(r.subarray(4, 4 + n2), off); off += n2;
      }
      await loadScript("docs/keycodes.js");         // the number-to-name table, into vilimg
      var slug = (defn.name || "keyboard").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "keyboard";
      var board = vilimg.boardFromDefinition(defn, uid, slug);
      var positions = board.keys.map(function (k) { return k.matrix; });
      var layers = vilimg.namedLayers(vilimg.decodeBuffer(buf, layerCount, rows, cols), positions, protocol);
      // the .vil text is built by hand so the 64-bit uid stays a number in the file
      var vilText = '{"version":1,"uid":' + uid + ',"layout":' + JSON.stringify(layers) +
        ',"vial_protocol":' + protocol + ',"via_protocol":' + via + "}";
      var usb = { uid: uid, rec: board, name: slug + ".vil", text: vilText, label: defn.name || slug };
      try { $("file").value = ""; } catch (e3) {}     // the keymap is the keyboard's now, not a file's
      handleText(usb.name, vilText, usb);
      state.usbSum = M("js.usb.done", "Layout and mapping have been read from {name} over USB: {keys}, {layers}{rest}",
        { name: esc(defn.name || slug), keys: M("js.keys.other", "{n} keys", { n: board.keys.length }), layers: M("js.layers.other", "{n} layers", { n: layerCount }),
          rest: LIVE ? M("js.usb.done.live", ", drawn below.") : M("js.usb.done.local", ". The command in the Command section reads the keyboard again itself; save the keymap as a file to keep a copy.") });
      renderUsbSum();
      $("usbsave").className = "row";
    } catch (e) {
      sum.className = "summary err"; sum.textContent = t("js.usb.fail", "Could not read the keyboard: {msg}", { msg: e && e.message ? e.message : e });
    } finally {
      if (device && device.opened) { try { await device.close(); } catch (e2) {} }
      btn.disabled = false;
    }
  }
  function renderUsbSum() { if (state.usbSum) { var sum = $("usbsum"); sum.className = "summary"; sum.innerHTML = say(state.usbSum); } }
  $("readusb").onclick = function () {
    var blocked = usbBlocked();
    if (blocked) { var sum = $("usbsum"); sum.className = "summary err"; sum.textContent = blocked; return; }
    readKeyboard();
  };
  $("savevil").onclick = function () {
    if (state.usbBoard) download(state.usbBoard.name, new Blob([state.usbBoard.text], { type: "application/json" }));
  };
  function takeFile(f) {
    var reader = new FileReader();
    reader.onload = function () { handleText(f.name, reader.result); };
    reader.readAsText(f);
  }
  $("file").addEventListener("change", function () { if (this.files[0]) takeFile(this.files[0]); });
  // The two sample links sit inside one translated sentence, whose elements are replaced on a
  // language switch, so the click is taken on the sentence and matched to the link's data-sample.
  var SAMPLES = { dz60: "dz60-qwerty.json", corne: "corne-qwerty.vil", zmkcorne: "corne-zmk.keymap" };
  $("samplelinks").addEventListener("click", function (e) {
    var a = e.target.closest("a[data-sample]");
    if (!a) return;
    e.preventDefault();
    var key = a.getAttribute("data-sample"), name = SAMPLES[key];
    if (!name) return;
    var text = $("sampledata-" + key).textContent;
    // the file control shows the sample's name, as it would after a drop (no change event is fired)
    try { var dt = new DataTransfer(); dt.items.add(new File([text], name, { type: "application/json" })); $("file").files = dt.files; } catch (err) {}
    var side = {};
    try { side = JSON.parse($("samplesettings-" + key).textContent); } catch (err) {}
    handleText(name, text, null, side);
    if (side.board && state.km && !state.board) {
      // the settings file names the board (the ZMK sample: its keymap cannot); pick it once the list is in
      loadBoards().then(function (boards) {
        var b = boards.filter(function (x) { return x.k === side.board; })[0];
        if (b && state.file === name && !state.board) {
          selectBoard(b, side.layout || null);
          state.pickerOpen = false;
          setBoardNote(M("js.board.sample", "{board}: chosen by the sample's settings file.", { board: boardLabel() }));
          update(true);
        }
      }, function () {});
    }
  });
  var drop = $("drop");
  // the whole box opens the picker; the label and the control itself already do, so a click there is left alone
  drop.addEventListener("click", function (e) { if (!e.target.closest("label, input")) $("file").click(); });
  drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.className = "drop over"; });
  drop.addEventListener("dragleave", function () { drop.className = "drop"; });
  drop.addEventListener("drop", function (e) {
    e.preventDefault(); drop.className = "drop";
    if (!e.dataTransfer.files[0]) return;
    try { $("file").files = e.dataTransfer.files; } catch (err) {}   // so the picker shows the dropped name too
    takeFile(e.dataTransfer.files[0]);
  });
  $("search").addEventListener("input", function () { renderResults(this.value); });
  $("search").addEventListener("focus", function () { loadBoards().catch(function () {}); });   // fetched before the first keystroke
  $("png").addEventListener("change", function () { remember("png", this.checked ? "1" : "0"); update(); });
  $("dual").addEventListener("change", function () { remember("dual", this.checked ? "1" : "0"); update(true); if (!LIVE) showChosen(); });
  $("halves").addEventListener("change", function () { remember("halves", this.checked ? "1" : "0"); update(true); if (!LIVE) showChosen(); });
  $("combos").addEventListener("change", function () { remember("combos", this.value); update(true); if (!LIVE) showChosen(); });
  function usbCommand() {
    var name = ($("usbname").value || "").trim().toLowerCase().replace(/\.json$/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "mykeyboard";
    var py = state.os === "win" ? "python" : "python3";
    return py + " -m pip install hidapi\n" + py + " keymap-imgen.py --from-usb --save-board " + name;
  }
  function updateUsb() { $("usbcmd").textContent = usbCommand(); }
  $("usbname").addEventListener("input", updateUsb);
  function copyFrom(preId, btnId) {
    var pre = $(preId), btn = $(btnId), text = pre.textContent;
    // the label comes back from the language table, so a switch while "Copied" shows is harmless
    function done() { btn.textContent = t("js.copied", "Copied"); setTimeout(function () { btn.innerHTML = I18N.text(btn.getAttribute("data-i18n")); }, 1500); }
    function fallback() { var r = document.createRange(); r.selectNodeContents(pre); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand("copy"); done(); } catch (e) {} }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }
  $("usbcopy").onclick = function () { copyFrom("usbcmd", "usbcopy"); };
  $("pwcopy").onclick = function () { copyFrom("pwcmd", "pwcopy"); };
  $("stylefile").addEventListener("input", function () {
    state.customStyle = this.value.trim().replace(/\.css$/i, "");
    remember("stylefile", state.customStyle);
    renderStyles(); update(); if (!LIVE) showPreview(state.style);
  });
  function setOs(os) {
    state.os = os; remember("os", os);
    Array.prototype.forEach.call(document.querySelectorAll(".os button"), function (x) { x.className = x.getAttribute("data-os") === os ? "on" : ""; });
    $("batnote").className = "note" + (os === "win" ? "" : " hidden");   // the .bat file is Windows-only
    var py = os === "win" ? "python" : "python3";
    $("pwcmd").textContent = py + " -m pip install playwright\n" + py + " -m playwright install chromium";
    updateUsb();
    update();
  }
  Array.prototype.forEach.call(document.querySelectorAll(".os button"), function (b) {
    b.onclick = function () { setOs(b.getAttribute("data-os")); };
  });
  $("copy").onclick = function () { copyFrom("cmd", "copy"); };
  $("save").onclick = function () {
    $("savenote").className = "note";
    if (!state.file) { $("savenote").textContent = t("js.nokeymap", "Choose a keymap first."); return; }
    var name = state.file.replace(/\.(vil|json|keymap)$/i, "") + ".settings.json";
    $("savenote").innerHTML = t("js.save.done", "Saved <code>{name}</code> where your browser puts downloads. Move it into <code>keymaps/</code> next to your keymap; from then on <code>python keymap-imgen.py</code> remembers these choices.", { name: esc(name) });
    download(name, new Blob([JSON.stringify(settings(), null, 2)], { type: "application/json" }));
  };

  // last visit's choices, before the first render
  (function () {
    var s = recall("style"), custom = recall("stylefile"), os = recall("os");
    if (s && STYLES.some(function (x) { return x.name === s; })) state.style = s;
    if (custom) { state.customStyle = custom; $("stylefile").value = custom; }
    if (os === "win" || os === "nix") state.os = os;
    if (recall("png") === "0") $("png").checked = false;
    if (recall("dual") === "1") { $("dual").checked = true; if (recall("halves") === "1") $("halves").checked = true; }
    var cmb = recall("combos");
    if (cmb && ["badges", "lines", "panel", "text", "off"].indexOf(cmb) >= 0) $("combos").value = cmb;
    if (recall("scale") === "1") { $("scale1").checked = true; $("scale2").checked = false; }
  })();
  setDownloads(false);
  renderStyles(); if (!LIVE) showPreview(state.style);
  renderResults(""); renderLayers(); renderPicker(); setOs(state.os);

  // After a language switch: everything page.js wrote from its own strings is written again.
  // Transient notes (Drawing..., a PNG failure, the USB progress line) are left alone.
  function rerender() {
    applyTheme(document.documentElement.getAttribute("data-theme") || "light");
    fillBuilt(); renderMode(); renderUsbNote(); renderUsbSum();
    setBoardNote(state.boardNote);            // also renders the status block
    renderLayers(); renderResults($("search").value); renderStyles(); if (!LIVE) showPreview(state.style);
    $("savenote").className = "note hidden";
    update();
  }
  I18N.onChange(rerender);
})();
