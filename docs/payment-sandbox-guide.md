# 支付宝和微信支付沙盒测试完整指南

## 一、支付宝沙盒环境配置

### 1.1 注册支付宝开放平台账号

1. 访问 [支付宝开放平台](https://open.alipay.com/)
2. 使用支付宝账号登录
3. 完成实名认证（个人或企业）

### 1.2 进入沙盒环境

1. 登录后，点击顶部导航栏的 **"开发者中心"**
2. 在左侧菜单找到 **"研发服务"** → **"沙盒环境"**
3. 或直接访问：https://openhome.alipay.com/develop/sandbox/app

### 1.3 获取沙盒应用信息

沙盒环境会自动为你创建一个测试应用，你可以看到：

```
应用信息：
- APPID: 2021xxxxxxxxxxxxx（沙盒专用）
- 网关地址: https://openapi-sandbox.dl.alipaydev.com/gateway.do
- 支付宝公钥: MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
```

**重要**：沙盒环境的 APPID 和网关地址与生产环境不同！

### 1.4 生成应用密钥

#### 方法一：使用支付宝密钥生成工具（推荐）

1. 下载密钥生成工具：
   - Windows: https://ideservice.alipay.com/ide/getPluginUrl.htm?clientType=assistant&platform=win&channelType=WEB
   - Mac: https://ideservice.alipay.com/ide/getPluginUrl.htm?clientType=assistant&platform=mac&channelType=WEB

2. 打开工具，选择 **"生成密钥"**

3. 密钥长度选择 **2048**

4. 密钥格式选择 **PKCS1（非JAVA适用）**

5. 点击 **"生成密钥"**，会生成两个文件：
   - `应用私钥2048.txt` - 你的应用私钥（保密！）
   - `应用公钥2048.txt` - 你的应用公钥（需要上传）

#### 方法二：使用 OpenSSL 命令行

```bash
# 生成私钥
openssl genrsa -out app_private_key.pem 2048

# 从私钥生成公钥
openssl rsa -in app_private_key.pem -pubout -out app_public_key.pem

# 查看私钥（复制内容，去掉头尾）
cat app_private_key.pem

# 查看公钥（复制内容，去掉头尾）
cat app_public_key.pem
```

### 1.5 配置应用公钥

1. 在沙盒应用页面，找到 **"接口加签方式（密钥/证书）"** 部分
2. 点击 **"设置"** 或 **"修改"**
3. 选择 **"公钥"** 模式
4. 将 `应用公钥2048.txt` 的内容粘贴进去（**去掉头尾的 BEGIN/END 行**）
5. 点击 **"保存设置"**
6. 保存后，页面会显示 **"支付宝公钥"**，复制保存

### 1.6 获取沙盒买家账号

在沙盒应用页面下方，可以看到：

```
沙盒账号：
买家信息：
- 账号: xxxxxx@sandbox.com
- 登录密码: 111111
- 支付密码: 111111
- 用户名称: 沙箱环境

卖家信息：
- 账号: xxxxxx@sandbox.com
- 登录密码: 111111
```

### 1.7 配置 Model Bridge

在 `.env` 文件中添加：

```bash
# 支付宝沙盒配置
ALIPAY_APP_ID=2021xxxxxxxxxxxxx
ALIPAY_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...(你的应用私钥)...\n-----END RSA PRIVATE KEY-----
ALIPAY_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...(支付宝公钥)...\n-----END PUBLIC KEY-----
ALIPAY_NOTIFY_URL=https://your-domain.com/api/payment/callback/alipay
ALIPAY_RETURN_URL=https://your-domain.com/payment/return
```

**注意**：
- 私钥和公钥需要包含完整的 PEM 格式头尾
- 换行符用 `\n` 表示
- 或者直接使用多行字符串（不推荐在 .env 中）

### 1.8 修改网关地址（沙盒专用）

在 `src/payments/providers/alipay.ts` 中，临时修改网关地址：

```typescript
constructor(config: {
  appId: string
  privateKey: string
  alipayPublicKey: string
  gatewayUrl?: string
  notifyUrl: string
  returnUrl: string
}) {
  this.appId = config.appId
  this.privateKey = config.privateKey
  this.alipayPublicKey = config.alipayPublicKey
  // 沙盒环境使用沙盒网关
  this.gatewayUrl = config.gatewayUrl || 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
  this.notifyUrl = config.notifyUrl
  this.returnUrl = config.returnUrl
}
```

或在 `.env` 中添加：

```bash
ALIPAY_GATEWAY_URL=https://openapi-sandbox.dl.alipaydev.com/gateway.do
```

### 1.9 测试支付流程

#### 步骤 1：启动服务

```bash
npm run dev:all
```

#### 步骤 2：使用内网穿透工具

因为支付宝需要回调你的服务器，本地开发需要使用内网穿透：

**使用 ngrok**：

```bash
# 安装 ngrok
brew install ngrok  # Mac
# 或从 https://ngrok.com/download 下载

# 启动穿透
ngrok http 3000

# 会得到一个公网地址，例如：
# https://abc123.ngrok.io
```

**使用 localtunnel**：

```bash
# 安装
npm install -g localtunnel

# 启动
lt --port 3000

# 会得到一个公网地址
```

**使用 Cloudflare Tunnel**（推荐）：

```bash
# 安装
brew install cloudflare/cloudflare/cloudflared  # Mac

# 启动
cloudflared tunnel --url http://localhost:3000

# 会得到一个 trycloudflare.com 域名
```

#### 步骤 3：更新回调地址

将 `.env` 中的回调地址更新为公网地址：

```bash
ALIPAY_NOTIFY_URL=https://abc123.ngrok.io/api/payment/callback/alipay
ALIPAY_RETURN_URL=https://abc123.ngrok.io/payment/return
```

重启服务使配置生效。

#### 步骤 4：创建充值订单

1. 登录用户控制台
2. 点击 "充值" 按钮
3. 输入金额（例如 10 USD）
4. 选择 "支付宝" 支付方式
5. 点击 "创建订单"

#### 步骤 5：扫码支付

1. 系统会显示支付二维码
2. 使用 **支付宝沙盒版 APP** 扫码（不是正式版！）

**下载沙盒版 APP**：

- Android: 在沙盒页面扫描 "Android 版本" 二维码下载
- iOS: 在沙盒页面扫描 "iOS 版本" 二维码下载（需要 TestFlight）

3. 使用沙盒买家账号登录 APP
4. 扫描二维码，输入支付密码（111111）
5. 完成支付

#### 步骤 6：验证回调

支付成功后，支付宝会向你的回调地址发送通知：

```bash
# 查看服务器日志
tail -f logs/app.log | grep "alipay"

# 应该看到类似的日志：
# [info] Alipay callback received: {...}
# [info] Payment order po_xxx confirmed
```

#### 步骤 7：检查订单状态

1. 刷新用户控制台
2. 查看钱包余额是否增加
3. 查看充值订单状态是否变为 "paid"

---

## 二、微信支付沙盒环境配置

### 2.1 注意事项

**重要**：微信支付的沙盒环境配置比支付宝复杂，且有以下限制：

1. **需要已开通微信支付的商户号**（个人无法申请）
2. 沙盒环境仅用于验证签名和接口调用，**不能真实扣款**
3. 沙盒环境的密钥与生产环境不同

### 2.2 申请微信支付商户号

如果你还没有商户号：

1. 访问 [微信支付商户平台](https://pay.weixin.qq.com/)
2. 点击 "注册微信支付商户号"
3. 选择主体类型：
   - **企业**：需要营业执照、对公账户
   - **个体工商户**：需要营业执照
   - **个人**：目前不支持

4. 提交资料，等待审核（通常 1-7 个工作日）
5. 审核通过后，签署协议，完成开户

### 2.3 获取商户号信息

登录 [微信支付商户平台](https://pay.weixin.qq.com/)：

1. 在首页可以看到 **商户号（mch_id）**，例如：`1234567890`
2. 记录下来，后续配置需要

### 2.4 申请沙盒密钥

#### 方法一：通过商户平台申请

1. 登录商户平台
2. 进入 **"账户中心"** → **"API安全"** → **"沙箱验收"**
3. 点击 **"获取沙箱密钥"**
4. 系统会生成一个 32 位的沙盒密钥

#### 方法二：通过 API 获取

```bash
# 使用你的生产环境密钥调用接口
curl -X POST https://api.mch.weixin.qq.com/sandboxnew/pay/getsignkey \
  -H "Content-Type: application/xml" \
  -d '<xml>
    <mch_id>你的商户号</mch_id>
    <nonce_str>随机字符串</nonce_str>
    <sign>签名</sign>
  </xml>'

# 返回沙盒密钥
```

### 2.5 配置 Model Bridge

在 `.env` 文件中添加：

```bash
# 微信支付沙盒配置
WECHAT_APP_ID=你的AppID
WECHAT_MCH_ID=你的商户号
WECHAT_API_KEY=沙盒密钥（32位）
WECHAT_NOTIFY_URL=https://your-domain.com/api/payment/callback/wechat
```

**获取 AppID**：

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 在 "开发" → "基本配置" 中查看 AppID
3. 或者使用微信开放平台的 AppID

### 2.6 修改 API 地址（沙盒专用）

在 `src/payments/providers/wechat.ts` 中，临时修改 API 地址：

```typescript
export class WechatPayProvider implements PaymentProvider {
  private readonly appId: string
  private readonly mchId: string
  private readonly apiKey: string
  private readonly notifyUrl: string
  // 沙盒环境使用沙盒 API
  private readonly apiUrl = 'https://api.mch.weixin.qq.com/sandboxnew'

  // ... 其他代码
}
```

### 2.7 测试支付流程

#### 步骤 1：启动服务和内网穿透

```bash
# 启动服务
npm run dev:all

# 启动内网穿透（同支付宝）
ngrok http 3000
```

#### 步骤 2：更新回调地址

```bash
WECHAT_NOTIFY_URL=https://abc123.ngrok.io/api/payment/callback/wechat
```

#### 步骤 3：创建充值订单

1. 登录用户控制台
2. 选择 "微信支付" 方式
3. 创建订单，获取二维码

#### 步骤 4：使用微信扫码

**沙盒环境特殊说明**：

微信支付沙盒环境的二维码可以用正式版微信扫描，但：

1. 扫码后会提示 "沙盒支付"
2. 输入任意金额都会提示支付成功
3. **不会真实扣款**
4. 回调会正常触发

#### 步骤 5：验证回调

```bash
# 查看日志
tail -f logs/app.log | grep "wechat"

# 应该看到：
# [info] WeChat Pay callback received: {...}
# [info] Payment order po_xxx confirmed
```

---

## 三、本地测试的替代方案

如果你无法申请商户号或配置沙盒环境，可以使用以下方法测试：

### 3.1 模拟支付回调

创建测试脚本 `scripts/test-payment-callback.sh`：

```bash
#!/bin/bash

# 测试支付宝回调
curl -X POST http://localhost:3000/api/payment/callback/alipay \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "out_trade_no=po_test123&trade_no=2024010122001234567890&trade_status=TRADE_SUCCESS&total_amount=10.00&gmt_payment=2024-01-01 12:00:00&sign=mock_signature&sign_type=RSA2"

# 测试微信支付回调
curl -X POST http://localhost:3000/api/payment/callback/wechat \
  -H "Content-Type: application/xml" \
  -d '<xml>
    <return_code><![CDATA[SUCCESS]]></return_code>
    <result_code><![CDATA[SUCCESS]]></result_code>
    <out_trade_no><![CDATA[po_test123]]></out_trade_no>
    <transaction_id><![CDATA[4200001234567890]]></transaction_id>
    <total_fee>1000</total_fee>
    <time_end><![CDATA[20240101120000]]></time_end>
    <sign><![CDATA[mock_signature]]></sign>
  </xml>'
```

**注意**：这种方法会因为签名验证失败而报错，需要临时禁用签名验证。

### 3.2 临时禁用签名验证（仅用于开发测试）

在 `src/payments/providers/alipay.ts` 和 `wechat.ts` 中：

```typescript
async verifyNotification(data: Record<string, unknown>): Promise<PaymentNotification> {
  // 开发环境跳过签名验证
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_PAYMENT_SIGNATURE === 'true') {
    console.warn('[DEV] Skipping payment signature verification')
  } else {
    // 正常的签名验证逻辑
    if (!this.verify(params, sign)) {
      throw new Error('Signature verification failed')
    }
  }
  
  // ... 其他逻辑
}
```

在 `.env` 中添加：

```bash
NODE_ENV=development
SKIP_PAYMENT_SIGNATURE=true
```

**警告**：生产环境必须删除此配置！

### 3.3 使用 Postman 测试

1. 导入 API 集合
2. 创建充值订单请求
3. 手动调用回调接口
4. 验证订单状态变化

---

## 四、常见问题排查

### 4.1 支付宝签名验证失败

**问题**：回调时提示 "Signature verification failed"

**解决方案**：

1. 检查应用私钥格式：
   ```bash
   # 私钥应该是这样的格式
   -----BEGIN RSA PRIVATE KEY-----
   MIIEpAIBAAKCAQEA...
   ...
   -----END RSA PRIVATE KEY-----
   ```

2. 检查支付宝公钥是否正确：
   - 在沙盒页面重新复制支付宝公钥
   - 确保包含完整的头尾

3. 检查签名类型：
   - 必须使用 RSA2（SHA256）
   - 不要使用旧的 RSA（SHA1）

4. 调试签名：
   ```typescript
   // 在 verify 方法中添加日志
   private verify(params: Record<string, unknown>, signature: string): boolean {
     const sortedParams = Object.keys(params)
       .sort()
       .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
       .map((key) => `${key}=${params[key]}`)
       .join('&')
     
     console.log('[DEBUG] Verify string:', sortedParams)
     console.log('[DEBUG] Signature:', signature)
     
     const verify = createVerify('RSA-SHA256')
     verify.update(sortedParams, 'utf-8')
     const result = verify.verify(this.alipayPublicKey, signature, 'base64')
     
     console.log('[DEBUG] Verify result:', result)
     return result
   }
   ```

### 4.2 微信支付签名验证失败

**问题**：回调时提示 "WeChat Pay signature verification failed"

**解决方案**：

1. 检查 API 密钥长度：
   ```bash
   # 必须是 32 位字符串
   echo -n "your_api_key" | wc -c
   # 应该输出 32
   ```

2. 检查签名算法：
   - 微信支付使用 MD5
   - 签名字符串最后要拼接 `&key=你的API密钥`

3. 调试签名：
   ```typescript
   private verifySign(data: Record<string, unknown>): boolean {
     const receivedSign = data.sign as string
     const params = { ...data }
     delete params.sign
     
     const sortedParams = Object.keys(params)
       .sort()
       .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
       .map((key) => `${key}=${params[key]}`)
       .join('&')
     
     const stringSignTemp = `${sortedParams}&key=${this.apiKey}`
     console.log('[DEBUG] Sign string:', stringSignTemp)
     
     const calculatedSign = createHash('md5').update(stringSignTemp, 'utf-8').digest('hex').toUpperCase()
     console.log('[DEBUG] Calculated sign:', calculatedSign)
     console.log('[DEBUG] Received sign:', receivedSign)
     
     return receivedSign === calculatedSign
   }
   ```

### 4.3 回调地址无法访问

**问题**：支付成功但没有收到回调

**解决方案**：

1. 检查内网穿透是否正常：
   ```bash
   # 测试公网地址是否可访问
   curl https://abc123.ngrok.io/health
   ```

2. 检查防火墙：
   - 确保 3000 端口开放
   - 检查云服务器安全组配置

3. 检查回调 URL 格式：
   - 必须是 HTTPS（生产环境）
   - 沙盒环境可以使用 HTTP
   - 不能有端口号（使用标准 443 端口）

4. 查看支付平台的回调日志：
   - 支付宝：在沙盒页面查看 "接口调试" 日志
   - 微信：在商户平台查看 "交易中心" → "交易记录"

### 4.4 订单金额不匹配

**问题**：支付金额与订单金额不一致

**解决方案**：

1. 检查汇率转换：
   ```typescript
   // 确保汇率正确
   private usdToCny(usd: number): number {
     return usd * 7.2  // 根据实际汇率调整
   }
   ```

2. 检查金额单位：
   - 支付宝：元（保留两位小数）
   - 微信：分（整数）
   - Model Bridge：micros（微美元）

3. 检查精度：
   ```typescript
   // 微信支付金额转换
   const totalFee = Math.round(amountCny * 100)  // 元转分，四舍五入
   ```

---

## 五、生产环境部署

### 5.1 切换到生产环境

1. 修改网关地址：
   ```typescript
   // 支付宝
   this.gatewayUrl = 'https://openapi.alipay.com/gateway.do'
   
   // 微信支付
   private readonly apiUrl = 'https://api.mch.weixin.qq.com'
   ```

2. 使用生产环境密钥：
   - 支付宝：在正式应用中配置
   - 微信：使用生产环境 API 密钥

3. 配置 HTTPS：
   - 申请 SSL 证书
   - 配置 Nginx 反向代理

4. 配置域名：
   - 回调 URL 必须使用已备案的域名
   - 在支付平台配置授权域名

### 5.2 安全检查清单

- [ ] 删除所有 `SKIP_PAYMENT_SIGNATURE` 配置
- [ ] 删除所有调试日志（避免泄露敏感信息）
- [ ] 使用环境变量存储密钥（不要硬编码）
- [ ] 启用 HTTPS
- [ ] 配置 CORS 白名单
- [ ] 启用请求日志（但不记录敏感字段）
- [ ] 配置监控和告警
- [ ] 定期对账

### 5.3 监控和日志

```typescript
// 在回调处理中添加监控
app.post('/api/payment/callback/alipay', async (request, reply) => {
  const startTime = Date.now()
  
  try {
    const data = request.body as Record<string, unknown>
    
    // 记录回调（脱敏）
    app.log.info({
      type: 'payment_callback',
      provider: 'alipay',
      orderId: data.out_trade_no,
      tradeNo: data.trade_no,
      status: data.trade_status,
    })
    
    const result = await handlePaymentNotification({
      provider: 'alipay',
      data,
    })
    
    // 记录成功
    app.log.info({
      type: 'payment_success',
      provider: 'alipay',
      orderId: result.orderId,
      duration: Date.now() - startTime,
    })
    
    return reply.type('text/plain').send('success')
  } catch (err) {
    // 记录失败
    app.log.error({
      type: 'payment_error',
      provider: 'alipay',
      error: (err as Error).message,
      duration: Date.now() - startTime,
    })
    
    return reply.code(400).type('text/plain').send('fail')
  }
})
```

---

## 六、测试检查清单

### 支付宝测试

- [ ] 沙盒应用创建成功
- [ ] 应用密钥配置正确
- [ ] 支付宝公钥获取正确
- [ ] 内网穿透正常工作
- [ ] 回调地址配置正确
- [ ] 沙盒 APP 下载并登录
- [ ] 创建订单成功
- [ ] 二维码生成正常
- [ ] 扫码支付成功
- [ ] 回调接收成功
- [ ] 签名验证通过
- [ ] 订单状态更新
- [ ] 钱包余额增加

### 微信支付测试

- [ ] 商户号申请成功
- [ ] 沙盒密钥获取成功
- [ ] AppID 配置正确
- [ ] 内网穿透正常工作
- [ ] 回调地址配置正确
- [ ] 创建订单成功
- [ ] 二维码生成正常
- [ ] 扫码支付成功
- [ ] 回调接收成功
- [ ] 签名验证通过
- [ ] 订单状态更新
- [ ] 钱包余额增加

---

## 七、参考资料

### 官方文档

- [支付宝开放平台文档](https://opendocs.alipay.com/open)
- [支付宝当面付接口](https://opendocs.alipay.com/open/194/105072)
- [微信支付开发文档](https://pay.weixin.qq.com/wiki/doc/api/index.html)
- [微信支付 Native 支付](https://pay.weixin.qq.com/wiki/doc/api/native.php?chapter=6_1)

### 工具下载

- [支付宝密钥生成工具](https://opendocs.alipay.com/common/02kipl)
- [支付宝沙盒 APP](https://openhome.alipay.com/develop/sandbox/app)
- [ngrok](https://ngrok.com/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)

### 技术支持

- 支付宝技术支持：https://open.alipay.com/portal/forum
- 微信支付技术支持：https://kf.qq.com/product/wechatpaymentmerchant.html

---

完成以上步骤后，你就可以在本地环境完整测试支付宝和微信支付功能了！
