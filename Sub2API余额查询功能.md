# Sub2API 余额查询

Sub2API 账户的余额在管理后台的“配额”列中显示。对 Sub2API 账户，点击该列右侧的刷新按钮会查询上游并保存最近一次成功结果；页面重新加载后仍会显示缓存快照。

## 查询接口

首选接口是官方的：

```text
GET /v1/usage
Authorization: Bearer <API key>
x-api-key: <API key>
```

兼容旧版中转部署时，程序还会依次尝试 `/api/usage`、`/user/balance`、`/v1/user/balance`、`/api/balance` 和 `/v1/balance`。Base URL 可以填写根地址，也可以填写末尾带 `/v1` 的地址，程序会自动归一化。

## 官方响应

钱包模式示例：

```json
{
  "mode": "unrestricted",
  "remaining": 12.34,
  "balance": 12.34,
  "unit": "USD"
}
```

Key 限额模式示例：

```json
{
  "mode": "quota_limited",
  "quota": {
    "limit": 100,
    "used": 40,
    "remaining": 60,
    "unit": "USD"
  },
  "remaining": 60
}
```

订阅模式会在 `subscription` 中返回日、周、月窗口。程序选择剩余额度最小的已配置窗口作为当前余额，并按窗口起点计算下一次重置时间。订阅没有任何金额窗口时，官方会返回 `remaining: -1`，后台会将其显示为“无限额”，不会显示成负数美元。

如果官方只返回 `mode` 或速率窗口而没有金额字段，查询仍会被记录为成功，并显示“上游未返回金额”；这表示上游没有提供可显示的美元余额，不等同于余额为零。

## 数据安全与缓存

- 查询使用账号保存的 API Key；加密字段会先由服务端解密，API Key 不会写入响应或日志。
- 只保存数值、币种、模式、计划、重置/到期时间和更新时间等白名单字段，不保存上游原始响应。
- 查询失败时不会覆盖上一次成功的快照。
- 余额为 `0` 是有效结果，会正常显示为零并标记为耗尽。

## 常见问题

### 一直显示“未更新”

部署包含本次改动的后端和前端后，在账户页点击 Sub2API 行的刷新图标。若仍失败，查看按钮返回的错误信息并确认：

1. Base URL 指向 Sub2API 部署根地址；
2. 账号的 API Key 有效，且能访问 `GET /v1/usage`；
3. 反向代理没有拦截 `Authorization` 或 `x-api-key` 请求头。

### 显示“上游未返回金额”

这通常是只配置了速率窗口的 Key，或订阅信息未被上游鉴权上下文加载。此时接口连通且鉴权成功，但没有可用的金额字段，程序不会自行推算余额。

### 查询是否消耗额度

官方 `/v1/usage` 是只读查询，不会发起模型请求。

## 相关代码

- `src/providers/sub2api/balance.ts`：接口请求、响应解析和快照校验；
- `src/accounts/tester.ts`：刷新并持久化账户余额；
- `src/routes/admin.ts`：单个/批量刷新管理接口；
- `web/src/views/AccountsView.vue`：账户列表展示和刷新按钮；
- `src/providers/sub2api/balance.test.ts`：余额解析与回退行为测试。
