"""Build the bundled board-geometry index from QMK's public keyboard API.

    python tools/build_qmk_index.py [--workers 4] [--limit N]
    python tools/build_qmk_index.py --rewrite     the output files again from the existing index, no fetching
    python tools/build_qmk_index.py --page-only   docs/boards-local.js alone (after a board file or style is
                                                  added to the repository)

Fetches https://keyboards.qmk.fm/v1/keyboard_list.json, then each board's resolved
info.json, and writes:

    boards/qmk-index.json.gz     read by vilimg.geometry and by the page: every board's name,
                                 matrix size and layouts, a layout being its keys as
                                 [row, col, x, y, w, h, r, rx, ry]. Each distinct layout is
                                 stored once, in "shapes"; a board's layout entry is its number
    boards/qmk-index.meta.json   the build date and board count, read without inflating the index
    docs/boards.js               window.BOARDS for index.html: names, matrix size, layout names
                                 with key counts (the page loads it when a name is searched for)
    docs/boards-local.js         the shipped list for the page: the date and count again, beside the
                                 repository's board files and styles (a user's own go to
                                 docs/boards-user.js, written by keymap-imgen.py --refresh-page)
    boards/QMK-DATA-NOTICE.md    provenance and licence note

Maintainer tool. Resumes from boards/qmk-index.partial.json if a run was interrupted.
Standard library only.
"""

import argparse
import gzip
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://keyboards.qmk.fm/v1"
OUT_GZ = ROOT / "boards" / "qmk-index.json.gz"
OUT_META = ROOT / "boards" / "qmk-index.meta.json"
PARTIAL = ROOT / "boards" / "qmk-index.partial.json"
BOARDS_JS = ROOT / "docs" / "boards.js"
NOTICE = ROOT / "boards" / "QMK-DATA-NOTICE.md"
UA = "Keymap Image Generator index builder (github.com/whitehatnetizen/keymap-imgen)"

sys.path.insert(0, str(ROOT))
from vilimg.geometry import write_local_boards_js  # noqa: E402


