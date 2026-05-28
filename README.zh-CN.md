# model-bridge

> [English](./README.md) · **中文**

自托管的 AI API 中转平台 —— 把你的 **Claude / OpenAI / Gemini / DeepSeek** 订阅转化为
标准 API 端点，可与好友共享；支持按用户隔离的 API Key、用量统计，以及多账户
自动轮换。

完整架构与分期路线图见 **[PLAN.zh-CN.md](./PLAN.zh-CN.md)**。

## 当前状态

✅ **v1 已交付。** 管理后台、带成本配额的 API Key、Claude（粘贴 code）/
OpenAI（浏览器回调）/ Gemini（Google OAuth + Code Assist）/ DeepSeek（API key）账户接入、
多账户轮换（支持优先级）、三类中转入口（兼容旧版 `/api/*` 路径，也支持干净的 `/v1/messages`、
`/v1/responses`、`/v1beta/models/*`），按日 / 服务商 / 模型 / Key 的用量统计，
以及一键 Docker 部署。

## 技术栈

- **后端：** Node.js + TypeScript、Fastify、PostgreSQL（Drizzle ORM）
- **前端：** Vue 3 + Vite + Naive UI + ECharts

## 快速开始（开发环境）

需要 Node.js 20+。

```bash
# 同时启动前后端，并用 API / WEB 标签区分格式化日志。
npm install
cd web && npm install && cd ..
npm run dev:all
```

也可以分别启动：

```bash
# 后端 —— 端口 3000。会安装依赖；密钥在首次运行时自动生成到 .env。
npm install
npm run dev

# 前端开发服务器 —— 端口 5173，会把 /api 代理到后端。
cd web
npm install
npm run dev
```

打开 <http://localhost:5173>，用 **admin / admin** 登录，然后立刻在**设置**
页面修改密码。

## 部署

### 使用 Docker（推荐）

```bash
./install.sh
```

`install.sh` 会生成带随机 `ENCRYPTION_KEY` / `JWT_SECRET` 的 `.env`，然后
`docker compose up -d --build`。完成后：

- 管理后台：<http://localhost:3001>
- OAuth 回调监听：`localhost:1455`（OpenAI / Google 登录时浏览器需访问此端口）
- 默认管理员：`admin / admin` —— 暴露后台前请在**设置**里改掉

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

- **后端**：在 `.env` 里设置 `PORT=<端口号>`（默认 3000）。
- **前端开发服务器**：修改 [web/vite.config.ts](web/vite.config.ts) 的 `server.port`（默认 5173）。
- **前端开发代理目标**：如果改了后端端口，必须同步修改 [web/vite.config.ts](web/vite.config.ts) 里 `/api`、`/health` 两条代理的目标，否则 `npm run dev:all` 前端调不到后端。
- **Docker**：修改 `docker-compose.yml` 里的端口映射（格式是 `3001:3000`，左侧才是对外暴露的端口）。

## 接入客户端

先在 **API Keys** 页面创建一个密钥，再在 **上游账户** 页面至少添加一个上游
账户（Claude 用粘贴 code，OpenAI / Gemini 用浏览器回调，DeepSeek 填 API key）。

### 账户优先级

同一服务商有多个账户时，可在账户列表中设置**优先级**（1–100，默认 1）来控制
调度顺序。数值越高越优先使用，相同优先级则按最近最少使用策略轮换。

在**上游账户**页面直接调整优先级列的数值即可，修改即时生效。

