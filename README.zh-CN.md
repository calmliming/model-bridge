# model-bridge

> [English](./README.md) · **中文**

自托管的 AI API 中转平台 —— 把你的 **Claude / OpenAI / Gemini / DeepSeek / Xiaomi MiMo**
账号或 API Key 转化为标准 API 端点，可与好友共享；支持按用户隔离的 API Key、
用量统计，以及多账户自动轮换。

完整架构与分期路线图见 **[PLAN.zh-CN.md](./PLAN.zh-CN.md)**。

## 当前状态

✅ **v1 已交付。** 管理后台、带成本配额的 API Key、Claude（粘贴 code）/
OpenAI（浏览器回调）/ Gemini（Google OAuth + Code Assist）/ DeepSeek 与 Xiaomi MiMo
（API key）账户接入、多账户轮换（支持优先级、账号分组、并发上限和配额自动停调）、
三类中转入口（兼容旧版 `/api/*` 路径，也支持干净的 `/v1/messages`、
`/v1/responses`、`/v1/chat/completions`、`/v1/models`、`/v1beta/models/*`），
按日 / 服务商 / 模型 / Key 的用量统计，以及一键 Docker 部署。

## 技术栈

- **后端：** Node.js + TypeScript、Fastify、PostgreSQL（Drizzle ORM）
- **前端：** Vue 3 + Vite + Naive UI + ECharts

## 快速开始（开发环境）

需要 Node.js 24.19.0 LTS（或更新的 LTS 版本）。

本地开发**连本地数据库**，与线上完全隔离（见下面的「本地环境与生产环境」）。
首次准备好本地配置和数据库：

```bash
# 1. 建本地配置（连本地库、本地专用密钥）
cp .env.example .env.local
#    然后编辑 .env.local，确认这三项：
#      APP_ENV=local
#      PORT=3003
#      DATABASE_URL=postgresql://model_bridge:devpassword@127.0.0.1:5433/model_bridge

# 2. 起本地 PostgreSQL 容器（需要 Docker Desktop 已启动）
npm run dev:db

# 3. 同时启动前后端，并用 API / WEB 标签区分格式化日志
npm install
cd web && npm install && cd ..
npm run dev:all
```

打开 <http://localhost:5173>，用 `.env.local` 里的 **admin / admin** 登录，然后立刻在
**设置**页面修改密码。数据库表结构由后端启动时自动创建（幂等），无需手动跑迁移。

也可以分别启动：

```bash
# 后端 —— 端口 3003（读 .env.local）。密钥缺失时会自动生成到 .env.local。
npm install
npm run dev

# 前端开发服务器 —— 端口 5173，会把 /api、/health 代理到后端。
cd web
npm install
npm run dev
```

### 本地数据库管理

```bash
npm run dev:db         # 起库（127.0.0.1:5433，幂等）
npm run dev:db:down    # 停库，保留数据
npm run dev:db:reset   # 停库并删除数据卷，下次 up 是全新的空库
```

数据落在 `./data/dev-pg`，与线上的 `./data/pg` 互不影响。

**没必要用容器**：本地已有 PostgreSQL 时，把 `.env.local` 的 `DATABASE_URL`
指向它即可（后端不强制 5433 端口）。

## 本地环境与生产环境

两套环境用**不同的配置文件 + 不同的数据库 + 不同的密钥**隔离：

| | 本地开发 | 线上生产 |
| --- | --- | --- |
| 配置文件 | `.env.local`（`*.local` 已被 git 忽略） | `.env`（仅存在于服务器） |
| 模式开关 | `APP_ENV=local` | `APP_ENV=production`（或不写） |
| 数据库 | 本地容器 `127.0.0.1:5433`，数据在 `./data/dev-pg` | 服务器 PG 容器，数据在 `./data/pg` |
| 后端端口 | 3003 | 容器内 3000，对外 3001 |
| 密钥 | 本地专用随机值 | 线上专用随机值 |
| 起法 | `npm run dev:db` + `npm run dev:all` | `docker compose up -d --build` |

`ENCRYPTION_KEY` 两边必须各用一套：它是加密库内 OAuth token 的密钥，
本地库即使被清空或泄露，也解不开线上库里的任何密文。

### 模式判定规则

