// Vendored from e3d-pcap/server/tsharkCheck.js.

import { spawn } from 'node:child_process';

import { TSHARK_INSTALL_HINT } from './localPcapParse.js';

export async function checkTsharkInstalled({ spawnImpl = spawn } = {}) {
  return await new Promise((resolve) => {
    const child = spawnImpl('tshark', ['-v'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      const isMissing = error?.code === 'ENOENT';
      resolve({
        installed: false,
        version: null,
        message: isMissing
          ? `tshark was not found. ${TSHARK_INSTALL_HINT}`
          : String(error?.message || error),
      });
    });
    child.on('close', (code) => {
      if (code === 0) {
        const versionLine = `${stdout}\n${stderr}`.split('\n').map((line) => line.trim()).find(Boolean) || null;
        resolve({ installed: true, version: versionLine, message: 'tshark detected' });
        return;
      }

      resolve({
        installed: false,
        version: null,
        message: stderr.trim() || stdout.trim() || `tshark exited with status ${code}. ${TSHARK_INSTALL_HINT}`,
      });
    });
  });
}
