import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NetdoctorPostPaymentFailureError,
  runPaidReportRequest,
} from '../src/paidReportFlow.js';

function createDeliveryResult(options = {}) {
  return {
    report: {
      findings: {
        verdict: { headline: options.verdict || 'Likely upstream/ISP' },
      },
    },
    delivery: {
      subject: 'e3d netdoctor report: Likely upstream/ISP (2026-07-03)',
      from: 'e3d netdoctor <support@e3d.ai>',
      includePdf: true,
      accepted: ['tester@example.com'],
      rejected: [],
      messageId: '<paid-flow@example.com>',
    },
  };
}

test('runPaidReportRequest pays before live capture and runs the full pipeline', async () => {
  const events = [];

  const result = await runPaidReportRequest({
    to: 'tester@example.com',
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
    orchestrateDelivery: async (parsed, { to, includePdf }) => {
      events.push(`deliver:${to}:${includePdf}:${parsed.diagnostics.packetCount}`);
      return createDeliveryResult();
    },
    interfaceName: 'en0',
    durationSeconds: 30,
  });

  assert.deepEqual(events, [
    'pay:netdoctor:req-live-success',
    'capture:en0:30',
    'deliver:tester@example.com:true:12',
  ]);
  assert.equal(result.payment.creditsSpent, 500);
  assert.equal(result.capture.interfaceName, 'en0');
  assert.equal(result.report.findings.verdict.headline, 'Likely upstream/ISP');
});

test('runPaidReportRequest does not parse, capture, or deliver after failed payment', async () => {
  const events = [];

  await assert.rejects(
    () => runPaidReportRequest({
      to: 'tester@example.com',
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
      orchestrateDelivery: async () => {
        events.push('deliver');
      },
      pcapPath: './fixtures/sample-syn.pcap',
    }),
    /payment rejected/,
  );

  assert.deepEqual(events, ['pay']);
});

test('runPaidReportRequest documents post-payment retry behavior on downstream failure', async () => {
  await assert.rejects(
    () => runPaidReportRequest({
      to: 'tester@example.com',
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
