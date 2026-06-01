#!/bin/bash
# Double-clickable dev launcher for IRIS. Runs `npm start` against the
# current working tree — your edits are picked up on every relaunch.
# (To live-reload without relaunching, hit Cmd+R inside the window.)

cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE
exec npm start
