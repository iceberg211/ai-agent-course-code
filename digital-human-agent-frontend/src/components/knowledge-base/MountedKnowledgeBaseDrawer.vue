<template>
  <aside class="docs-drawer" aria-label="知识库挂载">
    <div class="drawer-header">
      <div class="title">
        <DatabaseIcon :size="15" color="var(--primary)" aria-hidden="true" />
        <div>
          <span>知识库挂载</span>
          <p class="subtitle">{{ personaName ? `当前角色：${personaName}` : '请选择角色后再挂载知识库' }}</p>
        </div>
      </div>
      <button class="close-btn" @click="$emit('close')" aria-label="关闭面板">
        <XIcon :size="15" aria-hidden="true" />
      </button>
    </div>

    <div class="drawer-body">
      <section
        v-if="focusSummary"
        class="focus-summary"
        :class="`focus-summary--${focusSummary.tone}`"
      >
        <div class="focus-summary__icon" aria-hidden="true">
          <SparklesIcon v-if="focusSummary.tone === 'active'" :size="16" />
          <TriangleAlertIcon v-else :size="16" />
        </div>
        <div class="focus-summary__copy">
          <p class="focus-summary__eyebrow">本次验证</p>
          <h3>{{ focusSummary.title }}</h3>
          <p>{{ focusSummary.description }}</p>
        </div>
      </section>

      <div v-if="loading" class="state-msg">加载中…</div>
      <div v-else-if="!personaId" class="state-empty">
        <BookOpenIcon :size="32" color="var(--border)" />
        <p>先选择一个角色，再为它挂载知识库</p>
      </div>
      <template v-else>
        <section class="drawer-section">
          <div class="section-head">
            <div class="section-title">
              <BookOpenIcon :size="14" color="var(--primary)" aria-hidden="true" />
              <span>已挂载</span>
              <strong class="count">{{ mounted.length }}</strong>
            </div>
          </div>

          <div v-if="mounted.length === 0" class="state-msg state-msg--section">
            当前角色还没有挂载知识库
          </div>
          <ul v-else class="kb-list" role="list">
            <li v-for="kb in mountedDisplay" :key="kb.id" class="kb-card">
              <div class="kb-card__content">
                <div class="kb-card__head">
                  <span class="kb-card__name">{{ kb.name }}</span>
                  <span
                    v-if="kb.id === props.focusKnowledgeBaseId"
                    class="kb-badge"
                  >
                    当前验证
                  </span>
                </div>
                <p v-if="kb.description" class="kb-card__desc">{{ kb.description }}</p>
                <div class="kb-card__meta">
                  <span>threshold {{ kb.retrievalConfig.threshold }}</span>
                  <span>topK {{ kb.retrievalConfig.finalTopK }}</span>
                  <span v-if="kb.retrievalConfig.rerank" class="tag-rerank">rerank</span>
                </div>
              </div>
              <button
                class="kb-action kb-action--detach"
                type="button"
                :disabled="actingKbId === kb.id"
                @click="detach(kb.id)"
              >
                {{ actingKbId === kb.id ? '处理中…' : '解除' }}
              </button>
            </li>
          </ul>
        </section>

        <section class="drawer-section">
          <div class="section-head">
            <div class="section-title">
              <SettingsIcon :size="14" color="var(--text-muted)" aria-hidden="true" />
              <span>可挂载知识库</span>
              <strong class="count">{{ attachable.length }}</strong>
            </div>
            <RouterLink to="/kb" class="link-manage">进入工作区</RouterLink>
          </div>

          <div v-if="attachable.length === 0" class="state-msg state-msg--section">
            {{ allKbs.length === 0 ? '还没有知识库，先去工作区创建' : '当前没有可新增挂载的知识库' }}
          </div>
          <ul v-else class="kb-list" role="list">
            <li v-for="kb in attachable" :key="kb.id" class="kb-card">
              <div class="kb-card__content">
                <div class="kb-card__head">
                  <span class="kb-card__name">{{ kb.name }}</span>
                  <span
                    v-if="kb.id === props.focusKnowledgeBaseId"
                    class="kb-badge kb-badge--warning"
                  >
                    待验证
                  </span>
                </div>
                <p v-if="kb.description" class="kb-card__desc">{{ kb.description }}</p>
              </div>
              <button
                class="kb-action kb-action--attach"
                type="button"
                :disabled="actingKbId === kb.id"
                @click="attach(kb.id)"
              >
                {{ actingKbId === kb.id ? '处理中…' : '挂载' }}
              </button>
            </li>
          </ul>
        </section>

        <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  BookOpenIcon,
  DatabaseIcon,
  SettingsIcon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import type { KnowledgeBase } from '@/types'

const props = defineProps<{
  personaId: string
  personaName?: string
  focusKnowledgeBaseId?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'changed'): void
}>()

const hook = useKnowledgeBase()
const mounted = ref<KnowledgeBase[]>([])
const allKbs = ref<KnowledgeBase[]>([])
const loading = ref(false)
const actingKbId = ref<string | null>(null)
const errorMsg = ref('')

const attachable = computed(() => {
  const mountedIds = new Set(mounted.value.map((kb) => kb.id))
  return sortKnowledgeBases(allKbs.value.filter((kb) => !mountedIds.has(kb.id)))
})

