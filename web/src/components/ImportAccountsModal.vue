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
const selectedFiles = ref<File[]>([])
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
  const files = target.files
  if (files && files.length > 0) {
    selectedFiles.value = Array.from(files)
    importResult.value = null
  }
}

function triggerFileInput() {
  fileInputRef.value?.click()
}

async function handleImport() {
  if (selectedFiles.value.length === 0) {
    message.warning('请先选择要导入的 JSON 文件')
    return
  }

  importing.value = true
  importResult.value = null

  try {
    const allAccounts: unknown[] = []

    for (const file of selectedFiles.value) {
      const text = await file.text()
      let parsed: unknown

      try {
        parsed = JSON.parse(text)
      } catch {
        // Try parsing concatenated JSON objects (e.g. multiple Codex sessions in one file)
        try {
          const parts = text.replace(/\}\s*\{/g, '}|||{').split('|||')
          for (const part of parts) {
            allAccounts.push(JSON.parse(part.trim()))
          }
          continue
        } catch {
          message.error(`文件 ${file.name} JSON 格式解析失败`)
          return
        }
      }

      // Single Codex object
      if (parsed && typeof parsed === 'object' && 'type' in (parsed as any) && (parsed as any).type === 'codex') {
        allAccounts.push(parsed)
        continue
      }

      // Array of accounts
      if (Array.isArray(parsed)) {
        allAccounts.push(...parsed)
        continue
      }

      // Standard format with accounts array
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).accounts)) {
        allAccounts.push(...(parsed as any).accounts)
        continue
      }

      // Unknown single object, try as account
      if (parsed && typeof parsed === 'object') {
        allAccounts.push(parsed)
      }
    }

    if (allAccounts.length === 0) {
      message.error('未找到可导入的账号数据')
      return
    }

    if (allAccounts.length > 100) {
      message.error(`共发现 ${allAccounts.length} 个账号，超过单次上限 100 个。请分批导入。`)
      return
    }

    const { data } = await api.post('/admin/accounts/import/batch', { accounts: allAccounts })
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
    selectedFiles.value = []
    importResult.value = null
    emit('update:show', false)
  }
}

function resetAndClose() {
  selectedFiles.value = []
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
          <p>支持两种导入格式（可一次选择多个文件）：</p>

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
      "concurrencyLimit": 2,
      "groupIds": ["group-id-1"],
      "notes": "团队号，晚高峰限并发"
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
            • 可选添加 <code>name</code>、<code>weight</code>、<code>concurrencyLimit</code>、<code>groupIds</code>、<code>notes</code> 字段
          </p>

          <p class="import-note">
            <strong>标准格式字段：</strong><br>
            • provider: claude | openai | gemini | deepseek | xiaomi | zhipu | qwen<br>
            • name: 账号名称（必填）<br>
            • accessToken: 访问令牌（必填）<br>
            • refreshToken: 刷新令牌（可选）<br>
            • expiresAt: 过期时间戳，毫秒（可选）<br>
            • weight: 优先级 1-100（可选，默认 1）<br>
            • concurrencyLimit: 账号级并发上限 1-1000（可选，留空不限）<br>
            • groupIds: 分组 ID 数组（可选）<br>
            • notes: 运维备注（可选）
          </p>
        </div>

        <div class="file-picker">
          <input
            ref="fileInputRef"
            type="file"
            accept=".json,application/json"
            multiple
            style="display: none"
            @change="handleFileSelect"
          >
          <UiButton secondary @click="triggerFileInput">
            选择文件
          </UiButton>
          <span v-if="selectedFiles.length > 0" class="selected-file">
            已选择 {{ selectedFiles.length }} 个文件
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

        <div class="result-list">
          <h4>导入明细</h4>
          <div class="result-items">
            <div
              v-for="(item, index) in importResult.results"
              :key="index"
              class="result-item"
              :class="item.success ? 'is-success' : 'is-error'"
            >
              <span class="result-item-icon">
                <svg v-if="item.success" class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                <svg v-else class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </span>
              <div class="result-item-body">
                <div class="result-item-header">
                  <span class="result-item-name">{{ item.name }}</span>
                  <span class="result-item-provider">{{ item.provider }}</span>
                </div>
                <div v-if="!item.success" class="result-item-message">{{ item.error }}</div>
              </div>
              <span class="result-item-status" :class="item.success ? 'ok' : 'fail'">
                {{ item.success ? '成功' : '失败' }}
              </span>
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
          :disabled="selectedFiles.length === 0"
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

.result-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.result-list h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color-1);
}

.result-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
  padding: 2px;
}

.result-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: white;
}

.result-item.is-success {
  border-color: #b7eb8f;
  background: #f6ffed;
}

.result-item.is-error {
  border-color: #ffccc7;
  background: #fff1f0;
}

.result-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-top: 1px;
}

.result-item.is-success .result-item-icon {
  color: #18a058;
}

.result-item.is-error .result-item-icon {
  color: #d03050;
}

.result-item-icon .icon {
  width: 16px;
  height: 16px;
  stroke-width: 2.5;
}

.result-item-body {
  flex: 1;
  min-width: 0;
}

.result-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.result-item-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-color-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-item-provider {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-color-3);
  padding: 2px 8px;
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 3px;
}

.result-item-message {
  margin-top: 4px;
  font-size: 13px;
  color: #cf1322;
  line-height: 1.5;
  word-break: break-word;
}

.result-item-status {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 3px;
}

.result-item-status.ok {
  color: #18a058;
  background: rgba(24, 160, 88, 0.12);
}

.result-item-status.fail {
  color: #d03050;
  background: rgba(208, 48, 80, 0.12);
}
</style>
