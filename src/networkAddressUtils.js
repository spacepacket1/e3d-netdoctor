function isIpv4InCidr(address, network, prefix) {
  const octets = String(address || '').trim().split('.').map((part) => Number(part));
  const networkOctets = network.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  let addressBits = 0;
  let networkBits = 0;
  for (let index = 0; index < 4; index += 1) {
    addressBits = (addressBits << 8) + octets[index];
    networkBits = (networkBits << 8) + networkOctets[index];
  }

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (addressBits & mask) === (networkBits & mask);
}

export function isLocalAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  if (!value) return false;
  if (value === 'localhost') return true;
  if (value === '::1') return true;
  if (value.startsWith('fe80:')) return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (isIpv4InCidr(value, '10.0.0.0', 8)) return true;
  if (isIpv4InCidr(value, '172.16.0.0', 12)) return true;
  if (isIpv4InCidr(value, '192.168.0.0', 16)) return true;
  if (isIpv4InCidr(value, '169.254.0.0', 16)) return true;
  if (isIpv4InCidr(value, '127.0.0.0', 8)) return true;
  return false;
}
