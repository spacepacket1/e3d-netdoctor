import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isLocalAddress } from '../src/networkAddressUtils.js';

test('isLocalAddress recognizes RFC1918 ranges', () => {
  assert.equal(isLocalAddress('10.0.0.5'), true);
  assert.equal(isLocalAddress('172.16.4.4'), true);
  assert.equal(isLocalAddress('172.31.255.255'), true);
  assert.equal(isLocalAddress('192.168.1.10'), true);
});

test('isLocalAddress recognizes loopback and link-local', () => {
  assert.equal(isLocalAddress('127.0.0.1'), true);
  assert.equal(isLocalAddress('localhost'), true);
  assert.equal(isLocalAddress('169.254.1.1'), true);
  assert.equal(isLocalAddress('::1'), true);
  assert.equal(isLocalAddress('fe80::1'), true);
});

test('isLocalAddress recognizes IPv6 unique local addresses', () => {
  assert.equal(isLocalAddress('fc00::1'), true);
  assert.equal(isLocalAddress('fd12:3456::1'), true);
});

test('isLocalAddress rejects public addresses and empty input', () => {
  assert.equal(isLocalAddress('8.8.8.8'), false);
  assert.equal(isLocalAddress('93.184.216.34'), false);
  assert.equal(isLocalAddress(''), false);
  assert.equal(isLocalAddress(undefined), false);
  assert.equal(isLocalAddress(null), false);
});
