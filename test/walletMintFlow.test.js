import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildMintPageUrl,
  pollForMintSessionResult,
  resolveMintViaWallet,
} from '../src/walletMintFlow.js';

test('buildMintPageUrl builds a /mint URL with the session id', () => {
  const url = buildMintPageUrl({ sessionId: 'abc123' });
  assert.equal(url, 'https://e3d.ai/mint?session=abc123');
});

test('buildMintPageUrl respects a custom base URL', () => {
  const url = buildMintPageUrl({ baseUrl: 'https://staging.example.com', sessionId: 'abc123' });
  assert.equal(url, 'https://staging.example.com/mint?session=abc123');
});

test('buildMintPageUrl requires a session id', () => {
  assert.throws(() => buildMintPageUrl({}), /requires sessionId/);
});

test('pollForMintSessionResult polls until completed', async () => {
  const responses = [{ status: 'pending' }, { status: 'pending' }, { status: 'completed', tokenId: 42, txHash: '0xabc' }];
  const mintClient = { getMintSessionResult: async () => responses.shift() };
  const sleeps = [];

  const result = await pollForMintSessionResult({
    mintClient,
    sessionId: 'sess-1',
    sleep: async (ms) => { sleeps.push(ms); },
  });

  assert.deepEqual(result, { status: 'completed', tokenId: 42, txHash: '0xabc' });
  assert.deepEqual(sleeps, [3000, 3000]);
});

test('pollForMintSessionResult throws when the session expires', async () => {
  const mintClient = { getMintSessionResult: async () => ({ status: 'expired' }) };
  await assert.rejects(
    () => pollForMintSessionResult({ mintClient, sessionId: 'sess-1', sleep: async () => {} }),
    /Mint session expired/,
  );
});

test('pollForMintSessionResult times out if it never completes', async () => {
  const mintClient = { getMintSessionResult: async () => ({ status: 'pending' }) };
  await assert.rejects(
    () => pollForMintSessionResult({
      mintClient,
      sessionId: 'sess-1',
      timeoutMs: 10,
      intervalMs: 5,
      sleep: async () => {},
    }),
    /Timed out after 10 ms/,
  );
});

test('resolveMintViaWallet creates a session, announces the mint URL, and polls through to a result', async () => {
  const createSessionCalls = [];
  let announcedUrl = null;
  let announcedMetadataURI = null;
  const mintClient = {
    createMintSession: async (args) => {
      createSessionCalls.push(args);
      return { sessionId: 'sess-1', metadataURI: 'ipfs://abc' };
    },
    getMintSessionResult: async () => ({ status: 'completed', tokenId: 42, txHash: '0xabc' }),
  };

  const result = await resolveMintViaWallet({
    wallet: '0xWallet',
    name: 'netdoctor report',
    description: 'a report',
    properties: { kind: 'netdoctor_report' },
    mintClient,
    onMintUrl: (url, metadataURI) => {
      announcedUrl = url;
      announcedMetadataURI = metadataURI;
    },
    pollOptions: { sleep: async () => {} },
  });

  assert.equal(createSessionCalls[0].wallet, '0xWallet');
  assert.equal(announcedUrl, 'https://e3d.ai/mint?session=sess-1');
  assert.equal(announcedMetadataURI, 'ipfs://abc');
  assert.equal(result.tokenId, 42);
  assert.equal(result.txHash, '0xabc');
});

test('resolveMintViaWallet requires a wallet address and a mintClient', async () => {
  await assert.rejects(() => resolveMintViaWallet({ mintClient: {} }), /requires a wallet address/);
  await assert.rejects(() => resolveMintViaWallet({ wallet: '0xWallet' }), /requires mintClient/);
});
