# Writing a style

A style is one CSS file here. Its file name is the name typed on the command line, and
its first line is a comment that `--list` prints as the description:

```css
/* Sepia: brown ink on cream, for printing. */
```

`_base.css` loads first and carries the structure: the grid of boards, the key boxes, the
legend spans, the header per layer, the footer. A style sets colours, fonts and any
decoration on top. The easiest start is a copy of `plain.css`.

## Tokens

Set these in `:root`. The base sheet uses them everywhere with grey fallbacks.

| Token | Used for |
|---|---|
| `--bg` | page background |
| `--card` | key face |
| `--ink` | main text |
| `--sec` | secondary text: modifier keys, small labels, the footer |
| `--line` | key borders |
| `--acc` | the layer-key outline and the bottom-left title |
| `--brass` | the "Layer n" number in each header and the footer separators |
| `--heldbg` | fill of the held key on the layer it opens |
| `--held-ink` | text on that held key |
| `--font-title` | header per layer |
| `--font-legend` | single-glyph legends (letters, symbols) |
| `--font-word` | word legends (Shift, Enter, Layer 2) |
| `--font-label` | small caps labels: access line, sub-labels, footer |

Two values are set by the renderer and can be used in `calc()`: `--s` on `body` is the
page scale (1.0 at 1920 x 1080, smaller pages scale down), and `--u` on each `.board` is
the key pitch in pixels. Size anything that should follow the page with `--s` and
anything inside a key with `--u`.

## Classes

```
.page                      the whole page; ::before / ::after are free for decoration
.grid                      the grid of layers
.quad[data-layer="n"]      one layer: .qhead (.qtitle > .no, .dot; .qaccess; .drule) then .boardwrap > .board
.key                       one key, absolutely positioned inside .board
.key .lg / .word / .combo / .tag     the legend, by kind (glyph, word, modifier combo, long label)
.key .sub                  small line under the legend (hold, kp, toggle ...)
.key.mod                   modifier keys and other keys drawn in the secondary colour
.key.layerkey              a key that reaches another layer ("hold")
.key.modtap                a mod-tap or layer-tap key
.key.held                  the layer's own key shown pressed
.key.trns                  KC_TRNS, falls through to the layer below
.key.dead                  KC_NO, nothing assigned
.cmb-badge                 combo marker: a numbered dot on a trigger key (a .board sibling of the keys)
.cmb-lines / .cmb-chip     combo lines mode: the svg of joining lines, and the output chip at their meeting point
.cmb-list                  the combo list under a board (<b> holds the number)
.cmb-prose                 one line of the combo text mode, under the layer header
.quad[data-layer="combos"] the extra board of the combo panel mode
.mapping                   the title, bottom-left
.footer                    board, source file, date, notes, centred at the bottom
.frame                     a drawing frame inset from the page edge; display:none in the base sheet
.tb                        a title block (board, source, date, sheet); display:none in the base sheet
```

The blueprint styles show `.frame` and `.tb` and hide `.footer`; see `blueprint.css`.

## Fonts

Reference a font file as `url('fonts/<file>')` in an `@font-face` rule and put the file
in `fonts/`. The renderer embeds it into the HTML, so the page needs no network and no
folder next to it. Only bundle fonts whose licence permits redistribution (the SIL Open
Font License does; add the family to `fonts/README.md`).
