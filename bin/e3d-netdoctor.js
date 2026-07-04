#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

// Dynamic import, not static: cli.js (and paymentGate.js underneath it) reads
// some env vars at module-evaluation time, and static imports are hoisted
// ahead of the loadEnvFile() call above, which would skip the .env file.
const { runCli } = await import('../src/cli.js');

const exitCode = await runCli(process.argv.slice(2));
if (Number.isInteger(exitCode) && exitCode !== 0) {
  process.exitCode = exitCode;
}
