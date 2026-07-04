import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import {
  DEFAULT_MAX_READ_PACKETS,
  DEFAULT_PARSE_TIMEOUT_MS,
  TSHARK_INSTALL_HINT,
} from 'e3d-pcap/server/localPcapParse.js';

const BASE_FIELD_DEFINITIONS = [
  ['eth.src', 'ethSrc'],
  ['eth.dst', 'ethDst'],
  ['ip.src', 'ipSrc'],
  ['ip.dst', 'ipDst'],
  ['tcp.srcport', 'tcpSrcPort'],
  ['tcp.dstport', 'tcpDstPort'],
  ['udp.srcport', 'udpSrcPort'],
  ['udp.dstport', 'udpDstPort'],
  ['frame.len', 'frameLen'],
  ['_ws.col.Protocol', 'protocol'],
];

const OPTIONAL_FIELD_DEFINITIONS = [
  ['frame.time_epoch', 'frameTimeEpoch'],
  ['tcp.stream', 'tcpStream'],
  ['tcp.flags.syn', 'tcpSyn'],
  ['tcp.flags.ack', 'tcpAck'],
  ['tcp.analysis.retransmission', 'tcpAnalysisRetransmission'],
  ['tcp.analysis.duplicate_ack', 'tcpAnalysisDuplicateAck'],
  ['tcp.analysis.out_of_order', 'tcpAnalysisOutOfOrder'],
  ['tcp.analysis.zero_window', 'tcpAnalysisZeroWindow'],
  ['tcp.analysis.window_full', 'tcpAnalysisWindowFull'],
  ['dns.time', 'dnsResponseTime'],
];

function toErrorMessage(error) {
  if (error?.code === 'ENOENT') {
    return `tshark is not installed or not on PATH. ${TSHARK_INSTALL_HINT}`;
  }
  return String(error?.message || error);
}

function buildTsharkArgs(filePath, maxReadPackets, fieldDefinitions) {
  const tsharkArgs = [
    '-r',
    filePath,
    '-c',
    String(maxReadPackets),
    '-T',
    'fields',
  ];

  for (const [fieldName] of fieldDefinitions) {
    tsharkArgs.push('-e', fieldName);
  }

  tsharkArgs.push(
    '-E',
    'separator=\t',
    '-E',
    'occurrence=f',
    '-Y',
    'ip',
  );

  return tsharkArgs;
}

function parseFieldLine(line, fieldDefinitions) {
  const values = line.split('\t');
  const record = {};

  fieldDefinitions.forEach(([, propertyName], index) => {
    record[propertyName] = values[index] || '';
  });

  return record;
}

function isOptionalFieldFailure(stderr) {
  const message = String(stderr || '');
  return /Some fields aren't valid|is not a valid field|Unknown field/i.test(message);
}

async function runTsharkWithFieldDefinitions(filePath, fieldDefinitions, opts = {}) {
  const maxReadPackets = Number.isFinite(opts.maxReadPackets) ? opts.maxReadPackets : DEFAULT_MAX_READ_PACKETS;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_PARSE_TIMEOUT_MS;
  const tsharkArgs = buildTsharkArgs(filePath, maxReadPackets, fieldDefinitions);

  return await new Promise((resolve, reject) => {
    const child = spawn('tshark', tsharkArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const records = [];
    let stderr = '';
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const reader = createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      records.push(parseFieldLine(line, fieldDefinitions));
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(new Error(toErrorMessage(error)));
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (timedOut) {
        reject(new Error(`tshark parsing timed out after ${timeoutMs} ms. Try a smaller capture or raise the local timeout.`));
        return;
      }
      if (code !== 0) {
        reject(Object.assign(new Error(stderr || `tshark exited with status ${code}`), {
          code,
          stderr,
        }));
        return;
      }
      resolve(records);
    });
  });
}

export async function runTsharkPacketFieldsWithMetadata(filePath, opts = {}) {
  const extendedFields = [...BASE_FIELD_DEFINITIONS, ...OPTIONAL_FIELD_DEFINITIONS];

  try {
    const records = await runTsharkWithFieldDefinitions(filePath, extendedFields, opts);
    return {
      records,
      warnings: [],
      optionalFieldsEnabled: true,
    };
  } catch (error) {
    if (!isOptionalFieldFailure(error?.stderr)) throw error;

    const records = await runTsharkWithFieldDefinitions(filePath, BASE_FIELD_DEFINITIONS, opts);
    return {
      records,
      warnings: [
        'Extended TCP analysis fields were unavailable in this tshark build; continuing without retransmission, duplicate ACK, out-of-order, or RTT metadata.',
      ],
      optionalFieldsEnabled: false,
    };
  }
}

export async function runTsharkPacketFields(filePath, opts = {}) {
  const { records } = await runTsharkPacketFieldsWithMetadata(filePath, opts);
  return records;
}

