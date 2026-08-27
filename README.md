# SecureIntent — Shadow Upload Interceptor

**Files with secrets never leave the machine. The local daemon only returns Block or Allow.**

This repository is a production-shaped vertical slice of SecureIntent's upload boundary: a polished
dummy AI destination, a Chrome MV3 extension built with WXT/React/TypeScript, and a headless Rust
Native Messaging host. An optional zero-window Tauri v2 wrapper preserves the production desktop
integration seam without adding GUI dependencies to the demo. No file bytes are sent to a cloud
service.

## The 60-second demo

1. Open the local **Forge** page at `http://localhost:4173`.
2. Drop [`testdata/allow.txt`](testdata/allow.txt). Forge reports **Allowed — uploaded** and shows
   the filename and size, proving the extension resumed the original upload.
3. Drop [`testdata/block.pem`](testdata/block.pem). A SecureIntent warning appears on the page and
   Forge reports **Blocked — not sent**. The sample is deliberately fake; it only contains the
   marker used by the assessment.
4. Stop or uninstall the native host and try again. After the bounded timeout the upload proceeds:
   a dead security tool does not freeze the developer's file picker.

The warning is rendered by the extension in a closed Shadow DOM. The page cannot inspect or alter
its contents.

## Prerequisites

- Google Chrome 148 or newer
- Node.js 22 or newer (`run-demo.sh` uses pnpm 10 from `PATH` or bootstraps it through `npx`)
- Rust 1.85 or newer

Chrome 148 is intentional: the extension opts into structured-clone messaging so a `Uint8Array`
can be copied from the content script to the MV3 worker without converting the file to base64 in
the page context. Native Messaging remains JSON and is base64-chunked only at that boundary.

## One-command demo

On Google Chrome for Linux, run:

```bash
chmod +x run-demo.sh
./run-demo.sh
```

The launcher installs pnpm dependencies, builds the WXT extension, builds and registers the Rust
host, serves Forge on port 4173, and opens a fresh temporary Chrome profile with the unpacked
extension loaded. Close that Chrome window or press `Ctrl+C` to stop the server. It does not require
GTK, WebKit, Tauri, Python, or an external static-server package.

The unpacked extension carries a public development key so its ID is stable and the launcher can
pin the exact Native Messaging `allowed_origin` automatically. The key is not a credential or a
private signing key. A production build would obtain its stable identity from the Chrome Web Store
or enterprise-managed deployment.

To build and register everything without opening Chrome, use `./run-demo.sh --prepare-only`.

## Manual setup

```bash
git clone <YOUR_REPOSITORY_URL> shadow-upload-interceptor && cd shadow-upload-interceptor
```

```bash
cd extension && pnpm install && pnpm build && cd ..
```

