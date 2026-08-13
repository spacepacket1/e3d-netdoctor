// Vendored from e3d-pcap/server/localPcapEnrichment.js.

function normalizeItems(items) {
  return Array.isArray(items) ? items : [];
}

export function normalizeEnrichmentResponse(payload) {
  return {
    ok: payload?.ok !== false,
    source: payload?.source || 'nametable',
    items: {
      names: normalizeItems(payload?.items?.names),
      ouis: normalizeItems(payload?.items?.ouis),
    },
  };
}

export function createLocalPcapEnrichmentClient({
  baseUrl = 'https://e3d.ai/api/nametable',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('createLocalPcapEnrichmentClient requires fetch');
  }

  return {
    async enrich({ ips = [], macs = [] }) {
      const response = await fetchImpl(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ips, macs }),
      });
      if (!response.ok) {
        throw new Error(`enrichment failed with status ${response.status}`);
      }
      return normalizeEnrichmentResponse(await response.json());
    },
  };
}
