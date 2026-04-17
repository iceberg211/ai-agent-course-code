import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/chat' },
  {
    path: '/chat',
    name: 'chat',
    component: () => import('../views/ChatView.vue'),
  },
  {
    path: '/kb',
    name: 'kb-list',
    component: () => import('../views/kb/KnowledgeBaseListView.vue'),
  },
  {
    path: '/kb/:kbId',
    name: 'kb-detail',
    component: () => import('../views/kb/KnowledgeBaseDetailView.vue'),
    props: true,
  },
  { path: '/:pathMatch(.*)*', redirect: '/chat' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
