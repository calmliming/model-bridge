# 账号分组隔离 · 实施计划

> 状态：**✅ 已实现（2026-06-02）**。本文件最初是「照着写代码」的实施计划，现已对照实际落地完成；下文设计与代码保持一致，可作为该功能的设计说明继续维护。
> 关联：[与 sub2api 的差异化对比](./comparison-with-sub2api.zh-CN.md) 第 1 项。
> 更新日期：2026-06-02

## 一、概述

当前 model-bridge 的账号调度是「按 provider 选号」：一个请求按 `provider` 在**全部**同类账号里
按权重 + LRU 轮转（`src/accounts/scheduler.ts` 的 `pickAccount`）。所有 API Key 共享同一个账号池，
无法把「某些账号只给某些 Key 用」。

**账号分组隔离**引入「分组（account group）」概念：

- 把上游账号编入分组；
- 把 API Key 绑定到某个分组；
- 调度时，绑定了分组的 Key **只会**命中该分组内的账号。

典型用途：隔离不同来源/等级的账号池（对标 sub2api 用分组隔离 Antigravity 账号与官方 Claude 账号，
避免混用导致上下文不兼容），或给特定客户分配专属账号。

## 二、目标与调度语义

采用**隔离式语义**（默认值天然向后兼容）：

| 主体 | 取值 | 调度结果 |
|---|---|---|
| 账号 `group_id = NULL` | 未分组 | 属于「默认池」 |
| 账号 `group_id = G` | 已分组 | **仅**绑定到 G 的 Key 可命中（移出默认池） |
| Key `account_group_id = NULL` | 未绑定 | 只调度默认池（`group_id IS NULL` 的账号） |
| Key `account_group_id = G` | 绑定 G | 只调度 G 组账号 |

**向后兼容**：现有账号全部 `group_id = NULL`、现有 Key 全部 `account_group_id = NULL`，
即「未绑定 Key → 默认池 = 当前全部账号」，线上行为完全不变；只有当管理员主动建组并把账号移入组、
把 Key 绑到组时，隔离才生效。

> 取舍：也可做「回退式」（绑定组无可用账号时回退默认池），但那样无法保证硬隔离，与本功能初衷相悖。
> 推荐隔离式；若将来需要回退，可加一个组级开关 `fallback_to_default`。

## 三、改动点总览

| 层 | 文件 | 改动 |
|---|---|---|
| Schema | `src/db/schema.ts` | 新增 `accountGroups` 表；`accounts` 加 `groupId`；`apiKeys` 加 `accountGroupId` |
| 建表/迁移 | `src/db/init.ts` + `npm run db:generate` | 幂等 DDL + 生成 `0002_*` 迁移 |
| 调度 | `src/accounts/scheduler.ts` | `pickAccount` 增 `groupId` 参与 where 过滤 |
| 调度调用 | `src/routes/relay.ts` | 传入 `apiKey.accountGroupId ?? null` |
| Key 持久化 | `src/keys/manager.ts` | 各 select / insert / patch 带 `accountGroupId` |
| 鉴权透传 | `src/middleware/apiKeyAuth.ts` | `AuthedApiKey` 与 `request.apiKey` 带 `accountGroupId` |
| 账号/分组管理 | `src/accounts/manager.ts`（+ 新建 `src/accounts/groups.ts`）| `createAccount` 支持 `groupId`；分组 CRUD |
| 后台路由 | `src/routes/admin.ts` | Key 的 zod 加 `accountGroupId`；新增分组 CRUD 路由 |
| 前端 | `web/src/views/AccountsView.vue`、`ApiKeysView.vue` | 分组列/选择器 + 分组管理弹窗 |

## 四、数据库设计

### 新表 `account_groups`

`src/db/schema.ts`（沿用文件顶部的 `epochMs` 辅助）：

```typescript
/** A named pool of upstream accounts. Keys bound to a group only schedule within it. */
export const accountGroups = pgTable('account_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: epochMs('created_at'),
})
```

### 在既有表加列

```typescript
// accounts 表内追加：
groupId: text('group_id'), // null = 默认池

// apiKeys 表内追加：
accountGroupId: text('account_group_id'), // null = 未绑定 → 默认池
```

> 用可空 `text` 软引用而非外键约束，与仓库现有风格一致（`user_invites.user_id` 等均无 FK 约束），
> 删除分组时在应用层把引用置空（见第八节）。

### 建表与迁移（`src/db/init.ts`）

`init.ts` 在每次启动时跑幂等 DDL。仿照 payment 的写法追加：

```sql
-- 加入启动时的 CREATE TABLE 块（或单独 pool.query）
CREATE TABLE IF NOT EXISTS account_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);
```

