import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadWalletCredentials, saveWalletCredentials } from '../src/walletCredentials.js';

async function withTempConfigPath(fn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e3d-netdoctor-wallet-creds-'));
  const configPath = path.join(tempDir, 'nested', 'config.json');
  try {
    return await fn(configPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('saveWalletCredentials creates the config dir/file with restrictive permissions', async () => {
  await withTempConfigPath(async (configPath) => {
    saveWalletCredentials('0xABCDEF0000000000000000000000000000000001', { netdoctorCreditKey: 'e3d_netdoctor_pay_abc', creditsRemaining: 2000 }, configPath);

    const dirStat = await fs.stat(path.dirname(configPath));
    const fileStat = await fs.stat(configPath);
    assert.equal(dirStat.mode & 0o777, 0o700);
    assert.equal(fileStat.mode & 0o777, 0o600);
  });
});

test('saveWalletCredentials lowercases the wallet key and round-trips through loadWalletCredentials', async () => {
  await withTempConfigPath(async (configPath) => {
    saveWalletCredentials('0xABCDEF0000000000000000000000000000000001', { netdoctorCreditKey: 'e3d_netdoctor_pay_abc', creditsRemaining: 2000 }, configPath);

    const loadedMixedCase = loadWalletCredentials('0xAbCdEf0000000000000000000000000000000001', configPath);
    const loadedLowercase = loadWalletCredentials('0xabcdef0000000000000000000000000000000001', configPath);

    assert.equal(loadedMixedCase.netdoctorCreditKey, 'e3d_netdoctor_pay_abc');
    assert.equal(loadedMixedCase.creditsRemaining, 2000);
    assert.ok(loadedMixedCase.updatedAt);
    assert.deepEqual(loadedMixedCase, loadedLowercase);
  });
});

test('saveWalletCredentials merges partial updates without discarding other fields', async () => {
  await withTempConfigPath(async (configPath) => {
    saveWalletCredentials('0xabc', { netdoctorCreditKey: 'e3d_netdoctor_pay_abc', creditsRemaining: 2000 }, configPath);
    saveWalletCredentials('0xabc', { creditsRemaining: 1500 }, configPath);

    const loaded = loadWalletCredentials('0xabc', configPath);
    assert.equal(loaded.netdoctorCreditKey, 'e3d_netdoctor_pay_abc');
    assert.equal(loaded.creditsRemaining, 1500);
  });
});

test('saveWalletCredentials keeps separate wallets independent', async () => {
  await withTempConfigPath(async (configPath) => {
    saveWalletCredentials('0xaaa', { netdoctorCreditKey: 'key-a' }, configPath);
    saveWalletCredentials('0xbbb', { netdoctorCreditKey: 'key-b' }, configPath);

    assert.equal(loadWalletCredentials('0xaaa', configPath).netdoctorCreditKey, 'key-a');
    assert.equal(loadWalletCredentials('0xbbb', configPath).netdoctorCreditKey, 'key-b');
  });
});

test('loadWalletCredentials returns null for an unknown wallet or missing file', async () => {
  await withTempConfigPath(async (configPath) => {
    assert.equal(loadWalletCredentials('0xdoesnotexist', configPath), null);

    saveWalletCredentials('0xabc', { netdoctorCreditKey: 'key' }, configPath);
    assert.equal(loadWalletCredentials('0xdefdoesnotexist', configPath), null);
  });
});

test('saveWalletCredentials rejects an empty wallet address', () => {
  assert.throws(() => saveWalletCredentials('', { netdoctorCreditKey: 'x' }, '/tmp/unused.json'), /wallet address is required/);
});
