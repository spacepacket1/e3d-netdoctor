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

test('report writes a standalone HTML report file summary', async () => {
  const stdout = createWritableCapture();
  const stderr = createWritableCapture();
  let wroteFile = null;

  const exitCode = await runCli(['report', './fixtures/sample-syn.pcap', './tmp/netdoctor-report.html'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    checkTshark: async () => ({ installed: true, version: 'TShark 4.6.0', message: 'tshark detected' }),
    parseFile: async (filePath) => ({
      rows: [{ 'Client Addr': '192.168.0.1', 'Client Port': '40000', 'Server Addr': '93.184.216.34', 'Server Port': '443', 'Client Bytes': 1200, 'Server Bytes': 800, Packets: 10, Protocol: 'tcp' }],
      diagnostics: {
        filePath,
        packetCount: 10,
        conversationCount: 1,
        warnings: [],
        protocolBreakdown: [{ protocol: 'tcp', packets: 10, bytes: 2000 }],
        verdict: {
          verdict: 'Inconclusive',
          confidence: 'Low',
          rationale: 'Confidence: Low - sample traffic is too thin.',
        },
        tcpAnalysis: {
          retransmissions: 0,
          duplicateAcks: 0,
          outOfOrder: 0,
          rttMs: { count: 0, minMs: null, p50Ms: null, p95Ms: null, maxMs: null },
        },
      },
    }),
    buildReport: async () => ({
      findings: { verdict: { headline: 'Inconclusive', confidence: 'Low' } },
      narrative: { source: 'fallback' },
      html: '<!doctype html><html><body>report</body></html>',
    }),
    writeFile: async (filePath, html) => {
      wroteFile = { filePath, html };
    },
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.read(), /"outputPath":/);
  assert.match(stdout.read(), /"narrativeSource": "fallback"/);
  assert.equal(stderr.read(), '');
  assert.equal(wroteFile.filePath.endsWith('/tmp/netdoctor-report.html'), true);
  assert.match(wroteFile.html, /<!doctype html>/i);
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
