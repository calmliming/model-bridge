<script setup lang="ts">
import { ref } from 'vue'
import { UiButton, UiModal, UiSpace } from './ui'
import { useMessage } from '../composables/useMessage'
import { api, errMsg } from '../api/client'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  imported: []
}>()

const message = useMessage()

const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const importing = ref(false)
const importResult = ref<{
  total: number
  successCount: number
  failureCount: number
  results: Array<{
    name: string
    provider: string
    success: boolean
    id?: string
    error?: string
  }>
} | null>(null)

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    selectedFile.value = file
    importResult.value = null
  }
}

function triggerFileInput() {
  fileInputRef.value?.click()
}

async function handleImport() {
  if (!selectedFile.value) {
    message.warning('请先选择要导入的 JSON 文件')
    return
  }

  importing.value = true
  importResult.value = null

  try {
    const text = await selectedFile.value.text()
    let jsonData: unknown

    try {
      jsonData = JSON.parse(text)
    } catch {
      // Try parsing concatenated JSON objects (e.g. multiple Codex sessions in one file)
      try {
        const objects: unknown[] = []
        // Split on }{ boundary between concatenated JSON objects
        const parts = text.replace(/\}\s*\{/g, '}|||{').split('|||')
        for (const part of parts) {
          objects.push(JSON.parse(part.trim()))
        }
        jsonData = { accounts: objects }
      } catch {
        message.error('JSON 格式解析失败，请检查文件格式')
        return
      }
    }

    // Normalize: if it's a single Codex object, wrap it
    if (jsonData && typeof jsonData === 'object' && 'type' in (jsonData as any) && (jsonData as any).type === 'codex') {
      jsonData = { accounts: [jsonData] }
    }

    // Normalize: if it's a plain array, wrap it
    if (Array.isArray(jsonData)) {
      jsonData = { accounts: jsonData }
    }

    // Validate basic structure
    if (!jsonData || typeof jsonData !== 'object' || !Array.isArray((jsonData as any).accounts)) {
      message.error('无效的导入格式：需要包含 accounts 数组')
      return
    }

    const { data } = await api.post('/admin/accounts/import/batch', jsonData)
    importResult.value = data

    if (data.successCount > 0) {
      message.success(`成功导入 ${data.successCount} 个账号`)
      emit('imported')
    }

    if (data.failureCount > 0) {
      message.warning(`${data.failureCount} 个账号导入失败，请查看详情`)
    }
  } catch (e) {
    message.error(errMsg(e, '导入失败'))
  } finally {
    importing.value = false
  }
}

function handleClose() {
  if (!importing.value) {
    selectedFile.value = null
    importResult.value = null
    emit('update:show', false)
  }
}

function resetAndClose() {
  selectedFile.value = null
  importResult.value = null
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
  emit('update:show', false)
}
</script>

