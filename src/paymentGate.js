import crypto from 'node:crypto';

import { E3DPaymentsClient, bearer, requestJson } from './e3dPaymentsClient.js';

export const NETDOCTOR_PAYMENT_PRODUCT = process.env.NETDOCTOR_PAYMENT_PRODUCT || 'netdoctor';
export const NETDOCTOR_REPORT_ROUTE = process.env.NETDOCTOR_REPORT_ROUTE || '/netdoctor/report';
export const NETDOCTOR_REPORT_PRICE_CREDITS = Number(process.env.NETDOCTOR_REPORT_PRICE_CREDITS || 500);
export const NETDOCTOR_PAYMENT_DOCS = 'docs/payment-gate.md';

export class NetdoctorPaymentRequiredError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'NetdoctorPaymentRequiredError';
    this.code = details.code || 'NETDOCTOR_PAYMENT_REQUIRED';
    this.details = details;
  }
}

function requireValue(value, message) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new NetdoctorPaymentRequiredError(message);
  return normalized;
}

function normalizeCredits(value) {
  const credits = Number(value);
  return Number.isFinite(credits) ? credits : 0;
}

function buildPaymentFailureMessage(error) {
  const code = error?.code ? ` (${error.code})` : '';
  const purchasePath = error?.body?.purchasePath || error?.purchasePath || 'POST /api/payments/credits/purchase';
  const docsUrl = error?.body?.docsUrl || error?.docsUrl || NETDOCTOR_PAYMENT_DOCS;
  const base = error?.message || 'Payment was not accepted';
  return `Netdoctor payment failed${code}: ${base}. Buy or replenish e3d credits with ${purchasePath}, then retry. See ${docsUrl}.`;
}

export class NetdoctorPaymentsClient extends E3DPaymentsClient {
  constructor({
    e3dBaseUrl,
    token,
    creditKey,
    internalServiceKey,
  } = {}) {
    super({ e3dBaseUrl, token, creditKey });
    this.internalServiceKey = internalServiceKey || '';
  }

  spendCredits({
    product = NETDOCTOR_PAYMENT_PRODUCT,
    route = NETDOCTOR_REPORT_ROUTE,
    requestId,
    metadata,
    creditKey = this.creditKey,
  } = {}) {
    const internalServiceKey = requireValue(
      this.internalServiceKey,
      'Netdoctor payment is not configured: missing NETDOCTOR_PAYMENT_SERVICE_KEY.',
    );

    return requestJson(`${this.e3dBaseUrl}/api/payments/credits/spend`, {
      method: 'POST',
      headers: {
        ...bearer(internalServiceKey),
        authorization: `Internal ${internalServiceKey}`,
      },
      body: JSON.stringify({
        product,
        route,
        requestId,
        metadata,
        creditKey,
      }),
    });
  }
}

export function createNetdoctorPaymentsClient(options = {}) {
  return new NetdoctorPaymentsClient({
    e3dBaseUrl: options.e3dBaseUrl || process.env.E3D_BASE_URL,
    token: options.token || process.env.E3D_PAYMENT_TOKEN,
    creditKey: options.creditKey || process.env.NETDOCTOR_PAYMENT_CREDIT_KEY || process.env.E3D_PAYMENT_CREDIT_KEY,
    internalServiceKey: options.internalServiceKey || process.env.NETDOCTOR_PAYMENT_SERVICE_KEY,
  });
}

export function buildNetdoctorRequestId(prefix = 'netdoctor') {
  const random = crypto.randomUUID();
  return `${prefix}:${random}`;
}

export async function ensurePaidNetdoctorReport(options = {}) {
  const paymentClient = options.paymentClient || createNetdoctorPaymentsClient(options);
  if (!paymentClient?.spendCredits) {
    throw new NetdoctorPaymentRequiredError('Netdoctor payment is not configured: payment client cannot spend credits.');
  }

  const requestId = requireValue(options.requestId, 'Netdoctor payment requires a stable request ID.');
  const creditKey = requireValue(
    options.creditKey || paymentClient.creditKey,
    'Netdoctor payment requires NETDOCTOR_PAYMENT_CREDIT_KEY or an explicit credit key.',
  );
  const product = options.product || NETDOCTOR_PAYMENT_PRODUCT;
  const route = options.route || NETDOCTOR_REPORT_ROUTE;
  const expectedCredits = normalizeCredits(options.expectedCredits ?? NETDOCTOR_REPORT_PRICE_CREDITS);

  let spend;
  try {
    spend = await paymentClient.spendCredits({
      product,
      route,
      requestId,
      creditKey,
      metadata: {
        phase: 'netdoctor-report',
        expectedCredits,
        ...options.metadata,
      },
    });
  } catch (error) {
    throw new NetdoctorPaymentRequiredError(buildPaymentFailureMessage(error), {
      code: error?.code,
      status: error?.status,
      body: error?.body,
      requestId,
      product,
      route,
    });
  }

  const creditsSpent = normalizeCredits(spend?.creditsSpent ?? spend?.credits_spent);
  if (creditsSpent < expectedCredits) {
    throw new NetdoctorPaymentRequiredError(
      `Netdoctor payment failed: expected ${expectedCredits} credits for a report, but the payment API spent ${creditsSpent}. Report generation was stopped to avoid an unpaid or underpaid run.`,
      { requestId, product, route, creditsSpent, expectedCredits },
    );
  }

  return {
    ok: true,
    action: 'paid',
    product,
    route,
    requestId,
    creditsSpent,
    creditsRemaining: normalizeCredits(spend?.creditsRemaining ?? spend?.credits_remaining),
    wallet: spend?.wallet,
  };
}
