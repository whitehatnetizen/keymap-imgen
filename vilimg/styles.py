"""The style sheets in styles/ and the font files in fonts/.

A style is styles/<name>.css on top of styles/_base.css. Fonts a sheet names as
url('fonts/<file>') are embedded as data URIs so every page is one self-contained file;
the substitution itself is vilimg.js's inlineFonts (shared with the web page), so it
needs a Browser.
"""

import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLES_DIR = ROOT / "styles"
FONTS_DIR = ROOT / "fonts"


def list_styles():
    """[(name, description)] for every styles/<name>.css that is not the base sheet."""
    out = []
    for p in sorted(STYLES_DIR.glob("*.css")):
        if p.name.startswith("_"):
            continue
        first = p.read_text(encoding="utf-8").splitlines()[0] if p.stat().st_size else ""
        m = re.match(r"/\*\s*(.*?)\s*\*/", first)
        out.append((p.stem, m.group(1) if m else ""))
    return out


_ROOT_BLOCK = re.compile(r":root\s*\{(.*?)\}", re.S)
_DECL = re.compile(r"--([\w-]+)\s*:\s*([^;]+);")
_VAR = re.compile(r"var\(\s*--([\w-]+)\s*(?:,\s*(.*))?\)\s*$", re.S)
PAGE_TOKENS = ("bg", "card", "ink", "sec", "line", "acc")


def palette(name):
    """The style's page-facing colours, {token: colour} for bg, card, ink, sec, line and acc, with
    var() references inside the :root block resolved. Tokens the sheet does not define are left
    out. The page's "I feel lucky" button paints itself with these."""
    css = (STYLES_DIR / f"{name}.css").read_text(encoding="utf-8")
    decls = {}
    for block in _ROOT_BLOCK.findall(css):
        for k, v in _DECL.findall(block):
            decls[k] = v.strip()

    def resolve(v, depth=0):
        m = _VAR.match(v)
        if not m:
            return v
        if depth > 8 or m.group(1) not in decls:
            return (m.group(2) or "").strip() or None
        return resolve(decls[m.group(1)], depth + 1)

    out = {}
    for t in PAGE_TOKENS:
        if t in decls:
            v = resolve(decls[t])
            if v:
                out[t] = v
    return out


def read_style(name):
    """The base sheet plus the style's sheet, fonts still as url('fonts/<file>')."""
    p = STYLES_DIR / f"{name}.css"
    if not p.exists():
        names = ", ".join(n for n, _ in list_styles())
        raise FileNotFoundError(f"no style named {name!r}. Available: {names}")
    return (STYLES_DIR / "_base.css").read_text(encoding="utf-8") + "\n" + p.read_text(encoding="utf-8")


def font_bytes(names, fonts_dir=FONTS_DIR):
    """{file name: base64 contents} for the named fonts that exist in fonts/."""
    out = {}
    for n in names:
        f = Path(fonts_dir) / n
        if f.is_file():
            out[n] = base64.b64encode(f.read_bytes()).decode("ascii")
    return out


def inline_fonts(css, browser, fonts_dir=FONTS_DIR):
    """(the sheet with its fonts embedded, notes about fonts that could not be) for the caller to print."""
    return browser.inline_fonts(css, font_bytes(browser.font_refs(css), fonts_dir))


def load_style(name, browser):
    """(css, notes): the style's sheet with fonts embedded, ready for Browser.render_pages."""
    return inline_fonts(read_style(name), browser)
