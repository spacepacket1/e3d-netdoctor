import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { aggregatePacketRecords, parsePcapFile } from '../src/e3dPcap.js';
import { parsePcapFile as parsePcapFileDirect } from '../../e3d-pcap/server/localPcapParse.js';
import { normalizeEnrichmentResponse } from '../src/e3dPcap.js';

const fixturePath = path.resolve('fixtures/sample-syn.pcap');
const retransmissionFixturePath = path.resolve('fixtures/retransmission-handshake.pcap');

function stripExtendedFields(result) {
  return {
    ...result,
    rows: result.rows.map((row) => {
      const {
        'TCP Retransmissions': _tcpRetransmissions,
        'TCP Duplicate ACKs': _tcpDuplicateAcks,
        'TCP Out-of-Order': _tcpOutOfOrder,
        'TCP Zero-Window Stalls': _tcpZeroWindowStalls,
        'TCP RTT Samples': _tcpRttSamples,
        'TCP RTT Min (ms)': _tcpRttMin,
        'TCP RTT P50 (ms)': _tcpRttP50,
        'TCP RTT P95 (ms)': _tcpRttP95,
        'TCP RTT Max (ms)': _tcpRttMax,
        'DNS Response Samples': _dnsResponseSamples,
        'DNS Response P50 (ms)': _dnsResponseP50,
        'DNS Response P95 (ms)': _dnsResponseP95,
        'DNS Response Max (ms)': _dnsResponseMax,
        ...rest
      } = row;
      return rest;
    }),
    diagnostics: {
      packetCount: result.diagnostics.packetCount,
      conversationCount: result.diagnostics.conversationCount,
      aggregate: result.diagnostics.aggregate,
      protocolBreakdown: result.diagnostics.protocolBreakdown,
      warnings: result.diagnostics.warnings.filter((warning) => !warning.includes('Extended TCP analysis fields')),
      filePath: result.diagnostics.filePath,
      parserStatus: {
        ok: result.diagnostics.parserStatus.ok,
        maxReadPackets: result.diagnostics.parserStatus.maxReadPackets,
        timeoutMs: result.diagnostics.parserStatus.timeoutMs,
      },
    },
  };
}

test('local dependency wiring exposes e3d-pcap enrichment helpers', () => {
  const normalized = normalizeEnrichmentResponse({ ok: true, items: { names: [{ value: 'demo' }] } });
  assert.deepEqual(normalized, {
    ok: true,
    source: 'nametable',
    items: {
      names: [{ value: 'demo' }],
      ouis: [],
    },
  });
});

test('sample pcap preserves the upstream parse contract for existing fields', async () => {
  const viaDependency = await parsePcapFile(fixturePath);
  const directResult = await parsePcapFileDirect(fixturePath);

  assert.deepEqual(stripExtendedFields(viaDependency), directResult);
  assert.equal(viaDependency.parser, 'tshark');
  assert.ok(viaDependency.rows.length > 0);
  assert.ok(viaDependency.diagnostics.packetCount > 0);
});

test('retransmission fixture surfaces conversation TCP health and RTT metrics', async () => {
  const parsed = await parsePcapFile(retransmissionFixturePath);

  assert.equal(parsed.parser, 'tshark');
  assert.equal(parsed.diagnostics.packetCount, 7);
  assert.equal(parsed.rows.length, 1);

  const [row] = parsed.rows;
  assert.equal(row['Client Addr'], '192.168.1.10');
  assert.equal(row['Client Port'], '40000');
  assert.equal(row['Server Addr'], '93.184.216.34');
  assert.equal(row['Server Port'], '80');
  assert.equal(row['TCP Retransmissions'], 1);
  assert.equal(row['TCP Duplicate ACKs'], 1);
  assert.equal(row['TCP Out-of-Order'], 0);
  assert.equal(row['TCP RTT Samples'], 1);
  assert.equal(row['TCP RTT Min (ms)'], 50);
  assert.equal(row['TCP RTT P50 (ms)'], 50);
  assert.equal(row['TCP RTT P95 (ms)'], 50);
  assert.equal(row['TCP RTT Max (ms)'], 50);
  assert.equal(row['TCP Zero-Window Stalls'], 0);
  assert.equal(row['DNS Response Samples'], 0);

  assert.deepEqual(parsed.diagnostics.tcpAnalysis, {
    retransmissions: 1,
    duplicateAcks: 1,
    outOfOrder: 0,
    zeroWindow: 0,
    rttMs: {
      count: 1,
      minMs: 50,
      p50Ms: 50,
      p95Ms: 50,
      maxMs: 50,
    },
    dnsResponseTimeMs: {
      count: 0,
      minMs: null,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
    },
  });
  assert.equal(parsed.diagnostics.verdict.verdict, 'Inconclusive');
  assert.equal(parsed.diagnostics.verdict.confidence, 'Low');
  assert.equal(parsed.diagnostics.parserStatus.optionalFieldsEnabled, true);
});

