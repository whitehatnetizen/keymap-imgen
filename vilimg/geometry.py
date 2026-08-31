"""Physical key positions for a board.

A keymap file holds no geometry, only the matrix (a .vil) or a LAYOUT-ordered list (a
QMK keymap.json). Positions come from one of:

1. boards/<slug>.json, hand-written or saved from a connected Vial board:

    {"name": "Corne 46", "slug": "corne46", "matrix": [8, 7], "uids": [...],
     "keys": [{"matrix": [row, col], "x": 0, "y": 0.45, "w": 1, "h": 1,
               "r": 5, "rx": 3.8, "ry": 3.92}, ...]}

2. boards/qmk-index.json.gz, generated from QMK's keyboard API by
   tools/build_qmk_index.py: every QMK keyboard by name (e.g. "crkbd/rev1"), each with
   its layouts. See boards/QMK-DATA-NOTICE.md.

3. a plain grid synthesised from the keymap's matrix when nothing else fits, or when
   asked for with --board grid.

x, y, w, h are in key units (1 = one key pitch). r is a rotation in degrees about
(rx, ry), the same convention as QMK's info.json.

Matching a keymap against the QMK index and building the grid fallback are done by
docs/vilimg.js, the same code the web page runs; detect() calls it through a Browser.
This module keeps the file reading, the board files and the messages.
"""

import gzip
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import zmk as zmkmod

BOARDS_DIR = Path(__file__).resolve().parent.parent / "boards"
INDEX_GZ = BOARDS_DIR / "qmk-index.json.gz"
INDEX_META = BOARDS_DIR / "qmk-index.meta.json"
ZMK_INDEX_GZ = BOARDS_DIR / "zmk-index.json.gz"
ZMK_INDEX_META = BOARDS_DIR / "zmk-index.meta.json"
DTSI_SUFFIXES = (".dtsi", ".overlay", ".dts")


@dataclass
class Key:
    matrix: tuple
    x: float
    y: float
    w: float = 1.0
    h: float = 1.0
    r: float = 0.0
    rx: float = 0.0
    ry: float = 0.0

    def to_dict(self):
        d = {"matrix": list(self.matrix), "x": self.x, "y": self.y, "w": self.w, "h": self.h}
        if self.r:
            d.update(r=self.r, rx=self.rx, ry=self.ry)
        return d


@dataclass
class Board:
    name: str
    slug: str
    matrix: tuple
    uids: list
    keys: list
    note: str = ""
    layout: str = ""          # layout name when the board came from the QMK index
    source: str = ""          # where the geometry came from, for the footer
    zmk_order: bool = False   # keys are in a ZMK layout's own order: a ZMK keymap counts them as they are

    @property
    def positions(self):
        return {k.matrix for k in self.keys}

    def to_dict(self):
        """The board as plain data for the JavaScript renderer (docs/vilimg.js)."""
        return {"name": self.name, "slug": self.slug, "layout": self.layout, "source": self.source,
                "note": self.note, "matrix": list(self.matrix), "uids": [str(u) for u in self.uids],
                "keys": [k.to_dict() for k in self.keys], "zmk_order": self.zmk_order}


@dataclass
class Detection:
    board: Board
    method: str               # board-arg, settings, keyboard-field, uid, shape, index-shape, grid
    warning: str = ""
    unplaced: int = 0         # keys in the file that the board has no position for
    info: str = ""            # a note worth printing that is not a warning


# ---- hand-written board files ------------------------------------------------------------

def _key_from_dict(raw):
    k = Key(matrix=tuple(raw["matrix"]), x=float(raw["x"]), y=float(raw["y"]),
            w=float(raw.get("w", 1)), h=float(raw.get("h", 1)), r=float(raw.get("r", 0)))
    if k.r:
        # no pivot given: the key centre (why: boards/README.md, "r")
        k.rx = float(raw.get("rx", k.x + k.w / 2))
        k.ry = float(raw.get("ry", k.y + k.h / 2))
    return k


