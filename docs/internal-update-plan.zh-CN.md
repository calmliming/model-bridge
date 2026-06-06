# 内部更新 · 实施计划

> 状态：规划中。
> 关联：[与 sub2api 的差异化对比](./comparison-with-sub2api.zh-CN.md) 第 3 项「Web 一键升级 + 回滚」。
> 更新日期：2026-06-05

## 一、背景与目标

当前 model-bridge 的 Docker 部署更新方式是手动进入服务器目录执行：

```bash
git pull
docker compose up -d --build
```

这套方式可靠，但对日常运维不够友好。参考 sub2ai 的后台更新体验，本功能目标是在管理后台提供：

- 检查当前部署是否落后于远端 `origin/main`；
- 一键拉取最新代码、重建并重启 `model-bridge` 容器；
- 展示更新状态、错误原因和日志尾部；
- 在生产目录存在 tracked 改动时拒绝更新，避免覆盖人工修改。

本计划只覆盖 Docker Compose 部署的一键更新。裸机源码、PM2、systemd 单独运行 Node 服务等部署方式暂不纳入 v1。

## 二、sub2api 更新机制对比

sub2api 是 Go 单二进制应用，适合采用「发布包替换」模式：

1. 打 `v*` tag 后由 CI 构建 GitHub Release。
2. 后端查询 GitHub latest release。
3. 下载当前平台匹配的压缩包。
4. 校验 `checksums.txt`。
5. 原子替换当前可执行文件，并保留 `.backup` 用于回滚。
6. 管理后台触发 systemd 重启。

model-bridge 当前是 Node.js + Vue + Docker Compose 部署，容器中运行的是镜像内代码，不适合直接照搬「替换当前二进制」。更自然的更新方式是让服务器上的 Git 仓库更新到 `origin/main`，然后重新构建并启动 Docker Compose 服务。

因此，本项目推荐做成「sub2api 体验，Docker Compose 执行模型」：

- 后台仍然提供版本检查和一键更新；
- 更新动作不替换二进制，而是执行固定的 Git + Docker Compose 流程；
- 高权限操作放在独立 updater 容器里，主业务容器不直接持有 Docker 权限。

## 三、推荐方案

### 版本来源

v1 跟随 `origin/main`：

- 当前版本：服务器部署目录当前 `HEAD` commit。
- 最新版本：`origin/main` 最新 commit。
- 有更新：`HEAD` 与 `origin/main` 不一致。

这样不改变现有提交和打包习惯。开发者平时正常 commit/push 到 `main`；服务器后台检测到远端 main 更新后即可一键更新。

> 备选方案是参考 sub2api 使用 GitHub Release Tag。那样发布边界更稳定，但每次上线都需要额外打 tag 或创建 release。对于当前 model-bridge 的自托管轻量部署，先跟随 `main` 更合适。

### 执行器

新增独立 `model-bridge-updater` 服务：

- 只监听 Docker Compose 内网，不暴露公网端口；
- 挂载宿主机仓库目录；
- 挂载 `/var/run/docker.sock`；
- 持有 `UPDATE_TOKEN`；
- 只允许执行固定更新流程，不接受任意 shell 命令。

主应用容器通过 `UPDATER_URL` 和 `UPDATE_TOKEN` 调用 updater。这样 Docker 权限集中在 updater，业务服务被攻击时不会直接拥有宿主机 Docker socket。

### 脏工作区策略

更新前执行 tracked 工作区检查：

- 如果存在 staged 或 unstaged tracked 改动，拒绝更新；
- 忽略 untracked 文件，例如 `.env`、`data/`、临时日志；
- 不执行 `git clean`；
- 不自动 stash；
- 不强制覆盖。

这个策略可以保护生产目录里的人工修复和未提交改动。管理员需要先提交、清理或手动处理这些改动，再从后台触发更新。

## 四、Docker Compose 更新流程

updater 的标准流程如下：

1. 校验请求 Bearer token。
2. 确认当前没有正在执行的更新任务。
3. 在仓库目录执行 `git status --porcelain`，只要存在 tracked 改动就返回失败。
4. 执行 `git fetch origin main`。
5. 读取当前 `HEAD` 和 `origin/main`。
6. 如果两者一致，返回 `already_up_to_date`。
7. 执行 `git reset --hard origin/main`。
8. 执行 `docker compose up -d --build model-bridge`。
9. 记录任务状态、开始时间、结束时间、错误原因和日志尾部。
10. 前端轮询 `/health`，服务恢复后提示刷新页面。

推荐只重建 `model-bridge` 服务，不重启 PostgreSQL：

```bash
docker compose up -d --build model-bridge
```

PostgreSQL 数据位于 `./data/pg/`，该流程不会删除数据库和账户数据。

## 五、后端接口设计

后端只代理固定 updater 能力，所有接口仍需管理员 JWT 鉴权。

### 检查更新

```http
GET /api/admin/system/check-updates
```

响应示例：

