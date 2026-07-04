import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildNarrativePrompt,
  buildStructuredFindings,
  generateNarrativeWithClaude,
  generateReport,
} from '../src/reportGeneration.js';

function createParsedCaptureFixture() {
  return {
    rawPackets: [
      { payload: 'TOP-SECRET-PAYLOAD', tcpPayload: 'hidden' },
    ],
    rows: [
      {
        'Client Addr': '192.168.1.10',
        'Client Port': '40000',
        'Server Addr': '93.184.216.34',
        'Server Port': '443',
        'Client MAC': 'aa:aa:aa:aa:aa:aa',
        'Server MAC': 'bb:bb:bb:bb:bb:bb',
        'Client Bytes': 2048,
        'Server Bytes': 8192,
        Packets: 24,
        Protocol: 'tcp',
        'TCP Retransmissions': 2,
        'TCP Duplicate ACKs': 1,
        'TCP Out-of-Order': 0,
        'TCP Zero-Window Stalls': 3,
        'TCP RTT Samples': 4,
        'TCP RTT P50 (ms)': 130,
        'TCP RTT P95 (ms)': 250,
        'TCP RTT Max (ms)': 280,
      },
      {
        'Client Addr': '192.168.1.10',
        'Client Port': '5353',
        'Server Addr': '224.0.0.251',
        'Server Port': '5353',
        'Client MAC': 'aa:aa:aa:aa:aa:aa',
        'Server MAC': '01:00:5e:00:00:fb',
        'Client Bytes': 256,
        'Server Bytes': 0,
        Packets: 8,
        Protocol: 'mdns',
        'TCP Retransmissions': 0,
        'TCP Duplicate ACKs': 0,
        'TCP Out-of-Order': 0,
        'TCP RTT Samples': 0,
        'TCP RTT P50 (ms)': null,
        'TCP RTT P95 (ms)': null,
        'TCP RTT Max (ms)': null,
      },
      {
        'Client Addr': '192.168.1.10',
        'Client Port': '53000',
        'Server Addr': '1.1.1.1',
        'Server Port': '53',
        'Client MAC': 'aa:aa:aa:aa:aa:aa',
        'Server MAC': 'cc:cc:cc:cc:cc:cc',
        'Client Bytes': 120,
        'Server Bytes': 180,
        Packets: 4,
        Protocol: 'dns',
        'TCP Retransmissions': 0,
        'TCP Duplicate ACKs': 0,
        'TCP Out-of-Order': 0,
        'TCP RTT Samples': 0,
        'TCP RTT P50 (ms)': null,
        'TCP RTT P95 (ms)': null,
        'TCP RTT Max (ms)': null,
        'DNS Response Samples': 3,
        'DNS Response P50 (ms)': 110,
        'DNS Response P95 (ms)': 140,
        'DNS Response Max (ms)': 150,
      },
    ],
    diagnostics: {
      filePath: '/tmp/sample-capture.pcap',
      packetCount: 36,
      conversationCount: 3,
      warnings: ['Extended TCP analysis fields were unavailable for one packet.'],
      protocolBreakdown: [
        { protocol: 'tcp', packets: 24, bytes: 10240 },
        { protocol: 'mdns', packets: 8, bytes: 256 },
        { protocol: 'dns', packets: 4, bytes: 300 },
      ],
      verdict: {
        verdict: 'Likely local',
        confidence: 'Medium',
        rationale: 'Confidence: Medium - one local device accounts for most affected conversations across multiple destinations.',
        summary: {
          eligibleDestinations: 3,
          eligibleConversations: 3,
          affectedDestinations: 1,
          affectedConversations: 1,
          providersAffected: 1,
          dominantLocal: 'aa:aa:aa:aa:aa:aa',
          dominantLocalShare: 0.88,
        },
      },
      tcpAnalysis: {
        retransmissions: 2,
        duplicateAcks: 1,
        outOfOrder: 0,
        zeroWindow: 3,
        rttMs: {
          count: 4,
          minMs: 120,
          p50Ms: 130,
          p95Ms: 250,
          maxMs: 280,
        },
        dnsResponseTimeMs: {
          count: 3,
          minMs: 100,
          p50Ms: 110,
          p95Ms: 140,
          maxMs: 150,
        },
      },
    },
  };
}