def _parse_board_file(data, source):
    if not isinstance(data, dict) or not isinstance(data.get("keys"), list) or not data["keys"]:
        raise ValueError(f"board file {source}: needs a 'keys' list with one entry per key (see boards/README.md)")
    try:
        keys = [_key_from_dict(raw) for raw in data["keys"]]
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError(f"board file {source}: every key needs 'matrix', 'x' and 'y' ({e!r})") from None
    return Board(name=data.get("name", source), slug=data.get("slug", source),
                 matrix=tuple(data.get("matrix", (0, 0))), uids=list(data.get("uids", [])),
                 keys=keys, note=data.get("note", ""), source=f"boards/{source}.json")


def _board_from_renderer(data):
    """A Board from the plain-data form docs/vilimg.js returns (gridBoard, positionalGrid)."""
    return Board(name=data["name"], slug=data["slug"], matrix=tuple(data["matrix"]),
                 uids=[str(u) for u in data.get("uids", [])], keys=[_key_from_dict(raw) for raw in data["keys"]],
                 note=data.get("note", ""), layout=data.get("layout", ""), source=data.get("source", ""))


def board_from_layouts_file(path, layout=None, prefer_count=None):
    """A Board from a devicetree file holding zmk,physical-layout nodes (a ZMK board's
    -layouts.dtsi). With several layouts in one file, `layout` picks by display name;
    else the one whose key count matches `prefer_count`, else the first."""
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise ValueError(f"board file {path.name}: not a text file") from None
    layouts = zmkmod.parse_layouts(text, path.name)
    chosen = None
    if layout:
        chosen = next((l for l in layouts if l["name"] == layout), None)
        if chosen is None:
            raise LookupError(f"{path.name} has no layout {layout!r}; it has: "
                              + ", ".join(l["name"] for l in layouts))
    elif prefer_count:
        chosen = next((l for l in layouts if len(l["keys"]) == prefer_count), None)
    if chosen is None:
        chosen = layouts[0]
    pairs = zmkmod.matrix_from_geometry(chosen["keys"])
    keys = []
    for k, (r, c) in zip(chosen["keys"], pairs):
        key = Key(matrix=(r, c), x=k["x"], y=k["y"], w=k.get("w", 1.0), h=k.get("h", 1.0),
                  r=k.get("r", 0.0))
        if key.r:
            key.rx = k.get("rx", key.x + key.w / 2)
            key.ry = k.get("ry", key.y + key.h / 2)
        keys.append(key)
    rows = max((k.matrix[0] for k in keys), default=-1) + 1
    cols = max((k.matrix[1] for k in keys), default=-1) + 1
    return Board(name=chosen["name"] or path.stem, slug=path.stem, matrix=(rows, cols), uids=[],
                 keys=keys, layout=chosen["name"], source=f"ZMK physical layout ({path.name})",
                 zmk_order=True)


def list_boards():
    """Slugs of the hand-written / saved board files."""
    return sorted(p.stem for p in BOARDS_DIR.glob("*.json")
                  if not p.name.startswith(("qmk-index", "zmk-index")))


_board_cache = {}      # path -> (mtime, size, Board): a run with many keymaps parses each file once


def all_boards():
    out = []
    for slug in list_boards():
        p = BOARDS_DIR / f"{slug}.json"
        st = p.stat()
        hit = _board_cache.get(p)
        if hit is None or hit[0] != st.st_mtime_ns or hit[1] != st.st_size:
            hit = (st.st_mtime_ns, st.st_size, load_board_file(p))
            _board_cache[p] = hit
        out.append(hit[2])
    return out


def load_board_file(slug_or_path, layout=None, prefer_count=None):
    p = Path(slug_or_path)
    if not p.is_file():
        p = BOARDS_DIR / f"{slug_or_path}.json"
    if not p.is_file():
        raise FileNotFoundError(f"no board file named {slug_or_path!r}")
    if p.suffix.lower() in DTSI_SUFFIXES:
        return board_from_layouts_file(p, layout, prefer_count)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ValueError(f"board file {p.name}: not valid JSON ({e}); a board file is described in "
                         f"boards/README.md") from None
    return _parse_board_file(data, p.stem)


