/**
 * DeepSeek official platform balance.
 *
 * DeepSeek keys are plain API keys, so unlike the OAuth providers there are no
 * rate-limit quota headers to read. The platform exposes the wallet through
 * `GET /user/balance` instead:
 *
 * ```json
 * {
 *   "is_available": true,
 *   "balance_infos": [
 *     { "currency": "CNY", "total_balance": "110.00",
 *       "granted_balance": "10.00", "topped_up_balance": "100.00" }
 *   ]
 * }
 * ```
 *
 * Amounts are JSON *strings* and `granted_balance` is the promotional part of
 * `total_balance`, so both are parsed into numbers before the shared snapshot
 * shape is built. The relay itself always talks to the official host, so this
 * administrative query does too.
 *
 * @see https://api-docs.deepseek.com/api/get-user-balance
 */
import { fetchWithConnectTimeout } from '../../http/upstream'
import {
  balanceQueryFailureMessage,
  balanceRequestHeaders,
  finiteNumber,
  objectValue,
  type AccountBalanceInfo,
} from '../balance'

export const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'

const BALANCE_TIMEOUT_MS = 15_000

/**
 * Parses a `/user/balance` response. Throws when the upstream answered in a
 * shape this platform does not understand, so the admin sees why the balance is
 * missing instead of a bare "查询失败".
 */
export function parseDeepSeekBalanceResponse(payload: unknown): AccountBalanceInfo {
  const root = objectValue(payload)
  if (!root) throw new Error('DeepSeek 余额返回格式无效')

  const infos = Array.isArray(root.balance_infos) ? root.balance_infos : []
  if (!infos.length) throw new Error('DeepSeek 余额返回格式无效（缺少 balance_infos）')
  // The platform reports one entry per currency; the first is the account's
  // billing currency, which is also the one shown in the console.
  const info = objectValue(infos[0])
  if (!info) throw new Error('DeepSeek 余额返回格式无效（balance_infos 条目异常）')

  const result: AccountBalanceInfo = {
    endpoint: '/user/balance',
    mode: 'wallet',
    planName: 'DeepSeek 钱包余额',
    currency: typeof info.currency === 'string' && info.currency.trim() ? info.currency.trim() : undefined,
    totalBalance: finiteNumber(info.total_balance),
    granted: finiteNumber(info.granted_balance),
    // DeepSeek reports a wallet total rather than "limit minus spend", so the
    // remaining credit is the total balance. `topped_up_balance` is only the
    // paid part of it, which is why it is not surfaced as spend.
    remaining: finiteNumber(info.total_balance),
    available: typeof root.is_available === 'boolean' ? root.is_available : undefined,
  }

  if (result.remaining === undefined && result.totalBalance === undefined) {
    throw new Error('DeepSeek 余额返回格式无效（缺少金额字段）')
  }
  // `is_available: false` describes an exhausted wallet, not a broken answer.
  if (result.available === false) {
    result.mode = 'exhausted'
  }
  return result
}

/** Queries the DeepSeek wallet without exposing the API key or the raw body. */
export async function fetchDeepSeekBalance(apiKey: string): Promise<AccountBalanceInfo> {
  let response: Response
  try {
    response = await fetchWithConnectTimeout(DEEPSEEK_BALANCE_URL, {
      method: 'GET',
      headers: balanceRequestHeaders(apiKey),
      // Never forward the credential to a redirect target.
      redirect: 'error',
    }, BALANCE_TIMEOUT_MS)
  } catch (error) {
    throw new Error(`DeepSeek 余额查询失败：${balanceQueryFailureMessage(error, '/user/balance', BALANCE_TIMEOUT_MS)}`)
  }

  if (!response.ok) {
    if (response.body) await response.body.cancel().catch(() => undefined)
    const hint = response.status === 401 || response.status === 403 ? '，请检查 API Key 是否有效' : ''
    throw new Error(`DeepSeek 余额查询失败：/user/balance 返回 HTTP ${response.status}${hint}`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('DeepSeek 余额查询失败：/user/balance 返回了非 JSON 响应')
  }
  return parseDeepSeekBalanceResponse(payload)
}
