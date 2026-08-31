# ZMK board geometry data: provenance and licence

`zmk-index.json.gz` in this folder and `docs/zmk-boards.js` were generated on 2026-09-01
by `tools/build_zmk_index.py` from the `zmk,physical-layout` nodes (per-key positions in
centi-key-units) in these repositories (34 boards in all):

- https://github.com/zmkfirmware/zmk (branch main, licence MIT)
- https://github.com/hitsmaxft/zmk-keyboard-cornix (branch main, licence Apache-2.0)

For each keyboard they keep a name and the position of every key in every physical
layout. Nothing else from those projects is included. ZMK Firmware is copyright the ZMK
Contributors, MIT licensed; the vendor repositories are copyright their authors under the
licences listed above. These derived data files are provided under the same terms with
credit to their projects. The rest of this repository (the code, styles and fonts) is
separately licensed; see `LICENSE` and `fonts/README.md`.

To refresh after boards are added, re-run the script; new vendor module repositories are
added to SOURCE_REPOS in the script, licence checked, one line each.
