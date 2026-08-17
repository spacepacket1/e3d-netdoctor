export const DEFAULT_CARD_PACK_ID = 'single';
export const DEFAULT_CARD_POLL_INTERVAL_MS = 3000;
export const DEFAULT_CARD_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export async function pollForStripeSessionResult({
  paymentClient,
  sessionId,
  intervalMs = DEFAULT_CARD_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_CARD_POLL_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!paymentClient) throw new Error('pollForStripeSessionResult requires paymentClient');
  if (!sessionId) throw new Error('pollForStripeSessionResult requires sessionId');

  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await paymentClient.getStripeSessionResult(sessionId);
    if (result.status === 'completed') return result;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for card payment to complete.`);
    }
    await sleep(intervalMs);
  }
}

export async function resolveCreditKeyViaCard({
  packId = DEFAULT_CARD_PACK_ID,
  product = 'netdoctor',
  customerEmail,
  paymentClient,
  poll = pollForStripeSessionResult,
  onPayUrl,
  pollOptions = {},
} = {}) {
  if (!paymentClient) throw new Error('resolveCreditKeyViaCard requires paymentClient');

  const checkout = await paymentClient.createStripeCheckout({ product, packId, customerEmail });
  if (onPayUrl) onPayUrl(checkout.url, checkout);

  const result = await poll({ paymentClient, sessionId: checkout.sessionId, ...pollOptions });

  return {
    creditKey: result.creditKey,
    source: 'purchased',
    creditsRemaining: result.issuedCredits,
  };
}
