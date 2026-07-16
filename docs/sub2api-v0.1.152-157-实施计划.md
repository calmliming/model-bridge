# sub2api v0.1.152–v0.1.157 同步实施计划

> 跟踪对象：Wei-Shaw/sub2api v0.1.152 – v0.1.157（2026-07-13 ~ 2026-07-16，v0.1.154 缺号）
> 整理日期：2026-07-16
> 目标仓库：model-bridge
> 上一轮：v0.1.145–v0.1.151（见 [comparison-with-sub2api](./comparison-with-sub2api.zh-CN.md) 第六节）
>
> **状态（2026-07-16）：实施项 1–5 已全部落地**（实施项 6「预流阶段防断连」为可选项,暂未做）。后端 typecheck 通过、293 测试全绿（新增 18 个）、前端 typecheck + 构建通过。落地摘要见对比文档「跟踪 sub2api 至 v0.1.157」小节。

## 背景

sub2api 在 3 天内连发 5 个版本，集中在：Grok 平台扩展（API Key 账号、健康监控、免费额度、prompt caching）、failover / 调度稳定性、协议转换与计费修复、以及安全运营能力（审计日志、会话绑定、step-up 2FA）。

本轮对照沿用既往方法：**先逐项核查 model-bridge 是否存在同构问题，只对真实差距立项**，不照搬 sub2api 的 SaaS 能力。本轮核查基于三路代码调查（协议转换/计费、failover/调度、伪装/Grok），结论按「无同类问题 / 真实差距 / 暂缓不适用」三档归类。

参考来源：

