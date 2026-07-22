# Sub2API 分组问题完整解决方案

## 📋 问题描述
将三个 sub2api 账户放在同一个分组下后，账户无法正常使用。

## 🎯 最可能的原因（80% 概率）

### 账户未正确加入分组

**技术原因：**
- 在管理界面操作时，可能只更新了某些字段，但 `account_group_members` 表中缺少成员关系记录
- 系统使用 `INNER JOIN` 查询分组成员，没有记录就查询不到账户
- 详见代码：`src/accounts/scheduler.ts:55-75`

## 🔍 诊断步骤（按优先级）

### 方法 1：通过 Web 管理后台（最简单）

1. **启动服务**（如果未运行）
   ```bash
   # 如果使用 Docker
   docker compose up -d
   
   # 或者直接运行
   npm run dev
   ```

2. **访问管理后台**
   ```
   http://localhost:3003  （或你的部署地址）
   ```

3. **登录** - 使用管理员账号（默认 admin/admin）

4. **检查分组成员列表** ⭐ 最关键的一步
   - 进入：**分组管理** 页面
   - 找到目标分组，点击查看详情
   - 查看 **成员列表** 是否显示这三个 sub2api 账户
   - ❌ **如果列表为空或不完整** → 这就是问题所在！

5. **检查账户状态**
   - 进入：**账户管理** 页面
   - 找到三个 sub2api 账户
   - 确认状态是 `active`（不是 `error` 或 `rate_limited`）
   - 确认没有冷却倒计时
   - 确认 `proxy_url` 字段已正确填写

6. **检查 API Key 绑定**
   - 进入：**API Keys** 页面
   - 找到你使用的 API Key
   - 确认已绑定到正确的分组（不是"默认池"）

### 方法 2：运行诊断脚本（如果服务正在运行）

```powershell
# Windows
.\diagnose.ps1

# 或指定服务器地址
.\diagnose.ps1 -Server "http://your-server:3003"
```

脚本会自动检查所有配置并显示问题。

### 方法 3：直接查询数据库（需要数据库访问）

```bash
# 启动数据库
docker compose up -d postgres

# 运行诊断
npx tsx diagnose-sub2api-group.ts
```

## ✅ 解决方案

### 解决方案 1：在管理后台重新添加账户到分组

1. 进入 **分组管理** → 选择目标分组
2. 点击 **编辑成员** 或 **添加成员** 按钮
3. 勾选三个 sub2api 账户
4. 点击 **保存**
5. 刷新页面确认成员列表已更新
6. 重新测试 API 调用

### 解决方案 2：通过 SQL 手动修复（如果后台无法操作）

```sql
-- 1. 查看现有分组
SELECT id, name FROM account_groups;

-- 2. 查看 sub2api 账户
SELECT id, name FROM accounts WHERE provider = 'sub2api';

-- 3. 插入成员关系（替换实际的 ID）
INSERT INTO account_group_members (account_id, group_id, weight, created_at)
VALUES 
  ('sub2api_account_id_1', 'group_id', NULL, EXTRACT(EPOCH FROM NOW()) * 1000),
  ('sub2api_account_id_2', 'group_id', NULL, EXTRACT(EPOCH FROM NOW()) * 1000),
  ('sub2api_account_id_3', 'group_id', NULL, EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (account_id, group_id) DO NOTHING;

-- 4. 验证插入结果
SELECT 
  a.name as account_name,
  ag.name as group_name
FROM account_group_members agm
JOIN accounts a ON agm.account_id = a.id
JOIN account_groups ag ON agm.group_id = ag.id
WHERE a.provider = 'sub2api';
```

### 解决方案 3：清除账户冷却状态（如果账户在冷却中）

**通过管理后台：**
1. 进入 **账户管理**
2. 找到状态为 `error` 或 `rate_limited` 的账户
3. 点击操作菜单中的 **清除冷却** 或 **重置状态**

**通过 SQL：**
```sql
UPDATE accounts 
SET status = 'active', cooldown_until = NULL
WHERE provider = 'sub2api'
  AND status IN ('rate_limited', 'error');
```

### 解决方案 4：修正 proxy_url（如果配置错误）

