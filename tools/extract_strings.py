"""Collect the page's English strings into docs/lang/en.js, the reference the translations
are checked against (tools/check_lang.py).

    python tools/extract_strings.py          # check: every text block tagged, write en.js
    python tools/extract_strings.py --tag    # also give untagged text blocks a data-i18n id

Two sources:
- index.html: every element carrying data-i18n="<id>" contributes its inner HTML (tags and
  all, whitespace collapsed); an element with an id and a placeholder, aria-label or title
  contributes those as attr.<id>.<attribute>.
- docs/page.js: every t("<id>", "<English>") or M("<id>", "<English>") call contributes the
  English literal; tn("<id>", n, "<one>", "<other>") contributes <id>.one and <id>.other.

Ids are written into index.html once (--tag) and never renumbered: a new paragraph gets the
next free number in its section (s02.p.7), an edited paragraph keeps its id and the checker
notices the changed English through the hash stamped in each language file.

A text block is an element whose children are all inline (code, a, b, i, em, span, br) and
which contains letters; an element holding a form control, a button, an iframe, an element
with an id that page.js fills, or an already tagged element is not a block: its children are
looked at instead. data-i18n-skip on an element leaves it and its children alone.

Standard library only. Writes LF, UTF-8, no BOM.
"""
import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "index.html"
PAGEJS = ROOT / "docs" / "page.js"
OUT = ROOT / "docs" / "lang" / "en.js"

INLINE = {"code", "a", "b", "i", "em", "span", "br", "strong", "kbd"}
VOID = {"input", "br", "img", "meta", "link", "hr", "use", "path"}
BLOCKISH = {"p", "li", "summary", "h1", "h2", "h3", "button", "label", "span", "div", "b", "a"}
CONTROLS = {"input", "button", "select", "textarea", "iframe", "img", "svg", "pre", "ul", "ol", "details", "section"}
FILL_IDS = {"pngsize", "size1", "size2", "built", "tbbuilt"}   # spans page.js fills; a block may contain them
ATTRS = ("placeholder", "aria-label", "title")
PREFIX = {"sec01": "s01", "sec02": "s02", "sec03": "s03", "sec04": "s04", "sec05": "s05", "sec06": "s06", "tinker": "tinker"}


class Node:
    def __init__(self, tag, attrs, start, start_end, parent):
        self.tag, self.attrs, self.start, self.start_end, self.parent = tag, dict(attrs), start, start_end, parent
        self.end = None          # offset of the closing tag
        self.children = []       # nodes and text strings, in order
        self.skip = False


