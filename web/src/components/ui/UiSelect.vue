<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, useId, watch, type CSSProperties, type Ref } from 'vue'
import { useFieldContext } from './fieldContext'

type Value = string | number
type Selection = Value | Value[] | null

interface Option {
  label: string
  value: Value
  description?: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    value?: Selection
    modelValue?: Selection
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
    ariaLabelledby?: string
    id?: string
  }>(),
  {
    placeholder: '请选择',
    options: () => [],
    size: 'medium',
  },
)

const emit = defineEmits<{
  (e: 'update:value', value: Selection): void
  (e: 'update:modelValue', value: Selection): void
  (e: 'updateValue', value: Selection): void
}>()

const field = useFieldContext()
const overlayRoot = inject<Ref<HTMLElement | null> | null>('uiOverlayRoot', null)
const selectId = `ui-select-${useId()}`
const resolvedId = computed(() => props.id ?? field?.id ?? selectId)
const listId = `${selectId}-options`
const optionId = (index: number) => `${listId}-${index}`

const open = ref(false)
const search = ref('')
const activeIndex = ref(-1)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
const dropdown = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const dropdownStyle = ref<CSSProperties>({})

const raw = computed(() => props.value ?? props.modelValue ?? null)
const selectedArray = computed(() => props.multiple && Array.isArray(raw.value) ? raw.value : [])
const singleValue = computed(() => Array.isArray(raw.value) ? null : raw.value)
const labelOf = (value: Value) => props.options.find(option => option.value === value)?.label ?? String(value)
const singleLabel = computed(() => singleValue.value == null ? '' : labelOf(singleValue.value))
const hasValue = computed(() => props.multiple ? selectedArray.value.length > 0 : singleLabel.value !== '')

const query = computed(() => search.value.trim())
const filteredOptions = computed(() => {
  if (!props.filterable || !query.value) return props.options
  const term = query.value.toLowerCase()
  return props.options.filter(option =>
    [option.label, String(option.value), option.description].some(text => text?.toLowerCase().includes(term)),
  )
})
const canCreate = computed(() => props.tag && !!query.value
  && !props.options.some(option => String(option.value) === query.value)
  && !selectedArray.value.includes(query.value),
)
const enabledIndices = computed(() => {
  const indices = filteredOptions.value.flatMap((option, index) => option.disabled ? [] : [index])
  if (canCreate.value) indices.push(filteredOptions.value.length)
  return indices
})
const activeId = computed(() => open.value && enabledIndices.value.includes(activeIndex.value)
  ? optionId(activeIndex.value)
  : undefined)

const visibleSelected = computed(() => {
  if (props.maxTagCount == null) return selectedArray.value
  const limit = props.maxTagCount === 'responsive' ? 1 : Math.max(0, Math.trunc(props.maxTagCount))
  return selectedArray.value.slice(0, limit)
})
const hiddenSelected = computed(() => selectedArray.value.slice(visibleSelected.value.length))
const hiddenSelectedTitle = computed(() => hiddenSelected.value.map(labelOf).join('、'))
const showClearButton = computed(() => props.clearable && hasValue.value
  && (props.multiple ? selectedArray.value.length > 1 : singleValue.value !== ''),
)

function emitVal(value: Selection) {
  emit('update:value', value)
  emit('update:modelValue', value)
  emit('updateValue', value)
}

function isSelected(value: Value) {
  return props.multiple ? selectedArray.value.includes(value) : singleValue.value === value
}

function pick(index: number) {
  if (props.disabled || !enabledIndices.value.includes(index)) return
  const value = index === filteredOptions.value.length ? query.value : filteredOptions.value[index].value
  if (!props.multiple) {
    emitVal(value)
    close(true)
    return
  }
  emitVal(isSelected(value) ? selectedArray.value.filter(item => item !== value) : [...selectedArray.value, value])
  search.value = ''
}

function removeTag(value: Value) {
  trigger.value?.focus({ preventScroll: true })
  emitVal(selectedArray.value.filter(item => item !== value))
}

function clearAll() {
  trigger.value?.focus({ preventScroll: true })
  emitVal(props.multiple ? [] : null)
}

