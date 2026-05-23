# model-bridge — 实施计划

> [English](./PLAN.md) · **中文**

## 背景

`model-bridge` 是一个**自托管的 AI API 中转平台**，面向个人使用与小范围共享。用户持有
**Claude**（Pro/Max）、**OpenAI**（ChatGPT Plus/Pro）和 **Google Gemini** 的订阅——这些
订阅通常只能通过各自的官方 CLI 经 OAuth 使用。本平台捕获每个订阅的 OAuth 凭证，并将其重新
暴露为**各服务商标准格式的 API 端点**，使用户与少数好友能够通过一个完全自控的网关驱动
Claude Code / Codex CLI / Gemini CLI / Cherry Studio——共享订阅、分摊成本——并具备按用户
隔离的 API Key、Token/成本统计，以及为稳定性服务的**多账户自动轮换**。请求直连官方服务商
端点；平台是唯一的中间环节，且为自托管，因此没有任何第三方能看到流量。

**已确认的决策：** 全新的 **Node.js + TypeScript** 代码库（OAuth/上游协议等高难度部分
参考成熟开源实现，而非从零逆向）；**SQLite** 单文件存储；首版（v1）即覆盖**全部三家服务商**。

> ⚠️ **动工前需提示的风险。** 通过中转、用非官方工具使用订阅 OAuth 令牌，可能违反服务商的
> 服务条款（ToS），并有**账户被封**的风险——截至 2026 年初，Anthropic 的 ToS 将 Claude
> Code 的 OAuth 令牌限定于 Claude Code / claude.ai 使用。这是此类项目共同的权衡。预期用途：
> 仅使用你自己的订阅，并与小范围可信群体共享。

## 参考项目（查阅脆弱的 OAuth / 上游协议细节时引用）

