import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { installUi } from './components/ui'
import { api } from './api/client'
import { setDisplayTimeZone } from './utils'
import { setCcSwitchRuntimeConfig } from './composables/useCcSwitchImport'
import './styles.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
installUi(app)
app.mount('#app')

// Fire-and-forget: align timestamp rendering with the server's stats timezone
// so list dates match the day buckets. Failure keeps browser-local rendering.
void api
  .get('/auth/display-config')
  .then(({ data }) => {
    setDisplayTimeZone(data?.statsTimezone)
    setCcSwitchRuntimeConfig({
      ccSwitchApiBaseUrl: data?.ccSwitchApiBaseUrl,
      openaiImageGenerationEnabled: data?.openaiImageGenerationEnabled,
    })
  })
  .catch(() => {})
