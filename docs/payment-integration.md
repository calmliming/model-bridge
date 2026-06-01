# 支付集成文档

## 概述

Model Bridge 现已集成支付宝和微信支付，支持用户在线充值。系统支持三种支付方式：

- **线下转账（manual）**：默认方式，需要管理员手动确认入账
- **支付宝（alipay）**：扫码支付，自动回调入账
- **微信支付（wechat）**：扫码支付，自动回调入账

## 架构设计

### 1. 支付提供商抽象层

**文件位置**：`src/payments/providers/`

```
providers/
├── base.ts          # 支付提供商接口定义
├── alipay.ts        # 支付宝实现
├── wechat.ts        # 微信支付实现
└── index.ts         # 提供商注册和获取
```

**核心接口**：

```typescript
interface PaymentProvider {
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>
  verifyNotification(data: Record<string, unknown>): Promise<PaymentNotification>
  queryOrder?(orderId: string): Promise<PaymentNotification>
}
```

### 2. 支付流程

#### 用户发起充值

1. 用户选择充值金额和支付方式
2. 系统创建 `payment_orders` 记录（状态：pending）
3. 如果是第三方支付，调用支付网关生成支付二维码
4. 返回订单信息和支付 URL

#### 支付回调处理

1. 支付平台异步通知回调 URL
2. 验证签名确保请求来自支付平台
3. 查询订单状态，确认未处理
4. 使用数据库事务：
   - 创建钱包流水记录（credit）
   - 更新用户余额
   - 更新订单状态为 paid
5. 返回成功响应给支付平台

### 3. 数据库设计

**payment_orders 表**：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text | 订单 ID（po_xxx） |
| user_id | text | 用户 ID |
| provider | text | 支付方式（manual/alipay/wechat） |
| status | text | 状态（pending/paid/canceled/expired） |
| amount_micros | bigint | 金额（微美元） |
| provider_order_id | text | 第三方订单号 |
| payment_url | text | 支付链接（二维码内容） |
| wallet_transaction_id | text | 关联的钱包流水 ID |
| expires_at | bigint | 过期时间（30分钟） |
| paid_at | bigint | 支付时间 |
| created_at | bigint | 创建时间 |

## 配置说明

### 环境变量

在 `.env` 文件中配置支付提供商：

```bash
# 支付宝配置
ALIPAY_APP_ID=your_app_id
ALIPAY_PRIVATE_KEY=your_private_key
ALIPAY_PUBLIC_KEY=alipay_public_key
ALIPAY_NOTIFY_URL=https://yourdomain.com/api/payment/callback/alipay
ALIPAY_RETURN_URL=https://yourdomain.com/payment/return

# 微信支付配置
WECHAT_APP_ID=your_app_id
WECHAT_MCH_ID=your_mch_id
WECHAT_API_KEY=your_api_key
WECHAT_NOTIFY_URL=https://yourdomain.com/api/payment/callback/wechat
```

### 获取支付宝密钥

