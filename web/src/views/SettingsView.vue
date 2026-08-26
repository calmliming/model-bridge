<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useMessage } from '../composables/useMessage'
import { useDialog } from '../composables/useDialog'
import { api, errMsg } from '../api/client'
import { useAuthStore } from '../stores/auth'

const message = useMessage()
const dialog = useDialog()
const auth = useAuthStore()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const saving = ref(false)

const registrationEnabled = ref(false)
const togglingRegistration = ref(false)
const turnstileEnabled = ref(false)
const turnstileConfigured = ref(false)
const securityHeadersEnabled = ref(false)

const quotaAutopausePercent = ref(100)
const autopauseInput = ref(100)
const savingAutopause = ref(false)
const autopauseDirty = computed(() => autopauseInput.value !== quotaAutopausePercent.value)

type OpenAiSchedulingStrategy = 'weighted_lru' | 'prefer_soonest_reset'
const openaiSchedulingStrategy = ref<OpenAiSchedulingStrategy>('weighted_lru')
const savingSchedulingStrategy = ref(false)
const schedulingStrategyOptions = [
  { label: '权重 + 最近最少使用（默认）', value: 'weighted_lru' },
  { label: '优先最快重置', value: 'prefer_soonest_reset' },
]

type UpdateTaskStatus = 'idle' | 'checking' | 'updating' | 'succeeded' | 'failed'
type TagType = 'default' | 'info' | 'success' | 'warning' | 'error' | 'primary'

interface UpdateCheck {
  currentCommit: string | null
  latestCommit: string | null
  currentVersion: string | null
  latestVersion: string | null
  hasUpdate: boolean
  branch: string
  remote: string
  dirty: boolean
  checkedAt: number
  updaterAvailable: boolean
  warning?: string
}

interface UpdateTask {
  operationId: string | null
  status: UpdateTaskStatus
  startedAt: number | null
  finishedAt: number | null
  logTail: string
  message?: string | null
  error?: string | null
  currentCommit?: string | null
  latestCommit?: string | null
  currentVersion?: string | null
  latestVersion?: string | null
  updaterAvailable?: boolean
  warning?: string
}

const updateCheck = ref<UpdateCheck | null>(null)
const checkingUpdates = ref(false)
const startingUpdate = ref(false)
const healthChecking = ref(false)
const updateTask = ref<UpdateTask>({
  operationId: null,
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  logTail: '',
})

let statusTimer: number | undefined
let statusInitialized = false

const updateBusy = computed(() => updateTask.value.status === 'checking' || updateTask.value.status === 'updating')

const versionState = computed<{ label: string; type: TagType }>(() => {
  const check = updateCheck.value
  if (!check) return { label: '未检查', type: 'default' }
  if (check.warning || check.updaterAvailable === false) return { label: '更新服务不可用', type: 'error' }
  if (check.dirty) return { label: '工作区有改动', type: 'warning' }
  if (check.hasUpdate) return { label: '有新版本', type: 'warning' }
  return { label: '已是最新', type: 'success' }
})

const taskState = computed<{ label: string; type: TagType }>(() => {
  switch (updateTask.value.status) {
    case 'checking':
      return { label: '检查中', type: 'info' }
    case 'updating':
      return { label: '更新中', type: 'warning' }
    case 'succeeded':
      return { label: '已完成', type: 'success' }
    case 'failed':
      return { label: '失败', type: 'error' }
    default:
      return { label: '空闲', type: 'default' }
  }
})

const updateActionDisabled = computed(() => {
  const check = updateCheck.value
  return (
    !check ||
    check.updaterAvailable === false ||
    check.dirty ||
    !check.hasUpdate ||
    updateBusy.value ||
    checkingUpdates.value
  )
})

onMounted(() => {
  void loadSettings()
  void refreshUpdateInfo()
  void loadUpdateStatus(false)
})

onUnmounted(() => {
  stopStatusPolling()
})

