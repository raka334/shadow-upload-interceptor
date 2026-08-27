import { browser } from 'wxt/browser';
import { MAX_FILE_BYTES, type ScanFileResult } from '../bridge/protocol';
import { mountUploadOverlay } from '../overlay/mountUploadOverlay';
import { resumeIntoInput } from './resumeUpload';

const FILE_INPUT_SELECTOR = 'input[type="file"][data-forge-upload]';
const CONTENT_TIMEOUT_MS = 3_500;
let warnedFailOpen = false;

interface DemoStatus {
  state: 'scanning' | 'allowed' | 'blocked';
  filename: string;
  detail?: string;
}

function notifyPage(status: DemoStatus): void {
  // DOM attributes cross Chrome's isolated-world boundary reliably; this demo-only
  // channel carries status metadata, never file bytes or matched content.
  document.documentElement.dataset.secureintentStatus = JSON.stringify(status);
}

function allowResult(reason: string): ScanFileResult {
  return {
    decision: 'allow',
    rule: null,
    failOpen: true,
    reason: reason === 'too_large' ? 'too_large' : 'timeout',
  };
}

async function requestScan(file: File): Promise<ScanFileResult> {
  if (file.size > MAX_FILE_BYTES) return allowResult('too_large');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const request = browser.runtime.sendMessage({
    type: 'scan-file',
    scanId: crypto.randomUUID(),
    name: file.name,
    mime: file.type,
    size: file.size,
    bytes,
  }) as Promise<ScanFileResult>;

  return Promise.race([
    request,
    new Promise<ScanFileResult>((resolve) => {
      setTimeout(() => resolve(allowResult('timeout')), CONTENT_TIMEOUT_MS);
    }),
  ]);
}

function canonicalInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(FILE_INPUT_SELECTOR);
}

function containsFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function installUploadGuard(): () => void {
  let generation = 0;
  document.documentElement.dataset.secureintentGuard = 'active';

  const processFile = async (file: File, input: HTMLInputElement, ownGeneration: number) => {
    notifyPage({ state: 'scanning', filename: file.name });

    let result: ScanFileResult;
    try {
      result = await requestScan(file);
    } catch {
      result = allowResult('timeout');
    }
    if (generation !== ownGeneration) return;

    if (result.decision === 'block') {
      notifyPage({ state: 'blocked', filename: file.name });
      mountUploadOverlay(file.name);
      return;
    }

    if (result.failOpen && !warnedFailOpen) {
      warnedFailOpen = true;
      console.warn('SecureIntent local scanner unavailable; upload allowed.', result.reason);
    }
    const status: DemoStatus = { state: 'allowed', filename: file.name };
    if (result.reason === 'too_large') {
      status.detail = 'File exceeded the 8 MiB demo scan limit.';
    } else if (result.failOpen) {
      status.detail = `Local scanner unavailable (${result.reason ?? 'unknown'}); upload allowed.`;
    }
    notifyPage(status);
    if (!resumeIntoInput(input, file)) {
      console.warn('SecureIntent could not reconstruct the file input after scanning.');
    }
  };

  const onChange = (event: Event) => {
    if (!event.isTrusted) return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches(FILE_INPUT_SELECTOR)) return;
    const file = input.files?.[0];
    if (!file) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    input.value = '';
    const ownGeneration = ++generation;
    void processFile(file, input, ownGeneration);
  };

  const onDragOver = (event: DragEvent) => {
    if (!event.isTrusted || !containsFiles(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (event: DragEvent) => {
    if (!event.isTrusted || !containsFiles(event)) return;
    const file = event.dataTransfer?.files?.[0];
    const input = canonicalInput();
    if (!file || !input) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const ownGeneration = ++generation;
    void processFile(file, input, ownGeneration);
  };

  window.addEventListener('change', onChange, true);
  window.addEventListener('dragover', onDragOver, true);
  window.addEventListener('drop', onDrop, true);

  return () => {
    delete document.documentElement.dataset.secureintentGuard;
    window.removeEventListener('change', onChange, true);
    window.removeEventListener('dragover', onDragOver, true);
    window.removeEventListener('drop', onDrop, true);
  };
}
