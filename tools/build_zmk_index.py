"""Build the bundled ZMK board-geometry index from zmk,physical-layout nodes.

    python tools/build_zmk_index.py [--keep-downloads]
    python tools/build_zmk_index.py --rewrite     the output files again from the existing index, no fetching

Downloads the ZMK firmware repository plus the vendor module repositories listed in
VENDOR_REPOS (each checked for a redistribution-friendly licence before being added),
scans every .dtsi/.overlay/.dts file for zmk,physical-layout nodes (key_physical_attrs
rows in centi-key-units, the ecosystem's standard geometry since ZMK Studio), and writes:

    boards/zmk-index.json.gz     read by vilimg.geometry and by the page: every board by
                                 slug, its layouts as compact key rows
                                 [row, col, x, y, w, h, r, rx, ry] (the QMK index's format;
                                 the row/col pairs are synthesised in visual reading order,
                                 the order ZMK numbers its keys in)
    boards/zmk-index.meta.json   the build date and board count
    docs/zmk-boards.js           window.ZMKBOARDS for index.html's search list (z: 1 marks
                                 the records as ZMK, so the page fetches the right index)
    boards/ZMK-DATA-NOTICE.md    provenance and licence note, one line per source repository

Maintainer tool; the morning-briefing index refresh runs it monthly beside
tools/build_qmk_index.py. Standard library only.
"""

import argparse
import gzip
import io
import json
import sys
import tarfile
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_GZ = ROOT / "boards" / "zmk-index.json.gz"
OUT_META = ROOT / "boards" / "zmk-index.meta.json"
BOARDS_JS = ROOT / "docs" / "zmk-boards.js"
NOTICE = ROOT / "boards" / "ZMK-DATA-NOTICE.md"
UA = "Keymap Image Generator index builder (github.com/whitehatnetizen/keymap-imgen)"

sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
from vilimg import zmk as zmkmod  # noqa: E402
from build_qmk_index import share_shapes, expand_shapes  # noqa: E402

# (owner/repo, branch, licence). Add a vendor module repository only after checking its
# licence allows redistributing derived data with attribution.
SOURCE_REPOS = [
    ("zmkfirmware/zmk", "main", "MIT"),
    ("hitsmaxft/zmk-keyboard-cornix", "main", "Apache-2.0"),
]


def fetch_tarball(repo, branch):
    url = f"https://codeload.github.com/{repo}/tar.gz/refs/heads/{branch}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def slug_of(path_parts):
    """The board or shield a layouts file belongs to. Usually the file's parent folder
    (boards/shields/<shield>/x.dtsi, boards/<vendor>/<board>/x.dtsi); the shared layouts in
    the main repository live at dts/layouts/<vendor>/<board>.dtsi, where the file stem is
    the board; a metadata/ subfolder (Studio exports) belongs to its grandparent."""
    parents = list(path_parts[:-1])
    stem = Path(path_parts[-1]).stem
    slug = parents[-1] if parents else stem
    if slug == "metadata" and len(parents) > 1:
        slug = parents[-2]
    if len(parents) >= 2 and parents[-2] == "layouts":
        slug = stem
    if slug in ("boards", "shields", "arm", "dts", "layouts"):
        slug = stem
    for suffix in ("-layouts", "_layouts", "-layouts-export"):
        slug = slug.removesuffix(suffix)
    return slug


def compact_key(k, pair):
    row = [pair[0], pair[1], k["x"], k["y"]]
    w, h, r = k.get("w", 1), k.get("h", 1), k.get("r", 0)
    if w != 1 or h != 1 or r:
        row += [w, h]
    if r:
        row += [r, k.get("rx", k["x"] + w / 2), k.get("ry", k["y"] + h / 2)]
    return [int(v) if isinstance(v, float) and v.is_integer() else v for v in row]


