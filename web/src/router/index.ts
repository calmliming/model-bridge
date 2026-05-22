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
      path: '/',
      component: () => import('../layouts/AppLayout.vue'),
      children: [
        { path: '', redirect: '/overview' },
        { path: 'overview', name: 'overview', component: () => import('../views/OverviewView.vue') },
        { path: 'accounts', name: 'accounts', component: () => import('../views/AccountsView.vue') },
        { path: 'keys', name: 'keys', component: () => import('../views/ApiKeysView.vue') },
        { path: 'stats', name: 'stats', component: () => import('../views/StatsView.vue') },
        { path: 'settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.name !== 'login' && !auth.isAuthenticated) {
    return { name: 'login' }
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'overview' }
  }
})
