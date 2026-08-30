"""Load a keymap file: a Vial .vil or a QMK keymap.json.

A .vil is JSON whose "layout" is a list of layers, each a list of matrix rows, each a
list of keycode strings; -1 marks a matrix position with no physical key. Keycodes are
addressed by matrix row and column.

A QMK keymap.json (Configurator export, or `qmk c2json`) has "keyboard", "layout" (the
LAYOUT macro name) and "layers": lists of keycodes in LAYOUT order, i.e. the same order
as the keys in that layout's definition. It carries no matrix arrays; they are built once
the board geometry is known (see `Keymap.resolve_positional`).

Everything else in either file (macros, combos, encoders, settings) is kept on the object
but not drawn; the tap-dance table and the Vial protocol version go to the renderer, which
prints a tap dance's actions and reads bare-number keycodes under that version.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

EMPTY_CODES = {"KC_NO", "KC_TRNS", -1, "KC_TRANSPARENT",
               "_______", "XXXXXXX"}   # QMK's keymap.json spellings of KC_TRNS and KC_NO


@dataclass
class Keymap:
    path: Path
    kind: str = "vil"                 # "vil" or "qmk"
    uid: int | None = None
    layers: list = field(default_factory=list)   # [layer][row][col] -> keycode or -1
    extra: dict = field(default_factory=dict)
    keyboard: str | None = None       # qmk: the "keyboard" field
    layout_name: str | None = None    # qmk: the "layout" field
    positional: list | None = None    # qmk: [layer][i] keycodes in LAYOUT order
    layer_names: dict = field(default_factory=dict)
    warnings: list = field(default_factory=list)   # notes for the user, printed by keymap-imgen.py

    @property
    def rows(self):
        return len(self.layers[0]) if self.layers else 0

    @property
    def cols(self):
        return len(self.layers[0][0]) if self.layers and self.layers[0] else 0

    @property
    def shape(self):
        return (self.rows, self.cols)

    @property
    def layer_count(self):
        if self.layers:
            return len(self.layers)
        return len(self.positional or [])

    def to_dict(self):
        """The keymap as plain data for the JavaScript renderer (docs/vilimg.js).

        The layers are the matrix arrays; a qmk keymap has them once resolve_positional
        has run, and carries its LAYOUT-ordered lists as `positional` until then. Layer
        names are keyed by the layer number as a string.
        """
        protocol = self.extra.get("vial_protocol")
        td = self.extra.get("tap_dance")
        return {"name": self.path.name, "stem": self.path.stem, "kind": self.kind,
                "uid": None if self.uid is None else str(self.uid),
                "layers": self.layers, "positional": self.positional,
                "layer_names": {str(k): v for k, v in self.layer_names.items()},
                "vial_protocol": protocol if isinstance(protocol, int) else None,
                "tap_dance": td if isinstance(td, list) else []}

    def positions(self):
        """Matrix positions that hold a physical key, from layer 0."""
        if not self.layers:
            return set()
        return {(r, c) for r, row in enumerate(self.layers[0])
                for c, code in enumerate(row) if code != -1}

    def nonempty_layers(self):
        """Layer indexes that assign at least one key."""
        # positional (qmk) layers are flat lists; wrap each in a one-row grid so one loop reads both shapes
        src = self.layers if self.layers else [[layer] for layer in (self.positional or [])]
        out = []
        for i, layer in enumerate(src):
            if any(code not in EMPTY_CODES for row in layer for code in row):
                out.append(i)
        return out

    def resolve_positional(self, board):
        """Build matrix arrays for a positional (qmk) keymap from a board's key order."""
        if self.positional is None:
            return
        n = len(board.keys)
        rows = max((k.matrix[0] for k in board.keys), default=-1) + 1
        cols = max((k.matrix[1] for k in board.keys), default=-1) + 1
        if board.matrix and board.matrix[0] and board.matrix[1]:
            rows, cols = max(rows, board.matrix[0]), max(cols, board.matrix[1])
        self.layers = []
        for layer in self.positional:
            grid = [[-1] * cols for _ in range(rows)]
            for i, key in enumerate(board.keys):
                r, c = key.matrix
                grid[r][c] = layer[i] if i < len(layer) else "KC_NO"
            self.layers.append(grid)
        if any(len(layer) != n for layer in self.positional):
            counts = sorted({len(layer) for layer in self.positional})
            self.warnings.append(f"{self.path.name}: layers have {counts} keycodes but the layout "
                                 f"{board.layout or ''} has {n} keys; extra codes ignored, missing ones blank")


def is_keymap_json(data):
    return isinstance(data, dict) and isinstance(data.get("layers"), list) and "keyboard" in data


EXPORT_HINT = ("Export one from Vial (File, Save current layout) or from QMK Configurator (Export keymap)")


def load(path):
    """The keymap in a file. Every failure raises ValueError with a sentence that names the
    file and says what to do; the Python detail (a codec name, an errno) stays out of it."""
    path = Path(path)
    if path.is_dir():
        raise ValueError(f"{path.name} is a folder, not a keymap file")
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise ValueError(f"{path.name}: not a text file (a .vil or keymap.json is UTF-8 text)") from None
    if not text.strip():
        raise ValueError(f"{path.name}: the file is empty. {EXPORT_HINT} and try again")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"{path.name}: not valid JSON ({e}). {EXPORT_HINT} and try again") from None
    if not isinstance(data, dict):
        raise ValueError(f"{path.name}: expected a JSON object")
    layout = data.get("layout")
    if isinstance(layout, list) and layout and isinstance(layout[0], list):
        first = layout[0]
        if not first or not all(isinstance(row, list) for row in first) or not any(first):
            raise ValueError(f"{path.name}: layer 0 has no keys; nothing to draw")
        extra = {k: v for k, v in data.items() if k != "layout"}
        return Keymap(path=path, kind="vil", uid=data.get("uid"), layers=layout, extra=extra)
    if is_keymap_json(data):
        layers = data["layers"]
        if not layers:
            raise ValueError(f"{path.name}: 'layers' is empty; nothing to draw")
        if not all(isinstance(layer, list) for layer in layers):
            raise ValueError(f"{path.name}: 'layers' must be lists of keycodes")
        extra = {k: v for k, v in data.items() if k not in ("layers",)}
        names = {}
        for i, nm in enumerate(data.get("layer_names") or []):
            if nm:
                names[str(i)] = str(nm)
        return Keymap(path=path, kind="qmk", keyboard=data.get("keyboard"),
                      layout_name=data.get("layout") if isinstance(data.get("layout"), str) else None,
                      positional=layers, extra=extra, layer_names=names)
    settings_like = "board" in data or ("layers" in data and any(k in data for k in ("title", "names", "labels")))
    if settings_like:
        raise ValueError(f"{path.name} looks like a settings file; give the keymap it belongs to "
                         f"(the settings are read from beside it)")
    raise ValueError(f"{path.name}: neither a Vial .vil ('layout' list of layers) nor a QMK "
                     f"keymap.json ('keyboard' and 'layers'). {EXPORT_HINT} and try again")

