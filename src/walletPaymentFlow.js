import { loadWalletCredentials, saveWalletCredentials } from './walletCredentials.js';
import { NETDOCTOR_REPORT_PRICE_CREDITS } from './paymentGate.js';

export const DEFAULT_PAY_BASE_URL = 'https://e3d.ai';
export const DEFAULT_POLL_INTERVAL_MS = 3000;
export const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export function buildPaymentPageUrl({ baseUrl = DEFAULT_PAY_BASE_URL, sessionId } = {}) {
  if (!sessionId) throw new Error('buildPaymentPageUrl requires sessionId');
  const url = new URL('/pay', baseUrl);
  url.searchParams.set('session', sessionId);
  return url.toString();
}

export async function pollForSessionResult({
  paymentClient,
  sessionId,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!paymentClient) throw new Error('pollForSessionResult requires paymentClient');
  if (!sessionId) throw new Error('pollForSessionResult requires sessionId');

  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await paymentClient.getSessionResult(sessionId);
    if (result.status === 'completed') return result;
    if (result.status === 'expired') {
      throw new Error('Payment session expired before completing. Please retry the wallet payment flow.');
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for wallet payment to complete.`);
    }
    await sleep(intervalMs);
  }
}

export function recordWalletSpend({ wallet, creditsRemaining, walletCredentials = { save: saveWalletCredentials } }) {
  walletCredentials.save(wallet, { creditsRemaining });
}

export async function resolveCreditKeyViaWallet({
  wallet,
  credits,
  oneOff = false,
  product = 'netdoctor',
  paymentMethod,
  minCreditsPerReport = NETDOCTOR_REPORT_PRICE_CREDITS,
  paymentClient,
  walletCredentials = { load: loadWalletCredentials, save: saveWalletCredentials },
  buildUrl = buildPaymentPageUrl,
  poll = pollForSessionResult,
  onPayUrl,
  pollOptions = {},
} = {}) {
  if (!wallet) throw new Error('resolveCreditKeyViaWallet requires a wallet address');
  if (!paymentClient) throw new Error('resolveCreditKeyViaWallet requires paymentClient');

  if (!oneOff) {
    const saved = walletCredentials.load(wallet);
    if (saved?.netdoctorCreditKey && Number(saved.creditsRemaining) >= minCreditsPerReport) {
      return {
        creditKey: saved.netdoctorCreditKey,
        source: 'saved',
        creditsRemaining: Number(saved.creditsRemaining),
      };
    }
  }

  const requestedIssuedCredits = oneOff
    ? minCreditsPerReport
    : Math.max(Number(credits) || 0, minCreditsPerReport);

  const session = await paymentClient.createPaymentSession({ product, wallet, requestedIssuedCredits, paymentMethod });
  const payUrl = buildUrl({ sessionId: session.sessionId });
  if (onPayUrl) onPayUrl(payUrl, session.quote);

  const result = await poll({ paymentClient, sessionId: session.sessionId, ...pollOptions });

  if (!oneOff) {
    walletCredentials.save(wallet, {
      netdoctorCreditKey: result.creditKey,
      creditsRemaining: result.issuedCredits,
    });
  }

  return {
    creditKey: result.creditKey,
    source: 'purchased',
    creditsRemaining: result.issuedCredits,
  };
}
