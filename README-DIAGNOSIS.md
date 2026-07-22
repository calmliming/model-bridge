# Sub2API 分组问题诊断指南

## 问题概述

将三个 sub2api 账户放在同一个分组下后无法使用。

## 快速诊断步骤

### 1. 启动数据库

```bash
# 使用 Docker Compose 启动数据库
docker compose up -d postgres

# 等待数据库就绪（约5-10秒）
docker compose logs -f postgres
```

### 2. 运行诊断脚本

```bash
npx tsx diagnose-sub2api-group.ts
```

诊断脚本会检查：
- ✅ Sub2API 账户的基本信息和状态
- ✅ 账户分组配置
- ✅ 分组成员关系（account_group_members 表）
- ✅ API Keys 的分组绑定
- ✅ 最近的错误日志
- ✅ 潜在的配置问题

## 常见问题和解决方案

### 问题 1：账户未正确加入分组

**症状：**
- 诊断脚本显示"未找到任何 sub2api 账户的分组成员关系"
- 或者只有部分账户在 account_group_members 表中

**原因：**
账户在界面上设置了分组，但 `account_group_members` 表中没有对应记录。

**解决方案：**
手动插入分组成员关系：

```sql
-- 查看现有分组
SELECT id, name FROM account_groups;

-- 查看 sub2api 账户
SELECT id, name FROM accounts WHERE provider = 'sub2api';

-- 将账户加入分组（替换实际的 account_id 和 group_id）
INSERT INTO account_group_members (account_id, group_id, weight, created_at)
VALUES 
  ('account_id_1', 'group_id', NULL, EXTRACT(EPOCH FROM NOW()) * 1000),
  ('account_id_2', 'group_id', NULL, EXTRACT(EPOCH FROM NOW()) * 1000),
  ('account_id_3', 'group_id', NULL, EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (account_id, group_id) DO NOTHING;
```

### 问题 2：所有账户都在冷却中

**症状：**
- 诊断脚本显示账户状态为 'rate_limited' 或 'error'
- cooldown_until 时间未过期

**原因：**
可能是上游服务故障或配置错误导致所有账户连续失败。

**解决方案：**
清除冷却状态：

```sql
-- 清除所有 sub2api 账户的冷却
UPDATE accounts 
SET status = 'active', cooldown_until = NULL
WHERE provider = 'sub2api'
  AND status IN ('rate_limited', 'error');
```

### 问题 3：API Key 未绑定到分组

**症状：**
- 账户已正确加入分组
- 但 API Key 的 account_group_id 为 NULL

**原因：**
API Key 没有绑定到分组，仍然使用默认池（未分组的账户）。

**解决方案：**

```sql
-- 查看 API Keys
SELECT id, name, key_prefix, account_group_id FROM api_keys WHERE enabled = true;

-- 将 API Key 绑定到分组
UPDATE api_keys 
SET account_group_id = 'your_group_id'
WHERE id = 'your_api_key_id';
```

### 问题 4：proxy_url 配置错误

**症状：**
- 错误日志显示连接失败
- 账户状态频繁变为 'error'

**原因：**
Sub2API 需要正确的 proxy_url 才能转发请求。

**解决方案：**

```sql
-- 检查 proxy_url
SELECT id, name, proxy_url FROM accounts WHERE provider = 'sub2api';

-- 更新 proxy_url（替换实际值）
UPDATE accounts 
SET proxy_url = 'https://your-sub2api-endpoint.com'
WHERE id = 'account_id';
```

### 问题 5：账户被禁用

**症状：**
- 账户状态为 'disabled'

**原因：**
可能是 OAuth token 失效或手动禁用。

**解决方案：**

```sql
-- 重新启用账户
UPDATE accounts 
SET status = 'active', cooldown_until = NULL
WHERE id = 'account_id' AND provider = 'sub2api';
```

## 手动 SQL 查询

如果诊断脚本无法运行，可以直接连接数据库执行以下查询：

### 连接数据库

```bash
# 使用 psql（如果已安装）
psql postgres://model_bridge:9a686e2773a3729e51a7b4221b7ff312@127.0.0.1:5432/model_bridge

# 或者通过 Docker
docker compose exec postgres psql -U model_bridge -d model_bridge
```

### 关键查询

```sql
-- 1. 查看所有 sub2api 账户
SELECT id, name, status, cooldown_until, proxy_url, weight 
FROM accounts 
WHERE provider = 'sub2api';

-- 2. 查看分组成员关系
SELECT 
  a.name as account_name,
  ag.name as group_name,
  agm.weight as member_weight,
  a.weight as account_weight
FROM account_group_members agm
JOIN accounts a ON agm.account_id = a.id
JOIN account_groups ag ON agm.group_id = ag.id
WHERE a.provider = 'sub2api';

-- 3. 查看最近的错误
SELECT 
  to_timestamp(ts/1000) as time,
  provider,
  model,
  status,
  account_id
FROM usage_logs 
WHERE status != 'success' 
ORDER BY ts DESC 
LIMIT 5;

-- 4. 查看 API Key 绑定
SELECT 
  ak.name,
  ak.key_prefix,
  ag.name as bound_group
FROM api_keys ak
LEFT JOIN account_groups ag ON ak.account_group_id = ag.id
WHERE ak.enabled = true;
```

## 相关文件

- `diagnose-sub2api-group.ts` - 自动诊断脚本
- `sub2api-group-issue-analysis.md` - 详细的技术分析
- `src/accounts/scheduler.ts` - 账户选择逻辑
- `src/routes/relay.ts` - 请求转发和重试逻辑
- `src/db/init.ts` - 数据库表结构

## 获取帮助

如果问题仍未解决，请提供：
1. 诊断脚本的完整输出
2. 最近的错误日志（包括时间戳和错误状态）
3. 账户和分组的配置截图
