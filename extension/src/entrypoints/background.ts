import { browser, defineBackground } from '#imports';
import { checkNativeHost, scanWithNativeHost } from '../bridge/nativeClient';
import {
  allowFailOpen,
  type HealthCheckResult,
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
    const messageType = (message as { type?: unknown })?.type;
    if (messageType !== 'scan-file' && messageType !== 'health-check') return false;

    if (messageType === 'health-check') {
      const handleHealth = async (): Promise<HealthCheckResult> => {
        if (!trustedSender(sender.url)) {
          return { available: false, protocol: null, reason: 'invalid_request' };
        }
        return checkNativeHost(crypto.randomUUID());
      };

      void handleHealth()
        .then(sendResponse)
        .catch(() =>
          sendResponse({ available: false, protocol: null, reason: 'host_unavailable' }),
        );
      return true;
    }

    const handle = async (): Promise<ScanFileResult> => {
      if (!trustedSender(sender.url) || !isScanFileRequest(message)) {
        return allowFailOpen('invalid_request');
      }
      if (message.size !== message.bytes.byteLength) return allowFailOpen('invalid_request');
      if (message.size > MAX_FILE_BYTES) return allowFailOpen('too_large');

      try {
        return await scanWithNativeHost(message);
      } finally {
        // Best-effort scrubbing of the worker's structured-clone allocation.
        message.bytes.fill(0);
      }
    };

    void handle()
      .then(sendResponse)
      .catch(() => sendResponse(allowFailOpen('host_unavailable')));
    return true;
  });
});
