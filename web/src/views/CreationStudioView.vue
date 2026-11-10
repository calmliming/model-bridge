<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api, errMsg } from '../api/client'
import {
  createTask, CreationRequestError, getTask, IMAGE_MODELS, mediaUrl,
  VIDEO_MODEL, type CreationMode as Mode, type TaskStatus, type CreationTask,
} from '../api/creation'
import { useAuthStore } from '../stores/auth'

interface StudioGroup {
  id: string
  name: string
  rateMultiplier: number
  providers: string[] | null
}

interface Creation {
  id: string
  mode: Mode
  model: string
  createdAt: number
  status: TaskStatus
  url?: string
  duration?: number
  progress?: number
  error?: string
}

const tabs = [{ id: 'image', label: '图片创作' }, { id: 'video', label: '视频创作' }] as const
const icons = {
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm-1 11 5-5 4 4 3-3 6 6M15 8.5h.01',
  video: 'M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm13 4 5-3v10l-5-3',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4',
} as const
const statusLabels: Record<TaskStatus, string> = {
  running: '生成中', succeeded: '已完成', failed: '生成失败', violation: '内容未通过审核',
}
const qualityLabels: Record<string, string> = { auto: '自动', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高' }
const sizes = ['1024x1024', '1536x1024', '1024x1536', 'auto']
const imageModelOptions = IMAGE_MODELS.map(model => ({ label: model.id, value: model.id }))
const videoModelOptions = [{ label: VIDEO_MODEL, value: VIDEO_MODEL }]
const sizeOptions = sizes.map(value => ({ label: value === 'auto' ? '自动' : value.replace('x', ' × '), value }))
const aspectOptions = [{ label: '横屏', value: 'landscape' }, { label: '竖屏', value: 'portrait' }]
const resolutionOptions = ['480p', '768p', '1080p'].map(value => ({ label: value, value }))
const referenceTypes = ['image/png', 'image/jpeg', 'image/webp']
const historyLimit = 8

const auth = useAuthStore()
const role = auth.role
const historyOwner = role === 'admin' ? `admin:${auth.username}` : auth.userId
const storageKey = historyOwner ? `mb_creation_studio_v1:${historyOwner}` : null
const lifetime = new AbortController()
const mode = ref<Mode>('image')
const prompts = ref({ image: '', video: '' })
const references = ref<Record<Mode, { file: File; preview: string } | null>>({ image: null, video: null })
const referenceError = ref({ image: '', video: '' })
const imageModel = ref<string>(IMAGE_MODELS[0].id)
const size = ref(sizes[0]!)
const quality = ref('auto')
const aspectRatio = ref<'landscape' | 'portrait'>('landscape')
const resolution = ref<'480p' | '768p' | '1080p'>('480p')
const duration = ref(5)
const maxDuration = computed(() => resolution.value === '1080p' ? 10 : 15)
const qualities = computed(() => IMAGE_MODELS.find(model => model.id === imageModel.value)?.qualities ?? IMAGE_MODELS[0].qualities)
const qualityOptions = computed(() => qualities.value.map(value => ({ label: qualityLabels[value], value })))
const durationOptions = computed(() => Array.from({ length: maxDuration.value }, (_, index) => ({ label: `${index + 1} 秒`, value: index + 1 })))
watch(qualities, options => { quality.value = options[0] }, { flush: 'sync' })
watch(maxDuration, max => { if (duration.value > max) duration.value = max })

const groups = ref<StudioGroup[]>([])
const groupOptions = computed(() => [
  { label: '默认池 · 钱包余额', value: '' },
  ...groups.value.map(group => ({
    label: `${group.name}${group.rateMultiplier !== 1 ? ` ×${group.rateMultiplier}` : ''}`,
    value: group.id,
  })),
])
const groupId = ref('')
const groupError = ref('')
const activeMode = ref<Mode | null>(null)
const submitting = ref(false)
const pollingId = ref<string | null>(null)
const errors = ref({ image: '', video: '' })
const previewError = ref('')
const history = ref<Creation[]>(readHistory())
const selectedId = ref<Record<Mode, string>>({ image: '', video: '' })
const result = computed(() => {
  const entries = history.value.filter(item => item.mode === mode.value)
  return entries.find(item => item.id === selectedId.value[mode.value]) ?? entries[0]
})
const isSubmitting = computed(() => submitting.value && activeMode.value === mode.value)
const resultUrl = computed(() => isSubmitting.value ? undefined : mediaUrl(result.value?.url))
const progressPercent = computed(() => {
  const value = result.value?.progress
  return typeof value === 'number' && value > 0 && value <= 100 ? value : undefined
})
watch(resultUrl, () => { previewError.value = '' })

function readHistory(): Creation[] {
  if (!storageKey) return []
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as Creation[]
    return Array.isArray(saved) ? saved.filter(item => item && ['image', 'video'].includes(item.mode)).slice(0, historyLimit) : []
  } catch {
    return []
  }
}

