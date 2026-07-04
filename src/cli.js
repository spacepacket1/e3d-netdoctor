import path from 'node:path';
import fs from 'node:fs/promises';

import {
  TSHARK_INSTALL_HINT,
  checkTsharkInstalled,
  parsePcapFile,
} from './e3dPcap.js';
import {
  captureLiveTraffic,
  DEFAULT_CAPTURE_DURATION_SECONDS,
} from './liveCapture.js';
import { generateReport } from './reportGeneration.js';
import { generateAndDeliverReport } from './deliveryOrchestration.js';
import { runPaidReportRequest } from './paidReportFlow.js';
import { NETDOCTOR_REPORT_PRICE_CREDITS } from './paymentGate.js';

export const AUTHORIZED_USE_NOTICE = 'Only analyze traffic on networks you are authorized to monitor.';

function writeLine(stream, line = '') {
  stream.write(`${line}\n`);
}

function usage() {
  return [
    'e3d-netdoctor',
    AUTHORIZED_USE_NOTICE,
    '',
    'Commands:',
    '  preflight             Check whether tshark is installed locally.',
    '  smoke <file.pcap>     Run tshark preflight, parse a sample capture, and print rows/diagnostics.',
    `  capture [iface] [s]   Run a live tshark capture on an authorized network (default ${DEFAULT_CAPTURE_DURATION_SECONDS}s).`,
    '  report <pcap> [html] [--no-system-diagnostics]  Generate a netdoctor HTML report from a capture.',
    '  deliver <pcap> <to> [--pdf] [--no-system-diagnostics]  Generate and email a netdoctor report after analysis completes.',
    `  paid-report <to> [--pcap file | --interface iface] [--duration s] [--pdf] [--request-id id] [--no-system-diagnostics]`,
    `                        Spend ${NETDOCTOR_REPORT_PRICE_CREDITS} e3d credits before report generation.`,
    '',
    '  --no-system-diagnostics  Skip the supplementary ping/traceroute/netstat host checks (report/deliver/paid-report).',
    '',
    `Install hint: ${TSHARK_INSTALL_HINT}`,
  ].join('\n');
}

function takeFlagValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePaidReportArgs(args) {
  const [recipient, ...flags] = args;
  const parsed = {
    recipient,
    includePdf: false,
    noSystemDiagnostics: false,
    pcapPath: null,
    interfaceName: undefined,
    durationSeconds: undefined,
    requestId: undefined,
  };

  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    if (flag === '--pdf') {
      parsed.includePdf = true;
      continue;
    }
    if (flag === '--no-system-diagnostics') {
      parsed.noSystemDiagnostics = true;
      continue;
    }
    if (flag === '--pcap') {
      parsed.pcapPath = takeFlagValue(flags, i, flag);
      i += 1;
      continue;
    }
    if (flag === '--interface') {
      parsed.interfaceName = takeFlagValue(flags, i, flag);
      i += 1;
      continue;
    }
    if (flag === '--duration') {
      const value = Number(takeFlagValue(flags, i, flag));
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--duration must be a positive whole number of seconds');
      }
      parsed.durationSeconds = value;
      i += 1;
      continue;
    }
    if (flag === '--request-id') {
      parsed.requestId = takeFlagValue(flags, i, flag);
      i += 1;
      continue;
    }
    throw new Error(`Unknown paid-report option: ${flag}`);
  }

  return parsed;
}

async function runPreflight({ stdout, stderr, checkTshark }) {
  writeLine(stdout, AUTHORIZED_USE_NOTICE);
  const status = await checkTshark();
  if (status.installed) {
    writeLine(stdout, 'tshark status: installed');
    if (status.version) writeLine(stdout, status.version);
    return 0;
  }

  writeLine(stderr, 'tshark status: missing');
  writeLine(stderr, status.message || `tshark was not found. ${TSHARK_INSTALL_HINT}`);
  return 1;
}

