<script setup lang="ts">
import { computed } from 'vue'
import type { BillingPlan } from '../billing'
import { formatUsagePoints } from '../billing'

const props = defineProps<{ plan: BillingPlan }>()
const recommended = computed(() => props.plan.name.toLowerCase() === 'pro')
const tierLabel = computed(() => ({ lite: '轻量使用', pro: '日常主力', max: '高频进阶' }[props.plan.name.toLowerCase()] ?? '自选套餐'))
const money = (value: number | null) => value == null ? '不限' : `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
</script>

<template>
  <article class="plan-card" :class="{ 'plan-card--recommended': recommended }" :aria-label="`${plan.name} 套餐`">
    <div class="plan-card-top">
      <span class="plan-tier-label">{{ tierLabel }}</span>
      <span v-if="recommended" class="plan-recommended">推荐</span>
      <slot name="selection" />
    </div>
    <h2>{{ plan.name }}</h2>
    <p class="plan-description">{{ plan.description || '灵活的模型调用额度，满足你的使用需求。' }}</p>
    <div class="plan-price"><strong>{{ money(plan.price) }}</strong><span>/ {{ plan.paymentProvider === 'waffo' ? '月' : `${plan.validityDays} 天` }}</span></div>
    <p class="plan-billing-note">{{ plan.paymentProvider === 'waffo' ? 'Waffo 按月订阅' : '钱包余额一次性购买' }}</p>
    <dl class="plan-allowances">
      <template v-if="plan.quotaMode === 'usage'">
        <div class="plan-monthly"><dt>5 小时用量</dt><dd>{{ formatUsagePoints(plan.fiveHourLimitPoints) }}</dd></div>
        <div><dt>每周用量</dt><dd>{{ formatUsagePoints(plan.weeklyLimitPoints) }}</dd></div>
        <div><dt>每月用量</dt><dd>{{ formatUsagePoints(plan.monthlyLimitPoints) }}</dd></div>
      </template>
      <template v-else>
      <div class="plan-monthly"><dt>每 30 天可用额度</dt><dd>{{ money(plan.monthlyLimitUsd) }}</dd></div>
      <div><dt>每日额度</dt><dd>{{ money(plan.dailyLimitUsd) }}</dd></div>
      <div><dt>每周额度</dt><dd>{{ money(plan.weeklyLimitUsd) }}</dd></div>
      </template>
    </dl>
    <p v-if="plan.quotaMode === 'usage'" class="plan-policy">按模型及实际输入、输出、缓存用量扣点，三项上限同时生效。同样的任务，模型和缓存命中情况会影响消耗。</p>
    <details v-if="plan.quotaMode === 'usage' && plan.usageProfile === 'opencode-go'" class="model-allowances">
      <summary>不同模型能用多少</summary>
      <div v-for="band in plan.usageBands" :key="band.multiplier" class="model-allowance">
        <strong>{{ band.label }} · 每月 {{ money(band.monthlyReferenceUsd) }} 参考用量</strong>
        <span>{{ band.examples }}</span>
      </div>
      <p>各模型共享上方三项额度，不能叠加领取。未列模型按本站 4 倍规则计量，实际可用模型以分组为准。</p>
    </details>
    <p v-if="plan.groupName" class="plan-group"><span class="plan-group-dot" />{{ plan.groupName }}</p>
    <div class="plan-card-actions"><slot /></div>
    <slot name="status" />
  </article>
</template>

<style scoped>
.plan-card { display: flex; flex-direction: column; min-width: 0; padding: 25px; border: 1px solid #e2e8e8; border-radius: 18px; background: #fff; color: #172b2a; transition: border-color .2s, box-shadow .2s; }
.plan-card:hover { border-color: #94b8b2; box-shadow: 0 7px 24px #143e3410; }
.plan-card--recommended { border-color: #55ada0; background: #f5fcfa; }
.plan-card-top { display: flex; align-items: center; gap: 10px; min-height: 24px; margin-bottom: 16px; }
.plan-tier-label { font-size: 12px; color: #617875; flex: 1; }
.plan-recommended { color: #0f766e; background: #dff5ee; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 5px; }
h2 { font-size: 25px; font-weight: 650; letter-spacing: -.7px; line-height: 1.2; overflow-wrap: anywhere; }
.plan-description { color: #657975; font-size: 13px; line-height: 1.8; min-height: 47px; margin: 12px 0 20px; overflow-wrap: anywhere; }
.plan-price { display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px; font-variant-numeric: tabular-nums; }
.plan-price strong { font-size: 38px; font-weight: 650; letter-spacing: -1.6px; line-height: 1.2; overflow-wrap: anywhere; }
.plan-price span, .plan-billing-note { color: #657975; font-size: 12px; }
.plan-billing-note { margin: 8px 0 23px; }
.plan-allowances { border-top: 1px solid #dde8e4; padding-top: 20px; display: grid; gap: 13px; font-size: 13px; }
.plan-allowances div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.plan-allowances dt { color: #657975; }
.plan-allowances dd { font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.plan-monthly { margin-bottom: 4px; }
.plan-monthly dd { color: #0f766e; font-size: 21px; }
.plan-group { display: flex; align-items: baseline; gap: 7px; margin: 22px 0 0; font-size: 12px; color: #657975; overflow-wrap: anywhere; }
.plan-policy { color: #657975; font-size: 11px; line-height: 1.7; margin-top: 16px; }
.model-allowances { margin-top: 12px; font-size: 11px; line-height: 1.7; color: #657975; }
.model-allowances summary { cursor: pointer; color: #0f766e; font-size: 12px; }
.model-allowance { display: grid; gap: 3px; margin-top: 12px; }
.model-allowance strong { font-weight: 600; color: #244b3e; }
.model-allowances p { margin-top: 12px; }
:global(.dark) .model-allowances { color: #aac1bb; }
:global(.dark) .model-allowances summary, :global(.dark) .model-allowance strong { color: #79d0b8; }
.plan-group-dot { height: 5px; width: 5px; border-radius: 50%; background: #71a79b; flex-shrink: 0; }
.plan-card-actions { padding-top: 24px; margin-top: auto; }
:global(.dark) .plan-card { background: #15282a; color: #e4f0ed; border-color: #304647; }
:global(.dark) .plan-card--recommended { background: #18332f; border-color: #408f7f; }
:global(.dark) .plan-description, :global(.dark) .plan-tier-label, :global(.dark) .plan-billing-note, :global(.dark) .plan-price span, :global(.dark) .plan-allowances dt, :global(.dark) .plan-group { color: #aac1bb; }
:global(.dark) .plan-allowances { border-color: #354d47; }
:global(.dark) .plan-policy { color: #aac1bb; }
:global(.dark) .plan-monthly dd { color: #79d0b8; }
:global(.dark) .plan-recommended { background: #244e41; color: #98ddc7; }
@media (max-width: 480px) { .plan-card { padding: 22px; } .plan-description { min-height: 0; } }
@media (prefers-reduced-motion: reduce) { .plan-card { transition: none; } }
</style>
