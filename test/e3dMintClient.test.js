import assert from 'node:assert/strict';
import { test } from 'node:test';

import { E3DMintClient } from '../src/e3dMintClient.js';

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

test('createMintSession posts to the mint session endpoint', async () => {
  let capturedUrl = null;
  let capturedBody = null;
  const restore = stubFetch(async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return jsonResponse({ sessionId: 'sess-1', metadataURI: 'ipfs://abc' }, { status: 201 });
  });

  try {
    const client = new E3DMintClient({});
    const result = await client.createMintSession({
      wallet: '0x1',
      name: 'netdoctor report',
      description: 'a report',
      imageBuffer: Buffer.from('fake-png'),
      animationContent: '<html>report</html>',
      properties: { kind: 'netdoctor_report', verdict: 'Likely local' },
      source: 'netdoctor',
    });

    assert.equal(capturedUrl, 'https://e3d.ai/api/mint/session');
    assert.equal(capturedBody.wallet, '0x1');
    assert.equal(capturedBody.image, Buffer.from('fake-png').toString('base64'));
    assert.deepEqual(capturedBody.properties, { kind: 'netdoctor_report', verdict: 'Likely local' });
    assert.equal(capturedBody.source, 'netdoctor');
    assert.equal(result.sessionId, 'sess-1');
    assert.equal(result.metadataURI, 'ipfs://abc');
  } finally {
    restore();
  }
});

test('getMintSessionResult GETs the result endpoint for the given session id', async () => {
  let capturedUrl = null;
  let capturedMethod = null;
  const restore = stubFetch(async (url, options) => {
    capturedUrl = url;
    capturedMethod = options.method;
    return jsonResponse({ status: 'pending' });
  });

  try {
    const client = new E3DMintClient({});
    const result = await client.getMintSessionResult('session with spaces');
    assert.equal(capturedUrl, 'https://e3d.ai/api/mint/session/session%20with%20spaces/result');
    assert.equal(capturedMethod, 'GET');
    assert.equal(result.status, 'pending');
  } finally {
    restore();
  }
});

test('requestJson surfaces server error payloads with status and code', async () => {
  const restore = stubFetch(async () => jsonResponse(
    { message: 'Mint session not found or expired', code: 'SESSION_NOT_FOUND' },
    { ok: false, status: 404 },
  ));

  try {
    const client = new E3DMintClient({});
    await assert.rejects(
      () => client.getMintSessionResult('missing'),
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
