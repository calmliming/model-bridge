import { randomUUID } from 'node:crypto'
import { ensureFreshToken, getAccount, updateAccountMetadata } from './manager'
import { markAccountUsed } from './scheduler'

const TEST_TIMEOUT_MS = 15_000
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models'
const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
const GEMINI_LOAD_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'

interface AccountRow {
  id: string
  provider: string
  name: string
  oauthAccessToken: string | null
  tokenExpiresAt: number | null
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

async function testClaude(accessToken: string): Promise<string> {
  const response = await fetchWithTimeout(ANTHROPIC_MODELS_URL, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20',
      accept: 'application/json',
      'user-agent': 'claude-cli/1.0.0 (external, cli)',
    },
  })
  await assertOk(response)
  return 'Claude 账号可访问模型列表'
}

async function testOpenAI(accessToken: string): Promise<string> {
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
  await assertOk(response)
  return 'OpenAI / Codex Responses 端点可访问'
}

async function testGemini(accessToken: string): Promise<{ message: string; metadata: Record<string, unknown> }> {
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

async function runProviderTest(account: AccountRow, accessToken: string): Promise<string> {
  if (account.provider === 'claude') return testClaude(accessToken)
  if (account.provider === 'openai') return testOpenAI(accessToken)
  if (account.provider === 'gemini') {
    const result = await testGemini(accessToken)
    updateAccountMetadata(account.id, result.metadata)
    return result.message
  }
  throw new AccountTestError(`unsupported provider: ${account.provider}`)
}

/** Tests whether one upstream account can reach its provider with current credentials. */
export async function testAccountConnectivity(id: string): Promise<AccountTestResult> {
  const account = getAccount(id)
  if (!account) throw new AccountTestError('account not found', 404)

  const startedAt = Date.now()
  const accessToken = await ensureFreshToken(account)
  const message = await runProviderTest(account, accessToken)
  const latencyMs = Date.now() - startedAt

  markAccountUsed(account.id)
  return {
    success: true,
    provider: account.provider,
    message,
    latencyMs,
    checkedAt: Date.now(),
  }
}
