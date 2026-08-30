"""Check the page's translations against the English reference.

    python tools/check_lang.py             # every docs/lang/<code>.js except en
    python tools/check_lang.py es de       # some of them
    python tools/check_lang.py --stamp es  # record the English each entry was translated from

For each language file: every English id present, no id English lacks, the same HTML tags in
the same order with the same attributes, the same {placeholders}, and no entry whose English
has changed since it was translated (the file carries a "_source" table of short hashes of
the English, written by --stamp after a translation or a re-translation; an entry whose hash
no longer matches is reported as stale). Exit code 1 when anything is wrong.

Run tools/extract_strings.py first so docs/lang/en.js is current. Standard library only.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANG = ROOT / "docs" / "lang"
TAG = re.compile(r"<[^>]+>")
PLACEHOLDER = re.compile(r"\{\w+\}")


def text_hash(s):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:8]


def load(path):
    """The object literal in a language file, as a dict (insertion order kept)."""
    src = path.read_bytes().decode("utf-8")
    m = re.search(r"window\.VILIMG_LANG\.([a-z]{2})\s*=\s*(\{)", src)
    if not m:
        sys.exit("%s: no 'window.VILIMG_LANG.<code> = {' found" % path.name)
    body = src[m.start(2):].rstrip()
    if not body.endswith("};"):
        sys.exit("%s: the file must end with '};'" % path.name)
    try:
        return m.group(1), json.loads(body[:-1])
    except ValueError as e:
        sys.exit("%s: the table is not valid JSON (%s); keep every value on one line with \\\" for quotes" % (path.name, e))


def write(path, code, table, source):
    header = path.read_bytes().decode("utf-8").split("window.VILIMG_LANG", 1)[0]
    lines = [header.rstrip("\n"), "window.VILIMG_LANG = window.VILIMG_LANG || {};", "window.VILIMG_LANG.%s = {" % code]
    items = [(k, v) for k, v in table.items() if k != "_source"]
    for k, v in items:
        lines.append("  %s: %s," % (json.dumps(k), json.dumps(v, ensure_ascii=False)))
    lines.append('  "_source": %s' % json.dumps(source, ensure_ascii=False, indent=4).replace("\n", "\n  "))
    lines.append("};")
    path.write_bytes(("\n".join(lines) + "\n").encode("utf-8"))


def check(code, table, en, stamp):
    problems = []
    source = dict(table.get("_source") or {})
    for sid, val in en.items():
        if sid not in table:
            problems.append("missing: %s" % sid)
            continue
        tr = table[sid]
        if not isinstance(tr, str):
            problems.append("%s: value is not a string" % sid)
            continue
        if TAG.findall(tr) != TAG.findall(val):
            problems.append("%s: tags differ (English %s, %s %s)" % (sid, TAG.findall(val), code, TAG.findall(tr)))
        if sorted(set(PLACEHOLDER.findall(tr))) != sorted(set(PLACEHOLDER.findall(val))):
            problems.append("%s: placeholders differ (English %s, %s %s)" % (sid, sorted(set(PLACEHOLDER.findall(val))), code, sorted(set(PLACEHOLDER.findall(tr)))))
        if not tr.strip() and val.strip():
            problems.append("%s: empty" % sid)
        h = text_hash(val)
        if stamp:
            source[sid] = h
        elif source.get(sid) != h:
            problems.append("%s: %s" % (sid, "not stamped (run --stamp %s after translating)" % code if sid not in source else "stale: the English changed since it was translated"))
    for sid in table:
        if sid != "_source" and sid not in en:
            problems.append("unknown id: %s" % sid)
    if stamp:
        for sid in list(source):
            if sid not in en:
                del source[sid]
    return problems, source


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("codes", nargs="*", help="language codes (default: every file in docs/lang except en)")
    ap.add_argument("--stamp", action="store_true", help="record the current English hashes into the language file(s)")
    args = ap.parse_args()
    _, en = load(LANG / "en.js")
    codes = args.codes or sorted(p.stem for p in LANG.glob("*.js") if p.stem != "en")
    bad = 0
    for code in codes:
        path = LANG / ("%s.js" % code)
        if not path.exists():
            print("%s: no such file" % path.name)
            bad += 1
            continue
        file_code, table = load(path)
        if file_code != code:
            print("%s: defines VILIMG_LANG.%s, not .%s" % (path.name, file_code, code))
            bad += 1
            continue
        problems, source = check(code, table, en, args.stamp)
        if args.stamp:
            write(path, code, table, source)
        for p in problems:
            print("%s: %s" % (code, p))
        n = len([k for k in table if k != "_source"])
        print("%s: %d entries, %d problem(s)%s" % (code, n, len(problems), ", stamped" if args.stamp else ""))
        bad += len(problems)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
