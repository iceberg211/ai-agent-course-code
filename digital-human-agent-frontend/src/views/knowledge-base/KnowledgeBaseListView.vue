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
.kb-list { 
  padding: 32px 24px; 
  height: 100%; 
  overflow-y: auto; 
  background: transparent;
}
.kb-list__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.kb-list__head h2 { 
  margin: 0; 
  font-size: 24px; 
  font-weight: 800; 
  color: var(--text);
  letter-spacing: -0.02em;
}
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--primary-gradient);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-btn);
  transition: all 0.2s ease;
}
.btn-primary:hover { 
  background: var(--primary-hover);
  box-shadow: var(--shadow-btn-hover);
  transform: translateY(-1px);
}
.kb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}
.empty {
  padding: 64px 32px;
  text-align: center;
  color: var(--text-muted);
  border: 1px dashed rgba(226, 232, 240, 0.9);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  font-size: 14px;
}
</style>
