# model-bridge

> [English](./README.md) · **中文**

自托管的 AI API 中转平台 —— 把你的 **Claude / OpenAI / Gemini** 订阅转化为
标准 API 端点，可与好友共享；支持按用户隔离的 API Key、用量统计，以及多账户
自动轮换。

完整架构与分期路线图见 **[PLAN.zh-CN.md](./PLAN.zh-CN.md)**。

## 当前状态

🚧 **阶段 E —— 统计与配额限制。** 在之前能力之上新增：完整的用量统计页
（每日趋势 + 按服务商/模型/Key 分解）、按 Key 的成本配额（在中转入口处强制
执行），以及 Key 的限额就地编辑（配额、速率、有效期、允许的服务商）。剩余：
阶段 F（部署）。

## 技术栈

- **后端：** Node.js + TypeScript、Fastify、SQLite（Drizzle ORM）
- **前端：** Vue 3 + Vite + Naive UI

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

## 类生产方式运行

```bash
cd web && npm install && npm run build && cd ..
npm install
npm start
```

之后后端会直接在 <http://localhost:3000> 托管构建好的管理后台。

## 接入 Claude Code

在 **API Keys** 页面创建一个密钥，在 **上游账户** 页面通过 OAuth 添加一个
Claude 账户，然后让 Claude Code 指向本中转服务：

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000/api/claude
export ANTHROPIC_AUTH_TOKEN=mb-xxxxxxxx   # 后台里的 API Key
claude
```

## 配置

可将 `.env.example` 复制为 `.env` 进行自定义。`ENCRYPTION_KEY` 与 `JWT_SECRET`
在首次运行时自动生成；初始管理员账户来自 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。
所有数据保存在 `./data/` 下的 SQLite 文件中 —— 请备份该目录。

> ⚠️ 通过中转、用非官方工具使用订阅 OAuth 令牌，可能违反服务商服务条款并有
> 账户被封风险。仅建议使用你自己的订阅、并在小范围可信群体内共享。详见 PLAN.zh-CN.md。
