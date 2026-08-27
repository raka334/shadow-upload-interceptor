#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.secureintent.shadow"
EXTENSION_ID="${1:-}"
BROWSER_FLAVOR="${2:-chrome}"
HOST_VARIANT="${3:-native}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DAEMON_MANIFEST="${REPO_DIR}/daemon/Cargo.toml"
CONFIG_ROOT="${XDG_CONFIG_HOME:-${HOME}/.config}"

case "${BROWSER_FLAVOR}" in
  chrome) BROWSER_CONFIG_DIR="google-chrome" ;;
  chrome-for-testing) BROWSER_CONFIG_DIR="google-chrome-for-testing" ;;
  chromium) BROWSER_CONFIG_DIR="chromium" ;;
  *)
    echo "Unsupported browser flavor: ${BROWSER_FLAVOR}" >&2
    echo "Expected chrome, chrome-for-testing, or chromium." >&2
    exit 2
    ;;
esac

HOST_DIR="${SHADOW_NATIVE_HOST_DIR:-${CONFIG_ROOT}/${BROWSER_CONFIG_DIR}/NativeMessagingHosts}"
HOST_MANIFEST="${HOST_DIR}/${HOST_NAME}.json"

for required_command in awk cargo node realpath sha256sum stat; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing installer dependency: ${required_command}" >&2
    exit 1
  fi
done

if [[ ! "${EXTENSION_ID}" =~ ^[a-p]{32}$ ]]; then
  echo "Usage: ./scripts/install-host.sh <extension-id> [browser] [native|tauri]" >&2
  echo "The ID must contain only letters a through p." >&2
  exit 2
fi

case "${HOST_VARIANT}" in
  native)
    BINARY="${REPO_DIR}/daemon/target/release/secureintent-shadow-host"
    echo "Building the dependency-light Rust Native Messaging host..."
    cargo build --release --manifest-path "${DAEMON_MANIFEST}" --bin secureintent-shadow-host
    ;;
  tauri)
    BINARY="${REPO_DIR}/daemon/target/release/secureintent-shadow-tauri"
    if ! command -v pkg-config >/dev/null 2>&1 || \
      ! pkg-config --exists javascriptcoregtk-4.1 webkit2gtk-4.1; then
      echo "The Tauri host requires Tauri v2's Linux development packages." >&2
      echo "Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-dev" >&2
      echo "Use the default 'native' variant when those packages are unavailable." >&2
      exit 1
    fi
    echo "Building the zero-window Tauri v2 Native Messaging host..."
    cargo build --release --manifest-path "${DAEMON_MANIFEST}" \
      --features tauri-host --bin secureintent-shadow-tauri
    ;;
  *)
    echo "Unsupported host variant: ${HOST_VARIANT}" >&2
    echo "Expected native or tauri." >&2
    exit 2
    ;;
esac

if [[ ! -f "${BINARY}" ]]; then
  echo "Expected native host binary was not produced: ${BINARY}" >&2
  exit 1
fi
chmod 0755 "${BINARY}"
BINARY="$(realpath "${BINARY}")"
if [[ "${BINARY}" != /* || ! -f "${BINARY}" || ! -x "${BINARY}" ]]; then
  echo "Native host must resolve to an absolute executable file: ${BINARY}" >&2
  exit 1
fi

BINARY_SHA256="$(sha256sum "${BINARY}" | awk '{print $1}')"

mkdir -p "${HOST_DIR}"
chmod 0700 "${HOST_DIR}"
node -e '
  const fs = require("node:fs");
  const { randomUUID } = require("node:crypto");
  const [manifestPath, binaryPath, extensionId] = process.argv.slice(1);
  const manifest = {
    name: "com.secureintent.shadow",
    description: "SecureIntent Shadow Upload native scanner",
    path: binaryPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  const temporaryPath = `${manifestPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, manifestPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
' "${HOST_MANIFEST}" "${BINARY}" "${EXTENSION_ID}"

node -e '
  const fs = require("node:fs");
  const [manifestPath, expectedBinary, extensionId] = process.argv.slice(1);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.name !== "com.secureintent.shadow") throw new Error("wrong host name");
  if (manifest.path !== expectedBinary || !manifest.path.startsWith("/")) {
    throw new Error("host path is not the expected absolute binary path");
  }
  if (manifest.type !== "stdio") throw new Error("host type must be stdio");
  const expectedOrigin = `chrome-extension://${extensionId}/`;
  if (JSON.stringify(manifest.allowed_origins) !== JSON.stringify([expectedOrigin])) {
    throw new Error("allowed_origins is not pinned to the exact extension id");
  }
' "${HOST_MANIFEST}" "${BINARY}" "${EXTENSION_ID}"

MANIFEST_MODE="$(stat -c '%a' "${HOST_MANIFEST}")"
if [[ "${MANIFEST_MODE}" != "600" ]]; then
  echo "Native host manifest permissions must be 600; found ${MANIFEST_MODE}." >&2
  exit 1
fi

echo "Installed ${HOST_NAME} (${HOST_VARIANT}) for ${BROWSER_FLAVOR}."
echo "Manifest: ${HOST_MANIFEST}"
echo "Binary:   ${BINARY}"
echo "SHA-256:  ${BINARY_SHA256}"
echo "Mode:      ${MANIFEST_MODE}"
echo "Next: restart Chrome, reopen http://localhost:4173, and drop testdata/block.pem."
