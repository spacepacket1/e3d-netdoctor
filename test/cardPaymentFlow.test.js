import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  pollForStripeSessionResult,
  resolveCreditKeyViaCard,
} from '../src/cardPaymentFlow.js';

test('pollForStripeSessionResult polls until completed', async () => {
  const responses = [{ status: 'pending' }, { status: 'pending' }, { status: 'completed', creditKey: 'k', issuedCredits: 500 }];
  const paymentClient = { getStripeSessionResult: async () => responses.shift() };
  const sleeps = [];

  const result = await pollForStripeSessionResult({
    paymentClient,
    sessionId: 'cs_1',
    sleep: async (ms) => { sleeps.push(ms); },
  });

  assert.deepEqual(result, { status: 'completed', creditKey: 'k', issuedCredits: 500 });
  assert.deepEqual(sleeps, [3000, 3000]);
});

test('pollForStripeSessionResult times out if it never completes', async () => {
  const paymentClient = { getStripeSessionResult: async () => ({ status: 'pending' }) };
  await assert.rejects(
    () => pollForStripeSessionResult({
      paymentClient,
      sessionId: 'cs_1',
      timeoutMs: 10,
      intervalMs: 5,
      sleep: async () => {},
    }),
    /Timed out after 10 ms/,
  );
});

test('pollForStripeSessionResult propagates errors from a failed/expired session', async () => {
  const paymentClient = {
    getStripeSessionResult: async () => {
      throw Object.assign(new Error('purchase_failed'), { status: 402, code: 'STRIPE_FULFILLMENT_FAILED' });
    },
  };
  await assert.rejects(
    () => pollForStripeSessionResult({ paymentClient, sessionId: 'cs_1', sleep: async () => {} }),
    /purchase_failed/,
  );
});

test('resolveCreditKeyViaCard creates a checkout session and polls for the credit key', async () => {
  const createCalls = [];
  const paymentClient = {
    createStripeCheckout: async (args) => {
      createCalls.push(args);
      return { sessionId: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' };
    },
    getStripeSessionResult: async () => ({ status: 'completed', creditKey: 'e3d_netdoctor_pay_card', issuedCredits: 500 }),
  };

  let announcedUrl = null;
  const result = await resolveCreditKeyViaCard({
    paymentClient,
    onPayUrl: (url) => { announcedUrl = url; },
    pollOptions: { sleep: async () => {} },
  });

  assert.equal(result.creditKey, 'e3d_netdoctor_pay_card');
  assert.equal(result.creditsRemaining, 500);
  assert.equal(result.source, 'purchased');
  assert.equal(announcedUrl, 'https://checkout.stripe.com/c/pay/cs_1');
  assert.equal(createCalls[0].product, 'netdoctor');
  assert.equal(createCalls[0].packId, 'single');
});

test('resolveCreditKeyViaCard forwards a custom packId', async () => {
  const createCalls = [];
  const paymentClient = {
    createStripeCheckout: async (args) => {
      createCalls.push(args);
      return { sessionId: 'cs_2', url: 'https://checkout.stripe.com/c/pay/cs_2' };
    },
    getStripeSessionResult: async () => ({ status: 'completed', creditKey: 'e3d_netdoctor_pay_five', issuedCredits: 2500 }),
  };

  await resolveCreditKeyViaCard({
    packId: 'five',
    paymentClient,
    pollOptions: { sleep: async () => {} },
  });

  assert.equal(createCalls[0].packId, 'five');
});
