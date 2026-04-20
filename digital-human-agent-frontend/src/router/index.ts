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
    name: 'knowledge-base-list',
    component: () =>
      import('../views/knowledge-base/KnowledgeBaseListView.vue'),
  },
  {
    path: '/kb/:kbId',
    name: 'knowledge-base-detail',
    component: () =>
      import('../views/knowledge-base/KnowledgeBaseDetailView.vue'),
    props: true,
  },
  { path: '/:pathMatch(.*)*', redirect: '/chat' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
