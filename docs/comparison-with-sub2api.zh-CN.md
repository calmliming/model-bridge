# model-bridge vs sub2api 差异化对比

> 对比对象：[Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)（已核查至 **v0.1.183**，2026-08-25）
> 更新日期：2026-08-27

## 一句话定位

| 项目 | 定位 |
|---|---|
| **model-bridge**（本项目）| 自托管的多服务商 AI API 中转平台，偏「个人 / 小团队 / 小规模拼车」的轻量网关 |
| **sub2api** | AI API 网关 + **拼车 SaaS 平台**，主打「订阅配额分发 + 内置计费收款」 |

核心区别一句话：**sub2api 是更完整的商业化拼车 SaaS；model-bridge 已具备中转、管理后台、邀请用户、钱包、余额扣费、充值订单、支付宝/微信在线收款闭环、账号分组和基础登录安全加固，但在 2FA/TOTP、出站 URL allowlist/SSRF 与更完整运维回滚上仍有差距，整体保持轻量自托管定位。**

---

## 一、技术栈差异

| 维度 | model-bridge | sub2api |
|---|---|---|
| 后端 | Node.js + TypeScript + **Fastify** | **Go** + Gin + Ent |
| 数据库 | **PostgreSQL**（Drizzle ORM）| PostgreSQL 15+ |
| 缓存 / 共享状态 | **可选 Redis（可插拔）**，默认走进程内存 | Redis 7+（必需） |
| 前端 | Vue 3 + Vite + **Naive UI** + ECharts | Vue 3 + Vite + **TailwindCSS** |
| 部署 | Docker Compose / 裸机 | 一键脚本(systemd) / Docker / 源码 |

> 说明：model-bridge 的限流、并发门、粘性会话状态做成了「可插拔后端」——不配置 `REDIS_URL` 时走进程内存（保持零依赖部署），配置后切到 Redis 实现多实例水平扩展。详见下文「差异化机会清单」第 9 项。

---

## 二、model-bridge 独有 / 更强的地方 ✅

1. **DeepSeek / Xiaomi MiMo 支持** —— 本项目支持 messages / chat completions / responses 三种协议，并可用 API key 接入国产上游。
2. **更细的协议兼容层** —— 显式实现了 OpenAI Responses API、DeepSeek 原生 Responses、流式终止事件保证。
3. **轻量、零外部依赖默认值** —— 不强制 Redis，单进程内存即可跑通限流 / 并发 / 粘性会话，部署更简单；需要扩展时再开 Redis。
4. **TypeScript 全栈** —— 对 JS / TS 团队更友好，二次开发门槛低。
5. **首 Token 延迟观测** —— usage 日志新增 `first_token_ms`，管理后台可同时查看总耗时和流式首 Token 延迟。

---

## 三、sub2api 独有 / 本项目缺失的功能 ❌（差异化机会清单）

> 按价值排序，标注当前进度。

