import {
  DEFAULT_MAX_READ_PACKETS,
  DEFAULT_PARSE_TIMEOUT_MS,
  TSHARK_INSTALL_HINT,
  aggregatePacketRecords as aggregatePacketRecordsBase,
} from 'e3d-pcap/server/localPcapParse.js';
import {
  runTsharkPacketFields,
  runTsharkPacketFieldsWithMetadata,
} from './tsharkExtendedFields.js';
import { scoreVerdict } from './verdictScoring.js';

export { checkTsharkInstalled } from 'e3d-pcap/server/tsharkCheck.js';
export {
  createLocalPcapEnrichmentClient,
  normalizeEnrichmentResponse,
} from 'e3d-pcap/server/localPcapEnrichment.js';

export {
  runTsharkPacketFields,
  runTsharkPacketFieldsWithMetadata,
  scoreVerdict,
};

function toInt(value) {
  const number = Number(String(value || '').trim());
  return Number.isFinite(number) ? number : 0;
}

function toFloat(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function toBoolean(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

function toErrorMessage(error) {
  if (error?.code === 'ENOENT') {
    return `tshark is not installed or not on PATH. ${TSHARK_INSTALL_HINT}`;
  }
  return String(error?.message || error);
}

function validateTsharkRecords(records) {
  if (!Array.isArray(records)) {
    throw new Error('Malformed tshark output: expected an array of packet records');
  }

  records.forEach((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`Malformed tshark output: packet record ${index} is invalid`);
    }
  });
}

function buildConversationPosition(record, aggregate = 'ip_port') {
  const src = String(record?.ipSrc || '').trim();
  const dst = String(record?.ipDst || '').trim();
  if (!src || !dst) return null;

  const tcpSrcPort = String(record?.tcpSrcPort || '').trim();
  const tcpDstPort = String(record?.tcpDstPort || '').trim();
  const udpSrcPort = String(record?.udpSrcPort || '').trim();
  const udpDstPort = String(record?.udpDstPort || '').trim();
  const srcPort = tcpSrcPort || udpSrcPort || '-';
  const dstPort = tcpDstPort || udpDstPort || '-';

  let clientAddr = src;
  let serverAddr = dst;
  let clientPort = srcPort;
  let serverPort = dstPort;
  let reversed = false;

  if (src > dst) {
    clientAddr = dst;
    serverAddr = src;
    clientPort = dstPort;
    serverPort = srcPort;
    reversed = true;
  }

  return {
    key: aggregate === 'ip'
      ? `${clientAddr}|-|${serverAddr}|-`
      : `${clientAddr}|${clientPort}|${serverAddr}|${serverPort}`,
    reversed,
  };
}

function buildConversationKeyFromRow(row, aggregate = 'ip_port') {
  return aggregate === 'ip'
    ? `${row['Client Addr']}|-|${row['Server Addr']}|-`
    : `${row['Client Addr']}|${row['Client Port']}|${row['Server Addr']}|${row['Server Port']}`;
}

function createTcpMetrics() {
  return {
    retransmissions: 0,
    duplicateAcks: 0,
    outOfOrder: 0,
    zeroWindow: 0,
    rttSamples: [],
    dnsResponseTimeSamples: [],
  };
}

