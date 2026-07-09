<template>
  <main class="p-6 h-full overflow-y-auto bg-transparent box-border">
    <header class="flex items-center justify-between gap-4 mb-6 text-left">
      <div>
        <h2 class="m-0 text-xl font-extrabold text-text-main tracking-tight">知识库</h2>
        <p class="m-0 mt-1 text-xs text-text-muted">管理企业知识库资产，进入详情完成文档治理与检索验证。</p>
      </div>
      <button class="inline-flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-btn transition-all duration-200 hover:-translate-y-px hover:brightness-104 shrink-0" type="button" @click="createOpen = true">
        <PlusIcon :size="16" />
        <span>新建</span>
      </button>
    </header>

    <div v-if="store.list.length === 0 && !hook.listLoading.value" class="p-16 text-center text-text-muted border border-dashed border-slate-200/90 rounded-xl bg-white/60 backdrop-blur-md text-sm">
      还没有知识库，点右上角"新建"创建第一个
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
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
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import KnowledgeBaseCard from '@/components/knowledge-base/KnowledgeBaseCard.vue'
import KnowledgeBaseCreateModal from '@/components/knowledge-base/KnowledgeBaseCreateModal.vue'

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
/* 知识库主列表已完全使用 Tailwind CSS 原子类改造，无须 scoped style */
</style>
