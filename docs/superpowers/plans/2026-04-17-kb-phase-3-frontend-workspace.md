# KB Phase 3 · 前端知识库工作区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `digital-human-agent-frontend/` 前端上线独立的"知识库"工作区 `/kb` —— 列表页 + 详情 3 Tab（Documents / HitTest / Settings），对应 Phase 2 暴露的新 REST API。对话页维持现状（Phase 4 再改造联动）。

**Architecture:** 引入 `vue-router@4`，把现有单屏三栏布局搬到 `/chat` 路由下的 `ChatView.vue`；新增 `/kb` 列表和 `/kb/:kbId` 详情两个路由；新增 `useKnowledgeBase.ts` hook 统一收口所有 `/api/knowledge-bases/*` 和 `/api/personas/:id/knowledge-bases` 调用；KB 详情页用受控 Tabs 组织 Documents / HitTest / Settings 三个视图。

**Tech Stack:** Vue 3 `<script setup lang="ts">` / Pinia（已装）/ vue-router 4（新装）/ lucide-vue-next / 原生 `fetch` + vite proxy

**Spec:** `docs/superpowers/specs/2026-04-17-knowledge-base-platform-design.md`（§5 前端改造点）

**Prerequisites:**
- `kb-phase2-done` tag 已打
- 后端 `/knowledge-bases/*`、`/personas/:id/knowledge-bases`、`/personas/:id/search` 全部可用
- 前端现状：`App.vue` 是三栏布局，没有路由

**Phase 3 不做的事（留给 Phase 4）**：
- 不改 `DocsDrawer`（Phase 4 瘦身）
- 不改 `PersonaPanel`（Phase 4 加挂载 Modal）
- 不改 `ChatView` 内部（只是把它搬到路由下）
- 不改 `useKnowledge.ts`（旧的 persona-scoped hook 仍然存在但它的后端 API 已 404；对话页依赖的部分会静默返回空数组，不会崩溃。Phase 4 重写）

---

## File Structure Map

### 新增文件

```
digital-human-agent-frontend/src/
├── router/
│   └── index.ts                                  # vue-router 配置
├── views/
│   ├── ChatView.vue                              # 原 App.vue 三栏搬到这里，零行为变更
│   └── kb/
│       ├── KnowledgeBaseListView.vue             # /kb 列表 + 新建入口
│       └── KnowledgeBaseDetailView.vue           # /kb/:kbId 容器 + Tabs
├── components/
│   └── kb/
│       ├── KnowledgeBaseCard.vue                 # 列表卡片
│       ├── KnowledgeBaseCreateModal.vue          # 新建 Modal
│       ├── AppNav.vue                            # 顶部 [对话 | 知识库] 导航
│       └── tabs/
│           ├── DocumentsTab.vue                  # 文档列表 + 上传 + 选中后展开 chunks
│           ├── HitTestTab.vue                    # 命中测试（stage1 + stage2 + 参数调节）
│           └── SettingsTab.vue                   # retrievalConfig + 危险操作
├── hooks/
│   └── useKnowledgeBase.ts                       # 所有 /knowledge-bases + /personas/:id KB 相关的 fetch
└── stores/
    └── knowledgeBase.ts                          # KB 列表 + 当前选中 KB
```

### 修改文件

```
digital-human-agent-frontend/
├── package.json                                   # 加 vue-router 依赖
├── src/
│   ├── main.ts                                   # 注册 router
│   ├── App.vue                                   # 改为 AppNav + <router-view> shell
│   └── types.ts                                  # 加 KnowledgeBase / Chunk / RetrievalConfig 类型
```

### 不修改

```
ChatView 内所有子组件 (PersonaPanel / ChatHeader / MessageList / MessageItem /
ChatComposer / ChatControls / DocsDrawer / UploadZone / DocItem / ToastAlert /
PersonaCreateModal)、useAppController / useAudio / useConversation /
useKnowledge / useWebSocket / stores/persona / stores/session
```

---

## Task Sequence Rationale

按**可独立验证**的思路拆分：

1. Task 1–2：**Router + ChatView 提取** — 让现有单屏可以通过 `/chat` 路由访问，`/kb` 先放一个空壳，系统整体可跑
2. Task 3–4：**类型定义 + 数据层** — types、hook、store，都是无 UI 代码
3. Task 5–6：**KB 列表 + KB 详情骨架** — 路由都能跳，Tab 空壳能切换
4. Task 7–9：**三个 Tab 的实现** — Documents、HitTest、Settings 各自独立，按顺序填充
5. Task 10：E2E 冒烟 + tag

每个 Task 完成后都能 `npm run dev` 跑起来看到增量效果。

---

## Task 1: 安装 vue-router + 写路由表 + main 注册

**Files:**
- Modify: `digital-human-agent-frontend/package.json`
- Create: `digital-human-agent-frontend/src/router/index.ts`
- Modify: `digital-human-agent-frontend/src/main.ts`

- [ ] **Step 1: 安装 vue-router**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm install vue-router@4
```

Expected: `package.json` dependencies 追加 `vue-router`，`package-lock.json` 更新。

- [ ] **Step 2: 创建 `src/router/index.ts`**

```ts
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
```

- [ ] **Step 3: 修改 `src/main.ts`** — 注册 router

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { router } from './router'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
```

- [ ] **Step 4: 不立刻 build**（等 Task 2 提取 ChatView 后一起 build）

- [ ] **Step 5: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/package.json \
        digital-human-agent-frontend/package-lock.json \
        digital-human-agent-frontend/src/router/index.ts \
        digital-human-agent-frontend/src/main.ts
git commit -m "feat(fe): install vue-router + define /chat /kb /kb/:kbId routes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 抽 `ChatView.vue` + 改 `App.vue` 为 shell

**Files:**
- Create: `digital-human-agent-frontend/src/views/ChatView.vue`
- Create: `digital-human-agent-frontend/src/components/kb/AppNav.vue`
- Modify: `digital-human-agent-frontend/src/App.vue`
- Create: `digital-human-agent-frontend/src/views/kb/KnowledgeBaseListView.vue`（仅占位）
- Create: `digital-human-agent-frontend/src/views/kb/KnowledgeBaseDetailView.vue`（仅占位）

目标：现有 `App.vue` 三栏布局整段搬到 `ChatView.vue`，不改一行内部逻辑；`App.vue` 改为"顶部导航 + `<router-view>`" 的薄 shell；KB 两个视图先做占位（Task 5、6 再实现）。

- [ ] **Step 1: 原样复制 App.vue 内容到 `src/views/ChatView.vue`**

把 `src/App.vue` 当前的整个 `<template> / <script setup> / <style scoped>` 三部分完整复制到 `src/views/ChatView.vue`。import 路径需要相对调整：