判定逻辑在 [src/config.ts](src/config.ts)：**只有** `APP_ENV=local` 且
`NODE_ENV != production` 时才算本地模式，读 `.env.local`；其余情况一律按线上
处理，读 `.env`。也就是说"忘记配置"的后果是读到线上 `.env`，而不会把开发配置
带上生产。容器里 `NODE_ENV=production`（见 [Dockerfile](Dockerfile)），
所以即使 `.env.local` 被误带进镜像也不会被加载。

### 防误连线上库

本地模式下，如果 `DATABASE_URL` 指向非回环主机，[src/db/index.ts](src/db/index.ts)
会**直接拒绝启动**并打印醒目提示：

```
╔════════════════════════════════════════════════════════════════════╗
║  已阻止启动：本地模式检测到远端数据库                                ║
║  DATABASE_URL host : your.prod.host                                ║
║    npm run dev:db     # 起本地 PostgreSQL（127.0.0.1:5433）         ║
║  若确实需要本地连远端库，请在配置里显式设置：                        ║
║    ALLOW_REMOTE_DB=true                                            ║
╚════════════════════════════════════════════════════════════════════╝
```

确实要让本地进程连线上库调试时，在 `.env.local` 里设 `ALLOW_REMOTE_DB=true`
显式放行；此时所有写操作都会真实作用在线上数据上，且建议先把线上应用停掉，
避免两个实例同时跑 token 刷新任务把上游 refresh token 打废。

## 部署

### 使用 Docker（推荐）

```bash
./install.sh
```

`install.sh` 会生成带随机 `ENCRYPTION_KEY` / `JWT_SECRET` / `UPDATE_TOKEN` 的 `.env`，然后
`docker compose up -d --build`。完成后：

- 管理后台：<http://localhost:3001>
- OAuth 回调监听：`localhost:1455`（OpenAI / Google 登录时浏览器需访问此端口）
- 默认管理员：`admin / admin` —— 暴露后台前请在**设置**里改掉

Docker 部署会同时启动内部 `model-bridge-updater` 服务。登录后台后，可在**设置**
页的「系统更新」卡片检查并升级到远端 `origin/main`。

可选登录安全加固：

- 配置 `TURNSTILE_SITE_KEY` 和 `TURNSTILE_SECRET_KEY` 后，登录 / 注册入口会强制
  Cloudflare Turnstile 人机验证。
- `SECURITY_HEADERS_ENABLED=true` 为默认值，会发送 CSP 和常见浏览器安全响应头。
  只有在反向代理统一管理这些响应头时，才建议改成 `false`。
- 服务自动信任来自回环、RFC1918 私网和 IPv6 ULA 网段的直连反向代理，并据此解析
  `X-Forwarded-For`；公网直连请求携带的转发头会被忽略。源站不要直接开放给不可信的
  内网客户端，否则对方可能伪造来源 IP。

出站与面板 API 防护：

- `UPSTREAM_URL_GUARD_ENABLED=true` 默认开启。自定义上游 URL 若使用非 HTTP(S)
  协议、携带凭据或路径穿越片段，或者解析到回环、私网、链路本地、云元数据地址，
  会在账号保存时和实际出站前分别被拦截。
- 升级前已配置的内网 Sub2API 网关必须加入 `UPSTREAM_HOST_ALLOWLIST`（支持精确主机
  或 `*.example.com`）。若使用 80/443 以外端口，还需加入
  `UPSTREAM_PORT_ALLOWLIST`。关闭 URL Guard 可恢复旧行为，但不建议长期使用。
- 面板 API 默认按公网 IP 或登录身份应用滑动窗口限流：公开接口每分钟 60 次、
  已认证接口 300 次、注册/接受邀请/兑换等敏感写操作 10 次。可通过
  `PANEL_PUBLIC_RATE_LIMIT`、`PANEL_AUTHENTICATED_RATE_LIMIT`、
  `PANEL_WRITE_RATE_LIMIT` 调整环境默认值，后台设置值可运行时覆盖。

停止 / 查看日志：

```bash
docker compose down
docker compose logs -f
```

### 不用 Docker

```bash
cd web && npm install && npm run build && cd ..
npm install
npm start
```

之后后端会直接在 <http://localhost:3000> 托管构建好的管理后台。