| 项目 | 参考用途 |
|---|---|
| [Wei-Shaw/claude-relay-service](https://github.com/Wei-Shaw/claude-relay-service) | Claude OAuth 流程、账户池、请求改写、用量统计（Node.js——最贴近） |
| [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | 三家服务商的 OAuth + 上游协议怪异点（Go） |
| [EvanZhouDev/openai-oauth](https://github.com/EvanZhouDev/openai-oauth)、[AmazingAng/auth2api](https://github.com/AmazingAng/auth2api) | OpenAI/ChatGPT OAuth + Codex 后端 |

## 架构

```
client (Claude Code / Codex CLI / Gemini CLI / Cherry Studio)
   │  request in provider-native format + platform API key (mb-xxxx)
   ▼
┌─────────────────────── model-bridge ───────────────────────┐
│ apiKeyAuth ─▶ relay route ─▶ account scheduler (pick acct)  │
│                    │              │ rotation / sticky /      │
│                    │              │ cooldown+failover        │
│                    ▼              ▼                          │
│             provider relay  ◀─ encrypted OAuth token         │
│             (transform req, inject headers, swap auth)        │
│                    │                                         │
│                    ▼  stream SSE back ──▶ usage recorder      │
└──────────────────────────────────────────────────────────────┘
                     │ direct HTTPS, no third party
                     ▼
   api.anthropic.com  /  chatgpt.com/backend-api/codex  /  cloudcode-pa.googleapis.com
```

流程：客户端以服务商**原生格式** + 平台 API Key 发起请求 → API Key 鉴权 → 中转路由 →
账户调度器选出健康账户（轮换 / 粘性会话 / 冷却 + 故障转移）→ 服务商中转模块改写请求、
注入请求头、替换为加密的 OAuth 令牌 → 直连官方端点 → SSE 流式回传并由用量记录器记录。

**首版范围说明（v1）：** 仅暴露**各服务商的原生 API 格式**（Anthropic Messages、OpenAI
Responses/Chat、Gemini generateContent）。跨格式转换（例如 OpenAI 格式请求 → Claude 后端）
**明确不在 v1 范围内**。

## 技术栈

- **后端：** Node.js 20+ / TypeScript，**Fastify**（`@fastify/static`、`@fastify/jwt`），
  上游流式调用使用 **undici**。
- **存储：** **SQLite**，经 **Drizzle ORM** + `better-sqlite3`（`drizzle-kit` 负责迁移）。
- **前端：** **Vue 3** + Vite + TypeScript + **Naive UI**（组件库）+ Pinia + Vue Router；
  图表使用 ECharts。构建为静态资源，由 Fastify 托管。
- **加密/鉴权：** Node `crypto` 的 AES-256-GCM 用于令牌静态加密；`bcrypt` 用于管理员密码；
  JWT 用于管理员会话。令牌刷新后台任务用 `node-cron`。配置经 `dotenv` + `zod` 校验。

## 项目结构（待创建文件）

```
model-bridge/
├── package.json  tsconfig.json  drizzle.config.ts  .env.example
├── Dockerfile  docker-compose.yml  install.sh  README.md
├── src/
│   ├── index.ts                  启动 Fastify + 路由 + 定时任务
│   ├── config.ts                 环境变量加载（经 zod 校验）
│   ├── crypto.ts                 AES-256-GCM 加解密
│   ├── db/{schema.ts,index.ts,migrations/}
│   ├── middleware/{apiKeyAuth.ts,adminAuth.ts}
│   ├── providers/
│   │   ├── types.ts              Provider 接口（共享抽象）
│   │   ├── registry.ts           按 id 查找服务商
│   │   ├── claude/{oauth.ts,relay.ts,usage.ts}
│   │   ├── openai/{oauth.ts,relay.ts,usage.ts}
│   │   └── gemini/{oauth.ts,relay.ts,usage.ts}
│   ├── accounts/{manager.ts,scheduler.ts}
│   ├── keys/manager.ts
│   ├── usage/{recorder.ts,stats.ts,pricing.ts}
│   ├── routes/{relay.ts,admin.ts}
│   └── jobs/tokenRefresh.ts
├── web/  (Vue 3 + Naive UI SPA：Login/Overview/Accounts/ApiKeys/Stats/Settings)
└── data/ (SQLite 文件——已 gitignore，作为 Docker 卷挂载)
```

## 数据模型（SQLite 表 — `src/db/schema.ts`）

- **`accounts`（账户）** — id、provider、name、`oauth_access_token`（加密）、
  `oauth_refresh_token`（加密）、token_expires_at、status（`active`/`rate_limited`/
  `error`/`disabled`）、cooldown_until、proxy_url、weight、last_used_at、metadata(json)。
- **`api_keys`（API 密钥）** — id、name、owner_label（好友标识）、key_hash、key_prefix、
  enabled、allowed_providers(json)、allowed_models(json)、rate_limit、quota_limit、
  quota_used、expires_at、created_at。
- **`usage_logs`（用量日志）** — id、api_key_id、account_id、provider、model、ts、
  input_tokens、output_tokens、cache_create_tokens、cache_read_tokens、cost、status、
  latency_ms。
- **`model_pricing`（模型定价）** — provider、model，每百万 token 的 输入/输出/缓存写入/
  缓存读取 单价（预置当前费率；可在「设置」中编辑）。
- **`oauth_sessions`（OAuth 会话）** — 临时数据：state、code_verifier、provider（进行中的
  OAuth 流程）。
- **`settings`（系统设置）** — admin_password_hash、jwt_secret、其他杂项配置。

## 服务商抽象

`src/providers/types.ts` 定义统一接口，使中转/调度逻辑与具体服务商解耦——新增第 4 家
服务商时只需新增一个模块：

```ts
interface Provider {
  id: 'claude' | 'openai' | 'gemini'
  buildAuthorizeUrl(state, codeVerifier): string
  exchangeCode(code, codeVerifier): Promise<TokenSet>
  refreshToken(refreshToken): Promise<TokenSet>
  routes: RelayRouteSpec[]                       // 该服务商对外暴露的端点
  relay(req, account): Promise<UpstreamResponse>  // 改写 + 调用 + 流式转发
  parseUsage(events): UsageData
}
```

| 服务商 | OAuth | 上游端点 | 对外中转路由 | 需处理的关键怪异点 |
|---|---|---|---|---|
| **Claude** | claude.ai OAuth + PKCE，手动粘贴授权码 | `api.anthropic.com/v1/messages` | `POST /api/claude/v1/messages` | 注入 `anthropic-beta: oauth-*`、`anthropic-version`、Claude-Code 系统身份；按会话做粘性绑定以命中 prompt 缓存 |
| **OpenAI** | `auth.openai.com/oauth/token` | `chatgpt.com/backend-api/codex/responses` | `POST /api/openai/v1/responses`（+ `/v1/chat/completions`） | 必须带 `stream:true`、`store:false`、`instructions`；剔除 `max_output_tokens`/`parallel_tool_calls` |
| **Gemini** | Google OAuth | `cloudcode-pa.googleapis.com`（Code Assist） | `POST /api/gemini/v1beta/models/{model}:streamGenerateContent` | 免费额度约 1000 次/天、60 次/分钟 |

## 进度

- ✅ 阶段 0 —— 计划文档（`201af14`）
- ✅ 阶段 A —— 平台骨架（`832ab86`）
- ✅ 阶段 B —— Claude 全链路中转（`afc2ad4`，+`3443a2c` Cloudflare 修复）
- ✅ 阶段 C —— OpenAI / Codex 接入
- ✅ 阶段 D —— Gemini 接入
- ⬜ 阶段 E —— 统计与管理完善
- ⬜ 阶段 F —— 部署与文档

## 实施阶段

所有阶段都在 v1 内交付。执行顺序为 **Claude 优先**——先用 Claude 跑通并验证整体架构，
随后 OpenAI 与 Gemini 复用相同的服务商模块模式。

**阶段 0 — 计划文档（本文件）。** 本实施计划以两份保持同步的文件存放于仓库根目录——
`PLAN.md`（英文）与 `PLAN.zh-CN.md`（中文）——作为项目的活文档路线图。范围变动时两份同步更新。

**阶段 A — 骨架与平台核心。** TypeScript 项目初始化；Fastify 启动 + `config.ts`；
SQLite/Drizzle 表结构 + 迁移；`crypto.ts`；管理员鉴权（`adminAuth.ts`，bcrypt+JWT）；
`apiKeyAuth.ts`（接受 `Authorization: Bearer` / `x-api-key` / `?key=`）；`keys/manager.ts`
（创建/吊销 `mb-` 前缀密钥，仅存哈希）；健康检查端点；Vue SPA 脚手架 + 由 Fastify 托管的
登录页。→ *管理员可登录、创建/吊销密钥。*

**阶段 B — 服务商抽象 + Claude 全链路。** `providers/types.ts`；`accounts/manager.ts`
（增删改查、令牌加密存储）；`accounts/scheduler.ts`（健康账户筛选、轮询 + 粘性会话、
429/5xx 时进入冷却、故障转移重试——**多账户轮换**）；`providers/claude/{oauth,relay,usage}.ts`；
中转路由 `/api/claude/v1/messages`；`usage/recorder.ts` + `pricing.ts`；`jobs/tokenRefresh.ts`
定时任务；账户页（经 OAuth 添加 Claude 账户，启用/禁用/删除，状态展示）。→ *Claude Code →
中转 → 真实订阅，流式与用量记录均跑通。*

**阶段 C — OpenAI / Codex。** `providers/openai/*`，结构对照 Claude；路由
`/api/openai/v1/responses` + `/v1/chat/completions`；处理 Codex 后端的请求要求；添加
OpenAI 账户的 UI。

**阶段 D — Gemini。** `providers/gemini/*`；路由 `…:streamGenerateContent` +
`:generateContent`；Google OAuth 回调；添加 Gemini 账户的 UI。

**阶段 E — 统计与管理完善。** `usage/stats.ts` 聚合（按密钥/账户/天/模型，统计 token +
成本）；管理端统计接口；Vue 统计页（ECharts）、API Key 页（限额：速率/配额/有效期/允许的
服务商+模型）、设置页（管理员密码、定价编辑器）；在中转路径中执行按密钥配额限制。

**阶段 F — 部署与文档。** 多阶段 `Dockerfile`（构建 web + 后端 → 精简运行时）；
`docker-compose.yml`（为 `/data` SQLite 挂载卷）；`install.sh` 一键安装脚本；`.env.example`
（`PORT`、`ENCRYPTION_KEY`、管理员凭据、`JWT_SECRET`）；README 含各客户端配置说明（Claude
Code 用 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`，Codex CLI / Gemini CLI 用 base-URL
覆盖，Cherry Studio 用自定义服务商配置）。

## 风险与对策

- **服务条款 / 账户封禁** — 见上文风险提示；在 README 中写明，并将使用范围限制在可信群体内。
- **未公开流程的变动** — OAuth 端点与「伪装成官方 CLI」的请求改写均为逆向得来，会随时间
  失效；将其隔离在 `providers/*` 模块内，并固定参考项目版本以便对照。
- **安全** — 令牌静态加密；强管理员鉴权 + 登录限速 + 生产环境启用 HTTPS（参考项目曾出现
  管理后台鉴权绕过 CVE——切勿重蹈）。
- **流式用量解析** — 在不缓冲、不破坏透传的前提下观察 SSE 流以捕获 `usage` 事件（对流做 tee）。

## 验证

1. **构建与运行：** `npm install && npm run dev`（后端）+ 在 `web/` 中 `npm run dev`；
   或 `docker compose up -d`。
2. **单元测试：** `crypto.ts` 加解密往返；`pricing.ts` 成本计算；`scheduler.ts` 账户选择
   （轮换、粘性、跳过冷却中的账户）。
3. **各服务商端到端**（每家需一个真实订阅）：
   - 在管理后台经各自的 OAuth 流程添加账户；创建一个 API Key。
   - Claude Code：`ANTHROPIC_BASE_URL=http://localhost:3000/api/claude
     ANTHROPIC_AUTH_TOKEN=mb-xxxx claude` → 运行一次提问，确认流式回复。
   - Codex CLI / Gemini CLI：将 base URL 指向 `…/api/openai` / `…/api/gemini`，密钥用
     `mb-xxxx` → 运行一次提问。
   - 确认后台**统计**页显示该请求及其 token 数与成本。
4. **多账户故障转移：** 注册 2 个账户，禁用 / 强制冷却正在使用的那个，发送一次请求，
   确认调度器改用另一个账户。
5. **令牌刷新：** 将某账户的 `token_expires_at` 设为接近当前时间，确认 `tokenRefresh`
   定时任务完成刷新。
6. **持久化：** `docker compose restart` 后确认账户/密钥/日志仍存在（SQLite 卷）。
