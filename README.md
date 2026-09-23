# Keymap Image Generator

Makes a picture of your keyboard's keymap, one board per layer, for anyone who runs Vial, QMK or ZMK firmware.

![The outrun style: four layers of a Corne keymap](docs/gallery/outrun.webp)

Works with Vial `.vil` exports, QMK `keymap.json` files and ZMK `.keymap` files, knows
the shape of every keyboard in QMK's public data (3,753 boards) and of the ZMK boards
that publish physical layouts, and can read a Vial keyboard's own shape and keymap over
USB for clones and one-offs. Combos (keys pressed together that give another key) are
drawn in your choice of four ways. Output is an HTML page per keymap and a 4K PNG for a
wallpaper or a forum post, in any of 45 styles.

## See it

Open the page and drop a keymap on it, or plug in a Vial keyboard and press "Read my
keyboard" (Chrome, Edge and other Chromium browsers; not Firefox or Safari): the picture
is drawn in your browser and downloaded as a PNG
or an SVG. Nothing is uploaded. Hosted copy: `https://whitehatnetizen.github.io/keymap-imgen/`
(live from the 1.0 release; until then, serve the folder yourself, see "The page" below).

![The page in use: the sample keymap loaded, then drawn in a few styles](docs/screenshots/page.gif)

Stills of the page are in `docs/screenshots/`; the pictures it makes are in the style
gallery further down.

## Install

You need Python 3.10 or newer. The one dependency is Playwright, which runs the drawing
in a headless Chromium; the browser is downloaded once (about 150 MB):

```
python -m pip install -r requirements.txt
python -m playwright install chromium
```

On macOS and Linux the command is usually `python3` (so `python3 -m pip ...`); on Windows,
`python`. If typing `python` on Windows opens the Microsoft Store instead of running
anything, Python is not installed yet: install it from https://www.python.org/downloads/
and tick "Add python.exe to PATH" in the installer (the Store copy works too, but the
python.org one is the usual choice). If Python is installed and the Store still opens,
switch off the two `python` entries under Settings → Apps → Advanced app settings → App
execution aliases. Reading a keyboard over USB from the command line needs one more package,
`python -m pip install hidapi` (see "Clones and boards with extra keys"); the web page
reads USB without it.

Get it with `git clone https://github.com/whitehatnetizen/keymap-imgen.git`,
or download the zip from GitHub (the green Code button, Download ZIP) and unpack it.

## First run in 60 seconds

A sample keymap ships in the folder, so you can see a picture before exporting anything
of your own:

```
git clone https://github.com/whitehatnetizen/keymap-imgen.git
cd keymap-imgen
python -m pip install -r requirements.txt && python -m playwright install chromium
python keymap-imgen.py outrun samples/corne-qwerty.vil
```

Open `output/corne-qwerty.outrun.png`: the picture at the top of this page, drawn on
your machine. The Playwright download is most of the minute. Two QMK samples sit beside the
Vial one, in the format QMK Configurator exports: `python keymap-imgen.py outrun samples/crkbd-qwerty.json`
draws a three-layer Corne keymap, and `python keymap-imgen.py outrun samples/dz60-qwerty.json`
a three-layer keymap on a 60% board (DZ60, ANSI), for anyone whose keyboard is not split.

## Run it with your own keymap

1. Export your keymap. Vial app: File → Save current layout (a `.vil` file). QMK
   Configurator: Export keymap (a `.json` file). ZMK: the `.keymap` file from your
   config repository, as it is. Save it into the `keymaps/` folder.
2. Open `index.html` (in the `keymap-imgen` folder) in your browser. Opened from the folder it is a
   command builder: it reads your keymap, finds your keyboard, lets you choose layers,
   style and whether you want a PNG, and writes the command for you. Copy it.
3. Open a terminal in the `keymap-imgen` folder, paste the command, press Enter.
   Your pictures are in `output/`.

If you would rather skip the page:

```
python keymap-imgen.py outrun
```

renders every keymap in `keymaps/` in the `outrun` style; `python keymap-imgen.py` on its
own does the same in `plain`, the default style. On Windows, double-clicking
`keymap-imgen.bat` runs that default; to make it rerun a command from the page, replace the
`python keymap-imgen.py` line inside the file with that command.

### Playwright

