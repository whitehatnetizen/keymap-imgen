# Changelog

Every release is a git tag (`v1.1.1` and so on). Dates are the day the tag was made.

## 1.1.1, 2026-08-30

- First public release. The page draws a Vial `.vil` or QMK `keymap.json` in the browser
  and downloads it as a PNG (1x or 2x, one per screen for two monitors) or an SVG; the
  command line makes the same pictures with Playwright; a Vial keyboard can be read over
  USB; two sample keymaps (a split 40% and a 60%); 33 styles; English, Spanish and German.
- The number says the page, the command line and the file formats (board files, settings
  files, `docs/boards-user.js`) are settled and will change in the way the semantic
  version promises: a patch fixes, a minor adds, a major breaks.
