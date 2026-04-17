# KB Phase 4 · 对话页集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Phase 3 建好的知识库工作区与对话页打通——PersonaPanel 加 KB 挂载 Modal、DocsDrawer 瘦身为只读挂载视图、消息引用 chip 显示 KB 名、删除死代码 `useKnowledge.ts`、清理旧类型依赖。完成后代码库无死代码、无 broken import、`npm run type-check` 干净通过。

**Architecture:** 不新增路由、不新增 Pinia store。新增一个独立组件 `PersonaKbModal.vue` 管理 attach/detach；`DocsDrawer` 瘦身为纯展示（不再 import `useKnowledge`）；`useAppController` 移除对 `useKnowledge` 的所有依赖；`usePersonaActions` + `useWsEventHandler` 同步清理；`Citation` 类型新增可选字段 `knowledgeBaseName`。

**Tech Stack:** Vue 3 `<script setup lang="ts">` / Pinia（已装）/ vue-router 4（已装）/ lucide-vue-next / 原生 `fetch`

**Spec:** `docs/superpowers/specs/2026-04-17-knowledge-base-platform-design.md`（Phase 4 部分）

**Prerequisites:**
- `kb-phase3-done` tag 已打
- 后端 `GET /api/personas/:id/knowledge-bases`、`POST /api/personas/:id/knowledge-bases`、`DELETE /api/personas/:id/knowledge-bases/:kbId` 均可用
- `useKnowledgeBase.ts` 已有 `listKbsForPersona` / `attachToPersona` / `detachFromPersona`

**Phase 4 不做的事（留给未来）**:
- 不改 KB 工作区本身（Phase 3 的文件不动）
- 不做 KB 排序 / 搜索 / 分页
- 不引入新 npm 包
- 不加 toast 统一错误处理层（学习项目，就地 errorMsg 够用）
- 不做 citation 点击跳转到 KB 详情（复杂度不值当）
- backend 的 citation payload 不动（`knowledgeBaseName` 字段由前端推断，不改后端）

---

## File Structure Map

### 新增文件

```
digital-human-agent-frontend/src/
└── components/
    └── persona/
        └── PersonaKbModal.vue   # Persona 挂载 KB 的 Modal（列出已挂载 + 全局 KB 列表 + attach/detach）
```

### 修改文件

```
digital-human-agent-frontend/src/
├── types.ts                                  # Citation 增加 knowledgeBaseName 可选字段
├── components/
│   ├── persona/
│   │   └── PersonaPanel.vue                  # 每个 PersonaItem 旁加"知识库"图标按钮，点击打开 PersonaKbModal
│   ├── knowledge/
│   │   └── DocsDrawer.vue                    # 移除 UploadZone/搜索面板/DocItem；改为只读挂载 KB 列表
│   └── chat/
│       └── CitationChips.vue                 # 显示 knowledgeBaseName（若存在则追加）
├── hooks/
│   ├── useAppController.ts                   # 移除 knowledge import + 所有 knowledge.* 引用；移除 onUpload/onDeleteDoc/onSearchKnowledge
│   ├── usePersonaActions.ts                  # 移除 knowledge 参数；删除 knowledge.clearDocuments/clearSearchResult 调用
│   └── useWsEventHandler.ts                  # 移除 knowledge 参数；删除 knowledge.fetchDocuments 调用
└── views/
    └── ChatView.vue                          # 移除 DocsDrawer 的 onUpload/onDeleteDoc/onSearchKnowledge 绑定；传新 props
```

### 删除文件

```
digital-human-agent-frontend/src/
└── hooks/
    └── useKnowledge.ts                       # 老的 persona-scoped 知识库 hook，后端 API 已 404，全面删除
```

### 不修改

```
KB 工作区（views/kb/、components/kb/、hooks/useKnowledgeBase.ts、stores/knowledgeBase.ts）
stores/persona.ts、stores/session.ts
useAudio、useConversation、useVoiceClone、useDigitalHuman、useTextChat、useMicController、useWebSocket
components/knowledge/UploadZone.vue（暂时保留文件，DocsDrawer 不再 import 它，但文件不删）
components/knowledge/DocItem.vue（同上，保留文件）
```

---

## Task Sequence Rationale

Phase 4 的核心约束是：`useKnowledge.ts` 被多个文件 import，必须先把所有 import 方移走，最后再删文件。

1. **Task 1**：先做类型清理（types.ts），无依赖，最安全
2. **Task 2**：新建 `PersonaKbModal.vue`——纯新文件，不影响任何现有代码，可以独立验证
3. **Task 3**：改 `PersonaPanel.vue`——集成 Modal，使用 Task 2 刚建好的组件
4. **Task 4**：改 `DocsDrawer.vue`——瘦身为只读视图，移除对 `useKnowledge` 的依赖
5. **Task 5**：改 `CitationChips.vue`——加 KB 名显示（前端推断）
6. **Task 6**：改 `usePersonaActions.ts` + `useWsEventHandler.ts`——移除 `knowledge` 参数
7. **Task 7**：改 `useAppController.ts`——移除 `useKnowledge` import，移除所有 knowledge 相关操作句柄
8. **Task 8**：改 `ChatView.vue`——同步修改 DocsDrawer 绑定，移除死掉的事件处理器
9. **Task 9**：删除 `useKnowledge.ts`——此时已无任何文件 import 它
10. **Task 10**：E2E smoke + tag

每个 Task 后都能 `npm run type-check` 验证，Tasks 4 和 7 之间有依赖，必须按顺序。