def get_json(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt == tries - 1:
                raise
        except Exception:
            if attempt == tries - 1:
                raise
        time.sleep(1.5 * (attempt + 1))


def compact_key(k):
    """[row, col, x, y, (w, h, (r, rx, ry))], read back by vilimg.geometry._keys_from_compact.

    w and h are written whenever any of w, h, r differ from the default; rx and ry whenever
    r is set. QMK's data gives no pivot for most rotated keys, so the key centre is written.
    """
    row = [k["matrix"][0], k["matrix"][1], k.get("x", 0), k.get("y", 0)]
    w, h, r = k.get("w", 1), k.get("h", 1), k.get("r", 0)
    if w != 1 or h != 1 or r:
        row += [w, h]
    if r:
        row += [r, k.get("rx", k.get("x", 0) + w / 2), k.get("ry", k.get("y", 0) + h / 2)]
    return row


def fetch_board(name):
    data = get_json(f"{API}/keyboards/{name}/info.json")
    if not data or "keyboards" not in data:
        return name, None
    kb = next(iter(data["keyboards"].values()))
    layouts = {}
    for lname, lay in (kb.get("layouts") or {}).items():
        keys = [k for k in lay.get("layout", []) if "matrix" in k]
        if keys:
            layouts[lname] = [compact_key(k) for k in keys]
    if not layouts:
        return name, None
    ms = kb.get("matrix_size") or {}
    return name, {"name": kb.get("keyboard_name") or name, "rows": ms.get("rows"), "cols": ms.get("cols"),
                  "layouts": layouts}


def share_shapes(boards):
    """Replace every layout's rows with the number of that shape in the returned list, so a
    shape used by several boards (revisions, clones, a layout offered under two names) is
    written once. vilimg.geometry.load_index and vilimg.js resolveIndex put the rows back."""
    shapes, numbers = [], {}
    for rec in boards.values():
        for ln, rows in rec["layouts"].items():
            key = json.dumps(rows, separators=(",", ":"))
            if key not in numbers:
                numbers[key] = len(shapes)
                shapes.append(rows)
            rec["layouts"][ln] = numbers[key]
    return shapes


def expand_shapes(index):
    """The reverse of share_shapes, for --rewrite: every layout entry back to its rows."""
    shapes = index.get("shapes") or []
    for rec in index["boards"].values():
        rec["layouts"] = {ln: shapes[v] if isinstance(v, int) else v for ln, v in rec["layouts"].items()}
    return index["boards"]


def write_outputs(boards, built):
    """Every output file from a {name: record} table whose layouts are rows."""
    shapes = share_shapes(boards)
    index = {"built": built, "source": API, "count": len(boards), "shapes": shapes, "boards": boards}
    OUT_GZ.parent.mkdir(exist_ok=True)
    with gzip.open(OUT_GZ, "wt", encoding="utf-8", newline="\n") as f:
        json.dump(index, f, separators=(",", ":"))
    OUT_META.write_text(json.dumps({"built": built, "source": API, "count": len(boards)}) + "\n",
                        encoding="utf-8", newline="\n")
    print(f"wrote {OUT_GZ.name}: {len(boards)} boards, {len(shapes)} distinct layouts, "
          f"{OUT_GZ.stat().st_size // 1024} KB gzipped; {OUT_META.name}")
    js_boards = [{"k": n, "n": r["name"], "r": r["rows"], "c": r["cols"],
                  "l": {ln: len(shapes[v]) for ln, v in r["layouts"].items()}}
                 for n, r in sorted(boards.items())]
    BOARDS_JS.write_text(
        "// Generated by tools/build_qmk_index.py from https://keyboards.qmk.fm/v1 on "
        f"{built}. See boards/QMK-DATA-NOTICE.md.\n"
        f"window.BOARDS={json.dumps(js_boards, separators=(',', ':'))};\n",
        encoding="utf-8", newline="\n")
    print(f"wrote {BOARDS_JS.name}: {BOARDS_JS.stat().st_size // 1024} KB")
    write_page_list()
    write_notice(built, len(boards))


def write_page_list():
    local, changed = write_local_boards_js()
    print(f"{'wrote' if changed else 'unchanged'} {local.name}")


def write_notice(built, count):
    """The provenance note; the keycode section tools/build_keycodes.py adds is kept."""
    tail = ""
    if NOTICE.exists():
        text = NOTICE.read_text(encoding="utf-8")
        if "\n## Keycode names" in text:
            tail = text[text.index("\n## Keycode names"):]
    NOTICE.write_text(f"""# Board geometry data: provenance and licence

`qmk-index.json.gz` in this folder and `docs/boards.js` were generated on {built}
by `tools/build_qmk_index.py` from the QMK Firmware project's published keyboard data at
{API} ({count} keyboards). For each keyboard they keep the name, matrix size, and
the position of every key in every layout. Nothing else from QMK is included.

QMK Firmware is copyright its contributors and released under the GNU General Public
License, version 2 or later (https://github.com/qmk/qmk_firmware). These derived data
files are provided under the same terms with credit to the QMK project. The rest of this
repository (the code, styles and fonts) is separately licensed; see `LICENSE` and
`fonts/README.md`.

To refresh after QMK adds keyboards, re-run the script; it resumes from a partial file if
interrupted.
""" + tail, encoding="utf-8", newline="\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, help="only the first N boards (for testing)")
    ap.add_argument("--rewrite", action="store_true",
                    help="write every output file again from the existing index, without fetching")
    ap.add_argument("--page-only", action="store_true",
                    help="rewrite docs/boards-local.js only, from boards/, styles/ and the index's meta file")
    args = ap.parse_args()

    if args.page_only:
        write_page_list()
        return
    if args.rewrite:
        with gzip.open(OUT_GZ, "rt", encoding="utf-8") as f:
            index = json.load(f)
        for rec in index["boards"].values():
            rec.pop("vid", None)
            rec.pop("pid", None)
        write_outputs(expand_shapes(index), index["built"])
        return

    names = get_json(f"{API}/keyboard_list.json")["keyboards"]
    if args.limit:
        names = names[:args.limit]
    done = {}
    if PARTIAL.exists():
        done = json.loads(PARTIAL.read_text(encoding="utf-8"))
        print(f"resuming: {len(done)} boards already fetched")
    todo = [n for n in names if n not in done]
    print(f"{len(names)} boards listed, {len(todo)} to fetch")

    skipped = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(fetch_board, n): n for n in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            name, rec = fut.result()
            done[name] = rec
            if rec is None:
                skipped.append(name)
            if i % 100 == 0 or i == len(todo):
                PARTIAL.write_text(json.dumps(done), encoding="utf-8", newline="\n")
                print(f"  {i}/{len(todo)}  {time.time() - t0:.0f}s")

    write_outputs({n: r for n, r in done.items() if r}, date.today().isoformat())
    if PARTIAL.exists():
        PARTIAL.unlink()
    if skipped:
        print("skipped (no layouts with matrix data):", ", ".join(skipped[:20]),
              "..." if len(skipped) > 20 else "")


if __name__ == "__main__":
    main()
