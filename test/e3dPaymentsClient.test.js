import assert from 'node:assert/strict';
import { test } from 'node:test';

import { E3DPaymentsClient } from '../src/e3dPaymentsClient.js';

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => handler(url, options);
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

test('quoteCredits does not require a bearer token', async () => {
  let capturedHeaders = null;
  const restore = stubFetch(async (url, options) => {
    capturedHeaders = options.headers;
    return jsonResponse({ requiredBaseCredits: 500 });
  });

  try {
    const client = new E3DPaymentsClient({});
    const quote = await client.quoteCredits({ product: 'netdoctor', wallet: '0x1', requestedIssuedCredits: 500 });
    assert.equal(quote.requiredBaseCredits, 500);
    assert.equal(capturedHeaders.authorization, undefined);
  } finally {
    restore();
  }
});

test('quoteCredits includes a bearer header when a token is configured', async () => {
  let capturedHeaders = null;
  const restore = stubFetch(async (url, options) => {
    capturedHeaders = options.headers;
    return jsonResponse({ requiredBaseCredits: 500 });
  });

  try {
    const client = new E3DPaymentsClient({ token: 'agent-token' });
    await client.quoteCredits({ product: 'netdoctor', wallet: '0x1', requestedIssuedCredits: 500 });
    assert.equal(capturedHeaders.authorization, 'Bearer agent-token');
  } finally {
    restore();
  }
});

test('createPaymentSession posts to the session endpoint without requiring a token', async () => {
  let capturedUrl = null;
  let capturedBody = null;
  const restore = stubFetch(async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return jsonResponse({ sessionId: 'abc123', quote: { requiredBaseCredits: 500 } }, { status: 201 });
  });

  try {
    const client = new E3DPaymentsClient({});
    const result = await client.createPaymentSession({ product: 'netdoctor', wallet: '0x1', requestedIssuedCredits: 500 });
    assert.equal(capturedUrl, 'https://e3d.ai/api/payments/credits/session');
    assert.deepEqual(capturedBody, { product: 'netdoctor', wallet: '0x1', requestedIssuedCredits: 500 });
    assert.equal(result.sessionId, 'abc123');
  } finally {
    restore();
  }
});

test('getSessionResult GETs the result endpoint for the given session id', async () => {
  let capturedUrl = null;
  let capturedMethod = null;
  const restore = stubFetch(async (url, options) => {
    capturedUrl = url;
    capturedMethod = options.method;
    return jsonResponse({ status: 'pending' });
  });

  try {
    const client = new E3DPaymentsClient({});
    const result = await client.getSessionResult('session with spaces');
    assert.equal(capturedUrl, 'https://e3d.ai/api/payments/credits/session/session%20with%20spaces/result');
    assert.equal(capturedMethod, 'GET');
    assert.equal(result.status, 'pending');
  } finally {
    restore();
  }
});

test('requestJson surfaces server error payloads with status and code', async () => {
  const restore = stubFetch(async () => jsonResponse(
    { message: 'Payment session not found or expired', code: 'SESSION_NOT_FOUND' },
    { ok: false, status: 404 },
  ));

  try {
    const client = new E3DPaymentsClient({});
    await assert.rejects(
      () => client.getSessionResult('missing'),
      (error) => {
        assert.equal(error.status, 404);
        assert.equal(error.code, 'SESSION_NOT_FOUND');
        return true;
      },
    );
  } finally {
    restore();
  }
});
