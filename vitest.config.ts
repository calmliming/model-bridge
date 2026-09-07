import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Keep local .env credentials out of tests and make npm test runnable on a
    // fresh checkout. Tests that use persistence mock it; port 1 fails closed.
    env: {
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/model_bridge_test',
      REDIS_URL: '',
      ENCRYPTION_KEY: '0'.repeat(64),
      JWT_SECRET: 'model-bridge-test-secret',
    },
  },
})
