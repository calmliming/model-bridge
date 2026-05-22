# model-bridge

> [English](./README.md) · **中文**

自托管的 AI API 中转平台 —— 把你的 **Claude / OpenAI / Gemini** 订阅转化为
标准 API 端点，可与好友共享；支持按用户隔离的 API Key、用量统计，以及多账户
自动轮换。

完整架构与分期路线图见 **[PLAN.zh-CN.md](./PLAN.zh-CN.md)**。

## 当前状态

🚧 **阶段 A —— 平台骨架。** 管理后台、登录鉴权、API Key 管理已可用。上游服务商
中转（Claude / OpenAI / Gemini 的 OAuth 接入）将在阶段 B–D 实现。

## 技术栈

- **后端：** Node.js + TypeScript、Fastify、SQLite（Drizzle ORM）
- **前端：** Vue 3 + Vite + Naive UI

## 快速开始（开发环境）

需要 Node.js 20+。

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

## 配置

可将 `.env.example` 复制为 `.env` 进行自定义。`ENCRYPTION_KEY` 与 `JWT_SECRET`
在首次运行时自动生成；初始管理员账户来自 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。
所有数据保存在 `./data/` 下的 SQLite 文件中 —— 请备份该目录。

> ⚠️ 通过中转、用非官方工具使用订阅 OAuth 令牌，可能违反服务商服务条款并有
> 账户被封风险。仅建议使用你自己的订阅、并在小范围可信群体内共享。详见 PLAN.zh-CN.md。
