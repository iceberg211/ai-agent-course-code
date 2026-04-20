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
import KnowledgeBaseCard from '../../components/knowledge-base/KnowledgeBaseCard.vue'
import KnowledgeBaseCreateModal from '../../components/knowledge-base/KnowledgeBaseCreateModal.vue'

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
