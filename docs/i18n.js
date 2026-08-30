/* i18n.js: the page in other languages.

   English is the page itself. A language is one file, docs/lang/<code>.js, a table from
   string id to text, loaded the first time that language is chosen (so an English reader
   downloads nothing extra). Static text: every element with data-i18n="<id>" gets its inner
   HTML from the table, attributes named attr.<element id>.<attribute> likewise; the English
   is remembered at load so switching back needs no file. Runtime text: page.js calls
   t(id, English, vars) and tn(id, n, one, other, vars), which read the current table and
   fall back to the English given. Placeholders are {name}.

   The language comes from ?lang=xx in the address, else the remembered choice, else the
   browser's languages, else English. The buttons in the header choose and remember.
   Classic script, no modules: the page also opens from a folder. Loaded before page.js. */
(function () {
  var LANGS = ["en", "es", "de"];
  var ATTRS = ["placeholder", "aria-label", "title"];
  var EN = {};                  // the page's own English, by id
  var tables = { en: {} };
  var loading = {};
  var current = "en", listeners = [];

  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function snapshot() {
    all("[data-i18n]").forEach(function (el) { var id = el.getAttribute("data-i18n"); if (!(id in EN)) EN[id] = el.innerHTML; });
    all("[id]").forEach(function (el) {
      ATTRS.forEach(function (a) { if (el.hasAttribute(a)) EN["attr." + el.id + "." + a] = el.getAttribute(a); });
    });
  }
  function table() { return tables[current] || {}; }
  function fmt(s, vars) {
    return vars ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? vars[k] : m; }) : s;
  }
  function t(id, en, vars) { var v = table()[id]; return fmt(v != null ? v : en, vars); }
  function tn(id, n, one, other, vars) {
    vars = vars || {}; vars.n = n;
    return t(id + (n === 1 ? ".one" : ".other"), n === 1 ? one : other, vars);
  }
  // The current text of a static string, for a button label that page.js puts back after "Copied".
  function text(id) { var v = table()[id]; return v != null ? v : (EN[id] != null ? EN[id] : ""); }

  function applyDom() {
    all("[data-i18n]").forEach(function (el) { var v = text(el.getAttribute("data-i18n")); if (el.innerHTML !== v) el.innerHTML = v; });
    all("[id]").forEach(function (el) {
      ATTRS.forEach(function (a) { var id = "attr." + el.id + "." + a; if (id in EN) el.setAttribute(a, text(id)); });
    });
    document.documentElement.lang = current;
    all("#langs button").forEach(function (b) {
      var on = b.getAttribute("data-lang") === current;
      b.className = on ? "on" : ""; b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  function load(code) {
    if (tables[code]) return Promise.resolve();
    if (window.VILIMG_LANG && window.VILIMG_LANG[code]) { tables[code] = window.VILIMG_LANG[code]; return Promise.resolve(); }
    if (!loading[code]) {
      loading[code] = new Promise(function (ok, fail) {
        // the version on the address, as on the page's own script tags, so a new release is not read from the cache
        var s = document.createElement("script"); s.src = "docs/lang/" + code + ".js" + (window.vilimg && vilimg.version ? "?v=" + vilimg.version : "");
        s.onload = function () {
          if (window.VILIMG_LANG && window.VILIMG_LANG[code]) { tables[code] = window.VILIMG_LANG[code]; ok(); }
          else { delete loading[code]; fail(new Error("docs/lang/" + code + ".js defines no table")); }
        };
        s.onerror = function () { delete loading[code]; fail(new Error("could not load docs/lang/" + code + ".js")); };
        document.head.appendChild(s);
      });
    }
    return loading[code];
  }
  // Switch the page. A language whose file cannot be loaded leaves the page in English.
  function set(code, remember) {
    code = LANGS.indexOf(code) >= 0 ? code : "en";
    return load(code).then(function () {
      current = code; applyDom();
      if (remember) { try { localStorage.setItem("lang", code); } catch (e) {} }
      listeners.forEach(function (f) { f(code); });
    }, function () { if (code !== "en") return set("en", remember); });
  }
  function initial() {
    var m = /[?&]lang=([A-Za-z]{2})/.exec(location.search);
    if (m) return m[1].toLowerCase();
    try { var s = localStorage.getItem("lang"); if (s) return s; } catch (e) {}
    var langs = navigator.languages || [navigator.language || "en"];
    for (var i = 0; i < langs.length; i++) {
      var c = String(langs[i]).slice(0, 2).toLowerCase();
      if (LANGS.indexOf(c) >= 0) return c;
    }
    return "en";
  }

  snapshot();
  all("#langs button").forEach(function (b) { b.onclick = function () { set(b.getAttribute("data-lang"), true); }; });
  window.vilimgI18n = { t: t, tn: tn, text: text, set: set, onChange: function (f) { listeners.push(f); } };
  set(initial(), false);
})();
