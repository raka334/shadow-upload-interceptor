#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.secureintent.shadow"
BROWSER_FLAVOR="${1:-chrome}"
CONFIG_ROOT="${XDG_CONFIG_HOME:-${HOME}/.config}"

case "${BROWSER_FLAVOR}" in
  chrome) BROWSER_CONFIG_DIR="google-chrome" ;;
  chrome-for-testing) BROWSER_CONFIG_DIR="google-chrome-for-testing" ;;
  chromium) BROWSER_CONFIG_DIR="chromium" ;;
  *)
    echo "Usage: ./scripts/uninstall-host.sh [chrome|chrome-for-testing|chromium]" >&2
    exit 2
    ;;
esac

HOST_DIR="${SHADOW_NATIVE_HOST_DIR:-${CONFIG_ROOT}/${BROWSER_CONFIG_DIR}/NativeMessagingHosts}"
HOST_MANIFEST="${HOST_DIR}/${HOST_NAME}.json"

if [[ ! -e "${HOST_MANIFEST}" && ! -L "${HOST_MANIFEST}" ]]; then
  echo "Native host is already absent: ${HOST_MANIFEST}"
  exit 0
fi

rm -f -- "${HOST_MANIFEST}"
echo "Removed Native Messaging registration: ${HOST_MANIFEST}"
echo "Compiled binaries were preserved and can be removed with a normal cargo clean."
