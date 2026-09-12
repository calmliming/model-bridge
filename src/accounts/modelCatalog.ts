import { createHash } from 'node:crypto'
import { pool } from '../db'
import { getAccount, ensureFreshToken, updateAccountMetadata } from './manager'
import { fetchWithConnectTimeout } from '../http/upstream'
import { CODEX_ORIGINATOR, CODEX_USER_AGENT } from '../providers/openai/constants'
import { normalizeSub2ApiBaseUrl } from '../providers/sub2api/relay'
import { minimaxBaseUrl } from '../providers/minimax/relay'
import { mergeCatalogModels, parseModelCatalog, readCatalogSnapshot, type CatalogModel } from '../providers/modelCatalog'
import type { ProviderId } from '../providers/types'

export const CATALOG_PROVIDERS = ['openai', 'sub2api', 'deepseek', 'xiaomi', 'qwen', 'zhipu', 'kimi', 'minimax', 'grok'] as const
export const CATALOG_REFRESH_MS = 6 * 60 * 60_000
export function catalogSourceKey(provider: string, proxyUrl: string | null): string {
  return createHash('sha256').update(`${provider}:${proxyUrl ?? ''}`).digest('hex')
}
function catalogEndpoint(provider: string, proxyUrl: string | null): string {
  if (provider === 'sub2api') return `${normalizeSub2ApiBaseUrl(proxyUrl)}/v1/models`
  if (provider === 'minimax') return `${minimaxBaseUrl(proxyUrl)}/v1/models`
  const urls: Record<string, string> = {
    openai: `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_USER_AGENT.split('/')[1]}`,
    deepseek: 'https://api.deepseek.com/models', xiaomi: 'https://api.xiaomimimo.com/v1/models',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
    zhipu: 'https://open.bigmodel.cn/api/paas/v4/models', kimi: 'https://api.moonshot.cn/v1/models',
    grok: 'https://api.x.ai/v1/models',
  }
  if (!urls[provider]) throw new Error('该服务商暂不支持目录同步')
  return urls[provider]
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('模型目录为空')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('模型目录超过 2 MB') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
const inFlight = new Map<string, Promise<unknown>>()
export function syncAccountCatalog(id: string): Promise<unknown> {
  const pending = inFlight.get(id)
  if (pending) return pending
  const work = sync(id).finally(() => inFlight.delete(id))
  inFlight.set(id, work)
  return work
}
async function sync(id: string) {
  const account = await getAccount(id)
  if (!account) throw new Error('账号不存在')
  if (account.status === 'disabled') throw new Error('停用账号不能同步目录')
  const endpoint = catalogEndpoint(account.provider, account.proxyUrl)
  const attemptAt = Date.now()
  try {
    const token = await ensureFreshToken(account)
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' }
    if (account.provider === 'openai') Object.assign(headers, { 'user-agent': CODEX_USER_AGENT, originator: CODEX_ORIGINATOR })
    const accountId = (account.metadata as { openai?: { chatgptAccountId?: unknown } } | null)?.openai?.chatgptAccountId
    if (account.provider === 'openai' && typeof accountId === 'string' && /^[\w-]{1,200}$/.test(accountId)) headers['ChatGPT-Account-ID'] = accountId
    const response = await fetchWithConnectTimeout(endpoint, { headers, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) { await response.body?.cancel(); throw new Error(`上游返回 HTTP ${response.status}`) }
    const models = parseModelCatalog(await boundedJson(response))
    const snapshot = { version: 1 as const, sourceKey: catalogSourceKey(account.provider, account.proxyUrl), syncedAt: Date.now(), models }
    await updateAccountMetadata(id, { modelCatalog: snapshot, modelCatalogAttemptAt: attemptAt, modelCatalogError: null })
    return snapshot
  } catch (error) {
    const reason = error instanceof Error && /^上游返回 HTTP \d{3}$/.test(error.message) ? error.message : '同步失败，请检查上游连通性和目录接口'
    await updateAccountMetadata(id, { modelCatalogAttemptAt: attemptAt, modelCatalogError: reason })
    throw new Error(reason)
  }
}

export async function listAccountCatalogs() {
  const { rows } = await pool.query('SELECT id, name, provider, status, proxy_url, metadata FROM accounts ORDER BY created_at DESC')
  return rows.map(row => {
    const snapshot = readCatalogSnapshot(row.metadata, catalogSourceKey(row.provider, row.proxy_url))
    return { id: row.id, name: row.name, provider: row.provider, status: row.status,
      supported: (CATALOG_PROVIDERS as readonly string[]).includes(row.provider),
      syncedAt: snapshot?.syncedAt ?? null, stale: !snapshot || Date.now() - snapshot.syncedAt > CATALOG_REFRESH_MS,
      error: typeof row.metadata?.modelCatalogError === 'string' ? row.metadata.modelCatalogError : null,
      models: snapshot?.models ?? [] }
  })
}

export async function cachedAccountCatalogs(groupId: string | null, providers: readonly string[]) {
  const eligible = providers.filter(p => (CATALOG_PROVIDERS as readonly string[]).includes(p))
  if (!eligible.length) return { providerModels: {}, catalogModels: {} }
  const { rows } = await pool.query(`SELECT provider, proxy_url, metadata FROM accounts a
    WHERE provider = ANY($1::text[]) AND status <> 'disabled'
      AND (($2::text IS NULL AND NOT EXISTS (SELECT 1 FROM account_group_members m WHERE m.account_id = a.id))
        OR ($2::text IS NOT NULL AND EXISTS (SELECT 1 FROM account_group_members m WHERE m.account_id = a.id AND m.group_id = $2)))`, [eligible, groupId])
  const providerModels: Partial<Record<ProviderId, string[]>> = {}
  const catalogModels: Partial<Record<ProviderId, Record<string, CatalogModel>>> = {}
  for (const provider of eligible as ProviderId[]) {
    const members = rows.filter(row => row.provider === provider)
    if (!members.length) { providerModels[provider] = []; continue }
    const models: Record<string, CatalogModel> = Object.create(null)
    let complete = true
    for (const row of members) {
      const snapshot = readCatalogSnapshot(row.metadata, catalogSourceKey(provider, row.proxy_url))
      if (!snapshot) { complete = false; continue }
      for (const model of snapshot.models) models[model.id] = models[model.id] ? mergeCatalogModels(models[model.id]!, model) : model
    }
    // Unobserved accounts retain static discovery. Do not claim shared
    // capabilities while one of the eligible accounts has no snapshot.
    if (complete) { providerModels[provider] = Object.keys(models); catalogModels[provider] = models }
    else if (Object.keys(models).length) catalogModels[provider] = Object.fromEntries(Object.keys(models).map(id => [id, { id }]))
  }
  return { providerModels, catalogModels }
}

export function startModelCatalogJob(): () => Promise<void> {
  let running: Promise<void> | null = null
  let stopping = false
  const timer = setInterval(() => {
    if (running) return
    running = (async () => {
      const attempt = `CASE WHEN (metadata->>'modelCatalogAttemptAt') ~ '^[0-9]{1,15}$' THEN (metadata->>'modelCatalogAttemptAt')::bigint ELSE 0 END`
      const { rows } = await pool.query(`SELECT id FROM accounts WHERE status <> 'disabled' AND provider = ANY($1::text[])
        AND (${attempt}) < $2 ORDER BY (${attempt}) LIMIT 10`,
      [CATALOG_PROVIDERS, Date.now() - CATALOG_REFRESH_MS])
      for (const row of rows) {
        if (stopping) break
        await syncAccountCatalog(row.id).catch(() => {})
      }
    })().catch(() => console.error('[model-catalog] refresh sweep failed')).finally(() => { running = null })
  }, 60_000)
  timer.unref()
  return async () => { stopping = true; clearInterval(timer); await running }
}