test('buildStructuredFindings derives reportable sections from parsed capture data', () => {
  const findings = buildStructuredFindings(createParsedCaptureFixture(), {
    generatedAt: '2026-07-03T21:00:00.000Z',
    rttOutlierThresholdMs: 200,
  });

  assert.equal(findings.verdict.headline, 'Likely local');
  assert.equal(findings.bandwidthHogs.length, 3);
  assert.equal(findings.bandwidthHogs[0].totalBytes, 10240);
  assert.equal(findings.tcpHealth.totals.retransmissions, 2);
  assert.equal(findings.tcpHealth.totals.zeroWindowStalls, 3);
  assert.equal(findings.rttOutliers.conversations.length, 1);
  assert.equal(findings.dnsSlowness.timingSupported, true);
  assert.equal(findings.dnsSlowness.slowConversations.length, 1);
  assert.equal(findings.dnsSlowness.slowConversations[0].responseMaxMs, 150);
  assert.equal(findings.broadcastNoise.conversations, 1);
  assert.equal(findings.chattyDevices.flagged.length, 1);
});

test('generateReport renders complete HTML without leaking raw packet payloads', async () => {
  const report = await generateReport(createParsedCaptureFixture(), {
    generatedAt: '2026-07-03T21:00:00.000Z',
    gatherSystemDiagnostics: async () => ({
      targets: [{
        host: '93.184.216.34',
        ping: { ok: true, packetLossPercent: 0, rttAvgMs: 26.1, rttMaxMs: 27.3 },
        traceroute: { ok: true, hopCount: 3, timedOutHopCount: 0, hops: [{ host: 'edge.example.net', address: '93.184.216.34' }] },
      }],
      localNetstat: { ok: true, interfacesSupported: true, interfaces: [], protocolStatsSupported: true, protocolStats: { retransmitTimeouts: 0 } },
      skippedReason: null,
    }),
    generateNarrative: async (findings) => ({
      source: 'test-double',
      executiveSummary: [
        `${findings.verdict.headline} is the leading diagnosis.`,
        'TCP retransmissions and elevated RTT support the conclusion.',
        'mDNS traffic is visible but not the primary issue.',
      ],
      sections: {
        overview: 'This summary is based on aggregated conversation metrics only.',
        bandwidthHogs: 'One TCP conversation carries most of the observed bytes.',
        tcpHealth: 'Retransmissions and duplicate ACKs are concentrated in the busiest affected conversation.',
        rttOutliers: 'The same conversation crosses the RTT outlier threshold.',
        dnsSlowness: 'DNS packets are present, but per-query DNS latency is not available in this phase.',
        broadcastNoise: 'Broadcast and multicast traffic is present at a lower volume than the TCP hotspot.',
        chattyDevices: 'A single local device is responsible for most of the observed activity.',
        systemDiagnostics: 'Ping and traceroute to the affected destination show clean loss and a stable path.',
      },
    }),
  });

  assert.match(report.html, /<!doctype html>/i);
  assert.match(report.html, /Likely local/);
  assert.match(report.html, /Executive Summary/);
  assert.match(report.html, /Bandwidth Hogs/);
  assert.match(report.html, /TCP Health/);
  assert.match(report.html, /RTT Outliers/);
  assert.match(report.html, /DNS Performance/);
  assert.match(report.html, /Broadcast &amp; Multicast Noise/);
  assert.match(report.html, /Chatty Devices/);
  assert.match(report.html, /System Diagnostics/);
  assert.match(report.html, /93\.184\.216\.34/);
  assert.match(report.html, /edge\.example\.net/);
  assert.ok(report.html.indexOf('Likely local') < report.html.indexOf('Executive Summary'));
  assert.doesNotMatch(report.html, /TOP-SECRET-PAYLOAD/);
  assert.doesNotMatch(report.html, /tcpPayload/);
});

