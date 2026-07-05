import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TSHARK_INSTALL_HINT } from '../src/e3dPcap.js';
import { AUTHORIZED_USE_NOTICE, runCli } from '../src/cli.js';

function createWritableCapture() {
  let output = '';
  return {
    stream: {
      write(chunk) {
        output += chunk;
      },
    },
    read() {
      return output;
    },
  };
}

test('preflight reports tshark installed when check succeeds', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  const exitCode = await runCli(['preflight'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.read(), new RegExp(AUTHORIZED_USE_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(stdout.read(), /tshark status: installed/);
  assert.match(stdout.read(), /TShark 4\.6\.0/);
  assert.equal(stderr.read(), '');
});

test('preflight surfaces the existing install hint when tshark is missing', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  const exitCode = await runCli(['preflight'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: false, version: null, message: `tshark was not found. ${TSHARK_INSTALL_HINT}` }),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /tshark status: missing/);
  assert.match(stderr.read(), new RegExp(TSHARK_INSTALL_HINT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('smoke prints parsed rows and diagnostics', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  const exitCode = await runCli(['smoke', './fixtures/sample-syn.pcap'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    parseFile: async (filePath) => ({
      rows: [{ 'Client Addr': '192.168.0.1', 'Server Addr': '93.184.216.34', Packets: 1 }],
      diagnostics: { filePath, packetCount: 1, conversationCount: 1, warnings: [] },
    }),
  });

  assert.equal(exitCode, 0);
  const output = stdout.read();
  assert.match(output, /"rows"/);
  assert.match(output, /"diagnostics"/);
  assert.match(output, /"packetCount": 1/);
  assert.equal(stderr.read(), '');
});

test('capture prints parsed live-capture output and keeps the authorized-use notice visible', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  const exitCode = await runCli(['capture', 'en0', '45'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    captureLive: async ({ interfaceName, durationSeconds }) => ({
      capture: {
        interfaceName,
        durationSeconds,
        fileSizeBytes: 512,
      },
      parsed: {
        rows: [{ 'Client Addr': '192.168.0.10', 'Server Addr': '1.1.1.1', Packets: 4 }],
        diagnostics: { packetCount: 4, conversationCount: 1, warnings: [] },
      },
    }),
  });

  assert.equal(exitCode, 0);
  const output = stdout.read();
  assert.match(output, new RegExp(AUTHORIZED_USE_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(output, /Starting live capture/);
  assert.match(output, /"interfaceName": "en0"/);
  assert.match(output, /"durationSeconds": 45/);
  assert.match(output, /"packetCount": 4/);
  assert.equal(stderr.read(), '');
});

test('capture rejects invalid duration arguments', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  const exitCode = await runCli(['capture', 'en0', '0'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /capture duration must be a positive whole number of seconds/);
});

function parseTrailingJson(output) {
  return JSON.parse(output.slice(output.indexOf('{')));
}

function createReportFixtureDeps(overrides = {}) {
  return {
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    parseFile: async (filePath) => ({
      rows: [],
      diagnostics: { filePath, packetCount: 10, conversationCount: 1, warnings: [] },
    }),
    buildReport: async () => ({
      findings: { verdict: { headline: 'Inconclusive', confidence: 'Low' } },
      narrative: { source: 'fallback' },
      html: '<!doctype html><html><body>report</body></html>',
      markdown: '# Inconclusive\n\nsample markdown report',
    }),
    ...overrides,
  };
}

test('report defaults to printing {findings, narrative} JSON to stdout', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli(['report', './fixtures/sample-syn.pcap'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...createReportFixtureDeps(),
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.read(), '');
  const parsed = parseTrailingJson(stdout.read());
  assert.equal(parsed.findings.verdict.headline, 'Inconclusive');
  assert.equal(parsed.narrative.source, 'fallback');
});

test('report --format markdown prints the raw markdown to stdout', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli(['report', './fixtures/sample-syn.pcap', '--format', 'markdown'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...createReportFixtureDeps(),
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.read(), '');
  assert.match(stdout.read(), /# Inconclusive\n\nsample markdown report/);
});

test('report --format html prints the raw HTML to stdout', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli(['report', './fixtures/sample-syn.pcap', '--format', 'html'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...createReportFixtureDeps(),
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.read(), /<!doctype html>/i);
});

test('report rejects an unknown --format value', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli(['report', './fixtures/sample-syn.pcap', '--format', 'yaml'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...createReportFixtureDeps(),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /--format must be one of: json, markdown, html/);
});

test('report --speed-test passes speedTest: true through to buildReport, off by default', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let capturedOptions = null;

  const withoutFlag = await runCli(['report', './fixtures/sample-syn.pcap'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...createReportFixtureDeps({
      buildReport: async (parsed, options) => {
        capturedOptions = options;
        return {
          findings: { verdict: { headline: 'Inconclusive', confidence: 'Low' } },
          narrative: { source: 'fallback' },
          html: '<!doctype html><html><body>report</body></html>',
          markdown: '# Inconclusive\n\nsample markdown report',
        };
      },
    }),
  });
  assert.equal(withoutFlag, 0);
  assert.equal(capturedOptions.speedTest, undefined);

  const withFlag = await runCli(['report', './fixtures/sample-syn.pcap', '--speed-test'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...createReportFixtureDeps({
      buildReport: async (parsed, options) => {
        capturedOptions = options;
        return {
          findings: { verdict: { headline: 'Inconclusive', confidence: 'Low' } },
          narrative: { source: 'fallback' },
          html: '<!doctype html><html><body>report</body></html>',
          markdown: '# Inconclusive\n\nsample markdown report',
        };
      },
    }),
  });
  assert.equal(withFlag, 0);
  assert.equal(capturedOptions.speedTest, true);
});

test('report --output writes the selected format to a file and prints a JSON summary', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let wroteFile = null;

  const exitCode = await runCli(['report', './fixtures/sample-syn.pcap', '--format', 'html', '--output', './tmp/netdoctor-report.html'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...createReportFixtureDeps({
      writeFile: async (filePath, content) => {
        wroteFile = { filePath, content };
      },
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.read(), '');
  const summary = parseTrailingJson(stdout.read());
  assert.match(summary.outputPath, /netdoctor-report\.html$/);
  assert.equal(summary.narrativeSource, 'fallback');
  assert.equal(summary.verdict, 'Inconclusive');
  assert.equal(wroteFile.filePath.endsWith('/tmp/netdoctor-report.html'), true);
  assert.match(wroteFile.content, /<!doctype html>/i);
});

test('report --to delivers by email and prints a JSON summary with delivery info', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let deliverCall = null;

  const exitCode = await runCli(['report', './fixtures/sample-syn.pcap', '--to', 'tester@example.com', '--pdf'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...createReportFixtureDeps({
      deliverEmail: async (options) => {
        deliverCall = options;
        return {
          subject: 'e3d netdoctor report: Inconclusive (2026-07-05)',
          from: 'e3d netdoctor <support@e3d.ai>',
          includePdf: true,
          accepted: ['tester@example.com'],
          rejected: [],
          messageId: '<report-cli@example.com>',
        };
      },
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.read(), '');
  assert.equal(deliverCall.to, 'tester@example.com');
  assert.equal(deliverCall.includePdf, true);
  const summary = parseTrailingJson(stdout.read());
  assert.equal(summary.recipient, 'tester@example.com');
  assert.equal(summary.messageId, '<report-cli@example.com>');
  assert.equal(summary.outputPath, null);
});

test('report --output and --to can combine in one run', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let wroteFile = null;
  let deliverCall = null;

  const exitCode = await runCli(['report', './fixtures/sample-syn.pcap', '--output', './tmp/netdoctor-report.json', '--to', 'tester@example.com'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...createReportFixtureDeps({
      writeFile: async (filePath, content) => {
        wroteFile = { filePath, content };
      },
      deliverEmail: async (options) => {
        deliverCall = options;
        return {
          subject: 'subject', from: 'from', includePdf: false,
          accepted: ['tester@example.com'], rejected: [], messageId: '<combo@example.com>',
        };
      },
    }),
  });

  assert.equal(exitCode, 0);
  assert.ok(wroteFile);
  assert.ok(deliverCall);
  const summary = parseTrailingJson(stdout.read());
  assert.match(summary.outputPath, /netdoctor-report\.json$/);
  assert.equal(summary.messageId, '<combo@example.com>');
});

test('deliver orchestrates report email delivery and surfaces sender metadata', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli(['deliver', './fixtures/sample-syn.pcap', 'tester@example.com', '--pdf'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    parseFile: async (filePath) => ({
      rows: [],
      diagnostics: {
        filePath,
        packetCount: 4,
        conversationCount: 1,
        warnings: [],
      },
    }),
    orchestrateDelivery: async (_parsed, options) => ({
      report: {
        findings: {
          verdict: { headline: 'Likely upstream/ISP' },
        },
      },
      delivery: {
        subject: 'e3d netdoctor report: Likely upstream/ISP (2026-07-03)',
        from: 'e3d netdoctor <support@e3d.ai>',
        includePdf: options.includePdf,
        accepted: [options.to],
        rejected: [],
        messageId: '<msg-123@example.com>',
      },
    }),
  });

  assert.equal(exitCode, 0);
  const output = stdout.read();
  assert.match(output, /"recipient": "tester@example\.com"/);
  assert.match(output, /"verdict": "Likely upstream\/ISP"/);
  assert.match(output, /"includePdf": true/);
  assert.match(output, /"from": "e3d netdoctor <support@e3d\.ai>"/);
  assert.equal(stderr.read(), '');
});

test('paid-report requests payment before the end-to-end report flow', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli([
    'paid-report',
    'tester@example.com',
    '--interface',
    'en0',
    '--duration',
    '30',
    '--pdf',
    '--request-id',
    'netdoctor:req-cli',
  ], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    paidReportRequest: async (options) => ({
      requestId: options.requestId,
      payment: {
        product: 'netdoctor',
        route: '/netdoctor/report',
        creditsSpent: 500,
        creditsRemaining: 1000,
      },
      capture: {
        interfaceName: options.interfaceName,
        durationSeconds: options.durationSeconds,
      },
      report: {
        findings: {
          verdict: { headline: 'Likely local' },
        },
      },
      delivery: {
        subject: 'e3d netdoctor report: Likely local (2026-07-03)',
        from: 'e3d netdoctor <support@e3d.ai>',
        includePdf: options.includePdf,
        accepted: [options.to],
        rejected: [],
        messageId: '<paid-cli@example.com>',
      },
    }),
  });

  assert.equal(exitCode, 0);
  const output = stdout.read();
  assert.match(output, /Requesting e3d payment before capture\/analysis/);
  assert.match(output, /"requestId": "netdoctor:req-cli"/);
  assert.match(output, /"creditsSpent": 500/);
  assert.match(output, /"interfaceName": "en0"/);
  assert.match(output, /"verdict": "Likely local"/);
  assert.equal(stderr.read(), '');
});

test('paid-report --wallet triggers the wallet flow, prints the pay URL, and reports success', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let receivedOptions = null;

  const exitCode = await runCli([
    'paid-report',
    'tester@example.com',
    '--pcap',
    './fixtures/sample-syn.pcap',
    '--wallet',
    '0xABCDEF0000000000000000000000000000000001',
    '--credits',
    '2000',
  ], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    paidReportRequest: async (options) => {
      receivedOptions = options;
      options.onPayUrl('https://e3d.ai/pay?session=abc123');
      return {
        requestId: 'netdoctor:req-wallet',
        payment: { product: 'netdoctor', route: '/netdoctor/report', creditsSpent: 500, creditsRemaining: 1500 },
        capture: null,
        report: { findings: { verdict: { headline: 'Likely local' } } },
        delivery: {
          subject: 'e3d netdoctor report: Likely local (2026-07-04)',
          from: 'e3d netdoctor <support@e3d.ai>',
          includePdf: false,
          accepted: [options.to],
          rejected: [],
          messageId: '<paid-wallet@example.com>',
        },
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(receivedOptions.wallet, '0xABCDEF0000000000000000000000000000000001');
  assert.equal(receivedOptions.credits, 2000);
  const output = stdout.read();
  assert.match(output, /Buying 2000 e3d credits with wallet 0xABCDEF0000000000000000000000000000000001/);
  assert.match(output, /https:\/\/e3d\.ai\/pay\?session=abc123/);
  assert.match(output, /Waiting for payment to complete/);
  assert.equal(stderr.read(), '');
});

test('paid-report --wallet without --credits announces one-off payment', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli([
    'paid-report',
    'tester@example.com',
    '--pcap',
    './fixtures/sample-syn.pcap',
    '--wallet',
    '0xABCDEF0000000000000000000000000000000001',
  ], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    paidReportRequest: async (options) => ({
      requestId: 'netdoctor:req-oneoff',
      payment: { product: 'netdoctor', route: '/netdoctor/report', creditsSpent: 500, creditsRemaining: 0 },
      capture: null,
      report: { findings: { verdict: { headline: 'Inconclusive' } } },
      delivery: {
        subject: 'e3d netdoctor report: Inconclusive (2026-07-04)',
        from: 'e3d netdoctor <support@e3d.ai>',
        includePdf: false,
        accepted: [options.to],
        rejected: [],
        messageId: '<paid-oneoff@example.com>',
      },
    }),
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.read(), /Paying for this one report with a connected wallet/);
});

test('paid-report --credits without --wallet is rejected', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli([
    'paid-report',
    'tester@example.com',
    '--credits',
    '2000',
  ], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /--credits requires --wallet/);
});