The drawing code is one JavaScript file, `docs/vilimg.js`, shared with the web page. The
command line runs it in a headless Chromium through [Playwright](https://playwright.dev/python/):

```
python -m pip install -r requirements.txt
python -m playwright install chromium
```

Without it the command line draws nothing: it prints those two lines and stops.

### Commands

```
python keymap-imgen.py                                 every keymap in keymaps/, plain style (the default)
python keymap-imgen.py outrun                          every keymap in keymaps/, outrun style
python keymap-imgen.py keymaps/my-corne.vil            one file, plain style
python keymap-imgen.py outrun keymaps/my-corne.vil     one file
python keymap-imgen.py blueprint_light keymaps/*.vil   several (* and ? are expanded by the command itself, on Windows too)
python keymap-imgen.py --list                          the styles
python keymap-imgen.py --list-boards sofle             keyboards whose name contains "sofle"
python keymap-imgen.py --from-usb                      what the connected Vial keyboard says it is
python keymap-imgen.py --from-usb --save-board mine    save its shape as boards/mine.json
python keymap-imgen.py --from-usb --save-keymap mine   save its keymap as keymaps/mine.vil
python keymap-imgen.py outrun --from-usb               draw the connected keyboard's keymap, no file needed
```

With no file named, the command renders every keymap in `keymaps/`; when that folder is
empty it looks in the folder the terminal is in instead (a `.vil` dropped beside
`keymap-imgen.py` works too).

Each keymap `name.vil` (or `name.json`) produces `output/name.<style>.html` and
`output/name.<style>.png`. The PNG is 3840 x 2160 by default (7680 x 2160 with
`--dual-monitor`, plus one 3840 x 2160 picture per screen).

Exit codes, for scripts that call the command: `0` every keymap drawn; `1` a keymap file was
not found or failed to render (the others are still drawn); `2` a bad option, name or style;
`3` Playwright is not installed (the two install lines are printed); `4` the USB read failed
(no keyboard, no hidapi, or the board did not answer).

### Options

```
--board crkbd/rev1    which keyboard: a QMK name, a file in boards/, or grid for a plain grid (default: detected)
--layout LAYOUT_split_3x5_3   which layout, when the keyboard has several
--layers 0,1,2,4      which layers to draw (default: every layer that has a key on it)
--names "Base,Function and numbers,Symbols,Navigation"   names for those layers, in the same order
--title qwerty        the label printed bottom-left (default: the file name)
--no-png              the HTML page only, no PNG
--size 1920x1080      page size in CSS pixels (default 1920x1080)
--scale 2             PNG pixel scale; 2 gives 3840x2160 from the default size
--out folder          write outputs there instead of output/
--no-date             leave the build date off the page
--dual-monitor        a picture two screens wide (7680 x 2160 by default), the layers shared
                      between the screens; also writes name.<style>.left.png and .right.png
--split-halves        every layer on both screens, the left half of a split keyboard on the
                      left screen and the right half on the right, drawn larger (implies
                      --dual-monitor; a keyboard that is not split gets the shared layout)
--dual, --halves      the same two, shorter
```

### Two monitors

`--dual-monitor` makes one picture twice as wide, with a hard seam in the middle: each
screen is a complete page with its own footer, so nothing sits across the join. The
layers are shared out, half on each screen. `--split-halves` instead puts every layer
on both screens, the left half of the keyboard on the left and the right half on the
right; with the whole screen height for a half-keyboard the keys come out about
twice the size. Both write the wide picture and one PNG per screen (`.left.png`,
`.right.png`), for desktops that take one wallpaper per monitor (Windows does).

## Reading the picture

- A key outlined in the accent colour, marked "hold", reaches another layer from where it sits.
- A key filled in the accent colour, marked "held", is that same key shown pressed, on the
  layer it opens. Which key that is comes from your layer 0, not from a setting.
- Dimmed or dashed keys are `KC_TRNS`: the press falls through to the layer below. They are
  drawn without a legend, since the file does not say which layer is below at the time.
- Empty dotted keys are `KC_NO`: nothing assigned.
- Small text under a legend: "kp" for numpad keycodes, "hold: Ctrl" for mod-tap keys,
  "hold: layer 2" for layer-tap keys, "toggle" / "one shot" / "macro" where those apply.
  On a key too narrow for the line it shrinks a little, and a long one drops the "hold:"
  ("Shift", "layer 2") rather than wrap.
- A tap-dance key prints its tap action as the legend and its hold action underneath
  ("Enter" with "hold: layer 3"), or the double tap ("2x: Home") when there is no hold action,
  read from the file's tap-dance table. A `.vil` without the table shows "TD 3".
- The line under each layer's title says which key reaches it ("Hold left middle thumb"),
  worked out from the geometry; treat it as a pointer to the picture, not a measurement.

## Combos

A combo is several keys pressed together that give another key. Vial files carry them as
keycode pairs (resolved by searching the layers, so a combo whose keys were remapped away
is honestly dropped); ZMK keymaps name key positions directly. When a file has combos
they are drawn, in one of four ways, chosen on the page (Picture section) or with
`--combos`:

- **badges** (the default): a small numbered marker on each key of the combo, and a list
  under the board (`1  J + K : Esc`).
- **lines**: thin lines joining the keys, the output in a chip where they meet. A combo
  that is ambiguous, on a crowded layer (more than six), or split across the two screens
  of `--split-halves` falls back to its badge and the list.
- **panel**: the layers stay clean and one extra board is drawn after them, titled
  Combos, with only the combo keys filled and numbered.
- **text**: nothing on the keys; a line of prose per combo under the layer title
  ("J and K together give Esc").
- **off**: nothing drawn, as before this option existed.

A combo whose output is a layer switch also joins that layer's title line ("Hold ... and
... together"), and its keys are shown held on the layer it opens.

## The page

`index.html` has two modes, decided by how it is opened. Served over http or https (the
hosted copy, or `python -m http.server` in the `keymap-imgen` folder, then http://localhost:8000/)
it does everything in the browser: choose a keymap file, drop one on the page, or plug in
a Vial keyboard and press "Read my keyboard" (Chromium browsers; the USB read needs https
or localhost); tick the layers, pick a style, and the picture is drawn as you go; download
the PNG (1x or 2x, one per screen for two monitors) or an SVG, which stays sharp at any
size (a browser draws it exactly as the page does; the sheet inside it is HTML, which most
vector editors cannot read). Opened straight from
the folder, where browsers block the fetches, it becomes the command builder for the
command line described above. Both routes make the same pictures.

The page reads in English, Spanish and German: the buttons at the top right switch,
`?lang=es` (or `de`) in the address opens it in that language, and a browser
set to one of them gets it without asking. The command line, the pictures and this README
stay English. Corrections to a translation are welcome; see `CONTRIBUTING.md`.

The Theme control at the top offers Light, Dark and "I feel lucky", which paints the page
itself in the palette of one of the image styles, a different one on every click (the pick is
named beside the buttons, and Light or Dark brings the page back). Light and Dark are
remembered; a lucky pick is not, so the next visit follows the browser setting again.

The page remembers the style, the computer and the picture options you chose last time,
in the browser's own storage (nothing is sent anywhere); the keymap itself is never kept.

Everything the page needs is static, so hosting it is serving the `keymap-imgen` folder as it is
(GitHub Pages, any web server, `python -m http.server`). The page fetches
`boards/qmk-index.json.gz` and inflates it in the browser, so the server must hand the
`.gz` over unchanged (GitHub Pages does). The `.nojekyll` file at the root stays: without
it GitHub Pages runs Jekyll, which does not serve `styles/_base.css` (the underscore), and
the page draws nothing.

## Styles

A style is one CSS file in `styles/`; `--list` shows them with a one-line description.
`plain` is the printer-friendly reference card (thick outlines, no fills, no webfonts),
with four variants of the same card: `plain_cream` (a warm paper tint), `plain_ink` (outlines
and titles in a deep blue), `sage` (a dusty green) and `sage_dark` (the card inverted).
`high_contrast` and `high_contrast_dark` are for reading at a distance or with low vision:
pure black and white, the largest legends, and layer keys marked by a corner flag and a
double outline rather than by colour. The other styles come in pairs, a dark and a light
version of each look.

The printer card and its variants:

| `plain` | `plain_cream` | `plain_ink` |
|---|---|---|
| ![plain](docs/gallery/plain.webp) | ![plain_cream](docs/gallery/plain_cream.webp) | ![plain_ink](docs/gallery/plain_ink.webp) |
| `sage` | `sage_dark` | |
| ![sage](docs/gallery/sage.webp) | ![sage_dark](docs/gallery/sage_dark.webp) | |

| `high_contrast` | `high_contrast_dark` |
|---|---|
| ![high_contrast](docs/gallery/high_contrast.webp) | ![high_contrast_dark](docs/gallery/high_contrast_dark.webp) |

| `paper` | `paper_dark` |
|---|---|
| ![paper](docs/gallery/paper.webp) | ![paper_dark](docs/gallery/paper_dark.webp) |

| `outrun` | `outrun_light` |
|---|---|
| ![outrun](docs/gallery/outrun.webp) | ![outrun_light](docs/gallery/outrun_light.webp) |

| `blueprint` | `blueprint_light` |
|---|---|
| ![blueprint](docs/gallery/blueprint.webp) | ![blueprint_light](docs/gallery/blueprint_light.webp) |

| `obsidian` | `obsidian_light` |
|---|---|
| ![obsidian](docs/gallery/obsidian.webp) | ![obsidian_light](docs/gallery/obsidian_light.webp) |

| `slate` | `slate_light` |
|---|---|
| ![slate](docs/gallery/slate.webp) | ![slate_light](docs/gallery/slate_light.webp) |

| `terminal` | `terminal_light` |
|---|---|
| ![terminal](docs/gallery/terminal.webp) | ![terminal_light](docs/gallery/terminal_light.webp) |

| `cyberpunk` | `cyberpunk_light` |
|---|---|
| ![cyberpunk](docs/gallery/cyberpunk.webp) | ![cyberpunk_light](docs/gallery/cyberpunk_light.webp) |

| `corporate` | `corporate_dark` |
|---|---|
| ![corporate](docs/gallery/corporate.webp) | ![corporate_dark](docs/gallery/corporate_dark.webp) |

| `retro` | `retro_light` |
|---|---|
| ![retro](docs/gallery/retro.webp) | ![retro_light](docs/gallery/retro_light.webp) |

| `solarized` | `solarized_light` |
|---|---|
| ![solarized](docs/gallery/solarized.webp) | ![solarized_light](docs/gallery/solarized_light.webp) |

| `catppuccin` | `catppuccin_light` |
|---|---|
| ![catppuccin](docs/gallery/catppuccin.webp) | ![catppuccin_light](docs/gallery/catppuccin_light.webp) |

| `gruvbox` | `gruvbox_light` |
|---|---|
| ![gruvbox](docs/gallery/gruvbox.webp) | ![gruvbox_light](docs/gallery/gruvbox_light.webp) |

| `nord` | `nord_light` |
|---|---|
| ![nord](docs/gallery/nord.webp) | ![nord_light](docs/gallery/nord_light.webp) |

| `dracula` | `dracula_light` |
|---|---|
| ![dracula](docs/gallery/dracula.webp) | ![dracula_light](docs/gallery/dracula_light.webp) |

| `tokyonight` | `tokyonight_light` |
|---|---|
| ![tokyonight](docs/gallery/tokyonight.webp) | ![tokyonight_light](docs/gallery/tokyonight_light.webp) |

| `bubblegum` | `bubblegum_light` |
|---|---|
| ![bubblegum](docs/gallery/bubblegum.webp) | ![bubblegum_light](docs/gallery/bubblegum_light.webp) |

| `torii` | `torii_light` |
|---|---|
| ![torii](docs/gallery/torii.webp) | ![torii_light](docs/gallery/torii_light.webp) |

| `sakura` | `sakura_dark` |
|---|---|
| ![sakura](docs/gallery/sakura.webp) | ![sakura_dark](docs/gallery/sakura_dark.webp) |

| `nuclear` | `nuclear_light` |
|---|---|
| ![nuclear](docs/gallery/nuclear.webp) | ![nuclear_light](docs/gallery/nuclear_light.webp) |

### Your own style

Copy the style closest to what you want, rename it, and edit; the class names and tokens
are documented in `styles/README.md`. Fonts referenced as `url('fonts/<file>')` are
embedded into the HTML at build time, so the output stays a single file that opens
anywhere.

## Which keyboards

A keymap file holds no physical layout, only the key matrix (a `.vil`) or the keys in
layout order (a `keymap.json`), so the generator needs the shape of your board. It looks in
this order:

1. **`--board`, or the settings file.** A QMK keyboard name such as `crkbd/rev1` or
   `sofle/rev1`, a ZMK board name such as `corne` or `cornix`, a ZMK layouts `.dtsi`
   file, or the name of a file in `boards/`.
2. **The keyboard named inside a QMK `keymap.json`.** Used as is, with its layout.
3. **The `uid` inside a `.vil`**, matched against the files in `boards/`. Files saved with
   `--from-usb --save-board` carry the uid, so after one read the board is recognised
   every time.
4. **The key matrix**, matched against every board file and every QMK layout. Only an
   exact, unique match is accepted.
5. **A plain grid.** Every key drawn in its matrix row and column, the footer says
   "matrix grid: real shape unknown", and the console names `--board`. You always get a
   picture. When the matrix is wired like a split keyboard's (or the boards that share it
   are split), the second half of the rows is drawn beside the first, mirrored, and the
   board name in the footer says "two halves" and whether that was a guess. `--board grid`
   asks for this grid outright (the page's "draw a plain grid" button writes it into the
   command and the settings file), without the warning.

**ZMK keyboards.** A ZMK `.keymap` names no keyboard, so the shape comes from the ZMK
ecosystem's `zmk,physical-layout` definitions (exact per-key positions, the standard
since ZMK Studio), on a ladder of its own: the bundled ZMK index
(`boards/zmk-index.json.gz`, harvested from the ZMK repository and known vendor module
repositories, see `boards/ZMK-DATA-NOTICE.md`) by name or, when only one bundled layout
has the keymap's key count, automatically; else the board's own `-layouts.dtsi` file,
passed as `--board path/to/x-layouts.dtsi` or dropped on the page's Keyboard section;
else any board from the lists above (the keys are counted in visual reading order); else
the plain grid. A file with several layouts is picked by `--layout <display name>` or by
key count.

