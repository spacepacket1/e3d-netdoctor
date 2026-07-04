import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { test } from 'node:test';

import {
  captureLiveTraffic,
  resolveCaptureInterface,
  runTimedCaptureToFile,
} from '../src/liveCapture.js';

function createSpawnStub(handlers = {}) {
  return function spawnStub() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      child.killed = true;
    };

    queueMicrotask(async () => {
      try {
        await handlers.onSpawn?.(child, ...arguments);
      } catch (error) {
        child.emit('error', error);
      }
    });

    return child;
  };
}

test('resolveCaptureInterface prefers the first usable local interface', async () => {
  const iface = await resolveCaptureInterface(undefined, {
    interfaces: [
      { name: 'randpkt', description: 'Random packet generator' },
      { name: 'lo0', description: 'Loopback' },
      { name: 'en0', description: 'Ethernet' },
    ],
  });

  assert.equal(iface.name, 'en0');
});

test('resolveCaptureInterface reports when no usable interfaces are available', async () => {
  await assert.rejects(
    resolveCaptureInterface(undefined, {
      interfaces: [
        { name: 'randpkt', description: 'Random packet generator' },
        { name: 'sshdump', description: 'SSH remote capture' },
      ],
    }),
    /No usable capture interface is available/,
  );
});

test('runTimedCaptureToFile surfaces actionable capture permission errors', async () => {
  const spawnImpl = createSpawnStub({
    onSpawn(child) {
      child.stderr.emit('data', Buffer.from("You don't have permission to capture on that device."));
      child.emit('close', 1);
    },
  });

  await assert.rejects(
    runTimedCaptureToFile(path.resolve('tmp/permission-test.pcap'), {
      interfaceName: 'en0',
      durationSeconds: 30,
      spawnImpl,
    }),
    /Capture permissions are insufficient on interface "en0"/,
  );
});

test('captureLiveTraffic cleans up its temporary file after a successful parse', async () => {
  let capturedPath = null;
  let observedDuringParse = false;

  const spawnImpl = createSpawnStub({
    async onSpawn(child, command, args) {
      const outputPath = args[args.length - 1];
      await fs.writeFile(outputPath, 'pcap-data');
      child.emit('close', 0);
    },
  });

  const result = await captureLiveTraffic({
    interfaceName: 'en0',
    durationSeconds: 1,
    interfaces: [{ name: 'en0', description: 'Ethernet' }],
    spawnImpl,
    parseFile: async (filePath) => {
      capturedPath = filePath;
      observedDuringParse = await fs.access(filePath).then(() => true, () => false);
      return {
        rows: [],
        diagnostics: { packetCount: 0, conversationCount: 0, warnings: [] },
      };
    },
  });

  assert.equal(result.capture.interfaceName, 'en0');
  assert.equal(observedDuringParse, true);
  await assert.rejects(fs.access(capturedPath), /ENOENT/);
});

test('captureLiveTraffic cleans up its temporary file after parser failure', async () => {
  let capturedPath = null;

  const spawnImpl = createSpawnStub({
    async onSpawn(child, command, args) {
      const outputPath = args[args.length - 1];
      await fs.writeFile(outputPath, 'pcap-data');
      child.emit('close', 0);
    },
  });

  await assert.rejects(
    captureLiveTraffic({
      interfaceName: 'en0',
      durationSeconds: 1,
      interfaces: [{ name: 'en0', description: 'Ethernet' }],
      spawnImpl,
      parseFile: async (filePath) => {
        capturedPath = filePath;
        throw new Error('parser failed');
      },
    }),
    /parser failed/,
  );

  await assert.rejects(fs.access(capturedPath), /ENOENT/);
});