| # | 功能 | sub2api | model-bridge | 状态 |
|---|---|:---:|:---:|---|
| 1 | **账号分组隔离**（账号编组 + Key 绑定组，调度限定组内）| ✅ | ✅ 已实现（账号分组 + Key 绑定 + 隔离式调度）| ✅ 已完成 · 实现见 [account-groups-plan](./account-groups-plan.zh-CN.md) |
| 2 | **登录与接口安全加固**（2FA/TOTP、Turnstile 验证码、可信代理 IP、CSP 安全响应头、出站 URL allowlist/SSRF、计费失败熔断）| ✅ | ⚠️ 已部分实现（Turnstile、登录限流、零配置本机/私网代理信任、CSP/安全响应头、非流式计费失败 fail-closed）| 进行中 · 剩余 2FA/TOTP、出站 URL allowlist/SSRF、流式计费熔断 |
| 3 | **Web 一键升级 + 回滚** | ✅ | ⚠️ 已实现检查 / 一键升级，回滚待扩展 | 进行中 · 运维体验 |
| 4 | **内置在线收款**（支付宝 / 微信扫码）| ✅ | ✅ 已实现（扫码 + 异步回调 + RSA2/MD5 验签 + 幂等 + 自动入账）| ✅ 已完成（Alipay / WeChat）|
| 5 | **Stripe / EasyPay 国际支付** | ✅ | ❌ | 低优先级 · 国内收款已覆盖 |
| 6 | **用户自助注册 / 开放注册** | ✅ | ⚠️ 邀请制用户体系 | 可用但偏私域 |
| 7 | **Antigravity 上游 + 混合调度** | ✅ | ❌ | 待评估 |
| 8 | **用户钱包 + 余额扣费闭环** | ✅ | ✅ 基础能力已实现 | ✅ 管理员调账、用户余额、usage 扣费、充值订单入账 |
| 9 | **Redis 化状态（多实例水平扩展）** | ✅ | ✅ **已实现（可插拔）** | ✅ 完成 |
| 10 | **iframe 外部系统嵌入**（如工单系统）| ✅ | ❌ | 低优先级 |
| 11 | **移动管理端 App**（RN / Expo）| ✅ | ❌ | 低优先级 · 生态 |
| 12 | **Simple Mode**（隐藏 SaaS 功能给个人用）| ✅ | ➖ 本项目天然即简化版 | 不适用 |
| 13 | **账号配额自动暂停**（按 5h/7d 用量阈值自动暂停账号调度，支持全局默认 + 单账号禁用） | ✅ (v0.1.133) | ✅ 已实现（可配置全局阈值 + 单账号覆盖/关闭，达到阈值停调至窗口重置，含后台周期兜底扫描） | ✅ 已完成 |
| 14 | **用户分平台配额**（anthropic/openai/gemini/antigravity 各设日/周/月 USD 上限） | ✅ (v0.1.131/132) | ⚠️ 已有 per-Key USD 配额上限（`quotaLimit`），但无按用户分平台 + 时间窗的配额 | 中优先级 |
| 15 | **失败请求追踪**（用户端 + 管理端记录/查看失败请求） | ✅ (v0.1.134) | ❌ | 中优先级 · 观测增强 |
| 16 | **OpenAI embeddings 网关** | ✅ (v0.1.133) | ❌ | 低优先级 · 协议覆盖 |
| 17 | **内容审计 / 风控**（按模型生效的内容审核、前置拦截风控运行态） | ✅ (v0.1.130/134) | ❌ | 待评估 · 合规向 |
| 18 | **钉钉 OAuth 登录** | ✅ (v0.1.127) | ❌ | 低优先级 |
| 19 | **图像 token 计费** | ✅ (v0.1.134) | ✅ 已实现（图片输入/输出 token 独立持久化与计价） | ✅ 已完成 |
| 20 | **邀请返利系统**（返利冻结期 / 有效期 / 单人上限 / 专属邀请码） | ✅ (v0.1.119/138) | ⚠️ 已有邀请制用户体系，无返利结算 | 低优先级 · 偏 SaaS |
| 21 | **OpenAI 账号 quota 查询 + 手动 reset credit** | ✅ (v0.1.137/138) | ✅ 已实现（管理员查询 ChatGPT 配额、消耗 reset credit，OAuth 账号专属）| ✅ 已完成 |
| 22 | **OpenAI 调度策略「优先最快重置」** | ✅ (v0.1.138) | ✅ 已实现（设置项 `openai_scheduling_strategy`，仅影响 OpenAI 非粘性回退）| ✅ 已完成 |
| 23 | **`cyber_policy` 硬阻断全链路透传** | ✅ (v0.1.137) | ✅ 已实现（Responses `failed`/`incomplete` 记为错误，不 failover/cooldown，透传上游 code/message）| ✅ 已完成 |
| 24 | **Gemini 工具 schema 兼容清理** | ✅ (v0.1.138) | ✅ 已实现（递归清理 function declarations 中不兼容的 JSON Schema 字段）| ✅ 已完成 |
| 25 | **OpenAI `token_expired` refresh 永久失效分类** | ✅ (v0.1.144) | ✅ 已实现（命中即禁用账号并标记需重新授权，停止后台无效重试）| ✅ 已完成 |
| 26 | **Claude Fable 7d_oi 模型级 quota 窗口** | ✅ (v0.1.144) | ⚠️ 已实现窗口采样/展示与 Fable-only 429 不整体 cooldown；未做持久化模型级调度黑名单 | 轻量完成 |
| 27 | **Codex `image_generation` 工具策略** | ✅ (v0.1.144) | ✅ 网关开关开启时保留显式 tool / `tool_choice`，关闭时统一剥离 | ✅ 轻量完成 |
| 28 | **Anthropic OAuth dateline 指纹归一化** | ✅ (v0.1.142) | ✅ 已实现（system 与 `<system-reminder>` 内日期句归一化，避免改用户正文） | ✅ 已完成 |
| 29 | **OpenAI Images 网关**（generations / edits、JSON / multipart、JSON / SSE） | ✅ | ✅ 参考 sub2api OAuth Responses 图片桥实现 | ✅ 已完成 |
| 30 | **Responses `input_tokens` 预检端点** | ✅ (v0.1.179) | ✅ 已实现本地结构化估算（最终用量仍以上游 usage 为准） | ✅ 兼容完成 |

> 上表第 13–20 项为对照 sub2api **v0.1.119–v0.1.134** 新增能力补入；第 21–24 项为对照 **v0.1.137/v0.1.138** 补入；第 25–28 项为对照 **v0.1.142–v0.1.144** 补入。标 ✅ 的括号为该能力在 sub2api 的引入版本。这些多为偏 SaaS / 合规 / 计费精度方向，符合 model-bridge「轻量自托管」错位定位，按价值择优追赶即可。

---

## 四、双方打平的功能

多账户管理、API Key 分发、账号分组隔离、用户邀请登录、用户钱包、余额扣费、充值订单、**支付宝 / 微信在线收款**、Token 级用量统计与成本计算、粘性会话调度、并发控制、限流、Web 管理仪表盘、OAuth 授权、PostgreSQL、Claude / OpenAI(Codex) / Gemini 支持。

---

## 五、差异化策略建议

### 错位（保持轻量自用定位）
- 强化 DeepSeek + 国产模型支持，覆盖 sub2api 不做的上游。
- 保持「默认零 Redis、一键起」的极简部署优势，Redis 仅作为可选的扩展开关。
- 继续增强观测能力，例如首 Token 延迟、账号 quota 快照、按用户 / key / provider 的成本拆分。