test('aggregatePacketRecords rolls up duplicate ACK, out-of-order, and RTT samples per conversation', () => {
  const records = [
    {
      ethSrc: 'aa:aa:aa:aa:aa:aa',
      ethDst: 'bb:bb:bb:bb:bb:bb',
      ipSrc: '10.0.0.2',
      ipDst: '20.0.0.1',
      tcpSrcPort: '50000',
      tcpDstPort: '443',
      udpSrcPort: '',
      udpDstPort: '',
      frameLen: '60',
      protocol: 'TCP',
      frameTimeEpoch: '1.000',
      tcpSyn: 'True',
      tcpAck: 'False',
    },
    {
      ethSrc: 'bb:bb:bb:bb:bb:bb',
      ethDst: 'aa:aa:aa:aa:aa:aa',
      ipSrc: '20.0.0.1',
      ipDst: '10.0.0.2',
      tcpSrcPort: '443',
      tcpDstPort: '50000',
      udpSrcPort: '',
      udpDstPort: '',
      frameLen: '60',
      protocol: 'TCP',
      frameTimeEpoch: '1.012',
      tcpSyn: 'True',
      tcpAck: 'True',
    },
    {
      ethSrc: 'aa:aa:aa:aa:aa:aa',
      ethDst: 'bb:bb:bb:bb:bb:bb',
      ipSrc: '10.0.0.2',
      ipDst: '20.0.0.1',
      tcpSrcPort: '50000',
      tcpDstPort: '443',
      udpSrcPort: '',
      udpDstPort: '',
      frameLen: '52',
      protocol: 'TCP',
      frameTimeEpoch: '1.100',
      tcpAnalysisOutOfOrder: '1',
    },
    {
      ethSrc: 'bb:bb:bb:bb:bb:bb',
      ethDst: 'aa:aa:aa:aa:aa:aa',
      ipSrc: '20.0.0.1',
      ipDst: '10.0.0.2',
      tcpSrcPort: '443',
      tcpDstPort: '50000',
      udpSrcPort: '',
      udpDstPort: '',
      frameLen: '52',
      protocol: 'TCP',
      frameTimeEpoch: '1.200',
      tcpAnalysisDuplicateAck: '1',
    },
    {
      ethSrc: 'aa:aa:aa:aa:aa:aa',
      ethDst: 'bb:bb:bb:bb:bb:bb',
      ipSrc: '10.0.0.2',
      ipDst: '20.0.0.1',
      tcpSrcPort: '50000',
      tcpDstPort: '443',
      udpSrcPort: '',
      udpDstPort: '',
      frameLen: '60',
      protocol: 'TCP',
      frameTimeEpoch: '2.000',
      tcpSyn: 'True',
      tcpAck: 'False',
    },
    {
      ethSrc: 'bb:bb:bb:bb:bb:bb',
      ethDst: 'aa:aa:aa:aa:aa:aa',
      ipSrc: '20.0.0.1',
      ipDst: '10.0.0.2',
      tcpSrcPort: '443',
      tcpDstPort: '50000',
      udpSrcPort: '',
      udpDstPort: '',
      frameLen: '60',
      protocol: 'TCP',
      frameTimeEpoch: '2.030',
      tcpSyn: 'True',
      tcpAck: 'True',
    },
  ];

  const aggregated = aggregatePacketRecords(records);
  assert.equal(aggregated.rows.length, 1);

  const [row] = aggregated.rows;
  assert.equal(row['TCP Retransmissions'], 0);
  assert.equal(row['TCP Duplicate ACKs'], 1);
  assert.equal(row['TCP Out-of-Order'], 1);
  assert.equal(row['TCP RTT Samples'], 2);
  assert.equal(row['TCP RTT Min (ms)'], 12);
  assert.equal(row['TCP RTT P50 (ms)'], 21);
  assert.equal(row['TCP RTT P95 (ms)'], 29.1);
  assert.equal(row['TCP RTT Max (ms)'], 30);
  assert.equal(row['TCP Zero-Window Stalls'], 0);
  assert.equal(row['DNS Response Samples'], 0);
});

test('aggregatePacketRecords rolls up zero-window stalls and DNS response timing per conversation', () => {
  const records = [
    {
      ipSrc: '10.0.0.2',
      ipDst: '20.0.0.1',
      tcpSrcPort: '50000',
      tcpDstPort: '443',
      udpSrcPort: '',
      udpDstPort: '',
      frameLen: '60',
      protocol: 'TCP',
      frameTimeEpoch: '1.000',
      tcpAnalysisZeroWindow: '1',
    },
    {
      ipSrc: '20.0.0.1',
      ipDst: '10.0.0.2',
      tcpSrcPort: '443',
      tcpDstPort: '50000',
      udpSrcPort: '',
      udpDstPort: '',
      frameLen: '60',
      protocol: 'TCP',
      frameTimeEpoch: '1.100',
      tcpAnalysisWindowFull: '1',
    },
    {
      ipSrc: '10.0.0.5',
      ipDst: '8.8.8.8',
      udpSrcPort: '55000',
      udpDstPort: '53',
      tcpSrcPort: '',
      tcpDstPort: '',
      frameLen: '70',
      protocol: 'DNS',
      frameTimeEpoch: '2.000',
    },
    {
      ipSrc: '8.8.8.8',
      ipDst: '10.0.0.5',
      udpSrcPort: '53',
      udpDstPort: '55000',
      tcpSrcPort: '',
      tcpDstPort: '',
      frameLen: '90',
      protocol: 'DNS',
      frameTimeEpoch: '2.040',
      dnsResponseTime: '0.040000',
    },
  ];

  const aggregated = aggregatePacketRecords(records);
  assert.equal(aggregated.rows.length, 2);

  const tcpRow = aggregated.rows.find((row) => row['Client Addr'] === '10.0.0.2');
  assert.equal(tcpRow['TCP Zero-Window Stalls'], 2);

  const dnsRow = aggregated.rows.find((row) => row['Client Addr'] === '10.0.0.5');
  assert.equal(dnsRow['DNS Response Samples'], 1);
  assert.equal(dnsRow['DNS Response Max (ms)'], 40);

  assert.equal(aggregated.diagnostics.tcpAnalysis.zeroWindow, 2);
  assert.deepEqual(aggregated.diagnostics.tcpAnalysis.dnsResponseTimeMs, {
    count: 1,
    minMs: 40,
    p50Ms: 40,
    p95Ms: 40,
    maxMs: 40,
  });
});