# ---- the page's lists --------------------------------------------------------------------
# Two files, so a user's additions never touch a file git tracks:
#   docs/boards-local.js  the shipped list: the board files and styles in the repository, and
#                         the QMK index's date and size. Written by the maintainer
#                         (tools/build_qmk_index.py), tracked.
#   docs/boards-user.js   what this copy has on top: board files and styles that
#                         are not in the shipped list. Written by --refresh-page and after
#                         --save-board. Tracked as an empty stub that the repository never
#                         changes, so a git pull does not conflict with it.
# Either file is rewritten only when its content would change.

LOCAL_JS = BOARDS_DIR.parent / "docs" / "boards-local.js"
USER_JS = BOARDS_DIR.parent / "docs" / "boards-user.js"
USER_JS_STUB = ("// Board files and styles added to this copy of Keymap Image Generator, on top of the shipped list in "
                "boards-local.js.\n// Written by keymap-imgen.py --refresh-page (and after --save-board); "
                "empty until then.\n"
                "window.USERBOARDS=[];\nwindow.USERSTYLES=[];\n")


def _hand_record(b):
    # uids as strings: they do not fit a JavaScript number; "keys" carries the positions in
    # Board.to_dict form, so the page draws a hand board without fetching anything
    return {"k": b.slug, "n": b.name, "r": b.matrix[0] if b.matrix else 0,
            "c": b.matrix[1] if len(b.matrix) > 1 else 0, "u": [str(u) for u in b.uids],
            "keys": [k.to_dict() for k in b.keys]}


def _page_lists():
    from .styles import list_styles, palette
    # "pal" carries the sheet's page-facing colours, for the page's "I feel lucky" button
    return [_hand_record(b) for b in all_boards()], [{"name": n, "desc": d, "pal": palette(n)} for n, d in list_styles()]


def _write_if_changed(path, text):
    """(path, changed). LF on every platform."""
    path = Path(path)
    data = text.encode("utf-8")
    if path.exists() and path.read_bytes() == data:
        return path, False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path, True


def write_local_boards_js(path=None):
    """docs/boards-local.js, the shipped list (maintainer). Returns (path, changed)."""
    hand, styles = _page_lists()
    meta = index_meta()
    return _write_if_changed(path or LOCAL_JS,
                             "// The shipped list: board files in boards/, styles in styles/ and the QMK index's date "
                             "and size. Written by tools/build_qmk_index.py; your own additions go to boards-user.js.\n"
                             f"window.INDEX_BUILT={json.dumps(meta.get('built'))};\n"
                             f"window.INDEX_COUNT={json.dumps(meta.get('count', 0))};\n"
                             f"window.STYLES={json.dumps(styles)};\n"
                             f"window.HANDBOARDS={json.dumps(hand, separators=(',', ':'))};\n")


def _shipped_lists(local_js):
    """The board records and styles in docs/boards-local.js, or empty lists without it."""
    try:
        text = Path(local_js).read_text(encoding="utf-8")
    except OSError:
        return [], []
    hand = re.search(r"^window\.HANDBOARDS=(\[.*\]);$", text, re.M)
    styles = re.search(r"^window\.STYLES=(\[.*\]);$", text, re.M)
    try:
        return (json.loads(hand.group(1)) if hand else []), (json.loads(styles.group(1)) if styles else [])
    except ValueError:
        return [], []