async function loadSettings() {
  try {
    const { data } = await api.get('/admin/settings')
    registrationEnabled.value = !!data.registrationEnabled
    turnstileEnabled.value = !!data.turnstileEnabled
    turnstileConfigured.value = !!data.turnstileConfigured
    securityHeadersEnabled.value = !!data.securityHeadersEnabled
    if (typeof data.quotaAutopausePercent === 'number') {
      quotaAutopausePercent.value = data.quotaAutopausePercent
      autopauseInput.value = data.quotaAutopausePercent
    }
    if (data.openaiSchedulingStrategy === 'weighted_lru' || data.openaiSchedulingStrategy === 'prefer_soonest_reset') {
      openaiSchedulingStrategy.value = data.openaiSchedulingStrategy
    }
  } catch (e) {
    message.error(errMsg(e, '加载设置失败'))
  }
}

async function saveAutopause() {
  const value = Math.max(1, Math.min(100, Math.trunc(autopauseInput.value)))
  savingAutopause.value = true
  try {
    const { data } = await api.patch('/admin/settings', { quotaAutopausePercent: value })
    quotaAutopausePercent.value = data.quotaAutopausePercent
    autopauseInput.value = data.quotaAutopausePercent
    message.success('已更新自动停调阈值')
  } catch (e) {
    message.error(errMsg(e, '保存失败'))
  } finally {
    savingAutopause.value = false
  }
}

async function saveSchedulingStrategy(value: OpenAiSchedulingStrategy) {
  const previous = openaiSchedulingStrategy.value
  openaiSchedulingStrategy.value = value
  savingSchedulingStrategy.value = true
  try {
    const { data } = await api.patch('/admin/settings', { openaiSchedulingStrategy: value })
    if (data.openaiSchedulingStrategy) openaiSchedulingStrategy.value = data.openaiSchedulingStrategy
    message.success('已更新 OpenAI 调度策略')
  } catch (e) {
    openaiSchedulingStrategy.value = previous
    message.error(errMsg(e, '保存失败'))
  } finally {
    savingSchedulingStrategy.value = false
  }
}

async function toggleRegistration(value: boolean) {
  togglingRegistration.value = true
  try {
    const { data } = await api.patch('/admin/settings', { registrationEnabled: value })
    registrationEnabled.value = !!data.registrationEnabled
    turnstileEnabled.value = !!data.turnstileEnabled
    turnstileConfigured.value = !!data.turnstileConfigured
    securityHeadersEnabled.value = !!data.securityHeadersEnabled
    message.success(value ? '已开放注册' : '已关闭注册')
  } catch (e) {
    registrationEnabled.value = !value
    message.error(errMsg(e, '操作失败'))
  } finally {
    togglingRegistration.value = false
  }
}