class Tree(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.text = text
        self.lines = [0]
        for m in re.finditer("\n", text):
            self.lines.append(m.end())
        self.root = Node("#root", [], 0, 0, None)
        self.cur = self.root
        self.svg = 0
        self.feed(text)

    def pos(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def handle_starttag(self, tag, attrs):
        if tag == "svg":
            self.svg += 1
        if self.svg:
            return
        start = self.pos()
        node = Node(tag, attrs, start, start + len(self.get_starttag_text()), self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID and not self.svg:
            self.cur = self.cur.parent

    def handle_endtag(self, tag):
        if tag == "svg":
            self.svg -= 1
            return
        if self.svg:
            return
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is self.root:
            return
        n.end = self.pos()
        self.cur = n.parent

    def handle_data(self, data):
        if not self.svg:
            self.cur.children.append(data)

    def handle_entityref(self, name):
        if not self.svg:
            self.cur.children.append("&%s;" % name)

    def handle_charref(self, name):
        if not self.svg:
            self.cur.children.append("&#%s;" % name)


def letters(node):
    for c in node.children:
        if isinstance(c, str):
            if re.search(r"[A-Za-z]", c):
                return True
        elif not c.skip and letters(c):
            return True
    return False


def disqualified(node):
    """True when the element must not be translated as one block."""
    for c in node.children:
        if isinstance(c, str):
            continue
        if c.tag in CONTROLS or "data-i18n" in c.attrs or (c.attrs.get("id") and c.attrs["id"] not in FILL_IDS):
            return True
        if c.tag not in INLINE:
            return True
        if disqualified(c):
            return True
    return False


def walk(node, out):
    """Collect the text blocks under node, in document order."""
    for c in node.children:
        if isinstance(c, str) or c.skip or "data-i18n-skip" in c.attrs:
            continue
        if c.tag in ("script", "style", "pre"):
            continue
        if "data-i18n" in c.attrs:
            out.append(c)
            continue
        if c.tag in BLOCKISH and not disqualified(c) and letters(c):
            out.append(c)
            continue
        walk(c, out)


def prefix_of(node):
    n = node.parent
    while n is not None:
        i = n.attrs.get("id", "")
        cls = n.attrs.get("class", "").split()
        if i in PREFIX:
            return PREFIX[i]
        if "head" in cls:
            return "head"
        if "tb" in cls:
            return "tb"
        n = n.parent
    return "misc"


def inner_html(text, node):
    raw = text[node.start_end:node.end]
    return re.sub(r"\s+", " ", raw).strip()


def all_nodes(node, out):
    for c in node.children:
        if not isinstance(c, str):
            out.append(c)
            all_nodes(c, out)


def js_strings(src):
    """Every t("id", "English") in page.js, in file order. The literal is a JS double-quoted
    string on one line; JSON decoding covers its escapes."""
    found = {}
    lit = r'("(?:[^"\\\n]|\\.)*")'

    def add(sid, raw):
        try:
            val = json.loads(raw)
        except ValueError:
            sys.exit("page.js: cannot decode the literal for %s: %s" % (sid, raw))
        if sid in found and found[sid] != val:
            sys.exit("page.js: %s is given two different English texts" % sid)
        found.setdefault(sid, val)

    hits = []
    for m in re.finditer(r'\b(?:t|M)\(\s*"([a-z0-9_.-]+)"\s*,\s*' + lit, src):
        hits.append((m.start(), [(m.group(1), m.group(2))]))
    for m in re.finditer(r'\btn\(\s*"([a-z0-9_.-]+)"\s*,[^,]+,\s*' + lit + r'\s*,\s*' + lit, src):
        hits.append((m.start(), [(m.group(1) + ".one", m.group(2)), (m.group(1) + ".other", m.group(3))]))
    for _, pairs in sorted(hits):
        for sid, raw in pairs:
            add(sid, raw)
    return found


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--tag", action="store_true", help="give untagged text blocks a data-i18n id and rewrite index.html")
    args = ap.parse_args()

    text = PAGE.read_bytes().decode("utf-8")
    tree = Tree(text)
    blocks = []
    walk(tree.root, blocks)

    # ids: existing ones stay; new ones take the next free number per section and tag
    used = {}
    for n in blocks:
        i = n.attrs.get("data-i18n")
        if i:
            m = re.match(r"^(.*)\.([a-z0-9]+)\.(\d+)$", i)
            if m:
                key = (m.group(1), m.group(2))
                used[key] = max(used.get(key, 0), int(m.group(3)))
    untagged = [n for n in blocks if "data-i18n" not in n.attrs]
    if untagged and not args.tag:
        for n in untagged:
            print("untagged %s: %s" % (n.tag, inner_html(text, n)[:70]))
        sys.exit("%d text block(s) without data-i18n; run with --tag" % len(untagged))
    if untagged:
        inserts = []
        for n in untagged:
            key = (prefix_of(n), n.tag)
            used[key] = used.get(key, 0) + 1
            sid = "%s.%s.%d" % (key[0], key[1], used[key])
            n.attrs["data-i18n"] = sid
            inserts.append((n.start + 1 + len(n.tag), ' data-i18n="%s"' % sid))
        for off, ins in sorted(inserts, reverse=True):
            text = text[:off] + ins + text[off:]
        PAGE.write_bytes(text.encode("utf-8"))
        print("tagged %d block(s)" % len(untagged))
        tree = Tree(text)
        blocks = []
        walk(tree.root, blocks)

    table = {}
    for n in blocks:
        sid = n.attrs["data-i18n"]
        val = inner_html(text, n)
        if sid in table and table[sid] != val:
            sys.exit("%s is used for two different texts: %r / %r" % (sid, table[sid][:50], val[:50]))
        table[sid] = val
    nodes = []
    all_nodes(tree.root, nodes)
    for n in nodes:
        i = n.attrs.get("id")
        if not i:
            continue
        for a in ATTRS:
            if a in n.attrs and re.search(r"[A-Za-z]", n.attrs[a] or ""):
                table["attr.%s.%s" % (i, a)] = n.attrs[a]
    for sid, val in js_strings(PAGEJS.read_bytes().decode("utf-8")).items():
        if sid in table:
            sys.exit("%s is used both in index.html and page.js" % sid)
        table[sid] = val

    OUT.parent.mkdir(exist_ok=True)
    lines = ["/* Generated by tools/extract_strings.py from index.html and docs/page.js: do not edit.",
             "   The reference for the translations in this folder; tools/check_lang.py compares them",
             "   with it. */",
             "window.VILIMG_LANG = window.VILIMG_LANG || {};",
             "window.VILIMG_LANG.en = {"]
    items = list(table.items())
    for k, (sid, val) in enumerate(items):
        lines.append("  %s: %s%s" % (json.dumps(sid), json.dumps(val, ensure_ascii=False), "," if k < len(items) - 1 else ""))
    lines.append("};")
    OUT.write_bytes(("\n".join(lines) + "\n").encode("utf-8"))
    words = sum(len(re.sub(r"<[^>]+>", " ", v).split()) for v in table.values())
    print("en.js: %d strings, about %d words" % (len(table), words))


if __name__ == "__main__":
    main()