### Claude Code

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_AUTH_TOKEN=mb-xxxxxxxx
claude
```

想让 Claude Code 走 DeepSeek 上游（DeepSeek 提供 Anthropic 兼容端点），把
`ANTHROPIC_BASE_URL` 改成 `http://localhost:3000/api/deepseek` 即可，账号池
和 [Codex CLI 接 DeepSeek](#codex-cli-接-deepseek) 共享同一份 DeepSeek API key。

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

中转目前暴露 OpenAI 的 **Responses** API（`/v1/responses`），因为 Codex CLI
用的就是它。给 Cherry Studio / 通用 OpenAI 客户端用的 Chat Completions 入口
**尚未实现**。

### Codex CLI 接 DeepSeek

让 Codex CLI 用 DeepSeek 的 API key 跑——网关在 `/api/deepseek/v1/responses`
暴露一个 Responses API 入口，内部把请求改写成 DeepSeek 的 `chat/completions`
协议，再把响应流转换回 Codex 期望的 Responses 事件。账号池和 `/api/deepseek/v1/messages`
（Claude Code 路径）共享，**同一份 DeepSeek API key 同时服务两端**。

#### 1. 后台准备

- **上游账户** 页面 → 添加 DeepSeek 账户，把你的 DeepSeek API key（`sk-...`）粘进去
- **API Keys** 页面 → 新建一个中转 key（拿到 `mb-xxxxxxxx`）；若设了 `allowedProviders`，勾上 `deepseek`

#### 2. 编辑 `~/.codex/config.toml`

```toml
[profiles.model-bridge-deepseek]
model_provider = "model-bridge-deepseek"
model = "deepseek-v4-pro"   # 或 "deepseek-v4-flash" 用更便宜的轻量模型

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
  -d '{"model":"deepseek-v4-pro","input":"say hi","stream":true}'
```

正常会看到 SSE：`response.created` → 若干 `response.output_text.delta` → `response.completed`。

#### 说明

- **模型名重写**：以 `deepseek-` 开头的透传（`deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-reasoner` 等），其它（包括 Codex 默认的 `gpt-5-codex`）一律强制改为 `deepseek-v4-pro`，所以即使 toml 里 `model` 写错或不写也能跑通
- **始终 SSE**：该端点忽略客户端的 `stream` 字段，永远以 text/event-stream 返回
- **用量统计**：调用记在 `provider=deepseek` 下，与 messages 端点共用同一份统计

### Cherry Studio

为每个服务商各加一个自定义 provider：

- **Anthropic** —— base URL `http://localhost:3000`，API key `mb-xxxx`
- **Gemini** —— base URL `http://localhost:3000`，API key `mb-xxxx`
- **OpenAI** —— 暂未实现（见上面 Codex CLI 一节）

### Gemini CLI

官方版 Gemini CLI 不支持改 base URL，没法直接指向中转。要在外部用 Gemini 中转，
推荐 **Cherry Studio**（或任何能自定义 Gemini base URL 的客户端）。

## 配置

Docker 部署时 `install.sh` 会把所有配置写进宿主机的 `.env`；非 Docker 模式可
把 `.env.example` 复制为 `.env`，`ENCRYPTION_KEY` 与 `JWT_SECRET` 在首次运行
时自动生成。首次启动前请设置 `PG_PASSWORD` 和 `DATABASE_URL`——内置的
`postgres` 容器把数据存放在 `./data/pg/` 下，请备份这个目录。

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

### 本地开发与生产共用数据

数据库改为独立的 PostgreSQL 服务后，本地开发进程可以通过 SSH 隧道直连生产
数据库——不再需要手动导出/导入。在 `~/.ssh/config` 里加：

```sshconfig
Host model-bridge-prod
  HostName your.server.com
  User your-ssh-user
  LocalForward 5432 127.0.0.1:5432
```

然后 `ssh model-bridge-prod` 启动隧道，本地 `.env` 里把 `DATABASE_URL`
设成 `postgres://model_bridge:PASSWORD@127.0.0.1:5432/model_bridge`。
后端启动时若 `NODE_ENV != production` 且数据库 host 不是 `localhost`，
会打印醒目警告横幅,提示当前正在写生产库。生产服务器上 PostgreSQL 端口
只绑在 `127.0.0.1`，不暴露到公网。

## 远程部署

如果把 model-bridge 部署在远程（VPS / NAS / 家庭服务器），授权回调的
`localhost:1455` 从云端是回不来的。三种处理方式：

| 方式 | 说明 | 适用场景 |
| ---- | ---- | -------- |
| **粘贴回调 URL**（推荐） | 浏览器授权完成后，从地址栏复制完整回调 URL（`localhost:1455/auth/callback?code=...`），粘贴到后台输入框。系统自动提取 code/state 完成授权。 | 无法 SSH/搬数据库时最方便 |
| **SSH 隧道** | 本地执行 `ssh -R 1455:localhost:1455 your-server`，授权时浏览器跳转会通过隧道送达服务器。 | 偶尔添加账号 |
| **搬数据库** | 先在本地添加账户，再把 `./data/` 目录拷贝到服务器。Token 刷新任务会自动续期。 | 批量迁移或不方便实时操作 |

另外，如果已有 Access Token / Refresh Token，可以直接用后台的「直接导入 Token」
功能，完全跳过 OAuth 授权流程。

### Docker 部署说明

Docker Compose 的端口映射为 `3001:3000`（外部 3001 → 容器内 3000）。
管理后台通过 `http://<服务器IP>:3001` 访问。

### 代码更新后重新部署

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
