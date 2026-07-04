import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_CAPTURE_DURATION_SECONDS = 30;
export const CAPTURE_TIMEOUT_GRACE_MS = 10_000;

const EXT_CAPTURE_PREFIXES = new Set([
  'ciscodump',
  'randpkt',
  'sshdump',
  'udpdump',
  'wifidump',
]);

function sanitizeFileName(fileName) {
  const value = String(fileName || 'capture.pcap').trim() || 'capture.pcap';
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function parseInterfaceLine(line) {
  const match = String(line || '').match(/^\s*(\d+)\.\s+([^\s]+)(?:\s+\((.+)\))?\s*$/);
  if (!match) return null;

  return {
    index: Number(match[1]),
    name: match[2],
    description: match[3] || '',
  };
}

function isUsableInterface(iface) {
  if (!iface?.name) return false;
  if (EXT_CAPTURE_PREFIXES.has(iface.name)) return false;
  return true;
}

function normalizeDurationSeconds(durationSeconds) {
  const value = Number(durationSeconds);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Capture duration must be a positive whole number of seconds.');
  }
  return value;
}

function buildPermissionError(interfaceName, stderr) {
  const details = String(stderr || '').trim();
  const suffix = details ? ` tshark said: ${details}` : '';
  return new Error(
    `Capture permissions are insufficient on interface "${interfaceName}". ` +
    'Grant packet-capture access for tshark/dumpcap or retry with appropriate privileges.' +
    suffix,
  );
}

function toCaptureError(error, context = {}) {
  const stderr = String(error?.stderr || error?.message || '').trim();
  const interfaceName = context.interfaceName || 'unknown';

  if (error?.code === 'ENOENT') {
    return new Error('tshark is not installed or not on PATH.');
  }

  if (/permission|not permitted|access is denied|could not be initiated/i.test(stderr)) {
    return buildPermissionError(interfaceName, stderr);
  }

  return new Error(stderr || `Live capture failed on interface "${interfaceName}".`);
}

export async function listCaptureInterfaces(opts = {}) {
  const spawnImpl = opts.spawnImpl || spawn;

  return await new Promise((resolve, reject) => {
    const child = spawnImpl('tshark', ['-D'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(toCaptureError(error));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(toCaptureError(Object.assign(new Error(stderr || `tshark exited with status ${code}`), {
          code,
          stderr,
        })));
        return;
      }

      const interfaces = stdout
        .split(/\r?\n/)
        .map(parseInterfaceLine)
        .filter(Boolean);
      resolve(interfaces);
    });
  });
}

export async function resolveCaptureInterface(requestedInterface, opts = {}) {
  const interfaces = opts.interfaces || await listCaptureInterfaces(opts);
  const usableInterfaces = interfaces.filter(isUsableInterface);

  if (requestedInterface) {
    const match = usableInterfaces.find((iface) => iface.name === requestedInterface);
    if (!match) {
      throw new Error(
        `Capture interface "${requestedInterface}" is unavailable. ` +
        `Available interfaces: ${usableInterfaces.map((iface) => iface.name).join(', ') || 'none'}.`,
      );
    }
    return match;
  }

  const preferred = usableInterfaces.find((iface) => iface.name !== 'lo0');
  if (preferred) return preferred;

  const fallback = usableInterfaces[0];
  if (fallback) return fallback;

  throw new Error(
    'No usable capture interface is available. Connect a local network interface and retry, ' +
    'or pass an explicit interface name once one is present.',
  );
}

export async function withTemporaryCapturePath(fileName, fn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e3d-netdoctor-'));
  const tempPath = path.join(tempDir, sanitizeFileName(fileName || 'capture.pcap'));

  try {
    return await fn(tempPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function runTimedCaptureToFile(tempFilePath, opts = {}) {
  const interfaceName = String(opts.interfaceName || '').trim();
  if (!interfaceName) {
    throw new Error('runTimedCaptureToFile requires interfaceName.');
  }

  const durationSeconds = normalizeDurationSeconds(opts.durationSeconds || DEFAULT_CAPTURE_DURATION_SECONDS);
  const timeoutMs = Number.isFinite(opts.timeoutMs)
    ? opts.timeoutMs
    : (durationSeconds * 1000) + CAPTURE_TIMEOUT_GRACE_MS;
  const spawnImpl = opts.spawnImpl || spawn;

  await fs.mkdir(path.dirname(tempFilePath), { recursive: true });

  await new Promise((resolve, reject) => {
    const child = spawnImpl(
      'tshark',
      ['-i', interfaceName, '-a', `duration:${durationSeconds}`, '-w', tempFilePath],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(toCaptureError(error, { interfaceName }));
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (timedOut) {
        reject(new Error(
          `Live capture timed out after ${timeoutMs} ms on interface "${interfaceName}". ` +
          'The capture was stopped to avoid running indefinitely.',
        ));
        return;
      }

      if (code !== 0) {
        reject(toCaptureError(Object.assign(new Error(stderr || `tshark exited with status ${code}`), {
          code,
          stderr,
        }), { interfaceName }));
        return;
      }

      resolve();
    });
  });

  const stats = await fs.stat(tempFilePath);
  return {
    filePath: tempFilePath,
    fileSizeBytes: stats.size,
    interfaceName,
    durationSeconds,
    timeoutMs,
  };
}

export async function captureLiveTraffic(opts = {}) {
  const durationSeconds = normalizeDurationSeconds(opts.durationSeconds || DEFAULT_CAPTURE_DURATION_SECONDS);
  const parseFile = opts.parseFile;
  if (typeof parseFile !== 'function') {
    throw new Error('captureLiveTraffic requires parseFile.');
  }

  const selectedInterface = await resolveCaptureInterface(opts.interfaceName, opts);
  return await withTemporaryCapturePath(`capture-${selectedInterface.name}.pcap`, async (tempFilePath) => {
    const capture = await runTimedCaptureToFile(tempFilePath, {
      ...opts,
      interfaceName: selectedInterface.name,
      durationSeconds,
    });
    const parsed = await parseFile(tempFilePath, opts.parseOptions || {});
    return {
      capture,
      parsed,
    };
  });
}
