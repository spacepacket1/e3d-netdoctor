import { spawn } from 'node:child_process';

export const DEFAULT_PING_COUNT = 4;
export const DEFAULT_PING_TIMEOUT_MS = 8_000;
export const DEFAULT_TRACEROUTE_MAX_HOPS = 12;
export const DEFAULT_TRACEROUTE_TIMEOUT_MS = 15_000;
export const DEFAULT_NETSTAT_TIMEOUT_MS = 5_000;
export const DEFAULT_SYSTEM_DIAGNOSTICS_TARGET_LIMIT = 2;
export const DEFAULT_SPEED_TEST_DOWNLOAD_URL = 'https://speed.cloudflare.com/__down';
export const DEFAULT_SPEED_TEST_UPLOAD_URL = 'https://speed.cloudflare.com/__up';
export const DEFAULT_SPEED_TEST_DOWNLOAD_BYTES = 10_000_000;
export const DEFAULT_SPEED_TEST_UPLOAD_BYTES = 5_000_000;
export const DEFAULT_SPEED_TEST_TIMEOUT_MS = 15_000;

function runCommand(command, args, { timeoutMs, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    const child = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeoutId = timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({ ok: false, stdout, stderr, error: error?.code === 'ENOENT' ? `${command} is not installed or not on PATH.` : String(error?.message || error) });
    });

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (timedOut) {
        resolve({ ok: false, stdout, stderr, error: `${command} timed out after ${timeoutMs} ms.` });
        return;
      }
      resolve({ ok: code === 0, stdout, stderr, error: code === 0 ? null : (stderr.trim() || `${command} exited with status ${code}.`) });
    });
  });
}

function parsePingSummary(stdout) {
  const transmittedMatch = stdout.match(/(\d+)\s+packets transmitted/);
  const receivedMatch = stdout.match(/(\d+)\s+(?:packets\s+)?received/);
  const lossMatch = stdout.match(/([\d.]+)%\s+packet loss/);
  const rttMatch = stdout.match(/=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)\s*ms/);

  return {
    transmitted: transmittedMatch ? Number(transmittedMatch[1]) : null,
    received: receivedMatch ? Number(receivedMatch[1]) : null,
    packetLossPercent: lossMatch ? Number(lossMatch[1]) : null,
    rttMinMs: rttMatch ? Number(rttMatch[1]) : null,
    rttAvgMs: rttMatch ? Number(rttMatch[2]) : null,
    rttMaxMs: rttMatch ? Number(rttMatch[3]) : null,
    rttStddevMs: rttMatch ? Number(rttMatch[4]) : null,
  };
}

export async function runPing(host, opts = {}) {
  const count = Number.isInteger(opts.count) ? opts.count : DEFAULT_PING_COUNT;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_PING_TIMEOUT_MS;
  const result = await runCommand('ping', ['-c', String(count), host], { timeoutMs, spawnImpl: opts.spawnImpl });

  if (!result.stdout && !result.ok) {
    return { host, ok: false, error: result.error };
  }

  const summary = parsePingSummary(result.stdout);
  return {
    host,
    ok: result.ok || summary.received > 0,
    error: result.ok ? null : result.error,
    ...summary,
  };
}

