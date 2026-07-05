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
import { sendReportEmail } from './emailDelivery.js';
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
    '  report <pcap> [--format json|markdown|html] [--output file] [--to email] [--pdf] [--no-system-diagnostics] [--speed-test]',
    '                        Generate a netdoctor report from a capture. Defaults to printing',
    '                        {findings, narrative} JSON to stdout (agent-friendly); --format markdown',
    '                        or html prints that instead. --output writes the selected format to a',
    '                        file; --to emails it (always as HTML, --pdf attaches a PDF) via the',
    '                        NETDOCTOR_SMTP_* env vars. --output/--to can combine; using either prints',
    '                        a JSON summary instead of the raw content.',
    '  deliver <pcap> <to> [--pdf] [--no-system-diagnostics] [--speed-test]  Generate and email a netdoctor report after analysis completes.',
    `  paid-report <to> [--pcap file | --interface iface] [--duration s] [--pdf] [--request-id id] [--no-system-diagnostics] [--speed-test]`,
    `                [--wallet address [--credits n] [--payment-method ethereum|base]]`,
    `                        Spend ${NETDOCTOR_REPORT_PRICE_CREDITS} e3d credits before report generation. With`,
    '                        --wallet, pay by connecting a wallet in the browser instead of an',
    '                        existing NETDOCTOR_PAYMENT_CREDIT_KEY: no --credits pays for exactly',
    '                        this one report (nothing saved locally); --credits n buys a reusable',
    '                        batch of n credits and saves the key at ~/.config/e3d-netdoctor/config.json',
    '                        for future paid-report runs against the same wallet. --payment-method',
    '                        chooses which chain/token to pay with: ethereum (E3D, default) or base',
    '                        (wE3D, usually lower gas fees). Requires --wallet.',
    '',
    '  --no-system-diagnostics  Skip the supplementary ping/traceroute/netstat host checks (report/deliver/paid-report).',
    '  --speed-test             Also run a real download/upload throughput test (report/deliver/paid-report).',
    '                           Uses real bandwidth and adds several seconds; off by default.',
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

function buildReportOptions({ noSystemDiagnostics, speedTest }) {
  const options = {};
  if (noSystemDiagnostics) options.systemDiagnostics = false;
  if (speedTest) options.speedTest = true;
  return options;
}

const VALID_PAYMENT_METHODS = ['ethereum', 'base'];
const DEFAULT_WALLET_PAYMENT_METHOD = 'ethereum';