def scan_repo(repo, branch, boards):
    data = fetch_tarball(repo, branch)
    print(f"{repo}: {len(data) // 1024} KB downloaded")
    found = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile() or not member.name.lower().endswith((".dtsi", ".overlay", ".dts")):
                continue
            text = tar.extractfile(member).read().decode("utf-8", errors="replace")
            if "zmk,physical-layout" not in text or "key_physical_attrs" not in text:
                continue
            parts = member.name.split("/")[1:]        # drop the tarball's top folder
            try:
                layouts = zmkmod.parse_layouts(text, member.name)
            except ValueError:
                continue
            slug = slug_of(parts)
            rec = boards.setdefault(slug, {"name": slug.replace("_", " ").replace("-", " ").title(),
                                           "layouts": {}, "source": repo})
            for lay in layouts:
                pairs = zmkmod.matrix_from_geometry(lay["keys"])
                rows = [compact_key(k, p) for k, p in zip(lay["keys"], pairs)]
                if rows in rec["layouts"].values():
                    continue                      # the same shape under another name (a Studio export copy)
                lname = lay["name"] or f"LAYOUT_{len(rows)}"
                if lname in rec["layouts"]:
                    lname = f"{lname}_{len(rows)}"
                if lname not in rec["layouts"]:
                    rec["layouts"][lname] = rows
                    found += 1
    print(f"{repo}: {found} layouts")


def write_outputs(boards, built):
    shapes = share_shapes(boards)
    sources = ", ".join(f"{repo} ({licence})" for repo, _, licence in SOURCE_REPOS)
    index = {"built": built, "source": sources, "count": len(boards), "shapes": shapes, "boards": boards}
    OUT_GZ.parent.mkdir(exist_ok=True)
    with gzip.open(OUT_GZ, "wt", encoding="utf-8", newline="\n") as f:
        json.dump(index, f, separators=(",", ":"))
    OUT_META.write_text(json.dumps({"built": built, "source": sources, "count": len(boards)}) + "\n",
                        encoding="utf-8", newline="\n")
    print(f"wrote {OUT_GZ.name}: {len(boards)} boards, {len(shapes)} distinct layouts, "
          f"{OUT_GZ.stat().st_size // 1024} KB gzipped; {OUT_META.name}")
    js_boards = [{"k": n, "n": r["name"] + " (ZMK)", "z": 1,
                  "l": {ln: len(shapes[v]) for ln, v in r["layouts"].items()}}
                 for n, r in sorted(boards.items())]
    BOARDS_JS.write_text(
        "// Generated by tools/build_zmk_index.py from zmk,physical-layout nodes on "
        f"{built}. See boards/ZMK-DATA-NOTICE.md.\n"
        f"window.ZMKBOARDS={json.dumps(js_boards, separators=(',', ':'))};\n",
        encoding="utf-8", newline="\n")
    print(f"wrote {BOARDS_JS.name}: {BOARDS_JS.stat().st_size // 1024} KB")
    write_notice(built, len(boards))


def write_notice(built, count):
    lines = "\n".join(f"- https://github.com/{repo} (branch {branch}, licence {licence})"
                      for repo, branch, licence in SOURCE_REPOS)
    NOTICE.write_text(f"""# ZMK board geometry data: provenance and licence

`zmk-index.json.gz` in this folder and `docs/zmk-boards.js` were generated on {built}
by `tools/build_zmk_index.py` from the `zmk,physical-layout` nodes (per-key positions in
centi-key-units) in these repositories ({count} boards in all):

{lines}

For each keyboard they keep a name and the position of every key in every physical
layout. Nothing else from those projects is included. ZMK Firmware is copyright the ZMK
Contributors, MIT licensed; the vendor repositories are copyright their authors under the
licences listed above. These derived data files are provided under the same terms with
credit to their projects. The rest of this repository (the code, styles and fonts) is
separately licensed; see `LICENSE` and `fonts/README.md`.

To refresh after boards are added, re-run the script; new vendor module repositories are
added to SOURCE_REPOS in the script, licence checked, one line each.
""", encoding="utf-8", newline="\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rewrite", action="store_true",
                    help="write every output file again from the existing index, without fetching")
    args = ap.parse_args()

    if args.rewrite:
        with gzip.open(OUT_GZ, "rt", encoding="utf-8") as f:
            index = json.load(f)
        write_outputs(expand_shapes(index), index["built"])
        return

    boards = {}
    for repo, branch, _ in SOURCE_REPOS:
        scan_repo(repo, branch, boards)
    boards = {slug: rec for slug, rec in boards.items() if rec["layouts"]}
    for rec in boards.values():
        rec.pop("source", None)
    write_outputs(boards, date.today().isoformat())


if __name__ == "__main__":
    main()
