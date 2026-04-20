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
import DocumentsTab from '../../components/knowledge-base/tabs/DocumentsTab.vue'
import HitTestTab from '../../components/knowledge-base/tabs/HitTestTab.vue'
import SettingsTab from '../../components/knowledge-base/tabs/SettingsTab.vue'

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
