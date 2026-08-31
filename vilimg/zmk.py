"""ZMK devicetree reading: the .keymap parser and the physical-layout parser.

A ZMK keymap is devicetree text, not JSON: a node with compatible = "zmk,keymap" holds one
child node per layer, each with a `bindings` list of behavior calls (&kp A, &lt 2 SPACE).
Combos live in a "zmk,combos" node and name their keys by position; custom hold-tap
behaviors live in a "behaviors" node. Geometry is not in the keymap at all: it comes from
`zmk,physical-layout` nodes in a board's -layouts.dtsi file (key_physical_attrs rows in
centi-key-units), read here for --board <file>.dtsi and by tools/build_zmk_index.py.

This is a small tolerant subset parser: comments and single-line #define substitutions are
handled, #include lines are ignored (a self-contained .keymap file is the scope), and
anything unrecognised is carried through as its raw text rather than raised on. The same
parser exists in docs/vilimg.js for the page; they are part of the one intended duplicate
(vil.load() / parseKeymap): keep them in step. Binding-to-QMK-keycode translation is NOT
done here: the layers carry raw ZMK binding strings, and the renderer translates them at
normalise time so the legend tables live once, in docs/vilimg.js.
"""

import math
import re

DEFINE = re.compile(r"^[ \t]*#[ \t]*define[ \t]+(\w+)(\([^)]*\))?[ \t]*(.*?)[ \t]*$", re.M)
PREPROC = re.compile(r"^[ \t]*#.*$", re.M)
WORD = re.compile(r"\b[A-Za-z_]\w*\b")
CELL_GROUP = re.compile(r"<([^>]*)>")
NUMBER = re.compile(r"^\(?(-?\d+)\)?$")


def strip_comments(text):
    """The text without /* */ and // comments."""
    out, i, n = [], 0, len(text)
    while i < n:
        two = text[i:i + 2]
        if two == "/*":
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
        elif two == "//":
            j = text.find("\n", i)
            i = n if j < 0 else j
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def apply_defines(text):
    """Single-line `#define NAME value` substitutions applied to the body; function-like
    macros are left alone, and every remaining preprocessor line (#include, #if) drops."""
    defs = {}
    for m in DEFINE.finditer(text):
        if not m.group(2) and m.group(1) != m.group(3):
            defs[m.group(1)] = m.group(3)
    body = PREPROC.sub("", text)
    if defs:
        for _ in range(5):       # a define may name another define
            replaced = WORD.sub(lambda m: defs.get(m.group(0), m.group(0)), body)
            if replaced == body:
                break
            body = replaced
    return body


def parse_tree(text):
    """The node tree of devicetree text (comments stripped, defines applied): each node is
    {"name", "label", "props": {name: raw value or True}, "children": [...]}."""
    root = {"name": "", "label": "", "props": {}, "children": []}
    stack, buf = [root], []
    for ch in text:
        if ch == "{":
            tokens = "".join(buf).replace(":", ": ").split()
            name = tokens[-1] if tokens else ""
            label = tokens[-2][:-1] if len(tokens) > 1 and tokens[-2].endswith(":") else ""
            node = {"name": name, "label": label, "props": {}, "children": []}
            stack[-1]["children"].append(node)
            stack.append(node)
            buf = []
        elif ch == "}":
            if len(stack) > 1:
                stack.pop()
            buf = []
        elif ch == ";":
            s = "".join(buf).strip()
            if s:
                if "=" in s:
                    k, v = s.split("=", 1)
                    stack[-1]["props"][k.strip()] = v.strip()
                else:
                    stack[-1]["props"][s] = True
            buf = []
        else:
            buf.append(ch)
    return root


def find_nodes(root, compatible):
    """Every node whose compatible property is the given string, depth first."""
    out = []
    def walk(node):
        if prop_string(node, "compatible") == compatible:
            out.append(node)
        for child in node["children"]:
            walk(child)
    walk(root)
    return out


def prop_string(node, key):
    """A string property without its quotes, or ""."""
    v = node["props"].get(key)
    if not isinstance(v, str):
        return ""
    m = re.search(r'"([^"]*)"', v)
    return m.group(1) if m else v.strip()


def prop_cells(node, key):
    """The numbers of a <...> property, flattened across groups; (-3000) reads as -3000."""
    v = node["props"].get(key)
    if not isinstance(v, str):
        return []
    out = []
    for group in CELL_GROUP.findall(v):
        for tok in group.split():
            m = NUMBER.match(tok)
            if m:
                out.append(int(m.group(1)))
    return out


def prop_bindings(node, key="bindings"):
    """The behavior calls of a bindings property, one string each: `<&kp A &lt 2 SPACE>`
    gives ["&kp A", "&lt 2 SPACE"]. Groups (`<&kp>, <&mo>`) are read in order."""
    v = node["props"].get(key)
    if not isinstance(v, str):
        return []
    tokens = []
    for group in CELL_GROUP.findall(v):
        tokens.extend(group.split())
    out, cur = [], None
    for tok in tokens:
        if tok.startswith("&"):
            if cur:
                out.append(" ".join(cur))
            cur = [tok]
        elif cur is not None:
            cur.append(tok)
    if cur:
        out.append(" ".join(cur))
    return out


