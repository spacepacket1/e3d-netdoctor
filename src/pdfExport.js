import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const BROWSER_INSTALL_HINT = 'Install Google Chrome, Chromium, or Microsoft Edge to enable PDF export '
  + '(netdoctor shells out to the browser\'s built-in --headless --print-to-pdf, no npm dependency required). '
  + 'You can also point netdoctor at a specific binary with NETDOCTOR_BROWSER_PATH.';

export const DEFAULT_PDF_TIMEOUT_MS = 20_000;

const CANDIDATE_BINARY_NAMES = [
  'google-chrome-stable',
  'google-chrome',
  'chromium-browser',
  'chromium',
  'microsoft-edge-stable',
  'microsoft-edge',
  'brave-browser',
];

const DARWIN_APP_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function resolveFromPath(name, spawnImpl) {
  return new Promise((resolve) => {
    const child = spawnImpl(name, ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(null));
    child.on('exit', (code) => resolve(code === 0 || code === null ? name : null));
  });
}

export async function findBrowserExecutable(options = {}) {
  if (options.browserPath) return options.browserPath;
  if (process.env.NETDOCTOR_BROWSER_PATH) return process.env.NETDOCTOR_BROWSER_PATH;

  const spawnImpl = options.spawnImpl || spawn;

  if (process.platform === 'darwin') {
    for (const candidate of DARWIN_APP_PATHS) {
      if (await pathExists(candidate)) return candidate;
    }
  }

  for (const name of CANDIDATE_BINARY_NAMES) {
    const resolved = await resolveFromPath(name, spawnImpl);
    if (resolved) return resolved;
  }

  return null;
}

async function renderPdfWithBrowser(browserPath, html, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_PDF_TIMEOUT_MS;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e3d-netdoctor-pdf-'));
  const htmlPath = path.join(tempDir, 'report.html');
  const pdfPath = path.join(tempDir, 'report.pdf');

  try {
    await fs.writeFile(htmlPath, html, 'utf8');

    await new Promise((resolve, reject) => {
      const args = [
        '--headless=new',
        '--disable-gpu',
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
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
          reject(new Error(`PDF export timed out after ${timeoutMs} ms.`));
          return;
        }
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Browser exited with status ${code} while exporting PDF.`));
          return;
        }
        resolve();
      });
    });

    return await fs.readFile(pdfPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function createPdfFromHtml(html, options = {}) {
  if (!html || !String(html).trim()) {
    throw new Error('PDF export requires non-empty HTML content');
  }

  const browserPath = await findBrowserExecutable(options);
  if (!browserPath) {
    throw new Error(`No headless-capable browser was found for PDF export. ${BROWSER_INSTALL_HINT}`);
  }

  return await renderPdfWithBrowser(browserPath, html, options);
}
