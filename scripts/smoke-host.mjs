import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { endianness } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = resolve(root, 'daemon/target/debug/secureintent-shadow-host');
const fixturePath = resolve(root, process.argv[2] ?? 'testdata/block.pem');
const expected = process.argv[3] ?? 'block';

if (!existsSync(binary)) {
  console.error('Build the protocol host first: cargo build --manifest-path daemon/Cargo.toml');
  process.exit(2);
}

const bytes = readFileSync(fixturePath);
const scanId = 'smoke-test';
const messages = [
  { type: 'scan_begin', id: scanId, name: 'fixture', size: bytes.length },
  { type: 'scan_chunk', id: scanId, offset: 0, data: bytes.toString('base64') },
  { type: 'scan_end', id: scanId },
];

function frame(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  if (endianness() === 'LE') header.writeUInt32LE(payload.length);
  else header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

const host = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
const stdout = [];
const stderr = [];
host.stdout.on('data', (chunk) => stdout.push(chunk));
host.stderr.on('data', (chunk) => stderr.push(chunk));
for (const message of messages) host.stdin.write(frame(message));
host.stdin.end();

const exitCode = await new Promise((resolveExit) => host.on('close', resolveExit));
if (exitCode !== 0) {
  console.error(Buffer.concat(stderr).toString('utf8'));
  process.exit(exitCode ?? 1);
}

const response = Buffer.concat(stdout);
if (response.length < 4) throw new Error('native host returned no framed verdict');
const length = endianness() === 'LE' ? response.readUInt32LE(0) : response.readUInt32BE(0);
const verdict = JSON.parse(response.subarray(4, 4 + length).toString('utf8'));
if (verdict.decision !== expected) {
  throw new Error(`expected ${expected}, received ${verdict.decision}`);
}
console.log(`Native Messaging smoke test: ${verdict.decision.toUpperCase()} (${fixturePath})`);