1. 登录 [支付宝开放平台](https://open.alipay.com/)
2. 创建应用，选择"当面付"产品
3. 生成应用私钥和公钥
4. 上传应用公钥，获取支付宝公钥
5. 配置回调地址

### 获取微信支付密钥

1. 登录 [微信支付商户平台](https://pay.weixin.qq.com/)
2. 获取商户号（mch_id）
3. 设置 API 密钥（32位字符串）
4. 配置支付回调 URL

## API 接口

### 用户端接口

#### 获取可用支付方式

```http
GET /api/users/payment-providers
Authorization: Bearer <user_token>
```

响应：

```json
{
  "providers": ["manual", "alipay", "wechat"]
}
```

#### 创建充值订单

```http
POST /api/users/payment-orders
Authorization: Bearer <user_token>
Content-Type: application/json

{
  "amount": 10.00,
  "provider": "alipay"
}
```

响应：

```json
{
  "order": {
    "id": "po_abc123",
    "provider": "alipay",
    "status": "pending",
    "amount": 10.00,
    "paymentUrl": "https://qr.alipay.com/xxx",
    "expiresAt": 1234567890000,
    "createdAt": 1234567890000
  }
}
```

#### 查询充值订单列表

```http
GET /api/users/payment-orders?page=1&pageSize=20
Authorization: Bearer <user_token>
```

### 管理员接口

#### 查询所有订单

```http
GET /api/admin/payment-orders?status=pending&page=1&pageSize=100
Authorization: Bearer <admin_token>
```

#### 手动确认入账

```http
POST /api/admin/payment-orders/:id/confirm
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "providerOrderId": "optional_external_id",
  "note": "线下转账确认"
}
```

#### 取消订单

```http
POST /api/admin/payment-orders/:id/cancel
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "note": "用户取消"
}
```

### 支付回调接口（无需认证）

#### 支付宝回调

```http
POST /api/payment/callback/alipay
Content-Type: application/x-www-form-urlencoded

# 支付宝会发送表单数据，包含签名
```

#### 微信支付回调

```http
POST /api/payment/callback/wechat
Content-Type: application/xml

# 微信会发送 XML 数据，包含签名
```

## 前端集成

### 用户充值界面

**文件位置**：`web/src/views/UserOverviewView.vue`

**功能特性**：

1. 显示当前钱包余额
2. 充值金额输入
3. 支付方式选择（根据后端配置动态显示）
4. 支付宝/微信支付显示二维码
5. 支付状态实时刷新

**关键代码**：

```vue
<template>
  <n-modal v-model:show="showRecharge">
    <n-form-item label="充值金额（USD）">
      <n-input-number v-model:value="rechargeAmount" />
    </n-form-item>
    <n-form-item label="支付方式">
      <n-radio-group v-model:value="selectedProvider">
        <n-radio value="manual">线下转账</n-radio>
        <n-radio value="alipay">支付宝</n-radio>
        <n-radio value="wechat">微信支付</n-radio>
      </n-radio-group>
    </n-form-item>
  </n-modal>

  <!-- 支付二维码弹窗 -->
  <n-modal v-model:show="showPaymentQr">
    <img :src="qrCodeUrl" alt="支付二维码" />
  </n-modal>
</template>
```

### 管理员订单管理

**文件位置**：`web/src/views/PaymentOrdersView.vue`

**功能特性**：

1. 订单列表展示（用户信息、金额、状态、时间）
2. 状态筛选（pending/paid/canceled/expired）
3. 手动确认入账（仅 pending 状态）
4. 取消订单

## 安全考虑

### 1. 签名验证

- **支付宝**：使用 RSA2 签名算法验证回调数据
- **微信支付**：使用 MD5 签名算法验证回调数据
- 所有回调必须通过签名验证才能处理

### 2. 幂等性保证

- 订单状态检查：已支付的订单不会重复入账
- 数据库事务：确保钱包余额和订单状态一致性
- 回调重试：支付平台会多次重试，系统需要正确处理

### 3. 金额精度

- 使用 `micros`（微美元）存储金额，避免浮点数精度问题
- 1 USD = 1,000,000 micros
- 支付宝/微信使用人民币，需要汇率转换（默认 7.2）

### 4. 订单过期

- 订单创建后 30 分钟自动过期
- 查询订单列表时自动标记过期订单
- 过期订单不能支付或确认

## 测试指南

### 本地测试

1. **使用沙箱环境**：
   - 支付宝提供沙箱环境用于测试
   - 微信支付需要真实商户号

2. **回调测试**：
   - 使用 ngrok 或类似工具暴露本地服务
   - 配置回调 URL 为公网地址

3. **手动触发回调**：
   ```bash
   curl -X POST http://localhost:3000/api/payment/callback/alipay \
     -d "out_trade_no=po_xxx&trade_status=TRADE_SUCCESS&..."
   ```

### 生产部署

1. **配置 HTTPS**：支付回调必须使用 HTTPS
2. **配置域名**：回调 URL 必须是已备案的域名
3. **监控日志**：记录所有支付回调和异常
4. **定期对账**：比对系统订单和支付平台账单

## 故障排查

### 常见问题

1. **回调未收到**：
   - 检查回调 URL 是否可访问
   - 检查防火墙和安全组配置
   - 查看支付平台的回调日志

2. **签名验证失败**：
   - 检查密钥配置是否正确
   - 检查签名算法是否匹配
   - 注意密钥格式（PEM 格式需要包含头尾）

3. **订单状态不更新**：
   - 检查数据库事务是否提交
   - 查看应用日志中的错误信息
   - 手动查询支付平台订单状态

### 日志查看

```bash
# 查看支付相关日志
grep "payment" logs/app.log

# 查看回调日志
grep "callback" logs/app.log
```

## 扩展开发

### 添加新的支付方式

1. 在 `src/payments/providers/` 创建新的提供商文件
2. 实现 `PaymentProvider` 接口
3. 在 `src/payments/providers/index.ts` 注册提供商
4. 在 `src/config.ts` 添加配置项
5. 在 `.env.example` 添加配置说明
6. 在 `src/routes/payment-callback.ts` 添加回调路由

### 自定义汇率

修改 `src/payments/providers/alipay.ts` 和 `wechat.ts` 中的汇率转换逻辑：

```typescript
private usdToCny(usd: number): number {
  // 调用实时汇率 API
  return usd * getCurrentExchangeRate()
}
```

## 总结

支付集成已完成以下功能：

✅ 支付宝扫码支付  
✅ 微信扫码支付  
✅ 支付回调自动入账  
✅ 订单管理和查询  
✅ 前端支付界面  
✅ 签名验证和安全保护  
✅ 数据库事务保证一致性  
✅ 订单自动过期机制  

所有代码已通过类型检查，可以直接部署使用。