### 修改端口

- **后端**：在 `.env.local`（本地）或 `.env`（线上）里设置 `PORT=<端口号>`。
  本地默认 3003、线上默认 3000。
- **前端开发服务器**：修改 [web/vite.config.ts](web/vite.config.ts) 的 `server.port`（默认 5173）。
- **前端开发代理目标**：[web/vite.config.ts](web/vite.config.ts) 的 `/api`、`/health`
  代理目标取自 `process.env.PORT`（默认 3003）；`npm run dev:all` 会自动把
  `.env.local` 里的 `PORT` 透传给 Vite，所以改一处即可。单独 `cd web && npm run dev`
  时没有这个透传，需要先 `set PORT=3003`（Windows）或 `export PORT=3003`。
- **Docker**：修改 `docker-compose.yml` 里的端口映射（格式是 `3001:3000`，左侧才是对外暴露的端口）。

## 接入客户端

先在 **API Keys** 页面创建一个密钥，再在 **上游账户** 页面至少添加一个上游
账户（Claude 用粘贴 code，OpenAI / Gemini 用浏览器回调，DeepSeek / Xiaomi MiMo 填 API key）。

API Key 可按需限制服务商/模型、绑定账号分组、设置限速/并发/成本配额，也可配置
`gpt-public=gpt-5.4` 这类模型映射。模型映射是客户端可见的别名：
`GET /v1/models` 会展示别名，实际请求上游时改写为映射后的模型。

### 账号池调度

同一服务商有多个账户时，可用以下配置控制调度：

- **优先级**：在账户列表设置 1–100（默认 1），数值越高越优先；相同优先级按最近最少使用策略轮换。
- **账号分组**：在**账号分组**页面创建池，账号可加入多个分组；API Key 绑定分组后只调度组内账号，未绑定 Key 只使用默认池（未加入任何分组的账号）。
- **并发上限**：账户和 API Key 都可设置最大同时在途请求数，留空表示不限。
- **配额自动停调**：设置页可配置全局 quota 用量阈值；账号达到阈值后会暂停调度到对应窗口重置，也可在单账号上继承、覆盖或关闭。

账户页还提供手动健康检查，会把最近一次连通性结果记录到账号元数据里；它不会在后台
自动循环运行，避免已有部署意外消耗额度。

### Claude Code

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_AUTH_TOKEN=mb-xxxxxxxx
claude
```

想让 Claude Code 走 DeepSeek 或 Xiaomi MiMo 这类 Anthropic 兼容上游，把
`ANTHROPIC_BASE_URL` 改成 `http://localhost:3000/api/deepseek` 或
`http://localhost:3000/api/xiaomi` 即可。它们分别和对应的 Codex / OpenAI
兼容入口共享同一账号池。

### Codex CLI

较新的 Codex CLI 使用 `model_providers` 配置自定义 Responses API：

```toml
# ~/.codex/config.toml
[profiles.model-bridge]
model_provider = "model-bridge"
model = "gpt-5.5"

[model_providers.model-bridge]
name = "model-bridge"
base_url = "http://localhost:3000/v1"
env_key = "MODEL_BRIDGE_API_KEY"
wire_api = "responses"
requires_openai_auth = false
```

```bash
export MODEL_BRIDGE_API_KEY=mb-xxxxxxxx
codex --profile model-bridge
```

中转暴露 OpenAI 的 **Responses** API（`/v1/responses`）供 Codex CLI 使用，
同时提供兼容 OpenAI 客户端的 **Chat Completions** 入口
（`/v1/chat/completions`）。Chat Completions 内部仍走同一套 Responses
后端转换，所以文本对话可用；embeddings 暂未暴露。`GET /v1/models`
会返回兼容格式的模型列表，并按 API Key 的服务商和模型限制过滤。

OpenAI 图片生成现已通过 ChatGPT OAuth 账号桥接到 Responses
`image_generation` 工具，支持 `/v1/images/generations`、`/v1/images/edits`
及对应的 `/api/openai/v1/...` 路径。embeddings 仍未暴露。默认图片模型为
`gpt-image-2`；可用 `OPENAI_IMAGE_GENERATION_ENABLED=false` 关闭图片入口和
Responses 中显式声明的图片工具。账号明确报告图片能力不可用时，网关只冷却该
账号的图片调度（默认 30 分钟），不会影响文本请求；可通过
`OPENAI_IMAGE_UNAVAILABLE_COOLDOWN_MINUTES` 调整为 1～120 分钟。