function parsePaidReportArgs(args) {
  const [recipient, ...flags] = args;
  const parsed = {
    recipient,
    includePdf: false,
    noSystemDiagnostics: false,
    speedTest: false,
    pcapPath: null,
    interfaceName: undefined,
    durationSeconds: undefined,
    requestId: undefined,
    wallet: undefined,
    credits: undefined,
    paymentMethod: undefined,
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
    if (flag === '--speed-test') {
      parsed.speedTest = true;
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
    if (flag === '--wallet') {
      parsed.wallet = takeFlagValue(flags, i, flag);
      i += 1;
      continue;
    }
    if (flag === '--credits') {
      const value = Number(takeFlagValue(flags, i, flag));
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--credits must be a positive whole number of credits');
      }
      parsed.credits = value;
      i += 1;
      continue;
    }
    if (flag === '--payment-method') {
      const value = takeFlagValue(flags, i, flag);
      if (!VALID_PAYMENT_METHODS.includes(value)) {
        throw new Error(`--payment-method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`);
      }
      parsed.paymentMethod = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown paid-report option: ${flag}`);
  }

  if (parsed.credits !== undefined && !parsed.wallet) {
    throw new Error('--credits requires --wallet');
  }
  if (parsed.paymentMethod !== undefined && !parsed.wallet) {
    throw new Error('--payment-method requires --wallet');
  }
  if (parsed.wallet && parsed.paymentMethod === undefined) {
    parsed.paymentMethod = DEFAULT_WALLET_PAYMENT_METHOD;
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

const VALID_REPORT_FORMATS = ['json', 'markdown', 'html'];

function parseReportArgs(args) {
  const [filePath, ...flags] = args;
  const parsed = {
    filePath,
    format: 'json',
    outputPath: null,
    recipient: undefined,
    includePdf: false,
    noSystemDiagnostics: false,
    speedTest: false,
  };

  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    if (flag === '--format') {
      const value = takeFlagValue(flags, i, flag);
      if (!VALID_REPORT_FORMATS.includes(value)) {
        throw new Error(`--format must be one of: ${VALID_REPORT_FORMATS.join(', ')}`);
      }
      parsed.format = value;
      i += 1;
      continue;
    }
    if (flag === '--output') {
      parsed.outputPath = takeFlagValue(flags, i, flag);
      i += 1;
      continue;
    }
    if (flag === '--to') {
      parsed.recipient = takeFlagValue(flags, i, flag);
      i += 1;
      continue;
    }
    if (flag === '--pdf') {
      parsed.includePdf = true;
      continue;
    }
    if (flag === '--no-system-diagnostics') {
      parsed.noSystemDiagnostics = true;
      continue;
    }
    if (flag === '--speed-test') {
      parsed.speedTest = true;
      continue;
    }
    throw new Error(`Unknown report option: ${flag}`);
  }

  return parsed;
}

function selectReportContent(report, format) {
  if (format === 'markdown') return report.markdown;
  if (format === 'html') return report.html;
  return JSON.stringify({ findings: report.findings, narrative: report.narrative }, null, 2);
}

async function runReport(args, { stdout, stderr, checkTshark, parseFile, buildReport, writeFile, deliverEmail }) {
  const options = parseReportArgs(args);
  if (!options.filePath) {
    writeLine(stderr, 'report requires a .pcap file path');
    writeLine(stderr, usage());
    return 1;
  }

  const preflightCode = await runPreflight({ stdout, stderr, checkTshark });
  if (preflightCode !== 0) return preflightCode;

  const resolvedPath = path.resolve(options.filePath);
  const parsed = await parseFile(resolvedPath);
  const report = await buildReport(parsed, buildReportOptions(options));
  const content = selectReportContent(report, options.format);

  let resolvedOutput = null;
  if (options.outputPath) {
    resolvedOutput = path.resolve(options.outputPath);
    await writeFile(resolvedOutput, content, 'utf8');
  }

  let deliveryResult = null;
  if (options.recipient) {
    deliveryResult = await deliverEmail({
      to: options.recipient,
      includePdf: options.includePdf,
      report,
    });
  }

  if (!resolvedOutput && !deliveryResult) {
    writeLine(stdout, content);
    return 0;
  }

  writeLine(stdout, JSON.stringify({
    filePath: resolvedPath,
    format: options.format,
    outputPath: resolvedOutput,
    narrativeSource: report.narrative.source,
    verdict: report.findings.verdict.headline,
    confidence: report.findings.verdict.confidence,
    ...(deliveryResult ? {
      recipient: options.recipient,
      subject: deliveryResult.subject,
      from: deliveryResult.from,
      includePdf: deliveryResult.includePdf,
      accepted: deliveryResult.accepted,
      rejected: deliveryResult.rejected,
      messageId: deliveryResult.messageId,
    } : {}),
  }, null, 2));
  return 0;
}

function parseDeliverArgs(args) {
  const [filePath, recipient, ...flags] = args;
  return {
    filePath,
    recipient,
    includePdf: flags.includes('--pdf'),
    noSystemDiagnostics: flags.includes('--no-system-diagnostics'),
    speedTest: flags.includes('--speed-test'),
  };
}

async function runDeliver(args, {
  stdout,
  stderr,
  checkTshark,
  parseFile,
  orchestrateDelivery,
}) {
  const { filePath, recipient, includePdf, noSystemDiagnostics, speedTest } = parseDeliverArgs(args);
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
    reportOptions: buildReportOptions({ noSystemDiagnostics, speedTest }),
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
  if (options.wallet) {
    writeLine(stdout, options.credits
      ? `Buying ${options.credits} e3d credits with wallet ${options.wallet}...`
      : 'Paying for this one report with a connected wallet...');
  }
  const result = await paidReportRequest({
    to: options.recipient,
    includePdf: options.includePdf,
    pcapPath: options.pcapPath,
    interfaceName: options.interfaceName,
    durationSeconds: options.durationSeconds,
    requestId: options.requestId,
    wallet: options.wallet,
    credits: options.credits,
    paymentMethod: options.paymentMethod,
    onPayUrl: (url) => {
      writeLine(stdout, `Open this URL in your browser to pay with your wallet:`);
      writeLine(stdout, url);
      writeLine(stdout, 'Waiting for payment to complete...');
    },
    reportOptions: buildReportOptions(options),
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
  const deliverEmail = deps.deliverEmail || sendReportEmail;
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
        return await runReport(rest, { stdout, stderr, checkTshark, parseFile, buildReport, writeFile, deliverEmail });
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
