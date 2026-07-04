import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredPaths = [
  'bin/e3d-netdoctor.js',
  'src/cli.js',
  'src/e3dPcap.js',
  'fixtures/sample-syn.pcap',
];

for (const relativePath of requiredPaths) {
  await access(path.join(rootDir, relativePath));
}

await import('../src/cli.js');
await import('../src/e3dPcap.js');

console.log('Build verification passed.');
