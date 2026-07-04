import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { test } from 'node:test';

import {
  createPdfFromHtml,
  findBrowserExecutable,
} from '../src/pdfExport.js';

function createSpawnStub(handlers = {}) {
  return function spawnStub(command, args) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      child.killed = true;
    };

    queueMicrotask(async () => {
      try {
        await handlers.onSpawn?.(child, command, args);
      } catch (error) {
        child.emit('error', error);
      }
    });

    return child;
  };
}

test('findBrowserExecutable resolves the first PATH candidate that responds to --version', async () => {
  const spawnImpl = createSpawnStub({
    onSpawn: (child, command) => {
      if (command === 'google-chrome-stable') {
        child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
        return;
      }
      child.emit('exit', 0);
    },
  });

  const resolved = await findBrowserExecutable({ spawnImpl });
  assert.equal(resolved, 'google-chrome');
});

test('findBrowserExecutable returns null when no candidate is available', async () => {
  const spawnImpl = createSpawnStub({
    onSpawn: (child) => {
      child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
    },
  });

  const resolved = await findBrowserExecutable({ spawnImpl });
  assert.equal(resolved, null);
});

test('createPdfFromHtml throws an actionable error when no browser is found', async () => {
  const spawnImpl = createSpawnStub({
    onSpawn: (child) => {
      child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
    },
  });

  await assert.rejects(
    () => createPdfFromHtml('<p>report</p>', { spawnImpl }),
    /No headless-capable browser was found for PDF export\. Install Google Chrome/,
  );
});

test('createPdfFromHtml writes the rendered PDF and cleans up its temp directory on success', async () => {
  let capturedPdfPath = null;
  let tempDirDuringRun = null;

  const spawnImpl = createSpawnStub({
    onSpawn: async (child, command, args) => {
      const pdfArg = args.find((arg) => arg.startsWith('--print-to-pdf='));
      capturedPdfPath = pdfArg.slice('--print-to-pdf='.length);
      tempDirDuringRun = capturedPdfPath.replace(/\/report\.pdf$/, '');
      await fs.writeFile(capturedPdfPath, Buffer.from('%PDF-1.4 fake'));
      child.emit('close', 0);
    },
  });

  const result = await createPdfFromHtml('<p>report</p>', { browserPath: '/fake/chrome', spawnImpl });

  assert.equal(Buffer.isBuffer(result), true);
  assert.match(result.toString(), /%PDF-1\.4 fake/);

  await assert.rejects(() => fs.access(tempDirDuringRun), /ENOENT/);
});

test('createPdfFromHtml cleans up its temp directory even when the browser process fails', async () => {
  let tempDirDuringRun = null;

  const spawnImpl = createSpawnStub({
    onSpawn: (child, command, args) => {
      const pdfArg = args.find((arg) => arg.startsWith('--print-to-pdf='));
      tempDirDuringRun = pdfArg.slice('--print-to-pdf='.length).replace(/\/report\.pdf$/, '');
      child.stderr.emit('data', Buffer.from('renderer crashed'));
      child.emit('close', 1);
    },
  });

  await assert.rejects(
    () => createPdfFromHtml('<p>report</p>', { browserPath: '/fake/chrome', spawnImpl }),
    /renderer crashed/,
  );

  await assert.rejects(() => fs.access(tempDirDuringRun), /ENOENT/);
});
