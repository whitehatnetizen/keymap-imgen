#!/usr/bin/env python3
"""Render Vial .vil and QMK keymap.json files as layout images.

    python keymap-imgen.py [style] [file ...] [options]
    python keymap-imgen.py --list                  styles
    python keymap-imgen.py --list-boards [search]  keyboards it knows
    python keymap-imgen.py --from-usb [--save-board NAME] [--save-keymap NAME]
    python keymap-imgen.py <style> --from-usb      draw the connected keyboard's own keymap

With no style given, plain is used. With no files given, every keymap in keymaps/ is
rendered (then the current folder, if keymaps/ is empty). Pictures go to output/: <stem>.<style>.html and
<stem>.<style>.png. Drawing needs Playwright, a headless browser (see README.md): the
renderer is docs/vilimg.js, shared with the web page, and the command runs it there.

A settings file <stem>.settings.json beside a keymap stores title, board, layout,
layers, names, labels and the combos treatment for it; index.html writes one.
Command-line options override it.
"""

import argparse
import glob
import json
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from vilimg import __version__  # noqa: E402
from vilimg import browser as browsermod, geometry, styles, vil as vilmod  # noqa: E402

KEYMAPS = ROOT / "keymaps"
OUTPUT = ROOT / "output"
DEFAULT_STYLE = "plain"
SLUG = re.compile(r"^[a-z0-9-]+$")   # board file names: lower-case letters, digits, dashes
SLUG_FROM_NAME = re.compile(r"[^a-z0-9]+")


def warn(msg):
    print(f"  [warn] {msg}", file=sys.stderr)


def note(msg):
    print(f"  [note] {msg}", file=sys.stderr)


def _rel(p):
    """A path relative to the keymap-imgen folder when it is inside it, else as given."""
    try:
        return p.relative_to(ROOT)
    except ValueError:
        return p


def err(msg):
    print(msg, file=sys.stderr)


def parse_size(s):
    try:
        w, h = s.lower().split("x")
        w, h = int(w), int(h)
    except ValueError:
        raise argparse.ArgumentTypeError(f"size must look like 1920x1080, got {s!r}")
    if w < 100 or h < 100:
        raise argparse.ArgumentTypeError(f"size must be at least 100x100, got {s!r}")
    return w, h


def parse_scale(s):
    try:
        v = float(s)
    except ValueError:
        raise argparse.ArgumentTypeError(f"scale must be a number, got {s!r}")
    if not v > 0:
        raise argparse.ArgumentTypeError(f"scale must be above 0, got {s!r}")
    return v


def expand_files(names):
    """The file arguments as paths, with * ? [ patterns expanded here: cmd.exe and PowerShell
    hand them over unexpanded. A pattern that matches nothing raises FileNotFoundError."""
    out = []
    for name in names:
        if any(ch in name for ch in "*?["):
            hits = sorted(Path(p) for p in glob.glob(name))
            if not hits:
                raise FileNotFoundError(f"no file matches {name}")
            out.extend(hits)
        else:
            out.append(Path(name))
    return out


def parse_layers(s):
    try:
        return [int(x) for x in s.split(",") if x.strip() != ""]
    except ValueError:
        raise argparse.ArgumentTypeError(f"layers must be comma-separated numbers, got {s!r}")


def _is_keymap_file(p):
    if p.suffix.lower() in (".vil", ".keymap"):
        return True
    if p.suffix.lower() != ".json" or p.name.endswith(".settings.json"):
        return False
    try:
        return vilmod.is_keymap_json(json.loads(p.read_text(encoding="utf-8")))
    except (ValueError, OSError):
        return False


def find_keymaps():
    for folder in (KEYMAPS, Path.cwd()):
        if folder.exists():
            files = sorted(p for p in folder.iterdir() if p.is_file() and _is_keymap_file(p))
            if files:
                return files, folder
    return [], KEYMAPS


