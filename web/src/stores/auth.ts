import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

const TOKEN_KEY = 'mb_token'
const USERNAME_KEY = 'mb_username'

/** Holds the admin session token, persisted to localStorage. */
export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const username = ref<string | null>(localStorage.getItem(USERNAME_KEY))

  const isAuthenticated = computed(() => !!token.value)

  function setSession(newToken: string, newUsername: string): void {
    token.value = newToken
    username.value = newUsername
    localStorage.setItem(TOKEN_KEY, newToken)
    localStorage.setItem(USERNAME_KEY, newUsername)
  }

  function clear(): void {
    token.value = null
    username.value = null
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USERNAME_KEY)
  }

  return { token, username, isAuthenticated, setSession, clear }
})
