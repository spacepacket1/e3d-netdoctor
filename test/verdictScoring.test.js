import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scoreVerdict } from '../src/verdictScoring.js';

function createRow({
  localIp = '192.168.1.10',
  localMac = 'aa:aa:aa:aa:aa:aa',
  externalIp,
  externalMac = 'ff:ff:ff:ff:ff:ff',
  retransmissions = 0,
  duplicateAcks = 0,
  outOfOrder = 0,
  rttP95Ms = null,
  provider = null,
  asn = null,
} = {}) {
  return {
    Group: 'Group1',
    'Client Addr': localIp,
    'Client Port': '40000',
    'Server Addr': externalIp,
    'Server Port': '443',
    'Client MAC': localMac,
    'Server MAC': externalMac,
    'Client Bytes': 1000,
    'Server Bytes': 1000,
    Packets: 10,
    Protocol: 'tcp',
    'TCP Retransmissions': retransmissions,
    'TCP Duplicate ACKs': duplicateAcks,
    'TCP Out-of-Order': outOfOrder,
    'TCP RTT Samples': rttP95Ms === null ? 0 : 1,
    'TCP RTT Min (ms)': rttP95Ms,
    'TCP RTT P50 (ms)': rttP95Ms,
    'TCP RTT P95 (ms)': rttP95Ms,
    'TCP RTT Max (ms)': rttP95Ms,
    'Server Provider': provider,
    'Server ASN': asn,
  };
}

test('scoreVerdict returns likely upstream/ISP when signal spans many destinations and providers', () => {
  const rows = [
    createRow({ externalIp: '8.8.8.8', retransmissions: 2, provider: 'Google', asn: '15169', localMac: 'aa:aa:aa:aa:aa:aa' }),
    createRow({ externalIp: '1.1.1.1', retransmissions: 1, provider: 'Cloudflare', asn: '13335', localMac: 'bb:bb:bb:bb:bb:bb' }),
    createRow({ externalIp: '9.9.9.9', retransmissions: 1, provider: 'Quad9', asn: '19281', localMac: 'cc:cc:cc:cc:cc:cc' }),
    createRow({ externalIp: '208.67.222.222', retransmissions: 1, provider: 'Cisco OpenDNS', asn: '36692', localMac: 'dd:dd:dd:dd:dd:dd' }),
    createRow({ externalIp: '151.101.1.69', retransmissions: 1, provider: 'Fastly', asn: '54113', localMac: 'ee:ee:ee:ee:ee:ee' }),
    createRow({ externalIp: '52.95.110.1', retransmissions: 0, provider: 'Amazon', asn: '16509', localMac: 'ff:ff:ff:ff:ff:01' }),
  ];

  const result = scoreVerdict(rows);

  assert.equal(result.verdict, 'Likely upstream/ISP');
  assert.equal(result.confidence, 'High');
  assert.match(result.rationale, /5 of 6 external destinations/);
  assert.match(result.rationale, /spanning 5 providers/);
});

test('scoreVerdict returns likely local when one MAC owns the affected signal across many destinations', () => {
  const rows = [
    createRow({ externalIp: '8.8.8.8', retransmissions: 2, localMac: 'aa:aa:aa:aa:aa:aa', provider: 'Google', asn: '15169' }),
    createRow({ externalIp: '1.1.1.1', retransmissions: 2, localMac: 'aa:aa:aa:aa:aa:aa', provider: 'Cloudflare', asn: '13335' }),
    createRow({ externalIp: '9.9.9.9', retransmissions: 1, localMac: 'aa:aa:aa:aa:aa:aa', provider: 'Quad9', asn: '19281' }),
    createRow({ externalIp: '208.67.222.222', retransmissions: 1, localMac: 'aa:aa:aa:aa:aa:aa', provider: 'Cisco OpenDNS', asn: '36692' }),
    createRow({ externalIp: '151.101.1.69', retransmissions: 0, localMac: 'bb:bb:bb:bb:bb:bb', provider: 'Fastly', asn: '54113' }),
  ];

  const result = scoreVerdict(rows);

  assert.equal(result.verdict, 'Likely local');
  assert.equal(result.confidence, 'High');
  assert.match(result.rationale, /one local device/);
  assert.match(result.rationale, /across 4 destinations/);
});