The QMK shapes come from `boards/qmk-index.json.gz`, generated from QMK's public keyboard
data (see `boards/QMK-DATA-NOTICE.md`; `--version` prints the refresh date of that data
and of the ZMK index). Two board files are bundled as well:

| Board | Keys | Notes |
|---|---|---|
| `corne46` | 46 | Corne v4 clone with an extra inner-column key on the top two rows of each half. Read from the board's own Vial definition over USB. |
| `corne42` | 42 | Standard crkbd matrix, derived from the above. For a QMK-firmware Corne, `--board crkbd/rev1` is the better choice. |

### Clones and boards with extra keys

QMK's data describes official revisions. A clone with extra keys matched to the official
board renders with those keys missing, and the console says how many
("4 key(s) ... have no position"). The fix is to read the shape from the board:

```
python -m pip install hidapi
python keymap-imgen.py --from-usb --save-board mycorne
```

Vial firmware contains a drawing of the board it runs on; `--from-usb` reads that drawing
(read-only, the same request the Vial app makes when you plug in) and saves it as
`boards/mycorne.json`, uid included, so the board's `.vil` files match it from then on.
Windows and macOS need nothing else. On Linux, give yourself access to the device with a
udev rule, for example `/etc/udev/rules.d/92-viia.rules` containing
`KERNEL=="hidraw*", SUBSYSTEM=="hidraw", MODE="0660", GROUP="users", TAG+="uaccess"`,
then unplug and replug.

