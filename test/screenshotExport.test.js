import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { test } from 'node:test';

import { createPngFromHtml } from '../src/screenshotExport.js';

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

test('createPngFromHtml throws an actionable error when no browser is found', async () => {
  const spawnImpl = createSpawnStub({
    onSpawn: (child) => {
      child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
    },
  });

  await assert.rejects(
    () => createPngFromHtml('<p>report</p>', { spawnImpl }),
    /No headless-capable browser was found for screenshot export\. Install Google Chrome/,
  );
});

test('createPngFromHtml rejects empty HTML content', async () => {
  await assert.rejects(
    () => createPngFromHtml('   ', { browserPath: '/fake/chrome' }),
    /Screenshot export requires non-empty HTML content/,
  );
});

test('createPngFromHtml writes the rendered PNG and cleans up its temp directory on success', async () => {
  let capturedPngPath = null;
  let tempDirDuringRun = null;
  let capturedArgs = null;

  const spawnImpl = createSpawnStub({
    onSpawn: async (child, command, args) => {
      capturedArgs = args;
      const pngArg = args.find((arg) => arg.startsWith('--screenshot='));
      capturedPngPath = pngArg.slice('--screenshot='.length);
      tempDirDuringRun = capturedPngPath.replace(/\/report\.png$/, '');
      await fs.writeFile(capturedPngPath, Buffer.from('fake-png-bytes'));
      child.emit('close', 0);
    },
  });

  const result = await createPngFromHtml('<p>report</p>', { browserPath: '/fake/chrome', spawnImpl });

  assert.equal(Buffer.isBuffer(result), true);
  assert.match(result.toString(), /fake-png-bytes/);
  assert.ok(capturedArgs.some((arg) => arg.startsWith('--window-size=')));

  await assert.rejects(() => fs.access(tempDirDuringRun), /ENOENT/);
});

test('createPngFromHtml cleans up its temp directory even when the browser process fails', async () => {
  let tempDirDuringRun = null;

  const spawnImpl = createSpawnStub({
    onSpawn: (child, command, args) => {
      const pngArg = args.find((arg) => arg.startsWith('--screenshot='));
      tempDirDuringRun = pngArg.slice('--screenshot='.length).replace(/\/report\.png$/, '');
      child.stderr.emit('data', Buffer.from('renderer crashed'));
      child.emit('close', 1);
    },
  });

  await assert.rejects(
    () => createPngFromHtml('<p>report</p>', { browserPath: '/fake/chrome', spawnImpl }),
    /renderer crashed/,
  );

  await assert.rejects(() => fs.access(tempDirDuringRun), /ENOENT/);
});
