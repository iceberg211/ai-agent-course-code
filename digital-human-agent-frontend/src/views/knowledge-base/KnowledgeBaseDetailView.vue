<template>
  <main class="p-8 px-6 h-full flex flex-col overflow-hidden bg-transparent text-left" v-if="kb">
    <div class="mb-5 flex flex-col gap-3">
      <RouterLink to="/kb" class="inline-flex items-center gap-1 text-xs font-semibold text-text-muted no-underline transition-all hover:text-primary hover:-translate-x-0.5">
        <ChevronLeftIcon :size="14" /> 知识库
      </RouterLink>
      <PageHeader
        eyebrow="知识库运营"
        :title="kb.name"
        :description="kb.description || '围绕单个知识库查看文档、健康、图谱、验证和配置。'"
      >
        <template #actions>
          <button class="inline-flex items-center justify-center min-w-[112px] h-10 px-5 border-none rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 text-white text-xs font-bold cursor-pointer shrink-0 shadow-btn transition-all duration-200 hover:-translate-y-[0.5px] hover:brightness-104 max-md:w-full" type="button" @click="goToChatValidation">
            去问答验证
          </button>
        </template>
      </PageHeader>
    </div>

    <nav class="flex gap-2 border-b border-border-main mb-5" role="tablist">
      <button
        v-for="t in tabs"
        :key="t.key"
        role="tab"
        :aria-selected="active === t.key"
        class="p-2 px-4 bg-transparent border-none border-b-3 border-transparent text-xs font-semibold text-text-secondary cursor-pointer transition-all -mb-[1px] hover:text-text-main"
        :class="active === t.key ? '!text-primary !border-b-primary !font-bold' : ''"
        @click="active = t.key"
      >
        {{ t.label }}
      </button>
    </nav>

    <section class="flex-1 overflow-y-auto min-h-0 bg-white border border-slate-200/80 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.015)] p-5">
      <OverviewTab v-if="active === 'overview'" :kb-id="kbId" />
      <DocumentsTab v-else-if="active === 'documents'" :kb-id="kbId" />
      <HealthTab v-else-if="active === 'health'" :kb-id="kbId" />
      <GraphTab v-else-if="active === 'graph'" :kb-id="kbId" />
      <HitTestTab v-else-if="active === 'hit-test'" :kb="kb" />
      <EvaluationTab v-else-if="active === 'evaluation'" :kb-id="kbId" />
      <PermissionsTab v-else-if="active === 'permissions'" :kb="kb" />
      <SettingsTab v-else-if="active === 'settings'" :kb="kb" @changed="onKbChanged" @deleted="onKbDeleted" />
    </section>
  </main>

  <main v-else-if="loading" class="p-8 px-6 h-full flex flex-col items-center justify-center text-text-muted">加载中…</main>
  <main v-else class="p-8 px-6 h-full flex flex-col items-center justify-center text-text-muted">知识库不存在或已删除</main>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeftIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import type { KnowledgeBase } from '@/types'
import OverviewTab from '@/components/knowledge-base/tabs/OverviewTab.vue'
import DocumentsTab from '@/components/knowledge-base/tabs/DocumentsTab.vue'
import HealthTab from '@/components/knowledge-base/tabs/HealthTab.vue'
import GraphTab from '@/components/knowledge-base/tabs/GraphTab.vue'
import HitTestTab from '@/components/knowledge-base/tabs/HitTestTab.vue'
import EvaluationTab from '@/components/knowledge-base/tabs/EvaluationTab.vue'
import PermissionsTab from '@/components/knowledge-base/tabs/PermissionsTab.vue'
import SettingsTab from '@/components/knowledge-base/tabs/SettingsTab.vue'
import PageHeader from '@/components/common/PageHeader.vue'

const props = defineProps<{ kbId: string }>()
const router = useRouter()
const hook = useKnowledgeBase()
const store = useKnowledgeBaseStore()

type TabKey = 'overview' | 'documents' | 'health' | 'graph' | 'hit-test' | 'evaluation' | 'permissions' | 'settings'
const tabs: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '库概览' },
  { key: 'documents', label: '资料管理' },
  { key: 'health', label: '召回健康度' },
  { key: 'graph', label: '知识图谱' },
  { key: 'hit-test', label: '检索调试' },
  { key: 'evaluation', label: '黄金回归测试' },
  { key: 'permissions', label: 'ACL 权限控制' },
  { key: 'settings', label: '库配置' },
]
const active = ref<TabKey>('overview')

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
/* 知识库详情页面已完全使用 Tailwind CSS 原子类改造，无须 scoped style */
</style>