- [sub2api releases](https://github.com/Wei-Shaw/sub2api/releases)（v0.1.152 ~ v0.1.157）

## 核查结论一：无同类问题（不改代码）

以下 sub2api 修复项，经核查 model-bridge **不存在同构形态**：

| sub2api 修复 | 版本 | model-bridge 核查结论 |
| --- | --- | --- |
| Haiku 请求未应用完整 Claude Code 伪装 | v0.1.157 | ❌ 不存在 —— 伪装层 `src/providers/claude/relay.ts` 是统一路径（headers/身份块/billing block 处理均无按 model 分支），Haiku 与其他模型完全同路径，测试 `relay.test.ts` 有 Haiku 用例佐证 |
| Responses↔Anthropic 转换丢 `cache_creation_input_tokens` | v0.1.152 | ❌ 不适用 —— 本仓库没有 Responses↔Anthropic 转换器（Claude 只有原生透传 + Chat↔Anthropic 两条路径）；Chat 路径的 cache_creation 统计经 `src/providers/claude/usage.ts:39-55` 从上游原始事件解析，正确无丢失 |
| 并行 tool_use 产生幻影 `content_block_delta`（index 错乱） | v0.1.156 | ❌ 不存在 —— `claude/chat.ts:314-424` 用 `toolIndexByBlock` Map 管理块映射，查不到映射即丢弃不发 delta；Responses→Chat 方向用 `toolIndexesByItemId` 同样正确 |
| OpenAI 长上下文重复计费（改为账号级开关默认关） | v0.1.155 | ❌ 不存在 —— 本仓库定价是单一线性费率（`usage/pricing.ts`），根本没有长上下文分档，无重复计费源；分档计费本身列为待评估项（见结论三） |
| native Responses 转发丢工具命名空间 | v0.1.155 | ❌ 不存在 —— 全库无任何改写/剥离 tool name 的代码，mcp 前缀原样透传；唯一例外是整类剥离 `image_generation` 工具（刻意行为，v0.1.144 轮已落地） |
| 用量统计跨时区日期偏移 | v0.1.153 | ✅ 已修 —— d9a523e 已将日桶/range 边界/today 窗口统一到 `STATS_TIMEZONE`，API 与 dashboard 一致。遗留两处小尾巴见实施项 5 |
| 调度器全量重建风暴 / 并发重建合并 | v0.1.155 | ❌ 不适用 —— 本仓库调度是每请求即时 DB 查询（`accounts/scheduler.ts:39-132`），无快照/缓存/重建机制，不存在重建风暴 |
| failover 在客户端断开后静默中止、误报 502 | v0.1.156 | ❌ 反向形态 —— 本仓库未接 AbortController，断开**不会**中止 failover（不存在该 bug），代价是资源浪费，见实施项 4 |
| Codex plan-gated 模型 400 后重试死循环 | v0.1.155 | ❌ 不存在 —— 400 非限流文本时 `classifyUpstreamFailure` 直接不重试、原样透传（`routes/relay.ts:736-742`），无重试循环 |
| /v1/messages 精确模型映射不生效 | v0.1.155 | ❌ 已正确 —— key 级映射 `keys/modelMapping.ts` 对含 `/v1/messages` 在内所有 provider 统一生效，精确匹配优先于通配，含测试 |
| tool_choice 指向被剥离的 image 工具 | v0.1.152 | ❌ 已防护 —— `stripImageGenerationTools` 剥工具时同步剥指向它的 `tool_choice`（v0.1.144 轮落地） |

## 核查结论二：真实差距（本轮实施项）

按价值排序，首期建议落地 1–5。

### 1. sub2api 透传路径错误净化（对应 v0.1.156）

**问题**：sub2api / sub2api-chat 属非 responses 协议，3 轮同号重试耗尽后走 `sendBuffered` / `sendStreaming` 原样透传（`src/routes/relay.ts:1646-1650, 1685-1688`），上游网关的错误体**逐字回传**给客户端——可能泄露上游网关地址、渠道名、内部配置等信息（sub2api 同期还专门移除了一个泄露内部渠道配置的端点，方向一致）。

**方案**：

- 对 `relayToRelay` 提供方的最终失败响应做净化：保留 HTTP 状态码与 `extractUpstreamError` 提取的 code/message 类别，重写为本网关自己的错误 envelope，剥掉上游原始 body 中的 URL、渠道、内部字段。
- sub2api-responses 路径已经走合成 `response.failed`（泄露面小），保持不变，但同样只保留 message 的净化文案。
- 净化开关不做配置项，直接默认开启（透传上游错误细节对终端用户无价值）。
- 日志侧保留完整上游错误体（仅服务端可见），便于排障。

**测试**：sub2api 透传路径当前**零测试**（见结论四），本项连带补上：非 2xx 透传净化、3 轮耗尽后的最终响应形态、流式/缓冲两条路径。

### 2. OpenAI 临时冷却按模型隔离（对应 v0.1.157）

**问题**：当前 cooldown 是账号级（`accounts` 表 `status`+`cooldownUntil`，`accounts/scheduler.ts:176-186`）。OpenAI 单个模型出错（如 plan-gated 模型 404/429、某档模型独立限流）会把整个账号停调，其他模型也被拖累。sub2api v0.1.157 已改为按模型隔离。

**方案**：

- 不动表结构，在 `accounts.metadata` 加 `modelCooldowns: Record<modelKey, epochMs>`（modelKey 用归一化后的模型名）。
- `penalizeAccount` 增加可选 `model` 参数：传入且 provider 为 openai 时写模型级冷却，不改账号级 `status`；未传时保持现有账号级行为（其他 provider 不变）。
- `pickAccount` 过滤时若请求模型命中未过期的 `modelCooldowns[model]`，跳过该账号（等同现有 cooldown 过滤，`scheduler.ts:97-99` 附近）。
- 触发面收窄：仅「明确可归因到单模型」的错误走模型级——429 且响应头带模型窗口信息、404 model_not_found、plan-gated 400；泛化的 5xx/网络错误仍走账号级（上游整体故障不该按模型分桶）。
- 过期清理并入 `clearExpiredAccountCooldowns` 同一节奏，惰性清理即可（读时过滤 + 写时顺带清理过期项）。

**测试**：模型级冷却写入/过滤/过期、账号级行为不回归、非 OpenAI provider 不受影响。

### 3. stop_reason / finish_reason 映射补全（对应 v0.1.153 同类）

**问题**：sub2api v0.1.153 修了流式 Anthropic 兼容层 max_tokens/content_filter 停止原因映射。本仓库核查发现同区域两处不完整：

- `claude/chat.ts:181-190` `mapStopReason`：Anthropic `refusal` 被映射为 `stop`（应为 `content_filter`），`pause_turn` 也落到 `stop`。
- Responses→Chat 方向（`openai/chat.ts:398, 505, 514`）finish_reason 硬编码 `'tool_calls'/'stop'`，`incomplete`（max_output_tokens）时缺 `length`、内容过滤缺 `content_filter`。

**方案**：

- `mapStopReason` 补 `refusal → content_filter`；`pause_turn` 维持 `stop`（OpenAI 无对应语义，注释说明）。
- Responses→Chat：从 `response.incomplete_details.reason` 映射 —— `max_output_tokens → length`、`content_filter → content_filter`，其余保持现状。
- 原生 `/v1/messages` 透传路径不动（stop_reason 来自上游，无需网关映射）。

**测试**：扩充 `claude/chat.test.ts:95-100` 映射用例；`openai/chat.test.ts` 补 incomplete 场景。

### 4. 客户端断开中止重试循环（对应 v0.1.156 的反向加固）

**问题**：sub2api 修的是「断开导致 failover 静默中止」；本仓库是反向——完全没接 AbortController（`callUpstream` 的 fetch 不传 signal，`runRelayLoop` 无 `request.raw.on('close')`），客户端断开后仍会把 3 个账号试完并向已死 socket 写流。不是正确性 bug，但浪费上游配额和本地资源，客户端取消场景（Codex/Claude Code 用户 Ctrl-C）很常见。

**方案（保守版）**：

- 在 `runRelayLoop` 入口监听 `request.raw` 的 `close`/`aborted`，置 `clientGone` 标志。
- **仅在重试边界检查**：每轮换号前若 `clientGone` 则终止循环，不再发起新的上游请求。已在途的上游请求不 abort（避免把「客户端断开」误传染成上游错误、也避开计费边界问题）。
- 流已开始后的断开维持现状（读循环 catch 已静默停止，usage 照常落账）。
- 不给上游 fetch 传 signal——第一期先只省「后续轮次」，风险最小。

**测试**：断开后不再进入下一轮取号;正常请求行为不变。

### 5. 时区收尾（d9a523e 残留）

**问题**：两处小尾巴——① `web/src/utils.ts:17` 最近日志时间戳用浏览器本地时区渲染，与日桶的 `STATS_TIMEZONE` 可能跨天不一致；② `src/usage/stats.ts:273`（"(UTC)"）与 `:411`（"server timezone"）注释过时。

**方案**：前端时间戳格式化改用后端下发的 `STATS_TIMEZONE`（overview 接口顺带返回该设置，`toLocaleString` 传 `timeZone`）；更新两处注释。纯展示层，风险极低。

### 6. 预流阶段防断连（可选，v0.1.150 心跳的补强)

**问题**：SSE 心跳（15s `: keepalive`）只在上游 body 读循环内启动（`routes/relay.ts:1422-1437`），选号→刷 token→上游 TTFB 这段真空期无任何输出，慢首字节时反代仍可能空闲断连。

**方案（如做）**：SSE 请求在 `writeHead` 后、首个上游字节前也跑同一心跳定时器；非 SSE 输出不注入。注意仅对已确定 `sseOutput` 的路径生效——但 `sseOutput` 依赖上游 content-type，需改为「客户端请求了 stream 且路由是 SSE 型协议」时提前判定。此项改动触及流式主路径,建议单独一个 commit 并压测后再合入,列为**可选**。

## 核查结论三：暂缓 / 不适用项

| 能力 | 版本 | 处置 |
| --- | --- | --- |
| **Grok 增强包**：xAI API Key 账号、账号级自定义 base URL/headers、第三方 base URL、健康监控+自动探活、免费额度 24h 滚动估算、prompt caching、Web SSO 批量导入、视频编辑端点 | v0.1.152/153/155/157 | 暂缓 —— 本仓库 Grok 刚接入（OAuth-only，base URL 仅全局 env 覆盖 `XAI_BASE_URL`），使用量未起来前不扩面。若后续 Grok 成为主力上游，优先补 **xAI API Key 账号类型 + 账号级 base URL**（自托管价值最高） |
| 操作审计日志 + 管理页、会话 IP/UA 绑定、敏感操作 step-up 2FA | v0.1.157 | 暂缓 —— 并入差异表第 2 项「安全加固」遗留（2FA/TOTP 本就在列），属 SaaS 运营向，轻量自托管定位下优先级低 |
| 异步生图任务 + 对象存储、图片输入 token 独立计费 | v0.1.157 | 不适用 —— 本仓库无图像主路径（图片输入在转换器中直接丢弃），差异表第 19 项已跟踪 |
| Codex alpha/search web 搜索转发 + 按次计费 | v0.1.152 | 暂缓 —— 按次计费模型（$/次 + 分组倍率）与现有 token 计费体系不同构，需求出现再设计 |
| 上游计费倍率探测 + 按倍率调度 | v0.1.157 | 暂缓 —— 依赖 sub2api 网关间协议，本仓库作为 sub2api 下游时可受益，观察上游协议稳定后评估 |
| Responses 被拒字段自动剥离重试、请求体超限自动换号 | v0.1.157 | 暂缓 —— 本仓库靠发送前主动剥离（openai/gemini/grok 均有），反应式重试收益有限；若上游字段变动频繁再立项 |
| 长上下文分档计费（>200k 输入分档） | v0.1.155/156 | 待评估 —— sub2api 也默认关闭；需先确认上游实际按长上下文差异计费后再动 `TierPrice` 结构，避免凭空复杂化 |
| force-chat 直连桥（跳过 Responses 中间层）、审核关键词热路径、调度快照复用、Server-Timing、HTTP/2 keep-alive PING、WS 系列修复、Apple container 部署、DataTable/前端修复 | v0.1.153/155/156 | 不适用 —— 架构不同（无 Responses 中间层/无 WS 转发路径/无 Go HTTP/2 栈）或纯 sub2api 前端问题 |
| Codex Agent Identity 认证 | v0.1.156/157 | 待评估 —— 新认证形态，等上游生态稳定（Codex 客户端普及该模式）后再看是否需要 |

## 核查结论四：测试缺口（随实施项补齐）

本轮调查发现的存量测试盲区，与实施项绑定补齐，不单独立项：

1. `runRelayLoop` 换号/重试/断开行为 —— 零集成测试（随实施项 1、4 补）。
2. sub2api 透传 + `relayToRelay` 同号重试 —— 零测试（随实施项 1 补）。
3. `penalizeAccount` / `pickAccount` cooldown 设置与过滤 —— 无直接测试（随实施项 2 补）。
4. SSE 心跳 —— 无测试（如做实施项 6 时补）。

## 实施拆分

### 后端

1. `relayToRelay` 最终失败响应净化 + envelope 重写（实施项 1）。
2. `penalizeAccount`/`pickAccount` 增加 OpenAI 模型级冷却（实施项 2）。
3. `mapStopReason` 补 `refusal`；Responses→Chat 补 `incomplete_details` 映射（实施项 3）。
4. `runRelayLoop` 客户端断开标志 + 重试边界检查（实施项 4）。
5. stats 注释修正、overview 返回 `STATS_TIMEZONE`（实施项 5）。

### 前端

1. 最近日志时间戳按 `STATS_TIMEZONE` 渲染（实施项 5）。

### 文档

1. 更新 `docs/comparison-with-sub2api.zh-CN.md`：跟踪版本 bump 到 v0.1.157，新增本轮「第六节」小节，差异表按需补行（模型级冷却、透传净化）。
2. 本文档随落地进度更新状态。

### 验证

```bash
npm run typecheck
npm test
cd web && npm run typecheck
cd web && npm run build
```

> 注意:本地 `npm test` 需要有效 `.env`,否则有 7 个测试文件加载失败(既有现象,非回归)。

## 验收标准

1. sub2api 上游报错时,客户端收到的错误体不含上游网关 URL/渠道/内部字段;服务端日志保留完整原始错误。
2. OpenAI 账号单模型 429/404 后,同账号其他模型仍可被调度;冷却到期自动恢复;非 OpenAI provider 行为不变。
3. Anthropic `refusal` 经 Chat 兼容层返回 `content_filter`;Responses `incomplete`(max_output_tokens)经 Chat 兼容层返回 `length`。
4. 客户端断开后不再发起新一轮上游请求;已在途请求照常完成并落账。
5. 前端最近日志日期与「今日」统计桶在任意浏览器时区下一致。
6. 全部既有测试通过,无敏感信息新增入日志。

## 默认假设

- 不新增数据库表,模型级冷却存 `accounts.metadata`。
- 错误净化默认开启,不做配置项。
- 客户端断开只中止「后续轮次」,不 abort 在途上游请求(计费安全优先)。
- Grok 增强包、审计日志、step-up 2FA 本轮不做。
- 长上下文分档计费在确认上游真实计费行为前不动定价结构。
