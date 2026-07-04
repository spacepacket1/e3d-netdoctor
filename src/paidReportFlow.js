import path from 'node:path';

import { parsePcapFile } from './e3dPcap.js';
import { captureLiveTraffic } from './liveCapture.js';
import { generateAndDeliverReport } from './deliveryOrchestration.js';
import {
  buildNetdoctorRequestId,
  createNetdoctorPaymentsClient,
  ensurePaidNetdoctorReport,
} from './paymentGate.js';
import {
  recordWalletSpend,
  resolveCreditKeyViaWallet,
} from './walletPaymentFlow.js';

export class NetdoctorPostPaymentFailureError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'NetdoctorPostPaymentFailureError';
    this.code = 'NETDOCTOR_POST_PAYMENT_FAILURE';
    this.details = details;
  }
}

function wrapPostPaymentFailure(error, payment) {
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
  const orchestrateDelivery = options.orchestrateDelivery || generateAndDeliverReport;

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

    const parsed = captureResult
      ? captureResult.parsed
      : await parseFile(path.resolve(options.pcapPath));

    const deliveryResult = await orchestrateDelivery(parsed, {
      to: options.to,
      includePdf: options.includePdf,
      buildReport: options.buildReport,
      deliverReport: options.deliverReport,
      mailer: options.mailer,
      createPdf: options.createPdf,
      reportOptions: options.reportOptions,
    });

    return {
      requestId,
      payment,
      capture: captureResult?.capture || null,
      parsed,
      report: deliveryResult.report,
      delivery: deliveryResult.delivery,
    };
  } catch (error) {
    throw wrapPostPaymentFailure(error, payment);
  }
}