def write_user_boards_js(path=None, local_js=None):
    """docs/boards-user.js: the boards and styles this copy has that the shipped list does not
    (a shipped board file that was edited counts). The stub when there is nothing.
    Returns (path, changed, boards added, styles added)."""
    hand, styles = _page_lists()
    shipped_hand, shipped_styles = _shipped_lists(local_js or LOCAL_JS)
    known_hand = {json.dumps(h, sort_keys=True) for h in shipped_hand}
    known_styles = {json.dumps(s, sort_keys=True) for s in shipped_styles}
    user_hand = [h for h in hand if json.dumps(h, sort_keys=True) not in known_hand]
    user_styles = [s for s in styles if json.dumps(s, sort_keys=True) not in known_styles]
    if not user_hand and not user_styles:
        text = USER_JS_STUB
    else:
        text = ("// Board files and styles added to this copy of Keymap Image Generator, on top of the shipped list in "
                "boards-local.js.\n// Written by keymap-imgen.py --refresh-page (and after --save-board). "
                "Keep it across updates; --refresh-page writes it again from boards/ and styles/.\n"
                f"window.USERBOARDS={json.dumps(user_hand, separators=(',', ':'))};\n"
                f"window.USERSTYLES={json.dumps(user_styles)};\n")
    p, changed = _write_if_changed(path or USER_JS, text)
    return p, changed, len(user_hand), len(user_styles)


# ---- the QMK index -----------------------------------------------------------------------

_index_cache = None


def _resolve_shapes(index):
    """Layouts are stored once each: a layout entry that is a number refers to index["shapes"][n]."""
    shapes = index.get("shapes")
    if shapes:
        for rec in index.get("boards", {}).values():
            rec["layouts"] = {ln: shapes[v] if isinstance(v, int) else v for ln, v in rec["layouts"].items()}
    return index


def load_index():
    """The QMK index as a dict, or {} when the file is absent."""
    global _index_cache
    if _index_cache is None:
        if INDEX_GZ.exists():
            with gzip.open(INDEX_GZ, "rt", encoding="utf-8") as f:
                _index_cache = _resolve_shapes(json.load(f))
        else:
            _index_cache = {}
    return _index_cache


def index_meta():
    """{"built", "count", "source"} of the QMK index without inflating it (boards/qmk-index.meta.json);
    from the index itself when the meta file is missing; {} when there is no index."""
    if INDEX_META.exists():
        return json.loads(INDEX_META.read_text(encoding="utf-8"))
    idx = load_index()
    return {k: idx[k] for k in ("built", "count", "source") if k in idx}


def index_built():
    return index_meta().get("built")


def _match_rank(name, disp, term):
    """How well a board matches the typed term, as page.js matchRank: 0 exact, 1 the name, the
    display name or a part of the name starts with it, 2 the name contains it, 3 the display
    name contains it, -1 no match."""
    k, n = name.lower(), disp.lower()
    if k == term or n == term:
        return 0
    if k.startswith(term) or n.startswith(term) or any(part.startswith(term) for part in k.split("/")):
        return 1
    if term in k:
        return 2
    if term in n:
        return 3
    return -1


def search_index(term=""):
    """[(name, display name, {layout: key count})] whose name or display name contains term,
    best matches first (exact, then starts with, then contains), then by name."""
    term = (term or "").lower()
    out = []
    for name, rec in load_index().get("boards", {}).items():
        disp = rec.get("name") or name
        rank = _match_rank(name, disp, term) if term else 0
        if rank >= 0:
            out.append((rank, name, disp, {ln: len(keys) for ln, keys in rec["layouts"].items()}))
    return [(name, disp, layouts) for _, name, disp, layouts in sorted(out)]


def _keys_from_compact(rows):
    # The compact form written by tools/build_qmk_index.py compact_key():
    # [row, col, x, y, (w, h, (r, rx, ry))]. w and h are present whenever any of w, h, r
    # differ from the default; rx and ry whenever r is set. The centre fallback below
    # only matters for hand-shortened rows.
    keys = []
    for row in rows:
        r, c, x, y = row[0], row[1], float(row[2]), float(row[3])
        w = float(row[4]) if len(row) > 4 else 1.0
        h = float(row[5]) if len(row) > 5 else 1.0
        rot = float(row[6]) if len(row) > 6 else 0.0
        k = Key(matrix=(r, c), x=x, y=y, w=w, h=h, r=rot)
        if rot:
            k.rx = float(row[7]) if len(row) > 7 else x + w / 2
            k.ry = float(row[8]) if len(row) > 8 else y + h / 2
        keys.append(k)
    return keys


