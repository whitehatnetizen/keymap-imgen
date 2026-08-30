@echo off
rem Double-click to render every keymap in keymaps\ (or in this folder) in the default style, plain.
rem To use another style, or to rerun a command built on index.html, replace the python line
rem below with that command; the page's "Your command" section has the line to paste.
cd /d "%~dp0"
python keymap-imgen.py %*
echo.
pause