test('scoreVerdict returns likely destination/path-specific when issues stay confined to one destination', () => {
  const rows = [
    createRow({ externalIp: '8.8.8.8', retransmissions: 2, provider: 'Google', asn: '15169' }),
    createRow({ externalIp: '1.1.1.1', retransmissions: 0, provider: 'Cloudflare', asn: '13335' }),
    createRow({ externalIp: '9.9.9.9', retransmissions: 0, provider: 'Quad9', asn: '19281' }),
    createRow({ externalIp: '208.67.222.222', retransmissions: 0, provider: 'Cisco OpenDNS', asn: '36692' }),
    createRow({ externalIp: '151.101.1.69', retransmissions: 0, provider: 'Fastly', asn: '54113' }),
  ];

  const result = scoreVerdict(rows);

  assert.equal(result.verdict, 'Likely destination/path-specific');
  assert.equal(result.confidence, 'High');
  assert.match(result.rationale, /issues are confined to 1 of 5 external destinations/);
  assert.match(result.rationale, /8\.8\.8\.8/);
});

test('scoreVerdict falls back to a concrete best-guess verdict when there are too few distinct destinations', () => {
  const rows = [
    createRow({ externalIp: '8.8.8.8', retransmissions: 2, provider: 'Google', asn: '15169' }),
    createRow({ externalIp: '1.1.1.1', retransmissions: 1, provider: 'Cloudflare', asn: '13335' }),
  ];

  const result = scoreVerdict(rows);

  assert.notEqual(result.verdict, 'Inconclusive');
  assert.equal(result.verdict, 'Likely local');
  assert.equal(result.confidence, 'Low');
  assert.match(result.rationale, /too little traffic diversity/);
  assert.match(result.rationale, /closest match is one local device/);
  assert.equal(result.summary.eligibleDestinations, 2);
  assert.equal(result.summary.eligibleConversations, 2);
});

test('scoreVerdict falls back to a concrete best-guess verdict when there is no retransmission/RTT signal at all', () => {
  const rows = [
    createRow({ externalIp: '8.8.8.8', localMac: 'aa:aa:aa:aa:aa:aa', provider: 'Google', asn: '15169' }),
    createRow({ externalIp: '1.1.1.1', localMac: 'bb:bb:bb:bb:bb:bb', provider: 'Cloudflare', asn: '13335' }),
    createRow({ externalIp: '9.9.9.9', localMac: 'cc:cc:cc:cc:cc:cc', provider: 'Quad9', asn: '19281' }),
  ];

  const result = scoreVerdict(rows);

  assert.notEqual(result.verdict, 'Inconclusive');
  assert.equal(result.verdict, 'Likely destination/path-specific');
  assert.equal(result.confidence, 'Low');
  assert.match(result.rationale, /no retransmission or RTT-outlier signal was observed/);
  assert.match(result.rationale, /narrowest possible claim/);
});

test('scoreVerdict falls back to a concrete best-guess verdict when signal is spread but ties every classifier', () => {
  const rows = [
    createRow({ externalIp: '8.8.8.8', retransmissions: 1, localMac: 'aa:aa:aa:aa:aa:aa' }),
    createRow({ externalIp: '1.1.1.1', retransmissions: 1, localMac: 'bb:bb:bb:bb:bb:bb' }),
    createRow({ externalIp: '9.9.9.9', retransmissions: 1, localMac: 'cc:cc:cc:cc:cc:cc' }),
    createRow({ externalIp: '208.67.222.222', retransmissions: 1, localMac: 'dd:dd:dd:dd:dd:dd' }),
  ];

  const result = scoreVerdict(rows);

  assert.notEqual(result.verdict, 'Inconclusive');
  assert.equal(result.verdict, 'Likely upstream/ISP');
  assert.equal(result.confidence, 'Low');
  assert.match(result.rationale, /signal is mixed across destinations and local devices/);
  assert.match(result.rationale, /closest match is signal spread across 4 destinations/);
});
