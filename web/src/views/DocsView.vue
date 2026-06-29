<script setup lang="ts">
import { computed } from 'vue'

const baseOrigin = computed(() => {
  if (typeof window === 'undefined') return 'http://localhost:3000'
  return window.location.origin
})

const isSecureContext = computed(() => {
  if (typeof window === 'undefined') return true
  return window.isSecureContext
})
</script>

<template>
  <div class="grid gap-4">
    <UiGrid :cols="12" :x-gap="16" :y-gap="16" responsive="screen">
      <UiGi span="12 l:7">
        <UiCard title="使用流程">
          <UiSteps vertical :current="4">
            <UiStep title="修改管理员密码" description="首次登录后进入设置，立即替换默认密码。" />
            <UiStep title="添加上游账户" description="在上游账户页面接入 Claude、OpenAI、Gemini、DeepSeek、Xiaomi MiMo 或 Zhipu GLM。" />
            <UiStep title="创建 API Key" description="在 API Keys 页面创建密钥，并按需设置服务商、分组、限速、并发、成本配额和过期时间。" />
            <UiStep title="配置客户端" description="把客户端 base URL 指向 model-bridge，并使用后台生成的 API Key。" />
          </UiSteps>
        </UiCard>
      </UiGi>

      <UiGi span="12 l:5">
        <UiCard title="API Key">
          <div class="grid gap-3.5">
            <div>
              <strong class="block text-sm text-gray-900 dark:text-white">密钥只显示一次</strong>
              <p class="doc-p">创建后立即复制保存，后台之后只展示 Key 前缀。</p>
            </div>
            <div v-if="!isSecureContext">
              <strong class="block text-sm text-gray-900 dark:text-white">HTTP 访问下的复制</strong>
              <p class="doc-p">
                当前页面不在 HTTPS / localhost，浏览器不允许自动写入剪贴板。点击复制时若失败，
                后台会弹出一个文本框，请在框内手动选中并复制。
              </p>
            </div>
            <div>
              <strong class="block text-sm text-gray-900 dark:text-white">服务商限制</strong>
              <p class="doc-p">留空表示允许全部服务商；选择后只允许访问指定服务商。</p>
            </div>
            <div>
              <strong class="block text-sm text-gray-900 dark:text-white">模型限制</strong>
              <p class="doc-p">留空表示允许全部模型；支持精确模型名和 <code class="code-inline">*</code> 通配符。</p>
            </div>
            <div>
              <strong class="block text-sm text-gray-900 dark:text-white">模型映射</strong>
              <p class="doc-p">按 <code class="code-inline">客户端模型=上游模型</code> 配置；留空表示不改写模型名。</p>
            </div>
            <div>
              <strong class="block text-sm text-gray-900 dark:text-white">账号分组</strong>
              <p class="doc-p">绑定后只调度该分组内账号；留空使用默认池。</p>
            </div>
            <div>
              <strong class="block text-sm text-gray-900 dark:text-white">并发上限</strong>
              <p class="doc-p">限制同一个 Key 的同时在途请求数；留空表示不限。</p>
            </div>
            <div>
              <strong class="block text-sm text-gray-900 dark:text-white">成本配额</strong>
              <p class="doc-p">设置后达到配额会拒绝继续调用；留空表示不限。</p>
            </div>
          </div>
        </UiCard>
      </UiGi>
    </UiGrid>

    <UiCard title="客户端接入">
      <UiTabs>
        <UiTabPane name="claude" tab="Claude Code">
          <pre class="code-block"><code>export ANTHROPIC_BASE_URL={{ baseOrigin }}
export ANTHROPIC_AUTH_TOKEN=mb-xxxxxxxx
claude</code></pre>
          <p class="doc-p mt-3">
            DeepSeek / Xiaomi MiMo / Zhipu GLM 的 Anthropic 兼容入口分别是
            <code class="code-inline">{{ baseOrigin }}/api/deepseek</code>、
            <code class="code-inline">{{ baseOrigin }}/api/xiaomi</code> 和
            <code class="code-inline">{{ baseOrigin }}/api/zhipu</code>。
          </p>
        </UiTabPane>
        <UiTabPane name="codex" tab="Codex CLI">
          <pre class="code-block"><code># ~/.codex/config.toml
[profiles.model-bridge]
model_provider = "model-bridge"
model = "gpt-5.5"

[model_providers.model-bridge]
name = "model-bridge"
base_url = "{{ baseOrigin }}/v1"
env_key = "MODEL_BRIDGE_API_KEY"
wire_api = "responses"
requires_openai_auth = false

