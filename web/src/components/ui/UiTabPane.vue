<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, type Ref } from 'vue'

const props = defineProps<{ name: string; tab: string }>()

interface TabsCtx {
  active: Ref<string>
  register: (name: string, label: string) => void
  unregister: (name: string) => void
}

const ctx = inject<TabsCtx>('uiTabs')

onMounted(() => ctx?.register(props.name, props.tab))
onBeforeUnmount(() => ctx?.unregister(props.name))
</script>

<template>
  <div v-if="ctx && ctx.active.value === name">
    <slot />
  </div>
</template>