def _clean_settings(data, name):
    """Keep the settings fields that have the right type; say which ones were dropped."""
    if not isinstance(data, dict):
        warn(f"{name}: expected a JSON object, ignored")
        return {}
    out = {}
    for key in ("title", "board", "layout", "combos"):
        if key in data:
            if isinstance(data[key], str):
                out[key] = data[key]
            else:
                warn(f"{name}: '{key}' should be text, ignored")
    if out.get("combos") not in (None, "badges", "lines", "panel", "text", "off"):
        warn(f"{name}: 'combos' should be badges, lines, panel, text or off, ignored")
        del out["combos"]
    if "layers" in data:
        try:
            out["layers"] = [int(x) for x in data["layers"]]
        except (TypeError, ValueError):
            warn(f"{name}: 'layers' should be a list of numbers, ignored")
    for key in ("names", "labels"):
        if key in data:
            if isinstance(data[key], dict):
                out[key] = {str(k): str(v) for k, v in data[key].items()}
            else:
                warn(f"{name}: '{key}' should be an object of text values, ignored")
    return out


def read_settings(path):
    """<stem>.settings.json beside the keymap, else {}."""
    p = path.with_name(path.stem + ".settings.json")
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        warn(f"{p.name}: not valid JSON ({e}), ignored")
        return {}
    return _clean_settings(data, p.name)


def version_string():
    meta = geometry.index_meta()
    idx = f"QMK index {meta['built']} ({meta.get('count')} keyboards)" if meta.get("built") else "no QMK index"
    zmeta = geometry.zmk_index_meta()
    zidx = f", ZMK index {zmeta['built']} ({zmeta.get('count')} keyboards)" if zmeta.get("built") else ""
    return f"Keymap Image Generator {__version__}, {idx}{zidx}"


class _VersionAction(argparse.Action):
    """--version: read the index's date only when asked, not every time the parser is built."""

    def __init__(self, option_strings, dest, **kw):
        super().__init__(option_strings, dest, nargs=0, **kw)

    def __call__(self, parser, namespace, values, option_string=None):
        print(version_string())
        parser.exit()


@dataclass
class RenderJob:
    """What every keymap of one run shares: the options, the style, the browser, the output
    folder and the page size."""
    args: argparse.Namespace
    style: str
    style_css: str
    browser: browsermod.Browser
    want_png: bool
    out_dir: Path
    today: str
    width: int
    height: int


def render_one(f, job, out_stem=None):
    """Render one keymap file. Raises with a message meant for the user."""
    out_stem = out_stem or f.stem
    km = vilmod.load(f)
    side = read_settings(f)
    board_arg = job.args.board or side.get("board")
    layout_arg = job.args.layout or side.get("layout")
    det = geometry.detect(km, job.browser, board_arg, layout_arg, method_hint="board-arg" if job.args.board else "settings")
    render_km(km, det, side, job, out_stem)