async function runSmoke(filePath, { stdout, stderr, checkTshark, parseFile }) {
  if (!filePath) {
    writeLine(stderr, 'smoke requires a .pcap file path');
    writeLine(stderr, usage());
    return 1;
  }

  const preflightCode = await runPreflight({ stdout, stderr, checkTshark });
  if (preflightCode !== 0) return preflightCode;

  const resolvedPath = path.resolve(filePath);
  const parsed = await parseFile(resolvedPath);
  writeLine(stdout, JSON.stringify({
    filePath: resolvedPath,
    rows: parsed.rows,
    diagnostics: parsed.diagnostics,
  }, null, 2));
  return 0;
}

function parseCaptureArgs(args) {
  const [interfaceName, durationArg] = args;
  if (durationArg === undefined) {
    return {
      interfaceName,
      durationSeconds: undefined,
    };
  }

  const durationSeconds = Number(durationArg);
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    throw new Error('capture duration must be a positive whole number of seconds');
  }

  return {
    interfaceName,
    durationSeconds,
  };
}

async function runCapture(args, { stdout, stderr, checkTshark, captureLive }) {
  const preflightCode = await runPreflight({ stdout, stderr, checkTshark });
  if (preflightCode !== 0) return preflightCode;

  const options = parseCaptureArgs(args);
  writeLine(stdout, AUTHORIZED_USE_NOTICE);
  writeLine(stdout, 'Starting live capture...');

  const result = await captureLive(options);
  writeLine(stdout, JSON.stringify({
    capture: result.capture,
    diagnostics: result.parsed.diagnostics,
    rows: result.parsed.rows,
  }, null, 2));
  return 0;
}

async function runReport(args, { stdout, stderr, checkTshark, parseFile, buildReport, writeFile }) {
  const noSystemDiagnostics = args.includes('--no-system-diagnostics');
  const [filePath, outputPath] = args.filter((arg) => arg !== '--no-system-diagnostics');
  if (!filePath) {
    writeLine(stderr, 'report requires a .pcap file path');
    writeLine(stderr, usage());
    return 1;
  }

  const preflightCode = await runPreflight({ stdout, stderr, checkTshark });
  if (preflightCode !== 0) return preflightCode;

  const resolvedPath = path.resolve(filePath);
  const parsed = await parseFile(resolvedPath);
  const report = await buildReport(parsed, noSystemDiagnostics ? { systemDiagnostics: false } : {});

  if (outputPath) {
    const resolvedOutput = path.resolve(outputPath);
    await writeFile(resolvedOutput, report.html, 'utf8');
    writeLine(stdout, JSON.stringify({
      filePath: resolvedPath,
      outputPath: resolvedOutput,
      narrativeSource: report.narrative.source,
      verdict: report.findings.verdict.headline,
      confidence: report.findings.verdict.confidence,
    }, null, 2));
    return 0;
  }

  writeLine(stdout, report.html);
  return 0;
}

function parseDeliverArgs(args) {
  const [filePath, recipient, ...flags] = args;
  return {
    filePath,
    recipient,
    includePdf: flags.includes('--pdf'),
    noSystemDiagnostics: flags.includes('--no-system-diagnostics'),
  };
}

async function runDeliver(args, {
  stdout,
  stderr,
  checkTshark,
  parseFile,
  orchestrateDelivery,
}) {
  const { filePath, recipient, includePdf, noSystemDiagnostics } = parseDeliverArgs(args);
  if (!filePath || !recipient) {
    writeLine(stderr, 'deliver requires a .pcap file path and recipient email address');
    writeLine(stderr, usage());
    return 1;
  }

  const preflightCode = await runPreflight({ stdout, stderr, checkTshark });
  if (preflightCode !== 0) return preflightCode;

  const resolvedPath = path.resolve(filePath);
  const parsed = await parseFile(resolvedPath);
  const result = await orchestrateDelivery(parsed, {
    to: recipient,
    includePdf,
    reportOptions: noSystemDiagnostics ? { systemDiagnostics: false } : {},
  });

  writeLine(stdout, JSON.stringify({
    filePath: resolvedPath,
    recipient,
    verdict: result.report.findings.verdict.headline,
    subject: result.delivery.subject,
    from: result.delivery.from,
    includePdf: result.delivery.includePdf,
    accepted: result.delivery.accepted,
    rejected: result.delivery.rejected,
    messageId: result.delivery.messageId,
  }, null, 2));
  return 0;
}

