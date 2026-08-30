"""Show how the access-text heuristics read a board's geometry, for checking by eye.

    python tools/check_rows.py planck/rev6 gh60/satan sofle/rev1 corne46

For each board (a QMK index name or a boards/ file) prints whether it is treated as split,
the physical rows found on each half with their key counts, which row is taken as the
thumb row, and the description of every key in matrix order. The QMK index supplies the
geometry, so any of its boards can be checked without owning it. The heuristics live in
docs/vilimg.js (layers section); this runs them through the renderer's browser. Maintainer script.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vilimg import browser as browsermod, geometry  # noqa: E402

DEFAULT = ["planck/rev6", "gh60/satan", "preonic/rev3", "sofle/rev1", "crkbd/rev1", "lily58/rev1",
           "keebio/iris/rev4", "kbdfans/kbd67/rev2", "corne46"]

REPORT = """
var b = v.normBoard(a[0]), split = v.isSplit(b);
var groups = split ? [["left", v.halves(b)[0], true], ["right", v.halves(b)[1], false]] : [["", b.keys, true]];
return {
  split: split,
  halves: groups.map(function (g) {
    var rows = v.physicalRows(g[1]), ti = v.thumbRow(rows, split, g[2]);
    return {label: g[0], rows: rows.map(function (r, i) { return {n: r.length, thumb: i === ti}; })};
  }),
  keys: b.keys.slice().sort(function (p, q) { return p.matrix[0] - q.matrix[0] || p.matrix[1] - q.matrix[1]; })
    .map(function (k) { return [k.matrix[0], k.matrix[1], v.describe(b, k.matrix)]; })
};
"""


def report(b, name):
    board = geometry.load_board(name)
    out = b.run(REPORT, board.to_dict())
    print(f"\n== {name}: {board.name}, {len(board.keys)} keys, {'split' if out['split'] else 'not split'}")
    for half in out["halves"]:
        desc = ", ".join(f"{r['n']} keys" + (" (thumb)" if r["thumb"] else "") for r in half["rows"])
        label = half["label"] + " " if half["label"] else ""
        print(f"  {label}rows top to bottom: {desc}")
    for r, c, text in out["keys"]:
        print(f"  [{r},{c}] {text}")


def main(argv=None):
    names = (argv if argv is not None else sys.argv[1:]) or DEFAULT
    b = browsermod.open_browser()
    if b is None:
        return 3
    try:
        for name in names:
            try:
                report(b, name)
            except (LookupError, FileNotFoundError, ValueError) as e:
                print(f"\n== {name}: {e}")
    finally:
        b.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
