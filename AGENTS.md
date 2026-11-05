# AGENTS.md

## Codex

- Codex 在每次会话开始时必须读取仓库根目录的 `AGENTS.md` 和 `CLAUDE.md`，并遵守其中所有适用于 Codex 的项目规则。
- 生成 Markdown 文档时，文件必须放在 `docs/` 目录下，并使用“中文名称_时间”的命名格式；时间统一使用 `YYYYMMDD-HHmmss`，例如 `接口变更说明_20260809-191500.md`。

## 生产服务器与部署

- 登录方式、实际服务器地址和部署流程见 [服务器登录与部署说明](docs/服务器登录与部署说明_20261105-214023.md)。部署前先读取该文档。
- 本项目使用 `scripts/server-ssh.mjs` 和本机 `.deployment/ssh.local.json` 登录服务器，不再依赖其他项目的配置或 SSH 运行库。
- `.deployment/` 是已排除出 Git 和 Docker 的本机配置目录。不得输出登录口令、解密后的凭据或将其写入可提交的文件。
