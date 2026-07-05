export const DEFAULT_MINT_BASE_URL = 'https://e3d.ai';
export const DEFAULT_MINT_POLL_INTERVAL_MS = 3000;
export const DEFAULT_MINT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export function buildMintPageUrl({ baseUrl = DEFAULT_MINT_BASE_URL, sessionId } = {}) {
  if (!sessionId) throw new Error('buildMintPageUrl requires sessionId');
  const url = new URL('/mint', baseUrl);
  url.searchParams.set('session', sessionId);
  return url.toString();
}

export async function pollForMintSessionResult({
  mintClient,
  sessionId,
  intervalMs = DEFAULT_MINT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_MINT_POLL_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!mintClient) throw new Error('pollForMintSessionResult requires mintClient');
  if (!sessionId) throw new Error('pollForMintSessionResult requires sessionId');

  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await mintClient.getMintSessionResult(sessionId);
    if (result.status === 'completed') return result;
    if (result.status === 'expired') {
      throw new Error('Mint session expired before completing. Please retry the mint.');
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for the mint to complete.`);
    }
    await sleep(intervalMs);
  }
}

export async function resolveMintViaWallet({
  wallet,
  name,
  description,
  imageBuffer,
  animationContent,
  properties,
  source,
  mintClient,
  buildUrl = buildMintPageUrl,
  poll = pollForMintSessionResult,
  onMintUrl,
  pollOptions = {},
} = {}) {
  if (!wallet) throw new Error('resolveMintViaWallet requires a wallet address');
  if (!mintClient) throw new Error('resolveMintViaWallet requires mintClient');

  const session = await mintClient.createMintSession({ wallet, name, description, imageBuffer, animationContent, properties, source });
  const mintUrl = buildUrl({ sessionId: session.sessionId });
  if (onMintUrl) onMintUrl(mintUrl, session.metadataURI);

  const result = await poll({ mintClient, sessionId: session.sessionId, ...pollOptions });

  return {
    tokenId: result.tokenId,
    txHash: result.txHash,
  };
}
