import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPaymentPageUrl,
  pollForSessionResult,
  resolveCreditKeyViaWallet,
} from '../src/walletPaymentFlow.js';

function createFakeWalletCredentials(initial = {}) {
  const store = { ...initial };
  return {
    store,
    load: (wallet) => store[wallet.toLowerCase()] || null,
    save: (wallet, record) => {
      store[wallet.toLowerCase()] = { ...store[wallet.toLowerCase()], ...record };
      return store[wallet.toLowerCase()];
    },
  };
}

test('buildPaymentPageUrl builds a /pay URL with the session id', () => {
  const url = buildPaymentPageUrl({ sessionId: 'abc123' });
  assert.equal(url, 'https://e3d.ai/pay?session=abc123');
});

test('buildPaymentPageUrl respects a custom base URL', () => {
  const url = buildPaymentPageUrl({ baseUrl: 'https://staging.example.com', sessionId: 'abc123' });
  assert.equal(url, 'https://staging.example.com/pay?session=abc123');
});

test('buildPaymentPageUrl requires a session id', () => {
  assert.throws(() => buildPaymentPageUrl({}), /requires sessionId/);
});

test('pollForSessionResult polls until completed', async () => {
  const responses = [{ status: 'pending' }, { status: 'pending' }, { status: 'completed', creditKey: 'k', issuedCredits: 500 }];
  const paymentClient = { getSessionResult: async () => responses.shift() };
  const sleeps = [];

  const result = await pollForSessionResult({
    paymentClient,
    sessionId: 'sess-1',
    sleep: async (ms) => { sleeps.push(ms); },
  });

  assert.deepEqual(result, { status: 'completed', creditKey: 'k', issuedCredits: 500 });
  assert.deepEqual(sleeps, [3000, 3000]);
});

test('pollForSessionResult throws when the session expires', async () => {
  const paymentClient = { getSessionResult: async () => ({ status: 'expired' }) };
  await assert.rejects(
    () => pollForSessionResult({ paymentClient, sessionId: 'sess-1', sleep: async () => {} }),
    /Payment session expired/,
  );
});

test('pollForSessionResult times out if it never completes', async () => {
  let now = 0;
  const paymentClient = { getSessionResult: async () => ({ status: 'pending' }) };
  await assert.rejects(
    () => pollForSessionResult({
      paymentClient,
      sessionId: 'sess-1',
      timeoutMs: 10,
      intervalMs: 5,
      sleep: async () => { now += 20; },
    }),
    /Timed out after 10 ms/,
  );
});

test('resolveCreditKeyViaWallet in one-off mode requests exactly one report worth and never persists', async () => {
  const walletCredentials = createFakeWalletCredentials();
  const createSessionCalls = [];
  const paymentClient = {
    createPaymentSession: async (args) => {
      createSessionCalls.push(args);
      return { sessionId: 'sess-1', quote: { requiredAmount: '0.5' } };
    },
    getSessionResult: async () => ({ status: 'completed', creditKey: 'e3d_netdoctor_pay_oneoff', issuedCredits: 500 }),
  };

  const result = await resolveCreditKeyViaWallet({
    wallet: '0xABC',
    credits: 2000, // should be ignored in one-off mode
    oneOff: true,
    paymentClient,
    walletCredentials,
    pollOptions: { sleep: async () => {} },
  });

  assert.equal(result.creditKey, 'e3d_netdoctor_pay_oneoff');
  assert.equal(result.source, 'purchased');
  assert.equal(createSessionCalls[0].requestedIssuedCredits, 500);
  assert.equal(walletCredentials.load('0xABC'), null);
});

test('resolveCreditKeyViaWallet in batch mode purchases and persists the key', async () => {
  const walletCredentials = createFakeWalletCredentials();
  const paymentClient = {
    createPaymentSession: async (args) => ({ sessionId: 'sess-2', quote: { requiredAmount: '2' } , args }),
    getSessionResult: async () => ({ status: 'completed', creditKey: 'e3d_netdoctor_pay_batch', issuedCredits: 2000 }),
  };

  let announcedUrl = null;
  const result = await resolveCreditKeyViaWallet({
    wallet: '0xDEF',
    credits: 2000,
    oneOff: false,
    paymentClient,
    walletCredentials,
    onPayUrl: (url) => { announcedUrl = url; },
    pollOptions: { sleep: async () => {} },
  });

  assert.equal(result.creditKey, 'e3d_netdoctor_pay_batch');
  assert.equal(result.creditsRemaining, 2000);
  assert.match(announcedUrl, /^https:\/\/e3d\.ai\/pay\?session=sess-2$/);

  const saved = walletCredentials.load('0xDEF');
  assert.equal(saved.netdoctorCreditKey, 'e3d_netdoctor_pay_batch');
  assert.equal(saved.creditsRemaining, 2000);
});

test('resolveCreditKeyViaWallet forwards paymentMethod to createPaymentSession', async () => {
  const walletCredentials = createFakeWalletCredentials();
  const createSessionCalls = [];
  const paymentClient = {
    createPaymentSession: async (args) => {
      createSessionCalls.push(args);
      return { sessionId: 'sess-4', quote: { requiredAmount: '0.5' } };
    },
    getSessionResult: async () => ({ status: 'completed', creditKey: 'e3d_netdoctor_pay_eth', issuedCredits: 500 }),
  };

  await resolveCreditKeyViaWallet({
    wallet: '0xETH',
    oneOff: true,
    paymentMethod: 'ethereum',
    paymentClient,
    walletCredentials,
    pollOptions: { sleep: async () => {} },
  });

  assert.equal(createSessionCalls[0].paymentMethod, 'ethereum');
});

test('resolveCreditKeyViaWallet reuses a saved key with enough remaining balance, skipping session creation', async () => {
  const walletCredentials = createFakeWalletCredentials({
    '0xghi': { netdoctorCreditKey: 'e3d_netdoctor_pay_existing', creditsRemaining: 1500 },
  });
  let sessionCreated = false;
  const paymentClient = {
    createPaymentSession: async () => { sessionCreated = true; throw new Error('should not be called'); },
    getSessionResult: async () => { throw new Error('should not be called'); },
  };

  const result = await resolveCreditKeyViaWallet({
    wallet: '0xGHI',
    oneOff: false,
    paymentClient,
    walletCredentials,
  });

  assert.equal(result.creditKey, 'e3d_netdoctor_pay_existing');
  assert.equal(result.source, 'saved');
  assert.equal(sessionCreated, false);
});

test('resolveCreditKeyViaWallet re-purchases when the saved balance is too low for another report', async () => {
  const walletCredentials = createFakeWalletCredentials({
    '0xjkl': { netdoctorCreditKey: 'e3d_netdoctor_pay_low', creditsRemaining: 100 },
  });
  const paymentClient = {
    createPaymentSession: async () => ({ sessionId: 'sess-3', quote: {} }),
    getSessionResult: async () => ({ status: 'completed', creditKey: 'e3d_netdoctor_pay_new', issuedCredits: 2000 }),
  };

  const result = await resolveCreditKeyViaWallet({
    wallet: '0xJKL',
    credits: 2000,
    oneOff: false,
    paymentClient,
    walletCredentials,
    pollOptions: { sleep: async () => {} },
  });

  assert.equal(result.creditKey, 'e3d_netdoctor_pay_new');
  assert.equal(result.source, 'purchased');
});