### 追赶（优先级从高到低）
1. **登录与接口安全加固** —— ✅ 已落地 Turnstile、登录限流、CSP 等安全响应头、非流式计费失败 fail-closed；继续补管理员/用户 2FA(TOTP)、出站 URL allowlist 防 SSRF、流式计费失败熔断。
2. **Web 一键升级 + 回滚** —— ✅ 已落地后台检查更新 / 一键升级；继续补回滚与更新审计。
3. **Stripe / EasyPay 国际支付** —— 在已有支付宝/微信之上补海外收款（低优先级）。
4. **开放注册 / 用户套餐** —— 如果要从私域邀请制走向公开 SaaS。
5. ~~账号分组隔离~~ —— ✅ 已完成（账号编组 + Key 绑定组 + 隔离式调度，实现见 [account-groups-plan](./account-groups-plan.zh-CN.md)）。
6. ~~支付接入（支付宝 / 微信）~~ —— ✅ 已完成（扫码 + 异步回调 + 验签 + 幂等入账）。
7. ~~支付回调审计（验签、幂等、异常处理）~~ —— ✅ 已完成。
8. ~~Redis 化并发 / 会话状态~~ —— ✅ 已完成（可插拔）。

---

## 六、本次更新整理

### 核查 sub2api v0.1.175–v0.1.183（2026-08-12～2026-08-26）

本轮对照上游连续版本，补齐了与本项目原生协议路径同构、且不会引入新数据库迁移的兼容性修复：

- **Gemini 工具 Schema 清理增强**：在递归清理基础上继续移除 `minLength`、`maxLength`、`minItems`、`maxItems`、`exclusiveMinimum`、`deprecated`；混合标量 `enum` 归一为字符串，含对象/数组等复合值的枚举安全丢弃，避免 Code Assist 400。
- **Kimi Code K3 路由兼容**：`k3`、`k3-256k`、`kimi-code/k3` 纳入 Kimi 模型发现和裸路径按模型分发；原生 Moonshot 上游统一转换为 `kimi-k3`，Sub2API 专用 Key 仍保留原始模型名透传。
- **Kimi 403 并发限制兼容**：精确识别 Kimi 返回的 `You've reached your concurrent request limit...`，按临时限流处理并继续故障转移，避免把可恢复的并发拒绝当成永久权限错误。
- **OpenAI/Codex 配额 429 识别**：识别 `usage_limit_reached`、`GoUsageLimitError` 及 `resets_at` / `resets_in_seconds` 响应体，按账号窗口暂停到重置时间；非耗尽快照不再把账号错误冷却到 5 小时/7 天窗口。
- **Codex 会话与容量溢出**：支持 `session-id` 会话信号；粘性账号并发已满时允许一次溢出，但不把持久会话绑定迁移到临时账号。
- **Responses 工具历史 ID 归一**：对已知 `fc_` / `ctc_` / `tsc_` / `tso_` 前缀按输入项类型归一，避免 custom tool / tool search 历史重放触发上游 ID 校验 400。

以上四项已在本项目落地。Sub2API v0.1.183 的 Antigravity token 上限、邮箱别名事务保护和 Composite 频道监控修复依赖本项目未采用的账号/监控模型，暂不照搬；New API `v1.0.0-rc.26` 的 32 位额度迁移和 vLLM 专属字段也不与本项目后端同构，未引入对应数据库迁移。

以下上游能力暂未照搬：Responses Lite 专用 OAuth/WS 传输细节、Remote Compaction V2 全链路、服务层级（Fast/Flex）与渠道级逐模型定价、OpenAI 官方输入 token 预检转发。这些功能依赖 Sub2API 的 Go 调度/账号模型或独立上游接口，直接移植会改变本项目的轻量架构；后续应分别设计兼容层和配置开关。

### 跟踪 sub2api 至 v0.1.179（2026-08-21）

对照 v0.1.173–v0.1.179 的发布内容，先落地与现有协议入口直接相关的 `POST /v1/responses/input_tokens` 预检端点。该端点支持 `/v1/responses/input_tokens`、`/responses/input_tokens` 和 `/api/openai/v1/responses/input_tokens`，返回标准 `response.input_tokens` envelope；由于本项目没有统一 tokenizer，结果是有上限的本地结构化估算，最终计费和真实用量仍以上游 usage 事件为准。

本轮确认以下上游能力暂不直接照搬：

- Kimi / 智谱 / DeepSeek 的 adaptive API protocol：本项目已经为三种协议分别提供路由和转换器，但账号级多 Base URL / 自适应协商需要扩展账号配置模型，暂不改变现有账号语义。
- Fast/Flex 与上下文区间倍率、长上下文计费门控：属于渠道/分组级计价模型，当前 `model_pricing` 是全局模型价卡，直接引入会改变已有账单口径，单独立项处理。
- Grok 4.6 的模型发现、别名和基础价卡已同步（输入 $2、输出 $6、缓存读取 $0.50 / MTok）；原生 `x_search`、长上下文倍率、Codex remote compaction v2、被动渠道监控和运营后台能力依赖上游专有端点或 SaaS 调度架构，暂不直接照搬。
- v0.1.169 的 URL 路径校验与 v0.1.172 的建连超时、模型审计、计费量化：本项目已有 `src/http/urlGuard.ts`、`src/http/upstream.ts`、上游模型审计和微美元量化路径，后续只做针对性回归测试，不重复引入另一套机制。

### 跟踪 sub2api 至 v0.1.172（2026-08-07）

对照 2026-07-26 之后发布的 v0.1.166、v0.1.168、v0.1.169、v0.1.170、v0.1.171、v0.1.172，优先落地与本项目现有 relay 主路径同构的稳定性和安全修复：

