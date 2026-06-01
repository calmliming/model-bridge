import axios from 'axios'
import { useAuthStore } from '../stores/auth'
import { router } from '../router'

/** Shared axios instance pointed at the backend admin API. */
export const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const auth = useAuthStore()
  if (auth.token) {
    config.headers.Authorization = `Bearer ${auth.token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const auth = useAuthStore()
      const isUserArea =
        router.currentRoute.value.path.startsWith('/app') ||
        router.currentRoute.value.name === 'user-login'
      auth.clear()
      const target = isUserArea ? 'user-login' : 'login'
      if (router.currentRoute.value.name !== target) {
        void router.push({ name: target })
      }
    }
    return Promise.reject(error)
  },
)

/** Extracts a human-readable message from a failed request. */
export function errMsg(error: unknown, fallback = '请求失败'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined
    return data?.error ?? error.message ?? fallback
  }
  return fallback
}
