"""The renderer: docs/vilimg.js run in Playwright's Chromium.

The drawing code is one JavaScript file shared with the web page, so the command line draws by
loading that file into a headless browser page once and calling it with plain data
(Keymap.to_dict(), Board.to_dict()). Board detection against the QMK index runs there
too. Screenshots come from the same browser.
Playwright is therefore required for any output; `open_browser()` returns None and prints
the two install lines when it is missing.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS_PATH = ROOT / "docs" / "vilimg.js"
KEYCODES_PATH = ROOT / "docs" / "keycodes.js"   # number-to-name table, for bare numbers in a .vil

INSTALL_HINT = ("Rendering needs Playwright, a headless browser. Install it once with:\n"
                "    python -m pip install playwright\n"
                "    python -m playwright install chromium")

_BLANK = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body></body></html>"


def _data(obj):
    """Plain data for the JavaScript side: dataclasses through to_dict(), dicts as they are."""
    return obj.to_dict() if hasattr(obj, "to_dict") else obj


class Browser:
    """One headless Chromium holding vilimg.js. Use as a context manager or call close()."""

    def __init__(self):
        self._pw = None
        self._browser = None
        self._page = None
        self._index_loaded = False

    def start(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch()
        self._page = self._browser.new_page()
        self._page.set_content(_BLANK)
        self._page.add_script_tag(path=str(JS_PATH))
        if KEYCODES_PATH.exists():
            self._page.add_script_tag(path=str(KEYCODES_PATH))
        return self

    def close(self):
        if self._browser:
            self._browser.close()
        if self._pw:
            self._pw.stop()
        self._browser = self._pw = self._page = None
        self._index_loaded = False

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.close()

    # ---- calling into vilimg.js ------------------------------------------------------------

    def call(self, fn, *args):
        """window.vilimg[fn](*args); arguments and result travel as JSON."""
        return self._page.evaluate("([fn, args]) => window.vilimg[fn](...args)", [fn, list(args)])

    def run(self, body, *args):
        """A JavaScript function body with `v` = window.vilimg and `a` = the argument list."""
        return self._page.evaluate("([body, a]) => (new Function('v', 'a', body))(window.vilimg, a)",
                                   [body, list(args)])

    def version(self):
        return self._page.evaluate("window.vilimg.version")

    # ---- board detection against the QMK index (vilimg.js does the comparing) -------------

    def load_index(self, index):
        """Hand the inflated QMK index (geometry.load_index()) to the page, once per browser."""
        if not self._index_loaded:
            self._page.evaluate("idx => { window.QMK_INDEX = idx; }", index)
            self._index_loaded = True

    def match_index(self, km):
        """[[qmk name, layout], ...] whose matrix positions are exactly the keymap's."""
        return self.run("return v.matchIndex(a[0], window.QMK_INDEX.boards);", _data(km))

    def same_shape(self, matches):
        return self.run("return v.sameShape(window.QMK_INDEX.boards, a[0]);", [list(m) for m in matches])

    def grid_mode(self, matches):
        """"sure", "guess" or "": how the grid fallback should draw for these candidate boards."""
        return self.run("return v.gridMode(window.QMK_INDEX.boards, a[0]);", [list(m) for m in matches])

    def render_pages(self, km, board, style_css, *, width=1920, height=1080, layers=None, names=None,
                     title=None, labels=None, date="", style_name="", note="", dual=False, halves=False,
                     combos="badges"):
        """The HTML documents for a keymap on a board in a style, one string per sheet.

        Same contract as vilimg.renderPages: a sheet is one screen of up to nine layers; with
        `dual` two screens side by side sharing the layers; with `halves` (implies `dual`)
        every layer on both screens, one half of a split keyboard on each, drawn larger.
        `halves` needs a split board: check with is_split first.
        """
        opts = {"width": width, "height": height, "layers": layers, "names": names or {}, "title": title,
                "labels": labels or {}, "date": date, "styleName": style_name, "note": note,
                "dual": dual, "halves": halves, "combos": combos}
        return self.call("renderPages", _data(km), _data(board), style_css, opts)

    def is_split(self, board):
        return self.call("isSplit", _data(board))

    def describe(self, board, pos):
        return self.call("describe", _data(board), list(pos))

    def inline_fonts(self, css, files):
        """(css, notes) with url('fonts/<file>') replaced by data URIs from files ({name: base64})."""
        out = self.call("inlineFonts", css, files)
        return out["css"], out["notes"]

    def font_refs(self, css):
        return self.call("fontRefs", css)

    # ---- screenshots -----------------------------------------------------------------------

    def screenshot(self, html_path, png_path, width, height, scale, strips=()):
        """Screenshot an HTML file at width x height CSS pixels, `scale` device pixels per CSS pixel.

        `strips` = [(path, x, w)]: extra screenshots of vertical strips of the same page, used
        for one picture per screen of a two-screen page.
        """
        page = self._browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=scale)
        page.goto(Path(html_path).resolve().as_uri())
        page.evaluate("document.fonts.ready")   # the embedded fonts decode after load; wait for them
        page.screenshot(path=str(png_path))
        for path, x, w in strips:
            page.screenshot(path=str(path), clip={"x": x, "y": 0, "width": w, "height": height})
        page.close()


def open_browser(quiet=False):
    """A started Browser, or None with a one-line explanation printed."""
    try:
        import playwright  # noqa: F401
    except ImportError:
        if not quiet:
            print(INSTALL_HINT)
        return None
    try:
        return Browser().start()
    except Exception as e:  # browser missing, or Playwright cannot start
        msg = str(e).splitlines()[0] if str(e) else type(e).__name__
        if not quiet:
            if "Executable doesn't exist" in str(e) or "playwright install" in str(e):
                print("Playwright is installed but its browser is not. Run:\n"
                      "    playwright install chromium")
            else:
                print(f"Playwright could not start ({msg}).")
        return None