function parseTracerouteHops(stdout) {
  const lines = stdout.split(/\r?\n/).filter((line) => /^\s*\d+\s/.test(line));

  return lines.map((line) => {
    const hopMatch = line.match(/^\s*(\d+)\s+(.*)$/);
    const hop = hopMatch ? Number(hopMatch[1]) : null;
    const rest = hopMatch ? hopMatch[2] : line;
    const timedOut = /^\*(\s+\*)*\s*$/.test(rest.trim());
    const hostMatch = rest.match(/^([^\s(]+)\s*(?:\(([\d.:a-fA-F]+)\))?/);
    const rttMatches = [...rest.matchAll(/([\d.]+)\s*ms/g)].map((match) => Number(match[1]));

    return {
      hop,
      host: timedOut ? null : (hostMatch?.[1] || null),
      address: timedOut ? null : (hostMatch?.[2] || (hostMatch?.[1] && /^[\d.]+$/.test(hostMatch[1]) ? hostMatch[1] : null)),
      rttsMs: rttMatches,
      timedOut,
    };
  });
}

export async function runTraceroute(host, opts = {}) {
  const maxHops = Number.isInteger(opts.maxHops) ? opts.maxHops : DEFAULT_TRACEROUTE_MAX_HOPS;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TRACEROUTE_TIMEOUT_MS;
  const args = ['-q', '1', '-w', '1', '-m', String(maxHops), host];
  const result = await runCommand('traceroute', args, { timeoutMs, spawnImpl: opts.spawnImpl });

  if (!result.stdout && !result.ok) {
    return { host, ok: false, error: result.error };
  }

  const hops = parseTracerouteHops(result.stdout);
  return {
    host,
    ok: hops.length > 0,
    error: hops.length > 0 ? null : result.error,
    hopCount: hops.length,
    timedOutHopCount: hops.filter((hop) => hop.timedOut).length,
    hops,
  };
}

const TCP_STAT_PATTERNS = [
  ['retransmittedDataPackets', /(\d+)\s+data packets?\s*\([^)]*\)\s*retransmitted/i],
  ['duplicateAcksReceived', /(\d+)\s+duplicate acks?\b/i],
  ['outOfOrderPackets', /(\d+)\s+out-of-order packets?/i],
  ['retransmitTimeouts', /(\d+)\s+retransmit timeouts?\b/i],
  ['connectionsEstablished', /(\d+)\s+connections? established/i],
  ['connectionsDropped', /connections? closed[^(]*\((?:including\s+)?(\d+)\s+drops?\)/i],
  ['embryonicConnectionsDropped', /(\d+)\s+embryonic connections? dropped/i],
  ['keepaliveDrops', /(\d+)\s+connections? dropped by keepalive\b/i],
];

function parseTcpProtocolStats(stdout) {
  const stats = {};
  for (const [key, pattern] of TCP_STAT_PATTERNS) {
    const match = stdout.match(pattern);
    stats[key] = match ? Number(match[1]) : null;
  }
  return stats;
}

function parseInterfaceCounters(stdout) {
  const lines = stdout.split(/\r?\n/);
  const seen = new Set();
  const interfaces = [];

  // Leading columns (Name/Mtu/Network/Address) vary in count depending on
  // whether the interface has a link-layer address, so the trailing 5
  // columns (Ipkts/Ierrs/Opkts/Oerrs/Coll) are parsed from the end of the
  // line rather than by fixed position.
  for (const line of lines.slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 6) continue;

    const name = columns[0];
    const [ipkts, ierrs, opkts, oerrs, coll] = columns.slice(-5);
    if (seen.has(name)) continue;
    if (ierrs === '-' || oerrs === '-') continue;
    seen.add(name);

    interfaces.push({
      name,
      inputPackets: Number(ipkts) || 0,
      inputErrors: Number(ierrs) || 0,
      outputPackets: Number(opkts) || 0,
      outputErrors: Number(oerrs) || 0,
      collisions: Number(coll) || 0,
    });
  }

  return interfaces;
}

export async function runNetstat(opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_NETSTAT_TIMEOUT_MS;
  const spawnImpl = opts.spawnImpl;

  const [protocolResult, interfaceResult] = await Promise.all([
    runCommand('netstat', ['-s', '-p', 'tcp'], { timeoutMs, spawnImpl }),
    runCommand('netstat', ['-i'], { timeoutMs, spawnImpl }),
  ]);

  return {
    ok: protocolResult.ok || interfaceResult.ok,
    protocolStatsSupported: protocolResult.ok,
    protocolStats: protocolResult.ok ? parseTcpProtocolStats(protocolResult.stdout) : null,
    interfacesSupported: interfaceResult.ok,
    interfaces: interfaceResult.ok ? parseInterfaceCounters(interfaceResult.stdout) : [],
    error: protocolResult.ok || interfaceResult.ok ? null : (protocolResult.error || interfaceResult.error),
  };
}

