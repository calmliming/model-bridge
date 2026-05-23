<template>
  <div class="docs-page">
    <n-grid :cols="12" :x-gap="16" :y-gap="16" responsive="screen">
      <n-gi span="12 l:7">
        <n-card class="surface-card" title="使用流程" :bordered="false">
          <n-steps vertical :current="4" status="process">
            <n-step title="修改管理员密码" description="首次登录后进入设置，立即替换默认密码。" />
            <n-step title="添加上游账户" description="在上游账户页面接入 Claude、OpenAI 或 Gemini 账号。" />
            <n-step title="创建 API Key" description="在 API Keys 页面创建密钥，并按需设置服务商、限速、成本配额和过期时间。" />
            <n-step title="配置客户端" description="把客户端 base URL 指向 model-bridge，并使用后台生成的 API Key。" />
          </n-steps>
        </n-card>
      </n-gi>

      <n-gi span="12 l:5">
        <n-card class="surface-card" title="API Key" :bordered="false">
          <div class="doc-list">
            <div>
              <strong>密钥只显示一次</strong>
              <p>创建后立即复制保存，后台之后只展示 Key 前缀。</p>
            </div>
            <div>
              <strong>服务商限制</strong>
              <p>留空表示允许全部服务商；选择后只允许访问指定服务商。</p>
            </div>
            <div>
              <strong>成本配额</strong>
              <p>设置后达到配额会拒绝继续调用；留空表示不限。</p>
            </div>
          </div>
        </n-card>
      </n-gi>
    </n-grid>

    <n-card class="surface-card" title="客户端接入" :bordered="false">
      <n-tabs type="line" animated>
        <n-tab-pane name="claude" tab="Claude Code">
          <pre><code>export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_AUTH_TOKEN=mb-xxxxxxxx
claude</code></pre>
        </n-tab-pane>
        <n-tab-pane name="codex" tab="Codex CLI">
          <pre><code># ~/.codex/config.toml
[profiles.model-bridge]
model_provider = "model-bridge"
model = "gpt-5.4"

[model_providers.model-bridge]
name = "model-bridge"
base_url = "http://localhost:3000/v1"
env_key = "MODEL_BRIDGE_API_KEY"
wire_api = "responses"
requires_openai_auth = false

export MODEL_BRIDGE_API_KEY=mb-xxxxxxxx
codex --profile model-bridge</code></pre>
          <p class="doc-note">Codex 的 base URL 填到 `/v1`，客户端会自动请求 `/v1/responses`。</p>
        </n-tab-pane>
        <n-tab-pane name="cherry" tab="Cherry Studio">
          <div class="endpoint-list">
            <div>
              <span>Anthropic</span>
              <code>http://localhost:3000</code>
            </div>
            <div>
              <span>Gemini</span>
              <code>http://localhost:3000</code>
            </div>
          </div>
          <p class="doc-note">API Key 填后台生成的 `mb-...` 密钥。</p>
        </n-tab-pane>
      </n-tabs>
    </n-card>

    <n-grid :cols="2" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <n-gi span="2 m:1">
        <n-card class="surface-card" title="上游账户" :bordered="false">
          <div class="doc-list">
            <div>
              <strong>Claude</strong>
              <p>生成授权链接后，复制页面返回的 code，粘贴回后台完成授权。</p>
            </div>
            <div>
              <strong>OpenAI / Gemini</strong>
              <p>浏览器回调到本机 `localhost:1455` 后，回到后台刷新检测账户。</p>
            </div>
          </div>
        </n-card>
      </n-gi>

      <n-gi span="2 m:1">
        <n-card class="surface-card" title="远程部署" :bordered="false">
          <p class="doc-text">
            如果后台部署在 VPS、NAS 或家庭服务器，OAuth 回调里的 `localhost:1455`
            指的是浏览器所在电脑。远程添加 OpenAI / Gemini 账户时，先建立 SSH 隧道：
          </p>
          <pre><code>ssh -L 1455:127.0.0.1:1455 your-server</code></pre>
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>

<style scoped>
.docs-page {
  display: grid;
  gap: 16px;
}

.doc-list {
  display: grid;
  gap: 14px;
}

.doc-list strong,
.endpoint-list span {
  display: block;
  color: #0f172a;
  font-size: 14px;
}

.doc-list p,
.doc-note,
.doc-text {
  margin: 6px 0 0;
  color: rgba(15, 23, 42, 0.58);
  font-size: 13px;
  line-height: 1.75;
}

pre {
  margin: 0;
  overflow-x: auto;
  padding: 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 14px;
  background: #0f172a;
}

pre code {
  padding: 0;
  color: #e2e8f0;
  background: transparent;
  font-size: 13px;
  line-height: 1.65;
}

.endpoint-list {
  display: grid;
  gap: 12px;
}

.endpoint-list div {
  display: grid;
  gap: 6px;
}

.endpoint-list code {
  width: fit-content;
}
</style>
