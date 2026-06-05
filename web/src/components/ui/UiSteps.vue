<script setup lang="ts">
import { provide, ref, type Ref } from 'vue'

const props = withDefaults(defineProps<{ vertical?: boolean; current?: number }>(), {
  current: 0,
})

const counter = ref(0)

provide<{ vertical: boolean; current: Ref<number>; nextIndex: () => number }>('uiSteps', {
  vertical: props.vertical ?? false,
  current: ref(props.current),
  nextIndex: () => ++counter.value,
})
</script>

<template>
  <div :class="vertical ? 'flex flex-col' : 'flex flex-wrap gap-8'">
    <slot />
  </div>
</template>
