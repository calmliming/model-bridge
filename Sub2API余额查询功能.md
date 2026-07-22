# Sub2API 余额查询功能

## 功能说明

Sub2API 账户余额查询功能允许你查看上游中转站的剩余额度、总额度、已使用额度等信息。

## 实现文件

- **`src/providers/sub2api/balance.ts`** - 余额查询核心模块
- **`check-sub2api-balance.ts`** - 命令行查询工具

## 使用方法

### 方法 1：命令行工具（推荐用于测试）

```bash
# 启动数据库（如果未运行）
docker compose up -d postgres

# 运行余额查询工具
npx tsx check-sub2api-balance.ts
```

**输出示例：**
```
--- MagicAI ---
ID: a4ce2f862f64a85e6f8ec511
状态: active
Proxy URL: https://sky1818.com
🔍 查询余额中...
✅ 余额信息:
   剩余: $15.23 | 总额: $20.00 | 已用: $4.77
   ✅ 剩余额度: $15.2300
   💰 总额度: $20.00
   📊 已使用: $4.77
   📈 使用率: 23.9%
   🔄 重置时间: 2026/8/1 00:00:00
```

### 方法 2：集成到管理后台

你可以将余额查询功能集成到管理后台的账户详情页面。

#### 步骤 1：添加后端路由

在 `src/routes/admin.ts` 中添加：

```typescript
import { fetchSub2ApiBalance } from '../providers/sub2api/balance'

// 查询单个账户余额
app.get('/api/admin/accounts/:id/balance', async (request, reply) => {
  await requireAdmin(request)
  const { id } = request.params as { id: string }

  const [account] = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      provider: accounts.provider,
      proxyUrl: accounts.proxyUrl,
      oauthAccessToken: accounts.oauthAccessToken,
    })
    .from(accounts)
    .where(eq(accounts.id, id))

  if (!account) {
    return reply.code(404).send({ error: 'account not found' })
  }

  if (account.provider !== 'sub2api') {
    return reply.code(400).send({ error: 'only sub2api accounts support balance query' })
  }

  if (!account.oauthAccessToken || !account.proxyUrl) {
    return reply.code(400).send({ error: 'account missing credentials' })
  }

  const balance = await fetchSub2ApiBalance(account.oauthAccessToken, account.proxyUrl)

  if (!balance) {
    return reply.code(503).send({ error: 'failed to fetch balance from upstream' })
  }

  return { accountId: id, accountName: account.name, balance }
})
```

#### 步骤 2：前端调用

在前端账户详情页面添加"查询余额"按钮：

```typescript
async function queryBalance(accountId: string) {
  const response = await fetch(`/api/admin/accounts/${accountId}/balance`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  
  if (response.ok) {
    const data = await response.json()
    // 显示余额信息
    console.log(data.balance)
  }
}
```

## 支持的余额查询端点

程序会自动尝试以下常见的余额查询端点：

1. `/v1/dashboard/billing/subscription` - OpenAI 兼容格式
2. `/api/balance` - 简单余额格式
3. `/v1/balance` - 另一种常见格式

## 余额信息字段

```typescript
interface Sub2ApiBalanceInfo {
  totalBalance?: number      // 总额度（美元）
  used?: number             // 已使用（美元）
  remaining?: number        // 剩余额度（美元）
  resetAt?: number          // 重置时间（Unix 毫秒）
  hasSubscription?: boolean // 是否有订阅
  planName?: string         // 订阅计划名称
}
```

## 注意事项

### 1. 并非所有 sub2api 服务都支持余额查询

- 某些自建的 sub2api 中转站可能没有实现余额查询 API
- 如果查询失败，不代表账户有问题，只是该服务不支持

### 2. API Key 权限

- 确保账户的 `oauth_access_token` 字段已正确配置
- 某些服务可能需要特殊权限才能查询余额

### 3. 自定义端点

如果你的 sub2api 服务使用自定义的余额查询端点，可以修改 `balance.ts` 中的 `endpoints` 数组：

```typescript
const endpoints = [
  '/v1/dashboard/billing/subscription',
  '/api/balance',
  '/v1/balance',
  '/your/custom/endpoint',  // 添加你的自定义端点
]
```

## 常见问题

### Q1: 查询返回"无法获取余额信息"

**可能原因：**
1. Sub2API 服务不支持余额查询 API
2. API Key 权限不足
3. Proxy URL 配置错误

**解决方法：**
1. 联系 sub2api 服务提供商确认是否支持余额查询
2. 检查 API Key 是否有效
3. 确认 proxy_url 配置正确

### Q2: 能否定时自动查询余额？

可以！添加一个定时任务：

```typescript
// src/jobs/balanceCheck.ts
import { fetchSub2ApiBalance } from '../providers/sub2api/balance'

export function startBalanceCheckJob() {
  const interval = setInterval(async () => {
    // 查询所有 sub2api 账户的余额
    // 如果余额低于阈值，发送通知
  }, 24 * 60 * 60 * 1000) // 每天检查一次

  return async () => clearInterval(interval)
}
```

### Q3: 余额查询会消耗配额吗？

不会。余额查询是查看性操作，不消耗 API 调用配额。

## 示例代码

### 在代码中使用

```typescript
import { fetchSub2ApiBalance, formatBalanceInfo } from './src/providers/sub2api/balance'

const balance = await fetchSub2ApiBalance(
  'your-api-key',
  'https://your-sub2api-endpoint.com'
)

if (balance) {
  console.log('余额:', formatBalanceInfo(balance))
  
  if (balance.remaining && balance.remaining < 1) {
    console.log('⚠️  余额不足！')
  }
}
```

### 批量查询所有账户

```typescript
const accounts = await db.select().from(accounts).where(eq(accounts.provider, 'sub2api'))

for (const account of accounts) {
  if (account.oauthAccessToken && account.proxyUrl) {
    const balance = await fetchSub2ApiBalance(account.oauthAccessToken, account.proxyUrl)
    console.log(`${account.name}: ${formatBalanceInfo(balance)}`)
  }
}
```

## 下一步

1. **测试功能** - 运行 `check-sub2api-balance.ts` 查看是否能获取余额
2. **集成到后台** - 如果测试成功，可以添加到管理后台界面
3. **设置告警** - 当余额低于阈值时发送通知

---

**创建时间:** 2026-07-22  
**功能状态:** ✅ 已实现，待测试  
**相关文件:** `src/providers/sub2api/balance.ts`, `check-sub2api-balance.ts`
