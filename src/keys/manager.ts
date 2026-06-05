import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/index'
import { apiKeys, accountGroups, users } from '../db/schema'
import { decrypt, encrypt } from '../crypto'
import { normalizeModelMappings, type ModelMappings } from './modelMapping'

const KEY_PREFIX = 'mb-'

function generateId(): string {
  return randomBytes(12).toString('hex')
}

/** API keys are high-entropy random strings, so a fast SHA-256 hash is enough. */
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export interface CreateApiKeyInput {
  userId?: string | null
  name: string
  ownerLabel?: string | null
  allowedProviders?: string[] | null
  allowedModels?: string[] | null
  modelMappings?: ModelMappings | null
  accountGroupId?: string | null
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
      userId: input.userId ?? null,
      name: input.name,
      ownerLabel: input.ownerLabel ?? null,
      keyHash: hashKey(secret),
      keySecretEncrypted: encrypt(secret),
      keyPrefix: secret.slice(0, 11),
      allowedProviders: input.allowedProviders ?? null,
      allowedModels: input.allowedModels ?? null,
      modelMappings: normalizeModelMappings(input.modelMappings),
      accountGroupId: input.accountGroupId ?? null,
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
      userId: apiKeys.userId,
      userEmail: users.email,
      userName: users.name,
      name: apiKeys.name,
      ownerLabel: apiKeys.ownerLabel,
      keyPrefix: apiKeys.keyPrefix,
      keySecretEncrypted: apiKeys.keySecretEncrypted,
      enabled: apiKeys.enabled,
      allowedProviders: apiKeys.allowedProviders,
      allowedModels: apiKeys.allowedModels,
      modelMappings: apiKeys.modelMappings,
      accountGroupId: apiKeys.accountGroupId,
      rateLimit: apiKeys.rateLimit,
      concurrencyLimit: apiKeys.concurrencyLimit,
      quotaLimit: apiKeys.quotaLimit,
      quotaUsed: apiKeys.quotaUsed,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .leftJoin(users, eq(apiKeys.userId, users.id))
    .orderBy(desc(apiKeys.createdAt))
  return rows.map(({ keySecretEncrypted, ...key }) => ({
    ...key,
    canReveal: !!keySecretEncrypted,
  }))
}

/** Looks up a key record by its plaintext secret. */
export async function findApiKeyBySecret(secret: string) {
  const [row] = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      name: apiKeys.name,
      ownerLabel: apiKeys.ownerLabel,
      keyHash: apiKeys.keyHash,
      keySecretEncrypted: apiKeys.keySecretEncrypted,
      keyPrefix: apiKeys.keyPrefix,
      enabled: apiKeys.enabled,
      allowedProviders: apiKeys.allowedProviders,
      allowedModels: apiKeys.allowedModels,
      modelMappings: apiKeys.modelMappings,
      accountGroupId: apiKeys.accountGroupId,
      rateLimit: apiKeys.rateLimit,
      concurrencyLimit: apiKeys.concurrencyLimit,
      quotaLimit: apiKeys.quotaLimit,
      quotaUsed: apiKeys.quotaUsed,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
      userStatus: users.status,
      userBalanceMicros: users.balanceMicros,
      userEmail: users.email,
      groupMultiplier: accountGroups.rateMultiplier,
    })
    .from(apiKeys)
    .leftJoin(users, eq(apiKeys.userId, users.id))
    .leftJoin(accountGroups, eq(apiKeys.accountGroupId, accountGroups.id))
    .where(eq(apiKeys.keyHash, hashKey(secret)))
  return row
}

/** Returns a full API key for admin copy/reveal when it was created after encrypted storage existed. */
export async function getApiKeySecret(id: string, userId?: string): Promise<string | null> {
  const where = userId
    ? and(eq(apiKeys.id, id), eq(apiKeys.userId, userId))
    : eq(apiKeys.id, id)
  const [row] = await db
    .select({ keySecretEncrypted: apiKeys.keySecretEncrypted })
    .from(apiKeys)
    .where(where)
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
  allowedModels?: string[] | null
  modelMappings?: ModelMappings | null
  accountGroupId?: string | null
  rateLimit?: number | null
  concurrencyLimit?: number | null
  quotaLimit?: number | null
  expiresAt?: number | null
}

/** Updates an API key's metadata and limits. Only provided fields change. */
export async function updateApiKey(
  id: string,
  patch: UpdateApiKeyPatch,
  userId?: string,
): Promise<void> {
  if (Object.keys(patch).length === 0) return
  if ('modelMappings' in patch) {
    patch.modelMappings = normalizeModelMappings(patch.modelMappings)
  }
  const where = userId
    ? and(eq(apiKeys.id, id), eq(apiKeys.userId, userId))
    : eq(apiKeys.id, id)
  await db.update(apiKeys).set(patch).where(where)
}

export async function deleteApiKey(id: string, userId?: string): Promise<void> {
  const where = userId
    ? and(eq(apiKeys.id, id), eq(apiKeys.userId, userId))
    : eq(apiKeys.id, id)
  await db.delete(apiKeys).where(where)
}

export async function listApiKeysForUser(userId: string) {
  const rows = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      name: apiKeys.name,
      ownerLabel: apiKeys.ownerLabel,
      keyPrefix: apiKeys.keyPrefix,
      keySecretEncrypted: apiKeys.keySecretEncrypted,
      enabled: apiKeys.enabled,
      allowedProviders: apiKeys.allowedProviders,
      allowedModels: apiKeys.allowedModels,
      modelMappings: apiKeys.modelMappings,
      accountGroupId: apiKeys.accountGroupId,
      rateLimit: apiKeys.rateLimit,
      concurrencyLimit: apiKeys.concurrencyLimit,
      quotaLimit: apiKeys.quotaLimit,
      quotaUsed: apiKeys.quotaUsed,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt))
  return rows.map(({ keySecretEncrypted, ...key }) => ({
    ...key,
    canReveal: !!keySecretEncrypted,
  }))
}
