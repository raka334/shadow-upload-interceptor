# Shadow Upload Interceptor — Architecture

## One bounded transfer

```mermaid
sequenceDiagram
    actor Developer
    participant Page as Forge dummy page
    participant CS as WXT content script
    participant BG as MV3 background worker
    participant Host as Rust NM host (native or Tauri v2)

    CS->>BG: health-check
    BG->>Host: health { protocol: 1 }
    Host->>BG: ready { protocol: 1 }
    Developer->>Page: choose or drop File
    CS-->>CS: capture on window; cancel synchronously
    CS-->>Page: clear input; Scanning (metadata only)
    CS->>CS: File.arrayBuffer() → Uint8Array
    CS->>BG: structured-clone scan request
    BG->>Host: connectNative(com.secureintent.shadow)
    BG->>Host: scan_begin + base64 scan_chunk × N + scan_end
    Host-->>Host: validate, decode into Zeroizing buffers, scan bytes
    Host-->>Host: drop/zero owned file allocation
    Host->>BG: verdict { Block | Allow, rule id }
    BG->>CS: verdict
    alt Block
        CS-->>Page: closed Shadow DOM warning; file remains absent
    else Allow or bridge failure
        CS-->>Page: rebuild FileList; dispatch synthetic change
        Page-->>Developer: filename + size received
    end
```

## Why the earliest listener is on `window`

The original transfer event is the security boundary. Capture starts at `window`, so a listener
registered by the `document_start` content script runs before target/document handlers on the dummy
page. It calls `preventDefault()` and `stopImmediatePropagation()` before any promise or file read.
For a picker event it also snapshots the `File` and clears `input.value` synchronously. The page
therefore cannot read the original `FileList` from its normal handler while the decision is pending.

`dragover` is also cancelled in capture; without that, browsers commonly refuse to deliver `drop`.
The demo handles one file at a time, matching the product moment rather than hiding a partial
multi-file policy behind optimistic UI.

## Resuming a read-only `FileList`

`HTMLInputElement.files` cannot be mutated in place. On Allow, the content script creates a
`DataTransfer`, adds the retained `File`, assigns the resulting `FileList`, and dispatches a new
bubbling `change`. The extension ignores `isTrusted === false`, preventing recursion; the page
receives the event normally. Allowed drops use this same canonical input path instead of attempting
to forge a trusted `DragEvent`.

## The privilege boundary

Content scripts cannot call Native Messaging. They send a typed-byte request to the MV3 worker,
which validates the sender origin, metadata, declared length, and 8 MiB bound. Chrome 148's explicit
`message_serialization: structured_clone` setting copies the `Uint8Array` between extension
contexts. It is not a zero-copy transfer.

Only the background calls `connectNative`. Chrome launches one host process for the port and owns
the stdio pipes. Before launch, Chrome checks the caller against the native-host manifest, which
allows exactly `chrome-extension://<ID>/`; wildcards are absent and the trailing slash is required.

For a reproducible one-command demo, the unpacked manifest contains a public development key. The
launcher derives Chrome's stable extension ID from that key and writes the matching host origin.
This public key is identity metadata, not an authentication secret; production identity comes from
a signed Web Store package or enterprise-managed deployment.

The automated launcher uses Chrome for Testing or Chromium because branded Chrome 137+ removed the
`--load-extension` command-line path. It registers the host in that browser's specific Native
Messaging directory and refuses branded Chrome rather than presenting an unprotected demo page.
Because the runner supplies a disposable `--user-data-dir`, its host manifest is written into that
profile's `NativeMessagingHosts` directory—the location Chrome actually resolves for that process.

## Native Messaging instead of a local server

Native Messaging exposes no TCP listener. A web origin cannot probe or authenticate to the Rust
process, and another local user process cannot race a guessed port. It also avoids Private Network
Access, CORS, firewall, proxy and browser-store concerns. Chrome frames each UTF-8 JSON message as a
four-byte platform-native length followed by payload. All supported demo targets are little-endian,
the Rust host reads/writes `u32le`, and compilation is rejected on big-endian targets. The extension
does not construct this frame; Chrome does. The Rust `protocol` module is the framing endpoint.

Host-bound Chrome messages may be up to 64 MiB, while host-to-extension messages are limited to
approximately 1 MiB. This protocol keeps both far below those limits: each 256 KiB raw chunk becomes
about 342 KiB of base64 JSON, and the return value is a tiny verdict.

Production files far beyond this demo's bound would use Native Messaging as a control plane: the
host would vend an expiring, single-use capability for a user-scoped Unix domain socket or named
pipe. File bytes would still avoid TCP and cloud infrastructure. That transport is intentionally
outside this slice.