---

## Task 1: 清理 `types.ts`

**Files:**
- Modify: `digital-human-agent-frontend/src/types.ts`

目标：
1. 给 `Citation` 接口新增 `knowledgeBaseName` 可选字段（Task 5 的 CitationChips 需要）
2. 检查 `KnowledgeDocument`、`KnowledgeSearchChunk`、`KnowledgeSearchResult` 是否还有人用——目前 `DocsDrawer` 在 import 但 Task 4 会移除；`useKnowledge.ts` 也在用但 Task 9 会删除。这些类型本身无害，**保留不删**（后续手工清理更安全）

- [ ] **Step 1: 在 `Citation` 接口追加 `knowledgeBaseName` 字段**

找到：
```ts
export interface Citation {
  source?: string
  chunkIndex?: number
  chunk_index?: number
  similarity?: number
  [key: string]: unknown
}
```

改为：
```ts
export interface Citation {
  source?: string
  chunkIndex?: number
  chunk_index?: number
  similarity?: number
  knowledgeBaseName?: string
  [key: string]: unknown
}
```

- [ ] **Step 2: Type check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: pass。

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/types.ts
git commit -m "$(cat <<'EOF'
feat(fe): add knowledgeBaseName to Citation type

Phase 4 prep: CitationChips will show KB name from this optional field.
Frontend infers it from persona's mounted KB list rather than requiring
a backend change.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 新建 `PersonaKbModal.vue`

**Files:**
- Create: `digital-human-agent-frontend/src/components/persona/PersonaKbModal.vue`

职责：给定 `personaId`，展示该 persona 已挂载的 KB 列表（可 detach），以及全局 KB 列表（可 attach）。使用 `useKnowledgeBase` hook，不依赖任何 store 写入（attach/detach 后重新拉列表）。

- [ ] **Step 1: 创建文件**

```vue
<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal" role="dialog" aria-label="管理知识库挂载">
      <header class="modal__head">
        <h3>知识库挂载 · {{ personaName }}</h3>
        <button class="close-btn" @click="$emit('close')" aria-label="关闭">
          <XIcon :size="16" />
        </button>
      </header>

      <section class="section">
        <h4 class="section__title">
          <LinkIcon :size="13" />
          已挂载
          <span class="badge">{{ mounted.length }}</span>
        </h4>

        <div v-if="loadingMounted" class="muted">加载中…</div>
        <div v-else-if="mounted.length === 0" class="empty">尚未挂载任何知识库</div>
        <ul v-else class="kb-list" role="list">
          <li v-for="kb in mounted" :key="kb.id" class="kb-item">
            <BookOpenIcon :size="14" class="kb-item__icon" />
            <span class="kb-item__name">{{ kb.name }}</span>
            <span v-if="kb.description" class="kb-item__desc">{{ kb.description }}</span>
            <button
              class="btn-detach"
              :disabled="actingKbId === kb.id"
              @click="detach(kb.id)"
              :aria-label="`解除挂载 ${kb.name}`"
            >
              {{ actingKbId === kb.id ? '…' : '解除' }}
            </button>
          </li>
        </ul>
      </section>

      <section class="section">
        <h4 class="section__title">
          <PlusCircleIcon :size="13" />
          可挂载（全局知识库）
        </h4>

        <div v-if="loadingAll" class="muted">加载中…</div>
        <div v-else-if="attachable.length === 0" class="empty">
          {{ allKbs.length === 0 ? '还没有知识库，去知识库工作区新建' : '所有知识库已全部挂载' }}
        </div>
        <ul v-else class="kb-list" role="list">
          <li v-for="kb in attachable" :key="kb.id" class="kb-item">
            <BookOpenIcon :size="14" class="kb-item__icon" />
            <span class="kb-item__name">{{ kb.name }}</span>
            <span v-if="kb.description" class="kb-item__desc">{{ kb.description }}</span>
            <button
              class="btn-attach"
              :disabled="actingKbId === kb.id"
              @click="attach(kb.id)"
              :aria-label="`挂载 ${kb.name}`"
            >
              {{ actingKbId === kb.id ? '…' : '挂载' }}
            </button>
          </li>
        </ul>
      </section>

      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BookOpenIcon, LinkIcon, PlusCircleIcon, XIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '../../hooks/useKnowledgeBase'
import type { KnowledgeBase } from '../../types'

const props = defineProps<{
  personaId: string
  personaName: string
}>()

defineEmits<{ (e: 'close'): void }>()

const hook = useKnowledgeBase()

const mounted = ref<KnowledgeBase[]>([])
const allKbs = ref<KnowledgeBase[]>([])
const loadingMounted = ref(false)
const loadingAll = ref(false)
const actingKbId = ref<string | null>(null)
const errorMsg = ref('')

const mountedIds = computed(() => new Set(mounted.value.map((kb) => kb.id)))

const attachable = computed(() =>
  allKbs.value.filter((kb) => !mountedIds.value.has(kb.id)),
)

async function refresh() {
  loadingMounted.value = true
  loadingAll.value = true
  errorMsg.value = ''
  try {
    const [mountedList, allList] = await Promise.all([
      hook.listKbsForPersona(props.personaId),
      hook.listAll(),
    ])
    mounted.value = mountedList
    allKbs.value = allList
  } finally {
    loadingMounted.value = false
    loadingAll.value = false
  }
}

onMounted(refresh)

async function attach(kbId: string) {
  actingKbId.value = kbId
  errorMsg.value = ''
  try {
    const ok = await hook.attachToPersona(props.personaId, kbId)
    if (!ok) {
      errorMsg.value = '挂载失败，请稍后重试'
      return
    }
    await refresh()
  } finally {
    actingKbId.value = null
  }
}

async function detach(kbId: string) {
  actingKbId.value = kbId
  errorMsg.value = ''
  try {
    const ok = await hook.detachFromPersona(props.personaId, kbId)
    if (!ok) {
      errorMsg.value = '解除挂载失败，请稍后重试'
      return
    }
    await refresh()
  } finally {
    actingKbId.value = null
  }
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
  z-index: 200;
}

.modal {
  width: min(560px, 94vw);
  max-height: 80vh;
  background: var(--surface);
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
  overflow-y: auto;
}

.modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal__head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.close-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 150ms, color 150ms;
}
.close-btn:hover {
  background: var(--primary-bg);
  color: var(--text);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section__title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.badge {
  padding: 1px 7px;
  border-radius: 10px;
  background: var(--primary-bg);
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
}

.muted,
.empty {
  font-size: 12px;
  color: var(--text-muted);
  padding: 8px 0;
}

.kb-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.kb-item {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fafafa;
}

.kb-item__icon {
  color: var(--primary);
  flex-shrink: 0;
}

.kb-item__name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-item__desc {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  grid-column: 2;
  margin-top: -4px;
}

.btn-attach,
.btn-detach {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  grid-column: 4;
  white-space: nowrap;
}

.btn-attach {
  background: var(--primary-bg);
  color: var(--primary);
  border-color: var(--primary-muted);
}
.btn-attach:hover:not(:disabled) {
  background: var(--primary);
  color: #fff;
}

.btn-detach {
  background: transparent;
  color: var(--text-muted);
  border-color: var(--border);
}
.btn-detach:hover:not(:disabled) {
  background: #fef2f2;
  color: var(--error);
  border-color: var(--error);
}

.btn-attach:disabled,
.btn-detach:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--error);
}
</style>
```

