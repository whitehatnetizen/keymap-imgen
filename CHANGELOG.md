# Changelog

Every release is a git tag (`v1.1.1` and so on). Dates are the day the tag was made.

## 1.2.0, 2026-09-01

- Combos (keys pressed together that give another key) are drawn: numbered badges with a
  list under the board (the default), lines joining the keys, a panel of their own, or a
  line of text per combo, chosen on the page or with `--combos`; `off` restores the old
  behaviour. A combo that opens a layer joins that layer's title line, and its keys are
  shown held there. Vial combo slots are resolved by searching the layers, so a stale
  combo whose keys were remapped away is dropped rather than guessed at.
- ZMK keymaps: a `.keymap` file (devicetree text) renders like a `.vil` or
  `keymap.json`, including its combos (position-addressed) and custom `&kp`/`&mo`
  hold-taps; bindings are translated to the same legends QMK keycodes get. One
  self-contained file is the scope: `#include` lines are ignored, single-line `#define`
  names are substituted.
- ZMK geometry: a bundled ZMK index (`boards/zmk-index.json.gz`, from the
  `zmk,physical-layout` definitions in the ZMK repository and known vendor module
  repositories, `boards/ZMK-DATA-NOTICE.md`) joins the board search on the page and
  `--list-boards`; a board's own `-layouts.dtsi` file works directly as `--board` or
  dropped on the page's Keyboard section. A third sample keymap, `samples/corne-zmk.keymap`.
- A key that sits in several combos gets one badge holding every number, instead of the
  last badge hiding the others; the layout-size warning no longer piles up a copy per
  redraw on the page; the combos choice is visibly dimmed when the keymap has no combos.

## 1.1.1, 2026-08-30

- First public release. The page draws a Vial `.vil` or QMK `keymap.json` in the browser
  and downloads it as a PNG (1x or 2x, one per screen for two monitors) or an SVG; the
  command line makes the same pictures with Playwright; a Vial keyboard can be read over
  USB; two sample keymaps (a split 40% and a 60%); 33 styles; English, Spanish and German.
- The number says the page, the command line and the file formats (board files, settings
  files, `docs/boards-user.js`) are settled and will change in the way the semantic
  version promises: a patch fixes, a minor adds, a major breaks.