- **上游建连超时**：所有供应商 relay 统一经 `src/http/upstream.ts` 的 `fetchWithConnectTimeout` 发起请求，10 秒内拿不到响应头即中止并交给现有 failover；响应头到达后清理计时器，不会截断长连接 SSE。对应 sub2api v0.1.172 的 DNS/TCP/TLS 建连超时修复。
- **Codex 工具 Schema 净化**：Chat Completions 转 Responses 时，工具 `parameters` 为 `null` 或非对象会归一为 `{ type: 'object', properties: {} }`，避免上游 400 及会话历史反复重放。对应 sub2api v0.1.172 的 `parameters.type` 修复。
- **OAuth 状态一次性消费**：管理端 OAuth finish 由先查后删改为数据库原子 `DELETE ... RETURNING`，并发提交同一 state 只有一个请求能继续换 token，降低 OAuth 补全竞态和重复建号风险。

本轮未照搬利润控制、Passkey、验证码、模型广场等 SaaS/运营功能，也未引入数据库迁移；新增行为均为兼容性加固。

### 跟踪 sub2api 至 v0.1.162（2026-07-20）

对照 sub2api v0.1.158–v0.1.162 及 v0.1.162 后的关键稳定性提交逐项核查。五个正式版本主要集中在 Grok 媒体/缓存生态、提示词安全审计、会话与 step-up 2FA 开关、Responses/WS 兼容、反向代理客户端 IP 和异步生图存储。多数能力依赖 sub2api 的 SaaS、Grok 媒体或 Go 调度架构，本仓库没有同构路径；本轮落地两项会直接影响现有部署安全或计费完整性的改动：

**已落地改动：**

- **零配置可信代理与真实客户端 IP**（对应 v0.1.159/v0.1.162）：按 sub2api 曾采用的本机/容器默认信任思路，Fastify 固定信任回环、RFC1918 私网和 IPv6 ULA 网段；仅当直连来源命中这些范围时解析 `X-Forwarded-For`，登录限流、注册限流和 Turnstile 的 `request.ip` 因而在常见 Nginx/Docker 反代后仍指向真实客户端。公网直连来源的转发头会被忽略，不新增部署配置；代价是源站不能直接开放给不可信内网客户端。
- **优雅关停与计费写入排空**（对应 v0.1.162 后 `304fcb0` 的关停清理修复，按本仓库架构加固）：流式响应原先在 `raw.end()` 后以 `void recordUsage()` 后台落库，进程收到 Docker `SIGTERM` 时可能直接退出并丢失末尾 usage/钱包扣费。现将流式写入纳入待完成集合并在请求处理器中等待；`SIGTERM`/`SIGINT` 触发 Fastify 关停后，依次停止后台任务、关闭 OAuth 回调服务、排空 usage、关闭 Redis/PostgreSQL。关停硬超时固定为 30 秒，Compose `stop_grace_period` 为 35 秒，不新增环境变量。

**已覆盖 / 无需重复实现：** OpenAI 临时冷却按模型隔离已在上一轮完成；DeepSeek Responses 已原生透传并保留 `web_search` / `apply_patch`，Qwen/Kimi/Xiaomi/Zhipu 的 Responses 转换已发送 `response.content_part.added/done` 和完整终态；本仓库重试失败响应不会逐次调用 `recordUsage`，不存在 sub2api 的同账号重试重复缓存计费路径。

**暂缓 / 不适用：** 用户并发/RPM 批量修改与分组复制属于管理效率增强，后续按实际运营规模补；提示词审计控制台、step-up 2FA、会话 IP/UA 绑定继续归入 SaaS/合规安全路线；Grok 媒体代理、Free 工具缓存、OpenAI WS、异步生图对象存储、Agent Identity Team 隔离等与当前轻量主路径不同构，不跟进。

### 跟踪 sub2api 至 v0.1.157（2026-07-16）

对照 sub2api v0.1.152–v0.1.157（3 天 5 版，v0.1.154 缺号）逐项核查 model-bridge 实际代码，方法与结论详见 [sub2api v0.1.152-157 实施计划](./sub2api-v0.1.152-157-实施计划.md)。核查确认 10 项 sub2api 修复在本仓库**无同构形态**（Haiku 伪装缺口、cache_creation 丢失、幻影 content_block_delta、长上下文重复计费、调度重建风暴等）；识别出 5 项真实差距并已全部落地：

**已落地改动：**