test('generateReport skips gathering system diagnostics when disabled', async () => {
  let called = false;
  const report = await generateReport(createParsedCaptureFixture(), {
    systemDiagnostics: false,
    gatherSystemDiagnostics: async () => {
      called = true;
      return { targets: [], localNetstat: { ok: true }, skippedReason: null };
    },
    generateNarrative: async () => ({ executiveSummary: [], sections: {} }),
  });

  assert.equal(called, false);
  assert.equal(report.findings.systemDiagnostics, undefined);
  assert.match(report.html, /System-level diagnostics \(ping, traceroute, netstat\) were not run/);
});

test('generateNarrativeWithClaude falls back when no API key is configured', async () => {
  // options.apiKey falls back to process.env.ANTHROPIC_API_KEY, which may be
  // ambiently set in the shell (e.g. by the harness running this test) --
  // clear it for the duration of this test so an empty options.apiKey really
  // means "no key", instead of silently making a real network call.
  const previousEnvKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const findings = buildStructuredFindings(createParsedCaptureFixture());
    const narrative = await generateNarrativeWithClaude(findings, { apiKey: '' });
    assert.equal(narrative.source, 'fallback');
  } finally {
    if (previousEnvKey !== undefined) process.env.ANTHROPIC_API_KEY = previousEnvKey;
  }
});

test('generateNarrativeWithClaude sends no temperature parameter and parses fenced JSON responses', async () => {
  const findings = buildStructuredFindings(createParsedCaptureFixture());
  let capturedBody = null;

  const fetchImpl = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => '',
      json: async () => ({
        content: [{
          type: 'text',
          text: '```json\n{"executiveSummary":["a","b","c"],"sections":{"overview":"o"}}\n```',
        }],
      }),
    };
  };

  const narrative = await generateNarrativeWithClaude(findings, { apiKey: 'test-key', fetchImpl });

  assert.equal('temperature' in capturedBody, false);
  assert.deepEqual(narrative.executiveSummary, ['a', 'b', 'c']);
  assert.equal(narrative.sections.overview, 'o');
});

test('generateNarrativeWithClaude throws a clear error when the response was truncated by max_tokens', async () => {
  const findings = buildStructuredFindings(createParsedCaptureFixture());
  const fetchImpl = async () => ({
    ok: true,
    text: async () => '',
    json: async () => ({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '```json\n{"executiveSummary":["a"' }],
    }),
  });

  await assert.rejects(
    () => generateNarrativeWithClaude(findings, { apiKey: 'test-key', fetchImpl }),
    /truncated \(hit max_tokens/,
  );
});

test('generateNarrativeWithClaude throws a clear error on a non-JSON response, letting generateReport fall back', async () => {
  const findings = buildStructuredFindings(createParsedCaptureFixture());
  const fetchImpl = async () => ({
    ok: true,
    text: async () => '',
    json: async () => ({ content: [{ type: 'text', text: 'not json at all' }] }),
  });

  await assert.rejects(
    () => generateNarrativeWithClaude(findings, { apiKey: 'test-key', fetchImpl }),
    /Claude narrative generation returned invalid JSON/,
  );
});

test('buildNarrativePrompt scopes the model input to structured findings', () => {
  const prompt = buildNarrativePrompt(buildStructuredFindings(createParsedCaptureFixture()));

  assert.match(prompt, /Use only the structured evidence/);
  assert.match(prompt, /Return valid JSON/);
  assert.match(prompt, /"bandwidthHogs"/);
  assert.doesNotMatch(prompt, /TOP-SECRET-PAYLOAD/);
});