- `./hooks/useAppController` → `../hooks/useAppController`
- `./stores/persona` → `../stores/persona`
- `./stores/session` → `../stores/session`
- `./components/persona/PersonaPanel.vue` → `../components/persona/PersonaPanel.vue`
- `./components/chat/ChatHeader.vue` → `../components/chat/ChatHeader.vue`
- `./components/chat/MessageList.vue` → `../components/chat/MessageList.vue`
- `./components/chat/ChatComposer.vue` → `../components/chat/ChatComposer.vue`
- `./components/chat/ChatControls.vue` → `../components/chat/ChatControls.vue`
- `./components/knowledge/DocsDrawer.vue` → `../components/knowledge/DocsDrawer.vue`
- `./components/common/ToastAlert.vue` → `../components/common/ToastAlert.vue`
- `./components/persona/PersonaCreateModal.vue` → `../components/persona/PersonaCreateModal.vue`
- `./types` → `../types`

其他代码一字不改。

- [ ] **Step 2: 写 `src/components/kb/AppNav.vue`**

```vue
<template>
  <nav class="app-nav" aria-label="主导航">
    <RouterLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="app-nav__item"
      active-class="app-nav__item--active"
    >
      <component :is="item.icon" :size="16" aria-hidden="true" />
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<script setup lang="ts">
import { MessageSquareIcon, LibraryIcon } from 'lucide-vue-next'

const items = [
  { to: '/chat', label: '对话', icon: MessageSquareIcon },
  { to: '/kb', label: '知识库', icon: LibraryIcon },
]
</script>

<style scoped>
.app-nav {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.app-nav__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  transition: background-color 150ms, color 150ms;
}
.app-nav__item:hover {
  background: var(--primary-bg);
  color: var(--text);
}
.app-nav__item--active {
  background: var(--primary-bg);
  color: var(--primary);
}
</style>
```

- [ ] **Step 3: 重写 `src/App.vue`** 为 shell

```vue
<template>
  <div class="app-root">
    <AppNav />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import AppNav from './components/kb/AppNav.vue'
</script>

<style>
.app-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--primary-bg);
}
.app-root > :last-child {
  flex: 1;
  min-height: 0;
}
</style>
```

- [ ] **Step 4: 占位 `src/views/kb/KnowledgeBaseListView.vue`**

```vue
<template>
  <main class="kb-view">
    <h2>知识库</h2>
    <p class="placeholder">Phase 3 Task 5 实现</p>
  </main>
</template>

<script setup lang="ts"></script>

<style scoped>
.kb-view { padding: 24px; }
.placeholder { color: var(--text-muted); }
</style>
```

- [ ] **Step 5: 占位 `src/views/kb/KnowledgeBaseDetailView.vue`**

```vue
<template>
  <main class="kb-view">
    <h2>知识库详情 · {{ kbId }}</h2>
    <p class="placeholder">Phase 3 Task 6 实现</p>
  </main>
</template>

<script setup lang="ts">
defineProps<{ kbId: string }>()
</script>

<style scoped>
.kb-view { padding: 24px; }
.placeholder { color: var(--text-muted); }
</style>
```

- [ ] **Step 6: Type check + dev smoke**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: 没有错误。

```bash
# 启动 vite dev，后端也得起着（否则 ChatView 有网络异常，但不影响路由跑通）
npm run dev &
DEV_PID=$!
sleep 5

# 验证路由可达
curl -s http://localhost:5173/chat -o /dev/null -w "chat: %{http_code}\n"
curl -s http://localhost:5173/kb -o /dev/null -w "kb: %{http_code}\n"
curl -s http://localhost:5173/kb/some-id -o /dev/null -w "kb-detail: %{http_code}\n"

kill $DEV_PID
wait $DEV_PID 2>/dev/null
```

Expected: 三个都 200（Vite dev 服务器对任意路径都返回 index.html）。

**浏览器手工验证**（auto mode 下跳过此步，除非发现异常）：
- 打开 `http://localhost:5173/`，应该重定向到 `/chat`，看到原三栏
- 点击顶部 "知识库"，路由变为 `/kb`，看到占位文字
- 手工输入 `/kb/xxx`，看到"知识库详情 · xxx"

- [ ] **Step 7: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/App.vue \
        digital-human-agent-frontend/src/views/ChatView.vue \
        digital-human-agent-frontend/src/views/kb/ \
        digital-human-agent-frontend/src/components/kb/AppNav.vue
git commit -m "refactor(fe): extract ChatView + add AppNav shell with /kb placeholders

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 扩展 `types.ts`

**Files:**
- Modify: `digital-human-agent-frontend/src/types.ts`

- [ ] **Step 1: 追加 KB 相关类型（文件末尾）**

在 `src/types.ts` 末尾追加：

```ts
// ── Knowledge Base ─────────────────────────────────────────────────────────

export interface RetrievalConfig {
  threshold: number
  stage1TopK: number
  finalTopK: number
  rerank: boolean
}

export interface KnowledgeBase {
  id: string
  name: string
  description?: string | null
  ownerPersonaId?: string | null
  retrievalConfig: RetrievalConfig
  createdAt: string
  updatedAt: string
}

export interface KnowledgeChunk {
  id: string
  documentId: string
  chunkIndex: number
  content: string
  charCount: number
  enabled: boolean
  source: string
  category?: string | null
  createdAt: string
}

export interface KnowledgeDocumentDetail extends KnowledgeDocument {
  knowledgeBaseId: string
  mimeType?: string | null
  fileSize?: number | null
  sourceType: 'upload'
}
```

- [ ] **Step 2: Type check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: 没有错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/types.ts
git commit -m "feat(fe): add KnowledgeBase / Chunk / RetrievalConfig types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `useKnowledgeBase` hook + `knowledgeBase` store

**Files:**
- Create: `digital-human-agent-frontend/src/hooks/useKnowledgeBase.ts`
- Create: `digital-human-agent-frontend/src/stores/knowledgeBase.ts`

- [ ] **Step 1: `src/hooks/useKnowledgeBase.ts`**

```ts
import { ref } from 'vue'
import type {
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeDocumentDetail,
  KnowledgeSearchResult,
  RetrievalConfig,
} from '../types'

export interface CreateKnowledgeBasePayload {
  name: string
  description?: string
  ownerPersonaId?: string
  retrievalConfig?: Partial<RetrievalConfig>
}

export interface UpdateKnowledgeBasePayload
  extends Partial<CreateKnowledgeBasePayload> {}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(input, init)
    if (!res.ok) {
      console.error(`[useKnowledgeBase] ${init?.method ?? 'GET'} ${input} -> HTTP ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (e) {
    console.error(`[useKnowledgeBase] network error ${input}:`, e)
    return null
  }
}

