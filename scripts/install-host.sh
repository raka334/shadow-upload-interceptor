#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.secureintent.shadow"
EXTENSION_ID="${1:-}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DAEMON_MANIFEST="${REPO_DIR}/daemon/Cargo.toml"
BINARY="${REPO_DIR}/daemon/target/release/secureintent-shadow-host"
HOST_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/google-chrome/NativeMessagingHosts"
HOST_MANIFEST="${HOST_DIR}/${HOST_NAME}.json"

if [[ ! "${EXTENSION_ID}" =~ ^[a-p]{32}$ ]]; then
  echo "Usage: ./scripts/install-host.sh <32-character Chrome extension ID>" >&2
  echo "The ID must contain only letters a through p." >&2
  exit 2
fi

echo "Building the headless Native Messaging host..."
cargo build --release --manifest-path "${DAEMON_MANIFEST}"

if [[ ! -f "${BINARY}" ]]; then
  echo "Expected native host binary was not produced: ${BINARY}" >&2
  exit 1
fi
chmod 0755 "${BINARY}"
BINARY="$(realpath "${BINARY}")"

mkdir -p "${HOST_DIR}"
node -e '
  const fs = require("node:fs");
  const [manifestPath, binaryPath, extensionId] = process.argv.slice(1);
  const manifest = {
    name: "com.secureintent.shadow",
    description: "SecureIntent Shadow Upload native scanner",
    path: binaryPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
' "${HOST_MANIFEST}" "${BINARY}" "${EXTENSION_ID}"

node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "${HOST_MANIFEST}"

echo "Installed ${HOST_NAME} for Google Chrome."
echo "Manifest: ${HOST_MANIFEST}"
echo "Binary:   ${BINARY}"
echo "Next: restart Chrome, reopen http://localhost:4173, and drop testdata/block.pem."
