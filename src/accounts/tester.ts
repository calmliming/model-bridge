import { randomUUID } from 'node:crypto'
import {
  ensureFreshToken,
  getAccount,
  updateAccountMetadata,
  updateAccountQuota,
} from './manager'
import {
  extractAccountQuota,
  extractClaudeOAuthUsageQuota,
  quotaPauseUntil,
  resolveAutopausePercent,
  type AccountQuotaSnapshot,
} from './quota'
import { getQuotaAutopausePercent } from '../db/settings'
import { markAccountUsed, penalizeAccount } from './scheduler'
import { PermanentRefreshError } from './refreshErrors'
import { normalizeSub2ApiBaseUrl } from '../providers/sub2api/relay'

const TEST_TIMEOUT_MS = 15_000
const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
const GEMINI_LOAD_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
const DEEPSEEK_MESSAGES_URL = 'https://api.deepseek.com/anthropic/v1/messages'
const XIAOMI_MESSAGES_URL = 'https://api.xiaomimimo.com/anthropic/v1/messages'
const ZHIPU_MESSAGES_URL = 'https://open.bigmodel.cn/api/anthropic/v1/messages'
const QWEN_MESSAGES_URL = 'https://dashscope.aliyuncs.com/apps/anthropic/v1/messages'

interface AccountRow {
  id: string
  provider: string
  name: string
  oauthAccessToken: string | null
  tokenExpiresAt: number | null
  proxyUrl: string | null
}

export interface AccountTestResult {
  success: boolean
  provider: string
  message: string
  latencyMs: number
  checkedAt: number
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

async function testXiaomi(apiKey: string): Promise<ProviderTestOutcome> {
  const response = await fetchWithTimeout(XIAOMI_MESSAGES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      model: 'mimo-v2.5-pro',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  })
  await assertOk(response)
  return { message: 'Xiaomi MiMo Anthropic 端点可访问' }
}

async function testZhipu(apiKey: string): Promise<ProviderTestOutcome> {
  const response = await fetchWithTimeout(ZHIPU_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      model: 'glm-5.2',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  })
  await assertOk(response)
  return { message: 'Zhipu GLM Anthropic 端点可访问' }
}

async function testQwen(apiKey: string): Promise<ProviderTestOutcome> {
  const response = await fetchWithTimeout(QWEN_MESSAGES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen3-coder-plus',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  })
  await assertOk(response)
  return { message: 'Qwen 通义千问 Anthropic 端点可访问' }
}

function sub2ApiEndpoint(baseUrl: string | null): string {
  return `${normalizeSub2ApiBaseUrl(baseUrl)}/v1/models`
}

async function testSub2Api(apiKey: string, baseUrl: string | null): Promise<ProviderTestOutcome> {
  const response = await fetchWithTimeout(sub2ApiEndpoint(baseUrl), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
      accept: 'application/json',
    },
  })
  await assertOk(response)
  return { message: 'Sub2API /v1/models 端点可访问' }
}

async function runProviderTest(account: AccountRow, accessToken: string): Promise<ProviderTestOutcome> {
  let result: ProviderTestOutcome
  if (account.provider === 'claude') result = await testClaude(accessToken)
  else if (account.provider === 'openai') result = await testOpenAI(accessToken)
  else if (account.provider === 'gemini') result = await testGemini(accessToken)
  else if (account.provider === 'deepseek') result = await testDeepSeek(accessToken)
  else if (account.provider === 'xiaomi') result = await testXiaomi(accessToken)
  else if (account.provider === 'zhipu') result = await testZhipu(accessToken)
  else if (account.provider === 'qwen') result = await testQwen(accessToken)
  else if (account.provider === 'sub2api') result = await testSub2Api(accessToken, account.proxyUrl)
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
  let accessToken: string
  try {
    accessToken = await ensureFreshToken(account)
  } catch (err) {
    // refreshAccountToken has already disabled the account; surface a friendly
    // hint to the admin instead of leaking the raw upstream error.
    if (err instanceof PermanentRefreshError) {
      throw new AccountTestError('refresh token 已失效，请重新授权该账号')
    }
    throw err
  }
  const result = await runProviderTest(account, accessToken)
  const latencyMs = Date.now() - startedAt

  const threshold = resolveAutopausePercent(account.metadata, await getQuotaAutopausePercent())
  const cooldownUntil = quotaPauseUntil(result.quota, threshold)
  if (cooldownUntil) {
    await penalizeAccount(account.id, 'rate_limited', cooldownUntil)
  } else {
    await markAccountUsed(account.id)
  }
  return {
    success: true,
    provider: account.provider,
    message: result.message,
    latencyMs,
    checkedAt: Date.now(),
  }
}
