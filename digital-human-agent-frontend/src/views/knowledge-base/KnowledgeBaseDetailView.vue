<template>
  <main class="kb-detail" v-if="kb">
    <header class="kb-detail__head">
      <div>
        <RouterLink to="/kb" class="back"><ChevronLeftIcon :size="14" /> 知识库</RouterLink>
        <h2>{{ kb.name }}</h2>
        <p v-if="kb.description" class="kb-detail__desc">{{ kb.description }}</p>
      </div>
      <button class="btn-primary" type="button" @click="goToChatValidation">
        去问答验证
      </button>
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
      <HealthTab v-else-if="active === 'health'" :kb-id="kbId" />
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
import { KNOWLEDGE_BASE_DETAIL_TABS } from '@/common/constants'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import type { KnowledgeBase } from '@/types'
import DocumentsTab from '@/components/knowledge-base/tabs/DocumentsTab.vue'
import HealthTab from '@/components/knowledge-base/tabs/HealthTab.vue'
import HitTestTab from '@/components/knowledge-base/tabs/HitTestTab.vue'
import SettingsTab from '@/components/knowledge-base/tabs/SettingsTab.vue'

const props = defineProps<{ kbId: string }>()
const router = useRouter()
const hook = useKnowledgeBase()
const store = useKnowledgeBaseStore()

type TabKey = 'documents' | 'health' | 'hit-test' | 'settings'
const tabs: { key: TabKey; label: string }[] = KNOWLEDGE_BASE_DETAIL_TABS
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

function goToChatValidation() {
  router.push({
    path: '/chat',
    query: {
      knowledgeBaseId: props.kbId,
      openKnowledgeDrawer: '1',
    },
  })
}
</script>

<style scoped>
.kb-detail { 
  padding: 32px 24px; 
  height: 100%; 
  display: flex; 
  flex-direction: column; 
  overflow: hidden; 
  background: transparent;
}
.kb-detail--empty { align-items: center; justify-content: center; color: var(--text-muted); }
.kb-detail__head {
  margin-bottom: 20px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-decoration: none;
  margin-bottom: 8px;
  transition: all 0.2s ease;
}
.back:hover { 
  color: var(--primary); 
  transform: translateX(-2px);
}
.kb-detail__head h2 { 
  margin: 0 0 6px; 
  font-size: 24px; 
  font-weight: 800; 
  color: var(--text);
  letter-spacing: -0.02em;
}
.kb-detail__desc { 
  margin: 0; 
  color: var(--text-secondary); 
  font-size: 13px; 
  line-height: 1.6;
}
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 112px;
  height: 40px;
  padding: 0 20px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--primary-gradient);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  box-shadow: var(--shadow-btn);
  transition: all 0.2s ease;
}
.btn-primary:hover {
  background: var(--primary-hover);
  box-shadow: var(--shadow-btn-hover);
  transform: translateY(-1px);
}
.tabs { 
  display: flex; 
  gap: 8px; 
  border-bottom: 1px solid var(--border); 
  margin-bottom: 20px; 
}
.tab {
  padding: 8px 16px;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: -1px;
}
.tab:hover { 
  color: var(--text); 
}
.tab--active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 700;
}
.tab-body { 
  flex: 1; 
  overflow-y: auto; 
  min-height: 0; 
  background: #ffffff;
  border-radius: var(--radius-lg);
  border: 1px solid rgba(226, 232, 240, 0.8);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.015);
  padding: 20px;
}

@media (max-width: 720px) {
  .kb-detail__head {
    flex-direction: column;
    align-items: stretch;
  }
  .btn-primary {
    width: 100%;
  }
}
</style>
