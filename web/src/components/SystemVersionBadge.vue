<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, errMsg } from '../api/client'
import { useDialog } from '../composables/useDialog'
import { useMessage } from '../composables/useMessage'

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

const message = useMessage()
const dialog = useDialog()

const rootEl = ref<HTMLElement | null>(null)
const dropdownOpen = ref(false)
const appVersion = ref<string | null>(null)
const appCommit = ref<string | null>(null)
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

const displayedVersion = computed(() => {
  return updateCheck.value?.currentVersion || updateTask.value.currentVersion || appVersion.value
})

const versionLabel = computed(() => formatVersion(displayedVersion.value, 'v--'))

const versionTitle = computed(() => {
  const commit = updateCheck.value?.currentCommit || updateTask.value.currentCommit || appCommit.value
  if (!commit) return '当前版本'
  return `当前提交 ${shortCommit(commit)}`
})

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
  void loadSystemVersion()
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  stopStatusPolling()
  document.removeEventListener('click', handleClickOutside)
})

function formatVersion(version?: string | null, fallback = '-'): string {
  if (!version) return fallback
  return version.startsWith('v') ? version : `v${version}`
}

function shortCommit(commit?: string | null): string {
  return commit ? commit.slice(0, 12) : '-'
}

function formatTime(value?: number | null): string {
  return value ? new Date(value).toLocaleString() : '-'
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as Node | null
  if (target && rootEl.value?.contains(target)) return
  dropdownOpen.value = false
}

async function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value
  if (!dropdownOpen.value) return
  await ensureDropdownData()
}

async function ensureDropdownData() {
  await Promise.all([
    updateCheck.value ? Promise.resolve() : refreshUpdateInfo(false),
    loadUpdateStatus(false),
  ])
}

async function loadSystemVersion() {
  try {
    const { data } = await api.get<{ version?: unknown; commit?: unknown }>('/admin/system/version')
    appVersion.value = typeof data.version === 'string' && data.version.trim() ? data.version.trim() : null
    appCommit.value = typeof data.commit === 'string' && data.commit.trim() ? data.commit.trim() : null
  } catch {
    appVersion.value = null
    appCommit.value = null
  }
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
    void loadSystemVersion()
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
  <div ref="rootEl" class="relative">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors"
      :class="
        updateCheck?.hasUpdate
          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-dark-800 dark:text-dark-300 dark:hover:bg-dark-700'
      "
      :title="versionTitle"
      @click.stop="toggleDropdown"
    >
      <span>{{ versionLabel }}</span>
      <span v-if="updateCheck?.hasUpdate" class="relative flex h-2 w-2">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span class="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      <span v-else-if="checkingUpdates" class="spinner h-3 w-3" />
      <svg
        class="h-3.5 w-3.5 transition-transform"
        :class="dropdownOpen ? 'rotate-180' : ''"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <Transition name="version-dropdown">
      <div
        v-if="dropdownOpen"
        class="absolute left-0 z-[70] mt-2 w-72 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-dark-700 dark:bg-dark-900"
      >
        <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-dark-800">
          <div>
            <p class="text-sm font-semibold text-gray-900 dark:text-white">系统版本</p>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-dark-400">{{ versionLabel }}</p>
          </div>
          <button
            type="button"
            class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-dark-800 dark:hover:text-dark-200"
            :disabled="checkingUpdates"
            title="刷新版本信息"
            @click="refreshUpdateInfo(true)"
          >
            <svg
              class="h-4 w-4"
              :class="{ 'animate-spin': checkingUpdates }"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4m-4 4a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
            </svg>
          </button>
        </div>

        <div class="space-y-3 p-4">
          <div class="flex items-center justify-between gap-3">
            <span class="text-xs text-gray-500 dark:text-dark-400">状态</span>
            <UiTag :type="versionState.type">{{ versionState.label }}</UiTag>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="rounded-xl border border-gray-100 p-2.5 dark:border-dark-800">
              <span class="text-gray-500 dark:text-dark-400">当前版本</span>
              <strong class="mt-1 block truncate font-mono text-gray-900 dark:text-white">
                {{ formatVersion(updateCheck?.currentVersion || displayedVersion) }}
              </strong>
              <small class="mt-1 block truncate font-mono text-gray-400 dark:text-dark-500">
                {{ shortCommit(updateCheck?.currentCommit || appCommit) }}
              </small>
            </div>
            <div class="rounded-xl border border-gray-100 p-2.5 dark:border-dark-800">
              <span class="text-gray-500 dark:text-dark-400">最新版本</span>
              <strong class="mt-1 block truncate font-mono text-gray-900 dark:text-white">
                {{ formatVersion(updateCheck?.latestVersion) }}
              </strong>
              <small class="mt-1 block truncate font-mono text-gray-400 dark:text-dark-500">
                {{ shortCommit(updateCheck?.latestCommit) }}
              </small>
            </div>
          </div>

          <div class="rounded-xl bg-gray-50 p-2.5 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-dark-400">
            <div class="flex justify-between gap-2">
              <span>远端</span>
              <strong class="truncate font-medium text-gray-700 dark:text-dark-200">
                {{ updateCheck ? `${updateCheck.remote}/${updateCheck.branch}` : '-' }}
              </strong>
            </div>
            <div class="mt-1.5 flex justify-between gap-2">
              <span>检查时间</span>
              <strong class="truncate font-medium text-gray-700 dark:text-dark-200">
                {{ formatTime(updateCheck?.checkedAt) }}
              </strong>
            </div>
          </div>

          <UiAlert v-if="updateCheck?.warning" type="error">{{ updateCheck.warning }}</UiAlert>
          <UiAlert v-else-if="updateCheck?.dirty" type="warning">
            生产目录存在 tracked 改动，已阻止自动更新。
          </UiAlert>

          <div v-if="updateTask.operationId || updateTask.status !== 'idle'" class="rounded-xl border border-gray-100 p-3 dark:border-dark-800">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs font-semibold text-gray-900 dark:text-white">更新任务</p>
                <p class="mt-1 truncate text-[11px] text-gray-500 dark:text-dark-400">
                  {{ updateTask.operationId || '-' }}
                </p>
              </div>
              <UiTag :type="taskState.type">{{ taskState.label }}</UiTag>
            </div>
            <UiAlert v-if="updateTask.error" class="mt-3" type="error">{{ updateTask.error }}</UiAlert>
            <pre v-if="updateTask.logTail" class="version-update-log mt-3">{{ updateTask.logTail }}</pre>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <UiButton size="tiny" secondary :loading="checkingUpdates" block @click="refreshUpdateInfo(true)">
              刷新
            </UiButton>
            <UiButton
              size="tiny"
              type="primary"
              :loading="startingUpdate || updateBusy"
              :disabled="updateActionDisabled"
              block
              @click="confirmSystemUpdate"
            >
              立即更新
            </UiButton>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.version-dropdown-enter-active,
.version-dropdown-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.version-dropdown-enter-from,
.version-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

.version-update-log {
  max-height: 120px;
  overflow: auto;
  border-radius: 10px;
  background: rgb(17 24 39);
  padding: 10px;
  color: rgb(243 244 246);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
