# Token 刷新永久失效处理增强 · 实施计划

> 整理日期：2026-07-02
> 目标仓库：model-bridge
> 触发来源：核查 sub2api 提交 [`0a97a5f`](https://github.com/Wei-Shaw/sub2api)（`fix(token-refresh): treat refresh_token_invalidated as non-retryable`）时发现的一处真实（非关键）缺口，详见 [comparison-with-sub2api.zh-CN.md](./comparison-with-sub2api.zh-CN.md) 「06-23~06-26 提交核查」小节。

## 背景与问题

model-bridge 目前对 OAuth token 刷新失败**不做错误分类**：

- 后台任务 [`src/jobs/tokenRefresh.ts`](../src/jobs/tokenRefresh.ts) 每 60s 扫描临近过期的账号，逐个 `refreshAccountToken`，失败只 `console.error` 打一行日志，**下一周期继续重试**。
- provider 的 `refreshToken()`（`src/providers/{claude,openai,gemini}/oauth.ts`）在 `!res.ok` 时统一抛 `Error("token refresh failed (${status}): ${body}")`。

对**临时失败**（429 / 5xx / 网络抖动）这套「无脑重试」是对的。但对**永久失效**的 refresh token —— 账号被删、授权被撤销、team 工作区被移除、refresh_token 已被使用（reuse detection）—— 上游会稳定返回 `invalid_grant` / `refresh_token_invalidated` 等，token **不可能自愈**。此时的现状是：

1. 每 60s 一次徒劳的刷新请求，永不停止；
2. 每次都往日志刷一行 error，淹没真正有价值的告警；
3. 日志里还带上了上游响应 body（`await res.text()`），信息噪音且不符合「日志最小化」约定；
4. 该账号仍留在 `active` 池里，relay 每次挑到它都要走一遍「刷新失败 → penalize → 换下一个」，浪费一次调度与一次上游往返。

sub2api 的 `0a97a5f` 只是往它的 `isNonRetryableRefreshError` 列表里加了一个 `refresh_token_invalidated` 字符串——因为它**早就有**「永久失效 → 停止重试 / 标记账号」的机制。model-bridge 缺的是这套机制本身。

## 目标 / 非目标

### 目标

1. 对 token 刷新失败做**永久 vs 临时**分类。
2. 判定为**永久失效**时：自动把账号置为 `disabled`，并记录「需重新授权」的原因与时间，停止后续刷新与调度。
3. 判定为**临时失败**时：保持现有行为（后台下轮重试 / relay penalize 后换号），**绝不**自动禁用。
4. 分类**默认 fail-safe**：无法确定的错误一律按「临时」处理，宁可多重试几次，也不误禁一个还活着的账号。
5. 收紧刷新失败日志：只记账号 ID、provider、HTTP 状态码、命中的错误类别；**不记原始响应 body**。
6. 后台任务与 relay 两条刷新路径**共用**同一套判定，且不出现「禁用被 penalize 覆盖复活」的竞态。

### 非目标（本期不做）

- 不新增数据库表 / 不做 schema 迁移（复用现有 `accounts.status` 与 `accounts.metadata`）。
- 不引入独立的 `expired` / `needs_reauth` 状态枚举值（避免牵动 scheduler 过滤、UI 徽章等一圈；本期用 `disabled` + metadata 标记表达，作为后续可选精化）。
- 不做自动重新授权（refresh token 已死，只能人工重新走 OAuth；本期只把账号清晰地标出来）。
- 前端仅做**只读提示**（徽章 + 原因），重新授权复用现有「重新添加 / 重新授权」入口，不新建流程。

## 现状梳理（代码事实）

| 关注点 | 位置 | 现状 |
|---|---|---|
| 后台刷新循环 | [`src/jobs/tokenRefresh.ts:31-45`](../src/jobs/tokenRefresh.ts#L31-L45) | 失败仅 `console.error(...message)`，无分类、无禁用；循环 `where(ne(status,'disabled'))` 已跳过禁用账号 |
| 刷新入口 | [`src/accounts/manager.ts:317-325`](../src/accounts/manager.ts#L317-L325) | `refreshAccountToken` → `provider.refreshToken()` → `persistTokens`；不 catch |
| relay 刷新调用 | [`src/routes/relay.ts:914-922`](../src/routes/relay.ts#L914-L922) | `ensureFreshToken` 抛错 → `penalizeAccount(id,'error')` + `continue` |
| 手动测试调用 | [`src/accounts/tester.ts:301`](../src/accounts/tester.ts#L301) | `ensureFreshToken` 抛错直接向上抛给管理员测试接口，无 penalize |
| provider 抛错格式 | `src/providers/{claude,openai,gemini}/oauth.ts` 的 `refreshToken` | 三者一致：`throw new Error("token refresh failed (${status}): ${body}")` |
| 禁用 | [`src/accounts/scheduler.ts:154-158`](../src/accounts/scheduler.ts#L154-L158) | `disableAccount` → `status='disabled', cooldownUntil=null` |
| penalize | [`src/accounts/scheduler.ts:161-171`](../src/accounts/scheduler.ts#L161-L171) | `penalizeAccount` → `status=kind, cooldownUntil=until`（**会覆盖 disabled**）|
| 账号状态 | [`src/db/schema.ts:16`](../src/db/schema.ts#L16) | `status`：`active \| rate_limited \| error \| disabled`（自由文本，无枚举约束）|
| 账号 metadata | [`src/db/schema.ts:24`](../src/db/schema.ts#L24) | `jsonb`，已承载 `quota` / `openai` / `autopausePercent` 等子对象 |

### 关键交互坑（决定设计）

`disableAccount`（status=disabled）与 `penalizeAccount`（status=error + cooldown）都是无条件 `UPDATE`。若在 `refreshAccountToken` 内部先禁用再抛通用 `Error`：

- **后台路径**：catch 只 log → 禁用存活 ✅
- **relay 路径**：catch 里 `penalizeAccount(id,'error')` → **把 disabled 覆写成 error + cooldown**，冷却结束后账号回到可调度池，后台循环下轮又去刷这个死 token ❌

> 结论：必须让 relay 的 catch 能**识别**这是一次永久失效，从而**跳过 penalize**。→ 引入类型化错误 `PermanentRefreshError`，而不是靠字符串二次判断。

## 方案设计

分层实现，核心判定集中在 manager 层，两条调用路径自然复用。

### 1. 刷新错误分类器（新增 `src/accounts/refreshErrors.ts`）

```ts
/** 永久失效信号：token 不可能自愈，需人工重新授权。命中即禁用账号。 */
const PERMANENT_REFRESH_SIGNALS = [
  'invalid_grant',            // refresh_token 已失效（最常见）
  'invalid_refresh_token',    // team 工作区被删等
  'refresh_token_invalidated',// OpenAI 会话终止，refresh token 作废（对应 sub2api 0a97a5f）
  'refresh_token_reused',     // refresh_token 已被使用，必须重新授权
  'app_session_terminated',   // team 账号工作区被删除
  'invalid_client',           // 客户端配置错误
  'unauthorized_client',      // 客户端未授权
  'access_denied',            // 授权被拒绝
  'account has no refresh token', // 本地就没有 refresh token
]

export class PermanentRefreshError extends Error {
  constructor(readonly accountId: string, readonly signal: string, readonly status?: number) {
    super(`refresh token permanently invalid for account ${accountId} (${signal})`)
    this.name = 'PermanentRefreshError'
  }
}

/**
 * 从 provider 抛出的通用 Error 判定永久/临时。
 * fail-safe：任何不在永久信号列表里的错误一律按 transient，宁可多重试也不误禁。
 * 返回命中的 signal（用于日志与 metadata），非永久返回 null。
 */
export function matchPermanentRefreshSignal(err: unknown): string | null {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return PERMANENT_REFRESH_SIGNALS.find((s) => msg.includes(s)) ?? null
}
```

设计要点：
- **只做子串匹配、默认 transient**：403/`access_denied` 这类偶发也可能是临时策略拦截，但列进永久列表是有意的——它们通常伴随撤权；若线上发现误伤，从列表移除即可。安全阀是「不确定 → transient」。
- 分类器**不碰网络、不碰 DB**，纯函数，便于单测。
- 暂**不改** provider 层的抛错格式（三个 oauth 文件保持不动），把 `status + body` 留在 message 里给分类器读；如后续要更稳，可让 provider 抛 `RefreshTokenError(status, code)`，分类器改读结构化字段——列为可选精化，不在本期。

### 2. `refreshAccountToken` 包裹禁用逻辑（改 `src/accounts/manager.ts`）

```ts
export async function refreshAccountToken(id: string): Promise<string> {
  const account = await getAccount(id)
  if (!account?.oauthRefreshToken) throw new Error('account has no refresh token')
  const provider = getProvider(account.provider)
  if (!provider) throw new Error(`unknown provider: ${account.provider}`)
  try {
    const tokens = await provider.refreshToken(decryptAccountSecret(account.oauthRefreshToken))
    await persistTokens(id, tokens)
    return tokens.accessToken
  } catch (err) {
    const signal = matchPermanentRefreshSignal(err)
    if (signal) {
      // 永久失效：禁用 + 记录需重新授权，停止后续刷新/调度。
      await markAccountReauthRequired(id, provider.id, signal)
      throw new PermanentRefreshError(id, signal)
    }
    throw err // 临时失败：保持原行为，向上冒泡
  }
}
```

`markAccountReauthRequired`（可放 manager 或 scheduler）：
```ts
// 原子地禁用并写入 reauth 标记；复用 disableAccount 的 status=disabled/cooldown=null。
await disableAccount(id)
await updateAccountMetadata(id, {
  reauth: { required: true, reason: signal, provider, at: Date.now() },
})
```
> 注意：`account has no refresh token` 这条本会在函数开头就 `throw`，走不到 catch。把它保留在信号列表里是为了让**上层**（若直接调用别处）也能识别，同时开头那处 throw 可考虑一并改抛 `PermanentRefreshError`——细节实现时统一。

### 3. relay 路径识别永久错误，跳过 penalize（改 `src/routes/relay.ts:914-922`）

```ts
let token: string
try {
  token = await ensureFreshToken(account)
} catch (err) {
  if (err instanceof PermanentRefreshError) {
    // 账号已在 refreshAccountToken 内被禁用；不要 penalize（会把 disabled 复活成 error）。
    request.log.warn(`account ${account.id} disabled: refresh token invalid (${err.signal})`)
    if (sessionKey) await clearStickyAccount(sessionKey)
    if (accountLimit != null) await releaseSlot(accountSlotKey)
    continue
  }
  request.log.warn(`token refresh failed for ${account.id}: ${(err as Error).message}`)
  await penalizeAccount(account.id, 'error')
  if (accountLimit != null) await releaseSlot(accountSlotKey)
  continue
}
```
关键：`PermanentRefreshError` 分支**不调用 `penalizeAccount`**，禁用状态得以保留；同时清粘性绑定、释放并发槽后 `continue` 换下一个账号。

### 4. 后台任务收敛日志（改 `src/jobs/tokenRefresh.ts:38-44`）

```ts
try {
  await refreshAccountToken(account.id)
  console.log(`[token-refresh] refreshed account "${account.name}"`)
} catch (err) {
  if (err instanceof PermanentRefreshError) {
    // 已禁用；下一周期 ne(status,'disabled') 自动跳过，不再重试。
    console.warn(`[token-refresh] disabled "${account.name}": refresh token invalid (${err.signal}); needs re-auth`)
  } else {
    console.error(`[token-refresh] transient failure for "${account.name}" (status ${statusOf(err)}); will retry`)
  }
}
```
- 永久：一条清晰的「已禁用 + 需重新授权」，**且不再复现**（下轮被 `ne(status,'disabled')` 过滤）。
- 临时：只打状态码摘要，**不打原始 body**，符合 [AGENTS.md](../AGENTS.md) 「不要把敏感信息写进日志」。

### 5. 手动测试路径（`src/accounts/tester.ts`）

`testAccountConnectivity` 里 `ensureFreshToken` 抛 `PermanentRefreshError` 时，账号同样会被自动禁用（逻辑在底层，自动生效）。测试接口把它作为失败返回给管理员即可，`AccountTestError` 的 message 用友好文案「refresh token 已失效，请重新授权」，不泄露内部细节。**无需改动核心逻辑，仅需在 catch 里对该错误类型给友好文案**。

### 6. 前端（可选 · Phase 2）

- [`web/src/views/AccountsView.vue`](../web/src/views/AccountsView.vue)：当 `account.metadata.reauth?.required` 为真时，账号行显示「需重新授权」徽章（红/警告色），tooltip 展示 `reason` 与时间。
- 复用现有「重新添加账号 / 重新授权」入口完成修复；重新授权成功后（`persistTokens` 写入新 token）应清除 `metadata.reauth` 标记并把 status 恢复 `active`。
- `listAccounts`（[manager.ts:110-155](../src/accounts/manager.ts#L110-L155)）已返回 `metadata` 派生字段，补一个 `reauthRequired` 派生位透出即可。

> 前端属只读提示增强，后端逻辑不依赖它。可与后端分期。

## 实施拆分

### 后端

1. 新增 `src/accounts/refreshErrors.ts`：`PERMANENT_REFRESH_SIGNALS`、`PermanentRefreshError`、`matchPermanentRefreshSignal`。
2. `src/accounts/manager.ts`：`refreshAccountToken` 包 try/catch + `markAccountReauthRequired`；重新授权成功路径（`persistTokens`）清除 `metadata.reauth`、恢复 `status='active'`。
3. `src/routes/relay.ts`：`ensureFreshToken` catch 增加 `PermanentRefreshError` 分支（不 penalize）。
4. `src/jobs/tokenRefresh.ts`：按错误类别分级日志，去掉原始 body。
5. `src/accounts/tester.ts`：对 `PermanentRefreshError` 给友好文案。

### 前端（可选）

6. `AccountsView.vue`：`需重新授权` 徽章 + 原因 tooltip；`listAccounts` 透出 `reauthRequired`。

### 测试

7. `src/accounts/refreshErrors.test.ts`：分类器各永久信号 → 命中；429/500/503/超时/网络/未知 → null（transient）。
8. `refreshAccountToken` 测试：永久 → 账号 `disabled` + `metadata.reauth` 落库 + 抛 `PermanentRefreshError`；临时 → status 不变 + 原样抛出。
9. relay 交互测试：`PermanentRefreshError` 分支不调用 `penalizeAccount`（禁用状态保留，不被复活）。

### 文档

10. 更新 [comparison-with-sub2api.zh-CN.md](./comparison-with-sub2api.zh-CN.md)：把该增强从「后续排期」标记为已落地，附实现位置。

## 测试计划

**后端单测（`npm test`）**

- 分类器：`invalid_grant` / `refresh_token_invalidated` / `refresh_token_reused` / `app_session_terminated` / `invalid_client` / `unauthorized_client` / `access_denied` / `invalid_refresh_token` → 命中对应 signal。
- 分类器 fail-safe：`token refresh failed (429)` / `(500)` / `(503)` / `AbortError` / 任意未知串 → `null`。
- `refreshAccountToken` 永久：mock provider `refreshToken` 抛 `invalid_grant` → 断言 DB 中该账号 `status='disabled'`、`metadata.reauth.required===true`、`reason==='invalid_grant'`，且函数抛 `PermanentRefreshError`。
- `refreshAccountToken` 临时：mock 抛 `(503)` → status 保持原值，抛出原始错误（非 `PermanentRefreshError`）。
- relay：构造 `ensureFreshToken` 抛 `PermanentRefreshError`，断言不触发 `penalizeAccount`、粘性被清、`continue` 换号。

**手动验收**

- 用一个已撤销授权的账号，等后台刷新周期到 → 账号自动变 `disabled`，日志出现一条「needs re-auth」，此后**不再刷屏**。
- relay 请求命中该（已失效）账号 → 自动跳过换号，不把它 penalize 复活。
- 重新授权后账号回到 `active`，`metadata.reauth` 被清除。

**命令**

```bash
npm run typecheck
npm test
cd web && npm run typecheck   # 若做了前端
cd web && npm run build
```

## 验收标准

1. refresh token 永久失效的账号会被**自动禁用**，并带「需重新授权」的原因与时间戳。
2. 后台任务对已禁用账号**不再重试**、**不再刷屏**（下轮被 `ne(status,'disabled')` 过滤）。
3. 临时失败（429/5xx/网络）行为**完全不变**，不会误禁账号。
4. relay 路径遇永久失效**跳过 penalize**，禁用状态不被复活成 `error`。
5. 刷新失败日志**不含上游原始 body**，只有账号 ID / provider / 状态码 / 错误类别。
6. 无数据库迁移；仅用现有 `status` 与 `metadata`。
7. 重新授权成功后账号自动恢复 `active`、清除 reauth 标记。

## 默认假设

- 分类**默认 fail-safe（transient）**：只有命中显式永久信号才禁用。误禁风险优先级高于「多重试几次」。
- 永久信号列表以 sub2api `isNonRetryableRefreshError` 为蓝本 + `refresh_token_invalidated`；上线后按线上实际错误体裁剪。
- 本期用 `status='disabled' + metadata.reauth`，不引入新状态枚举值；如需在调度/统计上区分「自动失效」与「人工禁用」，后续再评估独立状态。
- provider 层抛错格式保持不变；结构化 `RefreshTokenError` 为可选后续精化。
- 前端徽章为可选增强，后端逻辑不依赖。

## 参考

- sub2api 提交 `0a97a5f` `fix(token-refresh): treat refresh_token_invalidated as non-retryable`
- 核查结论：[comparison-with-sub2api.zh-CN.md](./comparison-with-sub2api.zh-CN.md) 「06-23~06-26 提交核查」
- 相关代码：`src/jobs/tokenRefresh.ts`、`src/accounts/manager.ts`、`src/accounts/scheduler.ts`、`src/routes/relay.ts`、`src/accounts/tester.ts`、`src/providers/{claude,openai,gemini}/oauth.ts`
