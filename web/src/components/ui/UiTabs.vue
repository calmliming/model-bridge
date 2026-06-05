<script setup lang="ts">
import { computed, provide, ref, watch, type Ref } from 'vue'

const props = defineProps<{ value?: string; modelValue?: string }>()
const emit = defineEmits<{
  (e: 'update:value', v: string): void
  (e: 'update:modelValue', v: string): void
}>()

const active = ref<string>(props.value ?? props.modelValue ?? '')

watch(
  () => props.value ?? props.modelValue,
  (v) => {
    if (v != null && v !== active.value) active.value = v
  },
)

function select(name: string) {
  active.value = name
  emit('update:value', name)
  emit('update:modelValue', name)
}

interface TabsCtx {
  active: Ref<string>
  register: (name: string, label: string) => void
  unregister: (name: string) => void
  select: (name: string) => void
}

const tabs = ref<{ name: string; label: string }[]>([])

provide<TabsCtx>('uiTabs', {
  active,
  register: (name, label) => {
    if (!tabs.value.find((t) => t.name === name)) tabs.value.push({ name, label })
    if (!active.value) select(name)
  },
  unregister: (name) => {
    tabs.value = tabs.value.filter((t) => t.name !== name)
  },
  select,
})

const tabList = computed(() => tabs.value)
</script>

<template>
  <div>
    <div class="tab-list">
      <button
        v-for="t in tabList"
        :key="t.name"
        class="tab-item"
        :class="active === t.name && 'tab-item-active'"
        @click="select(t.name)"
      >
        {{ t.label }}
      </button>
    </div>
    <div class="pt-4">
      <slot />
    </div>
  </div>
</template>
