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

test('report --redact anonymizes local identifiers and strips the capture file path before buildReport', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let capturedParsed = null;

  const exitCode = await runCli(['report', './fixtures/sample-syn.pcap', '--redact'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...createReportFixtureDeps({
      parseFile: async (filePath) => ({
        rows: [{ 'Client Addr': '192.168.1.10', 'Client MAC': 'aa:aa:aa:aa:aa:aa', 'Server Addr': '93.184.216.34', 'Server MAC': 'bb:bb:bb:bb:bb:bb' }],
        diagnostics: { filePath, packetCount: 1, conversationCount: 1, warnings: [] },
      }),
      buildReport: async (parsed) => {
        capturedParsed = parsed;
        return {
          findings: { verdict: { headline: 'Inconclusive', confidence: 'Low' } },
          narrative: { source: 'fallback' },
          html: '<!doctype html><html><body>report</body></html>',
          markdown: '# Inconclusive\n\nsample markdown report',
        };
      },
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(capturedParsed.rows[0]['Client Addr'], 'local-device-1');
  assert.equal(capturedParsed.rows[0]['Client MAC'], 'local-mac-1');
  assert.equal(capturedParsed.rows[0]['Server Addr'], '93.184.216.34');
  assert.equal(capturedParsed.diagnostics.filePath, null);
  assert.equal(stderr.read(), '');
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

function createPaidReportFixture(overrides = {}) {
  const requestId = overrides.requestId || 'netdoctor:req-cli';
  return {
    requestId,
    payment: {
      requestId,
      product: 'netdoctor',
      route: '/netdoctor/report',
      creditsSpent: 500,
      creditsRemaining: 1000,
      ...overrides.payment,
    },
    capture: overrides.capture !== undefined ? overrides.capture : null,
    report: {
      findings: { verdict: { headline: 'Likely local', confidence: 'High' } },
      narrative: { source: 'fallback' },
      html: '<!doctype html><html><body>report</body></html>',
      markdown: '# Likely local\n\nsample markdown report',
      ...overrides.report,
    },
  };
}

test('paid-report defaults to printing payment receipt + findings/narrative JSON to stdout', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli([
    'paid-report',
    '--interface',
    'en0',
    '--duration',
    '30',
    '--request-id',
    'netdoctor:req-cli',
  ], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    paidReportRequest: async (options) => createPaidReportFixture({
      requestId: options.requestId,
      capture: { interfaceName: options.interfaceName, durationSeconds: options.durationSeconds },
    }),
  });

  assert.equal(exitCode, 0);
  const output = stdout.read();
  assert.match(output, /Requesting e3d payment before capture\/analysis/);
  const parsed = JSON.parse(output.slice(output.indexOf('{')));
  assert.equal(parsed.requestId, 'netdoctor:req-cli');
  assert.equal(parsed.payment.creditsSpent, 500);
  assert.equal(parsed.capture.interfaceName, 'en0');
  assert.equal(parsed.findings.verdict.headline, 'Likely local');
  assert.equal(stderr.read(), '');
});

test('paid-report --format markdown prints the raw markdown to stdout', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli(['paid-report', '--pcap', './fixtures/sample-syn.pcap', '--format', 'markdown'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    paidReportRequest: async () => createPaidReportFixture(),
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.read(), /# Likely local\n\nsample markdown report/);
  assert.equal(stderr.read(), '');
});

test('paid-report --output writes the selected format to a file and prints a JSON summary', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let wroteFile = null;

  const exitCode = await runCli(['paid-report', '--pcap', './fixtures/sample-syn.pcap', '--format', 'html', '--output', './tmp/paid-report.html'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    paidReportRequest: async () => createPaidReportFixture(),
    writeFile: async (filePath, content) => {
      wroteFile = { filePath, content };
    },
  });

  assert.equal(exitCode, 0);
  const output = stdout.read();
  const summary = JSON.parse(output.slice(output.indexOf('{')));
  assert.match(summary.outputPath, /paid-report\.html$/);
  assert.equal(summary.verdict, 'Likely local');
  assert.match(wroteFile.content, /<!doctype html>/i);
  assert.equal(stderr.read(), '');
});

test('paid-report --to delivers by email and prints a JSON summary with delivery info', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let deliverCall = null;

  const exitCode = await runCli(['paid-report', '--pcap', './fixtures/sample-syn.pcap', '--to', 'tester@example.com', '--pdf'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    paidReportRequest: async () => createPaidReportFixture(),
    deliverEmail: async (options) => {
      deliverCall = options;
      return {
        subject: 'e3d netdoctor report: Likely local (2026-07-04)',
        from: 'e3d netdoctor <support@e3d.ai>',
        includePdf: true,
        accepted: ['tester@example.com'],
        rejected: [],
        messageId: '<paid-cli-email@example.com>',
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(deliverCall.to, 'tester@example.com');
  assert.equal(deliverCall.includePdf, true);
  const output = stdout.read();
  const summary = JSON.parse(output.slice(output.indexOf('{')));
  assert.equal(summary.recipient, 'tester@example.com');
  assert.equal(summary.messageId, '<paid-cli-email@example.com>');
  assert.equal(stderr.read(), '');
});

test('paid-report reports a post-payment failure with the same "no automatic refund" messaging when delivery fails', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli(['paid-report', '--pcap', './fixtures/sample-syn.pcap', '--to', 'tester@example.com'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    paidReportRequest: async () => createPaidReportFixture({ requestId: 'netdoctor:req-delivery-fail' }),
    deliverEmail: async () => {
      throw new Error('Missing SMTP password for netdoctor delivery');
    },
  });

  assert.equal(exitCode, 1);
  const errorOutput = stderr.read();
  assert.match(errorOutput, /failed after payment for request netdoctor:req-delivery-fail/);
  assert.match(errorOutput, /No automatic refund or credit is issued in v1/);
  assert.match(errorOutput, /retry with the same request ID/);
});

test('paid-report --wallet triggers the wallet flow, prints the pay URL, and reports success', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let receivedOptions = null;

  const exitCode = await runCli([
    'paid-report',
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
      return createPaidReportFixture({ requestId: 'netdoctor:req-wallet', payment: { creditsRemaining: 1500 } });
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(receivedOptions.wallet, '0xABCDEF0000000000000000000000000000000001');
  assert.equal(receivedOptions.credits, 2000);
  assert.equal(receivedOptions.paymentMethod, 'ethereum');
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
    '--pcap',
    './fixtures/sample-syn.pcap',
    '--wallet',
    '0xABCDEF0000000000000000000000000000000001',
  ], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    paidReportRequest: async () => createPaidReportFixture({ requestId: 'netdoctor:req-oneoff', payment: { creditsRemaining: 0 } }),
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.read(), /Paying for this one report with a connected wallet/);
});

test('paid-report --redact forwards redact: true through to paidReportRequest, off by default', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let capturedOptions = null;

  const withoutFlag = await runCli(['paid-report', '--pcap', './fixtures/sample-syn.pcap'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    paidReportRequest: async (options) => {
      capturedOptions = options;
      return createPaidReportFixture();
    },
  });
  assert.equal(withoutFlag, 0);
  assert.equal(capturedOptions.redact, false);

  const withFlag = await runCli(['paid-report', '--pcap', './fixtures/sample-syn.pcap', '--redact'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    paidReportRequest: async (options) => {
      capturedOptions = options;
      return createPaidReportFixture();
    },
  });
  assert.equal(withFlag, 0);
  assert.equal(capturedOptions.redact, true);
});

test('paid-report --credits without --wallet is rejected', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli([
    'paid-report',
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

test('paid-report --payment-method without --wallet is rejected', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli([
    'paid-report',
    '--payment-method',
    'base',
  ], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /--payment-method requires --wallet/);
});

test('paid-report --wallet --payment-method base is accepted and overrides the default', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let receivedOptions = null;

  const exitCode = await runCli([
    'paid-report',
    '--pcap',
    './fixtures/sample-syn.pcap',
    '--wallet',
    '0xABCDEF0000000000000000000000000000000001',
    '--payment-method',
    'base',
  ], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    paidReportRequest: async (options) => {
      receivedOptions = options;
      options.onPayUrl('https://e3d.ai/pay?session=abc456');
      return createPaidReportFixture({ requestId: 'netdoctor:req-wallet-base', payment: { creditsRemaining: 0 } });
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(receivedOptions.paymentMethod, 'base');
  assert.equal(stderr.read(), '');
});

test('paid-report --wallet --payment-method rejects an unsupported value', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli([
    'paid-report',
    '--wallet',
    '0xABCDEF0000000000000000000000000000000001',
    '--payment-method',
    'solana',
  ], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /--payment-method must be one of: ethereum, base/);
});

function createMintReportFixture(overrides = {}) {
  return JSON.stringify({
    redacted: true,
    findings: { verdict: { headline: 'Likely local', confidence: 'High' } },
    narrative: { source: 'fallback' },
    ...overrides,
  });
}

test('mint rejects a report that was not generated with --redact', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli(['mint', './tmp/report.json', '--wallet', '0xABCDEF0000000000000000000000000000000001', '--confirm-public'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    readFile: async () => createMintReportFixture({ redacted: false }),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /wasn't generated with --redact/);
});

test('mint rejects when --confirm-public is missing', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli(['mint', './tmp/report.json', '--wallet', '0xABCDEF0000000000000000000000000000000001'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    readFile: async () => createMintReportFixture(),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /requires --confirm-public/);
});

test('mint rejects when --wallet is missing', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli(['mint', './tmp/report.json', '--confirm-public'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    readFile: async () => createMintReportFixture(),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /requires --wallet/);
});

test('mint requires a report file path', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();

  const exitCode = await runCli(['mint'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /mint requires a report JSON file path/);
});

test('mint reads a redacted report, mints via wallet, and prints the mint result', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let capturedArgs = null;
  let capturedPath = null;

  const exitCode = await runCli(['mint', './tmp/report.json', '--wallet', '0xABCDEF0000000000000000000000000000000001', '--confirm-public'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    readFile: async (filePath) => {
      capturedPath = filePath;
      return createMintReportFixture();
    },
    mintReportViaWallet: async (args) => {
      capturedArgs = args;
      args.onMintUrl('https://e3d.ai/mint?session=sess-1');
      return { tokenId: 42, txHash: '0xabc' };
    },
  });

  assert.equal(exitCode, 0);
  assert.match(capturedPath, /report\.json$/);
  assert.equal(capturedArgs.wallet, '0xABCDEF0000000000000000000000000000000001');
  assert.equal(capturedArgs.findings.verdict.headline, 'Likely local');
  assert.match(capturedArgs.name, /Likely local/);
  const output = stdout.read();
  assert.match(output, /https:\/\/e3d\.ai\/mint\?session=sess-1/);
  assert.match(output, /Waiting for mint to complete/);
  const summary = JSON.parse(output.slice(output.indexOf('{')));
  assert.equal(summary.tokenId, 42);
  assert.equal(summary.txHash, '0xabc');
  assert.equal(summary.etherscanUrl, 'https://etherscan.io/tx/0xabc');
  assert.equal(stderr.read(), '');
});
