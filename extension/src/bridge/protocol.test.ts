import { describe, expect, test } from 'vitest';
import { allowFailOpen, isNativeVerdict, isScanFileRequest, MAX_FILE_BYTES } from './protocol';

describe('extension bridge protocol', () => {
  test('accepts a bounded typed-byte scan request', () => {
    expect(
      isScanFileRequest({
        type: 'scan-file',
        scanId: '80bb0ad2-25f6-494a-9101-1f547dfa79bb',
        name: 'allow.txt',
        mime: 'text/plain',
        size: 3,
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).toBe(true);
  });

  test('rejects plain objects in place of typed bytes', () => {
    expect(
      isScanFileRequest({
        type: 'scan-file',
        scanId: 'id',
        name: 'file',
        mime: '',
        size: 1,
        bytes: { 0: 1 },
      }),
    ).toBe(false);
  });

  test('accepts only the matching verdict and known rule', () => {
    expect(
      isNativeVerdict(
        {
          type: 'verdict',
          id: 'scan-1',
          decision: 'block',
          rule: 'pem_private_key',
        },
        'scan-1',
      ),
    ).toBe(true);
    expect(
      isNativeVerdict(
        { type: 'verdict', id: 'some-other-scan', decision: 'block', rule: 'pem_private_key' },
        'scan-1',
      ),
    ).toBe(false);
  });

  test('fail-open results never claim a rule match', () => {
    expect(allowFailOpen('timeout')).toEqual({
      decision: 'allow',
      rule: null,
      failOpen: true,
      reason: 'timeout',
    });
    expect(MAX_FILE_BYTES).toBe(8 * 1024 * 1024);
  });
});
