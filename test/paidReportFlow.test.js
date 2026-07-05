import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NetdoctorPostPaymentFailureError,
  runPaidReportRequest,
} from '../src/paidReportFlow.js';

function createFakeReport(options = {}) {
  return {
    findings: {
      verdict: { headline: options.verdict || 'Likely upstream/ISP', confidence: 'High' },
    },
    narrative: { source: 'fallback' },
    html: '<!doctype html><html><body>report</body></html>',
    markdown: '# report',
  };
}

test('runPaidReportRequest pays before live capture and builds the report', async () => {
  const events = [];

  const result = await runPaidReportRequest({
    includePdf: true,
    requestId: 'netdoctor:req-live-success',
    ensurePayment: async ({ requestId }) => {
      events.push(`pay:${requestId}`);
      return {
        ok: true,
        requestId,
        product: 'netdoctor',
        route: '/netdoctor/report',
        creditsSpent: 500,
        creditsRemaining: 500,
      };
    },
    captureLive: async ({ interfaceName, durationSeconds }) => {
      events.push(`capture:${interfaceName}:${durationSeconds}`);
      return {
        capture: { interfaceName, durationSeconds, fileSizeBytes: 1024 },
        parsed: {
          rows: [{ 'Client Addr': '192.168.1.10', 'Server Addr': '1.1.1.1' }],
          diagnostics: { packetCount: 12, conversationCount: 1, warnings: [] },
        },
      };
    },
    buildReport: async (parsed) => {
      events.push(`build:${parsed.diagnostics.packetCount}`);
      return createFakeReport();
    },
    interfaceName: 'en0',
    durationSeconds: 30,
  });

  assert.deepEqual(events, [
    'pay:netdoctor:req-live-success',
    'capture:en0:30',
    'build:12',
  ]);
  assert.equal(result.payment.creditsSpent, 500);
  assert.equal(result.capture.interfaceName, 'en0');
  assert.equal(result.report.findings.verdict.headline, 'Likely upstream/ISP');
  assert.equal(result.delivery, undefined);
});

test('runPaidReportRequest with redact: true anonymizes local identifiers and strips the file path before buildReport', async () => {
  let capturedParsed = null;

  await runPaidReportRequest({
    requestId: 'netdoctor:req-redact',
    redact: true,
    ensurePayment: async ({ requestId }) => ({ ok: true, requestId, product: 'netdoctor', route: '/netdoctor/report', creditsSpent: 500, creditsRemaining: 500 }),
    pcapPath: './fixtures/sample-syn.pcap',
    parseFile: async (filePath) => ({
      rows: [{ 'Client Addr': '192.168.1.10', 'Client MAC': 'aa:aa:aa:aa:aa:aa', 'Server Addr': '93.184.216.34', 'Server MAC': 'bb:bb:bb:bb:bb:bb' }],
      diagnostics: { filePath, packetCount: 1, conversationCount: 1, warnings: [] },
    }),
    buildReport: async (parsed) => {
      capturedParsed = parsed;
      return createFakeReport();
    },
  });

  assert.equal(capturedParsed.rows[0]['Client Addr'], 'local-device-1');
  assert.equal(capturedParsed.rows[0]['Client MAC'], 'local-mac-1');
  assert.equal(capturedParsed.rows[0]['Server Addr'], '93.184.216.34');
  assert.equal(capturedParsed.diagnostics.filePath, null);
});

test('runPaidReportRequest without redact leaves rows and the file path untouched', async () => {
  let capturedParsed = null;

  await runPaidReportRequest({
    requestId: 'netdoctor:req-no-redact',
    ensurePayment: async ({ requestId }) => ({ ok: true, requestId, product: 'netdoctor', route: '/netdoctor/report', creditsSpent: 500, creditsRemaining: 500 }),
    pcapPath: './fixtures/sample-syn.pcap',
    parseFile: async (filePath) => ({
      rows: [{ 'Client Addr': '192.168.1.10', 'Client MAC': 'aa:aa:aa:aa:aa:aa', 'Server Addr': '93.184.216.34' }],
      diagnostics: { filePath, packetCount: 1, conversationCount: 1, warnings: [] },
    }),
    buildReport: async (parsed) => {
      capturedParsed = parsed;
      return createFakeReport();
    },
  });

  assert.equal(capturedParsed.rows[0]['Client Addr'], '192.168.1.10');
  assert.match(capturedParsed.diagnostics.filePath, /sample-syn\.pcap$/);
});

test('runPaidReportRequest does not parse, capture, or build after failed payment', async () => {
  const events = [];

  await assert.rejects(
    () => runPaidReportRequest({
      requestId: 'netdoctor:req-payment-fail',
      ensurePayment: async () => {
        events.push('pay');
        throw new Error('payment rejected');
      },
      parseFile: async () => {
        events.push('parse');
      },
      captureLive: async () => {
        events.push('capture');
      },
      buildReport: async () => {
        events.push('build');
      },
      pcapPath: './fixtures/sample-syn.pcap',
    }),
    /payment rejected/,
  );

  assert.deepEqual(events, ['pay']);
});