function updatePosition() {
  if (!trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const viewport = window.visualViewport
  const viewportLeft = viewport?.offsetLeft ?? 0
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportWidth = viewport?.width ?? window.innerWidth
  const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
  const width = Math.min(rect.width, viewportWidth - 16)
  const left = Math.max(viewportLeft + 8, Math.min(rect.left, viewportLeft + viewportWidth - width - 8))
  const below = viewportBottom - rect.bottom - 12
  const above = rect.top - viewportTop - 12
  const opensUp = below < 180 && above > below
  dropdownStyle.value = {
    left: `${left}px`,
    top: opensUp ? undefined : `${rect.bottom + 4}px`,
    bottom: opensUp ? `${window.innerHeight - rect.top + 4}px` : undefined,
    minWidth: `${width}px`,
    maxWidth: `${Math.min(Math.max(width, 448), viewportLeft + viewportWidth - left - 8)}px`,
    maxHeight: `${Math.max(0, Math.min(288, opensUp ? above : below))}px`,
    width: props.consistentMenuWidth ? `${width}px` : 'max-content',
  }
}

function onOutside(event: Event) {
  if (event.target instanceof Node && !root.value?.contains(event.target) && !dropdown.value?.contains(event.target)) {
    close()
  }
}

function addListeners() {
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('focusin', onOutside)
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', updatePosition)
  window.visualViewport?.addEventListener('resize', updatePosition)
  window.visualViewport?.addEventListener('scroll', updatePosition)
}

function removeListeners() {
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('focusin', onOutside)
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
  window.visualViewport?.removeEventListener('resize', updatePosition)
  window.visualViewport?.removeEventListener('scroll', updatePosition)
}

function setActive(index: number) {
  activeIndex.value = index
  void nextTick(() => {
    if (open.value && activeIndex.value === index) {
      document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' })
    }
  })
}

function openMenu(fromEnd = false) {
  if (props.disabled || open.value) return
  updatePosition()
  open.value = true
  addListeners()
  const indices = enabledIndices.value
  setActive(indices.find(index => {
    const option = filteredOptions.value[index]
    return option && isSelected(option.value)
  })
    ?? (fromEnd ? indices.at(-1) : indices[0]) ?? -1)
  void nextTick(() => {
    if (open.value) searchInput.value?.focus({ preventScroll: true })
  })
}

function close(restoreFocus = false) {
  if (!open.value) return
  open.value = false
  search.value = ''
  activeIndex.value = -1
  removeListeners()
  if (restoreFocus) trigger.value?.focus({ preventScroll: true })
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled || event.isComposing) return
  const { key } = event
  const inSearch = event.target === searchInput.value
  if (key === 'Tab' && open.value) {
    close(inSearch && !event.defaultPrevented)
    return
  }
  if (key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    close(true)
    return
  }
  if (key === 'Enter' || (key === ' ' && !inSearch)) {
    event.preventDefault()
    if (open.value) pick(activeIndex.value)
    else openMenu()
    return
  }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) {
      openMenu(key === 'ArrowUp')
      return
    }
    const indices = enabledIndices.value
    const movingDown = key === 'ArrowDown'
    const current = indices.indexOf(activeIndex.value)
    const next = current === -1
      ? (movingDown ? 0 : indices.length - 1)
      : Math.max(0, Math.min(indices.length - 1, current + (movingDown ? 1 : -1)))
    setActive(indices[next] ?? -1)
  } else if (open.value && !inSearch && (key === 'Home' || key === 'End')) {
    event.preventDefault()
    setActive((key === 'Home' ? enabledIndices.value[0] : enabledIndices.value.at(-1)) ?? -1)
  }
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (event.target === trigger.value || event.key === 'Escape' || event.key === 'Tab') onKeydown(event)
}

watch(query, () => {
  if (open.value) setActive(enabledIndices.value[0] ?? -1)
})
watch(selectedArray, () => {
  if (open.value) updatePosition()
}, { flush: 'post' })
watch(() => props.disabled, disabled => {
  if (disabled) close()
})
onBeforeUnmount(removeListeners)
</script>