## Protocol invariants

```json
{ "type": "health", "id": "uuid", "protocol": 1 }
{ "type": "scan_begin", "id": "uuid", "name": "id_rsa", "size": 1234, "protocol": 1 }
{ "type": "scan_chunk", "id": "uuid", "offset": 0, "data": "<base64>" }
{ "type": "scan_end", "id": "uuid" }
```

```json
{ "type": "health", "id": "uuid", "protocol": 1, "status": "ready" }
{ "type": "verdict", "id": "uuid", "decision": "block", "rule": "pem_private_key" }
```

Every request uses a strict schema; unknown fields are rejected. The host accepts protocol v1, one
active scan, a maximum 512 KiB JSON frame, a maximum declared file size of 8 MiB, bounded metadata,
matching IDs, contiguous raw offsets, valid base64, no decoded overflow, and exact final length. A
violation closes the host; the worker observes disconnect and fails open. The verdict never includes
filename, bytes, offsets, matched text, or a file-derived fingerprint.

## Memory ownership

The Rust host wraps each incoming JSON frame in `Zeroizing<Vec<u8>>`. `serde_json` borrows the
base64 slice directly from that frame. Decoded chunks are separately zeroizing. On `scan_begin`, the
host creates an exact-capacity `Zeroizing<Vec<u8>>`; this prevents growth reallocations from leaving
abandoned sensitive allocations. The complete file stays bytes, is checked against a deterministic
byte-rule registry, and is explicitly dropped before the verdict is serialized. Filenames and
extensions never influence the decision.

This guarantees scrubbing only for allocations the host owns. Chrome and V8 hold the original
`File`/`ArrayBuffer`; OS pipes and allocators may copy; base64/JSON dependencies and crash or swap
facilities are outside the host's absolute control. The content script and worker overwrite their
owned `Uint8Array` views after each decision, but this is best effort under garbage collection. No
temporary file, mmap, content log, or cloud request is created.

## Rust core and Tauri v2 host

The security boundary is one Rust library with two thin executable entrypoints:

- `secureintent-shadow-host` is the dependency-light Native Messaging sidecar used by the default
  demo. Chrome owns its lifetime from `connectNative` until the port closes.
- `secureintent-shadow-tauri` is a genuine zero-window Tauri v2 application. Tauri owns the
  main-thread lifecycle while `tauri::async_runtime::spawn_blocking` owns the blocking stdio scan
  loop. Chrome can register this executable directly with `./run-demo.sh --tauri-host`.

Both call the same `run_stdio()` library entrypoint, so protocol validation, byte scanning, and
zeroization cannot drift between variants. They have distinct binary names, and CI compiles and
exercises protocol smoke tests and real-browser flows through each path. The default remains the
small sidecar because forcing an evaluator to install WebKitGTK does not improve Chrome's
already-authenticated stdio transport.
The Tauri path proves the production desktop lifecycle without adding a GUI, tray, commands,
plugins, updater, capabilities, or frontend.

## Threat model

| Threat | Control | Residual risk |
|---|---|---|
| Malicious destination page | Earliest capture, synchronous clearing, isolated content world, closed Shadow DOM | The page can hide/remove the overlay host but cannot recover already-blocked bytes; a browser exploit or earlier privileged extension is out of scope |
| Page forges extension messages | Background validates sender origin and typed request; no externally-connectable API | Compromised renderer could attack its content script, so the worker trusts only bounded bytes |
| Unrelated extension calls host | Native manifest pins one extension origin | A fully compromised Chrome profile can alter local manifests |
| Local process probes scanner | No listening TCP/socket endpoint; Chrome supplies stdio | Same-user malware can inspect memory or replace binaries/manifests |
| Oversized/malformed input | Frame, file, offset, base64 and final-size bounds | A valid 8 MiB file intentionally consumes up to the configured bound |
| Host crash/missing install | 2.5 s bounded timeout and fail-open reconstruction | A secret can pass while protection is unavailable; velocity is the selected default |
| Memory recovery | Zeroizing owned frames, chunks and aggregate; no disk writes | Copies outside Rust ownership, swap and privileged memory inspection remain possible |

## Path into the real product

In the existing extension, this content guard would be a sibling of the paste guard and reuse its
destination selectors and closed-shadow UI primitives. The protocol/scanner library remains shared
by the Chrome-spawned sidecar and Tauri desktop process; Native Messaging remains the authenticated
browser control plane. The demo proves that seam without merging codebases or inventing desktop UI.
