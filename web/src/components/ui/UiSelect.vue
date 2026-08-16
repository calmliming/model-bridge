<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

interface Option {
  label: string
  value: string | number
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    value?: string | number | null | (string | number)[]
    modelValue?: string | number | null | (string | number)[]
    options: Option[]
    placeholder?: string
    multiple?: boolean
    filterable?: boolean
    tag?: boolean
    clearable?: boolean
    disabled?: boolean
    size?: 'small' | 'medium'
    maxTagCount?: number | 'responsive'
    consistentMenuWidth?: boolean
    ariaLabel?: string
  }>(),
  {
    placeholder: '请选择',
    options: () => [],
    size: 'medium',
    consistentMenuWidth: false,
  },
)

const emit = defineEmits<{
  (e: 'update:value', v: string | number | null | (string | number)[]): void
  (e: 'update:modelValue', v: string | number | null | (string | number)[]): void
  (e: 'updateValue', v: string | number | null | (string | number)[]): void
}>()

const open = ref(false)
const search = ref('')
const triggerRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const rect = ref<DOMRect | null>(null)

const raw = computed(() => props.value ?? props.modelValue ?? (props.multiple ? [] : null))
const selectedArray = computed<(string | number)[]>(() =>
  props.multiple ? ((raw.value as (string | number)[]) ?? []) : [],
)

function emitVal(v: string | number | null | (string | number)[]) {
  emit('update:value', v)
  emit('update:modelValue', v)
  emit('updateValue', v)
}

const labelOf = (val: string | number) =>
  props.options.find((o) => o.value === val)?.label ?? String(val)

const singleLabel = computed(() => {
  const v = raw.value
  if (v == null || v === '') return ''
  return labelOf(v as string | number)
})

const filteredOptions = computed(() => {
  if (!props.filterable || !search.value.trim()) return props.options
  const q = search.value.trim().toLowerCase()
  return props.options.filter((o) => o.label.toLowerCase().includes(q))
})

const canCreate = computed(() => {
  if (!props.tag || !search.value.trim()) return false
  const q = search.value.trim()
  const exists = props.options.some((o) => String(o.value) === q) || selectedArray.value.includes(q)
  return !exists
})

function isSelected(val: string | number) {
  return props.multiple ? selectedArray.value.includes(val) : raw.value === val
}

function pick(val: string | number) {
  if (props.multiple) {
    const next = [...selectedArray.value]
    const idx = next.indexOf(val)
    if (idx === -1) next.push(val)
    else next.splice(idx, 1)
    emitVal(next)
  } else {
    emitVal(val)
    close()
  }
  search.value = props.multiple ? '' : search.value
}

function createTag() {
  const q = search.value.trim()
  if (!q) return
  if (props.multiple) {
    emitVal([...selectedArray.value, q])
  } else {
    emitVal(q)
    close()
  }
  search.value = ''
}

function removeTag(val: string | number) {
  emitVal(selectedArray.value.filter((v) => v !== val))
}

function clearAll(e: Event) {
  e.stopPropagation()
  emitVal(props.multiple ? [] : null)
}

function updateRect() {
  rect.value = triggerRef.value?.getBoundingClientRect() ?? null
}

function toggle() {
  if (props.disabled) return
  open.value ? close() : openMenu()
}

function openMenu() {
  updateRect()
  open.value = true
  window.addEventListener('scroll', updateRect, true)
  window.addEventListener('resize', updateRect)
  nextTick(() => {
    if (props.filterable) dropdownRef.value?.querySelector('input')?.focus()
  })
}

function close() {
  open.value = false
  search.value = ''
  window.removeEventListener('scroll', updateRect, true)
  window.removeEventListener('resize', updateRect)
}

function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  if (triggerRef.value?.contains(t) || dropdownRef.value?.contains(t)) return
  close()
}