def render_km(km, det, side, job, out_stem):
    """Render a loaded keymap on a detected board."""
    f, args, browser = km.path, job.args, job.browser
    for w in km.warnings:
        warn(w)
    if det.warning:
        warn(det.warning)
    if det.info:
        note(det.info)

    wanted = args.layers if args.layers is not None else side.get("layers")
    if wanted is not None:
        missing = [i for i in wanted if not 0 <= i < km.layer_count]
        shown = [i for i in wanted if 0 <= i < km.layer_count]
        if missing and not shown:
            raise ValueError(f"{f.name}: none of the requested layers exist "
                             f"(the keymap has layers 0 to {km.layer_count - 1})")
        if missing:
            warn(f"{f.name}: no layer {', '.join(str(i) for i in missing)} "
                 f"(the keymap has layers 0 to {km.layer_count - 1}); skipped")
    else:
        shown = km.nonempty_layers()
    if not shown:
        shown = [0]

    names = dict(km.layer_names)
    names.update({str(k): v for k, v in (side.get("names") or {}).items()})
    if args.names:
        given = [nm.strip() for nm in args.names.split(",")]
        if len(given) != len(shown):
            warn(f"{f.name}: --names has {len(given)} name(s) for {len(shown)} layer(s); "
                 f"they are matched in order" +
                 (", and a name with a comma in it is split (the settings file keeps such a name whole)"
                  if len(given) > len(shown) else ", so the last layer(s) keep their own names"))
        for li, nm in zip(shown, given):
            names[str(li)] = nm
    title = args.title if args.title is not None else side.get("title")
    labels = side.get("labels") or {}
    footer_notes = []
    if det.method == "grid":
        footer_notes.append("matrix grid: real shape unknown")
    if det.unplaced:
        footer_notes.append(f"{det.unplaced} key(s) not drawn: no position on this board")

    dual = args.dual_monitor or args.split_halves
    halves = args.split_halves
    if halves and not browser.is_split(det.board):
        warn(f"{f.name}: {det.board.name} is not a split keyboard, so its halves cannot go on separate "
             f"screens; drawing whole layers across both screens instead")
        halves = False
    combos = args.combos or side.get("combos") or "badges"
    pages = browser.render_pages(km, det.board, job.style_css, width=job.width, height=job.height,
                                 layers=shown, names=names, title=title, labels=labels,
                                 date=job.today, style_name=job.style, note="; ".join(footer_notes),
                                 dual=dual, halves=halves, combos=combos)
    for i, page_html in enumerate(pages):
        suffix = f".{i + 1}" if len(pages) > 1 else ""
        out_html = job.out_dir / f"{out_stem}.{job.style}{suffix}.html"
        out_html.write_text(page_html, encoding="utf-8", newline="\n")
        written = out_html.name
        if job.want_png:
            out_png = out_html.with_suffix(".png")
            strips = []
            if dual:
                # one picture per screen as well, for desktops that take a wallpaper per monitor
                strips = [(out_png.with_name(out_png.stem + ".left.png"), 0, job.width),
                          (out_png.with_name(out_png.stem + ".right.png"), job.width, job.width)]
            browser.screenshot(out_html, out_png, job.width * (2 if dual else 1), job.height, args.scale, strips)
            written += f", {out_png.name}" + (f", .left.png, .right.png" if dual else "")
        board_desc = det.board.name + (f" {det.board.layout}" if det.board.layout else "")
        print(f"{f.name} -> {job.out_dir.name}/{written}  [{board_desc} via {det.method}; "
              f"layers {', '.join(str(x) for x in shown)}]")


def cmd_list_boards(term):
    hand = geometry.all_boards()
    if hand:
        print("Board files in boards/:")
        for b in hand:
            print(f"  {b.slug:<14} {b.name}: {len(b.keys)} keys, matrix {b.matrix[0]}x{b.matrix[1]}")
    zmk_hits = geometry.search_zmk_index(term or "")
    if zmk_hits:
        label = f"matching {term!r}" if term else "in the ZMK index"
        print(f"\n{len(zmk_hits)} ZMK keyboards {label}:")
        for name, disp, layouts in zmk_hits[:20]:
            lay = ", ".join(f"{ln} ({n})" for ln, n in sorted(layouts.items()))
            print(f"  {name:<32} {disp}: {lay}")
        if len(zmk_hits) > 20:
            print(f"  and {len(zmk_hits) - 20} more; add more of the name to narrow the search")
    hits = geometry.search_index(term or "")
    if not geometry.load_index():
        print("No QMK index present (boards/qmk-index.json.gz); run tools/build_qmk_index.py to create it.")
        return 0
    label = f"matching {term!r}" if term else "in the QMK index"
    print(f"\n{len(hits)} keyboards {label}:")     # ranked as the page ranks them: exact, starts with, contains
    for name, disp, layouts in hits[:40]:
        lay = ", ".join(f"{ln} ({n})" for ln, n in sorted(layouts.items()))
        print(f"  {name:<32} {disp}: {lay}")
    if len(hits) > 40:
        print(f"  and {len(hits) - 40} more; add more of the name to narrow the search")
    return 0