```json
{
  "currentCommit": "575ee37",
  "latestCommit": "e5c0414",
  "hasUpdate": true,
  "branch": "main",
  "remote": "origin",
  "dirty": false,
  "checkedAt": 1780660800000
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `currentCommit` | 当前部署目录的短 commit |
| `latestCommit` | `origin/main` 的短 commit |
| `hasUpdate` | 当前 commit 是否落后远端 |
| `branch` | 固定为 `main` |
| `remote` | 固定为 `origin` |
| `dirty` | tracked 工作区是否有改动 |
| `checkedAt` | 检查时间，毫秒时间戳 |
| `warning` | 可选，网络失败或 updater 不可用时的提示 |

### 执行更新

```http
POST /api/admin/system/update
```

响应示例：

```json
{
  "operationId": "upd_1780660800_x7k2",
  "status": "updating",
  "message": "update started"
}
```

### 查询更新状态

```http
GET /api/admin/system/update-status
```

响应示例：

```json
{
  "operationId": "upd_1780660800_x7k2",
  "status": "succeeded",
  "startedAt": 1780660800000,
  "finishedAt": 1780660860000,
  "logTail": "docker compose up -d --build model-bridge\n..."
}
```

状态枚举：

| 状态 | 说明 |
|---|---|
| `idle` | 当前没有任务 |
| `checking` | 正在检查工作区和远端 |
| `updating` | 正在拉取代码、重建或重启服务 |
| `succeeded` | 更新完成 |
| `failed` | 更新失败 |

## 六、updater 服务设计

新增脚本建议放在 `scripts/updater.mjs`，由独立容器运行。

### 环境变量

| 变量 | 说明 |
|---|---|
| `UPDATE_TOKEN` | 主应用调用 updater 的内部密钥 |
| `REPO_DIR` | 仓库目录，默认 `/repo` |
| `UPDATER_PORT` | updater 监听端口，默认 `3002` |
| `UPDATE_REMOTE` | 远端名，默认 `origin` |
| `UPDATE_BRANCH` | 分支名，默认 `main` |

### 内部接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/health` | updater 存活检查 |
| `POST` | `/check` | 检查当前和远端 commit |
| `POST` | `/update` | 启动更新任务 |
| `GET` | `/status` | 查询任务状态 |

### 命令执行约束

updater 只允许执行写死的命令序列：

- `git status --porcelain`
- `git fetch origin main`
- `git rev-parse HEAD`
- `git rev-parse origin/main`
- `git reset --hard origin/main`
- `docker compose up -d --build model-bridge`

不得从请求体读取命令、路径、分支或服务名直接拼接执行。未来如果需要可配置分支，也应只从环境变量读取，并做严格格式校验。

## 七、前端交互设计

入口放在管理后台「设置」页，新增「系统更新」卡片。

### 默认展示

- 当前版本：当前短 commit；
- 最新版本：远端短 commit；
- 状态标签：已是最新 / 有新版本 / 工作区有改动 / updater 不可用；
- 操作按钮：刷新、立即更新。

### 有新版本

管理员点击「立即更新」后：

1. 弹出确认提示，说明会重建并重启服务；
2. 发送 `POST /api/admin/system/update`；
3. 禁用按钮并展示更新进度；
4. 轮询 `GET /api/admin/system/update-status`；
5. 更新完成后轮询 `/health`；
6. 服务恢复后提示刷新，或自动刷新页面。

### 异常状态

- updater 不可用：显示「更新服务未启动」，并提示可手动执行 README 中的更新命令。
- 工作区不干净：显示 tracked 改动阻止更新，提示先提交或清理生产目录改动。
- Docker 构建失败：展示错误摘要和日志尾部。
- 网络失败：允许重新刷新检查。

## 八、安全边界

内部更新会触达宿主机 Docker 权限，必须把安全边界写清楚：

- Docker socket 只挂载给 updater，不挂载给主应用；
- updater 不暴露公网端口；
- 主应用调用 updater 必须携带 `UPDATE_TOKEN`；
- 后端更新接口必须要求管理员 JWT；
- updater 不接受任意命令执行；
- 日志需要脱敏，不能输出 `UPDATE_TOKEN`、JWT、数据库密码、OAuth token、API Key、加密密钥；
- 更新前拒绝 tracked 脏工作区；
- 不执行破坏性清理命令，例如 `git clean`、删除数据目录、重置数据库；
- 一次只允许一个更新任务，并发请求直接返回当前任务状态。

## 九、测试计划

### 脚本与后端

- `node --check scripts/updater.mjs`
- `npm run typecheck`
- 覆盖以下 updater 场景：
  - 无更新；
  - 有更新；
  - tracked 工作区不干净；
  - `git fetch` 失败；
  - `docker compose up` 失败；
  - 并发更新锁；
  - token 缺失或错误；
  - 状态查询返回最近任务。

### 前端

- `cd web && npm run typecheck`
- `cd web && npm run build`
- 手测「设置」页：
  - 已是最新；
  - 有更新；
  - 更新中；
  - 更新成功后服务恢复；
  - 更新失败显示日志；
  - updater 不可用时显示提示。

### Docker 集成

在 Docker Compose 部署环境验证：

```bash
docker compose up -d --build
```

然后在后台触发检查和更新，确认：

- `model-bridge-updater` 仅在内网可访问；
- `model-bridge` 更新后重新构建并启动；
- `/health` 恢复正常；
- PostgreSQL 数据不受影响；
- tracked 改动会阻止更新。

## 十、默认假设

- 服务器部署目录是 Git 仓库；
- 远端名固定为 `origin`；
- 更新分支固定为 `main`；
- v1 不支持 Release Tag 或预构建镜像更新；
- v1 不支持后台回滚；
- v1 不支持裸机源码、PM2 或 systemd 部署的一键更新；
- 管理员仍可通过手动命令更新：

```bash
git pull
docker compose up -d --build
```

## 十一、后续扩展

如果后续要更接近 sub2api 的正式发布模型，可以逐步加入：

- GitHub Release Tag 检查；
- GitHub Actions 构建并推送 Docker 镜像；
- 服务器执行 `docker compose pull && docker compose up -d`；
- 更新前自动数据库备份；
- 上一镜像回滚；
- 更新审计日志。

这些能力适合在当前 `origin/main` 更新方案稳定后再做。
