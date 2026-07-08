#!/bin/bash
# Double-clickable dev launcher for IRIS on Linux. Runs `npm start` against the
# current working tree — your edits are picked up on every relaunch.
# (Ctrl+R inside the window live-reloads the renderer.)
#
# If double-clicking opens this in an editor instead of running it, mark it
# executable (chmod +x dev.sh) and set your file manager to run executable text
# files — or just run it from a terminal: ./dev.sh
cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE
exec npm start
