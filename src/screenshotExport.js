import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { BROWSER_INSTALL_HINT, findBrowserExecutable } from './pdfExport.js';

export const DEFAULT_SCREENSHOT_TIMEOUT_MS = 20_000;
export const DEFAULT_SCREENSHOT_WINDOW_SIZE = '1200,1600';

async function renderScreenshotWithBrowser(browserPath, html, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_SCREENSHOT_TIMEOUT_MS;
  const windowSize = options.windowSize || DEFAULT_SCREENSHOT_WINDOW_SIZE;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e3d-netdoctor-screenshot-'));
  const htmlPath = path.join(tempDir, 'report.html');
  const pngPath = path.join(tempDir, 'report.png');

  try {
    await fs.writeFile(htmlPath, html, 'utf8');

    await new Promise((resolve, reject) => {
      const args = [
        '--headless=new',
        '--disable-gpu',
        `--window-size=${windowSize}`,
        `--screenshot=${pngPath}`,
        `file://${htmlPath}`,
        ...(options.browserArgs || []),
      ];
      const child = spawnImpl(browserPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      let timedOut = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error?.code === 'ENOENT'
          ? new Error(`Browser executable "${browserPath}" could not be launched. ${BROWSER_INSTALL_HINT}`)
          : error);
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        if (timedOut) {
          reject(new Error(`Screenshot export timed out after ${timeoutMs} ms.`));
          return;
        }
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Browser exited with status ${code} while exporting a screenshot.`));
          return;
        }
        resolve();
      });
    });

    return await fs.readFile(pngPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function createPngFromHtml(html, options = {}) {
  if (!html || !String(html).trim()) {
    throw new Error('Screenshot export requires non-empty HTML content');
  }

  const browserPath = await findBrowserExecutable(options);
  if (!browserPath) {
    throw new Error(`No headless-capable browser was found for screenshot export. ${BROWSER_INSTALL_HINT}`);
  }

  return await renderScreenshotWithBrowser(browserPath, html, options);
}