Without hidapi the flag explains what to install and does nothing else. hidapi 0.14 or
newer is best: older Linux packages do not report which interface is Vial's, and `--from-usb`
then asks each unidentified interface in turn, which is slower and can wake other devices.
Turning the drawing into a board is done by the shared JavaScript, so saving needs
Playwright as well; a bare `--from-usb` (a look at what is connected) does not.

The page lists your saved and hand-written boards, and any style you add, from
`docs/boards-user.js`, which `--save-board` and `python keymap-imgen.py --refresh-page`
write. That file and the board files are yours: keep them across updates (the
repository never changes `boards-user.js`, so `git pull` leaves it alone), and
`--refresh-page` writes it again from `boards/` and `styles/` at any time.

### The keymap straight from the keyboard

The same USB read fetches every layer's keycodes, so no `.vil` export is needed:
`python keymap-imgen.py outrun --from-usb` draws the connected keyboard as it is right now,
and `--from-usb --save-keymap mine` keeps a copy as `keymaps/mine.vil`. The file uses QMK's
own keycode names (`KC_LEFT_SHIFT`, `QK_BOOTLOADER`), which the generator reads; it is not
meant for importing into the Vial app, which writes names of its own. Numbers come from
QMK's published keycode data (`docs/keycodes.js`, protocol 6); keyboards on an older
Vial protocol get the pre-2022 numbering with a short list of names, and anything
unrecognised prints as hex, as the Vial app does. The web page does the same read in
Chrome, Edge and other Chromium browsers ("Read my keyboard"; Firefox and Safari have no
WebHID), including from a page opened out of the folder.

