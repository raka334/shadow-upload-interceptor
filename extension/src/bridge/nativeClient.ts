import { browser } from 'wxt/browser';
import {
  allowFailOpen,
  isNativeVerdict,
  NATIVE_HOST,
  NATIVE_TIMEOUT_MS,
  RAW_CHUNK_BYTES,
  type ScanFileRequest,
  type ScanFileResult,
} from './protocol';

function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const sliceSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += sliceSize) {
    const slice = bytes.subarray(offset, Math.min(offset + sliceSize, bytes.length));
    let binary = '';
    for (const byte of slice) binary += String.fromCharCode(byte);
    parts.push(binary);
  }
  return btoa(parts.join(''));
}

/** One Native Messaging process and port per scan. Chrome owns the u32 framing. */
export function scanWithNativeHost(request: ScanFileRequest): Promise<ScanFileResult> {
  return new Promise((resolve) => {
    let settled = false;
    let port: ReturnType<typeof browser.runtime.connectNative> | undefined;

    const finish = (result: ScanFileResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        port?.disconnect();
      } catch {
        // Already disconnected.
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(allowFailOpen('timeout')), NATIVE_TIMEOUT_MS);

    try {
      port = browser.runtime.connectNative(NATIVE_HOST);
      port.onMessage.addListener((message: unknown) => {
        if (!isNativeVerdict(message, request.scanId)) {
          finish(allowFailOpen('invalid_response'));
          return;
        }
        finish({
          decision: message.decision,
          rule: message.rule,
          failOpen: false,
        });
      });
      port.onDisconnect.addListener(() => finish(allowFailOpen('host_disconnected')));

      port.postMessage({
        type: 'scan_begin',
        id: request.scanId,
        name: request.name,
        size: request.size,
      });
      for (let offset = 0; offset < request.bytes.length; offset += RAW_CHUNK_BYTES) {
        const chunk = request.bytes.subarray(
          offset,
          Math.min(offset + RAW_CHUNK_BYTES, request.bytes.length),
        );
        port.postMessage({
          type: 'scan_chunk',
          id: request.scanId,
          offset,
          data: encodeBase64(chunk),
        });
      }
      port.postMessage({ type: 'scan_end', id: request.scanId });
    } catch {
      finish(allowFailOpen('host_unavailable'));
    }
  });
}