export function useKnowledgeBase() {
  const listLoading = ref(false)
  const detailLoading = ref(false)
  const documentsLoading = ref(false)
  const chunksLoading = ref(false)
  const searching = ref(false)
  const uploading = ref(false)

  async function listAll(): Promise<KnowledgeBase[]> {
    listLoading.value = true
    try {
      return (await fetchJson<KnowledgeBase[]>('/api/knowledge-bases')) ?? []
    } finally {
      listLoading.value = false
    }
  }

  async function getById(kbId: string): Promise<KnowledgeBase | null> {
    detailLoading.value = true
    try {
      return await fetchJson<KnowledgeBase>(`/api/knowledge-bases/${kbId}`)
    } finally {
      detailLoading.value = false
    }
  }

  async function create(
    payload: CreateKnowledgeBasePayload,
  ): Promise<KnowledgeBase | null> {
    return fetchJson<KnowledgeBase>('/api/knowledge-bases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  async function update(
    kbId: string,
    payload: UpdateKnowledgeBasePayload,
  ): Promise<KnowledgeBase | null> {
    return fetchJson<KnowledgeBase>(`/api/knowledge-bases/${kbId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  async function remove(kbId: string): Promise<boolean> {
    const res = await fetchJson<{ deleted: true }>(
      `/api/knowledge-bases/${kbId}`,
      { method: 'DELETE' },
    )
    return !!res?.deleted
  }

  async function listDocuments(kbId: string): Promise<KnowledgeDocumentDetail[]> {
    documentsLoading.value = true
    try {
      return (
        (await fetchJson<KnowledgeDocumentDetail[]>(
          `/api/knowledge-bases/${kbId}/documents`,
        )) ?? []
      )
    } finally {
      documentsLoading.value = false
    }
  }

  async function uploadDocument(
    kbId: string,
    file: File,
    category?: string,
  ): Promise<KnowledgeDocumentDetail | null> {
    uploading.value = true
    try {
      const form = new FormData()
      form.append('file', file)
      if (category) form.append('category', category)
      const res = await fetch(`/api/knowledge-bases/${kbId}/documents`, {
        method: 'POST',
        body: form,
      }).catch(() => null)
      if (!res?.ok) return null
      return (await res.json()) as KnowledgeDocumentDetail
    } finally {
      uploading.value = false
    }
  }

  async function deleteDocument(kbId: string, docId: string): Promise<boolean> {
    const res = await fetch(
      `/api/knowledge-bases/${kbId}/documents/${docId}`,
      { method: 'DELETE' },
    ).catch(() => null)
    return !!res?.ok
  }

  async function listChunks(
    kbId: string,
    docId: string,
  ): Promise<KnowledgeChunk[]> {
    chunksLoading.value = true
    try {
      return (
        (await fetchJson<KnowledgeChunk[]>(
          `/api/knowledge-bases/${kbId}/documents/${docId}/chunks`,
        )) ?? []
      )
    } finally {
      chunksLoading.value = false
    }
  }

  async function setChunkEnabled(
    kbId: string,
    chunkId: string,
    enabled: boolean,
  ): Promise<boolean> {
    const res = await fetchJson<{ enabled: boolean }>(
      `/api/knowledge-bases/${kbId}/chunks/${chunkId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      },
    )
    return res?.enabled === enabled
  }

  async function searchInKb(
    kbId: string,
    query: string,
    options: Partial<{
      rerank: boolean
      threshold: number
      stage1TopK: number
      finalTopK: number
    }> = {},
  ): Promise<KnowledgeSearchResult | null> {
    const q = query.trim()
    if (!q) return null
    searching.value = true
    try {
      return await fetchJson<KnowledgeSearchResult>(
        `/api/knowledge-bases/${kbId}/search`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: q, ...options }),
        },
      )
    } finally {
      searching.value = false
    }
  }

  async function listKbsForPersona(personaId: string): Promise<KnowledgeBase[]> {
    return (
      (await fetchJson<KnowledgeBase[]>(
        `/api/personas/${personaId}/knowledge-bases`,
      )) ?? []
    )
  }

  async function attachToPersona(
    personaId: string,
    knowledgeBaseId: string,
  ): Promise<boolean> {
    const res = await fetchJson<{ attached: boolean }>(
      `/api/personas/${personaId}/knowledge-bases`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ knowledgeBaseId }),
      },
    )
    return res?.attached === true
  }

  async function detachFromPersona(
    personaId: string,
    kbId: string,
  ): Promise<boolean> {
    const res = await fetch(
      `/api/personas/${personaId}/knowledge-bases/${kbId}`,
      { method: 'DELETE' },
    ).catch(() => null)
    return !!res?.ok
  }

  return {
    // loading flags
    listLoading,
    detailLoading,
    documentsLoading,
    chunksLoading,
    searching,
    uploading,

    // KB CRUD
    listAll,
    getById,
    create,
    update,
    remove,

    // documents + chunks
    listDocuments,
    uploadDocument,
    deleteDocument,
    listChunks,
    setChunkEnabled,

    // hit test
    searchInKb,

    // persona attach
    listKbsForPersona,
    attachToPersona,
    detachFromPersona,
  }
}
```

- [ ] **Step 2: `src/stores/knowledgeBase.ts`**

```ts
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { KnowledgeBase } from '../types'

export const useKnowledgeBaseStore = defineStore('knowledgeBase', () => {
  const list = ref<KnowledgeBase[]>([])
  const current = ref<KnowledgeBase | null>(null)

  const byId = computed(() => {
    const map = new Map<string, KnowledgeBase>()
    for (const kb of list.value) map.set(kb.id, kb)
    return map
  })

  function setList(items: KnowledgeBase[]) {
    list.value = items
  }

  function setCurrent(kb: KnowledgeBase | null) {
    current.value = kb
  }

  function upsert(kb: KnowledgeBase) {
    const idx = list.value.findIndex((x) => x.id === kb.id)
    if (idx >= 0) list.value.splice(idx, 1, kb)
    else list.value.unshift(kb)
    if (current.value?.id === kb.id) current.value = kb
  }

  function removeById(kbId: string) {
    list.value = list.value.filter((kb) => kb.id !== kbId)
    if (current.value?.id === kbId) current.value = null
  }

  return { list, current, byId, setList, setCurrent, upsert, removeById }
})
```

- [ ] **Step 3: Type check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/hooks/useKnowledgeBase.ts \
        digital-human-agent-frontend/src/stores/knowledgeBase.ts
git commit -m "feat(fe): add useKnowledgeBase hook + knowledgeBase pinia store

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: KB 列表页 `/kb`

**Files:**
- Create: `digital-human-agent-frontend/src/components/kb/KnowledgeBaseCard.vue`
- Create: `digital-human-agent-frontend/src/components/kb/KnowledgeBaseCreateModal.vue`
- Modify: `digital-human-agent-frontend/src/views/kb/KnowledgeBaseListView.vue`（把占位换成真实页面）

- [ ] **Step 1: `components/kb/KnowledgeBaseCard.vue`**

```vue
<template>
  <article class="kb-card" @click="$emit('open', kb.id)" role="button" tabindex="0" @keydown.enter="$emit('open', kb.id)">
    <div class="kb-card__head">
      <BookOpenIcon :size="18" color="var(--primary)" aria-hidden="true" />
      <h3 class="kb-card__name">{{ kb.name }}</h3>
    </div>
    <p v-if="kb.description" class="kb-card__desc">{{ kb.description }}</p>
    <footer class="kb-card__footer">
      <span class="kb-card__meta">threshold {{ kb.retrievalConfig.threshold }}</span>
      <span class="kb-card__meta">topK {{ kb.retrievalConfig.finalTopK }}</span>
      <span v-if="kb.retrievalConfig.rerank" class="kb-card__tag">rerank</span>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { BookOpenIcon } from 'lucide-vue-next'
import type { KnowledgeBase } from '../../types'