To write a board file by hand (or edit a saved one), see `boards/README.md`.

## Settings file

Choices that belong to one keymap can live in a small file beside it, named
`<name>.settings.json`, so a plain `python keymap-imgen.py outrun` uses those settings
every time. The page writes one for you ("Save settings file"); by hand it looks like:

```json
{
  "title": "qwerty",
  "board": "corne46",
  "layers": [0, 1, 2, 4],
  "names": {"0": "Base", "1": "Function and numbers", "2": "Symbols", "4": "Navigation"},
  "labels": {"LCA(KC_J)": "open the terminal", "M3": "email signature"}
}
```

`labels` prints words on a key whose keycode gives no clue to its purpose: macros, custom
keycodes, or chords that mean something only on your computer. A `"combos"` field
(badges, lines, panel, text or off) picks the combo treatment. Every field is optional;
command-line options override the file. Each sample keymap ships with one
(`samples/corne-qwerty.settings.json`, `samples/crkbd-qwerty.settings.json`,
`samples/dz60-qwerty.settings.json`, `samples/corne-zmk.settings.json`), which is how the
first run above knows the board and the layers.

## Limits

- Legends are US ANSI. A key that produces `;` on your layout prints `;` regardless of
  the OS keyboard language.
- Encoders and macro contents are not drawn. The keys that trigger them are. A tap dance
  shows its tap and hold (or double tap) actions; the tap-then-hold action is not
  printed.
