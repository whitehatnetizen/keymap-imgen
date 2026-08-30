"""Render the sample in every style and write 1600-wide previews to docs/gallery/.

Three per style, as WebP (a fifth of the PNG size; every browser and GitHub's README
rendering read it): <style>.webp (one screen), <style>.dual.webp (two screens, layers
shared out) and <style>.halves.webp (two screens, one half of the keyboard on each); the
page shows the one matching the boxes ticked in step 05.

    python tools/make_gallery.py
    python tools/make_gallery.py corporate sepia

Needs Playwright (the renderer) and Pillow (for the downscale). One browser is started
for all the styles, or only the styles named on the command line. Maintainer tool; users never need it.
"""

import importlib.util
import sys
import tempfile
from datetime import date
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "samples" / "corne-qwerty.vil"
OUT = ROOT / "docs" / "gallery"

sys.path.insert(0, str(ROOT))
_spec = importlib.util.spec_from_file_location("keymap_imgen", ROOT / "keymap-imgen.py")
cli = importlib.util.module_from_spec(_spec)   # keymap-imgen.py, loaded by path (a hyphen keeps it out of import)
_spec.loader.exec_module(cli)
from vilimg import browser as browsermod, geometry, styles, vil as vilmod  # noqa: E402


def main():
    km = vilmod.load(SAMPLE)
    side = cli.read_settings(SAMPLE)
    names = dict(km.layer_names)
    names.update(side.get("names") or {})
    b = browsermod.open_browser()
    if b is None:
        return 3
    det = geometry.detect(km, b, side.get("board"), side.get("layout"), method_hint="settings")
    OUT.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            wanted = set(sys.argv[1:])
            for style, _ in styles.list_styles():
                if wanted and style not in wanted:
                    continue
                css, notes = styles.load_style(style, b)
                for n in notes:
                    print(f"  [warn] {style}: {n}")
                for suffix, dual, halves, scale in (("", False, False, 2), (".dual", True, False, 1),
                                                    (".halves", True, True, 1)):
                    page = b.render_pages(km, det.board, css, layers=side.get("layers"), names=names,
                                          title=side.get("title"), labels=side.get("labels") or {},
                                          date=today, style_name=style, dual=dual, halves=halves)[0]
                    html = Path(tmp) / f"{style}{suffix}.html"
                    html.write_text(page, encoding="utf-8", newline="\n")
                    big = html.with_suffix(".png")
                    b.screenshot(html, big, 3840 if dual else 1920, 1080, scale)
                    im = Image.open(big)
                    im.thumbnail((1600, 900))
                    im.convert("RGB").save(OUT / f"{style}{suffix}.webp", quality=90, method=6)
                    (OUT / f"{style}{suffix}.png").unlink(missing_ok=True)   # the format before 0.9.3
                    print(f"gallery: {style}{suffix}.webp {im.size}")
    finally:
        b.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