defineProps<{ kb: KnowledgeBase }>()
defineEmits<{ (e: 'open', kbId: string): void }>()
</script>

<style scoped>
.kb-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  cursor: pointer;
  transition: border-color 150ms, transform 150ms, box-shadow 150ms;
}
.kb-card:hover {
  border-color: var(--primary);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(124, 58, 237, 0.08);
}
.kb-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.kb-card__name {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.kb-card__desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.kb-card__footer {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-muted);
}
.kb-card__meta { font-variant-numeric: tabular-nums; }
.kb-card__tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--primary-bg);
  color: var(--primary);
  font-weight: 600;
}
</style>
```

- [ ] **Step 2: `components/kb/KnowledgeBaseCreateModal.vue`**

```vue
<template>
  <div class="modal-backdrop" @click.self="$emit('cancel')">
    <div class="modal" role="dialog" aria-label="新建知识库">
      <h3 class="modal__title">新建知识库</h3>

      <label class="field">
        <span>名称</span>
        <input v-model="name" type="text" placeholder="例如：产品 FAQ" maxlength="120" autofocus />
      </label>

      <label class="field">
        <span>描述（可选）</span>
        <textarea v-model="description" rows="3" maxlength="500" placeholder="这个知识库收录什么内容？" />
      </label>

      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

      <div class="actions">
        <button type="button" class="btn btn--ghost" @click="$emit('cancel')">取消</button>
        <button type="button" class="btn btn--primary" :disabled="!canSubmit || submitting" @click="onSubmit">
          {{ submitting ? '创建中…' : '创建' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'submit', payload: { name: string; description?: string }): void
}>()

defineProps<{ submitting?: boolean; errorMsg?: string }>()

const name = ref('')
const description = ref('')

const canSubmit = computed(() => name.value.trim().length > 0)

function onSubmit() {
  if (!canSubmit.value) return
  emit('submit', {
    name: name.value.trim(),
    description: description.value.trim() || undefined,
  })
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: min(480px, 92vw);
  background: var(--surface);
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
}
.modal__title { margin: 0; font-size: 16px; font-weight: 600; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.field input, .field textarea {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text);
  background: #fff;
  font: inherit;
}
.field input:focus, .field textarea:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.16);
}
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
.btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn--ghost { background: transparent; color: var(--text-secondary); border-color: var(--border); }
.btn--ghost:hover { background: var(--primary-bg); }
.btn--primary { background: var(--primary); color: #fff; }
.btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.error { margin: 0; color: var(--error); font-size: 12px; }
</style>
```

- [ ] **Step 3: 重写 `views/kb/KnowledgeBaseListView.vue`**

```vue
<template>
  <main class="kb-list">
    <header class="kb-list__head">
      <h2>知识库</h2>
      <button class="btn-primary" @click="createOpen = true">
        <PlusIcon :size="16" />
        新建
      </button>
    </header>

    <div v-if="store.list.length === 0 && !hook.listLoading.value" class="empty">
      还没有知识库，点右上角"新建"创建第一个
    </div>

    <div v-else class="kb-grid">
      <KnowledgeBaseCard
        v-for="kb in store.list"
        :key="kb.id"
        :kb="kb"
        @open="goDetail"
      />
    </div>

    <KnowledgeBaseCreateModal
      v-if="createOpen"
      :submitting="creating"
      :error-msg="createError"
      @cancel="createOpen = false"
      @submit="onCreate"
    />
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PlusIcon } from 'lucide-vue-next'
import { useKnowledgeBaseStore } from '../../stores/knowledgeBase'
import { useKnowledgeBase } from '../../hooks/useKnowledgeBase'
import KnowledgeBaseCard from '../../components/kb/KnowledgeBaseCard.vue'
import KnowledgeBaseCreateModal from '../../components/kb/KnowledgeBaseCreateModal.vue'

const store = useKnowledgeBaseStore()
const hook = useKnowledgeBase()
const router = useRouter()

const createOpen = ref(false)
const creating = ref(false)
const createError = ref('')

async function refresh() {
  const list = await hook.listAll()
  store.setList(list)
}

onMounted(refresh)

function goDetail(kbId: string) {
  router.push(`/kb/${kbId}`)
}

