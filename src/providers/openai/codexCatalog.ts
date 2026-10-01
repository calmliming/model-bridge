/**
 * Codex remote model catalog (`model_catalog_url`, Codex 0.156+).
 *
 * Codex fetches `<model_catalog_url>?client_version=<v>` with the provider's
 * API key and expects the same manifest the ChatGPT backend serves at
 * /backend-api/codex/models: `{ "models": [ { "slug": ..., ... } ] }`. The relay
 * proxies that manifest through one of its OpenAI OAuth accounts and keeps only
 * the models the caller's key and group may use, so the picker never offers a
 * model the gateway would reject.
 */

import { fetchWithConnectTimeout } from '../../http/upstream'
import { CODEX_ORIGINATOR, CODEX_USER_AGENT } from './constants'

const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models'
const MAX_MANIFEST_BYTES = 1 << 20
const CACHE_TTL_MS = 60_000
const CACHE_MAX_ENTRIES = 64

export class CodexCatalogError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message)
  }
}

/** Codex sends its own semantic version; anything else is not a catalog request. */
export function codexClientVersion(value: unknown): string | null {
  return typeof value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value) ? value : null
}

type Manifest = Record<string, unknown> & { models: unknown[] }

const cache = new Map<string, { manifest: Manifest; expiresAt: number }>()

async function boundedText(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_MANIFEST_BYTES) {
      await reader.cancel()
      throw new CodexCatalogError('Codex model catalog exceeds 1 MB', 502)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Fetches (or reuses for 60s) the upstream manifest for one account and client version. */
export async function fetchCodexManifest(input: {
  accountId: string
  token: string
  chatgptAccountId?: string | null
  clientVersion: string
  now?: number
}): Promise<Manifest> {
  const now = input.now ?? Date.now()
  const key = `${input.accountId}:${input.clientVersion}`
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.manifest
  const headers: Record<string, string> = {
    authorization: `Bearer ${input.token}`,
    accept: 'application/json',
    'user-agent': CODEX_USER_AGENT,
    originator: CODEX_ORIGINATOR,
  }
  if (input.chatgptAccountId && /^[\w-]{1,200}$/.test(input.chatgptAccountId)) headers['ChatGPT-Account-ID'] = input.chatgptAccountId
  let response: Response
  try {
    response = await fetchWithConnectTimeout(
      `${CODEX_MODELS_URL}?${new URLSearchParams({ client_version: input.clientVersion })}`,
      { headers, signal: AbortSignal.timeout(15_000) },
    )
  } catch {
    throw new CodexCatalogError('Codex model catalog is unavailable', 503)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new CodexCatalogError(`Codex model catalog upstream returned HTTP ${response.status}`, 502)
  }
  let manifest: unknown
  try {
    manifest = JSON.parse(await boundedText(response))
  } catch (err) {
    if (err instanceof CodexCatalogError) throw err
    throw new CodexCatalogError('Codex model catalog is not valid JSON', 502)
  }
  if (!manifest || typeof manifest !== 'object' || !Array.isArray((manifest as { models?: unknown }).models)) {
    throw new CodexCatalogError('Codex model catalog is not a valid manifest', 502)
  }
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  cache.set(key, { manifest: manifest as Manifest, expiresAt: now + CACHE_TTL_MS })
  return manifest as Manifest
}

/** Keeps manifest entries whose slug the caller may use; other fields pass through. */
export function filterCodexManifest(manifest: Manifest, allowed: (model: string) => boolean): Manifest {
  return {
    ...manifest,
    models: manifest.models.filter(entry => {
      const slug = entry && typeof entry === 'object' ? (entry as { slug?: unknown }).slug : undefined
      return typeof slug === 'string' && slug.trim() !== '' && allowed(slug)
    }),
  }
}

/** Test helper. */
export function resetCodexCatalogCache(): void {
  cache.clear()
}
