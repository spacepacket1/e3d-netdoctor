import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NetdoctorPaymentRequiredError,
  ensurePaidNetdoctorReport,
} from '../src/paymentGate.js';

test('ensurePaidNetdoctorReport spends the configured report price before work begins', async () => {
  let spendCall = null;
  const payment = await ensurePaidNetdoctorReport({
    requestId: 'netdoctor:req-success',
    creditKey: 'e3d_netdoctor_pay_test',
    expectedCredits: 500,
    paymentClient: {
      async spendCredits(payload) {
        spendCall = payload;
        return {
          wallet: '0xabc',
          creditsSpent: 500,
          creditsRemaining: 1500,
        };
      },
    },
  });

  assert.equal(payment.ok, true);
  assert.equal(payment.creditsSpent, 500);
  assert.equal(payment.creditsRemaining, 1500);
  assert.equal(spendCall.product, 'netdoctor');
  assert.equal(spendCall.route, '/netdoctor/report');
  assert.equal(spendCall.requestId, 'netdoctor:req-success');
  assert.equal(spendCall.creditKey, 'e3d_netdoctor_pay_test');
});

test('ensurePaidNetdoctorReport fails closed when payment is missing or rejected', async () => {
  await assert.rejects(
    () => ensurePaidNetdoctorReport({
      requestId: 'netdoctor:req-fail',
      creditKey: 'e3d_netdoctor_pay_test',
      paymentClient: {
        async spendCredits() {
          const error = new Error('Payment required');
          error.status = 402;
          error.code = 'INSUFFICIENT_CREDITS';
          error.body = { purchasePath: 'POST /api/payments/credits/purchase' };
          throw error;
        },
      },
    }),
    (error) => {
      assert.equal(error instanceof NetdoctorPaymentRequiredError, true);
      assert.match(error.message, /Netdoctor payment failed/);
      assert.match(error.message, /Buy or replenish e3d credits/);
      return true;
    },
  );
});

test('ensurePaidNetdoctorReport rejects underpriced or free spends', async () => {
  await assert.rejects(
    () => ensurePaidNetdoctorReport({
      requestId: 'netdoctor:req-underpaid',
      creditKey: 'e3d_netdoctor_pay_test',
      expectedCredits: 500,
      paymentClient: {
        async spendCredits() {
          return { creditsSpent: 10, creditsRemaining: 990 };
        },
      },
    }),
    /expected 500 credits for a report, but the payment API spent 10/,
  );
});