function saveResult(item: Creation): void {
  const index = history.value.findIndex(entry => entry.id === item.id)
  if (index === -1) history.value = [item, ...history.value].slice(0, historyLimit)
  else history.value[index] = item
  try {
    if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify(history.value))
  } catch {
    // The current page remains usable when session storage is disabled.
  }
}

function showResult(item: Creation): void {
  mode.value = item.mode
  selectedId.value[item.mode] = item.id
}

async function loadGroups(): Promise<void> {
  groupError.value = ''
  try {
    const namespace = role === 'admin' ? 'admin' : 'users'
    const { data } = await api.get<{ groups: StudioGroup[] }>(`/${namespace}/account-groups`, { signal: lifetime.signal })
    groups.value = data.groups.filter(group => group.providers?.includes(role === 'admin' ? 'grsai' : 'media'))
  } catch (error) {
    if (!lifetime.signal.aborted) groupError.value = '暂时无法加载其他生成渠道。'
  }
}

function setReference(file: File | undefined): void {
  if (!file) return
  const current = mode.value
  if (!referenceTypes.includes(file.type) || file.size > 20 * 1024 * 1024 || file.size === 0) {
    referenceError.value[current] = '请选择不超过 20 MB 的 PNG、JPEG 或 WebP 图片。'
    return
  }
  clearReference(current)
  references.value[current] = { file, preview: URL.createObjectURL(file) }
}

function clearReference(current: Mode): void {
  const reference = references.value[current]
  if (reference) URL.revokeObjectURL(reference.preview)
  references.value[current] = null
  referenceError.value[current] = ''
}

function chooseReference(event: Event): void {
  const input = event.target as HTMLInputElement
  setReference(input.files?.[0])
  input.value = ''
}

function displayError(error: unknown): string {
  return error instanceof Error ? errMsg(error, error.message) : '请求失败，请稍后重试。'
}

function updateTask(item: Creation, task: CreationTask): Creation {
  if (task.id !== item.id || task.object !== item.mode || !/^media_[\w-]{1,100}$/.test(task.id) || !Object.hasOwn(statusLabels, task.status)) {
    throw new Error('服务返回了无法识别的创作任务。')
  }
  const updated = { ...item, status: task.status, progress: task.progress, url: mediaUrl(task.results?.[0]?.studio_url), error: task.error }
  saveResult(updated)
  return updated
}

async function pollTask(item: Creation): Promise<void> {
  pollingId.value = item.id
  let failures = 0
  const deadline = Date.now() + 12 * 60_000
  try {
    while (item.status === 'running' && !lifetime.signal.aborted && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5_000))
      if (lifetime.signal.aborted) return
      try {
        const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(25_000)])
        item = updateTask(item, await getTask(role, item.mode, item.id, signal))
        failures = 0
      } catch (error) {
        if (lifetime.signal.aborted) return
        const retryable = !(error instanceof CreationRequestError) || error.status === 429 || error.status >= 500
        if (!retryable || ++failures >= 3) throw error
      }
    }
    if (item.status === 'running' && !lifetime.signal.aborted) {
      errors.value[item.mode] = '任务仍在生成，可稍后继续查询。'
    }
  } finally {
    pollingId.value = null
  }
}

async function resumeTask(item: Creation): Promise<void> {
  if (activeMode.value || item.status !== 'running') return
  activeMode.value = item.mode
  errors.value[item.mode] = ''
  try {
    await pollTask(item)
  } catch (error) {
    if (!lifetime.signal.aborted) errors.value[item.mode] = `暂时无法查询进度。${displayError(error)}`
  } finally {
    activeMode.value = null
  }
}

