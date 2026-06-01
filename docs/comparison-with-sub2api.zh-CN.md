# model-bridge vs sub2api 差异化对比

> 对比对象：[Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)
> 更新日期：2026-06-02

## 一句话定位

| 项目 | 定位 |
|---|---|
| **model-bridge**（本项目）| 自托管的多服务商 AI API 中转平台，偏「个人 / 小团队 / 小规模拼车」的轻量网关 |
| **sub2api** | AI API 网关 + **拼车 SaaS 平台**，主打「订阅配额分发 + 内置计费收款」 |

核心区别一句话：**sub2api 是更完整的商业化拼车 SaaS；model-bridge 已具备中转、管理后台、邀请用户、钱包、余额扣费和充值订单核心闭环，但仍保持轻量自托管定位。**

---

## 一、技术栈差异

| 维度 | model-bridge | sub2api |
|---|---|---|
| 后端 | Node.js + TypeScript + **Fastify** | **Go** + Gin + Ent |
| 数据库 | **PostgreSQL**（Drizzle ORM）| PostgreSQL 15+ |
| 缓存 / 共享状态 | **可选 Redis（可插拔）**，默认走进程内存 | Redis 7+（必需） |
| 前端 | Vue 3 + Vite + **Naive UI** + ECharts | Vue 3 + Vite + **TailwindCSS** |
| 部署 | Docker Compose / 裸机 | 一键脚本(systemd) / Docker / 源码 |

> 说明：model-bridge 的限流、并发门、粘性会话状态做成了「可插拔后端」——不配置 `REDIS_URL` 时走进程内存（保持零依赖部署），配置后切到 Redis 实现多实例水平扩展。详见下文「差异化机会清单」第 5 项。

---

## 二、model-bridge 独有 / 更强的地方 ✅

1. **DeepSeek 支持** —— sub2api 没有 DeepSeek，本项目支持 messages / chat completions / responses 三种协议。
2. **更细的协议兼容层** —— 显式实现了 OpenAI Responses API、DeepSeek 格式转换、流式终止事件保证。
3. **轻量、零外部依赖默认值** —— 不强制 Redis，单进程内存即可跑通限流 / 并发 / 粘性会话，部署更简单；需要扩展时再开 Redis。
4. **TypeScript 全栈** —— 对 JS / TS 团队更友好，二次开发门槛低。
5. **首 Token 延迟观测** —— usage 日志新增 `first_token_ms`，管理后台可同时查看总耗时和流式首 Token 延迟。

---

## 三、sub2api 独有 / 本项目缺失的功能 ❌（差异化机会清单）

> 按价值排序，标注当前进度。

| # | 功能 | sub2api | model-bridge | 状态 |
|---|---|:---:|:---:|---|
| 1 | **内置支付 / 收款系统**（EasyPay / 支付宝 / 微信 / Stripe）| ✅ | ⚠️ 订单核心已实现，自动支付待接入 | 待开发 · 拼车 SaaS 的核心 |
| 2 | **用户自助注册 / 开放注册** | ✅ | ⚠️ 邀请制用户体系 | 可用但偏私域 |
| 3 | **用户钱包 + 余额扣费闭环** | ✅ | ✅ 基础能力已实现 | 已支持管理员调账、用户余额、usage 扣费、充值订单手动确认入账 |
| 4 | **Antigravity 上游 + 混合调度** | ✅ | ❌ | 待评估 |
| 5 | **Redis 化状态（多实例水平扩展）** | ✅ | ✅ **已实现（可插拔）** | ✅ 完成 |
| 6 | **Web 一键升级 + 回滚** | ✅ | ❌ 手动部署 | 待开发 · 运维体验 |
| 7 | **iframe 外部系统嵌入**（如工单系统）| ✅ | ❌ | 低优先级 |
| 8 | **移动管理端 App**（RN / Expo）| ✅ | ❌ | 低优先级 · 生态 |
| 9 | **Simple Mode**（隐藏 SaaS 功能给个人用）| ✅ | ➖ 本项目天然即简化版 | 不适用 |

---

## 四、双方打平的功能

多账户管理、API Key 分发、用户邀请登录、用户钱包、余额扣费、Token 级用量统计与成本计算、粘性会话调度、并发控制、限流、Web 管理仪表盘、OAuth 授权、PostgreSQL、Claude / OpenAI(Codex) / Gemini 支持。

---

## 五、差异化策略建议

### 错位（保持轻量自用定位）
- 强化 DeepSeek + 国产模型支持，覆盖 sub2api 不做的上游。
- 保持「默认零 Redis、一键起」的极简部署优势，Redis 仅作为可选的扩展开关。
- 继续增强观测能力，例如首 Token 延迟、账号 quota 快照、按用户 / key / provider 的成本拆分。

### 追赶（若要走 SaaS / 拼车方向，优先级从高到低）
1. **支付接入**（支付宝 / 微信 / Stripe 至少一个）—— 将现有充值订单从手动确认升级为自动回调确认。
2. **支付回调审计**（回调验签、幂等处理、异常补单）。
3. **开放注册 / 用户套餐**（如果要从私域邀请制走向公开 SaaS）。
4. ~~Redis 化并发 / 会话状态~~ —— ✅ 已完成。
5. **Web 一键升级**。

---

## 六、本次更新整理

- usage 日志新增 `first_token_ms` 字段，初始化 SQL、Drizzle schema 和迁移快照已同步。
- 流式 relay 会在首次向客户端写出事件 / 数据时记录首 Token 延迟，并随 usage 日志入库。
- 管理后台 Overview 最近请求列表新增「首 Token」指标，便于区分上游响应启动慢和完整生成耗时长。
- 对比文档同步当前用户体系、钱包和余额扣费状态：这些已不再是缺失项，真正缺口变为在线支付、充值订单与更完整的 SaaS 运维能力。

---

## 附：第 5 项「Redis 可插拔状态」实现要点

| 共享状态 | 内存实现 | Redis 实现 |
|---|---|---|
| 滑动窗口限流 | `Map<key, number[]>` | ZSET + Lua 原子「检查+写入」 |
| 并发门 | `Map<key, number>` | `INCR` Lua + 安全 TTL（防崩溃泄漏槽位）|
| 粘性会话绑定 | `Map<key, binding>` | `SET PX` / `GET` / `DEL` |
| token 刷新任务 | 单节点直接跑 | `SET NX PX` 分布式锁，每周期仅一个节点刷新 |

- 通过环境变量 `REDIS_URL` 切换；不配置即走内存，保持向后兼容。
- Redis 不可达时**fail open**（放行）而非阻塞流量。
- 相关文件：`src/store/redis.ts`、`src/middleware/limits.ts`、`src/accounts/session.ts`、`src/jobs/tokenRefresh.ts`。