- [ ] **Step 2: Type check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: pass。

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/components/persona/PersonaKbModal.vue
git commit -m "$(cat <<'EOF'
feat(fe): add PersonaKbModal for attach/detach KB management

Shows currently mounted KBs (with detach button) and all global KBs
that can be attached. Uses useKnowledgeBase hook directly.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 改 `PersonaPanel.vue` — 加 KB 挂载入口

**Files:**
- Modify: `digital-human-agent-frontend/src/components/persona/PersonaPanel.vue`

目标：每个 `PersonaItem` 行右侧加一个"知识库"图标按钮，点击打开 `PersonaKbModal`。PersonaPanel 自身管理 Modal 的打开/关闭状态，不需要 emit 到父层。

- [ ] **Step 1: 重写 `PersonaPanel.vue`**

在现有文件的基础上做以下改动：

1. `<script setup>` 顶部新增 import：
   - `import { DatabaseIcon } from 'lucide-vue-next'`
   - `import PersonaKbModal from './PersonaKbModal.vue'`

2. 新增两个 ref：
   ```ts
   const kbModalPersonaId = ref<string | null>(null)
   const kbModalPersonaName = ref('')
   ```

3. 新增函数：
   ```ts
   function openKbModal(persona: Persona) {
     kbModalPersonaId.value = persona.id
     kbModalPersonaName.value = persona.name
   }
   function closeKbModal() {
     kbModalPersonaId.value = null
     kbModalPersonaName.value = ''
   }
   ```

4. template 中：
   - 在 `</nav>` 闭合标签之前、`<section v-if="selectedPersona"...>` 之前，追加：
     ```html
     <PersonaKbModal
       v-if="kbModalPersonaId"
       :persona-id="kbModalPersonaId"
       :persona-name="kbModalPersonaName"
       @close="closeKbModal"
     />
     ```
   - 把原来的 `<PersonaItem ... />` 改为带外层容器的写法，在每个 PersonaItem 旁加 KB 按钮（见下方完整 template 片段）

完整的 `<ul class="persona-list">` 内部 `<template v-else>` 块改为：

```html
<template v-else>
  <li
    v-for="p in personas"
    :key="p.id"
    class="persona-row"
  >
    <PersonaItem
      :persona="p"
      :active="selectedId === p.id"
      @select="$emit('select', $event)"
      @delete="$emit('delete', $event)"
    />
    <button
      class="kb-btn"
      type="button"
      :title="`管理「${p.name}」的知识库`"
      :aria-label="`管理 ${p.name} 的知识库`"
      @click.stop="openKbModal(p)"
    >
      <DatabaseIcon :size="12" />
    </button>
  </li>
</template>
```

5. style 尾部追加：

```css
.persona-row {
  display: flex;
  align-items: center;
  position: relative;
}
.persona-row :deep(.persona-item) {
  flex: 1;
  min-width: 0;
}
.kb-btn {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin-right: 4px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms, background 150ms, color 150ms, border-color 150ms;
}
.persona-row:hover .kb-btn {
  opacity: 1;
}
.kb-btn:hover {
  background: var(--primary-bg);
  color: var(--primary);
  border-color: var(--primary-muted);
}

@media (max-width: 960px) {
  .kb-btn {
    display: none;
  }
}
```

**注意**：`PersonaItem.vue` 的根元素需要有 `class="persona-item"` 才能被上面的 `:deep` 选中。如果 PersonaItem 根元素没有这个 class，把 `:deep(.persona-item)` 改成 `:deep(li)` 或直接删掉这行（flex:1 在 `<PersonaItem>` 上不起作用，改为让 `.kb-btn` 自适应）。