<template>
  <div ref="root" class="relative min-w-0">
    <div
      :id="resolvedId"
      ref="trigger"
      class="input select-trigger flex items-center gap-1.5"
      :class="[
        size === 'small' && 'is-small',
        multiple && 'flex-wrap',
        showClearButton && 'has-clear',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-primary-400',
        open && 'is-open',
        field?.invalid.value && 'input-error',
      ]"
      :tabindex="disabled ? -1 : 0"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="open ? listId : undefined"
      :aria-activedescendant="activeId"
      :aria-disabled="disabled || undefined"
      :aria-label="ariaLabel"
      :aria-labelledby="ariaLabelledby ?? (ariaLabel ? undefined : field?.labelId)"
      :aria-invalid="field?.invalid.value || undefined"
      :aria-describedby="field?.descriptionId.value"
      @click="open ? close() : openMenu()"
      @keydown="onTriggerKeydown"
    >
      <template v-if="multiple && hasValue">
        <span
          v-for="value in visibleSelected"
          :key="value"
          class="select-tag inline-flex min-w-0 items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-dark-700 dark:text-gray-200"
        >
          <span class="truncate" :title="labelOf(value)">{{ labelOf(value) }}</span>
          <button
            type="button"
            class="select-icon-button"
            :disabled="disabled"
            :aria-label="`移除 ${labelOf(value)}`"
            @click.stop="removeTag(value)"
          >
            <svg class="h-3 w-3" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
        <span
          v-if="hiddenSelected.length"
          class="select-tag-count shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-dark-700 dark:text-gray-300"
          :title="hiddenSelectedTitle"
        >
          +{{ hiddenSelected.length }}
        </span>
      </template>
      <span v-else-if="hasValue" class="truncate" :title="singleLabel">{{ singleLabel }}</span>
      <span v-else class="truncate text-gray-500 dark:text-dark-400">{{ placeholder }}</span>

      <span class="pointer-events-none absolute inset-y-0 right-2.5 flex items-center gap-1">
        <button
          v-if="showClearButton"
          type="button"
          class="select-icon-button pointer-events-auto"
          :disabled="disabled"
          :aria-label="multiple ? '清空全部选项' : '清除选择'"
          @click.stop="clearAll"
        >
          <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
        <svg
          class="h-4 w-4 text-gray-500 transition-transform dark:text-dark-400"
          :class="open && 'rotate-180 text-primary-600 dark:text-primary-400'"
          aria-hidden="true"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </span>
    </div>

    <Teleport :to="overlayRoot || 'body'">
      <Transition enter-active-class="transition-opacity duration-150" enter-from-class="opacity-0">
        <div
          v-if="open"
          ref="dropdown"
          :style="dropdownStyle"
          class="fixed z-[100000] flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-dark-600 dark:bg-dark-800"
          @keydown="onKeydown"
        >
          <div v-if="filterable" class="border-b border-gray-100 p-2 dark:border-dark-700">
            <input
              ref="searchInput"
              v-model="search"
              class="input !rounded-lg !px-2.5 !py-1.5"
              placeholder="搜索选项"
              aria-label="搜索选项"
              tabindex="-1"
              role="combobox"
              aria-expanded="true"
              :aria-controls="listId"
              :aria-activedescendant="activeId"
            />
          </div>
          <div
            :id="listId"
            role="listbox"
            :aria-label="ariaLabel ?? '选项'"
            :aria-labelledby="ariaLabelledby ?? (ariaLabel ? undefined : field?.labelId)"
            :aria-multiselectable="multiple || undefined"
            class="min-h-0 overflow-y-auto overscroll-contain p-1"
          >
            <div
              v-for="(option, index) in filteredOptions"
              :id="optionId(index)"
              :key="option.value"
              role="option"
              :aria-selected="isSelected(option.value)"
              :aria-disabled="option.disabled || undefined"
              class="select-option"
              :class="{ 'is-active': activeIndex === index, 'is-selected': isSelected(option.value) }"
              @mousedown.prevent
              @click="pick(index)"
            >
              <span class="min-w-0">
                <span>{{ option.label }}</span>
                <span v-if="option.description" class="mt-0.5 block text-xs font-normal text-gray-500 dark:text-dark-400">{{ option.description }}</span>
              </span>
              <svg
                v-if="isSelected(option.value)"
                class="h-4 w-4 shrink-0"
                aria-hidden="true"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <div
              v-if="canCreate"
              :id="optionId(filteredOptions.length)"
              role="option"
              aria-selected="false"
              class="select-option font-medium text-primary-700 dark:text-primary-400"
              :class="{ 'is-active': activeIndex === filteredOptions.length }"
              @mousedown.prevent
              @click="pick(filteredOptions.length)"
            >
              创建 “{{ query }}”
            </div>
          </div>
          <p v-if="!filteredOptions.length && !canCreate" role="status" class="px-3 pb-3 pt-2 text-center text-xs text-gray-500 dark:text-dark-400">
            {{ query ? '无匹配选项' : '暂无选项' }}
          </p>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.select-trigger {
  min-height: 38px;
  padding-right: 34px;
}

.select-trigger.has-clear {
  padding-right: 52px;
}

.select-trigger.is-open {
  @apply border-primary-500 ring-2 ring-primary-500/30;
}

.select-trigger.input-error.is-open {
  @apply border-red-500 ring-red-500/30;
}

.select-trigger.is-small {
  min-height: 30px;
  @apply rounded-lg py-1 pl-2 text-xs;
}

.select-tag {
  max-width: 100%;
}

.select-icon-button {
  @apply shrink-0 rounded text-gray-500 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed dark:text-dark-400 dark:hover:text-gray-200;
}

.select-option {
  @apply flex min-h-9 items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 transition-colors dark:text-gray-200;
  overflow-wrap: anywhere;
}

.select-option:not([aria-disabled='true']) {
  @apply cursor-pointer;
}

.select-option:not([aria-disabled='true']):hover,
.select-option.is-active {
  @apply bg-gray-100 dark:bg-dark-700;
}

.select-option.is-selected {
  @apply bg-primary-50 font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300;
}

.select-option.is-selected:hover,
.select-option.is-selected.is-active {
  @apply bg-primary-100 dark:bg-primary-900/50;
}

.select-option[aria-disabled='true'] {
  @apply cursor-not-allowed opacity-50;
}
</style>
