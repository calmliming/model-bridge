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
  quotaLimit?: number | null
  expiresAt?: number | null
}

export interface CreatedApiKey {
  id: string
  /** Plaintext secret — returned to the admin and stored encrypted for later admin copy/reveal. */
  key: string
}

/** Creates a new API key and returns its plaintext secret once. */
export function createApiKey(input: CreateApiKeyInput): CreatedApiKey {
  const secret = KEY_PREFIX + randomBytes(24).toString('hex')
  const id = generateId()
  db.insert(apiKeys)
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
      quotaLimit: input.quotaLimit ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .run()
  return { id, key: secret }
}

/** Lists every API key, newest first. The key hash and encrypted secret are never exposed. */
export function listApiKeys() {
  return db
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
      quotaLimit: apiKeys.quotaLimit,
      quotaUsed: apiKeys.quotaUsed,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt))
    .all()
    .map(({ keySecretEncrypted, ...key }) => ({
      ...key,
      canReveal: !!keySecretEncrypted,
    }))
}

/** Looks up a key record by its plaintext secret. */
export function findApiKeyBySecret(secret: string) {
  return db.select().from(apiKeys).where(eq(apiKeys.keyHash, hashKey(secret))).get()
}

/** Returns a full API key for admin copy/reveal when it was created after encrypted storage existed. */
export function getApiKeySecret(id: string): string | null {
  const row = db
    .select({ keySecretEncrypted: apiKeys.keySecretEncrypted })
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .get()
  if (!row?.keySecretEncrypted) return null
  return decrypt(row.keySecretEncrypted)
}

export function setApiKeyEnabled(id: string, enabled: boolean): void {
  db.update(apiKeys).set({ enabled }).where(eq(apiKeys.id, id)).run()
}

export interface UpdateApiKeyPatch {
  enabled?: boolean
  name?: string
  ownerLabel?: string | null
  allowedProviders?: string[] | null
  rateLimit?: number | null
  quotaLimit?: number | null
  expiresAt?: number | null
}

/** Updates an API key's metadata and limits. Only provided fields change. */
export function updateApiKey(id: string, patch: UpdateApiKeyPatch): void {
  if (Object.keys(patch).length === 0) return
  db.update(apiKeys).set(patch).where(eq(apiKeys.id, id)).run()
}

export function deleteApiKey(id: string): void {
  db.delete(apiKeys).where(eq(apiKeys.id, id)).run()
}
