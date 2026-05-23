# AGENTS.md

## 仓库约定

- 本仓库是 `model-bridge`，一个自托管 AI API 中转平台。
- 后端代码在 `src/`，技术栈是 Node.js、TypeScript、Fastify、SQLite、Drizzle ORM。
- 前端代码在 `web/src/`，技术栈是 Vue 3、Vite、Pinia、Vue Router、Naive UI。
- 优先做小而聚焦的改动，遵循现有目录结构和代码风格。
- 除非任务明确需要，不要重写无关代码、生成文件、锁文件或配置。
- 工作区里已有的用户改动必须保留，不要擅自回滚。

## 常用命令

- 只启动后端：`npm run dev`
- 只启动前端：`cd web && npm run dev`
- 同时启动前后端：`npm run dev:all`
- 后端类型检查：`npm run typecheck`
- 前端类型检查：`cd web && npm run typecheck`
- 前端构建：`cd web && npm run build`
- 运行测试：`npm test`
- 生成数据库迁移：`npm run db:generate`

## 后端规则

- API 路由放在 `src/routes/`。
- 服务商相关的 relay、OAuth、usage 逻辑放在 `src/providers/<provider>/`。
- 账户和 API Key 的持久化行为优先放在已有 manager 模块中。
- 路由处理外部输入前必须做校验。
- 不要把敏感信息写进日志。禁止打印明文 API Key、OAuth token、JWT secret、加密密钥、授权码。
- 修改数据库结构前，必须同时检查 `src/db/schema.ts`、`src/db/init.ts` 和迁移生成要求。
- 保持 Fastify 路由行为兼容现有 `/api/*` 和 `/health` 入口。

## 前端规则

- 使用现有 Vue 单文件组件写法。
- 优先使用 Naive UI 组件，不要随意引入新的 UI 依赖。
- 管理后台应保持轻量、现代、信息密度合理；登录后的控制台不要做成营销落地页。
- 登录页和控制台布局必须响应式；桌面端避免出现不必要的视口高度滚动。
- 可复用的全局页面样式放在 `web/src/styles.css`；页面专属样式放在对应 view 的 scoped style 中。
- 除非任务明确需要，不要新增图标库或图表库。

## 质量要求

- 修改后运行最相关的检查：
  - 后端或共享 TypeScript 改动：`npm run typecheck`
  - 前端改动：`cd web && npm run typecheck`；涉及 UI 或构建时再运行 `cd web && npm run build`
  - 脚本改动：`node --check <script>`
- 如果命令因为沙箱、权限、端口占用或缺少服务无法运行，要明确说明。
- 修改用户可见行为时，只有在能帮助后续维护者时才更新 README 或界面文案。

## 安全与运维

- 默认账号密码只用于本地初始化，不要把它描述成生产可用方案。
- `.env`、数据库文件、生成的密钥、本地 Claude/Codex 设置不要提交，除非任务明确要求。
- OAuth token、中转凭据、API Key 都按敏感生产数据处理。
- 避免破坏性命令。删除数据、重置 git 状态、杀掉无关进程之前必须先确认。
