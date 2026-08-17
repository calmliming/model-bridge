import { lookup } from 'node:dns/promises'
import { isIP, type LookupFunction } from 'node:net'

const BUILTIN_UPSTREAM_HOSTS = new Set([
  'api.anthropic.com',
  'chatgpt.com',
  'api.deepseek.com',
  'api.x.ai',
  'cloudcode-pa.googleapis.com',
  'dashscope.aliyuncs.com',
  'api.xiaomimimo.com',
  'open.bigmodel.cn',
  'api.moonshot.cn',
  'challenges.cloudflare.com',
])

const DEFAULT_ALLOWED_PORTS = new Set(['80', '443'])

export class UnsafeUpstreamUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUpstreamUrlError'
  }
}

function envEnabled(): boolean {
  const value = process.env.UPSTREAM_URL_GUARD_ENABLED?.trim().toLowerCase()
  return !value || !['false', '0', 'no', 'off'].includes(value)
}

function configuredAllowedPorts(): Set<string> {
  const raw = process.env.UPSTREAM_PORT_ALLOWLIST
  if (!raw?.trim()) return DEFAULT_ALLOWED_PORTS
  return new Set(raw.split(',').map((part) => part.trim()).filter((part) => /^\d{1,5}$/.test(part)))
}

function configuredAllowedHosts(): string[] {
  return (process.env.UPSTREAM_HOST_ALLOWLIST ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1'))
    .filter(Boolean)
}

function hostMatchesEntry(hostname: string, entry: string): boolean {
  if (entry.startsWith('*.')) {
    const suffix = entry.slice(1)
    return hostname.endsWith(suffix) && hostname.length > suffix.length
  }
  return hostname === entry
}

export function isExplicitlyAllowedUpstreamHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return BUILTIN_UPSTREAM_HOSTS.has(normalized)
    || configuredAllowedHosts().some((entry) => hostMatchesEntry(normalized, entry))
}

/** True only for an operator-provided exemption, which may intentionally be private. */
export function isConfiguredUpstreamHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return configuredAllowedHosts().some((entry) => hostMatchesEntry(normalized, entry))
}

function decodePathSegment(segment: string): string {
  let decoded = segment
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      throw new UnsafeUpstreamUrlError('upstream URL contains invalid path encoding')
    }
  }
  return decoded
}

function containsTraversal(raw: string): boolean {
  const schemeEnd = raw.indexOf('://')
  if (schemeEnd < 0) return false
  const authorityEnd = schemeEnd + 3
  const relativePathStart = raw.slice(authorityEnd).search(/[/\\]/)
  const start = relativePathStart >= 0 ? authorityEnd + relativePathStart : raw.length
  const rawPath = raw.slice(start).split(/[?#]/, 1)[0].replace(/\\/g, '/')
  return rawPath.split('/').some((segment) => decodePathSegment(segment) === '..')
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const bytes = parts.map(Number)
  if (bytes.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return (((bytes[0] * 256 + bytes[1]) * 256 + bytes[2]) * 256 + bytes[3]) >>> 0
}

function inIpv4Cidr(value: number, base: number, prefix: number): boolean {
  if (prefix === 0) return true
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  return (value & mask) === (base & mask)
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4ToNumber(address)
  if (value == null) return false
  const denied: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ]
  return !denied.some(([base, prefix]) => inIpv4Cidr(value, ipv4ToNumber(base)!, prefix))
}

function expandIpv6(address: string): number[] | null {
  let normalized = address.toLowerCase()
  const zone = normalized.indexOf('%')
  if (zone >= 0) normalized = normalized.slice(0, zone)

  const lastColon = normalized.lastIndexOf(':')
  if (normalized.includes('.') && lastColon >= 0) {
    const ipv4 = ipv4ToNumber(normalized.slice(lastColon + 1))
    if (ipv4 == null) return null
    normalized = `${normalized.slice(0, lastColon)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`
  }

  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
  const parts = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null
  return parts.map((part) => Number.parseInt(part, 16))
}

function isPublicIpv6(address: string): boolean {
  const parts = expandIpv6(address)
  if (!parts) return false
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    return isPublicIpv4(`${parts[6] >> 8}.${parts[6] & 0xff}.${parts[7] >> 8}.${parts[7] & 0xff}`)
  }
  if (parts.slice(0, 7).every((part) => part === 0) && parts[7] <= 1) return false
  if (parts.slice(0, 6).every((part) => part === 0)) return false
  if ((parts[0] & 0xfe00) === 0xfc00) return false
  if ((parts[0] & 0xffc0) === 0xfe80) return false
  if ((parts[0] & 0xff00) === 0xff00) return false
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return false
  return true
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family === 6) return isPublicIpv6(address)
  return false
}

