"""Build the keycode-number table from QMK's published keycode data.

    python tools/build_keycodes.py

Fetches every data/constants/keycodes/keycodes_<version>*.hjson from the QMK Firmware
repository, merges them newest over oldest (as QMK's own `qmk.keycodes.load_spec` does)
and writes:

    docs/keycodes.js         window.KEYCODES = {"built", "source", "spec", "names": {"0x0004": "KC_A", ...},
                              "ranges": {"QK_MODS": [start, end], ...}}, handed to vilimg.js: the
                              page loads it when a keyboard is read over USB or a .vil holds bare
                              numbers, and the command line loads it into its browser at start
    boards/QMK-DATA-NOTICE.md  a paragraph appended about this data

The names are what a keyboard's keymap reads as when it comes over USB as numbers
(Vial protocol 6 uses QMK's current numbering). Maintainer tool; standard library only.
"""

import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.github.com/repos/qmk/qmk_firmware/contents/data/constants/keycodes"
RAW = "https://raw.githubusercontent.com/qmk/qmk_firmware/master/data/constants/keycodes/"
OUT_JS = ROOT / "docs" / "keycodes.js"
NOTICE = ROOT / "boards" / "QMK-DATA-NOTICE.md"

_COMMENT = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)
_TRAILING = re.compile(r",(\s*[}\]])")
_MISSING = re.compile(r'("|\d|true|false|null|\]|\})[ \t]*\n(\s*")')   # a value, a line break, then a key or string


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Keymap Image Generator build_keycodes (github.com/whitehatnetizen/keymap-imgen)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def strip_comments(text):
    """Remove // and /* */ comments outside strings (a label may contain a slash)."""
    out, i, n, in_str = [], 0, len(text), False
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1]); i += 1
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True; out.append(ch)
        elif text.startswith("//", i):
            j = text.find("\n", i); i = n if j < 0 else j; continue
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2); i = n if j < 0 else j + 2; continue
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def parse_hjson(text):
    """QMK's keycode files are JSON plus comments, the odd trailing comma and the odd missing one
    (hjson lets a line break separate members)."""
    text = strip_comments(text)
    text = _MISSING.sub(r"\1,\n\2", text)
    text = _TRAILING.sub(r"\1", text)
    return json.loads(text) if text.strip() else {}


def version_key(name):
    m = re.match(r"keycodes_(\d+)\.(\d+)\.(\d+)(?:_(\w+))?\.hjson$", name)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4) or "") if m else None


def main():
    listing = json.loads(fetch(API))
    files = sorted((e["name"] for e in listing if version_key(e["name"])), key=version_key)
    # QMK merges each group (basic, quantum, magic, ...) across versions, newest over oldest; a
    # "!reset!" entry starts that group afresh (the magic group was renumbered in 0.0.2) and a
    # "!delete!" value removes an entry. The base file of each version carries the ranges.
    groups, ranges = {}, {}
    spec = "0.0.0"
    for f in files:
        try:
            data = parse_hjson(fetch(RAW + f))
        except json.JSONDecodeError as e:
            raise SystemExit(f"{f}: cannot parse ({e})")
        v = version_key(f)
        spec = f"{v[0]}.{v[1]}.{v[2]}"
        for rng, rec in (data.get("ranges") or {}).items():
            if isinstance(rec, dict) and rec.get("define"):
                ranges[rng] = rec["define"]
            else:
                ranges.pop(rng, None)
        group = groups.setdefault(v[3], {})
        for code, rec in (data.get("keycodes") or {}).items():
            if code == "!reset!":
                group.clear()
                continue
            key = f"0x{int(code, 16):04X}"
            if isinstance(rec, dict) and rec.get("key"):
                group[key] = rec["key"]
            else:
                group.pop(key, None)
        print(f"{f}: {len(data.get('keycodes') or {})} keycodes, {len(data.get('ranges') or {})} ranges")
    names = {}
    for group in groups.values():
        names.update(group)
    ranges = {define: [int(rng.split("/")[0], 16), int(rng.split("/")[0], 16) + int(rng.split("/")[1], 16)]
              for rng, define in ranges.items()}
    table = {"built": date.today().isoformat(), "source": "https://github.com/qmk/qmk_firmware/tree/master/data/constants/keycodes",
             "spec": spec, "names": dict(sorted(names.items())), "ranges": ranges}
    OUT_JS.write_text("// Generated by tools/build_keycodes.py from QMK's keycode data on "
                      f"{table['built']}. See boards/QMK-DATA-NOTICE.md.\n"
                      f"window.KEYCODES={json.dumps(table, separators=(',', ':'))};\n"
                      "if (window.vilimg) window.vilimg.setKeycodes(window.KEYCODES);\n",
                      encoding="utf-8", newline="\n")
    print(f"wrote {OUT_JS.relative_to(ROOT)} ({len(names)} names, {len(ranges)} ranges, spec {spec})")
    para = ("\n## Keycode names\n\n"
            f"`docs/keycodes.js` was generated on {table['built']} by `tools/build_keycodes.py` from the same\n"
            f"project's keycode data ({table['source']}, spec {spec}):\n"
            "the number of every named keycode and the layout of the ranges (mod-tap, layer-tap, ...). It turns\n"
            "the numbers a keyboard reports over USB back into names, on the page and on the command line. Same licence\n"
            "and terms as the geometry data above.\n")
    if NOTICE.exists():
        text = NOTICE.read_text(encoding="utf-8")
        if "## Keycode names" in text:
            text = text[:text.index("\n## Keycode names")]
        NOTICE.write_text(text.rstrip("\n") + "\n" + para, encoding="utf-8", newline="\n")
        print(f"updated {NOTICE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