export MODEL_BRIDGE_API_KEY=mb-xxxxxxxx
codex --profile model-bridge</code></pre>
          <p class="doc-p mt-3">Codex 的 base URL 填到 <code class="code-inline">/v1</code>，客户端会自动请求 <code class="code-inline">/v1/responses</code>。</p>
          <p class="doc-p mt-2">
            DeepSeek / Xiaomi MiMo / Zhipu GLM 专用入口分别使用
            <code class="code-inline">{{ baseOrigin }}/api/deepseek/v1</code>、
            <code class="code-inline">{{ baseOrigin }}/api/xiaomi/v1</code> 和
            <code class="code-inline">{{ baseOrigin }}/api/zhipu/v1</code>。
          </p>
        </UiTabPane>
        <UiTabPane name="cherry" tab="Cherry Studio">
          <div class="grid gap-3">
            <div class="grid gap-1.5">
              <span class="text-sm text-gray-900 dark:text-white">Anthropic</span>
              <code class="code-inline w-fit">{{ baseOrigin }}</code>
            </div>
            <div class="grid gap-1.5">
              <span class="text-sm text-gray-900 dark:text-white">Gemini</span>
              <code class="code-inline w-fit">{{ baseOrigin }}</code>
            </div>
            <div class="grid gap-1.5">
              <span class="text-sm text-gray-900 dark:text-white">OpenAI</span>
              <code class="code-inline w-fit">{{ baseOrigin }}/v1</code>
            </div>
            <div class="grid gap-1.5">
              <span class="text-sm text-gray-900 dark:text-white">DeepSeek (OpenAI)</span>
              <code class="code-inline w-fit">{{ baseOrigin }}/api/deepseek/v1</code>
            </div>
            <div class="grid gap-1.5">
              <span class="text-sm text-gray-900 dark:text-white">Xiaomi MiMo (OpenAI)</span>
              <code class="code-inline w-fit">{{ baseOrigin }}/api/xiaomi/v1</code>
            </div>
            <div class="grid gap-1.5">
              <span class="text-sm text-gray-900 dark:text-white">Zhipu GLM (OpenAI)</span>
              <code class="code-inline w-fit">{{ baseOrigin }}/api/zhipu/v1</code>
            </div>
          </div>
          <p class="doc-p mt-3">
            API Key 填后台生成的 <code class="code-inline">mb-...</code> 密钥；OpenAI 兼容客户端使用 Chat Completions，
            <code class="code-inline">/v1/models</code> 会按 Key 的服务商和模型限制返回列表。
          </p>
        </UiTabPane>
      </UiTabs>
    </UiCard>

    <UiGrid :cols="2" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <UiGi span="2 m:1">
        <UiCard title="上游账户">
          <div class="grid gap-3.5">
            <div>
              <strong class="block text-sm text-gray-900 dark:text-white">Claude</strong>
              <p class="doc-p">生成授权链接后，复制页面返回的 code，粘贴回后台完成授权。</p>
            </div>
            <div>
              <strong class="block text-sm text-gray-900 dark:text-white">OpenAI / Gemini</strong>
              <p class="doc-p">浏览器回调到本机 <code class="code-inline">localhost:1455</code> 后，回到后台刷新检测账户。</p>
            </div>
            <div>
              <strong class="block text-sm text-gray-900 dark:text-white">DeepSeek / Xiaomi MiMo / Zhipu GLM</strong>
              <p class="doc-p">直接导入 API key；它们都支持 Messages、Chat Completions 和 Responses 入口。</p>
            </div>
            <div>
              <strong class="block text-sm text-gray-900 dark:text-white">账号池</strong>
              <p class="doc-p">可设置优先级、分组、并发上限和配额自动停调；未分组账号属于默认池。</p>
            </div>
            <div>
              <strong class="block text-sm text-gray-900 dark:text-white">连通性测试</strong>
              <p class="doc-p">账户页可对单个账户手动测试连通性并刷新配额；不会自动循环消耗额度。</p>
            </div>
          </div>
        </UiCard>
      </UiGi>

      <UiGi span="2 m:1">
        <UiCard title="远程部署">
          <p class="doc-p">
            如果后台部署在 VPS、NAS 或家庭服务器，OAuth 回调里的 <code class="code-inline">localhost:1455</code>
            指的是浏览器所在电脑。可从地址栏复制完整回调 URL 粘贴回后台，也可以先建立 SSH 隧道：
          </p>
          <pre class="code-block mt-3"><code>ssh -L 1455:127.0.0.1:1455 your-server</code></pre>
          <p class="doc-p mt-3">已有凭据时可用直接导入 Token 或批量导入 JSON，跳过 OAuth 回调。</p>
        </UiCard>
      </UiGi>
    </UiGrid>
  </div>
</template>

<style scoped>
.doc-p {
  @apply mt-1.5 text-[13px] leading-relaxed text-gray-500 dark:text-dark-400;
}
</style>