async function changePassword() {
  if (!currentPassword.value || !newPassword.value) {
    message.warning('请填写完整')
    return
  }
  if (newPassword.value.length < 6) {
    message.warning('新密码至少 6 位')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    message.warning('两次输入的新密码不一致')
    return
  }
  saving.value = true
  try {
    await api.post('/admin/change-password', {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    })
    message.success('密码已更新')
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (e) {
    message.error(errMsg(e, '修改失败'))
  } finally {
    saving.value = false
  }
}

function formatTime(value?: number | null): string {
  return value ? new Date(value).toLocaleString() : '-'
}

function formatVersion(version?: string | null): string {
  if (!version) return '-'
  return version.startsWith('v') ? version : `v${version}`
}

function stopStatusPolling() {
  if (statusTimer !== undefined) {
    window.clearInterval(statusTimer)
    statusTimer = undefined
  }
}

function ensureStatusPolling() {
  if (statusTimer !== undefined) return
  statusTimer = window.setInterval(() => {
    void loadUpdateStatus(true)
  }, 2500)
}

function applyUpdateTask(next: UpdateTask) {
  const previous = updateTask.value
  updateTask.value = {
    operationId: next.operationId ?? null,
    status: next.status ?? 'idle',
    startedAt: next.startedAt ?? null,
    finishedAt: next.finishedAt ?? null,
    logTail: next.logTail ?? '',
    message: next.message ?? null,
    error: next.error ?? null,
    currentCommit: next.currentCommit ?? null,
    latestCommit: next.latestCommit ?? null,
    currentVersion: next.currentVersion ?? null,
    latestVersion: next.latestVersion ?? null,
    updaterAvailable: next.updaterAvailable,
    warning: next.warning,
  }

  if (updateBusy.value) {
    ensureStatusPolling()
  } else {
    stopStatusPolling()
  }

  const shouldNotify = statusInitialized && !!updateTask.value.operationId
  statusInitialized = true

  if (shouldNotify && previous.status !== 'succeeded' && updateTask.value.status === 'succeeded') {
    message.success('系统更新完成，正在确认服务状态')
    void waitForHealth()
    void refreshUpdateInfo()
  }
  if (shouldNotify && previous.status !== 'failed' && updateTask.value.status === 'failed') {
    message.error(updateTask.value.error || '系统更新失败')
  }
}

async function refreshUpdateInfo(showToast = false) {
  checkingUpdates.value = true
  try {
    const { data } = await api.get('/admin/system/check-updates')
    updateCheck.value = data
    if (showToast) message.success('版本信息已刷新')
  } catch (e) {
    message.error(errMsg(e, '检查版本失败'))
  } finally {
    checkingUpdates.value = false
  }
}

async function loadUpdateStatus(silent = true) {
  try {
    const { data } = await api.get('/admin/system/update-status')
    applyUpdateTask(data)
  } catch (e) {
    if (!silent) message.error(errMsg(e, '加载更新状态失败'))
  }
}

async function waitForHealth() {
  if (healthChecking.value) return
  healthChecking.value = true
  const deadline = Date.now() + 60000
  try {
    while (Date.now() < deadline) {
      try {
        const res = await fetch('/health', { cache: 'no-store' })
        if (res.ok) {
          message.success('服务已恢复，可以刷新页面')
          return
        }
      } catch {
        // Service may be restarting.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000))
    }
    message.warning('更新已完成，服务恢复状态请稍后刷新确认')
  } finally {
    healthChecking.value = false
  }
}

async function startUpdate() {
  startingUpdate.value = true
  try {
    const { data } = await api.post('/admin/system/update')
    applyUpdateTask(data)
    message.success('更新任务已启动')
  } catch (e) {
    message.error(errMsg(e, '启动更新失败'))
  } finally {
    startingUpdate.value = false
  }
}

function confirmSystemUpdate() {
  const check = updateCheck.value
  if (!check?.hasUpdate || updateActionDisabled.value) return
  dialog.warning({
    title: '确认系统更新',
    content: `将从 ${check.remote}/${check.branch} 拉取最新代码，并重建重启 model-bridge 服务。`,
    positiveText: '立即更新',
    negativeText: '取消',
    onPositiveClick: startUpdate,
  })
}
</script>

<template>
  <div class="space-y-5">
    <UiCard id="system-update" class="max-w-3xl scroll-mt-6" title="系统更新">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <strong class="text-gray-900 dark:text-white">系统版本</strong>
          <p class="mt-1.5 text-[13px] text-gray-500 dark:text-dark-400">
            Docker Compose 部署可在这里检查并升级到远端 main。
          </p>
        </div>
        <UiTag :type="versionState.type">{{ versionState.label }}</UiTag>
      </div>

      <div class="update-version-grid mt-4">
        <div class="update-version-item">
          <span>当前版本</span>
          <strong>{{ formatVersion(updateCheck?.currentVersion) }}</strong>
          <small>{{ updateCheck?.currentCommit || '-' }}</small>
        </div>
        <div class="update-version-item">
          <span>最新版本</span>
          <strong>{{ formatVersion(updateCheck?.latestVersion) }}</strong>
          <small>{{ updateCheck?.latestCommit || '-' }}</small>
        </div>
        <div class="update-version-item">
          <span>远端分支</span>
          <strong>{{ updateCheck ? `${updateCheck.remote}/${updateCheck.branch}` : '-' }}</strong>
          <small>发布源</small>
        </div>
        <div class="update-version-item">
          <span>检查时间</span>
          <strong>{{ formatTime(updateCheck?.checkedAt) }}</strong>
          <small>按提交判断更新</small>
        </div>
      </div>

      <UiAlert v-if="updateCheck?.warning" class="mt-4" type="error">
        {{ updateCheck.warning }}
      </UiAlert>
      <UiAlert v-else-if="updateCheck?.dirty" class="mt-4" type="warning">
        生产目录存在 tracked 改动，已阻止自动更新。
      </UiAlert>

      <div class="mt-4 flex flex-wrap justify-end gap-3">
        <UiButton secondary :loading="checkingUpdates" @click="refreshUpdateInfo(true)">刷新</UiButton>
        <UiButton
          type="primary"
          :loading="startingUpdate || updateBusy"
          :disabled="updateActionDisabled"
          @click="confirmSystemUpdate"
        >
          立即更新
        </UiButton>
      </div>

      <div v-if="updateTask.operationId || updateTask.status !== 'idle'" class="update-task mt-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong class="text-gray-900 dark:text-white">更新任务</strong>
            <p class="mt-1 text-xs text-gray-500 dark:text-dark-400">
              {{ updateTask.operationId || '-' }}
            </p>
          </div>
          <UiTag :type="taskState.type">{{ taskState.label }}</UiTag>
        </div>
        <div class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <span class="text-gray-500 dark:text-dark-400">开始时间</span>
            <p class="mt-1 text-gray-900 dark:text-white">{{ formatTime(updateTask.startedAt) }}</p>
          </div>
          <div>
            <span class="text-gray-500 dark:text-dark-400">结束时间</span>
            <p class="mt-1 text-gray-900 dark:text-white">{{ formatTime(updateTask.finishedAt) }}</p>
          </div>
        </div>
        <UiAlert v-if="updateTask.error" class="mt-3" type="error">{{ updateTask.error }}</UiAlert>
        <pre v-if="updateTask.logTail" class="system-update-log mt-3">{{ updateTask.logTail }}</pre>
      </div>
    </UiCard>

    <UiCard class="max-w-xl" title="管理员账户">
      <UiForm label-placement="top" @submit="changePassword">
        <UiFormItem label="当前用户">
          <UiInput :value="auth.username ?? ''" readonly />
        </UiFormItem>
        <UiFormItem label="当前密码">
          <UiInput v-model:value="currentPassword" type="password" />
        </UiFormItem>
        <UiFormItem label="新密码">
          <UiInput v-model:value="newPassword" type="password" />
        </UiFormItem>
        <UiFormItem label="确认新密码">
          <UiInput
            v-model:value="confirmPassword"
            type="password"
          />
        </UiFormItem>
        <UiButton type="primary" native-type="submit" :loading="saving">更新密码</UiButton>
      </UiForm>
    </UiCard>

    <UiCard class="max-w-xl" title="用户注册">
      <div class="flex items-center justify-between gap-5">
        <div>
          <strong class="text-gray-900 dark:text-white">开放用户自助注册</strong>
          <p class="mt-1.5 text-[13px] text-gray-500 dark:text-dark-400">
            关闭后，登录页不显示注册入口，仅管理员邀请可创建用户。
          </p>
        </div>
        <UiSwitch
          :value="registrationEnabled"
          @update:value="toggleRegistration"
        />
      </div>
    </UiCard>

    <UiCard class="max-w-xl" title="账号配额自动停调">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="min-w-0 flex-1">
          <strong class="text-gray-900 dark:text-white">用量阈值</strong>
          <p class="mt-1.5 text-[13px] text-gray-500 dark:text-dark-400">
            账号 5 小时 / 7 天用量达到该百分比时，自动暂停调度直到对应窗口重置。
            设为 100 表示仅在上游判定超额时停调；调低可在账号快用尽前提前切走流量。
            单个账号可在「账号」页单独覆盖或关闭。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UiInputNumber
            v-model:value="autopauseInput"
            :min="1"
            :max="100"
            :step="5"
            style="width: 120px"
          />
          <span class="text-sm text-gray-500 dark:text-dark-400">%</span>
          <UiButton
            type="primary"
            :loading="savingAutopause"
            :disabled="!autopauseDirty"
            @click="saveAutopause"
          >
            保存
          </UiButton>
        </div>
      </div>
    </UiCard>

    <UiCard class="max-w-xl" title="OpenAI 调度策略">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="min-w-0 flex-1">
          <strong class="text-gray-900 dark:text-white">账号选择方式</strong>
          <p class="mt-1.5 text-[13px] text-gray-500 dark:text-dark-400">
            仅影响 OpenAI 账号的非粘性回退调度，其它服务商不受影响。粘性会话始终优先以保持对话缓存。
            「优先最快重置」会先选择配额窗口最快重置的可用账号，让接近用尽的账号先消耗、其余账号留作储备。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UiSelect
            :value="openaiSchedulingStrategy"
            :options="schedulingStrategyOptions"
            :loading="savingSchedulingStrategy"
            :disabled="savingSchedulingStrategy"
            style="width: 220px"
            @update:value="saveSchedulingStrategy"
          />
        </div>
      </div>
    </UiCard>

    <UiCard class="max-w-xl" title="安全加固">
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-5">
          <div>
            <strong class="text-gray-900 dark:text-white">Turnstile 人机验证</strong>
            <p class="mt-1.5 text-[13px] text-gray-500 dark:text-dark-400">
              配置站点密钥和服务端密钥后，登录与注册入口会强制校验。
            </p>
          </div>
          <UiTag :type="turnstileEnabled ? 'success' : (turnstileConfigured ? 'warning' : 'default')">
            {{ turnstileEnabled ? '已启用' : (turnstileConfigured ? '配置不完整' : '未配置') }}
          </UiTag>
        </div>
        <div class="flex items-center justify-between gap-5">
          <div>
            <strong class="text-gray-900 dark:text-white">CSP / 安全响应头</strong>
            <p class="mt-1.5 text-[13px] text-gray-500 dark:text-dark-400">
              默认发送 CSP、frame 防护、nosniff、referrer 与权限策略响应头。
            </p>
          </div>
          <UiTag :type="securityHeadersEnabled ? 'success' : 'warning'">
            {{ securityHeadersEnabled ? '已启用' : '已关闭' }}
          </UiTag>
        </div>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.update-version-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 12px;
}

@media (min-width: 640px) {
  .update-version-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 960px) {
  .update-version-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.update-version-item {
  min-width: 0;
  border-radius: 12px;
  border: 1px solid rgb(229 231 235);
  padding: 12px;
}

:global(.dark) .update-version-item {
  border-color: rgb(55 65 81);
}

.update-version-item span {
  display: block;
  color: rgb(107 114 128);
  font-size: 12px;
}

.update-version-item strong {
  display: block;
  margin-top: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgb(17 24 39);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 13px;
}

.update-version-item small {
  display: block;
  margin-top: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgb(107 114 128);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
}

:global(.dark) .update-version-item strong {
  color: white;
}

:global(.dark) .update-version-item small {
  color: rgb(156 163 175);
}

.update-task {
  border-top: 1px solid rgb(243 244 246);
  padding-top: 16px;
}

:global(.dark) .update-task {
  border-color: rgb(55 65 81);
}

.system-update-log {
  max-height: 240px;
  overflow: auto;
  border-radius: 12px;
  background: rgb(17 24 39);
  padding: 12px;
  color: rgb(243 244 246);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
