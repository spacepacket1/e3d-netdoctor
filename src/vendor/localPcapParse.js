// Vendored from e3d-pcap/server/localPcapParse.js (parsing-core constants +
// aggregatePacketRecords only; e3d-netdoctor forks its own tshark shell-out
// and parsePcapFile wrapper, so those are not copied here).

export const TSHARK_INSTALL_HINT = 'Install Wireshark/tshark on macOS with `brew install --cask wireshark` and ensure `tshark` is on your PATH.';
export const DEFAULT_MAX_READ_PACKETS = 300000;
export const DEFAULT_PARSE_TIMEOUT_MS = 20000;

function toInt(value) {
  const number = Number(String(value || '').trim());
  return Number.isFinite(number) ? number : 0;
}

function pickPort(tcpValue, udpValue) {
  const tcp = String(tcpValue || '').trim();
  const udp = String(udpValue || '').trim();
  return tcp || udp || '-';
}

function normalizeProtocol(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'unknown';
  const cleaned = raw.split(',')[0]?.trim() || raw;
  return cleaned.toLowerCase();
}

export function aggregatePacketRecords(records, opts = {}) {
  const aggregate = opts.aggregate === 'ip' ? 'ip' : 'ip_port';
  const minBytes = Number.isFinite(opts.minBytes) ? opts.minBytes : 1;
  const minPackets = Number.isFinite(opts.minPackets) ? opts.minPackets : 1;
  const maxRows = Number.isFinite(opts.maxRows) ? opts.maxRows : 20000;
  const maxReadPackets = Number.isFinite(opts.maxReadPackets) ? opts.maxReadPackets : DEFAULT_MAX_READ_PACKETS;
  const map = new Map();
  const protocolBreakdown = new Map();
  const warnings = [];
  let packetCount = 0;

  for (const record of records || []) {
    const src = String(record?.ipSrc || '').trim();
    const dst = String(record?.ipDst || '').trim();
    if (!src || !dst) continue;

    packetCount += 1;
    const srcPort = pickPort(record?.tcpSrcPort, record?.udpSrcPort);
    const dstPort = pickPort(record?.tcpDstPort, record?.udpDstPort);
    const len = toInt(record?.frameLen);
    const protocol = normalizeProtocol(record?.protocol);
    const protocolEntry = protocolBreakdown.get(protocol) || { packets: 0, bytes: 0 };
    protocolEntry.packets += 1;
    protocolEntry.bytes += len;
    protocolBreakdown.set(protocol, protocolEntry);

    let clientAddr = src;
    let serverAddr = dst;
    let clientPort = srcPort;
    let serverPort = dstPort;
    let clientMac = String(record?.ethSrc || '').trim() || '-';
    let serverMac = String(record?.ethDst || '').trim() || '-';
    let reversed = false;

    if (src > dst) {
      clientAddr = dst;
      serverAddr = src;
      clientPort = dstPort;
      serverPort = srcPort;
      clientMac = String(record?.ethDst || '').trim() || '-';
      serverMac = String(record?.ethSrc || '').trim() || '-';
      reversed = true;
    }

    const key = aggregate === 'ip'
      ? `${clientAddr}|-|${serverAddr}|-`
      : `${clientAddr}|${clientPort}|${serverAddr}|${serverPort}`;
    const current = map.get(key) || {
      Group: 'Group1',
      'Client Addr': clientAddr,
      'Client Port': aggregate === 'ip' ? '-' : clientPort,
      'Server Addr': serverAddr,
      'Server Port': aggregate === 'ip' ? '-' : serverPort,
      'Client MAC': clientMac || '-',
      'Server MAC': serverMac || '-',
      'Client Bytes': 0,
      'Server Bytes': 0,
      Packets: 0,
      Protocol: protocol === 'unknown'
        ? (clientPort !== '-' || serverPort !== '-' ? 'tcp/udp' : 'ip')
        : protocol,
    };

    if (reversed) current['Server Bytes'] += len;
    else current['Client Bytes'] += len;
    current.Packets += 1;
    if (!current['Client MAC'] || current['Client MAC'] === '-') current['Client MAC'] = clientMac || '-';
    if (!current['Server MAC'] || current['Server MAC'] === '-') current['Server MAC'] = serverMac || '-';
    map.set(key, current);
  }

  const rows = [];
  for (const row of map.values()) {
    const totalBytes = row['Client Bytes'] + row['Server Bytes'];
    if (totalBytes < minBytes && row.Packets < minPackets) continue;
    rows.push(row);
    if (rows.length >= maxRows) break;
  }

  if (packetCount >= maxReadPackets) {
    warnings.push(`Parsing stopped after ${maxReadPackets} packets to keep the local viewer responsive.`);
  }

  return {
    rows,
    diagnostics: {
      packetCount,
      conversationCount: rows.length,
      aggregate,
      protocolBreakdown: [...protocolBreakdown.entries()]
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .map(([protocol, totals]) => ({ protocol, packets: totals.packets, bytes: totals.bytes })),
      warnings,
    },
  };
}
