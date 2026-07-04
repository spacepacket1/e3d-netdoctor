async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw Object.assign(new Error(body.message || `HTTP ${res.status}`), {
      status: res.status,
      code: body.code || body.error || body.reason,
      body,
    });
  }
  return body;
}

function bearer(token) {
  if (!token) throw new Error('Missing bearer token');
  return { authorization: `Bearer ${token}` };
}

function optionalBearer(token) {
  return token ? bearer(token) : {};
}

export class E3DPaymentsClient {
  e3dBaseUrl = '';
  token = '';
  creditKey = '';

  constructor({ e3dBaseUrl, token, creditKey } = {}) {
    this.e3dBaseUrl = String(e3dBaseUrl || 'https://e3d.ai').replace(/\/+$/, '');
    this.token = token || '';
    this.creditKey = creditKey || '';
  }

  quoteCredits({ product = 'maps', wallet, requestedIssuedCredits, promotionCode } = {}) {
    return requestJson(`${this.e3dBaseUrl}/api/payments/credits/quote`, {
      method: 'POST',
      headers: optionalBearer(this.token),
      body: JSON.stringify({
        product,
        wallet,
        requestedIssuedCredits,
        promotionCode,
      }),
    });
  }

  purchaseCredits({ product = 'maps', wallet, txHash, promotionCode } = {}) {
    return requestJson(`${this.e3dBaseUrl}/api/payments/credits/purchase`, {
      method: 'POST',
      headers: optionalBearer(this.token),
      body: JSON.stringify({
        product,
        wallet,
        txHash,
        promotionCode,
      }),
    });
  }

  createPaymentSession({ product = 'maps', wallet, requestedIssuedCredits } = {}) {
    return requestJson(`${this.e3dBaseUrl}/api/payments/credits/session`, {
      method: 'POST',
      headers: optionalBearer(this.token),
      body: JSON.stringify({
        product,
        wallet,
        requestedIssuedCredits,
      }),
    });
  }

  getSessionResult(sessionId) {
    return requestJson(`${this.e3dBaseUrl}/api/payments/credits/session/${encodeURIComponent(sessionId)}/result`, {
      method: 'GET',
      headers: optionalBearer(this.token),
    });
  }

  getBalance({ product = 'maps' } = {}) {
    const authToken = this.token || this.creditKey;
    const query = this.token ? `?product=${encodeURIComponent(product)}` : '';
    return requestJson(`${this.e3dBaseUrl}/api/payments/credits/balance${query}`, {
      method: 'GET',
      headers: bearer(authToken),
    });
  }
}

export { requestJson, bearer };
