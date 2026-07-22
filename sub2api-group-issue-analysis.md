# Sub2API 分组问题分析

## 问题描述
将三个 sub2api 账户放在同一个分组下后，账户不能正常使用。

## 根本原因分析

根据代码审查，发现了关键问题：

### 1. 账户选择逻辑 (src/accounts/scheduler.ts)

在 `pickAccount` 函数中：

```typescript
// 第 55-75 行：当指定 groupId 时的账户选择
const rows = groupId
  ? await db
      .select({...})
      .from(accounts)
      .innerJoin(accountGroupMembers, eq(accountGroupMembers.accountId, accounts.id))
      .where(and(
        eq(accounts.provider, provider),
        ne(accounts.status, 'disabled'),
        eq(accountGroupMembers.groupId, groupId),
      ))
  : // 未分组的账户查询...
```

**关键发现：**
- 当 API Key 绑定到某个分组时，系统只会从 `account_group_members` 表中查询该分组的成员
- 查询使用 `INNER JOIN`，意味着账户必须同时满足：
  1. 在 `accounts` 表中存在
  2. 在 `account_group_members` 表中有对应的成员关系记录

### 2. Sub2API 的特殊冷却机制 (src/routes/relay.ts)

```typescript
// 第 98-99 行
const RELAY_TO_RELAY_COOLDOWN_MS = 15_000
```

Sub2API 作为 relay-to-relay 上游，失败后只会被冷却 15 秒（而不是普通账户的 2-10 分钟）。

### 3. 重试机制 (src/routes/relay.ts)

```typescript
// 第 93 行
const MAX_ATTEMPTS = 3
```

系统最多会尝试 3 次不同的账户。

## 可能的问题场景

### 场景 1：账户未正确加入分组
如果三个 sub2api 账户在 `accounts` 表中设置了 `group_id`，但 `account_group_members` 表中没有对应的记录，那么：
- 使用分组 API Key 时，查询结果为空（INNER JOIN 找不到匹配）
- 使用未分组的 API Key 时，这些账户也不可用（因为有 `notExists` 子查询排除了有 group_id 的账户）

### 场景 2：所有账户同时进入冷却
如果三个账户因为某种原因（如上游故障、配置错误）连续失败：
1. 第一次请求：尝试账户 A → 失败 → 冷却 15 秒
2. 继续尝试账户 B → 失败 → 冷却 15 秒
3. 继续尝试账户 C → 失败 → 冷却 15 秒
4. 所有账户都进入冷却，请求失败

### 场景 3：数据库迁移问题
从代码中看到有一个一次性的数据迁移（src/db/init.ts 第 330-343 行）：

```typescript
// 将旧的 accounts.group_id 迁移到 account_group_members 表
if (backfilled.rows[0]?.value !== '1') {
  await pool.query(
    `INSERT INTO account_group_members (account_id, group_id, weight, created_at)
     SELECT id, group_id, NULL, created_at FROM accounts WHERE group_id IS NOT NULL
     ON CONFLICT (account_id, group_id) DO NOTHING`
  )
}
```

如果分组操作在迁移之后进行，可能只更新了 `account_group_members` 表，而忘记更新其他相关配置。

## 诊断步骤

需要查询数据库确认以下信息：

1. **检查账户基本信息：**
   ```sql
   SELECT id, name, provider, status, cooldown_until, group_id 
   FROM accounts 
   WHERE provider = 'sub2api';
   ```

2. **检查分组成员关系：**
   ```sql
   SELECT agm.account_id, a.name, agm.group_id, ag.name as group_name, agm.weight
   FROM account_group_members agm
   LEFT JOIN accounts a ON agm.account_id = a.id
   LEFT JOIN account_groups ag ON agm.group_id = ag.id
   WHERE a.provider = 'sub2api';
   ```

3. **检查最近的错误日志：**
   ```sql
   SELECT id, ts, to_timestamp(ts/1000), provider, model, status, account_id, user_id
   FROM usage_logs 
   WHERE status != 'success' 
   ORDER BY ts DESC 
   LIMIT 3;
   ```

4. **检查 API Key 的分组绑定：**
   ```sql
   SELECT id, name, user_id, account_group_id 
   FROM api_keys 
   WHERE enabled = true;
   ```

## 可能的解决方案

1. **确保分组成员关系正确建立：**
   - 确认三个账户在 `account_group_members` 表中都有记录
   - 确认 API Key 的 `account_group_id` 字段指向正确的分组

2. **检查账户状态：**
   - 确认账户状态为 'active' 而不是 'disabled'、'error' 或 'rate_limited'
   - 如果在冷却中，清除冷却状态或等待冷却结束

3. **检查 proxy_url 配置：**
   - Sub2API 账户需要正确的 `proxy_url` 才能转发请求
   - 确认所有三个账户的 proxy_url 配置正确且可访问

4. **分离测试：**
   - 先单独测试每个账户是否可用
   - 然后再将它们放入同一个分组

## 下一步行动

需要启动数据库并执行上述 SQL 查询来确认具体问题。