test('runPaidReportRequest resolves a credit key via wallet before paying, in one-off mode with no persisted record', async () => {
  const events = [];

  const result = await runPaidReportRequest({
    requestId: 'netdoctor:req-wallet-oneoff',
    wallet: '0xWallet',
    resolveCreditKeyViaWallet: async ({ wallet, oneOff, paymentClient }) => {
      events.push(`resolve:${wallet}:${oneOff}:${typeof paymentClient}`);
      return { creditKey: 'e3d_netdoctor_pay_wallet', source: 'purchased', creditsRemaining: 0 };
    },
    ensurePayment: async ({ creditKey }) => {
      events.push(`pay:${creditKey}`);
      return { ok: true, requestId: 'netdoctor:req-wallet-oneoff', product: 'netdoctor', route: '/netdoctor/report', creditsSpent: 500, creditsRemaining: 0 };
    },
    recordWalletSpend: () => {
      events.push('recordSpend');
    },
    captureLive: async () => ({ capture: {}, parsed: { rows: [], diagnostics: { packetCount: 0, conversationCount: 0, warnings: [] } } }),
    buildReport: async () => createFakeReport(),
  });

  assert.deepEqual(events, [
    'resolve:0xWallet:true:object',
    'pay:e3d_netdoctor_pay_wallet',
  ]);
  assert.equal(result.payment.creditsSpent, 500);
});

test('runPaidReportRequest forwards options.paymentMethod to resolveCreditKeyViaWallet', async () => {
  const events = [];

  await runPaidReportRequest({
    requestId: 'netdoctor:req-wallet-payment-method',
    wallet: '0xWallet',
    paymentMethod: 'ethereum',
    resolveCreditKeyViaWallet: async ({ paymentMethod }) => {
      events.push(`resolve:${paymentMethod}`);
      return { creditKey: 'e3d_netdoctor_pay_eth', source: 'purchased', creditsRemaining: 0 };
    },
    ensurePayment: async () => ({ ok: true, requestId: 'netdoctor:req-wallet-payment-method', product: 'netdoctor', route: '/netdoctor/report', creditsSpent: 500, creditsRemaining: 0 }),
    captureLive: async () => ({ capture: {}, parsed: { rows: [], diagnostics: { packetCount: 0, conversationCount: 0, warnings: [] } } }),
    buildReport: async () => createFakeReport(),
  });

  assert.deepEqual(events, ['resolve:ethereum']);
});

test('runPaidReportRequest treats --wallet with --credits as batch mode and records the post-spend balance', async () => {
  const events = [];

  await runPaidReportRequest({
    requestId: 'netdoctor:req-wallet-batch',
    wallet: '0xWallet',
    credits: 2000,
    resolveCreditKeyViaWallet: async ({ oneOff, credits }) => {
      events.push(`resolve:${oneOff}:${credits}`);
      return { creditKey: 'e3d_netdoctor_pay_batch', source: 'purchased', creditsRemaining: 2000 };
    },
    ensurePayment: async () => ({ ok: true, requestId: 'netdoctor:req-wallet-batch', product: 'netdoctor', route: '/netdoctor/report', creditsSpent: 500, creditsRemaining: 1500 }),
    recordWalletSpend: ({ wallet, creditsRemaining }) => {
      events.push(`recordSpend:${wallet}:${creditsRemaining}`);
    },
    captureLive: async () => ({ capture: {}, parsed: { rows: [], diagnostics: { packetCount: 0, conversationCount: 0, warnings: [] } } }),
    buildReport: async () => createFakeReport(),
  });

  assert.deepEqual(events, [
    'resolve:false:2000',
    'recordSpend:0xWallet:1500',
  ]);
});

test('runPaidReportRequest does not record wallet spend in one-off mode', async () => {
  let recordSpendCalled = false;

  await runPaidReportRequest({
    requestId: 'netdoctor:req-wallet-oneoff-2',
    wallet: '0xWallet',
    resolveCreditKeyViaWallet: async () => ({ creditKey: 'e3d_netdoctor_pay_wallet', source: 'purchased', creditsRemaining: 0 }),
    ensurePayment: async () => ({ ok: true, requestId: 'netdoctor:req-wallet-oneoff-2', product: 'netdoctor', route: '/netdoctor/report', creditsSpent: 500, creditsRemaining: 0 }),
    recordWalletSpend: () => {
      recordSpendCalled = true;
    },
    captureLive: async () => ({ capture: {}, parsed: { rows: [], diagnostics: { packetCount: 0, conversationCount: 0, warnings: [] } } }),
    buildReport: async () => createFakeReport(),
  });

  assert.equal(recordSpendCalled, false);
});

test('runPaidReportRequest documents post-payment retry behavior on downstream failure', async () => {
  await assert.rejects(
    () => runPaidReportRequest({
      requestId: 'netdoctor:req-capture-fail',
      ensurePayment: async ({ requestId }) => ({
        ok: true,
        requestId,
        product: 'netdoctor',
        route: '/netdoctor/report',
        creditsSpent: 500,
        creditsRemaining: 500,
      }),
      captureLive: async () => {
        throw new Error('capture permission denied');
      },
    }),
    (error) => {
      assert.equal(error instanceof NetdoctorPostPaymentFailureError, true);
      assert.match(error.message, /failed after payment/);
      assert.match(error.message, /No automatic refund or credit is issued in v1/);
      assert.match(error.message, /retry with the same request ID/);
      return true;
    },
  );
});