function computeMbps(bytes, durationMs) {
  if (!Number.isFinite(bytes) || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  const megabits = (bytes * 8) / 1_000_000;
  const seconds = durationMs / 1000;
  return Number((megabits / seconds).toFixed(2));
}

async function drainBody(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

async function measureDownload(url, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`speed test download failed with status ${response.status}`);

    let bytesReceived = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesReceived += value.byteLength;
    }
    return { bytes: bytesReceived, durationMs: Date.now() - start };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function measureUpload(url, uploadBytes, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      body: new Uint8Array(uploadBytes),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`speed test upload failed with status ${response.status}`);
    await drainBody(response);
    return { bytes: uploadBytes, durationMs: Date.now() - start };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runSpeedTest(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'fetch is not available in this runtime.' };
  }

  const downloadUrl = opts.downloadUrl || DEFAULT_SPEED_TEST_DOWNLOAD_URL;
  const uploadUrl = opts.uploadUrl || DEFAULT_SPEED_TEST_UPLOAD_URL;
  const downloadBytes = Number.isFinite(opts.downloadBytes) ? opts.downloadBytes : DEFAULT_SPEED_TEST_DOWNLOAD_BYTES;
  const uploadBytes = Number.isFinite(opts.uploadBytes) ? opts.uploadBytes : DEFAULT_SPEED_TEST_UPLOAD_BYTES;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_SPEED_TEST_TIMEOUT_MS;

  try {
    const download = await measureDownload(`${downloadUrl}?bytes=${downloadBytes}`, timeoutMs, fetchImpl);
    const upload = await measureUpload(uploadUrl, uploadBytes, timeoutMs, fetchImpl);

    return {
      ok: true,
      error: null,
      downloadBytes: download.bytes,
      downloadDurationMs: download.durationMs,
      downloadMbps: computeMbps(download.bytes, download.durationMs),
      uploadBytes: upload.bytes,
      uploadDurationMs: upload.durationMs,
      uploadMbps: computeMbps(upload.bytes, upload.durationMs),
    };
  } catch (error) {
    const message = error?.name === 'AbortError' ? `speed test timed out after ${timeoutMs} ms.` : String(error?.message || error);
    return { ok: false, error: message };
  }
}

function pickDiagnosticTargets(findings, limit) {
  const candidates = [
    ...(findings?.tcpHealth?.affectedConversations || []),
    ...(findings?.rttOutliers?.conversations || []),
  ];

  const seen = new Set();
  const targets = [];
  for (const candidate of candidates) {
    const host = candidate?.remoteAddress;
    if (!host || seen.has(host)) continue;
    seen.add(host);
    targets.push(host);
    if (targets.length >= limit) break;
  }

  return targets;
}

export async function gatherSystemDiagnostics(findings, options = {}) {
  const runPingImpl = options.runPing || runPing;
  const runTracerouteImpl = options.runTraceroute || runTraceroute;
  const runNetstatImpl = options.runNetstat || runNetstat;
  const runSpeedTestImpl = options.runSpeedTest || runSpeedTest;
  const targetLimit = Number.isInteger(options.systemDiagnosticsTargetLimit)
    ? options.systemDiagnosticsTargetLimit
    : DEFAULT_SYSTEM_DIAGNOSTICS_TARGET_LIMIT;

  const targetHosts = pickDiagnosticTargets(findings, targetLimit);

  const [targets, localNetstat, speedTest] = await Promise.all([
    Promise.all(targetHosts.map(async (host) => ({
      host,
      ping: await runPingImpl(host, options.pingOptions),
      traceroute: await runTracerouteImpl(host, options.tracerouteOptions),
    }))),
    runNetstatImpl(options.netstatOptions),
    options.speedTest === true ? runSpeedTestImpl(options.speedTestOptions) : Promise.resolve(null),
  ]);

  const result = {
    targets,
    localNetstat,
    skippedReason: targetHosts.length ? null : 'No affected destination was available to target with ping/traceroute.',
  };
  if (options.speedTest === true) {
    result.speedTest = speedTest;
  }
  return result;
}
