#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.secureintent.shadow"
EXTENSION_ID="${1:-}"
BROWSER_FLAVOR="${2:-chrome}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
CONFIG_ROOT="${XDG_CONFIG_HOME:-${HOME}/.config}"

if [[ ! "${EXTENSION_ID}" =~ ^[a-p]{32}$ ]]; then
  echo "Usage: ./scripts/doctor.sh <extension-id> [chrome|chrome-for-testing|chromium]" >&2
  exit 2
fi

case "${BROWSER_FLAVOR}" in
  chrome) BROWSER_CONFIG_DIR="google-chrome" ;;
  chrome-for-testing) BROWSER_CONFIG_DIR="google-chrome-for-testing" ;;
  chromium) BROWSER_CONFIG_DIR="chromium" ;;
  *)
    echo "Unsupported browser flavor: ${BROWSER_FLAVOR}" >&2
    exit 2
    ;;
esac

HOST_DIR="${SHADOW_NATIVE_HOST_DIR:-${CONFIG_ROOT}/${BROWSER_CONFIG_DIR}/NativeMessagingHosts}"
HOST_MANIFEST="${HOST_DIR}/${HOST_NAME}.json"

for required_command in awk node sha256sum stat; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing diagnostic dependency: ${required_command}" >&2
    exit 1
  fi
done

if [[ ! -f "${HOST_MANIFEST}" ]]; then
  echo "Native host manifest is missing: ${HOST_MANIFEST}" >&2
  exit 1
fi

BINARY="$(node -e '
  const fs = require("node:fs");
  const [manifestPath, extensionId] = process.argv.slice(1);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const expectedOrigin = `chrome-extension://${extensionId}/`;
  if (manifest.name !== "com.secureintent.shadow") throw new Error("wrong host name");
  if (manifest.type !== "stdio") throw new Error("host type is not stdio");
  if (typeof manifest.path !== "string" || !manifest.path.startsWith("/")) {
    throw new Error("host path is not absolute");
  }
  if (JSON.stringify(manifest.allowed_origins) !== JSON.stringify([expectedOrigin])) {
    throw new Error("allowed_origins does not exactly match the extension");
  }
  process.stdout.write(manifest.path);
' "${HOST_MANIFEST}" "${EXTENSION_ID}")"

if [[ ! -f "${BINARY}" || ! -x "${BINARY}" ]]; then
  echo "Registered host binary is missing or not executable: ${BINARY}" >&2
  exit 1
fi

MANIFEST_MODE="$(stat -c '%a' "${HOST_MANIFEST}")"
if [[ "${MANIFEST_MODE}" != "600" ]]; then
  echo "Manifest mode is ${MANIFEST_MODE}; expected 600." >&2
  exit 1
fi

echo "Manifest: ${HOST_MANIFEST} (mode ${MANIFEST_MODE})"
echo "Binary:   ${BINARY}"
echo "SHA-256:  $(sha256sum "${BINARY}" | awk '{print $1}')"

SHADOW_HOST_BINARY="${BINARY}" node "${SCRIPT_DIR}/smoke-host.mjs" --health
SHADOW_HOST_BINARY="${BINARY}" node \
  "${SCRIPT_DIR}/smoke-host.mjs" "${REPO_DIR}/testdata/block.pem" block
SHADOW_HOST_BINARY="${BINARY}" node \
  "${SCRIPT_DIR}/smoke-host.mjs" "${REPO_DIR}/testdata/allow.txt" allow

echo "SecureIntent Shadow diagnostics passed."
