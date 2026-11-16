<script setup lang="ts">
import { computed, ref, useId } from 'vue'

const props = defineProps<{ options: { label: string; value: string }[] }>()
const selection = defineModel<string[]>('value', { required: true })

const cards = [
  { id: 'claude', label: 'Anthropic', icons: ['claude'], group: false },
  { id: 'openai', label: 'OpenAI', icons: ['openai'], group: false },
  { id: 'domestic', label: '国产模型', icons: ['deepseek', 'kimi'], group: true },
  { id: 'other', label: '其他', icons: ['gemini', 'grok'], group: true },
] as const
type Card = typeof cards[number]
type GroupId = Extract<Card, { group: true }>['id']

const iconDir = '/brand/provider-icons'
const icons: Partial<Record<string, string>> = {
  claude: `${iconDir}/claude-color.svg`,
  openai: `${iconDir}/openai.svg`,
  gemini: `${iconDir}/gemini-color.svg`,
  antigravity: `${iconDir}/antigravity-color.svg`,
  deepseek: `${iconDir}/deepseek-color.svg`,
  xiaomi: `${iconDir}/xiaomimimo.svg`,
  zhipu: `${iconDir}/zhipu-color.svg`,
  qwen: `${iconDir}/qwen-color.svg`,
  kimi: `${iconDir}/kimi-color.svg`,
  minimax: `${iconDir}/minimax-color.svg`,
  grok: `${iconDir}/grok.svg`,
  media: '/brand/model-bridge-mark-192-v2.png',
  sub2api: `${iconDir}/sub2api-color.svg`,
}

const domesticProviders = new Set(['deepseek', 'xiaomi', 'zhipu', 'qwen', 'kimi', 'minimax'])
const groupedOptions = computed(() => ({
  domestic: props.options.filter(option => domesticProviders.has(option.value)),
  other: props.options.filter(option => option.value !== 'claude' && option.value !== 'openai' && !domesticProviders.has(option.value)),
}))
const selectedLabels = computed(() => props.options
  .filter(option => selection.value.includes(option.value))
  .map(option => option.label)
  .join('、'))

const expanded = ref<GroupId | null>(null)
const detailsId = useId()

function isSelected(card: Card) {
  return card.group
    ? groupedOptions.value[card.id].some(option => selection.value.includes(option.value))
    : selection.value.includes(card.id)
}

function toggleProvider(value: string) {
  selection.value = selection.value.includes(value)
    ? selection.value.filter(provider => provider !== value)
    : [...selection.value, value]
}

function chooseCard(card: Card) {
  if (card.group) expanded.value = expanded.value === card.id ? null : card.id
  else toggleProvider(card.id)
}
</script>

<template>
  <fieldset class="min-w-0">
    <legend class="field-label">允许的服务商</legend>
    <div class="grid grid-cols-2 gap-2 min-[400px]:grid-cols-4">
      <button
        v-for="card in cards"
        :key="card.id"
        type="button"
        class="provider-card"
        :class="{ 'is-selected': isSelected(card), 'is-expanded': expanded === card.id }"
        :aria-pressed="card.group ? undefined : isSelected(card)"
        :aria-expanded="card.group ? expanded === card.id : undefined"
        :aria-controls="expanded === card.id ? detailsId : undefined"
        @click="chooseCard(card)"
      >
        <span class="flex gap-1.5" aria-hidden="true">
          <span v-for="icon in card.icons" :key="icon" class="provider-icon h-8 w-8 rounded-lg" :data-provider="icon">
            <img :src="icons[icon]" alt="" class="h-5 w-5" />
          </span>
        </span>
        <span class="flex items-center gap-0.5">
          {{ card.label }}
          <svg v-if="card.group" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="h-3 w-3 text-gray-500 dark:text-dark-400" :class="{ 'rotate-180': expanded === card.id }">
            <path d="m4 6 4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <svg v-if="isSelected(card)" aria-hidden="true" viewBox="0 0 16 16" fill="none" class="absolute right-1 top-1 h-4 w-4 rounded-full bg-primary-600 text-white">
          <path d="m4.5 8 2.25 2.25 4.75-4.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <div v-if="expanded" :id="detailsId" class="mt-2 flex flex-wrap gap-1.5 rounded-xl border border-gray-200 p-2 dark:border-dark-600">
      <button
        v-for="option in groupedOptions[expanded]"
        :key="option.value"
        type="button"
        class="provider-option"
        :class="{ 'is-selected': selection.includes(option.value) }"
        :aria-pressed="selection.includes(option.value)"
        @click="toggleProvider(option.value)"
      >
        <span class="provider-icon h-6 w-6 rounded-md" :data-provider="option.value" aria-hidden="true">
          <img v-if="icons[option.value]" :src="icons[option.value]" alt="" class="h-4 w-4" />
          <span v-else>{{ option.label.slice(0, 1) }}</span>
        </span>
        {{ option.label }}
      </button>
    </div>
    <p class="field-hint mt-2" aria-live="polite">{{ selectedLabels ? `已选 ${selectedLabels}` : '未选择时允许所有服务商' }}</p>
  </fieldset>
</template>

<style scoped>
.provider-card,
.provider-option {
  @apply rounded-xl border border-gray-200 text-gray-800 transition-colors hover:border-primary-400;
  @apply focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500;
  @apply dark:border-dark-600 dark:text-gray-100 dark:hover:border-primary-500;
}

.provider-card {
  @apply relative flex min-h-[86px] min-w-0 flex-col items-center justify-center gap-1.5 text-sm font-semibold;
}

.provider-option {
  @apply flex items-center gap-1.5 py-1 pl-1 pr-2 text-left text-xs;
}

.is-expanded {
  @apply border-primary-500 dark:border-primary-500;
}

.is-selected {
  @apply border-primary-500 bg-primary-50 ring-1 ring-inset ring-primary-500 dark:border-primary-500 dark:bg-primary-950/60;
}

.provider-icon {
  @apply grid shrink-0 place-items-center bg-gray-100 text-gray-700;
}

.provider-icon[data-provider='claude'] { @apply bg-orange-50; }
.provider-icon[data-provider='openai'] { @apply bg-emerald-50; }
.provider-icon[data-provider='deepseek'],
.provider-icon[data-provider='gemini'] { @apply bg-blue-50; }
.provider-icon[data-provider='kimi'] { @apply bg-pink-50; }
</style>
