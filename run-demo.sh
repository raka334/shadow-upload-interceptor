#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="${SCRIPT_DIR}/extension"
EXTENSION_OUTPUT="${EXTENSION_DIR}/.output/chrome-mv3"
BUILT_MANIFEST="${EXTENSION_OUTPUT}/manifest.json"
DUMMY_PAGE_DIR="${SCRIPT_DIR}/dummy-page"
DEMO_PORT="4173"
DEMO_URL="http://localhost:${DEMO_PORT}"
DEMO_CHROME_BIN="${DEMO_CHROME_BIN:-google-chrome}"
PNPM_VERSION="10.28.2"
MODE="run"
SERVER_PID=""
CHROME_PID=""
CHROME_PROFILE=""

usage() {
  cat <<'EOF'
Usage: ./run-demo.sh [--prepare-only]

Builds the extension and Rust host, installs the Native Messaging manifest,
serves Forge, and opens a clean Chrome window with the extension loaded.

Options:
  --prepare-only  Build and install without starting Forge or Chrome.
  -h, --help      Show this help.

Environment:
  DEMO_CHROME_BIN  Chrome executable to launch (default: google-chrome).
EOF
}

case "${1:-}" in
  "") ;;
  --prepare-only) MODE="prepare" ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This demo launcher currently supports Google Chrome on Linux." >&2
  exit 1
fi

for required_command in node cargo; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing required command: ${required_command}" >&2
    exit 1
  fi
done

if command -v pnpm >/dev/null 2>&1; then
  PNPM_COMMAND=(pnpm)
elif command -v npx >/dev/null 2>&1; then
  echo "pnpm is not on PATH; using pnpm ${PNPM_VERSION} through npx."
  PNPM_COMMAND=(npx --yes "pnpm@${PNPM_VERSION}")
else
  echo "Missing pnpm. Install pnpm ${PNPM_VERSION}, or provide npm/npx so it can be bootstrapped." >&2
  exit 1
fi

if [[ "${MODE}" == "run" ]] && ! command -v "${DEMO_CHROME_BIN}" >/dev/null 2>&1; then
  echo "Chrome executable not found: ${DEMO_CHROME_BIN}" >&2
  echo "Set DEMO_CHROME_BIN if Chrome is installed under another command." >&2
  exit 1
fi

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi

  if [[ -n "${CHROME_PID}" ]] && kill -0 "${CHROME_PID}" >/dev/null 2>&1; then
    kill "${CHROME_PID}" >/dev/null 2>&1 || true
    wait "${CHROME_PID}" 2>/dev/null || true
  fi

  if [[ -n "${CHROME_PROFILE}" && -d "${CHROME_PROFILE}" ]]; then
    case "${CHROME_PROFILE}" in
      */secureintent-shadow-chrome.*) rm -rf -- "${CHROME_PROFILE}" ;;
      *) echo "Refusing to remove unexpected profile path: ${CHROME_PROFILE}" >&2 ;;
    esac
  fi

  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

echo "[1/4] Installing extension dependencies..."
"${PNPM_COMMAND[@]}" --dir "${EXTENSION_DIR}" install --frozen-lockfile

echo "[2/4] Building the Chrome extension..."
"${PNPM_COMMAND[@]}" --dir "${EXTENSION_DIR}" build

if [[ ! -f "${BUILT_MANIFEST}" ]]; then
  echo "WXT did not produce the expected manifest: ${BUILT_MANIFEST}" >&2
  exit 1
fi

# Chrome derives an extension ID from the first 128 bits of SHA-256(public key),
# encoding each nibble as a-p. Deriving it here prevents manifest/ID drift.
EXTENSION_ID="$(node -e '
  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  const manifest = JSON.parse(readFileSync(process.argv[1], "utf8"));
  if (typeof manifest.key !== "string" || manifest.key.length === 0) process.exit(2);
  const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest();
  const alphabet = "abcdefghijklmnop";
  let id = "";
  for (const byte of digest.subarray(0, 16)) id += alphabet[byte >> 4] + alphabet[byte & 15];
  process.stdout.write(id);
' "${BUILT_MANIFEST}")"

if [[ ! "${EXTENSION_ID}" =~ ^[a-p]{32}$ ]]; then
  echo "Could not derive a valid Chrome extension ID from the development key." >&2
  exit 1
fi

echo "[3/4] Building and registering the Rust Native Messaging host..."
"${SCRIPT_DIR}/scripts/install-host.sh" "${EXTENSION_ID}"

if [[ "${MODE}" == "prepare" ]]; then
  echo
  echo "Prepared SecureIntent Shadow Upload for extension ${EXTENSION_ID}."
  echo "Unpacked extension: ${EXTENSION_OUTPUT}"
  exit 0
fi

echo "[4/4] Starting Forge and Chrome..."
SERVER_TOKEN="$$-${RANDOM}-${RANDOM}"
node - "${DUMMY_PAGE_DIR}" "${DEMO_PORT}" "${SERVER_TOKEN}" <<'NODE' &
const { createServer } = require('node:http');
const { readFile } = require('node:fs');
const { join } = require('node:path');

const root = process.argv[2];
const port = Number(process.argv[3]);
const healthToken = process.argv[4];
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/__secureintent_health') {
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end(healthToken);
    return;
  }

  const entry = files.get(pathname);
  if (!entry) {
    response.writeHead(404).end('Not found');
    return;
  }
  readFile(join(root, entry[0]), (error, body) => {
    if (error) {
      response.writeHead(500).end('Unable to read demo page');
      return;
    }
    response.writeHead(200, {
      'Content-Type': entry[1],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
  });
});

server.on('error', (error) => {
  console.error(`Forge server failed: ${error.message}`);
  process.exit(1);
});
server.listen(port, '127.0.0.1');
NODE
SERVER_PID=$!

SERVER_READY="false"
for _attempt in {1..30}; do
  if node -e '
    fetch(process.argv[1])
      .then(async (response) => process.exit(response.ok && (await response.text()) === process.argv[2] ? 0 : 1))
      .catch(() => process.exit(1));
  ' "${DEMO_URL}/__secureintent_health" "${SERVER_TOKEN}"; then
    SERVER_READY="true"
    break
  fi
  if ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    wait "${SERVER_PID}" || true
    echo "Forge server stopped before it became ready." >&2
    exit 1
  fi
  sleep 0.1
done

if [[ "${SERVER_READY}" != "true" ]]; then
  echo "Forge did not become ready at ${DEMO_URL}. Is port ${DEMO_PORT} already in use?" >&2
  exit 1
fi

CHROME_PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/secureintent-shadow-chrome.XXXXXX")"

echo
echo "SecureIntent Shadow Upload is running."
echo "Extension ID: ${EXTENSION_ID}"
echo "Forge:        ${DEMO_URL}"
echo "Try:          testdata/allow.txt, then testdata/block.pem"
echo "Close the demo Chrome window or press Ctrl+C to stop."

"${DEMO_CHROME_BIN}" \
  --user-data-dir="${CHROME_PROFILE}" \
  --disable-extensions-except="${EXTENSION_OUTPUT}" \
  --load-extension="${EXTENSION_OUTPUT}" \
  --no-first-run \
  --no-default-browser-check \
  --new-window \
  "${DEMO_URL}" &
CHROME_PID=$!
wait "${CHROME_PID}"
CHROME_PID=""