```bash
curl http://localhost:3000/v1/images/generations \
  -H "Authorization: Bearer mb-xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"一只坐在窗边的橘猫","size":"1024x1024"}'
```

```bash
curl http://localhost:3000/v1/images/edits \
  -H "Authorization: Bearer mb-xxxxxxxx" \
  -F "model=gpt-image-2" \
  -F "prompt=把天空替换成极光" \
  -F "image=@./source.png"
```

请求加上 `"stream":true` 可接收 `image_generation.partial_image` /
`image_generation.completed`（编辑时为 `image_edit.*`）SSE 事件。尺寸和格式参数
遵循 [OpenAI Image Generation 指南](https://developers.openai.com/api/docs/guides/image-generation)。

### Codex CLI 接 DeepSeek

让 Codex CLI 用 DeepSeek 的 API key 跑——网关在 `/api/deepseek/v1/responses`
暴露一个 Responses API 入口，原生转发到 DeepSeek `/v1/responses`，保留官方的
`web_search`、`apply_patch`、思考模式和 1M 上下文能力。账号池和 `/api/deepseek/v1/messages`
（Claude Code 路径）共享，**同一份 DeepSeek API key 同时服务两端**。OpenAI
兼容客户端仍可把 base URL 填成 `http://localhost:3000/api/deepseek/v1`，
走兼容 `chat/completions` 入口；网关会在内部转换为 DeepSeek Responses 上游。

#### 1. 后台准备

- **上游账户** 页面 → 添加 DeepSeek 账户，把你的 DeepSeek API key（`sk-...`）粘进去
- **API Keys** 页面 → 新建一个中转 key（拿到 `mb-xxxxxxxx`）；若设了 `allowedProviders`，勾上 `deepseek`

#### 2. 编辑 `~/.codex/config.toml`

```toml
[profiles.model-bridge-deepseek]
model_provider = "model-bridge-deepseek"
model = "deepseek-flash"  # DeepSeek V4.1 Flash

[model_providers.model-bridge-deepseek]
name = "model-bridge-deepseek"
base_url = "http://localhost:3000/api/deepseek/v1"
env_key = "MODEL_BRIDGE_API_KEY"
wire_api = "responses"
requires_openai_auth = false
```

- `base_url` 必须包含 `/api/deepseek/v1` 这段前缀，不能写成裸 `/v1`
- 中转站不在本机就把 `localhost:3000` 换成实际地址（如 `https://your-host`）

#### 3. 启动 Codex

```bash
export MODEL_BRIDGE_API_KEY=mb-xxxxxxxx
codex --profile model-bridge-deepseek
```

#### 4. 验证（可选）

不确定通不通时先用 curl 试一发：

```bash
curl -N -X POST http://localhost:3000/api/deepseek/v1/responses \
  -H "Authorization: Bearer mb-xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-flash","input":"say hi","stream":true}'
```

正常会看到 SSE：`response.created` → 若干 `response.output_text.delta` → `response.completed`。

#### 说明

- **模型名重写**：使用 `deepseek-flash` 调用原生支持视觉的 V4.1 Flash。Chat、Anthropic 和 Responses 均默认使用该名称，旧别名 `deepseek-chat` / `deepseek-reasoner` 也映射到它。显式传入 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 和 `deepseek-v4-pro` 仍可调用。北京时间 2026 年 9 月 14 日 12:00 起，上游将 V4 Pro 路由到 V4.1 Flash，直到 V4.1 Pro 上线；内置计费同步切换为 Flash 价格，管理员自定义价格仍优先。
- **隔离标识**：网关按租户和客户端身份生成匿名 `user_id` / `user`，用于 DeepSeek 内容安全、KV Cache 和调度隔离
- **流式兼容**：`stream:true` 返回完整 Responses SSE（适用于 Codex）；`stream:false` 或省略时返回原生 JSON
- **用量统计**：调用记在 `provider=deepseek` 下，与 messages 端点共用同一份统计

### Codex CLI 接 Xiaomi MiMo

Xiaomi MiMo 的接法和 DeepSeek 一样：后台添加 Xiaomi MiMo 账户并填入 API key 后，
可使用 `/api/xiaomi/v1/messages`、`/api/xiaomi/v1/chat/completions` 和
`/api/xiaomi/v1/responses` 三个入口。Codex 配置示例：

```toml
[profiles.model-bridge-mimo]
model_provider = "model-bridge-mimo"
model = "mimo-v2.5-pro"   # 或 "mimo-v2.5"

[model_providers.model-bridge-mimo]
name = "model-bridge-mimo"
base_url = "http://localhost:3000/api/xiaomi/v1"
env_key = "MODEL_BRIDGE_API_KEY"
wire_api = "responses"
requires_openai_auth = false
```

```bash
export MODEL_BRIDGE_API_KEY=mb-xxxxxxxx
codex --profile model-bridge-mimo
```

以 `mimo-` 开头的模型名会透传，其它模型会改写为 `mimo-v2.5-pro`；Responses
入口同样始终以 SSE 返回，用量记在 `provider=xiaomi` 下。

### Cherry Studio

为每个服务商各加一个自定义 provider：

- **Anthropic** —— base URL `http://localhost:3000`，API key `mb-xxxx`
- **Gemini** —— base URL `http://localhost:3000`，API key `mb-xxxx`
- **OpenAI** —— base URL `http://localhost:3000/v1`，API key `mb-xxxx`
- **DeepSeek as OpenAI** —— base URL `http://localhost:3000/api/deepseek/v1`，API key `mb-xxxx`
- **Xiaomi MiMo as OpenAI** —— base URL `http://localhost:3000/api/xiaomi/v1`，API key `mb-xxxx`

### Gemini CLI

官方版 Gemini CLI 不支持改 base URL，没法直接指向中转。要在外部用 Gemini 中转，
推荐 **Cherry Studio**（或任何能自定义 Gemini base URL 的客户端）。

## 配置

Docker 部署时 `install.sh` 会把所有配置写进宿主机的 `.env`；非 Docker 模式可
把 `.env.example` 复制为 `.env`，`ENCRYPTION_KEY` 与 `JWT_SECRET` 在首次运行
时自动生成。首次启动前请设置 `PG_PASSWORD` 和 `DATABASE_URL`——内置的
`postgres` 容器把数据存放在 `./data/pg/` 下，请备份这个目录。

服务收到 `SIGTERM`/`SIGINT` 后会停止接收新请求，等待在途请求、OAuth 回调、后台任务
和用量扣费落库，再关闭 PostgreSQL/Redis 连接。关停超时固定为 30 秒；Docker Compose
预留 35 秒停止宽限期。

### 支付宝 AI 网页应用收款

账户充值支持保留原有支付宝扫码支付，并新增基于官方 `alipay-sdk` 的支付宝网页支付。
配置 `ALIPAY_APP_ID`、Node.js 所需的 PKCS#1 原始 `ALIPAY_PRIVATE_KEY`、
`ALIPAY_PUBLIC_KEY`、`ALIPAY_SELLER_ID`（或 `ALIPAY_SELLER_EMAIL`）以及指向本站
`/api/payment/return/alipay` 的 `ALIPAY_RETURN_URL` 后，用户充值页会显示“支付宝网页支付”。

本地没有公网 HTTPS 地址时可以暂不设置 `ALIPAY_NOTIFY_URL`，服务端仍会实现并保留
通知验签、业务字段校验、持久化幂等和主动交易查询；生产上线前必须把
`ALIPAY_NOTIFY_URL` 配置为公网 HTTPS 的 `/api/payment/callback/alipay`，完成真实通知联调。
沙箱联调时把 `ALIPAY_GATEWAY` 设为
`https://openapi-sandbox.dl.alipaydev.com/gateway.do`，生产环境留空使用正式网关。

网站支付覆盖下单、主动查询、管理员关单、退款、退款查询、同步回跳和异步通知。
退款接口位于 `/api/admin/payment-orders/:id/refunds`，同一次未知结果重试必须复用
原 `outRequestNo`；退款查询至少等待 10 秒。

### 从旧版 SQLite 升级到 PostgreSQL（一键迁移）

如果你之前跑过 SQLite 版本（`./data/model-bridge.db` 存在），更新代码后
**直接跑一键脚本**即可，不用手动操作：

```bash
git pull
./install.sh          # 会自动给 .env 补上 PG_PASSWORD 等字段
./migrate-to-pg.sh    # 备份 SQLite → 起 PG → 自动建表 → 自动导入数据 → 起完整服务
```

`migrate-to-pg.sh` 全程有进度提示，行数对不上会直接报错退出。原 SQLite
文件会备份为 `./data/model-bridge.db.bak-<时间戳>`，确认无误前不要删。

### 本地开发与生产共用数据（可选，不推荐）

默认行为是**本地连本地库、与线上隔离**（见前面的「本地环境与生产环境」）。
只有在确实需要拿线上真实数据调试时，才走下面的隧道方式，并显式打开闸门。

生产服务器的 PostgreSQL 端口只绑在 `127.0.0.1`，不暴露到公网，所以要先建隧道。
在 `~/.ssh/config` 里加：

```sshconfig
Host model-bridge-prod
  HostName your.server.com
  User your-ssh-user
  LocalForward 5432 127.0.0.1:5432
```

然后：

1. `ssh model-bridge-prod` 启动隧道；
2. `.env.local` 里把 `DATABASE_URL` 改成 `postgres://model_bridge:PASSWORD@127.0.0.1:5432/model_bridge`；
3. **同时**设置 `ALLOW_REMOTE_DB=true` —— 否则后端会拒绝启动（`127.0.0.1`
   属于回环地址，这一条其实不会拦，但把开关写上能提醒自己当前在写线上库）；
4. 强烈建议先停掉线上应用容器，避免两个实例同时跑 token 刷新任务，
   把上游 refresh token 打废。

用完记得把 `DATABASE_URL` 改回本地库、并清掉 `ALLOW_REMOTE_DB`。

## 远程部署

如果把 model-bridge 部署在远程（VPS / NAS / 家庭服务器），授权回调的
`localhost:1455` 从云端是回不来的。三种处理方式：

| 方式 | 说明 | 适用场景 |
| ---- | ---- | -------- |
| **粘贴回调 URL**（推荐） | 浏览器授权完成后，从地址栏复制完整回调 URL（`localhost:1455/auth/callback?code=...`），粘贴到后台输入框。系统自动提取 code/state 完成授权。 | 无法 SSH/搬数据库时最方便 |
| **SSH 隧道** | 本地执行 `ssh -L 1455:127.0.0.1:1455 your-server`，授权时浏览器访问本机 `localhost:1455` 会转发到服务器。 | 偶尔添加账号 |
| **搬数据库** | 先在本地添加账户，再把 `./data/` 目录拷贝到服务器。Token 刷新任务会自动续期。 | 批量迁移或不方便实时操作 |

另外，如果已有 Access Token / Refresh Token，可以直接用后台的「直接导入 Token」
功能，完全跳过 OAuth 授权流程。需要一次导入多个账号时，可用「批量导入 JSON」；
原生格式见 [docs/account-import-example.json](docs/account-import-example.json)，
Codex 导出格式见 [docs/codex-import-example.json](docs/codex-import-example.json)。
这些文件包含敏感凭据，导入后不要提交或外传。

### Docker 部署说明

Docker Compose 的端口映射为 `3001:3000`（外部 3001 → 容器内 3000）。
管理后台通过 `http://<服务器IP>:3001` 访问。

### 代码更新后重新部署

Docker Compose 部署可直接在后台**设置 → 系统更新**里检查并升级。若更新服务不可用，
或需要手动处理生产目录改动，也可以在服务器上执行：

```bash
cd ~/model-bridge
git pull
docker compose up -d --build    # 完整重建（前后端都改了）
```

如果只改了前端：

```bash
cd web && npm run build && cd ..
docker compose restart
```

`./data` 目录是 volume 挂载的（PostgreSQL 数据位于 `./data/pg/` 下），
重建不会丢失数据库和账户数据。建议定期备份 `./data` 目录。

> ⚠️ 通过中转、用非官方工具使用订阅 OAuth 令牌，可能违反服务商服务条款并有
> 账户被封风险。仅建议使用你自己的订阅、并在小范围可信群体内共享。详见
> PLAN.zh-CN.md。
