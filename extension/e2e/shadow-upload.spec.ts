import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const extensionPath = resolve(repoRoot, 'extension/.output/chrome-mv3');
const demoUrl = 'http://localhost:4173';
const hostName = 'com.secureintent.shadow';

interface RunningExtension {
  context: BrowserContext;
  profile: string;
}

function deriveExtensionId(): string {
  const manifest = JSON.parse(readFileSync(resolve(extensionPath, 'manifest.json'), 'utf8')) as {
    key?: unknown;
  };
  if (typeof manifest.key !== 'string' || manifest.key.length === 0) {
    throw new Error('Built extension manifest does not contain its pinned development key.');
  }
  const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest();
  const alphabet = 'abcdefghijklmnop';
  return Array.from(digest.subarray(0, 16), (byte) => {
    return `${alphabet[byte >> 4]}${alphabet[byte & 15]}`;
  }).join('');
}

async function launchExtension(hostBinary?: string): Promise<RunningExtension> {
  const profile = mkdtempSync(join(tmpdir(), 'secureintent-shadow-e2e.'));
  try {
    if (hostBinary) {
      const absoluteBinary = resolve(repoRoot, hostBinary);
      chmodSync(absoluteBinary, 0o755);
      const hostDirectory = join(profile, 'NativeMessagingHosts');
      mkdirSync(hostDirectory, { recursive: true, mode: 0o700 });
      writeFileSync(
        join(hostDirectory, `${hostName}.json`),
        `${JSON.stringify(
          {
            name: hostName,
            description: 'SecureIntent Shadow Upload E2E native scanner',
            path: absoluteBinary,
            type: 'stdio',
            allowed_origins: [`chrome-extension://${deriveExtensionId()}/`],
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
    }

    const executablePath = process.env.SHADOW_E2E_CHROME_BIN;
    const context = await chromium.launchPersistentContext(profile, {
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      headless: process.env.SHADOW_E2E_HEADED !== '1',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    return { context, profile };
  } catch (error) {
    rmSync(profile, { recursive: true, force: true });
    throw error;
  }
}

async function closeExtension(running: RunningExtension | undefined): Promise<void> {
  if (!running) return;
  try {
    await running.context.close();
  } finally {
    rmSync(running.profile, { recursive: true, force: true });
  }
}

function requireContext(running: RunningExtension | undefined): BrowserContext {
  if (!running) throw new Error('Extension context did not start.');
  return running.context;
}

async function openForge(context: BrowserContext, guard: 'active' | 'degraded'): Promise<Page> {
  const page = await context.newPage();
  await page.goto(demoUrl);
  await expect.poll(() => page.locator('html').getAttribute('data-secureintent-guard')).toBe(guard);
  return page;
}

async function chooseFile(page: Page, filePath: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByText('Choose file', { exact: true }).click();
  await (await chooserPromise).setFiles(filePath);
}

async function chooseFileWithKeyboard(page: Page, filePath: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#forge-drop-zone').focus();
  await page.keyboard.press('Enter');
  await (await chooserPromise).setFiles(filePath);
}

async function dropFile(page: Page, filePath: string): Promise<void> {
  const zone = page.locator('#forge-drop-zone');
  const box = await zone.boundingBox();
  if (!box) throw new Error('Drop zone is not visible.');
  const client = await page.context().newCDPSession(page);
  const dragData = {
    items: [],
    files: [filePath],
    dragOperationsMask: 1,
  };
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  try {
    await client.send('Input.dispatchDragEvent', { type: 'dragEnter', ...point, data: dragData });
    await client.send('Input.dispatchDragEvent', { type: 'dragOver', ...point, data: dragData });
    await client.send('Input.dispatchDragEvent', { type: 'drop', ...point, data: dragData });
  } finally {
    await client.detach();
  }
}

async function expectAllowed(page: Page, filename: string): Promise<void> {
  await expect(page.locator('#status-title')).toHaveText('Allowed — uploaded');
  await expect(page.locator('#received-name')).toHaveText(filename);
  await expect(page.locator('#received-file')).toBeVisible();
  expect(
    await page
      .locator('input[type=file]')
      .evaluate((input: HTMLInputElement) => input.files?.length),
  ).toBe(1);
  await expect(page.locator('secureintent-shadow-warning')).toHaveCount(0);
}

async function expectBlocked(page: Page): Promise<void> {
  await expect(page.locator('#status-title')).toHaveText('Blocked — not sent');
  await expect(page.locator('#received-file')).toBeHidden();
  await expect(page.locator('secureintent-shadow-warning')).toHaveCount(1);
  expect(
    await page.evaluate(() => {
      const host = document.querySelector('secureintent-shadow-warning');
      return host ? host.shadowRoot : 'missing';
    }),
  ).toBeNull();
  expect(
    await page
      .locator('input[type=file]')
      .evaluate((input: HTMLInputElement) => input.files?.length),
  ).toBe(0);
}

test.describe('protected upload loop', () => {
  test.describe.configure({ mode: 'serial' });
  let running: RunningExtension | undefined;
  let fixtureDirectory: string;

  test.beforeAll(async () => {
    const hostBinary =
      process.env.SHADOW_E2E_HOST_BINARY ?? 'daemon/target/debug/secureintent-shadow-host';
    running = await launchExtension(hostBinary);
    fixtureDirectory = mkdtempSync(join(tmpdir(), 'secureintent-shadow-fixtures.'));
    copyFileSync(
      resolve(repoRoot, 'testdata/block.pem'),
      join(fixtureDirectory, 'meeting-notes.txt'),
    );
    copyFileSync(
      resolve(repoRoot, 'testdata/allow.txt'),
      join(fixtureDirectory, 'private-key.pem'),
    );
  });

  test.afterAll(async () => {
    try {
      await closeExtension(running);
    } finally {
      if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  test('allows harmless bytes even when the filename looks secret', async () => {
    const page = await openForge(requireContext(running), 'active');
    await chooseFileWithKeyboard(page, join(fixtureDirectory, 'private-key.pem'));
    await expectAllowed(page, 'private-key.pem');
    await page.close();
  });

  test('blocks private-key bytes even when renamed as text', async () => {
    const page = await openForge(requireContext(running), 'active');
    await chooseFile(page, join(fixtureDirectory, 'meeting-notes.txt'));
    await expectBlocked(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('secureintent-shadow-warning')).toHaveCount(0);
    await page.close();
  });

  test('intercepts a trusted drag-and-drop upload', async () => {
    const page = await openForge(requireContext(running), 'active');
    await chooseFile(page, resolve(repoRoot, 'testdata/allow.txt'));
    await expectAllowed(page, 'allow.txt');
    await dropFile(page, resolve(repoRoot, 'testdata/block.pem'));
    await expectBlocked(page);
    await page.close();
  });

  test('allows over-limit files explicitly without sending them to the host', async () => {
    const page = await openForge(requireContext(running), 'active');
    const oversized = join(fixtureDirectory, `${randomUUID()}.bin`);
    writeFileSync(oversized, Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
    await chooseFile(page, oversized);
    await expectAllowed(page, basename(oversized));
    await expect(page.locator('#status-detail')).toContainText(
      'exceeded the 8 MiB demo scan limit',
    );
    await page.close();
  });
});

test('fails open when the native host is absent', async () => {
  const running = await launchExtension();
  try {
    const page = await openForge(running.context, 'degraded');
    await chooseFile(page, resolve(repoRoot, 'testdata/block.pem'));
    await expectAllowed(page, 'block.pem');
    await expect(page.locator('#status-detail')).toContainText('Local scanner unavailable');
    await expect(page.locator('html')).toHaveAttribute('data-secureintent-guard', 'degraded');
  } finally {
    await closeExtension(running);
  }
});