async function submit(): Promise<void> {
  const current = mode.value
  const selectedGroup = groupId.value
  const prompt = prompts.value[current].trim()
  if (activeMode.value || !prompt || referenceError.value[current]) return
  const reference = references.value[current]?.file ?? null
  const imageSettings = { model: imageModel.value, prompt, size: size.value, quality: quality.value }
  const videoSettings = { prompt, aspectRatio: aspectRatio.value, resolution: resolution.value, duration: duration.value }
  if (current === 'video' && (!Number.isInteger(videoSettings.duration) || videoSettings.duration < 1 || videoSettings.duration > maxDuration.value)) return

  activeMode.value = current
  submitting.value = true
  errors.value[current] = ''
  try {
    const createdAt = Date.now()
    const task = await createTask(role, current === 'image' ? imageSettings : videoSettings, reference, lifetime.signal, selectedGroup)
    const item = updateTask({ id: task.id, mode: current, model: current === 'image' ? imageSettings.model : VIDEO_MODEL,
      createdAt, status: 'running', ...(current === 'video' ? { duration: videoSettings.duration } : {}) }, task)
    selectedId.value[current] = item.id
    submitting.value = false
    if (item.status === 'running') await pollTask(item)
  } catch (error) {
    if (!lifetime.signal.aborted) errors.value[current] = displayError(error)
  } finally {
    submitting.value = false
    activeMode.value = null
  }
}

onMounted(() => {
  void loadGroups()
  const pending = history.value.find(item => item.status === 'running')
  if (pending) {
    showResult(pending)
    void resumeTask(pending)
  }
})

onBeforeUnmount(() => {
  lifetime.abort()
  clearReference('image')
  clearReference('video')
})
</script>

