# Board geometry files

One JSON file per keyboard. The script picks one by `--board`, by the `.vil` file's `uid`,
or by matching the matrix shape and which positions hold keys.

```json
{
  "name": "Corne 42",
  "slug": "corne42",
  "matrix": [8, 6],
  "uids": [],
  "note": "where the geometry came from and how well it is checked",
  "keys": [
    {"matrix": [0, 0], "x": 0, "y": 0.45},
    {"matrix": [3, 3], "x": 3.3, "y": 3.42, "r": 5, "rx": 3.8, "ry": 3.92}
  ]
}
```

- `matrix` on a key is `[row, col]` into the `.vil` layout arrays. In a `.vil` the rows of
  a split board run left half first (rows 0 to 3), then right half (rows 4 to 7).
- `x`, `y` are the key's top-left corner in key units (1 = one key pitch, 19.05 mm on a
  standard board). `w`, `h` default to 1.
- `r` rotates the key that many degrees clockwise about the point `rx`, `ry`, given as
  absolute positions in key units (QMK's `info.json` uses the same names). When `rx`, `ry`
  are absent the key rotates about its own centre: QMK documents no default and its own
  tools do not draw rotation, and most rotated keys in QMK's data carry no pivot. A board's
  `layouts.LAYOUT.layout` list from QMK is a good starting point; add the `matrix` pair to
  each entry.
- `uids`: the `uid` values seen in `.vil` files from this board, for automatic detection.
  Vial assigns one per keyboard definition, so every board flashed with the same firmware
  shares it. Add yours if it is missing.
- `matrix` at the top level is `[rows, cols]` of the layout arrays, used for detection
  when no uid matches.

To find your matrix positions, open the `.vil` in a text editor: `layout[0]` is layer 0,
each inner list is a row, and `-1` marks a position with no key. Press keys in Vial and
watch which entry changes if the order is not obvious.

Test a new file with `python keymap-imgen.py plain your.vil --board yourslug` and compare
the picture with the board in front of you.
