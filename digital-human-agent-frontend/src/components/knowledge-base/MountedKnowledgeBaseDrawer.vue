<template>
  <aside class="w-[320px] shrink-0 bg-gradient-to-b from-white to-slate-50/75 border-l border-slate-200 flex flex-col overflow-hidden h-full shadow-card" aria-label="知识与记忆挂载">
    <div class="flex items-center justify-between p-4.5 border-b border-slate-200 shrink-0 bg-white">
      <div class="flex items-start gap-2 text-text-main">
        <DatabaseIcon :size="15" class="text-primary mt-0.5" aria-hidden="true" />
        <div class="flex flex-col text-left">
          <span class="text-xs font-extrabold">知识与记忆控制台</span>
          <p class="m-0 text-[10.5px] text-text-muted mt-0.5">{{ personaName ? `角色：${personaName}` : '选择角色以挂载配置' }}</p>
        </div>
      </div>
      <button class="w-6 h-6 border-none bg-transparent rounded-full flex items-center justify-center cursor-pointer text-text-muted hover:bg-slate-100 hover:text-text-secondary transition-colors" @click="$emit('close')" aria-label="关闭面板">
        <XIcon :size="14" aria-hidden="true" />
      </button>
    </div>

    <!-- 页签导航：切换知识库挂载与 AI 长期记忆 -->
    <div class="flex border-b border-slate-200 shrink-0 bg-white">
      <button 
        v-for="tab in [{ key: 'knowledge', label: '知识库挂载' }, { key: 'memory', label: '长期记忆' }]" 
        :key="tab.key"
        class="flex-1 p-2.5 text-xs font-bold text-center border-none bg-transparent cursor-pointer transition-colors relative"
        :class="activeTab === tab.key ? 'text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-primary' : 'text-text-muted hover:text-text-secondary'"
        type="button"
        @click="activeTab = tab.key as 'knowledge' | 'memory'"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <!-- 🚀 Tab 1: 知识库挂载 -->
      <div v-if="activeTab === 'knowledge'" class="flex flex-col gap-4 p-4">
        <section
          v-if="focusSummary"
          class="p-3 border rounded-xl flex items-start gap-2.5 text-left"
          :class="focusSummary.tone === 'active' ? 'border-blue-200 bg-blue-50/40' : 'border-amber-200 bg-amber-50/40'"
        >
          <div class="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-primary-bg text-primary" aria-hidden="true">
            <SparklesIcon v-if="focusSummary.tone === 'active'" :size="14" />
            <TriangleAlertIcon v-else :size="14" class="text-amber-600" />
          </div>
          <div class="flex flex-col gap-1 min-w-0">
            <p class="m-0 text-[9px] font-bold tracking-wider text-text-muted uppercase">本次验证</p>
            <h3 class="m-0 text-xs font-bold text-text-main">{{ focusSummary.title }}</h3>
            <p class="m-0 text-[11px] leading-relaxed text-text-secondary">{{ focusSummary.description }}</p>
          </div>
        </section>

        <div v-if="loading" class="text-center py-8 text-text-muted text-xs">加载中…</div>
        <div v-else-if="!personaId" class="flex flex-col items-center justify-center p-8 text-center text-text-muted gap-2.5">
          <BookOpenIcon :size="28" class="text-slate-350" />
          <p class="text-xs">先选择一个角色，再为它挂载知识库</p>
        </div>
        <template v-else>
          <section class="flex flex-col text-left">
            <div class="flex items-center gap-1.5 mb-2.5">
              <BookOpenIcon :size="13" class="text-primary" aria-hidden="true" />
              <span class="text-xs font-extrabold text-text-secondary">已挂载</span>
              <strong class="text-[10px] font-black bg-primary-bg text-primary px-1.5 py-0.5 rounded-[4px] ml-auto">{{ mounted.length }}</strong>
            </div>

            <div v-if="mounted.length === 0" class="py-4 text-center text-text-muted text-xs border border-dashed border-slate-200 rounded-lg">
              当前角色还没有挂载知识库
            </div>
            <ul v-else class="list-none p-0 m-0" role="list">
              <li v-for="kb in mountedDisplay" :key="kb.id" class="flex items-start justify-between gap-3 p-3.5 border border-slate-200/60 rounded-xl bg-white/60 mb-2.5">
                <div class="flex flex-col gap-1 min-w-0 text-left">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-xs font-bold text-text-secondary truncate max-w-[120px]" :title="kb.name">{{ kb.name }}</span>
                    <span v-if="kb.id === props.focusKnowledgeBaseId" class="bg-blue-50 text-primary text-[9px] font-bold px-1 rounded-[4px]">当前验证</span>
                  </div>
                  <p v-if="kb.description" class="m-0 text-[11px] text-text-muted line-clamp-2 leading-relaxed">{{ kb.description }}</p>
                  <div class="flex items-center gap-1.5 flex-wrap mt-1 text-[9.5px] text-text-muted">
                    <span class="bg-slate-100 px-1 rounded-[4px]">阈值 {{ kb.retrievalConfig.threshold }}</span>
                    <span class="bg-slate-100 px-1 rounded-[4px]">TopK {{ kb.retrievalConfig.finalTopK }}</span>
                    <span v-if="kb.retrievalConfig.rerank" class="bg-indigo-50 text-indigo-700 px-1 rounded-[4px] font-bold">Rerank</span>
                  </div>
                </div>
                <button
                  class="shrink-0 p-1 px-2.5 border border-slate-200 hover:border-red-500/30 hover:bg-red-50 hover:text-error rounded-md text-[10.5px] font-bold text-text-secondary cursor-pointer transition-all"
                  type="button"
                  :disabled="actingKbId === kb.id"
                  @click="detach(kb.id)"
                >
                  {{ actingKbId === kb.id ? '...' : '解除' }}
                </button>
              </li>
            </ul>
          </section>

          <section class="flex flex-col text-left mt-2.5">
            <div class="flex items-center gap-1.5 mb-2.5">
              <SettingsIcon :size="13" class="text-text-muted" aria-hidden="true" />
              <span class="text-xs font-extrabold text-text-secondary">可挂载知识库</span>
              <strong class="text-[10px] font-black bg-slate-100 text-text-muted px-1.5 py-0.5 rounded-[4px] ml-auto">{{ attachable.length }}</strong>
            </div>

            <div v-if="attachable.length === 0" class="py-4 text-center text-text-muted text-xs border border-dashed border-slate-200 rounded-lg">
              {{ allKbs.length === 0 ? '无知识库，先去工作区创建' : '没有可新增挂载的知识库' }}
            </div>
            <ul v-else class="list-none p-0 m-0" role="list">
              <li v-for="kb in attachable" :key="kb.id" class="flex items-start justify-between gap-3 p-3.5 border border-slate-200/60 rounded-xl bg-white/60 mb-2.5">
                <div class="flex flex-col gap-1 min-w-0 text-left">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-bold text-text-secondary truncate max-w-[150px]" :title="kb.name">{{ kb.name }}</span>
                    <span v-if="kb.id === props.focusKnowledgeBaseId" class="bg-amber-50 text-amber-700 text-[9px] font-bold px-1 rounded-[4px]">待验证</span>
                  </div>
                  <p v-if="kb.description" class="m-0 text-[11px] text-text-muted line-clamp-2 leading-relaxed">{{ kb.description }}</p>
                </div>
                <button
                  class="shrink-0 p-1 px-3 bg-primary text-white border-none rounded-md text-[10.5px] font-bold cursor-pointer transition-all hover:brightness-105"
                  type="button"
                  :disabled="actingKbId === kb.id"
                  @click="attach(kb.id)"
                >
                  {{ actingKbId === kb.id ? '...' : '挂载' }}
                </button>
              </li>
            </ul>
          </section>
        </template>
      </div>

      <!-- 🧠 Tab 2: 长期记忆管理 -->
      <div v-else class="flex flex-col gap-4 p-4 text-left">
        <div>
          <span class="text-[10px] font-black text-primary bg-primary-bg px-1.5 py-0.5 rounded-[4px] uppercase">mem0 Engine</span>
          <h3 class="m-0 text-xs font-extrabold text-text-main mt-1.5">会话长期记忆调试</h3>
          <p class="m-0 text-[11px] leading-relaxed text-text-muted mt-1">手动增加事实以干预后续回答，或抹除不需要的偏好记忆。</p>
        </div>

        <!-- 手动录入 -->
        <form class="flex flex-col gap-2" @submit.prevent="addMemory">
          <input
            v-model="newMemoryContent"
            type="text"
            class="w-full h-8.5 px-2.5 border border-slate-200 rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary transition-all"
            placeholder="让 AI 记住事实偏好…"
            :disabled="memoryLoading"
          />
          <button class="w-full h-8 px-3 inline-flex items-center justify-center gap-1 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer hover:brightness-104" type="submit" :disabled="memoryLoading || !newMemoryContent.trim()">
            <span>记录该事实偏好</span>
          </button>
        </form>

        <!-- 搜索与列表 -->
        <div class="flex flex-col gap-2 border-t border-slate-200/50 pt-3">
          <div class="flex justify-between items-center gap-2 mb-1">
            <span class="text-[11px] font-extrabold text-text-secondary">已保存的记忆 ({{ memories.length }})</span>
            <input
              v-model="memorySearch"
              type="text"
              class="w-32 h-7 px-2 border border-slate-200 rounded-md bg-white text-text-main outline-none text-[10px] focus:border-primary transition-all"
              placeholder="搜索记忆…"
              @input="loadMemories"
            />
          </div>

          <div v-if="memoryLoading && memories.length === 0" class="text-center py-6 text-text-muted text-xs">加载中…</div>
          <div v-else class="flex flex-col gap-2.5">
            <article v-for="item in memories" :key="item.id" class="p-3 border border-slate-200/60 rounded-xl bg-white/60 flex flex-col gap-2">
              <p class="m-0 text-[11.5px] font-semibold text-text-secondary leading-relaxed break-words">{{ item.content }}</p>
              <div class="flex items-center justify-between gap-2 mt-0.5">
                <span class="text-[9.5px] text-text-muted">
                  安全:{{ item.visibility }} · {{ formatDate(item.createdAt || item.created_at) }}
                </span>
                <button
                  class="p-0.5 px-2 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-error rounded-md text-[10px] font-bold cursor-pointer transition-all"
                  type="button"
                  :disabled="memoryLoading"
                  @click="removeMemory(item.id)"
                >
                  抹除
                </button>
              </div>
            </article>
            <p v-if="!memories.length" class="text-center py-6 text-text-muted text-xs border border-dashed border-slate-200 rounded-lg">暂无关联记忆事实</p>
          </div>
        </div>
      </div>
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
import { useProductizedKnowledge } from '@/hooks/useProductizedKnowledge'
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

