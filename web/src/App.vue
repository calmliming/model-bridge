<script setup lang="ts">
import { darkTheme } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#5b8cff',
    primaryColorHover: '#7aa2ff',
    primaryColorPressed: '#4670d8',
    primaryColorSuppl: '#7aa2ff',
    borderRadius: '8px',
  },
}
</script>

<template>
  <n-config-provider :theme="darkTheme" :theme-overrides="themeOverrides">
    <n-loading-bar-provider>
      <n-message-provider>
        <n-dialog-provider>
          <router-view />
        </n-dialog-provider>
      </n-message-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>