- **sub2api 透传错误净化**（对应 v0.1.156 passthrough 错误净化）：relay-to-relay 提供方（sub2api / sub2api-chat）最终失败响应此前把上游网关错误体逐字回传客户端，可能泄露上游后端地址、渠道名等内部信息。现改为重写成本网关自有 envelope（保留 HTTP 状态码 + `extractUpstreamError` 提取的 code/message，message 做 URL 脱敏），兼容 Anthropic/OpenAI 两种客户端解析；sub2api-responses 的合成 `response.failed` 路径同样对 message 做 URL 脱敏。完整原始错误体只进服务端日志。见 `src/routes/relay.ts` 的 `sendSanitizedRelayError` / `redactUrls`，含单测。
- **OpenAI 临时冷却按模型隔离**（对应 v0.1.157）：此前 cooldown 是账号级，单模型限流（如 plan-gated 模型的 400/429）会把整个账号停调。现在 OpenAI 的限流响应若**不带**账号级 Codex 配额窗口头（`x-codex-*`），判定为模型级限制，只冷却 `metadata.modelCooldowns[model]`，账号本身保持 active，其他模型继续调度；带账号窗口证据的 429 仍走账号级。不新增表，过期项写时清理、读时过滤。见 `src/accounts/scheduler.ts` 的 `penalizeAccountModel` / `modelCooldownUntil` 与 `relay.ts` 的 `isOpenaiModelScopedLimit`，含单测。
- **stop_reason / finish_reason 映射补全**（对应 v0.1.153 同类修复）：Anthropic `refusal` 此前被映射为 `stop`，现映射为 `content_filter`（`pause_turn` 维持 `stop`）；Responses→Chat 方向新增 `response.incomplete` 处理——`incomplete_details.reason` 为 `max_output_tokens` 时 finish_reason 记 `length`、`content_filter` 记 `content_filter`（缓冲与流式两条路径），流式 `response.failed` 也补了 error chunk 终止（对齐 claude→chat 已有模式），不再以假 `stop` 结尾。见 `src/providers/claude/chat.ts` 的 `mapStopReason` 与 `src/providers/openai/chat.ts` 的 `finishReasonFromIncomplete`，含单测。
- **客户端断开中止重试**（v0.1.156 failover 修复的反向加固）：本仓库不存在 sub2api 的「断开导致 failover 静默中止」bug，但此前完全未感知断开——客户端取消后仍会把 3 轮换号重试跑完，浪费上游配额。现在 `runRelayLoop` 监听响应连接提前关闭，只在**重试边界**（下一轮取号前）终止循环；在途上游请求不 abort，照常完成并正常落账，计费安全不受影响。
- **时区收尾**（d9a523e 残留）：前端 `formatTime` 此前用浏览器本地时区渲染，与 `STATS_TIMEZONE` 日桶可能跨天不一致。新增公开端点 `GET /api/auth/display-config` 下发 `statsTimezone`，前端启动时拉取后所有时间戳按该时区渲染（拉取失败回退浏览器本地）；同时修正 `stats.ts` 两处过时注释（"(UTC)"/"server timezone"）。

**暂缓 / 不适用**（详见实施计划）：Grok 增强包（xAI API Key 账号、账号级自定义 URL、健康监控、免费额度、prompt caching）、操作审计日志、会话 IP/UA 绑定、step-up 2FA、异步生图、Codex web 搜索按次计费、长上下文分档计费（待确认上游真实计费行为）、被拒字段自动剥离重试等。

### 跟踪 sub2api 至 v0.1.151（2026-07-11）

对照 sub2api v0.1.145–v0.1.151 的发布，逐项核查 model-bridge 实际代码。核查确认多数 sub2api 修复的现网 bug（originator/UA 错配、透传规则恒不命中、compact 无限重连、下游重复扣费、response.failed 硬编码 502）在本仓库**不存在同构形态**；识别出 **2 项真实计费/稳定性差距 + 1 项相关缺口 + 1 项维护性加固**并已落地。

**已落地改动：**

- **GPT-5.6 缓存写入计费**（对应 v0.1.150/151「cache write 独立计价 + 官方定价对齐」）：GPT-5.6 引入了 explicit cache breakpoints，cache write 按 1.25× input 计费（Sol 6.25 / Terra 3.125 / Luna 1.25），不同于其他仍不计 cache write 的 OpenAI tier。此前 model-bridge 三档 `cacheWrite` 均为 0 且 `usageWithCachedInput` 硬编码不解析 cache write token，会少算成本。改动：`src/usage/pricing.ts` 三档拆为独立 `TierPrice` 并填非零 cacheWrite（不再复用 gpt-5.5/5.4 引用，避免误伤）；`src/providers/types.ts` 的 `usageWithCachedInput` 加可选 `cacheWriteTokens` 参数、把总输入拆成互斥三桶（对齐 sub2api `InputTokens - CacheRead - CacheCreation` 语义），未传时行为不变；`src/providers/openai/{usage,chat}.ts` 从上游 usage 的 `input_tokens_details.cache_write_tokens`/`cache_creation_tokens` 提取。**部署要点**：老库 gpt-5.6 行已被播种成 cacheWrite=0，补了 3 条 `SEED_CORRECTIONS` 并将修正 flag `pricing_seed_v3`→`pricing_seed_v4`，让修正在现有部署重跑一次（幂等，admin 改过的价保留）。含单测。
- **remote compact 稳定性**（对应 v0.1.149/150「200+JSON 合成 + 心跳保活」，#3887）：`src/routes/relay.ts` 的 `sendStreaming` 加两处——① responsesProtocol 上游返回非 SSE 的 200 JSON 时，缓冲并合成 `response.completed`（成功）或错误终结事件，避免被当坏流处理导致 compact 失败、客户端重试消耗上游配额；② SSE 输出流在上游静默期每 15s 写 `: keepalive` 注释帧防反代空闲超时断连，收到数据即重置计时。（无限重连此前已由「末尾必补终结事件」兜底，下游按 cost>0 计费不会重复扣费。）
- **协议转换静默吞错**（v0.1.149 #2 的近亲缺口）：上游 200 后流中途出错的错误事件此前在协议转换器被静默丢弃。`src/providers/claude/chat.ts` transform 加 `case 'error'`，把 Anthropic error 转为 OpenAI 风格 error chunk + `[DONE]`；`src/providers/openai/chat.ts` 的 `responsesSseToChatCompletion` 捕获 `response.failed`/`incomplete`，无有效内容时返回 error body 并回传 `status:'error'`，让 `sendBuffered` 记为 error 而非空的假成功。含单测。
- **Codex 请求头单一来源**（对应 v0.1.151 originator/UA 404 修复的预防性加固）：核查确认本仓库四处 UA/originator **已统一**（均 `codex_cli_rs/0.20.0` + `codex_cli_rs`），无错配现网 bug；但版本号在 4 个文件硬编码有升级漂移风险。新建 `src/providers/openai/constants.ts` 导出 `CODEX_USER_AGENT`/`CODEX_ORIGINATOR`，relay/quota/oauth/tester 四处改为引用。

