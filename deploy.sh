#!/bin/bash
# Deploy IRIS — builds all targets and (optionally) creates a GitHub release.
# Usage: ./deploy.sh [--skip-builds] [--skip-release]
#
# Mirrors the VoucherVisionGO-Editor deploy script. Reads code-signing
# secrets from .env.signing (gitignored): APPLE_ID, APPLE_TEAM_ID,
# APPLE_APP_SPECIFIC_PASSWORD.

set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env.signing ]; then
    # shellcheck disable=SC1091
    source .env.signing
fi

REPO="nybgvh/IRIS-Electron"
SKIP_BUILDS=0
SKIP_RELEASE=0

for arg in "$@"; do
    case "$arg" in
        --skip-builds)  SKIP_BUILDS=1 ;;
        --skip-release) SKIP_RELEASE=1 ;;
        *)
            echo "Unknown option: $arg"
            echo "Usage: ./deploy.sh [--skip-builds] [--skip-release]"
            exit 1
            ;;
    esac
done

echo "=== IRIS Deploy ==="
echo ""

VERSION=$(node -e "console.log(require('./package.json').version)")
TAG="v${VERSION}"
echo "Version: $VERSION  Tag: $TAG  Repo: $REPO"
echo ""

if [ "$SKIP_BUILDS" -ne 1 ]; then
    unset ELECTRON_RUN_AS_NODE

    echo "Building all platforms in parallel..."
    echo ""

    LOGDIR=$(mktemp -d)
    trap 'rm -rf "$LOGDIR"' EXIT

    (npm run dist -- --mac --arm64 > "$LOGDIR/mac-arm64.raw.log" 2>&1) &
    PID_MAC_ARM=$!

    (npm run dist -- --mac --x64 > "$LOGDIR/mac-x64.raw.log" 2>&1) &
    PID_MAC_X64=$!

    (npm run dist -- --win --x64 > "$LOGDIR/win-x64.raw.log" 2>&1) &
    PID_WIN=$!

    (npm run dist -- --linux --x64 > "$LOGDIR/linux-x64.raw.log" 2>&1) &
    PID_LINUX=$!

    FAILED=0
    for PID_NAME in "mac-arm64:$PID_MAC_ARM" "mac-x64:$PID_MAC_X64" "win-x64:$PID_WIN" "linux-x64:$PID_LINUX"; do
        NAME="${PID_NAME%%:*}"
        PID="${PID_NAME##*:}"
        echo "  [$NAME] Building..."
        if wait "$PID"; then
            echo "  ✓ $NAME completed"
        else
            STATUS=$?
            echo "  ✗ $NAME FAILED (exit $STATUS)"
            FAILED=1
        fi
        FILTER='building|packaging|signing|artifact|executing|downloading|notariz|stapl|error|fail|⨯|✗'
        if grep -E -i "$FILTER" "$LOGDIR/$NAME.raw.log" >/dev/null 2>&1; then
            grep -E -i "$FILTER" "$LOGDIR/$NAME.raw.log" | sed "s/^/    [$NAME] /"
        else
            tail -n 20 "$LOGDIR/$NAME.raw.log" | sed "s/^/    [$NAME] /"
        fi
        echo ""
    done

    if [ "$FAILED" = "1" ]; then
        echo "ERROR: One or more builds failed. Aborting."
        exit 1
    fi

    # Notarize and staple the DMG containers — electron-builder notarizes the
    # .app inside the DMG, but not the DMG itself, so we submit each DMG
    # separately and staple the returned ticket.
    if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]; then
        echo "Notarizing and stapling macOS DMG containers..."
        echo ""
        for arch in arm64 x64; do
            DMG="build/IRIS-${VERSION}-${arch}.dmg"
            if [ ! -f "$DMG" ]; then
                echo "  ⚠ $DMG not found, skipping"
                continue
            fi
            echo "  [$arch] Submitting $(basename "$DMG") to Apple..."
            SUBMIT_OUT=$(xcrun notarytool submit "$DMG" \
                --apple-id "$APPLE_ID" \
                --team-id "$APPLE_TEAM_ID" \
                --password "$APPLE_APP_SPECIFIC_PASSWORD" \
                --wait \
                --output-format json 2>&1)
            STATUS=$(echo "$SUBMIT_OUT" | grep -o '"status":[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
            if [ "$STATUS" != "Accepted" ]; then
                echo "  ✗ [$arch] Notarization failed (status: $STATUS)"
                echo "$SUBMIT_OUT" | sed "s/^/    /"
                exit 1
            fi
            echo "  ✓ [$arch] Apple Accepted — stapling..."
            if xcrun stapler staple "$DMG" 2>&1 | sed "s/^/    /"; then
                if xcrun stapler validate "$DMG" >/dev/null 2>&1; then
                    echo "  ✓ [$arch] Stapled and validated $(basename "$DMG")"
                else
                    echo "  ✗ [$arch] Staple validation failed for $(basename "$DMG")"
                    exit 1
                fi
            else
                echo "  ✗ [$arch] Stapling failed for $(basename "$DMG")"
                exit 1
            fi
            echo ""
        done
    else
        echo "⚠ Skipping DMG notarization — Apple credentials not set in .env.signing."
        echo ""
    fi
else
    echo "Skipping app builds (--skip-builds)"
    echo ""
fi

echo "=== Build outputs ==="
ls -lhS build/*.dmg build/*.zip build/*.exe build/*.AppImage build/latest*.yml 2>/dev/null || true
echo ""

if [ "$SKIP_RELEASE" -ne 1 ] && [ "$SKIP_BUILDS" -ne 1 ]; then
    echo "Creating GitHub release $TAG on $REPO..."

    gh release delete "$TAG" --repo "$REPO" --yes 2>/dev/null || true
    git tag -d "$TAG" 2>/dev/null || true
    git push origin ":refs/tags/$TAG" 2>/dev/null || true

    gh release create "$TAG" \
      "build/IRIS-${VERSION}-arm64.dmg#macOS (Apple Silicon)" \
      "build/IRIS-${VERSION}-x64.dmg#macOS (Intel)" \
      "build/IRIS-${VERSION}-arm64.zip" \
      "build/IRIS-${VERSION}-x64.zip" \
      "build/IRIS-${VERSION}-x64.exe#Windows Portable (64-bit)" \
      "build/IRIS-Setup-${VERSION}-x64.exe#Windows Installer (64-bit, auto-update)" \
      "build/IRIS-${VERSION}-x86_64.AppImage#Linux (64-bit)" \
      "build/latest-mac.yml" \
      "build/latest.yml" \
      "build/latest-linux.yml" \
      --repo "$REPO" \
      --title "IRIS $TAG" \
      --notes "See [README](https://github.com/${REPO}#readme) for details."

    echo ""
    echo "Release created: https://github.com/${REPO}/releases/tag/$TAG"
else
    echo "Skipping GitHub release"
fi
