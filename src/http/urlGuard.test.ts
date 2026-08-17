import { afterEach, describe, expect, it } from 'vitest'
import {
  assertSafeUpstreamEgress,
  assertSafeUpstreamUrl,
  guardedUpstreamLookup,
  isPublicIpAddress,
  UnsafeUpstreamUrlError,
} from './urlGuard'

const originalEnabled = process.env.UPSTREAM_URL_GUARD_ENABLED
const originalHosts = process.env.UPSTREAM_HOST_ALLOWLIST
const originalPorts = process.env.UPSTREAM_PORT_ALLOWLIST

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.UPSTREAM_URL_GUARD_ENABLED
  else process.env.UPSTREAM_URL_GUARD_ENABLED = originalEnabled
  if (originalHosts === undefined) delete process.env.UPSTREAM_HOST_ALLOWLIST
  else process.env.UPSTREAM_HOST_ALLOWLIST = originalHosts
  if (originalPorts === undefined) delete process.env.UPSTREAM_PORT_ALLOWLIST
  else process.env.UPSTREAM_PORT_ALLOWLIST = originalPorts
})

describe('assertSafeUpstreamUrl', () => {
  it.each([
    'http://127.0.0.1:8080',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'https://evil.com/../../admin',
    'https://evil.com/%252e%252e/admin',
    'file:///etc/passwd',
    'https://user:password@example.com/v1',
  ])('rejects unsafe URL %s', (raw) => {
    expect(() => assertSafeUpstreamUrl(raw)).toThrow(UnsafeUpstreamUrlError)
  })

  it('allows public addresses and normal public HTTPS URLs', () => {
    expect(assertSafeUpstreamUrl('https://8.8.8.8/v1').hostname).toBe('8.8.8.8')
    expect(assertSafeUpstreamUrl('https://api.example.org/v1').hostname).toBe('api.example.org')
  })

  it('requires explicit configuration for a non-standard port', () => {
    expect(() => assertSafeUpstreamUrl('https://api.example.org:8443/v1')).toThrow(/port 8443/)
    process.env.UPSTREAM_PORT_ALLOWLIST = '443,8443'
    expect(assertSafeUpstreamUrl('https://api.example.org:8443/v1').port).toBe('8443')
  })

  it('lets an explicit host allowlist opt into a private upstream', async () => {
    process.env.UPSTREAM_HOST_ALLOWLIST = '127.0.0.1'
    await expect(assertSafeUpstreamEgress('http://127.0.0.1/v1')).resolves.toBeInstanceOf(URL)
  })

  it('restores legacy behavior when the guard is disabled', () => {
    process.env.UPSTREAM_URL_GUARD_ENABLED = 'false'
    expect(assertSafeUpstreamUrl('file:///etc/passwd').protocol).toBe('file:')
  })
})

describe('isPublicIpAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '192.168.1.2', '169.254.169.254', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1'])(
    'classifies %s as non-public',
    (address) => expect(isPublicIpAddress(address)).toBe(false),
  )

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'classifies %s as public',
    (address) => expect(isPublicIpAddress(address)).toBe(true),
  )
})

describe('guardedUpstreamLookup', () => {
  it('returns an address array when the caller requests all results', async () => {
    const addresses = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
      guardedUpstreamLookup('8.8.8.8', { all: true }, (error, result) => {
        if (error) {
          reject(error)
          return
        }
        if (!Array.isArray(result)) {
          reject(new Error('lookup did not return all addresses'))
          return
        }
        resolve(result)
      })
    })

    expect(addresses).toEqual([{ address: '8.8.8.8', family: 4 }])
  })
})