/** Performs synchronous URL checks suitable for validation before persistence. */
export function assertSafeUpstreamUrl(raw: string): URL {
  const value = raw.trim()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new UnsafeUpstreamUrlError('invalid upstream URL')
  }

  if (!envEnabled()) return url
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUpstreamUrlError('upstream URL must use http or https')
  }
  if (url.username || url.password) {
    throw new UnsafeUpstreamUrlError('upstream URL must not contain credentials')
  }
  if (!url.hostname) throw new UnsafeUpstreamUrlError('upstream URL must contain a hostname')
  if (containsTraversal(value)) {
    throw new UnsafeUpstreamUrlError('upstream URL must not contain path traversal segments')
  }
  if (url.port && !configuredAllowedPorts().has(url.port)) {
    throw new UnsafeUpstreamUrlError(`upstream URL port ${url.port} is not allowed`)
  }

  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1')
  if (isIP(hostname) && !isExplicitlyAllowedUpstreamHost(hostname) && !isPublicIpAddress(hostname)) {
    throw new UnsafeUpstreamUrlError('upstream URL resolves to a non-public address')
  }
  return url
}

/** Resolves a hostname immediately before egress and rejects every non-public result. */
export async function resolveAndAssertPublicHost(url: URL): Promise<void> {
  if (!envEnabled() || isExplicitlyAllowedUpstreamHost(url.hostname)) return

  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1')
  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw new UnsafeUpstreamUrlError('upstream URL resolves to a non-public address')
    }
    return
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch (error) {
    throw new UnsafeUpstreamUrlError(
      `unable to resolve upstream host: ${error instanceof Error ? error.message : 'DNS lookup failed'}`,
    )
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new UnsafeUpstreamUrlError('upstream URL resolves to a non-public address')
  }
}

/** Full egress check, including parsing the original value before URL normalization. */
export async function assertSafeUpstreamEgress(raw: string | URL): Promise<URL> {
  const url = assertSafeUpstreamUrl(raw instanceof URL ? raw.toString() : raw)
  await resolveAndAssertPublicHost(url)
  return url
}

/**
 * DNS lookup used by the actual HTTP connector. It validates every answer and
 * returns one of those same answers to the socket, closing the check/connect
 * gap that would otherwise permit DNS rebinding between two resolutions.
 */
export const guardedUpstreamLookup: LookupFunction = (hostname, options, callback) => {
  const family = typeof options === 'number' ? options : options.family
  const returnAll = typeof options !== 'number' && options.all === true
  void lookup(hostname, { all: true, verbatim: true, family }).then(
    (addresses) => {
      if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
        callback(new UnsafeUpstreamUrlError('upstream URL resolves to a non-public address'), '', 0)
        return
      }
      // Undici asks for all addresses on recent Node releases. Returning the
      // single-address callback shape in that case makes node:net read an
      // undefined address and fail every guarded request before it connects.
      if (returnAll) {
        callback(null, addresses)
        return
      }
      const selected = addresses[0]
      callback(null, selected.address, selected.family)
    },
    (error: unknown) => {
      callback(
        new UnsafeUpstreamUrlError(
          `unable to resolve upstream host: ${error instanceof Error ? error.message : 'DNS lookup failed'}`,
        ),
        '',
        0,
      )
    },
  )
}