In `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select:

```text
extension/.output/chrome-mv3
```

Copy the 32-character extension ID shown by Chrome, then install the host:

```bash
chmod +x scripts/install-host.sh
./scripts/install-host.sh EXTENSION_ID_FROM_CHROME
```

Restart Chrome, then serve and open Forge:

```bash
npx serve dummy-page -l 4173
```

```text
http://localhost:4173
```

The installer builds `daemon/target/release/secureintent-shadow-host` and writes an absolute path
plus the exact extension origin to:

```text
~/.config/google-chrome/NativeMessagingHosts/com.secureintent.shadow.json
```

Chromium uses `~/.config/chromium/NativeMessagingHosts/`. macOS and Windows use different
registration locations; this take-home's tested path is Google Chrome on Linux.

## Tests

```bash
cd daemon && cargo test
```

From the repository root, the stdio smoke test exercises the compiled Native Messaging framing
without Chrome:

```bash
cargo build --manifest-path daemon/Cargo.toml
node scripts/smoke-host.mjs testdata/block.pem block
node scripts/smoke-host.mjs testdata/allow.txt allow
```

```bash
cd extension && pnpm test && pnpm compile && pnpm build
```

Rust tests cover safe, PEM, empty and binary inputs; framing; split markers; offset validation;
size mismatches; and the 8 MiB bound. TypeScript tests cover protocol validation and `FileList`
reconstruction. `install-host.sh` builds the same dependency-light Rust stdio host exercised by the
tests and smoke script, so a reviewer does not need GTK or WebKit to run the demo. On a workstation
with the [Tauri v2 system prerequisites](https://v2.tauri.app/start/prerequisites/),
`cargo build --release --features tauri-host --manifest-path daemon/Cargo.toml` builds the optional
zero-window Tauri lifecycle wrapper around the identical protocol and scanner.

## Why Native Messaging, not localhost WebSockets

Chrome launches the registered host and connects over inherited stdin/stdout. There is no listening
TCP port, no port discovery, and no HTTP/CORS/PNA exception. The host manifest pins the exact
extension origin, including its required trailing slash. Ordinary web pages and content scripts
cannot call `connectNative`; only the privileged extension worker can. The Rust process receives
Chrome-framed JSON and returns a tiny verdict—never the bytes or matched substring. A localhost
WebSocket would create an independently reachable service for other browser origins and local
processes, complicate authentication, and make browser-store review harder. For genuinely huge
production files, Native Messaging would vend a one-use capability for an OS-local Unix socket;
this bounded demo deliberately keeps the complete path on chunked Native Messaging with no TCP.

## Memory and zero retention

The host validates the declared size before allocating. It preallocates one
`Zeroizing<Vec<u8>>`, validates contiguous offsets, wraps every decoded chunk in `Zeroizing`, scans
the final buffer as bytes, and drops it before writing the verdict. Incoming JSON frames are also
held in a zeroizing buffer, and serde borrows the base64 field instead of copying it.

Zeroization is an ownership guarantee, not a claim of magical erasure. Chrome, OS pipes, JavaScript
garbage collection, system allocators, crash dumps, swap, and dependency internals may create
copies the Rust host does not own. The daemon zeroes every sensitive allocation it directly owns,
does not write temporary files, and never logs file contents.

## Fail-open behavior

Missing host, connection failure, disconnect, malformed response, timeout, and files over 8 MiB all
resolve to **Allow**. The extension reconstructs the read-only `FileList` and delivers a fresh
untrusted `change` event to the destination. One console warning records that local scanning was
unavailable. This is a deliberate developer-first choice: protection may degrade, but developer
work does not deadlock.

## Deliberate limits

- Google Chrome 148+ on Linux is the supported demo platform.
- One file is scanned per picker/drop interaction.
- Files larger than 8 MiB are allowed without scanning and clearly reported as such.
- The mock rule is the byte marker `BEGIN RSA PRIVATE KEY`, not a production detector.
- The page is a local prop. No ChatGPT, Claude, SaaS, cloud, account, or telemetry integration exists.
- The optional Tauri wrapper has no window, tray, updater, settings, or frontend.

## Two-minute Loom shot list

**0:00–0:15 — The promise.** Show Forge and say: “SecureIntent inspects the transfer boundary,
locally. The destination receives an allowed file or nothing.”

**0:15–0:35 — Allow.** Drop `allow.txt`. Point to **Scanning locally…**, then the attached filename
and size. Explain that a new `FileList` proves the original page flow resumed.

**0:35–1:00 — Block.** Drop `block.pem`. Show the closed-shadow warning and Forge's
**Blocked — not sent** state. Open Network briefly: no cloud scan occurred.

**1:00–1:25 — The bridge.** Show the host manifest's absolute path and pinned `allowed_origins`,
then `scan.rs` and the zeroizing session allocation. Explain Chrome's stdio framing and chunking.

**1:25–1:45 — Reliability.** Temporarily rename the installed host manifest, restart Chrome, and
drop `allow.txt`. The upload resumes after timeout. Restore the manifest afterward.

**1:45–2:00 — Evidence.** Run `cargo test` and close with: “Raw bytes stay local; the daemon returns
only Block or Allow.”

See [ARCHITECTURE.md](ARCHITECTURE.md) for protocol and threat-model details and
[PART2-STRATEGIC-BRIEF.md](PART2-STRATEGIC-BRIEF.md) for the 12-month enterprise direction.