**通过管理后台：**
1. 进入 **账户管理**
2. 编辑每个 sub2api 账户
3. 填写正确的 `proxy_url`：`https://your-sub2api-endpoint.com`
4. 保存

**通过 SQL：**
```sql
UPDATE accounts 
SET proxy_url = 'https://your-sub2api-endpoint.com'
WHERE id = 'account_id' AND provider = 'sub2api';
```

### 解决方案 5：绑定 API Key 到分组

**通过管理后台：**
1. 进入 **API Keys**
2. 编辑你使用的 API Key
3. 在"账户分组"下拉框中选择目标分组
4. 保存

**通过 SQL：**
```sql
-- 查看 API Keys
SELECT id, name, key_prefix, account_group_id FROM api_keys WHERE enabled = true;

-- 绑定到分组
UPDATE api_keys 
SET account_group_id = 'your_group_id'
WHERE id = 'your_api_key_id';
```

## 🧪 验证修复

修复后，按以下步骤验证：

1. **检查分组成员列表**
   - 管理后台 → 分组管理 → 查看分组详情
   - 确认三个账户都在列表中

2. **检查账户状态**
   - 管理后台 → 账户管理
   - 确认所有账户状态为 `active`

3. **测试 API 调用**
   ```bash
   curl -X POST http://localhost:3003/v1/messages \
     -H "Authorization: Bearer your-api-key" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "claude-3-5-sonnet-20241022",
       "max_tokens": 100,
       "messages": [{"role": "user", "content": "Hello"}]
     }'
   ```

4. **查看使用记录**
   - 管理后台 → 使用记录
   - 确认请求成功，没有错误

## 📊 相关文件说明

| 文件 | 用途 | 使用场景 |
|------|------|---------|
| `问题总结-Sub2API分组.md` | 问题总结和快速参考 | 了解问题概况 |
| `remote-diagnosis-guide.md` | 无需数据库的诊断指南 | 本地无法启动数据库 |
| `diagnose.ps1` | PowerShell 诊断脚本 | 服务运行时快速诊断 |
| `diagnose-sub2api-group.ts` | 完整诊断脚本 | 数据库可用时详细诊断 |
| `README-DIAGNOSIS.md` | 详细操作手册 | 深入了解和手动操作 |
| `sub2api-group-issue-analysis.md` | 技术原理分析 | 了解底层实现 |

## ❓ 常见问题

### Q1: 为什么在界面上设置了分组，但还是不工作？
**A:** 界面操作可能只更新了显示字段，但没有在 `account_group_members` 表中创建成员关系。需要重新在界面上操作或通过 SQL 手动插入。

### Q2: 三个账户单独使用都正常，为什么放在一起就不行？
**A:** 可能是成员关系配置问题，或者连续失败导致全部冷却。检查分组成员列表和账户状态。

### Q3: 清除冷却后还是不行怎么办？
**A:** 检查根本原因：
- proxy_url 是否配置正确
- 上游 sub2api 服务是否正常
- API Key 是否绑定到正确的分组

### Q4: 怎么确认是不是成员关系的问题？
**A:** 最直接的方法：打开管理后台 → 分组管理 → 查看分组详情 → 查看成员列表。如果列表为空或不完整，就是这个问题。

### Q5: 本地无法启动数据库怎么诊断？
**A:** 参考 `remote-diagnosis-guide.md`，通过 Web 管理后台界面检查，或者在部署服务器上运行诊断脚本。

## 🎉 成功案例

**典型场景：** 用户在管理界面将三个 sub2api 账户分配到分组，但 API 调用时提示无可用账户。

**诊断结果：** 分组详情页的成员列表为空。

**解决方法：** 在分组管理页面重新添加三个账户到分组。

**结果：** 问题立即解决，三个账户开始正常轮换使用。

## 📞 需要更多帮助？

如果问题仍未解决，请提供以下信息：

1. 管理后台截图：
   - 三个 sub2api 账户的状态
   - 分组详情页的成员列表
   - 使用的 API Key 配置

2. 诊断脚本输出（如果运行了）

3. 最近的错误日志（时间、状态、账户）

有了这些信息可以更准确地定位问题！