- A ZMK `.keymap` is read as one self-contained file: `#include` lines are ignored and
  single-line `#define` names are substituted, so a keymap built from helper-library
  macros (function-like `#define`s) will not parse. Hold-tap timing, macro behaviors and
  `zmk,conditional-layers` (tri-layer) are not read; a custom hold-tap whose halves are
  `&kp`/`&mo` prints as a mod-tap or layer-tap, and any other custom behavior prints as
  its raw call, which is the honest fallback.
- A keycode Vial saved as a bare number is named through QMK's keycode table under the
  file's `vial_protocol`; one the older numbering has no name for prints as hex (`0x5DB2`).
- Layers reached only by holding two other layer keys together (QMK's tri-layer) show
  "No base-layer key reaches this layer", because the file does not record that rule.
- More than nine layers spill onto a second page (`name.<style>.2.html`).
- Anything the legend tables do not recognise prints as the raw keycode. That is the
  signal to add it; open an issue with the keycode.
- Boards added to QMK after the index was built need `tools/build_qmk_index.py` re-run
  (maintainers) or a hand-written board file; ZMK boards likewise need
  `tools/build_zmk_index.py` (a new vendor module repository is one line in its list),
  or their `-layouts.dtsi` passed directly.

## Checking a change

The test suite is not shipped; `CONTRIBUTING.md` describes the checks by hand and the
house rules. Maintainer scripts:

```
python tools/build_qmk_index.py        refresh boards/qmk-index.json.gz and docs/boards.js
python tools/build_qmk_index.py --page-only   rewrite docs/boards-local.js (the page's shipped list) after a board file or style joins the repository
python tools/build_keycodes.py         refresh docs/keycodes.js (keycode numbers to names)
python tools/make_gallery.py           re-render the README pictures (needs Pillow as well)
python tools/check_rows.py <board>     show how the "Hold left middle thumb" text reads a board's rows
```

## Contributing

Problem reports, new styles and board files are all welcome: `CONTRIBUTING.md` says what
to send with each, how to check a change, and the house rules (LF line endings, no
modules in `docs/vilimg.js`, OFL fonts only).

## Licences

Keymap Image Generator is MIT, see `LICENSE`. The whitehatnetizen mark (the hat drawing on the page)
identifies the author and is not covered by that licence: it is not for reuse. The
bundled fonts are under the SIL Open Font License 1.1 (`fonts/README.md`, `fonts/OFL.txt`).
The keyboard geometry and keycode data are derived from QMK Firmware's published data and
are provided with credit to QMK under the GPL-2 terms described in
`boards/QMK-DATA-NOTICE.md`. `docs/xzwasm.min.js` is xzwasm by Steve Sanderson (MIT),
containing xz-embedded (public domain) and walloc (MIT); it decodes a keyboard's
compressed definition in the browser. The licence texts of the bundled components are
collected in `THIRD-PARTY-NOTICES.md`; `CHANGELOG.md` lists what changed in each release.
