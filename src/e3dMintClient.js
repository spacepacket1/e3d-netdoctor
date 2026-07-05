import { requestJson } from './e3dPaymentsClient.js';

export class E3DMintClient {
  e3dBaseUrl = '';

  constructor({ e3dBaseUrl } = {}) {
    this.e3dBaseUrl = String(e3dBaseUrl || 'https://e3d.ai').replace(/\/+$/, '');
  }

  createMintSession({ wallet, name, description, imageBuffer, animationContent, properties, source } = {}) {
    return requestJson(`${this.e3dBaseUrl}/api/mint/session`, {
      method: 'POST',
      body: JSON.stringify({
        wallet,
        name,
        description,
        image: imageBuffer ? imageBuffer.toString('base64') : undefined,
        animationContent,
        properties,
        source,
      }),
    });
  }

  getMintSessionResult(sessionId) {
    return requestJson(`${this.e3dBaseUrl}/api/mint/session/${encodeURIComponent(sessionId)}/result`, {
      method: 'GET',
    });
  }
}
