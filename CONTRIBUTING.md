# Contributing

Thank you for looking. This is a small project with a short list of ways to help, and a few
house rules that are not obvious from the code.

## Reporting a problem

Open an issue with whatever reproduces it:

- A keycode that prints as a raw name (`KC_...`, a number): the keycode and the board.
- A board drawn wrong: the board's name in the list (`python keymap-imgen.py --list-boards`
  or the page's board picker) and, if you have it, a photo or a link to the vendor's picture.
- A keymap that fails: the `.vil` or `keymap.json` file and the command you ran. A `.vil`
  holds keycodes, layer names and the board's uid, nothing personal.
- The page misbehaving: the browser and whether it was opened from a folder or served
  over http.

## Checking a change

The test suite is not shipped. To check a change by hand:

1. `python keymap-imgen.py plain samples/corne-qwerty.vil` and compare
   `output/corne-qwerty.plain.html` with `docs/gallery/plain.webp`: every legend, every
   "Hold ..." line.
2. `python tools/check_rows.py <board>` prints how the layer text ("Hold left middle
   thumb") reads a board's rows.
3. For a page change, serve the folder (`python -m http.server 8000`) and try
   `http://localhost:8000/` as well as opening `index.html` from the folder: the page
   works in both, and behaves differently in each.

## House rules

- **Line endings are LF.** A script that rewrites a file must write bytes or open it with
  `newline="\n"`; on Windows, Python's text mode turns LF into CRLF, and the page then
  serves a `_base.css` that no longer matches what the command line inlines.
- **`docs/vilimg.js` stays a classic script**: no `import` or `export`. The page also
  opens from a folder, where browsers block modules.
- **Standard library only** in `vilimg/` and `tools/`, apart from Playwright (drawing),
  hidapi (USB, optional) and Pillow (gallery, maintainers only). See `requirements.txt`.
- **Fonts must be OFL.** Anything bundled goes in `fonts/` with a row in `fonts/README.md`.
  Fonts served under other terms (Fontshare, for one) cannot be redistributed.

## Translations

The page's text lives in `docs/lang/`: `en.js` is generated from `index.html` and
`docs/page.js` (`python tools/extract_strings.py`) and is the reference; `es.js` and
`de.js` are the translations, one table each from string id to text. To correct a
translation, edit the value in its file, keep every HTML tag and every `{placeholder}` as
they are, and run `python tools/check_lang.py es` (or `de`): it reports missing or
unknown ids, tags or placeholders that differ from the English, and entries whose English
has changed since they were translated. `--stamp es` records that the entry has been
looked at again. A German or Spanish reader's eye for wording is worth more
than the machine's; the first versions were drafted by machine and read by people, so an
expression that reads translated is a fair thing to report.

To add a language: copy `en.js` to `<code>.js`, change the `.en` in it to your code,
translate every value, add the code to `LANGS` in `docs/i18n.js` and a button to the
`langs` row in `index.html`, then run the checker with `--stamp`.

When `index.html` or `page.js` wording changes: give a new paragraph no id (`python
tools/extract_strings.py --tag` assigns one), keep the id of an edited one, and rerun
`extract_strings.py`; the checker then lists what the translations must follow.

## Releases

The version lives in three places that must agree: `__version__` in `vilimg/__init__.py`,
`vilimg.version` in `docs/vilimg.js`, and the `?v=` stamp on the five script tags at the
foot of `index.html` (the stamp is what makes a browser fetch the new scripts instead of
the cached ones; the language files and style sheets take theirs from `vilimg.version` at
run time). Add the entry to `CHANGELOG.md`, then tag the commit `v<version>`.

## Adding a style

One CSS file in `styles/`, following `styles/README.md`: the file name is the name typed
on the command line, the first line is the one-line description that `--list` prints.
The easiest start is a copy of `plain.css`. A light and dark pair is welcome but not
required. Run `python tools/make_gallery.py` so the README gallery gains its picture, and
`python keymap-imgen.py --refresh-page` so the page lists it while you work on it.

## Adding a board

For a board missing from the QMK index or drawn differently from its QMK entry: read it
from the keyboard with `--from-usb --save-board`, check the picture against the board in
front of you, and send the JSON with the board's name and where it is sold. The file
format is described in `boards/README.md`.

## Refreshing the bundled data (maintainers)

`python tools/build_qmk_index.py` rebuilds the board index from QMK's keyboard API and
`python tools/build_keycodes.py` the keycode table. Both update the dates in
`boards/QMK-DATA-NOTICE.md`.

The page reads two lists: `docs/boards-local.js`, the shipped board files and styles,
and `docs/boards-user.js`, what one copy has on top. When a board file or a
style joins the repository, run `python tools/build_qmk_index.py --page-only` to rewrite
the shipped list, then `python keymap-imgen.py --refresh-page`, which puts
`boards-user.js` back to its empty stub. Never commit `boards-user.js` with content: the
repository keeps it as the stub so a user's `git pull` never conflicts with their own
additions.

## Licence of contributions

Code and styles you send are taken under the repository's MIT licence (`LICENSE`). Board
data derived from QMK stays under QMK's terms, see `boards/QMK-DATA-NOTICE.md`.
