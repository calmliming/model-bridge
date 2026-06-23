# sub2api 近期更新实施计划

> 跟踪对象：Wei-Shaw/sub2api v0.1.137 与 v0.1.138  
> 整理日期：2026-06-23  
> 目标仓库：model-bridge

## 背景

sub2api 在 2026-06-16 发布 v0.1.137，在 2026-06-22 发布 v0.1.138。两版更新集中在 OpenAI 账号 quota/reset、上游兼容性、账号调度、错误透传和订阅推广返利等方向。

model-bridge 当前已经具备多服务商中转、账号分组、API Key、用户钱包、订阅套餐、用量统计、缓存 Token 明细、账号 quota 自动暂停和基础支付闭环。本计划不照搬 sub2api 的完整 SaaS 能力，而是优先补齐对网关稳定性和运维体验价值最高的部分。

参考来源：

- [sub2api v0.1.137](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.137)
- [sub2api v0.1.138](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.138)

## 首期目标

首期采用“稳定性优先”的范围，重点落地以下能力：

1. OpenAI OAuth 账号 quota 查询与手动触发 reset。
2. OpenAI 账号调度增加“优先最快重置账号”策略。
3. OpenAI Responses 错误和 `cyber_policy` 硬阻断更准确透传与记录。
4. Gemini 工具 schema 兼容性清理。
5. 对新版 Claude Code CLI / Codex 相关请求头和错误形态做兼容检查。

订阅推广返利属于偏 SaaS/运营增长能力，首期不实现，只作为后续评估项。

## 重点实施项

### 1. OpenAI quota 查询与 reset

新增 OpenAI OAuth 账号的 quota 查询和 reset 操作，服务于管理员手动运维。

后端建议：

- 在 OpenAI OAuth token 交换和刷新阶段解析 `id_token`，提取并保存 `chatgptAccountId`、`chatgptUserId`、`organizationId`、`email`、`planType` 等非敏感元数据。
- 元数据存入现有 `accounts.metadata`，不新增数据库表。
- 新增 `GET /api/admin/accounts/:id/openai/quota`，查询 ChatGPT/Codex quota 使用情况和可用 reset credit 数量。
- 新增 `POST /api/admin/accounts/:id/openai/reset-quota`，消耗一次 reset credit。
- reset 成功后刷新本地 quota 快照。
- 日志只记录账号 ID、状态码和窗口信息，禁止记录 access token、refresh token、authorization header、reset 原始敏感响应。

前端建议：

- 在账号页 OpenAI 账号的配额区域展示 reset credit 数量。
- 增加“重置限额”动作，仅 OpenAI OAuth 账号可见。
- 点击 reset 前弹出二次确认，提示该操作会消耗一次上游 reset credit。
- reset 成功后自动刷新账号列表。

### 2. OpenAI 调度策略

当前 model-bridge 的调度逻辑以粘性会话、权重和 LRU 为主。建议新增一个轻量策略，而不是引入 sub2api 的完整 advanced scheduler。

后端建议：

- 新增设置项 `openaiSchedulingStrategy`。
- 可选值：
  - `weighted_lru`：默认值，保持现有行为。
  - `prefer_soonest_reset`：优先选择 quota reset 时间最近的可用 OpenAI 账号。
- 策略仅影响 OpenAI 非 sticky fallback 调度。
- 粘性会话仍优先，避免破坏对话缓存和会话连续性。
- 排序建议：最快 reset 时间、权重、lastUsedAt。
- 非 OpenAI provider 行为保持不变。

前端建议：

- 在设置页或账号页增加 OpenAI 调度策略选择。
- 默认展示为“权重 + 最近最少使用”，可切换为“优先最快重置”。

### 3. OpenAI Responses 错误透传

sub2api v0.1.137 强调 `cyber_policy` 硬阻断全链路透传。model-bridge 目前已有 Responses 协议错误事件构造能力，但还应补强错误分类和记录。

后端建议：

- 将 `response.failed` 和 `response.incomplete` 统一视作错误结果写入 usage log。
- `response.completed` 才记录为成功。
- 识别 `error.code === "cyber_policy"` 时：
  - 不触发账号 failover。
  - 不将账号置入 cooldown。
  - 保留上游 code/message 给客户端。
  - usage log 记录 `status="error"`。
- 对 Responses SSE 终止事件保持兼容：`response.completed`、`response.failed`、`response.incomplete` 都应终止流。

### 4. Gemini 工具 schema 清理

sub2api v0.1.138 修复了 Gemini 工具 schema 兼容问题。model-bridge 的 Gemini relay 当前只做请求 envelope 包装，建议增加 schema 清理。

后端建议：

- 在 `src/providers/gemini/relay.ts` 增加请求体清理函数。
- 递归处理 `tools` / function declarations 中的 JSON Schema。
- 移除 Gemini 不支持或容易导致 400 的字段，例如：
  - `$schema`
  - `$id`
  - `$defs`
  - `definitions`
  - `additionalProperties`
  - `title`
  - `default`
  - `examples`
  - `nullable`