async function runPaidReport(args, {
  stdout,
  stderr,
  checkTshark,
  paidReportRequest,
}) {
  const options = parsePaidReportArgs(args);
  if (!options.recipient) {
    writeLine(stderr, 'paid-report requires a recipient email address');
    writeLine(stderr, usage());
    return 1;
  }

  const preflightCode = await runPreflight({ stdout, stderr, checkTshark });
  if (preflightCode !== 0) return preflightCode;

  writeLine(stdout, AUTHORIZED_USE_NOTICE);
  writeLine(stdout, 'Requesting e3d payment before capture/analysis...');
  const result = await paidReportRequest({
    to: options.recipient,
    includePdf: options.includePdf,
    pcapPath: options.pcapPath,
    interfaceName: options.interfaceName,
    durationSeconds: options.durationSeconds,
    requestId: options.requestId,
    reportOptions: options.noSystemDiagnostics ? { systemDiagnostics: false } : {},
  });

  writeLine(stdout, JSON.stringify({
    requestId: result.requestId,
    payment: {
      product: result.payment.product,
      route: result.payment.route,
      creditsSpent: result.payment.creditsSpent,
      creditsRemaining: result.payment.creditsRemaining,
    },
    capture: result.capture,
    recipient: options.recipient,
    verdict: result.report.findings.verdict.headline,
    subject: result.delivery.subject,
    from: result.delivery.from,
    includePdf: result.delivery.includePdf,
    accepted: result.delivery.accepted,
    rejected: result.delivery.rejected,
    messageId: result.delivery.messageId,
  }, null, 2));
  return 0;
}

export async function runCli(argv = [], deps = {}) {
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const checkTshark = deps.checkTshark || checkTsharkInstalled;
  const parseFile = deps.parseFile || parsePcapFile;
  const captureLive = deps.captureLive || ((options) => captureLiveTraffic({ ...options, parseFile }));
  const buildReport = deps.buildReport || generateReport;
  const orchestrateDelivery = deps.orchestrateDelivery || ((parsed, options) => (
    generateAndDeliverReport(parsed, { ...options, buildReport })
  ));
  const paidReportRequest = deps.paidReportRequest || ((options) => (
    runPaidReportRequest({ ...options, parseFile, captureLive, buildReport })
  ));
  const writeFile = deps.writeFile || fs.writeFile;
  const [command, ...rest] = argv;

  try {
    switch (command) {
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        writeLine(stdout, usage());
        return 0;
      case 'preflight':
        return await runPreflight({ stdout, stderr, checkTshark });
      case 'smoke':
        return await runSmoke(rest[0], { stdout, stderr, checkTshark, parseFile });
      case 'capture':
        return await runCapture(rest, { stdout, stderr, checkTshark, captureLive });
      case 'report':
        return await runReport(rest, { stdout, stderr, checkTshark, parseFile, buildReport, writeFile });
      case 'deliver':
        return await runDeliver(rest, { stdout, stderr, checkTshark, parseFile, orchestrateDelivery });
      case 'paid-report':
        return await runPaidReport(rest, { stdout, stderr, checkTshark, paidReportRequest });
      default:
        writeLine(stderr, `Unknown command: ${command}`);
        writeLine(stderr, usage());
        return 1;
    }
  } catch (error) {
    writeLine(stderr, String(error?.message || error));
    return 1;
  }
}
