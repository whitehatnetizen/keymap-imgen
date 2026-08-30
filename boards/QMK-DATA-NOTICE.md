# Board geometry data: provenance and licence

`qmk-index.json.gz` in this folder and `docs/boards.js` were generated on 2026-08-27
by `tools/build_qmk_index.py` from the QMK Firmware project's published keyboard data at
https://keyboards.qmk.fm/v1 (3753 keyboards). For each keyboard they keep the name, matrix size, and
the position of every key in every layout. Nothing else from QMK is included.

QMK Firmware is copyright its contributors and released under the GNU General Public
License, version 2 or later (https://github.com/qmk/qmk_firmware). These derived data
files are provided under the same terms with credit to the QMK project. The rest of this
repository (the code, styles and fonts) is separately licensed; see `LICENSE` and
`fonts/README.md`.

To refresh after QMK adds keyboards, re-run the script; it resumes from a partial file if
interrupted.

## Keycode names

`docs/keycodes.js` was generated on 2026-08-27 by `tools/build_keycodes.py` from the same
project's keycode data (https://github.com/qmk/qmk_firmware/tree/master/data/constants/keycodes, spec 0.0.8):
the number of every named keycode and the layout of the ranges (mod-tap, layer-tap, ...). It turns
the numbers a keyboard reports over USB back into names, on the page and on the command line. Same licence
and terms as the geometry data above.