@dataclass
class UsbRead:
    """What --from-usb hands on when a style was given: the keyboard's own keymap and board,
    and the browser opened to decode its definition, for main() to go on drawing with."""
    km: vilmod.Keymap
    det: geometry.Detection
    browser: browsermod.Browser


def cmd_from_usb(args):
    """--from-usb: read the connected keyboard.

    Returns an exit code when the run ends here (a plain look, a save, or a failure), or a
    UsbRead when a style was given and the keymap is to be drawn.
    """
    from vilimg import usb
    save_slug, device_index = args.save_board, args.device
    want_keymap = bool(args.save_keymap or args.style)
    try:
        devices = usb.list_devices()
    except ImportError as e:
        print(e)
        return 4
    if not devices:
        print("No Vial keyboard found. Is it plugged in, and is it running Vial firmware?")
        return 4
    print("Vial keyboards connected:")
    for i, d in enumerate(devices):
        print(f"  [{i}] {d['manufacturer']} {d['product']}  (vid {d['vid']:#06x}, pid {d['pid']:#06x})")
    if device_index >= len(devices):
        print(f"--device {device_index} is out of range")
        return 4
    d = devices[device_index]
    read = None
    try:
        if want_keymap:
            read = usb.read_keymap(d["path"])
            protocol, uid, defn = read.protocol, read.uid, read.definition
        else:
            protocol, uid, defn = usb.read_definition(d["path"])
    except Exception as e:
        print(f"Could not read {'the keymap' if want_keymap else 'the definition'} from {d['product']}: {e}")
        return 4
    print(f"\nRead {defn.get('name', '?')}: vial protocol {protocol}, uid {uid}, "
          f"matrix {defn.get('matrix', {}).get('rows')}x{defn.get('matrix', {}).get('cols')}"
          + (f", {read.layers} layers" if read is not None else ""))
    if not save_slug and not args.save_keymap and not args.style:
        print("Pass --save-board <name> to store this geometry as boards/<name>.json (after that this "
              "keyboard's .vil files are recognised automatically), --save-keymap <name> to store its "
              "keymap as keymaps/<name>.vil, or a style name to draw it straight away.")
        return 0
    browser = browsermod.open_browser()
    if browser is None:
        return 3
    try:
        board = browser.call("boardFromDefinition", defn, str(uid), save_slug or "usb")
    except Exception as e:
        print(f"Could not convert the definition: {str(e).splitlines()[0]}")
        browser.close()
        return 4
    board["uids"] = [uid]                # vilimg.js carries the id as text; the board file keeps the number
    layers = None
    if read is not None:
        # the keycode numbers become names in the renderer, which holds QMK's table (docs/keycodes.js)
        codes = browser.call("decodeBuffer", list(read.raw), read.layers, read.rows, read.cols)
        layers = browser.call("namedLayers", codes, [k["matrix"] for k in board["keys"]], protocol)
    if save_slug:
        out = geometry.BOARDS_DIR / f"{save_slug}.json"
        out.write_text(json.dumps(board, indent=1), encoding="utf-8", newline="\n")
        print(f"wrote {_rel(out)}: {len(board['keys'])} keys. Use it with --board {save_slug}, "
              f"or just render: .vil files with uid {uid} now match it.")
        local, changed = geometry.write_user_boards_js()[:2]
        print(f"{'updated' if changed else 'kept'} {_rel(local)}: the board is in index.html's search list (reload the page).")
    km = None
    if layers is not None:
        stem = args.save_keymap or SLUG_FROM_NAME.sub("-", (defn.get("name") or "keyboard").lower()).strip("-") or "keyboard"
        km = vilmod.Keymap(path=KEYMAPS / f"{stem}.vil", kind="vil", uid=uid, layers=layers)
        if args.save_keymap:
            KEYMAPS.mkdir(parents=True, exist_ok=True)
            km.path.write_text(json.dumps(usb.keymap_file(uid, protocol, read.via, layers), indent=1),
                               encoding="utf-8", newline="\n")
            print(f"wrote {_rel(km.path)}: {len(layers)} layers with QMK keycode names (the Vial app's own names "
                  f"differ, so the file is for the generator rather than for importing into Vial).")
    if not args.style:
        browser.close()
        return 0
    det = geometry.detect(km, browser, save_slug) if save_slug else \
        geometry.Detection(board=geometry._parse_board_file(board, "usb"), method="usb")
    return UsbRead(km, det, browser)


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="keymap-imgen.py", allow_abbrev=False,
        description="Render Vial .vil and QMK keymap.json files as styled layout images "
                    "(an HTML page and a PNG per keymap; needs Playwright, see README.md).")
    ap.add_argument("style", nargs="?", help=f"style name, e.g. outrun (see --list); default {DEFAULT_STYLE}")
    ap.add_argument("files", nargs="*", help="keymap files (default: every keymap in keymaps/, or in the current "
                                             "folder when keymaps/ is empty)")
    ap.add_argument("--list", action="store_true", help="list the available styles and exit")
    ap.add_argument("--list-boards", nargs="?", const="", metavar="SEARCH",
                    help="list known keyboards, optionally filtered by a search word, and exit")
    ap.add_argument("--board", help="keyboard geometry: a boards/ file name, a QMK name like crkbd/rev1, or grid for a plain grid")
    ap.add_argument("--layout", help="layout name when the QMK board has several, e.g. LAYOUT_split_3x5_3")
    ap.add_argument("--layers", type=parse_layers, help="layers to draw, e.g. 0,1,2,4 (default: every layer with keys)")
    ap.add_argument("--names", help='layer names in order of --layers, e.g. "Base,Numbers,Symbols,Nav"')
    ap.add_argument("--title", help="title printed bottom-left (default: the file name)")
    ap.add_argument("--size", type=parse_size, default=(1920, 1080), help="page size, default 1920x1080")
    ap.add_argument("--scale", type=parse_scale, default=2.0, help="PNG pixel scale, default 2 (3840x2160 from 1920x1080)")
    ap.add_argument("--out", type=Path, help="output folder (default: output/)")
    ap.add_argument("--no-png", action="store_true", help="write the HTML page only, no PNG")
    ap.add_argument("--no-date", action="store_true", help="leave the build date off the page")
    ap.add_argument("--dual-monitor", "--dual", action="store_true",
                    help="a picture two screens wide, the layers shared between the screens; also writes "
                         "a .left.png and a .right.png, one per screen")
    ap.add_argument("--split-halves", "--halves", action="store_true",
                    help="with --dual-monitor (implied): every layer on both screens, the left half of a "
                         "split keyboard on the left screen and the right half on the right, drawn larger")
    ap.add_argument("--combos", choices=["badges", "lines", "panel", "text", "off"],
                    help="how combos (several keys pressed together producing another key) are drawn: "
                         "badges (numbered markers plus a list, the default), lines (joining the keys), "
                         "panel (their own extra quad), text (a line of prose per combo), or off")
    ap.add_argument("--from-usb", action="store_true",
                    help="read the connected Vial keyboard's own layout definition; with a style name as well, render afterwards")
    ap.add_argument("--save-board", metavar="NAME", help="with --from-usb: save the definition as boards/NAME.json")
    ap.add_argument("--save-keymap", metavar="NAME", help="with --from-usb: save the keyboard's keymap as keymaps/NAME.vil")
    ap.add_argument("--device", type=int, default=0, help="with --from-usb: which connected keyboard (default 0)")
    ap.add_argument("--refresh-page", action="store_true",
                    help="rewrite docs/boards-user.js (the board files and styles you added) so index.html lists them, and exit")
    ap.add_argument("--version", action=_VersionAction, help="print the version and the QMK data date, then exit")
    args = ap.parse_args(argv)

    if args.refresh_page:
        local, changed, nb, ns = geometry.write_user_boards_js()
        print(f"{'wrote' if changed else 'unchanged'} {_rel(local)}: {nb} board file(s) and {ns} style(s) beyond the "
              f"shipped list ({len(geometry.list_boards())} board files in boards/ in all)")
        return 0
    if args.list:
        for name, desc in styles.list_styles():
            print(f"  {name:<18} {desc}")
        return 0
    if args.list_boards is not None:
        return cmd_list_boards(args.list_boards)
    for opt, val in (("--save-board", args.save_board), ("--save-keymap", args.save_keymap)):
        if val and not SLUG.match(val):
            err(f"{opt} names use lower-case letters, digits and dashes only (not {val!r})")
            return 2
    usb_read = None
    if args.from_usb:
        res = cmd_from_usb(args)
        if isinstance(res, int):
            return res      # done, or failed; with a style name the read goes on to be drawn
        usb_read = res
    style, files_arg = args.style, list(args.files)
    if style and style not in {n for n, _ in styles.list_styles()} and \
            (Path(style).is_file() or (any(ch in style for ch in "*?[") and glob.glob(style))):
        # "python keymap-imgen.py my.vil" (or keymaps/*.vil): a file in the style's place; use the default style
        files_arg.insert(0, style)
        style = None
    style_note = not style      # printed once there is something to render, not before a failure
    if not style:
        style = DEFAULT_STYLE

    try:
        style_src = styles.read_style(style)
    except FileNotFoundError as e:
        err(str(e))
        return 2

    if usb_read is not None:
        files = []              # the keymap came from the keyboard; nothing to read from disk
    elif files_arg:
        try:
            files = expand_files(files_arg)
        except FileNotFoundError as e:
            err(str(e))
            return 1
        missing = [f for f in files if not f.exists()]
        if missing:
            err("file not found: " + ", ".join(str(f) for f in missing))
            return 1
    else:
        files, folder = find_keymaps()
        if not files:
            err(f"no keymap files found. Save a .vil or keymap.json into {KEYMAPS} "
                f"(or the current folder) and run again.")
            return 1
        print(f"{len(files)} keymap(s) in {folder}")
    if style_note:
        print(f"no style given: using {DEFAULT_STYLE} (--list shows the others)")

    out_dir = args.out or OUTPUT
    out_dir.mkdir(parents=True, exist_ok=True)

    browser = usb_read.browser if usb_read is not None else browsermod.open_browser()
    if browser is None:
        return 3       # the install lines were printed; nothing can be drawn without the renderer
    style_css, style_notes = styles.inline_fonts(style_src, browser)
    for msg in style_notes:
        warn(msg)
    width, height = args.size
    job = RenderJob(args=args, style=style, style_css=style_css, browser=browser, want_png=not args.no_png,
                    out_dir=out_dir, today="" if args.no_date else date.today().isoformat(), width=width, height=height)

    failures = 0
    rendered = 0
    # a.vil and a.json in one run would overwrite each other's output; keep the suffix for those
    stems = {}
    for f in files:
        stems.setdefault(f.stem, []).append(f)
    for stem, group in stems.items():
        if len(group) > 1:
            warn(f"{' and '.join(g.name for g in group)} share a name; their pictures are named by the full file name")
    try:
        if usb_read is not None:
            try:
                render_km(usb_read.km, usb_read.det, {}, job, usb_read.km.path.stem)
                rendered += 1
            except Exception as e:
                err(f"{usb_read.km.path.name}: could not render ({type(e).__name__}: {e})")
                failures += 1
        for f in files:
            out_stem = f.name if len(stems[f.stem]) > 1 else f.stem
            try:
                render_one(f, job, out_stem)
                rendered += 1
            except (ValueError, LookupError, OSError) as e:
                msg = str(e)     # the loader already names the file in its messages
                err(msg if msg.startswith(f.name) else f"{f.name}: {msg}")
                failures += 1
            except Exception as e:   # a keycode or file shape the code did not expect: report it, keep going
                err(f"{f.name}: could not render ({type(e).__name__}: {e})")
                failures += 1
    finally:
        browser.close()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
