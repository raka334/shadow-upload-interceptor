export const NATIVE_HOST = 'com.secureintent.shadow';
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const RAW_CHUNK_BYTES = 256 * 1024;
export const NATIVE_TIMEOUT_MS = 2_500;

export interface ScanFileRequest {
  type: 'scan-file';
  scanId: string;
  name: string;
  mime: string;
  size: number;
  bytes: Uint8Array;
}

export type ScanFailureReason =
  | 'host_unavailable'
  | 'host_disconnected'
  | 'invalid_request'
  | 'invalid_response'
  | 'timeout'
  | 'too_large';

export interface ScanFileResult {
  decision: 'allow' | 'block';
  rule: 'pem_private_key' | null;
  failOpen: boolean;
  reason?: ScanFailureReason;
}

export type NativeRequest =
  | { type: 'scan_begin'; id: string; name: string; size: number }
  | { type: 'scan_chunk'; id: string; offset: number; data: string }
  | { type: 'scan_end'; id: string };

export interface NativeVerdict {
  type: 'verdict';
  id: string;
  decision: 'allow' | 'block';
  rule: 'pem_private_key' | null;
}

export function isScanFileRequest(value: unknown): value is ScanFileRequest {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ScanFileRequest>;
  return (
    message.type === 'scan-file' &&
    typeof message.scanId === 'string' &&
    message.scanId.length > 0 &&
    message.scanId.length <= 64 &&
    typeof message.name === 'string' &&
    message.name.length > 0 &&
    message.name.length <= 512 &&
    typeof message.mime === 'string' &&
    message.mime.length <= 256 &&
    Number.isSafeInteger(message.size) &&
    (message.size ?? -1) >= 0 &&
    message.bytes instanceof Uint8Array
  );
}

export function isNativeVerdict(value: unknown, scanId: string): value is NativeVerdict {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<NativeVerdict>;
  return (
    message.type === 'verdict' &&
    message.id === scanId &&
    (message.decision === 'allow' || message.decision === 'block') &&
    (message.rule === null || message.rule === 'pem_private_key')
  );
}

export function allowFailOpen(reason: ScanFailureReason): ScanFileResult {
  return { decision: 'allow', rule: null, failOpen: true, reason };
}
