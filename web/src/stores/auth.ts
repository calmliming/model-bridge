import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

const LEGACY_TOKEN_KEY = 'mb_token'
const LEGACY_USERNAME_KEY = 'mb_username'
const LEGACY_ROLE_KEY = 'mb_role'

export type SessionRole = 'admin' | 'user'

const TOKEN_KEY: Record<SessionRole, string> = {
  admin: 'mb_admin_token',
  user: 'mb_user_token',
}

const USERNAME_KEY: Record<SessionRole, string> = {
  admin: 'mb_admin_username',
  user: 'mb_user_username',
}

function initialRole(): SessionRole {
  const path = typeof window === 'undefined' ? '' : window.location.pathname
  return path.startsWith('/app') || path === '/user-login' ? 'user' : 'admin'
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

function roleFromToken(token: string): SessionRole | null {
  const role = decodeJwtPayload(token)?.role
  if (role === 'admin' || role === 'user') return role
  return null
}

function usernameFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token)
  const value = payload?.email ?? payload?.name ?? payload?.sub
  return typeof value === 'string' && value ? value : null
}

function migrateLegacySession(): void {
  const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY)
  if (!legacyToken) return
  const legacyRole =
    roleFromToken(legacyToken) ??
    (localStorage.getItem(LEGACY_ROLE_KEY) === 'user' ? 'user' : 'admin')
  if (!localStorage.getItem(TOKEN_KEY[legacyRole])) {
    localStorage.setItem(TOKEN_KEY[legacyRole], legacyToken)
    const legacyUsername = usernameFromToken(legacyToken) ?? localStorage.getItem(LEGACY_USERNAME_KEY)
    if (legacyUsername) localStorage.setItem(USERNAME_KEY[legacyRole], legacyUsername)
  }
  localStorage.removeItem(LEGACY_TOKEN_KEY)
  localStorage.removeItem(LEGACY_USERNAME_KEY)
  localStorage.removeItem(LEGACY_ROLE_KEY)
}

/** Holds the active console session, with admin/user tokens stored separately. */
export const useAuthStore = defineStore('auth', () => {
  migrateLegacySession()

  const activeRole = ref<SessionRole>(initialRole())
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY[activeRole.value]))
  const username = ref<string | null>(localStorage.getItem(USERNAME_KEY[activeRole.value]))

  const isAuthenticated = computed(() => !!token.value)
  const isAdmin = computed(() => activeRole.value === 'admin' && !!token.value)
  const isUser = computed(() => activeRole.value === 'user' && !!token.value)
  const role = computed(() => activeRole.value)

  function activateRole(newRole: SessionRole): void {
    activeRole.value = newRole
    token.value = localStorage.getItem(TOKEN_KEY[newRole])
    username.value = localStorage.getItem(USERNAME_KEY[newRole])
  }

  function setSession(newToken: string, newUsername: string, newRole: SessionRole = 'admin'): void {
    localStorage.setItem(TOKEN_KEY[newRole], newToken)
    localStorage.setItem(USERNAME_KEY[newRole], newUsername)
    activateRole(newRole)
  }

  function clear(roleToClear: SessionRole = activeRole.value): void {
    localStorage.removeItem(TOKEN_KEY[roleToClear])
    localStorage.removeItem(USERNAME_KEY[roleToClear])
    localStorage.removeItem(LEGACY_TOKEN_KEY)
    localStorage.removeItem(LEGACY_USERNAME_KEY)
    localStorage.removeItem(LEGACY_ROLE_KEY)
    if (roleToClear !== activeRole.value) return
    token.value = null
    username.value = null
  }

  return {
    token,
    username,
    role,
    isAuthenticated,
    isAdmin,
    isUser,
    activateRole,
    setSession,
    clear,
  }
})
