import { normalizeSub2ApiBaseUrl } from './relay'

/**
 * 查询 sub2api 上游账户的余额信息
 * Sub2API 通常提供 /v1/dashboard/billing/subscription 或类似端点
 */
export async function fetchSub2ApiBalance(
  apiKey: string,
  baseUrl: string | null,
): Promise<Sub2ApiBalanceInfo | null> {
  try {
    const normalizedBase = normalizeSub2ApiBaseUrl(baseUrl)

    // 尝试多个可能的余额查询端点
    const endpoints = [
      '/v1/dashboard/billing/subscription',  // OpenAI 兼容
      '/api/balance',                         // 常见的余额端点
      '/v1/balance',                          // 另一个常见格式
    ]

    for (const path of endpoints) {
      try {
        const response = await fetch(`${normalizedBase}${path}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
        })

        if (response.ok) {
          const data = await response.json()
          return parseBalanceResponse(data, path)
        }
      } catch (err) {
        // 继续尝试下一个端点
        continue
      }
    }

    return null
  } catch (err) {
    console.error('Failed to fetch sub2api balance:', err)
    return null
  }
}

/**
 * Sub2API 余额信息
 */
export interface Sub2ApiBalanceInfo {
  /** 总余额（美元） */
  totalBalance?: number
  /** 已使用（美元） */
  used?: number
  /** 剩余额度（美元） */
  remaining?: number
  /** 额度重置时间（Unix 毫秒时间戳） */
  resetAt?: number
  /** 是否有有效订阅 */
  hasSubscription?: boolean
  /** 订阅计划名称 */
  planName?: string
  /** 原始响应数据（用于调试） */
  raw?: any
}

/**
 * 解析不同格式的余额响应
 */
function parseBalanceResponse(data: any, endpoint: string): Sub2ApiBalanceInfo {
  const result: Sub2ApiBalanceInfo = { raw: data }

  // OpenAI dashboard billing 格式
  if (endpoint.includes('dashboard/billing')) {
    result.hasSubscription = data.has_payment_method === true
    result.totalBalance = data.hard_limit_usd
    result.used = data.system_hard_limit_usd

    if (result.totalBalance != null && result.used != null) {
      result.remaining = result.totalBalance - result.used
    }

    if (data.soft_limit_usd) {
      result.totalBalance = data.soft_limit_usd
    }

    if (data.plan) {
      result.planName = data.plan.title || data.plan.id
    }
  }

  // 简单的余额格式
  if (data.balance !== undefined) {
    result.remaining = Number(data.balance)
  }

  if (data.total !== undefined) {
    result.totalBalance = Number(data.total)
  }

  if (data.used !== undefined) {
    result.used = Number(data.used)
  }

  if (data.remaining !== undefined) {
    result.remaining = Number(data.remaining)
  }

  // 计算缺失的字段
  if (result.totalBalance != null && result.used != null && result.remaining == null) {
    result.remaining = result.totalBalance - result.used
  }

  if (result.totalBalance != null && result.remaining != null && result.used == null) {
    result.used = result.totalBalance - result.remaining
  }

  if (result.used != null && result.remaining != null && result.totalBalance == null) {
    result.totalBalance = result.used + result.remaining
  }

  // 解析重置时间
  if (data.reset_at) {
    const parsed = Date.parse(data.reset_at)
    if (Number.isFinite(parsed)) {
      result.resetAt = parsed
    }
  }

  if (data.resetAt) {
    result.resetAt = Number(data.resetAt)
  }

  return result
}

/**
 * 格式化余额信息为人类可读的字符串
 */
export function formatBalanceInfo(info: Sub2ApiBalanceInfo | null): string {
  if (!info) {
    return '无法获取余额信息'
  }

  const parts: string[] = []

  if (info.remaining != null) {
    parts.push(`剩余: $${info.remaining.toFixed(2)}`)
  }

  if (info.totalBalance != null) {
    parts.push(`总额: $${info.totalBalance.toFixed(2)}`)
  }

  if (info.used != null) {
    parts.push(`已用: $${info.used.toFixed(2)}`)
  }

  if (info.hasSubscription) {
    parts.push('有订阅')
  }

  if (info.planName) {
    parts.push(`计划: ${info.planName}`)
  }

  if (info.resetAt) {
    const resetDate = new Date(info.resetAt)
    parts.push(`重置: ${resetDate.toLocaleDateString('zh-CN')}`)
  }

  return parts.length > 0 ? parts.join(' | ') : '无余额信息'
}
