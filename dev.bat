@echo off
REM Double-clickable dev launcher for IRIS on Windows. Runs `npm start`
REM against the current working tree — your edits are picked up on every
REM relaunch. (Cmd+R inside the window live-reloads the renderer.)

cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
call npm start
if errorlevel 1 pause