const mountedDisplay = computed(() => sortKnowledgeBases(mounted.value))

const focusSummary = computed(() => {
  const focusId = props.focusKnowledgeBaseId
  if (!focusId) return null

  const mountedTarget = mounted.value.find((kb) => kb.id === focusId)
  if (mountedTarget) {
    return {
      tone: 'active' as const,
      title: `当前正在验证：${mountedTarget.name}`,
      description: '这份知识库已经参与当前会话检索。现在回到对话区提问，就能直接观察回答与引用效果。',
    }
  }

  const pendingTarget = allKbs.value.find((kb) => kb.id === focusId)
  return {
    tone: 'warning' as const,
    title: `待挂载验证：${pendingTarget?.name ?? '目标知识库'}`,
    description: '目标知识库还没有参与当前会话。先在下方点击“挂载”，再回到对话中提问，验证结果才会准确。',
  }
})

async function load(personaId: string) {
  errorMsg.value = ''
  if (!personaId) {
    mounted.value = []
    allKbs.value = []
    return
  }
  loading.value = true
  try {
    const [mountedList, allList] = await Promise.all([
      hook.listKbsForPersona(personaId),
      hook.listAll(),
    ])
    mounted.value = mountedList
    allKbs.value = allList
  } finally {
    loading.value = false
  }
}

async function attach(kbId: string) {
  if (!props.personaId) return
  actingKbId.value = kbId
  errorMsg.value = ''
  try {
    const ok = await hook.attachToPersona(props.personaId, kbId)
    if (!ok) {
      errorMsg.value = '挂载失败，请稍后重试'
      return
    }
    await load(props.personaId)
    emit('changed')
  } finally {
    actingKbId.value = null
  }
}

async function detach(kbId: string) {
  if (!props.personaId) return
  actingKbId.value = kbId
  errorMsg.value = ''
  try {
    const ok = await hook.detachFromPersona(props.personaId, kbId)
    if (!ok) {
      errorMsg.value = '解除挂载失败，请稍后重试'
      return
    }
    await load(props.personaId)
    emit('changed')
  } finally {
    actingKbId.value = null
  }
}

function sortKnowledgeBases(items: KnowledgeBase[]) {
  const focusId = props.focusKnowledgeBaseId
  if (!focusId) return items
  return [...items].sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId))
}

onMounted(() => load(props.personaId))
watch(() => props.personaId, load)
</script>

<style scoped>
.docs-drawer {
  width: 320px;
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

.drawer-body {
  flex: 1;
  overflow-y: auto;
}

.focus-summary {
  margin: 14px 16px 0;
  padding: 12px 12px 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(191, 219, 254, 0.92);
  background:
    radial-gradient(circle at top right, rgba(191, 219, 254, 0.14), transparent 32%),
    linear-gradient(180deg, #ffffff, #f7fbff);
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.focus-summary--warning {
  border-color: rgba(251, 191, 36, 0.32);
  background:
    radial-gradient(circle at top right, rgba(251, 191, 36, 0.14), transparent 32%),
    linear-gradient(180deg, #fffef7, #fff9ef);
}

.focus-summary__icon {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-bg);
  color: var(--primary);
}

.focus-summary--warning .focus-summary__icon {
  background: #fff7ed;
  color: #b45309;
}

.focus-summary__copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.focus-summary__eyebrow {
  margin: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.focus-summary__copy h3 {
  margin: 0;
  font-size: 13px;
  color: var(--text);
}

.focus-summary__copy p:last-child {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.title {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  color: var(--text);
}
.title > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.title span {
  font-size: 14px;
  font-weight: 600;
}
.subtitle {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
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
.state-msg--section {
  padding: 12px 4px 6px;
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

.drawer-section {
  padding: 14px 16px 0;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.section-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.count {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--primary-bg);
  color: var(--primary);
  font-size: 11px;
}

.kb-list {
  list-style: none;
  margin: 0;
  padding: 0;
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
  align-items: flex-start;
  gap: 10px;
}

.kb-card__content {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kb-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.kb-card__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
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

.kb-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--primary-bg);
  color: var(--primary);
  font-size: 10px;
  font-weight: 700;
}

.kb-badge--warning {
  background: #fff7ed;
  color: #b45309;
}

.kb-action {
  flex-shrink: 0;
  min-width: 52px;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.kb-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.kb-action--attach {
  background: var(--primary-bg);
  color: var(--primary);
  border-color: var(--primary-muted);
}
.kb-action--attach:hover:not(:disabled) {
  background: var(--primary);
  color: #fff;
}
.kb-action--detach {
  background: transparent;
  color: var(--text-muted);
  border-color: var(--border);
}
.kb-action--detach:hover:not(:disabled) {
  background: #fef2f2;
  color: var(--error);
  border-color: var(--error);
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

.error-msg {
  margin: 14px 16px 16px;
  font-size: 12px;
  color: var(--error);
}

@media (max-width: 960px) {
  .docs-drawer {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: min(88vw, 320px);
    z-index: 20;
    box-shadow: -12px 0 24px rgba(26, 48, 79, 0.14);
  }
}
</style>
