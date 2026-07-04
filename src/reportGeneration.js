import { gatherSystemDiagnostics } from './systemDiagnostics.js';

const DEFAULT_ANTHROPIC_MODEL = process.env.NETDOCTOR_ANTHROPIC_MODEL || 'claude-sonnet-5';
const DEFAULT_EXECUTIVE_SUMMARY_LIMIT = 5;

function toNumber(value) {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value) {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatInteger(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatMilliseconds(value) {
  if (value === null || value === undefined) return 'n/a';
  return `${Number(value).toFixed(Number.isInteger(value) ? 0 : 1)} ms`;
}

function sanitizeBulletList(items, maxItems = DEFAULT_EXECUTIVE_SUMMARY_LIMIT) {
  if (!Array.isArray(items)) return [];

  const seen = new Set();
  const bullets = [];
  for (const item of items) {
    const text = String(item ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    bullets.push(text);
    if (bullets.length >= maxItems) break;
  }

  return bullets;
}

function sanitizeParagraph(value) {
  const text = String(value ?? '').trim();
  return text || '';
}

function isIpv4InCidr(address, network, prefix) {
  const octets = String(address || '').trim().split('.').map((part) => Number(part));
  const networkOctets = network.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  let addressBits = 0;
  let networkBits = 0;
  for (let index = 0; index < 4; index += 1) {
    addressBits = (addressBits << 8) + octets[index];
    networkBits = (networkBits << 8) + networkOctets[index];
  }

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (addressBits & mask) === (networkBits & mask);
}

function isLocalAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  if (!value) return false;
  if (value === 'localhost' || value === '::1') return true;
  if (value.startsWith('fe80:')) return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (isIpv4InCidr(value, '10.0.0.0', 8)) return true;
  if (isIpv4InCidr(value, '172.16.0.0', 12)) return true;
  if (isIpv4InCidr(value, '192.168.0.0', 16)) return true;
  if (isIpv4InCidr(value, '169.254.0.0', 16)) return true;
  if (isIpv4InCidr(value, '127.0.0.0', 8)) return true;
  return false;
}

function isBroadcastOrMulticast(address) {
  const value = String(address || '').trim().toLowerCase();
  if (!value) return false;
  if (value === '255.255.255.255') return true;
  if (isIpv4InCidr(value, '224.0.0.0', 4)) return true;
  return value.startsWith('ff');
}

function resolveConversationPerspective(row) {
  const clientAddr = toText(row['Client Addr']);
  const serverAddr = toText(row['Server Addr']);
  if (!clientAddr || !serverAddr) return null;

  const clientIsLocal = isLocalAddress(clientAddr);
  const serverIsLocal = isLocalAddress(serverAddr);

  if (clientIsLocal && !serverIsLocal) {
    return {
      localAddress: clientAddr,
      localMac: toText(row['Client MAC']) || '-',
      remoteAddress: serverAddr,
      remoteLabel: serverAddr,
    };
  }

  if (serverIsLocal && !clientIsLocal) {
    return {
      localAddress: serverAddr,
      localMac: toText(row['Server MAC']) || '-',
      remoteAddress: clientAddr,
      remoteLabel: clientAddr,
    };
  }

  return {
    localAddress: clientAddr,
    localMac: toText(row['Client MAC']) || '-',
    remoteAddress: serverAddr,
    remoteLabel: serverAddr,
  };
}

function buildBandwidthHogs(rows, limit = 5) {
  return [...(rows || [])]
    .map((row) => {
      const perspective = resolveConversationPerspective(row);
      const clientBytes = toNumber(row['Client Bytes']);
      const serverBytes = toNumber(row['Server Bytes']);
      return {
        conversation: `${row['Client Addr']}:${row['Client Port']} ↔ ${row['Server Addr']}:${row['Server Port']}`,
        localAddress: perspective?.localAddress || null,
        remoteAddress: perspective?.remoteAddress || null,
        protocol: toText(row.Protocol) || 'unknown',
        packets: toNumber(row.Packets),
        clientBytes,
        serverBytes,
        totalBytes: clientBytes + serverBytes,
      };
    })
    .sort((left, right) => right.totalBytes - left.totalBytes || right.packets - left.packets)
    .slice(0, limit);
}

function buildTcpHealth(findingsRows, diagnostics, options = {}) {
  const rttOutlierThresholdMs = Number.isFinite(options.rttOutlierThresholdMs)
    ? options.rttOutlierThresholdMs
    : 200;

  const conversations = [...(findingsRows || [])]
    .map((row) => {
      const perspective = resolveConversationPerspective(row);
      return {
        conversation: `${row['Client Addr']}:${row['Client Port']} ↔ ${row['Server Addr']}:${row['Server Port']}`,
        localAddress: perspective?.localAddress || null,
        remoteAddress: perspective?.remoteAddress || null,
        retransmissions: toNumber(row['TCP Retransmissions']),
        duplicateAcks: toNumber(row['TCP Duplicate ACKs']),
        outOfOrder: toNumber(row['TCP Out-of-Order']),
        zeroWindowStalls: toNumber(row['TCP Zero-Window Stalls']),
        rttSamples: toNumber(row['TCP RTT Samples']),
        rttP95Ms: toNullableNumber(row['TCP RTT P95 (ms)']),
        rttMaxMs: toNullableNumber(row['TCP RTT Max (ms)']),
      };
    })
    .filter((row) => (
      row.retransmissions > 0
      || row.duplicateAcks > 0
      || row.outOfOrder > 0
      || row.zeroWindowStalls > 0
      || (row.rttP95Ms !== null && row.rttP95Ms >= rttOutlierThresholdMs)
      || (row.rttMaxMs !== null && row.rttMaxMs >= rttOutlierThresholdMs)
    ))
    .sort((left, right) => (
      (right.retransmissions - left.retransmissions)
      || (right.duplicateAcks - left.duplicateAcks)
      || (right.zeroWindowStalls - left.zeroWindowStalls)
      || ((right.rttMaxMs || 0) - (left.rttMaxMs || 0))
    ))
    .slice(0, 5);

  return {
    totals: {
      retransmissions: toNumber(diagnostics?.tcpAnalysis?.retransmissions),
      duplicateAcks: toNumber(diagnostics?.tcpAnalysis?.duplicateAcks),
      outOfOrder: toNumber(diagnostics?.tcpAnalysis?.outOfOrder),
      zeroWindowStalls: toNumber(diagnostics?.tcpAnalysis?.zeroWindow),
      rttMs: diagnostics?.tcpAnalysis?.rttMs || {
        count: 0,
        minMs: null,
        p50Ms: null,
        p95Ms: null,
        maxMs: null,
      },
    },
    affectedConversations: conversations,
  };
}

function buildRttOutliers(rows, options = {}) {
  const thresholdMs = Number.isFinite(options.rttOutlierThresholdMs)
    ? options.rttOutlierThresholdMs
    : 200;

  const conversations = [...(rows || [])]
    .map((row) => {
      const perspective = resolveConversationPerspective(row);
      return {
        conversation: `${row['Client Addr']}:${row['Client Port']} ↔ ${row['Server Addr']}:${row['Server Port']}`,
        localAddress: perspective?.localAddress || null,
        remoteAddress: perspective?.remoteAddress || null,
        rttSamples: toNumber(row['TCP RTT Samples']),
        rttP50Ms: toNullableNumber(row['TCP RTT P50 (ms)']),
        rttP95Ms: toNullableNumber(row['TCP RTT P95 (ms)']),
        rttMaxMs: toNullableNumber(row['TCP RTT Max (ms)']),
      };
    })
    .filter((row) => (
      (row.rttP95Ms !== null && row.rttP95Ms >= thresholdMs)
      || (row.rttMaxMs !== null && row.rttMaxMs >= thresholdMs)
    ))
    .sort((left, right) => (right.rttMaxMs || 0) - (left.rttMaxMs || 0))
    .slice(0, 5);

  return {
    thresholdMs,
    conversations,
  };
}

function buildDnsSummary(rows, options = {}) {
  const slowThresholdMs = Number.isFinite(options.dnsSlowThresholdMs) ? options.dnsSlowThresholdMs : 100;
  const dnsRows = [...(rows || [])].filter((row) => String(row.Protocol || '').toLowerCase() === 'dns');
  const packets = dnsRows.reduce((sum, row) => sum + toNumber(row.Packets), 0);
  const bytes = dnsRows.reduce((sum, row) => sum + toNumber(row['Client Bytes']) + toNumber(row['Server Bytes']), 0);
  const responseSamples = dnsRows.reduce((sum, row) => sum + toNumber(row['DNS Response Samples']), 0);

  const slowConversations = dnsRows
    .map((row) => {
      const perspective = resolveConversationPerspective(row);
      return {
        conversation: `${row['Client Addr']}:${row['Client Port']} ↔ ${row['Server Addr']}:${row['Server Port']}`,
        localAddress: perspective?.localAddress || null,
        remoteAddress: perspective?.remoteAddress || null,
        responseSamples: toNumber(row['DNS Response Samples']),
        responseP50Ms: toNullableNumber(row['DNS Response P50 (ms)']),
        responseP95Ms: toNullableNumber(row['DNS Response P95 (ms)']),
        responseMaxMs: toNullableNumber(row['DNS Response Max (ms)']),
      };
    })
    .filter((row) => (
      (row.responseP95Ms !== null && row.responseP95Ms >= slowThresholdMs)
      || (row.responseMaxMs !== null && row.responseMaxMs >= slowThresholdMs)
    ))
    .sort((left, right) => (right.responseMaxMs || 0) - (left.responseMaxMs || 0))
    .slice(0, 5);

  return {
    conversations: dnsRows.length,
    packets,
    bytes,
    timingSupported: responseSamples > 0,
    slowThresholdMs,
    slowConversations,
  };
}

function buildBroadcastNoise(rows) {
  const noisyRows = [...(rows || [])]
    .map((row) => ({
      destination: toText(row['Server Addr']),
      source: toText(row['Client Addr']),
      protocol: toText(row.Protocol) || 'unknown',
      packets: toNumber(row.Packets),
      totalBytes: toNumber(row['Client Bytes']) + toNumber(row['Server Bytes']),
    }))
    .filter((row) => isBroadcastOrMulticast(row.destination) || isBroadcastOrMulticast(row.source))
    .sort((left, right) => right.totalBytes - left.totalBytes || right.packets - left.packets)
    .slice(0, 5);

  return {
    conversations: noisyRows.length,
    packets: noisyRows.reduce((sum, row) => sum + row.packets, 0),
    bytes: noisyRows.reduce((sum, row) => sum + row.totalBytes, 0),
    topConversations: noisyRows,
  };
}

function buildChattyDevices(rows) {
  const devices = new Map();

  for (const row of rows || []) {
    const perspective = resolveConversationPerspective(row);
    if (!perspective?.localAddress) continue;

    const key = perspective.localMac && perspective.localMac !== '-'
      ? perspective.localMac
      : perspective.localAddress;

    const current = devices.get(key) || {
      device: key,
      localAddress: perspective.localAddress,
      conversations: 0,
      packets: 0,
      bytes: 0,
      destinations: new Set(),
    };

    current.conversations += 1;
    current.packets += toNumber(row.Packets);
    current.bytes += toNumber(row['Client Bytes']) + toNumber(row['Server Bytes']);
    if (perspective.remoteAddress) current.destinations.add(perspective.remoteAddress);
    devices.set(key, current);
  }

  const sorted = [...devices.values()]
    .map((device) => ({
      device: device.device,
      localAddress: device.localAddress,
      conversations: device.conversations,
      packets: device.packets,
      bytes: device.bytes,
      distinctDestinations: device.destinations.size,
    }))
    .sort((left, right) => right.packets - left.packets || right.bytes - left.bytes)
    .slice(0, 5);

  const flagged = sorted.filter((device) => device.conversations >= 3 || device.packets >= 20 || device.distinctDestinations >= 3);

  return {
    flagged,
    topDevices: sorted,
  };
}

export function buildStructuredFindings(parsedCapture, options = {}) {
  const rows = Array.isArray(parsedCapture?.rows) ? parsedCapture.rows : [];
  const diagnostics = parsedCapture?.diagnostics || {};
  const bandwidthHogs = buildBandwidthHogs(rows, options.bandwidthHogLimit || 5);
  const tcpHealth = buildTcpHealth(rows, diagnostics, options);
  const rttOutliers = buildRttOutliers(rows, options);
  const dnsSlowness = buildDnsSummary(rows, options);
  const broadcastNoise = buildBroadcastNoise(rows);
  const chattyDevices = buildChattyDevices(rows);

  return {
    generatedAt: options.generatedAt || new Date().toISOString(),
    capture: {
      filePath: toText(diagnostics.filePath),
      packetCount: toNumber(diagnostics.packetCount),
      conversationCount: toNumber(diagnostics.conversationCount),
      warnings: Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [],
      parserStatus: diagnostics.parserStatus || null,
      protocolBreakdown: Array.isArray(diagnostics.protocolBreakdown) ? diagnostics.protocolBreakdown : [],
    },
    verdict: {
      headline: toText(diagnostics?.verdict?.verdict) || 'Inconclusive',
      confidence: toText(diagnostics?.verdict?.confidence) || 'Low',
      rationale: toText(diagnostics?.verdict?.rationale) || 'Confidence: Low - verdict data unavailable.',
      summary: diagnostics?.verdict?.summary || {},
    },
    bandwidthHogs,
    tcpHealth,
    rttOutliers,
    dnsSlowness,
    broadcastNoise,
    chattyDevices,
  };
}

export function buildNarrativePrompt(findings) {
  return [
    'You are writing a network slowdown diagnostic report.',
    'Use only the structured evidence in the JSON payload.',
    'Do not invent causes, vendors, or remediation beyond what the evidence supports.',
    'If a metric is unavailable, say that directly instead of guessing.',
    'Do not mention raw packets, packet payloads, or claim packet inspection beyond the provided summary.',
    'Return valid JSON with this shape only:',
    '{"executiveSummary":["3 to 5 bullets"],"sections":{"overview":"...","bandwidthHogs":"...","tcpHealth":"...","rttOutliers":"...","dnsSlowness":"...","broadcastNoise":"...","chattyDevices":"...","systemDiagnostics":"..."}}',
    '',
    JSON.stringify(findings, null, 2),
  ].join('\n');
}

function fallbackOverview(findings) {
  return `The report leads with a ${findings.verdict.headline} verdict. ${findings.verdict.rationale}`;
}

function describeTarget(target) {
  const parts = [];

  if (target.ping?.ok) {
    parts.push(`ping to ${target.host} showed ${formatInteger(target.ping.packetLossPercent ?? 0)}% packet loss and ${formatMilliseconds(target.ping.rttAvgMs)} average RTT`);
  } else if (target.ping) {
    parts.push(`ping to ${target.host} did not complete (${target.ping.error || 'unavailable'})`);
  }

  if (target.traceroute?.ok) {
    const lastHop = target.traceroute.hops[target.traceroute.hops.length - 1];
    const lastHopLabel = lastHop?.host || lastHop?.address || 'an unresolved hop';
    parts.push(`traceroute reached ${target.host} in ${formatInteger(target.traceroute.hopCount)} hops, last hop ${lastHopLabel}${target.traceroute.timedOutHopCount ? ` (${formatInteger(target.traceroute.timedOutHopCount)} hop(s) did not respond)` : ''}`);
  } else if (target.traceroute) {
    parts.push(`traceroute to ${target.host} did not complete (${target.traceroute.error || 'unavailable'})`);
  }

  return parts.length ? `For ${target.host}: ${parts.join('; ')}.` : null;
}

function describeSystemDiagnostics(findings) {
  const diagnostics = findings.systemDiagnostics;
  if (!diagnostics) {
    return 'System-level diagnostics (ping, traceroute, netstat) were not run for this report.';
  }

  const parts = [];
  const targetDescriptions = (diagnostics.targets || []).map(describeTarget).filter(Boolean);
  if (targetDescriptions.length) {
    parts.push(...targetDescriptions);
  } else if (diagnostics.skippedReason) {
    parts.push(diagnostics.skippedReason);
  }

  const netstat = diagnostics.localNetstat;
  if (netstat?.interfacesSupported) {
    const noisyInterfaces = (netstat.interfaces || []).filter((iface) => iface.inputErrors > 0 || iface.outputErrors > 0 || iface.collisions > 0);
    parts.push(noisyInterfaces.length
      ? `Local interface counters show errors on: ${noisyInterfaces.map((iface) => `${iface.name} (${formatInteger(iface.inputErrors)} input, ${formatInteger(iface.outputErrors)} output errors)`).join(', ')}.`
      : 'Local network interface counters show no input/output errors or collisions.');
  }
  if (netstat?.protocolStatsSupported && netstat.protocolStats?.retransmitTimeouts) {
    parts.push(`The local TCP stack recorded ${formatInteger(netstat.protocolStats.retransmitTimeouts)} retransmit timeouts since counters were last reset.`);
  }

  return parts.length ? parts.join(' ') : 'System-level diagnostics did not surface additional corroborating evidence.';
}

function createFallbackNarrative(findings) {
  const bandwidthLead = findings.bandwidthHogs[0];
  const topRtt = findings.rttOutliers.conversations[0];
  const noisyDevice = findings.chattyDevices.flagged[0] || findings.chattyDevices.topDevices[0];

  const executiveSummary = sanitizeBulletList([
    `${findings.verdict.headline} with ${findings.verdict.confidence.toLowerCase()} confidence. ${findings.verdict.rationale}`,
    bandwidthLead
      ? `Top bandwidth conversation: ${bandwidthLead.conversation} moved ${formatBytes(bandwidthLead.totalBytes)} across ${formatInteger(bandwidthLead.packets)} packets.`
      : 'No high-volume conversation stood out in the aggregated sample.',
    findings.tcpHealth.totals.retransmissions > 0 || findings.tcpHealth.totals.duplicateAcks > 0 || findings.tcpHealth.totals.zeroWindowStalls > 0
      ? `TCP health signals included ${formatInteger(findings.tcpHealth.totals.retransmissions)} retransmissions, ${formatInteger(findings.tcpHealth.totals.duplicateAcks)} duplicate ACKs, and ${formatInteger(findings.tcpHealth.totals.zeroWindowStalls)} zero-window stalls.`
      : 'The aggregated sample did not show retransmissions, duplicate ACK clusters, or zero-window stalls.',
    topRtt
      ? `Worst RTT outlier observed: ${topRtt.conversation} peaked at ${formatMilliseconds(topRtt.rttMaxMs)}.`
      : 'No conversation crossed the current RTT outlier threshold.',
    noisyDevice
      ? `Most chatty local device: ${noisyDevice.device} touched ${formatInteger(noisyDevice.distinctDestinations || 0)} destinations.`
      : 'No local device crossed the current chatter threshold.',
  ]);

  return {
    source: 'fallback',
    executiveSummary,
    sections: {
      overview: fallbackOverview(findings),
      bandwidthHogs: bandwidthLead
        ? `Bandwidth concentration was highest on ${bandwidthLead.conversation}, which accounted for ${formatBytes(bandwidthLead.totalBytes)} over ${formatInteger(bandwidthLead.packets)} packets.`
        : 'Bandwidth usage was distributed enough that no single conversation dominated the sample.',
      tcpHealth: findings.tcpHealth.affectedConversations.length
        ? `TCP health issues were visible in ${formatInteger(findings.tcpHealth.affectedConversations.length)} aggregated conversations, led by retransmissions, duplicate ACKs, and zero-window stalls (${formatInteger(findings.tcpHealth.totals.zeroWindowStalls)} observed).`
        : 'No conversation crossed the current TCP health issue thresholds, including zero-window stalls.',
      rttOutliers: topRtt
        ? `RTT outliers were concentrated on ${topRtt.conversation}, with a worst observed RTT of ${formatMilliseconds(topRtt.rttMaxMs)}.`
        : 'No RTT outlier crossed the configured threshold in this sample.',
      dnsSlowness: (() => {
        const slowLead = findings.dnsSlowness.slowConversations[0];
        if (slowLead) {
          return `Slow DNS responses were observed for ${slowLead.conversation}, with a worst observed response time of ${formatMilliseconds(slowLead.responseMaxMs)}.`;
        }
        if (findings.dnsSlowness.timingSupported) {
          return `DNS traffic accounted for ${formatInteger(findings.dnsSlowness.packets)} packets across ${formatInteger(findings.dnsSlowness.conversations)} conversations; no response crossed the ${formatInteger(findings.dnsSlowness.slowThresholdMs)} ms slow-response threshold.`;
        }
        return `DNS traffic accounted for ${formatInteger(findings.dnsSlowness.packets)} packets, but no DNS response/query pairs with timing data were captured, so no DNS slowdown claim is made.`;
      })(),
      broadcastNoise: findings.broadcastNoise.conversations > 0
        ? `Broadcast or multicast traffic accounted for ${formatInteger(findings.broadcastNoise.packets)} packets in the sample.`
        : 'Broadcast and multicast traffic did not stand out in the aggregated conversations.',
      chattyDevices: noisyDevice
        ? `The busiest local device was ${noisyDevice.device}, responsible for ${formatInteger(noisyDevice.packets)} packets across ${formatInteger(noisyDevice.conversations)} conversations.`
        : 'No local device crossed the current chatty-device thresholds.',
      systemDiagnostics: describeSystemDiagnostics(findings),
    },
  };
}

function extractAnthropicText(responseJson) {
  const content = Array.isArray(responseJson?.content) ? responseJson.content : [];
  const textBlock = content.find((block) => block?.type === 'text' && typeof block.text === 'string');
  return textBlock?.text || null;
}

function stripJsonCodeFence(text) {
  const trimmed = String(text ?? '').trim();

  // Look for a fenced block anywhere in the text, not just one spanning the
  // whole string -- models sometimes add a preamble/postamble around it
  // despite being asked for JSON only.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();

  // No fence at all: fall back to the outermost {...} span, in case there's
  // stray prose around raw (unfenced) JSON.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function validateNarrative(candidate, findings) {
  const executiveSummary = sanitizeBulletList(candidate?.executiveSummary);
  const sections = candidate?.sections && typeof candidate.sections === 'object'
    ? candidate.sections
    : {};

  const normalized = {
    source: candidate?.source || 'claude',
    executiveSummary: executiveSummary.length
      ? executiveSummary
      : createFallbackNarrative(findings).executiveSummary,
    sections: {
      overview: sanitizeParagraph(sections.overview),
      bandwidthHogs: sanitizeParagraph(sections.bandwidthHogs),
      tcpHealth: sanitizeParagraph(sections.tcpHealth),
      rttOutliers: sanitizeParagraph(sections.rttOutliers),
      dnsSlowness: sanitizeParagraph(sections.dnsSlowness),
      broadcastNoise: sanitizeParagraph(sections.broadcastNoise),
      chattyDevices: sanitizeParagraph(sections.chattyDevices),
      systemDiagnostics: sanitizeParagraph(sections.systemDiagnostics),
    },
  };

  const fallback = createFallbackNarrative(findings);
  for (const key of Object.keys(normalized.sections)) {
    if (!normalized.sections[key]) normalized.sections[key] = fallback.sections[key];
  }

  return normalized;
}

export async function generateNarrativeWithClaude(findings, options = {}) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return createFallbackNarrative(findings);

  const model = options.model || DEFAULT_ANTHROPIC_MODEL;
  const prompt = buildNarrativePrompt(findings);
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Claude narrative generation failed: ${response.status} ${message}`);
  }

  const responseJson = await response.json();
  const text = extractAnthropicText(responseJson);
  if (!text) throw new Error('Claude narrative generation returned no text content');
  if (responseJson?.stop_reason === 'max_tokens') {
    throw new Error('Claude narrative generation was truncated (hit max_tokens before finishing); raise max_tokens or shorten the findings payload');
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(stripJsonCodeFence(text));
  } catch (error) {
    throw new Error(`Claude narrative generation returned invalid JSON: ${error.message}`);
  }

  return validateNarrative({ ...parsedJson, source: 'claude' }, findings);
}

function renderMetricPills(findings) {
  const items = [
    `Packets: ${formatInteger(findings.capture.packetCount)}`,
    `Conversations: ${formatInteger(findings.capture.conversationCount)}`,
    `Retransmissions: ${formatInteger(findings.tcpHealth.totals.retransmissions)}`,
    `RTT p95: ${formatMilliseconds(findings.tcpHealth.totals.rttMs?.p95Ms ?? null)}`,
  ];

  return items.map((item) => (
    `<span style="display:inline-block;margin:0 8px 8px 0;padding:8px 12px;border:1px solid #d6dde8;border-radius:999px;background:#f7fafc;font-size:12px;color:#334155;">${escapeHtml(item)}</span>`
  )).join('');
}

function renderSummaryList(items) {
  return items.map((item) => (
    `<li style="margin:0 0 10px 0;">${escapeHtml(item)}</li>`
  )).join('');
}

function renderTable(headers, rows) {
  const headerHtml = headers.map((header) => (
    `<th align="left" style="padding:10px 12px;border-bottom:1px solid #d6dde8;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#475569;">${escapeHtml(header)}</th>`
  )).join('');

  const rowHtml = rows.map((row) => (
    `<tr>${row.map((cell) => (
      `<td style="padding:10px 12px;border-bottom:1px solid #e8edf3;font-size:14px;color:#0f172a;vertical-align:top;">${escapeHtml(cell)}</td>`
    )).join('')}</tr>`
  )).join('');

  return [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #d6dde8;border-radius:14px;overflow:hidden;">',
    `<thead><tr style="background:#f8fafc;">${headerHtml}</tr></thead>`,
    `<tbody>${rowHtml || '<tr><td colspan="4" style="padding:12px;color:#475569;">No items in this section.</td></tr>'}</tbody>`,
    '</table>',
  ].join('');
}

function renderSection(title, narrative, contentHtml) {
  return [
    '<tr><td style="padding:0 32px 24px 32px;">',
    `<h2 style="margin:0 0 10px 0;font-size:20px;line-height:28px;color:#0f172a;">${escapeHtml(title)}</h2>`,
    `<p style="margin:0 0 16px 0;font-size:15px;line-height:24px;color:#334155;">${escapeHtml(narrative)}</p>`,
    contentHtml,
    '</td></tr>',
  ].join('');
}

export function renderReportHtml({ findings, narrative }) {
  const bandwidthTable = renderTable(
    ['Conversation', 'Protocol', 'Bytes', 'Packets'],
    findings.bandwidthHogs.map((item) => [
      item.conversation,
      item.protocol,
      formatBytes(item.totalBytes),
      formatInteger(item.packets),
    ]),
  );

  const tcpTable = renderTable(
    ['Conversation', 'Retrans', 'Dup ACK', 'Zero-Window', 'RTT p95', 'RTT max'],
    findings.tcpHealth.affectedConversations.map((item) => [
      item.conversation,
      formatInteger(item.retransmissions),
      formatInteger(item.duplicateAcks),
      formatInteger(item.zeroWindowStalls),
      formatMilliseconds(item.rttP95Ms),
      formatMilliseconds(item.rttMaxMs),
    ]),
  );

  const dnsTable = renderTable(
    ['Conversation', 'Samples', 'Response p50', 'Response max'],
    findings.dnsSlowness.slowConversations.map((item) => [
      item.conversation,
      formatInteger(item.responseSamples),
      formatMilliseconds(item.responseP50Ms),
      formatMilliseconds(item.responseMaxMs),
    ]),
  );

  const rttTable = renderTable(
    ['Conversation', 'RTT p50', 'RTT p95', 'RTT max'],
    findings.rttOutliers.conversations.map((item) => [
      item.conversation,
      formatMilliseconds(item.rttP50Ms),
      formatMilliseconds(item.rttP95Ms),
      formatMilliseconds(item.rttMaxMs),
    ]),
  );

  const pingTable = renderTable(
    ['Target', 'Loss', 'RTT avg', 'RTT max'],
    (findings.systemDiagnostics?.targets || [])
      .filter((target) => target.ping?.ok)
      .map((target) => [
        target.host,
        `${formatInteger(target.ping.packetLossPercent ?? 0)}%`,
        formatMilliseconds(target.ping.rttAvgMs),
        formatMilliseconds(target.ping.rttMaxMs),
      ]),
  );

  const tracerouteTable = renderTable(
    ['Target', 'Hops', 'Timed-out Hops', 'Last Hop'],
    (findings.systemDiagnostics?.targets || [])
      .filter((target) => target.traceroute?.ok)
      .map((target) => {
        const lastHop = target.traceroute.hops[target.traceroute.hops.length - 1];
        return [
          target.host,
          formatInteger(target.traceroute.hopCount),
          formatInteger(target.traceroute.timedOutHopCount),
          lastHop?.host || lastHop?.address || 'n/a',
        ];
      }),
  );

  const netstatInterfaceTable = renderTable(
    ['Interface', 'Input Errors', 'Output Errors', 'Collisions'],
    (findings.systemDiagnostics?.localNetstat?.interfaces || [])
      .filter((iface) => iface.inputErrors > 0 || iface.outputErrors > 0 || iface.collisions > 0)
      .map((iface) => [
        iface.name,
        formatInteger(iface.inputErrors),
        formatInteger(iface.outputErrors),
        formatInteger(iface.collisions),
      ]),
  );

  const broadcastTable = renderTable(
    ['Source', 'Destination', 'Protocol', 'Packets'],
    findings.broadcastNoise.topConversations.map((item) => [
      item.source || 'n/a',
      item.destination || 'n/a',
      item.protocol,
      formatInteger(item.packets),
    ]),
  );

  const chattyTable = renderTable(
    ['Device', 'Conversations', 'Packets', 'Destinations'],
    (findings.chattyDevices.flagged.length ? findings.chattyDevices.flagged : findings.chattyDevices.topDevices).map((item) => [
      item.device,
      formatInteger(item.conversations),
      formatInteger(item.packets),
      formatInteger(item.distinctDestinations),
    ]),
  );

  const protocolRows = findings.capture.protocolBreakdown.slice(0, 5).map((item) => (
    `<li style="margin:0 0 8px 0;">${escapeHtml(item.protocol)}: ${escapeHtml(formatInteger(item.packets))} packets / ${escapeHtml(formatBytes(item.bytes))}</li>`
  )).join('');

  const warningsHtml = findings.capture.warnings.length
    ? `<p style="margin:12px 0 0 0;font-size:13px;line-height:20px;color:#92400e;"><strong>Warnings:</strong> ${escapeHtml(findings.capture.warnings.join(' | '))}</p>`
    : '';

  const dnsEvidence = findings.dnsSlowness.timingSupported
    ? `DNS conversations: ${formatInteger(findings.dnsSlowness.conversations)}. Slow-response threshold: ${formatInteger(findings.dnsSlowness.slowThresholdMs)} ms.`
    : `DNS packets observed: ${formatInteger(findings.dnsSlowness.packets)}. No DNS query/response pairs with timing data were captured.`;

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '<title>e3d netdoctor report</title>',
    '</head>',
    '<body style="margin:0;padding:0;background:#edf3f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf3f7;">',
    '<tr><td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:860px;background:#ffffff;border-collapse:collapse;border-radius:22px;overflow:hidden;border:1px solid #d6dde8;">',
    '<tr><td style="padding:32px;background:linear-gradient(135deg,#0f172a 0%,#17485e 55%,#1e6d73 100%);color:#ffffff;">',
    '<p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#b8d7df;">e3d netdoctor report</p>',
    `<h1 style="margin:0 0 12px 0;font-size:30px;line-height:38px;">${escapeHtml(findings.verdict.headline)}</h1>`,
    `<p style="margin:0 0 16px 0;font-size:16px;line-height:25px;color:#dcecf1;">${escapeHtml(findings.verdict.rationale)}</p>`,
    `<div>${renderMetricPills(findings)}</div>`,
    '</td></tr>',
    '<tr><td style="padding:28px 32px 24px 32px;">',
    '<h2 style="margin:0 0 12px 0;font-size:22px;line-height:30px;color:#0f172a;">Executive Summary</h2>',
    `<ul style="margin:0;padding-left:20px;font-size:15px;line-height:24px;color:#334155;">${renderSummaryList(narrative.executiveSummary)}</ul>`,
    '</td></tr>',
    renderSection('Capture Overview', narrative.sections.overview, [
      `<p style="margin:0 0 12px 0;font-size:14px;line-height:22px;color:#475569;">Source: ${escapeHtml(findings.capture.filePath || 'live capture')}<br />Generated: ${escapeHtml(findings.generatedAt)}</p>`,
      `<ul style="margin:0;padding-left:20px;font-size:14px;line-height:22px;color:#475569;">${protocolRows}</ul>`,
      warningsHtml,
    ].join('')),
    renderSection('Bandwidth Hogs', narrative.sections.bandwidthHogs, bandwidthTable),
    renderSection('TCP Health', narrative.sections.tcpHealth, [
      '<p style="margin:0 0 12px 0;font-size:14px;line-height:22px;color:#475569;">',
      `Retransmissions: ${escapeHtml(formatInteger(findings.tcpHealth.totals.retransmissions))} | `,
      `Duplicate ACKs: ${escapeHtml(formatInteger(findings.tcpHealth.totals.duplicateAcks))} | `,
      `Out-of-order: ${escapeHtml(formatInteger(findings.tcpHealth.totals.outOfOrder))} | `,
      `Zero-window stalls: ${escapeHtml(formatInteger(findings.tcpHealth.totals.zeroWindowStalls))}`,
      '</p>',
      tcpTable,
    ].join('')),
    renderSection('RTT Outliers', narrative.sections.rttOutliers, rttTable),
    renderSection('DNS Performance', narrative.sections.dnsSlowness, [
      `<p style="margin:0 0 12px 0;font-size:14px;line-height:22px;color:#475569;">${escapeHtml(dnsEvidence)}</p>`,
      dnsTable,
    ].join('')),
    renderSection('Broadcast & Multicast Noise', narrative.sections.broadcastNoise, broadcastTable),
    renderSection('Chatty Devices', narrative.sections.chattyDevices, chattyTable),
    renderSection('System Diagnostics (ping/traceroute/netstat)', narrative.sections.systemDiagnostics, [
      '<p style="margin:0 0 12px 0;font-size:13px;line-height:20px;color:#475569;">Supplementary host-level checks, independent of the packet capture, used to corroborate the verdict above.</p>',
      pingTable,
      tracerouteTable,
      netstatInterfaceTable,
    ].join('')),
    '<tr><td style="padding:0 32px 32px 32px;">',
    '<p style="margin:0;font-size:12px;line-height:18px;color:#64748b;">This report is based on aggregated conversation metrics only. No raw packet payload data is rendered in the report.</p>',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('');
}

export async function generateReport(parsedCapture, options = {}) {
  const findings = buildStructuredFindings(parsedCapture, options);

  if (options.systemDiagnostics !== false) {
    const gatherDiagnostics = options.gatherSystemDiagnostics || gatherSystemDiagnostics;
    findings.systemDiagnostics = await gatherDiagnostics(findings, options);
  }

  const narrativeGenerator = options.generateNarrative || generateNarrativeWithClaude;
  let narrativeResult;
  try {
    narrativeResult = await narrativeGenerator(findings, options);
  } catch (error) {
    if (options.strictNarrative) throw error;
    narrativeResult = {
      ...createFallbackNarrative(findings),
      source: 'fallback',
      warning: String(error?.message || error),
    };
  }

  const narrative = validateNarrative(narrativeResult, findings);
  const html = renderReportHtml({ findings, narrative });

  return {
    findings,
    narrative,
    html,
  };
}
