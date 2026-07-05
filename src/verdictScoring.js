function toInt(value) {
  const number = Number(String(value ?? '').trim());
  return Number.isFinite(number) ? number : 0;
}

function toNullableNumber(value) {
  const number = Number(String(value ?? '').trim());
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeProviderKey(metadata = {}) {
  const asn = normalizeText(metadata.asn);
  if (asn) return `asn:${asn}`;

  const provider = normalizeText(metadata.provider);
  if (provider) return `provider:${provider.toLowerCase()}`;

  return null;
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
  if (value === 'localhost') return true;
  if (value === '::1') return true;
  if (value.startsWith('fe80:')) return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (isIpv4InCidr(value, '10.0.0.0', 8)) return true;
  if (isIpv4InCidr(value, '172.16.0.0', 12)) return true;
  if (isIpv4InCidr(value, '192.168.0.0', 16)) return true;
  if (isIpv4InCidr(value, '169.254.0.0', 16)) return true;
  if (isIpv4InCidr(value, '127.0.0.0', 8)) return true;
  return false;
}

function resolveLocalAndExternalEndpoints(row) {
  const clientAddr = normalizeText(row['Client Addr']);
  const serverAddr = normalizeText(row['Server Addr']);
  if (!clientAddr || !serverAddr) return null;

  const clientIsLocal = isLocalAddress(clientAddr);
  const serverIsLocal = isLocalAddress(serverAddr);
  if (clientIsLocal === serverIsLocal) return null;

  if (clientIsLocal) {
    return {
      localAddress: clientAddr,
      localMac: normalizeText(row['Client MAC']),
      externalAddress: serverAddr,
    };
  }

  return {
    localAddress: serverAddr,
    localMac: normalizeText(row['Server MAC']),
    externalAddress: clientAddr,
  };
}

function resolveDestinationMetadata(row, externalAddress, options = {}) {
  const metadataFromMap = options.destinationMetadata?.[externalAddress] || {};
  const provider = normalizeText(
    metadataFromMap.provider
    ?? row['Destination Provider']
    ?? row['Server Provider']
    ?? row.Provider
  );
  const asn = normalizeText(
    metadataFromMap.asn
    ?? row['Destination ASN']
    ?? row['Server ASN']
    ?? row.ASN
  );

  return {
    provider,
    asn,
    providerKey: normalizeProviderKey({ provider, asn }),
  };
}

function buildConversationSignal(row, options = {}) {
  const retransmissions = toInt(row['TCP Retransmissions']);
  const duplicateAcks = toInt(row['TCP Duplicate ACKs']);
  const outOfOrder = toInt(row['TCP Out-of-Order']);
  const rttP95Ms = toNullableNumber(row['TCP RTT P95 (ms)']);
  const rttMaxMs = toNullableNumber(row['TCP RTT Max (ms)']);
  const rttOutlierThresholdMs = Number.isFinite(options.rttOutlierThresholdMs)
    ? options.rttOutlierThresholdMs
    : 200;
  const hasRttOutlier = (
    (rttP95Ms !== null && rttP95Ms >= rttOutlierThresholdMs)
    || (rttMaxMs !== null && rttMaxMs >= rttOutlierThresholdMs)
  );

  const score = (retransmissions * 3) + duplicateAcks + outOfOrder + (hasRttOutlier ? 2 : 0);

  return {
    retransmissions,
    duplicateAcks,
    outOfOrder,
    hasRttOutlier,
    score,
    affected: score > 0,
  };
}

function createSummary() {
  return {
    totalConversations: 0,
    eligibleConversations: 0,
    eligibleDestinations: new Set(),
    affectedDestinations: new Map(),
    affectedLocals: new Map(),
    knownProvidersAffected: new Set(),
    totalAffectedSignal: 0,
    affectedConversations: 0,
  };
}

function getOrCreateDestination(summary, destinationKey, metadata) {
  const current = summary.affectedDestinations.get(destinationKey) || {
    signal: 0,
    conversations: 0,
    providers: new Set(),
    metadata,
  };
  summary.affectedDestinations.set(destinationKey, current);
  return current;
}

function getOrCreateLocal(summary, localMac) {
  const current = summary.affectedLocals.get(localMac) || {
    signal: 0,
    conversations: 0,
    destinations: new Set(),
  };
  summary.affectedLocals.set(localMac, current);
  return current;
}

function summarizeRows(rows, options = {}) {
  const summary = createSummary();

  for (const row of rows || []) {
    summary.totalConversations += 1;
    const endpoints = resolveLocalAndExternalEndpoints(row);
    if (!endpoints?.externalAddress) continue;

    summary.eligibleConversations += 1;
    summary.eligibleDestinations.add(endpoints.externalAddress);

    const signal = buildConversationSignal(row, options);
    if (!signal.affected) continue;

    const metadata = resolveDestinationMetadata(row, endpoints.externalAddress, options);
    const destination = getOrCreateDestination(summary, endpoints.externalAddress, metadata);
    destination.signal += signal.score;
    destination.conversations += 1;
    if (metadata.providerKey) {
      destination.providers.add(metadata.providerKey);
      summary.knownProvidersAffected.add(metadata.providerKey);
    }

    const localKey = endpoints.localMac || `addr:${endpoints.localAddress}`;
    const local = getOrCreateLocal(summary, localKey);
    local.signal += signal.score;
    local.conversations += 1;
    local.destinations.add(endpoints.externalAddress);

    summary.totalAffectedSignal += signal.score;
    summary.affectedConversations += 1;
  }

  return summary;
}

function pickDominantLocal(summary) {
  let dominant = null;
  for (const [key, value] of summary.affectedLocals.entries()) {
    if (!dominant || value.signal > dominant.signal) {
      dominant = { key, ...value };
    }
  }
  return dominant;
}

function confidenceLevelFromAffectedShare(share, highThreshold = 0.75, mediumThreshold = 0.6) {
  if (share >= highThreshold) return 'High';
  if (share >= mediumThreshold) return 'Medium';
  return 'Low';
}

function formatProviderCount(summary) {
  const count = summary.knownProvidersAffected.size;
  if (!count) return 'provider data unavailable';
  return `${count} ${count === 1 ? 'provider' : 'providers'}`;
}

function classifyBestGuess(summary, reason) {
  const destinations = summary.eligibleDestinations.size;
  const conversations = summary.eligibleConversations;
  const affectedDestinations = summary.affectedDestinations.size;
  const dominantLocal = pickDominantLocal(summary);
  const dominantLocalShare = dominantLocal && summary.totalAffectedSignal > 0
    ? dominantLocal.signal / summary.totalAffectedSignal
    : 0;

  const baseSummary = {
    eligibleDestinations: destinations,
    eligibleConversations: conversations,
    affectedDestinations,
    affectedConversations: summary.affectedConversations,
    providersAffected: summary.knownProvidersAffected.size,
  };

  if (dominantLocalShare >= 0.5) {
    return {
      verdict: 'Likely local',
      confidence: 'Low',
      rationale: `Confidence: Low - ${reason}; the closest match is one local device (${dominantLocal.key}) accounting for ${Math.round(dominantLocalShare * 100)}% of the affected signal (${destinations} external ${destinations === 1 ? 'destination' : 'destinations'}, ${conversations} eligible ${conversations === 1 ? 'conversation' : 'conversations'}).`,
      summary: {
        ...baseSummary,
        dominantLocal: dominantLocal.key,
        dominantLocalShare: Number(dominantLocalShare.toFixed(3)),
      },
    };
  }

  if (affectedDestinations >= 3) {
    return {
      verdict: 'Likely upstream/ISP',
      confidence: 'Low',
      rationale: `Confidence: Low - ${reason}; the closest match is signal spread across ${affectedDestinations} destinations (${formatProviderCount(summary)}) with no single local device dominating.`,
      summary: {
        ...baseSummary,
        dominantLocal: dominantLocal?.key || null,
        dominantLocalShare: Number(dominantLocalShare.toFixed(3)),
      },
    };
  }

  return {
    verdict: 'Likely destination/path-specific',
    confidence: 'Low',
    rationale: `Confidence: Low - ${reason}; defaulting to the narrowest possible claim (${destinations} external ${destinations === 1 ? 'destination' : 'destinations'}, ${conversations} eligible ${conversations === 1 ? 'conversation' : 'conversations'}).`,
    summary: baseSummary,
  };
}

function classifyLocal(summary) {
  const dominantLocal = pickDominantLocal(summary);
  if (!dominantLocal || summary.totalAffectedSignal <= 0) return null;

  const affectedDestinations = summary.affectedDestinations.size;
  const dominantShare = dominantLocal.signal / summary.totalAffectedSignal;
  const dominantDestinations = dominantLocal.destinations.size;

  if (affectedDestinations < 3 || dominantDestinations < 3 || dominantShare < 0.75) return null;

  const confidence = dominantShare >= 0.9 && dominantDestinations >= 4 ? 'High' : 'Medium';
  return {
    verdict: 'Likely local',
    confidence,
    rationale: `Confidence: ${confidence} - one local device (${dominantLocal.key}) accounts for ${dominantLocal.conversations} of ${summary.affectedConversations} affected conversations across ${dominantDestinations} destinations.`,
    summary: {
      eligibleDestinations: summary.eligibleDestinations.size,
      eligibleConversations: summary.eligibleConversations,
      affectedDestinations,
      affectedConversations: summary.affectedConversations,
      providersAffected: summary.knownProvidersAffected.size,
      dominantLocal: dominantLocal.key,
      dominantLocalShare: Number(dominantShare.toFixed(3)),
    },
  };
}

function classifyUpstream(summary) {
  const affectedDestinations = summary.affectedDestinations.size;
  const totalDestinations = summary.eligibleDestinations.size;
  const dominantLocal = pickDominantLocal(summary);
  const affectedShare = totalDestinations > 0 ? affectedDestinations / totalDestinations : 0;
  const dominantLocalShare = dominantLocal && summary.totalAffectedSignal > 0
    ? dominantLocal.signal / summary.totalAffectedSignal
    : 0;
  const providerCount = summary.knownProvidersAffected.size;

  const hasSpread = affectedDestinations >= 3 && affectedShare >= 0.6;
  const hasProviderBreadth = providerCount >= 2 || (providerCount === 0 && affectedDestinations >= 5);
  const notDeviceBound = dominantLocalShare < 0.75;
  if (!hasSpread || !hasProviderBreadth || !notDeviceBound) return null;

  let confidence = confidenceLevelFromAffectedShare(affectedShare);
  if (providerCount >= 3 && affectedShare >= 0.75) confidence = 'High';
  if (providerCount === 0 && confidence === 'High') confidence = 'Medium';

  const providerPhrase = providerCount > 0
    ? `spanning ${providerCount} ${providerCount === 1 ? 'provider' : 'providers'}`
    : 'with provider diversity unavailable';

  return {
    verdict: 'Likely upstream/ISP',
    confidence,
    rationale: `Confidence: ${confidence} - ${affectedDestinations} of ${totalDestinations} external destinations show retransmission/RTT issues, ${providerPhrase}, and no single local device dominates the signal.`,
    summary: {
      eligibleDestinations: totalDestinations,
      eligibleConversations: summary.eligibleConversations,
      affectedDestinations,
      affectedConversations: summary.affectedConversations,
      providersAffected: providerCount,
      dominantLocal: dominantLocal?.key || null,
      dominantLocalShare: Number(dominantLocalShare.toFixed(3)),
    },
  };
}

function classifyDestinationSpecific(summary) {
  const affectedDestinations = summary.affectedDestinations.size;
  const totalDestinations = summary.eligibleDestinations.size;
  if (affectedDestinations === 0 || affectedDestinations > 2) return null;

  const cleanDestinations = totalDestinations - affectedDestinations;
  if (cleanDestinations < 2) return null;

  const cleanShare = cleanDestinations / totalDestinations;
  const confidence = cleanShare >= 0.6 && totalDestinations >= 5 ? 'High' : 'Medium';
  const destinationList = Array.from(summary.affectedDestinations.keys()).join(', ');

  return {
    verdict: 'Likely destination/path-specific',
    confidence,
    rationale: `Confidence: ${confidence} - issues are confined to ${affectedDestinations} of ${totalDestinations} external destinations (${destinationList}) while ${cleanDestinations} destinations remain clean.`,
    summary: {
      eligibleDestinations: totalDestinations,
      eligibleConversations: summary.eligibleConversations,
      affectedDestinations,
      affectedConversations: summary.affectedConversations,
      providersAffected: summary.knownProvidersAffected.size,
    },
  };
}

export function scoreVerdict(rows, options = {}) {
  const summary = summarizeRows(rows, options);
  const minDestinations = Number.isFinite(options.minDistinctDestinations) ? options.minDistinctDestinations : 3;
  const minConversations = Number.isFinite(options.minEligibleConversations) ? options.minEligibleConversations : 3;

  if (summary.eligibleConversations < minConversations || summary.eligibleDestinations.size < minDestinations) {
    return classifyBestGuess(summary, 'too little traffic diversity for a credible local-vs-upstream call');
  }

  if (summary.affectedDestinations.size === 0) {
    return classifyBestGuess(summary, 'no retransmission or RTT-outlier signal was observed');
  }

  return (
    classifyLocal(summary)
    || classifyUpstream(summary)
    || classifyDestinationSpecific(summary)
    || classifyBestGuess(summary, `signal is mixed across destinations and local devices (${formatProviderCount(summary)})`)
  );
}