<template>
  <div class="mx-auto max-w-[1500px] space-y-5">
    <div class="flex gap-2 border-b border-gray-200 dark:border-dark-800" role="group" aria-label="创作类型">
      <button
        v-for="tab in tabs" :key="tab.id" type="button" :aria-pressed="mode === tab.id"
        class="-mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-sm font-semibold transition sm:px-5 sm:text-base"
        :class="mode === tab.id ? 'border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-300' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-dark-400 dark:hover:text-white'"
        @click="mode = tab.id"
      >
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path :d="icons[tab.id]" />
        </svg>
        {{ tab.label }}
      </button>
    </div>

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(300px,1fr)_minmax(0,2fr)] xl:gap-5">
      <form class="card min-w-0 space-y-4 p-4 sm:p-5" aria-labelledby="studio-settings" @submit.prevent="submit">
        <h2 id="studio-settings" class="text-lg font-bold text-gray-900 dark:text-white">创作设置</h2>

        <div v-if="groups.length">
          <span class="field-label">生成渠道</span>
          <UiSelect id="studio-group" v-model:value="groupId" :options="groupOptions" aria-label="生成渠道" />
          <p v-if="groupId" class="field-hint">有可用的渠道订阅时优先使用订阅额度。</p>
        </div>
        <p v-else-if="groupError" class="field-hint" role="status">
          {{ groupError }} <button type="button" class="underline" @click="loadGroups">重新加载</button>
        </p>

        <div>
          <span class="field-label">模型</span>
          <UiSelect v-if="mode === 'image'" id="studio-model" v-model:value="imageModel" :options="imageModelOptions" aria-label="模型" />
          <UiSelect v-else id="studio-model" :value="VIDEO_MODEL" :options="videoModelOptions" disabled aria-label="模型" />
        </div>

        <div>
          <label class="field-label" for="studio-prompt">提示词</label>
          <textarea
            id="studio-prompt" v-model="prompts[mode]" class="input min-h-28 resize-y leading-relaxed"
            rows="4" maxlength="100000" required
            :placeholder="mode === 'image' ? '例如：晨雾中的山间湖泊，一座暖灯木屋，电影感光影' : '例如：镜头缓慢推近晨雾中的木屋，湖面倒影随风摇曳'"
          />
        </div>

        <div v-if="mode === 'image'" class="grid grid-cols-2 gap-3">
          <div>
            <span class="field-label">尺寸</span>
            <UiSelect id="studio-size" v-model:value="size" :options="sizeOptions" aria-label="尺寸" />
          </div>
          <div>
            <span class="field-label">质量</span>
            <UiSelect id="studio-quality" v-model:value="quality" :options="qualityOptions" aria-label="质量" />
          </div>
        </div>

        <div v-else class="grid grid-cols-2 gap-3">
          <div>
            <span class="field-label">画面方向</span>
            <UiSelect id="studio-aspect" v-model:value="aspectRatio" :options="aspectOptions" aria-label="画面方向" />
          </div>
          <div>
            <span class="field-label">分辨率</span>
            <UiSelect id="studio-resolution" v-model:value="resolution" :options="resolutionOptions" aria-label="分辨率" />
          </div>
          <div class="col-span-2">
            <span class="field-label">时长</span>
            <UiSelect id="studio-duration" v-model:value="duration" :options="durationOptions" aria-label="时长" />
          </div>
        </div>

        <div>
          <label class="field-label" for="studio-reference">添加参考图 <span class="font-normal text-gray-500 dark:text-dark-400">（可选）</span></label>
          <input id="studio-reference" class="peer sr-only" type="file" :accept="referenceTypes.join(',')" @change="chooseReference" />
          <label
            for="studio-reference"
            class="flex min-h-24 cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 text-center transition hover:border-primary-500 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 dark:border-dark-600 dark:bg-dark-800/60"
            @dragover.prevent @drop.prevent="setReference($event.dataTransfer?.files[0])"
          >
            <img v-if="references[mode]" :src="references[mode]?.preview" alt="参考图预览" class="h-14 w-14 shrink-0 rounded-lg object-cover" />
            <svg v-else class="h-7 w-7 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="icons.image" /></svg>
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium text-gray-700 dark:text-dark-200">{{ references[mode]?.file.name ?? '点击或拖放图片到这里' }}</span>
              <span class="mt-0.5 block text-xs text-gray-500 dark:text-dark-400">{{ references[mode] ? '点击可替换参考图' : 'PNG、JPEG、WebP · 最大 20 MB' }}</span>
            </span>
          </label>
          <button v-if="references[mode] || referenceError[mode]" class="mt-1.5 text-xs text-primary-700 hover:underline dark:text-primary-300" type="button" @click="clearReference(mode)">清除参考图</button>
          <p v-if="referenceError[mode]" class="mt-1 text-xs text-red-700 dark:text-red-300" role="alert">{{ referenceError[mode] }}</p>
        </div>

        <button
          class="btn btn-primary btn-block min-h-11" type="submit"
          :disabled="!!activeMode || !prompts[mode].trim() || !!referenceError[mode]"
        >
          <span v-if="activeMode === mode" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
          {{ isSubmitting ? '正在提交…' : activeMode === mode ? '正在生成…' : mode === 'image' ? '生成图片' : '生成视频' }}
        </button>
        <p v-if="errors[mode]" class="break-words text-sm text-red-700 dark:text-red-300" role="alert">{{ errors[mode] }}</p>
      </form>

      <section class="card min-w-0 p-4 sm:p-5" aria-labelledby="studio-result">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2.5">
            <h2 id="studio-result" class="text-lg font-bold text-gray-900 dark:text-white">生成结果</h2>
            <span v-if="result && !isSubmitting" class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="result.status === 'succeeded' ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200' : 'bg-gray-100 text-gray-600 dark:bg-dark-800 dark:text-dark-300'" aria-live="polite">
              {{ result.status === 'running' && pollingId !== result.id ? '待查询' : statusLabels[result.status] }}
            </span>
          </div>
          <a v-if="resultUrl" class="btn btn-secondary" :href="`${resultUrl}&download=1`" download>
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="icons.download" /></svg>
            {{ mode === 'image' ? '下载图片' : '下载视频' }}
          </a>
        </div>

        <div v-if="resultUrl && !previewError" class="flex min-h-52 items-center justify-center overflow-hidden rounded-xl bg-gray-100 dark:bg-dark-950">
          <img v-if="mode === 'image'" :key="resultUrl" :src="resultUrl" alt="生成的图片" referrerpolicy="no-referrer" class="max-h-[50vh] w-full object-contain" @error="previewError = '图片无法加载，链接可能已过期。'" />
          <video v-else :key="resultUrl" :src="resultUrl" class="max-h-[50vh] w-full" controls playsinline preload="metadata" aria-label="生成的视频" @error="previewError = '视频无法加载，链接可能已过期。'" />
        </div>
        <div v-else class="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center sm:min-h-80 dark:border-dark-700 dark:bg-dark-950/50" aria-live="polite">
          <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
            <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="icons[mode]" /></svg>
          </span>
          <template v-if="isSubmitting">
            <p class="text-sm font-medium text-gray-700 dark:text-dark-200">正在提交任务</p>
            <progress class="h-2 w-full max-w-64 accent-primary-600" max="100" aria-label="正在提交任务" />
          </template>
          <template v-else-if="previewError">
            <p class="text-sm font-medium text-gray-700 dark:text-dark-200">{{ previewError }}</p>
          </template>
          <template v-else-if="result?.status === 'running'">
            <p class="text-sm font-medium text-gray-700 dark:text-dark-200">
              {{ pollingId !== result.id ? '进度查询已暂停' : progressPercent === 100 ? '正在确认结果' : mode === 'image' ? '正在生成图片' : '正在生成视频' }}
            </p>
            <progress v-if="progressPercent !== undefined" class="h-2 w-full max-w-64 accent-primary-600" :value="progressPercent" max="100" aria-label="上游生成进度" />
            <progress v-else-if="pollingId === result.id" class="h-2 w-full max-w-64 accent-primary-600" max="100" aria-label="等待上游报告进度" />
            <p v-if="progressPercent !== undefined" class="text-sm tabular-nums text-gray-500 dark:text-dark-400">{{ progressPercent }}%</p>
            <p v-else-if="pollingId === result.id" class="text-xs text-gray-500 dark:text-dark-400">等待上游报告进度</p>
            <button v-if="pollingId !== result.id" type="button" class="btn btn-secondary" :disabled="!!activeMode" @click="resumeTask(result)">继续查询</button>
          </template>
          <template v-else-if="result && result.status !== 'succeeded'">
            <p class="break-words text-sm text-gray-700 dark:text-dark-200">{{ result.error || statusLabels[result.status] }}</p>
          </template>
          <template v-else-if="result">
            <p class="text-sm text-gray-700 dark:text-dark-200">服务未返回可预览的文件。</p>
          </template>
          <template v-else>
            <p class="text-sm font-medium text-gray-700 dark:text-dark-200">作品会显示在这里</p>
            <p class="text-xs text-gray-500 dark:text-dark-400">填写提示词后，点击生成开始创作。</p>
          </template>
        </div>

        <div class="mt-5 border-t border-gray-200 pt-4 dark:border-dark-700">
          <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-base font-bold text-gray-900 dark:text-white">最近创作</h3>
            <p class="text-xs text-gray-500 dark:text-dark-400">仅在当前标签页保留，文件链接可能过期，请及时下载。</p>
          </div>
          <p v-if="!history.length" class="py-3 text-sm text-gray-500 dark:text-dark-400">还没有创作记录。</p>
          <ul v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <li v-for="item in history" :key="item.id" class="min-w-0">
              <button
                class="group relative block w-full overflow-hidden rounded-lg border bg-gray-50 text-left transition hover:border-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-dark-800"
                :class="result?.id === item.id ? 'border-primary-500' : 'border-gray-200 dark:border-dark-700'"
                :aria-pressed="result?.id === item.id" :title="`${item.model} · ${new Date(item.createdAt).toLocaleString()}`" type="button" @click="showResult(item)"
              >
                <div class="relative flex aspect-video items-center justify-center overflow-hidden text-gray-400 dark:text-dark-400">
                  <svg class="absolute h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="icons[item.mode]" /></svg>
                  <img v-if="item.mode === 'image' && mediaUrl(item.url)" :src="mediaUrl(item.url)" alt="" loading="lazy" referrerpolicy="no-referrer" class="absolute inset-0 h-full w-full object-cover" />
                  <video v-else-if="item.mode === 'video' && mediaUrl(item.url)" :src="`${mediaUrl(item.url)}#t=0.1`" preload="metadata" muted playsinline aria-hidden="true" class="absolute inset-0 h-full w-full object-cover" />
                  <span v-if="item.mode === 'video' && item.duration" class="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{{ item.duration }} 秒</span>
                </div>
                <span class="block truncate px-2 py-1.5 text-xs text-gray-600 dark:text-dark-300">{{ item.mode === 'image' ? '图片' : '视频' }} · {{ statusLabels[item.status] }}</span>
              </button>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </div>
</template>
