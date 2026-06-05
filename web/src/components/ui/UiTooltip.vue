<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

const show = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const rect = ref<DOMRect | null>(null)

function open() {
  rect.value = triggerRef.value?.getBoundingClientRect() ?? null
  show.value = true
  nextTick(() => {
    rect.value = triggerRef.value?.getBoundingClientRect() ?? null
  })
}
function close() {
  show.value = false
}

onBeforeUnmount(close)

const style = computed(() => {
  if (!rect.value) return {}
  return {
    position: 'fixed' as const,
    left: `${rect.value.left + rect.value.width / 2}px`,
    top: `${rect.value.top - 8}px`,
    transform: 'translate(-50%, -100%)',
    zIndex: 100001,
  }
})
</script>

<template>
  <span ref="triggerRef" class="inline-flex" @mouseenter="open" @mouseleave="close">
    <slot name="trigger" />
  </span>
  <Teleport to="body">
    <Transition
      enter-active-class="transition ease-out duration-150"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in duration-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        :style="style"
        class="pointer-events-none max-w-xs whitespace-pre-line rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg dark:bg-dark-700"
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>