watch(open, (v) => {
  if (v) document.addEventListener('mousedown', onDocClick)
  else document.removeEventListener('mousedown', onDocClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  window.removeEventListener('scroll', updateRect, true)
  window.removeEventListener('resize', updateRect)
})

const dropdownStyle = computed(() => {
  if (!rect.value) return {}
  return {
    position: 'fixed' as const,
    left: `${rect.value.left}px`,
    top: `${rect.value.bottom + 4}px`,
    minWidth: `${rect.value.width}px`,
    width: props.consistentMenuWidth ? `${rect.value.width}px` : undefined,
    zIndex: 100000,
  }
})

const hasValue = computed(() =>
  props.multiple ? selectedArray.value.length > 0 : raw.value != null && raw.value !== '',
)

const visibleSelected = computed(() => {
  if (props.maxTagCount == null) return selectedArray.value
  const limit = props.maxTagCount === 'responsive'
    ? 1
    : Math.max(0, Math.trunc(props.maxTagCount))
  return selectedArray.value.slice(0, limit)
})

const hiddenSelected = computed(() => selectedArray.value.slice(visibleSelected.value.length))
const hiddenSelectedTitle = computed(() => hiddenSelected.value.map(labelOf).join('、'))
const showClearButton = computed(() =>
  Boolean(props.clearable && hasValue.value && (!props.multiple || selectedArray.value.length > 1)),
)
</script>

<template>
  <div ref="triggerRef" class="relative">
    <div
      class="input select-trigger flex cursor-pointer items-center gap-1.5"
      :class="[
        size === 'small' && 'is-small',
        multiple && 'flex-wrap',
        showClearButton && 'has-clear',
        disabled && 'cursor-not-allowed opacity-60',
        open && 'border-primary-500 ring-2 ring-primary-500/30',
      ]"
      :tabindex="disabled ? -1 : 0"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      @click="toggle"
      @keydown.enter.self.prevent="toggle"
      @keydown.space.self.prevent="toggle"
      @keydown.esc.stop="close"
    >
      <!-- multiple selected tags -->
      <template v-if="multiple && selectedArray.length">
        <span
          v-for="val in visibleSelected"
          :key="val"
          class="select-tag inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-dark-700 dark:text-gray-200"
        >
          <span class="truncate">{{ labelOf(val) }}</span>
          <button
            type="button"
            class="flex-shrink-0 rounded text-gray-400 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-gray-100"
            :title="`移除 ${labelOf(val)}`"
            :aria-label="`移除 ${labelOf(val)}`"
            @click.stop="removeTag(val)"
          >
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
        <span
          v-if="hiddenSelected.length"
          class="select-tag-count inline-flex flex-shrink-0 items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-dark-700 dark:text-gray-300"
          :title="hiddenSelectedTitle"
        >
          +{{ hiddenSelected.length }}
        </span>
      </template>
      <!-- single value -->
      <span v-else-if="!multiple && hasValue" class="truncate text-gray-900 dark:text-gray-100">{{ singleLabel }}</span>
      <!-- placeholder -->
      <span v-if="!hasValue" class="truncate text-gray-400 dark:text-dark-400">{{ placeholder }}</span>

      <!-- clear + chevron -->
      <span class="pointer-events-none absolute inset-y-0 right-2.5 flex items-center gap-1">
        <button
          v-if="showClearButton"
          type="button"
          class="pointer-events-auto rounded text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          :title="multiple ? '清空全部选项' : '清除选择'"
          :aria-label="multiple ? '清空全部选项' : '清除选择'"
          @click="clearAll"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
        <svg
          class="h-4 w-4 text-gray-400 transition-transform"
          :class="open && 'rotate-180'"
          aria-hidden="true"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </span>
    </div>

    <Teleport to="body">
      <Transition
        enter-active-class="transition ease-out duration-150"
        enter-from-class="opacity-0 -translate-y-1"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition ease-in duration-100"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="open"
          ref="dropdownRef"
          :style="dropdownStyle"
          role="listbox"
          :aria-multiselectable="multiple || undefined"
          class="max-h-72 overflow-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-dark-700 dark:bg-dark-800"
        >
          <div v-if="filterable" class="px-2 pb-1.5 pt-0.5">
            <input
              v-model="search"
              class="input py-1.5 text-xs"
              placeholder="搜索..."
              @keyup.enter="canCreate && createTag()"
            />
          </div>
          <div
            v-for="opt in filteredOptions"
            :key="opt.value"
            role="option"
            :aria-selected="isSelected(opt.value)"
            class="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-dark-700"
            :class="[
              isSelected(opt.value) && 'text-primary-600 dark:text-primary-400',
              opt.disabled && 'pointer-events-none opacity-40',
            ]"
            @click="pick(opt.value)"
          >
            <span class="truncate">{{ opt.label }}</span>
            <svg
              v-if="isSelected(opt.value)"
              class="h-4 w-4 flex-shrink-0 text-primary-500"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <div
            v-if="canCreate"
            class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-primary-600 hover:bg-gray-100 dark:hover:bg-dark-700"
            @click="createTag"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            创建 “{{ search.trim() }}”
          </div>
          <div
            v-if="!filteredOptions.length && !canCreate"
            class="px-3 py-4 text-center text-xs text-gray-400"
          >
            无匹配选项
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.select-trigger {
  min-height: 38px;
  padding-right: 36px;
}

.select-trigger.has-clear {
  padding-right: 52px;
}

.select-trigger:focus-visible {
  outline: 2px solid rgba(37, 99, 235, 0.55);
  outline-offset: 1px;
}

.select-trigger.is-small {
  min-height: 30px;
  padding-top: 3px;
  padding-bottom: 3px;
  padding-left: 8px;
  border-radius: 8px;
  font-size: 12px;
}

.select-tag {
  max-width: calc(100% - 8px);
}
</style>
