import { randomUUID } from 'node:crypto'
import { and, eq, ne } from 'drizzle-orm'
import { db } from '../db/index'
import { accounts } from '../db/schema'
import {
  ensureFreshToken,
  getAccount,
  updateAccountHealth,
  updateAccountMetadata,
  updateAccountQuota,
} from './manager'
import {
  extractAccountQuota,
  extractClaudeOAuthUsageQuota,
  quotaCooldownUntil,
  type AccountQuotaSnapshot,
} from './quota'
import { markAccountUsed, penalizeAccount } from './scheduler'

const TEST_TIMEOUT_MS = 15_000
const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
const GEMINI_LOAD_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
const DEEPSEEK_MESSAGES_URL = 'https://api.deepseek.com/anthropic/v1/messages'

interface AccountRow {
  id: string
  provider: string
  name: string
  oauthAccessToken: string | null
  tokenExpiresAt: number | null
}

export interface AccountTestResult {
  success: boolean
  healthStatus?: 'healthy' | 'limited' | 'unhealthy'
  provider: string
  message: string
  latencyMs: number
  checkedAt: number
}

export interface AccountHealthCheckSummary {
  total: number
  checked: number
  healthy: number
  limited: number
  unhealthy: number
  results: AccountTestResult[]
}

export class AccountTestError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
  }
}

interface ProviderTestOutcome {
  message: string
  quota?: AccountQuotaSnapshot | null
  metadata?: Record<string, unknown>
}

function abortSignal(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const timeout = abortSignal(TEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: timeout.signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`上游请求超时（${TEST_TIMEOUT_MS / 1000}s）`)
    }
    throw err
  } finally {
    timeout.dispose()
  }
}

async function limitedBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 800)
  } catch {
    return ''
  }
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    try {
      await response.body?.cancel()
    } catch {
      // Some runtimes mark the body as already consumed; the probe itself still succeeded.
    }
    return
  }
  const body = await limitedBody(response)
  const suffix = body ? `：${body}` : ''
  throw new Error(`上游返回 ${response.status} ${response.statusText}${suffix}`)
}

async function drainBody(response: Response): Promise<void> {
  if (!response.body) return

  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      response.text(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`上游响应超时（${TEST_TIMEOUT_MS / 1000}s）`)), TEST_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    try {
      await response.body?.cancel()
    } catch {
      // The body may already be fully consumed.
    }
  }
}

async function testClaude(accessToken: string): Promise<ProviderTestOutcome> {
  const response = await fetchWithTimeout(ANTHROPIC_USAGE_URL, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      'user-agent': 'claude-code/2.1.7',
    },
  })
  if (!response.ok) await assertOk(response)
  const data = await response.json()
  return {
    message: 'Claude 账号可访问用量接口',
    quota: extractClaudeOAuthUsageQuota(data) ?? extractAccountQuota('claude', response.headers),
  }
}

async function testOpenAI(accessToken: string): Promise<ProviderTestOutcome> {
  const response = await fetchWithTimeout(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'user-agent': 'codex_cli_rs/0.20.0',
      'openai-beta': 'responses=experimental',
      originator: 'codex_cli_rs',
      session_id: randomUUID(),
    },
    body: JSON.stringify({
      model: 'gpt-5.4',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'hi' }],
        },
      ],
      instructions: 'Reply with ok.',
      stream: true,
      store: false,
    }),
  })
  if (!response.ok) await assertOk(response)
  await drainBody(response)
  return {
    message: 'OpenAI / Codex Responses 端点可访问',
    quota: extractAccountQuota('openai', response.headers),
  }
}

async function testGemini(accessToken: string): Promise<ProviderTestOutcome> {
  const response = await fetchWithTimeout(GEMINI_LOAD_CODE_ASSIST_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      cloudaicompanionProject: '',
      metadata: {
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI',
      },
    }),
  })
  if (!response.ok) {
    await assertOk(response)
  }
  const data = (await response.json()) as { cloudaicompanionProject?: string }
  if (!data.cloudaicompanionProject) {
    throw new Error('Gemini loadCodeAssist 未返回项目信息')
  }
  return {
    message: 'Gemini Code Assist 端点可访问',
    metadata: { project: data.cloudaicompanionProject },
  }
}

async function testDeepSeek(apiKey: string): Promise<ProviderTestOutcome> {
  const response = await fetchWithTimeout(DEEPSEEK_MESSAGES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  })
  await assertOk(response)
  return { message: 'DeepSeek Anthropic 端点可访问' }
}

async function runProviderTest(account: AccountRow, accessToken: string): Promise<ProviderTestOutcome> {
  let result: ProviderTestOutcome
  if (account.provider === 'claude') result = await testClaude(accessToken)
  else if (account.provider === 'openai') result = await testOpenAI(accessToken)
  else if (account.provider === 'gemini') result = await testGemini(accessToken)
  else if (account.provider === 'deepseek') result = await testDeepSeek(accessToken)
  else throw new AccountTestError(`unsupported provider: ${account.provider}`)

  if (result.metadata) await updateAccountMetadata(account.id, result.metadata)
  if (result.quota) await updateAccountQuota(account.id, result.quota)
  return result
}

/** Tests whether one upstream account can reach its provider with current credentials. */
export async function testAccountConnectivity(id: string): Promise<AccountTestResult> {
  const account = await getAccount(id)
  if (!account) throw new AccountTestError('account not found', 404)

  const startedAt = Date.now()
  try {
    const accessToken = await ensureFreshToken(account)
    const result = await runProviderTest(account, accessToken)
    const latencyMs = Date.now() - startedAt

    const cooldownUntil = quotaCooldownUntil(result.quota)
    if (cooldownUntil) {
      await penalizeAccount(account.id, 'rate_limited', cooldownUntil)
    } else {
      await markAccountUsed(account.id)
    }
    const healthStatus = cooldownUntil ? 'limited' : 'healthy'
    await updateAccountHealth(account.id, {
      status: healthStatus,
      message: result.message,
      latencyMs,
      checkedAt: Date.now(),
    })
    return {
      success: true,
      healthStatus,
      provider: account.provider,
      message: result.message,
      latencyMs,
      checkedAt: Date.now(),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'account connectivity test failed'
    await updateAccountHealth(account.id, {
      status: 'unhealthy',
      message,
      latencyMs: Date.now() - startedAt,
      checkedAt: Date.now(),
    })
    throw err
  }
}

export async function testAllAccountsConnectivity(provider?: string): Promise<AccountHealthCheckSummary> {
  const rows = await db
    .select({ id: accounts.id, provider: accounts.provider })
    .from(accounts)
    .where(provider ? and(eq(accounts.provider, provider), ne(accounts.status, 'disabled')) : ne(accounts.status, 'disabled'))
  const results: AccountTestResult[] = []

  for (const row of rows) {
    try {
      results.push(await testAccountConnectivity(row.id))
    } catch (err) {
      results.push({
        success: false,
        healthStatus: 'unhealthy',
        provider: row.provider,
        message: err instanceof Error ? err.message : 'account connectivity test failed',
        latencyMs: 0,
        checkedAt: Date.now(),
      })
    }
  }

  return {
    total: rows.length,
    checked: results.length,
    healthy: results.filter((result) => result.healthStatus === 'healthy').length,
    limited: results.filter((result) => result.healthStatus === 'limited').length,
    unhealthy: results.filter((result) => result.healthStatus === 'unhealthy' || !result.success).length,
    results,
  }
}
