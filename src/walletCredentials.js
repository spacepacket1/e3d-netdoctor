import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getWalletCredentialsPath() {
  return path.join(os.homedir(), '.config', 'e3d-netdoctor', 'config.json');
}

function normalizeWallet(wallet) {
  const normalized = String(wallet || '').trim().toLowerCase();
  if (!normalized) throw new Error('wallet address is required');
  return normalized;
}

function loadStore(configPath) {
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function saveWalletCredentials(wallet, record, configPath = getWalletCredentialsPath()) {
  const normalizedWallet = normalizeWallet(wallet);
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const store = loadStore(configPath);
  store[normalizedWallet] = {
    ...store[normalizedWallet],
    ...record,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  return store[normalizedWallet];
}

export function loadWalletCredentials(wallet, configPath = getWalletCredentialsPath()) {
  const normalizedWallet = normalizeWallet(wallet);
  const store = loadStore(configPath);
  return store[normalizedWallet] || null;
}