def board_from_index(name, layout=None, prefer_positions=None):
    rec = load_index().get("boards", {}).get(name)
    if rec is None:
        near = [n for n, _, _ in search_index(name.split("/")[0])][:8]
        hint = f" Similar names: {', '.join(near)}." if near else ""
        raise LookupError(f"no QMK board named {name!r} in the bundled index.{hint} "
                          f"Try --list-boards <part of the name>.")
    layouts = rec["layouts"]
    if layout:
        if layout not in layouts:
            raise LookupError(f"{name} has no layout {layout!r}; it has: {', '.join(layouts)}")
        chosen = layout
    elif prefer_positions:
        # the layout whose keys overlap the file's keys the most, ties to the larger layout
        def score(ln):
            pos = {(k[0], k[1]) for k in layouts[ln]}
            return (len(pos & prefer_positions), len(pos))
        chosen = max(layouts, key=score)
    else:
        chosen = max(layouts, key=lambda ln: len(layouts[ln]))
    keys = _keys_from_compact(layouts[chosen])
    rows = rec.get("rows") or max(k.matrix[0] for k in keys) + 1
    cols = rec.get("cols") or max(k.matrix[1] for k in keys) + 1
    return Board(name=rec.get("name") or name, slug=name, matrix=(rows, cols), uids=[], keys=keys,
                 layout=chosen, source="QMK keyboard data")


def load_board(name, layout=None, prefer_positions=None, prefer_count=None):
    """A board by hand-file slug or path (a ZMK layouts .dtsi included), else by ZMK index
    name, else by QMK index name."""
    p = Path(name)
    if p.is_file() or (BOARDS_DIR / f"{name}.json").is_file():
        return load_board_file(name, layout, prefer_count)
    if str(name) in load_zmk_index().get("boards", {}):
        return zmk_board_from_index(name, layout, prefer_count)
    if load_index():
        return board_from_index(name, layout, prefer_positions)
    raise LookupError(f"no board named {name!r}; bundled board files: {', '.join(list_boards())} "
                      f"(the QMK index is not present, so QMK names cannot be used)")


# ---- the ZMK index -----------------------------------------------------------------------
# The same structure as the QMK index (shapes shared, compact key rows), generated by
# tools/build_zmk_index.py from zmk,physical-layout nodes in the ZMK repository and a list
# of vendor module repositories. See boards/ZMK-DATA-NOTICE.md.

_zmk_index_cache = None


def load_zmk_index():
    """The ZMK index as a dict, or {} when the file is absent."""
    global _zmk_index_cache
    if _zmk_index_cache is None:
        if ZMK_INDEX_GZ.exists():
            with gzip.open(ZMK_INDEX_GZ, "rt", encoding="utf-8") as f:
                _zmk_index_cache = _resolve_shapes(json.load(f))
        else:
            _zmk_index_cache = {}
    return _zmk_index_cache


def zmk_index_meta():
    if ZMK_INDEX_META.exists():
        return json.loads(ZMK_INDEX_META.read_text(encoding="utf-8"))
    idx = load_zmk_index()
    return {k: idx[k] for k in ("built", "count", "source") if k in idx}


def search_zmk_index(term=""):
    """[(name, display name, {layout: key count})] from the ZMK index, as search_index."""
    term = (term or "").lower()
    out = []
    for name, rec in load_zmk_index().get("boards", {}).items():
        disp = rec.get("name") or name
        rank = _match_rank(name, disp, term) if term else 0
        if rank >= 0:
            out.append((rank, name, disp, {ln: len(keys) for ln, keys in rec["layouts"].items()}))
    return [(name, disp, layouts) for _, name, disp, layouts in sorted(out)]


