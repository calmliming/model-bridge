import { createHash, randomBytes } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { db } from '../db/index'
import { apiKeys } from '../db/schema'
import { decrypt, encrypt } from '../crypto'

const KEY_PREFIX = 'mb-'

function generateId(): string {
  return randomBytes(12).toString('hex')
}

/** API keys are high-entropy random strings, so a fast SHA-256 hash is enough. */
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export interface CreateApiKeyInput {
  name: string
  ownerLabel?: string | null
  allowedProviders?: string[] | null
  allowedModels?: string[] | null
  rateLimit?: number | null
  concurrencyLimit?: number | null
  quotaLimit?: number | null
  expiresAt?: number | null
}

export interface CreatedApiKey {
  id: string
  /** Plaintext secret — returned to the admin and stored encrypted for later admin copy/reveal. */
  key: string
}

/** Creates a new API key and returns its plaintext secret once. */
export async function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
  const secret = KEY_PREFIX + randomBytes(24).toString('hex')
  const id = generateId()
  await db.insert(apiKeys)
    .values({
      id,
      name: input.name,
      ownerLabel: input.ownerLabel ?? null,
      keyHash: hashKey(secret),
      keySecretEncrypted: encrypt(secret),
      keyPrefix: secret.slice(0, 11),
      allowedProviders: input.allowedProviders ?? null,
      allowedModels: input.allowedModels ?? null,
      rateLimit: input.rateLimit ?? null,
      concurrencyLimit: input.concurrencyLimit ?? null,
      quotaLimit: input.quotaLimit ?? null,
      expiresAt: input.expiresAt ?? null,
    })
  return { id, key: secret }
}

/** Lists every API key, newest first. The key hash and encrypted secret are never exposed. */
export async function listApiKeys() {
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      ownerLabel: apiKeys.ownerLabel,
      keyPrefix: apiKeys.keyPrefix,
      keySecretEncrypted: apiKeys.keySecretEncrypted,
      enabled: apiKeys.enabled,
      allowedProviders: apiKeys.allowedProviders,
      allowedModels: apiKeys.allowedModels,
      rateLimit: apiKeys.rateLimit,
      concurrencyLimit: apiKeys.concurrencyLimit,
      quotaLimit: apiKeys.quotaLimit,
      quotaUsed: apiKeys.quotaUsed,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt))
  return rows.map(({ keySecretEncrypted, ...key }) => ({
    ...key,
    canReveal: !!keySecretEncrypted,
  }))
}

/** Looks up a key record by its plaintext secret. */
export async function findApiKeyBySecret(secret: string) {
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hashKey(secret)))
  return row
}

/** Returns a full API key for admin copy/reveal when it was created after encrypted storage existed. */
export async function getApiKeySecret(id: string): Promise<string | null> {
  const [row] = await db
    .select({ keySecretEncrypted: apiKeys.keySecretEncrypted })
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
  if (!row?.keySecretEncrypted) return null
  return decrypt(row.keySecretEncrypted)
}

export async function setApiKeyEnabled(id: string, enabled: boolean): Promise<void> {
  await db.update(apiKeys).set({ enabled }).where(eq(apiKeys.id, id))
}

export interface UpdateApiKeyPatch {
  enabled?: boolean
  name?: string
  ownerLabel?: string | null
  allowedProviders?: string[] | null
  rateLimit?: number | null
  concurrencyLimit?: number | null
  quotaLimit?: number | null
  expiresAt?: number | null
}

/** Updates an API key's metadata and limits. Only provided fields change. */
export async function updateApiKey(id: string, patch: UpdateApiKeyPatch): Promise<void> {
  if (Object.keys(patch).length === 0) return
  await db.update(apiKeys).set(patch).where(eq(apiKeys.id, id))
}

export async function deleteApiKey(id: string): Promise<void> {
  await db.delete(apiKeys).where(eq(apiKeys.id, id))
}
