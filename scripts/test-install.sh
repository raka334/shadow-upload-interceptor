#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HOST_NAME="com.secureintent.shadow"
EXTENSION_ID="abcdefghijklmnopabcdefghijklmnop"
TEMPORARY_ROOT=""

if (( $# > 1 )); then
  echo "Usage: ./scripts/test-install.sh [isolated-host-directory]" >&2
  exit 2
fi

if (( $# == 1 )); then
  INSTALL_TEST_ROOT="$1"
else
  TEMPORARY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/secureintent-installer-audit.XXXXXX")"
  INSTALL_TEST_ROOT="${TEMPORARY_ROOT}"
fi

cleanup() {
  if [[ -z "${TEMPORARY_ROOT}" ]]; then
    return
  fi
  case "${TEMPORARY_ROOT}" in
    "${TMPDIR:-/tmp}"/secureintent-installer-audit.*) rm -rf -- "${TEMPORARY_ROOT}" ;;
    *) echo "Refusing to remove unexpected test directory: ${TEMPORARY_ROOT}" >&2 ;;
  esac
}
trap cleanup EXIT

export SHADOW_NATIVE_HOST_DIR="${INSTALL_TEST_ROOT}"
"${SCRIPT_DIR}/install-host.sh" "${EXTENSION_ID}" chrome native
"${SCRIPT_DIR}/doctor.sh" "${EXTENSION_ID}" chrome
"${SCRIPT_DIR}/uninstall-host.sh" chrome

if [[ -e "${INSTALL_TEST_ROOT}/${HOST_NAME}.json" ]]; then
  echo "Uninstall left the native host manifest behind." >&2
  exit 1
fi

echo "Installer lifecycle test passed."
