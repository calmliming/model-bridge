<script setup lang="ts">
import ToastHost from './components/ui/ToastHost.vue'
import DialogHost from './components/ui/DialogHost.vue'
</script>

<template>
  <router-view />
  <ToastHost />
  <DialogHost />
</template>
