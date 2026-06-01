import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
    },
    {
      path: '/user-login',
      name: 'user-login',
      redirect: { name: 'login' },
    },
    {
      path: '/accept-invite',
      name: 'accept-invite',
      component: () => import('../views/AcceptInviteView.vue'),
    },
    {
      path: '/',
      component: () => import('../layouts/AppLayout.vue'),
      meta: { role: 'admin' },
      children: [
        { path: '', redirect: '/overview' },
        { path: 'overview', name: 'overview', component: () => import('../views/OverviewView.vue') },
        { path: 'accounts', name: 'accounts', component: () => import('../views/AccountsView.vue') },
        { path: 'keys', name: 'keys', component: () => import('../views/ApiKeysView.vue') },
        { path: 'users', name: 'users', component: () => import('../views/AdminUsersView.vue') },
        { path: 'payments', name: 'payments', component: () => import('../views/PaymentOrdersView.vue') },
        { path: 'stats', name: 'stats', component: () => import('../views/StatsView.vue') },
        { path: 'docs', name: 'docs', component: () => import('../views/DocsView.vue') },
        { path: 'settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
      ],
    },
    {
      path: '/app',
      component: () => import('../layouts/UserLayout.vue'),
      meta: { role: 'user' },
      children: [
        { path: '', name: 'user-overview', component: () => import('../views/UserOverviewView.vue') },
        { path: 'keys', name: 'user-keys', component: () => import('../views/UserKeysView.vue') },
        { path: 'usage', name: 'user-usage', component: () => import('../views/UserUsageView.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.name === 'accept-invite') return
  const requiredRole = to.matched.find((record) => record.meta.role)?.meta.role
  if (requiredRole === 'admin' || to.name === 'login') {
    auth.activateRole('admin')
  } else if (requiredRole === 'user') {
    auth.activateRole('user')
  }
  if (!auth.isAuthenticated) {
    if (requiredRole === 'user') return { name: 'login' }
    if (to.name !== 'login') return { name: 'login' }
    return
  }
  if (requiredRole === 'admin' && !auth.isAdmin) {
    return { name: 'login' }
  }
  if (requiredRole === 'user' && !auth.isUser) {
    return { name: 'login' }
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    if (auth.isUser) return { name: 'user-overview' }
    return { name: 'overview' }
  }
})