def looks_like_keymap(text):
    return "zmk,keymap" in text


def parse_keymap(text, name="keymap"):
    """The parsed pieces of a ZMK .keymap: {"layers": [[binding strings]], "layer_names":
    {"0": "Base"}, "combos": [...], "behaviors": {...}, "warnings": [...]}.

    Combos are position-addressed: {"keyPositions": [...], "output": binding string,
    "layers": [...] or None, "triggers": []} (the renderer reads the triggers from the
    layer). Behaviors are the custom hold-taps: {label: {"hold": "&mo", "tap": "&kp"}}.
    """
    root = parse_tree(apply_defines(strip_comments(text)))
    keymaps = find_nodes(root, "zmk,keymap")
    if not keymaps:
        raise ValueError(f"{name}: no zmk,keymap node found. A ZMK keymap file has a node "
                         f"with compatible = \"zmk,keymap\" holding one child node per layer")
    layers, names, warnings = [], {}, []
    for child in keymaps[0]["children"]:
        bindings = prop_bindings(child)
        if not bindings:
            continue
        label = prop_string(child, "display-name") or prop_string(child, "label") or child["name"]
        if label:
            names[str(len(layers))] = label
        layers.append(bindings)
    if not layers:
        raise ValueError(f"{name}: the zmk,keymap node has no layers with bindings")
    combos = []
    for combo_node in find_nodes(root, "zmk,combos"):
        for child in combo_node["children"]:
            positions = prop_cells(child, "key-positions")
            outputs = prop_bindings(child)
            if len(positions) < 2 or not outputs:
                continue
            layer_list = prop_cells(child, "layers")
            combos.append({"keyPositions": positions, "output": outputs[0],
                           "layers": layer_list or None, "triggers": []})
    behaviors = {}
    for node in find_nodes(root, "zmk,behavior-hold-tap"):
        calls = prop_bindings(node)
        key = node["label"] or node["name"]
        if key and len(calls) == 2:
            behaviors[key] = {"hold": calls[0], "tap": calls[1]}
    return {"layers": layers, "layer_names": names, "combos": combos,
            "behaviors": behaviors, "warnings": warnings}


# ---- physical layouts (geometry): zmk,physical-layout nodes --------------------------------

def _centre(k):
    """The key's centre as drawn, after any rotation about (rx, ry)."""
    w, h = k.get("w", 1), k.get("h", 1)
    cx, cy = k["x"] + w / 2, k["y"] + h / 2
    rot = k.get("r", 0)
    if rot:
        a = math.radians(rot)
        rx, ry = k.get("rx", cx), k.get("ry", cy)
        dx, dy = cx - rx, cy - ry
        cx = rx + dx * math.cos(a) - dy * math.sin(a)
        cy = ry + dx * math.sin(a) + dy * math.cos(a)
    return cx, cy


def matrix_from_geometry(keys):
    """Synthesised (row, col) for keys that arrive as a plain position list (a ZMK physical
    layout has no matrix): keys whose drawn centre y differ by less than half a key unit are
    one row, numbered top to bottom, columns left to right within the row. The pairs keep
    the row analysis honest (home row, thumbs) and give every key a stable address in
    visual reading order, the order ZMK numbers its keys in."""
    centres = [_centre(k) for k in keys]
    order = sorted(range(len(keys)), key=lambda i: (centres[i][1], centres[i][0]))
    rows, last_y = [], None
    for i in order:
        cy = centres[i][1]
        if last_y is None or cy - last_y >= 0.5:
            rows.append([])
            last_y = cy
        rows[-1].append(i)
    out = [None] * len(keys)
    for r, row in enumerate(rows):
        for c, i in enumerate(sorted(row, key=lambda i: centres[i][0])):
            out[i] = (r, c)
    return out


def parse_layouts(text, name="layouts"):
    """Every zmk,physical-layout in a devicetree file, in source order:
    [{"name": display name or node name, "keys": [{x, y, w, h, r, rx, ry}]}].

    key_physical_attrs rows are <&key_physical_attrs w h x y rot rx ry> in centi-key-units
    (rotation in centi-degrees), converted to the key units the rest of the code uses.
    """
    root = parse_tree(apply_defines(strip_comments(text)))
    out = []
    for node in find_nodes(root, "zmk,physical-layout"):
        rows = []
        v = node["props"].get("keys")
        if isinstance(v, str):
            for group in CELL_GROUP.findall(v):
                tokens = group.split()
                nums = []
                for tok in tokens:
                    m = NUMBER.match(tok)
                    if m:
                        nums.append(int(m.group(1)))
                # one group may hold several 7-number rows (a bare <...> list)
                for start in range(0, len(nums) - 6, 7):
                    w, h, x, y, rot, rx, ry = nums[start:start + 7]
                    key = {"x": x / 100.0, "y": y / 100.0, "w": w / 100.0, "h": h / 100.0}
                    if rot:
                        key.update(r=rot / 100.0, rx=rx / 100.0, ry=ry / 100.0)
                    rows.append(key)
        if not rows:
            continue
        out.append({"name": prop_string(node, "display-name") or node["name"], "keys": rows})
    if not out:
        raise ValueError(f"{name}: no zmk,physical-layout node with keys found")
    return out