- 保留必要字段：
  - `type`
  - `description`
  - `enum`
  - `required`
  - `properties`
  - `items`

测试建议覆盖嵌套 object、array、function declarations，以及没有工具时不改变请求体。

### 5. Claude Code / Codex 兼容检查

sub2api v0.1.138 移除了旧版 `cch` 签名伪装，并适配新版 Claude Code CLI。model-bridge 当前 Claude 和 OpenAI/Codex 路径较轻，建议做一次兼容检查。

检查项：

- OpenAI Codex 上游请求的 `user-agent`、`originator`、`session_id` 是否仍符合当前 Codex 后端要求。
- Claude OAuth 测试请求是否不依赖旧版 `cch` 字段。
- 失败响应是否能被客户端明确展示，而不是导致客户端无限重试。
- 文档中提醒 Nginx 反代需要保留带下划线请求头时，可补充 `underscores_in_headers on;`。

## 暂缓或不适用项

### 订阅推广返利

sub2api v0.1.138 新增订阅推广返利。该能力涉及邀请关系、返利比例、冻结期、返利上限、返利流水和余额转入等完整运营模型。

model-bridge 当前定位偏轻量自托管和小团队使用，首期不纳入。后续如果要做，建议单独规划：

- 邀请码与邀请关系。
- 全局返利比例和用户专属返利比例。
- 返利冻结期、有效期、单个被邀请人返利上限。
- 返利流水、转余额、后台审计。
- 用户端返利概览和管理员返利管理页。

### Vertex / GLM / 图像生成

sub2api v0.1.138 包含 Vertex Anthropic、GLM reasoning effort 和 OpenAI 图像生成相关修复。当前 model-bridge 暂无 Vertex/GLM/图像生成主路径，首期不做。

后续如果新增这些 provider 或接口，再按对应能力补充兼容逻辑和测试。

### SELinux bind mount

sub2api 的 Docker bind mount `:Z` 修复主要面向 SELinux 环境。model-bridge 当前不作为首期功能处理，可在部署文档中作为 Linux/SELinux 注意事项补充。

## 实施拆分

### 后端

1. 扩展 OpenAI OAuth 元数据解析与持久化。
2. 新增 OpenAI quota 查询和 reset service。
3. 增加管理员 API 路由和 Zod 校验。
4. 扩展 `AccountQuotaSnapshot`，支持 reset credit 展示。
5. 增加 OpenAI 调度策略设置和排序逻辑。
6. 补强 Responses 错误分类、`cyber_policy` 透传和 usage 状态记录。
7. 增加 Gemini schema 清理。

### 前端

1. 账号页展示 OpenAI reset credit。
2. 账号页增加“重置限额”操作和确认弹窗。
3. 设置页或账号页增加 OpenAI 调度策略选择。
4. 对 quota 刷新、reset 成功/失败提示做统一处理。

### 文档

1. 更新 `docs/comparison-with-sub2api.zh-CN.md` 的跟踪版本到 v0.1.138。
2. 在差异表中新增 v0.1.137/v0.1.138 相关能力。
3. 标记首期实现项、暂缓项和不适用项。

### 测试

后端测试：

- OpenAI `id_token` 解析。
- OpenAI quota usage 映射。
- OpenAI reset 请求体、成功响应、失败响应。
- 缺失 `chatgptAccountId` 时返回明确错误。
- 调度策略默认行为不变。
- `prefer_soonest_reset` 只影响 OpenAI fallback 调度。
- Responses `response.failed` / `response.incomplete` 记录为错误。
- `cyber_policy` 不 failover、不 cooldown。
- Gemini schema 清理保留必要字段。

前端测试或手动验收：

- OpenAI 账号显示 reset credit。
- 非 OpenAI 账号不显示 reset 操作。
- reset 操作有二次确认。
- reset 成功后刷新配额。
- 设置项保存后后端返回一致。

建议执行命令：

```bash
npm run typecheck
npm test
cd web && npm run typecheck
cd web && npm run build
```

## 验收标准

1. 管理员可以查看 OpenAI OAuth 账号 quota 和 reset credit。
2. 管理员可以手动消耗一次 OpenAI reset credit，成功后本地 quota 快照刷新。
3. 默认调度行为与现有版本兼容。
4. 开启“优先最快重置”后，OpenAI fallback 调度会优先选择 reset 时间最近的可用账号。
5. Responses `failed` / `incomplete` 不再被误记为成功。
6. `cyber_policy` 被准确透传给客户端，并记录为错误用量。
7. Gemini 工具 schema 中不兼容字段被清理，常见工具调用请求不再因 schema 字段失败。
8. 不新增明文敏感日志。

## 默认假设

- 首期不实现订阅推广返利。
- 不新增数据库表，优先使用 `accounts.metadata` 和 `settings`。
- OpenAI reset 只支持 OAuth 账号，不支持 API Key 账号。
- 缺少 OpenAI `chatgptAccountId` 的老账号需要重新授权，或等待 token refresh 后补齐元数据。
- 所有新增外部输入都必须做 Zod 校验。