def zmk_board_from_index(name, layout=None, prefer_count=None):
    rec = load_zmk_index().get("boards", {}).get(name)
    if rec is None:
        raise LookupError(f"no ZMK board named {name!r} in the bundled index")
    layouts = rec["layouts"]
    if layout:
        if layout not in layouts:
            raise LookupError(f"{name} has no layout {layout!r}; it has: {', '.join(layouts)}")
        chosen = layout
    elif prefer_count:
        chosen = next((ln for ln in layouts if len(layouts[ln]) == prefer_count), None) \
            or max(layouts, key=lambda ln: len(layouts[ln]))
    else:
        chosen = max(layouts, key=lambda ln: len(layouts[ln]))
    keys = _keys_from_compact(layouts[chosen])
    rows = max(k.matrix[0] for k in keys) + 1
    cols = max(k.matrix[1] for k in keys) + 1
    return Board(name=rec.get("name") or name, slug=name, matrix=(rows, cols), uids=[], keys=keys,
                 layout=chosen if len(layouts) > 1 else "", source="ZMK keyboard data", zmk_order=True)


def _zmk_by_count(km, warn):
    """A ZMK keymap with no usable board name: when exactly one board in the ZMK index has a
    layout with the keymap's key count, use it (with a note); else None, and the caller
    falls back to the grid."""
    idx = load_zmk_index()
    if not idx:
        return None
    n = max((len(layer) for layer in km.positional or []), default=0)
    hits = []
    for name, rec in idx.get("boards", {}).items():
        for ln, rows in rec["layouts"].items():
            if len(rows) == n:
                hits.append((name, ln))
    if len(hits) != 1:
        return None
    board = zmk_board_from_index(hits[0][0], hits[0][1])
    km.resolve_positional(board)
    det = _finish(km, board, "zmk-count")
    det.info = (f"{km.path.name}: drawn as {board.name}, the only bundled ZMK layout with {n} keys"
                + (f" ({warn})" if warn else "") + "; pass --board to name a different keyboard.")
    return det


# ---- detection ---------------------------------------------------------------------------

def _finish(km, board, method, warning=""):
    unplaced = len(km.positions() - board.positions) if km.layers else 0
    if unplaced and not warning:
        warning = (f"{unplaced} key(s) in {km.path.name} have no position on {board.name}"
                   + (f" ({board.layout})" if board.layout else "")
                   + "; they are not drawn. A clone with extra keys needs its own board file "
                     "(see --from-usb or boards/README.md).")
    return Detection(board=board, method=method, warning=warning, unplaced=unplaced)


def _positional_grid(km, browser, warning):
    """A keymap.json with no usable board: the LAYOUT-ordered keys in one grid about 2.5 times
    wider than tall."""
    board = _board_from_renderer(browser.call("positionalGrid", km.to_dict()))
    km.resolve_positional(board)
    return Detection(board=board, method="grid", warning=warning)


def _matrix_grid(km, browser, ask_index):
    """The plain grid asked for with --board grid: the same grid the page draws for its "draw a
    plain grid" button. Two mirrored halves when the matrix looks split; when no board file
    settled the question and the QMK boards sharing the matrix differ in shape, the halves
    follow those boards instead (all split, most split, or neither), as on the page."""
    km_data = km.to_dict()
    mode = "guess" if browser.call("looksSplit", km_data) else ""
    if ask_index and load_index():
        browser.load_index(load_index())
        matches = [tuple(m) for m in browser.match_index(km_data)]
        if len(matches) > 1 and not browser.same_shape(matches):
            mode = browser.grid_mode(matches)
    return Detection(board=_board_from_renderer(browser.call("gridBoard", km_data, mode)), method="grid", warning="")