**核查确认无同类问题（未改代码）：**

- **originator/UA 错配 404**（v0.1.151）：四处头部已统一，无错配；仓库无 WebSocket 转发路径，该子项不适用。
- **response.failed 硬编码 502 / 透传规则恒不命中**（v0.1.149）：本仓库无「可配置错误透传规则」这套机制，走默认透明透传 + `classifyUpstreamFailure` 硬编码分类（按 `provider.id` 正确区分平台）；合成 `response.failed` 用 `extractUpstreamError` 保留真实 code/message，无硬编码 502。
- **effort 识别 / 带后缀丢元数据**（v0.1.150/151）：本仓库用量元数据取自上游 `response.usage`，不从模型名反推，故这两个 effort bug 不存在。gpt-5.6 别名匹配（sol/terra/luna + 裸 gpt-5.6→Sol）已对齐并有测试覆盖。

**待验证：** gpt-5.6-luna 404（v0.1.150 靠升级 Codex 客户端版本修复）—— 本仓库 UA 固定 `0.20.0`，是否受上游按 UA 版本 gate luna 影响需实测，暂未改版本号（已抽成单一常量，将来升级只需改一处）。

**不适用 / 暂不追：** v0.1.149–v0.1.151 的用户级 Fast/Flex 规则、版本一键回退、用户角色管理、用户 Token 排行、用量页布局重构、Grok 系列（Responses reasoning effort、OAuth、图像、配额探测）、Windows WebSocket 修复等，属偏 SaaS / 多上游生态或本仓库无对应路径，暂不纳入轻量主线。

### 跟踪 sub2api 至 v0.1.144（2026-07-04）

- **OpenAI `token_expired` 不可重试已落地**：`src/accounts/refreshErrors.ts` 将 `token_expired` 纳入永久刷新失败信号，行为与 `invalid_refresh_token` / `refresh_token_invalidated` 一致，账号自动禁用并标记「需重新授权」，避免后台持续重试刷屏。
- **Claude Fable 7d_oi 窗口轻量落地**：`src/accounts/quota.ts` 解析 `anthropic-ratelimit-unified-7d_oi-*` 响应头与 OAuth usage API 的 `seven_day_overage_included` 字段，后台账号页显示「7天 Fable」。该窗口是模型级限制，`quotaPauseUntil` / `soonestReset` 会跳过它，`src/routes/relay.ts` 对 Fable-only 429 不再把整个 Claude 账号置入 cooldown。
- **OpenAI 图片桥已落地**：新增 `/v1/images/generations`、`/v1/images/edits` 与 `/api/openai/v1/...` 入口，JSON / multipart 请求会转换为 OAuth Codex Responses 的 `image_generation` 工具调用，再转换回 Images JSON 或 SSE；图片 token、数量、尺寸和实际图片模型进入 usage log 并独立计费。`OPENAI_IMAGE_GENERATION_ENABLED` 统一控制独立图片入口和 Responses 显式图片工具。
- **Anthropic dateline 指纹归一化已落地**：`src/providers/claude/relay.ts` 将 system prompt 以及 `<system-reminder>` 内的 `Today's date is YYYY/MM/DD.` / 撇号变体归一为 ASCII 撇号 + `YYYY-MM-DD`，只处理特定日期句式，避免误改用户正文。
- **不适用 / 暂不追**：sub2api v0.1.139–v0.1.144 的 Grok 订阅、OpenAI WS `http_bridge`、Spark 影子账号、IP 地理位置、高峰倍率、恢复撤销订阅、列设置等偏 SaaS / 多上游生态能力，暂不纳入 model-bridge 轻量主线。usage log 队列溢出问题不适用：model-bridge 当前 usage 写入为同步数据库事务，没有异步队列静默丢弃路径。

### 06-23~06-26 提交核查（2026-07-02，跟踪至 commit df99b94）

对照 sub2api 最近一周（v0.1.138 之后、尚未发新 tag）的关键 relay 稳定性提交，逐项核对 model-bridge 实际代码，**五项均不适用或已正确，未改动代码**：

