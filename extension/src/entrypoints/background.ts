import { browser, defineBackground } from '#imports';
import { scanWithNativeHost } from '../bridge/nativeClient';
import {
  allowFailOpen,
  isScanFileRequest,
  MAX_FILE_BYTES,
  type ScanFileResult,
} from '../bridge/protocol';

const ALLOWED_ORIGINS = new Set(['http://localhost:4173', 'http://127.0.0.1:4173']);

function trustedSender(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ALLOWED_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if ((message as { type?: unknown })?.type !== 'scan-file') return false;

    const handle = async (): Promise<ScanFileResult> => {
      if (!trustedSender(sender.url) || !isScanFileRequest(message)) {
        return allowFailOpen('invalid_request');
      }
      if (message.size !== message.bytes.byteLength) return allowFailOpen('invalid_request');
      if (message.size > MAX_FILE_BYTES) return allowFailOpen('too_large');

      return scanWithNativeHost(message);
    };

    void handle()
      .then(sendResponse)
      .catch(() => sendResponse(allowFailOpen('host_unavailable')));
    return true;
  });
});