<template>
  <UiModal :show="props.show" title="批量导入账号" :width="680" @update:show="handleClose">
    <div class="import-modal-content">
      <div v-if="!importResult" class="import-form">
        <div class="import-hint">
          <p>支持两种导入格式：</p>

          <h4>1. Model-Bridge 标准格式</h4>
          <pre class="import-example">{
  "accounts": [
    {
      "provider": "claude",
      "name": "Claude Account 1",
      "accessToken": "sk-ant-xxx",
      "refreshToken": "optional",
      "expiresAt": 1234567890000,
      "weight": 10,
      "groupIds": ["group-id-1"]
    }
  ]
}</pre>

          <h4>2. Codex 会话格式（自动识别）</h4>
          <pre class="import-example">{
  "accounts": [
    {
      "type": "codex",
      "email": "user@example.com",
      "token_source": "ChatGPT_team",
      "access_token": "eyJhbGc...",
      "refresh_token": "rt.1.AABo...",
      "saved_at": "2026-06-08T12:40:35.717143+00:00"
    }
  ]
}</pre>

          <p class="import-note">
            <strong>Codex 格式说明：</strong><br>
            • 自动识别 <code>type: "codex"</code> 字段<br>
            • 使用 <code>email</code> 作为账号名称<br>
            • 自动从 JWT 解析过期时间<br>
            • 可选添加 <code>name</code>、<code>weight</code>、<code>groupIds</code> 字段
          </p>

          <p class="import-note">
            <strong>标准格式字段：</strong><br>
            • provider: claude | openai | gemini | deepseek | xiaomi<br>
            • name: 账号名称（必填）<br>
            • accessToken: 访问令牌（必填）<br>
            • refreshToken: 刷新令牌（可选）<br>
            • expiresAt: 过期时间戳，毫秒（可选）<br>
            • weight: 优先级 1-100（可选，默认 1）<br>
            • groupIds: 分组 ID 数组（可选）
          </p>
        </div>

        <div class="file-picker">
          <input
            ref="fileInputRef"
            type="file"
            accept=".json,application/json"
            style="display: none"
            @change="handleFileSelect"
          >
          <UiButton secondary @click="triggerFileInput">
            选择文件
          </UiButton>
          <span v-if="selectedFile" class="selected-file">
            {{ selectedFile.name }}
          </span>
        </div>
      </div>

      <div v-else class="import-result">
        <div class="result-summary">
          <div class="summary-item">
            <span class="summary-label">总数</span>
            <strong class="summary-value">{{ importResult.total }}</strong>
          </div>
          <div class="summary-item success">
            <span class="summary-label">成功</span>
            <strong class="summary-value">{{ importResult.successCount }}</strong>
          </div>
          <div class="summary-item error">
            <span class="summary-label">失败</span>
            <strong class="summary-value">{{ importResult.failureCount }}</strong>
          </div>
        </div>

        <div v-if="importResult.failureCount > 0" class="error-list">
          <h4>失败详情</h4>
          <div class="error-items">
            <div
              v-for="(item, index) in importResult.results.filter(r => !r.success)"
              :key="index"
              class="error-item"
            >
              <div class="error-item-header">
                <span class="error-item-name">{{ item.name }}</span>
                <span class="error-item-provider">{{ item.provider }}</span>
              </div>
              <div class="error-item-message">{{ item.error }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <UiSpace v-if="!importResult">
        <UiButton @click="handleClose">取消</UiButton>
        <UiButton
          type="primary"
          :loading="importing"
          :disabled="!selectedFile"
          @click="handleImport"
        >
          开始导入
        </UiButton>
      </UiSpace>
      <UiButton v-else type="primary" @click="resetAndClose">
        关闭
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.import-modal-content {
  padding: 4px 0;
}

.import-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.import-hint {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-color-2);
}

.import-example {
  background: var(--code-bg, #f5f5f5);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
  overflow-x: auto;
  color: var(--text-color-1);
}

.import-note {
  font-size: 13px;
  line-height: 1.8;
}

.file-picker {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--card-bg, #fafafa);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.selected-file {
  font-size: 14px;
  color: var(--text-color-2);
  font-weight: 500;
}

.import-result {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.result-summary {
  display: flex;
  gap: 16px;
  padding: 16px;
  background: var(--card-bg, #fafafa);
  border-radius: 6px;
}

.summary-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: white;
  border-radius: 4px;
  border: 1px solid var(--border-color);
}

.summary-item.success {
  border-color: #18a058;
  background: #f6ffed;
}

.summary-item.error {
  border-color: #d03050;
  background: #fff1f0;
}

.summary-label {
  font-size: 13px;
  color: var(--text-color-3);
}

.summary-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-color-1);
}

.summary-item.success .summary-value {
  color: #18a058;
}

.summary-item.error .summary-value {
  color: #d03050;
}

.error-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.error-list h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color-1);
}

.error-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
  padding: 2px;
}

.error-item {
  padding: 12px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  border-radius: 4px;
}

.error-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.error-item-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-color-1);
}

.error-item-provider {
  font-size: 12px;
  color: var(--text-color-3);
  padding: 2px 8px;
  background: white;
  border-radius: 3px;
}

.error-item-message {
  font-size: 13px;
  color: #cf1322;
  line-height: 1.5;
}
</style>
