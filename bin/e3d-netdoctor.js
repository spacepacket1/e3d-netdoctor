#!/usr/bin/env node

import { runCli } from '../src/cli.js';

const exitCode = await runCli(process.argv.slice(2));
if (Number.isInteger(exitCode) && exitCode !== 0) {
  process.exitCode = exitCode;
}