def detect(km, browser, board_arg=None, layout_arg=None, method_hint="board-arg"):
    """Pick a board for a keymap.

    Without a board argument an unknown board falls back to a plain grid with a warning.
    With one (from --board or the settings file) a bad name raises LookupError and a bad
    board file raises ValueError, for keymap-imgen.py to report. The name "grid" asks for
    the plain grid outright, without the warning: it is what the page's "draw a plain
    grid" button writes into the command and the settings file.

    `browser` is the renderer harness (vilimg.browser.Browser): the comparison with every
    QMK layout and the grid fallback run in docs/vilimg.js. It is not touched when a board
    argument, a keyboard id or a board file settles the question, so None is accepted for
    those paths only.
    """
    if km.kind in ("qmk", "zmk"):
        if board_arg == "grid":
            return _positional_grid(km, _renderer(browser), warning="")
        name = board_arg or km.keyboard
        layout = layout_arg or km.layout_name
        method = method_hint if board_arg else "keyboard-field"
        board, warn = None, ""
        count = max((len(layer) for layer in km.positional or []), default=0)
        if name:
            try:
                board = load_board(name, layout, prefer_count=count if km.kind == "zmk" else None)
            except LookupError as e:
                warn = str(e)
        if board is None and km.kind == "zmk":
            zdet = _zmk_by_count(km, warn)
            if zdet is not None:
                return zdet
        if board is None:
            no_name = ("a ZMK keymap names no keyboard." if km.kind == "zmk" else "the file names no keyboard.")
            return _positional_grid(km, _renderer(browser),
                                    warning=f"{km.path.name}: " + (warn if name else no_name) +
                                            " Drawn as a plain grid; pass --board <name> for the real shape"
                                            + (" (a ZMK layouts .dtsi file works too)." if km.kind == "zmk" else "."))
        km.resolve_positional(board)
        return _finish(km, board, method)

    # .vil: matrix-addressed
    if board_arg and board_arg != "grid":
        return _finish(km, load_board(board_arg, layout_arg, km.positions()), method_hint)
    hand = all_boards()
    pos = km.positions()
    by_uid = next((b for b in hand if km.uid is not None and km.uid in b.uids), None)
    fits = [b for b in hand if b.matrix == km.shape and b.positions == pos]
    if board_arg == "grid":
        return _matrix_grid(km, _renderer(browser), ask_index=not (by_uid or len(fits) == 1))
    if by_uid:
        return _finish(km, by_uid, "uid")
    if len(fits) == 1:
        return _finish(km, fits[0], "shape")
    # exact-shape match against the QMK index, unique only
    browser = _renderer(browser)
    km_data = km.to_dict()
    matches = []
    if load_index():
        browser.load_index(load_index())
        matches = [tuple(m) for m in browser.match_index(km_data)]
    if len(matches) == 1:
        name, ln = matches[0]
        return _finish(km, board_from_index(name, ln), "index-shape")
    if len(matches) > 1 and browser.same_shape(matches):
        # revisions of one board, or clones: the picture is the same whichever is named
        name, ln = matches[0]
        det = _finish(km, board_from_index(name, ln), "index-shape")
        others = ", ".join(n for n, _ in matches[1:5]) + (", ..." if len(matches) > 5 else "")
        det.info = (f"{km.path.name}: {len(matches)} QMK boards share this key arrangement and the same "
                    f"shape ({name} and {others}); drawn as {name}. Pass --board to name yours.")
        return det
    if len(matches) > 1:
        names = ", ".join(f"{n} ({ln})" for n, ln in matches[:6])
        why = f"its key matrix matches {len(matches)} QMK boards ({names}{', ...' if len(matches) > 6 else ''})"
        # the candidates say whether the board is split: all of them, most of them, or not
        mode = browser.grid_mode(matches)
        how = {"sure": "Every one of them is split, so the grid is drawn in two mirrored halves",
               "guess": "Most of them are split, so the grid is drawn in two mirrored halves (a guess)",
               "": "Drawn as a plain grid"}[mode]
    else:
        why = f"no bundled board has a {km.rows}x{km.cols} matrix with these {len(pos)} keys"
        mode = "guess" if browser.call("looksSplit", km_data) else ""
        how = ("The matrix is shaped like a split keyboard's, so the grid is drawn in two mirrored halves (a guess)"
               if mode else "Drawn as a plain grid")
    warning = (f"{km.path.name}: cannot tell which keyboard this is: {why}. {how}; "
               f"pass --board <name> (see --list-boards <search>) or read the board with --from-usb.")
    return Detection(board=_board_from_renderer(browser.call("gridBoard", km_data, mode)), method="grid", warning=warning)


def _renderer(browser):
    if browser is None:
        raise RuntimeError("board detection past the bundled board files needs the renderer: pass a vilimg.browser.Browser")
    return browser
