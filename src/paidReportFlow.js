import path from 'node:path';

import { parsePcapFile } from './e3dPcap.js';
import { captureLiveTraffic } from './liveCapture.js';
import { generateReport } from './reportGeneration.js';
import {
  buildNetdoctorRequestId,
  createNetdoctorPaymentsClient,
  ensurePaidNetdoctorReport,
} from './paymentGate.js';
import {
  recordWalletSpend,
  resolveCreditKeyViaWallet,
} from './walletPaymentFlow.js';
import { anonymizeLocalIdentifiers } from './reportRedaction.js';

function applyRedaction(parsed, redact) {
  if (!redact) return parsed;
  return {
    ...parsed,
    rows: anonymizeLocalIdentifiers(parsed.rows),
    diagnostics: { ...parsed.diagnostics, filePath: null },
  };
}

export class NetdoctorPostPaymentFailureError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'NetdoctorPostPaymentFailureError';
    this.code = 'NETDOCTOR_POST_PAYMENT_FAILURE';
    this.details = details;
  }
}

export function wrapPostPaymentFailure(error, payment) {
  const cause = error?.message || String(error);
  return new NetdoctorPostPaymentFailureError(
    `Netdoctor report failed after payment for request ${payment.requestId}: ${cause}. No automatic refund or credit is issued in v1; retry with the same request ID to reuse the idempotent payment record and avoid a duplicate charge.`,
    { payment, cause: error },
  );
}

export async function runPaidReportRequest(options = {}) {
  const requestId = options.requestId || buildNetdoctorRequestId();
  const ensurePayment = options.ensurePayment || ensurePaidNetdoctorReport;
  const parseFile = options.parseFile || parsePcapFile;
  const captureLive = options.captureLive || ((captureOptions) => (
    captureLiveTraffic({ ...captureOptions, parseFile })
  ));
  const buildReport = options.buildReport || generateReport;

  const usingWallet = Boolean(options.wallet);
  const oneOff = usingWallet && !options.credits;
  let creditKey = options.creditKey;

  if (usingWallet) {
    const resolveCreditKey = options.resolveCreditKeyViaWallet || resolveCreditKeyViaWallet;
    const walletPaymentClient = options.walletPaymentClient || createNetdoctorPaymentsClient(options.paymentOptions);
    const resolved = await resolveCreditKey({
      wallet: options.wallet,
      credits: options.credits,
      oneOff,
      paymentMethod: options.paymentMethod,
      paymentClient: walletPaymentClient,
      onPayUrl: options.onPayUrl,
    });
    creditKey = resolved.creditKey;
  }

  const payment = await ensurePayment({
    ...options.paymentOptions,
    paymentClient: options.paymentClient,
    creditKey,
    requestId,
    metadata: {
      source: options.pcapPath ? 'pcap' : 'live-capture',
      recipient: options.to,
      includePdf: Boolean(options.includePdf),
      ...options.paymentOptions?.metadata,
    },
  });

  if (usingWallet && !oneOff && Number.isFinite(payment.creditsRemaining)) {
    const recordSpend = options.recordWalletSpend || recordWalletSpend;
    recordSpend({ wallet: options.wallet, creditsRemaining: payment.creditsRemaining });
  }

  try {
    const captureResult = options.pcapPath
      ? null
      : await captureLive({
        interfaceName: options.interfaceName,
        durationSeconds: options.durationSeconds,
      });

    const parsed = applyRedaction(
      captureResult ? captureResult.parsed : await parseFile(path.resolve(options.pcapPath)),
      options.redact,
    );

    const report = await buildReport(parsed, options.reportOptions);

    return {
      requestId,
      payment,
      capture: captureResult?.capture || null,
      parsed,
      report,
    };
  } catch (error) {
    throw wrapPostPaymentFailure(error, payment);
  }
}
