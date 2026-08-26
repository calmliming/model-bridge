<script setup lang="ts">
import { computed, watch, onUnmounted } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    show: boolean
    title?: string
    width?: number | string
    closable?: boolean
  }>(),
  {
    width: 520,
    closable: true,
  },
)

const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>()

const widthStyle = computed(() => ({
  width: typeof props.width === 'number' ? `${props.width}px` : props.width,
  maxWidth: '95vw',
}))

function close() {
  if (props.closable) emit('update:show', false)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.show) close()
}

watch(
  () => props.show,
  (open) => {
    if (open) {
      document.body.classList.add('modal-open')
      document.addEventListener('keydown', onKey)
    } else {
      document.body.classList.remove('modal-open')
      document.removeEventListener('keydown', onKey)
    }
  },
)

onUnmounted(() => {
  document.body.classList.remove('modal-open')
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="show" class="modal-overlay" @click.self="close">
        <div class="modal-panel" :style="widthStyle" role="dialog" aria-modal="true" :aria-label="title">
          <div class="modal-header">
            <h3 class="modal-title">{{ title }}</h3>
            <button
              v-if="closable"
              type="button"
              class="-mr-1 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-dark-700"
              aria-label="关闭弹窗"
              @click="close"
            >
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="modal-body">
            <slot />
          </div>
          <div v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
