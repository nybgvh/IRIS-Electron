# Assets

This folder holds the app icon used by electron-builder for all platforms.

## Required

- `icon.png` — at least **512×512**, ideally 1024×1024 (electron-builder
  downsizes for macOS `.icns` and Windows `.ico` automatically).

Drop a PNG here named `icon.png` before running `npm run dist`. The dev
flow (`npm start`) does not require the icon.