```typescript
// 加入「Forward-compatible column additions」区：
await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS group_id TEXT;`)
await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS account_group_id TEXT;`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_accounts_group_id ON accounts (group_id);`)
```

随后运行 `npm run db:generate`，生成 `src/db/migrations/0002_*.sql` 与快照（流程同 payment 的 `0001`）。

## 五、调度注入（核心）

### `src/accounts/scheduler.ts`

给 `pickAccount` 增加第 4 个参数 `groupId`，并把它编进查询条件。当前导入需补 `isNull`：

```typescript
import { and, eq, inArray, isNull, lte, ne } from 'drizzle-orm'

export async function pickAccount(
  provider: string,
  exclude: string[] = [],
  sessionKey?: string | null,
  groupId?: string | null, // 新增：null = 默认池（group_id IS NULL）
) {
  const now = Date.now()
  await clearExpiredAccountCooldowns(now)
  const rows = await db
    .select()
    .from(accounts)
    .where(and(
      eq(accounts.provider, provider),
      ne(accounts.status, 'disabled'),
      groupId ? eq(accounts.groupId, groupId) : isNull(accounts.groupId), // 新增
    ))
  // ……后续 available 过滤 / 粘性会话 / 权重+LRU 排序保持不变
}
```

### `src/routes/relay.ts`

调用处（约 `relay.ts:621`）把 Key 的分组绑定传进去：

```typescript
const account = await pickAccount(provider.id, tried, sessionKey, apiKey.accountGroupId ?? null)
```

> **粘性会话**无需特殊处理：若某会话先前绑定的账号已不在该 Key 的分组内，该账号不会进入 `available`，
> 现有逻辑会自动回退到组内 LRU（见 `pickAccount` 内 `available.find(stickyId)` 后的兜底排序）。

## 六、Key 持久化与鉴权透传

### `src/keys/manager.ts`

- `CreateApiKeyInput` / `UpdateApiKeyPatch` 增加 `accountGroupId?: string | null`。
- `createApiKey` 的 `insert(...).values({...})` 写入 `accountGroupId: input.accountGroupId ?? null`。
- `updateApiKey` 走既有 patch 合并（`accountGroupId` 在 patch 里即可被 `set`）。
- **关键**：`findApiKeyBySecret`、`listApiKeys`、`listApiKeysForUser` 的 `select({...})` 都补上
  `accountGroupId: apiKeys.accountGroupId`——其中 `findApiKeyBySecret` 是 relay 选号前的鉴权查询，
  必须带上它，relay 才能零额外查询拿到绑定。

### `src/middleware/apiKeyAuth.ts`

鉴权中间件把 DB 记录组装成 `request.apiKey`（约 `apiKeyAuth.ts:86`）。两处同步：

```typescript
// 1) AuthedApiKey 类型加字段
//    accountGroupId: string | null
// 2) request.apiKey = { ... } 内补：
accountGroupId: record.accountGroupId ?? null,
```

这样 `relay.ts` 里的 `apiKey.accountGroupId` 才有值。

## 七、账号与分组管理

### 账号侧（`src/accounts/manager.ts`）

- `createAccount` 入参增加可选 `groupId`，写入 `accounts.groupId`。
- 新增 `setAccountGroup(id, groupId: string | null)`（与既有 `setAccountWeight` / `setAccountStatus` 同风格）。
- `listAccounts` 的返回补 `groupId`，并 `leftJoin(accountGroups)` 带出 `groupName`，供前端展示。

### 分组 CRUD（新建 `src/accounts/groups.ts`）

```typescript
createGroup(input: { name: string; description?: string | null }): Promise<{ id: string }>
listGroups(): Promise<Array<{ id; name; description; accountCount }>> // accountCount 可聚合得到
renameGroup(id: string, patch: { name?: string; description?: string | null }): Promise<void>
deleteGroup(id: string): Promise<void> // 删除策略见第八节
```

## 八、后台路由（`src/routes/admin.ts`）

### Key 的 zod 校验

`createKeySchema` / `updateKeySchema` 增加：

```typescript
accountGroupId: z.string().trim().min(1).nullable().optional(),
```

并在创建/更新 Key 的处理里透传给 `createApiKey` / `updateApiKey`。

### 分组路由（仅管理员，`preHandler: requireAdmin`）

```http
GET    /api/admin/account-groups            # 列表（含 accountCount）
POST   /api/admin/account-groups            # 创建 { name, description? }
PATCH  /api/admin/account-groups/:id        # 改名/改描述
DELETE /api/admin/account-groups/:id        # 删除（见删除策略）
```

账号设组：复用既有 `/api/admin/accounts/:id`（若无 PATCH 则新增），body 接受 `groupId: string | null`，
内部调 `setAccountGroup`。

### 删除分组策略

删除分组时，**在同一事务里**把引用它的账号与 Key 的分组列置空（移回默认池），避免悬空引用：

```sql
UPDATE accounts  SET group_id = NULL          WHERE group_id = $1;
UPDATE api_keys  SET account_group_id = NULL  WHERE account_group_id = $1;
DELETE FROM account_groups WHERE id = $1;
```

> 注意副作用：被绑定到该组的 Key 删组后会落回默认池，可能突然能命中默认池账号。
> 前端删除确认弹窗应提示「该组下的账号与 Key 将移回默认池」。

## 九、前端集成（Naive UI）

### `web/src/views/AccountsView.vue`

- 账号列表新增「分组」列（显示 `groupName`，未分组显示「默认池」）。
- 新建/编辑账号表单加分组下拉（`n-select`，选项来自分组列表 + 「默认池 / 不分组」= null）。
- 顶部加「管理分组」入口，弹窗内做分组的增删改查（调用第八节的分组路由）。

### `web/src/views/ApiKeysView.vue`

- 新建/编辑 Key 表单加「账号分组」下拉（选项含「默认 / 不限」= null）。
- 列表可加一列展示 Key 当前绑定的分组名，便于核对隔离关系。

### API client

在前端 API 封装里增加 account-groups 的 `list/create/rename/delete` 调用，
并给 Key 的 create/update 入参补 `accountGroupId`。

> 用户自助建 Key 的页面（`UserKeysView.vue`）**保持不变**：分组绑定是管理员能力，
> 用户创建的 Key 默认 `account_group_id = NULL`（默认池）。

## 十、边界与兼容性清单

- **向后兼容**：见第二节，默认值保证线上零影响。
- **provider × group 正交**：调度先按 `provider` 再按 `group` 过滤；一个组可含多 provider 账号，互不影响。
- **粘性会话**：账号被移出 Key 所属组后，自动从该 Key 的可选集中消失并回退 LRU，无需额外代码。
- **空组**：Key 绑定到一个没有可用账号的组时，`pickAccount` 返回 `null`，relay 回 `no <provider> account configured`（与现状一致）。
- **删除分组**：账号/Key 引用置空（第八节），需事务 + 前端提示。

## 十一、实施步骤（建议顺序）

1. Schema：`schema.ts` 加表与两列 → `init.ts` 幂等 DDL → `npm run db:generate` 出 `0002`。
2. 调度：`scheduler.ts` 的 `pickAccount` 加参与过滤；`relay.ts` 调用处传参。
3. 透传：`keys/manager.ts` 各 select/insert/patch + `apiKeyAuth.ts` 的类型与组装。
4. 管理：`accounts/manager.ts` 的 `createAccount`/`setAccountGroup`/`listAccounts` + 新建 `accounts/groups.ts`。
5. 路由：`admin.ts` 的 Key zod 与分组 CRUD 路由 + 账号设组。
6. 前端：`AccountsView.vue`、`ApiKeysView.vue` 与 API client。
7. 测试与验证（见下节）。

## 十二、验证清单（实现后执行）

- 后端类型检查：`npm run typecheck`。
- 前端类型检查：`cd web && npm run typecheck`；涉及 UI/构建再 `cd web && npm run build`。
- 单元测试：给 `pickAccount` 增「按分组过滤」用例（同目录 `scheduler` 测试风格，`npm test`）：
  - 默认池：未绑定 Key 只命中 `group_id IS NULL` 的账号；
  - 隔离：绑定 G 的 Key 只命中 G 组账号；G 组账号不被未绑定 Key 命中。
- 端到端：
  1. 建分组 G，把账号 A 设入 G，账号 B 保持未分组；
  2. 建绑定 G 的 Key1、未绑定的 Key2；
  3. 分别用 Key1/Key2 发起中转；
  4. 核对 `usage_logs.account_id`：Key1 只出现 A、Key2 只出现 B。
- 兼容性回归：对存量库（账号/Key 均未分组）跑一遍中转，确认行为与升级前一致。

## 十三、未来可扩展

- 一个 Key 绑定**多个**分组（`account_group_id` → `account_group_ids JSONB`，过滤改 `inArray`）。
- 组级 `fallback_to_default` 开关（回退式语义）。
- 组级默认配额 / 限流 / 权重，简化批量账号策略配置。
- 用户级默认分组：邀请用户时指定其新建 Key 的默认组。
