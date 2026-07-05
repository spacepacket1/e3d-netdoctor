import assert from 'node:assert/strict';
import { test } from 'node:test';

import { anonymizeLocalIdentifiers } from '../src/reportRedaction.js';

function createRow(overrides = {}) {
  return {
    'Client Addr': '192.168.1.10',
    'Client MAC': 'aa:aa:aa:aa:aa:aa',
    'Client Port': '40000',
    'Server Addr': '93.184.216.34',
    'Server MAC': 'bb:bb:bb:bb:bb:bb',
    'Server Port': '443',
    Packets: 10,
    Protocol: 'tcp',
    ...overrides,
  };
}

test('anonymizeLocalIdentifiers replaces the local side and leaves the external side untouched', () => {
  const [row] = anonymizeLocalIdentifiers([createRow()]);
  assert.equal(row['Client Addr'], 'local-device-1');
  assert.equal(row['Client MAC'], 'local-mac-1');
  assert.equal(row['Server Addr'], '93.184.216.34');
  assert.equal(row['Server MAC'], 'bb:bb:bb:bb:bb:bb');
  assert.equal(row['Client Port'], '40000');
  assert.equal(row.Protocol, 'tcp');
});

test('anonymizeLocalIdentifiers gives the same real device the same pseudonym across rows', () => {
  const rows = anonymizeLocalIdentifiers([
    createRow({ 'Server Addr': '8.8.8.8' }),
    createRow({ 'Server Addr': '1.1.1.1' }),
  ]);
  assert.equal(rows[0]['Client Addr'], 'local-device-1');
  assert.equal(rows[1]['Client Addr'], 'local-device-1');
});

test('anonymizeLocalIdentifiers assigns distinct pseudonyms to distinct devices in first-seen order', () => {
  const rows = anonymizeLocalIdentifiers([
    createRow({ 'Client Addr': '192.168.1.10', 'Client MAC': 'aa:aa:aa:aa:aa:aa' }),
    createRow({ 'Client Addr': '192.168.1.20', 'Client MAC': 'cc:cc:cc:cc:cc:cc' }),
    createRow({ 'Client Addr': '192.168.1.10', 'Client MAC': 'aa:aa:aa:aa:aa:aa' }),
  ]);
  assert.equal(rows[0]['Client Addr'], 'local-device-1');
  assert.equal(rows[1]['Client Addr'], 'local-device-2');
  assert.equal(rows[2]['Client Addr'], 'local-device-1');
});

test('anonymizeLocalIdentifiers leaves a row with no local side unchanged', () => {
  const [row] = anonymizeLocalIdentifiers([createRow({ 'Client Addr': '8.8.8.8', 'Client MAC': null })]);
  assert.equal(row['Client Addr'], '8.8.8.8');
  assert.equal(row['Server Addr'], '93.184.216.34');
});

test('anonymizeLocalIdentifiers pseudonymizes both sides of a LAN-to-LAN row as distinct devices', () => {
  const [row] = anonymizeLocalIdentifiers([createRow({ 'Server Addr': '192.168.1.20', 'Server MAC': 'cc:cc:cc:cc:cc:cc' })]);
  assert.equal(row['Client Addr'], 'local-device-1');
  assert.equal(row['Server Addr'], 'local-device-2');
});

test('anonymizeLocalIdentifiers does not mutate the input rows', () => {
  const original = createRow();
  anonymizeLocalIdentifiers([original]);
  assert.equal(original['Client Addr'], '192.168.1.10');
  assert.equal(original['Client MAC'], 'aa:aa:aa:aa:aa:aa');
});
