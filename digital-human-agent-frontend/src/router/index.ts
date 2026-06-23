import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/dashboard' },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
  },
  {
    path: '/documents',
    name: 'documents',
    component: () => import('@/views/DocumentManagementView.vue'),
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('@/views/SearchView.vue'),
  },
  {
    path: '/chat',
    name: 'chat',
    component: () => import('@/views/ChatView.vue'),
  },
  {
    path: '/kb',
    name: 'knowledge-base-list',
    component: () =>
      import('@/views/knowledge-base/KnowledgeBaseListView.vue'),
  },
  {
    path: '/kb/:kbId',
    name: 'knowledge-base-detail',
    component: () =>
      import('@/views/knowledge-base/KnowledgeBaseDetailView.vue'),
    props: true,
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/views/ProfileView.vue'),
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