| sub2api 提交 | 内容 | model-bridge 核查结论 |
|---|---|---|
| `29122e3` | 单块上游（GLM/Zhipu）致 tool_call 参数翻倍 | ❌ 不受影响 —— zhipu/qwen/xiaomi/deepseek 四个转换器同一套正确模板：`argsBuffer` 从 `''` 初始化、只 `+= argFrag` 累加一次（见各 `src/providers/*/stream.ts` 第 406/422 行），不会像 Go 版把整块含 arguments 先拷进 state 再累加 |
| `2b49d66` | OpenAI passthrough function call args 去重 | ❌ 不适用 —— 转换器自行从 delta 合成 arguments，不透传上游 Responses 事件；OpenAI 走 `src/providers/openai/relay.ts` 逐字透传 Codex SSE，无二次累加，无翻倍源 |
| `0a97a5f` | `refresh_token_invalidated` 视为不可重试 | ✅ 已落地 —— 新增 `src/accounts/refreshErrors.ts` 永久/临时分类器（含 `refresh_token_invalidated`），`refreshAccountToken` 命中永久信号即自动禁用账号并写 `metadata.reauth` 标记；relay 跳过 penalize、后台任务分级日志。详见 [token-refresh-permanent-failure-plan.zh-CN.md](./token-refresh-permanent-failure-plan.zh-CN.md) |
| `fcd3bc1` | 无账号支持模型返回 404 而非 503 | ❌ 已正确 —— 未知模型在 provider/model allow-list 阶段即返回 403/404；relay 的 503（`src/routes/relay.ts` 第 899/1003 行）是真正的「账号不可用 / 全部失败」，语义无误 |
| `82576e0` | auth 邮箱身份创建被 shadowed err 吞掉 | ❌ 不存在 —— Go 的 `err` 变量遮蔽陷阱；model-bridge 用 TS throw/catch，无此 bug 类 |

> 结论：model-bridge 的流式转换器是「正确构造」版本，恰好是 sub2api 打补丁要达到的正确状态。核查时发现的**唯一真实（非关键）小缺口**——`tokenRefresh.ts` 对永久失效的 refresh token 每 60s 徒劳重试并刷屏日志——已于 2026-07-02 补齐：引入永久/临时刷新错误分类，永久失效自动禁用账号并标记「需重新授权」，后台不再刷屏、relay 不再把禁用复活成 error。实现见 [token-refresh-permanent-failure-plan.zh-CN.md](./token-refresh-permanent-failure-plan.zh-CN.md)。

### 跟踪 sub2api 至 v0.1.138（2026-06-22）

- **跟踪 sub2api 至 v0.1.138（2026-06-22）**：对照 v0.1.137/v0.1.138 的发布，补入差异表第 21–24 项 —— OpenAI 账号 quota 查询 + 手动 reset credit、OpenAI 调度策略「优先最快重置」、`cyber_policy` 硬阻断全链路透传、Gemini 工具 schema 兼容清理。四项均已在 model-bridge 落地（实施依据见 [sub2api 近期更新实施计划](./sub2api近期更新实施计划.md)）；订阅推广返利属偏运营 SaaS 能力，首期不实现（见第 20 项）。
- **OpenAI quota 查询 + reset credit 已落地**（差异表第 21 项 ✅）：OpenAI OAuth token 交换 / 刷新时解析 `id_token`，提取 `chatgptAccountId`/`chatgptUserId`/`organizationId`/`email`/`planType` 等非敏感元数据存入 `accounts.metadata.openai`（不新增表）。管理员可在「账号」页查询 ChatGPT 配额（`GET /api/admin/accounts/:id/openai/quota`，调用 `chatgpt.com/backend-api/wham/usage`）并手动消耗一次 reset credit（`POST .../openai/reset-quota`，调用 `wham/rate-limit-reset-credits/consume`），reset credit 余额单独存 `metadata.openaiResetCredits` 以免被 relay 头部抓取覆盖。日志只记账号 ID / 状态码，不打 token / 授权码 / 原始敏感响应。仅支持 OAuth 账号；缺 `chatgptAccountId` 的老账号需重新授权或等 token 刷新补齐。核心见 `src/providers/openai/{identity,quota}.ts`、`src/accounts/openaiQuota.ts`，含单测。
- **OpenAI 调度策略「优先最快重置」已落地**（差异表第 22 项 ✅）：新增设置项 `settings.openai_scheduling_strategy`，可选 `weighted_lru`（默认，保持原行为）或 `prefer_soonest_reset`（优先选 quota 窗口最快重置的可用账号）。仅影响 OpenAI 非粘性回退调度，粘性会话仍优先，其它 provider 不受影响。在设置页可切换。逻辑见 `src/accounts/scheduler.ts` 的 `soonestReset` 与 `src/db/settings.ts`，含单测。
- **`cyber_policy` 硬阻断透传已落地**（差异表第 23 项 ✅）：Responses 流 `response.completed` 才记为成功；`response.failed` / `response.incomplete`（含 `cyber_policy`）记为 `status="error"`，并按原样透传上游 code/message 给客户端，不触发 failover、不置 cooldown。逻辑见 `src/routes/relay.ts` 的 `responsesStreamStatus` / `noteResponsesTerminal`，含单测。
- **Gemini 工具 schema 清理已落地**（差异表第 24 项 ✅）：relay 请求前递归清理 `tools[].functionDeclarations[].parameters` 中 Gemini 不支持或易致 400 的 JSON Schema 字段（`$schema`/`$id`/`$defs`/`definitions`/`additionalProperties`/`title`/`default`/`examples`/`nullable` 等），保留 `type`/`description`/`enum`/`required`/`properties`/`items`。无 tools 时请求体不变、不改原对象。见 `src/providers/gemini/relay.ts` 的 `sanitizeGeminiBody`，含单测。
- **部署提示**：若用 Nginx 反代且上游依赖带下划线的请求头，需在 server/location 配 `underscores_in_headers on;`，否则带下划线的头会被默认丢弃。
- **下一步建议优先级**：① 失败请求追踪（纯观测增强，风险低）；② 用户分平台配额（从 per-Key 上限扩展到 per-user 多平台时间窗）。embeddings / 钉钉 OAuth / 图像计费 / 内容审计 / 邀请返利可按需求再排。

