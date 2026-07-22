/**
 * Zero-config trust list for reverse proxies on the same host, LAN, or Docker
 * network. Public peers remain untrusted, so their forwarded headers cannot
 * replace request.ip. Deployments must not expose the origin to untrusted
 * clients from one of these private ranges.
 */
export const TRUSTED_LOCAL_PROXIES = [
  '127.0.0.0/8',
  '::1/128',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  'fc00::/7',
]