async function onCreate(payload: { name: string; description?: string }) {
  creating.value = true
  createError.value = ''
  try {
    const kb = await hook.create(payload)
    if (!kb) {
      createError.value = '创建失败，请稍后重试'
      return
    }
    store.upsert(kb)
    createOpen.value = false
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.kb-list { padding: 24px; height: 100%; overflow-y: auto; }
.kb-list__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.kb-list__head h2 { margin: 0; font-size: 20px; font-weight: 600; }
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:hover { filter: brightness(1.1); }
.kb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.empty {
  padding: 48px;
  text-align: center;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 12px;
}
</style>
```

- [ ] **Step 4: Type check + dev smoke**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: pass.

Dev smoke（需要后端起着）：
```bash
# 后端在另一个终端起着（cd digital-human-agent && npm run start:dev）
npm run dev &
sleep 5
# 验证 GET /api/knowledge-bases 能返回（通过 vite proxy 到 3001）
curl -s http://localhost:5173/api/knowledge-bases | python3 -m json.tool | head -10
kill $(lsof -iTCP:5173 -sTCP:LISTEN -n -P -t) 2>/dev/null
```

Expected: 有 KB 数组返回。浏览器访问 `http://localhost:5173/kb` 可以看到卡片列表和"新建"按钮。

- [ ] **Step 5: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/views/kb/KnowledgeBaseListView.vue \
        digital-human-agent-frontend/src/components/kb/KnowledgeBaseCard.vue \
        digital-human-agent-frontend/src/components/kb/KnowledgeBaseCreateModal.vue
git commit -m "feat(fe): KB list page with create modal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: KB 详情页骨架 + Tabs 切换

**Files:**
- Modify: `digital-human-agent-frontend/src/views/kb/KnowledgeBaseDetailView.vue`（替换占位）
- Create: 3 个占位 Tab 文件：
  - `digital-human-agent-frontend/src/components/kb/tabs/DocumentsTab.vue`
  - `digital-human-agent-frontend/src/components/kb/tabs/HitTestTab.vue`
  - `digital-human-agent-frontend/src/components/kb/tabs/SettingsTab.vue`

- [ ] **Step 1: 重写 `KnowledgeBaseDetailView.vue`**

```vue
<template>
  <main class="kb-detail" v-if="kb">
    <header class="kb-detail__head">
      <RouterLink to="/kb" class="back"><ChevronLeftIcon :size="14" /> 知识库</RouterLink>
      <h2>{{ kb.name }}</h2>
      <p v-if="kb.description" class="kb-detail__desc">{{ kb.description }}</p>
    </header>

    <nav class="tabs" role="tablist">
      <button
        v-for="t in tabs"
        :key="t.key"
        role="tab"
        :aria-selected="active === t.key"
        class="tab"
        :class="{ 'tab--active': active === t.key }"
        @click="active = t.key"
      >
        {{ t.label }}
      </button>
    </nav>

    <section class="tab-body">
      <DocumentsTab v-if="active === 'documents'" :kb-id="kbId" />
      <HitTestTab v-else-if="active === 'hit-test'" :kb="kb" />
      <SettingsTab v-else-if="active === 'settings'" :kb="kb" @changed="onKbChanged" @deleted="onKbDeleted" />
    </section>
  </main>

  <main v-else-if="loading" class="kb-detail kb-detail--empty">加载中…</main>
  <main v-else class="kb-detail kb-detail--empty">知识库不存在或已删除</main>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeftIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '../../hooks/useKnowledgeBase'
import { useKnowledgeBaseStore } from '../../stores/knowledgeBase'
import type { KnowledgeBase } from '../../types'
import DocumentsTab from '../../components/kb/tabs/DocumentsTab.vue'
import HitTestTab from '../../components/kb/tabs/HitTestTab.vue'
import SettingsTab from '../../components/kb/tabs/SettingsTab.vue'

const props = defineProps<{ kbId: string }>()
const router = useRouter()
const hook = useKnowledgeBase()
const store = useKnowledgeBaseStore()

type TabKey = 'documents' | 'hit-test' | 'settings'
const tabs: { key: TabKey; label: string }[] = [
  { key: 'documents', label: '文档' },
  { key: 'hit-test', label: '命中测试' },
  { key: 'settings', label: '配置' },
]
const active = ref<TabKey>('documents')

const kb = ref<KnowledgeBase | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const result = await hook.getById(props.kbId)
    kb.value = result
    if (result) {
      store.setCurrent(result)
      store.upsert(result)
    }
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.kbId, load)

function onKbChanged(updated: KnowledgeBase) {
  kb.value = updated
  store.upsert(updated)
}

function onKbDeleted() {
  store.removeById(props.kbId)
  router.push('/kb')
}
</script>

<style scoped>
.kb-detail { padding: 24px; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.kb-detail--empty { align-items: center; justify-content: center; color: var(--text-muted); }
.kb-detail__head { margin-bottom: 16px; }
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  text-decoration: none;
  margin-bottom: 6px;
}
.back:hover { color: var(--text); }
.kb-detail__head h2 { margin: 0 0 4px; font-size: 20px; }
.kb-detail__desc { margin: 0; color: var(--text-secondary); font-size: 13px; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
.tab {
  padding: 8px 14px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 150ms, border-color 150ms;
}
.tab:hover { color: var(--text); }
.tab--active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 600;
}
.tab-body { flex: 1; overflow-y: auto; min-height: 0; }
</style>
```

- [ ] **Step 2: 占位 Tabs（Task 7-9 会真正实现）**

`src/components/kb/tabs/DocumentsTab.vue`:

```vue
<template>
  <div class="tab-placeholder">DocumentsTab for {{ kbId }} (Task 7)</div>
</template>

<script setup lang="ts">
defineProps<{ kbId: string }>()
</script>

<style scoped>
.tab-placeholder { color: var(--text-muted); padding: 24px; }
</style>
```

`src/components/kb/tabs/HitTestTab.vue`:

```vue
<template>
  <div class="tab-placeholder">HitTestTab for {{ kb.id }} (Task 8)</div>
</template>

<script setup lang="ts">
import type { KnowledgeBase } from '../../../types'
defineProps<{ kb: KnowledgeBase }>()
</script>

<style scoped>
.tab-placeholder { color: var(--text-muted); padding: 24px; }
</style>
```

`src/components/kb/tabs/SettingsTab.vue`:

```vue
<template>
  <div class="tab-placeholder">SettingsTab for {{ kb.id }} (Task 9)</div>
</template>

<script setup lang="ts">
import type { KnowledgeBase } from '../../../types'
defineProps<{ kb: KnowledgeBase }>()
defineEmits<{
  (e: 'changed', kb: KnowledgeBase): void
  (e: 'deleted'): void
}>()
</script>

<style scoped>
.tab-placeholder { color: var(--text-muted); padding: 24px; }
</style>
```

- [ ] **Step 3: Type check + commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/views/kb/KnowledgeBaseDetailView.vue \
        digital-human-agent-frontend/src/components/kb/tabs/
git commit -m "feat(fe): KB detail shell with 3 tab placeholders

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: DocumentsTab（文档列表 + 上传 + Chunk 启用开关）

**Files:**
- Modify: `digital-human-agent-frontend/src/components/kb/tabs/DocumentsTab.vue`

- [ ] **Step 1: 写完整实现**

```vue
<template>
  <div class="documents-tab">
    <section class="upload">
      <label class="upload__dropzone">
        <UploadCloudIcon :size="20" />
        <span v-if="hook.uploading.value">上传中…</span>
        <span v-else>选择文档（PDF / Markdown / TXT），点击或拖拽</span>
        <input
          type="file"
          accept=".pdf,.txt,.md,.markdown,.csv,.json,.log"
          :disabled="hook.uploading.value"
          @change="onFileSelected"
        />
      </label>
      <p v-if="uploadError" class="error">{{ uploadError }}</p>
    </section>

    <section class="doc-list">
      <header class="doc-list__head">
        <h3>已上传文档</h3>
        <span class="badge">{{ documents.length }}</span>
      </header>

      <div v-if="hook.documentsLoading.value" class="muted">加载中…</div>
      <div v-else-if="documents.length === 0" class="empty">暂无文档</div>

      <ul v-else class="docs" role="list">
        <li v-for="doc in documents" :key="doc.id" class="doc">
          <button class="doc__row" @click="toggleExpand(doc.id)" :aria-expanded="expanded === doc.id">
            <FileTextIcon :size="16" />
            <span class="doc__name">{{ doc.filename }}</span>
            <span class="doc__status" :class="`status--${doc.status}`">{{ statusLabel(doc.status) }}</span>
            <span class="doc__meta">{{ doc.chunkCount ?? 0 }} 段</span>
            <ChevronDownIcon :size="14" class="doc__chevron" :class="{ 'doc__chevron--open': expanded === doc.id }" />
          </button>

          <button class="doc__delete" :aria-label="'删除 ' + doc.filename" @click.stop="deleteDoc(doc)">
            <Trash2Icon :size="14" />
          </button>

          <div v-if="expanded === doc.id" class="chunks">
            <div v-if="hook.chunksLoading.value" class="muted">chunks 加载中…</div>
            <ul v-else class="chunk-list" role="list">
              <li v-for="c in chunks" :key="c.id" class="chunk">
                <header class="chunk__head">
                  <span class="chunk__idx">§ {{ c.chunkIndex }}</span>
                  <span class="chunk__count">{{ c.charCount }} 字</span>
                  <label class="toggle">
                    <input type="checkbox" :checked="c.enabled" @change="toggleChunk(c)" />
                    <span>{{ c.enabled ? '启用' : '禁用' }}</span>
                  </label>
                </header>
                <p class="chunk__body">{{ c.content }}</p>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  ChevronDownIcon,
  FileTextIcon,
  Trash2Icon,
  UploadCloudIcon,
} from 'lucide-vue-next'
import { useKnowledgeBase } from '../../../hooks/useKnowledgeBase'
import type {
  KnowledgeChunk,
  KnowledgeDocumentDetail,
} from '../../../types'

const props = defineProps<{ kbId: string }>()
const hook = useKnowledgeBase()

const documents = ref<KnowledgeDocumentDetail[]>([])
const expanded = ref<string | null>(null)
const chunks = ref<KnowledgeChunk[]>([])
const uploadError = ref('')

async function refresh() {
  documents.value = await hook.listDocuments(props.kbId)
}

onMounted(refresh)

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadError.value = ''
  const result = await hook.uploadDocument(props.kbId, file)
  input.value = ''
  if (!result) {
    uploadError.value = '上传失败，请检查文件格式（支持 PDF / TXT / MD）或稍后重试'
    return
  }
  await refresh()
}

async function deleteDoc(doc: KnowledgeDocumentDetail) {
  if (!confirm(`确定删除文档「${doc.filename}」？其 chunks 会一并清除。`)) return
  const ok = await hook.deleteDocument(props.kbId, doc.id)
  if (ok) {
    if (expanded.value === doc.id) expanded.value = null
    await refresh()
  }
}

async function toggleExpand(docId: string) {
  if (expanded.value === docId) {
    expanded.value = null
    chunks.value = []
    return
  }
  expanded.value = docId
  chunks.value = await hook.listChunks(props.kbId, docId)
}

async function toggleChunk(c: KnowledgeChunk) {
  const next = !c.enabled
  const ok = await hook.setChunkEnabled(props.kbId, c.id, next)
  if (ok) c.enabled = next
}

function statusLabel(s: string) {
  return { pending: '排队中', processing: '处理中', completed: '就绪', failed: '失败' }[s] ?? s
}
</script>

<style scoped>
.documents-tab { display: flex; flex-direction: column; gap: 20px; padding: 4px 0; }

/* ── upload ─── */
.upload { display: flex; flex-direction: column; gap: 6px; }
.upload__dropzone {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px;
  border: 2px dashed var(--border);
  border-radius: 12px;
  cursor: pointer;
  background: var(--surface);
  color: var(--text-secondary);
  transition: border-color 150ms, background 150ms;
}
.upload__dropzone:hover { border-color: var(--primary); background: var(--primary-bg); }
.upload__dropzone input { display: none; }
.error { margin: 0; color: var(--error); font-size: 12px; }

/* ── doc list ─── */
.doc-list__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.doc-list__head h3 { margin: 0; font-size: 14px; font-weight: 600; }
.badge { padding: 1px 8px; border-radius: 10px; background: var(--primary-bg); color: var(--primary); font-size: 11px; font-weight: 600; }
.muted, .empty { padding: 16px; color: var(--text-muted); font-size: 13px; }

.docs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.doc {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}
.doc__row {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto auto auto;
  gap: 10px;
  align-items: center;
  padding: 10px 44px 10px 12px;
  background: none;
  border: none;
  font: inherit;
  cursor: pointer;
  text-align: left;
  color: var(--text);
}
.doc__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.doc__status { font-size: 11px; padding: 2px 6px; border-radius: 6px; }
.status--completed { color: var(--success); background: #ecfdf5; }
.status--processing { color: var(--warning); background: #fffbeb; }
.status--failed { color: var(--error); background: #fef2f2; }
.status--pending { color: var(--text-secondary); background: #f1f5f9; }
.doc__meta { font-size: 11px; color: var(--text-muted); }
.doc__chevron { transition: transform 150ms; color: var(--text-muted); }
.doc__chevron--open { transform: rotate(180deg); }
.doc__delete {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.doc__delete:hover { background: var(--error); color: #fff; }

/* ── chunks ─── */
.chunks { border-top: 1px solid var(--border); padding: 8px 12px 12px; }
.chunk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.chunk {
  border: 1px solid var(--border-muted);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--primary-bg);
}
.chunk__head { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; }
.chunk__idx { font-weight: 600; color: var(--primary); }
.chunk__count { font-variant-numeric: tabular-nums; }
.toggle { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.toggle input { accent-color: var(--primary); }
.chunk__body {
  margin: 0;
  font-size: 12px;
  color: var(--text);
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
  line-height: 1.5;
}
</style>
```

- [ ] **Step 2: Type check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/components/kb/tabs/DocumentsTab.vue
git commit -m "feat(fe): KB DocumentsTab with upload + chunk expand + enable toggle

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: HitTestTab（命中测试）

**Files:**
- Modify: `digital-human-agent-frontend/src/components/kb/tabs/HitTestTab.vue`

- [ ] **Step 1: 写实现**

```vue
<template>
  <div class="hit-test">
    <section class="controls">
      <div class="query-row">
        <input
          v-model="query"
          type="text"
          placeholder="输入你的问题，看看这个知识库召回什么…"
          :disabled="hook.searching.value"
          @keydown.enter="runSearch"
        />
        <button class="btn-primary" :disabled="!canSearch" @click="runSearch">
          <SearchIcon :size="14" />
          {{ hook.searching.value ? '检索中…' : '检索' }}
        </button>
      </div>

      <div class="params">
        <label>
          Threshold
          <input v-model.number="threshold" type="number" min="0" max="1" step="0.05" />
        </label>
        <label>
          stage1 topK
          <input v-model.number="stage1TopK" type="number" min="1" max="50" step="1" />
        </label>
        <label>
          finalTopK
          <input v-model.number="finalTopK" type="number" min="1" max="20" step="1" />
        </label>
        <label class="params__toggle">
          <input v-model="rerank" type="checkbox" />
          开启 Rerank
        </label>
        <button class="btn-ghost" type="button" @click="resetParams">恢复 KB 默认</button>
      </div>
    </section>

    <section v-if="result" class="results">
      <div class="results__head">
        <span>stage1 召回 {{ result.stage1.length }}</span>
        <span>stage2 {{ rerank ? 'rerank' : '截断' }} {{ result.stage2.length }}</span>
      </div>
      <div class="results__columns">
        <article class="column">
          <h4>Stage 1 · 向量召回</h4>
          <ol v-if="result.stage1.length">
            <li v-for="c in result.stage1" :key="`s1-${c.id}`" @click="selected = c" :class="{ 'is-active': selected?.id === c.id }">
              <div class="row-main">{{ c.source }} · § {{ c.chunk_index }}</div>
              <div class="row-sub">sim {{ fmt(c.similarity) }}</div>
            </li>
          </ol>
          <p v-else class="muted">无结果</p>
        </article>
        <article class="column">
          <h4>Stage 2 · Rerank</h4>
          <ol v-if="result.stage2.length">
            <li v-for="c in result.stage2" :key="`s2-${c.id}`" @click="selected = c" :class="{ 'is-active': selected?.id === c.id }">
              <div class="row-main">{{ c.source }} · § {{ c.chunk_index }}</div>
              <div class="row-sub">
                <span v-if="c.rerank_score != null">rerank {{ fmt(c.rerank_score) }} · </span>
                sim {{ fmt(c.similarity) }}
              </div>
            </li>
          </ol>
          <p v-else class="muted">无结果</p>
        </article>
      </div>

      <aside v-if="selected" class="detail">
        <header>命中内容</header>
        <pre>{{ selected.content }}</pre>
      </aside>
    </section>
    <p v-else class="muted hint">运行一次检索试试</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { SearchIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '../../../hooks/useKnowledgeBase'
import type {
  KnowledgeBase,
  KnowledgeSearchChunk,
  KnowledgeSearchResult,
} from '../../../types'

const props = defineProps<{ kb: KnowledgeBase }>()
const hook = useKnowledgeBase()

const query = ref('')
const threshold = ref(props.kb.retrievalConfig.threshold)
const stage1TopK = ref(props.kb.retrievalConfig.stage1TopK)
const finalTopK = ref(props.kb.retrievalConfig.finalTopK)
const rerank = ref(props.kb.retrievalConfig.rerank)

const result = ref<KnowledgeSearchResult | null>(null)
const selected = ref<KnowledgeSearchChunk | null>(null)

const canSearch = computed(
  () => !hook.searching.value && query.value.trim().length > 0,
)

watch(
  () => props.kb.id,
  () => {
    query.value = ''
    result.value = null
    selected.value = null
    resetParams()
  },
)

function resetParams() {
  threshold.value = props.kb.retrievalConfig.threshold
  stage1TopK.value = props.kb.retrievalConfig.stage1TopK
  finalTopK.value = props.kb.retrievalConfig.finalTopK
  rerank.value = props.kb.retrievalConfig.rerank
}

async function runSearch() {
  if (!canSearch.value) return
  selected.value = null
  const r = await hook.searchInKb(props.kb.id, query.value, {
    threshold: threshold.value,
    stage1TopK: stage1TopK.value,
    finalTopK: finalTopK.value,
    rerank: rerank.value,
  })
  result.value = r
}

function fmt(n: number | undefined): string {
  const v = Number(n)
  return Number.isFinite(v) ? v.toFixed(3) : '-'
}
</script>

<style scoped>
.hit-test { display: flex; flex-direction: column; gap: 16px; padding: 4px 0; }

.controls { display: flex; flex-direction: column; gap: 12px; }
.query-row { display: flex; gap: 8px; }
.query-row input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
}
.query-row input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.16); }
.btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 16px; background: var(--primary); color: #fff;
  border: none; border-radius: 8px; font-weight: 600; cursor: pointer;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost {
  background: transparent; color: var(--text-secondary);
  border: 1px solid var(--border); border-radius: 8px;
  padding: 4px 10px; font-size: 12px; cursor: pointer;
}
.btn-ghost:hover { background: var(--primary-bg); }

.params { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--text-secondary); align-items: center; }
.params label { display: flex; align-items: center; gap: 6px; }
.params input[type='number'] {
  width: 72px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
}
.params__toggle { cursor: pointer; }

.results__head { display: flex; gap: 16px; font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.results__columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.column { border: 1px solid var(--border); border-radius: 10px; padding: 12px; background: var(--surface); }
.column h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
.column ol { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.column li {
  padding: 6px 8px; border-radius: 6px; cursor: pointer;
  font-size: 12px; color: var(--text-secondary);
}
.column li:hover { background: var(--primary-bg); }
.column li.is-active { background: var(--primary-bg); color: var(--primary); font-weight: 600; }
.row-main { color: var(--text); font-size: 12px; }
.row-sub { font-size: 11px; color: var(--text-muted); }
.muted { color: var(--text-muted); font-size: 12px; }
.hint { padding: 24px; text-align: center; }

.detail {
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  background: var(--surface);
}
.detail header { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
.detail pre {
  margin: 0;
  font-size: 12px;
  color: var(--text);
  white-space: pre-wrap;
  max-height: 320px;
  overflow-y: auto;
  font-family: inherit;
  line-height: 1.5;
}
</style>
```

- [ ] **Step 2: Type check + commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/components/kb/tabs/HitTestTab.vue
git commit -m "feat(fe): KB HitTestTab with parameter tuning and stage1/stage2 columns

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: SettingsTab（retrievalConfig 编辑 + 删除）

**Files:**
- Modify: `digital-human-agent-frontend/src/components/kb/tabs/SettingsTab.vue`

- [ ] **Step 1: 写实现**

```vue
<template>
  <div class="settings-tab">
    <section class="block">
      <h4>基础信息</h4>
      <label class="field">
        <span>名称</span>
        <input v-model="draft.name" type="text" maxlength="120" />
      </label>
      <label class="field">
        <span>描述</span>
        <textarea v-model="draft.description" rows="3" maxlength="500" />
      </label>
    </section>

    <section class="block">
      <h4>检索参数</h4>
      <div class="params-grid">
        <label class="field">
          <span>Threshold ({{ draft.retrievalConfig.threshold.toFixed(2) }})</span>
          <input v-model.number="draft.retrievalConfig.threshold" type="range" min="0" max="1" step="0.05" />
        </label>
        <label class="field">
          <span>stage1 topK</span>
          <input v-model.number="draft.retrievalConfig.stage1TopK" type="number" min="1" max="50" />
        </label>
        <label class="field">
          <span>finalTopK</span>
          <input v-model.number="draft.retrievalConfig.finalTopK" type="number" min="1" max="20" />
        </label>
        <label class="field field--inline">
          <input v-model="draft.retrievalConfig.rerank" type="checkbox" />
          <span>开启 Rerank</span>
        </label>
      </div>
    </section>

    <div class="actions">
      <button class="btn-ghost" :disabled="!dirty || saving" @click="reset">恢复</button>
      <button class="btn-primary" :disabled="!dirty || saving" @click="save">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </div>
    <p v-if="saveError" class="error">{{ saveError }}</p>

    <section class="danger">
      <h4>危险区</h4>
      <p class="danger__hint">删除知识库会级联移除所有文档与 chunks，无法恢复。</p>
      <button class="btn-danger" :disabled="deleting" @click="onDelete">
        {{ deleting ? '删除中…' : '删除此知识库' }}
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useKnowledgeBase } from '../../../hooks/useKnowledgeBase'
import type { KnowledgeBase } from '../../../types'

const props = defineProps<{ kb: KnowledgeBase }>()
const emit = defineEmits<{
  (e: 'changed', kb: KnowledgeBase): void
  (e: 'deleted'): void
}>()

const hook = useKnowledgeBase()
const saving = ref(false)
const deleting = ref(false)
const saveError = ref('')

const draft = reactive({
  name: props.kb.name,
  description: props.kb.description ?? '',
  retrievalConfig: { ...props.kb.retrievalConfig },
})

function snapshot() {
  return JSON.stringify({
    name: props.kb.name,
    description: props.kb.description ?? '',
    retrievalConfig: props.kb.retrievalConfig,
  })
}

const dirty = computed(() => {
  const orig = snapshot()
  const cur = JSON.stringify({
    name: draft.name,
    description: draft.description,
    retrievalConfig: draft.retrievalConfig,
  })
  return orig !== cur
})

watch(
  () => props.kb.id,
  () => reset(),
)

function reset() {
  draft.name = props.kb.name
  draft.description = props.kb.description ?? ''
  draft.retrievalConfig = { ...props.kb.retrievalConfig }
  saveError.value = ''
}

async function save() {
  saving.value = true
  saveError.value = ''
  try {
    const updated = await hook.update(props.kb.id, {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      retrievalConfig: { ...draft.retrievalConfig },
    })
    if (!updated) {
      saveError.value = '保存失败，请稍后重试'
      return
    }
    emit('changed', updated)
  } finally {
    saving.value = false
  }
}

async function onDelete() {
  if (!confirm(`确定删除知识库「${props.kb.name}」？此操作不可恢复。`)) return
  deleting.value = true
  try {
    const ok = await hook.remove(props.kb.id)
    if (ok) emit('deleted')
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.settings-tab { display: flex; flex-direction: column; gap: 20px; max-width: 640px; }

.block { border: 1px solid var(--border); border-radius: 10px; padding: 16px; background: var(--surface); display: flex; flex-direction: column; gap: 12px; }
.block h4 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }

.field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.field--inline { flex-direction: row; align-items: center; }
.field input[type='text'], .field textarea, .field input[type='number'] {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: #fff;
}
.field input[type='range'] { accent-color: var(--primary); }

.params-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.actions { display: flex; gap: 8px; justify-content: flex-end; }
.btn-primary, .btn-ghost, .btn-danger {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost { background: transparent; color: var(--text-secondary); border-color: var(--border); }
.btn-ghost:hover { background: var(--primary-bg); }
.btn-danger { background: var(--error); color: #fff; }
.btn-danger:hover { filter: brightness(1.08); }
.error { margin: 0; color: var(--error); font-size: 12px; }

.danger { border: 1px solid var(--error); border-radius: 10px; padding: 16px; background: #fef2f2; }
.danger h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; color: var(--error); }
.danger__hint { margin: 0 0 12px; font-size: 12px; color: var(--text-secondary); }
</style>
```

- [ ] **Step 2: Type check + commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/components/kb/tabs/SettingsTab.vue
git commit -m "feat(fe): KB SettingsTab with retrievalConfig editor + delete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: E2E smoke + tag

**Files:** 无

- [ ] **Step 1: 启后端 + 启前端**

```bash
# 后端
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
lsof -iTCP:3001 -sTCP:LISTEN -n -P -t | xargs -r kill 2>/dev/null
npm run start:dev > /tmp/phase3-backend.log 2>&1 &
BE_PID=$!
sleep 10
grep -E "successfully started" /tmp/phase3-backend.log || { echo "backend failed"; exit 1; }

# 前端
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
lsof -iTCP:5173 -sTCP:LISTEN -n -P -t | xargs -r kill 2>/dev/null
npm run dev > /tmp/phase3-frontend.log 2>&1 &
FE_PID=$!
sleep 6
grep -E "ready in" /tmp/phase3-frontend.log || { echo "frontend failed"; exit 1; }
```

- [ ] **Step 2: API 可达性冒烟（vite proxy）**

```bash
echo "=== routes reachable via vite proxy ==="
curl -s -o /dev/null -w "/api/knowledge-bases: %{http_code}\n" http://localhost:5173/api/knowledge-bases
curl -s -o /dev/null -w "/api/personas: %{http_code}\n" http://localhost:5173/api/personas
curl -s -o /dev/null -w "/chat (index): %{http_code}\n" http://localhost:5173/chat
curl -s -o /dev/null -w "/kb (index): %{http_code}\n" http://localhost:5173/kb
```

Expected: 全部 200。

- [ ] **Step 3: 浏览器手工路径（人类验证或跳过）**

- 访问 `/kb`：看到列表；点"新建"，填名称、描述，提交 → 列表出现新卡片
- 点一个卡片进 `/kb/:kbId`：
  - Documents tab：点上传选择一个 .md 文件，看到卡片状态 `processing` → `completed`；点文档展开看到 chunks + 启用开关
  - 点一个 chunk 的"禁用"开关：chunk 变灰
  - HitTest tab：输一个问题，点"检索"，看到 stage1 + stage2 两栏；点一个结果右下展开
  - Settings tab：拖 threshold、改 topK、保存；看到"保存"按钮变灰（无 dirty），改值又可点
  - Settings tab 底部点"删除"，确认，跳回 `/kb` 列表
- 顶部导航切回"对话"：原三栏仍可用（注意：DocsDrawer 的上传会静默失败，是 Phase 4 的工作）

- [ ] **Step 4: 停所有服务 + tag**

```bash
kill $FE_PID $BE_PID 2>/dev/null
wait $FE_PID $BE_PID 2>/dev/null
lsof -iTCP:5173 -sTCP:LISTEN -n -P && echo WARN_FE_ALIVE || echo fe_down
lsof -iTCP:3001 -sTCP:LISTEN -n -P && echo WARN_BE_ALIVE || echo be_down

cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git tag kb-phase3-done
git log --oneline kb-phase2-done..kb-phase3-done
```

Expected: 看到 9 个 commit（Task 1-9），tag 打上。

---

## 验收清单（Phase 3 完成条件）

- [ ] `/chat` 正常访问，ChatView 行为和 Phase 2 末一致
- [ ] `/kb` 列表页能看到所有 KB 卡片
- [ ] "新建"Modal 工作，创建后立刻出现在列表
- [ ] `/kb/:kbId` 能看到三 Tab：Documents / HitTest / Settings
- [ ] Documents：上传 .md 成功、文档展开显示 chunks、禁用 chunk 后下次检索不命中
- [ ] HitTest：输入 query 能看到 stage1 + stage2，点击结果展开完整内容
- [ ] Settings：改名/描述/retrievalConfig 保存成功；删除 KB 跳回列表
- [ ] 顶部导航 `[对话 | 知识库]` 切换正常，active 态正确
- [ ] 浏览器直接输入 `/kb`、`/kb/xxx` 能深链
- [ ] `npm run type-check` 通过，`npm run build` 能出 dist
- [ ] Tag `kb-phase3-done` 已打

---

## 风险与已知限制

| 风险 | 说明 | 处理 |
| --- | --- | --- |
| DocsDrawer 老 UI 在 Phase 3 末期是坏的 | 老抽屉里的上传、检索测试都调 `/api/knowledge/:personaId/*`，Phase 2 已全删 → 404；UI 层静默失败（uploadZone 状态不变） | Phase 4 专项处理。Phase 3 不在 plan 中覆盖 |
| `useKnowledge.ts` 仍然被 useAppController import | 其中 `fetchDocuments` 会一直返回空数组，不抛错 | 保持原状；Phase 4 删除 |
| 前端未做 toast 错误提示 | 上传失败时只改一个 `uploadError` ref | 够用，study project 不必引入统一 toast |
| 没有分页 | `/kb` 列表和 documents 列表都一次性拉全 | 学习项目数据量小，v2 再优化 |
| 没有搜索/过滤 | 多 KB 时需要滚找 | 同上 |

---

## 下一阶段

Phase 3 完成 + tag `kb-phase3-done` 后，运行 `superpowers:writing-plans` 写：

`docs/superpowers/plans/2026-04-17-kb-phase-4-chat-integration.md`

Phase 4 目标：`PersonaPanel` 挂载 Modal、`DocsDrawer` 瘦身为 KB 只读视图、消息引用气泡显示 KB 名、删除 `useKnowledge.ts`、清理旧 types。预计 1 天。