---

### v0.1.134 跟踪（2026-06-08）

- **跟踪 sub2api 至 v0.1.134**：对照 v0.1.119–v0.1.134 的新发布，补入差异表第 13–20 项 —— 账号配额自动暂停、用户分平台配额、失败请求追踪、OpenAI embeddings 网关、内容审计/风控、钉钉 OAuth、图像 token 计费、邀请返利系统。其中第 13 项账号配额自动暂停已在 model-bridge 补齐；第 14 项已有 per-Key USD 配额上限（`src/middleware/apiKeyAuth.ts`、`schema.ts` 的 `quotaLimit`），但无「按用户分平台 + 时间窗」配额。其余多为偏 SaaS / 合规 / 计费精度方向，符合错位定位，择优追赶。
- **账号配额自动暂停已落地**（差异表第 13 项 ✅）：在原有 quota 快照基础上加阈值停调——账号 5h/7d 用量达到阈值即置入 cooldown 直到对应窗口重置。全局阈值存 `settings.quota_autopause_percent`（默认 100＝仅超额时停调，调低可提前切走流量），单账号可在「账号」页用 `metadata.autopausePercent` 覆盖（留空=继承、0=关闭）。即时停调走 relay 成功路径与手动测试/刷新；另加后台周期扫描 `jobs/quotaAutopause.ts` 兜底闲置账号与阈值下调场景（多实例 Redis 锁、只读快照不打上游、忽略已过期窗口）。核心逻辑 `quotaPauseUntil` / `resolveAutopausePercent` 见 `src/accounts/quota.ts`，含单测。
- **下一步建议优先级**：① 失败请求追踪（纯观测增强，风险低）；② 用户分平台配额（从 per-Key 上限扩展到 per-user 多平台时间窗）。embeddings / 钉钉 OAuth / 图像计费 / 内容审计可按需求再排。

---

### 历史更新

- **账号分组隔离已落地**：差异表第 1 项、策略「追赶」第 5 项标记为 ✅ 完成。上游账号可编入分组，API Key 可绑定到某个分组，调度时绑定组的 Key 只命中组内账号、未绑定的 Key 只用默认池（未分组账号）；存量数据全为 null，行为向后兼容。代码涉及 `src/db/schema.ts`、`src/accounts/{scheduler,manager,groups}.ts`、`src/keys/manager.ts`、`src/routes/admin.ts`、`web/src/views/{AccountsView,ApiKeysView}.vue`，迁移为 `0002_zippy_invaders.sql`。
- **支付宝 / 微信在线收款已落地**：差异表第 4 项、策略「追赶」中的支付接入与回调审计标记为 ✅ 完成（扫码 + 异步回调 + RSA2/MD5 验签 + 幂等入账，代码见 `src/payments/`、`src/routes/payment-callback.ts`）。
- **登录基础安全加固部分落地**：差异表第 2 项更新为 ⚠️ 进行中。新增 Turnstile 登录 / 注册校验、登录限流、默认 CSP / 安全响应头、设置页安全状态展示；用户付费 API Key 的非流式上游成功响应会先确认 usage / 扣费写入，失败则返回 503 并隐藏上游响应。剩余项为 2FA/TOTP、出站 URL allowlist/SSRF、流式计费失败熔断。
- **Web 一键升级部分落地**：差异表第 3 项更新为 ⚠️ 进行中。已支持后台检查更新 / 启动更新 / 状态轮询，独立 updater 容器执行固定 Git + Docker Compose 流程；回滚与更新审计仍待扩展。
- **新增对比维度并重排优先级**：补入账号分组隔离、登录与接口安全加固（2FA/TOTP、Turnstile、CSP 响应头、出站 URL allowlist/SSRF、计费熔断）、Stripe/EasyPay 国际支付；差异表与策略均按「剩余价值」重新排序，当前最高优先缺口为安全加固与 Web 一键升级。
- **实施计划文档**：[account-groups-plan](./account-groups-plan.zh-CN.md) 既是账号分组的设计依据，也已对照实际落地完成。
- 上一轮（首 Token 观测）：usage 日志新增 `first_token_ms`，流式 relay 在首次写出事件 / 数据时记录首 Token 延迟并入库，管理后台 Overview 最近请求展示「首 Token」指标。

---

## 附：第 9 项「Redis 可插拔状态」实现要点

| 共享状态 | 内存实现 | Redis 实现 |
|---|---|---|
| 滑动窗口限流 | `Map<key, number[]>` | ZSET + Lua 原子「检查+写入」 |
| 并发门 | `Map<key, number>` | `INCR` Lua + 安全 TTL（防崩溃泄漏槽位）|
| 粘性会话绑定 | `Map<key, binding>` | `SET PX` / `GET` / `DEL` |
| token 刷新任务 | 单节点直接跑 | `SET NX PX` 分布式锁，每周期仅一个节点刷新 |

- 通过环境变量 `REDIS_URL` 切换；不配置即走内存，保持向后兼容。
- Redis 不可达时**fail open**（放行）而非阻塞流量。
- 相关文件：`src/store/redis.ts`、`src/middleware/limits.ts`、`src/accounts/session.ts`、`src/jobs/tokenRefresh.ts`。
