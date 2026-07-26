# Model Bridge 工具集

## 图片生成工具

### 前置条件

1. **启动后端服务**
   ```bash
   npm run dev
   # 或生产环境
   npm start
   ```

2. **创建 API Key**
   - 访问管理后台：http://localhost:3000
   - 登录（默认 admin/admin）
   - 进入「API Keys」页面创建一个 Key
   - 复制 Key（格式类似 `mb-xxxxx`）

3. **添加 OpenAI OAuth 账户**
   - 在管理后台「账户」页面
   - 添加 OpenAI 账户（通过浏览器 OAuth 登录）
   - 确保账户有图片生成权限

4. **设置环境变量**
   ```bash
   # Windows PowerShell
   $env:MODEL_BRIDGE_API_KEY="mb-your-api-key-here"

   # Windows CMD
   set MODEL_BRIDGE_API_KEY=mb-your-api-key-here

   # Linux/macOS
   export MODEL_BRIDGE_API_KEY="mb-your-api-key-here"
   ```

### 使用方法

#### 1. 单个图片生成

```bash
# 使用默认提示词
node tools/test-image-gen.js

# 使用自定义提示词
node tools/test-image-gen.js "A beautiful sunset over mountains"
```

**输出示例：**
```
📸 开始生成图片...
提示词: A beautiful sunset over mountains

✅ 图片生成成功！

📊 使用统计:
  - 输入 tokens: 12
  - 输出 tokens: 2459
  - 图片数量: 1

💾 已保存: E:\Projects\model-bridge\output\image_2026-07-26T16-30-45_1.png

🎉 完成！
```

#### 2. 批量图片生成

```bash
# 使用示例文件
node tools/batch-image-gen.js tools/prompts-example.txt

# 使用自己的提示词文件
node tools/batch-image-gen.js my-prompts.txt
```

**prompts.txt 格式：**
```
A red apple on a wooden table
A blue car driving on a highway
A sunset over the ocean
# 这是注释，会被忽略
```

**输出示例：**
```
📋 共 7 个任务
⚙️  并发数: 3
⏱️  延迟: 1000ms

[1/7] 处理中: A small orange cat sitting on a blue cushion...
[2/7] 处理中: A red sports car on a mountain road at sunset...
[3/7] 处理中: A futuristic city skyline with flying cars...
  ✅ 成功: batch_2026-07-26T16-35-20_001.png
  ✅ 成功: batch_2026-07-26T16-35-21_002.png
  ✅ 成功: batch_2026-07-26T16-35-22_003.png
...

═══════════════════════════════════════════
📊 批量处理完成
  成功: 7 / 7
  失败: 0 / 7
  输出目录: E:\Projects\model-bridge\output
═══════════════════════════════════════════
```

### 输出文件

所有生成的图片保存在 `output/` 目录：

```
output/
├── image_2026-07-26T16-30-45_1.png      # 单个生成
├── batch_2026-07-26T16-35-20_001.png    # 批量生成
├── batch_2026-07-26T16-35-20_001.json   # 元数据
├── batch_2026-07-26T16-35-21_002.png
├── batch_2026-07-26T16-35-21_002.json
└── failed.txt                            # 失败记录（如果有）
```

### 配置调整

#### 修改并发数和延迟

编辑 `tools/batch-image-gen.js`：

```javascript
const CONCURRENT_LIMIT = 3;  // 同时处理 3 个请求
const DELAY_MS = 1000;       // 批次间等待 1 秒
```

#### 修改图片参数

编辑工具脚本中的 `requestBody`：

```javascript
const requestBody = {
  model: 'gpt-image-2',           // 模型
  prompt: prompt,                 // 提示词
  n: 1,                          // 生成数量（1-10）
  size: '1024x1024',             // 尺寸
  quality: 'standard',           // 质量：standard 或 high
  response_format: 'b64_json'    // 响应格式
};
```

**支持的尺寸（gpt-image-2）：**
- 宽高必须是 16 的倍数
- 最长边 ≤ 3840
- 最短边 ≥ 810
- 宽高比 ≤ 3:1
- 像素总数：655,360 ~ 8,294,400

常用尺寸：
- `1024x1024`（正方形）
- `1536x1024`（横向）
- `1024x1536`（纵向）
- `1792x1024`（宽屏）

### 常见问题

#### 1. "fetch is not defined"

需要 Node.js 18+ 或安装 node-fetch：

```bash
npm install node-fetch@2
```

然后在脚本顶部添加：
```javascript
const fetch = require('node-fetch');
```

#### 2. "HTTP 401: Unauthorized"

API Key 未设置或无效：

```bash
# 检查环境变量
echo $env:MODEL_BRIDGE_API_KEY  # PowerShell
echo %MODEL_BRIDGE_API_KEY%     # CMD

# 重新设置
$env:MODEL_BRIDGE_API_KEY="mb-correct-key-here"
```

#### 3. "HTTP 503: No available account"

- 检查是否已添加 OpenAI OAuth 账户
- 确认账户状态正常（未暂停、未超配额）
- 确认 `.env` 中 `OPENAI_IMAGE_GENERATION_ENABLED=true`

#### 4. PowerShell 不显示输出

```powershell
# 方法 1：使用 cmd
cmd /c "node tools/test-image-gen.js"

# 方法 2：重定向到文件查看
node tools/test-image-gen.js 2>&1 | Tee-Object -FilePath log.txt

# 方法 3：使用 Windows Terminal（推荐）
# 下载安装：https://aka.ms/terminal
```

### 高级用法

#### 使用流式响应

修改请求体添加 `stream: true`：

```javascript
const requestBody = {
  // ...
  stream: true
};
```

流式模式会收到以下事件：
- `image_generation.partial_image` - 部分图片（如果启用）
- `image_generation.completed` - 完成的图片

#### 编辑现有图片

使用 `/v1/images/edits` 端点：

```javascript
const formData = new FormData();
formData.append('prompt', 'Replace the sky with sunset');
formData.append('image', new Blob([fs.readFileSync('input.png')], { type: 'image/png' }), 'input.png');
formData.append('mask', new Blob([fs.readFileSync('mask.png')], { type: 'image/png' }), 'mask.png'); // 可选
formData.append('size', '1024x1024');

const response = await fetch(`${API_BASE}/v1/images/edits`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${API_KEY}` },
  body: formData
});
```

## 技术说明

### OpenAI 图片生成桥接

本项目通过 OpenAI OAuth 账户调用图片生成 API，**不需要** OpenAI API Key。

工作原理：
1. 用户通过浏览器 OAuth 登录 OpenAI 账户
2. 系统加密保存 access token
3. 图片生成请求通过 `/v1/responses` 端点调用 `image_generation` 工具
4. 自动转换为标准 OpenAI Images API 格式

### 端点对应

| 标准 API | 内部实现 |
|---------|---------|
| `POST /v1/images/generations` | OpenAI Responses + image_generation tool |
| `POST /v1/images/edits` | OpenAI Responses + image_generation tool (action: edit) |

### 计费

图片生成会计入用量统计：
- `imageCount`: 生成的图片数量
- `imageOutputTokens`: 图片相关的 token 消耗
- `imageSize`: 图片尺寸
- `imageModel`: 使用的模型（如 gpt-image-2）

在管理后台的「用量统计」可查看详细数据。
