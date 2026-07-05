import { isLocalAddress } from './networkAddressUtils.js';

function deviceKey(addr, mac) {
  return mac ? `mac:${String(mac).toLowerCase()}` : `addr:${String(addr).toLowerCase()}`;
}

export function anonymizeLocalIdentifiers(rows) {
  const pseudonyms = new Map();
  let nextIndex = 1;

  function pseudonymIndexFor(addr, mac) {
    const key = deviceKey(addr, mac);
    if (!pseudonyms.has(key)) {
      pseudonyms.set(key, nextIndex);
      nextIndex += 1;
    }
    return pseudonyms.get(key);
  }

  return (rows || []).map((row) => {
    const next = { ...row };
    const clientAddr = row['Client Addr'];
    const clientMac = row['Client MAC'];
    const serverAddr = row['Server Addr'];
    const serverMac = row['Server MAC'];

    if (isLocalAddress(clientAddr)) {
      const index = pseudonymIndexFor(clientAddr, clientMac);
      next['Client Addr'] = `local-device-${index}`;
      if (clientMac) next['Client MAC'] = `local-mac-${index}`;
    }
    if (isLocalAddress(serverAddr)) {
      const index = pseudonymIndexFor(serverAddr, serverMac);
      next['Server Addr'] = `local-device-${index}`;
      if (serverMac) next['Server MAC'] = `local-mac-${index}`;
    }

    return next;
  });
}
