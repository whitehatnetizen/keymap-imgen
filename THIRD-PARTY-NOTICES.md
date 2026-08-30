# Third-party notices

Keymap Image Generator is MIT licensed (`LICENSE`). The following components are bundled
with it under their own terms, reproduced here as those terms require.

## xzwasm

`docs/xzwasm.min.js` is xzwasm by Steve Sanderson, https://github.com/SteveSanderson/xzwasm,
bundled unmodified. It decodes the compressed keyboard definition a Vial keyboard sends
over USB, in the browser.

```
MIT License

Copyright (c) Steve Sanderson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

xzwasm itself contains two further components, compiled into its WebAssembly module:

### walloc

walloc by Andy Wingo, copyright (c) 2020 Igalia, S.L., https://github.com/wingo/walloc,
under the MIT License. The permission notice above applies to it with that copyright line.

### xz-embedded

xz-embedded by Lasse Collin and Igor Pavlov, https://tukaani.org/xz/embedded.html, placed
in the public domain by its authors.

## QMK Firmware data

`boards/qmk-index.json.gz`, `docs/boards.js` and `docs/keycodes.js` are generated from the
QMK Firmware project's published keyboard and keycode data. QMK Firmware is copyright its
contributors and released under the GNU General Public License, version 2 or later. The
derived files are provided under those terms with credit to QMK; the details are in
`boards/QMK-DATA-NOTICE.md`.

## Fonts

Every font in `fonts/` is published under the SIL Open Font License 1.1, the text of which
is `fonts/OFL.txt`; `fonts/README.md` lists each family with its copyright holder.

## Not bundled

Playwright (Apache 2.0), hidapi (GPL-3, BSD or the HIDAPI licence, at the user's choice)
and Pillow (HPND) are installed by the user with `pip` and are not part of this repository.