function getOrCreateConversationMetrics(map, key) {
  const current = map.get(key) || createTcpMetrics();
  map.set(key, current);
  return current;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  if (values.length === 1) return values[0];

  const index = (values.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return values[lower];

  const fraction = index - lower;
  return values[lower] + ((values[upper] - values[lower]) * fraction);
}

function roundMetric(value) {
  if (value === null) return null;
  return Math.round(value * 1000) / 1000;
}

function summarizeRttSamples(samples) {
  if (!samples.length) {
    return {
      count: 0,
      minMs: null,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    minMs: roundMetric(sorted[0]),
    p50Ms: roundMetric(percentile(sorted, 0.5)),
    p95Ms: roundMetric(percentile(sorted, 0.95)),
    maxMs: roundMetric(sorted[sorted.length - 1]),
  };
}

function collectConversationTcpMetrics(records, aggregate = 'ip_port') {
  const conversationMetrics = new Map();
  const pendingSyns = new Map();

  for (const record of records || []) {
    const conversation = buildConversationPosition(record, aggregate);
    if (!conversation) continue;

    const metrics = getOrCreateConversationMetrics(conversationMetrics, conversation.key);
    if (toBoolean(record.tcpAnalysisRetransmission)) metrics.retransmissions += 1;
    if (toBoolean(record.tcpAnalysisDuplicateAck)) metrics.duplicateAcks += 1;
    if (toBoolean(record.tcpAnalysisOutOfOrder)) metrics.outOfOrder += 1;
    if (toBoolean(record.tcpAnalysisZeroWindow) || toBoolean(record.tcpAnalysisWindowFull)) metrics.zeroWindow += 1;

    const dnsResponseTimeSeconds = toFloat(record?.dnsResponseTime);
    if (dnsResponseTimeSeconds !== null) metrics.dnsResponseTimeSamples.push(roundMetric(dnsResponseTimeSeconds * 1000));

    const src = String(record?.ipSrc || '').trim();
    const dst = String(record?.ipDst || '').trim();
    const srcPort = String(record?.tcpSrcPort || '').trim();
    const dstPort = String(record?.tcpDstPort || '').trim();
    const timestamp = toFloat(record?.frameTimeEpoch);
    const isSyn = toBoolean(record?.tcpSyn);
    const isAck = toBoolean(record?.tcpAck);
    if (!src || !dst || !srcPort || !dstPort || timestamp === null || !isSyn) continue;

    if (!isAck) {
      const key = `${src}|${srcPort}|${dst}|${dstPort}`;
      const queued = pendingSyns.get(key) || [];
      queued.push({ timestamp, conversationKey: conversation.key });
      pendingSyns.set(key, queued);
      continue;
    }

    const reverseKey = `${dst}|${dstPort}|${src}|${srcPort}`;
    const queued = pendingSyns.get(reverseKey);
    if (!queued?.length) continue;

    const synPacket = queued.shift();
    if (!queued.length) pendingSyns.delete(reverseKey);
    if (!synPacket || timestamp < synPacket.timestamp) continue;

    const rttMs = roundMetric((timestamp - synPacket.timestamp) * 1000);
    const rttMetrics = getOrCreateConversationMetrics(conversationMetrics, synPacket.conversationKey);
    rttMetrics.rttSamples.push(rttMs);
  }

  return conversationMetrics;
}

function extendRowsWithTcpMetrics(rows, conversationMetrics, aggregate = 'ip_port') {
  return rows.map((row) => {
    const metrics = conversationMetrics.get(buildConversationKeyFromRow(row, aggregate)) || createTcpMetrics();
    const rtt = summarizeRttSamples(metrics.rttSamples);
    const dnsResponseTime = summarizeRttSamples(metrics.dnsResponseTimeSamples);

    return {
      ...row,
      'TCP Retransmissions': metrics.retransmissions,
      'TCP Duplicate ACKs': metrics.duplicateAcks,
      'TCP Out-of-Order': metrics.outOfOrder,
      'TCP Zero-Window Stalls': metrics.zeroWindow,
      'TCP RTT Samples': rtt.count,
      'TCP RTT Min (ms)': rtt.minMs,
      'TCP RTT P50 (ms)': rtt.p50Ms,
      'TCP RTT P95 (ms)': rtt.p95Ms,
      'TCP RTT Max (ms)': rtt.maxMs,
      'DNS Response Samples': dnsResponseTime.count,
      'DNS Response P50 (ms)': dnsResponseTime.p50Ms,
      'DNS Response P95 (ms)': dnsResponseTime.p95Ms,
      'DNS Response Max (ms)': dnsResponseTime.maxMs,
    };
  });
}

function summarizeConversationMetrics(conversationMetrics) {
  let retransmissions = 0;
  let duplicateAcks = 0;
  let outOfOrder = 0;
  let zeroWindow = 0;
  const rttSamples = [];
  const dnsResponseTimeSamples = [];

  for (const metrics of conversationMetrics.values()) {
    retransmissions += metrics.retransmissions;
    duplicateAcks += metrics.duplicateAcks;
    outOfOrder += metrics.outOfOrder;
    zeroWindow += metrics.zeroWindow;
    rttSamples.push(...metrics.rttSamples);
    dnsResponseTimeSamples.push(...metrics.dnsResponseTimeSamples);
  }

  return {
    retransmissions,
    duplicateAcks,
    outOfOrder,
    zeroWindow,
    rttMs: summarizeRttSamples(rttSamples),
    dnsResponseTimeMs: summarizeRttSamples(dnsResponseTimeSamples),
  };
}

export function aggregatePacketRecords(records, opts = {}) {
  const baseAggregate = aggregatePacketRecordsBase(records, opts);
  const aggregate = opts.aggregate === 'ip' ? 'ip' : 'ip_port';
  const conversationMetrics = collectConversationTcpMetrics(records, aggregate);
  const rows = extendRowsWithTcpMetrics(baseAggregate.rows, conversationMetrics, aggregate);
  const verdict = scoreVerdict(rows, opts);

  return {
    rows,
    diagnostics: {
      ...baseAggregate.diagnostics,
      tcpAnalysis: summarizeConversationMetrics(conversationMetrics),
      verdict,
    },
  };
}

export async function parsePcapFile(filePath, opts = {}) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('parsePcapFile requires filePath');
  }

  let tsharkResult;
  try {
    tsharkResult = await (opts.runTshark
      ? { records: await opts.runTshark(filePath, opts), warnings: [], optionalFieldsEnabled: true }
      : runTsharkPacketFieldsWithMetadata(filePath, opts));
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }

  validateTsharkRecords(tsharkResult.records);
  const { rows, diagnostics } = aggregatePacketRecords(tsharkResult.records, opts);
  const warnings = [...diagnostics.warnings];
  if (tsharkResult.warnings?.length) warnings.push(...tsharkResult.warnings);

  return {
    parser: 'tshark',
    rows,
    diagnostics: {
      ...diagnostics,
      warnings,
      filePath,
      parserStatus: {
        ok: true,
        maxReadPackets: Number.isFinite(opts.maxReadPackets) ? opts.maxReadPackets : DEFAULT_MAX_READ_PACKETS,
        timeoutMs: Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_PARSE_TIMEOUT_MS,
        optionalFieldsEnabled: tsharkResult.optionalFieldsEnabled,
      },
    },
  };
}

export {
  DEFAULT_MAX_READ_PACKETS,
  DEFAULT_PARSE_TIMEOUT_MS,
  TSHARK_INSTALL_HINT,
};
