# model-bridge vs sub2api 差异化对比

> 对比对象：[Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)（已跟踪至 **v0.1.134**，2026-06-06）
> 更新日期：2026-06-08

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
2. **更细的协议兼容层** —— 显式实现了 OpenAI Responses API、DeepSeek 格式转换、流式终止事件保证。
3. **轻量、零外部依赖默认值** —— 不强制 Redis，单进程内存即可跑通限流 / 并发 / 粘性会话，部署更简单；需要扩展时再开 Redis。
4. **TypeScript 全栈** —— 对 JS / TS 团队更友好，二次开发门槛低。
5. **首 Token 延迟观测** —— usage 日志新增 `first_token_ms`，管理后台可同时查看总耗时和流式首 Token 延迟。

---

## 三、sub2api 独有 / 本项目缺失的功能 ❌（差异化机会清单）

> 按价值排序，标注当前进度。

| # | 功能 | sub2api | model-bridge | 状态 |
|---|---|:---:|:---:|---|
| 1 | **账号分组隔离**（账号编组 + Key 绑定组，调度限定组内）| ✅ | ✅ 已实现（账号分组 + Key 绑定 + 隔离式调度）| ✅ 已完成 · 实现见 [account-groups-plan](./account-groups-plan.zh-CN.md) |
| 2 | **登录与接口安全加固**（2FA/TOTP、Turnstile 验证码、CSP 安全响应头、出站 URL allowlist/SSRF、计费失败熔断）| ✅ | ⚠️ 已部分实现（Turnstile、登录限流、CSP/安全响应头、非流式计费失败 fail-closed）| 进行中 · 剩余 2FA/TOTP、出站 URL allowlist/SSRF、流式计费熔断 |
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
| 19 | **图像 token 计费** | ✅ (v0.1.134) | ❌ | 低优先级 · 计费精度 |
| 20 | **邀请返利系统**（返利冻结期 / 有效期 / 单人上限 / 专属邀请码） | ✅ (v0.1.119) | ⚠️ 已有邀请制用户体系，无返利结算 | 低优先级 · 偏 SaaS |

> 上表第 13–20 项为对照 sub2api **v0.1.119–v0.1.134** 新增能力补入；标 ✅ 的括号为该能力在 sub2api 的引入版本。这些多为偏 SaaS / 合规 / 计费精度方向，符合 model-bridge「轻量自托管」错位定位，按价值择优追赶即可。

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

- **跟踪 sub2api 至 v0.1.134（2026-06-08）**：对照 v0.1.119–v0.1.134 的新发布，补入差异表第 13–20 项 —— 账号配额自动暂停、用户分平台配额、失败请求追踪、OpenAI embeddings 网关、内容审计/风控、钉钉 OAuth、图像 token 计费、邀请返利系统。其中第 13 项账号配额自动暂停已在 model-bridge 补齐；第 14 项已有 per-Key USD 配额上限（`src/middleware/apiKeyAuth.ts`、`schema.ts` 的 `quotaLimit`），但无「按用户分平台 + 时间窗」配额。其余多为偏 SaaS / 合规 / 计费精度方向，符合错位定位，择优追赶。
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