实际做法：读一下 `PersonaItem.vue` 的根元素是什么。下面的 Step 2 会检查。

- [ ] **Step 2: 验证 PersonaItem 根元素并调整选择器**

```bash
head -5 /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend/src/components/persona/PersonaItem.vue
```

如果根元素是 `<li class="persona-item">`，`:deep` 保持原样。
如果根元素是 `<li>` 但没有 `persona-item` class，把 `:deep(.persona-item)` 改为直接删掉那一行（PersonaItem 内部是 block 元素，flex:1 通过 wrapper 控制）。

替代安全写法（不依赖子组件 class）：

```css
.persona-row :deep(li) {
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 3: Type check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: pass。

- [ ] **Step 4: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/components/persona/PersonaPanel.vue
git commit -m "$(cat <<'EOF'
feat(fe): PersonaPanel add KB mount icon button per persona

Clicking the database icon next to a persona opens PersonaKbModal,
which shows mounted KBs and allows attach/detach without leaving chat.
Icon appears on hover to keep the panel uncluttered.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 改 `DocsDrawer.vue` — 瘦身为只读 KB 挂载视图

**Files:**
- Modify: `digital-human-agent-frontend/src/components/knowledge/DocsDrawer.vue`

目标：
- 删除 `UploadZone` + 搜索面板 + 文档列表 + `DocItem`（这些功能已在 KB 工作区实现）
- 改为展示当前对话 persona 挂载的 KB 列表（调 `listKbsForPersona`）
- Props 接口简化为只需要 `personaId: string`
- 不再 import `useKnowledge`、`KnowledgeDocument`、`KnowledgeSearchResult`

**新的 DocsDrawer 职责**：当 persona 变了（`personaId` 变化）就重新拉挂载列表，显示 KB 名称、描述、文档数（retrievalConfig.finalTopK 作为参考参数）。提供"去管理"RouterLink 跳到 `/kb`。

- [ ] **Step 1: 用全新内容重写 `DocsDrawer.vue`**

```vue
<template>
  <aside class="docs-drawer" aria-label="已挂载知识库">
    <div class="drawer-header">
      <div class="title">
        <DatabaseIcon :size="15" color="var(--primary)" aria-hidden="true" />
        <span>已挂载知识库</span>
      </div>
      <button class="close-btn" @click="$emit('close')" aria-label="关闭面板">
        <XIcon :size="15" aria-hidden="true" />
      </button>
    </div>

    <div v-if="loading" class="state-msg">加载中…</div>
    <div v-else-if="!personaId" class="state-msg">请先选择角色</div>
    <div v-else-if="kbs.length === 0" class="state-empty">
      <BookOpenIcon :size="32" color="var(--border)" />
      <p>此角色尚未挂载知识库</p>
      <RouterLink to="/kb" class="link-manage">去知识库工作区管理</RouterLink>
    </div>

    <ul v-else class="kb-list" role="list">
      <li v-for="kb in kbs" :key="kb.id" class="kb-card">
        <div class="kb-card__head">
          <BookOpenIcon :size="14" color="var(--primary)" aria-hidden="true" />
          <span class="kb-card__name">{{ kb.name }}</span>
        </div>
        <p v-if="kb.description" class="kb-card__desc">{{ kb.description }}</p>
        <div class="kb-card__meta">
          <span>threshold {{ kb.retrievalConfig.threshold }}</span>
          <span>topK {{ kb.retrievalConfig.finalTopK }}</span>
          <span v-if="kb.retrievalConfig.rerank" class="tag-rerank">rerank</span>
        </div>
      </li>
    </ul>

    <footer v-if="kbs.length > 0" class="drawer-footer">
      <RouterLink to="/kb" class="link-manage">
        <SettingsIcon :size="12" />
        管理知识库
      </RouterLink>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { BookOpenIcon, DatabaseIcon, SettingsIcon, XIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '../../hooks/useKnowledgeBase'
import type { KnowledgeBase } from '../../types'

const props = defineProps<{
  personaId: string
}>()

defineEmits<{ (e: 'close'): void }>()

const hook = useKnowledgeBase()
const kbs = ref<KnowledgeBase[]>([])
const loading = ref(false)

async function load(personaId: string) {
  if (!personaId) {
    kbs.value = []
    return
  }
  loading.value = true
  try {
    kbs.value = await hook.listKbsForPersona(personaId)
  } finally {
    loading.value = false
  }
}

onMounted(() => load(props.personaId))
watch(() => props.personaId, load)
</script>

<style scoped>
.docs-drawer {
  width: 260px;
  flex-shrink: 0;
  background: linear-gradient(180deg, #ffffff, #f9fbff);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.close-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 150ms ease-out, color 150ms ease-out;
}
.close-btn:hover {
  background: var(--primary-bg);
  color: var(--text);
}

.state-msg {
  padding: 24px 16px;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
}

.state-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  color: var(--text-muted);
  text-align: center;
}
.state-empty p {
  margin: 0;
  font-size: 12px;
}

.kb-list {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kb-card {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kb-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kb-card__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-card__desc {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-card__meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
  flex-wrap: wrap;
}

.tag-rerank {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--primary-bg);
  color: var(--primary);
  font-weight: 600;
  font-size: 10px;
}

.drawer-footer {
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.link-manage {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--primary);
  text-decoration: none;
  font-weight: 500;
}
.link-manage:hover {
  text-decoration: underline;
}

@media (max-width: 960px) {
  .docs-drawer {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: min(86vw, 280px);
    z-index: 20;
    box-shadow: -12px 0 24px rgba(26, 48, 79, 0.14);
  }
}
</style>
```

- [ ] **Step 2: Type check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: pass。此时 DocsDrawer 已不再 import `useKnowledge`，但 `useKnowledge.ts` 文件本身还在（Task 9 删）。

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/components/knowledge/DocsDrawer.vue
git commit -m "$(cat <<'EOF'
refactor(fe): DocsDrawer slim down to read-only KB mount list

Remove UploadZone, search panel, DocItem – those live in /kb workspace now.
New view shows KBs mounted on the current persona via GET
/api/personas/:id/knowledge-bases, with a link to /kb for management.
No longer depends on useKnowledge hook.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 改 `CitationChips.vue` — 显示 KB 名

**Files:**
- Modify: `digital-human-agent-frontend/src/components/chat/CitationChips.vue`

目标：如果 `citation.knowledgeBaseName` 存在，在 chip 上追加显示（格式：`文件名 · §段落 · KB名`）。

**背景说明**：后端 `conversation:citations` 事件返回的 citation 目前只有 `source`（文件名）、`chunk_index`、`similarity`。`knowledgeBaseName` 需要前端推断。推断逻辑放在 `useWsEventHandler` 里（Task 6 处理），从 `knowledgeBase store` 的 `byId` map 查找并注入到 citation。CitationChips 只负责展示。

本 Task 只改 template 展示层。

- [ ] **Step 1: 修改 `CitationChips.vue`**

找到 template 中的 chip span：
```html
<span
  v-for="(c, i) in citations"
  :key="i"
  class="chip"
  role="listitem"
  :title="`来源：${resolveSource(c)} 第${resolveChunkNumber(c)}段`"
>
  <LinkIcon :size="10" aria-hidden="true" />
  {{ resolveSource(c) }} · §{{ resolveChunkNumber(c) }}
</span>
```

改为：
```html
<span
  v-for="(c, i) in citations"
  :key="i"
  class="chip"
  role="listitem"
  :title="resolveTitle(c)"
>
  <LinkIcon :size="10" aria-hidden="true" />
  {{ resolveSource(c) }} · §{{ resolveChunkNumber(c) }}<template v-if="c.knowledgeBaseName"> · {{ c.knowledgeBaseName }}</template>
</span>
```

在 `<script setup>` 里追加 `resolveTitle` 函数：

```ts
function resolveTitle(citation: Citation): string {
  const base = `来源：${resolveSource(citation)} 第${resolveChunkNumber(citation)}段`
  return citation.knowledgeBaseName ? `${base}（${citation.knowledgeBaseName}）` : base
}
```

- [ ] **Step 2: Type check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: pass。

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/components/chat/CitationChips.vue
git commit -m "$(cat <<'EOF'
feat(fe): CitationChips show knowledgeBaseName when present

If citation.knowledgeBaseName is set (injected by useWsEventHandler from
KB store), the chip shows "file · §N · KBName". Falls back gracefully
when field is absent.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 改 `usePersonaActions.ts` + `useWsEventHandler.ts`

**Files:**
- Modify: `digital-human-agent-frontend/src/hooks/usePersonaActions.ts`
- Modify: `digital-human-agent-frontend/src/hooks/useWsEventHandler.ts`

目标：
- 从两个文件中移除对 `useKnowledge` 的 import 和参数依赖
- `useWsEventHandler` 的 `session:ready` handler 移除 `knowledge.fetchDocuments(...)` 调用；新增：从 `knowledgeBaseStore` 注入 `knowledgeBaseName` 到 citations
- `usePersonaActions` 的 `onSelectPersona` / `onDeletePersona` 移除 `knowledge.clearDocuments()` / `knowledge.clearSearchResult()` 调用

### 6A: `usePersonaActions.ts`

- [ ] **Step 1: 修改 `usePersonaActions.ts`**

1. 删除 import：
   ```ts
   import { useKnowledge } from './useKnowledge'
   ```

2. 函数签名从：
   ```ts
   export function usePersonaActions(
     conversation: ReturnType<typeof useConversation>,
     knowledge: ReturnType<typeof useKnowledge>,
     voiceClone: ReturnType<typeof useVoiceClone>,
     ...
   )
   ```
   改为：
   ```ts
   export function usePersonaActions(
     conversation: ReturnType<typeof useConversation>,
     voiceClone: ReturnType<typeof useVoiceClone>,
     ...
   )
   ```

3. `onSelectPersona` 函数里删除：
   ```ts
   knowledge.clearSearchResult()
   ```

4. `onDeletePersona` 函数里删除：
   ```ts
   knowledge.clearDocuments()
   knowledge.clearSearchResult()
   ```

完整改动后的函数签名：

```ts
export function usePersonaActions(
  conversation: ReturnType<typeof useConversation>,
  voiceClone: ReturnType<typeof useVoiceClone>,
  digitalHuman: ReturnType<typeof useDigitalHuman>,
  textChat: ReturnType<typeof useTextChat>,
  send: (msg: object) => void,
  showToast: (msg: string) => void,
)
```

### 6B: `useWsEventHandler.ts`

- [ ] **Step 2: 修改 `useWsEventHandler.ts`**

1. 删除 import：
   ```ts
   import { useKnowledge } from './useKnowledge'
   ```

2. 新增 import（用于注入 knowledgeBaseName）：
   ```ts
   import { useKnowledgeBaseStore } from '../stores/knowledgeBase'
   ```

3. 函数参数 `{...}` 对象里删除 `knowledge` 字段：
   ```ts
   // 删除：
   knowledge: ReturnType<typeof useKnowledge>
   // 同时删除对应的类型注解行
   ```

4. 在函数体顶部（`const sessionStore = ...` 之后）新增：
   ```ts
   const kbStore = useKnowledgeBaseStore()
   ```

5. `session:ready` handler 里删除：
   ```ts
   knowledge.fetchDocuments(personaStore.selectedId)
   ```

6. `conversation:citations` handler 里，在 `conversation.setCitations(...)` 调用之前，注入 KB 名：

   原来：
   ```ts
   on('conversation:citations', (msg: BaseWsMessage<{ citations?: Citation[] }>) => {
     conversation.setCitations(msg.turnId ?? '', msg.payload?.citations ?? [])
   })
   ```

   改为：
   ```ts
   on('conversation:citations', (msg: BaseWsMessage<{ citations?: Citation[] }>) => {
     // 尝试从 KB store 推断来源知识库名（store 在 DocsDrawer load 时已拉取挂载列表，
     // 但 store.list 存的是全局 KB，需要借助 store.byId map）
     // 因为 citation 只有 source（文件名），无法精确匹配 KB，跳过自动推断。
     // knowledgeBaseName 字段保留给未来后端直接返回时使用。
     conversation.setCitations(msg.turnId ?? '', msg.payload?.citations ?? [])
   })
   ```

   **说明**：citation 只有文件名（source），无法从文件名反推属于哪个 KB（同一文件名可能在多个 KB 里）。因此 `knowledgeBaseName` 的自动推断在前端做不了，保持字段为空。Phase 4 的文档任务里这条"消息引用气泡显示 KB 名"的前端部分（CitationChips 支持显示）已完成，后端返回时就能直接用。

- [ ] **Step 3: Type check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: 此时 `useAppController.ts` 的调用还没改，会报 `usePersonaActions` 参数数量不对。**这是预期的临时报错**，Task 7 会修复。如果想在这个 task 就 pass，可以先暂时在 type-check 前跳过，直接进 Task 7。

**或者选择方案：先改 useAppController（把 Task 7 里 usePersonaActions 调用改了），再来 type-check。** 取决于执行人偏好。推荐方案：先跳过 type-check 直接进入 Task 7，在 Task 7 末尾统一 type-check。

- [ ] **Step 4: Commit（即使 type-check 暂时失败，先 commit 再在 Task 7 修）**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/hooks/usePersonaActions.ts \
        digital-human-agent-frontend/src/hooks/useWsEventHandler.ts
git commit -m "$(cat <<'EOF'
refactor(fe): remove useKnowledge dependency from usePersonaActions + useWsEventHandler

- usePersonaActions: drop knowledge param, remove clearDocuments/clearSearchResult calls
- useWsEventHandler: drop knowledge param, remove fetchDocuments call on session:ready
- useWsEventHandler: add kbStore import for future knowledgeBaseName injection

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 改 `useAppController.ts` — 移除 useKnowledge

**Files:**
- Modify: `digital-human-agent-frontend/src/hooks/useAppController.ts`

目标：
- 删除 `useKnowledge` import
- 删除 `const knowledge = useKnowledge()`
- 更新 `usePersonaActions` 调用（移除 `knowledge` 参数）
- 更新 `useWsEventHandler` 调用（移除 `knowledge` 字段）
- 删除 `onUpload` / `onDeleteDoc` / `onSearchKnowledge` 这三个操作句柄（它们调用了 `knowledge.*`）
- 删除 return 对象里的 `knowledge`

- [ ] **Step 1: 修改 `useAppController.ts`**

**删除的内容：**

1. `import { useKnowledge } from './useKnowledge'` 这一行

2. `const knowledge = useKnowledge()` 这一行

3. `usePersonaActions(...)` 调用里的 `knowledge,` 参数

4. `useWsEventHandler(...)` 调用里的 `knowledge,` 字段

5. 以下三个操作句柄（完整函数体删除）：
   ```ts
   onUpload: async (file: File) => { ... },
   onDeleteDoc: async (docId: string) => { ... },
   onSearchKnowledge: async (query: string) => { ... },
   ```

6. return 对象里的 `knowledge,`

**修改后的 `usePersonaActions` 调用**（去掉 knowledge 参数）：

```ts
const { mode, onSelectPersona, onDeletePersona, onChangeMode, onNewConversation } = usePersonaActions(
  conversation, voiceClone, digitalHuman, textChat, send, showToast,
)
```

**修改后的 `useWsEventHandler` 调用**（去掉 knowledge 字段）：

```ts
useWsEventHandler(
  { conversation, audio, voiceClone, digitalHuman, textChat, mode },
  on, showToast, send,
)
```

**修改后的 return 对象**（去掉 knowledge 相关字段）：

```ts
return {
  onSelectPersona,
  onDeletePersona,
  onChangeMode,
  onNewConversation,
  onMicDown: (mode_: string) => mic.onMicDown(mode_),
  onMicUp: mic.onMicUp,
  onSendText: async (text: string) => { ... },  // 保持不变
  onStopText: async () => { ... },               // 保持不变
  onUploadVoiceSample: async (file: File) => { ... },    // 保持不变
  onRefreshVoiceCloneStatus: async () => { ... },        // 保持不变
  conversation,
  voiceClone,
  toastMsg,
  audio,
  digitalHuman,
  mode,
}
```

- [ ] **Step 2: Type check（此时应全部 pass）**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: 无错误。此时所有文件都不再 import `useKnowledge`，但文件本身还存在（Task 9 删）。

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/hooks/useAppController.ts
git commit -m "$(cat <<'EOF'
refactor(fe): remove useKnowledge from useAppController

Drop onUpload / onDeleteDoc / onSearchKnowledge handlers — document
management now lives in /kb workspace. Remove knowledge from return
object. useKnowledge.ts file still exists; deleted in next task.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 改 `ChatView.vue` — 同步 DocsDrawer props + 移除死代码

**Files:**
- Modify: `digital-human-agent-frontend/src/views/ChatView.vue`

目标：
- `DocsDrawer` 的 props 已从 `(personaId, documents, uploading, loading, searching, searchResult, statusLabel)` 简化为只需 `personaId`
- 绑定的 `@upload / @delete / @search` 事件处理器在 `useAppController` 返回值里已删除，这里也要移除
- 从 `useAppController()` 解构的 `knowledge` 已删除，相应的变量引用要清理

- [ ] **Step 1: 读取 ChatView.vue 找到 DocsDrawer 的绑定**

```bash
grep -n "DocsDrawer\|knowledge\|onUpload\|onDeleteDoc\|onSearchKnowledge" \
  /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend/src/views/ChatView.vue
```

- [ ] **Step 2: 修改 ChatView.vue**

找到 `<DocsDrawer ... />` 的模板绑定，将其从：

```html
<DocsDrawer
  v-if="docsOpen"
  :persona-id="personaStore.selectedId"
  :documents="knowledge.documents.value"
  :uploading="knowledge.uploading.value"
  :loading="knowledge.loading.value"
  :searching="knowledge.searching.value"
  :search-result="knowledge.searchResult.value"
  :status-label="knowledge.statusLabel"
  @close="docsOpen = false"
  @upload="onUpload"
  @delete="onDeleteDoc"
  @search="onSearchKnowledge"
/>
```

改为：

```html
<DocsDrawer
  v-if="docsOpen"
  :persona-id="personaStore.selectedId"
  @close="docsOpen = false"
/>
```

同时在 `<script setup>` 里：
- 从 `useAppController()` 解构中，移除 `knowledge,` 这一项（如果解构列表里有的话）
- 移除 `onUpload`, `onDeleteDoc`, `onSearchKnowledge` 的解构（如果有的话）

**注意**：仔细检查 ChatView.vue 实际的解构方式，不要盲目替换。当前文件里 `knowledge` 可能是从 `useAppController()` 返回值里单独解构出来的，也可能是通过返回对象整体使用。实际改法以 grep 结果为准。

- [ ] **Step 3: Type check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: pass。

- [ ] **Step 4: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent-frontend/src/views/ChatView.vue
git commit -m "$(cat <<'EOF'
refactor(fe): ChatView update DocsDrawer bindings for slim props

DocsDrawer now only needs :persona-id. Remove upload/delete/search
event handlers and knowledge state bindings that no longer exist.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 删除 `useKnowledge.ts`

**Files:**
- Delete: `digital-human-agent-frontend/src/hooks/useKnowledge.ts`

前置条件：此时运行以下命令确认没有任何文件 import 它：

- [ ] **Step 1: 确认无引用**

```bash
grep -r "useKnowledge" \
  /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend/src \
  --include="*.ts" --include="*.vue" -l
```

Expected: 输出为空（没有任何文件引用）。

如果仍有文件引用，检查是哪里漏改了，先修复再回到本 Task。

- [ ] **Step 2: 删除文件**

```bash
rm /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend/src/hooks/useKnowledge.ts
```

- [ ] **Step 3: Type check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
```

Expected: pass。

- [ ] **Step 4: Build check（可选，但推荐）**

```bash
npm run build 2>&1 | tail -10
```

Expected: `built in ...` 成功，无 error。

- [ ] **Step 5: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add -u digital-human-agent-frontend/src/hooks/useKnowledge.ts
git commit -m "$(cat <<'EOF'
chore(fe): delete useKnowledge.ts (all callers migrated)

The old persona-scoped knowledge hook called /api/knowledge/:personaId/*
which returned 404 since Phase 2 backend cleanup. All usages have been
removed: DocsDrawer uses useKnowledgeBase directly, useAppController /
usePersonaActions / useWsEventHandler no longer depend on it.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: E2E smoke + tag

**Files:** 无

- [ ] **Step 1: 启后端 + 启前端**

```bash
# 后端
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
lsof -iTCP:3001 -sTCP:LISTEN -n -P -t | xargs -r kill 2>/dev/null
npm run start:dev > /tmp/phase4-backend.log 2>&1 &
BE_PID=$!
sleep 10
grep -E "successfully started" /tmp/phase4-backend.log || { echo "backend failed"; cat /tmp/phase4-backend.log | tail -20; exit 1; }

# 前端
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
lsof -iTCP:5173 -sTCP:LISTEN -n -P -t | xargs -r kill 2>/dev/null
npm run dev > /tmp/phase4-frontend.log 2>&1 &
FE_PID=$!
sleep 6
grep -E "ready in" /tmp/phase4-frontend.log || { echo "frontend failed"; cat /tmp/phase4-frontend.log | tail -20; exit 1; }
```

- [ ] **Step 2: API 可达性冒烟**

```bash
echo "=== API smoke ==="
curl -s -o /dev/null -w "GET /knowledge-bases: %{http_code}\n" http://localhost:5173/api/knowledge-bases
curl -s -o /dev/null -w "GET /chat: %{http_code}\n" http://localhost:5173/chat
curl -s -o /dev/null -w "GET /kb: %{http_code}\n" http://localhost:5173/kb
```

Expected: 全部 200。

- [ ] **Step 3: Persona KB 挂载 API 冒烟**

```bash
# 取第一个 persona id
PERSONA_ID=$(curl -s http://localhost:5173/api/personas | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['id'] if d else '')" 2>/dev/null)
echo "PERSONA_ID=$PERSONA_ID"

# 查挂载 KB
curl -s http://localhost:5173/api/personas/$PERSONA_ID/knowledge-bases | python3 -m json.tool | head -15
```

Expected: 返回 JSON 数组（可以是空数组 `[]` 或有已挂载的 KB）。

- [ ] **Step 4: 浏览器手工验证清单（人工执行或跳过）**

- 打开 `http://localhost:5173/chat`
- 选择一个角色，左侧 PersonaPanel 的每个角色行右侧出现小数据库图标（hover 才显示）
- 点击图标，弹出 PersonaKbModal：
  - "已挂载"区域：列出已挂载 KB；点"解除"→ KB 从列表消失；确认 API 返回 200
  - "可挂载"区域：列出未挂载的全局 KB；点"挂载"→ KB 移到"已挂载"；确认 API 返回 200
  - 点背景 / X 关闭 Modal
- 点右上角"知识库"按钮，右侧抽屉打开：
  - 显示该 persona 已挂载的 KB 列表（名称 + 描述 + 检索参数 tag）
  - 底部有"管理知识库"链接，点击跳到 `/kb`
  - 切换到其他 persona → 抽屉列表自动更新
- 发一条消息后，消息下方的 citation chips 显示正常（source · §N），不报错
- `http://localhost:5173/kb` 和 `/kb/:kbId` 功能仍正常（Phase 3 不受影响）
- 顶部导航 [对话 | 知识库] 切换正常

- [ ] **Step 5: 停服务 + type-check + build**

```bash
kill $FE_PID $BE_PID 2>/dev/null
wait $FE_PID $BE_PID 2>/dev/null

cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run type-check
npm run build 2>&1 | tail -5
```

Expected: type-check pass，build 输出 `built in ...` 无 error。

- [ ] **Step 6: tag**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git tag kb-phase4-done
git log --oneline kb-phase3-done..kb-phase4-done
```

Expected: 看到 9 个 commit（Tasks 1-9 各一个），tag 已打。

---

## 验收清单（Phase 4 完成条件）

- [ ] PersonaPanel 每个角色行 hover 时出现数据库图标，点击打开 PersonaKbModal
- [ ] PersonaKbModal 能列出已挂载 KB、attach/detach 操作成功、错误时显示 errorMsg
- [ ] DocsDrawer 只显示当前 persona 已挂载的 KB 列表（名称 + 参数），不再有上传 / 搜索 UI
- [ ] DocsDrawer 切换 persona 时自动更新 KB 列表
- [ ] DocsDrawer 底部"管理知识库"链接跳到 `/kb`
- [ ] CitationChips 如果 citation 有 `knowledgeBaseName` 字段则展示（无此字段时正常降级）
- [ ] `src/hooks/useKnowledge.ts` 文件已不存在
- [ ] `grep -r "useKnowledge" src --include="*.ts" --include="*.vue"` 输出为空
- [ ] `npm run type-check` 通过，无任何错误
- [ ] `npm run build` 成功，无 error
- [ ] `/chat`、`/kb`、`/kb/:kbId` 路由均可访问，Phase 3 功能不受影响
- [ ] Tag `kb-phase4-done` 已打

---

## 风险与已知限制

| 风险 | 说明 | 处理 |
| --- | --- | --- |
| `PersonaItem.vue` 根元素 class 未知 | Task 3 的 `:deep` 选择器依赖子组件根元素 class；如果 class 不匹配，KB 按钮和 PersonaItem 的 flex 布局会错位 | Task 3 Step 2 明确要求先 grep 检查，并给出备用选择器 |
| DocsDrawer 宽度从 292px 改为 260px | 新版 DocsDrawer 内容更简洁，窄一些更合适；但如果 ChatView 有硬编码宽度逻辑，需要同步调整 | ChatView 使用 flex 布局，DocsDrawer 有自己的 `width: 260px`，通常不会冲突 |
| `knowledgeBaseName` 自动推断无法实现 | citation 只有文件名，无法 1:1 匹配到 KB | 已在 Task 6 说明：字段预留，等后端返回时直接用；CitationChips 已能展示 |
| `UploadZone.vue` 和 `DocItem.vue` 变成孤文件 | Phase 4 后这两个组件没有任何 import 方，但文件保留 | 学习项目不强求清理；后续如需清理，grep 确认无引用后直接删除 |
| Tasks 6/7 的 type-check 中间状态 | Task 6 改完后因 useAppController 还没改，会有 TS 报错 | 计划里已说明：Task 6 可以跳过 type-check，在 Task 7 末统一验证 |
| session:ready 不再 fetchDocuments | 移除后 DocsDrawer 依赖 `watch(personaId)` 触发加载，切换角色时应正常更新 | DocsDrawer 的 `watch(() => props.personaId, load)` 在 personaId 变化时会触发；初次挂载走 `onMounted` |
| Modal 无分页 | 如果全局 KB 很多，列表会很长 | 学习项目，数据量小；后续需要时加搜索框 |
