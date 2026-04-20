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
          <span>{{ modeLabel(kb.retrievalConfig.retrievalMode) }}</span>
          <span>threshold {{ kb.retrievalConfig.threshold }}</span>
          <span>vector {{ kb.retrievalConfig.vectorTopK }}</span>
          <span>final {{ kb.retrievalConfig.finalTopK }}</span>
          <span v-if="kb.retrievalConfig.rerank" class="tag-rerank"
            >rerank</span
          >
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
import {
  BookOpenIcon,
  DatabaseIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-vue-next'
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

function modeLabel(mode: KnowledgeBase['retrievalConfig']['retrievalMode']) {
  const labels = {
    vector: '向量',
    keyword: '关键词',
    hybrid: '混合',
  }
  return labels[mode] ?? labels.vector
}
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
  transition:
    background-color 150ms ease-out,
    color 150ms ease-out;
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