const activeTab = ref<'knowledge' | 'memory'>('knowledge')

const hook = useKnowledgeBase()
const { listMemories, createMemory, deleteMemory } = useProductizedKnowledge()

const mounted = ref<KnowledgeBase[]>([])
const allKbs = ref<KnowledgeBase[]>([])
const loading = ref(false)
const actingKbId = ref<string | null>(null)
const errorMsg = ref('')

// 长期记忆 states
const memories = ref<any[]>([])
const memoryLoading = ref(false)
const newMemoryContent = ref('')
const memorySearch = ref('')

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
      description: '该知识库已挂载会话中。现在回到对话区提问，就能直接观察回答与引用效果。',
    }
  }

  const pendingTarget = allKbs.value.find((kb) => kb.id === focusId)
  return {
    tone: 'warning' as const,
    title: `待挂载验证：${pendingTarget?.name ?? '目标知识库'}`,
    description: '目标知识库尚未挂载。先在下方点击“挂载”，再回到对话中提问，验证结果才会准确。',
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

// 长期记忆相关操作
async function loadMemories() {
  memoryLoading.value = true
  try {
    memories.value = await listMemories(memorySearch.value)
  } finally {
    memoryLoading.value = false
  }
}

async function addMemory() {
  const content = newMemoryContent.value.trim()
  if (!content) return
  memoryLoading.value = true
  try {
    const res = await createMemory(content)
    if (res) {
      newMemoryContent.value = ''
      await loadMemories()
    }
  } finally {
    memoryLoading.value = false
  }
}

async function removeMemory(id: string) {
  if (!confirm('确定要抹除这段 AI 长期记忆吗？抹除后 AI 将不再遵循该偏好。')) return
  memoryLoading.value = true
  try {
    const ok = await deleteMemory(id)
    if (ok) {
      await loadMemories()
    }
  } finally {
    memoryLoading.value = false
  }
}

function sortKnowledgeBases(items: KnowledgeBase[]) {
  const focusId = props.focusKnowledgeBaseId
  if (!focusId) return items
  return [...items].sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId))
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

onMounted(() => {
  load(props.personaId)
  loadMemories()
})

watch(() => props.personaId, load)
</script>
