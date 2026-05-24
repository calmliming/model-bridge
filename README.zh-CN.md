# model-bridge

> [English](./README.md) · **中文**

自托管的 AI API 中转平台 —— 把你的 **Claude / OpenAI / Gemini** 订阅转化为
标准 API 端点，可与好友共享；支持按用户隔离的 API Key、用量统计，以及多账户
自动轮换。

完整架构与分期路线图见 **[PLAN.zh-CN.md](./PLAN.zh-CN.md)**。

## 当前状态

✅ **v1 已交付。** 管理后台、带成本配额的 API Key、Claude（粘贴 code）/
OpenAI（浏览器回调）/ Gemini（Google OAuth + Code Assist）账户接入、多账户
轮换、三类中转入口（兼容旧版 `/api/*` 路径，也支持干净的 `/v1/messages`、
`/v1/responses`、`/v1beta/models/*`），按日 / 服务商 / 模型 / Key 的用量统计，
以及一键 Docker 部署。

## 技术栈

- **后端：** Node.js + TypeScript、Fastify、SQLite（Drizzle ORM）
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

## 接入客户端

先在 **API Keys** 页面创建一个密钥，再在 **上游账户** 页面至少添加一个上游
账户（Claude 用粘贴 code，OpenAI / Gemini 用浏览器回调）。

### Claude Code

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_AUTH_TOKEN=mb-xxxxxxxx
claude
```

### Codex CLI

较新的 Codex CLI 使用 `model_providers` 配置自定义 Responses API：

```toml
# ~/.codex/config.toml
[profiles.model-bridge]
model_provider = "model-bridge"
model = "gpt-5.4"

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
时自动生成。所有数据保存在 `./data/` 下的 SQLite 文件中 —— 请备份该目录。

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

`./data` 目录是 volume 挂载的，重建不会丢失数据库和账户数据。
建议定期备份 `./data` 目录。

> ⚠️ 通过中转、用非官方工具使用订阅 OAuth 令牌，可能违反服务商服务条款并有
> 账户被封风险。仅建议使用你自己的订阅、并在小范围可信群体内共享。详见
> PLAN.zh-CN.md。
